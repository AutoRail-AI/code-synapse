/**
 * Local Model Provider
 *
 * Provides a unified interface for local model inference via node-llama-cpp.
 * Uses dependency injection for the LLM service factory to avoid circular dependencies.
 */

import type {
  IModelProvider,
  ModelConfig,
  ModelRequest,
  ModelResponse,
  StreamChunk,
  ModelVendor,
} from "../interfaces/IModel.js";
import { LOCAL_MODELS, getDefaultModelId } from "../Registry.js";
import { createLogger } from "../../telemetry/logger.js";
import type { ILocalLLMService, LocalLLMServiceFactory } from "../internal/index.js";
import { createDefaultLocalLLMService } from "../internal/index.js";

const logger = createLogger("local-provider");

// =============================================================================
// Local Provider Configuration
// =============================================================================

export interface LocalProviderConfig {
  /**
   * Factory function to create LLM services
   * If not provided, uses the default node-llama-cpp based service
   */
  llmServiceFactory?: LocalLLMServiceFactory;

  /**
   * Default model ID to initialize with
   * If not provided, uses Registry default
   */
  defaultModelId?: string;
}

// =============================================================================
// Local Provider Implementation
// =============================================================================

export class LocalModelProvider implements IModelProvider {
  readonly vendorId: ModelVendor = "local";

  private llmService: ILocalLLMService | null = null;
  private llmServiceFactory: LocalLLMServiceFactory;
  private defaultModelId: string;
  private _isAvailable = false;
  private _isReady = false;
  private currentModelId: string | null = null;

  constructor(config?: LocalProviderConfig) {
    // Use injected factory or default
    this.llmServiceFactory = config?.llmServiceFactory ?? createDefaultLocalLLMService;
    const registryDefault = getDefaultModelId("local");
    if (!config?.defaultModelId && !registryDefault) {
      throw new Error("No default model configured for local provider in Registry");
    }
    this.defaultModelId = config?.defaultModelId ?? registryDefault!;
  }

  get isAvailable(): boolean {
    return this._isAvailable;
  }

  async initialize(): Promise<void> {
    logger.debug("Initializing local model provider");

    try {
      // Initialize with default model using injected factory
      this.llmService = await this.llmServiceFactory(this.defaultModelId);
      this.currentModelId = this.defaultModelId;
      this._isAvailable = true;
      this._isReady = true;
      logger.info({ modelId: this.defaultModelId }, "Local model provider initialized");
    } catch (error) {
      logger.warn({ error }, "Failed to initialize local model provider - local models unavailable");
      this._isAvailable = false;
      this._isReady = false;
    }
  }

  isReady(): boolean {
    return this._isReady;
  }

  getAvailableModels(): ModelConfig[] {
    if (!this._isAvailable) return [];
    return LOCAL_MODELS;
  }

  getModel(modelId: string): ModelConfig | undefined {
    return LOCAL_MODELS.find((m) => m.id === modelId);
  }

  async complete(modelId: string, request: ModelRequest): Promise<ModelResponse> {
    if (!this._isReady || !this.llmService) {
      throw new Error("Local model provider not ready");
    }

    const startTime = Date.now();

    // Switch model if necessary
    if (modelId !== this.currentModelId) {
      await this.switchModel(modelId);
    }

    try {
      const result = await this.llmService.generateText(this.formatPrompt(request), {
        maxTokens: request.parameters?.maxTokens ?? 2048,
        temperature: request.parameters?.temperature ?? 0.7,
      });

      const latencyMs = Date.now() - startTime;

      // Estimate token counts (rough approximation)
      const inputTokens = Math.ceil((request.prompt.length + (request.systemPrompt?.length ?? 0)) / 4);
      const outputTokens = Math.ceil(result.length / 4);

      return {
        content: result,
        finishReason: "stop",
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        latencyMs,
        modelId,
      };
    } catch (error) {
      logger.error({ modelId, error }, "Local model completion failed");
      throw error;
    }
  }

  async *stream(modelId: string, request: ModelRequest): AsyncIterable<StreamChunk> {
    if (!this._isReady || !this.llmService) {
      throw new Error("Local model provider not ready");
    }

    // Switch model if necessary
    if (modelId !== this.currentModelId) {
      await this.switchModel(modelId);
    }

    if (this.llmService.streamText) {
      let totalContent = "";
      for await (const chunk of this.llmService.streamText(this.formatPrompt(request), {
        maxTokens: request.parameters?.maxTokens ?? 2048,
        temperature: request.parameters?.temperature ?? 0.7,
      })) {
        totalContent += chunk;
        yield { content: chunk, done: false };
      }

      // Final chunk with usage
      const inputTokens = Math.ceil((request.prompt.length + (request.systemPrompt?.length ?? 0)) / 4);
      const outputTokens = Math.ceil(totalContent.length / 4);

      yield {
        content: "",
        done: true,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      };
    } else {
      // Fallback to non-streaming
      const result = await this.llmService.generateText(this.formatPrompt(request), {
        maxTokens: request.parameters?.maxTokens ?? 2048,
        temperature: request.parameters?.temperature ?? 0.7,
      });

      const inputTokens = Math.ceil((request.prompt.length + (request.systemPrompt?.length ?? 0)) / 4);
      const outputTokens = Math.ceil(result.length / 4);

      yield {
        content: result,
        done: true,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      };
    }
  }

  async embed(_modelId: string, texts: string[]): Promise<number[][]> {
    // Local models don't typically support embeddings via llama.cpp
    // Use the HuggingFace embeddings service instead
    try {
      const { createEmbeddingService } = await import("../../embeddings/index.js");
      const embeddingService = createEmbeddingService();
      await embeddingService.initialize();

      const results = await embeddingService.embedBatch(texts);
      return results.map((r) => r.vector);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          err: error,
          errorMessage,
          errorStack: error instanceof Error ? error.stack : undefined,
          textCount: texts.length,
        },
        "Failed to generate embeddings for %d texts: %s",
        texts.length,
        errorMessage
      );
      throw error;
    }
  }

  estimateTokens(text: string): number {
    // Rough approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  async shutdown(): Promise<void> {
    if (this.llmService?.shutdown) {
      await this.llmService.shutdown();
    }
    this.llmService = null;
    this._isReady = false;
    logger.info("Local model provider shutdown");
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private formatPrompt(request: ModelRequest): string {
    if (request.systemPrompt) {
      return `${request.systemPrompt}\n\n${request.prompt}`;
    }
    return request.prompt;
  }

  private async switchModel(modelId: string): Promise<void> {
    const model = this.getModel(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    logger.debug({ from: this.currentModelId, to: modelId }, "Switching local model");

    try {
      // Shutdown current model
      if (this.llmService?.shutdown) {
        await this.llmService.shutdown();
      }

      // Initialize new model using injected factory
      this.llmService = await this.llmServiceFactory(modelId);
      this.currentModelId = modelId;

      logger.info({ modelId }, "Switched to local model");
    } catch (error) {
      logger.error({ modelId, error }, "Failed to switch model");
      throw error;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a local model provider
 * @param config Optional configuration including custom LLM service factory
 */
export function createLocalProvider(config?: LocalProviderConfig): LocalModelProvider {
  return new LocalModelProvider(config);
}

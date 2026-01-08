/**
 * Local Model Provider
 *
 * Wraps the existing node-llama-cpp based LLM service to provide
 * a unified interface for local model inference.
 */

import type {
  IModelProvider,
  ModelConfig,
  ModelRequest,
  ModelResponse,
  StreamChunk,
  ModelVendor,
} from "../interfaces/IModel.js";
import { LOCAL_MODELS } from "../interfaces/IModel.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("local-provider");

// =============================================================================
// Local Provider Implementation
// =============================================================================

export class LocalModelProvider implements IModelProvider {
  readonly vendorId: ModelVendor = "local";

  private llmService: unknown = null;
  private _isAvailable = false;
  private _isReady = false;
  private currentModelId: string | null = null;

  get isAvailable(): boolean {
    return this._isAvailable;
  }

  async initialize(): Promise<void> {
    logger.debug("Initializing local model provider");

    try {
      // Check if node-llama-cpp is available by trying to import and initialize
      const { createInitializedLLMService } = await import("../../llm/index.js");

      // Try to initialize with default model
      this.llmService = await createInitializedLLMService({ modelId: "qwen2.5-coder-3b" });
      this.currentModelId = "qwen2.5-coder-3b";
      this._isAvailable = true;
      this._isReady = true;
      logger.info("Local model provider initialized");
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
      const llm = this.llmService as {
        generateText: (prompt: string, options?: { maxTokens?: number; temperature?: number }) => Promise<string>;
      };

      const result = await llm.generateText(this.formatPrompt(request), {
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

    // Check if streaming is supported
    const llm = this.llmService as {
      streamText?: (
        prompt: string,
        options?: { maxTokens?: number; temperature?: number }
      ) => AsyncIterable<string>;
      generateText: (prompt: string, options?: { maxTokens?: number; temperature?: number }) => Promise<string>;
    };

    if (llm.streamText) {
      let totalContent = "";
      for await (const chunk of llm.streamText(this.formatPrompt(request), {
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
      const result = await llm.generateText(this.formatPrompt(request), {
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
      logger.error({ error }, "Failed to generate embeddings");
      throw error;
    }
  }

  estimateTokens(text: string): number {
    // Rough approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  async shutdown(): Promise<void> {
    if (this.llmService) {
      const llm = this.llmService as { shutdown?: () => Promise<void> };
      if (llm.shutdown) {
        await llm.shutdown();
      }
      this.llmService = null;
    }
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
      const { createInitializedLLMService } = await import("../../llm/index.js");

      // Shutdown current model
      if (this.llmService) {
        const llm = this.llmService as { shutdown?: () => Promise<void> };
        if (llm.shutdown) {
          await llm.shutdown();
        }
      }

      // Initialize new model
      this.llmService = await createInitializedLLMService({ modelId });
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

export function createLocalProvider(): LocalModelProvider {
  return new LocalModelProvider();
}

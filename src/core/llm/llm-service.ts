/**
 * LLM Service - Local model management with node-llama-cpp
 *
 * Provides local LLM inference capabilities for:
 * - Function summarization and business logic inference
 * - Structured JSON output via grammar enforcement
 * - Caching to avoid redundant inference
 *
 * @module
 */

import {
  getLlama,
  LlamaChatSession,
  type Llama,
  type LlamaModel,
  type LlamaContext,
} from "node-llama-cpp";
import { createLogger } from "../../utils/logger.js";
import type { AsyncDisposable } from "../../utils/disposable.js";
import { resolveModel, getModelById, MODEL_PRESETS, type ModelSpec, type ModelPreset } from "./models.js";

const logger = createLogger("llm-service");

// =============================================================================
// Types
// =============================================================================

export interface LLMServiceConfig {
  /** Model ID from registry (e.g., "qwen2.5-coder-3b") - recommended */
  modelId?: string;
  /** Path to the GGUF model file (alternative to modelId) */
  modelPath?: string;
  /** GPU layers to offload (0 = CPU only, -1 = all) */
  gpuLayers?: number;
  /** Context size in tokens (default: 4096) */
  contextSize?: number;
  /** Enable inference caching (default: true) */
  enableCache?: boolean;
  /** Maximum cache entries (default: 1000) */
  maxCacheEntries?: number;
  /** Custom directory for model storage */
  modelsDir?: string;
}

/** JSON schema type for structured output */
export type JsonSchema = Record<string, unknown>;

export interface InferenceOptions {
  /** Maximum tokens to generate (default: 512) */
  maxTokens?: number;
  /** Temperature for sampling (default: 0.7) */
  temperature?: number;
  /** Stop sequences to end generation */
  stopSequences?: string[];
  /** JSON schema for structured output */
  jsonSchema?: JsonSchema;
  /** Skip cache lookup for this request */
  skipCache?: boolean;
}

export interface InferenceResult {
  /** Generated text */
  text: string;
  /** Parsed JSON if jsonSchema was provided */
  parsed?: unknown;
  /** Whether result came from cache */
  fromCache: boolean;
  /** Tokens generated (estimated) */
  tokensGenerated: number;
  /** Generation time in ms */
  durationMs: number;
}

export interface LLMStats {
  /** Total inference calls */
  totalCalls: number;
  /** Cache hits */
  cacheHits: number;
  /** Cache misses */
  cacheMisses: number;
  /** Total tokens generated */
  totalTokens: number;
  /** Average generation time in ms */
  avgDurationMs: number;
  /** Model loaded status */
  modelLoaded: boolean;
}

// =============================================================================
// Cache Entry
// =============================================================================

interface CacheEntry {
  result: InferenceResult;
  timestamp: number;
}

// =============================================================================
// LLM Service
// =============================================================================

export class LLMService implements AsyncDisposable {
  private config: LLMServiceConfig;
  private resolvedModelPath: string | null = null;
  private modelSpec: ModelSpec | null = null;
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private cache: Map<string, CacheEntry> = new Map();
  private stats: LLMStats = {
    totalCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalTokens: 0,
    avgDurationMs: 0,
    modelLoaded: false,
  };
  private totalDurationMs = 0;

  constructor(config: LLMServiceConfig) {
    // Validate that at least one of modelId or modelPath is provided
    if (!config.modelId && !config.modelPath) {
      throw new Error("Either modelId or modelPath must be provided");
    }

    this.config = {
      gpuLayers: 0,
      contextSize: 4096,
      enableCache: true,
      maxCacheEntries: 1000,
      ...config,
    };

    // If modelId provided, get the model spec
    if (config.modelId) {
      this.modelSpec = getModelById(config.modelId) || null;
      if (!this.modelSpec) {
        throw new Error(`Unknown model ID: ${config.modelId}. Use getAvailableModels() to see valid options.`);
      }
    }
  }

  /**
   * Get the loaded model specification (if using modelId)
   */
  getModelSpec(): ModelSpec | null {
    return this.modelSpec;
  }

  /**
   * Initialize the LLM service and load the model
   */
  async initialize(): Promise<void> {
    try {
      // Resolve model path from modelId or use provided modelPath
      if (this.config.modelId) {
        logger.info({ modelId: this.config.modelId }, "Resolving model from registry");

        const resolution = await resolveModel(this.config.modelId, {
          modelsDir: this.config.modelsDir,
        });

        this.resolvedModelPath = resolution.path;
        logger.info({
          modelId: this.config.modelId,
          modelPath: this.resolvedModelPath,
          wasDownloaded: resolution.wasDownloaded,
        }, "Model resolved");
      } else if (this.config.modelPath) {
        this.resolvedModelPath = this.config.modelPath;
      } else {
        throw new Error("No model path resolved");
      }

      logger.info({ modelPath: this.resolvedModelPath }, "Initializing LLM service");

      // Initialize llama.cpp
      this.llama = await getLlama();

      // Load the model
      this.model = await this.llama.loadModel({
        modelPath: this.resolvedModelPath,
        gpuLayers: this.config.gpuLayers,
      });

      // Create context
      this.context = await this.model.createContext({
        contextSize: this.config.contextSize,
      });

      this.stats.modelLoaded = true;
      logger.info({
        modelName: this.modelSpec?.name || "Custom Model",
      }, "LLM service initialized successfully");
    } catch (error) {
      logger.error({ error }, "Failed to initialize LLM service");
      throw error;
    }
  }

  /**
   * Check if the model is loaded and ready
   */
  isReady(): boolean {
    return this.model !== null && this.context !== null;
  }

  /**
   * Generate text completion using chat session
   */
  async complete(prompt: string, options: InferenceOptions = {}): Promise<InferenceResult> {
    if (!this.isReady()) {
      throw new Error("LLM service not initialized. Call initialize() first.");
    }

    const {
      maxTokens = 512,
      temperature = 0.7,
      jsonSchema,
      skipCache = false,
    } = options;

    this.stats.totalCalls++;

    // Check cache
    const cacheKey = this.getCacheKey(prompt, options);
    if (this.config.enableCache && !skipCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        logger.debug({ cacheKey }, "Cache hit");
        return { ...cached.result, fromCache: true };
      }
    }
    this.stats.cacheMisses++;

    const startTime = Date.now();

    try {
      // Create a chat session for this completion
      const session = new LlamaChatSession({
        contextSequence: this.context!.getSequence(),
      });

      let text: string;
      let parsed: unknown;

      if (jsonSchema) {
        // Use grammar-constrained generation for structured output
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const grammar = await this.llama!.createGrammarForJsonSchema(jsonSchema as any);

        // Generate with grammar constraint
        text = await session.prompt(prompt, {
          maxTokens,
          temperature,
          grammar,
        });

        // Parse the JSON output
        try {
          parsed = grammar.parse(text);
        } catch (parseError) {
          logger.warn({ parseError, text }, "Failed to parse grammar output");
          // Try direct JSON parse as fallback
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = undefined;
          }
        }
      } else {
        // Regular text generation
        text = await session.prompt(prompt, {
          maxTokens,
          temperature,
        });
      }

      // Estimate tokens generated (rough approximation: ~4 chars per token)
      const tokensGenerated = Math.ceil(text.length / 4);

      const durationMs = Date.now() - startTime;
      this.totalDurationMs += durationMs;
      this.stats.totalTokens += tokensGenerated;
      this.stats.avgDurationMs = this.totalDurationMs / this.stats.totalCalls;

      const result: InferenceResult = {
        text,
        parsed,
        fromCache: false,
        tokensGenerated,
        durationMs,
      };

      // Cache the result
      if (this.config.enableCache) {
        this.addToCache(cacheKey, result);
      }

      logger.debug(
        { tokensGenerated, durationMs },
        "Inference complete"
      );

      // Dispose of the session to free up the context sequence
      session.dispose();

      return result;
    } catch (error) {
      logger.error({ error }, "Inference failed");
      throw error;
    }
  }

  /**
   * Get cache key for a prompt and options
   */
  private getCacheKey(prompt: string, options: InferenceOptions): string {
    const optionsKey = JSON.stringify({
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      jsonSchema: options.jsonSchema,
    });
    return `${prompt}::${optionsKey}`;
  }

  /**
   * Add result to cache with LRU eviction
   */
  private addToCache(key: string, result: InferenceResult): void {
    // Evict oldest entries if cache is full
    if (this.cache.size >= this.config.maxCacheEntries!) {
      const oldest = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      )[0];
      if (oldest) {
        this.cache.delete(oldest[0]);
      }
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear the inference cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug("Inference cache cleared");
  }

  /**
   * Get service statistics
   */
  getStats(): LLMStats {
    return { ...this.stats };
  }

  /**
   * Close the service and release resources
   */
  async close(): Promise<void> {
    logger.info("Closing LLM service");

    if (this.context) {
      await this.context.dispose();
      this.context = null;
    }

    if (this.model) {
      await this.model.dispose();
      this.model = null;
    }

    this.llama = null;
    this.stats.modelLoaded = false;
    this.cache.clear();

    logger.info("LLM service closed");
  }

  /**
   * AsyncDisposable implementation
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/**
 * Create an LLM service instance
 */
export function createLLMService(config: LLMServiceConfig): LLMService {
  return new LLMService(config);
}

/**
 * Create and initialize an LLM service
 */
export async function createInitializedLLMService(
  config: LLMServiceConfig
): Promise<LLMService> {
  const service = new LLMService(config);
  await service.initialize();
  return service;
}

// Re-export ModelPreset type from models for convenience
export type { ModelPreset } from "./models.js";

/**
 * Create an LLM service using a preset
 *
 * Presets:
 * - "fastest": Qwen 2.5 Coder 0.5B - Ultra-fast, minimal resources
 * - "balanced": Qwen 2.5 Coder 3B - Best balance of speed and quality (RECOMMENDED)
 * - "quality": Qwen 2.5 Coder 7B - High quality, moderate resources
 * - "maximum": Qwen 2.5 Coder 14B - Maximum quality, requires 16GB+ RAM
 * - "minimal": Qwen 2.5 Coder 1.5B - Good for low-memory systems
 */
export function createLLMServiceWithPreset(
  preset: ModelPreset,
  options?: Omit<LLMServiceConfig, "modelId" | "modelPath">
): LLMService {
  const modelId = MODEL_PRESETS[preset];
  return new LLMService({
    modelId,
    ...options,
  });
}

/**
 * Create and initialize an LLM service using a preset
 */
export async function createInitializedLLMServiceWithPreset(
  preset: ModelPreset,
  options?: Omit<LLMServiceConfig, "modelId" | "modelPath">
): Promise<LLMService> {
  const service = createLLMServiceWithPreset(preset, options);
  await service.initialize();
  return service;
}

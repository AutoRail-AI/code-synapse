/**
 * API-based LLM Service
 *
 * Provides LLM inference through external APIs (Anthropic, OpenAI, Google).
 * Implements the same interface as the local LLMService for seamless swapping.
 *
 * @module
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { createLogger } from "../../utils/logger.js";
import type {
  ILLMService,
  InferenceOptions,
  InferenceResult,
  LLMStats,
  JsonSchema,
} from "./interfaces/ILLMService.js";

const logger = createLogger("api-llm-service");

// =============================================================================
// Types
// =============================================================================

export type APIProvider = "anthropic" | "openai" | "google";

export interface APILLMServiceConfig {
  /** API provider */
  provider: APIProvider;
  /** API key (reads from env if not provided) */
  apiKey?: string;
  /** Model ID to use */
  modelId?: string;
  /** Max retries for failed requests */
  maxRetries?: number;
}

// Default models per provider
const DEFAULT_MODELS: Record<APIProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  google: "gemini-3-pro-preview",
};

// =============================================================================
// API LLM Service
// =============================================================================

/**
 * API-based LLM Service using external providers.
 */
export class APILLMService implements ILLMService {
  private config: Required<APILLMServiceConfig>;
  private anthropicClient: Anthropic | null = null;
  private openaiClient: OpenAI | null = null;
  private googleClient: GoogleGenerativeAI | null = null;
  private googleModel: GenerativeModel | null = null;
  private ready = false;

  // Stats
  private stats = {
    totalCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalTokens: 0,
    totalDurationMs: 0,
  };

  // Simple in-memory cache
  private cache = new Map<string, InferenceResult>();
  private static readonly MAX_CACHE_SIZE = 1000;

  constructor(config: APILLMServiceConfig) {
    this.config = {
      provider: config.provider,
      apiKey: config.apiKey || this.getApiKeyFromEnv(config.provider),
      modelId: config.modelId || DEFAULT_MODELS[config.provider],
      maxRetries: config.maxRetries ?? 3,
    };
  }

  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Get API key from environment variables
   */
  private getApiKeyFromEnv(provider: APIProvider): string {
    const envVars: Record<APIProvider, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
    };

    const key = process.env[envVars[provider]];
    if (!key) {
      throw new Error(
        `API key not found. Set ${envVars[provider]} environment variable or provide apiKey in config.`
      );
    }
    return key;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.ready) return;

    logger.debug(
      { provider: this.config.provider, model: this.config.modelId },
      "Initializing API LLM service"
    );

    switch (this.config.provider) {
      case "anthropic":
        this.anthropicClient = new Anthropic({
          apiKey: this.config.apiKey,
          maxRetries: this.config.maxRetries,
        });
        break;

      case "openai":
        this.openaiClient = new OpenAI({
          apiKey: this.config.apiKey,
          maxRetries: this.config.maxRetries,
        });
        break;

      case "google":
        this.googleClient = new GoogleGenerativeAI(this.config.apiKey);
        this.googleModel = this.googleClient.getGenerativeModel({
          model: this.config.modelId,
        });
        break;

      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }

    this.ready = true;
    logger.debug({ provider: this.config.provider }, "API LLM service initialized");
  }

  /**
   * Run inference with the given prompt
   */
  async infer(prompt: string, options?: InferenceOptions): Promise<InferenceResult> {
    if (!this.ready) {
      throw new Error("Service not initialized. Call initialize() first.");
    }

    const startTime = Date.now();
    this.stats.totalCalls++;

    // Check cache
    const cacheKey = this.getCacheKey(prompt, options);
    if (!options?.skipCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return { ...cached, fromCache: true };
      }
    }
    this.stats.cacheMisses++;

    let result: InferenceResult;

    switch (this.config.provider) {
      case "anthropic":
        result = await this.inferAnthropic(prompt, options);
        break;

      case "openai":
        result = await this.inferOpenAI(prompt, options);
        break;

      case "google":
        result = await this.inferGoogle(prompt, options);
        break;

      default:
        throw new Error(`Provider ${this.config.provider} not implemented`);
    }

    // Update stats
    const durationMs = Date.now() - startTime;
    this.stats.totalTokens += result.tokensGenerated;
    this.stats.totalDurationMs += durationMs;

    // Cache result
    this.cacheResult(cacheKey, result);

    return result;
  }

  /**
   * Alias for infer() to match LLMService interface
   */
  async complete(prompt: string, options?: InferenceOptions): Promise<InferenceResult> {
    return this.infer(prompt, options);
  }

  /**
   * Run inference using Anthropic API with streaming
   *
   * Streaming is required for operations that may take longer than 10 minutes.
   * We always use streaming to ensure large batch requests complete successfully.
   */
  private async inferAnthropic(
    prompt: string,
    options?: InferenceOptions
  ): Promise<InferenceResult> {
    if (!this.anthropicClient) {
      throw new Error("Anthropic client not initialized");
    }

    const startTime = Date.now();
    const maxTokens = options?.maxTokens ?? 2048;

    // Split prompt into system and user parts if it contains a system prompt pattern
    let systemPrompt = "";
    let userPrompt = prompt;

    // Check if prompt has a system/user split
    const systemMatch = prompt.match(/^(.*?)(?:\n\n|$)([\s\S]*)$/);
    if (systemMatch && systemMatch[1] && systemMatch[2]) {
      // If the first part looks like a system prompt (instruction-like)
      if (
        systemMatch[1].length < 2000 &&
        (systemMatch[1].includes("You are") ||
          systemMatch[1].includes("your task") ||
          systemMatch[1].includes("must") ||
          systemMatch[1].includes("should"))
      ) {
        systemPrompt = systemMatch[1];
        userPrompt = systemMatch[2];
      }
    }

    try {
      // Use streaming for all requests to handle long-running operations
      // Anthropic SDK requires streaming for requests >10 minutes
      logger.debug(
        { maxTokens, promptLength: prompt.length },
        "Starting Anthropic streaming request"
      );

      const stream = this.anthropicClient.messages.stream({
        model: this.config.modelId,
        max_tokens: maxTokens,
        system: systemPrompt || undefined,
        messages: [{ role: "user", content: userPrompt }],
        stop_sequences: options?.stopSequences,
      });

      // Accumulate text from stream
      let text = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let chunkCount = 0;
      let lastProgressLog = Date.now();

      // Listen for text events
      stream.on("text", (chunk) => {
        text += chunk;
        chunkCount++;
        // Log progress every 5 seconds or every 100 chunks
        const now = Date.now();
        if (now - lastProgressLog > 5000 || chunkCount % 100 === 0) {
          logger.debug(
            { chunks: chunkCount, textLength: text.length },
            "Anthropic streaming progress"
          );
          lastProgressLog = now;
        }
      });

      // Listen for errors
      stream.on("error", (error) => {
        logger.error({ error }, "Anthropic stream error");
      });

      // Log when stream starts connecting
      stream.on("connect", () => {
        logger.debug("Anthropic stream connected");
      });

      logger.debug("Waiting for Anthropic stream to complete...");

      // Wait for the final message to get usage statistics
      const finalMessage = await stream.finalMessage();

      // Get token counts from final message
      if (finalMessage.usage) {
        inputTokens = finalMessage.usage.input_tokens;
        outputTokens = finalMessage.usage.output_tokens;
      }

      const durationMs = Date.now() - startTime;

      logger.debug(
        {
          inputTokens,
          outputTokens,
          textLength: text.length,
          durationMs,
        },
        "Anthropic streaming request complete"
      );

      // Parse JSON if schema was provided
      let parsed: unknown;
      if (options?.jsonSchema) {
        try {
          // Extract JSON from the response (might be wrapped in markdown code blocks)
          const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
          const jsonStr = jsonMatch[1]?.trim() || text.trim();
          parsed = JSON.parse(jsonStr);
        } catch (parseError) {
          const preview = text.length > 200 ? text.slice(0, 200) + "..." : text;
          logger.warn(
            { preview, error: String(parseError) },
            "Failed to parse JSON response from API"
          );
        }
      }

      return {
        text,
        parsed,
        fromCache: false,
        tokensGenerated: outputTokens || Math.ceil(text.length / 4),
        durationMs,
      };
    } catch (error) {
      logger.error({ error }, "Anthropic API call failed");
      throw error;
    }
  }

  /**
   * Run inference using OpenAI API
   */
  private async inferOpenAI(
    prompt: string,
    options?: InferenceOptions
  ): Promise<InferenceResult> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    const startTime = Date.now();

    // Split prompt into system and user parts if it contains a system prompt pattern
    let systemPrompt = "";
    let userPrompt = prompt;

    const systemMatch = prompt.match(/^(.*?)(?:\n\n|$)([\s\S]*)$/);
    if (systemMatch && systemMatch[1] && systemMatch[2]) {
      if (
        systemMatch[1].length < 2000 &&
        (systemMatch[1].includes("You are") ||
          systemMatch[1].includes("your task") ||
          systemMatch[1].includes("must") ||
          systemMatch[1].includes("should"))
      ) {
        systemPrompt = systemMatch[1];
        userPrompt = systemMatch[2];
      }
    }

    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: userPrompt });

      const response = await this.openaiClient.chat.completions.create({
        model: this.config.modelId,
        max_tokens: options?.maxTokens ?? 2048,
        messages,
        stop: options?.stopSequences,
      });

      const text = response.choices[0]?.message?.content ?? "";
      const durationMs = Date.now() - startTime;

      // Parse JSON if schema was provided
      let parsed: unknown;
      if (options?.jsonSchema) {
        try {
          const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
          const jsonStr = jsonMatch[1]?.trim() || text.trim();
          parsed = JSON.parse(jsonStr);
        } catch (parseError) {
          const preview = text.length > 200 ? text.slice(0, 200) + "..." : text;
          logger.warn(
            { preview, error: String(parseError) },
            "Failed to parse JSON response from OpenAI API"
          );
        }
      }

      return {
        text,
        parsed,
        fromCache: false,
        tokensGenerated: response.usage?.completion_tokens ?? Math.ceil(text.length / 4),
        durationMs,
      };
    } catch (error) {
      logger.error({ error }, "OpenAI API call failed");
      throw error;
    }
  }

  /**
   * Run inference using Google Gemini API
   */
  private async inferGoogle(
    prompt: string,
    options?: InferenceOptions
  ): Promise<InferenceResult> {
    if (!this.googleModel) {
      throw new Error("Google Gemini model not initialized");
    }

    const startTime = Date.now();
    try {
      const generationConfig: any = {
        maxOutputTokens: options?.maxTokens ?? 2048,
        stopSequences: options?.stopSequences,
      };

      if (options?.thinkingLevel) {
        generationConfig.thinkingConfig = {
          thinkingLevel: options.thinkingLevel,
        };
      }

      // Use native Structured Outputs if schema is provided
      if (options?.jsonSchema) {
        generationConfig.responseMimeType = "application/json";
        generationConfig.responseJsonSchema = options.jsonSchema;
      }

      const result = await this.googleModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      });

      const response = result.response;
      const text = response.text();
      const durationMs = Date.now() - startTime;

      // Parse JSON
      let parsed: unknown;
      if (options?.jsonSchema) {
        try {
          parsed = JSON.parse(text);
        } catch (parseError) {
          logger.warn(
            { text, error: String(parseError) },
            "Failed to parse JSON response from Google API (Structured Output)"
          );
        }
      }

      // Google doesn't provide token counts in the same way, estimate from text length
      const tokensGenerated = Math.ceil(text.length / 4);

      return {
        text,
        parsed,
        fromCache: false,
        tokensGenerated,
        durationMs,
      };
    } catch (error) {
      logger.error({ error }, "Google Gemini API call failed");
      throw error;
    }
  }

  /**
   * Get cache key for a request
   */
  private getCacheKey(prompt: string, options?: InferenceOptions): string {
    return `${this.config.modelId}:${prompt}:${JSON.stringify(options || {})}`;
  }

  /**
   * Cache a result with LRU eviction
   */
  private cacheResult(key: string, result: InferenceResult): void {
    if (this.cache.size >= APILLMService.MAX_CACHE_SIZE) {
      // Remove oldest entry (first key)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, result);
  }

  /**
   * Get service statistics
   */
  getStats(): LLMStats {
    return {
      totalCalls: this.stats.totalCalls,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      totalTokens: this.stats.totalTokens,
      avgDurationMs:
        this.stats.totalCalls > 0
          ? this.stats.totalDurationMs / this.stats.totalCalls
          : 0,
      modelLoaded: this.ready,
    };
  }

  /**
   * Clear the inference cache
   */
  clearCache(): void {
    this.cache.clear();
    this.stats.cacheHits = 0;
    this.stats.cacheMisses = 0;
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    this.ready = false;
    this.anthropicClient = null;
    this.openaiClient = null;
    this.googleClient = null;
    this.googleModel = null;
    this.cache.clear();
    logger.debug("API LLM service shut down");
  }

  /**
   * Alias for shutdown() to match local LLMService interface
   */
  async close(): Promise<void> {
    return this.shutdown();
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an API LLM service
 */
export function createAPILLMService(config: APILLMServiceConfig): APILLMService {
  return new APILLMService(config);
}

/**
 * Create and initialize an API LLM service
 */
export async function createInitializedAPILLMService(
  config: APILLMServiceConfig
): Promise<APILLMService> {
  const service = createAPILLMService(config);
  await service.initialize();
  return service;
}

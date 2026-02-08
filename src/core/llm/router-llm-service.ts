/**
 * Model Router LLM Service Adapter
 *
 * Wraps IModelRouter to provide ILLMService interface.
 * Works with any provider (local, openai, anthropic, google) without requiring
 * API-specific configuration - the router is already configured.
 *
 * Used by Hybrid Search Phase 4 for answer synthesis.
 *
 * @module
 */

import type {
  ILLMService,
  InferenceOptions,
  InferenceResult,
  LLMStats,
} from "./interfaces/ILLMService.js";
import type { IModelRouter } from "../models/interfaces/IModel.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("router-llm-service");

export interface RouterLLMServiceConfig {
  /** Model ID hint for routing (optional) */
  modelId?: string;
}

/**
 * Adapter that wraps IModelRouter to expose ILLMService.
 * Supports local and cloud providers - no API key resolution needed.
 */
export class RouterLLMService implements ILLMService {
  private router: IModelRouter | null = null;
  private modelId: string;
  private ready = false;

  private stats = {
    totalCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalTokens: 0,
    totalDurationMs: 0,
  };

  constructor(router: IModelRouter, config: RouterLLMServiceConfig = {}) {
    this.router = router;
    this.modelId = config.modelId ?? "default";
  }

  get isReady(): boolean {
    return this.ready;
  }

  async initialize(): Promise<void> {
    if (this.ready) return;
    if (this.router) {
      try {
        await this.router.initialize();
      } catch (err) {
        logger.warn({ err }, "Model router init failed (may already be ready)");
      }
      this.ready = true;
      logger.debug("Router LLM service ready");
    }
  }

  async infer(prompt: string, options?: InferenceOptions): Promise<InferenceResult> {
    if (!this.ready || !this.router) {
      throw new Error("Router LLM service not initialized");
    }

    const start = Date.now();
    this.stats.totalCalls++;
    this.stats.cacheMisses++;

    try {
      const response = await this.router.execute(
        {
          prompt,
          parameters: {
            maxTokens: options?.maxTokens ?? 512,
            temperature: options?.temperature ?? 0.7,
            stopSequences: options?.stopSequences,
          },
          schema: options?.jsonSchema,
        },
        { preferLocal: true }
      );

      const durationMs = Date.now() - start;
      this.stats.totalDurationMs += durationMs;
      this.stats.totalTokens += response.usage?.totalTokens ?? 0;

      return {
        text: response.content,
        fromCache: false,
        tokensGenerated: response.usage?.totalTokens ?? 0,
        durationMs,
      };
    } catch (err) {
      logger.error({ err }, "Router LLM inference failed");
      throw err;
    }
  }

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

  clearCache(): void {
    this.stats.cacheHits = 0;
    this.stats.cacheMisses = 0;
  }

  async shutdown(): Promise<void> {
    if (this.router) {
      try {
        await this.router.shutdown();
      } catch (err) {
        logger.warn({ err }, "Router shutdown failed");
      }
      this.router = null;
    }
    this.ready = false;
  }
}

export function createRouterLLMService(
  router: IModelRouter,
  config?: RouterLLMServiceConfig
): RouterLLMService {
  return new RouterLLMService(router, config);
}

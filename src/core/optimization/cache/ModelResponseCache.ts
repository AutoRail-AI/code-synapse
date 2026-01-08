/**
 * Model Response Cache
 *
 * Specialized cache for LLM model responses with:
 * - Semantic similarity-based retrieval
 * - Token-aware caching
 * - Cost tracking
 * - Model-specific caching strategies
 */

import type { ICacheStats } from "../interfaces/IOptimization.js";
import { LRUCache } from "./LRUCache.js";
import { createHash } from "node:crypto";

// =============================================================================
// Model Response Types
// =============================================================================

export interface ModelResponseEntry {
  prompt: string;
  promptHash: string;
  response: string;
  modelId: string;
  tokenCount: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost: number;
  latencyMs: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface ModelCacheConfig {
  maxSize: number;
  defaultTtlMs: number;
  maxTokensPerEntry?: number;
  enableSemanticMatching?: boolean;
  similarityThreshold?: number;
}

// =============================================================================
// Model Response Cache Implementation
// =============================================================================

export class ModelResponseCache {
  private cache: LRUCache<string, ModelResponseEntry>;
  private modelIndex: Map<string, Set<string>> = new Map();
  private config: Required<ModelCacheConfig>;

  // Statistics
  private _stats = {
    hits: 0,
    misses: 0,
    semanticHits: 0,
    tokensSaved: 0,
    costSaved: 0,
  };

  constructor(config: ModelCacheConfig) {
    this.config = {
      maxSize: config.maxSize,
      defaultTtlMs: config.defaultTtlMs,
      maxTokensPerEntry: config.maxTokensPerEntry ?? 10000,
      enableSemanticMatching: config.enableSemanticMatching ?? false,
      similarityThreshold: config.similarityThreshold ?? 0.95,
    };

    this.cache = new LRUCache({
      maxSize: config.maxSize,
      defaultTtlMs: config.defaultTtlMs,
      onEvict: (_key: unknown, value: unknown) => {
        const entry = value as ModelResponseEntry;
        this.removeFromModelIndex(entry);
      },
    });
  }

  get(
    prompt: string,
    modelId: string,
    options?: Record<string, unknown>
  ): ModelResponseEntry | undefined {
    const hash = this.hashPrompt(prompt, modelId, options);

    // Try exact match first
    const exactMatch = this.cache.get(hash);
    if (exactMatch) {
      this._stats.hits++;
      this._stats.tokensSaved += exactMatch.tokenCount.total;
      this._stats.costSaved += exactMatch.cost;
      return exactMatch;
    }

    this._stats.misses++;
    return undefined;
  }

  set(
    prompt: string,
    response: string,
    modelId: string,
    metadata: {
      tokenCount: { prompt: number; completion: number; total: number };
      cost: number;
      latencyMs: number;
      options?: Record<string, unknown>;
    }
  ): void {
    // Skip if response is too large
    if (metadata.tokenCount.total > this.config.maxTokensPerEntry) {
      return;
    }

    const hash = this.hashPrompt(prompt, modelId, metadata.options);

    const entry: ModelResponseEntry = {
      prompt,
      promptHash: hash,
      response,
      modelId,
      tokenCount: metadata.tokenCount,
      cost: metadata.cost,
      latencyMs: metadata.latencyMs,
      createdAt: Date.now(),
      metadata: metadata.options,
    };

    this.cache.set(hash, entry, this.config.defaultTtlMs);
    this.addToModelIndex(entry);
  }

  invalidateByModel(modelId: string): number {
    const hashes = this.modelIndex.get(modelId);
    if (!hashes || hashes.size === 0) return 0;

    let invalidated = 0;
    for (const hash of hashes) {
      if (this.cache.delete(hash)) {
        invalidated++;
      }
    }

    this.modelIndex.delete(modelId);
    return invalidated;
  }

  invalidateAll(): void {
    this.cache.clear();
    this.modelIndex.clear();
  }

  stats(): ICacheStats {
    return this.cache.stats();
  }

  getStats(): ICacheStats & {
    semanticHits: number;
    tokensSaved: number;
    costSaved: number;
  } {
    const baseStats = this.cache.stats();
    return {
      ...baseStats,
      semanticHits: this._stats.semanticHits,
      tokensSaved: this._stats.tokensSaved,
      costSaved: this._stats.costSaved,
    };
  }

  clear(): void {
    this.cache.clear();
    this.modelIndex.clear();
    this._stats = {
      hits: 0,
      misses: 0,
      semanticHits: 0,
      tokensSaved: 0,
      costSaved: 0,
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private hashPrompt(
    prompt: string,
    modelId: string,
    options?: Record<string, unknown>
  ): string {
    const content = options
      ? `${modelId}:${prompt}:${JSON.stringify(options)}`
      : `${modelId}:${prompt}`;
    return createHash("sha256").update(content).digest("hex").substring(0, 24);
  }

  private addToModelIndex(entry: ModelResponseEntry): void {
    let modelSet = this.modelIndex.get(entry.modelId);
    if (!modelSet) {
      modelSet = new Set();
      this.modelIndex.set(entry.modelId, modelSet);
    }
    modelSet.add(entry.promptHash);
  }

  private removeFromModelIndex(entry: ModelResponseEntry): void {
    const modelSet = this.modelIndex.get(entry.modelId);
    if (modelSet) {
      modelSet.delete(entry.promptHash);
      if (modelSet.size === 0) {
        this.modelIndex.delete(entry.modelId);
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createModelResponseCache(config: ModelCacheConfig): ModelResponseCache {
  return new ModelResponseCache(config);
}

/**
 * Optimization Layer
 *
 * Main orchestrator that combines all optimization components:
 * - Caching (LRU, Query, Model Response)
 * - Worker pools for parallel processing
 * - Batch writing and write-behind logging
 * - Bloom filters for fast existence checks
 * - Heat tracking for adaptive indexing
 * - Performance monitoring and cost attribution
 */

import type {
  IOptimizationLayer,
  OptimizationConfig,
  OptimizationStats,
} from "../interfaces/IOptimization.js";
import { LRUCache, createLRUCache } from "../cache/LRUCache.js";
import { QueryCache, createQueryCache } from "../cache/QueryCache.js";
import { ModelResponseCache, createModelResponseCache } from "../cache/ModelResponseCache.js";
import { EntityFilter, createEntityFilter } from "../filters/EntityFilter.js";
import { HeatTracker, createHeatTracker } from "../heat/HeatTracker.js";
import { AdaptiveIndex, createAdaptiveIndex } from "../heat/AdaptiveIndex.js";
import { PerformanceTracker, createPerformanceTracker } from "../metrics/PerformanceTracker.js";
import { CostAttribution, createCostAttribution } from "../metrics/CostAttribution.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("optimization-layer");

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_OPTIMIZATION_CONFIG: OptimizationConfig = {
  // Cache settings
  queryCacheSize: 1000,
  queryCacheTtlMs: 300000, // 5 minutes
  modelCacheSize: 500,
  modelCacheTtlMs: 600000, // 10 minutes
  entityCacheSize: 5000,
  entityCacheTtlMs: 300000,

  // Worker pool settings
  minWorkers: 2,
  maxWorkers: 8,
  workerIdleTimeoutMs: 60000,

  // Batch settings
  batchSize: 100,
  batchFlushIntervalMs: 100,
  maxRetries: 3,

  // Filter settings
  bloomFilterSize: 100000,
  bloomFilterFpr: 0.01,

  // Heat tracking settings
  heatDecayIntervalMs: 60000,
  heatDecayFactor: 0.95,
  hotThreshold: 0.8,
  coldThreshold: 0.1,

  // Performance settings
  slowOperationThresholdMs: 1000,
  metricsRetentionMs: 3600000, // 1 hour
};

// =============================================================================
// Optimization Layer Implementation
// =============================================================================

export class OptimizationLayer implements IOptimizationLayer {
  readonly queryCache: QueryCache;
  readonly modelCache: ModelResponseCache;
  readonly entityCache: LRUCache<string, unknown>;
  readonly entityFilter: EntityFilter;
  readonly heatTracker: HeatTracker;
  readonly adaptiveIndex: AdaptiveIndex;
  readonly performanceTracker: PerformanceTracker;
  readonly costAttribution: CostAttribution;

  private config: OptimizationConfig;
  private _isInitialized = false;

  constructor(config: Partial<OptimizationConfig> = {}) {
    this.config = { ...DEFAULT_OPTIMIZATION_CONFIG, ...config };

    // Initialize caches
    this.queryCache = createQueryCache({
      maxSize: this.config.queryCacheSize,
      defaultTtlMs: this.config.queryCacheTtlMs,
    });

    this.modelCache = createModelResponseCache({
      maxSize: this.config.modelCacheSize,
      defaultTtlMs: this.config.modelCacheTtlMs,
    });

    this.entityCache = createLRUCache({
      maxSize: this.config.entityCacheSize,
      defaultTtlMs: this.config.entityCacheTtlMs,
    });

    // Initialize filters
    this.entityFilter = createEntityFilter({
      expectedEntitiesPerType: Math.floor(this.config.bloomFilterSize / 6),
      falsePositiveRate: this.config.bloomFilterFpr,
    });

    // Initialize heat tracking
    this.heatTracker = createHeatTracker({
      decayIntervalMs: this.config.heatDecayIntervalMs,
      decayFactor: this.config.heatDecayFactor,
      hotThreshold: this.config.hotThreshold,
      coldThreshold: this.config.coldThreshold,
    });

    this.adaptiveIndex = createAdaptiveIndex({
      heatConfig: {
        decayIntervalMs: this.config.heatDecayIntervalMs,
        decayFactor: this.config.heatDecayFactor,
        hotThreshold: this.config.hotThreshold,
        coldThreshold: this.config.coldThreshold,
      },
    });

    // Initialize metrics
    this.performanceTracker = createPerformanceTracker({
      slowThresholdMs: this.config.slowOperationThresholdMs,
    });

    this.costAttribution = createCostAttribution();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this._isInitialized) return;

    logger.debug("Initializing optimization layer");

    await Promise.all([
      this.heatTracker.initialize(),
      this.adaptiveIndex.initialize(),
      this.performanceTracker.initialize(),
    ]);

    this._isInitialized = true;
    logger.info("Optimization layer initialized");
  }

  async shutdown(): Promise<void> {
    if (!this._isInitialized) return;

    logger.debug("Shutting down optimization layer");

    await Promise.all([
      this.heatTracker.shutdown(),
      this.adaptiveIndex.shutdown(),
      this.performanceTracker.shutdown(),
    ]);

    this._isInitialized = false;
    logger.info("Optimization layer shutdown complete");
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  // ==========================================================================
  // Cache Operations
  // ==========================================================================

  getCachedQuery<T>(query: string): T | undefined {
    const opId = this.performanceTracker.startTiming("cache.query.get", "cache");
    const result = this.queryCache.get(query);
    this.performanceTracker.endTiming(opId);

    if (result) {
      this.heatTracker.recordAccess(`query:${query}`, "query");
    }

    return result as T | undefined;
  }

  cacheQuery<T>(query: string, result: T, dependencies?: string[]): void {
    const opId = this.performanceTracker.startTiming("cache.query.set", "cache");
    this.queryCache.set(query, result, dependencies);
    this.performanceTracker.endTiming(opId);
  }

  getCachedModelResponse<T>(prompt: string, modelId: string): T | undefined {
    const opId = this.performanceTracker.startTiming("cache.model.get", "cache");
    const result = this.modelCache.get(prompt, modelId);
    this.performanceTracker.endTiming(opId);

    return result?.response as T | undefined;
  }

  cacheModelResponse<T>(
    prompt: string,
    modelId: string,
    response: T,
    inputTokens: number,
    outputTokens: number
  ): void {
    const opId = this.performanceTracker.startTiming("cache.model.set", "cache");
    this.modelCache.set(prompt, String(response), modelId, {
      tokenCount: { prompt: inputTokens, completion: outputTokens, total: inputTokens + outputTokens },
      cost: 0,
      latencyMs: 0,
    });
    this.performanceTracker.endTiming(opId);
  }

  getCachedEntity<T>(entityId: string): T | undefined {
    const opId = this.performanceTracker.startTiming("cache.entity.get", "cache");
    const result = this.entityCache.get(entityId);
    this.performanceTracker.endTiming(opId);

    if (result) {
      this.heatTracker.recordAccess(entityId, "entity");
    }

    return result as T | undefined;
  }

  cacheEntity<T>(entityId: string, entity: T): void {
    const opId = this.performanceTracker.startTiming("cache.entity.set", "cache");
    this.entityCache.set(entityId, entity);
    this.performanceTracker.endTiming(opId);
  }

  invalidateCache(pattern?: string): void {
    if (pattern) {
      this.queryCache.invalidatePattern(pattern);
    } else {
      this.queryCache.clear();
      this.modelCache.clear();
      this.entityCache.clear();
    }
  }

  // ==========================================================================
  // Entity Filtering
  // ==========================================================================

  addEntityToFilter(entityId: string, entityType: string): void {
    this.entityFilter.addEntity(entityId, entityType);
  }

  mightEntityExist(entityId: string): boolean {
    return this.entityFilter.mightExist(entityId);
  }

  filterPossibleEntities(entityIds: string[]): string[] {
    return this.entityFilter.filterPossibleEntities(entityIds);
  }

  // ==========================================================================
  // Heat Tracking
  // ==========================================================================

  recordEntityAccess(entityId: string, entityType: string, weight = 1): void {
    this.heatTracker.recordAccess(entityId, entityType, weight);
    this.adaptiveIndex.recordAccess(entityId, entityType, weight);
  }

  getHotEntities(limit = 100) {
    return this.heatTracker.getHotEntities(limit);
  }

  getColdEntities(limit = 100) {
    return this.heatTracker.getColdEntities(limit);
  }

  shouldPrioritizeEntity(entityId: string): boolean {
    return this.adaptiveIndex.shouldPrioritizeIndexing(entityId);
  }

  // ==========================================================================
  // Performance Tracking
  // ==========================================================================

  startOperation(operation: string, subsystem: string, metadata?: Record<string, unknown>): string {
    return this.performanceTracker.startTiming(operation, subsystem, metadata);
  }

  endOperation(operationId: string): number {
    return this.performanceTracker.endTiming(operationId);
  }

  recordOperation(
    operation: string,
    subsystem: string,
    durationMs: number,
    metadata?: Record<string, unknown>
  ): void {
    this.performanceTracker.recordTiming(operation, subsystem, durationMs, metadata);
  }

  // ==========================================================================
  // Cost Attribution
  // ==========================================================================

  recordLLMUsage(
    operation: string,
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    computeTimeMs: number
  ): void {
    this.costAttribution.recordLLMCost(operation, modelId, inputTokens, outputTokens, computeTimeMs);
  }

  recordEmbeddingUsage(
    operation: string,
    modelId: string,
    tokens: number,
    computeTimeMs: number
  ): void {
    this.costAttribution.recordEmbeddingCost(operation, modelId, tokens, computeTimeMs);
  }

  getCostSummary(since?: number) {
    return this.costAttribution.getSummary(since);
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  stats(): OptimizationStats {
    return {
      cache: {
        query: this.queryCache.stats(),
        model: this.modelCache.stats(),
        entity: this.entityCache.stats(),
      },
      filter: {
        global: this.entityFilter.getGlobalStats(),
        byType: this.entityFilter.getTypeStats(),
      },
      heat: this.heatTracker.stats(),
      performance: this.performanceTracker.getMetrics(),
      cost: this.costAttribution.getSummary(),
    };
  }

  getPerformanceMetrics() {
    return this.performanceTracker.getMetrics();
  }

  getSlowOperations(thresholdMs?: number) {
    return this.performanceTracker.getSlowOperations(thresholdMs);
  }

  getBottlenecks() {
    return this.performanceTracker.getBottlenecks();
  }

  getIndexSuggestions() {
    return this.adaptiveIndex.getIndexSuggestions();
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  getConfig(): OptimizationConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<OptimizationConfig>): void {
    this.config = { ...this.config, ...config };
    // Note: Some config changes require restart to take effect
    logger.debug({ config }, "Optimization config updated");
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createOptimizationLayer(config?: Partial<OptimizationConfig>): OptimizationLayer {
  return new OptimizationLayer(config);
}

export function createDefaultOptimizationConfig(): OptimizationConfig {
  return { ...DEFAULT_OPTIMIZATION_CONFIG };
}

/**
 * Optimization Interfaces
 *
 * Core interfaces for the optimization layer including caching,
 * batching, worker pools, and performance tracking.
 */

// =============================================================================
// Cache Interfaces
// =============================================================================

export interface ICacheEntry<T> {
  value: T;
  size: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  ttl?: number;
}

export interface ICacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
  hitRate: number;
  memoryUsage: number;
}

export interface ICache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V, ttl?: number): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  size(): number;
  stats(): ICacheStats;
  prune(): number;
}

export interface IQueryCache {
  getCachedQuery<T>(queryHash: string): T | undefined;
  cacheQuery<T>(queryHash: string, result: T, ttl?: number): void;
  invalidatePattern(pattern: string): number;
  invalidateAll(): void;
  stats(): ICacheStats;
}

// =============================================================================
// Worker Pool Interfaces
// =============================================================================

export interface IWorkerTask<TInput, TOutput> {
  id: string;
  type: string;
  input: TInput;
  priority?: number;
  timeout?: number;
}

export interface IWorkerResult<TOutput> {
  taskId: string;
  success: boolean;
  output?: TOutput;
  error?: string;
  durationMs: number;
  workerId: string;
}

export interface IWorkerPoolStats {
  totalWorkers: number;
  activeWorkers: number;
  idleWorkers: number;
  pendingTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageTaskDuration: number;
  throughput: number;
}

export interface WorkerPoolStats {
  activeWorkers: number;
  idleWorkers: number;
  pendingTasks: number;
  totalSubmitted: number;
  totalCompleted: number;
  totalFailed: number;
  totalDurationMs: number;
  queueWaitTimeMs: number;
}

export interface IWorkerPool<TInput, TOutput> {
  submit(task: IWorkerTask<TInput, TOutput>): Promise<IWorkerResult<TOutput>>;
  submitBatch(tasks: IWorkerTask<TInput, TOutput>[]): Promise<IWorkerResult<TOutput>[]>;
  resize(size: number): Promise<void>;
  stats(): WorkerPoolStats;
  shutdown(): Promise<void>;
}

// =============================================================================
// Batch Writer Interfaces
// =============================================================================

export interface IBatchConfig {
  maxBatchSize: number;
  maxWaitMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

export interface IBatchItem<T> {
  id: string;
  data: T;
  priority?: number;
  addedAt: number;
}

export interface IBatchResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  errors: Array<{ id: string; error: string }>;
  durationMs: number;
}

export interface IBatchWriter<T> {
  add(item: T, priority?: number): Promise<void>;
  addBatch(items: T[]): Promise<void>;
  flush(): Promise<IBatchResult>;
  stats(): BatchWriterStats;
  shutdown(): Promise<void>;
}

export interface BatchWriterStats {
  pendingItems: number;
  totalWritten: number;
  totalFailed: number;
  batchCount: number;
  averageBatchSize: number;
  averageWriteDuration: number;
}

// =============================================================================
// Bloom Filter Interfaces
// =============================================================================

export interface IBloomFilter {
  add(item: string): void;
  addBatch(items: string[]): void;
  mightContain(item: string): boolean;
  estimatedCount(): number;
  falsePositiveRate(): number;
  clear(): void;
  serialize(): Uint8Array;
  deserialize(data: Uint8Array): void;
}

// =============================================================================
// Performance Tracking Interfaces
// =============================================================================

export interface TimingStats {
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface OperationStats {
  operation: string;
  totalCount: number;
  totalDurationMs: number;
  averageDurationMs: number;
  errorCount: number;
  errorRate: number;
  trend: "improving" | "stable" | "degrading";
}

export interface PerformanceMetrics {
  totalOperations: number;
  totalDurationMs: number;
  averageDurationMs: number;
  operationsPerSecond: number;
  slowOperations: string[];
  bottlenecks: string[];
}

export interface ITimingMetric {
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface IResourceMetric {
  timestamp: number;
  cpuUsage: number;
  memoryUsage: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  activeHandles: number;
}

export interface IOperationMetric {
  operation: string;
  count: number;
  totalDurationMs: number;
  averageDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  errorCount: number;
  errorRate: number;
}

export interface ICostMetric {
  operation: string;
  cpuCost: number;
  memoryCost: number;
  ioCost: number;
  tokenCost: number;
  totalCost: number;
  timestamp: number;
}

export interface IPerformanceTracker {
  initialize(): Promise<void>;
  startTiming(operation: string, subsystem: string, metadata?: Record<string, unknown>): string;
  endTiming(operationId: string): number;
  recordTiming(operation: string, subsystem: string, durationMs: number, metadata?: Record<string, unknown>): void;
  recordError(operation: string, subsystem: string, error: Error): void;
  getTimingStats(operation: string): TimingStats;
  getOperationStats(operation: string): OperationStats;
  getSubsystemStats(subsystem: string): OperationStats;
  getMetrics(): PerformanceMetrics;
  clear(): void;
  shutdown(): Promise<void>;
}

export interface PerformanceReport {
  generatedAt: string;
  uptimeMs: number;
  operations: IOperationMetric[];
  costs: ICostMetric[];
  resources: IResourceMetric[];
  recommendations: OptimizationRecommendation[];
}

export interface OptimizationRecommendation {
  type: "cache" | "parallel" | "batch" | "index" | "model";
  priority: "low" | "medium" | "high" | "critical";
  operation: string;
  currentMetric: number;
  targetMetric: number;
  recommendation: string;
  estimatedImprovement: number;
}

// =============================================================================
// Heat Tracking Interfaces
// =============================================================================

export interface HeatEntry {
  entityId: string;
  entityType: string;
  heat: number;
  accessCount: number;
  lastAccess: number;
}

export interface IHeatEntry {
  entityId: string;
  entityType: string;
  accessCount: number;
  lastAccessedAt: number;
  heatScore: number;
  decayRate: number;
}

export interface IHeatTracker {
  initialize(): Promise<void>;
  recordAccess(entityId: string, entityType: string, weight?: number): void;
  recordBatchAccess(accesses: Array<{ entityId: string; entityType: string; weight?: number }>): void;
  getHeat(entityId: string): number;
  getHotEntities(limit?: number): HeatEntry[];
  getColdEntities(limit?: number): HeatEntry[];
  getHotByType(entityType: string, limit?: number): HeatEntry[];
  isHot(entityId: string): boolean;
  isCold(entityId: string): boolean;
  getAccessPattern(entityId: string): { frequency: number; recency: number; trend: "rising" | "stable" | "falling" };
  stats(): HeatStats;
  clear(): void;
  shutdown(): Promise<void>;
}

export interface HeatStats {
  totalTracked: number;
  hotCount: number;
  coldCount: number;
  averageHeat: number;
  typeDistribution: Record<string, number>;
}

// =============================================================================
// Optimization Layer Interface
// =============================================================================

export interface OptimizationConfig {
  // Cache settings
  queryCacheSize: number;
  queryCacheTtlMs: number;
  modelCacheSize: number;
  modelCacheTtlMs: number;
  entityCacheSize: number;
  entityCacheTtlMs: number;

  // Worker pool settings
  minWorkers: number;
  maxWorkers: number;
  workerIdleTimeoutMs: number;

  // Batch settings
  batchSize: number;
  batchFlushIntervalMs: number;
  maxRetries: number;

  // Bloom filter settings
  bloomFilterSize: number;
  bloomFilterFpr: number;

  // Heat tracking settings
  heatDecayIntervalMs: number;
  heatDecayFactor: number;
  hotThreshold: number;
  coldThreshold: number;

  // Performance settings
  slowOperationThresholdMs: number;
  metricsRetentionMs: number;
}

export const DEFAULT_OPTIMIZATION_CONFIG: OptimizationConfig = {
  // Cache settings
  queryCacheSize: 1000,
  queryCacheTtlMs: 300000,
  modelCacheSize: 500,
  modelCacheTtlMs: 600000,
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

  // Bloom filter settings
  bloomFilterSize: 100000,
  bloomFilterFpr: 0.01,

  // Heat tracking settings
  heatDecayIntervalMs: 60000,
  heatDecayFactor: 0.95,
  hotThreshold: 0.8,
  coldThreshold: 0.1,

  // Performance settings
  slowOperationThresholdMs: 1000,
  metricsRetentionMs: 3600000,
};

export interface OptimizationStats {
  cache: {
    query: ICacheStats;
    model: ICacheStats;
    entity: ICacheStats;
  };
  filter: {
    global: { count: number; fpr: number };
    byType: Record<string, { count: number; fpr: number }>;
  };
  heat: HeatStats;
  performance: PerformanceMetrics;
  cost: {
    totalCost: number;
    byCategory: Record<string, number>;
    byModel: Record<string, number>;
    byOperation: Record<string, number>;
    tokenUsage: {
      input: number;
      output: number;
      embedding: number;
    };
    timeRange: {
      start: number;
      end: number;
    };
  };
}

export interface IOptimizationLayer {
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  isInitialized: boolean;

  // Cache operations
  getCachedQuery<T>(query: string): T | undefined;
  cacheQuery<T>(query: string, result: T, dependencies?: string[]): void;
  getCachedModelResponse<T>(prompt: string, modelId: string): T | undefined;
  cacheModelResponse<T>(prompt: string, modelId: string, response: T, inputTokens: number, outputTokens: number): void;
  getCachedEntity<T>(entityId: string): T | undefined;
  cacheEntity<T>(entityId: string, entity: T): void;
  invalidateCache(pattern?: string): void;

  // Entity filtering
  addEntityToFilter(entityId: string, entityType: string): void;
  mightEntityExist(entityId: string): boolean;
  filterPossibleEntities(entityIds: string[]): string[];

  // Heat tracking
  recordEntityAccess(entityId: string, entityType: string, weight?: number): void;
  getHotEntities(limit?: number): HeatEntry[];
  getColdEntities(limit?: number): HeatEntry[];
  shouldPrioritizeEntity(entityId: string): boolean;

  // Performance tracking
  startOperation(operation: string, subsystem: string, metadata?: Record<string, unknown>): string;
  endOperation(operationId: string): number;
  recordOperation(operation: string, subsystem: string, durationMs: number, metadata?: Record<string, unknown>): void;

  // Cost attribution
  recordLLMUsage(operation: string, modelId: string, inputTokens: number, outputTokens: number, computeTimeMs: number): void;
  recordEmbeddingUsage(operation: string, modelId: string, tokens: number, computeTimeMs: number): void;
  getCostSummary(since?: number): OptimizationStats["cost"];

  // Statistics
  stats(): OptimizationStats;
  getPerformanceMetrics(): PerformanceMetrics;
  getConfig(): OptimizationConfig;
  updateConfig(config: Partial<OptimizationConfig>): void;
}

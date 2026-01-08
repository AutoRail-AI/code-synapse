/**
 * Optimization Module
 *
 * System-wide performance optimization primitives including:
 * - CPU optimization (parallel processing, worker pools)
 * - Memory optimization (LRU caches, streaming, pooling)
 * - IO optimization (batched writes, write-behind logging)
 * - Query optimization (caching, bloom filters, heat indexing)
 *
 * @module
 */

// Interfaces
export * from "./interfaces/IOptimization.js";

// Cache implementations
export * from "./cache/LRUCache.js";
export * from "./cache/QueryCache.js";
export * from "./cache/ModelResponseCache.js";

// Worker pool
export * from "./workers/WorkerPool.js";
export * from "./workers/ParserWorker.js";

// Batching
export * from "./batch/BatchWriter.js";
export * from "./batch/WriteBehindLedger.js";

// Bloom filters
export * from "./filters/BloomFilter.js";
export * from "./filters/EntityFilter.js";

// Performance tracking
export * from "./metrics/PerformanceTracker.js";
export * from "./metrics/CostAttribution.js";

// Heat indexing
export * from "./heat/HeatTracker.js";
export * from "./heat/AdaptiveIndex.js";

// Factory
export {
  createOptimizationLayer,
  createDefaultOptimizationConfig,
} from "./impl/OptimizationLayer.js";

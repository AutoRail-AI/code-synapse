/**
 * Data Flow Cache Service
 *
 * Implements lazy evaluation strategy for data flow analysis:
 * - Compute data flow on-demand (not at index time)
 * - Cache results for reuse
 * - Invalidate on file changes
 * - Track cache statistics
 *
 * @module
 */

import type {
  IDataFlowCache,
  FunctionDataFlow,
  DataFlowCacheStats,
} from "./interfaces.js";

// =============================================================================
// Types
// =============================================================================

interface CacheEntry {
  dataFlow: FunctionDataFlow;
  fileHash: string;
  accessCount: number;
  lastAccessedAt: number;
  createdAt: number;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * In-memory cache for data flow analysis results.
 *
 * Follows the lazy evaluation strategy:
 * 1. When analysis is requested, check cache first
 * 2. If cached and valid, return cached result
 * 3. If not cached, compute and store
 * 4. Invalidate on file changes
 */
export class DataFlowCache implements IDataFlowCache {
  private cache = new Map<string, CacheEntry>();
  private functionToFile = new Map<string, string>();
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  private maxEntries: number;
  private maxAgeMs: number;

  constructor(options: { maxEntries?: number; maxAgeMs?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 10000;
    this.maxAgeMs = options.maxAgeMs ?? 3600000; // 1 hour default
  }

  /**
   * Get cached data flow for a function.
   */
  get(functionId: string): FunctionDataFlow | null {
    const entry = this.cache.get(functionId);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if entry is expired
    if (Date.now() - entry.createdAt > this.maxAgeMs) {
      this.cache.delete(functionId);
      this.stats.misses++;
      return null;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();
    this.stats.hits++;

    return entry.dataFlow;
  }

  /**
   * Store data flow analysis result in cache.
   */
  set(functionId: string, dataFlow: FunctionDataFlow): void {
    // Evict old entries if needed
    if (this.cache.size >= this.maxEntries) {
      this.evictLeastRecentlyUsed();
    }

    const entry: CacheEntry = {
      dataFlow,
      fileHash: "", // Will be set by setWithHash
      accessCount: 0,
      lastAccessedAt: Date.now(),
      createdAt: Date.now(),
    };

    this.cache.set(functionId, entry);
  }

  /**
   * Store data flow with file hash for staleness detection.
   */
  setWithHash(
    functionId: string,
    dataFlow: FunctionDataFlow,
    fileId: string,
    fileHash: string
  ): void {
    // Evict old entries if needed
    if (this.cache.size >= this.maxEntries) {
      this.evictLeastRecentlyUsed();
    }

    const entry: CacheEntry = {
      dataFlow,
      fileHash,
      accessCount: 0,
      lastAccessedAt: Date.now(),
      createdAt: Date.now(),
    };

    this.cache.set(functionId, entry);
    this.functionToFile.set(functionId, fileId);
  }

  /**
   * Check if data flow is cached and still valid.
   */
  isValid(functionId: string, fileHash: string): boolean {
    const entry = this.cache.get(functionId);

    if (!entry) {
      return false;
    }

    // Check hash match
    if (entry.fileHash && entry.fileHash !== fileHash) {
      return false;
    }

    // Check expiration
    if (Date.now() - entry.createdAt > this.maxAgeMs) {
      return false;
    }

    return true;
  }

  /**
   * Invalidate cache for a function.
   */
  invalidate(functionId: string): void {
    this.cache.delete(functionId);
    this.functionToFile.delete(functionId);
  }

  /**
   * Invalidate all cache entries for a file.
   */
  invalidateFile(fileId: string): void {
    const toDelete: string[] = [];

    for (const [functionId, fId] of this.functionToFile) {
      if (fId === fileId) {
        toDelete.push(functionId);
      }
    }

    for (const functionId of toDelete) {
      this.cache.delete(functionId);
      this.functionToFile.delete(functionId);
    }
  }

  /**
   * Get cache statistics.
   */
  getStats(): DataFlowCacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;

    // Estimate memory usage (rough approximation)
    let memoryUsage = 0;
    for (const entry of this.cache.values()) {
      // Estimate ~100 bytes per node, ~50 bytes per edge
      memoryUsage +=
        entry.dataFlow.nodes.length * 100 + entry.dataFlow.edges.length * 50;
    }

    return {
      entries: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate,
      memoryUsage,
    };
  }

  /**
   * Clear all cached data.
   */
  clear(): void {
    this.cache.clear();
    this.functionToFile.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private evictLeastRecentlyUsed(): void {
    // Find the least recently used entry
    let oldestTime = Date.now();
    let oldestKey: string | null = null;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.functionToFile.delete(oldestKey);
      this.stats.evictions++;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a data flow cache instance.
 */
export function createDataFlowCache(options?: {
  maxEntries?: number;
  maxAgeMs?: number;
}): IDataFlowCache {
  return new DataFlowCache(options);
}

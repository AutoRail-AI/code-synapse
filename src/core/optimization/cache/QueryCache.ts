/**
 * Query Cache Implementation
 *
 * Specialized cache for graph database queries with:
 * - Query hash-based keying
 * - Pattern-based invalidation
 * - Dependency tracking
 * - TTL management
 */

import type { IQueryCache, ICacheStats } from "../interfaces/IOptimization.js";
import { LRUCache, type LRUCacheConfig } from "./LRUCache.js";
import { createHash } from "node:crypto";

// =============================================================================
// Query Cache Entry
// =============================================================================

interface QueryCacheEntry<T> {
  result: T;
  queryHash: string;
  queryPattern: string;
  dependencies: Set<string>;
  createdAt: number;
  ttl: number;
}

// =============================================================================
// Query Cache Implementation
// =============================================================================

export interface QueryCacheConfig {
  maxSize: number;
  defaultTtlMs: number;
  enableDependencyTracking?: boolean;
}

export class QueryCache implements IQueryCache {
  private cache: LRUCache<string, QueryCacheEntry<unknown>>;
  private patternIndex: Map<string, Set<string>> = new Map();
  private dependencyIndex: Map<string, Set<string>> = new Map();
  private config: Required<QueryCacheConfig>;

  constructor(config: QueryCacheConfig) {
    this.config = {
      maxSize: config.maxSize,
      defaultTtlMs: config.defaultTtlMs,
      enableDependencyTracking: config.enableDependencyTracking ?? true,
    };

    const lruConfig: LRUCacheConfig = {
      maxSize: config.maxSize,
      defaultTtlMs: config.defaultTtlMs,
      onEvict: (_key: unknown, value: unknown) => {
        const entry = value as QueryCacheEntry<unknown>;
        this.removeFromIndices(entry);
      },
    };

    this.cache = new LRUCache(lruConfig);
  }

  getCachedQuery<T>(queryHash: string): T | undefined {
    const entry = this.cache.get(queryHash);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.createdAt > entry.ttl) {
      this.cache.delete(queryHash);
      return undefined;
    }

    return entry.result as T;
  }

  cacheQuery<T>(
    queryHash: string,
    result: T,
    ttl?: number,
    options?: {
      queryPattern?: string;
      dependencies?: string[];
    }
  ): void {
    const effectiveTtl = ttl ?? this.config.defaultTtlMs;
    const queryPattern = options?.queryPattern ?? this.extractPattern(queryHash);
    const dependencies = new Set(options?.dependencies ?? []);

    const entry: QueryCacheEntry<T> = {
      result,
      queryHash,
      queryPattern,
      dependencies,
      createdAt: Date.now(),
      ttl: effectiveTtl,
    };

    this.cache.set(queryHash, entry as QueryCacheEntry<unknown>, effectiveTtl);
    this.addToIndices(entry as QueryCacheEntry<unknown>);
  }

  invalidatePattern(pattern: string): number {
    const matchingHashes = this.patternIndex.get(pattern);
    if (!matchingHashes || matchingHashes.size === 0) return 0;

    let invalidated = 0;
    for (const hash of matchingHashes) {
      if (this.cache.delete(hash)) {
        invalidated++;
      }
    }

    this.patternIndex.delete(pattern);
    return invalidated;
  }

  invalidateByDependency(dependency: string): number {
    const affectedHashes = this.dependencyIndex.get(dependency);
    if (!affectedHashes || affectedHashes.size === 0) return 0;

    let invalidated = 0;
    for (const hash of affectedHashes) {
      if (this.cache.delete(hash)) {
        invalidated++;
      }
    }

    this.dependencyIndex.delete(dependency);
    return invalidated;
  }

  invalidateAll(): void {
    this.cache.clear();
    this.patternIndex.clear();
    this.dependencyIndex.clear();
  }

  clear(): void {
    this.invalidateAll();
  }

  get<T>(query: string): T | undefined {
    return this.getCachedQuery<T>(query);
  }

  set<T>(query: string, result: T, dependencies?: string[]): void {
    this.cacheQuery(query, result, undefined, { dependencies });
  }

  stats(): ICacheStats {
    return this.cache.stats();
  }

  // ==========================================================================
  // Query Helpers
  // ==========================================================================

  static hashQuery(query: string, params?: Record<string, unknown>): string {
    const content = params ? `${query}:${JSON.stringify(params)}` : query;
    return createHash("sha256").update(content).digest("hex").substring(0, 16);
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private extractPattern(queryHash: string): string {
    // Extract pattern from query hash (first 8 chars as pattern identifier)
    return queryHash.substring(0, 8);
  }

  private addToIndices(entry: QueryCacheEntry<unknown>): void {
    // Pattern index
    let patternSet = this.patternIndex.get(entry.queryPattern);
    if (!patternSet) {
      patternSet = new Set();
      this.patternIndex.set(entry.queryPattern, patternSet);
    }
    patternSet.add(entry.queryHash);

    // Dependency index
    if (this.config.enableDependencyTracking) {
      for (const dep of entry.dependencies) {
        let depSet = this.dependencyIndex.get(dep);
        if (!depSet) {
          depSet = new Set();
          this.dependencyIndex.set(dep, depSet);
        }
        depSet.add(entry.queryHash);
      }
    }
  }

  private removeFromIndices(entry: QueryCacheEntry<unknown>): void {
    // Pattern index
    const patternSet = this.patternIndex.get(entry.queryPattern);
    if (patternSet) {
      patternSet.delete(entry.queryHash);
      if (patternSet.size === 0) {
        this.patternIndex.delete(entry.queryPattern);
      }
    }

    // Dependency index
    for (const dep of entry.dependencies) {
      const depSet = this.dependencyIndex.get(dep);
      if (depSet) {
        depSet.delete(entry.queryHash);
        if (depSet.size === 0) {
          this.dependencyIndex.delete(dep);
        }
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createQueryCache(config: QueryCacheConfig): QueryCache {
  return new QueryCache(config);
}

/**
 * LRU Cache Implementation
 *
 * High-performance LRU cache with TTL support, size-based eviction,
 * and comprehensive statistics tracking.
 */

import type { ICache, ICacheEntry, ICacheStats } from "../interfaces/IOptimization.js";

// =============================================================================
// Doubly Linked List Node for O(1) operations
// =============================================================================

class LRUNode<K, V> {
  key: K;
  entry: ICacheEntry<V>;
  prev: LRUNode<K, V> | null = null;
  next: LRUNode<K, V> | null = null;

  constructor(key: K, entry: ICacheEntry<V>) {
    this.key = key;
    this.entry = entry;
  }
}

// =============================================================================
// LRU Cache Implementation
// =============================================================================

export interface LRUCacheConfig {
  maxSize: number;
  maxMemoryBytes?: number;
  defaultTtlMs?: number;
  onEvict?: <K, V>(key: K, value: V) => void;
}

export class LRUCache<K, V> implements ICache<K, V> {
  private map: Map<K, LRUNode<K, V>> = new Map();
  private head: LRUNode<K, V> | null = null;
  private tail: LRUNode<K, V> | null = null;
  private currentMemory = 0;

  private config: Required<LRUCacheConfig>;
  private _stats: {
    hits: number;
    misses: number;
    evictions: number;
  } = { hits: 0, misses: 0, evictions: 0 };

  constructor(config: LRUCacheConfig) {
    this.config = {
      maxSize: config.maxSize,
      maxMemoryBytes: config.maxMemoryBytes ?? Infinity,
      defaultTtlMs: config.defaultTtlMs ?? 0,
      onEvict: config.onEvict ?? (() => {}),
    };
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) {
      this._stats.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (this.isExpired(node.entry)) {
      this.deleteNode(node);
      this._stats.misses++;
      return undefined;
    }

    // Update access stats and move to front
    node.entry.lastAccessedAt = Date.now();
    node.entry.accessCount++;
    this.moveToFront(node);

    this._stats.hits++;
    return node.entry.value;
  }

  set(key: K, value: V, ttl?: number): void {
    const now = Date.now();
    const size = this.estimateSize(value);
    const effectiveTtl = ttl ?? this.config.defaultTtlMs;

    // If key exists, update it
    const existingNode = this.map.get(key);
    if (existingNode) {
      this.currentMemory -= existingNode.entry.size;
      existingNode.entry = {
        value,
        size,
        createdAt: existingNode.entry.createdAt,
        lastAccessedAt: now,
        accessCount: existingNode.entry.accessCount + 1,
        ttl: effectiveTtl > 0 ? effectiveTtl : undefined,
      };
      this.currentMemory += size;
      this.moveToFront(existingNode);
      return;
    }

    // Create new entry
    const entry: ICacheEntry<V> = {
      value,
      size,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
      ttl: effectiveTtl > 0 ? effectiveTtl : undefined,
    };

    const node = new LRUNode(key, entry);

    // Evict if necessary
    while (
      this.map.size >= this.config.maxSize ||
      this.currentMemory + size > this.config.maxMemoryBytes
    ) {
      if (this.tail === null) break;
      this.evictOldest();
    }

    // Add new node
    this.map.set(key, node);
    this.currentMemory += size;
    this.addToFront(node);
  }

  has(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    if (this.isExpired(node.entry)) {
      this.deleteNode(node);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.deleteNode(node);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
    this.currentMemory = 0;
  }

  size(): number {
    return this.map.size;
  }

  stats(): ICacheStats {
    const total = this._stats.hits + this._stats.misses;
    return {
      hits: this._stats.hits,
      misses: this._stats.misses,
      evictions: this._stats.evictions,
      size: this.map.size,
      maxSize: this.config.maxSize,
      hitRate: total > 0 ? this._stats.hits / total : 0,
      memoryUsage: this.currentMemory,
    };
  }

  prune(): number {
    const now = Date.now();
    let pruned = 0;

    // Traverse from tail (oldest) to head
    let node = this.tail;
    while (node) {
      const prev = node.prev;
      if (this.isExpired(node.entry)) {
        this.deleteNode(node);
        pruned++;
      }
      node = prev;
    }

    return pruned;
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private isExpired(entry: ICacheEntry<V>): boolean {
    if (!entry.ttl) return false;
    return Date.now() - entry.createdAt > entry.ttl;
  }

  private estimateSize(value: V): number {
    // Rough size estimation
    if (value === null || value === undefined) return 8;
    if (typeof value === "string") return value.length * 2;
    if (typeof value === "number") return 8;
    if (typeof value === "boolean") return 4;
    if (Array.isArray(value)) {
      return value.reduce((sum, v) => sum + this.estimateSize(v), 16);
    }
    if (typeof value === "object") {
      return JSON.stringify(value).length * 2;
    }
    return 64; // Default
  }

  private addToFront(node: LRUNode<K, V>): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private moveToFront(node: LRUNode<K, V>): void {
    if (node === this.head) return;

    // Remove from current position
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.tail) this.tail = node.prev;

    // Add to front
    this.addToFront(node);
  }

  private deleteNode(node: LRUNode<K, V>): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.head) this.head = node.next;
    if (node === this.tail) this.tail = node.prev;

    this.map.delete(node.key);
    this.currentMemory -= node.entry.size;
    this.config.onEvict(node.key, node.entry.value);
  }

  private evictOldest(): void {
    if (!this.tail) return;
    this.deleteNode(this.tail);
    this._stats.evictions++;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createLRUCache<K, V>(config: LRUCacheConfig): LRUCache<K, V> {
  return new LRUCache<K, V>(config);
}

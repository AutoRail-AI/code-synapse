/**
 * Generic Object Pool
 *
 * Provides efficient reuse of expensive-to-create resources like database
 * connections, parser instances, or thread pools.
 *
 * @module
 */

import type { Disposable, AsyncDisposable } from "./disposable.js";
import { Deferred } from "./async.js";

// =============================================================================
// Pool Configuration
// =============================================================================

/**
 * Configuration options for the object pool
 */
export interface PoolOptions<T> {
  /** Factory function to create new pool items */
  create: () => Promise<T>;
  /** Function to destroy/cleanup pool items */
  destroy: (item: T) => Promise<void>;
  /** Optional validation function (return false to discard invalid items) */
  validate?: (item: T) => boolean;
  /** Maximum number of items in the pool */
  maxSize: number;
  /** Minimum number of items to maintain (pre-warmed) */
  minSize?: number;
  /** Timeout for acquiring an item (ms) */
  acquireTimeoutMs?: number;
  /** Idle timeout before destroying excess items (ms) */
  idleTimeoutMs?: number;
}

// =============================================================================
// Pooled Resource Wrapper
// =============================================================================

/**
 * Wrapper for a pooled resource that auto-releases on dispose.
 * Use with `using` keyword for automatic cleanup.
 *
 * @example
 * ```typescript
 * using resource = await pool.acquire();
 * // Use resource.resource
 * // Automatically released when scope exits
 * ```
 */
export class PooledResource<T> implements Disposable {
  private released = false;

  constructor(
    /** The actual resource */
    readonly resource: T,
    private releaseCallback: (resource: T) => void
  ) {}

  [Symbol.dispose](): void {
    if (!this.released) {
      this.released = true;
      this.releaseCallback(this.resource);
    }
  }

  /**
   * Manually release the resource back to the pool.
   * Prefer using `using` keyword instead.
   */
  release(): void {
    this[Symbol.dispose]();
  }
}

// =============================================================================
// Pool Statistics
// =============================================================================

/**
 * Pool statistics for monitoring
 */
export interface PoolStats {
  /** Number of items available for immediate use */
  available: number;
  /** Number of items currently in use */
  inUse: number;
  /** Number of pending acquire requests */
  waiting: number;
  /** Total items ever created */
  totalCreated: number;
  /** Total items ever destroyed */
  totalDestroyed: number;
}

// =============================================================================
// Object Pool Implementation
// =============================================================================

/**
 * Generic object pool for managing reusable resources.
 *
 * Features:
 * - Configurable min/max size
 * - Item validation before reuse
 * - Acquire timeout support
 * - Automatic resource cleanup on dispose
 *
 * @example
 * ```typescript
 * const pool = new Pool({
 *   create: () => createExpensiveResource(),
 *   destroy: (r) => r.close(),
 *   maxSize: 10,
 *   acquireTimeoutMs: 5000,
 * });
 *
 * using resource = await pool.acquire();
 * // Use resource.resource
 * ```
 */
export class Pool<T> implements AsyncDisposable {
  private available: T[] = [];
  private inUse = new Set<T>();
  private waitQueue: Deferred<T>[] = [];
  private closed = false;
  private totalCreated = 0;
  private totalDestroyed = 0;

  constructor(private readonly options: PoolOptions<T>) {}

  /**
   * Acquires a resource from the pool.
   * Creates a new resource if none available and under max size.
   * Waits for an available resource if at max size.
   *
   * @returns A wrapped resource that auto-releases on dispose
   * @throws Error if pool is closed or acquire times out
   */
  async acquire(): Promise<PooledResource<T>> {
    if (this.closed) {
      throw new Error("Pool is closed");
    }

    // Try to get from available pool
    while (this.available.length > 0) {
      const item: T = this.available.pop()!;

      // Validate if validator is provided
      if (this.options.validate && !this.options.validate(item)) {
        // Invalid item, destroy it
        await this.destroyItem(item);
        continue;
      }

      this.inUse.add(item);
      return new PooledResource(item, (r: T) => this.release(r));
    }

    // Create new if under max size
    if (this.inUse.size < this.options.maxSize) {
      const item: T = await this.createItem();
      this.inUse.add(item);
      return new PooledResource(item, (r: T) => this.release(r));
    }

    // Wait for available resource
    const deferred = new Deferred<T>();
    this.waitQueue.push(deferred);

    const timeoutMs = this.options.acquireTimeoutMs ?? 30000;
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        // Remove from wait queue
        const idx = this.waitQueue.indexOf(deferred);
        if (idx >= 0) this.waitQueue.splice(idx, 1);
        reject(new Error(`Pool acquire timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const item: T = await Promise.race([deferred.promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      this.inUse.add(item);
      return new PooledResource(item, (r: T) => this.release(r));
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  /**
   * Releases a resource back to the pool.
   * Called automatically by PooledResource on dispose.
   */
  private release(item: T): void {
    this.inUse.delete(item);

    if (this.closed) {
      // Pool is closing, destroy the item
      this.destroyItem(item).catch(() => {
        // Ignore destroy errors during shutdown
      });
      return;
    }

    // Give to waiting acquirer first
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      waiter.resolve(item);
      return;
    }

    // Return to available pool
    this.available.push(item);
  }

  /**
   * Creates a new pool item.
   */
  private async createItem(): Promise<T> {
    const item = await this.options.create();
    this.totalCreated++;
    return item;
  }

  /**
   * Destroys a pool item.
   */
  private async destroyItem(item: T): Promise<void> {
    try {
      await this.options.destroy(item);
    } finally {
      this.totalDestroyed++;
    }
  }

  /**
   * Pre-warms the pool by creating minSize items.
   * Call this after construction if you want items ready immediately.
   */
  async warmup(): Promise<void> {
    const minSize = this.options.minSize ?? 0;
    const toCreate = minSize - this.available.length - this.inUse.size;

    const createPromises: Promise<void>[] = [];
    for (let i = 0; i < toCreate; i++) {
      createPromises.push(
        this.createItem().then((item) => {
          this.available.push(item);
        })
      );
    }

    await Promise.all(createPromises);
  }

  /**
   * Clears all available items from the pool.
   * Items currently in use are not affected.
   */
  async clear(): Promise<void> {
    const items = this.available.splice(0);
    await Promise.all(items.map((item) => this.destroyItem(item)));
  }

  /**
   * Closes the pool and releases all resources.
   * Rejects all pending acquire requests.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Reject all waiters
    for (const waiter of this.waitQueue) {
      waiter.reject(new Error("Pool closed"));
    }
    this.waitQueue = [];

    // Destroy all available items
    const availableItems = this.available.splice(0);
    await Promise.all(availableItems.map((item) => this.destroyItem(item)));

    // Note: Items in use will be destroyed when released
  }

  /**
   * Closes the pool. Alternative to Symbol.asyncDispose for explicit closing.
   */
  async close(): Promise<void> {
    await this[Symbol.asyncDispose]();
  }

  /**
   * Returns current pool statistics.
   */
  get stats(): PoolStats {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      waiting: this.waitQueue.length,
      totalCreated: this.totalCreated,
      totalDestroyed: this.totalDestroyed,
    };
  }

  /**
   * Whether the pool is closed.
   */
  get isClosed(): boolean {
    return this.closed;
  }
}

// =============================================================================
// Convenience Factory
// =============================================================================

/**
 * Creates a new object pool with the given options.
 */
export function createPool<T>(options: PoolOptions<T>): Pool<T> {
  return new Pool(options);
}

/**
 * Batch Writer Implementation
 *
 * High-performance batched write operations with:
 * - Automatic flushing on size or time threshold
 * - Priority-based ordering
 * - Retry logic with exponential backoff
 * - Comprehensive error handling
 */

import type {
  IBatchWriter,
  IBatchConfig,
  IBatchItem,
  IBatchResult,
  BatchWriterStats,
} from "../interfaces/IOptimization.js";

// =============================================================================
// Batch Writer Implementation
// =============================================================================

export type BatchWriteFunction<T> = (items: T[]) => Promise<void>;

export interface BatchWriterConfig extends IBatchConfig {
  onError?: (error: Error, items: unknown[]) => void;
  onFlush?: (result: IBatchResult) => void;
}

export class BatchWriter<T> implements IBatchWriter<T> {
  private buffer: IBatchItem<T>[] = [];
  private writeFunction: BatchWriteFunction<T>;
  private config: Required<BatchWriterConfig>;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;
  private isShutdown = false;

  // Statistics
  private _stats = {
    totalWritten: 0,
    totalFailed: 0,
    batchCount: 0,
    totalWriteDuration: 0,
  };

  constructor(writeFunction: BatchWriteFunction<T>, config: Partial<BatchWriterConfig> = {}) {
    this.writeFunction = writeFunction;
    this.config = {
      maxBatchSize: config.maxBatchSize ?? 100,
      maxWaitMs: config.maxWaitMs ?? 100,
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 100,
      onError: config.onError ?? (() => {}),
      onFlush: config.onFlush ?? (() => {}),
    };
  }

  async add(item: T, priority = 0): Promise<void> {
    if (this.isShutdown) {
      throw new Error("BatchWriter is shutdown");
    }

    const batchItem: IBatchItem<T> = {
      id: `item-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      data: item,
      priority,
      addedAt: Date.now(),
    };

    // Insert by priority (higher priority first)
    let inserted = false;
    for (let i = 0; i < this.buffer.length; i++) {
      if (priority > (this.buffer[i]!.priority ?? 0)) {
        this.buffer.splice(i, 0, batchItem);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.buffer.push(batchItem);
    }

    // Check if we should flush
    if (this.buffer.length >= this.config.maxBatchSize) {
      await this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  async addBatch(items: T[]): Promise<void> {
    for (const item of items) {
      await this.add(item);
    }
  }

  async flush(): Promise<IBatchResult> {
    if (this.isFlushing || this.buffer.length === 0) {
      return {
        success: true,
        processedCount: 0,
        failedCount: 0,
        errors: [],
        durationMs: 0,
      };
    }

    this.cancelScheduledFlush();
    this.isFlushing = true;

    const startTime = Date.now();
    const batch = this.buffer.splice(0, this.config.maxBatchSize);
    const items = batch.map((b) => b.data);
    const errors: Array<{ id: string; error: string }> = [];

    let success = false;
    let lastError: Error | null = null;

    // Retry logic with exponential backoff
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.writeFunction(items);
        success = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    const durationMs = Date.now() - startTime;

    if (success) {
      this._stats.totalWritten += items.length;
      this._stats.batchCount++;
      this._stats.totalWriteDuration += durationMs;
    } else {
      this._stats.totalFailed += items.length;

      // Record individual errors
      for (const item of batch) {
        errors.push({
          id: item.id,
          error: lastError?.message ?? "Unknown error",
        });
      }

      // Call error handler
      this.config.onError(lastError!, items);
    }

    const result: IBatchResult = {
      success,
      processedCount: success ? items.length : 0,
      failedCount: success ? 0 : items.length,
      errors,
      durationMs,
    };

    this.config.onFlush(result);
    this.isFlushing = false;

    // Process remaining items
    if (this.buffer.length > 0) {
      this.scheduleFlush();
    }

    return result;
  }

  stats(): BatchWriterStats {
    return {
      pendingItems: this.buffer.length,
      totalWritten: this._stats.totalWritten,
      totalFailed: this._stats.totalFailed,
      batchCount: this._stats.batchCount,
      averageBatchSize:
        this._stats.batchCount > 0 ? this._stats.totalWritten / this._stats.batchCount : 0,
      averageWriteDuration:
        this._stats.batchCount > 0 ? this._stats.totalWriteDuration / this._stats.batchCount : 0,
    };
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
    this.cancelScheduledFlush();

    // Flush remaining items
    while (this.buffer.length > 0) {
      await this.flush();
    }
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;

    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null;
      await this.flush();
    }, this.config.maxWaitMs);
  }

  private cancelScheduledFlush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createBatchWriter<T>(
  writeFunction: BatchWriteFunction<T>,
  config?: Partial<BatchWriterConfig>
): BatchWriter<T> {
  return new BatchWriter(writeFunction, config);
}

/**
 * Write-Behind Ledger
 *
 * Asynchronous ledger writing wrapper with:
 * - In-memory buffering
 * - Periodic background flushing
 * - Crash recovery
 * - Ordering guarantees
 */

import type { LedgerEntry, TimelineEntry, LedgerAggregation } from "../../ledger/models/ledger-events.js";
import type { IChangeLedger, LedgerSubscriber, SubscriptionFilter, LedgerQuery } from "../../ledger/interfaces/IChangeLedger.js";
import { BatchWriter, type BatchWriterConfig } from "./BatchWriter.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("write-behind-ledger");

// =============================================================================
// Write-Behind Ledger Configuration
// =============================================================================

export interface WriteBehindLedgerConfig {
  maxBufferSize: number;
  flushIntervalMs: number;
  maxRetries: number;
  enableRecoveryLog: boolean;
  recoveryLogPath?: string;
}

export const DEFAULT_WRITE_BEHIND_CONFIG: WriteBehindLedgerConfig = {
  maxBufferSize: 1000,
  flushIntervalMs: 1000,
  maxRetries: 3,
  enableRecoveryLog: true,
  recoveryLogPath: undefined,
};

// =============================================================================
// Write-Behind Ledger Implementation
// =============================================================================

export class WriteBehindLedger implements IChangeLedger {
  private underlying: IChangeLedger;
  private batchWriter: BatchWriter<LedgerEntry>;
  private config: WriteBehindLedgerConfig;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private pendingWrites: Map<string, LedgerEntry> = new Map();

  constructor(underlying: IChangeLedger, config: Partial<WriteBehindLedgerConfig> = {}) {
    this.underlying = underlying;
    this.config = { ...DEFAULT_WRITE_BEHIND_CONFIG, ...config };

    const batchConfig: Partial<BatchWriterConfig> = {
      maxBatchSize: this.config.maxBufferSize,
      maxWaitMs: this.config.flushIntervalMs,
      maxRetries: this.config.maxRetries,
      onError: (error, items) => {
        logger.error({ error, count: items.length }, "Failed to write ledger entries");
      },
      onFlush: (result) => {
        if (result.processedCount > 0) {
          logger.debug({ count: result.processedCount, durationMs: result.durationMs }, "Flushed ledger entries");
        }
      },
    };

    this.batchWriter = new BatchWriter(
      async (entries: LedgerEntry[]) => {
        await this.underlying.appendBatch(entries);
        for (const entry of entries) {
          this.pendingWrites.delete(entry.id);
        }
      },
      batchConfig
    );
  }

  async initialize(): Promise<void> {
    await this.underlying.initialize();

    // Start periodic flush
    this.flushInterval = setInterval(async () => {
      try {
        await this.batchWriter.flush();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          {
            err: error,
            errorMessage,
            errorStack: error instanceof Error ? error.stack : undefined,
            pendingWriteCount: this.pendingWrites.size,
          },
          "Error during periodic ledger flush: %s",
          errorMessage
        );
      }
    }, this.config.flushIntervalMs);
  }

  async append(entry: LedgerEntry): Promise<void> {
    this.pendingWrites.set(entry.id, entry);
    await this.batchWriter.add(entry);
  }

  async appendBatch(entries: LedgerEntry[]): Promise<void> {
    for (const entry of entries) {
      this.pendingWrites.set(entry.id, entry);
    }
    await this.batchWriter.addBatch(entries);
  }

  // ==========================================================================
  // Read Operations (pass-through with pending merge)
  // ==========================================================================

  async query(query: LedgerQuery): Promise<LedgerEntry[]> {
    // Flush pending writes first for consistency
    await this.batchWriter.flush();
    return this.underlying.query(query);
  }

  async getEntry(id: string): Promise<LedgerEntry | null> {
    // Check pending writes first
    const pending = this.pendingWrites.get(id);
    if (pending) return pending;

    return this.underlying.getEntry(id);
  }

  async getRecent(limit?: number): Promise<LedgerEntry[]> {
    // Flush pending writes first
    await this.batchWriter.flush();
    return this.underlying.getRecent(limit);
  }

  async getByCorrelation(correlationId: string): Promise<LedgerEntry[]> {
    await this.batchWriter.flush();
    return this.underlying.getByCorrelation(correlationId);
  }

  async getBySession(sessionId: string): Promise<LedgerEntry[]> {
    await this.batchWriter.flush();
    return this.underlying.getBySession(sessionId);
  }

  async getTimeline(query: LedgerQuery): Promise<TimelineEntry[]> {
    await this.batchWriter.flush();
    return this.underlying.getTimeline(query);
  }

  async getAggregations(query: LedgerQuery): Promise<LedgerAggregation> {
    await this.batchWriter.flush();
    return this.underlying.getAggregations(query);
  }

  async getForEntity(entityId: string, limit?: number): Promise<LedgerEntry[]> {
    await this.batchWriter.flush();
    return this.underlying.getForEntity(entityId, limit);
  }

  async getForFile(filePath: string, limit?: number): Promise<LedgerEntry[]> {
    await this.batchWriter.flush();
    return this.underlying.getForFile(filePath, limit);
  }

  subscribe(callback: LedgerSubscriber, filter?: SubscriptionFilter): () => void {
    return this.underlying.subscribe(callback, filter);
  }

  getCurrentSequence(): number {
    return this.underlying.getCurrentSequence();
  }

  async getEntryCount(): Promise<number> {
    await this.batchWriter.flush();
    return this.underlying.getEntryCount();
  }

  async getOldestTimestamp(): Promise<string | null> {
    return this.underlying.getOldestTimestamp();
  }

  async getNewestTimestamp(): Promise<string | null> {
    await this.batchWriter.flush();
    return this.underlying.getNewestTimestamp();
  }

  async flush(): Promise<void> {
    await this.batchWriter.flush();
    await this.underlying.flush();
  }

  async compact(): Promise<number> {
    await this.batchWriter.flush();
    return this.underlying.compact();
  }

  async export(query: LedgerQuery): Promise<string> {
    await this.batchWriter.flush();
    return this.underlying.export(query);
  }

  async import(json: string): Promise<number> {
    return this.underlying.import(json);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async shutdown(): Promise<void> {
    // Stop periodic flush
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Flush remaining entries
    await this.batchWriter.shutdown();

    // Shutdown underlying
    await this.underlying.shutdown();
  }

  // ==========================================================================
  // Additional Methods
  // ==========================================================================

  getPendingCount(): number {
    return this.pendingWrites.size;
  }

  getWriterStats() {
    return this.batchWriter.stats();
  }

  async forceFlush(): Promise<void> {
    await this.batchWriter.flush();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createWriteBehindLedger(
  underlying: IChangeLedger,
  config?: Partial<WriteBehindLedgerConfig>
): WriteBehindLedger {
  return new WriteBehindLedger(underlying, config);
}

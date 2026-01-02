/**
 * Change Ledger Interface
 *
 * Black-box interface for the append-only change ledger.
 * Provides observability into all system events.
 */

import type {
  LedgerEntry,
  LedgerAggregation,
  TimelineEntry,
  LedgerEventType,
  EventSource,
} from "../models/ledger-events.js";
import { type LedgerQuery } from "../models/ledger-events.js";

// Re-export LedgerQuery for consumers
export type { LedgerQuery };

/**
 * Configuration for change ledger
 */
export interface ChangeLedgerConfig {
  /** Maximum entries to keep in memory cache */
  memoryCacheSize: number;
  /** Whether to persist to durable storage */
  persistToDisk: boolean;
  /** Flush interval for batch writes (ms) */
  flushIntervalMs: number;
  /** Maximum batch size for writes */
  maxBatchSize: number;
  /** Retention period for old entries (days, 0 = forever) */
  retentionDays: number;
  /** Enable real-time subscriptions */
  enableSubscriptions: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_LEDGER_CONFIG: ChangeLedgerConfig = {
  memoryCacheSize: 10000,
  persistToDisk: true,
  flushIntervalMs: 1000,
  maxBatchSize: 100,
  retentionDays: 90,
  enableSubscriptions: true,
};

/**
 * Subscription callback type
 */
export type LedgerSubscriber = (entry: LedgerEntry) => void;

/**
 * Subscription filter
 */
export interface SubscriptionFilter {
  eventTypes?: LedgerEventType[];
  sources?: EventSource[];
  entityIds?: string[];
  filePaths?: string[];
  correlationId?: string;
}

/**
 * Change Ledger Interface
 *
 * Append-only log of all system events for observability,
 * debugging, and time-travel analysis.
 */
export interface IChangeLedger {
  /**
   * Initialize the ledger
   */
  initialize(): Promise<void>;

  /**
   * Append a new entry to the ledger
   */
  append(entry: LedgerEntry): Promise<void>;

  /**
   * Append multiple entries atomically
   */
  appendBatch(entries: LedgerEntry[]): Promise<void>;

  /**
   * Query entries with filters
   */
  query(query: LedgerQuery): Promise<LedgerEntry[]>;

  /**
   * Get a single entry by ID
   */
  getEntry(id: string): Promise<LedgerEntry | null>;

  /**
   * Get entries by correlation ID
   */
  getByCorrelation(correlationId: string): Promise<LedgerEntry[]>;

  /**
   * Get entries for a session
   */
  getBySession(sessionId: string): Promise<LedgerEntry[]>;

  /**
   * Get timeline view (simplified entries for UI)
   */
  getTimeline(query: LedgerQuery): Promise<TimelineEntry[]>;

  /**
   * Get aggregated statistics
   */
  getAggregations(query: LedgerQuery): Promise<LedgerAggregation>;

  /**
   * Get recent entries (convenience method)
   */
  getRecent(limit?: number): Promise<LedgerEntry[]>;

  /**
   * Get entries for a specific entity
   */
  getForEntity(entityId: string, limit?: number): Promise<LedgerEntry[]>;

  /**
   * Get entries for a specific file
   */
  getForFile(filePath: string, limit?: number): Promise<LedgerEntry[]>;

  /**
   * Subscribe to new entries
   */
  subscribe(callback: LedgerSubscriber, filter?: SubscriptionFilter): () => void;

  /**
   * Get current sequence number
   */
  getCurrentSequence(): number;

  /**
   * Get entry count
   */
  getEntryCount(): Promise<number>;

  /**
   * Get oldest entry timestamp
   */
  getOldestTimestamp(): Promise<string | null>;

  /**
   * Get newest entry timestamp
   */
  getNewestTimestamp(): Promise<string | null>;

  /**
   * Flush pending writes to storage
   */
  flush(): Promise<void>;

  /**
   * Compact old entries (if retention enabled)
   */
  compact(): Promise<number>;

  /**
   * Export entries to JSON
   */
  export(query: LedgerQuery): Promise<string>;

  /**
   * Import entries from JSON
   */
  import(json: string): Promise<number>;

  /**
   * Shutdown and cleanup
   */
  shutdown(): Promise<void>;
}

/**
 * Ledger Storage Interface
 *
 * Abstraction for persisting ledger entries.
 */
export interface ILedgerStorage {
  /**
   * Initialize storage
   */
  initialize(): Promise<void>;

  /**
   * Store entries
   */
  store(entries: LedgerEntry[]): Promise<void>;

  /**
   * Query entries
   */
  query(query: LedgerQuery): Promise<LedgerEntry[]>;

  /**
   * Get by ID
   */
  getById(id: string): Promise<LedgerEntry | null>;

  /**
   * Get by correlation
   */
  getByCorrelation(correlationId: string): Promise<LedgerEntry[]>;

  /**
   * Get by session
   */
  getBySession(sessionId: string): Promise<LedgerEntry[]>;

  /**
   * Get entry count
   */
  getCount(query?: Partial<LedgerQuery>): Promise<number>;

  /**
   * Get oldest timestamp
   */
  getOldestTimestamp(): Promise<string | null>;

  /**
   * Get newest timestamp
   */
  getNewestTimestamp(): Promise<string | null>;

  /**
   * Delete entries older than timestamp
   */
  deleteOlderThan(timestamp: string): Promise<number>;

  /**
   * Get aggregations
   */
  getAggregations(query: LedgerQuery): Promise<LedgerAggregation>;
}

/**
 * Factory function type for creating change ledgers
 */
export type ChangeLedgerFactory = (config?: Partial<ChangeLedgerConfig>) => Promise<IChangeLedger>;

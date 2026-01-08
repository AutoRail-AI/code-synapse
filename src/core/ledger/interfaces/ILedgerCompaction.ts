/**
 * Ledger Compaction Interface
 *
 * Defines the contract for compacting raw ledger events into
 * human-meaningful consolidated entries.
 */

import type { LedgerEntry } from "../models/ledger-events.js";
import type {
  CompactedLedgerEntry,
  CompactedEntryQuery,
  CompactionConfig,
} from "../models/compacted-entry.js";

// =============================================================================
// Session Grouping Types
// =============================================================================

/**
 * A group of events belonging to the same logical session
 */
export interface SessionEventGroup {
  sessionId: string;
  events: LedgerEntry[];
  startTime: string;
  endTime: string;
  source: CompactedLedgerEntry["source"];
}

/**
 * Intent cluster - events with similar semantic intent
 */
export interface IntentCluster {
  clusterId: string;
  events: LedgerEntry[];
  intentEmbedding?: number[];
  inferredIntent: string;
  confidence: number;
}

// =============================================================================
// Compaction Storage Interface
// =============================================================================

/**
 * Storage backend for compacted entries
 */
export interface ICompactionStorage {
  /**
   * Initialize storage
   */
  initialize(): Promise<void>;

  /**
   * Store a compacted entry
   */
  store(entry: CompactedLedgerEntry): Promise<void>;

  /**
   * Store multiple entries atomically
   */
  storeBatch(entries: CompactedLedgerEntry[]): Promise<void>;

  /**
   * Get entry by ID
   */
  getById(id: string): Promise<CompactedLedgerEntry | null>;

  /**
   * Get entry by session ID
   */
  getBySessionId(sessionId: string): Promise<CompactedLedgerEntry | null>;

  /**
   * Query compacted entries
   */
  query(query: CompactedEntryQuery): Promise<CompactedLedgerEntry[]>;

  /**
   * Get timeline view
   */
  getTimeline(startTime: string, endTime: string, limit?: number): Promise<CompactedLedgerEntry[]>;

  /**
   * Get entries affecting a file
   */
  getForFile(filePath: string, limit?: number): Promise<CompactedLedgerEntry[]>;

  /**
   * Get entries affecting a vertical/domain
   */
  getForVertical(vertical: string, limit?: number): Promise<CompactedLedgerEntry[]>;

  /**
   * Delete entries older than timestamp
   */
  deleteOlderThan(timestamp: string): Promise<number>;

  /**
   * Get statistics
   */
  getStats(): Promise<CompactionStats>;
}

// =============================================================================
// Intent Analyzer Interface
// =============================================================================

/**
 * Analyzes and classifies intent from events
 */
export interface IIntentAnalyzer {
  /**
   * Infer intent from a group of events
   */
  inferIntent(events: LedgerEntry[]): Promise<{
    summary: string;
    category: CompactedLedgerEntry["intentCategory"];
    confidence: number;
    userPrompts: string[];
  }>;

  /**
   * Calculate similarity between event groups
   */
  calculateSimilarity(group1: LedgerEntry[], group2: LedgerEntry[]): Promise<number>;

  /**
   * Cluster events by semantic similarity
   */
  clusterByIntent(events: LedgerEntry[], threshold: number): Promise<IntentCluster[]>;

  /**
   * Generate embedding for event content
   */
  generateEmbedding(events: LedgerEntry[]): Promise<number[]>;
}

// =============================================================================
// Main Compaction Service Interface
// =============================================================================

/**
 * Main interface for ledger compaction
 */
export interface ILedgerCompaction {
  /**
   * Initialize the compaction service
   */
  initialize(): Promise<void>;

  /**
   * Check if service is ready
   */
  readonly isReady: boolean;

  // =========================================================================
  // Compaction Operations
  // =========================================================================

  /**
   * Run compaction on pending events
   * Groups events by session and semantic intent, creates compacted entries
   */
  compact(): Promise<CompactionResult>;

  /**
   * Compact events for a specific session
   */
  compactSession(sessionId: string): Promise<CompactedLedgerEntry | null>;

  /**
   * Compact events within a time range
   */
  compactTimeRange(startTime: string, endTime: string): Promise<CompactionResult>;

  /**
   * Force compaction of all uncompacted events
   */
  forceCompaction(): Promise<CompactionResult>;

  // =========================================================================
  // Session Management
  // =========================================================================

  /**
   * Group events into sessions based on time and context
   */
  groupIntoSessions(events: LedgerEntry[]): Promise<SessionEventGroup[]>;

  /**
   * Detect session boundaries
   */
  detectSessionBoundary(event: LedgerEntry, previousEvent: LedgerEntry | null): boolean;

  /**
   * Get active (uncompacted) sessions
   */
  getActiveSessions(): Promise<SessionEventGroup[]>;

  // =========================================================================
  // Intent Analysis
  // =========================================================================

  /**
   * Cluster events by semantic intent
   */
  clusterByIntent(events: LedgerEntry[]): Promise<IntentCluster[]>;

  /**
   * Merge similar intent clusters
   */
  mergeSimilarClusters(clusters: IntentCluster[], threshold: number): Promise<IntentCluster[]>;

  // =========================================================================
  // Querying
  // =========================================================================

  /**
   * Get compacted entry by ID
   */
  getEntry(id: string): Promise<CompactedLedgerEntry | null>;

  /**
   * Get compacted entry for session
   */
  getEntryForSession(sessionId: string): Promise<CompactedLedgerEntry | null>;

  /**
   * Query compacted entries
   */
  query(query: CompactedEntryQuery): Promise<CompactedLedgerEntry[]>;

  /**
   * Get timeline view
   */
  getTimeline(startTime: string, endTime: string, limit?: number): Promise<CompactedLedgerEntry[]>;

  /**
   * Get recent compacted entries
   */
  getRecent(limit?: number): Promise<CompactedLedgerEntry[]>;

  // =========================================================================
  // Hash Verification
  // =========================================================================

  /**
   * Calculate content hash for a compacted entry
   */
  calculateContentHash(entry: CompactedLedgerEntry): string;

  /**
   * Verify integrity of compacted entry
   */
  verifyIntegrity(entry: CompactedLedgerEntry): boolean;

  // =========================================================================
  // Maintenance
  // =========================================================================

  /**
   * Clean up old raw events that have been compacted
   */
  cleanupRawEvents(olderThanMs: number): Promise<number>;

  /**
   * Get compaction statistics
   */
  getStats(): Promise<CompactionStats>;

  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CompactionConfig>): void;

  /**
   * Get current configuration
   */
  getConfig(): CompactionConfig;

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Start automatic compaction
   */
  startAutoCompaction(): void;

  /**
   * Stop automatic compaction
   */
  stopAutoCompaction(): void;

  /**
   * Shutdown and cleanup
   */
  shutdown(): Promise<void>;
}

// =============================================================================
// Result Types
// =============================================================================

export interface CompactionResult {
  success: boolean;
  entriesProcessed: number;
  entriesCompacted: number;
  sessionsProcessed: number;
  errors: Array<{ sessionId: string; error: string }>;
  durationMs: number;
}

export interface CompactionStats {
  totalCompactedEntries: number;
  totalRawEventsCompacted: number;
  averageEventsPerEntry: number;
  bySource: Record<string, number>;
  byIntentCategory: Record<string, number>;
  oldestEntry: string | null;
  newestEntry: string | null;
  pendingRawEvents: number;
  lastCompactionAt: string | null;
  lastCompactionDurationMs: number;
}

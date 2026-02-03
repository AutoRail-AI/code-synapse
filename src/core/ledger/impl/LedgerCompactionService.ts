/**
 * Ledger Compaction Service Implementation
 *
 * Groups raw ledger events into semantic, human-meaningful summaries.
 * Uses session boundaries, intent similarity, and content hashing.
 */

import { createHash } from "node:crypto";
import type { IChangeLedger } from "../interfaces/IChangeLedger.js";
import type {
  ILedgerCompaction,
  ICompactionStorage,
  IIntentAnalyzer,
  SessionEventGroup,
  IntentCluster,
  CompactionResult,
  CompactionStats,
} from "../interfaces/ILedgerCompaction.js";
import type { LedgerEntry } from "../models/ledger-events.js";
import type {
  CompactedLedgerEntry,
  CompactedEntryQuery,
  CompactionConfig,
  MCPQueryTrace,
} from "../models/compacted-entry.js";
import { createCompactedEntry, DEFAULT_COMPACTION_CONFIG } from "../models/compacted-entry.js";
import type { IStorageAdapter } from "../../graph/interfaces/IStorageAdapter.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("ledger-compaction");

// =============================================================================
// Storage Implementation
// =============================================================================

interface CompactedEntryRow {
  id: string;
  session_id: string;
  timestamp_start: string;
  timestamp_end: string;
  source: string;
  intent_summary: string;
  intent_category: string;
  user_prompts: string;
  mcp_queries: string;
  total_mcp_queries: number;
  unique_tools_used: string;
  code_accessed: string;
  code_changes: string;
  semantic_impact: string;
  index_updates: string;
  memory_updates: string;
  memory_rules_applied: string;
  raw_event_ids: string;
  raw_event_count: number;
  confidence_score: number;
  completeness: number;
  correlated_sessions: string;
  git_commit_sha: string | null;
  git_branch: string | null;
  content_hash: string | null;
}

// Table name constant
const TABLE_NAME = "CompactedLedgerEntry";

export class CozoCompactionStorage implements ICompactionStorage {
  private adapter: IStorageAdapter;

  constructor(adapter: IStorageAdapter) {
    this.adapter = adapter;
  }

  async initialize(): Promise<void> {
    // Schema created by graph database initialization
    logger.info("Compaction storage initialized");
  }

  async store(entry: CompactedLedgerEntry): Promise<void> {
    const record = this.entryToRecord(entry);
    await this.adapter.storeOne(TABLE_NAME, record as unknown as Record<string, unknown>);
  }

  async storeBatch(entries: CompactedLedgerEntry[]): Promise<void> {
    const records = entries.map((entry) => this.entryToRecord(entry));
    await this.adapter.store(TABLE_NAME, records as unknown as Record<string, unknown>[]);
  }

  async getById(id: string): Promise<CompactedLedgerEntry | null> {
    const record = await this.adapter.findOne<CompactedEntryRow>(TABLE_NAME, [
      { field: "id", operator: "eq", value: id },
    ]);

    if (!record) return null;
    return this.rowToEntry(record);
  }

  async getBySessionId(sessionId: string): Promise<CompactedLedgerEntry | null> {
    const record = await this.adapter.findOne<CompactedEntryRow>(TABLE_NAME, [
      { field: "session_id", operator: "eq", value: sessionId },
    ]);

    if (!record) return null;
    return this.rowToEntry(record);
  }

  async query(queryParams: CompactedEntryQuery): Promise<CompactedLedgerEntry[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {
      limit: queryParams.limit ?? 100,
      offset: queryParams.offset ?? 0,
    };

    if (queryParams.sessionId) {
      conditions.push("session_id == $sessionId");
      params.sessionId = queryParams.sessionId;
    }
    if (queryParams.source) {
      conditions.push("source == $source");
      params.source = queryParams.source;
    }
    if (queryParams.startTime) {
      conditions.push("timestamp_start >= $startTime");
      params.startTime = queryParams.startTime;
    }
    if (queryParams.endTime) {
      conditions.push("timestamp_end <= $endTime");
      params.endTime = queryParams.endTime;
    }

    const whereClause = conditions.length > 0 ? `, ${conditions.join(", ")}` : "";

    // Use rawQuery for complex ordering
    const dbQuery = `
      ?[id, session_id, timestamp_start, timestamp_end, source,
        intent_summary, intent_category, user_prompts, mcp_queries, total_mcp_queries,
        unique_tools_used, code_accessed, code_changes, semantic_impact,
        index_updates, memory_updates, memory_rules_applied, raw_event_ids, raw_event_count,
        confidence_score, completeness, correlated_sessions, git_commit_sha, git_branch, content_hash] :=
        *${TABLE_NAME}{
          id, session_id, timestamp_start, timestamp_end, source,
          intent_summary, intent_category, user_prompts, mcp_queries, total_mcp_queries,
          unique_tools_used, code_accessed, code_changes, semantic_impact,
          index_updates, memory_updates, memory_rules_applied, raw_event_ids, raw_event_count,
          confidence_score, completeness, correlated_sessions, git_commit_sha, git_branch, content_hash
        }${whereClause}
      :order -timestamp_end
      :limit $limit
      :offset $offset
    `;

    const rows = await this.adapter.rawQuery<CompactedEntryRow>(dbQuery, params);
    return rows.map((row) => this.rowToEntry(row));
  }

  async getTimeline(startTime: string, endTime: string, limit = 50): Promise<CompactedLedgerEntry[]> {
    return this.query({ startTime, endTime, limit });
  }

  async getForFile(filePath: string, limit = 50): Promise<CompactedLedgerEntry[]> {
    // Query all and filter - could be optimized with proper indexing
    const all = await this.query({ limit: limit * 10 });
    return all
      .filter(
        (entry) =>
          entry.codeAccessed.files.includes(filePath) ||
          entry.codeChanges.filesModified.includes(filePath) ||
          entry.codeChanges.filesCreated.includes(filePath)
      )
      .slice(0, limit);
  }

  async getForVertical(vertical: string, limit = 50): Promise<CompactedLedgerEntry[]> {
    const all = await this.query({ limit: limit * 10 });
    return all
      .filter((entry) => entry.semanticImpact.verticals.includes(vertical))
      .slice(0, limit);
  }

  async deleteOlderThan(timestamp: string): Promise<number> {
    // Use rawQuery for aggregation
    const countQuery = `
      ?[cnt] := cnt = count(id), *${TABLE_NAME}{id, timestamp_end: ts}, ts < $timestamp
    `;
    const countRows = await this.adapter.rawQuery<{ cnt: number }>(countQuery, { timestamp });
    const count = countRows[0]?.cnt ?? 0;

    // Use rawExecute for delete
    const deleteQuery = `
      ?[id] := *${TABLE_NAME}{id, timestamp_end: ts}, ts < $timestamp
      :rm ${TABLE_NAME} {id}
    `;
    await this.adapter.rawExecute(deleteQuery, { timestamp });

    return count;
  }

  async getStats(): Promise<CompactionStats> {
    const entries = await this.query({ limit: 10000 });

    const bySource: Record<string, number> = {};
    const byIntentCategory: Record<string, number> = {};
    let totalRawEvents = 0;

    for (const entry of entries) {
      bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
      byIntentCategory[entry.intentCategory] = (byIntentCategory[entry.intentCategory] ?? 0) + 1;
      totalRawEvents += entry.rawEventCount;
    }

    return {
      totalCompactedEntries: entries.length,
      totalRawEventsCompacted: totalRawEvents,
      averageEventsPerEntry: entries.length > 0 ? totalRawEvents / entries.length : 0,
      bySource,
      byIntentCategory,
      oldestEntry: entries.length > 0 ? entries[entries.length - 1]!.timestampStart : null,
      newestEntry: entries.length > 0 ? entries[0]!.timestampEnd : null,
      pendingRawEvents: 0, // Would need ledger query
      lastCompactionAt: null,
      lastCompactionDurationMs: 0,
    };
  }

  // ===========================================================================
  // Conversion Helpers
  // ===========================================================================

  private entryToRecord(entry: CompactedLedgerEntry): CompactedEntryRow {
    return {
      id: entry.id,
      session_id: entry.sessionId,
      timestamp_start: entry.timestampStart,
      timestamp_end: entry.timestampEnd,
      source: entry.source,
      intent_summary: entry.intentSummary,
      intent_category: entry.intentCategory,
      user_prompts: JSON.stringify(entry.userPrompts),
      mcp_queries: JSON.stringify(entry.mcpQueries),
      total_mcp_queries: entry.totalMcpQueries,
      unique_tools_used: JSON.stringify(entry.uniqueToolsUsed),
      code_accessed: JSON.stringify(entry.codeAccessed),
      code_changes: JSON.stringify(entry.codeChanges),
      semantic_impact: JSON.stringify(entry.semanticImpact),
      index_updates: JSON.stringify(entry.indexUpdates),
      memory_updates: JSON.stringify(entry.memoryUpdates),
      memory_rules_applied: JSON.stringify(entry.memoryRulesApplied),
      raw_event_ids: JSON.stringify(entry.rawEventIds),
      raw_event_count: entry.rawEventCount,
      confidence_score: entry.confidenceScore,
      completeness: entry.completeness,
      correlated_sessions: JSON.stringify(entry.correlatedSessions),
      git_commit_sha: entry.gitCommitSha ?? null,
      git_branch: entry.gitBranch ?? null,
      content_hash: entry.contentHash ?? null,
    };
  }

  private rowToEntry(row: CompactedEntryRow): CompactedLedgerEntry {
    return {
      id: row.id,
      sessionId: row.session_id,
      timestampStart: row.timestamp_start,
      timestampEnd: row.timestamp_end,
      source: row.source as CompactedLedgerEntry["source"],
      intentSummary: row.intent_summary,
      intentCategory: row.intent_category as CompactedLedgerEntry["intentCategory"],
      userPrompts: JSON.parse(row.user_prompts),
      mcpQueries: JSON.parse(row.mcp_queries),
      totalMcpQueries: row.total_mcp_queries,
      uniqueToolsUsed: JSON.parse(row.unique_tools_used),
      codeAccessed: JSON.parse(row.code_accessed),
      codeChanges: JSON.parse(row.code_changes),
      semanticImpact: JSON.parse(row.semantic_impact),
      indexUpdates: JSON.parse(row.index_updates),
      memoryUpdates: JSON.parse(row.memory_updates),
      memoryRulesApplied: JSON.parse(row.memory_rules_applied),
      rawEventIds: JSON.parse(row.raw_event_ids),
      rawEventCount: row.raw_event_count,
      confidenceScore: row.confidence_score,
      completeness: row.completeness,
      correlatedSessions: JSON.parse(row.correlated_sessions),
      gitCommitSha: row.git_commit_sha ?? undefined,
      gitBranch: row.git_branch ?? undefined,
      contentHash: row.content_hash ?? undefined,
    };
  }
}

// =============================================================================
// Simple Intent Analyzer (can be extended with LLM)
// =============================================================================

export class SimpleIntentAnalyzer implements IIntentAnalyzer {
  async inferIntent(events: LedgerEntry[]): Promise<{
    summary: string;
    category: CompactedLedgerEntry["intentCategory"];
    confidence: number;
    userPrompts: string[];
  }> {
    // Extract MCP queries for prompts
    const userPrompts = events
      .filter((e) => e.mcpContext?.query)
      .map((e) => e.mcpContext!.query!)
      .filter((q, i, arr) => arr.indexOf(q) === i); // unique

    // Analyze event types
    const eventTypes = events.map((e) => e.eventType);
    const hasIndexing = eventTypes.some((t) => t.startsWith("index:"));
    const hasClassify = eventTypes.some((t) => t.startsWith("classify:"));
    const hasJustify = eventTypes.some((t) => t.startsWith("justify:"));
    const hasErrors = eventTypes.some((t) => t === "system:error");

    // Analyze files
    const allFiles = events.flatMap((e) => [...e.impactedFiles]);
    const uniqueFiles = [...new Set(allFiles)];
    const hasTestFiles = uniqueFiles.some((f) => f.includes("test") || f.includes("spec"));
    const hasConfigFiles = uniqueFiles.some(
      (f) => f.includes("config") || f.includes(".json") || f.includes(".yaml")
    );

    // Infer category
    let category: CompactedLedgerEntry["intentCategory"] = "unknown";
    let confidence = 0.5;

    if (hasErrors) {
      category = "debugging";
      confidence = 0.7;
    } else if (hasTestFiles && !hasConfigFiles) {
      category = "testing";
      confidence = 0.7;
    } else if (hasConfigFiles && !hasTestFiles) {
      category = "configuration";
      confidence = 0.6;
    } else if (hasClassify || hasJustify) {
      category = "exploration";
      confidence = 0.6;
    } else if (hasIndexing && uniqueFiles.length > 0) {
      category = "feature-development";
      confidence = 0.5;
    }

    // Generate summary
    const actionVerbs = this.inferActionVerbs(events);
    const summary = this.generateSummary(actionVerbs, uniqueFiles, category);

    return { summary, category, confidence, userPrompts };
  }

  async calculateSimilarity(_group1: LedgerEntry[], _group2: LedgerEntry[]): Promise<number> {
    // Simple overlap-based similarity
    // TODO: Use embeddings for better semantic similarity
    return 0.5;
  }

  async clusterByIntent(events: LedgerEntry[], _threshold: number): Promise<IntentCluster[]> {
    // For now, return all events as a single cluster
    // TODO: Implement proper clustering with embeddings
    const intent = await this.inferIntent(events);
    return [
      {
        clusterId: `cluster_${Date.now()}`,
        events,
        inferredIntent: intent.summary,
        confidence: intent.confidence,
      },
    ];
  }

  async generateEmbedding(_events: LedgerEntry[]): Promise<number[]> {
    // TODO: Use actual embedding service
    return [];
  }

  private inferActionVerbs(events: LedgerEntry[]): string[] {
    const verbs: string[] = [];
    for (const event of events) {
      if (event.eventType.includes("added") || event.eventType.includes("created")) {
        verbs.push("added");
      }
      if (event.eventType.includes("modified") || event.eventType.includes("updated")) {
        verbs.push("updated");
      }
      if (event.eventType.includes("deleted")) {
        verbs.push("removed");
      }
      if (event.eventType.includes("query")) {
        verbs.push("queried");
      }
    }
    return [...new Set(verbs)];
  }

  private generateSummary(
    verbs: string[],
    files: string[],
    category: string
  ): string {
    if (verbs.length === 0) {
      return `Session with ${files.length} files accessed`;
    }

    const verbStr = verbs.slice(0, 2).join(" and ");
    const fileCount = files.length;

    if (category === "debugging") {
      return `Debugged issues in ${fileCount} file${fileCount !== 1 ? "s" : ""}`;
    }
    if (category === "testing") {
      return `${verbStr} tests in ${fileCount} file${fileCount !== 1 ? "s" : ""}`;
    }
    if (category === "configuration") {
      return `Updated configuration in ${fileCount} file${fileCount !== 1 ? "s" : ""}`;
    }

    return `${verbStr.charAt(0).toUpperCase() + verbStr.slice(1)} code in ${fileCount} file${fileCount !== 1 ? "s" : ""}`;
  }
}

// =============================================================================
// Main Compaction Service
// =============================================================================

export class LedgerCompactionService implements ILedgerCompaction {
  private storage: ICompactionStorage;
  private ledger: IChangeLedger;
  private intentAnalyzer: IIntentAnalyzer;
  private config: CompactionConfig;
  private initialized = false;
  private autoCompactionTimer: ReturnType<typeof setInterval> | null = null;
  private lastCompactionAt: string | null = null;
  private lastCompactionDurationMs = 0;

  constructor(
    storage: ICompactionStorage,
    ledger: IChangeLedger,
    intentAnalyzer: IIntentAnalyzer,
    config?: Partial<CompactionConfig>
  ) {
    this.storage = storage;
    this.ledger = ledger;
    this.intentAnalyzer = intentAnalyzer;
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.storage.initialize();
    this.initialized = true;
    logger.info("Ledger compaction service initialized");
  }

  get isReady(): boolean {
    return this.initialized;
  }

  // =========================================================================
  // Compaction Operations
  // =========================================================================

  async compact(): Promise<CompactionResult> {
    const startTime = Date.now();
    const errors: Array<{ sessionId: string; error: string }> = [];

    try {
      // Get uncompacted events
      const recentEvents = await this.ledger.getRecent(this.config.compactionBatchSize);
      if (recentEvents.length < this.config.minEventsForCompaction) {
        return {
          success: true,
          entriesProcessed: 0,
          entriesCompacted: 0,
          sessionsProcessed: 0,
          errors: [],
          durationMs: Date.now() - startTime,
        };
      }

      // Group into sessions
      const sessions = await this.groupIntoSessions(recentEvents);
      let entriesCompacted = 0;

      for (const session of sessions) {
        try {
          const compacted = await this.compactSessionGroup(session);
          if (compacted) {
            await this.storage.store(compacted);
            entriesCompacted++;
          }
        } catch (error) {
          errors.push({
            sessionId: session.sessionId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      this.lastCompactionAt = new Date().toISOString();
      this.lastCompactionDurationMs = Date.now() - startTime;

      return {
        success: errors.length === 0,
        entriesProcessed: recentEvents.length,
        entriesCompacted,
        sessionsProcessed: sessions.length,
        errors,
        durationMs: this.lastCompactionDurationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          err: error,
          errorMessage,
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        "Ledger compaction failed: %s",
        errorMessage
      );
      return {
        success: false,
        entriesProcessed: 0,
        entriesCompacted: 0,
        sessionsProcessed: 0,
        errors: [{ sessionId: "unknown", error: errorMessage }],
        durationMs: Date.now() - startTime,
      };
    }
  }

  async compactSession(sessionId: string): Promise<CompactedLedgerEntry | null> {
    const events = await this.ledger.getBySession(sessionId);
    if (events.length < this.config.minEventsForCompaction) {
      return null;
    }

    const session: SessionEventGroup = {
      sessionId,
      events,
      startTime: events[events.length - 1]!.timestamp,
      endTime: events[0]!.timestamp,
      source: this.inferSource(events),
    };

    return this.compactSessionGroup(session);
  }

  async compactTimeRange(startTime: string, endTime: string): Promise<CompactionResult> {
    const events = await this.ledger.query({
      startTime,
      endTime,
      limit: this.config.maxRawEventsPerCompaction,
      offset: 0,
    });

    const sessions = await this.groupIntoSessions(events);
    const errors: Array<{ sessionId: string; error: string }> = [];
    let entriesCompacted = 0;

    for (const session of sessions) {
      try {
        const compacted = await this.compactSessionGroup(session);
        if (compacted) {
          await this.storage.store(compacted);
          entriesCompacted++;
        }
      } catch (error) {
        errors.push({
          sessionId: session.sessionId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      success: errors.length === 0,
      entriesProcessed: events.length,
      entriesCompacted,
      sessionsProcessed: sessions.length,
      errors,
      durationMs: 0,
    };
  }

  async forceCompaction(): Promise<CompactionResult> {
    return this.compact();
  }

  // =========================================================================
  // Session Management
  // =========================================================================

  async groupIntoSessions(events: LedgerEntry[]): Promise<SessionEventGroup[]> {
    if (events.length === 0) return [];

    // Sort by timestamp descending
    const sorted = [...events].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const sessions: SessionEventGroup[] = [];
    let currentSession: SessionEventGroup | null = null;

    for (const event of sorted) {
      if (!currentSession || this.detectSessionBoundary(event, currentSession.events[0] ?? null)) {
        // Start new session
        if (currentSession && currentSession.events.length > 0) {
          sessions.push(currentSession);
        }
        currentSession = {
          sessionId: event.sessionId ?? `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          events: [event],
          startTime: event.timestamp,
          endTime: event.timestamp,
          source: this.inferSource([event]),
        };
      } else {
        // Add to current session
        currentSession.events.push(event);
        currentSession.startTime = event.timestamp;
      }
    }

    if (currentSession && currentSession.events.length > 0) {
      sessions.push(currentSession);
    }

    return sessions;
  }

  detectSessionBoundary(event: LedgerEntry, previousEvent: LedgerEntry | null): boolean {
    if (!previousEvent) return true;

    // Different session IDs
    if (event.sessionId && previousEvent.sessionId && event.sessionId !== previousEvent.sessionId) {
      return true;
    }

    // Time gap exceeds threshold
    const eventTime = new Date(event.timestamp).getTime();
    const prevTime = new Date(previousEvent.timestamp).getTime();
    const gap = Math.abs(eventTime - prevTime);

    if (gap > this.config.sessionTimeoutMs) {
      return true;
    }

    // System shutdown/startup indicates boundary
    if (event.eventType === "system:startup" || previousEvent.eventType === "system:shutdown") {
      return true;
    }

    return false;
  }

  async getActiveSessions(): Promise<SessionEventGroup[]> {
    const recent = await this.ledger.getRecent(1000);
    return this.groupIntoSessions(recent);
  }

  // =========================================================================
  // Intent Analysis
  // =========================================================================

  async clusterByIntent(events: LedgerEntry[]): Promise<IntentCluster[]> {
    return this.intentAnalyzer.clusterByIntent(events, this.config.intentSimilarityThreshold);
  }

  async mergeSimilarClusters(clusters: IntentCluster[], threshold: number): Promise<IntentCluster[]> {
    // Simple merging - combine clusters with high similarity
    const merged: IntentCluster[] = [];
    const used = new Set<string>();

    for (const cluster of clusters) {
      if (used.has(cluster.clusterId)) continue;

      const toMerge = [cluster];
      used.add(cluster.clusterId);

      for (const other of clusters) {
        if (used.has(other.clusterId)) continue;
        const similarity = await this.intentAnalyzer.calculateSimilarity(cluster.events, other.events);
        if (similarity >= threshold) {
          toMerge.push(other);
          used.add(other.clusterId);
        }
      }

      if (toMerge.length === 1) {
        merged.push(cluster);
      } else {
        // Merge into single cluster
        merged.push({
          clusterId: `merged_${Date.now()}`,
          events: toMerge.flatMap((c) => c.events),
          inferredIntent: toMerge[0]!.inferredIntent,
          confidence: Math.max(...toMerge.map((c) => c.confidence)),
        });
      }
    }

    return merged;
  }

  // =========================================================================
  // Querying
  // =========================================================================

  async getEntry(id: string): Promise<CompactedLedgerEntry | null> {
    return this.storage.getById(id);
  }

  async getEntryForSession(sessionId: string): Promise<CompactedLedgerEntry | null> {
    return this.storage.getBySessionId(sessionId);
  }

  async query(query: CompactedEntryQuery): Promise<CompactedLedgerEntry[]> {
    return this.storage.query(query);
  }

  async getTimeline(startTime: string, endTime: string, limit?: number): Promise<CompactedLedgerEntry[]> {
    return this.storage.getTimeline(startTime, endTime, limit);
  }

  async getRecent(limit = 20): Promise<CompactedLedgerEntry[]> {
    return this.storage.query({ limit });
  }

  // =========================================================================
  // Hash Verification
  // =========================================================================

  calculateContentHash(entry: CompactedLedgerEntry): string {
    const content = JSON.stringify({
      sessionId: entry.sessionId,
      intentSummary: entry.intentSummary,
      codeAccessed: entry.codeAccessed,
      codeChanges: entry.codeChanges,
      rawEventIds: entry.rawEventIds,
    });

    return createHash("sha256").update(content).digest("hex");
  }

  verifyIntegrity(entry: CompactedLedgerEntry): boolean {
    if (!entry.contentHash) return true; // No hash to verify
    return this.calculateContentHash(entry) === entry.contentHash;
  }

  // =========================================================================
  // Maintenance
  // =========================================================================

  async cleanupRawEvents(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    // This would require ledger to support deletion
    // For now, rely on ledger's own retention policy
    logger.info({ cutoff }, "Raw event cleanup requested");
    return 0;
  }

  async getStats(): Promise<CompactionStats> {
    const stats = await this.storage.getStats();
    stats.lastCompactionAt = this.lastCompactionAt;
    stats.lastCompactionDurationMs = this.lastCompactionDurationMs;
    return stats;
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  updateConfig(config: Partial<CompactionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): CompactionConfig {
    return { ...this.config };
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  startAutoCompaction(): void {
    if (this.autoCompactionTimer) return;

    this.autoCompactionTimer = setInterval(() => {
      this.compact().catch((err) => logger.error({ err }, "Auto-compaction failed"));
    }, this.config.compactionIntervalMs);

    logger.info({ intervalMs: this.config.compactionIntervalMs }, "Auto-compaction started");
  }

  stopAutoCompaction(): void {
    if (this.autoCompactionTimer) {
      clearInterval(this.autoCompactionTimer);
      this.autoCompactionTimer = null;
    }
    logger.info("Auto-compaction stopped");
  }

  async shutdown(): Promise<void> {
    this.stopAutoCompaction();
    // Final compaction
    await this.compact();
    logger.info("Ledger compaction service shut down");
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private async compactSessionGroup(session: SessionEventGroup): Promise<CompactedLedgerEntry | null> {
    if (session.events.length < this.config.minEventsForCompaction) {
      return null;
    }

    // Analyze intent
    const intentInfo = await this.intentAnalyzer.inferIntent(session.events);

    // Extract MCP queries
    const mcpQueries: MCPQueryTrace[] = session.events
      .filter((e) => e.mcpContext?.toolName)
      .map((e) => ({
        toolName: e.mcpContext!.toolName!,
        query: e.mcpContext!.query ?? "",
        parameters: e.mcpContext!.parameters,
        resultCount: e.mcpContext!.resultCount ?? 0,
        responseTimeMs: e.mcpContext!.responseTimeMs ?? 0,
        timestamp: e.timestamp,
        entityIdsReturned: e.impactedEntities,
        filesReturned: e.impactedFiles,
      }));

    // Aggregate file access
    const allFiles = session.events.flatMap((e) => e.impactedFiles);
    const uniqueFiles = [...new Set(allFiles)];

    const allEntities = session.events.flatMap((e) => e.impactedEntities);
    const uniqueEntities = [...new Set(allEntities)];

    // Aggregate code changes
    const filesModified: string[] = [];
    const filesCreated: string[] = [];
    const filesDeleted: string[] = [];
    let totalLinesAdded = 0;
    let totalLinesDeleted = 0;

    for (const event of session.events) {
      if (event.eventType === "index:file:modified") {
        filesModified.push(...event.impactedFiles);
      }
      if (event.eventType === "index:file:added") {
        filesCreated.push(...event.impactedFiles);
      }
      if (event.eventType === "index:file:deleted") {
        filesDeleted.push(...event.impactedFiles);
      }
      // Would need line change info from events
    }

    // Aggregate semantic impact
    const verticals = [...new Set(session.events.flatMap((e) => e.domainsInvolved))];
    const infrastructureInvolved = [...new Set(session.events.flatMap((e) => e.infrastructureInvolved))];

    // Aggregate index updates
    let entitiesAdded = 0;
    let entitiesUpdated = 0;
    let entitiesRemoved = 0;

    for (const event of session.events) {
      if (event.indexGraphDiffSummary) {
        entitiesAdded += event.indexGraphDiffSummary.nodesCreated;
        entitiesUpdated += event.indexGraphDiffSummary.nodesUpdated;
        entitiesRemoved += event.indexGraphDiffSummary.nodesDeleted;
      }
    }

    const compacted = createCompactedEntry(
      session.sessionId,
      session.source,
      intentInfo.summary,
      session.startTime,
      session.endTime,
      {
        intentCategory: intentInfo.category,
        userPrompts: intentInfo.userPrompts,
        mcpQueries,
        totalMcpQueries: mcpQueries.length,
        uniqueToolsUsed: [...new Set(mcpQueries.map((q) => q.toolName))],
        codeAccessed: {
          files: uniqueFiles,
          entities: uniqueEntities,
          uniqueFilesCount: uniqueFiles.length,
          uniqueEntitiesCount: uniqueEntities.length,
        },
        codeChanges: {
          filesModified: [...new Set(filesModified)],
          filesCreated: [...new Set(filesCreated)],
          filesDeleted: [...new Set(filesDeleted)],
          functionsChanged: [],
          classesChanged: [],
          interfacesChanged: [],
          totalLinesAdded,
          totalLinesDeleted,
        },
        semanticImpact: {
          verticals,
          horizontals: infrastructureInvolved.map((h) => ({ name: h })),
          servicesAffected: [],
          apisAffected: [],
          patternsUsed: [],
        },
        indexUpdates: {
          entitiesAdded,
          entitiesUpdated,
          entitiesRemoved,
          relationshipsAdded: 0,
          relationshipsRemoved: 0,
          embeddingsGenerated: 0,
        },
        rawEventIds: session.events.map((e) => e.id),
        rawEventCount: session.events.length,
        confidenceScore: intentInfo.confidence,
        completeness: this.calculateCompleteness(session.events),
      }
    );

    // Calculate content hash
    compacted.contentHash = this.calculateContentHash(compacted);

    return compacted;
  }

  private inferSource(events: LedgerEntry[]): CompactedLedgerEntry["source"] {
    // Check for MCP queries
    const hasMcp = events.some((e) => e.source === "mcp-query");
    if (hasMcp) return "claude-code"; // Default to Claude Code for MCP

    // Check for filesystem events
    const hasFilesystem = events.some((e) => e.source === "filesystem");
    if (hasFilesystem) return "filesystem";

    return "manual";
  }

  private calculateCompleteness(events: LedgerEntry[]): number {
    // Higher if we have more context
    let score = 0.3; // Base score

    if (events.some((e) => e.mcpContext)) score += 0.2;
    if (events.some((e) => e.indexGraphDiffSummary)) score += 0.2;
    if (events.some((e) => e.classificationChanges.length > 0)) score += 0.15;
    if (events.some((e) => e.userInteraction)) score += 0.15;

    return Math.min(1, score);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createCompactionStorage(adapter: IStorageAdapter): ICompactionStorage {
  return new CozoCompactionStorage(adapter);
}

export function createIntentAnalyzer(): IIntentAnalyzer {
  return new SimpleIntentAnalyzer();
}

export function createLedgerCompaction(
  adapter: IStorageAdapter,
  ledger: IChangeLedger,
  config?: Partial<CompactionConfig>
): ILedgerCompaction {
  const storage = createCompactionStorage(adapter);
  const analyzer = createIntentAnalyzer();
  return new LedgerCompactionService(storage, ledger, analyzer, config);
}

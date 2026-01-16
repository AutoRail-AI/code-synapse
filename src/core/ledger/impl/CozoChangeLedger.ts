/**
 * CozoDB Change Ledger Implementation
 *
 * Append-only log of all system events for observability.
 */

import type {
  IChangeLedger,
  ILedgerStorage,
  ChangeLedgerConfig,
  LedgerSubscriber,
  SubscriptionFilter,
} from "../interfaces/IChangeLedger.js";
import type {
  LedgerEntry,
  LedgerQuery,
  LedgerAggregation,
  TimelineEntry,
  LedgerEventType,
  EventSource,
} from "../models/ledger-events.js";
import type { GraphDatabase } from "../../graph/database.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("change-ledger");

// Row type for ledger queries (matches snake_case schema)
interface LedgerRow {
  id: string;
  timestamp: number; // Unix timestamp in ms (DB stores as Int)
  sequence: number;
  event_type: string;
  source: string;
  impacted_files: string;
  impacted_entities: string;
  domains_involved: string;
  infrastructure_involved: string;
  classification_changes: string;
  index_graph_diff_summary: string | null;
  confidence_adjustments: string;
  user_interaction: string | null;
  mcp_context: string | null;
  metadata: string;
  summary: string;
  details: string | null;
  error_code: string | null;
  error_message: string | null;
  stack_trace: string | null;
  correlation_id: string | null;
  parent_event_id: string | null;
  session_id: string | null;
}

// =============================================================================
// Storage Implementation
// =============================================================================

export class CozoLedgerStorage implements ILedgerStorage {
  private db: GraphDatabase;

  constructor(db: GraphDatabase) {
    this.db = db;
  }

  async initialize(): Promise<void> {
    // Schema created by graph database
  }

  async store(entries: LedgerEntry[]): Promise<void> {
    for (const entry of entries) {
      const query = `
        ?[id, timestamp, sequence, event_type, source,
          impacted_files, impacted_entities, domains_involved, infrastructure_involved,
          classification_changes, index_graph_diff_summary, confidence_adjustments,
          user_interaction, mcp_context, metadata, summary, details,
          error_code, error_message, stack_trace, correlation_id, parent_event_id, session_id] <- [[
          $id, $timestamp, $sequence, $event_type, $source,
          $impacted_files, $impacted_entities, $domains_involved, $infrastructure_involved,
          $classification_changes, $index_graph_diff_summary, $confidence_adjustments,
          $user_interaction, $mcp_context, $metadata, $summary, $details,
          $error_code, $error_message, $stack_trace, $correlation_id, $parent_event_id, $session_id
        ]]
        :put LedgerEntry {
          id, timestamp, sequence, event_type, source,
          impacted_files, impacted_entities, domains_involved, infrastructure_involved,
          classification_changes, index_graph_diff_summary, confidence_adjustments,
          user_interaction, mcp_context, metadata, summary, details,
          error_code, error_message, stack_trace, correlation_id, parent_event_id, session_id
        }
      `;

      await this.db.query(query, {
        id: entry.id,
        timestamp: new Date(entry.timestamp).getTime(), // Convert ISO string to Unix timestamp
        sequence: entry.sequence,
        event_type: entry.eventType,
        source: entry.source,
        impacted_files: JSON.stringify(entry.impactedFiles),
        impacted_entities: JSON.stringify(entry.impactedEntities),
        domains_involved: JSON.stringify(entry.domainsInvolved),
        infrastructure_involved: JSON.stringify(entry.infrastructureInvolved),
        classification_changes: JSON.stringify(entry.classificationChanges),
        index_graph_diff_summary: entry.indexGraphDiffSummary
          ? JSON.stringify(entry.indexGraphDiffSummary)
          : null,
        confidence_adjustments: JSON.stringify(entry.confidenceAdjustments),
        user_interaction: entry.userInteraction ? JSON.stringify(entry.userInteraction) : null,
        mcp_context: entry.mcpContext ? JSON.stringify(entry.mcpContext) : null,
        metadata: JSON.stringify(entry.metadata),
        summary: entry.summary,
        details: entry.details ?? null,
        error_code: entry.errorCode ?? null,
        error_message: entry.errorMessage ?? null,
        stack_trace: entry.stackTrace ?? null,
        correlation_id: entry.correlationId ?? null,
        parent_event_id: entry.parentEventId ?? null,
        session_id: entry.sessionId ?? null,
      });
    }
  }

  async query(queryParams: LedgerQuery): Promise<LedgerEntry[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {
      limit: queryParams.limit ?? 100,
      offset: queryParams.offset ?? 0,
    };

    if (queryParams.startTime) {
      conditions.push("timestamp >= $startTime");
      params.startTime = new Date(queryParams.startTime).getTime(); // Convert to Unix timestamp
    }
    if (queryParams.endTime) {
      conditions.push("timestamp <= $endTime");
      params.endTime = new Date(queryParams.endTime).getTime(); // Convert to Unix timestamp
    }
    if (queryParams.correlationId) {
      conditions.push("correlation_id == $correlation_id");
      params.correlation_id = queryParams.correlationId;
    }
    if (queryParams.sessionId) {
      conditions.push("session_id == $session_id");
      params.session_id = queryParams.sessionId;
    }

    const whereClause = conditions.length > 0 ? `, ${conditions.join(", ")}` : "";
    const orderDir = queryParams.orderDirection === "asc" ? "" : "-";

    const dbQuery = `
      ?[id, timestamp, sequence, event_type, source,
        impacted_files, impacted_entities, domains_involved, infrastructure_involved,
        classification_changes, index_graph_diff_summary, confidence_adjustments,
        user_interaction, mcp_context, metadata, summary, details,
        error_code, error_message, stack_trace, correlation_id, parent_event_id, session_id] :=
        *LedgerEntry{
          id, timestamp, sequence, event_type, source,
          impacted_files, impacted_entities, domains_involved, infrastructure_involved,
          classification_changes, index_graph_diff_summary, confidence_adjustments,
          user_interaction, mcp_context, metadata, summary, details,
          error_code, error_message, stack_trace, correlation_id, parent_event_id, session_id
        }${whereClause}
      :order ${orderDir}sequence
      :limit $limit
      :offset $offset
    `;

    const rows = await this.db.query<LedgerRow>(dbQuery, params);
    return rows.map((row) => this.rowToEntry(row));
  }

  async getById(id: string): Promise<LedgerEntry | null> {
    const query = `
      ?[id, timestamp, sequence, event_type, source,
        impacted_files, impacted_entities, domains_involved, infrastructure_involved,
        classification_changes, index_graph_diff_summary, confidence_adjustments,
        user_interaction, mcp_context, metadata, summary, details,
        error_code, error_message, stack_trace, correlation_id, parent_event_id, session_id] :=
        *LedgerEntry{
          id, timestamp, sequence, event_type, source,
          impacted_files, impacted_entities, domains_involved, infrastructure_involved,
          classification_changes, index_graph_diff_summary, confidence_adjustments,
          user_interaction, mcp_context, metadata, summary, details,
          error_code, error_message, stack_trace, correlation_id, parent_event_id, session_id
        },
        id == $id
    `;

    const rows = await this.db.query<LedgerRow>(query, { id });
    if (rows.length === 0) return null;
    return this.rowToEntry(rows[0]!);
  }

  async getByCorrelation(correlationId: string): Promise<LedgerEntry[]> {
    return this.query({ correlationId, limit: 1000, offset: 0 });
  }

  async getBySession(sessionId: string): Promise<LedgerEntry[]> {
    return this.query({ sessionId, limit: 1000, offset: 0 });
  }

  async getCount(queryParams?: Partial<LedgerQuery>): Promise<number> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (queryParams?.startTime) {
      conditions.push("timestamp >= $startTime");
      params.startTime = queryParams.startTime;
    }
    if (queryParams?.endTime) {
      conditions.push("timestamp <= $endTime");
      params.endTime = queryParams.endTime;
    }

    const whereClause = conditions.length > 0 ? `, ${conditions.join(", ")}` : "";

    const dbQuery = `
      ?[cnt] := cnt = count(id), *LedgerEntry{id, timestamp}${whereClause}
    `;

    const rows = await this.db.query<{ cnt: number }>(dbQuery, params);
    return rows[0]?.cnt ?? 0;
  }

  async getOldestTimestamp(): Promise<string | null> {
    const query = `
      ?[ts] := *LedgerEntry{timestamp: ts}
      :order ts
      :limit 1
    `;

    const rows = await this.db.query<{ ts: number }>(query, {});
    if (!rows[0]?.ts) return null;
    return new Date(rows[0].ts).toISOString(); // Convert Unix timestamp to ISO string
  }

  async getNewestTimestamp(): Promise<string | null> {
    const query = `
      ?[ts] := *LedgerEntry{timestamp: ts}
      :order -ts
      :limit 1
    `;

    const rows = await this.db.query<{ ts: number }>(query, {});
    if (!rows[0]?.ts) return null;
    return new Date(rows[0].ts).toISOString(); // Convert Unix timestamp to ISO string
  }

  async deleteOlderThan(timestamp: string): Promise<number> {
    const timestampMs = new Date(timestamp).getTime(); // Convert ISO string to Unix timestamp

    // First count
    const countQuery = `
      ?[cnt] := cnt = count(id), *LedgerEntry{id, timestamp: ts}, ts < $timestamp
    `;
    const countRows = await this.db.query<{ cnt: number }>(countQuery, { timestamp: timestampMs });
    const count = countRows[0]?.cnt ?? 0;

    // Then delete
    const deleteQuery = `
      ?[id] := *LedgerEntry{id, timestamp: ts}, ts < $timestamp
      :rm LedgerEntry {id}
    `;
    await this.db.query(deleteQuery, { timestamp: timestampMs });

    return count;
  }

  async getAggregations(queryParams: LedgerQuery): Promise<LedgerAggregation> {
    // Simplified aggregation - would need more complex queries for full implementation
    const entries = await this.query({ ...queryParams, limit: 10000 });

    const byEventType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const fileImpacts: Record<string, number> = {};
    const entityImpacts: Record<string, number> = {};
    let errorCount = 0;
    let totalResponseTime = 0;
    let responseTimeCount = 0;

    for (const entry of entries) {
      byEventType[entry.eventType] = (byEventType[entry.eventType] ?? 0) + 1;
      bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;

      for (const file of entry.impactedFiles) {
        fileImpacts[file] = (fileImpacts[file] ?? 0) + 1;
      }
      for (const entity of entry.impactedEntities) {
        entityImpacts[entity] = (entityImpacts[entity] ?? 0) + 1;
      }

      if (entry.errorCode) errorCount++;
      if (entry.mcpContext?.responseTimeMs) {
        totalResponseTime += entry.mcpContext.responseTimeMs;
        responseTimeCount++;
      }
    }

    const topFiles = Object.entries(fileImpacts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([file, count]) => ({ file, count }));

    const topEntities = Object.entries(entityImpacts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([entity, count]) => ({ entity, count }));

    return {
      totalEvents: entries.length,
      byEventType,
      bySource,
      byHour: [], // Would need time bucketing
      topImpactedFiles: topFiles,
      topImpactedEntities: topEntities,
      classificationChanges: entries.filter((e) => e.classificationChanges.length > 0).length,
      errorCount,
      averageResponseTimeMs: responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0,
    };
  }

  private rowToEntry(row: LedgerRow): LedgerEntry {
    return {
      id: row.id,
      timestamp: new Date(row.timestamp).toISOString(), // Convert Unix timestamp to ISO string
      sequence: row.sequence,
      eventType: row.event_type as LedgerEventType,
      source: row.source as EventSource,
      impactedFiles: JSON.parse(row.impacted_files),
      impactedEntities: JSON.parse(row.impacted_entities),
      domainsInvolved: JSON.parse(row.domains_involved),
      infrastructureInvolved: JSON.parse(row.infrastructure_involved),
      classificationChanges: JSON.parse(row.classification_changes),
      indexGraphDiffSummary: row.index_graph_diff_summary ? JSON.parse(row.index_graph_diff_summary) : undefined,
      confidenceAdjustments: JSON.parse(row.confidence_adjustments),
      userInteraction: row.user_interaction ? JSON.parse(row.user_interaction) : undefined,
      mcpContext: row.mcp_context ? JSON.parse(row.mcp_context) : undefined,
      metadata: JSON.parse(row.metadata),
      summary: row.summary,
      details: row.details ?? undefined,
      errorCode: row.error_code ?? undefined,
      errorMessage: row.error_message ?? undefined,
      stackTrace: row.stack_trace ?? undefined,
      correlationId: row.correlation_id ?? undefined,
      parentEventId: row.parent_event_id ?? undefined,
      sessionId: row.session_id ?? undefined,
    };
  }
}

// =============================================================================
// Change Ledger Implementation
// =============================================================================

export class CozoChangeLedger implements IChangeLedger {
  private storage: ILedgerStorage;
  private config: ChangeLedgerConfig;
  private subscribers: Map<string, { callback: LedgerSubscriber; filter?: SubscriptionFilter }> =
    new Map();
  private pendingEntries: LedgerEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private currentSequence = 0;
  private initialized = false;

  constructor(storage: ILedgerStorage, config: ChangeLedgerConfig) {
    this.storage = storage;
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.storage.initialize();

    // Start flush timer
    if (this.config.persistToDisk && this.config.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
    }

    // Get current sequence
    const newest = await this.storage.getNewestTimestamp();
    if (newest) {
      const entries = await this.storage.query({
        limit: 1,
        offset: 0,
        orderDirection: "desc",
      });
      if (entries.length > 0 && entries[0]) {
        this.currentSequence = entries[0].sequence;
      }
    }

    this.initialized = true;
    logger.info("Change ledger initialized");
  }

  async append(entry: LedgerEntry): Promise<void> {
    // Update sequence if not set
    if (entry.sequence === 0) {
      entry.sequence = ++this.currentSequence;
    }

    // Add to pending entries
    this.pendingEntries.push(entry);

    // Notify subscribers
    this.notifySubscribers(entry);

    // Flush if batch size reached
    if (this.pendingEntries.length >= this.config.maxBatchSize) {
      await this.flush();
    }
  }

  async appendBatch(entries: LedgerEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.append(entry);
    }
  }

  async query(queryParams: LedgerQuery): Promise<LedgerEntry[]> {
    await this.flush();
    return this.storage.query(queryParams);
  }

  async getEntry(id: string): Promise<LedgerEntry | null> {
    // Check pending first
    const pending = this.pendingEntries.find((e) => e.id === id);
    if (pending) return pending;

    return this.storage.getById(id);
  }

  async getByCorrelation(correlationId: string): Promise<LedgerEntry[]> {
    await this.flush();
    return this.storage.getByCorrelation(correlationId);
  }

  async getBySession(sessionId: string): Promise<LedgerEntry[]> {
    await this.flush();
    return this.storage.getBySession(sessionId);
  }

  async getTimeline(queryParams: LedgerQuery): Promise<TimelineEntry[]> {
    const entries = await this.query(queryParams);

    return entries.map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      eventType: entry.eventType,
      source: entry.source,
      summary: entry.summary,
      impactLevel: this.calculateImpactLevel(entry),
      hasClassificationChange: entry.classificationChanges.length > 0,
      hasUserInteraction: !!entry.userInteraction,
      hasError: !!entry.errorCode,
    }));
  }

  async getAggregations(queryParams: LedgerQuery): Promise<LedgerAggregation> {
    await this.flush();
    return this.storage.getAggregations(queryParams);
  }

  async getRecent(limit = 100): Promise<LedgerEntry[]> {
    return this.query({ limit, offset: 0, orderDirection: "desc" });
  }

  async getForEntity(entityId: string, limit = 100): Promise<LedgerEntry[]> {
    const entries = await this.query({ limit: limit * 10, offset: 0, orderDirection: "desc" });
    return entries
      .filter((e) => e.impactedEntities.includes(entityId))
      .slice(0, limit);
  }

  async getForFile(filePath: string, limit = 100): Promise<LedgerEntry[]> {
    const entries = await this.query({ limit: limit * 10, offset: 0, orderDirection: "desc" });
    return entries
      .filter((e) => e.impactedFiles.includes(filePath))
      .slice(0, limit);
  }

  subscribe(callback: LedgerSubscriber, filter?: SubscriptionFilter): () => void {
    const id = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.subscribers.set(id, { callback, filter });

    return () => {
      this.subscribers.delete(id);
    };
  }

  getCurrentSequence(): number {
    return this.currentSequence;
  }

  async getEntryCount(): Promise<number> {
    await this.flush();
    return this.storage.getCount();
  }

  async getOldestTimestamp(): Promise<string | null> {
    return this.storage.getOldestTimestamp();
  }

  async getNewestTimestamp(): Promise<string | null> {
    if (this.pendingEntries.length > 0) {
      const lastEntry = this.pendingEntries[this.pendingEntries.length - 1];
      return lastEntry?.timestamp ?? null;
    }
    return this.storage.getNewestTimestamp();
  }

  async flush(): Promise<void> {
    if (this.pendingEntries.length === 0) return;

    const toFlush = [...this.pendingEntries];
    this.pendingEntries = [];

    if (this.config.persistToDisk) {
      await this.storage.store(toFlush);
    }

    logger.debug({ count: toFlush.length }, "Flushed ledger entries");
  }

  async compact(): Promise<number> {
    if (this.config.retentionDays <= 0) return 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.retentionDays);

    const deleted = await this.storage.deleteOlderThan(cutoff.toISOString());
    logger.info({ deleted, retentionDays: this.config.retentionDays }, "Compacted ledger");

    return deleted;
  }

  async export(queryParams: LedgerQuery): Promise<string> {
    const entries = await this.query(queryParams);
    return JSON.stringify(entries, null, 2);
  }

  async import(json: string): Promise<number> {
    const entries = JSON.parse(json) as LedgerEntry[];
    await this.storage.store(entries);
    return entries.length;
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();
    logger.info("Change ledger shut down");
  }

  private notifySubscribers(entry: LedgerEntry): void {
    for (const [, { callback, filter }] of this.subscribers) {
      if (this.matchesFilter(entry, filter)) {
        try {
          callback(entry);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(
            {
              err: error,
              errorMessage,
              errorStack: error instanceof Error ? error.stack : undefined,
              entryId: entry.id,
              eventType: entry.eventType,
            },
            "Subscriber callback failed for event %s: %s",
            entry.eventType,
            errorMessage
          );
        }
      }
    }
  }

  private matchesFilter(entry: LedgerEntry, filter?: SubscriptionFilter): boolean {
    if (!filter) return true;

    if (filter.eventTypes && !filter.eventTypes.includes(entry.eventType)) {
      return false;
    }
    if (filter.sources && !filter.sources.includes(entry.source)) {
      return false;
    }
    if (filter.entityIds && !entry.impactedEntities.some((e) => filter.entityIds!.includes(e))) {
      return false;
    }
    if (filter.filePaths && !entry.impactedFiles.some((f) => filter.filePaths!.includes(f))) {
      return false;
    }
    if (filter.correlationId && entry.correlationId !== filter.correlationId) {
      return false;
    }

    return true;
  }

  private calculateImpactLevel(entry: LedgerEntry): "low" | "medium" | "high" {
    const impactScore =
      entry.impactedFiles.length * 2 +
      entry.impactedEntities.length +
      entry.classificationChanges.length * 3;

    if (impactScore > 20) return "high";
    if (impactScore > 5) return "medium";
    return "low";
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createLedgerStorage(db: GraphDatabase): ILedgerStorage {
  return new CozoLedgerStorage(db);
}

export function createChangeLedger(
  storage: ILedgerStorage,
  config: ChangeLedgerConfig
): IChangeLedger {
  return new CozoChangeLedger(storage, config);
}

/**
 * MCP Adaptive Indexer Implementation
 *
 * Observes MCP queries and code changes, correlates them,
 * and triggers intelligent re-indexing based on usage patterns.
 */

import type {
  IAdaptiveIndexer,
  QueryObservation,
  ChangeObservation,
  ReindexTrigger,
  AdaptiveIndexerStats,
  HotEntity,
  ColdEntity,
  IMCPObserver,
} from "../interfaces/IAdaptiveIndexer.js";
import type {
  ObservedQuery,
  ObservedChange,
  SemanticCorrelation,
  IndexingPriority,
  AdaptiveSession,
  AdaptiveReindexRequest,
  AdaptiveIndexerConfig,
} from "../models/indexing-context.js";
import {
  createObservedQuery,
  createObservedChange,
  createSemanticCorrelation,
  createAdaptiveReindexRequest,
  DEFAULT_ADAPTIVE_CONFIG,
} from "../models/indexing-context.js";
import type { GraphDatabase } from "../../graph/database.js";
import type { IChangeLedger } from "../../ledger/interfaces/IChangeLedger.js";
import { createAdaptiveIndexingEvent } from "../../ledger/models/ledger-events.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("adaptive-indexer");

// =============================================================================
// Implementation
// =============================================================================

export class MCPAdaptiveIndexer implements IAdaptiveIndexer, IMCPObserver {
  private db: GraphDatabase;
  private ledger: IChangeLedger | null;
  private config: AdaptiveIndexerConfig;
  private reindexTrigger: ReindexTrigger | null = null;

  // In-memory state
  private sessions: Map<string, AdaptiveSession> = new Map();
  private queries: Map<string, ObservedQuery> = new Map();
  private changes: Map<string, ObservedChange> = new Map();
  private correlations: Map<string, SemanticCorrelation> = new Map();
  private pendingRequests: Map<string, AdaptiveReindexRequest> = new Map();
  private priorities: Map<string, IndexingPriority> = new Map();

  private activeSessionId: string | null = null;
  private paused = false;
  private initialized = false;

  // Debounce timer for reindexing
  private reindexDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    db: GraphDatabase,
    ledger: IChangeLedger | null,
    config: AdaptiveIndexerConfig
  ) {
    this.db = db;
    this.ledger = ledger;
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    logger.info("Adaptive indexer initialized");
  }

  setReindexTrigger(trigger: ReindexTrigger): void {
    this.reindexTrigger = trigger;
  }

  // =========================================================================
  // Session Management
  // =========================================================================

  async getOrCreateSession(sessionId?: string): Promise<AdaptiveSession> {
    const id = sessionId ?? `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    let session = this.sessions.get(id);
    if (!session) {
      session = {
        id,
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        queryCount: 0,
        changeCount: 0,
        correlationCount: 0,
        activeFiles: [],
        activeEntities: [],
        activeDomains: [],
        triggeredReindexCount: 0,
        entitiesReindexed: 0,
      };
      this.sessions.set(id, session);
    }

    this.activeSessionId = id;
    return session;
  }

  getActiveSession(): AdaptiveSession | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) ?? null;
  }

  async endSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.endedAt = new Date().toISOString();
      // Persist to DB
      await this.persistSession(session);
    }
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }

  async getSession(sessionId: string): Promise<AdaptiveSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async listSessions(limit = 10): Promise<AdaptiveSession[]> {
    return Array.from(this.sessions.values())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit);
  }

  // =========================================================================
  // Query Observation
  // =========================================================================

  async observeQuery(observation: QueryObservation): Promise<ObservedQuery> {
    if (this.paused || !this.config.observeQueries) {
      return createObservedQuery(
        observation.toolName,
        observation.query,
        observation.sessionId,
        { entityIds: observation.resultEntityIds, files: observation.resultFiles },
        observation.responseTimeMs
      );
    }

    const query = createObservedQuery(
      observation.toolName,
      observation.query,
      observation.sessionId,
      { entityIds: observation.resultEntityIds, files: observation.resultFiles },
      observation.responseTimeMs
    );

    this.queries.set(query.id, query);

    // Update session
    const session = this.sessions.get(observation.sessionId);
    if (session) {
      session.queryCount++;
      session.lastActivityAt = new Date().toISOString();
      session.activeFiles = [...new Set([...session.activeFiles, ...observation.resultFiles])];
      session.activeEntities = [
        ...new Set([...session.activeEntities, ...observation.resultEntityIds]),
      ];
    }

    // Update priorities for returned entities
    for (const entityId of observation.resultEntityIds) {
      await this.updateEntityPriority(entityId, "query");
    }

    // Log to ledger
    if (this.ledger) {
      const event = createAdaptiveIndexingEvent(
        "adaptive:query:observed",
        `Query observed: ${observation.toolName}`,
        observation.resultEntityIds,
        query.id
      );
      await this.ledger.append(event);
    }

    // Trigger correlation analysis
    if (this.config.enableCorrelation) {
      this.scheduleCorrelationAnalysis(observation.sessionId);
    }

    return query;
  }

  async getQueriesForSession(sessionId: string): Promise<ObservedQuery[]> {
    return Array.from(this.queries.values()).filter((q) => q.sessionId === sessionId);
  }

  async getRecentQueries(limit = 100): Promise<ObservedQuery[]> {
    return Array.from(this.queries.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async getQueriesForEntity(entityId: string): Promise<ObservedQuery[]> {
    return Array.from(this.queries.values()).filter((q) =>
      q.returnedEntityIds.includes(entityId)
    );
  }

  async getQueriesForFile(filePath: string): Promise<ObservedQuery[]> {
    return Array.from(this.queries.values()).filter((q) =>
      q.returnedFiles.includes(filePath)
    );
  }

  // =========================================================================
  // Change Observation
  // =========================================================================

  async observeChange(observation: ChangeObservation): Promise<ObservedChange> {
    if (this.paused || !this.config.observeChanges) {
      return createObservedChange(observation.changeType, observation.filePath, observation.sessionId);
    }

    const change = createObservedChange(
      observation.changeType,
      observation.filePath,
      observation.sessionId
    );

    change.source = observation.source;
    change.entitiesAdded = observation.entitiesAffected?.filter(() => observation.changeType === "created") ?? [];
    change.entitiesModified = observation.entitiesAffected?.filter(() => observation.changeType === "modified") ?? [];
    change.entitiesDeleted = observation.entitiesAffected?.filter(() => observation.changeType === "deleted") ?? [];
    change.linesAdded = observation.linesAdded ?? 0;
    change.linesDeleted = observation.linesDeleted ?? 0;

    this.changes.set(change.id, change);

    // Update session
    if (observation.sessionId) {
      const session = this.sessions.get(observation.sessionId);
      if (session) {
        session.changeCount++;
        session.lastActivityAt = new Date().toISOString();
        session.activeFiles = [...new Set([...session.activeFiles, observation.filePath])];
      }
    }

    // Update priorities for affected entities
    for (const entityId of observation.entitiesAffected ?? []) {
      await this.updateEntityPriority(entityId, "change");
    }

    // Log to ledger
    if (this.ledger) {
      const event = createAdaptiveIndexingEvent(
        "adaptive:change:detected",
        `Change detected: ${observation.changeType} ${observation.filePath}`,
        observation.entitiesAffected ?? [],
        change.id
      );
      await this.ledger.append(event);
    }

    // Trigger correlation analysis
    if (this.config.enableCorrelation && observation.sessionId) {
      this.scheduleCorrelationAnalysis(observation.sessionId);
    }

    return change;
  }

  async getChangesForSession(sessionId: string): Promise<ObservedChange[]> {
    return Array.from(this.changes.values()).filter((c) => c.sessionId === sessionId);
  }

  async getRecentChanges(limit = 100): Promise<ObservedChange[]> {
    return Array.from(this.changes.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async getChangesForFile(filePath: string): Promise<ObservedChange[]> {
    return Array.from(this.changes.values()).filter((c) => c.filePath === filePath);
  }

  // =========================================================================
  // Correlation
  // =========================================================================

  async analyzeCorrelations(sessionId?: string): Promise<SemanticCorrelation[]> {
    const targetSessionId = sessionId ?? this.activeSessionId;
    if (!targetSessionId) return [];

    const sessionQueries = await this.getQueriesForSession(targetSessionId);
    const sessionChanges = await this.getChangesForSession(targetSessionId);

    const correlations: SemanticCorrelation[] = [];

    // Find queries followed by changes to returned entities/files
    for (const query of sessionQueries) {
      const queryTime = new Date(query.timestamp).getTime();

      for (const change of sessionChanges) {
        const changeTime = new Date(change.timestamp).getTime();

        // Only correlate changes that happened after the query
        if (changeTime <= queryTime) continue;

        // Check if change is within correlation window
        if (changeTime - queryTime > this.config.correlationWindowMs) continue;

        // Calculate correlation strength based on overlap
        const sharedFiles = query.returnedFiles.filter((f) => f === change.filePath);
        const sharedEntities = query.returnedEntityIds.filter(
          (e) =>
            change.entitiesAdded.includes(e) ||
            change.entitiesModified.includes(e) ||
            change.entitiesDeleted.includes(e)
        );

        if (sharedFiles.length === 0 && sharedEntities.length === 0) continue;

        const strength = this.calculateCorrelationStrength(
          query,
          change,
          sharedFiles,
          sharedEntities
        );

        if (strength < this.config.minCorrelationStrength) continue;

        // Determine correlation type
        const correlationType = this.determineCorrelationType(change);

        const correlation = createSemanticCorrelation(
          query.id,
          [change.id],
          correlationType,
          strength
        );

        correlation.sharedFiles = sharedFiles;
        correlation.sharedEntities = sharedEntities;
        correlation.suggestedReindexing = sharedEntities;

        this.correlations.set(correlation.id, correlation);
        correlations.push(correlation);

        // Update session
        const session = this.sessions.get(targetSessionId);
        if (session) {
          session.correlationCount++;
        }

        // Log to ledger
        if (this.ledger) {
          const event = createAdaptiveIndexingEvent(
            "adaptive:semantic:correlation",
            `Correlation found: ${correlationType} (strength: ${strength.toFixed(2)})`,
            sharedEntities,
            correlation.id
          );
          await this.ledger.append(event);
        }

        // Trigger reindexing if needed
        if (sharedEntities.length > 0 && strength >= this.config.minCorrelationStrength) {
          await this.requestReindex(sharedEntities, "query-correlation", "high");
        }
      }
    }

    return correlations;
  }

  async getCorrelationsForQuery(queryId: string): Promise<SemanticCorrelation[]> {
    return Array.from(this.correlations.values()).filter((c) => c.queryId === queryId);
  }

  async getCorrelationsForChange(changeId: string): Promise<SemanticCorrelation[]> {
    return Array.from(this.correlations.values()).filter((c) =>
      c.changeIds.includes(changeId)
    );
  }

  async getCorrelationsForSession(sessionId: string): Promise<SemanticCorrelation[]> {
    const sessionQueries = await this.getQueriesForSession(sessionId);
    const queryIds = new Set(sessionQueries.map((q) => q.id));
    return Array.from(this.correlations.values()).filter((c) => queryIds.has(c.queryId));
  }

  // =========================================================================
  // Priority Management
  // =========================================================================

  async calculatePriority(entityId: string): Promise<IndexingPriority> {
    const existing = this.priorities.get(entityId);
    if (existing) return existing;

    // Create new priority entry
    const priority: IndexingPriority = {
      entityId,
      filePath: "", // Would need to look up
      priorityScore: 50,
      factors: [],
      queryCount: 0,
      modificationCount: 0,
      correlationCount: 0,
    };

    this.priorities.set(entityId, priority);
    return priority;
  }

  async getPriorityQueue(limit = 100): Promise<IndexingPriority[]> {
    return Array.from(this.priorities.values())
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, limit);
  }

  async boostPriority(entityIds: string[], boost: number, reason: string): Promise<void> {
    for (const entityId of entityIds) {
      const priority = await this.calculatePriority(entityId);
      priority.priorityScore = Math.min(100, priority.priorityScore + boost);
      priority.factors.push({
        factor: reason,
        weight: 1,
        value: boost,
      });
    }
  }

  // =========================================================================
  // Reindexing
  // =========================================================================

  async requestReindex(
    entityIds: string[],
    reason: AdaptiveReindexRequest["reason"],
    priority: AdaptiveReindexRequest["priority"] = "normal"
  ): Promise<AdaptiveReindexRequest> {
    const request = createAdaptiveReindexRequest(entityIds, [], reason, priority);
    this.pendingRequests.set(request.id, request);

    // Log to ledger
    if (this.ledger) {
      const event = createAdaptiveIndexingEvent(
        "adaptive:reindex:triggered",
        `Reindex requested: ${reason} (${entityIds.length} entities)`,
        entityIds
      );
      await this.ledger.append(event);
    }

    // Schedule processing with debounce
    this.scheduleReindexProcessing();

    return request;
  }

  async getPendingRequests(): Promise<AdaptiveReindexRequest[]> {
    return Array.from(this.pendingRequests.values()).filter((r) => r.status === "pending");
  }

  async processRequests(): Promise<number> {
    if (!this.reindexTrigger) {
      logger.warn("No reindex trigger set");
      return 0;
    }

    const pending = await this.getPendingRequests();
    let processed = 0;

    // Sort by priority
    pending.sort((a, b) => b.priorityScore - a.priorityScore);

    // Process in batches
    const batch = pending.slice(0, this.config.reindexBatchSize);

    for (const request of batch) {
      try {
        request.status = "processing";
        await this.reindexTrigger(request);
        request.status = "completed";
        request.completedAt = new Date().toISOString();
        processed++;

        // Update session stats
        if (request.sessionId) {
          const session = this.sessions.get(request.sessionId);
          if (session) {
            session.triggeredReindexCount++;
            session.entitiesReindexed += request.entityIds.length;
          }
        }
      } catch (error) {
        request.status = "failed";
        request.error = error instanceof Error ? error.message : "Unknown error";
        logger.error({ error, requestId: request.id }, "Reindex request failed");
      }
    }

    return processed;
  }

  async cancelRequest(requestId: string): Promise<boolean> {
    const request = this.pendingRequests.get(requestId);
    if (!request || request.status !== "pending") return false;

    this.pendingRequests.delete(requestId);
    return true;
  }

  async getReindexHistory(limit = 100): Promise<AdaptiveReindexRequest[]> {
    return Array.from(this.pendingRequests.values())
      .filter((r) => r.status === "completed" || r.status === "failed")
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  // =========================================================================
  // Statistics
  // =========================================================================

  async getStats(): Promise<AdaptiveIndexerStats> {
    const pending = await this.getPendingRequests();
    const completed = Array.from(this.pendingRequests.values()).filter(
      (r) => r.status === "completed"
    );
    const failed = Array.from(this.pendingRequests.values()).filter(
      (r) => r.status === "failed"
    );

    const correlationStrengths = Array.from(this.correlations.values()).map(
      (c) => c.correlationStrength
    );
    const avgStrength =
      correlationStrengths.length > 0
        ? correlationStrengths.reduce((a, b) => a + b, 0) / correlationStrengths.length
        : 0;

    return {
      totalQueries: this.queries.size,
      totalChanges: this.changes.size,
      totalCorrelations: this.correlations.size,
      totalReindexRequests: this.pendingRequests.size,
      pendingRequests: pending.length,
      completedRequests: completed.length,
      failedRequests: failed.length,
      averageCorrelationStrength: avgStrength,
      activeSessions: Array.from(this.sessions.values()).filter((s) => !s.endedAt).length,
      entitiesInPriorityQueue: this.priorities.size,
    };
  }

  async getHotEntities(limit = 10): Promise<HotEntity[]> {
    const entityStats: Map<string, HotEntity> = new Map();

    // Count queries per entity
    for (const query of this.queries.values()) {
      for (const entityId of query.returnedEntityIds) {
        const existing = entityStats.get(entityId);
        if (existing) {
          existing.queryCount++;
          existing.lastQueried = query.timestamp;
        } else {
          entityStats.set(entityId, {
            entityId,
            entityName: entityId, // Would need lookup
            filePath: "", // Would need lookup
            queryCount: 1,
            modificationCount: 0,
            lastQueried: query.timestamp,
            heatScore: 0,
          });
        }
      }
    }

    // Count changes per entity
    for (const change of this.changes.values()) {
      const entities = [
        ...change.entitiesAdded,
        ...change.entitiesModified,
        ...change.entitiesDeleted,
      ];
      for (const entityId of entities) {
        const existing = entityStats.get(entityId);
        if (existing) {
          existing.modificationCount++;
          existing.lastModified = change.timestamp;
        }
      }
    }

    // Calculate heat scores
    for (const entity of entityStats.values()) {
      entity.heatScore = entity.queryCount * 2 + entity.modificationCount * 3;
    }

    return Array.from(entityStats.values())
      .sort((a, b) => b.heatScore - a.heatScore)
      .slice(0, limit);
  }

  async getColdEntities(_limit = 10): Promise<ColdEntity[]> {
    // Would need to query the graph for entities not in our hot list
    return [];
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  updateConfig(config: Partial<AdaptiveIndexerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): AdaptiveIndexerConfig {
    return { ...this.config };
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  pause(): void {
    this.paused = true;
    logger.info("Adaptive indexer paused");
  }

  resume(): void {
    this.paused = false;
    logger.info("Adaptive indexer resumed");
  }

  isPaused(): boolean {
    return this.paused;
  }

  async shutdown(): Promise<void> {
    this.paused = true;
    if (this.reindexDebounceTimer) {
      clearTimeout(this.reindexDebounceTimer);
    }

    // End all active sessions
    for (const [id, session] of this.sessions) {
      if (!session.endedAt) {
        await this.endSession(id);
      }
    }

    logger.info("Adaptive indexer shut down");
  }

  // =========================================================================
  // MCP Observer Interface
  // =========================================================================

  onToolCall(toolName: string, args: Record<string, unknown>, sessionId: string): void {
    logger.debug({ toolName, sessionId }, "Tool call observed");
  }

  onToolResult(
    toolName: string,
    args: Record<string, unknown>,
    result: unknown,
    sessionId: string,
    durationMs: number
  ): void {
    // Extract entity IDs and files from result
    const entityIds: string[] = [];
    const files: string[] = [];

    if (result && typeof result === "object") {
      // Try to extract from common result shapes
      const resultObj = result as Record<string, unknown>;
      if (Array.isArray(resultObj.entities)) {
        entityIds.push(
          ...resultObj.entities.map((e: { id?: string }) => e.id).filter(Boolean) as string[]
        );
      }
      if (Array.isArray(resultObj.files)) {
        files.push(
          ...resultObj.files.map((f: { path?: string }) => f.path).filter(Boolean) as string[]
        );
      }
    }

    // Observe the query
    this.observeQuery({
      toolName,
      query: JSON.stringify(args),
      parameters: args,
      sessionId,
      resultEntityIds: entityIds,
      resultFiles: files,
      responseTimeMs: durationMs,
    }).catch((err) => logger.error({ err }, "Failed to observe query"));
  }

  onResourceAccess(uri: string, sessionId: string): void {
    logger.debug({ uri, sessionId }, "Resource access observed");
  }

  onCodeGenerated(
    filePath: string,
    _content: string,
    sessionId: string,
    _context?: string
  ): void {
    this.observeChange({
      changeType: "modified",
      filePath,
      sessionId,
      source: "ai-generated",
    }).catch((err) => logger.error({ err }, "Failed to observe change"));
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private async updateEntityPriority(
    entityId: string,
    reason: "query" | "change"
  ): Promise<void> {
    const priority = await this.calculatePriority(entityId);

    if (reason === "query") {
      priority.queryCount++;
      priority.lastQueried = new Date().toISOString();
      priority.priorityScore = Math.min(100, priority.priorityScore + 5);
    } else {
      priority.modificationCount++;
      priority.lastModified = new Date().toISOString();
      priority.priorityScore = Math.min(100, priority.priorityScore + 10);
    }
  }

  private calculateCorrelationStrength(
    query: ObservedQuery,
    change: ObservedChange,
    sharedFiles: string[],
    sharedEntities: string[]
  ): number {
    let strength = 0;

    // File overlap contributes
    strength += (sharedFiles.length / Math.max(query.returnedFiles.length, 1)) * 0.3;

    // Entity overlap contributes more
    strength += (sharedEntities.length / Math.max(query.returnedEntityIds.length, 1)) * 0.5;

    // Time proximity contributes
    const queryTime = new Date(query.timestamp).getTime();
    const changeTime = new Date(change.timestamp).getTime();
    const timeDiff = changeTime - queryTime;
    const timeDecay = Math.max(0, 1 - timeDiff / this.config.correlationWindowMs);
    strength += timeDecay * 0.2;

    return Math.min(1, strength);
  }

  private determineCorrelationType(
    change: ObservedChange
  ): SemanticCorrelation["correlationType"] {
    if (change.entitiesAdded.length > 0) {
      return "query-then-create";
    }
    if (change.entitiesDeleted.length > 0) {
      return "query-then-delete";
    }
    return "query-then-edit";
  }

  private scheduleCorrelationAnalysis(sessionId: string): void {
    // Debounce correlation analysis
    setTimeout(() => {
      this.analyzeCorrelations(sessionId).catch((err) =>
        logger.error({ err }, "Correlation analysis failed")
      );
    }, 1000);
  }

  private scheduleReindexProcessing(): void {
    if (this.reindexDebounceTimer) {
      clearTimeout(this.reindexDebounceTimer);
    }

    this.reindexDebounceTimer = setTimeout(() => {
      this.processRequests().catch((err) =>
        logger.error({ err }, "Reindex processing failed")
      );
    }, this.config.reindexDebounceMs);
  }

  private async persistSession(session: AdaptiveSession): Promise<void> {
    try {
      const query = `
        ?[id, startedAt, lastActivityAt, endedAt, queryCount, changeCount,
          correlationCount, activeFiles, activeEntities, activeDomains,
          triggeredReindexCount, entitiesReindexed] <- [[
          $id, $startedAt, $lastActivityAt, $endedAt, $queryCount, $changeCount,
          $correlationCount, $activeFiles, $activeEntities, $activeDomains,
          $triggeredReindexCount, $entitiesReindexed
        ]]
        :put AdaptiveSession {
          id, startedAt, lastActivityAt, endedAt, queryCount, changeCount,
          correlationCount, activeFiles, activeEntities, activeDomains,
          triggeredReindexCount, entitiesReindexed
        }
      `;

      await this.db.query(query, {
        id: session.id,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        endedAt: session.endedAt ?? null,
        queryCount: session.queryCount,
        changeCount: session.changeCount,
        correlationCount: session.correlationCount,
        activeFiles: JSON.stringify(session.activeFiles),
        activeEntities: JSON.stringify(session.activeEntities),
        activeDomains: JSON.stringify(session.activeDomains),
        triggeredReindexCount: session.triggeredReindexCount,
        entitiesReindexed: session.entitiesReindexed,
      });
    } catch (error) {
      logger.error({ error, sessionId: session.id }, "Failed to persist session");
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export async function createAdaptiveIndexer(
  db: GraphDatabase,
  ledger: IChangeLedger | null,
  config?: Partial<AdaptiveIndexerConfig>
): Promise<IAdaptiveIndexer> {
  const indexer = new MCPAdaptiveIndexer(db, ledger, {
    ...DEFAULT_ADAPTIVE_CONFIG,
    ...config,
  });
  await indexer.initialize();
  return indexer;
}

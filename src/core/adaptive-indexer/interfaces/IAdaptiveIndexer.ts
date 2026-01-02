/**
 * Adaptive Indexer Interface
 *
 * Black-box interface for MCP-driven adaptive indexing.
 * Observes queries and changes, correlates them semantically,
 * and triggers intelligent re-indexing.
 */

import type {
  ObservedQuery,
  ObservedChange,
  SemanticCorrelation,
  IndexingPriority,
  AdaptiveSession,
  AdaptiveReindexRequest,
  AdaptiveIndexerConfig,
} from "../models/indexing-context.js";

/**
 * Query observation input
 */
export interface QueryObservation {
  toolName: string;
  query: string;
  parameters?: Record<string, unknown>;
  sessionId: string;
  resultEntityIds: string[];
  resultFiles: string[];
  responseTimeMs: number;
  cacheHit?: boolean;
}

/**
 * Change observation input
 */
export interface ChangeObservation {
  changeType: "created" | "modified" | "deleted" | "renamed" | "moved";
  filePath: string;
  previousFilePath?: string;
  sessionId?: string;
  source: "filesystem" | "ai-generated" | "user-edit" | "refactor";
  entitiesAffected?: string[];
  linesAdded?: number;
  linesDeleted?: number;
}

/**
 * Reindex trigger callback
 */
export type ReindexTrigger = (request: AdaptiveReindexRequest) => Promise<void>;

/**
 * Adaptive Indexer Interface
 *
 * Observes MCP queries and code changes, correlates them,
 * and triggers adaptive re-indexing based on usage patterns.
 */
export interface IAdaptiveIndexer {
  /**
   * Initialize the adaptive indexer
   */
  initialize(): Promise<void>;

  /**
   * Set the callback for triggering reindexing
   */
  setReindexTrigger(trigger: ReindexTrigger): void;

  // =========================================================================
  // Session Management
  // =========================================================================

  /**
   * Start or get current session
   */
  getOrCreateSession(sessionId?: string): Promise<AdaptiveSession>;

  /**
   * Get active session
   */
  getActiveSession(): AdaptiveSession | null;

  /**
   * End current session
   */
  endSession(sessionId: string): Promise<void>;

  /**
   * Get session by ID
   */
  getSession(sessionId: string): Promise<AdaptiveSession | null>;

  /**
   * List recent sessions
   */
  listSessions(limit?: number): Promise<AdaptiveSession[]>;

  // =========================================================================
  // Query Observation
  // =========================================================================

  /**
   * Observe an MCP query
   */
  observeQuery(observation: QueryObservation): Promise<ObservedQuery>;

  /**
   * Get observed queries for session
   */
  getQueriesForSession(sessionId: string): Promise<ObservedQuery[]>;

  /**
   * Get recent queries
   */
  getRecentQueries(limit?: number): Promise<ObservedQuery[]>;

  /**
   * Get queries that accessed an entity
   */
  getQueriesForEntity(entityId: string): Promise<ObservedQuery[]>;

  /**
   * Get queries that accessed a file
   */
  getQueriesForFile(filePath: string): Promise<ObservedQuery[]>;

  // =========================================================================
  // Change Observation
  // =========================================================================

  /**
   * Observe a code change
   */
  observeChange(observation: ChangeObservation): Promise<ObservedChange>;

  /**
   * Get changes for session
   */
  getChangesForSession(sessionId: string): Promise<ObservedChange[]>;

  /**
   * Get recent changes
   */
  getRecentChanges(limit?: number): Promise<ObservedChange[]>;

  /**
   * Get changes for a file
   */
  getChangesForFile(filePath: string): Promise<ObservedChange[]>;

  // =========================================================================
  // Correlation
  // =========================================================================

  /**
   * Analyze and create correlations between queries and changes
   */
  analyzeCorrelations(sessionId?: string): Promise<SemanticCorrelation[]>;

  /**
   * Get correlations for a query
   */
  getCorrelationsForQuery(queryId: string): Promise<SemanticCorrelation[]>;

  /**
   * Get correlations for a change
   */
  getCorrelationsForChange(changeId: string): Promise<SemanticCorrelation[]>;

  /**
   * Get all correlations for session
   */
  getCorrelationsForSession(sessionId: string): Promise<SemanticCorrelation[]>;

  // =========================================================================
  // Priority Management
  // =========================================================================

  /**
   * Calculate indexing priority for an entity
   */
  calculatePriority(entityId: string): Promise<IndexingPriority>;

  /**
   * Get entities sorted by indexing priority
   */
  getPriorityQueue(limit?: number): Promise<IndexingPriority[]>;

  /**
   * Boost priority for entities (e.g., from user feedback)
   */
  boostPriority(entityIds: string[], boost: number, reason: string): Promise<void>;

  // =========================================================================
  // Reindexing
  // =========================================================================

  /**
   * Request reindexing (adds to queue)
   */
  requestReindex(
    entityIds: string[],
    reason: AdaptiveReindexRequest["reason"],
    priority?: AdaptiveReindexRequest["priority"]
  ): Promise<AdaptiveReindexRequest>;

  /**
   * Get pending reindex requests
   */
  getPendingRequests(): Promise<AdaptiveReindexRequest[]>;

  /**
   * Process pending reindex requests
   */
  processRequests(): Promise<number>;

  /**
   * Cancel a reindex request
   */
  cancelRequest(requestId: string): Promise<boolean>;

  /**
   * Get reindex history
   */
  getReindexHistory(limit?: number): Promise<AdaptiveReindexRequest[]>;

  // =========================================================================
  // Statistics
  // =========================================================================

  /**
   * Get adaptive indexer statistics
   */
  getStats(): Promise<AdaptiveIndexerStats>;

  /**
   * Get hot entities (frequently queried/modified)
   */
  getHotEntities(limit?: number): Promise<HotEntity[]>;

  /**
   * Get cold entities (rarely accessed, may be stale)
   */
  getColdEntities(limit?: number): Promise<ColdEntity[]>;

  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AdaptiveIndexerConfig>): void;

  /**
   * Get current configuration
   */
  getConfig(): AdaptiveIndexerConfig;

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Pause adaptive indexing
   */
  pause(): void;

  /**
   * Resume adaptive indexing
   */
  resume(): void;

  /**
   * Check if paused
   */
  isPaused(): boolean;

  /**
   * Shutdown and cleanup
   */
  shutdown(): Promise<void>;
}

/**
 * Adaptive indexer statistics
 */
export interface AdaptiveIndexerStats {
  totalQueries: number;
  totalChanges: number;
  totalCorrelations: number;
  totalReindexRequests: number;
  pendingRequests: number;
  completedRequests: number;
  failedRequests: number;
  averageCorrelationStrength: number;
  activeSessions: number;
  entitiesInPriorityQueue: number;
}

/**
 * Hot entity - frequently accessed
 */
export interface HotEntity {
  entityId: string;
  entityName: string;
  filePath: string;
  queryCount: number;
  modificationCount: number;
  lastQueried: string;
  lastModified?: string;
  heatScore: number;
}

/**
 * Cold entity - rarely accessed, potentially stale
 */
export interface ColdEntity {
  entityId: string;
  entityName: string;
  filePath: string;
  lastQueried?: string;
  lastModified?: string;
  lastIndexed: string;
  staleDays: number;
  coldScore: number;
}

/**
 * MCP Observer Interface
 *
 * Hooks into MCP server to observe queries and results.
 */
export interface IMCPObserver {
  /**
   * Called before a tool is executed
   */
  onToolCall(
    toolName: string,
    args: Record<string, unknown>,
    sessionId: string
  ): void;

  /**
   * Called after a tool returns results
   */
  onToolResult(
    toolName: string,
    args: Record<string, unknown>,
    result: unknown,
    sessionId: string,
    durationMs: number
  ): void;

  /**
   * Called when a resource is accessed
   */
  onResourceAccess(uri: string, sessionId: string): void;

  /**
   * Called when code is generated by AI
   */
  onCodeGenerated(
    filePath: string,
    content: string,
    sessionId: string,
    context?: string
  ): void;
}

/**
 * Factory function type
 */
export type AdaptiveIndexerFactory = (
  config?: Partial<AdaptiveIndexerConfig>
) => Promise<IAdaptiveIndexer>;

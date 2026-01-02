/**
 * Adaptive Indexing Context Models
 *
 * Defines data structures for MCP-driven adaptive indexing.
 * Tracks queries, results, changes, and semantic correlations.
 */

import { z } from "zod";

// =============================================================================
// Query Observation
// =============================================================================

/**
 * Observed MCP query
 */
export const ObservedQuerySchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  sessionId: z.string(),

  // Query details
  toolName: z.string(),
  query: z.string(),
  parameters: z.record(z.string(), z.unknown()).default({}),

  // Results
  resultCount: z.number(),
  returnedEntityIds: z.array(z.string()).default([]),
  returnedFiles: z.array(z.string()).default([]),

  // Performance
  responseTimeMs: z.number(),
  cacheHit: z.boolean().default(false),

  // Intent analysis
  inferredIntent: z.string().optional(),
  intentConfidence: z.number().optional(),
  relatedDomains: z.array(z.string()).default([]),
});

export type ObservedQuery = z.infer<typeof ObservedQuerySchema>;

// =============================================================================
// Code Change Observation
// =============================================================================

/**
 * Types of code changes
 */
export const ChangeTypeSchema = z.enum([
  "created",
  "modified",
  "deleted",
  "renamed",
  "moved",
]);

export type ChangeType = z.infer<typeof ChangeTypeSchema>;

/**
 * Observed code change
 */
export const ObservedChangeSchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  sessionId: z.string().optional(),

  // Change details
  changeType: ChangeTypeSchema,
  filePath: z.string(),
  previousFilePath: z.string().optional(), // For renames/moves

  // Entity changes
  entitiesAdded: z.array(z.string()).default([]),
  entitiesModified: z.array(z.string()).default([]),
  entitiesDeleted: z.array(z.string()).default([]),

  // Change magnitude
  linesAdded: z.number().default(0),
  linesDeleted: z.number().default(0),
  significanceScore: z.number().min(0).max(1).default(0.5),

  // Source
  source: z.enum(["filesystem", "ai-generated", "user-edit", "refactor"]),
  aiGeneratedBy: z.string().optional(),

  // Correlation
  triggeredByQueryId: z.string().optional(),
  relatedQueryIds: z.array(z.string()).default([]),
});

export type ObservedChange = z.infer<typeof ObservedChangeSchema>;

// =============================================================================
// Semantic Correlation
// =============================================================================

/**
 * Correlation between query and subsequent changes
 */
export const SemanticCorrelationSchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),

  // Linked events
  queryId: z.string(),
  changeIds: z.array(z.string()),

  // Correlation analysis
  correlationType: z.enum([
    "query-then-edit", // User queried, then edited returned results
    "query-then-create", // User queried, then created related code
    "query-then-delete", // User queried, then deleted code
    "iterative-refinement", // Multiple queries refining same area
    "exploration", // Queries exploring related areas
  ]),

  // Strength
  correlationStrength: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),

  // Semantic analysis
  sharedConcepts: z.array(z.string()).default([]),
  sharedEntities: z.array(z.string()).default([]),
  sharedFiles: z.array(z.string()).default([]),

  // Impact on indexing
  suggestedReindexing: z.array(z.string()).default([]),
  priorityBoost: z.number().default(0),
});

export type SemanticCorrelation = z.infer<typeof SemanticCorrelationSchema>;

// =============================================================================
// Indexing Priority
// =============================================================================

/**
 * Priority for re-indexing entities
 */
export const IndexingPrioritySchema = z.object({
  entityId: z.string(),
  filePath: z.string(),

  // Priority score (higher = more urgent)
  priorityScore: z.number().min(0).max(100),

  // Factors contributing to priority
  factors: z.array(
    z.object({
      factor: z.string(),
      weight: z.number(),
      value: z.number(),
    })
  ),

  // Timing
  lastIndexed: z.string().datetime().optional(),
  lastQueried: z.string().datetime().optional(),
  lastModified: z.string().datetime().optional(),

  // Stats
  queryCount: z.number().default(0),
  modificationCount: z.number().default(0),
  correlationCount: z.number().default(0),
});

export type IndexingPriority = z.infer<typeof IndexingPrioritySchema>;

// =============================================================================
// Adaptive Indexing Session
// =============================================================================

/**
 * Represents an active coding session
 */
export const AdaptiveSessionSchema = z.object({
  id: z.string(),
  startedAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),

  // Activity tracking
  queryCount: z.number().default(0),
  changeCount: z.number().default(0),
  correlationCount: z.number().default(0),

  // Focus areas
  activeFiles: z.array(z.string()).default([]),
  activeEntities: z.array(z.string()).default([]),
  activeDomains: z.array(z.string()).default([]),

  // Indexing stats
  triggeredReindexCount: z.number().default(0),
  entitiesReindexed: z.number().default(0),
});

export type AdaptiveSession = z.infer<typeof AdaptiveSessionSchema>;

// =============================================================================
// Reindexing Request
// =============================================================================

/**
 * Request to reindex entities based on adaptive analysis
 */
export const AdaptiveReindexRequestSchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  sessionId: z.string().optional(),

  // What to reindex
  entityIds: z.array(z.string()),
  filePaths: z.array(z.string()),

  // Why
  reason: z.enum([
    "query-correlation",
    "change-cascade",
    "semantic-drift",
    "stale-classification",
    "dependency-update",
    "user-feedback",
    "scheduled",
  ]),
  triggerEventId: z.string().optional(),

  // Priority
  priority: z.enum(["immediate", "high", "normal", "low"]),
  priorityScore: z.number(),

  // Scope
  reindexScope: z.enum([
    "entity-only", // Just the specific entities
    "file", // Entire file
    "related", // Entity + directly related entities
    "cascade", // Entity + all dependents
  ]),

  // Status
  status: z.enum(["pending", "processing", "completed", "failed"]),
  completedAt: z.string().datetime().optional(),
  error: z.string().optional(),
});

export type AdaptiveReindexRequest = z.infer<typeof AdaptiveReindexRequestSchema>;

// =============================================================================
// Observer Configuration
// =============================================================================

export interface AdaptiveIndexerConfig {
  /** Enable query observation */
  observeQueries: boolean;
  /** Enable change observation */
  observeChanges: boolean;
  /** Enable semantic correlation */
  enableCorrelation: boolean;
  /** Time window for correlation (ms) */
  correlationWindowMs: number;
  /** Minimum correlation strength to trigger reindex */
  minCorrelationStrength: number;
  /** Maximum pending reindex requests */
  maxPendingRequests: number;
  /** Batch size for reindexing */
  reindexBatchSize: number;
  /** Debounce delay for reindexing (ms) */
  reindexDebounceMs: number;
  /** Session timeout (ms) */
  sessionTimeoutMs: number;
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveIndexerConfig = {
  observeQueries: true,
  observeChanges: true,
  enableCorrelation: true,
  correlationWindowMs: 60000, // 1 minute
  minCorrelationStrength: 0.5,
  maxPendingRequests: 100,
  reindexBatchSize: 10,
  reindexDebounceMs: 2000,
  sessionTimeoutMs: 1800000, // 30 minutes
};

// =============================================================================
// Factory Functions
// =============================================================================

export function createObservedQuery(
  toolName: string,
  query: string,
  sessionId: string,
  results: { entityIds: string[]; files: string[] },
  responseTimeMs: number
): ObservedQuery {
  return {
    id: `query_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    sessionId,
    toolName,
    query,
    parameters: {},
    resultCount: results.entityIds.length,
    returnedEntityIds: results.entityIds,
    returnedFiles: results.files,
    responseTimeMs,
    cacheHit: false,
    relatedDomains: [],
  };
}

export function createObservedChange(
  changeType: ChangeType,
  filePath: string,
  sessionId?: string
): ObservedChange {
  return {
    id: `change_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    sessionId,
    changeType,
    filePath,
    entitiesAdded: [],
    entitiesModified: [],
    entitiesDeleted: [],
    linesAdded: 0,
    linesDeleted: 0,
    significanceScore: 0.5,
    source: "filesystem",
    relatedQueryIds: [],
  };
}

export function createSemanticCorrelation(
  queryId: string,
  changeIds: string[],
  correlationType: SemanticCorrelation["correlationType"],
  strength: number
): SemanticCorrelation {
  return {
    id: `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    queryId,
    changeIds,
    correlationType,
    correlationStrength: strength,
    confidence: strength,
    sharedConcepts: [],
    sharedEntities: [],
    sharedFiles: [],
    suggestedReindexing: [],
    priorityBoost: 0,
  };
}

export function createAdaptiveReindexRequest(
  entityIds: string[],
  filePaths: string[],
  reason: AdaptiveReindexRequest["reason"],
  priority: AdaptiveReindexRequest["priority"]
): AdaptiveReindexRequest {
  return {
    id: `reindex_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    entityIds,
    filePaths,
    reason,
    priority,
    priorityScore: priority === "immediate" ? 100 : priority === "high" ? 75 : priority === "normal" ? 50 : 25,
    reindexScope: "entity-only",
    status: "pending",
  };
}

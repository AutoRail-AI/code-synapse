/**
 * Change Ledger Event Models
 *
 * Defines the data structures for the append-only change ledger.
 * Every meaningful system event is logged for observability and debugging.
 */

import { z } from "zod";

// =============================================================================
// Event Types
// =============================================================================

/**
 * All possible event types in the system
 */
export const LedgerEventTypeSchema = z.enum([
  // MCP Events
  "mcp:query:received",
  "mcp:query:completed",
  "mcp:tool:called",
  "mcp:resource:accessed",

  // Indexing Events
  "index:scan:started",
  "index:scan:completed",
  "index:file:added",
  "index:file:modified",
  "index:file:deleted",
  "index:entity:extracted",
  "index:batch:completed",

  // Classification Events
  "classify:started",
  "classify:completed",
  "classify:domain:detected",
  "classify:infrastructure:detected",
  "classify:updated",
  "classify:confirmed",

  // Justification Events
  "justify:started",
  "justify:completed",
  "justify:clarification:requested",
  "justify:clarification:received",

  // Adaptive Indexing Events
  "adaptive:query:observed",
  "adaptive:result:observed",
  "adaptive:change:detected",
  "adaptive:reindex:triggered",
  "adaptive:semantic:correlation",

  // Graph Events
  "graph:write:started",
  "graph:write:completed",
  "graph:node:created",
  "graph:node:updated",
  "graph:node:deleted",
  "graph:edge:created",
  "graph:edge:deleted",

  // User Events
  "user:feedback:received",
  "user:confirmation:received",
  "user:correction:received",

  // System Events
  "system:startup",
  "system:shutdown",
  "system:error",
  "system:warning",
]);

export type LedgerEventType = z.infer<typeof LedgerEventTypeSchema>;

/**
 * Event source - where the event originated
 */
export const EventSourceSchema = z.enum([
  "filesystem",
  "mcp-query",
  "mcp-result-processor",
  "adaptive-indexer",
  "classification-engine",
  "justification-engine",
  "graph-writer",
  "user-interface",
  "system",
]);

export type EventSource = z.infer<typeof EventSourceSchema>;

// =============================================================================
// Classification Change Tracking
// =============================================================================

export const ClassificationChangeSchema = z.object({
  entityId: z.string(),
  entityName: z.string(),
  previousCategory: z.enum(["vertical", "horizontal", "unknown"]).optional(),
  newCategory: z.enum(["vertical", "horizontal", "unknown"]),
  previousDomain: z.string().optional(),
  newDomain: z.string().optional(),
  previousLayer: z.string().optional(),
  newLayer: z.string().optional(),
  previousConfidence: z.number().optional(),
  newConfidence: z.number(),
  reason: z.string(),
});

export type ClassificationChange = z.infer<typeof ClassificationChangeSchema>;

// =============================================================================
// Confidence Adjustment Tracking
// =============================================================================

export const ConfidenceAdjustmentSchema = z.object({
  entityId: z.string(),
  entityName: z.string(),
  previousConfidence: z.number(),
  newConfidence: z.number(),
  adjustmentReason: z.enum([
    "user-confirmation",
    "user-correction",
    "pattern-match",
    "semantic-analysis",
    "dependency-analysis",
    "usage-pattern",
    "decay",
  ]),
  details: z.string().optional(),
});

export type ConfidenceAdjustment = z.infer<typeof ConfidenceAdjustmentSchema>;

// =============================================================================
// User Interaction Tracking
// =============================================================================

export const UserInteractionSchema = z.object({
  askedUser: z.boolean().default(false),
  questionType: z.enum(["clarification", "confirmation", "correction"]).optional(),
  question: z.string().optional(),
  response: z.string().optional(),
  responseAt: z.string().datetime().optional(),
  accepted: z.boolean().optional(),
});

export type UserInteraction = z.infer<typeof UserInteractionSchema>;

// =============================================================================
// Graph Diff Summary
// =============================================================================

export const GraphDiffSummarySchema = z.object({
  nodesCreated: z.number().default(0),
  nodesUpdated: z.number().default(0),
  nodesDeleted: z.number().default(0),
  edgesCreated: z.number().default(0),
  edgesDeleted: z.number().default(0),
  affectedRelations: z.array(z.string()).default([]),
});

export type GraphDiffSummary = z.infer<typeof GraphDiffSummarySchema>;

// =============================================================================
// MCP Context
// =============================================================================

export const MCPContextSchema = z.object({
  toolName: z.string().optional(),
  query: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  resultCount: z.number().optional(),
  responseTimeMs: z.number().optional(),
  cacheHit: z.boolean().optional(),
});

export type MCPContext = z.infer<typeof MCPContextSchema>;

// =============================================================================
// Main Ledger Entry Schema
// =============================================================================

export const LedgerEntrySchema = z.object({
  // Identity
  id: z.string(),
  timestamp: z.string().datetime(),
  sequence: z.number(), // Monotonic sequence for ordering

  // Event classification
  eventType: LedgerEventTypeSchema,
  source: EventSourceSchema,

  // Impact tracking
  impactedFiles: z.array(z.string()).default([]),
  impactedEntities: z.array(z.string()).default([]),

  // Classification tracking
  domainsInvolved: z.array(z.string()).default([]),
  infrastructureInvolved: z.array(z.string()).default([]),
  classificationChanges: z.array(ClassificationChangeSchema).default([]),

  // Graph changes
  indexGraphDiffSummary: GraphDiffSummarySchema.optional(),

  // Confidence tracking
  confidenceAdjustments: z.array(ConfidenceAdjustmentSchema).default([]),

  // User interaction
  userInteraction: UserInteractionSchema.optional(),

  // MCP context (for MCP-related events)
  mcpContext: MCPContextSchema.optional(),

  // Additional context
  metadata: z.record(z.string(), z.unknown()).default({}),

  // Human-readable summary
  summary: z.string(),
  details: z.string().optional(),

  // Error tracking
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  stackTrace: z.string().optional(),

  // Correlation
  correlationId: z.string().optional(), // Links related events
  parentEventId: z.string().optional(), // For hierarchical events
  sessionId: z.string().optional(), // Current MCP session
});

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

// =============================================================================
// Query Types
// =============================================================================

export const LedgerQuerySchema = z.object({
  // Time range
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),

  // Event filtering
  eventTypes: z.array(LedgerEventTypeSchema).optional(),
  sources: z.array(EventSourceSchema).optional(),

  // Entity filtering
  entityIds: z.array(z.string()).optional(),
  filePaths: z.array(z.string()).optional(),

  // Classification filtering
  includeVerticals: z.boolean().optional(),
  includeHorizontals: z.boolean().optional(),
  domains: z.array(z.string()).optional(),
  layers: z.array(z.string()).optional(),

  // Correlation
  correlationId: z.string().optional(),
  sessionId: z.string().optional(),

  // Text search
  searchText: z.string().optional(),

  // Pagination
  limit: z.number().optional(),
  offset: z.number().optional(),
  orderDirection: z.enum(["asc", "desc"]).optional(),
});

/**
 * Query parameters for ledger entries
 * All fields are optional - defaults are applied at query time
 */
export type LedgerQuery = z.infer<typeof LedgerQuerySchema>;

// =============================================================================
// Aggregation Types
// =============================================================================

export interface LedgerAggregation {
  totalEvents: number;
  byEventType: Record<string, number>;
  bySource: Record<string, number>;
  byHour: { hour: string; count: number }[];
  topImpactedFiles: { file: string; count: number }[];
  topImpactedEntities: { entity: string; count: number }[];
  classificationChanges: number;
  errorCount: number;
  averageResponseTimeMs: number;
}

export interface TimelineEntry {
  id: string;
  timestamp: string;
  eventType: LedgerEventType;
  source: EventSource;
  summary: string;
  impactLevel: "low" | "medium" | "high";
  hasClassificationChange: boolean;
  hasUserInteraction: boolean;
  hasError: boolean;
}

// =============================================================================
// Factory Functions
// =============================================================================

let sequenceCounter = 0;

export function createLedgerEntry(
  eventType: LedgerEventType,
  source: EventSource,
  summary: string,
  options?: Partial<Omit<LedgerEntry, "id" | "timestamp" | "sequence" | "eventType" | "source" | "summary">>
): LedgerEntry {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    sequence: ++sequenceCounter,
    eventType,
    source,
    summary,
    impactedFiles: options?.impactedFiles ?? [],
    impactedEntities: options?.impactedEntities ?? [],
    domainsInvolved: options?.domainsInvolved ?? [],
    infrastructureInvolved: options?.infrastructureInvolved ?? [],
    classificationChanges: options?.classificationChanges ?? [],
    indexGraphDiffSummary: options?.indexGraphDiffSummary,
    confidenceAdjustments: options?.confidenceAdjustments ?? [],
    userInteraction: options?.userInteraction,
    mcpContext: options?.mcpContext,
    metadata: options?.metadata ?? {},
    details: options?.details,
    errorCode: options?.errorCode,
    errorMessage: options?.errorMessage,
    stackTrace: options?.stackTrace,
    correlationId: options?.correlationId,
    parentEventId: options?.parentEventId,
    sessionId: options?.sessionId,
  };
}

// Convenience factory functions for common events

export function createMCPQueryEvent(
  toolName: string,
  query: string,
  sessionId?: string
): LedgerEntry {
  return createLedgerEntry("mcp:query:received", "mcp-query", `MCP query received: ${toolName}`, {
    mcpContext: { toolName, query },
    sessionId,
  });
}

export function createIndexingEvent(
  eventType: Extract<LedgerEventType, `index:${string}`>,
  files: string[],
  summary: string
): LedgerEntry {
  return createLedgerEntry(eventType, "filesystem", summary, {
    impactedFiles: files,
  });
}

export function createClassificationEvent(
  entityId: string,
  entityName: string,
  category: "domain" | "infrastructure",
  areaOrLayer: string,
  confidence: number
): LedgerEntry {
  const eventType = category === "domain" ? "classify:domain:detected" : "classify:infrastructure:detected";
  return createLedgerEntry(
    eventType,
    "classification-engine",
    `Classified ${entityName} as ${category}: ${areaOrLayer}`,
    {
      impactedEntities: [entityId],
      domainsInvolved: category === "domain" ? [areaOrLayer] : [],
      infrastructureInvolved: category === "infrastructure" ? [areaOrLayer] : [],
      metadata: { confidence },
    }
  );
}

export function createAdaptiveIndexingEvent(
  eventType: Extract<LedgerEventType, `adaptive:${string}`>,
  summary: string,
  entities: string[],
  correlationId?: string
): LedgerEntry {
  return createLedgerEntry(eventType, "adaptive-indexer", summary, {
    impactedEntities: entities,
    correlationId,
  });
}

export function createErrorEvent(
  source: EventSource,
  errorMessage: string,
  errorCode?: string,
  stackTrace?: string
): LedgerEntry {
  return createLedgerEntry("system:error", source, `Error: ${errorMessage}`, {
    errorCode,
    errorMessage,
    stackTrace,
  });
}

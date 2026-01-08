/**
 * Compacted Ledger Entry Models
 *
 * Represents consolidated, human-meaningful summaries of coding sessions.
 * Groups multiple raw ledger events into semantic units.
 */

import { z } from "zod";
import type { MemoryRuleRef } from "../../memory/models/memory-models.js";

// =============================================================================
// MCP Query Trace
// =============================================================================

export const MCPQueryTraceSchema = z.object({
  toolName: z.string(),
  query: z.string(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  resultCount: z.number(),
  responseTimeMs: z.number(),
  timestamp: z.string().datetime(),
  entityIdsReturned: z.array(z.string()).default([]),
  filesReturned: z.array(z.string()).default([]),
});

export type MCPQueryTrace = z.infer<typeof MCPQueryTraceSchema>;

// =============================================================================
// Semantic Impact Classification
// =============================================================================

export const SemanticImpactSchema = z.object({
  // Business domains affected
  verticals: z.array(z.string()).default([]),

  // Infrastructure layers affected
  horizontals: z
    .array(
      z.object({
        name: z.string(),
        library: z.string().optional(),
        version: z.string().optional(),
      })
    )
    .default([]),

  // Architectural impact
  servicesAffected: z.array(z.string()).default([]),
  apisAffected: z.array(z.string()).default([]),
  patternsUsed: z.array(z.string()).default([]),
});

export type SemanticImpact = z.infer<typeof SemanticImpactSchema>;

// =============================================================================
// Code Access Summary
// =============================================================================

export const CodeAccessSummarySchema = z.object({
  files: z.array(z.string()),
  entities: z.array(z.string()),
  uniqueFilesCount: z.number(),
  uniqueEntitiesCount: z.number(),
});

export type CodeAccessSummary = z.infer<typeof CodeAccessSummarySchema>;

// =============================================================================
// Code Changes Summary
// =============================================================================

export const CodeChangesSummarySchema = z.object({
  filesModified: z.array(z.string()).default([]),
  filesCreated: z.array(z.string()).default([]),
  filesDeleted: z.array(z.string()).default([]),
  functionsChanged: z.array(z.string()).default([]),
  classesChanged: z.array(z.string()).default([]),
  interfacesChanged: z.array(z.string()).default([]),
  totalLinesAdded: z.number().default(0),
  totalLinesDeleted: z.number().default(0),
});

export type CodeChangesSummary = z.infer<typeof CodeChangesSummarySchema>;

// =============================================================================
// Index Updates Summary
// =============================================================================

export const IndexUpdatesSummarySchema = z.object({
  entitiesAdded: z.number().default(0),
  entitiesUpdated: z.number().default(0),
  entitiesRemoved: z.number().default(0),
  relationshipsAdded: z.number().default(0),
  relationshipsRemoved: z.number().default(0),
  embeddingsGenerated: z.number().default(0),
});

export type IndexUpdatesSummary = z.infer<typeof IndexUpdatesSummarySchema>;

// =============================================================================
// Compacted Ledger Entry Schema
// =============================================================================

export const CompactedLedgerEntrySchema = z.object({
  // Identity
  id: z.string(),
  sessionId: z.string(),
  timestampStart: z.string().datetime(),
  timestampEnd: z.string().datetime(),

  // Source system
  source: z.enum(["claude-code", "cursor", "windsurf", "filesystem", "reconciliation", "manual"]),

  // Intent and context
  intentSummary: z.string(), // Human-readable summary of what was accomplished
  intentCategory: z
    .enum([
      "feature-development",
      "bug-fix",
      "refactoring",
      "testing",
      "documentation",
      "configuration",
      "exploration",
      "debugging",
      "unknown",
    ])
    .default("unknown"),
  userPrompts: z.array(z.string()).default([]), // Original user prompts

  // MCP activity
  mcpQueries: z.array(MCPQueryTraceSchema).default([]),
  totalMcpQueries: z.number().default(0),
  uniqueToolsUsed: z.array(z.string()).default([]),

  // Code interaction
  codeAccessed: CodeAccessSummarySchema,
  codeChanges: CodeChangesSummarySchema,

  // Semantic classification
  semanticImpact: SemanticImpactSchema,

  // Index changes
  indexUpdates: IndexUpdatesSummarySchema,

  // Memory system
  memoryUpdates: z.array(
    z.object({
      ruleId: z.string(),
      action: z.enum(["created", "updated", "validated", "violated", "deprecated"]),
      confidenceDelta: z.number().optional(),
      details: z.string().optional(),
    })
  ).default([]),
  memoryRulesApplied: z.array(z.string()).default([]), // Rules used in this session

  // Raw event references
  rawEventIds: z.array(z.string()).default([]), // Links to original ledger entries
  rawEventCount: z.number().default(0),

  // Quality metrics
  confidenceScore: z.number().min(0).max(1), // How confident we are in this summary
  completeness: z.number().min(0).max(1), // How complete the information is

  // Correlation
  correlatedSessions: z.array(z.string()).default([]), // Related sessions
  gitCommitSha: z.string().optional(), // Associated git commit
  gitBranch: z.string().optional(),

  // Merkle tree hash for integrity
  contentHash: z.string().optional(),
});

export type CompactedLedgerEntry = z.infer<typeof CompactedLedgerEntrySchema>;

// =============================================================================
// Compaction Configuration
// =============================================================================

export interface CompactionConfig {
  // Session-based compaction
  sessionTimeoutMs: number; // Max time gap before new session (default: 30 min)
  maxSessionDurationMs: number; // Max session length (default: 4 hours)
  minEventsForCompaction: number; // Min events to create compacted entry (default: 3)

  // Intent similarity
  intentSimilarityThreshold: number; // Cosine similarity threshold (default: 0.7)

  // Retention
  retainRawEventsMs: number; // How long to keep raw events (default: 7 days)
  maxRawEventsPerCompaction: number; // Max raw events to reference (default: 1000)

  // Performance
  compactionBatchSize: number; // Events to process per batch (default: 100)
  compactionIntervalMs: number; // How often to run compaction (default: 5 min)
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
  maxSessionDurationMs: 4 * 60 * 60 * 1000, // 4 hours
  minEventsForCompaction: 3,
  intentSimilarityThreshold: 0.7,
  retainRawEventsMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxRawEventsPerCompaction: 1000,
  compactionBatchSize: 100,
  compactionIntervalMs: 5 * 60 * 1000, // 5 minutes
};

// =============================================================================
// Compaction Query Types
// =============================================================================

export interface CompactedEntryQuery {
  sessionId?: string;
  source?: CompactedLedgerEntry["source"];
  intentCategory?: CompactedLedgerEntry["intentCategory"];
  startTime?: string;
  endTime?: string;
  verticals?: string[];
  horizontals?: string[];
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createCompactedEntry(
  sessionId: string,
  source: CompactedLedgerEntry["source"],
  intentSummary: string,
  timestampStart: string,
  timestampEnd: string,
  options?: Partial<
    Omit<CompactedLedgerEntry, "id" | "sessionId" | "source" | "intentSummary" | "timestampStart" | "timestampEnd">
  >
): CompactedLedgerEntry {
  return {
    id: `compact_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    sessionId,
    source,
    intentSummary,
    timestampStart,
    timestampEnd,
    intentCategory: options?.intentCategory ?? "unknown",
    userPrompts: options?.userPrompts ?? [],
    mcpQueries: options?.mcpQueries ?? [],
    totalMcpQueries: options?.totalMcpQueries ?? options?.mcpQueries?.length ?? 0,
    uniqueToolsUsed: options?.uniqueToolsUsed ?? [],
    codeAccessed: options?.codeAccessed ?? {
      files: [],
      entities: [],
      uniqueFilesCount: 0,
      uniqueEntitiesCount: 0,
    },
    codeChanges: options?.codeChanges ?? {
      filesModified: [],
      filesCreated: [],
      filesDeleted: [],
      functionsChanged: [],
      classesChanged: [],
      interfacesChanged: [],
      totalLinesAdded: 0,
      totalLinesDeleted: 0,
    },
    semanticImpact: options?.semanticImpact ?? {
      verticals: [],
      horizontals: [],
      servicesAffected: [],
      apisAffected: [],
      patternsUsed: [],
    },
    indexUpdates: options?.indexUpdates ?? {
      entitiesAdded: 0,
      entitiesUpdated: 0,
      entitiesRemoved: 0,
      relationshipsAdded: 0,
      relationshipsRemoved: 0,
      embeddingsGenerated: 0,
    },
    memoryUpdates: options?.memoryUpdates ?? [],
    memoryRulesApplied: options?.memoryRulesApplied ?? [],
    rawEventIds: options?.rawEventIds ?? [],
    rawEventCount: options?.rawEventCount ?? 0,
    confidenceScore: options?.confidenceScore ?? 0.5,
    completeness: options?.completeness ?? 0.5,
    correlatedSessions: options?.correlatedSessions ?? [],
    gitCommitSha: options?.gitCommitSha,
    gitBranch: options?.gitBranch,
    contentHash: options?.contentHash,
  };
}

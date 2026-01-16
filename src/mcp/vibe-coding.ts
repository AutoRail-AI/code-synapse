/**
 * Vibe Coding Module
 *
 * Provides context-aware coding assistance by enriching prompts with
 * business justifications, relationships, and codebase conventions.
 *
 * Every prompt is enriched, every change is tracked, and the full
 * context is preserved in the ledger for observability.
 */

import type { IGraphStore } from "../core/interfaces/IGraphStore.js";
import type { IJustificationService } from "../core/justification/interfaces/IJustificationService.js";
import type { IChangeLedger } from "../core/ledger/interfaces/IChangeLedger.js";
import type { EntityJustification } from "../core/justification/models/justification.js";
import { createLedgerEntry } from "../core/ledger/models/ledger-events.js";
import { createLogger } from "../core/telemetry/logger.js";

const logger = createLogger("vibe-coding");

// =============================================================================
// Types
// =============================================================================

/**
 * Vibe coding session - tracks a coding task from start to finish
 */
export interface VibeSession {
  id: string;
  startedAt: string;
  intent: string;
  targetFiles: string[];
  relatedConcepts: string[];
  enrichedContext: VibeContext | null;
  changes: VibeChange[];
  status: "active" | "completed" | "abandoned";
}

/**
 * A change made during a vibe coding session
 */
export interface VibeChange {
  filePath: string;
  changeType: "created" | "modified" | "deleted" | "renamed";
  description: string;
  timestamp: string;
  entitiesAffected: string[];
}

/**
 * Enriched context provided to the LLM
 */
export interface VibeContext {
  originalIntent: string;
  enrichedPrompt: string;
  relevantCode: RelevantCodeItem[];
  patterns: CodePattern[];
  conventions: CodebaseConventions;
  architectureNotes: string[];
}

/**
 * A relevant code item with full business context
 */
export interface RelevantCodeItem {
  entity: {
    id: string;
    name: string;
    type: "function" | "class" | "interface" | "file";
    filePath: string;
    code: string;
    startLine: number;
    endLine: number;
  };
  justification: {
    purposeSummary: string;
    businessValue: string;
    featureContext: string;
    confidence: number;
  } | null;
  relationships: {
    callers: Array<{ name: string; filePath: string }>;
    callees: Array<{ name: string; filePath: string }>;
    dependencies: string[];
  };
  relevanceScore: number;
  relevanceReason: string;
}

/**
 * A detected code pattern in the codebase
 */
export interface CodePattern {
  pattern: string;
  description: string;
  examples: Array<{ name: string; filePath: string }>;
}

/**
 * Codebase conventions detected from existing code
 */
export interface CodebaseConventions {
  namingPatterns: {
    functions: string;
    classes: string;
    interfaces: string;
    files: string;
  };
  fileOrganization: string;
  errorHandling: string;
  importStyle: string;
  typeUsage: string;
}

// =============================================================================
// Session Management
// =============================================================================

// In-memory session store (could be persisted later)
const activeSessions = new Map<string, VibeSession>();

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `vibe_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Get or create a session
 */
export function getSession(sessionId: string): VibeSession | null {
  const session = activeSessions.get(sessionId);
  return session !== undefined ? session : null;
}

/**
 * Create a new vibe session
 */
export function createSession(intent: string, targetFiles: string[] = [], relatedConcepts: string[] = []): VibeSession {
  const session: VibeSession = {
    id: generateSessionId(),
    startedAt: new Date().toISOString(),
    intent,
    targetFiles,
    relatedConcepts,
    enrichedContext: null,
    changes: [],
    status: "active",
  };
  activeSessions.set(session.id, session);
  logger.info({ sessionId: session.id, intent }, "Vibe session created");
  return session;
}

/**
 * Complete a session
 */
export function completeSession(sessionId: string): VibeSession | null {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.status = "completed";
    logger.info({ sessionId, changes: session.changes.length }, "Vibe session completed");
    return session;
  }
  return null;
}

// =============================================================================
// Context Building
// =============================================================================

/**
 * Extract concepts/keywords from a prompt
 */
export function extractConcepts(prompt: string): string[] {
  const concepts: string[] = [];

  // Extract potential function/class names (CamelCase or snake_case)
  const identifiers = prompt.match(/\b[A-Z][a-zA-Z0-9]*\b|\b[a-z][a-zA-Z0-9]*(?:_[a-z][a-zA-Z0-9]*)+\b/g) || [];
  concepts.push(...identifiers);

  // Extract quoted strings
  const quoted = prompt.match(/"([^"]+)"|'([^']+)'/g) || [];
  concepts.push(...quoted.map(q => q.replace(/["']/g, "")));

  // Extract technical keywords
  const techKeywords = [
    "function", "class", "interface", "type", "component", "service",
    "controller", "handler", "middleware", "validator", "parser",
    "api", "endpoint", "route", "model", "schema", "database",
    "auth", "authentication", "authorization", "permission",
    "cache", "queue", "event", "message", "notification",
    "test", "mock", "stub", "fixture",
  ];

  const words = prompt.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (techKeywords.includes(word)) {
      concepts.push(word);
    }
  }

  // Deduplicate
  return [...new Set(concepts)];
}

/**
 * Find relevant entities based on concepts
 */
export async function findRelevantEntities(
  graphStore: IGraphStore,
  concepts: string[],
  targetFile?: string,
  limit: number = 10
): Promise<Array<{ id: string; name: string; type: string; filePath: string; relevanceScore: number; relevanceReason: string }>> {
  const results: Array<{ id: string; name: string; type: string; filePath: string; relevanceScore: number; relevanceReason: string }> = [];

  // Search for each concept
  for (const concept of concepts.slice(0, 5)) { // Limit to top 5 concepts
    try {
      // Search functions
      const functions = await graphStore.query<{
        id: string;
        name: string;
        file_path: string;
      }>(`
        ?[id, name, file_path] :=
          *function{id, name, file_id},
          *file{id: file_id, relative_path: file_path},
          contains(lowercase(name), lowercase($concept))
        :limit 5
      `, { concept });

      for (const fn of functions.rows) {
        results.push({
          id: fn.id,
          name: fn.name,
          type: "function",
          filePath: fn.file_path,
          relevanceScore: 0.8,
          relevanceReason: `Name contains "${concept}"`,
        });
      }

      // Search classes
      const classes = await graphStore.query<{
        id: string;
        name: string;
        file_path: string;
      }>(`
        ?[id, name, file_path] :=
          *class{id, name, file_id},
          *file{id: file_id, relative_path: file_path},
          contains(lowercase(name), lowercase($concept))
        :limit 5
      `, { concept });

      for (const cls of classes.rows) {
        results.push({
          id: cls.id,
          name: cls.name,
          type: "class",
          filePath: cls.file_path,
          relevanceScore: 0.8,
          relevanceReason: `Name contains "${concept}"`,
        });
      }

      // Search interfaces
      const interfaces = await graphStore.query<{
        id: string;
        name: string;
        file_path: string;
      }>(`
        ?[id, name, file_path] :=
          *interface{id, name, file_id},
          *file{id: file_id, relative_path: file_path},
          contains(lowercase(name), lowercase($concept))
        :limit 5
      `, { concept });

      for (const iface of interfaces.rows) {
        results.push({
          id: iface.id,
          name: iface.name,
          type: "interface",
          filePath: iface.file_path,
          relevanceScore: 0.8,
          relevanceReason: `Name contains "${concept}"`,
        });
      }
    } catch (error) {
      logger.debug({ concept, error }, "Error searching for concept");
    }
  }

  // If target file specified, boost entities from that file
  if (targetFile) {
    for (const result of results) {
      if (result.filePath === targetFile || result.filePath.endsWith(targetFile)) {
        result.relevanceScore += 0.2;
        result.relevanceReason += " (target file)";
      }
    }
  }

  // Sort by relevance and deduplicate
  const seen = new Set<string>();
  const deduplicated = results
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .slice(0, limit);

  return deduplicated;
}

type EntityType = "function" | "class" | "interface" | "file";

/**
 * Get full entity details with code snippet
 */
export async function getEntityWithCode(
  graphStore: IGraphStore,
  entityId: string,
  entityType: string
): Promise<{ id: string; name: string; type: EntityType; filePath: string; code: string; startLine: number; endLine: number } | null> {
  try {
    const table = entityType === "function" || entityType === "method" ? "function" : entityType;
    const normalizedType = (entityType === "method" ? "function" : entityType) as EntityType;

    const result = await graphStore.query<{
      id: string;
      name: string;
      file_path: string;
      start_line: number;
      end_line: number;
      source_code: string | null;
    }>(`
      ?[id, name, file_path, start_line, end_line, source_code] :=
        *${table}{id, name, file_id, start_line, end_line, source_code},
        *file{id: file_id, relative_path: file_path},
        id = $entityId
    `, { entityId });

    if (result.rows.length === 0) return null;

    const row = result.rows[0]!;
    return {
      id: row.id,
      name: row.name,
      type: normalizedType,
      filePath: row.file_path,
      code: row.source_code || `// Code not available for ${row.name}`,
      startLine: row.start_line,
      endLine: row.end_line,
    };
  } catch (error) {
    logger.debug({ entityId, entityType, error }, "Error getting entity with code");
    return null;
  }
}

/**
 * Get relationships for an entity
 */
export async function getEntityRelationships(
  graphStore: IGraphStore,
  entityId: string
): Promise<{ callers: Array<{ name: string; filePath: string }>; callees: Array<{ name: string; filePath: string }>; dependencies: string[] }> {
  const callers: Array<{ name: string; filePath: string }> = [];
  const callees: Array<{ name: string; filePath: string }> = [];
  const dependencies: string[] = [];

  try {
    // Get callers
    const callerResult = await graphStore.query<{ name: string; file_path: string }>(`
      ?[name, file_path] :=
        *calls{from_id, to_id: $entityId},
        *function{id: from_id, name, file_id},
        *file{id: file_id, relative_path: file_path}
      :limit 5
    `, { entityId });

    for (const row of callerResult.rows) {
      callers.push({ name: row.name, filePath: row.file_path });
    }

    // Get callees
    const calleeResult = await graphStore.query<{ name: string; file_path: string }>(`
      ?[name, file_path] :=
        *calls{from_id: $entityId, to_id},
        *function{id: to_id, name, file_id},
        *file{id: file_id, relative_path: file_path}
      :limit 5
    `, { entityId });

    for (const row of calleeResult.rows) {
      callees.push({ name: row.name, filePath: row.file_path });
    }
  } catch (error) {
    logger.debug({ entityId, error }, "Error getting relationships");
  }

  return { callers, callees, dependencies };
}

/**
 * Detect codebase conventions
 */
export async function detectConventions(graphStore: IGraphStore): Promise<CodebaseConventions> {
  // Default conventions (could be enhanced with actual analysis)
  const conventions: CodebaseConventions = {
    namingPatterns: {
      functions: "camelCase",
      classes: "PascalCase",
      interfaces: "PascalCase with I prefix (IGraphStore) or without (GraphStore)",
      files: "kebab-case.ts or camelCase.ts",
    },
    fileOrganization: "Feature-based folders with index.ts exports",
    errorHandling: "Throw errors with descriptive messages, use try/catch at boundaries",
    importStyle: "Named imports with .js extension for ESM",
    typeUsage: "Strict TypeScript with explicit types on public APIs",
  };

  try {
    // Analyze function naming
    const functions = await graphStore.query<{ name: string }>(`
      ?[name] := *function{name}
      :limit 100
    `, {});

    const camelCaseCount = functions.rows.filter(f => /^[a-z][a-zA-Z0-9]*$/.test(f.name)).length;
    const snakeCaseCount = functions.rows.filter(f => /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(f.name)).length;

    if (snakeCaseCount > camelCaseCount) {
      conventions.namingPatterns.functions = "snake_case";
    }

    // Analyze interface naming
    const interfaces = await graphStore.query<{ name: string }>(`
      ?[name] := *interface{name}
      :limit 100
    `, {});

    const iPrefixCount = interfaces.rows.filter(i => i.name.startsWith("I") && /^I[A-Z]/.test(i.name)).length;
    if (iPrefixCount > interfaces.rows.length * 0.5) {
      conventions.namingPatterns.interfaces = "PascalCase with I prefix (e.g., IGraphStore)";
    }
  } catch (error) {
    logger.debug({ error }, "Error detecting conventions");
  }

  return conventions;
}

/**
 * Detect common patterns in the codebase
 */
export async function detectPatterns(graphStore: IGraphStore): Promise<CodePattern[]> {
  const patterns: CodePattern[] = [];

  try {
    // Check for common patterns by class/interface names
    const patternIndicators = [
      { pattern: "Repository Pattern", keywords: ["Repository", "Store", "DAO"] },
      { pattern: "Service Layer", keywords: ["Service", "Manager", "Handler"] },
      { pattern: "Factory Pattern", keywords: ["Factory", "Creator", "Builder"] },
      { pattern: "Observer Pattern", keywords: ["Observer", "Subscriber", "Listener", "EventEmitter"] },
      { pattern: "Strategy Pattern", keywords: ["Strategy", "Policy", "Provider"] },
    ];

    for (const indicator of patternIndicators) {
      const examples: Array<{ name: string; filePath: string }> = [];

      for (const keyword of indicator.keywords) {
        const result = await graphStore.query<{ name: string; file_path: string }>(`
          ?[name, file_path] :=
            *class{name, file_id},
            *file{id: file_id, relative_path: file_path},
            contains(name, $keyword)
          :limit 3
        `, { keyword });

        for (const row of result.rows) {
          examples.push({ name: row.name, filePath: row.file_path });
        }
      }

      if (examples.length > 0) {
        patterns.push({
          pattern: indicator.pattern,
          description: `Found ${examples.length} implementations`,
          examples: examples.slice(0, 3),
        });
      }
    }
  } catch (error) {
    logger.debug({ error }, "Error detecting patterns");
  }

  return patterns;
}

// =============================================================================
// Main Vibe Coding Functions
// =============================================================================

/**
 * Start a vibe coding session - enriches the prompt with full context
 */
export async function vibeStart(
  graphStore: IGraphStore,
  justificationService: IJustificationService | null,
  ledger: IChangeLedger | null,
  params: {
    intent: string;
    targetFiles?: string[];
    relatedConcepts?: string[];
    maxContextItems?: number;
  }
): Promise<{ sessionId: string; context: VibeContext }> {
  const { intent, targetFiles = [], relatedConcepts = [], maxContextItems = 8 } = params;

  logger.info({ intent, targetFiles }, "Starting vibe coding session");

  // Create session
  const session = createSession(intent, targetFiles, relatedConcepts);

  // Extract concepts from intent
  const concepts = [...extractConcepts(intent), ...relatedConcepts];
  logger.debug({ concepts }, "Extracted concepts");

  // Find relevant entities
  const relevantEntities = await findRelevantEntities(
    graphStore,
    concepts,
    targetFiles[0],
    maxContextItems
  );
  logger.debug({ count: relevantEntities.length }, "Found relevant entities");

  // Build full context for each entity
  const relevantCode: RelevantCodeItem[] = [];

  for (const entity of relevantEntities) {
    const entityWithCode = await getEntityWithCode(graphStore, entity.id, entity.type);
    if (!entityWithCode) continue;

    const relationships = await getEntityRelationships(graphStore, entity.id);

    // Get justification if service available
    let justification: RelevantCodeItem["justification"] = null;
    if (justificationService) {
      try {
        const j = await justificationService.getJustification(entity.id);
        if (j) {
          justification = {
            purposeSummary: j.purposeSummary,
            businessValue: j.businessValue,
            featureContext: j.featureContext,
            confidence: j.confidenceScore,
          };
        }
      } catch (error) {
        logger.debug({ entityId: entity.id, error }, "Error getting justification");
      }
    }

    relevantCode.push({
      entity: entityWithCode,
      justification,
      relationships,
      relevanceScore: entity.relevanceScore,
      relevanceReason: entity.relevanceReason,
    });
  }

  // Detect patterns and conventions
  const patterns = await detectPatterns(graphStore);
  const conventions = await detectConventions(graphStore);

  // Build architecture notes
  const architectureNotes: string[] = [];
  if (targetFiles.length > 0) {
    architectureNotes.push(`Target file(s): ${targetFiles.join(", ")}`);
  }
  if (patterns.length > 0) {
    architectureNotes.push(`Detected patterns: ${patterns.map(p => p.pattern).join(", ")}`);
  }

  // Build the enriched prompt
  const enrichedPrompt = buildEnrichedPrompt(intent, relevantCode, patterns, conventions, architectureNotes);

  // Create context
  const context: VibeContext = {
    originalIntent: intent,
    enrichedPrompt,
    relevantCode,
    patterns,
    conventions,
    architectureNotes,
  };

  // Store in session
  session.enrichedContext = context;

  // Record in ledger
  if (ledger) {
    try {
      await ledger.append(createLedgerEntry(
        "mcp:tool:called",
        "mcp-query",
        `Vibe session started: ${intent.slice(0, 50)}...`,
        {
          metadata: {
            sessionId: session.id,
            intent,
            conceptsExtracted: concepts,
            entitiesFound: relevantCode.map(r => r.entity.name),
            patternsDetected: patterns.map(p => p.pattern),
          },
        }
      ));
    } catch (error) {
      logger.debug({ error }, "Error recording to ledger");
    }
  }

  logger.info({ sessionId: session.id, entitiesProvided: relevantCode.length }, "Vibe context built");

  return { sessionId: session.id, context };
}

/**
 * Record a change made during vibe coding
 */
export async function vibeChange(
  graphStore: IGraphStore,
  justificationService: IJustificationService | null,
  ledger: IChangeLedger | null,
  indexer: { indexFile: (path: string) => Promise<void> } | null,
  params: {
    sessionId?: string;
    filePath: string;
    changeType: "created" | "modified" | "deleted" | "renamed";
    description: string;
    previousPath?: string;
  }
): Promise<{ success: boolean; entitiesAffected: string[]; message: string }> {
  const { sessionId, filePath, changeType, description, previousPath } = params;

  logger.info({ sessionId, filePath, changeType }, "Recording vibe change");

  const entitiesAffected: string[] = [];

  // Re-index the file if indexer available
  if (indexer && changeType !== "deleted") {
    try {
      await indexer.indexFile(filePath);
      logger.debug({ filePath }, "File re-indexed");
    } catch (error) {
      logger.warn({ filePath, error }, "Error re-indexing file");
    }
  }

  // Get entities in the file
  try {
    const entities = await graphStore.query<{ id: string; name: string }>(`
      ?[id, name] :=
        *function{id, name, file_id},
        *file{id: file_id, relative_path},
        contains(relative_path, $filePath)
      :limit 50
    `, { filePath });

    for (const entity of entities.rows) {
      entitiesAffected.push(entity.id);
    }
  } catch (error) {
    logger.debug({ error }, "Error getting affected entities");
  }

  // Re-justify affected entities if service available
  if (justificationService && entitiesAffected.length > 0 && changeType !== "deleted") {
    try {
      await justificationService.justifyEntities(entitiesAffected, {
        force: true,
        skipLLM: true, // Use fast mode for immediate feedback
      });
      logger.debug({ count: entitiesAffected.length }, "Entities re-justified");
    } catch (error) {
      logger.debug({ error }, "Error re-justifying entities");
    }
  }

  // Update session if exists
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      session.changes.push({
        filePath,
        changeType,
        description,
        timestamp: new Date().toISOString(),
        entitiesAffected,
      });
    }
  }

  // Record in ledger
  if (ledger) {
    try {
      const ledgerEventType = changeType === "created" ? "index:file:added" as const :
                              changeType === "deleted" ? "index:file:deleted" as const : "index:file:modified" as const;
      await ledger.append(createLedgerEntry(
        ledgerEventType,
        "mcp-query",
        `Vibe change: ${description}`,
        {
          impactedFiles: previousPath ? [filePath, previousPath] : [filePath],
          impactedEntities: entitiesAffected,
          metadata: {
            sessionId,
            changeType,
            description,
            previousPath,
            vibeChange: true,
          },
        }
      ));
    } catch (error) {
      logger.debug({ error }, "Error recording to ledger");
    }
  }

  return {
    success: true,
    entitiesAffected,
    message: `Change recorded. ${entitiesAffected.length} entities affected and re-indexed.`,
  };
}

/**
 * Complete a vibe coding session
 */
export async function vibeComplete(
  ledger: IChangeLedger | null,
  params: {
    sessionId: string;
    summary?: string;
  }
): Promise<{ session: VibeSession | null; message: string }> {
  const { sessionId, summary } = params;

  const session = completeSession(sessionId);

  if (!session) {
    return { session: null, message: "Session not found" };
  }

  // Record completion in ledger
  if (ledger) {
    try {
      await ledger.append(createLedgerEntry(
        "mcp:tool:called",
        "mcp-query",
        `Vibe session completed: ${summary || session.intent.slice(0, 50)}`,
        {
          impactedFiles: session.changes.map(c => c.filePath),
          metadata: {
            sessionId,
            intent: session.intent,
            totalChanges: session.changes.length,
            summary,
            duration: Date.now() - new Date(session.startedAt).getTime(),
          },
        }
      ));
    } catch (error) {
      logger.debug({ error }, "Error recording session completion");
    }
  }

  return {
    session,
    message: `Session completed. ${session.changes.length} changes recorded.`,
  };
}

/**
 * Get session status
 */
export async function vibeStatus(params: { sessionId: string }): Promise<{ session: VibeSession | null }> {
  return { session: getSession(params.sessionId) };
}

// =============================================================================
// Prompt Building
// =============================================================================

/**
 * Build the enriched prompt with all context
 */
function buildEnrichedPrompt(
  intent: string,
  relevantCode: RelevantCodeItem[],
  patterns: CodePattern[],
  conventions: CodebaseConventions,
  architectureNotes: string[]
): string {
  const parts: string[] = [];

  // Header
  parts.push("# Your Coding Task\n");
  parts.push(intent);
  parts.push("\n");

  // Relevant code with business context
  if (relevantCode.length > 0) {
    parts.push("---\n");
    parts.push("# Relevant Code Context\n");
    parts.push("*The following code is relevant to your task. Pay attention to the business context.*\n");

    for (const item of relevantCode) {
      parts.push(`## ${item.entity.name} (${item.entity.type})`);
      parts.push(`**File**: \`${item.entity.filePath}\` (lines ${item.entity.startLine}-${item.entity.endLine})`);
      parts.push(`**Relevance**: ${item.relevanceReason}`);

      if (item.justification) {
        parts.push("\n**Business Context**:");
        parts.push(`- **Purpose**: ${item.justification.purposeSummary}`);
        parts.push(`- **Value**: ${item.justification.businessValue}`);
        parts.push(`- **Feature**: ${item.justification.featureContext}`);
      }

      if (item.relationships.callers.length > 0) {
        parts.push(`\n**Used by**: ${item.relationships.callers.map(c => `\`${c.name}\``).join(", ")}`);
      }
      if (item.relationships.callees.length > 0) {
        parts.push(`**Calls**: ${item.relationships.callees.map(c => `\`${c.name}\``).join(", ")}`);
      }

      parts.push("\n```typescript");
      parts.push(item.entity.code);
      parts.push("```\n");
    }
  }

  // Patterns
  if (patterns.length > 0) {
    parts.push("---\n");
    parts.push("# Patterns in This Codebase\n");
    parts.push("*Follow these established patterns for consistency:*\n");

    for (const pattern of patterns) {
      parts.push(`- **${pattern.pattern}**: ${pattern.description}`);
      if (pattern.examples.length > 0) {
        parts.push(`  - Examples: ${pattern.examples.map(e => `\`${e.name}\``).join(", ")}`);
      }
    }
    parts.push("");
  }

  // Conventions
  parts.push("---\n");
  parts.push("# Codebase Conventions\n");
  parts.push("*Follow these conventions:*\n");
  parts.push(`- **Function naming**: ${conventions.namingPatterns.functions}`);
  parts.push(`- **Class naming**: ${conventions.namingPatterns.classes}`);
  parts.push(`- **Interface naming**: ${conventions.namingPatterns.interfaces}`);
  parts.push(`- **File organization**: ${conventions.fileOrganization}`);
  parts.push(`- **Error handling**: ${conventions.errorHandling}`);
  parts.push(`- **Import style**: ${conventions.importStyle}`);
  parts.push("");

  // Architecture notes
  if (architectureNotes.length > 0) {
    parts.push("---\n");
    parts.push("# Architecture Notes\n");
    for (const note of architectureNotes) {
      parts.push(`- ${note}`);
    }
    parts.push("");
  }

  // Instructions
  parts.push("---\n");
  parts.push("# Instructions\n");
  parts.push("1. Use the relevant code above as reference for style and patterns");
  parts.push("2. Follow the established conventions");
  parts.push("3. Consider the business context when making decisions");
  parts.push("4. Maintain consistency with existing code");
  parts.push("");

  return parts.join("\n");
}

// =============================================================================
// Tool Definitions for MCP
// =============================================================================

/**
 * MCP Tool definitions for vibe coding
 */
export const VIBE_TOOL_DEFINITIONS = [
  {
    name: "vibe_start",
    description: `Start a vibe coding session. This enriches your prompt with relevant codebase context including:
- Related functions, classes, and interfaces with their source code
- Business justifications explaining WHY code exists (not just what it does)
- Call relationships (who calls what)
- Detected patterns (Repository, Service, Factory, etc.)
- Codebase conventions (naming, file organization, error handling)

Use this BEFORE starting any coding task to get full context.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        intent: {
          type: "string",
          description: "What you want to do (e.g., 'Add email validation to user registration')",
        },
        targetFiles: {
          type: "array",
          items: { type: "string" },
          description: "Files you plan to modify (optional but helps find relevant context)",
        },
        relatedConcepts: {
          type: "array",
          items: { type: "string" },
          description: "Additional keywords/concepts to search for (optional)",
        },
        maxContextItems: {
          type: "number",
          description: "Maximum number of relevant code items to include (default: 8)",
        },
      },
      required: ["intent"],
    },
  },
  {
    name: "vibe_change",
    description: `Record a file change during vibe coding. This:
- Triggers re-indexing of the changed file
- Updates business justifications for affected entities
- Records the change in the ledger for observability
- Links the change to the current vibe session (if any)

Use this AFTER making changes to keep the knowledge graph updated.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: {
          type: "string",
          description: "Vibe session ID (from vibe_start, optional)",
        },
        filePath: {
          type: "string",
          description: "Path to the changed file",
        },
        changeType: {
          type: "string",
          enum: ["created", "modified", "deleted", "renamed"],
          description: "Type of change",
        },
        description: {
          type: "string",
          description: "What was changed and why",
        },
        previousPath: {
          type: "string",
          description: "Previous path (for renamed files)",
        },
      },
      required: ["filePath", "changeType", "description"],
    },
  },
  {
    name: "vibe_complete",
    description: `Complete a vibe coding session. This:
- Marks the session as complete
- Records a summary in the ledger
- Returns session statistics

Use this when you're done with a coding task.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: {
          type: "string",
          description: "Vibe session ID (from vibe_start)",
        },
        summary: {
          type: "string",
          description: "Summary of what was accomplished",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "vibe_status",
    description: "Get the status of a vibe coding session including all recorded changes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: {
          type: "string",
          description: "Vibe session ID (from vibe_start)",
        },
      },
      required: ["sessionId"],
    },
  },
];

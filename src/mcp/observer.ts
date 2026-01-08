/**
 * MCP Observer Integration
 *
 * Hooks into MCP server to observe queries, track sessions,
 * and enable adaptive indexing and memory learning.
 */

import type { IMCPObserver } from "../core/adaptive-indexer/interfaces/IAdaptiveIndexer.js";
import type { IChangeLedger } from "../core/ledger/interfaces/IChangeLedger.js";
import type { IProjectMemory } from "../core/memory/interfaces/IProjectMemory.js";
import { createLedgerEntry } from "../core/ledger/models/ledger-events.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("mcp-observer");

// =============================================================================
// Session Context
// =============================================================================

export interface MCPSessionContext {
  sessionId: string;
  startedAt: string;
  lastActivityAt: string;
  source: "claude-code" | "cursor" | "windsurf" | "unknown";
  queryCount: number;
  toolsUsed: Set<string>;
  filesAccessed: Set<string>;
  entitiesAccessed: Set<string>;
  userPrompts: string[];
}

// =============================================================================
// MCP Session Manager
// =============================================================================

export class MCPSessionManager {
  private sessions: Map<string, MCPSessionContext> = new Map();
  private activeSessionId: string | null = null;
  private sessionTimeoutMs: number;
  private sessionTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(sessionTimeoutMs = 30 * 60 * 1000) {
    this.sessionTimeoutMs = sessionTimeoutMs;
  }

  getOrCreateSession(sessionId?: string): MCPSessionContext {
    // If no session ID provided, use active or create new
    const id = sessionId ?? this.activeSessionId ?? this.generateSessionId();

    let session = this.sessions.get(id);
    if (!session) {
      session = {
        sessionId: id,
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        source: "unknown",
        queryCount: 0,
        toolsUsed: new Set(),
        filesAccessed: new Set(),
        entitiesAccessed: new Set(),
        userPrompts: [],
      };
      this.sessions.set(id, session);
      logger.debug({ sessionId: id }, "Created new MCP session");
    }

    this.activeSessionId = id;
    this.resetSessionTimeout();
    return session;
  }

  getActiveSession(): MCPSessionContext | null {
    if (!this.activeSessionId) return null;
    const session = this.sessions.get(this.activeSessionId);
    if (session === undefined) return null;
    return session;
  }

  updateSession(sessionId: string, updates: Partial<MCPSessionContext>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates);
      session.lastActivityAt = new Date().toISOString();
    }
  }

  endSession(sessionId: string): MCPSessionContext | null {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null;
      }
      return session;
    }
    return null;
  }

  recordToolUse(sessionId: string, toolName: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.queryCount++;
      session.toolsUsed.add(toolName);
      session.lastActivityAt = new Date().toISOString();
      this.resetSessionTimeout();
    }
  }

  recordFileAccess(sessionId: string, files: string[]): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      for (const file of files) {
        session.filesAccessed.add(file);
      }
    }
  }

  recordEntityAccess(sessionId: string, entities: string[]): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      for (const entity of entities) {
        session.entitiesAccessed.add(entity);
      }
    }
  }

  recordUserPrompt(sessionId: string, prompt: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.userPrompts.push(prompt);
    }
  }

  getRecentSessions(limit = 10): MCPSessionContext[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())
      .slice(0, limit);
  }

  private generateSessionId(): string {
    return `mcp_session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private resetSessionTimeout(): void {
    if (this.sessionTimeoutTimer) {
      clearTimeout(this.sessionTimeoutTimer);
    }

    this.sessionTimeoutTimer = setTimeout(() => {
      if (this.activeSessionId) {
        logger.debug({ sessionId: this.activeSessionId }, "Session timed out");
        this.activeSessionId = null;
      }
    }, this.sessionTimeoutMs);
  }

  shutdown(): void {
    if (this.sessionTimeoutTimer) {
      clearTimeout(this.sessionTimeoutTimer);
    }
  }
}

// =============================================================================
// MCP Observer Implementation
// =============================================================================

export interface MCPObserverConfig {
  enableLedger: boolean;
  enableAdaptiveIndexing: boolean;
  enableMemory: boolean;
  sessionTimeoutMs: number;
}

export const DEFAULT_OBSERVER_CONFIG: MCPObserverConfig = {
  enableLedger: true,
  enableAdaptiveIndexing: true,
  enableMemory: true,
  sessionTimeoutMs: 30 * 60 * 1000,
};

export class MCPObserverService implements IMCPObserver {
  private sessionManager: MCPSessionManager;
  private ledger: IChangeLedger | null;
  private adaptiveObserver: IMCPObserver | null;
  private memory: IProjectMemory | null;
  private config: MCPObserverConfig;

  constructor(
    config: MCPObserverConfig,
    ledger?: IChangeLedger,
    adaptiveObserver?: IMCPObserver,
    memory?: IProjectMemory
  ) {
    this.config = config;
    this.sessionManager = new MCPSessionManager(config.sessionTimeoutMs);
    this.ledger = ledger ?? null;
    this.adaptiveObserver = adaptiveObserver ?? null;
    this.memory = memory ?? null;
  }

  // =========================================================================
  // IMCPObserver Implementation
  // =========================================================================

  onToolCall(toolName: string, args: Record<string, unknown>, sessionId: string): void {
    const session = this.sessionManager.getOrCreateSession(sessionId);
    this.sessionManager.recordToolUse(session.sessionId, toolName);

    // Forward to adaptive indexer
    if (this.config.enableAdaptiveIndexing && this.adaptiveObserver) {
      this.adaptiveObserver.onToolCall(toolName, args, session.sessionId);
    }

    // Log to ledger
    if (this.config.enableLedger && this.ledger) {
      const entry = createLedgerEntry(
        "mcp:tool:called",
        "mcp-query",
        `Tool called: ${toolName}`,
        {
          mcpContext: {
            toolName,
            parameters: args,
          },
          sessionId: session.sessionId,
        }
      );
      this.ledger.append(entry).catch((err) => {
        logger.error({ err }, "Failed to log tool call to ledger");
      });
    }

    // Record prompt if present
    const query = (args.query as string) ?? (args.name as string);
    if (query) {
      this.sessionManager.recordUserPrompt(session.sessionId, query);
    }
  }

  onToolResult(
    toolName: string,
    args: Record<string, unknown>,
    result: unknown,
    sessionId: string,
    durationMs: number
  ): void {
    const session = this.sessionManager.getOrCreateSession(sessionId);

    // Extract entities and files from result
    const { entityIds, files } = this.extractResultData(result);

    this.sessionManager.recordFileAccess(session.sessionId, files);
    this.sessionManager.recordEntityAccess(session.sessionId, entityIds);

    // Forward to adaptive indexer
    if (this.config.enableAdaptiveIndexing && this.adaptiveObserver) {
      this.adaptiveObserver.onToolResult(toolName, args, result, session.sessionId, durationMs);
    }

    // Log to ledger
    if (this.config.enableLedger && this.ledger) {
      const entry = createLedgerEntry(
        "mcp:query:completed",
        "mcp-query",
        `Query completed: ${toolName} (${durationMs}ms)`,
        {
          mcpContext: {
            toolName,
            query: (args.query as string) ?? (args.name as string),
            parameters: args,
            resultCount: Array.isArray(result) ? result.length : 1,
            responseTimeMs: durationMs,
          },
          impactedFiles: files,
          impactedEntities: entityIds,
          sessionId: session.sessionId,
        }
      );
      this.ledger.append(entry).catch((err) => {
        logger.error({ err }, "Failed to log tool result to ledger");
      });
    }
  }

  onResourceAccess(uri: string, sessionId: string): void {
    const session = this.sessionManager.getOrCreateSession(sessionId);

    // Forward to adaptive indexer
    if (this.config.enableAdaptiveIndexing && this.adaptiveObserver) {
      this.adaptiveObserver.onResourceAccess(uri, session.sessionId);
    }

    // Log to ledger
    if (this.config.enableLedger && this.ledger) {
      const entry = createLedgerEntry(
        "mcp:resource:accessed",
        "mcp-query",
        `Resource accessed: ${uri}`,
        {
          metadata: { uri },
          sessionId: session.sessionId,
        }
      );
      this.ledger.append(entry).catch((err) => {
        logger.error({ err }, "Failed to log resource access to ledger");
      });
    }
  }

  onCodeGenerated(
    filePath: string,
    content: string,
    sessionId: string,
    context?: string
  ): void {
    const session = this.sessionManager.getOrCreateSession(sessionId);
    this.sessionManager.recordFileAccess(session.sessionId, [filePath]);

    // Forward to adaptive indexer
    if (this.config.enableAdaptiveIndexing && this.adaptiveObserver) {
      this.adaptiveObserver.onCodeGenerated(filePath, content, session.sessionId, context);
    }

    // Log to ledger
    if (this.config.enableLedger && this.ledger) {
      const entry = createLedgerEntry(
        "index:file:modified",
        "mcp-result-processor",
        `Code generated: ${filePath}`,
        {
          impactedFiles: [filePath],
          metadata: {
            aiGenerated: true,
            contentLength: content.length,
            context,
          },
          sessionId: session.sessionId,
        }
      );
      this.ledger.append(entry).catch((err) => {
        logger.error({ err }, "Failed to log code generation to ledger");
      });
    }
  }

  // =========================================================================
  // Extended Methods
  // =========================================================================

  /**
   * Called when user corrects AI-generated code
   */
  async onUserCorrection(
    filePath: string,
    originalCode: string,
    correctedCode: string,
    sessionId?: string
  ): Promise<void> {
    const session = this.sessionManager.getOrCreateSession(sessionId);

    // Learn from correction if memory enabled
    if (this.config.enableMemory && this.memory) {
      try {
        await this.memory.learnFromCorrection(
          originalCode,
          correctedCode,
          filePath,
          session.sessionId
        );
      } catch (err) {
        logger.error({ err }, "Failed to learn from correction");
      }
    }

    // Log to ledger
    if (this.config.enableLedger && this.ledger) {
      const entry = createLedgerEntry(
        "user:correction:received",
        "user-interface",
        `User corrected AI output in ${filePath}`,
        {
          impactedFiles: [filePath],
          metadata: {
            originalLength: originalCode.length,
            correctedLength: correctedCode.length,
          },
          sessionId: session.sessionId,
        }
      );
      await this.ledger.append(entry);
    }
  }

  /**
   * Called when build/lint fails after AI generation
   */
  async onBuildFailure(
    errorMessage: string,
    errorCode: string | undefined,
    filePath: string,
    sessionId?: string
  ): Promise<void> {
    const session = this.sessionManager.getOrCreateSession(sessionId);

    // Learn from failure if memory enabled
    if (this.config.enableMemory && this.memory) {
      try {
        await this.memory.learnFromBuildFailure(
          errorMessage,
          errorCode,
          filePath,
          session.sessionId
        );
      } catch (err) {
        logger.error({ err }, "Failed to learn from build failure");
      }
    }

    // Log to ledger
    if (this.config.enableLedger && this.ledger) {
      const entry = createLedgerEntry(
        "system:error",
        "system",
        `Build failure after AI generation: ${errorMessage.substring(0, 100)}`,
        {
          impactedFiles: [filePath],
          errorCode,
          errorMessage,
          sessionId: session.sessionId,
        }
      );
      await this.ledger.append(entry);
    }
  }

  /**
   * Get relevant memory rules for current context
   */
  async getMemoryContext(
    filePath: string,
    codeContext?: string
  ): Promise<string> {
    if (!this.memory) return "";

    const rules = await this.memory.getRelevantMemories({
      context: codeContext ?? "",
      filePath,
      limit: 10,
    });

    return this.memory.formatForPrompt(rules, 2000);
  }

  /**
   * Get current session info
   */
  getCurrentSession(): MCPSessionContext | null {
    return this.sessionManager.getActiveSession();
  }

  /**
   * Get recent sessions
   */
  getRecentSessions(limit = 10): MCPSessionContext[] {
    return this.sessionManager.getRecentSessions(limit);
  }

  /**
   * End current session
   */
  endCurrentSession(): MCPSessionContext | null {
    const session = this.sessionManager.getActiveSession();
    if (session) {
      return this.sessionManager.endSession(session.sessionId);
    }
    return null;
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    this.sessionManager.shutdown();
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private extractResultData(result: unknown): { entityIds: string[]; files: string[] } {
    const entityIds: string[] = [];
    const files: string[] = [];

    if (!result || typeof result !== "object") {
      return { entityIds, files };
    }

    const resultObj = result as Record<string, unknown>;

    // Extract from common result shapes
    if (Array.isArray(result)) {
      for (const item of result) {
        if (typeof item === "object" && item !== null) {
          const obj = item as Record<string, unknown>;
          if (obj.id) entityIds.push(String(obj.id));
          if (obj.filePath) files.push(String(obj.filePath));
          if (obj.path) files.push(String(obj.path));
        }
      }
    } else {
      // Single object result
      if (resultObj.id) entityIds.push(String(resultObj.id));
      if (resultObj.filePath) files.push(String(resultObj.filePath));

      // Nested arrays
      if (Array.isArray(resultObj.entities)) {
        for (const e of resultObj.entities) {
          if (e && typeof e === "object" && (e as Record<string, unknown>).id) {
            entityIds.push(String((e as Record<string, unknown>).id));
          }
        }
      }
      if (Array.isArray(resultObj.files)) {
        for (const f of resultObj.files) {
          if (typeof f === "string") files.push(f);
          else if (f && typeof f === "object" && (f as Record<string, unknown>).path) {
            files.push(String((f as Record<string, unknown>).path));
          }
        }
      }
    }

    return { entityIds, files };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createMCPObserver(
  config?: Partial<MCPObserverConfig>,
  ledger?: IChangeLedger,
  adaptiveObserver?: IMCPObserver,
  memory?: IProjectMemory
): MCPObserverService {
  return new MCPObserverService(
    { ...DEFAULT_OBSERVER_CONFIG, ...config },
    ledger,
    adaptiveObserver,
    memory
  );
}

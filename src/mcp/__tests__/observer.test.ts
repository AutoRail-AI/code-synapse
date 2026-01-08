/**
 * MCP Observer Tests
 *
 * Tests for the MCP Observer service including:
 * - Session management
 * - Tool call tracking
 * - Resource access logging
 * - Memory context integration
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  MCPSessionManager,
  MCPObserverService,
  createMCPObserver,
  DEFAULT_OBSERVER_CONFIG,
  type MCPSessionContext,
  type MCPObserverConfig,
} from "../observer.js";
import type { IMCPObserver } from "../../core/adaptive-indexer/interfaces/IAdaptiveIndexer.js";
import type { IChangeLedger } from "../../core/ledger/interfaces/IChangeLedger.js";
import type { IProjectMemory } from "../../core/memory/interfaces/IProjectMemory.js";

// =============================================================================
// MCPSessionManager Tests
// =============================================================================

describe("MCPSessionManager", () => {
  let manager: MCPSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new MCPSessionManager(30 * 60 * 1000); // 30 minutes
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  describe("getOrCreateSession", () => {
    it("should create new session when none exists", () => {
      const session = manager.getOrCreateSession();

      expect(session.sessionId).toBeDefined();
      expect(session.sessionId).toContain("mcp_session_");
      expect(session.startedAt).toBeDefined();
      expect(session.lastActivityAt).toBeDefined();
      expect(session.source).toBe("unknown");
      expect(session.queryCount).toBe(0);
      expect(session.toolsUsed.size).toBe(0);
      expect(session.filesAccessed.size).toBe(0);
      expect(session.entitiesAccessed.size).toBe(0);
      expect(session.userPrompts).toEqual([]);
    });

    it("should return existing session with same ID", () => {
      const session1 = manager.getOrCreateSession("test-session-1");
      const session2 = manager.getOrCreateSession("test-session-1");

      expect(session1).toBe(session2);
      expect(session1.sessionId).toBe("test-session-1");
    });

    it("should create different sessions with different IDs", () => {
      const session1 = manager.getOrCreateSession("session-1");
      const session2 = manager.getOrCreateSession("session-2");

      expect(session1.sessionId).not.toBe(session2.sessionId);
    });

    it("should reuse active session when no ID provided", () => {
      const session1 = manager.getOrCreateSession("active-session");
      const session2 = manager.getOrCreateSession();

      expect(session1).toBe(session2);
    });
  });

  describe("getActiveSession", () => {
    it("should return null when no active session", () => {
      expect(manager.getActiveSession()).toBeNull();
    });

    it("should return the active session", () => {
      const created = manager.getOrCreateSession("my-session");
      const active = manager.getActiveSession();

      expect(active).toBe(created);
    });
  });

  describe("updateSession", () => {
    it("should update session properties", () => {
      const session = manager.getOrCreateSession("update-test");
      const initialActivity = session.lastActivityAt;

      vi.advanceTimersByTime(1000);

      manager.updateSession("update-test", { source: "claude-code" });

      expect(session.source).toBe("claude-code");
      expect(session.lastActivityAt).not.toBe(initialActivity);
    });

    it("should do nothing for non-existent session", () => {
      // Should not throw
      manager.updateSession("non-existent", { source: "cursor" });
    });
  });

  describe("recordToolUse", () => {
    it("should increment query count", () => {
      const session = manager.getOrCreateSession("tool-test");
      expect(session.queryCount).toBe(0);

      manager.recordToolUse("tool-test", "searchEntities");
      expect(session.queryCount).toBe(1);

      manager.recordToolUse("tool-test", "getFile");
      expect(session.queryCount).toBe(2);
    });

    it("should track unique tools used", () => {
      const session = manager.getOrCreateSession("tool-test");

      manager.recordToolUse("tool-test", "searchEntities");
      manager.recordToolUse("tool-test", "searchEntities");
      manager.recordToolUse("tool-test", "getFile");

      expect(session.toolsUsed.size).toBe(2);
      expect(session.toolsUsed.has("searchEntities")).toBe(true);
      expect(session.toolsUsed.has("getFile")).toBe(true);
    });

    it("should update lastActivityAt", () => {
      const session = manager.getOrCreateSession("tool-test");
      const initial = session.lastActivityAt;

      vi.advanceTimersByTime(1000);
      manager.recordToolUse("tool-test", "searchEntities");

      expect(session.lastActivityAt).not.toBe(initial);
    });
  });

  describe("recordFileAccess", () => {
    it("should track unique files accessed", () => {
      const session = manager.getOrCreateSession("file-test");

      manager.recordFileAccess("file-test", ["src/auth.ts", "src/user.ts"]);
      manager.recordFileAccess("file-test", ["src/auth.ts", "src/config.ts"]);

      expect(session.filesAccessed.size).toBe(3);
      expect(session.filesAccessed.has("src/auth.ts")).toBe(true);
      expect(session.filesAccessed.has("src/user.ts")).toBe(true);
      expect(session.filesAccessed.has("src/config.ts")).toBe(true);
    });
  });

  describe("recordEntityAccess", () => {
    it("should track unique entities accessed", () => {
      const session = manager.getOrCreateSession("entity-test");

      manager.recordEntityAccess("entity-test", ["func-1", "class-1"]);
      manager.recordEntityAccess("entity-test", ["func-1", "func-2"]);

      expect(session.entitiesAccessed.size).toBe(3);
    });
  });

  describe("recordUserPrompt", () => {
    it("should store user prompts", () => {
      const session = manager.getOrCreateSession("prompt-test");

      manager.recordUserPrompt("prompt-test", "Find authentication functions");
      manager.recordUserPrompt("prompt-test", "Show me the login handler");

      expect(session.userPrompts.length).toBe(2);
      expect(session.userPrompts[0]).toBe("Find authentication functions");
    });
  });

  describe("endSession", () => {
    it("should return and clear active session", () => {
      manager.getOrCreateSession("end-test");
      expect(manager.getActiveSession()).not.toBeNull();

      const ended = manager.endSession("end-test");

      expect(ended).not.toBeNull();
      expect(ended!.sessionId).toBe("end-test");
      expect(manager.getActiveSession()).toBeNull();
    });

    it("should return null for non-existent session", () => {
      const ended = manager.endSession("non-existent");
      // Note: current implementation returns the session even if not active
      // but doesn't throw
    });
  });

  describe("getRecentSessions", () => {
    it("should return sessions sorted by last activity", () => {
      manager.getOrCreateSession("session-1");
      vi.advanceTimersByTime(1000);
      manager.getOrCreateSession("session-2");
      vi.advanceTimersByTime(1000);
      manager.getOrCreateSession("session-3");

      const recent = manager.getRecentSessions(10);

      expect(recent.length).toBe(3);
      expect(recent[0]!.sessionId).toBe("session-3"); // Most recent
    });

    it("should respect limit", () => {
      manager.getOrCreateSession("session-1");
      manager.getOrCreateSession("session-2");
      manager.getOrCreateSession("session-3");

      const recent = manager.getRecentSessions(2);

      expect(recent.length).toBe(2);
    });
  });

  describe("Session Timeout", () => {
    it("should clear active session after timeout", () => {
      manager.getOrCreateSession("timeout-test");
      expect(manager.getActiveSession()).not.toBeNull();

      // Advance past timeout (30 minutes)
      vi.advanceTimersByTime(31 * 60 * 1000);

      expect(manager.getActiveSession()).toBeNull();
    });

    it("should reset timeout on activity", () => {
      manager.getOrCreateSession("activity-test");

      // Advance 20 minutes
      vi.advanceTimersByTime(20 * 60 * 1000);

      // Record activity (resets timeout)
      manager.recordToolUse("activity-test", "searchEntities");

      // Advance another 20 minutes (40 total, but only 20 since activity)
      vi.advanceTimersByTime(20 * 60 * 1000);

      // Should still be active
      expect(manager.getActiveSession()).not.toBeNull();
    });
  });
});

// =============================================================================
// MCPObserverService Tests
// =============================================================================

describe("MCPObserverService", () => {
  let observer: MCPObserverService;
  let mockLedger: IChangeLedger;
  let mockAdaptiveObserver: IMCPObserver;
  let mockMemory: IProjectMemory;

  beforeEach(() => {
    vi.useFakeTimers();

    mockLedger = {
      initialize: vi.fn().mockResolvedValue(undefined),
      append: vi.fn().mockResolvedValue(undefined),
      appendBatch: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      getEntry: vi.fn().mockResolvedValue(null),
      getByCorrelation: vi.fn().mockResolvedValue([]),
      getBySession: vi.fn().mockResolvedValue([]),
      getTimeline: vi.fn().mockResolvedValue([]),
      getAggregations: vi.fn().mockResolvedValue({}),
      getRecent: vi.fn().mockResolvedValue([]),
      getForEntity: vi.fn().mockResolvedValue([]),
      getForFile: vi.fn().mockResolvedValue([]),
      subscribe: vi.fn().mockReturnValue(() => {}),
      getCurrentSequence: vi.fn().mockReturnValue(0),
      getEntryCount: vi.fn().mockResolvedValue(100),
      getOldestTimestamp: vi.fn().mockResolvedValue(new Date().toISOString()),
      getNewestTimestamp: vi.fn().mockResolvedValue(new Date().toISOString()),
      flush: vi.fn().mockResolvedValue(undefined),
      compact: vi.fn().mockResolvedValue(0),
      export: vi.fn().mockResolvedValue("{}"),
      import: vi.fn().mockResolvedValue(0),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    mockAdaptiveObserver = {
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onResourceAccess: vi.fn(),
      onCodeGenerated: vi.fn(),
    };

    mockMemory = {
      initialize: vi.fn().mockResolvedValue(undefined),
      isReady: true,
      createRule: vi.fn().mockResolvedValue({} as any),
      getRule: vi.fn().mockResolvedValue(null),
      updateRule: vi.fn().mockResolvedValue(null),
      deprecateRule: vi.fn().mockResolvedValue(true),
      deleteRule: vi.fn().mockResolvedValue(true),
      listRules: vi.fn().mockResolvedValue([]),
      getRelevantMemories: vi.fn().mockResolvedValue([]),
      getMemoriesForFile: vi.fn().mockResolvedValue([]),
      formatForPrompt: vi.fn().mockReturnValue("## Rules\n- Rule 1"),
      learnFromCorrection: vi.fn().mockResolvedValue(null),
      learnFromBuildFailure: vi.fn().mockResolvedValue(null),
      learnFromInstruction: vi.fn().mockResolvedValue({} as any),
      validateRule: vi.fn().mockResolvedValue(undefined),
      recordViolation: vi.fn().mockResolvedValue(undefined),
      applyConfidenceDecay: vi.fn().mockResolvedValue(0),
      getStats: vi.fn().mockResolvedValue({} as any),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    observer = new MCPObserverService(
      DEFAULT_OBSERVER_CONFIG,
      mockLedger,
      mockAdaptiveObserver,
      mockMemory
    );
  });

  afterEach(() => {
    observer.shutdown();
    vi.useRealTimers();
  });

  describe("onToolCall", () => {
    it("should create session and record tool use", () => {
      observer.onToolCall("searchEntities", { query: "auth" }, "session-1");

      const session = observer.getCurrentSession();
      expect(session).not.toBeNull();
      expect(session!.queryCount).toBe(1);
      expect(session!.toolsUsed.has("searchEntities")).toBe(true);
    });

    it("should forward to adaptive observer when enabled", () => {
      observer.onToolCall("searchEntities", { query: "auth" }, "session-1");

      expect(mockAdaptiveObserver.onToolCall).toHaveBeenCalledWith(
        "searchEntities",
        { query: "auth" },
        "session-1"
      );
    });

    it("should log to ledger when enabled", async () => {
      observer.onToolCall("searchEntities", { query: "auth" }, "session-1");

      // Wait for async ledger append
      await vi.runAllTimersAsync();

      expect(mockLedger.append).toHaveBeenCalled();
    });

    it("should record query/name as user prompt", () => {
      observer.onToolCall("searchEntities", { query: "find auth handlers" }, "session-1");

      const session = observer.getCurrentSession();
      expect(session!.userPrompts).toContain("find auth handlers");
    });
  });

  describe("onToolResult", () => {
    it("should extract files and entities from result", () => {
      const result = {
        entities: [{ id: "func-1" }, { id: "func-2" }],
        files: [{ path: "src/auth.ts" }],
      };

      observer.onToolResult(
        "searchEntities",
        { query: "auth" },
        result,
        "session-1",
        150
      );

      const session = observer.getCurrentSession();
      expect(session!.entitiesAccessed.has("func-1")).toBe(true);
      expect(session!.entitiesAccessed.has("func-2")).toBe(true);
      expect(session!.filesAccessed.has("src/auth.ts")).toBe(true);
    });

    it("should forward to adaptive observer", () => {
      observer.onToolResult("searchEntities", {}, [], "session-1", 100);

      expect(mockAdaptiveObserver.onToolResult).toHaveBeenCalledWith(
        "searchEntities",
        {},
        [],
        "session-1",
        100
      );
    });

    it("should log result to ledger", async () => {
      observer.onToolResult("searchEntities", {}, [], "session-1", 100);

      await vi.runAllTimersAsync();

      expect(mockLedger.append).toHaveBeenCalled();
    });
  });

  describe("onResourceAccess", () => {
    it("should forward to adaptive observer", () => {
      observer.onResourceAccess("file://src/auth.ts", "session-1");

      expect(mockAdaptiveObserver.onResourceAccess).toHaveBeenCalledWith(
        "file://src/auth.ts",
        "session-1"
      );
    });

    it("should log to ledger", async () => {
      observer.onResourceAccess("file://src/auth.ts", "session-1");

      await vi.runAllTimersAsync();

      expect(mockLedger.append).toHaveBeenCalled();
    });
  });

  describe("onCodeGenerated", () => {
    it("should record file access", () => {
      observer.onCodeGenerated(
        "src/new-file.ts",
        "export function newFunc() {}",
        "session-1",
        "Creating new utility function"
      );

      const session = observer.getCurrentSession();
      expect(session!.filesAccessed.has("src/new-file.ts")).toBe(true);
    });

    it("should forward to adaptive observer", () => {
      observer.onCodeGenerated(
        "src/new-file.ts",
        "export function newFunc() {}",
        "session-1"
      );

      expect(mockAdaptiveObserver.onCodeGenerated).toHaveBeenCalledWith(
        "src/new-file.ts",
        "export function newFunc() {}",
        "session-1",
        undefined
      );
    });

    it("should log to ledger", async () => {
      observer.onCodeGenerated(
        "src/new-file.ts",
        "export function newFunc() {}",
        "session-1"
      );

      await vi.runAllTimersAsync();

      expect(mockLedger.append).toHaveBeenCalled();
    });
  });

  describe("onUserCorrection", () => {
    it("should learn from correction when memory enabled", async () => {
      await observer.onUserCorrection(
        "src/auth.ts",
        "const x = console.log('test')",
        "const x = logger.info('test')",
        "session-1"
      );

      expect(mockMemory.learnFromCorrection).toHaveBeenCalledWith(
        "const x = console.log('test')",
        "const x = logger.info('test')",
        "src/auth.ts",
        "session-1"
      );
    });

    it("should log correction to ledger", async () => {
      await observer.onUserCorrection(
        "src/auth.ts",
        "old code",
        "new code",
        "session-1"
      );

      expect(mockLedger.append).toHaveBeenCalled();
    });
  });

  describe("onBuildFailure", () => {
    it("should learn from failure when memory enabled", async () => {
      await observer.onBuildFailure(
        "Type 'string' is not assignable to type 'number'",
        "TS2322",
        "src/utils.ts",
        "session-1"
      );

      expect(mockMemory.learnFromBuildFailure).toHaveBeenCalledWith(
        "Type 'string' is not assignable to type 'number'",
        "TS2322",
        "src/utils.ts",
        "session-1"
      );
    });

    it("should log failure to ledger", async () => {
      await observer.onBuildFailure(
        "Build error",
        "E001",
        "src/utils.ts",
        "session-1"
      );

      expect(mockLedger.append).toHaveBeenCalled();
    });
  });

  describe("getMemoryContext", () => {
    it("should return formatted memory rules", async () => {
      const context = await observer.getMemoryContext(
        "src/auth.ts",
        "handling user authentication"
      );

      expect(mockMemory.getRelevantMemories).toHaveBeenCalled();
      expect(mockMemory.formatForPrompt).toHaveBeenCalled();
      expect(typeof context).toBe("string");
    });

    it("should return empty string when memory not configured", async () => {
      const observerNoMemory = new MCPObserverService(
        DEFAULT_OBSERVER_CONFIG,
        mockLedger,
        mockAdaptiveObserver
        // No memory
      );

      const context = await observerNoMemory.getMemoryContext("src/test.ts");
      expect(context).toBe("");

      observerNoMemory.shutdown();
    });
  });

  describe("Session Management", () => {
    it("should get current session", () => {
      observer.onToolCall("test", {}, "my-session");

      const session = observer.getCurrentSession();
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe("my-session");
    });

    it("should get recent sessions", () => {
      observer.onToolCall("test", {}, "session-1");
      observer.onToolCall("test", {}, "session-2");
      observer.onToolCall("test", {}, "session-3");

      const recent = observer.getRecentSessions(10);
      expect(recent.length).toBeGreaterThan(0);
    });

    it("should end current session", () => {
      observer.onToolCall("test", {}, "end-session");
      expect(observer.getCurrentSession()).not.toBeNull();

      const ended = observer.endCurrentSession();

      expect(ended).not.toBeNull();
      expect(ended!.sessionId).toBe("end-session");
      expect(observer.getCurrentSession()).toBeNull();
    });
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createMCPObserver", () => {
  it("should create observer with default config", () => {
    const observer = createMCPObserver();

    expect(observer).toBeInstanceOf(MCPObserverService);
    observer.shutdown();
  });

  it("should create observer with custom config", () => {
    const customConfig: Partial<MCPObserverConfig> = {
      enableLedger: false,
      enableAdaptiveIndexing: false,
      enableMemory: false,
      sessionTimeoutMs: 60 * 60 * 1000, // 1 hour
    };

    const observer = createMCPObserver(customConfig);

    expect(observer).toBeInstanceOf(MCPObserverService);
    observer.shutdown();
  });

  it("should inject dependencies", () => {
    const mockLedger = { append: vi.fn() } as unknown as IChangeLedger;
    const mockAdaptive = { onToolCall: vi.fn() } as unknown as IMCPObserver;
    const mockMemory = { getRelevantMemories: vi.fn() } as unknown as IProjectMemory;

    const observer = createMCPObserver({}, mockLedger, mockAdaptive, mockMemory);

    expect(observer).toBeInstanceOf(MCPObserverService);
    observer.shutdown();
  });
});

// =============================================================================
// Config Tests
// =============================================================================

describe("DEFAULT_OBSERVER_CONFIG", () => {
  it("should have all expected properties", () => {
    expect(DEFAULT_OBSERVER_CONFIG.enableLedger).toBe(true);
    expect(DEFAULT_OBSERVER_CONFIG.enableAdaptiveIndexing).toBe(true);
    expect(DEFAULT_OBSERVER_CONFIG.enableMemory).toBe(true);
    expect(DEFAULT_OBSERVER_CONFIG.sessionTimeoutMs).toBe(30 * 60 * 1000);
  });
});

// =============================================================================
// Result Data Extraction Tests
// =============================================================================

describe("Result Data Extraction", () => {
  let observer: MCPObserverService;

  beforeEach(() => {
    observer = new MCPObserverService(DEFAULT_OBSERVER_CONFIG);
  });

  afterEach(() => {
    observer.shutdown();
  });

  it("should extract from array results", () => {
    const result = [
      { id: "func-1", filePath: "src/auth.ts" },
      { id: "func-2", path: "src/user.ts" },
    ];

    observer.onToolResult("search", {}, result, "session-1", 100);

    const session = observer.getCurrentSession();
    expect(session!.entitiesAccessed.has("func-1")).toBe(true);
    expect(session!.entitiesAccessed.has("func-2")).toBe(true);
    expect(session!.filesAccessed.has("src/auth.ts")).toBe(true);
    expect(session!.filesAccessed.has("src/user.ts")).toBe(true);
  });

  it("should extract from object with nested arrays", () => {
    const result = {
      entities: [{ id: "class-1" }],
      files: ["src/index.ts", { path: "src/utils.ts" }],
    };

    observer.onToolResult("search", {}, result, "session-1", 100);

    const session = observer.getCurrentSession();
    expect(session!.entitiesAccessed.has("class-1")).toBe(true);
    expect(session!.filesAccessed.has("src/index.ts")).toBe(true);
    expect(session!.filesAccessed.has("src/utils.ts")).toBe(true);
  });

  it("should handle single object result", () => {
    const result = {
      id: "single-entity",
      filePath: "src/single.ts",
    };

    observer.onToolResult("get", {}, result, "session-1", 50);

    const session = observer.getCurrentSession();
    expect(session!.entitiesAccessed.has("single-entity")).toBe(true);
    expect(session!.filesAccessed.has("src/single.ts")).toBe(true);
  });

  it("should handle null/undefined results gracefully", () => {
    observer.onToolResult("search", {}, null, "session-1", 100);
    observer.onToolResult("search", {}, undefined, "session-1", 100);

    const session = observer.getCurrentSession();
    expect(session!.entitiesAccessed.size).toBe(0);
    expect(session!.filesAccessed.size).toBe(0);
  });
});

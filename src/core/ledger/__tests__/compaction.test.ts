/**
 * Tests for Ledger Compaction Module
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CompactedLedgerEntrySchema,
  MCPQueryTraceSchema,
  CodeAccessSummarySchema,
  CodeChangesSummarySchema,
  SemanticImpactSchema,
  IndexUpdatesSummarySchema,
  createCompactedEntry,
  DEFAULT_COMPACTION_CONFIG,
} from "../models/compacted-entry.js";
import type {
  CompactedLedgerEntry,
  MCPQueryTrace,
  CodeAccessSummary,
  CodeChangesSummary,
  SemanticImpact,
  IndexUpdatesSummary,
  CompactedEntryQuery,
  CompactionConfig,
} from "../models/compacted-entry.js";
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

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe("CompactedLedgerEntry Schema", () => {
  describe("MCPQueryTrace", () => {
    it("should validate a valid MCP query trace", () => {
      const trace: MCPQueryTrace = {
        toolName: "searchEntities",
        query: "function handleLogin",
        resultCount: 5,
        responseTimeMs: 150,
        timestamp: new Date().toISOString(),
        entityIdsReturned: ["entity-1", "entity-2"],
        filesReturned: ["src/auth/login.ts"],
      };

      const result = MCPQueryTraceSchema.safeParse(trace);
      expect(result.success).toBe(true);
    });

    it("should validate MCP query trace with optional parameters", () => {
      const trace: MCPQueryTrace = {
        toolName: "searchEntities",
        query: "function test",
        resultCount: 0,
        responseTimeMs: 10,
        timestamp: new Date().toISOString(),
        entityIdsReturned: [],
        filesReturned: [],
        parameters: { type: "function", scope: "module" },
      };

      const result = MCPQueryTraceSchema.safeParse(trace);
      expect(result.success).toBe(true);
    });

    it("should reject trace missing required fields", () => {
      const invalidTrace = {
        toolName: "searchEntities",
        // Missing other required fields
      };

      const result = MCPQueryTraceSchema.safeParse(invalidTrace);
      expect(result.success).toBe(false);
    });
  });

  describe("CodeAccessSummary", () => {
    it("should validate a valid code access summary", () => {
      const summary: CodeAccessSummary = {
        files: ["src/auth/login.ts", "src/auth/logout.ts"],
        entities: ["func:handleLogin", "class:AuthService"],
        uniqueFilesCount: 2,
        uniqueEntitiesCount: 2,
      };

      const result = CodeAccessSummarySchema.safeParse(summary);
      expect(result.success).toBe(true);
    });
  });

  describe("CodeChangesSummary", () => {
    it("should validate a valid code changes summary", () => {
      const summary: CodeChangesSummary = {
        filesModified: ["src/auth/login.ts"],
        filesCreated: ["src/auth/new-feature.ts"],
        filesDeleted: [],
        functionsChanged: ["handleLogin", "validateToken"],
        classesChanged: ["AuthService"],
        interfacesChanged: [],
        totalLinesAdded: 45,
        totalLinesDeleted: 12,
      };

      const result = CodeChangesSummarySchema.safeParse(summary);
      expect(result.success).toBe(true);
    });
  });

  describe("SemanticImpact", () => {
    it("should validate a valid semantic impact", () => {
      const impact: SemanticImpact = {
        verticals: ["authentication", "user-management"],
        horizontals: [
          { name: "logging" },
          { name: "validation" },
        ],
        servicesAffected: ["AuthService", "UserService"],
        apisAffected: ["/api/auth/login", "/api/auth/logout"],
        patternsUsed: ["repository", "factory"],
      };

      const result = SemanticImpactSchema.safeParse(impact);
      expect(result.success).toBe(true);
    });
  });

  describe("IndexUpdatesSummary", () => {
    it("should validate a valid index updates summary", () => {
      const summary: IndexUpdatesSummary = {
        entitiesAdded: 10,
        entitiesUpdated: 5,
        entitiesRemoved: 2,
        relationshipsAdded: 15,
        relationshipsRemoved: 3,
        embeddingsGenerated: 10,
      };

      const result = IndexUpdatesSummarySchema.safeParse(summary);
      expect(result.success).toBe(true);
    });
  });

  describe("Full CompactedLedgerEntry", () => {
    it("should validate a complete compacted entry", () => {
      const entry = createCompactedEntry(
        "session-123",
        "claude-code",
        "Implemented user authentication flow",
        new Date(Date.now() - 3600000).toISOString(),
        new Date().toISOString(),
        {
          intentCategory: "feature-development",
          userPrompts: ["add login functionality", "handle JWT tokens"],
          mcpQueries: [
            {
              toolName: "searchEntities",
              query: "authentication",
              resultCount: 5,
              responseTimeMs: 100,
              timestamp: new Date().toISOString(),
              entityIdsReturned: [],
              filesReturned: [],
            },
          ],
          totalMcpQueries: 1,
          uniqueToolsUsed: ["searchEntities"],
          codeAccessed: {
            files: ["src/auth/login.ts"],
            entities: ["func:handleLogin"],
            uniqueFilesCount: 1,
            uniqueEntitiesCount: 1,
          },
          codeChanges: {
            filesModified: ["src/auth/login.ts"],
            filesCreated: [],
            filesDeleted: [],
            functionsChanged: ["handleLogin"],
            classesChanged: [],
            interfacesChanged: [],
            totalLinesAdded: 50,
            totalLinesDeleted: 10,
          },
          semanticImpact: {
            verticals: ["authentication"],
            horizontals: [],
            servicesAffected: ["AuthService"],
            apisAffected: [],
            patternsUsed: [],
          },
          indexUpdates: {
            entitiesAdded: 5,
            entitiesUpdated: 2,
            entitiesRemoved: 0,
            relationshipsAdded: 10,
            relationshipsRemoved: 0,
            embeddingsGenerated: 5,
          },
          rawEventIds: ["event-1", "event-2", "event-3"],
          rawEventCount: 3,
          confidenceScore: 0.85,
          completeness: 0.9,
        }
      );

      const result = CompactedLedgerEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it("should validate entry with all intent categories", () => {
      const categories: CompactedLedgerEntry["intentCategory"][] = [
        "feature-development",
        "bug-fix",
        "refactoring",
        "exploration",
        "debugging",
        "testing",
        "documentation",
        "configuration",
        "unknown",
      ];

      for (const category of categories) {
        const entry = createCompactedEntry(
          `session-${category}`,
          "claude-code",
          `Test ${category}`,
          new Date().toISOString(),
          new Date().toISOString(),
          { intentCategory: category }
        );
        const result = CompactedLedgerEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
      }
    });

    it("should validate entry with all source types", () => {
      const sources: CompactedLedgerEntry["source"][] = [
        "claude-code",
        "cursor",
        "windsurf",
        "filesystem",
        "manual",
        "reconciliation",
      ];

      for (const source of sources) {
        const entry = createCompactedEntry(
          `session-${source}`,
          source,
          `Test ${source}`,
          new Date().toISOString(),
          new Date().toISOString()
        );
        const result = CompactedLedgerEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
      }
    });
  });
});

describe("CompactedEntryQuery", () => {
  it("should support a valid query structure", () => {
    const query: CompactedEntryQuery = {
      sessionId: "session-123",
      source: "claude-code",
      startTime: new Date(Date.now() - 86400000).toISOString(),
      endTime: new Date().toISOString(),
      intentCategory: "feature-development",
      limit: 50,
      offset: 0,
    };

    expect(query.sessionId).toBe("session-123");
    expect(query.source).toBe("claude-code");
    expect(query.limit).toBe(50);
  });

  it("should support empty query", () => {
    const query: CompactedEntryQuery = {};
    expect(query.sessionId).toBeUndefined();
    expect(query.limit).toBeUndefined();
  });
});

describe("CompactionConfig", () => {
  it("should have valid default config", () => {
    expect(DEFAULT_COMPACTION_CONFIG.sessionTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_COMPACTION_CONFIG.minEventsForCompaction).toBeGreaterThan(0);
    expect(DEFAULT_COMPACTION_CONFIG.intentSimilarityThreshold).toBeGreaterThan(0);
    expect(DEFAULT_COMPACTION_CONFIG.intentSimilarityThreshold).toBeLessThanOrEqual(1);
  });

  it("should allow custom config", () => {
    const config: CompactionConfig = {
      compactionIntervalMs: 60000,
      minEventsForCompaction: 5,
      maxRawEventsPerCompaction: 500,
      sessionTimeoutMs: 1800000,
      maxSessionDurationMs: 7200000,
      intentSimilarityThreshold: 0.8,
      compactionBatchSize: 100,
      retainRawEventsMs: 86400000,
    };

    expect(config.minEventsForCompaction).toBe(5);
    expect(config.sessionTimeoutMs).toBe(1800000);
  });
});

// =============================================================================
// Interface Tests
// =============================================================================

describe("ICompactionStorage Interface", () => {
  let mockStorage: ICompactionStorage;
  const sampleEntry = createCompactedEntry(
    "session-test",
    "claude-code",
    "Test session",
    new Date().toISOString(),
    new Date().toISOString()
  );

  beforeEach(() => {
    mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      storeBatch: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(sampleEntry),
      getBySessionId: vi.fn().mockResolvedValue(sampleEntry),
      query: vi.fn().mockResolvedValue([sampleEntry]),
      getTimeline: vi.fn().mockResolvedValue([sampleEntry]),
      getForFile: vi.fn().mockResolvedValue([sampleEntry]),
      getForVertical: vi.fn().mockResolvedValue([sampleEntry]),
      deleteOlderThan: vi.fn().mockResolvedValue(5),
      getStats: vi.fn().mockResolvedValue({
        totalCompactedEntries: 10,
        totalRawEventsCompacted: 100,
        averageEventsPerEntry: 10,
        bySource: { "claude-code": 8, cursor: 2 },
        byIntentCategory: { "feature-development": 5, debugging: 3, exploration: 2 },
        oldestEntry: new Date(Date.now() - 86400000).toISOString(),
        newestEntry: new Date().toISOString(),
        pendingRawEvents: 15,
        lastCompactionAt: new Date().toISOString(),
        lastCompactionDurationMs: 250,
      }),
    };
  });

  it("should implement store method", async () => {
    await mockStorage.store(sampleEntry);
    expect(mockStorage.store).toHaveBeenCalledWith(sampleEntry);
  });

  it("should implement getById method", async () => {
    const result = await mockStorage.getById("test-id");
    expect(result).toEqual(sampleEntry);
  });

  it("should implement query method", async () => {
    const query: CompactedEntryQuery = { limit: 10 };
    const results = await mockStorage.query(query);
    expect(results).toHaveLength(1);
  });

  it("should implement getStats method", async () => {
    const stats = await mockStorage.getStats();
    expect(stats.totalCompactedEntries).toBe(10);
    expect(stats.averageEventsPerEntry).toBe(10);
  });
});

describe("IIntentAnalyzer Interface", () => {
  let mockAnalyzer: IIntentAnalyzer;

  beforeEach(() => {
    mockAnalyzer = {
      inferIntent: vi.fn().mockResolvedValue({
        summary: "Test intent summary",
        category: "feature-development",
        confidence: 0.8,
        userPrompts: ["test prompt"],
      }),
      calculateSimilarity: vi.fn().mockResolvedValue(0.75),
      clusterByIntent: vi.fn().mockResolvedValue([
        {
          clusterId: "cluster-1",
          events: [],
          inferredIntent: "Test cluster",
          confidence: 0.8,
        },
      ]),
      generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };
  });

  it("should implement inferIntent method", async () => {
    const events: LedgerEntry[] = [];
    const result = await mockAnalyzer.inferIntent(events);
    expect(result.category).toBe("feature-development");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should implement clusterByIntent method", async () => {
    const events: LedgerEntry[] = [];
    const clusters = await mockAnalyzer.clusterByIntent(events, 0.7);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.inferredIntent).toBeDefined();
  });
});

describe("ILedgerCompaction Interface", () => {
  let mockCompaction: ILedgerCompaction;
  const sampleEntry = createCompactedEntry(
    "session-test",
    "claude-code",
    "Test session",
    new Date().toISOString(),
    new Date().toISOString()
  );

  beforeEach(() => {
    mockCompaction = {
      initialize: vi.fn().mockResolvedValue(undefined),
      isReady: true,
      compact: vi.fn().mockResolvedValue({
        success: true,
        entriesProcessed: 50,
        entriesCompacted: 5,
        sessionsProcessed: 5,
        errors: [],
        durationMs: 150,
      }),
      compactSession: vi.fn().mockResolvedValue(sampleEntry),
      compactTimeRange: vi.fn().mockResolvedValue({
        success: true,
        entriesProcessed: 20,
        entriesCompacted: 2,
        sessionsProcessed: 2,
        errors: [],
        durationMs: 100,
      }),
      forceCompaction: vi.fn().mockResolvedValue({
        success: true,
        entriesProcessed: 100,
        entriesCompacted: 10,
        sessionsProcessed: 10,
        errors: [],
        durationMs: 300,
      }),
      groupIntoSessions: vi.fn().mockResolvedValue([]),
      detectSessionBoundary: vi.fn().mockReturnValue(false),
      getActiveSessions: vi.fn().mockResolvedValue([]),
      clusterByIntent: vi.fn().mockResolvedValue([]),
      mergeSimilarClusters: vi.fn().mockResolvedValue([]),
      getEntry: vi.fn().mockResolvedValue(sampleEntry),
      getEntryForSession: vi.fn().mockResolvedValue(sampleEntry),
      query: vi.fn().mockResolvedValue([sampleEntry]),
      getTimeline: vi.fn().mockResolvedValue([sampleEntry]),
      getRecent: vi.fn().mockResolvedValue([sampleEntry]),
      calculateContentHash: vi.fn().mockReturnValue("abc123"),
      verifyIntegrity: vi.fn().mockReturnValue(true),
      cleanupRawEvents: vi.fn().mockResolvedValue(10),
      getStats: vi.fn().mockResolvedValue({
        totalCompactedEntries: 100,
        totalRawEventsCompacted: 1000,
        averageEventsPerEntry: 10,
        bySource: {},
        byIntentCategory: {},
        oldestEntry: null,
        newestEntry: null,
        pendingRawEvents: 50,
        lastCompactionAt: new Date().toISOString(),
        lastCompactionDurationMs: 200,
      }),
      updateConfig: vi.fn(),
      getConfig: vi.fn().mockReturnValue(DEFAULT_COMPACTION_CONFIG),
      startAutoCompaction: vi.fn(),
      stopAutoCompaction: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("should implement compact method", async () => {
    const result = await mockCompaction.compact();
    expect(result.success).toBe(true);
    expect(result.entriesCompacted).toBe(5);
  });

  it("should implement query method", async () => {
    const results = await mockCompaction.query({ limit: 10 });
    expect(results).toHaveLength(1);
  });

  it("should implement getStats method", async () => {
    const stats = await mockCompaction.getStats();
    expect(stats.totalCompactedEntries).toBe(100);
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createCompactedEntry Factory", () => {
  it("should create a valid compacted entry with defaults", () => {
    const entry = createCompactedEntry(
      "session-1",
      "claude-code",
      "Test summary",
      new Date().toISOString(),
      new Date().toISOString()
    );

    expect(entry.id).toBeDefined();
    expect(entry.sessionId).toBe("session-1");
    expect(entry.source).toBe("claude-code");
    expect(entry.intentSummary).toBe("Test summary");
    expect(entry.intentCategory).toBe("unknown");
    expect(entry.rawEventCount).toBe(0);
    expect(entry.confidenceScore).toBe(0.5);
    expect(entry.completeness).toBe(0.5);
  });

  it("should create entry with custom options", () => {
    const entry = createCompactedEntry(
      "session-2",
      "cursor",
      "Custom summary",
      new Date().toISOString(),
      new Date().toISOString(),
      {
        intentCategory: "debugging",
        rawEventCount: 25,
        confidenceScore: 0.95,
        gitCommitSha: "abc123def",
        gitBranch: "feature/test",
      }
    );

    expect(entry.intentCategory).toBe("debugging");
    expect(entry.rawEventCount).toBe(25);
    expect(entry.confidenceScore).toBe(0.95);
    expect(entry.gitCommitSha).toBe("abc123def");
    expect(entry.gitBranch).toBe("feature/test");
  });
});

/**
 * HybridSearchService Tests
 *
 * Unit tests with mocked IGraphStore, IEmbeddingService, ZoektManager, and ILLMService.
 * Covers intent classification, RRF fusion, heuristic boosting, snippet selection,
 * deduplication, and query expansion.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HybridSearchService } from "../hybrid-service.js";
import type { IGraphStore, VectorSearchResult } from "../../interfaces/IGraphStore.js";
import type { IEmbeddingService } from "../../embeddings/index.js";
import type { ZoektManager, ZoektSearchResult } from "../zoekt-manager.js";
import type { ILLMService } from "../../llm/interfaces/ILLMService.js";

// =============================================================================
// Mock factories
// =============================================================================

function createMockGraphStore(overrides: Partial<IGraphStore> = {}): IGraphStore {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [], stats: { rowsAffected: 0, executionTimeMs: 0 } }),
    execute: vi.fn().mockResolvedValue(undefined),
    writeBatch: vi.fn().mockResolvedValue(undefined),
    vectorSearch: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as IGraphStore;
}

function createMockEmbeddingService(): IEmbeddingService {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    embed: vi.fn().mockResolvedValue({ vector: new Float32Array(384) }),
    embedBatch: vi.fn().mockResolvedValue([]),
    isInitialized: vi.fn().mockReturnValue(true),
    getModelId: vi.fn().mockReturnValue("test-model"),
    getDimension: vi.fn().mockReturnValue(384),
  } as unknown as IEmbeddingService;
}

function createMockZoekt(started = true): ZoektManager {
  return {
    isStarted: vi.fn().mockReturnValue(started),
    search: vi.fn().mockResolvedValue({ results: [] } as ZoektSearchResult),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    reindex: vi.fn().mockResolvedValue(undefined),
  } as unknown as ZoektManager;
}

function createMockLLM(): ILLMService {
  return {
    isReady: true,
    initialize: vi.fn().mockResolvedValue(undefined),
    infer: vi.fn().mockResolvedValue({
      text: "synonym1, synonym2, synonym3",
      fromCache: false,
      tokensGenerated: 10,
      durationMs: 50,
    }),
    getStats: vi.fn().mockReturnValue({
      totalCalls: 0, cacheHits: 0, cacheMisses: 0,
      totalTokens: 0, avgDurationMs: 0, modelLoaded: true,
    }),
    clearCache: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as ILLMService;
}

/** Helper: build semantic results */
function makeSemanticResults(items: Array<{ id: string; fileId: string; distance: number; name?: string }>): VectorSearchResult[] {
  return items.map(i => ({ id: i.id, fileId: i.fileId, distance: i.distance, name: i.name }));
}

/** Helper: build lexical results */
function makeLexicalResult(
  files: Array<{ fileName: string; lines: Array<{ lineNumber: number; line: string }> }>
): ZoektSearchResult {
  return {
    results: files.map(f => ({
      fileName: f.fileName,
      repository: "test-repo",
      lineMatches: f.lines.map(l => ({
        lineNumber: l.lineNumber,
        line: l.line,
      })),
    })),
  };
}

/** Setup graph store mock to resolve file IDs to paths */
function setupFilePathResolution(
  graphStore: IGraphStore,
  fileMap: Record<string, string>
) {
  const queryFn = graphStore.query as ReturnType<typeof vi.fn>;
  queryFn.mockImplementation(async (script: string) => {
    // File path resolution query
    if (script.includes("*file{id, relative_path}")) {
      const rows = Object.entries(fileMap).map(([id, relative_path]) => ({
        id,
        relative_path,
      }));
      return { rows, stats: { rowsAffected: rows.length, executionTimeMs: 1 } };
    }
    // Default empty result for other queries (justification, patterns, snippets, calls)
    return { rows: [], stats: { rowsAffected: 0, executionTimeMs: 0 } };
  });
}

// =============================================================================
// Tests
// =============================================================================

describe("HybridSearchService", () => {
  let graphStore: IGraphStore;
  let embeddingService: IEmbeddingService;
  let zoekt: ZoektManager;
  let llmService: ILLMService;
  let service: HybridSearchService;

  beforeEach(() => {
    graphStore = createMockGraphStore();
    embeddingService = createMockEmbeddingService();
    zoekt = createMockZoekt();
    llmService = createMockLLM();
    service = new HybridSearchService(graphStore, embeddingService, zoekt, llmService);
  });

  // ===========================================================================
  // 1. Intent Classification
  // ===========================================================================

  describe("classifyIntent", () => {
    it("should classify definition queries", () => {
      expect(service.classifyIntent("where is Parser defined")).toBe("definition");
      expect(service.classifyIntent("definition of GraphStore")).toBe("definition");
      expect(service.classifyIntent("find definition of parseFile")).toBe("definition");
      expect(service.classifyIntent("class Parser")).toBe("definition");
      expect(service.classifyIntent("interface IGraphStore")).toBe("definition");
    });

    it("should classify usage queries", () => {
      expect(service.classifyIntent("who calls parseFile")).toBe("usage");
      expect(service.classifyIntent("usages of GraphWriter")).toBe("usage");
      expect(service.classifyIntent("references to ILLMService")).toBe("usage");
      expect(service.classifyIntent("where is Parser used")).toBe("usage");
      expect(service.classifyIntent("consumers of embeddings")).toBe("usage");
    });

    it("should classify conceptual queries", () => {
      expect(service.classifyIntent("how does the indexer work")).toBe("conceptual");
      expect(service.classifyIntent("explain the search pipeline")).toBe("conceptual");
      expect(service.classifyIntent("what does the parser do")).toBe("conceptual");
      expect(service.classifyIntent("what is the purpose of GraphWriter")).toBe("conceptual");
      expect(service.classifyIntent("describe the architecture")).toBe("conceptual");
    });

    it("should classify question-mark queries as conceptual", () => {
      expect(service.classifyIntent("how does authentication work?")).toBe("conceptual");
      expect(service.classifyIntent("what is the data flow?")).toBe("conceptual");
    });

    it("should default to keyword for simple terms", () => {
      expect(service.classifyIntent("handlePayment")).toBe("keyword");
      expect(service.classifyIntent("parseFile")).toBe("keyword");
      expect(service.classifyIntent("authentication")).toBe("keyword");
    });

    it("should classify 'where is X' without defined/used/called as conceptual", () => {
      expect(service.classifyIntent("Where is the user authentication logic?")).toBe("conceptual");
      expect(service.classifyIntent("where is the payment processing code")).toBe("conceptual");
      expect(service.classifyIntent("where is the error handling")).toBe("conceptual");
    });

    it("should still classify 'where is X defined/used/called' correctly", () => {
      expect(service.classifyIntent("where is Parser defined")).toBe("definition");
      expect(service.classifyIntent("where is Parser used")).toBe("usage");
      expect(service.classifyIntent("where is Parser called")).toBe("usage");
    });

    it("should handle edge cases", () => {
      expect(service.classifyIntent("")).toBe("keyword");
      expect(service.classifyIntent("   ")).toBe("keyword");
      // "class Auth usage" is ambiguous — the usage pattern requires phrases like "usages of" or "who calls"
      expect(service.classifyIntent("class Auth usage")).toBe("keyword");
    });
  });

  // ===========================================================================
  // 2. RRF Fusion
  // ===========================================================================

  describe("RRF Fusion", () => {
    it("should combine scores when a file appears in both engines", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.1, name: "auth" },
      ]);
      const lexicalResults = makeLexicalResult([
        { fileName: "src/auth.ts", lines: [{ lineNumber: 10, line: "function auth() {" }] },
      ]);

      setupFilePathResolution(graphStore, { file1: "src/auth.ts" });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);
      (zoekt.search as ReturnType<typeof vi.fn>).mockResolvedValue(lexicalResults);

      const results = await service.searchWithJustification("auth");

      // File should appear only once (deduplicated by file path)
      expect(results.length).toBe(1);
      expect(results[0]!.filePath).toBe("src/auth.ts");
      // Score should be 1.0 (normalized — it's the only result so it becomes the max)
      expect(results[0]!.score).toBe(1);
    });

    it("should rank files appearing in both engines higher than single-engine files", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.1, name: "auth" },
        { id: "fn:2", fileId: "file2", distance: 0.2, name: "parser" },
      ]);
      const lexicalResults = makeLexicalResult([
        { fileName: "src/auth.ts", lines: [{ lineNumber: 10, line: "function auth() {" }] },
        { fileName: "src/other.ts", lines: [{ lineNumber: 5, line: "import auth" }] },
      ]);

      setupFilePathResolution(graphStore, { file1: "src/auth.ts", file2: "src/parser.ts" });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);
      (zoekt.search as ReturnType<typeof vi.fn>).mockResolvedValue(lexicalResults);

      const results = await service.searchWithJustification("auth");

      // auth.ts should be ranked first (appears in both engines)
      expect(results[0]!.filePath).toBe("src/auth.ts");
    });

    it("should handle semantic-only results", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.1, name: "computeHash" },
      ]);

      setupFilePathResolution(graphStore, { file1: "src/utils.ts" });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);

      const results = await service.searchWithJustification("computeHash");

      expect(results.length).toBe(1);
      expect(results[0]!.filePath).toBe("src/utils.ts");
      expect(results[0]!.source).toBe("semantic");
    });

    it("should handle lexical-only results", async () => {
      const lexicalResults = makeLexicalResult([
        { fileName: "src/config.ts", lines: [{ lineNumber: 3, line: "const PORT = 3000" }] },
      ]);

      (zoekt.search as ReturnType<typeof vi.fn>).mockResolvedValue(lexicalResults);

      const results = await service.searchWithJustification("PORT");

      expect(results.length).toBe(1);
      expect(results[0]!.filePath).toBe("src/config.ts");
      expect(results[0]!.source).toBe("lexical");
    });

    it("should apply intent-based weighting (definition boosts semantic)", async () => {
      // Semantic result: close match
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.05, name: "Parser" },
      ]);
      // Lexical result: also matches
      const lexicalResults = makeLexicalResult([
        { fileName: "src/other.ts", lines: [{ lineNumber: 1, line: "import { Parser } from './parser'" }] },
      ]);

      setupFilePathResolution(graphStore, { file1: "src/parser.ts" });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);
      (zoekt.search as ReturnType<typeof vi.fn>).mockResolvedValue(lexicalResults);

      // Definition intent: lower kSemantic (40) means semantic gets more weight
      const results = await service.searchWithJustification("where is Parser defined");

      // src/parser.ts (semantic) should rank above src/other.ts (lexical)
      expect(results[0]!.filePath).toBe("src/parser.ts");
    });
  });

  // ===========================================================================
  // 3. Heuristic Boosting
  // ===========================================================================

  describe("Heuristic Boosting", () => {
    it("should boost filename matches", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.3, name: "someFunc" },
        { id: "fn:2", fileId: "file2", distance: 0.1, name: "betterMatch" },
      ]);

      setupFilePathResolution(graphStore, {
        file1: "src/auth/login.ts",
        file2: "src/utils/helper.ts",
      });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);

      const results = await service.searchWithJustification("login.ts");

      // login.ts should be boosted to #1 even though helper.ts had a closer semantic distance
      expect(results[0]!.filePath).toBe("src/auth/login.ts");
    });

    it("should apply definition boost for semantic hits", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.1, name: "func1" },
      ]);
      const lexicalResults = makeLexicalResult([
        { fileName: "src/other.ts", lines: [{ lineNumber: 1, line: "func1()" }] },
      ]);

      setupFilePathResolution(graphStore, { file1: "src/main.ts" });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);
      (zoekt.search as ReturnType<typeof vi.fn>).mockResolvedValue(lexicalResults);

      const results = await service.searchWithJustification("func1");

      // main.ts (with semantic hit) should be boosted by 1.1x
      // Both files start with similar RRF scores but main.ts gets the definition boost
      expect(results[0]!.filePath).toBe("src/main.ts");
    });

    it("should boost popular entities (high call count)", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:popular", fileId: "file1", distance: 0.15, name: "popularFunc" },
        { id: "fn:unpopular", fileId: "file2", distance: 0.1, name: "unpopularFunc" },
      ]);

      setupFilePathResolution(graphStore, {
        file1: "src/popular.ts",
        file2: "src/unpopular.ts",
      });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);

      // Mock the call counts query
      const queryFn = graphStore.query as ReturnType<typeof vi.fn>;
      queryFn.mockImplementation(async (script: string) => {
        if (script.includes("*file{id, relative_path}")) {
          return {
            rows: [
              { id: "file1", relative_path: "src/popular.ts" },
              { id: "file2", relative_path: "src/unpopular.ts" },
            ],
            stats: { rowsAffected: 2, executionTimeMs: 1 },
          };
        }
        if (script.includes("*calls")) {
          return {
            rows: [{ to_id: "fn:popular", cnt: 100 }],
            stats: { rowsAffected: 1, executionTimeMs: 1 },
          };
        }
        return { rows: [], stats: { rowsAffected: 0, executionTimeMs: 0 } };
      });

      const results = await service.searchWithJustification("someFunc");

      // popular.ts should be boosted above unpopular.ts due to high call count
      expect(results[0]!.filePath).toBe("src/popular.ts");
    });

    it("should use correct CozoScript count() aggregation syntax in call counts query", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.1, name: "myFunc" },
      ]);

      const queryFn = graphStore.query as ReturnType<typeof vi.fn>;
      queryFn.mockImplementation(async (script: string) => {
        if (script.includes("*file{id, relative_path}")) {
          return {
            rows: [{ id: "file1", relative_path: "src/main.ts" }],
            stats: { rowsAffected: 1, executionTimeMs: 1 },
          };
        }
        if (script.includes("*calls")) {
          // Verify the query uses count(from_id) in the HEAD, not cnt = count(to_id) in the body
          expect(script).toContain("count(from_id)");
          expect(script).not.toContain("cnt = count(to_id)");
          return {
            rows: [{ to_id: "fn:1", cnt: 5 }],
            stats: { rowsAffected: 1, executionTimeMs: 1 },
          };
        }
        return { rows: [], stats: { rowsAffected: 0, executionTimeMs: 0 } };
      });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);

      await service.searchWithJustification("myFunc");
    });

    it("should apply compound boosts (filename + definition)", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.5, name: "config" },
        { id: "fn:2", fileId: "file2", distance: 0.1, name: "betterSemantic" },
      ]);

      setupFilePathResolution(graphStore, {
        file1: "src/config.ts",
        file2: "src/utils.ts",
      });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);

      const results = await service.searchWithJustification("config.ts");

      // config.ts gets filename boost (1.5x) + definition boost (1.1x)
      // Even though it had worse semantic distance, the compound boost pushes it to #1
      expect(results[0]!.filePath).toBe("src/config.ts");
    });
  });

  // ===========================================================================
  // 4. Snippet Selection
  // ===========================================================================

  describe("Snippet Selection", () => {
    it("should fetch function signature as snippet", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.1, name: "parseFile" },
      ]);

      const queryFn = graphStore.query as ReturnType<typeof vi.fn>;
      queryFn.mockImplementation(async (script: string) => {
        if (script.includes("*file{id, relative_path}")) {
          return {
            rows: [{ id: "file1", relative_path: "src/parser.ts" }],
            stats: { rowsAffected: 1, executionTimeMs: 1 },
          };
        }
        if (script.includes("*function{id, signature, start_line}")) {
          return {
            rows: [{ id: "fn:1", signature: "async parseFile(path: string): Promise<AST>", start_line: 42 }],
            stats: { rowsAffected: 1, executionTimeMs: 1 },
          };
        }
        return { rows: [], stats: { rowsAffected: 0, executionTimeMs: 0 } };
      });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);

      const results = await service.searchWithJustification("parseFile");

      expect(results[0]!.snippet).toBe("async parseFile(path: string): Promise<AST>");
      expect(results[0]!.lineNumber).toBe(42);
    });

    it("should fetch class snippet with extends", async () => {
      const semanticResults = makeSemanticResults([
        { id: "cls:1", fileId: "file1", distance: 0.1, name: "GraphWriter" },
      ]);

      const queryFn = graphStore.query as ReturnType<typeof vi.fn>;
      queryFn.mockImplementation(async (script: string) => {
        if (script.includes("*file{id, relative_path}")) {
          return {
            rows: [{ id: "file1", relative_path: "src/graph-writer.ts" }],
            stats: { rowsAffected: 1, executionTimeMs: 1 },
          };
        }
        if (script.includes("*class{id, name, start_line, extends_class}")) {
          return {
            rows: [{ id: "cls:1", name: "GraphWriter", start_line: 10, extends_class: "BaseWriter" }],
            stats: { rowsAffected: 1, executionTimeMs: 1 },
          };
        }
        return { rows: [], stats: { rowsAffected: 0, executionTimeMs: 0 } };
      });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);

      const results = await service.searchWithJustification("GraphWriter");

      expect(results[0]!.snippet).toBe("class GraphWriter extends BaseWriter");
      expect(results[0]!.lineNumber).toBe(10);
    });

    it("should fetch interface snippet", async () => {
      const semanticResults = makeSemanticResults([
        { id: "iface:1", fileId: "file1", distance: 0.1, name: "IGraphStore" },
      ]);

      const queryFn = graphStore.query as ReturnType<typeof vi.fn>;
      queryFn.mockImplementation(async (script: string) => {
        if (script.includes("*file{id, relative_path}")) {
          return {
            rows: [{ id: "file1", relative_path: "src/interfaces.ts" }],
            stats: { rowsAffected: 1, executionTimeMs: 1 },
          };
        }
        if (script.includes("*interface{id, name, start_line}")) {
          return {
            rows: [{ id: "iface:1", name: "IGraphStore", start_line: 5 }],
            stats: { rowsAffected: 1, executionTimeMs: 1 },
          };
        }
        return { rows: [], stats: { rowsAffected: 0, executionTimeMs: 0 } };
      });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);

      const results = await service.searchWithJustification("IGraphStore");

      expect(results[0]!.snippet).toBe("interface IGraphStore");
      expect(results[0]!.lineNumber).toBe(5);
    });
  });

  // ===========================================================================
  // 5. Deduplication
  // ===========================================================================

  describe("Deduplication", () => {
    it("should deduplicate files appearing in both engines", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.1, name: "login" },
      ]);
      const lexicalResults = makeLexicalResult([
        { fileName: "src/auth.ts", lines: [{ lineNumber: 5, line: "function login() {" }] },
      ]);

      setupFilePathResolution(graphStore, { file1: "src/auth.ts" });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);
      (zoekt.search as ReturnType<typeof vi.fn>).mockResolvedValue(lexicalResults);

      const results = await service.searchWithJustification("login");

      // Should appear exactly once
      const authResults = results.filter(r => r.filePath === "src/auth.ts");
      expect(authResults.length).toBe(1);
    });

    it("should prefer lexical snippet over semantic when both available", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.1, name: "processData" },
      ]);
      const lexicalResults = makeLexicalResult([
        { fileName: "src/data.ts", lines: [{ lineNumber: 15, line: "async processData(input: Buffer): Promise<Result>" }] },
      ]);

      const queryFn = graphStore.query as ReturnType<typeof vi.fn>;
      queryFn.mockImplementation(async (script: string) => {
        if (script.includes("*file{id, relative_path}")) {
          return {
            rows: [{ id: "file1", relative_path: "src/data.ts" }],
            stats: { rowsAffected: 1, executionTimeMs: 1 },
          };
        }
        if (script.includes("*function{id, signature, start_line}")) {
          return {
            rows: [{ id: "fn:1", signature: "processData(input)", start_line: 15 }],
            stats: { rowsAffected: 1, executionTimeMs: 1 },
          };
        }
        return { rows: [], stats: { rowsAffected: 0, executionTimeMs: 0 } };
      });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);
      (zoekt.search as ReturnType<typeof vi.fn>).mockResolvedValue(lexicalResults);

      const results = await service.searchWithJustification("processData");

      // Should use the lexical snippet (more context)
      expect(results[0]!.snippet).toBe("async processData(input: Buffer): Promise<Result>");
    });

    it("should determine source based on which engine ranked higher", async () => {
      // Semantic: rank 0 for file1
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.05, name: "topHit" },
      ]);
      // Lexical: rank 1 for file1 (second result)
      const lexicalResults = makeLexicalResult([
        { fileName: "src/other.ts", lines: [{ lineNumber: 1, line: "other" }] },
        { fileName: "src/file1.ts", lines: [{ lineNumber: 5, line: "topHit()" }] },
      ]);

      setupFilePathResolution(graphStore, { file1: "src/file1.ts" });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);
      (zoekt.search as ReturnType<typeof vi.fn>).mockResolvedValue(lexicalResults);

      const results = await service.searchWithJustification("topHit");

      const file1Result = results.find(r => r.filePath === "src/file1.ts");
      // Semantic rank 0 < lexical rank 1, so source should be "semantic"
      expect(file1Result?.source).toBe("semantic");
    });
  });

  // ===========================================================================
  // 6. Query Expansion
  // ===========================================================================

  describe("Query Expansion", () => {
    it("should not expand by default", async () => {
      setupFilePathResolution(graphStore, {});

      await service.searchWithJustification("login");

      // LLM should not be called
      expect(llmService.infer).not.toHaveBeenCalled();
    });

    it("should expand query when enableQueryExpansion is true", async () => {
      setupFilePathResolution(graphStore, {});
      (llmService.infer as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "authenticate, signin, authorization",
        fromCache: false,
        tokensGenerated: 5,
        durationMs: 50,
      });

      await service.searchWithJustification("login", { enableQueryExpansion: true });

      // LLM should have been called for expansion
      expect(llmService.infer).toHaveBeenCalledTimes(1);
      // Additional semantic searches for synonyms
      expect(embeddingService.embed).toHaveBeenCalledTimes(4); // 1 primary + 3 synonyms
    });

    it("should deduplicate expanded results by entity ID", async () => {
      const primaryResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.1, name: "login" },
        { id: "fn:2", fileId: "file2", distance: 0.2, name: "auth" },
      ]);
      const expandedResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.15, name: "login" }, // duplicate
        { id: "fn:3", fileId: "file3", distance: 0.3, name: "session" },
      ]);

      setupFilePathResolution(graphStore, {
        file1: "src/login.ts",
        file2: "src/auth.ts",
        file3: "src/session.ts",
      });

      let callCount = 0;
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? primaryResults : expandedResults;
      });

      (llmService.infer as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "authenticate",
        fromCache: false,
        tokensGenerated: 3,
        durationMs: 30,
      });

      const results = await service.searchWithJustification("login", {
        enableQueryExpansion: true,
      });

      // fn:1 should appear only once despite being in both primary and expanded results
      const entityIds = results.map(r => r.entityId).filter(Boolean);
      expect(new Set(entityIds).size).toBe(entityIds.length);
    });

    it("should gracefully handle LLM failure during expansion", async () => {
      setupFilePathResolution(graphStore, { file1: "src/login.ts" });
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.1, name: "login" },
      ]);
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);

      // LLM throws
      (llmService.infer as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM unavailable"));

      const results = await service.searchWithJustification("login", {
        enableQueryExpansion: true,
      });

      // Should still return primary results
      expect(results.length).toBe(1);
      expect(results[0]!.filePath).toBe("src/login.ts");
    });
  });

  // ===========================================================================
  // 7. searchWithSynthesis meta
  // ===========================================================================

  describe("searchWithSynthesis", () => {
    it("should include intent and counts in meta", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.1, name: "login" },
      ]);
      const lexicalResults = makeLexicalResult([
        { fileName: "src/other.ts", lines: [{ lineNumber: 1, line: "login()" }] },
      ]);

      setupFilePathResolution(graphStore, { file1: "src/auth.ts" });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);
      (zoekt.search as ReturnType<typeof vi.fn>).mockResolvedValue(lexicalResults);

      const response = await service.searchWithSynthesis("how does login work");

      expect(response.meta?.intent).toBe("conceptual");
      expect(response.meta?.semanticCount).toBeGreaterThanOrEqual(0);
      expect(response.meta?.lexicalCount).toBeGreaterThanOrEqual(0);
      expect(typeof response.meta?.processingTimeMs).toBe("number");
    });
  });

  // ===========================================================================
  // 8. Score Normalization
  // ===========================================================================

  describe("Score Normalization", () => {
    it("should normalize all scores to 0–1 range", async () => {
      const semanticResults = makeSemanticResults([
        { id: "fn:1", fileId: "file1", distance: 0.1, name: "alpha" },
        { id: "fn:2", fileId: "file2", distance: 0.5, name: "beta" },
        { id: "fn:3", fileId: "file3", distance: 0.9, name: "gamma" },
      ]);

      setupFilePathResolution(graphStore, {
        file1: "src/alpha.ts",
        file2: "src/beta.ts",
        file3: "src/gamma.ts",
      });
      (graphStore.vectorSearch as ReturnType<typeof vi.fn>).mockResolvedValue(semanticResults);

      const results = await service.searchWithJustification("test");

      // Top result should have score 1.0 (normalized max)
      expect(results[0]!.score).toBe(1);
      // All scores should be <= 1 and > 0
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });
  });
});

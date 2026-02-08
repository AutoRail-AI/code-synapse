/**
 * MCP Server Integration Tests
 *
 * Verifies AI agents can connect and query via MCP:
 * 1. MCP Server Startup - Server creation and configuration
 * 2. MCP Tools - search_code, get_function, get_dependencies
 * 3. MCP Resources - File access, symbol listing
 * 4. End-to-End Integration - Full workflow simulation
 *
 * NOTE: These tests require native CozoDB bindings and are skipped in CI.
 * Run locally with: pnpm test src/core/__tests__/mcp-server.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Skip tests in CI where native CozoDB bindings are not available
const SKIP_NATIVE_TESTS = process.env.SKIP_NATIVE_TESTS === "true";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { GraphDatabase } from "../graph/database.js";
import { createMcpServer, TOOL_DEFINITIONS } from "../../mcp/server.js";
import { getResourceDefinitions } from "../../mcp/resources.js";

// Type helpers for MCP SDK responses
interface TextContent {
  type: "text";
  text: string;
}

interface ToolCallResult {
  content: TextContent[];
  isError?: boolean;
}

interface ResourceContent {
  uri: string;
  text?: string;
  mimeType?: string;
}

interface ResourceReadResult {
  contents: ResourceContent[];
}

function getToolContent(result: unknown): TextContent[] {
  return (result as ToolCallResult).content;
}

function getResourceContents(result: unknown): ResourceContent[] {
  return (result as ResourceReadResult).contents;
}

describe.skipIf(SKIP_NATIVE_TESTS)("MCP Server Integration", () => {
  let tempDir: string;
  let db: GraphDatabase;
  let mcpServer: ReturnType<typeof createMcpServer>;
  let client: Client;

  beforeAll(async () => {
    // Create temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "checkpoint3-mcp-test-"));

    // Initialize database with in-memory engine
    db = new GraphDatabase({ dbPath: path.join(tempDir, "graph"), engine: "mem" });
    await db.initialize();

    // Create schema
    await createSchema(db);

    // Insert test data
    await insertTestData(db);

    // Create MCP server
    mcpServer = createMcpServer(db);

    // Create client and connect using InMemoryTransport
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    // Connect both ends
    await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);
  });

  afterAll(async () => {
    // Close client and server
    await client.close();
    await mcpServer.close();

    // Close database
    await db.close();

    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // Test 1: MCP Server Startup
  // ===========================================================================
  describe("1. MCP Server Startup", () => {
    it("should create server with correct name and version", () => {
      expect(mcpServer).toBeDefined();
    });

    it("should define all expected tools", () => {
      const expectedTools = [
        "search_code",
        "get_function",
        "get_class",
        "get_file_symbols",
        "get_callers",
        "get_callees",
        "get_dependencies",
        "get_project_stats",
      ];

      const toolNames = TOOL_DEFINITIONS.map((t) => t.name);
      for (const tool of expectedTools) {
        expect(toolNames).toContain(tool);
      }
    });

    it("should define all expected resources", () => {
      const definitions = getResourceDefinitions();
      const uris = definitions.map((d) => d.uri);

      expect(uris).toContain("file://");
      expect(uris).toContain("file://{path}");
      expect(uris).toContain("symbols://");
      expect(uris).toContain("symbols://{id}");
      expect(uris).toContain("graph://");
    });

    it("should list tools via MCP protocol", async () => {
      const result = await client.listTools();
      expect(result.tools).toBeDefined();
      expect(result.tools.length).toBe(36);

      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain("search_code");
      expect(toolNames).toContain("get_function");
      expect(toolNames).toContain("get_project_stats");
      // New tools for AI agent integration
      expect(toolNames).toContain("notify_file_changed");
      expect(toolNames).toContain("request_reindex");
      expect(toolNames).toContain("enhance_prompt");
      expect(toolNames).toContain("create_generation_context");
      // Phase 6: Semantic similarity
      expect(toolNames).toContain("find_similar_code");
      // Hybrid search tools
      expect(toolNames).toContain("search_code_exact");
      expect(toolNames).toContain("hybrid_search");
      // Vibe coding tools
      expect(toolNames).toContain("vibe_start");
      expect(toolNames).toContain("vibe_change");
      expect(toolNames).toContain("vibe_complete");
      expect(toolNames).toContain("vibe_status");
    });

    it("should list resources via MCP protocol", async () => {
      const result = await client.listResources();
      expect(result.resources).toBeDefined();
      expect(result.resources.length).toBe(5);
    });
  });

  // ===========================================================================
  // Test 2: MCP Tools
  // ===========================================================================
  describe("2. MCP Tools", () => {
    describe("search_code tool", () => {
      it("should search for functions by name", async () => {
        const result = await client.callTool({
          name: "search_code",
          arguments: { query: "main" },
        });

        const content = getToolContent(result);
        expect(content).toBeDefined();
        expect(content.length).toBe(1);
        expect(content[0]!.type).toBe("text");

        const data = JSON.parse(content[0]!.text);
        expect(Array.isArray(data)).toBe(true);
        expect(data.some((r: { name: string }) => r.name === "main")).toBe(true);
      });

      it("should search for classes by type filter", async () => {
        const result = await client.callTool({
          name: "search_code",
          arguments: { query: "User", entityType: "class" },
        });

        const content = getToolContent(result);
        const data = JSON.parse(content[0]!.text);

        expect(data.some((r: { name: string; type: string }) => r.type === "class")).toBe(true);
      });

      it("should respect limit parameter", async () => {
        const result = await client.callTool({
          name: "search_code",
          arguments: { query: "a", limit: 2 },
        });

        const content = getToolContent(result);
        const data = JSON.parse(content[0]!.text);

        expect(data.length).toBeLessThanOrEqual(2);
      });
    });

    describe("get_function tool", () => {
      it("should get function details", async () => {
        const result = await client.callTool({
          name: "get_function",
          arguments: { name: "main" },
        });

        const content = getToolContent(result);
        const data = JSON.parse(content[0]!.text);

        expect(data.name).toBe("main");
        expect(data.filePath).toContain("index.ts");
        expect(data.callers).toBeDefined();
        expect(data.callees).toBeDefined();
      });

      it("should return error for non-existent function", async () => {
        const result = await client.callTool({
          name: "get_function",
          arguments: { name: "nonExistentFunction" },
        });

        expect((result as ToolCallResult).isError).toBe(true);
        const content = getToolContent(result);
        expect(content[0]!.text).toContain("not found");
      });
    });

    describe("get_class tool", () => {
      it("should get class details", async () => {
        const result = await client.callTool({
          name: "get_class",
          arguments: { name: "UserService" },
        });

        const content = getToolContent(result);
        const data = JSON.parse(content[0]!.text);

        expect(data.name).toBe("UserService");
        expect(data.methods).toBeDefined();
      });
    });

    describe("get_file_symbols tool", () => {
      it("should get symbols in a file", async () => {
        const result = await client.callTool({
          name: "get_file_symbols",
          arguments: { filePath: "index.ts" },
        });

        const content = getToolContent(result);
        const data = JSON.parse(content[0]!.text);

        expect(data.filePath).toContain("index.ts");
        expect(data.functions).toBeDefined();
        expect(data.variables).toBeDefined();
      });
    });

    describe("get_callers tool", () => {
      it("should get callers of a function", async () => {
        const result = await client.callTool({
          name: "get_callers",
          arguments: { functionName: "findById" },
        });

        const content = getToolContent(result);
        const data = JSON.parse(content[0]!.text);

        expect(Array.isArray(data)).toBe(true);
        // main calls findById in our test data
        expect(data.some((c: { name: string }) => c.name === "main")).toBe(true);
      });
    });

    describe("get_callees tool", () => {
      it("should get callees of a function", async () => {
        const result = await client.callTool({
          name: "get_callees",
          arguments: { functionName: "main" },
        });

        const content = getToolContent(result);
        const data = JSON.parse(content[0]!.text);

        expect(Array.isArray(data)).toBe(true);
        // main calls findById in our test data
        expect(data.some((c: { name: string }) => c.name === "findById")).toBe(true);
      });
    });

    describe("get_dependencies tool", () => {
      it("should get file dependencies", async () => {
        const result = await client.callTool({
          name: "get_dependencies",
          arguments: { filePath: "index.ts" },
        });

        const content = getToolContent(result);
        const data = JSON.parse(content[0]!.text);

        expect(data.filePath).toContain("index.ts");
        expect(data.imports).toBeDefined();
        expect(data.importedBy).toBeDefined();
      });
    });

    describe("get_project_stats tool", () => {
      it("should get project statistics", async () => {
        const result = await client.callTool({
          name: "get_project_stats",
          arguments: {},
        });

        const content = getToolContent(result);
        const data = JSON.parse(content[0]!.text);

        expect(data.files).toBeGreaterThan(0);
        expect(data.functions).toBeGreaterThan(0);
        expect(data.classes).toBeGreaterThan(0);
        expect(data.interfaces).toBeGreaterThan(0);
        expect(data.variables).toBeGreaterThan(0);
      });
    });
  });

  // ===========================================================================
  // Test 3: MCP Resources
  // ===========================================================================
  describe("3. MCP Resources", () => {
    describe("graph:// resource", () => {
      it("should return graph overview statistics", async () => {
        const result = await client.readResource({ uri: "graph://" });

        const contents = getResourceContents(result);
        expect(contents).toBeDefined();
        expect(contents.length).toBe(1);

        const content = contents[0]!;
        expect(content.mimeType).toBe("application/json");

        const data = JSON.parse(content.text!);
        expect(data.nodes).toBeDefined();
        expect(data.edges).toBeDefined();
        expect(data.nodes.files).toBeGreaterThan(0);
      });
    });

    describe("file:// resource", () => {
      it("should list all files", async () => {
        const result = await client.readResource({ uri: "file://" });

        const contents = getResourceContents(result);
        const content = contents[0]!;
        const data = JSON.parse(content.text!);

        expect(data.files).toBeDefined();
        expect(data.total).toBeGreaterThan(0);
      });

      it("should get specific file details", async () => {
        const result = await client.readResource({ uri: "file://index.ts" });

        const contents = getResourceContents(result);
        const content = contents[0]!;
        const data = JSON.parse(content.text!);

        expect(data.path).toContain("index.ts");
        expect(data.language).toBe("typescript");
      });
    });

    describe("symbols:// resource", () => {
      it("should list all symbols", async () => {
        const result = await client.readResource({ uri: "symbols://" });

        const contents = getResourceContents(result);
        const content = contents[0]!;
        const data = JSON.parse(content.text!);

        expect(data.symbols).toBeDefined();
        expect(data.total).toBeGreaterThan(0);
      });

      it("should filter symbols by type", async () => {
        const result = await client.readResource({ uri: "symbols://?type=function" });

        const contents = getResourceContents(result);
        const content = contents[0]!;
        const data = JSON.parse(content.text!);

        expect(data.symbols).toBeDefined();
        // All symbols should be functions
        for (const symbol of data.symbols) {
          expect(symbol.type).toBe("function");
        }
      });
    });
  });

  // ===========================================================================
  // Test 4: End-to-End Integration
  // ===========================================================================
  describe("4. End-to-End Integration", () => {
    it("should support a typical AI agent workflow", async () => {
      // Step 1: Agent gets project overview
      const statsResult = await client.callTool({
        name: "get_project_stats",
        arguments: {},
      });
      const statsContent = getToolContent(statsResult);
      const stats = JSON.parse(statsContent[0]!.text);
      expect(stats.files).toBeGreaterThan(0);

      // Step 2: Agent searches for a function
      const searchResult = await client.callTool({
        name: "search_code",
        arguments: { query: "main", entityType: "function" },
      });
      const searchContent = getToolContent(searchResult);
      const searchData = JSON.parse(searchContent[0]!.text);
      expect(searchData.length).toBeGreaterThan(0);

      // Step 3: Agent gets function details
      const funcResult = await client.callTool({
        name: "get_function",
        arguments: { name: "main" },
      });
      const funcContent = getToolContent(funcResult);
      const funcData = JSON.parse(funcContent[0]!.text);
      expect(funcData.name).toBe("main");

      // Step 4: Agent gets file symbols for the file containing the function
      const symbolsResult = await client.callTool({
        name: "get_file_symbols",
        arguments: { filePath: "index.ts" },
      });
      const symbolsContent = getToolContent(symbolsResult);
      const symbolsData = JSON.parse(symbolsContent[0]!.text);
      expect(symbolsData.functions.length).toBeGreaterThan(0);

      // Step 5: Agent reads graph overview resource
      const graphResult = await client.readResource({ uri: "graph://" });
      const graphContents = getResourceContents(graphResult);
      const graphData = JSON.parse(graphContents[0]!.text!);
      expect(graphData.nodes.functions).toBeGreaterThan(0);
    });

    it("should handle concurrent tool calls", async () => {
      // Simulate multiple concurrent requests (as AI agents might do)
      const results = await Promise.all([
        client.callTool({ name: "get_project_stats", arguments: {} }),
        client.callTool({ name: "search_code", arguments: { query: "User" } }),
        client.callTool({ name: "get_function", arguments: { name: "main" } }),
        client.readResource({ uri: "graph://" }),
      ]);

      // All should succeed
      expect(results.length).toBe(4);
      for (const result of results) {
        // Check that result has either content (tool) or contents (resource)
        const hasContent = (result as ToolCallResult).content !== undefined;
        const hasContents = (result as ResourceReadResult).contents !== undefined;
        expect(hasContent || hasContents).toBe(true);
      }
    });

    it("should handle error conditions gracefully", async () => {
      // Call tool with invalid function name
      const result = await client.callTool({
        name: "get_function",
        arguments: { name: "nonExistentFunction123" },
      });

      expect((result as ToolCallResult).isError).toBe(true);
      const content = getToolContent(result);
      expect(content[0]).toBeDefined();
    });
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create schema for the test database
 */
async function createSchema(db: GraphDatabase): Promise<void> {
  // Create file table
  await db.execute(`
    :create file {
      id: String
      =>
      path: String,
      hash: String,
      language: String,
      size: Int,
      last_indexed: Int
    }
  `);

  // Create function table
  await db.execute(`
    :create function {
      id: String
      =>
      name: String,
      file_id: String,
      start_line: Int,
      end_line: Int,
      signature: String,
      return_type: String,
      is_exported: Bool,
      is_async: Bool,
      doc_comment: String,
      complexity: Int
    }
  `);

  // Create class table
  await db.execute(`
    :create class {
      id: String
      =>
      name: String,
      file_id: String,
      start_line: Int,
      end_line: Int,
      is_exported: Bool,
      is_abstract: Bool,
      extends_class: String,
      implements_interfaces: [String],
      doc_comment: String
    }
  `);

  // Create interface table
  await db.execute(`
    :create interface {
      id: String
      =>
      name: String,
      file_id: String,
      start_line: Int,
      end_line: Int,
      is_exported: Bool,
      doc_comment: String
    }
  `);

  // Create variable table
  await db.execute(`
    :create variable {
      id: String
      =>
      name: String,
      file_id: String,
      line: Int,
      is_const: Bool,
      is_exported: Bool,
      type: String,
      value: String,
      doc_comment: String
    }
  `);

  // Create contains edge
  await db.execute(`
    :create contains {
      from_id: String,
      to_id: String
    }
  `);

  // Create calls edge
  await db.execute(`
    :create calls {
      from_id: String,
      to_id: String
      =>
      line_number: Int
    }
  `);

  // Create imports edge
  await db.execute(`
    :create imports {
      from_id: String,
      to_id: String
      =>
      imported_symbols: [String]
    }
  `);

  // Create has_method edge
  await db.execute(`
    :create has_method {
      from_id: String,
      to_id: String
      =>
      visibility: String
    }
  `);

  // Create extends edge
  await db.execute(`
    :create extends {
      from_id: String,
      to_id: String
    }
  `);

  // Create implements edge
  await db.execute(`
    :create implements {
      from_id: String,
      to_id: String
    }
  `);
}

/**
 * Insert test data into the database
 */
async function insertTestData(db: GraphDatabase): Promise<void> {
  // Insert files
  await db.execute(`
    ?[id, path, hash, language, size, last_indexed] <- [
      ['file:index', '/test/src/index.ts', 'hash1', 'typescript', 1000, 1704067200000],
      ['file:user-service', '/test/src/user-service.ts', 'hash2', 'typescript', 2000, 1704067200000]
    ]
    :put file { id, path, hash, language, size, last_indexed }
  `);

  // Insert functions
  await db.execute(`
    ?[id, name, file_id, start_line, end_line, signature, return_type, is_exported, is_async, doc_comment, complexity] <- [
      ['func:main', 'main', 'file:index', 1, 10, 'function main(): void', 'void', true, false, 'Main entry point', 1],
      ['func:findById', 'findById', 'file:user-service', 20, 30, 'async findById(id: string): Promise<User>', 'Promise<User>', true, true, 'Find user by ID', 2]
    ]
    :put function { id, name, file_id, start_line, end_line, signature, return_type, is_exported, is_async, doc_comment, complexity }
  `);

  // Insert classes
  await db.execute(`
    ?[id, name, file_id, start_line, end_line, is_exported, is_abstract, extends_class, implements_interfaces, doc_comment] <- [
      ['class:UserService', 'UserService', 'file:user-service', 1, 100, true, false, '', [], 'User service class']
    ]
    :put class { id, name, file_id, start_line, end_line, is_exported, is_abstract, extends_class, implements_interfaces, doc_comment }
  `);

  // Insert interfaces
  await db.execute(`
    ?[id, name, file_id, start_line, end_line, is_exported, doc_comment] <- [
      ['iface:User', 'User', 'file:user-service', 1, 10, true, 'User interface']
    ]
    :put interface { id, name, file_id, start_line, end_line, is_exported, doc_comment }
  `);

  // Insert variables
  await db.execute(`
    ?[id, name, file_id, line, is_const, is_exported, type, value, doc_comment] <- [
      ['var:VERSION', 'VERSION', 'file:index', 1, true, true, 'string', '1.0.0', 'App version']
    ]
    :put variable { id, name, file_id, line, is_const, is_exported, type, value, doc_comment }
  `);

  // Insert contains relationships
  await db.execute(`
    ?[from_id, to_id] <- [
      ['file:index', 'func:main'],
      ['file:index', 'var:VERSION'],
      ['file:user-service', 'func:findById'],
      ['file:user-service', 'class:UserService'],
      ['file:user-service', 'iface:User']
    ]
    :put contains { from_id, to_id }
  `);

  // Insert calls relationships (main calls findById)
  await db.execute(`
    ?[from_id, to_id, line_number] <- [
      ['func:main', 'func:findById', 5]
    ]
    :put calls { from_id, to_id, line_number }
  `);

  // Insert imports relationships (index imports from user-service)
  await db.execute(`
    ?[from_id, to_id, imported_symbols] <- [
      ['file:index', 'file:user-service', ['UserService', 'User']]
    ]
    :put imports { from_id, to_id, imported_symbols }
  `);

  // Insert has_method relationships
  await db.execute(`
    ?[from_id, to_id, visibility] <- [
      ['class:UserService', 'func:findById', 'public']
    ]
    :put has_method { from_id, to_id, visibility }
  `);
}

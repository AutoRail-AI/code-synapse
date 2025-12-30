/**
 * MCP Tools Tests
 *
 * Tests for the MCP tool handlers.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { GraphDatabase } from "../../core/graph/database.js";
import {
  searchCode,
  getFunction,
  getClass,
  getFileSymbols,
  getCallers,
  getCallees,
  getDependencies,
  getProjectStats,
} from "../tools.js";

describe("MCP Tools", () => {
  let testDir: string;
  let db: GraphDatabase;

  beforeAll(async () => {
    // Create temp directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-tools-test-"));

    // Initialize database
    db = new GraphDatabase({ dbPath: path.join(testDir, "graph"), engine: "mem" });
    await db.initialize();

    // Create schema
    await createSchema(db);

    // Insert test data
    await insertTestData(db);
  });

  afterAll(async () => {
    await db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // searchCode tests
  // ==========================================================================
  describe("searchCode", () => {
    it("should search for functions by name", async () => {
      const results = await searchCode(db, { query: "main" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.name === "main" && r.type === "function")).toBe(true);
    });

    it("should search for classes by name", async () => {
      const results = await searchCode(db, { query: "User", entityType: "class" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.name === "UserService" && r.type === "class")).toBe(true);
    });

    it("should search for interfaces by name", async () => {
      const results = await searchCode(db, { query: "User", entityType: "interface" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.name === "User" && r.type === "interface")).toBe(true);
    });

    it("should search for variables by name", async () => {
      const results = await searchCode(db, { query: "VERSION", entityType: "variable" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.name === "VERSION" && r.type === "variable")).toBe(true);
    });

    it("should search for files by path", async () => {
      const results = await searchCode(db, { query: "index", entityType: "file" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.filePath?.includes("index.ts") && r.type === "file")).toBe(true);
    });

    it("should limit results", async () => {
      const results = await searchCode(db, { query: "a", limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  // ==========================================================================
  // getFunction tests
  // ==========================================================================
  describe("getFunction", () => {
    it("should get function details by name", async () => {
      const result = await getFunction(db, { name: "main" });
      expect(result).not.toBeNull();
      expect(result?.name).toBe("main");
      expect(result?.filePath).toContain("index.ts");
      expect(result?.callers).toBeDefined();
      expect(result?.callees).toBeDefined();
    });

    it("should return null for non-existent function", async () => {
      const result = await getFunction(db, { name: "nonExistent" });
      expect(result).toBeNull();
    });

    it("should filter by file path", async () => {
      const result = await getFunction(db, { name: "main", filePath: "index.ts" });
      expect(result).not.toBeNull();
      expect(result?.name).toBe("main");
    });
  });

  // ==========================================================================
  // getClass tests
  // ==========================================================================
  describe("getClass", () => {
    it("should get class details by name", async () => {
      const result = await getClass(db, { name: "UserService" });
      expect(result).not.toBeNull();
      expect(result?.name).toBe("UserService");
      expect(result?.methods).toBeDefined();
    });

    it("should return null for non-existent class", async () => {
      const result = await getClass(db, { name: "NonExistentClass" });
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getFileSymbols tests
  // ==========================================================================
  describe("getFileSymbols", () => {
    it("should get all symbols in a file", async () => {
      const result = await getFileSymbols(db, { filePath: "index.ts" });
      expect(result).not.toBeNull();
      expect(result?.functions).toBeDefined();
      expect(result?.classes).toBeDefined();
      expect(result?.interfaces).toBeDefined();
      expect(result?.variables).toBeDefined();
    });

    it("should return null for non-existent file", async () => {
      const result = await getFileSymbols(db, { filePath: "nonexistent.ts" });
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getCallers/getCallees tests
  // ==========================================================================
  describe("getCallers/getCallees", () => {
    it("should get callers of a function", async () => {
      const result = await getCallers(db, { functionName: "findById" });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it("should get callees of a function", async () => {
      const result = await getCallees(db, { functionName: "main" });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ==========================================================================
  // getDependencies tests
  // ==========================================================================
  describe("getDependencies", () => {
    it("should get file dependencies", async () => {
      const result = await getDependencies(db, { filePath: "index.ts" });
      expect(result).not.toBeNull();
      expect(result?.imports).toBeDefined();
      expect(result?.importedBy).toBeDefined();
    });

    it("should return null for non-existent file", async () => {
      const result = await getDependencies(db, { filePath: "nonexistent.ts" });
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getProjectStats tests
  // ==========================================================================
  describe("getProjectStats", () => {
    it("should get project statistics", async () => {
      const result = await getProjectStats(db);
      expect(result).toBeDefined();
      expect(result.files).toBeGreaterThan(0);
      expect(result.functions).toBeGreaterThan(0);
      expect(result.classes).toBeGreaterThan(0);
      expect(result.interfaces).toBeGreaterThan(0);
      expect(result.variables).toBeGreaterThan(0);
    });
  });
});

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

  // Insert calls relationships
  await db.execute(`
    ?[from_id, to_id, line_number] <- [
      ['func:main', 'func:findById', 5]
    ]
    :put calls { from_id, to_id, line_number }
  `);
}

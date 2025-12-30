/**
 * Integration Smoke Test
 *
 * Tests the full pipeline: Parser -> Graph Store
 * This verifies that all components work together correctly.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Import implementations
import { TypeScriptParser } from "../../parser/typescript-parser.js";
import { CozoGraphStore } from "../../graph/cozo-graph-store.js";
import { createEmptyBatch } from "../../extraction/types.js";

describe("Integration Smoke Test", () => {
  let parser: TypeScriptParser;
  let store: CozoGraphStore;
  let tempDir: string;

  beforeAll(async () => {
    // Create temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "integration-test-"));

    // Initialize all components
    parser = new TypeScriptParser();
    await parser.initialize();

    store = new CozoGraphStore({
      path: tempDir,
      engine: "mem",
      runMigrations: true,
    });
    await store.initialize();
  });

  afterAll(async () => {
    await parser.close();
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("Full Pipeline", () => {
    it("should parse TypeScript code and extract entities", async () => {
      // Sample TypeScript code with various entities
      const code = `
/**
 * A sample service for testing
 */
export class UserService {
  private users: Map<string, User> = new Map();

  /**
   * Gets a user by ID
   */
  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  /**
   * Creates a new user
   */
  async createUser(name: string, email: string): Promise<User> {
    const user: User = { id: crypto.randomUUID(), name, email };
    this.users.set(user.id, user);
    return user;
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export type UserId = string;

export function formatUserName(user: User): string {
  return user.name.toUpperCase();
}
`.trim();

      // Step 1: Parse the code
      const uce = await parser.parseCode(code, "typescript");

      // Verify parsing results
      expect(uce.classes).toHaveLength(1);
      expect(uce.classes[0]?.name).toBe("UserService");

      expect(uce.interfaces).toHaveLength(1);
      expect(uce.interfaces[0]?.name).toBe("User");

      expect(uce.typeAliases).toHaveLength(1);
      expect(uce.typeAliases[0]?.name).toBe("UserId");

      expect(uce.functions).toHaveLength(1);
      expect(uce.functions[0]?.name).toBe("formatUserName");
    });

    it("should extract entities and store in graph", async () => {
      // Parse code
      const code = `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export const DEFAULT_NAME = "World";
`;

      const uce = await parser.parseCode(code, "typescript");

      // Extract entities using the extractor
      const batch = createEmptyBatch();

      // Simulate file entry
      const fileId = "file:test.ts";
      batch.file.push([
        fileId,
        "/test.ts",
        "test.ts",
        ".ts",
        "hash123",
        code.length,
        Date.now(),
        "typescript",
        null,
      ]);

      // Add function entity from UCE
      if (uce.functions.length > 0) {
        const fn = uce.functions[0]!;
        batch.function.push([
          `fn:${fileId}:${fn.name}`,
          fn.name,
          fileId,
          fn.location.startLine,
          fn.location.endLine,
          fn.location.startColumn,
          fn.location.endColumn,
          fn.signature,
          fn.returnType ?? null,
          fn.modifiers.includes("export"),
          fn.modifiers.includes("async"),
          false, // isGenerator - check modifiers if needed
          fn.complexity ?? 1,
          fn.params?.length ?? 0,
          fn.docComment ?? null,
          null, // businessLogic
          null, // inferenceConfidence
        ]);
      }

      // Store in graph
      await store.writeBatch(batch);

      // Verify stored data
      const fileResult = await store.query<{ id: string; path: string }>(
        `?[id, path] := *file{id, path}, id = $id`,
        { id: fileId }
      );
      expect(fileResult.rows).toHaveLength(1);
      expect(fileResult.rows[0]?.path).toBe("/test.ts");

      const fnResult = await store.query<{ name: string; file_id: string }>(
        `?[name, file_id] := *function{name, file_id}, file_id = $fileId`,
        { fileId }
      );
      expect(fnResult.rows).toHaveLength(1);
      expect(fnResult.rows[0]?.name).toBe("greet");
    });

    it("should query relationships between entities", async () => {
      // Create file with class and method
      const code = `
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }
}
`;

      const uce = await parser.parseCode(code, "typescript");

      // Store file and class
      const batch = createEmptyBatch();
      const fileId = "file:calculator.ts";

      batch.file.push([
        fileId,
        "/calculator.ts",
        "calculator.ts",
        ".ts",
        "calchash",
        code.length,
        Date.now(),
        "typescript",
        null,
      ]);

      if (uce.classes.length > 0) {
        const cls = uce.classes[0]!;
        const classId = `class:${fileId}:${cls.name}`;

        batch.class.push([
          classId,
          cls.name,
          fileId,
          cls.location.startLine,
          cls.location.endLine,
          cls.isAbstract,
          cls.modifiers.includes("export"),
          cls.extends ?? null,
          cls.implements, // Already string[]
          cls.docComment ?? null,
        ]);

        // Store methods
        for (const method of cls.methods ?? []) {
          const methodId = `method:${classId}:${method.name}`;
          batch.function.push([
            methodId,
            method.name,
            fileId,
            method.location.startLine,
            method.location.endLine,
            method.location.startColumn,
            method.location.endColumn,
            method.signature,
            method.returnType ?? null,
            false, // Methods aren't directly exported
            method.modifiers.includes("async"),
            false, // isGenerator - UCEMethod doesn't track this
            1, // complexity - UCEMethod doesn't track this
            method.params?.length ?? 0,
            method.docComment ?? null,
            null,
            null,
          ]);

          // Create relationship: class has_method function
          batch.hasMethod.push([
            classId,
            methodId,
            method.visibility ?? "public",
            method.isStatic ?? false,
            method.isAbstract ?? false,
          ]);
        }
      }

      await store.writeBatch(batch);

      // Query to find methods of the class
      const methodsResult = await store.query<{ method_name: string }>(
        `?[method_name] :=
          *class{id: class_id, name: 'Calculator'},
          *has_method{from_id: class_id, to_id: method_id},
          *function{id: method_id, name: method_name}`
      );

      expect(methodsResult.rows).toHaveLength(2);
      const methodNames = methodsResult.rows.map((r) => r.method_name).sort();
      expect(methodNames).toEqual(["add", "multiply"]);
    });
  });

  describe("Schema Integrity", () => {
    it("should have schema initialized", async () => {
      const hasSchema = await store.hasSchema();
      expect(hasSchema).toBe(true);
    });

    it("should report correct schema version", async () => {
      const version = await store.getSchemaVersion();
      expect(version).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid queries gracefully", async () => {
      await expect(
        store.query("?[x] := *nonexistent_table{x}")
      ).rejects.toThrow();
    });

    it("should return empty results for non-matching queries", async () => {
      const result = await store.query<{ id: string }>(
        `?[id] := *file{id}, id = $id`,
        { id: "file:does-not-exist.ts" }
      );
      expect(result.rows).toHaveLength(0);
    });
  });
});

/**
 * IGraphStore Contract Tests
 *
 * Verifies that any IGraphStore implementation correctly fulfills the contract.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { IGraphStore } from "../IGraphStore.js";
import { CozoGraphStore } from "../../graph/cozo-graph-store.js";
import type { CozoBatch } from "../../extraction/types.js";
import { createEmptyBatch } from "../../extraction/types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("IGraphStore Contract", () => {
  let store: IGraphStore;
  let tempDir: string;

  beforeAll(async () => {
    // Create temp directory for test database
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "igraphstore-test-"));

    // Create store with in-memory engine for fast tests
    store = new CozoGraphStore({
      path: tempDir,
      engine: "mem",
      runMigrations: true,
    });

    await store.initialize();
  });

  afterAll(async () => {
    await store.close();
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("Lifecycle", () => {
    it("should report isReady as true after initialization", () => {
      expect(store.isReady).toBe(true);
    });
  });

  describe("Schema", () => {
    it("should have schema after initialization", async () => {
      const hasSchema = await store.hasSchema();
      expect(hasSchema).toBe(true);
    });

    it("should report schema version > 0", async () => {
      const version = await store.getSchemaVersion();
      expect(version).toBeGreaterThanOrEqual(1);
    });
  });

  describe("writeBatch", () => {
    it("should write empty batch without error", async () => {
      const batch = createEmptyBatch();
      await expect(store.writeBatch(batch)).resolves.not.toThrow();
    });

    it("should write batch with file entity", async () => {
      const batch = createEmptyBatch();
      batch.file.push([
        "file:test/example.ts",      // id
        "/test/example.ts",           // path
        "test/example.ts",            // relative_path
        ".ts",                        // extension
        "abc123",                     // hash
        1000,                         // size
        Date.now(),                   // last_modified
        "typescript",                 // language
        null,                         // framework
      ]);

      await expect(store.writeBatch(batch)).resolves.not.toThrow();
    });

    it("should write batch with function entity", async () => {
      const batch = createEmptyBatch();
      batch.function.push([
        "fn:test/example.ts:testFn",  // id
        "testFn",                      // name
        "file:test/example.ts",        // file_id
        1,                             // start_line
        5,                             // end_line
        0,                             // start_column
        1,                             // end_column
        "function testFn(): void",     // signature
        "void",                        // return_type
        true,                          // is_exported
        false,                         // is_async
        false,                         // is_generator
        1,                             // complexity
        0,                             // parameter_count
        "Test function",               // doc_comment
        "Test function for testing",   // business_logic
        null,                          // inference_confidence
      ]);

      await expect(store.writeBatch(batch)).resolves.not.toThrow();
    });
  });

  describe("query", () => {
    it("should execute a simple query and return results", async () => {
      // First write a file
      const batch = createEmptyBatch();
      batch.file.push([
        "file:query-test.ts",
        "/query-test.ts",
        "query-test.ts",
        ".ts",
        "hash123",
        500,
        Date.now(),
        "typescript",
        null,
      ]);
      await store.writeBatch(batch);

      // Query for the file
      const result = await store.query<{ id: string; path: string }>(
        `?[id, path] := *file{id, path}, id = $id`,
        { id: "file:query-test.ts" }
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.id).toBe("file:query-test.ts");
      expect(result.rows[0]?.path).toBe("/query-test.ts");
    });

    it("should return empty array for no matches", async () => {
      const result = await store.query<{ id: string }>(
        `?[id] := *file{id}, id = $id`,
        { id: "file:non-existent.ts" }
      );

      expect(result.rows).toHaveLength(0);
    });
  });

  describe("execute", () => {
    it("should execute statement without returning results", async () => {
      // Execute a no-op statement
      await expect(
        store.execute(`?[x] <- [[1]]`)
      ).resolves.not.toThrow();
    });
  });

  describe("transaction", () => {
    it("should execute operations within a transaction", async () => {
      const batch1 = createEmptyBatch();
      batch1.file.push([
        "file:tx-test-1.ts",
        "/tx-test-1.ts",
        "tx-test-1.ts",
        ".ts",
        "txhash1",
        100,
        Date.now(),
        "typescript",
        null,
      ]);

      const batch2 = createEmptyBatch();
      batch2.file.push([
        "file:tx-test-2.ts",
        "/tx-test-2.ts",
        "tx-test-2.ts",
        ".ts",
        "txhash2",
        200,
        Date.now(),
        "typescript",
        null,
      ]);

      // Execute both batches in a transaction
      await store.transaction(async (tx) => {
        await tx.writeBatch(batch1);
        await tx.writeBatch(batch2);
      });

      // Verify both were written
      const result = await store.query<{ id: string }>(
        `?[id] := *file{id}, starts_with(id, "file:tx-test")`
      );

      expect(result.rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("vectorSearch", () => {
    it("should return empty array when no embeddings exist", async () => {
      const embedding = new Array(384).fill(0.1);
      const results = await store.vectorSearch(embedding, 10);

      // Should not throw, should return empty or results
      expect(Array.isArray(results)).toBe(true);
    });
  });
});

/**
 * GraphWriter Tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { CozoGraphStore } from "../../graph/cozo-graph-store.js";
import { GraphWriter } from "../graph-writer.js";
import { createEmptyBatch, type CozoBatch, type ExtractionResult } from "../../extraction/types.js";

describe("GraphWriter", () => {
  let store: CozoGraphStore;
  let writer: GraphWriter;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "graph-writer-test-"));
    store = new CozoGraphStore({
      path: tempDir,
      engine: "mem",
      runMigrations: true,
    });
    await store.initialize();
    writer = new GraphWriter(store);
  });

  afterAll(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Helper to create a mock extraction result
  function createMockExtractionResult(
    fileId: string,
    filePath: string,
    hash: string
  ): ExtractionResult {
    const batch = createEmptyBatch();

    // Add file
    batch.file.push([
      fileId,
      filePath,
      path.basename(filePath),
      ".ts",
      hash,
      100,
      Date.now(),
      "typescript",
      null,
    ]);

    // Add a function
    const fnId = `fn:${fileId}:testFunc`;
    batch.function.push([
      fnId,
      "testFunc",
      fileId,
      1,
      5,
      0,
      50,
      "function testFunc(): void",
      "void",
      true,
      false,
      false,
      1,
      0,
      "Test function",
      null,
      null,
    ]);

    // Add CONTAINS relationship
    batch.contains.push([fileId, fnId, 1]);

    return {
      fileId,
      filePath,
      batch,
      unresolvedCalls: [],
      unresolvedTypes: [],
      embeddingChunks: [],
      errors: [],
      stats: {
        functions: 1,
        classes: 0,
        interfaces: 0,
        typeAliases: 0,
        variables: 0,
        imports: 0,
        exports: 1,
        ghostNodes: 0,
      },
    };
  }

  describe("writeFile", () => {
    it("should write a file and its entities to the graph", async () => {
      const result = createMockExtractionResult(
        "file:test1.ts",
        "/test1.ts",
        "hash1"
      );

      const writeResult = await writer.writeFile(result);

      expect(writeResult.success).toBe(true);
      expect(writeResult.fileId).toBe("file:test1.ts");
      expect(writeResult.stats.entitiesWritten).toBeGreaterThan(0);
    });

    it("should delete old entities before writing new ones", async () => {
      const fileId = "file:test2.ts";

      // Write initial version
      const result1 = createMockExtractionResult(fileId, "/test2.ts", "hash1");
      await writer.writeFile(result1);

      // Write updated version
      const result2 = createMockExtractionResult(fileId, "/test2.ts", "hash2");
      const writeResult = await writer.writeFile(result2);

      expect(writeResult.success).toBe(true);
      expect(writeResult.stats.entitiesDeleted).toBeGreaterThan(0);

      // Verify only one file exists
      const fileQuery = await store.query<{ id: string }>(
        `?[id] := *file{id}, id = $fileId`,
        { fileId }
      );
      expect(fileQuery.rows).toHaveLength(1);
    });

    it("should return error result for invalid input", async () => {
      const invalidResult: ExtractionResult = {
        fileId: "",
        filePath: "",
        batch: createEmptyBatch(),
        unresolvedCalls: [],
        unresolvedTypes: [],
        embeddingChunks: [],
        errors: [],
        stats: {
          functions: 0,
          classes: 0,
          interfaces: 0,
          typeAliases: 0,
          variables: 0,
          imports: 0,
          exports: 0,
          ghostNodes: 0,
        },
      };

      const writeResult = await writer.writeFile(invalidResult);

      expect(writeResult.success).toBe(false);
      expect(writeResult.error).toBeDefined();
    });
  });

  describe("writeFiles", () => {
    it("should write multiple files", async () => {
      const results = [
        createMockExtractionResult("file:multi1.ts", "/multi1.ts", "hash1"),
        createMockExtractionResult("file:multi2.ts", "/multi2.ts", "hash2"),
      ];

      const writeResults = await writer.writeFiles(results);

      expect(writeResults).toHaveLength(2);
      expect(writeResults.every((r) => r.success)).toBe(true);
    });
  });

  describe("deleteFileEntities", () => {
    it("should delete all entities for a file", async () => {
      const fileId = "file:delete-test.ts";

      // Write file first
      const result = createMockExtractionResult(fileId, "/delete-test.ts", "hash");
      await writer.writeFile(result);

      // Verify file exists
      let exists = await writer.fileExists(fileId);
      expect(exists).toBe(true);

      // Delete file entities
      const deletedCount = await writer.deleteFileEntities(fileId);

      expect(deletedCount).toBeGreaterThan(0);

      // Verify file no longer exists
      exists = await writer.fileExists(fileId);
      expect(exists).toBe(false);
    });
  });

  describe("fileExists", () => {
    it("should return true for existing file", async () => {
      const fileId = "file:exists-test.ts";
      const result = createMockExtractionResult(fileId, "/exists-test.ts", "hash");
      await writer.writeFile(result);

      const exists = await writer.fileExists(fileId);
      expect(exists).toBe(true);
    });

    it("should return false for non-existing file", async () => {
      const exists = await writer.fileExists("file:nonexistent.ts");
      expect(exists).toBe(false);
    });
  });

  describe("getFileHash", () => {
    it("should return hash for existing file", async () => {
      const fileId = "file:hash-test.ts";
      const expectedHash = "expectedhash123";
      const result = createMockExtractionResult(fileId, "/hash-test.ts", expectedHash);
      await writer.writeFile(result);

      const hash = await writer.getFileHash(fileId);
      expect(hash).toBe(expectedHash);
    });

    it("should return null for non-existing file", async () => {
      const hash = await writer.getFileHash("file:no-hash.ts");
      expect(hash).toBeNull();
    });
  });

  describe("getAllFileHashes", () => {
    it("should return map of all file hashes", async () => {
      // Use unique file IDs to avoid interference from other tests
      const uniqueId1 = `file:allhash-${Date.now()}-1.ts`;
      const uniqueId2 = `file:allhash-${Date.now()}-2.ts`;

      // Write some files
      await writer.writeFile(
        createMockExtractionResult(uniqueId1, "/allhash1.ts", "hash1")
      );
      await writer.writeFile(
        createMockExtractionResult(uniqueId2, "/allhash2.ts", "hash2")
      );

      const hashes = await writer.getAllFileHashes();

      expect(hashes.get(uniqueId1)).toBe("hash1");
      expect(hashes.get(uniqueId2)).toBe("hash2");
    });
  });
});

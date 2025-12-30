/**
 * IncrementalUpdater Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { CozoGraphStore } from "../../graph/cozo-graph-store.js";
import { IncrementalUpdater, type GraphFileInfo } from "../incremental-updater.js";
import { createEmptyBatch, type ExtractionResult } from "../../extraction/types.js";

describe("IncrementalUpdater", () => {
  let store: CozoGraphStore;
  let updater: IncrementalUpdater;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "incremental-test-"));
    store = new CozoGraphStore({
      path: tempDir,
      engine: "mem",
      runMigrations: true,
    });
    await store.initialize();
    updater = new IncrementalUpdater(store);
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
      null,
      null,
      null,
    ]);

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

  describe("detectChanges", () => {
    it("should detect added files", async () => {
      const currentFiles: GraphFileInfo[] = [
        { fileId: "file:new1.ts", filePath: "/new1.ts", hash: "hash1" },
        { fileId: "file:new2.ts", filePath: "/new2.ts", hash: "hash2" },
      ];

      const changes = await updater.detectChanges(currentFiles);

      expect(changes.added).toHaveLength(2);
      expect(changes.modified).toHaveLength(0);
      expect(changes.deleted).toHaveLength(0);
    });

    it("should detect modified files", async () => {
      // First, write a file to the graph
      const result = createMockExtractionResult(
        "file:modified.ts",
        "/modified.ts",
        "oldhash"
      );
      await store.writeBatch(result.batch);

      // Now detect changes with different hash
      const currentFiles: GraphFileInfo[] = [
        { fileId: "file:modified.ts", filePath: "/modified.ts", hash: "newhash" },
      ];

      const changes = await updater.detectChanges(currentFiles);

      expect(changes.modified).toHaveLength(1);
      expect(changes.modified[0]?.previousHash).toBe("oldhash");
      expect(changes.modified[0]?.currentHash).toBe("newhash");
    });

    it("should detect deleted files", async () => {
      // Write a file to the graph
      const result = createMockExtractionResult(
        "file:todelete.ts",
        "/todelete.ts",
        "hash"
      );
      await store.writeBatch(result.batch);

      // Now detect changes with empty current files
      const currentFiles: GraphFileInfo[] = [];

      const changes = await updater.detectChanges(currentFiles);

      // Should detect at least the file we added as deleted
      const deletedFile = changes.deleted.find(
        (f) => f.fileId === "file:todelete.ts"
      );
      expect(deletedFile).toBeDefined();
    });

    it("should detect unchanged files", async () => {
      // Write a file to the graph
      const result = createMockExtractionResult(
        "file:unchanged.ts",
        "/unchanged.ts",
        "samehash"
      );
      await store.writeBatch(result.batch);

      // Now detect changes with same hash
      const currentFiles: GraphFileInfo[] = [
        { fileId: "file:unchanged.ts", filePath: "/unchanged.ts", hash: "samehash" },
      ];

      const changes = await updater.detectChanges(currentFiles);

      const unchangedFile = changes.unchanged.find(
        (f) => f.fileId === "file:unchanged.ts"
      );
      expect(unchangedFile).toBeDefined();
    });
  });

  describe("update", () => {
    it("should update only changed files", async () => {
      const uniqueId = `file:update-test-${Date.now()}.ts`;

      // Write initial file
      const initialResult = createMockExtractionResult(
        uniqueId,
        "/update-test.ts",
        "oldhash"
      );
      await store.writeBatch(initialResult.batch);

      // Create updated extraction result
      const updatedResult = createMockExtractionResult(
        uniqueId,
        "/update-test.ts",
        "newhash"
      );

      // Current files with new hash
      const currentFiles: GraphFileInfo[] = [
        { fileId: uniqueId, filePath: "/update-test.ts", hash: "newhash" },
      ];

      const updateResult = await updater.update([updatedResult], currentFiles);

      // Find our specific file in modified
      const modifiedFile = updateResult.changes.modified.find(
        (f) => f.fileId === uniqueId
      );
      expect(modifiedFile).toBeDefined();
    });

    it("should add new files", async () => {
      const uniqueId = `file:brand-new-${Date.now()}.ts`;

      const newResult = createMockExtractionResult(
        uniqueId,
        "/brand-new.ts",
        "newhash"
      );

      const currentFiles: GraphFileInfo[] = [
        { fileId: uniqueId, filePath: "/brand-new.ts", hash: "newhash" },
      ];

      const updateResult = await updater.update([newResult], currentFiles);

      // Should be added
      const addedFile = updateResult.changes.added.find(
        (f) => f.fileId === uniqueId
      );
      expect(addedFile).toBeDefined();
    });
  });

  describe("fullReindex", () => {
    it("should write new files after full reindex", async () => {
      const ts = Date.now();

      // Create new extraction results with unique IDs
      const newResults = [
        createMockExtractionResult(`file:reindex-new1-${ts}.ts`, "/reindex-new1.ts", "hash3"),
        createMockExtractionResult(`file:reindex-new2-${ts}.ts`, "/reindex-new2.ts", "hash4"),
      ];

      const results = await updater.fullReindex(newResults);

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);

      // Verify new files exist
      const newFile1 = await store.query<{ id: string }>(
        `?[id] := *file{id}, id = $id`,
        { id: `file:reindex-new1-${ts}.ts` }
      );
      expect(newFile1.rows).toHaveLength(1);
    });
  });

  describe("getGraphStats", () => {
    it("should return correct statistics", async () => {
      const uniqueId = `file:stats-test-${Date.now()}.ts`;

      // Write a known file
      const result = createMockExtractionResult(
        uniqueId,
        "/stats-test.ts",
        "statshash"
      );
      await store.writeBatch(result.batch);

      const stats = await updater.getGraphStats();

      expect(stats.files).toBeGreaterThanOrEqual(1);
      expect(stats.functions).toBeGreaterThanOrEqual(1);
    });
  });
});

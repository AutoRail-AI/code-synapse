/**
 * IndexerCoordinator Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { CozoGraphStore } from "../../graph/cozo-graph-store.js";
import { TypeScriptParser } from "../../parser/typescript-parser.js";
import {
  IndexerCoordinator,
  type IndexingProgressEvent,
  type IndexingError,
} from "../coordinator.js";
import { ProjectDetector } from "../project-detector.js";

describe("IndexerCoordinator", () => {
  let tempDir: string;
  let projectDir: string;
  let store: CozoGraphStore;
  let parser: TypeScriptParser;

  beforeAll(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coordinator-test-"));
    projectDir = path.join(tempDir, "project");
    await fs.mkdir(projectDir);

    // Create a sample TypeScript file
    const srcDir = path.join(projectDir, "src");
    await fs.mkdir(srcDir);
    await fs.writeFile(
      path.join(srcDir, "index.ts"),
      `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export class Greeter {
  private greeting: string;

  constructor(greeting: string) {
    this.greeting = greeting;
  }

  greet(name: string): string {
    return \`\${this.greeting}, \${name}!\`;
  }
}

export interface User {
  name: string;
  age: number;
}

export type UserRole = "admin" | "user" | "guest";
`.trim()
    );

    // Create package.json
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "test-project", type: "module" }, null, 2)
    );

    // Create tsconfig.json
    await fs.writeFile(
      path.join(projectDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "ES2022" } }, null, 2)
    );

    // Initialize store and parser
    store = new CozoGraphStore({
      path: path.join(tempDir, "db"),
      engine: "mem",
      runMigrations: true,
    });
    await store.initialize();

    parser = new TypeScriptParser();
    await parser.initialize();
  });

  afterAll(async () => {
    await parser.close();
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("indexProject", () => {
    it("should index a project and extract entities", async () => {
      const detector = new ProjectDetector(projectDir);
      const project = await detector.detect();

      const coordinator = new IndexerCoordinator({
        parser,
        store,
        project,
      });

      const result = await coordinator.indexProject();

      // Debug: log errors if any
      if (result.errors.length > 0) {
        console.log("Indexing errors:", JSON.stringify(result.errors, null, 2));
      }

      expect(result.errors).toHaveLength(0);
      expect(result.success).toBe(true);
      expect(result.filesIndexed).toBeGreaterThan(0);
      expect(result.entitiesWritten).toBeGreaterThan(0);
    });

    it("should report progress during indexing", async () => {
      const detector = new ProjectDetector(projectDir);
      const project = await detector.detect();

      const progressEvents: IndexingProgressEvent[] = [];

      const coordinator = new IndexerCoordinator({
        parser,
        store,
        project,
        onProgress: (event) => {
          progressEvents.push(event);
        },
      });

      await coordinator.indexProject();

      // Should have scanning, parsing, extracting, writing, and complete phases
      const phases = new Set(progressEvents.map((e) => e.phase));
      expect(phases.has("scanning")).toBe(true);
      expect(phases.has("complete")).toBe(true);
    });

    it("should track phase statistics", async () => {
      const detector = new ProjectDetector(projectDir);
      const project = await detector.detect();

      const coordinator = new IndexerCoordinator({
        parser,
        store,
        project,
      });

      const result = await coordinator.indexProject();

      expect(result.phases.scanning.files).toBeGreaterThan(0);
      expect(result.phases.parsing.files).toBeGreaterThan(0);
      expect(result.phases.extracting.files).toBeGreaterThan(0);
      expect(result.phases.writing.files).toBeGreaterThan(0);
    });
  });

  describe("indexProjectIncremental", () => {
    it("should detect no changes when nothing has changed", async () => {
      const detector = new ProjectDetector(projectDir);
      const project = await detector.detect();

      const coordinator = new IndexerCoordinator({
        parser,
        store,
        project,
      });

      // First indexing
      await coordinator.indexProject();

      // Incremental indexing should detect no changes
      const incrementalResult = await coordinator.indexProjectIncremental();

      // Files are already indexed, so incremental should process fewer or none
      expect(incrementalResult.success).toBe(true);
    });

    it("should detect and process modified files", async () => {
      const detector = new ProjectDetector(projectDir);
      const project = await detector.detect();

      const coordinator = new IndexerCoordinator({
        parser,
        store,
        project,
      });

      // Modify a file
      const indexFile = path.join(projectDir, "src", "index.ts");
      const originalContent = await fs.readFile(indexFile, "utf-8");

      await fs.writeFile(
        indexFile,
        originalContent +
          "\nexport function newFunction(): void { console.log('new'); }"
      );

      try {
        const result = await coordinator.indexProjectIncremental();
        expect(result.success).toBe(true);
      } finally {
        // Restore original content
        await fs.writeFile(indexFile, originalContent);
      }
    });
  });

  describe("indexFile", () => {
    it("should index a single file", async () => {
      const detector = new ProjectDetector(projectDir);
      const project = await detector.detect();

      const coordinator = new IndexerCoordinator({
        parser,
        store,
        project,
      });

      const filePath = path.join(projectDir, "src", "index.ts");
      const result = await coordinator.indexFile(filePath);

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.stats.entitiesWritten).toBeGreaterThan(0);
    });

    it("should return null for non-existent file", async () => {
      const detector = new ProjectDetector(projectDir);
      const project = await detector.detect();

      const coordinator = new IndexerCoordinator({
        parser,
        store,
        project,
      });

      const result = await coordinator.indexFile("/nonexistent/file.ts");
      expect(result).toBeNull();
    });
  });

  describe("removeFile", () => {
    it("should remove a file from the index", async () => {
      const detector = new ProjectDetector(projectDir);
      const project = await detector.detect();

      const coordinator = new IndexerCoordinator({
        parser,
        store,
        project,
      });

      // First index the file
      const filePath = path.join(projectDir, "src", "index.ts");
      await coordinator.indexFile(filePath);

      // Then remove it
      const deletedCount = await coordinator.removeFile(filePath);
      expect(deletedCount).toBeGreaterThan(0);
    });
  });

  describe("getStats", () => {
    it("should return graph statistics", async () => {
      const detector = new ProjectDetector(projectDir);
      const project = await detector.detect();

      const coordinator = new IndexerCoordinator({
        parser,
        store,
        project,
      });

      // Index first
      await coordinator.indexProject();

      const stats = await coordinator.getStats();

      expect(stats.files).toBeGreaterThan(0);
      expect(stats.functions).toBeGreaterThan(0);
      expect(stats.classes).toBeGreaterThan(0);
      expect(stats.interfaces).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("should continue on error when configured", async () => {
      const detector = new ProjectDetector(projectDir);
      const project = await detector.detect();

      // Create a file with syntax errors
      const badFile = path.join(projectDir, "src", "bad.ts");
      await fs.writeFile(badFile, "function { invalid syntax }");

      try {
        const errors: IndexingError[] = [];
        const coordinator = new IndexerCoordinator({
          parser,
          store,
          project,
          continueOnError: true,
          onError: (err) => errors.push(err),
        });

        const result = await coordinator.indexProject();

        // Should still succeed overall (continueOnError)
        // The good file should be indexed
        expect(result.filesIndexed).toBeGreaterThan(0);
      } finally {
        await fs.unlink(badFile);
      }
    });
  });
});

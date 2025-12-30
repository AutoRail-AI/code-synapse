# Architecture Refactor Plan

**Based on**: Architecture Review (December 30, 2025)
**Current State**: V1-V5 Complete (Graph, Scanner, Parser, Semantic, Extraction)
**Created**: December 30, 2025

---

## Executive Summary

This document translates the Architecture Review recommendations into actionable implementation tasks. The review identified several high-impact improvements to simplify the codebase, improve testability, and reduce risk.

### Top 3 Priorities

1. **Storage Consolidation** - Remove LanceDB, use CozoDB's native HNSW vector indices
2. **Interface Extraction** - Define explicit contracts (IParser, IGraphStore, IExtractor, etc.)
3. **Pipeline Atomicity** - Implement Unit of Work pattern for coordinated writes

### Current State Assessment

| Component | Status | Notes |
|-----------|--------|-------|
| V5 Entity Extraction | ✅ Complete | Already uses CozoBatch pattern |
| LanceDB | ⚠️ Stub only | Never fully implemented - easy to remove |
| Orama | ⚠️ Stub only | Planned for V8 - can defer |
| Interface definitions | ❌ Missing | Concrete classes used directly |
| Contract tests | ❌ Missing | No interface compliance tests |
| Worker thread | ✅ Implemented | May be premature but works |

---

## Phase 0: Interface Extraction

**Goal**: Define all module interfaces without changing implementations
**Effort**: 1-2 days
**Risk**: Low (additive changes only)

### Tasks

#### 0.1 Create Interface Directory Structure

```
src/core/interfaces/
├── index.ts           # Re-exports all interfaces
├── IParser.ts         # Parser interface
├── IGraphStore.ts     # Graph database interface
├── IScanner.ts        # File scanner interface
├── ISemanticAnalyzer.ts # Semantic analysis interface
├── IExtractor.ts      # Entity extraction interface
└── IKnowledgeStore.ts # Unified storage facade (new)
```

#### 0.2 Define IParser Interface

**File**: `src/core/interfaces/IParser.ts`

```typescript
/**
 * IParser - Universal code parser interface
 *
 * Converts source code files into Universal Code Entities (UCE),
 * abstracting over parser implementations (Tree-sitter, Babel, etc).
 */
export interface IParser {
  /**
   * Parse a file from disk
   * @param filePath - Absolute path to source file
   * @throws FileNotFoundError if file doesn't exist
   * @throws UnsupportedLanguageError if language not supported
   */
  parseFile(filePath: string): Promise<UCEFile>;

  /**
   * Parse source code string
   * @param code - Source code content
   * @param language - Language identifier ("typescript", "javascript", etc)
   */
  parseCode(code: string, language: string): UCEFile;

  /**
   * Get list of supported language identifiers
   */
  getSupportedLanguages(): string[];

  /**
   * Initialize the parser (load WASM, etc)
   */
  initialize(): Promise<void>;
}
```

**Implementation Changes**:
- Update `TypeScriptParser` to implement `IParser`
- Create factory function `createParser(): IParser`
- Export interface from `src/core/parser/index.ts`

#### 0.3 Define IGraphStore Interface

**File**: `src/core/interfaces/IGraphStore.ts`

```typescript
/**
 * IGraphStore - Abstract graph database interface
 *
 * Provides transactional graph storage with support for:
 * - Atomic batch writes
 * - Query execution
 * - Vector similarity search (via CozoDB HNSW)
 */
export interface IGraphStore {
  /**
   * Write entities atomically in single transaction
   */
  write(entities: GraphEntity[]): Promise<void>;

  /**
   * Execute query against graph
   * @param query - CozoScript/Datalog query
   * @param params - Query parameters
   */
  query(query: string, params?: Record<string, unknown>): Promise<QueryResult>;

  /**
   * Execute function in transaction
   */
  transaction<T>(fn: (tx: ITransaction) => Promise<T>): Promise<T>;

  /**
   * Vector similarity search
   * @param embedding - Query vector
   * @param k - Number of results
   */
  vectorSearch(embedding: number[], k: number): Promise<VectorSearchResult[]>;

  /**
   * Close database connection
   */
  close(): Promise<void>;
}

export interface ITransaction {
  write(entities: GraphEntity[]): Promise<void>;
  query(query: string, params?: Record<string, unknown>): Promise<QueryResult>;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  stats: { rowsAffected: number; executionTimeMs: number };
}

export interface VectorSearchResult {
  id: string;
  distance: number;
  entity?: GraphEntity;
}
```

#### 0.4 Define IScanner Interface

**File**: `src/core/interfaces/IScanner.ts`

```typescript
/**
 * IScanner - File discovery interface
 */
export interface IScanner {
  /**
   * Scan directory for code files
   * @param rootPath - Project root directory
   * @param options - Scan configuration
   */
  scan(rootPath: string, options?: ScanOptions): AsyncIterable<FileMetadata>;

  /**
   * Detect project type and framework
   */
  detectProjectType(rootPath: string): Promise<ProjectInfo>;

  /**
   * Check for file changes since last scan
   */
  scanForChanges(
    rootPath: string,
    knownFiles: Map<string, string>
  ): Promise<ChangedFiles>;
}

export interface ScanOptions {
  patterns?: string[];
  ignorePatterns?: string[];
  maxDepth?: number;
}

export interface FileMetadata {
  path: string;
  relativePath: string;
  hash: string;
  size: number;
  language: string;
  lastModified: number;
}
```

#### 0.5 Define ISemanticAnalyzer Interface

**File**: `src/core/interfaces/ISemanticAnalyzer.ts`

```typescript
/**
 * ISemanticAnalyzer - Type resolution interface
 *
 * Hides worker thread implementation detail.
 */
export interface ISemanticAnalyzer {
  /**
   * Analyze files for type information
   */
  analyze(files: string[]): AsyncIterable<SemanticInfo>;

  /**
   * Get type for a specific symbol
   */
  getTypeFor(filePath: string, symbolName: string): Promise<TypeInfo | null>;

  /**
   * Build dependency graph for project
   */
  getDependencyGraph(): Promise<DependencyGraph>;

  /**
   * Initialize analyzer with project configuration
   */
  initialize(projectRoot: string, tsconfigPath?: string): Promise<void>;

  /**
   * Shutdown analyzer and release resources
   */
  shutdown(): Promise<void>;
}

export interface SemanticInfo {
  filePath: string;
  types: Map<string, TypeInfo>;
  symbols: Map<string, SymbolInfo>;
  references: Map<string, Location[]>;
  dependencies: string[];
}
```

#### 0.6 Define IExtractor Interface

**File**: `src/core/interfaces/IExtractor.ts`

```typescript
/**
 * IExtractor - UCE to graph entity converter
 *
 * Note: V5 EntityPipeline already implements this pattern.
 * This interface formalizes the existing API.
 */
export interface IExtractor {
  /**
   * Extract graph entities from parsed file
   * @param uceFile - Parsed file from IParser
   * @param fileHash - Content hash for change detection
   * @param fileSize - File size in bytes
   */
  extract(
    uceFile: UCEFile,
    fileHash: string,
    fileSize: number
  ): Promise<ExtractionResult>;

  /**
   * Merge multiple extraction batches
   */
  mergeBatches(batches: CozoBatch[]): CozoBatch;
}

// ExtractionResult already defined in V5
```

#### 0.7 Create Interface Index

**File**: `src/core/interfaces/index.ts`

```typescript
export type { IParser } from './IParser.js';
export type { IGraphStore, ITransaction, QueryResult, VectorSearchResult } from './IGraphStore.js';
export type { IScanner, ScanOptions, FileMetadata } from './IScanner.js';
export type { ISemanticAnalyzer, SemanticInfo } from './ISemanticAnalyzer.js';
export type { IExtractor } from './IExtractor.js';
```

### Acceptance Criteria

- [ ] All 5 interfaces compile without errors
- [ ] Each interface has JSDoc with example usage
- [ ] Interfaces exported from `src/core/interfaces/index.ts`
- [ ] No implementation changes yet (interfaces only)

---

## Phase 1: Remove LanceDB Dependency

**Goal**: Consolidate to single database (CozoDB with HNSW vectors)
**Effort**: 2-3 hours
**Risk**: Low (LanceDB is currently a stub)

### Background

From the review:
> "CozoDB supports HNSW vector indices natively (per references.md)"
> "Eliminates sync complexity, reduces dependencies"

The current `src/core/vector/` module is a stub. LanceDB was never fully integrated, making this an easy win.

### Tasks

#### 1.1 Remove LanceDB Package

```bash
pnpm remove @lancedb/lancedb
```

Update `package.json` to remove the dependency.

#### 1.2 Delete Vector Module

Delete the entire `src/core/vector/` directory:
- `src/core/vector/index.ts`

#### 1.3 Update Core Index

**File**: `src/core/index.ts`

```diff
- export * from "./vector/index.js";
```

#### 1.4 Add Vector Fields to Schema

**File**: `src/core/graph/schema-definitions.ts`

Add embedding fields to relevant node types:

```typescript
// In NODES.Function definition
embedding: {
  type: "Float[]",  // Vector type
  nullable: true,
  description: "Semantic embedding vector (384 dimensions)",
},

// In NODES.File definition
embedding: {
  type: "Float[]",
  nullable: true,
  description: "File-level semantic embedding",
},
```

#### 1.5 Create HNSW Index Migration

**File**: `src/core/graph/migrations/002_add_vector_indices.ts`

```typescript
import type { Migration } from "../migration-runner.js";

export const migration: Migration = {
  version: 2,
  name: "add_vector_indices",
  description: "Add HNSW vector indices for semantic search",

  async up(db) {
    // Create HNSW index on function embeddings
    await db.run(`
      ::hnsw create function:embedding_idx {
        fields: [embedding],
        dim: 384,
        m: 50,
        ef_construction: 200,
        filter: embedding != null
      }
    `);

    // Create HNSW index on file embeddings
    await db.run(`
      ::hnsw create file:embedding_idx {
        fields: [embedding],
        dim: 384,
        m: 50,
        ef_construction: 200,
        filter: embedding != null
      }
    `);
  },

  async down(db) {
    await db.run("::hnsw drop function:embedding_idx");
    await db.run("::hnsw drop file:embedding_idx");
  },
};
```

#### 1.6 Add Vector Search to GraphOperations

**File**: `src/core/graph/operations.ts`

Add vector search methods:

```typescript
/**
 * Search for similar functions using vector embeddings
 */
async vectorSearchFunctions(
  embedding: number[],
  k: number = 10
): Promise<VectorSearchResult[]> {
  const result = await this.db.query(`
    ?[id, name, file_id, distance] :=
      ~function:embedding_idx{ id, name, file_id | query: $embedding, k: $k, ef: 100, bind_distance: distance }
  `, { embedding, k });

  return result.rows.map(row => ({
    id: row.id as string,
    name: row.name as string,
    fileId: row.file_id as string,
    distance: row.distance as number,
  }));
}

/**
 * Search for similar files using vector embeddings
 */
async vectorSearchFiles(
  embedding: number[],
  k: number = 10
): Promise<VectorSearchResult[]> {
  const result = await this.db.query(`
    ?[id, path, distance] :=
      ~file:embedding_idx{ id, path | query: $embedding, k: $k, ef: 100, bind_distance: distance }
  `, { embedding, k });

  return result.rows.map(row => ({
    id: row.id as string,
    path: row.path as string,
    distance: row.distance as number,
  }));
}
```

#### 1.7 Update Documentation

**Files to update**:
- `docs/ARCHITECTURE.md` - Remove LanceDB references, update storage diagram
- `docs/implementation-plan.md` - Update V8 MCP section to use CozoDB vectors
- `CLAUDE.md` - Update dependencies section

### Acceptance Criteria

- [ ] `@lancedb/lancedb` removed from package.json
- [ ] `pnpm install` succeeds
- [ ] `pnpm build` succeeds
- [ ] `pnpm check-types` succeeds
- [ ] Vector search works via CozoDB HNSW indices
- [ ] No references to LanceDB in codebase (verified by grep)

---

## Phase 2: Implement IGraphStore

**Goal**: Decouple graph operations from CozoDB implementation
**Effort**: 1 day
**Risk**: Low (adapter pattern over existing code)

### Tasks

#### 2.1 Create CozoGraphStore Adapter

**File**: `src/core/graph/cozo-graph-store.ts`

```typescript
import type { IGraphStore, ITransaction, QueryResult, VectorSearchResult } from "../interfaces/index.js";
import type { GraphEntity } from "../extraction/types.js";
import { GraphDatabase } from "./database.js";
import { GraphOperations } from "./operations.js";

/**
 * CozoDB implementation of IGraphStore
 */
export class CozoGraphStore implements IGraphStore {
  private db: GraphDatabase;
  private ops: GraphOperations;

  constructor(dbPath: string) {
    this.db = new GraphDatabase(dbPath);
    this.ops = new GraphOperations(this.db);
  }

  async initialize(): Promise<void> {
    await this.db.initialize();
  }

  async write(entities: GraphEntity[]): Promise<void> {
    await this.db.withTransaction(async () => {
      // Convert GraphEntity[] to CozoBatch format and write
      // Implementation depends on batch write methods
    });
  }

  async query(query: string, params?: Record<string, unknown>): Promise<QueryResult> {
    const result = await this.db.query(query, params);
    return {
      rows: result.rows,
      stats: {
        rowsAffected: result.rows.length,
        executionTimeMs: 0, // CozoDB doesn't expose this directly
      },
    };
  }

  async transaction<T>(fn: (tx: ITransaction) => Promise<T>): Promise<T> {
    return this.db.withTransaction(async () => {
      const txAdapter: ITransaction = {
        write: async (entities) => this.write(entities),
        query: async (q, p) => this.query(q, p),
      };
      return fn(txAdapter);
    });
  }

  async vectorSearch(embedding: number[], k: number): Promise<VectorSearchResult[]> {
    return this.ops.vectorSearchFunctions(embedding, k);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
```

#### 2.2 Create Factory Function

**File**: `src/core/graph/factory.ts`

```typescript
import type { IGraphStore } from "../interfaces/index.js";
import { CozoGraphStore } from "./cozo-graph-store.js";

export interface GraphStoreConfig {
  path: string;
  runMigrations?: boolean;
}

export async function createGraphStore(config: GraphStoreConfig): Promise<IGraphStore> {
  const store = new CozoGraphStore(config.path);
  await store.initialize();

  if (config.runMigrations !== false) {
    // Run migrations if needed
  }

  return store;
}
```

#### 2.3 Update Exports

**File**: `src/core/graph/index.ts`

```typescript
// Interface
export type { IGraphStore, ITransaction, QueryResult, VectorSearchResult } from "../interfaces/index.js";

// Factory (preferred way to create)
export { createGraphStore } from "./factory.js";

// Concrete implementation (for advanced use)
export { CozoGraphStore } from "./cozo-graph-store.js";

// Keep existing exports for backwards compatibility
export { GraphDatabase } from "./database.js";
export { GraphOperations } from "./operations.js";
// ... etc
```

### Acceptance Criteria

- [ ] `CozoGraphStore` implements `IGraphStore`
- [ ] Factory function `createGraphStore()` works
- [ ] All existing tests pass (no behavior change)
- [ ] Can create mock `IGraphStore` for testing

---

## Phase 3: Implement IParser

**Goal**: Decouple parsing from Tree-sitter implementation
**Effort**: 1 day
**Risk**: Low (adapter pattern)

### Tasks

#### 3.1 Update TypeScriptParser to Implement IParser

**File**: `src/core/parser/typescript-parser.ts`

```diff
+ import type { IParser } from "../interfaces/index.js";

- export class TypeScriptParser implements LanguageParser {
+ export class TypeScriptParser implements IParser, LanguageParser {
```

#### 3.2 Create Factory Function

**File**: `src/core/parser/factory.ts`

```typescript
import type { IParser } from "../interfaces/index.js";
import { TypeScriptParser } from "./typescript-parser.js";

export async function createParser(): Promise<IParser> {
  const parser = new TypeScriptParser();
  await parser.initialize();
  return parser;
}
```

#### 3.3 Update Exports

**File**: `src/core/parser/index.ts`

```typescript
// Interface
export type { IParser } from "../interfaces/index.js";

// Factory
export { createParser } from "./factory.js";

// Keep existing exports
export { TypeScriptParser } from "./typescript-parser.js";
// ... etc
```

### Acceptance Criteria

- [ ] `TypeScriptParser` implements `IParser`
- [ ] Factory function `createParser()` works
- [ ] All existing parser tests pass
- [ ] Can create mock `IParser` for testing

---

## Phase 4: Contract Test Suite

**Goal**: Verify interface contracts with executable tests
**Effort**: 2 days
**Risk**: Low (test infrastructure only)

### Tasks

#### 4.1 Create Contract Test Infrastructure

**File**: `src/core/interfaces/__tests__/contract-test-base.ts`

```typescript
/**
 * Base class for contract tests.
 *
 * Each interface should have a contract test suite that:
 * 1. Defines the expected behavior
 * 2. Can be run against any implementation
 * 3. Catches interface violations early
 */
export abstract class ContractTestBase<T> {
  protected abstract createInstance(): Promise<T>;
  protected abstract destroyInstance(instance: T): Promise<void>;

  protected instance!: T;

  async setup(): Promise<void> {
    this.instance = await this.createInstance();
  }

  async teardown(): Promise<void> {
    await this.destroyInstance(this.instance);
  }
}
```

#### 4.2 Create IParser Contract Tests

**File**: `src/core/interfaces/__tests__/IParser.contract.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { IParser } from "../IParser.js";
import { createParser } from "../../parser/index.js";

describe("IParser Contract", () => {
  let parser: IParser;

  beforeAll(async () => {
    parser = await createParser();
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe("parseFile", () => {
    it("should parse valid TypeScript file", async () => {
      // Use a fixture file
      const uce = await parser.parseFile("./test-fixtures/valid.ts");

      expect(uce.filePath).toMatch(/valid\.ts$/);
      expect(uce.language).toBe("typescript");
      expect(uce.functions).toBeInstanceOf(Array);
    });

    it("should throw on non-existent file", async () => {
      await expect(parser.parseFile("./non-existent.ts"))
        .rejects.toThrow();
    });
  });

  describe("parseCode", () => {
    it("should extract function signatures", () => {
      const uce = parser.parseCode(`
        function add(a: number, b: number): number {
          return a + b;
        }
      `, "typescript");

      expect(uce.functions.length).toBe(1);
      expect(uce.functions[0].name).toBe("add");
      expect(uce.functions[0].params.length).toBe(2);
    });

    it("should handle syntax errors gracefully", () => {
      // Should not throw, return partial parse
      const uce = parser.parseCode("function foo(", "typescript");
      expect(uce.functions.length).toBe(0);
    });

    it("should extract class methods", () => {
      const uce = parser.parseCode(`
        class Calculator {
          add(a: number, b: number): number {
            return a + b;
          }
        }
      `, "typescript");

      expect(uce.classes.length).toBe(1);
      expect(uce.classes[0].methods.length).toBe(1);
    });
  });

  describe("getSupportedLanguages", () => {
    it("should include TypeScript and JavaScript", () => {
      const languages = parser.getSupportedLanguages();

      expect(languages).toContain("typescript");
      expect(languages).toContain("javascript");
    });
  });
});
```

#### 4.3 Create IGraphStore Contract Tests

**File**: `src/core/interfaces/__tests__/IGraphStore.contract.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { IGraphStore } from "../IGraphStore.js";
import { createGraphStore } from "../../graph/index.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

describe("IGraphStore Contract", () => {
  let store: IGraphStore;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "graphstore-test-"));
    store = await createGraphStore({ path: join(testDir, "test.db") });
  });

  afterAll(async () => {
    await store.close();
    await rm(testDir, { recursive: true });
  });

  describe("write", () => {
    it("should write entities atomically", async () => {
      const entities = [
        { id: "test:1", entityType: "File", data: { path: "/test.ts" }, relationships: [] },
      ];

      await expect(store.write(entities)).resolves.not.toThrow();
    });
  });

  describe("query", () => {
    it("should execute valid queries", async () => {
      const result = await store.query("?[x] := x = 1");

      expect(result.rows).toBeInstanceOf(Array);
      expect(result.stats).toHaveProperty("rowsAffected");
    });
  });

  describe("transaction", () => {
    it("should rollback on error", async () => {
      await expect(
        store.transaction(async (tx) => {
          await tx.write([{ id: "test:tx", entityType: "File", data: {}, relationships: [] }]);
          throw new Error("Rollback test");
        })
      ).rejects.toThrow("Rollback test");

      // Verify entity was not written
      const result = await store.query("?[id] := *file{id}, id = 'test:tx'");
      expect(result.rows.length).toBe(0);
    });
  });
});
```

#### 4.4 Create IExtractor Contract Tests

**File**: `src/core/interfaces/__tests__/IExtractor.contract.test.ts`

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import type { IExtractor } from "../IExtractor.js";
import type { IParser } from "../IParser.js";
import { createEntityPipeline } from "../../extraction/index.js";
import { createParser } from "../../parser/index.js";

describe("IExtractor Contract", () => {
  let extractor: IExtractor;
  let parser: IParser;

  beforeAll(async () => {
    parser = await createParser();
    extractor = createEntityPipeline({ projectRoot: "/test" });
  });

  describe("extract", () => {
    it("should generate deterministic IDs", async () => {
      const code = `export function test() {}`;
      const uce = parser.parseCode(code, "typescript");
      uce.filePath = "/test/file.ts";

      const result1 = await extractor.extract(uce, "hash1", 100);
      const result2 = await extractor.extract(uce, "hash1", 100);

      expect(result1.fileId).toBe(result2.fileId);
      expect(result1.batch.function[0][0]).toBe(result2.batch.function[0][0]);
    });

    it("should extract all entity types", async () => {
      const code = `
        interface Props { name: string; }
        class User implements Props { name = ""; }
        export function greet(user: User) { return "Hi"; }
        export const VERSION = "1.0";
      `;
      const uce = parser.parseCode(code, "typescript");
      uce.filePath = "/test/entities.ts";

      const result = await extractor.extract(uce, "hash", 500);

      expect(result.batch.file.length).toBe(1);
      expect(result.batch.function.length).toBeGreaterThan(0);
      expect(result.batch.class.length).toBe(1);
      expect(result.batch.interface.length).toBe(1);
      expect(result.batch.variable.length).toBe(1);
    });

    it("should create CONTAINS relationships", async () => {
      const code = `export function test() {}`;
      const uce = parser.parseCode(code, "typescript");
      uce.filePath = "/test/contains.ts";

      const result = await extractor.extract(uce, "hash", 100);

      expect(result.batch.contains.length).toBeGreaterThan(0);
      expect(result.batch.contains[0][0]).toBe(result.fileId); // from = file
    });

    it("should create ghost nodes for external imports", async () => {
      const code = `import { useState } from 'react';`;
      const uce = parser.parseCode(code, "typescript");
      uce.filePath = "/test/imports.ts";

      const result = await extractor.extract(uce, "hash", 100);

      const reactGhost = result.batch.ghostNode.find(g => g[2] === "react");
      expect(reactGhost).toBeDefined();
    });
  });
});
```

#### 4.5 Add Test Script

**File**: `package.json`

```json
{
  "scripts": {
    "test:contracts": "vitest run src/core/interfaces/__tests__/*.contract.test.ts"
  }
}
```

### Acceptance Criteria

- [ ] Contract tests exist for IParser, IGraphStore, IExtractor
- [ ] All contract tests pass
- [ ] `pnpm test:contracts` runs successfully
- [ ] Contract tests document expected behavior

---

## Phase 5: Integration Smoke Test

**Goal**: End-to-end test of full pipeline
**Effort**: 2 hours
**Risk**: Low (test only)

### Tasks

#### 5.1 Create Integration Test

**File**: `src/__tests__/integration/full-pipeline.integration.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createParser } from "../../core/parser/index.js";
import { createEntityPipeline } from "../../core/extraction/index.js";
import { createGraphStore } from "../../core/graph/index.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import type { IParser } from "../../core/interfaces/IParser.js";
import type { IGraphStore } from "../../core/interfaces/IGraphStore.js";
import type { IExtractor } from "../../core/interfaces/IExtractor.js";

describe("Full Pipeline Integration", () => {
  let testDir: string;
  let parser: IParser;
  let extractor: IExtractor;
  let store: IGraphStore;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "synapse-integration-"));

    // Create test project
    await mkdir(join(testDir, "src"));
    await writeFile(join(testDir, "src/index.ts"), `
      import { helper } from './utils';

      export interface User {
        name: string;
        age: number;
      }

      export class UserService {
        private users: User[] = [];

        addUser(user: User): void {
          this.users.push(user);
        }

        getUsers(): User[] {
          return this.users;
        }
      }

      export function createService(): UserService {
        return new UserService();
      }
    `);

    await writeFile(join(testDir, "src/utils.ts"), `
      export function helper(x: number): number {
        return x * 2;
      }
    `);

    // Initialize components
    parser = await createParser();
    extractor = createEntityPipeline({ projectRoot: testDir });
    store = await createGraphStore({
      path: join(testDir, ".synapse", "graph.db"),
      runMigrations: true,
    });
  });

  afterAll(async () => {
    await store.close();
    await rm(testDir, { recursive: true });
  });

  it("should complete scan → parse → extract → store → query pipeline", async () => {
    // 1. Parse files
    const indexUce = await parser.parseFile(join(testDir, "src/index.ts"));
    const utilsUce = await parser.parseFile(join(testDir, "src/utils.ts"));

    expect(indexUce.functions.length).toBeGreaterThan(0);
    expect(indexUce.classes.length).toBe(1);
    expect(indexUce.interfaces.length).toBe(1);

    // 2. Extract entities
    const indexResult = await extractor.extract(indexUce, "hash1", 500);
    const utilsResult = await extractor.extract(utilsUce, "hash2", 100);

    expect(indexResult.errors.length).toBe(0);
    expect(utilsResult.errors.length).toBe(0);

    // 3. Merge batches
    const merged = extractor.mergeBatches([indexResult.batch, utilsResult.batch]);

    expect(merged.file.length).toBe(2);
    expect(merged.function.length).toBeGreaterThan(0);
    expect(merged.class.length).toBe(1);

    // 4. Write to store (when write method is fully implemented)
    // await store.write(merged);

    // 5. Query store
    // const result = await store.query("?[name] := *function{name}");
    // expect(result.rows.length).toBeGreaterThan(0);

    console.log("Integration test passed!");
    console.log(`  Files: ${merged.file.length}`);
    console.log(`  Functions: ${merged.function.length}`);
    console.log(`  Classes: ${merged.class.length}`);
    console.log(`  Interfaces: ${merged.interface.length}`);
    console.log(`  Relationships: ${merged.contains.length + merged.hasMethod.length}`);
  });
});
```

#### 5.2 Add Test Script

```json
{
  "scripts": {
    "test:integration": "vitest run src/__tests__/integration/*.integration.test.ts"
  }
}
```

### Acceptance Criteria

- [ ] Integration test passes
- [ ] Pipeline handles real TypeScript code
- [ ] Entities and relationships correctly extracted

---

## Phase 6: Module Boundary Linting (Optional)

**Goal**: Enforce dependency rules via ESLint
**Effort**: 1 hour
**Risk**: Low

### Tasks

#### 6.1 Add ESLint Rule for Module Boundaries

**File**: `eslint.config.js`

Add a custom rule or use `eslint-plugin-import` to enforce:
- `cli/` can import from `core/`, `types/`, `utils/`
- `mcp/` can import from `core/`, `types/`, `utils/`
- `core/` can import from `types/`, `utils/` (NOT from `cli/` or `mcp/`)
- No direct imports of concrete classes across module boundaries

### Acceptance Criteria

- [ ] ESLint reports violations of module boundaries
- [ ] CI fails on boundary violations

---

## Phase 7: Documentation Updates

**Goal**: Update docs to reflect architectural changes
**Effort**: 2 hours
**Risk**: None

### Tasks

#### 7.1 Update ARCHITECTURE.md

- Remove LanceDB references
- Update storage diagram to show single CozoDB
- Document interface-based architecture
- Add module dependency diagram

#### 7.2 Update Implementation Plan

- Mark storage consolidation as complete
- Update V6-V10 to use interfaces

#### 7.3 Add Module READMEs

Create README.md in each core module directory following template:

```markdown
# Module: [Name]

**Purpose**: [One sentence description]

## Public API

- `interfaceName.method()` - Description

## Example Usage

```typescript
[Code example]
```

## Testing

```bash
pnpm test [module-path]
```
```

### Acceptance Criteria

- [ ] ARCHITECTURE.md reflects single-database design
- [ ] Module READMEs exist for parser, graph, extraction, semantic

---

## Summary: Implementation Order

| Phase | Name | Effort | Priority | Dependencies |
|-------|------|--------|----------|--------------|
| **0** | Interface Extraction | 1-2 days | High | None |
| **1** | Remove LanceDB | 2-3 hours | High | None |
| **2** | IGraphStore Impl | 1 day | High | Phase 0 |
| **3** | IParser Impl | 1 day | Medium | Phase 0 |
| **4** | Contract Tests | 2 days | Medium | Phases 2-3 |
| **5** | Integration Test | 2 hours | Medium | Phases 2-4 |
| **6** | Boundary Linting | 1 hour | Low | None |
| **7** | Documentation | 2 hours | Low | All phases |

**Total Estimated Effort**: 6-8 days

### Recommended Order

1. **Day 1**: Phase 0 (Interfaces) + Phase 1 (Remove LanceDB)
2. **Day 2-3**: Phase 2 (IGraphStore) + Phase 3 (IParser)
3. **Day 4-5**: Phase 4 (Contract Tests)
4. **Day 6**: Phase 5 (Integration) + Phase 6 (Linting) + Phase 7 (Docs)

---

## Open Questions

### Q1: Should we keep the Semantic Worker Thread?

**Review Opinion**: "Worker Thread May Be Premature (LOW SEVERITY)"

**Current State**: Already implemented in V4

**Recommendation**: Keep for now. It works and provides isolation. If performance testing shows overhead is too high, we can simplify later.

### Q2: How to handle Orama (fuzzy search)?

**Review Opinion**: "Orama is 'In-memory (limited by RAM)'"

**Current State**: Not yet implemented (planned for V8)

**Recommendation**: Defer Orama implementation. When implementing V8 MCP, consider:
1. Using CozoDB's built-in text search first
2. Only add Orama if fuzzy search quality is insufficient
3. Implement snapshot/restore if Orama is added

### Q3: Should we implement schema decorators?

**Review Opinion**: "Schema Simplification" - use decorators on domain classes

**Current State**: Manual schema-definitions.ts

**Recommendation**: Defer. Current approach works fine. Revisit after V8 when schema is stable.

---

## Deferred Items (Not in Scope)

These items from the review are deferred for later consideration:

1. **Schema Decorator-Based Generation** - Low priority, current approach works
2. **Orama Integration** - Wait for V8 MCP implementation
3. **GraphRAG Summarization** - Wait for V9 LLM integration
4. **Worker Thread Removal** - Keep existing implementation
5. **Result<T,E> Simplification** - Current pattern works, low impact change

---

*This plan will be updated as phases are completed.*

# Code-Synapse Implementation Plan

**Roadmap for Building the Zero-Config Smart Sidecar**

This document tracks implementation progress and defines the order of tasks to execute. For architectural details and design decisions, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Implementation Status

### Progress Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VERTICALS (Features)                               │
│  V1 Graph ✅ → V2 Scanner ✅ → V3 Parser ✅ → V4 Semantic ✅ → V5 Extract ✅ │
│  → V6 Refactor ✅ → V7 Build → V8 Indexer → V9 MCP → V10 LLM → V11 CLI      │
└─────────────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ depends on
┌─────────────────────────────┴───────────────────────────────────────────────┐
│                    HORIZONTALS (Infrastructure)                              │
│  H1 Foundation ✅ → H2 Resource Mgmt ✅ → H3 Schema ✅ → H4 Async ✅ → H5 Telemetry ✅ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Horizontal Layers (Cross-Cutting Infrastructure)

| Phase | Name | Status | What It Provides |
|-------|------|--------|------------------|
| **H1** | Core Foundation | ✅ **Complete** | Logger, FS utils, Errors, ID generators, Config paths |
| **H2** | Resource Management | ✅ **Complete** | TypeScript 5.2 `using`, Disposable interfaces |
| **H3** | Schema & Types | ✅ **Complete** | Schema Source of Truth, UCE types, Zod validation |
| **H4** | Async Infrastructure | ✅ **Complete** | Result<T,E>, Pool<T>, EventBus, retry(), Deferred<T> |
| **H5** | Telemetry | ✅ **Complete** | OpenTelemetry, @traced() decorator, file exporter |

### Vertical Modules (Feature-Specific)

| Phase | Name | Status | Dependencies | Description |
|-------|------|--------|--------------|-------------|
| **V1** | Graph Database | ✅ **Complete** | H1-H4 | CozoDB wrapper, migrations, transactions |
| **V2** | File Scanner | ✅ **Complete** | H1-H3 | Project detection, file discovery |
| **V3** | Code Parser | ✅ **Complete** | H1-H4 | Tree-sitter, UCE transformation |
| **V4** | Semantic Analysis | ✅ **Complete** | H1-H4, V3 | Worker thread, TS Compiler API |
| **V5** | Entity Extraction | ✅ **Complete** | V1-V4 | CozoBatch, signature IDs, ghost nodes, embeddings |
| **V6** | Architecture Refactor | ✅ **Complete** | V1-V5 | Interface contracts, LanceDB removal, CozoDB vectors, tests |
| **V7** | Graph Builder | ✅ **Complete** | V1, V5-V6 | Atomic writes, incremental updates |
| **V8** | Indexer & Watcher | 🔲 Pending | V1-V7 | Orchestration, RxJS file watching |
| **V9** | MCP Server | 🔲 Pending | V1-V8 | Hybrid search, tools, resources |
| **V10** | LLM Integration | 🔲 Pending | V1-V9 | GBNF grammars, GraphRAG, confidence |
| **V11** | CLI Commands | 🔲 Pending | V1-V10 | Full command implementations |

---

## Testing Checkpoints

Verification points to validate completed modules before proceeding.

### Checkpoint 1: Foundation Verification (After V4) ✅ COMPLETE

**Goal**: Verify CLI launches, core modules initialize, and parsing/analysis works

**What Was Tested:**
1. CLI Startup - `--help`, `--version`, `init`, `status` commands ✅
2. File Scanner - `index` command discovers project files ✅
3. Parser Module - Extracts functions, classes, imports from TypeScript ✅
4. Semantic Analysis - Builds dependency graph, detects circular deps ✅
5. Graph Database - Schema migration runs, CRUD operations work ✅

**Results:**
- [x] CLI commands execute without errors (help, version, status, index)
- [x] File scanner discovered 56 project files in 0.1s
- [x] Parser extracts functions, classes, imports correctly
- [x] Semantic analyzer infrastructure ready (worker thread)
- [x] Graph database CRUD operations verified (insert, query, join, delete)

**Key Fixes Applied:**
- Schema generator uses `Type?` syntax for nullable fields (not `default null`)
- Field names converted to snake_case for CozoDB compatibility
- Vector embedding fields deferred to future migration

---

### Checkpoint 2: Indexing Pipeline (After V8) 🔲 PENDING

**Goal**: Verify complete file indexing works end-to-end

**What to Test:**
1. Full Project Indexing - Parse all files, write to graph
2. Incremental Updates - Modify file, verify re-indexed
3. File Watcher - Auto-detect changes, process batches
4. Query Verification - Functions by name, call relationships, imports

**Success Criteria:**
- [ ] Full project indexes without errors
- [ ] Incremental updates work correctly
- [ ] File watcher detects and processes changes
- [ ] Graph queries return correct results

---

### Checkpoint 3: MCP Server (After V9) 🔲 PENDING

**Goal**: Verify AI agents can connect and query via MCP

**What to Test:**
1. MCP Server Startup - Listens on configured port
2. MCP Tools - search_code, get_function, get_dependencies
3. MCP Resources - File access, symbol listing
4. Claude Code Integration - Configure and test interactively

**Success Criteria:**
- [ ] MCP server starts and accepts connections
- [ ] All MCP tools respond correctly
- [ ] Resources are accessible
- [ ] Claude Code integration works

---

### Checkpoint 4: Full System (After V11) 🔲 PENDING

**Goal**: Complete end-to-end verification

**What to Test:**
1. Complete CLI - All commands with full functionality
2. LLM Integration - Summarization, GraphRAG, confidence scores
3. Performance - Index 10k+ LOC project, query response <100ms
4. Reliability - Malformed files, interrupted indexing, concurrent access

**Success Criteria:**
- [ ] All features work as documented
- [ ] Performance meets requirements
- [ ] Error handling is robust
- [ ] Documentation is complete

---

## Phase Details

### Phase 1: Project Foundation ✅ COMPLETE

**What Was Built:**
- Project structure with cli/, mcp/, core/ separation
- TypeScript configuration (strict mode, ES2022, NodeNext)
- ESLint + Prettier configuration
- CLI framework with Commander.js (init, start, index, status)
- Core module scaffolding
- Shared types and utilities

**Files Created:**
- `src/cli/index.ts` - CLI entry point
- `src/cli/commands/*.ts` - Command implementations
- `src/utils/logger.ts` - Pino-based logging
- `src/utils/fs.ts` - File system utilities
- `src/core/errors.ts` - Error classes
- `src/types/index.ts` - Type definitions

---

### H2: Resource Management ✅ COMPLETE

**What Was Built:**
- Disposable interface with `[Symbol.dispose]()`
- AsyncDisposable interface with `[Symbol.asyncDispose]()`
- DisposableStack and AsyncDisposableStack
- Utility functions for creating disposables

**Files Created:**
- `src/utils/disposable.ts`

---

### H3: Schema & Types ✅ COMPLETE

**What Was Built:**
- Schema Source of Truth with type-safe definitions
- Schema Generator producing Cypher DDL
- UCE types (UCEFunction, UCEClass, UCEInterface, etc.)
- Zod validation schemas

**Files Created:**
- `src/core/graph/schema-definitions.ts` - Schema source of truth
- `src/core/graph/schema-generator.ts` - CozoScript DDL generator
- `src/types/uce.ts`
- `src/utils/validation.ts`

---

### H4: Async Infrastructure ✅ COMPLETE

**What Was Built:**
- Result<T, E> discriminated union with ok/err constructors
- Deferred<T> for promise externalization
- timeout() and retry() with exponential backoff
- CancellationToken for cooperative cancellation
- Generic Pool<T> for resource pooling
- Type-safe EventBus<Events>

**Files Created:**
- `src/types/result.ts`
- `src/utils/async.ts`
- `src/utils/pool.ts`
- `src/utils/events.ts`

---

### H5: Telemetry ✅ COMPLETE

**What Was Built:**
- OpenTelemetry-compatible span interface
- @traced() decorator for automatic instrumentation
- Counter, Gauge, Histogram metrics
- In-memory trace recording with export

**Files Created:**
- `src/core/telemetry/tracer.ts`
- `src/core/telemetry/metrics.ts`
- `src/core/telemetry/index.ts`

---

### V1: Graph Database ✅ COMPLETE

**What Was Built:**
- CozoDB wrapper with initialization and lifecycle (RocksDB backend)
- Transaction management (begin, commit, rollback)
- withTransaction() for automatic handling
- MigrationRunner with version tracking
- GraphOperations for high-level CRUD
- CozoScript query generation

**Files Created:**
- `src/core/graph/database.ts`
- `src/core/graph/migration-runner.ts`
- `src/core/graph/migrations/001_initial_schema.ts`
- `src/core/graph/migrations/index.ts`
- `src/core/graph/operations.ts`

---

### V2: File Scanner ✅ COMPLETE

**What Was Built:**
- ProjectDetector for automatic project type/framework detection
- FileScanner for glob-based file discovery
- FileHasher for content-based change detection
- Indexer integration with new components

**Files Created:**
- `src/core/indexer/project-detector.ts`
- `src/core/indexer/scanner.ts`
- `src/core/indexer/hasher.ts`
- `src/core/indexer/index.ts` (updated)

---

### V3: Code Parser ✅ COMPLETE

**What Was Built:**
- ParserManager for Tree-sitter WASM wrapper
- ASTTransformer for CST to UCE conversion
- TypeScriptParser implementing LanguageParser interface
- CallExtractor for function call relationships

**Files Created:**
- `src/core/parser/parser-manager.ts`
- `src/core/parser/ast-transformer.ts`
- `src/core/parser/typescript-parser.ts`
- `src/core/parser/call-extractor.ts`
- `src/core/parser/index.ts`

---

### V4: Semantic Analysis ✅ COMPLETE

**What Was Built:**
- Semantic types and interfaces
- TypeScriptProgramManager wrapping ts.Program and ts.TypeChecker
- TypeResolver for resolving types using TypeChecker
- SymbolLinker for cross-file symbol resolution
- DependencyAnalyzer for module dependency graphs
- SemanticWorker running in isolated Worker Thread
- SemanticWorkerManager for worker orchestration
- SemanticAnalyzer facade combining all capabilities

**Files Created:**
- `src/core/semantic/types.ts`
- `src/core/semantic/ts-program.ts`
- `src/core/semantic/type-resolver.ts`
- `src/core/semantic/symbol-linker.ts`
- `src/core/semantic/dependency-analyzer.ts`
- `src/workers/semantic.worker.ts`
- `src/core/semantic/worker-manager.ts`
- `src/core/semantic/index.ts`
- `src/workers/index.ts`

---

### V5: Entity Extraction ✅ COMPLETE

**Goal**: Extract structured graph entities from UCE (Universal Code Entities) for database storage

**What Was Built:**

#### 5.1 CozoDB-Native Output Structure (types.ts)

Instead of generic `GraphEntity` objects, the pipeline outputs `CozoBatch` - typed arrays that map directly to CozoDB relations:

```typescript
export interface CozoBatch {
  file: FileRow[];           // [id, path, relative_path, extension, hash, size, last_modified, language, framework]
  function: FunctionRow[];   // [id, name, file_id, start_line, end_line, ..., business_logic, inference_confidence]
  class: ClassRow[];         // [id, name, file_id, start_line, end_line, is_abstract, is_exported, extends, implements, doc]
  interface: InterfaceRow[]; // [id, name, file_id, start_line, end_line, is_exported, extends, doc, properties_json]
  typeAlias: TypeAliasRow[];
  variable: VariableRow[];
  ghostNode: GhostNodeRow[]; // [id, name, package_name, entity_type, signature, is_external]
  // Relationships
  contains: ContainsRow[];   // [from_id, to_id, line_number]
  calls: CallsRow[];         // [from_id, to_id, call_type, is_async, location_line]
  imports: ImportsRow[];     // [from_id, to_id, imported_symbols, import_type, is_type_only]
  extends: ExtendsRow[];     // [from_id, to_id]
  implements: ImplementsRow[]; // [from_id, to_id]
  hasMethod: HasMethodRow[]; // [class_id, method_id, visibility, is_static, is_abstract]
  // ... more
}
```

#### 5.2 Signature-Based ID Generation (id-generator.ts)

IDs are generated from `filePath:kind:name:signature` - NOT line numbers. This means:
- IDs remain stable when code is moved within a file
- Same function with same signature always gets same ID
- Overloaded functions get unique IDs via parameter disambiguator

```typescript
export function generateEntityId(
  filePath: string,
  entityKind: string,
  name: string,
  parentScope: string = "",
  disambiguator: string = ""
): string {
  const parts = [normalizedPath, entityKind, parentScope, name, disambiguator].filter(p => p.length > 0);
  return hashToId(parts.join(":")); // SHA-256, 16 hex chars
}
```

#### 5.3 Entity Extractors

| Extractor | Output | Features |
|-----------|--------|----------|
| `FunctionExtractor` | `FunctionRow` + `EmbeddingChunk` | Signature, params, return type, complexity, doc |
| `ClassExtractor` | `ClassRow` + method rows + `HasMethodRow[]` | Inheritance, implements, constructors |
| `InterfaceExtractor` | `InterfaceRow` + `TypeAliasRow` | Properties as JSON, extends tracking |
| `ImportExtractor` | `ImportsRow[]` + `GhostNodeRow[]` | Internal imports, external ghost nodes |

#### 5.4 Two-Pass Resolution Architecture

**Pass 1** (this module): Extracts all entities and creates local relationships. Cross-file references are tracked as "unresolved":

```typescript
interface ExtractionResult {
  batch: CozoBatch;                    // Ready for :put
  unresolvedCalls: UnresolvedCall[];   // For Pass 2
  unresolvedTypes: UnresolvedTypeRef[]; // For Pass 2
  embeddingChunks: EmbeddingChunk[];   // For vector embedding
}
```

**Pass 2** (future `CallGraphLinker`): Uses complete symbol registry to resolve cross-file calls and type references.

#### 5.5 Embedding Preparation

Each extracted entity includes a text chunk for vector embedding:

```typescript
interface EmbeddingChunk {
  entityId: string;
  entityType: "function" | "class" | "interface" | "typeAlias";
  text: string;      // Signature + docs + body snippet
  metadata: { name: string; filePath: string; signature?: string };
}
```

#### 5.6 Files Created

| File | Purpose |
|------|---------|
| `src/core/extraction/types.ts` | CozoBatch and row types |
| `src/core/extraction/id-generator.ts` | Signature-based ID generation |
| `src/core/extraction/function-extractor.ts` | Function/method extraction |
| `src/core/extraction/class-extractor.ts` | Class extraction with methods |
| `src/core/extraction/interface-extractor.ts` | Interface and type alias extraction |
| `src/core/extraction/import-extractor.ts` | Import handling and ghost nodes |
| `src/core/extraction/pipeline.ts` | EntityPipeline orchestration |
| `src/core/extraction/index.ts` | Module exports |

#### 5.7 Testing Checklist

- [x] Entity IDs are deterministic (same input → same ID)
- [x] Functions extracted with all metadata
- [x] Classes extracted with methods and properties
- [x] Interfaces extracted with type information
- [x] Import relationships correctly resolve file paths
- [x] GhostNodes created for external packages
- [x] CONTAINS relationships link File → entities
- [x] HAS_METHOD relationships link Class → methods
- [x] EXTENDS relationships track inheritance
- [x] IMPLEMENTS relationships track interface implementation

**Dependencies**: V1-V4 complete

---

### V6: Architecture Refactor ✅ COMPLETE

**Goal**: Improve testability and reduce complexity through interface contracts and storage consolidation

**What Was Built:**

#### 6.1 Interface Extraction

Created `src/core/interfaces/` directory with explicit module contracts:

| Interface | File | Purpose |
|-----------|------|---------|
| `IParser` | `IParser.ts` | Code parser contract (parseFile, parseCode, getSupportedLanguages) |
| `IGraphStore` | `IGraphStore.ts` | Graph database contract (query, writeBatch, transaction, vectorSearch) |
| `ITransaction` | `IGraphStore.ts` | Transaction contract for atomic operations |
| `IScanner` | `IScanner.ts` | File discovery contract |
| `ISemanticAnalyzer` | `ISemanticAnalyzer.ts` | Type resolution contract |
| `IExtractor` | `IExtractor.ts` | UCE to graph entity converter contract |

#### 6.2 LanceDB Removal & CozoDB Vector Support

- Removed `@lancedb/lancedb` dependency (was never fully integrated)
- Deleted `src/core/vector/` module
- Added `FunctionEmbedding` relation for vector storage (CozoDB vectors can't be nullable)
- Added HNSW vector index support in migration 002
- Vector search methods in `GraphOperations`

```typescript
// Vector type syntax: <F32; 384> for 384-dimensional float vectors
FunctionEmbedding: {
  functionId: { type: "STRING", primary: true },
  embedding: { type: "VECTOR_384", vectorIndex: true },
}
```

#### 6.3 IGraphStore Implementation

`CozoGraphStore` adapter implementing `IGraphStore`:

```typescript
class CozoGraphStore implements IGraphStore {
  async initialize(): Promise<void>;
  async query<T>(script: string, params?): Promise<QueryResult<T>>;
  async writeBatch(batch: CozoBatch): Promise<void>;
  async transaction<T>(fn: (tx: ITransaction) => Promise<T>): Promise<T>;
  async hasSchema(): Promise<boolean>;
  async close(): Promise<void>;
}
```

#### 6.4 IParser Implementation

`TypeScriptParser` now implements `IParser`:

```typescript
class TypeScriptParser implements IParser {
  async initialize(): Promise<void>;
  async parseFile(filePath: string): Promise<UCEFile>;
  parseCode(code: string, language: string): UCEFile;
  getSupportedLanguages(): string[];
  async close(): Promise<void>;
}
```

#### 6.5 Contract Test Suite

Created comprehensive contract tests in `src/core/interfaces/__tests__/`:

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `IParser.contract.test.ts` | 13 | parseFile, parseCode, syntax errors, entity extraction |
| `IGraphStore.contract.test.ts` | 11 | query, writeBatch, transactions, schema version |
| `integration.smoke.test.ts` | 7 | Full pipeline: parse → extract → store → query |

**All 31 tests passing.**

#### 6.6 CozoDB Compatibility Fixes

Key fixes discovered during testing:

1. **Underscore-prefixed relations are hidden**: Changed `_schema_version` to `schema_version`
2. **Block transactions don't preserve params**: Migrations execute statements immediately
3. **Vector type syntax**: `<F32; 384>` not `<384, F32>`
4. **Nullable vectors not allowed**: Created separate `FunctionEmbedding` relation

#### 6.7 Files Created/Modified

| File | Status | Purpose |
|------|--------|---------|
| `src/core/interfaces/index.ts` | New | Interface exports |
| `src/core/interfaces/IParser.ts` | New | Parser interface |
| `src/core/interfaces/IGraphStore.ts` | New | Graph store interface |
| `src/core/interfaces/IScanner.ts` | New | Scanner interface |
| `src/core/interfaces/ISemanticAnalyzer.ts` | New | Semantic analyzer interface |
| `src/core/interfaces/IExtractor.ts` | New | Extractor interface |
| `src/core/graph/cozo-graph-store.ts` | New | CozoGraphStore adapter |
| `src/core/graph/migrations/002_add_vector_indices.ts` | New | HNSW index migration |
| `src/core/graph/schema-definitions.ts` | Modified | Added FunctionEmbedding |
| `src/core/graph/database.ts` | Modified | Fixed schema_version handling |
| `src/core/graph/migration-runner.ts` | Modified | Fixed CozoDB compatibility |
| `src/core/graph/operations.ts` | Modified | Added vector search |
| `src/core/parser/typescript-parser.ts` | Modified | Implements IParser |

**Dependencies**: V1-V5

---

### V7: Graph Builder ✅ COMPLETE

**Goal**: Write extracted entities to graph database atomically

**What Was Built:**

#### 7.1 GraphWriter (`src/core/graph-builder/graph-writer.ts`)

Handles atomic writes of extracted entities:
- `writeFile(result)` - Write single file's extraction result
- `writeFiles(results)` - Write multiple files
- `writeBatch(batch)` - Write merged batch directly
- `deleteFileEntities(fileId)` - Delete all entities for a file
- `fileExists(fileId)` - Check if file exists
- `getFileHash(fileId)` - Get stored file hash
- `getAllFileHashes()` - Get all file hashes for change detection

```typescript
const writer = new GraphWriter(store);
const result = await writer.writeFile(extractionResult);
// { success: true, stats: { entitiesWritten: 5, relationshipsWritten: 3 } }
```

#### 7.2 IncrementalUpdater (`src/core/graph-builder/incremental-updater.ts`)

Smart updates based on file hash comparison:
- `detectChanges(currentFiles)` - Detect added/modified/deleted/unchanged files
- `update(results, currentFiles)` - Incremental update only changed files
- `fullReindex(results)` - Delete all and write fresh
- `getGraphStats()` - Get entity counts from graph

```typescript
const updater = new IncrementalUpdater(store);
const changes = await updater.detectChanges(currentFiles);
// { added: [...], modified: [...], deleted: [...], unchanged: [...] }

const result = await updater.update(extractionResults, currentFiles);
// Only writes files that have changed based on hash
```

#### 7.3 Tests

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `graph-writer.test.ts` | 10 | writeFile, deleteFileEntities, hash operations |
| `incremental-updater.test.ts` | 8 | change detection, incremental update, fullReindex |

**Dependencies**: V1, V5-V6

---

### V8: Indexer & Watcher 🔲 PENDING

**Goal**: Orchestrate full indexing pipeline with file watching

**What to Build:**
1. **IndexerCoordinator** - Pipeline orchestration
   - Scan → Parse → Analyze → Extract → Write
   - Progress reporting
   - Error recovery

2. **ReactiveFileWatcher** - RxJS-based watching
   - Buffer events for batching
   - Deduplicate rapid changes
   - Controlled concurrency

**Dependencies**: V1-V7

---

### V9: MCP Server 🔲 PENDING

**Goal**: Expose knowledge graph to AI agents via MCP

**What to Build:**
1. **MCPServer** - Protocol implementation
   - Tool definitions
   - Resource handlers
   - SSE transport

2. **QueryEngine** - Hybrid search
   - Vector search (CozoDB HNSW)
   - Keyword search (CozoDB)
   - Fuzzy search (Orama)
   - Result merging and ranking

3. **ResponseFormatter** - LLM-optimized output
   - Context assembly
   - Graph enrichment
   - Markdown formatting

**Dependencies**: V1-V8

---

### V10: LLM Integration 🔲 PENDING

**Goal**: Add business logic inference with local LLM

**What to Build:**
1. **LLMService** - Local model management
   - Model loading (node-llama-cpp)
   - GBNF grammar enforcement
   - Inference caching

2. **BusinessLogicInferrer** - Function summarization
   - Prompt engineering
   - Output cleaning
   - Confidence scoring

3. **GraphRAGSummarizer** - Hierarchical summaries
   - Function → File → Module → System
   - Query-time drill-down

**Dependencies**: V1-V9

---

### V11: CLI Commands 🔲 PENDING

**Goal**: Complete CLI with full functionality

**What to Build:**
1. **init** - Full project initialization
2. **index** - Manual indexing with progress
3. **start** - MCP server with watching
4. **status** - Detailed project status
5. **query** - Interactive query tool

**Dependencies**: V1-V10

---

## Dependencies

### Production Dependencies

| Package | Purpose |
|---------|---------|
| `@huggingface/transformers` | Local embeddings (ONNX) |
| `cozo-node` | Graph + Vector database (CozoDB with HNSW indices) |
| `@modelcontextprotocol/sdk` | MCP protocol server |
| `chalk` | CLI colored output |
| `chokidar` | File system watching |
| `commander` | CLI framework |
| `fast-glob` | Fast file pattern matching |
| `node-llama-cpp` | Local LLM inference |
| `ora` | CLI spinners |
| `pino` | Structured logging |
| `tree-sitter-*` | Parser grammars |
| `web-tree-sitter` | Code parsing (WASM) |
| `zod` | Schema validation |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `typescript-eslint` | TypeScript linting |
| `eslint` | Code linting |
| `prettier` | Code formatting |
| `vitest` | Testing framework |
| `pino-pretty` | Pretty logging (dev) |

---

## Build Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript
pnpm check-types      # Type check only
pnpm lint             # Lint code
pnpm test             # Run tests
pnpm dev              # Watch mode
```

---

*For architectural details, see [ARCHITECTURE.md](./ARCHITECTURE.md). For implementation progress tracking, see [implementation-tracker.md](./implementation-tracker.md).*

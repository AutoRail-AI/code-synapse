# Code-Synapse Implementation Tracker

This document tracks the implementation progress, decisions made, and details of what has been built.

---

## Phase 1: Foundation & CLI Framework

**Status**: Completed
**Date**: December 30, 2025

### What Was Built

#### 1.1 Project Setup

| Item | Status | Details |
|------|--------|---------|
| Package structure | Done | Single-package ESM project |
| TypeScript config | Done | NodeNext module resolution, ES2022 target |
| ESLint config | Done | typescript-eslint with prettier integration |
| Build system | Done | Pure `tsc` (no bundler needed for CLI) |

**Files Created:**
- `package.json` - Project manifest with all dependencies
- `tsconfig.json` - TypeScript configuration
- `eslint.config.js` - Flat ESLint config

#### 1.2 Foundational Utility Modules

| Module | File | Status | Description |
|--------|------|--------|-------------|
| Logger | `src/utils/logger.ts` | Done | Pino-based structured logging |
| File System | `src/utils/fs.ts` | Done | File operations, glob patterns, hashing |
| Errors | `src/core/errors.ts` | Done | Typed error classes with error codes |
| Types | `src/types/index.ts` | Done | Comprehensive type definitions |

**Key Features:**
- **Logger**: Component-specific loggers, pretty printing in dev, JSON in production
- **File System**: `findFiles()`, `calculateFileHash()`, `isIgnoredPath()`, `detectLanguage()`
- **Errors**: `CodeSynapseError`, `ParsingError`, `GraphError`, `VectorError`, `MCPError`
- **Types**: `ProjectConfig`, `FileEntity`, `FunctionEntity`, `ClassEntity`, etc.

#### 1.3 CLI Framework

| Command | File | Status | Description |
|---------|------|--------|-------------|
| `init` | `src/cli/commands/init.ts` | Done | Initialize project configuration |
| `start` | `src/cli/commands/start.ts` | Done | Start MCP server |
| `index` | `src/cli/commands/index.ts` | Done | Trigger project indexing |
| `status` | `src/cli/commands/status.ts` | Done | Show project status |

**CLI Entry Point:** `src/cli/index.ts`
- Global error handling (unhandledRejection, uncaughtException)
- Signal handlers (SIGINT, SIGTERM) for graceful shutdown
- Commander.js framework with subcommands

#### 1.4 Core Module Stubs

| Module | File | Status | Description |
|--------|------|--------|-------------|
| Parser | `src/core/parser/index.ts` | Stub | Tree-sitter parser |
| Graph Store | `src/core/graph/index.ts` | Stub | CozoDB operations |
| Vector Store | `src/core/vector/index.ts` | Stub | LanceDB operations |
| Embeddings | `src/core/embeddings/index.ts` | Stub | HuggingFace embeddings |
| LLM | `src/core/llm/index.ts` | Stub | Local LLM inference |
| Indexer | `src/core/indexer/index.ts` | Stub | Orchestrates indexing |

#### 1.5 MCP Server Stub

| File | Status | Description |
|------|--------|-------------|
| `src/mcp/server.ts` | Stub | MCP server implementation |
| `src/mcp/index.ts` | Done | Module exports |

---

## Decisions Made

### Decision 1: No Post-Install Script

**Date**: December 30, 2025

**Context**: Initially planned a `postinstall.js` script to download WASM parsers and verify dependencies.

**Decision**: Removed the postinstall script entirely.

**Rationale**:
1. Node.js version is enforced via `engines` field in package.json
2. Tree-sitter WASM files are included in npm packages and loaded from `node_modules` at runtime
3. Ollama check is done at runtime when LLM features are requested
4. Welcome message is shown by `code-synapse init` command
5. All dependencies come from npm packages - no external downloads

**Impact**: Simpler installation, no network requests during install, everything from package.json.

### Decision 2: Pure TypeScript Compiler (No Bundler)

**Date**: December 30, 2025

**Context**: Considered using tsup, esbuild, or other bundlers for build.

**Decision**: Use `tsc` directly for compilation.

**Rationale**:
1. CLI applications don't need bundling
2. Simpler build process with fewer dependencies
3. ESM output with NodeNext module resolution works well
4. Easier debugging with source maps

### Decision 3: Pino for Logging

**Date**: December 30, 2025

**Context**: Needed structured logging for debugging and production use.

**Decision**: Use Pino with pino-pretty for development.

**Rationale**:
1. Fastest JSON logger for Node.js
2. Structured logging with component context
3. Pretty printing in development, JSON in production
4. Low overhead in production

### Decision 4: ESLint Flat Config

**Date**: December 30, 2025

**Context**: ESLint 9+ uses new flat config format.

**Decision**: Use flat config with typescript-eslint.

**Configuration**:
- Allow unused variables prefixed with underscore (`_varName`)
- Integrate with prettier via eslint-config-prettier
- Use recommended rules from typescript-eslint

### Decision 5: Single Package Structure

**Date**: December 30, 2025

**Context**: Originally considered monorepo with separate packages for cli, core, mcp.

**Decision**: Single package with three-part internal architecture.

**Structure**:
```
src/
├── cli/      # CLI entry point and commands
├── core/     # Core business logic (parser, graph, vector, llm)
├── mcp/      # MCP server implementation
├── types/    # Shared type definitions
└── utils/    # Shared utilities
```

**Rationale**:
1. Simpler for initial development
2. No workspace complexity
3. Single build command
4. Can extract to monorepo later if needed

---

## Architectural Decisions (Phase 2+)

These decisions define the architecture for upcoming phases based on design review and bottleneck analysis.

### Decision 6: Schema Source of Truth

**Date**: December 30, 2025

**Context**: The implementation plan defined graph schema in two places - Cypher DDL strings and TypeScript interfaces. Manual synchronization guarantees drift and runtime errors.

**Decision**: Create a single schema definition that generates both CozoScript DDL and TypeScript types.

**What to Build**:
```
src/core/graph/
├── schema-definitions.ts   # Single source of truth (const SCHEMA = {...})
├── schema-generator.ts     # generateCypherDDL(), generateTypeScriptTypes()
└── generated/
    └── types.ts            # Auto-generated TypeScript interfaces
```

**How It Works**:
1. Define schema once in `schema-definitions.ts` using a type-safe object literal
2. `generateCozoScript()` produces `:create` statements for stored relations
3. `generateTypeScriptTypes()` produces matching TypeScript interfaces
4. Run generator as build step or on-demand

**Rationale**:
1. Eliminates manual synchronization errors
2. Schema changes are centralized
3. Full TypeScript type inference from schema
4. Foundation for migration system

**Trade-offs**:
- (+) Type safety across CozoScript and TypeScript
- (+) Single place to modify schema
- (-) Initial setup complexity
- (-) Generated code needs to be committed or generated at build time

---

### Decision 7: Versioned Schema Migrations

**Date**: December 30, 2025

**Context**: Hardcoded `initializeSchema()` function means users must delete `.codegraph/` and re-index from scratch on any schema change.

**Decision**: Implement a versioned migration system similar to database migration tools.

**What to Build**:
```
src/core/graph/
├── migration-runner.ts     # MigrationRunner class
└── migrations/
    ├── 001_initial_schema.ts
    ├── 002_add_inference_confidence.ts
    └── index.ts            # Exports all migrations
```

**How It Works**:
1. Store current schema version in `_schema_version` relation in CozoDB
2. On startup, compare current version vs target version
3. Run pending migrations sequentially (up or down)
4. Each migration is a transaction - rollback on failure

**Migration Structure**:
```typescript
export const migration: Migration = {
  version: 2,
  name: 'add_inference_confidence',
  async up(db) {
    // CozoScript uses :create for new relations
    await db.execute(':create function_confidence { id: String => confidence: Float }');
  },
  async down(db) {
    await db.execute('::remove function_confidence');
  },
};
```

**Rationale**:
1. Users can upgrade CLI without losing indexed data
2. Rollback capability for failed migrations
3. Clear history of schema evolution
4. Standard pattern familiar to developers

**Trade-offs**:
- (+) Non-destructive upgrades
- (+) Rollback support
- (-) More complex initialization
- (-) Must maintain migration files forever

---

### Decision 8: Universal Code Entity (UCE) Interface

**Date**: December 30, 2025

**Context**: Parser and AST Transformer were tightly coupled to TypeScript/Tree-sitter implementation. Adding Python or Go support would require refactoring the GraphWriter.

**Decision**: Define a language-agnostic UCE interface between parsers and the GraphWriter.

**What to Build**:
```
src/types/
└── uce.ts                  # UCEFunction, UCEClass, UCEInterface, etc.

src/core/parser/
├── parser.ts               # LanguageParser interface
├── typescript-parser.ts    # Implements LanguageParser, outputs UCE
└── javascript-parser.ts    # Implements LanguageParser, outputs UCE
```

**Interface Design**:
```typescript
// All parsers output this format
interface UCEFunction {
  kind: 'function';
  name: string;
  params: UCEParameter[];
  returnType: string | null;
  body: string;
  location: UCELocation;
  modifiers: UCEModifier[];
  docComment: string | null;
}

// GraphWriter only knows about UCE, not Tree-sitter
interface LanguageParser {
  readonly language: string;
  readonly extensions: string[];
  parse(filePath: string, content: string): Promise<UCEFile>;
}
```

**Rationale**:
1. GraphWriter is language-agnostic
2. Adding new language = new parser only
3. Clear contract between parsing and storage
4. Enables community-contributed parsers

**Trade-offs**:
- (+) Clean separation of concerns
- (+) Easy to add new languages
- (-) Some language-specific features may not map to UCE
- (-) Additional abstraction layer

---

### Decision 9: Worker Thread Isolation for Semantic Analysis

**Date**: December 30, 2025

**Context**: TypeScript Compiler API is synchronous, blocking, and memory-intensive. Running it in the main thread alongside the MCP server causes timeouts on large codebases (50k+ LOC).

**Decision**: Run semantic analysis in a dedicated Worker Thread.

**What to Build**:
```
src/workers/
└── semantic.worker.ts      # Runs TS Compiler API in isolation

src/core/semantic/
└── worker-manager.ts       # Spawns and communicates with worker
```

**Architecture**:
```
┌─────────────────────────────────────────────────────────┐
│                    Main Thread                           │
│  ┌─────────┐  ┌─────────┐  ┌─────────────────────────┐  │
│  │   MCP   │  │  Graph  │  │   Indexer Coordinator   │  │
│  │ Server  │  │   DB    │  │                         │  │
│  └─────────┘  └─────────┘  └───────────┬─────────────┘  │
└───────────────────────────────────────┬─────────────────┘
                                        │ postMessage()
                           ┌────────────▼────────────┐
                           │    Worker Thread        │
                           │  ┌────────────────────┐ │
                           │  │ TS Compiler API    │ │
                           │  │ Type Resolution    │ │
                           │  │ Symbol Linking     │ │
                           │  └────────────────────┘ │
                           └─────────────────────────┘
```

**How It Works**:
1. Main thread sends file paths to worker via `postMessage()`
2. Worker initializes TS Program once, analyzes files
3. Worker sends progress updates and results back
4. Main thread remains responsive for MCP queries

**Rationale**:
1. MCP server never blocks during indexing
2. Memory-intensive TS Compiler isolated
3. Worker can be terminated if stuck
4. Progress reporting without blocking UI

**Trade-offs**:
- (+) Non-blocking indexing
- (+) Memory isolation
- (-) Serialization overhead for large ASTs
- (-) More complex error handling

---

### Decision 10: Transactional Atomicity for File Updates

**Date**: December 30, 2025

**Context**: The incremental updater had separate `deleteFileNodes()` and `writeEntities()` calls. If process killed between them, graph is corrupted (file exists but functions missing).

**Decision**: Wrap all operations for a single file update in one database transaction.

**What to Build**:
- Update `IncrementalUpdater.updateFile()` to use single transaction
- Add transaction parameter to all graph operations

**Pattern**:
```typescript
// ❌ Bad: Separate operations
await deleteFileNodes(fileId);
await writeEntities(newEntities);  // Process killed here = corruption

// ✅ Good: Single transaction
async updateFile(fileId: string, newEntities: ExtractedEntities): Promise<void> {
  const tx = await this.db.beginTransaction();
  try {
    await this.deleteFileContents(fileId, tx);
    await this.insertEntities(fileId, newEntities, tx);
    await this.rebuildRelationships(fileId, newEntities, tx);
    await this.db.commit(tx);
  } catch (error) {
    await this.db.rollback(tx);
    throw error;
  }
}
```

**Rationale**:
1. Database never in inconsistent state
2. Automatic rollback on errors
3. Standard database best practice
4. Recoverable from crashes

**Trade-offs**:
- (+) Data integrity guaranteed
- (+) Automatic cleanup on failure
- (-) Longer lock duration per file
- (-) Must thread transaction through all operations

---

### Decision 11: Hybrid Search (Vector + Keyword + Graph)

**Date**: December 30, 2025

**Context**: Query Engine relied only on basic text search. This ignores the installed LanceDB vector capabilities and provides brittle keyword-only search.

**Decision**: Implement hybrid search combining three data sources.

**What to Build**:
```
src/core/search/
├── query-engine.ts         # Orchestrates all search types
├── vector-search.ts        # LanceDB semantic search
├── keyword-search.ts       # KùzuDB CONTAINS queries
├── fuzzy-search.ts         # Orama typo-tolerant search
└── result-merger.ts        # Combines and ranks results
```

**Search Architecture**:
```
User Query: "how does authentication work?"
       │
       ├──► Orama (Fuzzy) ──► Symbol names with typos
       │
       ├──► LanceDB (Semantic) ──► Conceptually related functions
       │
       └──► CozoDB (Keyword) ──► Exact matches + graph context
       │
       ▼
   Result Merger
       │
       ▼
   Ranked Results (items found in multiple sources boosted)
```

**How It Works**:
1. Convert query to embedding for vector search
2. Run all three searches in parallel
3. Merge results, boosting items found in multiple sources
4. Use graph to add context (callers, callees, dependencies)

**Rationale**:
1. Semantic search finds conceptually related code
2. Keyword search for exact matches
3. Fuzzy search handles typos
4. Graph adds structural context

**Trade-offs**:
- (+) Much better search quality
- (+) Handles natural language queries
- (-) More complex implementation
- (-) Requires embedding generation

---

### Decision 12: LLM Output Reliability with Confidence Scoring

**Date**: December 30, 2025

**Context**: Small local models (Qwen 2.5 1.5B) often include preambles ("Sure, here is the summary...") and vary in output quality. This pollutes the database.

**Decision**: Implement structured output cleaning and confidence scoring.

**What to Build**:
- Update `BusinessLogicInferrer` with cleaning logic
- Add `inference_confidence` field to Function relation
- Strict prompt formatting to minimize preambles

**Cleaning Pipeline**:
```typescript
function cleanAndScore(raw: string): InferenceResult {
  let cleaned = raw
    .replace(/^(Sure|Here|Okay|The function|This function)[^.]*[.:]\s*/gi, '')
    .replace(/^["']|["']$/g, '')
    .trim();

  const confidence = calculateConfidence(cleaned, raw);
  return { text: cleaned, confidence };
}

function calculateConfidence(cleaned: string, raw: string): number {
  if (cleaned.length < 30) return 0.3;           // Too short
  if (cleaned === raw.trim()) return 0.9;        // No cleaning needed
  if (cleaned.length / raw.length < 0.6) return 0.5;  // Heavy cleaning
  return 0.7;
}
```

**Rationale**:
1. Clean data in database
2. AI agents know which inferences to trust
3. Low-confidence inferences can be re-run
4. Metrics for model quality assessment

**Trade-offs**:
- (+) Higher quality data
- (+) Trust signals for consumers
- (-) Some valid outputs may be incorrectly cleaned
- (-) Additional processing overhead

---

## Planned Architecture Overview

This section consolidates the complete system architecture based on all decisions above.

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              User / AI Agent                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                                    │
                    ▼                                    ▼
┌─────────────────────────────┐        ┌─────────────────────────────────────┐
│         CLI Layer           │        │           MCP Layer                  │
│   (commander.js + chalk)    │        │   (@modelcontextprotocol/sdk)       │
│   ┌─────────────────────┐   │        │   ┌─────────────────────────────┐   │
│   │ init │ start │ index│   │        │   │  Tools  │  Resources  │     │   │
│   └─────────────────────┘   │        │   └─────────────────────────────┘   │
└─────────────────────────────┘        └─────────────────────────────────────┘
                    │                                    │
                    └──────────────┬─────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Core Layer                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        Indexer Coordinator                              │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │  │  ReactiveWatcher (RxJS) ──► bufferTime ──► dedupe ──► process   │  │ │
│  │  └──────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                          │
│  ┌────────────────┬───────────────┼───────────────┬────────────────────┐    │
│  ▼                ▼               ▼               ▼                    ▼    │
│ ┌──────┐    ┌─────────┐    ┌───────────┐    ┌─────────┐          ┌──────┐  │
│ │Parser│    │ Semantic│    │   Graph   │    │ Vector  │          │ LLM  │  │
│ │(UCE) │    │ Worker  │    │  Store    │    │  Store  │          │Service│ │
│ └──┬───┘    └────┬────┘    └─────┬─────┘    └────┬────┘          └──┬───┘  │
│    │             │               │               │                   │      │
│    │     ┌───────┴───────┐       │               │           ┌───────┴────┐ │
│    │     │ Worker Thread │       │               │           │GBNF Grammar│ │
│    │     │ (TS Compiler) │       │               │           │Constrained │ │
│    │     └───────────────┘       │               │           └────────────┘ │
│    │                             │               │                          │
│    ▼                             ▼               ▼                          │
│ ┌────────────────────────────────────────────────────────────────────────┐  │
│ │                        Search Layer                                     │ │
│ │   ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐    │  │
│ │   │Orama (Fuzzy)│    │LanceDB(Vec) │    │CozoDB (Keyword + Graph) │    │  │
│ │   └──────┬──────┘    └──────┬──────┘    └───────────┬─────────────┘    │  │
│ │          └──────────────────┼───────────────────────┘                  │  │
│ │                             ▼                                          │  │
│ │                    Result Merger (hybrid ranking)                       │ │
│ └────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Storage Layer                                        │
│   ┌────────────────────┐    ┌─────────────────────┐    ┌─────────────────┐  │
│   │  .code-synapse/    │    │  Schema Source of   │    │  GraphRAG       │  │
│   │  ├── graph.db      │    │  Truth Generator    │    │  Summaries      │  │
│   │  ├── vectors/      │    │  (DDL + Types)      │    │  (hierarchical) │  │
│   │  └── traces/       │    └─────────────────────┘    └─────────────────┘  │
│   └────────────────────┘                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Pipeline

```
┌────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌────────┐
│ File   │──►│ Parser  │──►│Semantic │──►│ Entity  │──►│ Graph   │──►│ Vector │
│ System │   │ (UCE)   │   │ Worker  │   │ Extract │   │ Writer  │   │ Writer │
└────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘   └────────┘
                                                             │
                                                             ▼
                                                       ┌───────────┐
                                                       │ LLM       │
                                                       │ Inference │
                                                       │ (GraphRAG)│
                                                       └───────────┘
```

### Key Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Parser | Tree-sitter WASM + UCE | Language-agnostic AST extraction |
| Semantic | Worker Thread + TS Compiler | Type resolution, call graph |
| Graph DB | CozoDB (RocksDB) | Structural relationships |
| Vector DB | LanceDB | Semantic embeddings |
| Fuzzy Search | Orama | Typo-tolerant symbol search |
| File Watching | RxJS + chokidar | Backpressure-managed events |
| LLM | node-llama-cpp + GBNF | Grammar-constrained inference |
| Embeddings | HuggingFace ONNX | Local embedding generation |
| Telemetry | OpenTelemetry | Performance tracing |

### Trade-offs Summary

| Decision | Benefit | Cost |
|----------|---------|------|
| Schema Source of Truth | Type safety, no drift | Initial setup complexity |
| Versioned Migrations | Non-destructive upgrades | Must maintain migrations |
| UCE Interface | Easy to add languages | Extra abstraction layer |
| Worker Thread Isolation | Non-blocking MCP | Serialization overhead |
| Transactional Atomicity | Data integrity | Longer lock duration |
| Hybrid Search | Better search quality | More complex implementation |
| LLM Confidence Scoring | Trust signals | Some false positives |
| TypeScript 5.2 `using` | Automatic cleanup | Requires TS 5.2+ |
| RxJS Reactive Streams | Robust backpressure | Learning curve |
| GraphRAG Summaries | Better high-level queries | More LLM calls |
| GBNF Grammars | 100% valid output | Only node-llama-cpp |
| Orama Fuzzy Search | Sub-ms, typo tolerant | In-memory, rebuild on restart |
| OpenTelemetry | Identify bottlenecks | Small runtime overhead |

---

## Modern Tech Stack Decisions (2025)

These decisions adopt cutting-edge TypeScript and Node.js features for a production-quality sidecar.

### Decision 13: TypeScript 5.2+ Explicit Resource Management

**Date**: December 30, 2025

**Context**: Managing resources (DB connections, file handles, worker threads) requires verbose `try/finally` blocks. Missed cleanup causes memory leaks in long-running sidecar processes.

**Decision**: Use TypeScript 5.2 `using` keyword with `Disposable` interface.

**What to Build**:
- Implement `Disposable` on `TransactionScope`, `PooledParser`, `WorkerHandle`
- Update code to use `using` declarations

**Pattern**:
```typescript
// Resource implements Disposable
class TransactionScope implements Disposable {
  [Symbol.dispose](): void {
    if (this.committed) {
      this.db.commitSync(this.tx);
    } else {
      this.db.rollbackSync(this.tx);
    }
  }
}

// Usage - automatic cleanup!
async function updateFile(fileId: string): Promise<void> {
  using tx = new TransactionScope(db, await db.beginTransaction());
  using parser = await parserPool.acquire();

  const ast = parser.parse(content);
  await tx.execute('...');

  tx.commit();
  // Both resources auto-disposed when function exits
}
```

**Rationale**:
1. Prevents memory leaks in long-running processes
2. Cleaner code without nested try/finally
3. Automatic rollback on errors
4. Modern JavaScript standard (Stage 3)

**tsconfig.json Update**:
```json
{
  "compilerOptions": {
    "lib": ["ES2022", "ESNext.Disposable"]
  }
}
```

**Trade-offs**:
- (+) Cleaner, safer resource management
- (+) Works with async resources via `AsyncDisposable`
- (-) Requires TypeScript 5.2+
- (-) Sync dispose for DB might need workaround

---

### Decision 14: RxJS for Reactive File Watching

**Date**: December 30, 2025

**Context**: When user runs `git checkout another-branch`, hundreds of file events fire instantly. Simple callback + queue approach can bloat memory and overwhelm the indexer.

**Decision**: Use RxJS Observables for event stream processing with backpressure.

**What to Build**:
```
src/core/watcher/
└── reactive-watcher.ts     # RxJS-based file watcher
```

**Pipeline Design**:
```typescript
this.events$.pipe(
  bufferTime(500),           // Collect events for 500ms
  filter(events => events.length > 0),
  map(events => this.deduplicate(events)),
  mergeMap(
    events => this.indexer.processBatch(events),
    2  // Max 2 concurrent batches
  )
).subscribe({
  next: result => this.logger.info(`Indexed ${result.processed} files`),
  error: err => this.logger.error('Pipeline error:', err)
});
```

**Rationale**:
1. Handles `git checkout` with 500+ file changes gracefully
2. Automatic backpressure management
3. Deduplication prevents redundant reindexing
4. Controlled concurrency

**Dependencies to Add**:
```bash
pnpm add rxjs
```

**Trade-offs**:
- (+) Robust event handling
- (+) Built-in backpressure
- (-) Learning curve for RxJS
- (-) Additional dependency

---

### Decision 15: GraphRAG for Hierarchical Summarization

**Date**: December 30, 2025

**Context**: Summarizing only individual functions means "How does payment work?" requires scanning 500 function summaries.

**Decision**: Implement GraphRAG pattern with hierarchical summaries.

**What to Build**:
```
src/core/llm/
└── graph-rag.ts            # GraphRAGSummarizer class
```

**Hierarchy**:
```
System Summary
    └── Module Summaries (detected via import clustering)
        └── File Summaries
            └── Function Summaries
```

**How It Works**:
1. **Bottom-up summarization**: Summarize functions first
2. **Aggregation**: Combine function summaries into file summary
3. **Clustering**: Detect modules via import graph analysis
4. **Module summary**: Combine file summaries
5. **System summary**: High-level overview

**Query Flow**:
1. "How does payment work?" → Search module summaries
2. Find "Payment Module" → Get its file summaries
3. Drill down to specific functions as needed

**Rationale**:
1. High-level questions answered quickly
2. Reduces LLM context window usage
3. Better architectural understanding
4. Follows Microsoft Research GraphRAG pattern

**Trade-offs**:
- (+) Much better high-level queries
- (+) Reduced context for LLM
- (-) More LLM calls during indexing
- (-) Summaries may become stale

---

### Decision 16: GBNF Grammar-Constrained LLM Output

**Date**: December 30, 2025

**Context**: Prompt engineering alone cannot guarantee valid JSON from small local models. Output parsing failures cause runtime errors.

**Decision**: Use GBNF grammars with `node-llama-cpp` to force valid output.

**What to Build**:
```
src/core/llm/
└── constrained-generator.ts
```

**Grammar Definition**:
```typescript
const BUSINESS_LOGIC_GRAMMAR = `
root ::= "{" ws "\"summary\":" ws string "," ws "\"tags\":" ws tags "," ws "\"confidence\":" ws number ws "}"
string ::= "\"" ([^"\\] | "\\" .)* "\""
tags ::= "[" ws (string (ws "," ws string)*)? ws "]"
number ::= [0-9]+ ("." [0-9]+)?
ws ::= [ \\t\\n]*
`;

// Model literally cannot output anything else
const response = await context.evaluate(prompt, { grammar });
return JSON.parse(response);  // Guaranteed valid!
```

**Rationale**:
1. 100% reliable JSON output
2. Works with small models (Qwen 1.5B)
3. No post-processing error handling
4. Structured tags for better search

**Trade-offs**:
- (+) Guaranteed valid output
- (+) Structured data extraction
- (-) Only works with node-llama-cpp (not Ollama HTTP API)
- (-) Grammar syntax learning curve

---

### Decision 17: Orama for Fuzzy Symbol Search

**Date**: December 30, 2025

**Context**: Developers search with typos or partial names (`usr_id` should match `userId`). Cypher `CONTAINS` doesn't handle fuzzy matching.

**Decision**: Use Orama for in-memory fuzzy full-text search.

**What to Build**:
```
src/core/search/
└── orama-index.ts          # SymbolSearchIndex class
```

**Why Orama**:
- Pure JavaScript (no native dependencies)
- Sub-millisecond search (~0.5ms for 10k symbols)
- Built-in typo tolerance
- Zero external services

**Search Configuration**:
```typescript
const db = await create({
  schema: {
    id: 'string',
    name: 'string',
    type: 'enum',
    filePath: 'string',
    signature: 'string',
  },
  components: {
    tokenizer: {
      stemming: true,
      enableFuzzySearch: true,
    },
  },
});

// Typo-tolerant search
await search(db, {
  term: 'getUserByld',  // Typo: 'ld' instead of 'Id'
  tolerance: 2,
  properties: ['name', 'signature'],
});
// Returns: getUserById, get_user_by_id, etc.
```

**Dependencies to Add**:
```bash
pnpm add @orama/orama
```

**Trade-offs**:
- (+) Sub-millisecond fuzzy search
- (+) Pure JS, no native code
- (-) In-memory (limited by RAM)
- (-) Must rebuild index on restart

---

### Decision 18: OpenTelemetry for Observability

**Date**: December 30, 2025

**Context**: Sidecar is a black box to users. When indexing takes 30 seconds, users don't know why.

**Decision**: Instrument with OpenTelemetry for performance tracing.

**What to Build**:
```
src/core/telemetry/
├── tracer.ts               # OTel setup and traced() decorator
└── file-exporter.ts        # Export traces to .code-synapse/traces/
```

**Tracing Pattern**:
```typescript
// Decorator for automatic tracing
export function traced(spanName?: string) {
  return function(target, key, descriptor) {
    const original = descriptor.value;
    descriptor.value = async function(...args) {
      return tracer.startActiveSpan(spanName ?? `${target.constructor.name}.${key}`, async (span) => {
        try {
          const result = await original.apply(this, args);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.recordException(error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      });
    };
  };
}

// Usage
class Indexer {
  @traced()
  async indexFile(filePath: string): Promise<void> { ... }
}
```

**Trace Output** (viewable in Chrome `chrome://tracing`):
```
indexProject (12.5s)
├── scanFiles (0.8s)
├── parseFiles (4.2s)
│   ├── parse auth.ts (0.1s)
│   ├── parse user.ts (0.15s)
│   └── ... 100 more files
├── semanticAnalysis (5.1s)  ◄── Bottleneck!
│   └── tsCompiler.analyze (5.0s)
└── writeGraph (2.4s)
```

**Dependencies to Add**:
```bash
pnpm add @opentelemetry/sdk-node @opentelemetry/api
```

**Trade-offs**:
- (+) Identify performance bottlenecks
- (+) Debug slow operations
- (+) Standard observability format
- (-) Small runtime overhead
- (-) Additional dependencies

---

## Dependencies Installed

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@huggingface/transformers` | ^3.5.1 | Local embeddings generation |
| `cozo-node` | ^0.7.6 | Graph + Vector database (CozoDB with HNSW indices) |
| `@modelcontextprotocol/sdk` | ^1.25.1 | MCP protocol support |
| `chalk` | ^5.6.2 | Terminal styling |
| `chokidar` | ^5.0.0 | File watching |
| `commander` | ^14.0.2 | CLI framework |
| `fast-glob` | ^3.3.3 | File pattern matching |
| `node-llama-cpp` | ^3.14.5 | Local LLM inference |
| `ora` | ^9.0.0 | Terminal spinners |
| `pino` | ^10.1.0 | Structured logging |
| `tree-sitter-javascript` | ^0.25.0 | JavaScript parser grammar |
| `tree-sitter-typescript` | ^0.23.2 | TypeScript parser grammar |
| `web-tree-sitter` | ^0.26.3 | WASM Tree-sitter runtime |
| `zod` | ^4.2.1 | Schema validation |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@eslint/js` | ^9.39.1 | ESLint JavaScript config |
| `@types/node` | ^22.15.3 | Node.js type definitions |
| `eslint` | ^9.39.1 | Linting |
| `eslint-config-prettier` | ^10.1.0 | Prettier integration |
| `globals` | ^16.2.0 | Global variables for ESLint |
| `pino-pretty` | ^13.1.3 | Pretty logging (dev) |
| `prettier` | ^3.7.4 | Code formatting |
| `typescript` | 5.9.2 | TypeScript compiler |
| `typescript-eslint` | ^8.33.0 | TypeScript ESLint rules |
| `vitest` | ^4.0.16 | Testing framework |

---

## Current File Structure

```
code-synapse/
├── docs/
│   ├── implementation-plan.md
│   └── implementation-tracker.md    # This file
├── src/
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── index.ts            # index command
│   │   │   ├── init.ts             # init command
│   │   │   ├── start.ts            # start command
│   │   │   └── status.ts           # status command
│   │   └── index.ts                # CLI entry point
│   ├── core/
│   │   ├── embeddings/
│   │   │   └── index.ts            # HuggingFace embeddings (stub)
│   │   ├── graph/
│   │   │   ├── cozo-graph-store.ts # V6: CozoGraphStore adapter
│   │   │   ├── database.ts         # CozoDB wrapper with transactions
│   │   │   ├── index.ts            # Graph module exports
│   │   │   ├── migration-runner.ts # Schema migration system
│   │   │   ├── migrations/
│   │   │   │   ├── 001_initial_schema.ts  # Initial schema migration
│   │   │   │   ├── 002_add_vector_indices.ts  # V6: HNSW vector index
│   │   │   │   └── index.ts        # Migration registry
│   │   │   ├── operations.ts       # Graph CRUD operations
│   │   │   ├── schema-definitions.ts  # Schema source of truth
│   │   │   └── schema-generator.ts # CozoScript DDL generator
│   │   ├── indexer/
│   │   │   ├── coordinator.ts      # V8: IndexerCoordinator pipeline orchestration
│   │   │   ├── hasher.ts           # File hashing and change detection
│   │   │   ├── index.ts            # Indexer module exports
│   │   │   ├── project-detector.ts # Project type/framework detection
│   │   │   ├── scanner.ts          # File discovery and cataloging
│   │   │   ├── watcher.ts          # V8: FileWatcher for file change monitoring
│   │   │   └── __tests__/
│   │   │       ├── coordinator.test.ts
│   │   │       └── watcher.test.ts
│   │   ├── llm/
│   │   │   └── index.ts            # Local LLM service (stub)
│   │   ├── parser/
│   │   │   ├── ast-transformer.ts  # CST to UCE conversion
│   │   │   ├── call-extractor.ts   # Function call extraction
│   │   │   ├── index.ts            # Parser exports & legacy wrapper
│   │   │   ├── parser-manager.ts   # Tree-sitter WASM manager
│   │   │   └── typescript-parser.ts # TS/JS language parser
│   │   ├── semantic/
│   │   │   ├── dependency-analyzer.ts  # Module dependency graph builder
│   │   │   ├── index.ts                # SemanticAnalyzer facade & exports
│   │   │   ├── symbol-linker.ts        # Cross-file symbol resolution
│   │   │   ├── ts-program.ts           # TypeScript Program Manager
│   │   │   ├── type-resolver.ts        # Type resolution using TypeChecker
│   │   │   ├── types.ts                # Semantic analysis type definitions
│   │   │   └── worker-manager.ts       # Worker thread orchestration
│   │   ├── extraction/
│   │   │   ├── types.ts                # CozoBatch and row types
│   │   │   ├── id-generator.ts         # Signature-based ID generation
│   │   │   ├── function-extractor.ts   # Function/method extraction
│   │   │   ├── class-extractor.ts      # Class extraction with methods
│   │   │   ├── interface-extractor.ts  # Interface and type alias extraction
│   │   │   ├── import-extractor.ts     # Import handling and ghost nodes
│   │   │   ├── pipeline.ts             # EntityPipeline orchestration
│   │   │   └── index.ts                # Module exports
│   │   ├── graph-builder/              # V7: Atomic writes & incremental updates
│   │   │   ├── graph-writer.ts         # Atomic entity writes
│   │   │   ├── incremental-updater.ts  # Smart file updates
│   │   │   ├── index.ts                # Module exports
│   │   │   └── __tests__/
│   │   │       ├── graph-writer.test.ts
│   │   │       └── incremental-updater.test.ts
│   │   ├── interfaces/                 # V6: Interface contracts
│   │   │   ├── index.ts                # Interface re-exports
│   │   │   ├── IParser.ts              # Parser interface
│   │   │   ├── IGraphStore.ts          # Graph store interface
│   │   │   ├── IScanner.ts             # File scanner interface
│   │   │   ├── ISemanticAnalyzer.ts    # Semantic analyzer interface
│   │   │   ├── IExtractor.ts           # Entity extractor interface
│   │   │   └── __tests__/              # Contract tests
│   │   │       ├── IParser.contract.test.ts
│   │   │       ├── IGraphStore.contract.test.ts
│   │   │       └── integration.smoke.test.ts
│   │   ├── telemetry/
│   │   │   ├── index.ts            # Telemetry exports
│   │   │   ├── metrics.ts          # Counter, Gauge, Histogram
│   │   │   └── tracer.ts           # OpenTelemetry-compatible tracing
│   │   ├── errors.ts               # Error classes
│   │   └── index.ts                # Core exports
│   ├── mcp/
│   │   ├── index.ts                # MCP exports
│   │   └── server.ts               # MCP server (stub)
│   ├── types/
│   │   ├── index.ts                # Type definitions
│   │   ├── result.ts               # Result<T,E> type
│   │   └── uce.ts                  # Universal Code Entity types
│   ├── utils/
│   │   ├── async.ts                # Deferred, timeout, retry, CancellationToken
│   │   ├── disposable.ts           # Disposable/AsyncDisposable interfaces
│   │   ├── events.ts               # Type-safe EventBus
│   │   ├── fs.ts                   # File system utilities
│   │   ├── index.ts                # Utils exports
│   │   ├── logger.ts               # Pino logger
│   │   ├── pool.ts                 # Generic object pool
│   │   └── validation.ts           # Zod validation schemas
│   └── workers/
│       ├── index.ts                # Workers module exports
│       └── semantic.worker.ts      # Semantic analysis worker thread
├── dist/                           # Compiled output
├── .code-synapse/                  # Runtime config (created by init)
│   ├── config.json
│   ├── data/
│   └── logs/
├── package.json
├── tsconfig.json
├── eslint.config.js
├── CLAUDE.md
├── LICENSE
└── README.md
```

---

## Verification Results

**Last verified**: December 30, 2025

| Check | Status | Notes |
|-------|--------|-------|
| `pnpm build` | Pass | Compiles without errors |
| `pnpm check-types` | Pass | No type errors |
| `pnpm lint` | Pass | No lint errors (after config update) |
| `code-synapse --help` | Pass | Shows all commands |
| `code-synapse --version` | Pass | Shows 0.1.0 |
| `code-synapse init` | Pass | Creates .code-synapse/ |
| `code-synapse status` | Pass | Shows project status |
| `code-synapse status --verbose` | Pass | Shows detailed info |
| `code-synapse index` | Pass | Discovers and lists files |
| `code-synapse start --help` | Pass | Shows start options |

---

## Next Steps: Horizontal → Vertical Build Order

### Build Philosophy

**Horizontals First**: Cross-cutting infrastructure must be complete before verticals.
**Verticals Stack**: Each vertical builds on previous verticals.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    VERTICALS (Features)                                  │
│  V1 Graph ✅ → V2 Scanner ✅ → V3 Parser ✅ → V4 Semantic ✅ → V5 Extract ✅ │
│  → V6 Refactor ✅ → V7 Build ✅ → V8 Indexer ✅ → V9 MCP ✅ → V10 LLM ✅ → V11 CLI│
└─────────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ depends on
┌─────────────────────────────┴───────────────────────────────────────────┐
│                    HORIZONTALS (Infrastructure)                          │
│  H1 Foundation ✅ → H2 Disposables ✅ → H3 Schema/Types ✅ → H4 Async ✅ → H5 Telemetry ✅ │
└─────────────────────────────────────────────────────────────────────────┘
```

### H2: Resource Management ✅ Complete

1. **Updated `tsconfig.json`** ✅
   - Added `"ESNext.Disposable"` to lib array

2. **Created `src/utils/disposable.ts`** ✅
   - `Disposable` interface with `[Symbol.dispose]()`
   - `AsyncDisposable` interface with `[Symbol.asyncDispose]()`
   - `DisposableResource` and `AsyncDisposableResource` base classes
   - `DisposableStack` and `AsyncDisposableStack` for managing multiple resources
   - Utility functions: `createDisposable()`, `createAsyncDisposable()`

### H3: Schema & Types ✅ Complete

1. **Schema Source of Truth** (`src/core/graph/schema-definitions.ts`) ✅
   - Single source for all node/relationship types
   - Type-safe schema with full TypeScript inference
   - Defines all node tables (File, Function, Class, Interface, Variable, etc.)
   - Defines all relationship tables (CONTAINS, CALLS, IMPORTS, EXTENDS, IMPLEMENTS)

2. **Schema Generator** (`src/core/graph/schema-generator.ts`) ✅
   - `generateCozoScript()` produces `:create` statements
   - Full property mapping with CozoDB types
   - Relation definitions

3. **UCE Types** (`src/types/uce.ts`) ✅
   - Language-agnostic interfaces (UCEFunction, UCEClass, UCEInterface, etc.)
   - UCEFile container with all entities
   - UCELocation for source positions
   - LanguageParser interface for polyglot support

4. **Validation** (`src/utils/validation.ts`) ✅
   - Zod schemas for runtime validation
   - ProjectConfig validation
   - Entity validation schemas

### H4: Async Infrastructure ✅ Complete

1. **Result Type** (`src/types/result.ts`) ✅
   - `Result<T, E>` discriminated union
   - `ok()` and `err()` constructors
   - `isOk()`, `isErr()` type guards
   - `unwrap()`, `unwrapOr()`, `map()`, `mapErr()`, `andThen()`

2. **Async Utilities** (`src/utils/async.ts`) ✅
   - `Deferred<T>` for promise externalization
   - `timeout()` for deadline management
   - `retry()` with exponential backoff
   - `CancellationToken` for cooperative cancellation

3. **Object Pool** (`src/utils/pool.ts`) ✅
   - Generic `Pool<T>` for resource pooling
   - Configurable min/max size
   - Async acquire/release with timeout
   - Health checking and eviction

4. **Event Bus** (`src/utils/events.ts`) ✅
   - Type-safe `EventBus<Events>` with typed event map
   - `emit()`, `on()`, `off()`, `once()`
   - Wildcard listener support

### H5: Telemetry ✅ Complete

1. **Tracer** (`src/core/telemetry/tracer.ts`) ✅
   - OpenTelemetry-compatible span interface
   - `traced()` decorator for automatic instrumentation
   - In-memory trace recording with export

2. **Metrics** (`src/core/telemetry/metrics.ts`) ✅
   - Counter, Gauge, Histogram metric types
   - Named metrics registry
   - Duration measurement utilities

### V1: Graph Database ✅ Complete

1. **Database Wrapper** (`src/core/graph/database.ts`) ✅
   - CozoDB initialization and lifecycle (RocksDB backend)
   - Implements `AsyncDisposable` from H2
   - Transaction management (begin, commit, rollback)
   - `withTransaction()` for automatic transaction handling
   - Query execution with parameterization
   - Schema version management

2. **Migration System** (`src/core/graph/migration-runner.ts`) ✅
   - `MigrationRunner` class with `registerMigrations()`
   - `getStatus()`, `migrate()`, `rollback()`, `reset()`
   - Each migration wrapped in transaction for atomicity
   - Version tracking in `_schema_version` relation

3. **Migrations** (`src/core/graph/migrations/`) ✅
   - `001_initial_schema.ts` - Creates all relations from schema definitions
   - `index.ts` - Registry with `getMigration()`, `getLatestVersion()`

4. **Graph Operations** (`src/core/graph/operations.ts`) ✅
   - `GraphOperations` class for high-level CRUD
   - Node operations: create, get, update, delete for File, Function, Class
   - Relationship operations: createContains, createCalls, createImports, etc.
   - Query operations: getCallers, getCallees, getImportChain, findFunctionsByName
   - Batch operations for bulk inserts

### V2: File System Scanner ✅ Complete

1. **Project Detector** (`src/core/indexer/project-detector.ts`) ✅
   - Automatic project type detection from package.json
   - Framework detection (Next.js, React, Express, NestJS, etc.)
   - Language detection (TypeScript/JavaScript/mixed)
   - Package manager detection (npm/yarn/pnpm/bun)
   - Monorepo and workspace detection
   - Source patterns by framework
   - Ignore patterns configuration

2. **File Scanner** (`src/core/indexer/scanner.ts`) ✅
   - `FileScanner` class for project file discovery
   - Controlled concurrency for file operations
   - Content hash computation for change detection
   - File metadata collection (size, lastModified, language)
   - `scanForChanges()` for incremental updates
   - Progress callback support

3. **File Hasher** (`src/core/indexer/hasher.ts`) ✅
   - `FileHasher` class with in-memory caching
   - Single file and batch hash operations
   - Change detection utilities
   - Session-level hash caching

4. **Indexer Integration** (`src/core/indexer/index.ts`) ✅
   - Updated `Indexer` class with new components
   - Uses `GraphDatabase` for CozoDB operations
   - `scanProject()` method for file discovery
   - `indexProject()` with progress reporting

### V3: Code Parser ✅ Complete

1. **Parser Manager** (`src/core/parser/parser-manager.ts`) ✅
   - `ParserManager` class for Tree-sitter WASM wrapper
   - Multi-language parser management (TypeScript, JavaScript, TSX, JSX)
   - Implements `AsyncDisposable` for resource cleanup
   - `parseFile()` and `parseCode()` methods
   - `incrementalParse()` for efficient re-parsing
   - WASM grammar loading from node_modules
   - Language detection from file extensions

2. **AST Transformer** (`src/core/parser/ast-transformer.ts`) ✅
   - `ASTTransformer` class for CST to UCE conversion
   - Transforms Tree-sitter Concrete Syntax Tree to Universal Code Entity format
   - Extracts functions, classes, interfaces, type aliases, variables
   - Extracts imports and exports with specifier details
   - Parses parameters, type parameters, and modifiers
   - Calculates cyclomatic complexity
   - Extracts JSDoc comments
   - Builds function signatures

3. **TypeScript Parser** (`src/core/parser/typescript-parser.ts`) ✅
   - `TypeScriptParser` class implementing `LanguageParser` interface
   - Supports `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` extensions
   - Combines `ParserManager` and `ASTTransformer`
   - `JavaScriptParser` class for JS-specific parsing
   - Factory functions: `createTypeScriptParser()`, `createJavaScriptParser()`
   - `createInitializedTypeScriptParser()` for convenience

4. **Call Extractor** (`src/core/parser/call-extractor.ts`) ✅
   - `CallExtractor` class for function call relationship extraction
   - `FunctionCall` interface with caller, callee, location, context
   - `FileCallGraph` with `callsFrom` and `callsTo` maps
   - Extracts direct calls, method calls, constructor calls
   - Tracks `isAwait`, `isConstructorCall`, `receiver`, `arguments`
   - `extractFromTree()` for standalone extraction
   - `extractFromUCE()` for richer context with UCE file

5. **Parser Index** (`src/core/parser/index.ts`) ✅
   - Re-exports all parser modules
   - Backwards-compatible `Parser` class wrapper
   - `createParser()` factory function
   - Type exports for public API

See `docs/implementation-plan.md` for detailed specifications.

### V5: Entity Extraction ✅ Complete

See above in the V5 section under "### V5: Entity Extraction ✅ Complete"

### V4: Semantic Analysis ✅ Complete

1. **Semantic Types** (`src/core/semantic/types.ts`) ✅
   - Core type definitions for semantic analysis
   - `TypeInfo`, `ResolvedParameter`, `ResolvedFunctionSignature`
   - `LinkedSymbol`, `DefinitionLocation`, `ReferenceLocation`
   - `DependencyGraph`, `DependencyNode`, `DependencyEdge`, `CircularDependency`
   - `AnalyzedFile`, `SymbolReference`, `ResolvedImport`, `ResolvedExport`
   - `SemanticRequest`, `SemanticResponse`, `ProgressInfo` for worker communication
   - `SymbolKind` enum for symbol classification

2. **TypeScript Program Manager** (`src/core/semantic/ts-program.ts`) ✅
   - `TypeScriptProgramManager` class wraps `ts.Program` and `ts.TypeChecker`
   - Loads tsconfig.json and creates TypeScript program
   - `loadProgram()`, `getTypeChecker()`, `getSourceFile()`
   - `resolveModulePath()` for module resolution
   - `getDiagnostics()` for error reporting
   - Implements `AsyncDisposable` for resource cleanup
   - Utility functions: `getNodePosition()`, `getNodeEndPosition()`, `getNodeRange()`, `formatDiagnostic()`

3. **Type Resolver** (`src/core/semantic/type-resolver.ts`) ✅
   - `TypeResolver` class for resolving types using TypeChecker
   - `resolveType()` - Resolves type of any AST node to `TypeInfo`
   - `resolveFunctionSignature()` - Full function type resolution
   - `resolveParameters()` - Parameter type resolution
   - `getReturnType()`, `getSymbolType()` methods
   - Type classification: primitive, complex, generic, union, intersection
   - Built-in type detection

4. **Symbol Linker** (`src/core/semantic/symbol-linker.ts`) ✅
   - `SymbolLinker` class for cross-file symbol resolution
   - `linkCallToDefinition()` - Links function calls to definitions
   - `findAllReferences()` - Finds all references to a symbol
   - `getCrossFileReferences()` - Gets cross-file dependencies
   - `getExportedSymbols()` - Lists symbols exported from a file
   - Alias resolution for import/export chains
   - Symbol kind classification

5. **Dependency Analyzer** (`src/core/semantic/dependency-analyzer.ts`) ✅
   - `DependencyAnalyzer` class for building module dependency graphs
   - `buildDependencyGraph()` - Full project dependency graph
   - `getFileDependencies()` - Direct dependencies of a file
   - `getTransitiveDependencies()` - Recursive dependency resolution
   - `detectCircularDependencies()` - Circular import detection
   - `extractImports()`, `extractExports()` - Import/export analysis
   - Dependency depth calculation

6. **Semantic Worker** (`src/workers/semantic.worker.ts`) ✅
   - Worker thread for isolated TypeScript Compiler API execution
   - Handles `initialize`, `analyze`, `shutdown` request types
   - Progress reporting via `postMessage()`
   - Full file analysis: types, symbols, references, diagnostics
   - Memory isolation from main thread

7. **Worker Manager** (`src/core/semantic/worker-manager.ts`) ✅
   - `SemanticWorkerManager` class orchestrates worker thread
   - `initialize()` - Sets up worker with project config
   - `analyze()` - Async analysis with progress callback
   - `terminate()` - Clean worker shutdown
   - State management: idle, initializing, analyzing, terminated
   - Request/response handling with UUID tracking
   - Implements `AsyncDisposable`

8. **Semantic Analyzer Facade** (`src/core/semantic/index.ts`) ✅
   - `SemanticAnalyzer` class combining all capabilities
   - `getDependencyGraph()`, `analyzeFiles()`, `getTypeResolver()`
   - Factory functions: `createSemanticAnalyzer()`, `createInitializedSemanticAnalyzer()`
   - Module exports for all semantic components

9. **Workers Module** (`src/workers/index.ts`) ✅
   - Worker files registry
   - Module structure for worker threads

### V5: Entity Extraction ✅ Complete

1. **Types** (`src/core/extraction/types.ts`) ✅
   - `CozoBatch` - Native row arrays for CozoDB insertion
   - `FileRow`, `FunctionRow`, `ClassRow`, `InterfaceRow`, etc.
   - `UnresolvedCall`, `UnresolvedTypeRef` for two-pass resolution
   - `EmbeddingChunk` for vector embedding preparation

2. **ID Generator** (`src/core/extraction/id-generator.ts`) ✅
   - `generateEntityId()` - Signature-based IDs (not line-based)
   - `generateFileId()` - Normalized file path hashing
   - `generateGhostId()` - External package symbol IDs
   - `createParamDisambiguator()` - Overload differentiation
   - 16-character hex IDs using SHA-256

3. **Function Extractor** (`src/core/extraction/function-extractor.ts`) ✅
   - `FunctionExtractor.extract()` - Top-level functions
   - `FunctionExtractor.extractMethod()` - Class methods
   - Embedding text preparation (signature + docs + body snippet)
   - Type reference extraction for USES_TYPE relationships

4. **Class Extractor** (`src/core/extraction/class-extractor.ts`) ✅
   - `ClassExtractor.extract()` - Classes with methods
   - Constructor extraction
   - `HAS_METHOD` relationship rows
   - Inheritance tracking (EXTENDS, IMPLEMENTS)
   - Embedding chunks for class and methods

5. **Interface Extractor** (`src/core/extraction/interface-extractor.ts`) ✅
   - `InterfaceExtractor.extractInterface()` - Interfaces
   - `InterfaceExtractor.extractTypeAlias()` - Type aliases
   - Properties stored as JSON string
   - `EXTENDS_INTERFACE` tracking

6. **Import Extractor** (`src/core/extraction/import-extractor.ts`) ✅
   - `ImportExtractor.extractImports()` - IMPORTS relationships
   - `ImportExtractor.extractVariable()` - Module-level variables
   - GhostNode creation for external packages
   - Import path resolution
   - Package name extraction (scoped and regular)

7. **Entity Pipeline** (`src/core/extraction/pipeline.ts`) ✅
   - `EntityPipeline.extract()` - Main orchestration
   - `EntityPipeline.mergeBatches()` - Batch combination
   - Error handling with location tracking
   - Statistics collection
   - Two-pass architecture support

8. **Module Exports** (`src/core/extraction/index.ts`) ✅
   - Re-exports all extractors and types
   - Factory functions for pipeline creation

### V6: Architecture Refactor ✅ Complete

1. **Interface Definitions** (`src/core/interfaces/`) ✅
   - `IParser.ts` - Parser interface (parseFile, parseCode, getSupportedLanguages, initialize, close)
   - `IGraphStore.ts` - Graph store interface (query, writeBatch, transaction, hasSchema, close)
   - `IScanner.ts` - File scanner interface (scan, detectProjectType, scanForChanges)
   - `ISemanticAnalyzer.ts` - Semantic analyzer interface (analyze, getTypeFor, getDependencyGraph)
   - `IExtractor.ts` - Entity extractor interface (extract, mergeBatches)
   - `index.ts` - Re-exports all interfaces

2. **CozoGraphStore Adapter** (`src/core/graph/cozo-graph-store.ts`) ✅
   - `CozoGraphStore` implementing `IGraphStore`
   - `CozoTransaction` implementing `ITransaction`
   - `writeBatch()` method for CozoBatch insertion
   - Transaction support with atomic rollback
   - Proper CozoDB query execution

3. **LanceDB Removal** ✅
   - Removed `@lancedb/lancedb` from package.json
   - Deleted `src/core/vector/` directory
   - Updated core exports

4. **CozoDB Vector Support** ✅
   - `FunctionEmbedding` relation for vector storage (CozoDB vectors can't be nullable)
   - Vector type syntax: `<F32; 384>` for 384-dimensional vectors
   - Migration 002 adds HNSW vector index support
   - `vectorSearchFunctions()` in GraphOperations

5. **TypeScriptParser IParser Implementation** (`src/core/parser/typescript-parser.ts`) ✅
   - Implements `IParser` interface
   - `parseCode()` is now synchronous (no file I/O)
   - `getSupportedLanguages()` returns supported language list
   - `close()` for cleanup

6. **Contract Tests** (`src/core/interfaces/__tests__/`) ✅
   - `IParser.contract.test.ts` - 13 tests
   - `IGraphStore.contract.test.ts` - 11 tests
   - All 24 contract tests passing

7. **Integration Smoke Test** (`src/core/interfaces/__tests__/integration.smoke.test.ts`) ✅
   - 7 tests for full pipeline (parse → extract → store → query)
   - Tests class/method extraction with HAS_METHOD relationships
   - Schema integrity verification
   - Error handling tests

8. **CozoDB Compatibility Fixes** ✅
   - `_schema_version` → `schema_version` (underscore-prefixed tables are hidden)
   - Migration execution without block transaction accumulation
   - Vector type syntax fix: `<F32; 384>`
   - Class column names: `extends_class`, `implements_interfaces`

### V7: Graph Builder ✅ Complete

1. **GraphWriter** (`src/core/graph-builder/graph-writer.ts`) ✅
   - `writeFile(result)` - Write single file's extraction result
   - `writeFiles(results)` - Write multiple files
   - `writeBatch(batch)` - Write merged batch directly
   - `deleteFileEntities(fileId)` - Delete all entities for a file
   - `fileExists(fileId)` - Check if file exists
   - `getFileHash(fileId)` - Get stored file hash
   - `getAllFileHashes()` - Get all file hashes for change detection
   - Safe queries/executes that handle empty relations

2. **IncrementalUpdater** (`src/core/graph-builder/incremental-updater.ts`) ✅
   - `detectChanges(currentFiles)` - Detect added/modified/deleted/unchanged files
   - `update(results, currentFiles)` - Incremental update only changed files
   - `fullReindex(results)` - Delete all and write fresh
   - `getGraphStats()` - Get entity counts from graph
   - Progress callback support

3. **Module Exports** (`src/core/graph-builder/index.ts`) ✅
   - Exports GraphWriter, IncrementalUpdater, and all types
   - Factory functions: `createGraphWriter()`, `createIncrementalUpdater()`

4. **Tests** ✅
   - `graph-writer.test.ts` - 10 tests for write operations
   - `incremental-updater.test.ts` - 8 tests for change detection

### V8: Indexer & Watcher ✅ Complete

1. **IndexerCoordinator** (`src/core/indexer/coordinator.ts`) ✅
   - `indexProject()` - Full pipeline orchestration (Scan → Parse → Extract → Write)
   - `indexProjectIncremental()` - Incremental update with change detection
   - `indexFile(filePath)` - Single file indexing
   - `removeFile(filePath)` - Remove file entities from graph
   - `getStats()` - Get entity counts from graph
   - Progress reporting with 4 phases: Scanning, Parsing, Extracting, Writing
   - Configurable batch size for large projects
   - Error recovery with detailed error collection

2. **FileWatcher** (`src/core/indexer/watcher.ts`) ✅
   - Uses chokidar for file system watching
   - Event debouncing with configurable delay (default 300ms)
   - Event deduplication (keeps only latest event per file)
   - Batch processing with `FileChangeBatch` structure
   - Callbacks: `onReady`, `onChange`, `onBatch`, `onError`
   - State management: stopped, starting, watching
   - Respects project ignore patterns

3. **Module Exports** (`src/core/indexer/index.ts`) ✅
   - Exports coordinator and watcher modules
   - Type exports for all interfaces

4. **Tests** ✅
   - `coordinator.test.ts` - 10 tests (indexProject, incremental, indexFile, removeFile, stats, errors)
   - `watcher.test.ts` - 7 tests (lifecycle, event handling, deduplication, categorization)

---

## Change Log

### December 30, 2025 - V7 Graph Builder Complete

- **Completed V7: Graph Builder**:
  - **GraphWriter** (`src/core/graph-builder/graph-writer.ts`):
    - `writeFile(result)` - Write single file's extraction result
    - `writeFiles(results)` - Write multiple files
    - `writeBatch(batch)` - Write merged batch directly
    - `deleteFileEntities(fileId)` - Delete all entities for a file (safe for empty relations)
    - `fileExists(fileId)` / `getFileHash(fileId)` - Check file existence and hash
    - `getAllFileHashes()` - Get all file hashes for change detection

  - **IncrementalUpdater** (`src/core/graph-builder/incremental-updater.ts`):
    - `detectChanges(currentFiles)` - Detect added/modified/deleted/unchanged files
    - `update(results, currentFiles)` - Incremental update only changed files
    - `fullReindex(results)` - Delete all and write fresh
    - `getGraphStats()` - Get entity counts from graph

  - **Tests** (18 tests):
    - `graph-writer.test.ts` - 10 tests
    - `incremental-updater.test.ts` - 8 tests

- **V1-V7 now complete, V8-V11 pending**
- **Total tests: 49 passing**

### December 31, 2025 - V8 Indexer & Watcher Complete

- **Completed V8: Indexer & Watcher**:
  - **IndexerCoordinator** (`src/core/indexer/coordinator.ts`):
    - `indexProject()` - Full pipeline: Scan → Parse → Extract → Write
    - `indexProjectIncremental()` - Incremental update detecting changes
    - `indexFile(filePath)` - Single file indexing
    - `removeFile(filePath)` - Remove file from graph
    - `getStats()` - Get entity counts from graph
    - Progress reporting with 4 phases (Scanning, Parsing, Extracting, Writing)
    - Configurable batch size for large projects
    - Error recovery with detailed error collection

  - **FileWatcher** (`src/core/indexer/watcher.ts`):
    - Uses chokidar for file system watching
    - Event debouncing with configurable delay (default 300ms)
    - Event deduplication (keeps only latest event per file)
    - Batch processing with `FileChangeBatch` structure
    - Callbacks: `onReady`, `onChange`, `onBatch`, `onError`
    - State management: stopped, starting, watching
    - Respects project ignore patterns

  - **Module Exports** (`src/core/indexer/index.ts`):
    - Updated to export coordinator and watcher modules
    - Type exports for all new interfaces

  - **Tests** (17 tests):
    - `coordinator.test.ts` - 10 tests (indexProject, incremental, indexFile, removeFile, stats, errors)
    - `watcher.test.ts` - 7 tests (lifecycle, event handling, deduplication, categorization)

  - **Bug Fixes**:
    - Fixed `pascalToSnakeCase()` in schema-generator.ts to handle UPPER_SNAKE_CASE relation names
    - Relation names like `HAS_METHOD` now correctly convert to `has_method` instead of `h_a_s__m_e_t_h_o_d`

- **V1-V8 now complete, V9-V11 pending**
- **Total tests: 66 passing**

### December 31, 2025 - Checkpoint 2 Complete

- **Completed Checkpoint 2: Indexing Pipeline Integration Test**:
  - Created comprehensive integration test: `src/core/__tests__/checkpoint2.integration.test.ts`
  - **23 new tests** verifying end-to-end indexing pipeline

  - **Full Project Indexing** (6 tests):
    - Indexes all files successfully
    - Extracts entities (functions, classes, interfaces, variables)
    - Creates relationships (CONTAINS)
    - Reports progress through all phases

  - **Query Verification** (8 tests):
    - Find files by path
    - Find functions by name
    - Find classes and interfaces
    - Find variables with const flag
    - Verify CONTAINS relationships
    - Join functions with their file context

  - **Incremental Updates** (4 tests):
    - Process modified files and add new entities
    - Handle new files
    - Remove deleted files from graph

  - **File Watcher** (4 tests):
    - Start/stop lifecycle
    - Change detection
    - onReady callback
    - Error reporting

  - **Graph Statistics** (1 test):
    - Accurate entity counts

- **Total tests now: 89 passing**

### December 31, 2025 - V9 MCP Server Complete

- **Completed V9: MCP Server Implementation**:
  - **MCP Tools** (`src/mcp/tools.ts`):
    - `searchCode()` - Search functions, classes, interfaces, variables, files
    - `getFunction()` - Get function details with callers/callees
    - `getClass()` - Get class details with methods
    - `getFileSymbols()` - Get all symbols in a file
    - `getCallers()` - Get callers of a function
    - `getCallees()` - Get callees of a function
    - `getDependencies()` - Get file imports/imported-by
    - `getProjectStats()` - Get entity counts

  - **MCP Resources** (`src/mcp/resources.ts`):
    - `file://` - List/get indexed files
    - `symbols://` - List/get symbols by type
    - `graph://` - Get graph statistics (nodes and edges)
    - URI-based resource access pattern

  - **MCP Server** (`src/mcp/server.ts`):
    - Integrated with `@modelcontextprotocol/sdk`
    - `StdioServerTransport` for stdio communication
    - Tool definitions with JSON Schema input validation
    - Resource handlers for all resource URIs
    - Error handling with `McpError` codes

  - **Testing** (`src/mcp/__tests__/tools.test.ts`):
    - 18 tests covering all tools
    - In-memory CozoDB schema creation
    - Test data insertion for all entity types

  - **Technical Notes**:
    - Changed from `IGraphStore` to `GraphDatabase` directly
    - Client-side filtering for substring search (CozoDB lacks `contains` function)
    - All query results typed with generics

- **Total tests now: 107 passing** (89 + 18 MCP tests)

### December 31, 2025 - Checkpoint 3 Complete

- **Completed Checkpoint 3: MCP Server Integration Test**:
  - Created comprehensive integration test: `src/core/__tests__/checkpoint3.integration.test.ts`
  - **24 new tests** verifying AI agent connectivity via MCP

  - **MCP Server Startup** (5 tests):
    - Server creation with correct name and version
    - All 8 expected tools defined
    - All 5 resource URIs defined
    - List tools via MCP protocol
    - List resources via MCP protocol

  - **MCP Tools** (11 tests):
    - `search_code` - Search by name, filter by type, limit results
    - `get_function` - Get function details, handle non-existent
    - `get_class` - Get class details with methods
    - `get_file_symbols` - Get all symbols in a file
    - `get_callers` - Get function callers
    - `get_callees` - Get function callees
    - `get_dependencies` - Get file import/export dependencies
    - `get_project_stats` - Get entity counts

  - **MCP Resources** (4 tests):
    - `graph://` - Graph overview statistics
    - `file://` - List and get specific files
    - `symbols://` - List and filter symbols by type

  - **End-to-End Integration** (4 tests):
    - Typical AI agent workflow (stats → search → details → symbols → resources)
    - Concurrent tool calls (parallel requests)
    - Error handling (non-existent entities)

  - **Technical Implementation**:
    - Uses `InMemoryTransport` from MCP SDK for testing without stdio
    - Exports `createMcpServer()` and `TOOL_DEFINITIONS` for testing
    - Full schema creation and test data insertion
    - Client-server connection via linked transport pair

- **Total tests now: 131 passing** (89 + 18 MCP tools + 24 Checkpoint 3)

### December 31, 2025 - V10 LLM Integration Complete

- **Completed V10: LLM Integration** using `node-llama-cpp`:

  - **LLMService** (`src/core/llm/llm-service.ts`):
    - Model loading with `getLlama()` and `loadModel()`
    - Chat session management with `LlamaChatSession`
    - JSON schema grammar enforcement via `createGrammarForJsonSchema()`
    - Inference caching with LRU eviction
    - GPU offloading support (configurable layers)
    - Statistics tracking (calls, cache hits, tokens, duration)
    - AsyncDisposable implementation for resource cleanup

  - **BusinessLogicInferrer** (`src/core/llm/business-logic-inferrer.ts`):
    - Function summarization with structured JSON output
    - Optimized prompts for Qwen 2.5 Coder models
    - Output cleaning (removes preambles, extracts JSON)
    - Confidence scoring with adjustment based on cleaning
    - Fallback generation when LLM unavailable
    - Batch processing with progress callbacks
    - Retry logic for parse failures

  - **GraphRAGSummarizer** (`src/core/llm/graph-rag-summarizer.ts`):
    - Hierarchical summarization: Function → File → Module → System
    - Bottom-up summary building from function-level
    - Module detection by directory structure
    - Dependency tracking across modules
    - Query interface for searching summaries by tags/content
    - Fallback summaries when LLM unavailable

  - **Key Design Decisions**:
    - Generic `JsonSchema` type to avoid complex GbnfJsonSchema typing
    - Chat sessions for all inference (not raw text completion)
    - Grammar-constrained output for reliable JSON parsing
    - Progressive fallbacks: LLM → cache → heuristics

  - **Files Created**:
    - `src/core/llm/llm-service.ts` - Core LLM management
    - `src/core/llm/business-logic-inferrer.ts` - Function summarization
    - `src/core/llm/graph-rag-summarizer.ts` - Hierarchical summaries
    - `src/core/llm/index.ts` - Module exports (updated)

  - **Recommended Models** (Qwen 2.5 Coder series):
    - `Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf` (~1GB) - Fastest
    - `Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf` (~2GB) - Balanced
    - `Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf` (~4GB) - Best quality

### December 30, 2025 - V6 Architecture Refactor Complete

- **Completed V6: Architecture Refactor**:
  - **Interface Extraction** (Phase 0):
    - Created `src/core/interfaces/` directory with explicit module contracts
    - `IParser.ts` - Parser interface (parseFile, parseCode, getSupportedLanguages)
    - `IGraphStore.ts` - Graph store interface (query, writeBatch, transaction, vectorSearch)
    - `IScanner.ts` - File scanner interface
    - `ISemanticAnalyzer.ts` - Semantic analyzer interface
    - `IExtractor.ts` - Entity extractor interface

  - **LanceDB Removal & CozoDB Vector Support** (Phase 1):
    - Removed `@lancedb/lancedb` dependency (was never fully integrated)
    - Deleted `src/core/vector/` module
    - Added `FunctionEmbedding` relation for vector storage
    - Vector type syntax: `<F32; 384>` for 384-dimensional float vectors
    - Migration 002 adds HNSW vector index support

  - **IGraphStore Implementation** (Phase 2):
    - `CozoGraphStore` adapter implementing `IGraphStore`
    - Transaction support with `ITransaction` interface
    - `writeBatch()` for CozoBatch insertion
    - Vector search via CozoDB HNSW indices

  - **IParser Implementation** (Phase 3):
    - `TypeScriptParser` now implements `IParser`
    - Factory function `createParser(): Promise<IParser>`

  - **Contract Test Suite** (Phase 4):
    - `IParser.contract.test.ts` - 13 tests for parser contract
    - `IGraphStore.contract.test.ts` - 11 tests for graph store contract
    - All 24 contract tests passing

  - **Integration Smoke Test** (Phase 5):
    - `integration.smoke.test.ts` - 7 tests for full pipeline
    - Tests parser → extraction → storage → query workflow
    - All 31 total tests passing

  - **CozoDB Compatibility Fixes**:
    - Underscore-prefixed relations (`_schema_version`) are hidden - renamed to `schema_version`
    - Block transactions don't preserve params - migrations execute immediately
    - Vector type syntax: `<F32; 384>` not `<384, F32>`
    - Nullable vectors not allowed - created separate `FunctionEmbedding` relation

- **V1-V6 now complete, V7-V11 pending**

### December 30, 2025 - V5 Entity Extraction Complete

- **Completed V5: Entity Extraction Pipeline**:
  - `types.ts` - CozoDB-native batch types
    - `CozoBatch` with typed row arrays for all relations
    - Row types: `FileRow`, `FunctionRow`, `ClassRow`, `InterfaceRow`, etc.
    - `UnresolvedCall` and `UnresolvedTypeRef` for two-pass resolution
    - `EmbeddingChunk` for vector embedding preparation
  - `id-generator.ts` - Signature-based ID generation
    - SHA-256 hashing with 16-char hex output
    - Stable IDs that don't change when code moves
    - Parameter disambiguator for overloaded functions
  - `function-extractor.ts` - Function/method extraction
    - Full metadata extraction (signature, params, return type, complexity)
    - Embedding text preparation (signature + docs + body snippet)
    - Type reference tracking for USES_TYPE relationships
  - `class-extractor.ts` - Class extraction
    - Methods via FunctionExtractor with HAS_METHOD relationships
    - Constructor handling
    - EXTENDS and IMPLEMENTS relationship creation
  - `interface-extractor.ts` - Interface and type alias extraction
    - Properties stored as JSON string
    - EXTENDS_INTERFACE tracking
  - `import-extractor.ts` - Import handling
    - IMPORTS relationships for internal files
    - GhostNode creation for external packages
    - Import path resolution with extension handling
  - `pipeline.ts` - EntityPipeline orchestration
    - Coordinates all extractors
    - Batch merging and deduplication
    - Error handling with location tracking
  - `index.ts` - Module exports

- **Testing Results** (10/10 checklist items pass):
  - [x] Entity IDs are deterministic
  - [x] Functions extracted with all metadata
  - [x] Classes extracted with methods and properties
  - [x] Interfaces extracted with type information
  - [x] Import relationships correctly resolve
  - [x] GhostNodes created for external packages
  - [x] CONTAINS relationships link File → entities
  - [x] HAS_METHOD relationships link Class → methods
  - [x] EXTENDS relationships track inheritance
  - [x] IMPLEMENTS relationships track interface implementation

- **All horizontals (H1-H5) and V1-V5 complete**
- **Next up: V6 Graph Builder**

### December 30, 2025 - V4 Semantic Analysis Complete

- **Completed V4: Semantic Analysis Layer**:
  - `types.ts` - Comprehensive type definitions for semantic analysis
    - Types for type info, symbols, references, dependencies
    - Request/response types for worker communication
    - Analysis options and progress tracking
  - `ts-program.ts` - TypeScript Program Manager
    - Wraps TypeScript Compiler API Program and TypeChecker
    - Loads and parses tsconfig.json
    - Provides source file access and module resolution
    - Implements AsyncDisposable for cleanup
  - `type-resolver.ts` - Type Resolution
    - Resolves types for any AST node using TypeChecker
    - Full function signature resolution with parameters and return types
    - Type classification (primitive, complex, generic, union, etc.)
  - `symbol-linker.ts` - Cross-file Symbol Linking
    - Links function calls to their definition locations
    - Finds all references across the project
    - Tracks cross-file dependencies
    - Resolves import/export aliases
  - `dependency-analyzer.ts` - Module Dependency Graph
    - Builds complete dependency graph for project
    - Detects circular dependencies
    - Calculates transitive dependencies
    - Import/export extraction
  - `semantic.worker.ts` - Worker Thread
    - Runs TypeScript Compiler API in isolated thread
    - Prevents blocking main thread during analysis
    - Progress reporting for long operations
  - `worker-manager.ts` - Worker Orchestration
    - Manages worker lifecycle (init, analyze, terminate)
    - Async request/response handling
    - State tracking and error handling
  - `index.ts` - SemanticAnalyzer facade class
    - Unified API combining all semantic capabilities

- **All horizontals (H1-H5) and V1-V4 complete**
- **Next up: V5 Entity Extraction** ✅ (now complete)

### December 30, 2025 - V3 Code Parser Complete

- **Completed V3: Code Parser Layer**:
  - `parser-manager.ts` - Tree-sitter WASM wrapper
    - Multi-language parser management (TypeScript, JavaScript, TSX, JSX)
    - WASM grammar loading from node_modules
    - `parseFile()`, `parseCode()`, `incrementalParse()` methods
    - Implements `AsyncDisposable` for resource cleanup
  - `ast-transformer.ts` - CST to UCE conversion
    - Transforms Tree-sitter CST to Universal Code Entity format
    - Extracts all code entities (functions, classes, interfaces, etc.)
    - Calculates cyclomatic complexity
    - Builds function signatures
  - `typescript-parser.ts` - TypeScript/JavaScript parser
    - Implements `LanguageParser` interface from UCE types
    - Supports all JS/TS file extensions
    - Factory functions for parser creation
  - `call-extractor.ts` - Function call extraction
    - Extracts function call relationships from parse trees
    - Builds `callsFrom` and `callsTo` maps for call graph
    - Handles direct calls, method calls, constructor calls
  - `index.ts` - Parser module exports with legacy wrapper

- **All horizontals (H1-H5) and V1-V3 complete**
- **Next up: V4 Semantic Analysis**

### December 30, 2025 - V2 File Scanner Complete

- **Completed V2: File System Scanner**:
  - `project-detector.ts` - Automatic project configuration detection
    - Framework detection from dependencies
    - Language/TypeScript detection
    - Source patterns by framework type
    - Package manager detection
  - `scanner.ts` - File discovery and cataloging
    - Glob-based file scanning with fast-glob
    - File metadata and hash collection
    - Change detection for incremental updates
  - `hasher.ts` - Content-based change detection
    - MD5 hashing with session caching
    - Batch hash operations
  - Updated `index.ts` to use new `GraphDatabase`

- **All horizontals (H1-H5) and V1-V2 complete**
- **Next up: V3 Code Parser**

### December 30, 2025 - V1 Graph Database Complete

- **Completed V1: Graph Database Foundation**:
  - `database.ts` - GraphDatabase wrapper with CozoDB (RocksDB backend)
    - Connection management and initialization
    - Transaction support (begin, commit, rollback)
    - `withTransaction()` for automatic transaction handling
    - Implements `AsyncDisposable` for cleanup
    - Query execution with parameterization
  - `migration-runner.ts` - Schema migration system
    - `MigrationRunner` class with version tracking
    - Up/down migrations with rollback support
    - Transaction-wrapped migrations for atomicity
  - `migrations/001_initial_schema.ts` - Initial schema from definitions
  - `migrations/index.ts` - Migration registry
  - `operations.ts` - High-level graph CRUD
    - Node operations for File, Function, Class, Interface, Variable
    - Relationship operations for CONTAINS, CALLS, IMPORTS, EXTENDS, IMPLEMENTS
    - Query methods for traversal (getCallers, getCallees, getImportChain)

- **All horizontals (H1-H5) and V1 complete**
- **Next up: V2 File Scanner**

### December 30, 2025 - Horizontal/Vertical Reorganization

- **Reorganized implementation plan** into Horizontals (H1-H5) and Verticals (V1-V10):
  - **Horizontals** are cross-cutting infrastructure built first
  - **Verticals** are feature-specific modules that depend on horizontals

- **Added new Horizontal phases**:
  - **H2: Resource Management** - TypeScript 5.2 `using` keyword, Disposable interfaces
  - **H3: Schema & Types** - Schema Source of Truth, UCE types, Zod validation
  - **H4: Async Infrastructure** - Result<T,E>, Pool<T>, EventBus, retry(), Deferred<T>
  - **H5: Telemetry (Optional)** - OpenTelemetry instrumentation

- **Renamed Phases to Verticals**:
  - Phase 2 → V1: Graph Database
  - Phase 3 → V2: File Scanner
  - Phase 4 → V3: Code Parser
  - Phase 5 → V4: Semantic Analysis
  - Phase 6 → V5: Entity Extraction
  - Phase 7 → V6: Graph Building
  - Phase 8+9 → V7: Indexer & Watcher
  - Phase 10 → V8: MCP Server
  - Phase 11 → V9: LLM Integration
  - Phase 12 → V10: CLI Commands

### December 30, 2025 - Architecture Improvements

- Added comprehensive architectural improvements to implementation plan:
  - **Schema Source of Truth (Step 1.5)**: Single source generates Cypher DDL and TypeScript types
  - **Migration System (Phase 2)**: Versioned schema migrations with up/down support
  - **UCE Interface (Phase 4)**: Language-agnostic Universal Code Entity types
  - **Worker Thread Isolation (Phase 5)**: Non-blocking semantic analysis
  - **Transactional Atomicity (Phase 7)**: Atomic file updates prevent corruption
  - **Hybrid Search (Phase 10)**: Vector + keyword search combining LanceDB and KùzuDB
  - **LLM Confidence Scoring (Phase 11)**: Quality metrics for inferred business logic

- Added Modern Tech Stack (2025) improvements:
  - **TypeScript 5.2 `using` keyword**: Automatic resource cleanup
  - **RxJS**: Backpressure handling for file watcher
  - **GraphRAG**: Hierarchical summarization (Function → Module → System)
  - **GBNF Grammars**: 100% reliable JSON from small LLMs
  - **Orama**: Sub-millisecond fuzzy symbol search
  - **OpenTelemetry**: Performance tracing and bottleneck identification

### December 31, 2025 - V11 CLI Commands & Checkpoint 4 Complete

- **V11 CLI Commands Complete**:
  - `init` command: Added `--model` option for LLM model selection during initialization
  - `config` command: NEW command for model management
    - `--model <preset>` - Set LLM model (preset or model ID)
    - `--list-models` - List all 12 available models
    - `--show-guide` - Display comprehensive model selection guide
  - `status` command: Reads real statistics from CozoDB database
  - `index` command: Full IndexerCoordinator pipeline with progress reporting

- **LLM Model Registry**:
  - 12 models across 4 families: Qwen 2.5 Coder, Llama 3.x, CodeLlama, DeepSeek Coder
  - 5 presets: fastest, minimal, balanced, quality, maximum
  - System recommendation based on available RAM
  - Model filtering by family, RAM, quality tiers

- **Checkpoint 4 Integration Tests**:
  - 24 new tests (155 total, 6 MCP tests skipped)
  - Tests LLM registry, indexing pipeline, graph queries, error handling, performance
  - Test file: `src/core/__tests__/checkpoint4.integration.test.ts`

- **Files Changed**:
  - `src/cli/commands/init.ts` - Added --model option
  - `src/cli/commands/config.ts` - NEW file for model management
  - `src/cli/commands/status.ts` - Real database stats
  - `src/cli/commands/index.ts` - Full indexing pipeline
  - `src/cli/index.ts` - Registered config command
  - `.gitignore` - Added .code-synapse directory

- **All modules complete**: V1-V11 and H1-H5 all marked complete
- **All checkpoints passed**: Checkpoints 1-4 verified

### December 30, 2025 - Initial Implementation

- Initial Phase 1 implementation
- Created foundational utilities (logger, fs, errors, types)
- Implemented CLI framework with all commands
- Created core module stubs
- Removed postinstall script (decision documented above)
- Fixed ESLint config for underscore-prefixed unused variables
- Verified all checks pass

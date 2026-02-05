# Indexing Process

This document explains how Code-Synapse transforms source code into a Knowledge Graph optimized for AI reasoning.

---

## Architecture Overview

The indexing system is built around a coordinator that orchestrates multiple specialized components:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           IndexerCoordinator                                     │
│                    (src/core/indexer/coordinator.ts)                             │
│                                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  ┌───────────────────┐   │
│  │ FileScanner │  │ TypeScript  │  │ EntityPipeline │  │   GraphWriter     │   │
│  │             │  │   Parser    │  │                │  │                   │   │
│  │ fast-glob   │  │ tree-sitter │  │ Extractors:    │  │ CozoDB upserts    │   │
│  │ gitignore   │  │ WASM        │  │ • Function     │  │ Batch transactions│   │
│  └─────────────┘  └─────────────┘  │ • Class        │  └───────────────────┘   │
│                                     │ • Interface    │                          │
│                                     │ • Import       │  ┌───────────────────┐   │
│                                     │ • Call         │  │  CallGraphLinker  │   │
│                                     └────────────────┘  │                   │   │
│                                                         │ Cross-file calls  │   │
│                                                         │ Symbol registry   │   │
│                                                         └───────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `IndexerCoordinator` | `src/core/indexer/coordinator.ts` | Orchestrates the full pipeline |
| `FileScanner` | `src/core/indexer/scanner.ts` | Discovers and filters source files |
| `TypeScriptParser` | `src/core/parser/typescript-parser.ts` | Parses code to AST using Tree-sitter |
| `EntityPipeline` | `src/core/extraction/pipeline.ts` | Extracts entities from AST |
| `CallExtractor` | `src/core/parser/call-extractor.ts` | Extracts function call relationships |
| `CallGraphLinker` | `src/core/extraction/call-graph-linker.ts` | Resolves cross-file calls |
| `GraphWriter` | `src/core/graph-builder/writer.ts` | Writes entities to CozoDB |

---

## The Pipeline

Code-Synapse uses a multi-stage pipeline that progressively enriches code with structural, semantic, and business context:

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                   KNOWLEDGE PIPELINE                                      │
│                                                                                           │
│   ┌────────┐   ┌────────┐   ┌──────────┐   ┌────────┐   ┌────────┐   ┌────────────────┐  │
│   │  SCAN  │ → │ PARSE  │ → │ EXTRACT  │ → │ WRITE  │ → │  LINK  │ → │ ENRICH         │  │
│   │        │   │        │   │          │   │        │   │        │   │ (Optional)     │  │
│   │ Files  │   │  AST   │   │ Entities │   │ Graph  │   │ Calls  │   │ Semantics, LLM │  │
│   └────────┘   └────────┘   └──────────┘   └────────┘   └────────┘   └────────────────┘  │
│                                                                                           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Stage 1: Scanning

The scanner discovers all source files in your project.

**What it does:**
- Traverses the directory tree using fast-glob
- Filters by language extensions and exclude patterns (node_modules, dist, etc.)
- Computes a content hash for each file (used for incremental updates)
- Collects metadata: size, modification time, detected language

**Output:** A list of files with their paths, hashes, and metadata.

---

## Stage 2: Parsing

The parser builds an Abstract Syntax Tree (AST) for each file.

**What it does:**
- Loads the appropriate Tree-sitter grammar for each language
- Parses source code into structured AST nodes
- Handles syntax errors gracefully (partial parsing continues)

**Supported Languages:** TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, C#, Kotlin, Ruby, PHP, and more (24 total).

**Output:** AST nodes representing the syntactic structure of each file.

---

## Stage 3: Extraction

The extractor traverses ASTs to identify code entities and their relationships. This is handled by the `EntityPipeline` class which coordinates multiple specialized extractors.

### Extraction Pipeline Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         EntityPipeline.extract()                              │
│                                                                               │
│  Input: UCEFile + Tree + sourceCode                                          │
│                                                                               │
│  ┌────────────────┐  ┌───────────────┐  ┌──────────────────┐                 │
│  │FunctionExtractor│ │ClassExtractor │ │InterfaceExtractor│                 │
│  │                │  │               │  │                  │                 │
│  │ • Functions    │  │ • Classes     │  │ • Interfaces     │                 │
│  │ • Methods      │  │ • Properties  │  │ • Properties     │                 │
│  │ • Signatures   │  │ • Inheritance │  │ • Method sigs    │                 │
│  └────────────────┘  └───────────────┘  └──────────────────┘                 │
│                                                                               │
│  ┌────────────────┐  ┌───────────────┐                                       │
│  │ImportExtractor │  │ CallExtractor │                                       │
│  │                │  │               │                                       │
│  │ • Import stmts │  │ • Call sites  │                                       │
│  │ • Source paths │  │ • Same-file   │                                       │
│  │ • Symbols      │  │   resolution  │                                       │
│  └────────────────┘  └───────────────┘                                       │
│                                                                               │
│  Output: ExtractionResult                                                     │
│    • batch: CozoBatch (entities + relationships)                             │
│    • unresolvedCalls: UnresolvedCall[]                                       │
│    • stats: ExtractionStats                                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Entities Extracted

| Entity | Description | Row Type |
|--------|-------------|----------|
| File | Source file with path, hash, language | `FileRow` |
| Function | Functions and methods with signatures, parameters, return types | `FunctionRow` |
| Class | Class definitions with methods, properties, inheritance | `ClassRow` |
| Interface | TypeScript/Java interfaces with properties and methods | `InterfaceRow` |
| Type Alias | Type definitions and aliases | `TypeAliasRow` |
| Variable | Exported constants and variables | `VariableRow` |

### Relationships Extracted

| Relationship | Description | Row Type |
|--------------|-------------|----------|
| containsFunction | File contains function | `ContainsFunctionRow` |
| containsClass | File contains class | `ContainsClassRow` |
| calls | Function calls another function | `CallsRow` |
| imports | File imports from another file | `ImportsRow` |
| extendsClass | Class extends another class | `ExtendsClassRow` |
| implementsInterface | Class implements interface | `ImplementsInterfaceRow` |
| hasMethod | Class has method | `HasMethodRow` |

### Data Structures

**ExtractionResult** - Output from extracting a single file:
```typescript
interface ExtractionResult {
  fileId: string;           // Unique file identifier
  filePath: string;         // Absolute path
  batch: CozoBatch;         // Entities and relationships for this file
  unresolvedCalls: UnresolvedCall[];  // Calls that need cross-file resolution
  stats: ExtractionStats;   // Extraction statistics
  errors: ExtractionError[]; // Non-fatal errors encountered
}
```

**CozoBatch** - Batch of rows ready for CozoDB insertion:
```typescript
interface CozoBatch {
  file: FileRow[];
  function: FunctionRow[];
  class: ClassRow[];
  interface: InterfaceRow[];
  typeAlias: TypeAliasRow[];
  variable: VariableRow[];
  calls: CallsRow[];           // Same-file calls resolved in Pass 1
  imports: ImportsRow[];
  containsFunction: ContainsFunctionRow[];
  containsClass: ContainsClassRow[];
  hasMethod: HasMethodRow[];
  extendsClass: ExtendsClassRow[];
  implementsInterface: ImplementsInterfaceRow[];
}

### Two-Pass Call Resolution

Function call relationships are extracted using a two-pass architecture to handle both same-file and cross-file calls:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CALL RESOLUTION PIPELINE                             │
│                                                                              │
│  PASS 1 (Per-File)                    PASS 2 (Cross-File Linking)           │
│  ┌──────────────────────┐             ┌────────────────────────────┐        │
│  │  CallExtractor       │             │  CallGraphLinker           │        │
│  │                      │             │                            │        │
│  │  • Extract calls     │             │  • Build global symbol     │        │
│  │    from AST          │────────────▶│    registry                │        │
│  │  • Resolve same-file │  Unresolved │  • Build import maps       │        │
│  │    calls by name     │    Calls    │  • Resolve cross-file      │        │
│  │  • Track unresolved  │             │    calls via imports       │        │
│  └──────────────────────┘             └────────────────────────────┘        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Pass 1: CallExtractor (Per-File)

**Location:** `src/core/parser/call-extractor.ts`

The CallExtractor uses Tree-sitter AST to find all function calls within a file:

```typescript
// FunctionCall structure extracted from AST
interface FunctionCall {
  callerId: string;       // ID of calling function
  callerName: string;     // Name of calling function
  calleeName: string;     // Name of called function
  lineNumber: number;     // Line where call occurs
  column: number;         // Column where call occurs
  isDirectCall: boolean;  // true for foo(), false for obj.foo()
  isAwait: boolean;       // Whether call is awaited
  isConstructorCall: boolean; // true for new Foo()
  receiver: string | null;    // Object for method calls (e.g., "this", "obj")
  arguments: string[];    // Argument source text
}
```

**AST Node Types Processed:**
- `call_expression` - Regular function calls: `foo()`, `obj.bar()`
- `new_expression` - Constructor calls: `new Service()`
- `await_expression` - Checked to set `isAwait` flag

**Same-File Resolution:**
```
For each extracted call:
  1. Build nameToId map: {functionName → entityId} for all functions in file
  2. Look up callerName in nameToId → callerId
  3. Look up calleeName in nameToId → calleeId
  4. If BOTH found → add to batch.calls (resolved)
  5. If EITHER missing → add to unresolvedCalls (for Pass 2)
```

**Iterative Tree Walking:**
The CallExtractor uses an iterative (not recursive) tree traversal to avoid stack overflow on deeply nested code:
```typescript
private walkNode(node: SyntaxNode, visitor: (node: SyntaxNode) => boolean): void {
  const stack: SyntaxNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!visitor(current)) continue;
    // Add children in reverse order for correct traversal
    for (let i = current.children.length - 1; i >= 0; i--) {
      if (current.children[i]) stack.push(current.children[i]);
    }
  }
}
```

#### Pass 2: CallGraphLinker (Cross-File)

**Location:** `src/core/extraction/call-graph-linker.ts`

After all files are extracted, the CallGraphLinker resolves unresolved calls:

```typescript
// Global symbol registry built from all extraction results
interface GlobalSymbolRegistry {
  functions: Map<string, string>;  // "filePath:functionName" → entityId
  methods: Map<string, string>;    // "filePath:className.methodName" → entityId
  classes: Map<string, string>;    // "filePath:className" → entityId
  files: Map<string, string>;      // filePath → fileId
  exports: Map<string, ExportInfo>; // "filePath:exportedName" → {entityId, kind, name}
}
```

**Resolution Strategy:**
```
For each unresolved call:
  1. Check if calleeName is in the file's import map
     → If imported and source file is internal:
       - Look up "sourceFile:originalName" in exports registry
       - If found → resolved cross-file call
     → If imported from external package:
       - Mark as external (not stored)

  2. Check if calleeName is a built-in (console, Math, JSON, etc.)
     → Mark as external (not stored)

  3. Otherwise → unknown (logged for debugging)
```

**Call Types Detected:**
| Type | Example | Resolution |
|------|---------|------------|
| Direct call | `foo()` | Name lookup in same file |
| Method call | `this.bar()` | Class method lookup |
| Constructor | `new Service()` | Class constructor lookup |
| Imported call | `import { fn } from './utils'; fn()` | Cross-file linking via imports |
| External call | `console.log()`, `fs.readFile()` | Marked as external (not stored) |

**CallsRow Format:**
```typescript
type CallsRow = [
  string,   // caller_id - Entity ID of calling function
  string,   // callee_id - Entity ID of called function
  number,   // line_number - Line where call occurs
  boolean,  // is_direct_call - true for foo(), false for obj.foo()
  boolean   // is_await - Whether call is awaited
];
```

**Output:** Lists of entities and relationships ready for storage.

---

## Stage 4: Graph Writing

The graph writer stores entities and relationships in CozoDB.

**Location:** `src/core/graph-builder/writer.ts`

**What it does:**
- Upserts entities into appropriate tables (idempotent using `:put` operations)
- Creates relationship edges between entities
- Handles batch transactions for atomicity
- Updates vector indices for similarity search (if embeddings exist)

### Write Process

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        GraphWriter.writeFile(result)                          │
│                                                                               │
│  Input: ExtractionResult                                                      │
│                                                                               │
│  1. Write entities (in dependency order):                                     │
│     :put file { ... }                                                         │
│     :put function { ... }     ←── Must exist before calls reference them     │
│     :put class { ... }                                                        │
│     :put interface { ... }                                                    │
│                                                                               │
│  2. Write relationships:                                                      │
│     :put containsFunction { file_id, function_id, ... }                      │
│     :put calls { caller_id, callee_id, line_number, ... }  ←── Same-file     │
│     :put imports { from_id, to_id, symbols, ... }                            │
│     :put hasMethod { class_id, method_id }                                   │
│     :put extendsClass { subclass_id, superclass_id }                         │
│                                                                               │
│  Output: WriteResult { success, stats }                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Storage:** CozoDB with RocksDB backend for persistence, supporting both graph queries and vector search.

**Batching:** Files are processed in configurable batches (default: 10 files per batch) to balance memory usage and transaction overhead.

---

## Stage 5: Cross-File Call Linking

After all files are written to the graph, a second pass resolves function calls across file boundaries.

**Location:** `src/core/extraction/call-graph-linker.ts`

**When it runs:** After Phase 4 (Writing) completes for all files, Phase 5 runs once to process all accumulated unresolved calls.

### Linking Process

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    CallGraphLinker.linkCalls(results)                         │
│                                                                               │
│  Input: ExtractionResult[] (all files)                                        │
│                                                                               │
│  Step 1: Build Global Symbol Registry                                         │
│    For each result:                                                           │
│      - Extract functions: "filePath:fnName" → entityId                       │
│      - Extract methods: "filePath:className.methodName" → entityId           │
│      - Extract classes: "filePath:className" → entityId                      │
│      - Track exports: "filePath:exportedName" → {entityId, kind}             │
│                                                                               │
│  Step 2: Build Import Maps                                                    │
│    Query imports table:                                                       │
│      ?[from_id, to_id, imported_symbols] := *imports{...}                    │
│    For each import:                                                           │
│      - Map localName → {sourceFilePath, originalName, isExternal}            │
│                                                                               │
│  Step 3: Resolve Unresolved Calls                                             │
│    For each unresolved call:                                                  │
│      - Try import lookup → cross-file resolution                             │
│      - Check built-ins → mark as external                                    │
│      - Otherwise → mark as unknown                                           │
│                                                                               │
│  Step 4: Write Resolved Calls                                                 │
│    :put calls { caller_id, callee_id, line_number, is_direct_call, is_await }│
│                                                                               │
│  Output: LinkingResult                                                        │
│    • resolvedCalls: CallsRow[]                                               │
│    • stats: { totalUnresolved, resolvedCount, externalCount, unknownCount }  │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Resolution Strategy:**

1. **Import Lookup:** If the callee name matches an imported symbol, follow the import to find the target entity in the global registry
2. **Built-in Detection:** Calls to built-ins (`console`, `Math`, `JSON`, `Object`, `Array`, `String`, `Number`, `Boolean`, `Date`, `Promise`, `Error`) are marked as external and not stored
3. **Local Definition:** Checks for functions defined within the same file (fallback for complex local calls missed in Pass 1)
4. **Unknown Tracking:** Calls that can't be resolved (dynamic patterns, namespace imports, untracked imports) are logged for debugging

**Statistics Tracked:**
| Metric | Description |
|--------|-------------|
| `totalUnresolved` | Total calls that couldn't be resolved in Pass 1 |
| `resolvedCount` | Calls successfully linked to internal functions |
| `externalCount` | Calls to external packages or built-ins |
| `unknownCount` | Calls that couldn't be resolved (dynamic, etc.) |

**Output:** Additional `calls` relationships linking functions across different files.

---

## Stage 6: Enrichment (Optional)

Beyond structural extraction, optional enrichment stages add deeper understanding:

### Semantic Analysis

Analyzes code behavior without running it:

| Analysis | What it Detects |
|----------|-----------------|
| Parameter Semantics | Purpose (input, config, callback), usage patterns, validation |
| Return Analysis | Return conditions, possible values, data sources |
| Error Paths | What errors can be thrown, where they propagate |
| Side Effects | I/O operations, mutations, external calls |
| Data Flow | How data moves through functions and across calls |

### Design Pattern Detection

Identifies common architectural patterns:

| Pattern | Detection Signals |
|---------|-------------------|
| Factory | `create*`/`make*` methods, returns new instances |
| Singleton | Private constructor, static `getInstance` |
| Observer | `subscribe`/`on`/`emit` methods |
| Repository | CRUD methods (`find*`, `create*`, `update*`, `delete*`) |
| Service | `*Service` naming, injected dependencies, stateless |
| Builder | Method chaining, `build()` method |

### Business Justification (LLM)

Uses an LLM to infer business purpose:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     JUSTIFICATION PIPELINE                          │
│                                                                     │
│   ┌────────────┐   ┌───────────┐   ┌─────────────┐   ┌──────────┐  │
│   │ HIERARCHY  │ → │  FILTER   │ → │ LLM BATCH   │ → │ PROPAGATE│  │
│   │            │   │           │   │             │   │          │  │
│   │ Build deps │   │ Skip      │   │ Structured  │   │ Enrich   │  │
│   │ order      │   │ trivial   │   │ output      │   │ parents  │  │
│   └────────────┘   └───────────┘   └─────────────┘   └──────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Hierarchy Ordering:** Entities are processed leaves-first (functions → classes → files) so parents have context from children.

**Trivial Filtering:** Very short helpers, getters/setters, and index files are auto-justified without LLM to save cost.

**Batch Inference:** Non-trivial entities are sent to the LLM in optimized batches with structured JSON output.

**Context Propagation:** Justifications flow upward through the hierarchy, enriching parent entities.

**Output per entity:**
- Purpose summary (what it does)
- Business value (why it exists)
- Feature context (which domain/feature)
- Confidence score (0.0 - 1.0)
- Tags for categorization

---

## Incremental Updates

For efficiency, only changed files are reprocessed:

1. **Hash Comparison:** Current file hash vs stored hash
2. **Staleness Detection:** Changed files are marked for reindexing
3. **Cascading Updates:** Dependent entities are refreshed as needed
4. **Preserved Data:** Unchanged file data remains untouched

This applies to both structural indexing and justification.

---

## Batching & Concurrency

Files are processed in parallel batches with extraction results accumulated for cross-file linking:

```
Files [1..N]
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BATCH 1: Files 1-10                                                        │
│  ├─ Thread 1: Parse + Extract files 1-3   ──┐                               │
│  ├─ Thread 2: Parse + Extract files 4-5   ──┼─→ Collect ExtractionResults   │
│  ├─ Thread 3: Parse + Extract files 6-8   ──┤                               │
│  └─ Thread 4: Parse + Extract files 9-10  ──┘                               │
│                                                                              │
│  → Write batch to graph (entities + same-file calls)                        │
│  → Accumulate ExtractionResults for Pass 2                                  │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
   [Next batch...]
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5: Cross-File Call Linking (runs once after all batches)             │
│                                                                              │
│  Input: All ExtractionResults (247 files → 247 results)                     │
│                                                                              │
│  1. Build global symbol registry from all results                           │
│  2. Build import maps by querying imports table                             │
│  3. Resolve unresolved calls across files                                   │
│  4. Write resolved calls to database                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Configuration:**
- Batch size: 10 files (configurable via `batchSize` option)
- Concurrency: 4 threads (configurable)
- Errors are logged but don't stop the pipeline (recoverable errors)

---

## Error Handling

The indexing pipeline uses a "continue on error" strategy to maximize useful output:

### Error Types

| Error Type | Phase | Recovery |
|------------|-------|----------|
| Parse error | Parsing | Skip file, log warning |
| Extraction error | Extracting | Skip entity, continue with file |
| Call extraction error | Extracting | Log warning, continue (calls just missing) |
| Write error | Writing | Log error, mark file as failed |
| Link error | Linking | Log warning, continue (cross-file calls just missing) |

### Stack Overflow Prevention

Deep AST structures (heavily nested callbacks, deeply indented code) can cause stack overflow in recursive tree traversal. The CallExtractor uses an iterative approach:

```typescript
// Iterative tree walking (avoids call stack limit)
const stack: SyntaxNode[] = [rootNode];
while (stack.length > 0) {
  const node = stack.pop()!;
  // Process node...
  for (const child of node.children.reverse()) {
    stack.push(child);
  }
}
```

### Error Reporting

Errors are collected throughout the pipeline and included in the final result:

```typescript
interface IndexingCoordinatorResult {
  success: boolean;        // true if no fatal errors
  filesIndexed: number;    // Files successfully processed
  filesFailed: number;     // Files that failed
  entitiesWritten: number; // Total entities stored
  relationshipsWritten: number; // Total relationships stored
  errors: IndexingError[]; // All errors encountered
  phases: {
    scanning: { files: number, durationMs: number },
    parsing: { files: number, durationMs: number },
    extracting: { files: number, durationMs: number },
    writing: { files: number, durationMs: number },
    linking: { files: number, durationMs: number }  // Cross-file calls
  };
}
```

---

## The Knowledge Graph

After indexing, the graph contains:

### Node Tables
- `file` - All indexed files
- `function` - Functions and methods
- `class` - Class definitions
- `interface` - Interface definitions
- `type_alias` - Type aliases
- `justification` - Business justifications (unified with classification)

### Relationship Tables
- `containsFunction` - File → Function
- `containsClass` - File → Class
- `calls` - Function → Function (with line_number, is_direct_call, is_await)
- `imports` - File → File (with imported_symbols array)
- `extendsClass` - Class → Class
- `implementsInterface` - Class → Interface
- `hasMethod` - Class → Function

### Calls Table Schema

```
calls {
  caller_id: String,      // Entity ID of calling function
  callee_id: String,      // Entity ID of called function
  line_number: Int,       // Line where call occurs
  is_direct_call: Bool,   // true for foo(), false for obj.foo()
  is_await: Bool          // true if call is awaited
}
```

**Example Queries:**
```datalog
// Find all functions that call a specific function
?[caller_name, line] :=
  *calls{caller_id, callee_id: $target_id, line_number: line},
  *function{id: caller_id, name: caller_name}

// Find all callees of a function
?[callee_name, line, is_async] :=
  *calls{caller_id: $source_id, callee_id, line_number: line, is_await: is_async},
  *function{id: callee_id, name: callee_name}

// Count calls per function
?[fn_name, call_count] :=
  *function{id: fn_id, name: fn_name},
  call_count = count(callee_id : *calls{caller_id: fn_id, callee_id})
```

### Analysis Tables (if semantic analysis enabled)
- `side_effect` - Detected side effects
- `function_error_analysis` - Error handling analysis
- `data_flow_cache` - Cached data flow graphs
- `design_pattern` - Detected patterns

---

## MCP Tools

The indexed knowledge is exposed via MCP tools for AI agents:

| Tool | Purpose |
|------|---------|
| `search_code` | Find entities by name/pattern |
| `get_function` | Get function details and relationships |
| `get_callers` / `get_callees` | Navigate call graph |
| `find_similar_code` | Semantic similarity search |
| `get_side_effects` | List side effects of a function |
| `find_patterns` | Find design patterns |
| `get_justification` | Get business context for an entity |

---

## CLI Usage

### Running the Indexer

```bash
# Initialize and index (first time)
code-synapse init
code-synapse index

# Full re-index (ignores hash cache, reprocesses all files)
code-synapse index --force

# Incremental index (default - only changed files)
code-synapse index

# Check index status
code-synapse status
```

### Index Modes

| Mode | Command | Behavior |
|------|---------|----------|
| Full | `index --force` | Clears existing data, reindexes all files, runs Pass 2 linking |
| Incremental | `index` | Detects changed files via hash, processes only changes, runs Pass 2 linking |

**Note:** Both modes run the cross-file call linking phase (Pass 2) after processing.

---

## Enabling Features

### Basic Indexing (Default)
Structural extraction only - fast, covers most use cases.

### Semantic Analysis
Enable for deeper behavioral analysis:
- Parameter semantics
- Return value analysis
- Error path tracking
- Side effect detection
- Data flow analysis

### Pattern Detection
Enable for architectural insights:
- Factory, Singleton, Observer patterns
- Repository, Service patterns
- Builder, Strategy, Decorator patterns

### Business Justification
Enable for LLM-powered business context:
- Purpose summaries
- Business value inference
- Feature/domain classification
- Confidence scoring

---

## Performance

Typical indexing times for a medium project (~500 files):

| Stage | Duration | Notes |
|-------|----------|-------|
| Scan | 1-5 seconds | Depends on filesystem and ignore patterns |
| Parse | 10-30 seconds | Tree-sitter WASM parsing |
| Extract | 5-15 seconds | Entity + call extraction |
| Write | 5-10 seconds | CozoDB batch transactions |
| Link | <1 second | Cross-file call resolution |
| **Total (structural)** | **20-60 seconds** | |
| Semantic analysis | +10-30 seconds | Optional |
| Pattern detection | +5-15 seconds | Optional |
| Justification (LLM) | +30-120 seconds | Optional, depends on model |

### Benchmark: Code-Synapse Self-Index

Indexing the Code-Synapse codebase itself (~247 files):

| Phase | Files | Duration |
|-------|-------|----------|
| Scanning | 247 | ~0.04s |
| Parsing | 247 | ~2.2s |
| Extracting | 247 | ~0.7s |
| Writing | 247 | ~6.7s |
| Linking | 247 | <0.1s |
| **Total** | **247** | **~10s** |

**Output:**
- 4839 entities
- 4573 relationships
- 2801 functions, 132 classes, 701 interfaces

---

## Implementation Checklist

The following capabilities are implemented or planned:

### Core Pipeline
- [x] File scanning with exclusion patterns
- [x] Multi-language parsing (24 languages via Tree-sitter)
- [x] Entity extraction (functions, classes, interfaces, etc.)
- [x] Relationship extraction (imports, inheritance, contains)
- [x] Two-pass call resolution (same-file + cross-file linking)
- [x] CallExtractor with iterative AST traversal (avoids stack overflow)
- [x] CallGraphLinker for cross-file call resolution via imports
- [x] CozoDB graph storage with RocksDB backend
- [x] Incremental indexing with hash-based change detection
- [x] Batch processing with configurable concurrency

### Semantic Analysis
- [x] Parameter semantic analysis
- [x] Return value analysis
- [x] Error path extraction
- [x] Side-effect detection (80+ patterns, 12 categories)
- [x] Intra-function data flow
- [x] Cross-function data flow tracing

### Design Patterns
- [x] Factory pattern detector
- [x] Singleton pattern detector
- [x] Observer pattern detector
- [x] Repository pattern detector
- [x] Service pattern detector
- [x] Builder pattern detector
- [x] Strategy pattern detector
- [x] Decorator pattern detector

### Business Justification
- [x] Hierarchical processing (leaves-first)
- [x] Trivial entity filtering
- [x] LLM batch inference with structured output
- [x] Context propagation (child → parent)
- [x] Enhanced context (integrates semantic analysis + patterns)
- [x] Unified classification into justification

### Similarity Search
- [x] Embedding generation (HuggingFace transformers)
- [x] HNSW vector indices in CozoDB
- [x] `find_similar_code` MCP tool

### MCP Integration
- [x] Core search and navigation tools
- [x] `get_function_semantics` tool
- [x] `get_error_paths` tool
- [x] `get_data_flow` tool
- [x] `get_side_effects` tool
- [x] `find_patterns` / `get_pattern` tools
- [x] `find_similar_code` tool

### Future Enhancements
- [ ] `trace_data_flow` tool (cross-function data tracing)
- [ ] Taint analysis for security-sensitive data flows
- [ ] Runtime usage integration (APM/telemetry)
- [ ] Documentation mining (READMEs, ADRs)
- [ ] Visualization in web viewer

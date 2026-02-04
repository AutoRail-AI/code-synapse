# Indexing Process

This document explains how Code-Synapse indexes your codebase to build a Knowledge Graph for AI reasoning.

---

## Overview

The indexing process transforms source code into a structured Knowledge Graph. It follows a **pipeline architecture**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           INDEXING PIPELINE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────┐    ┌─────────┐    ┌───────────┐    ┌─────────────────────┐  │
│   │  SCAN    │ →  │  PARSE  │ →  │  EXTRACT  │ →  │  WRITE TO GRAPH     │  │
│   │          │    │         │    │           │    │                     │  │
│   │ Discover │    │ Build   │    │ Entities  │    │ Store nodes +       │  │
│   │ files    │    │ AST     │    │ Relations │    │ relationships       │  │
│   └──────────┘    └─────────┘    └───────────┘    └─────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Scanning

The `FileScanner` discovers all source files in your project.

### Input
| Field | Type | Description |
|-------|------|-------------|
| `project.rootPath` | `string` | Project root directory |
| `project.languages` | `string[]` | Languages to include (e.g., `["typescript", "python"]`) |
| `project.excludePatterns` | `string[]` | Glob patterns to ignore (e.g., `["node_modules/**"]`) |

### Process
1. Traverse directory tree using `fast-glob`
2. Filter by language extensions and exclude patterns
3. Compute content hash for each file (XXHash)
4. Collect metadata (size, modification time, language)

### Output: `FileInfo[]`
```typescript
{
  id: string;              // Unique hash-based ID
  absolutePath: string;    // Full file path
  relativePath: string;    // Path relative to project root
  extension: string;       // File extension (e.g., ".ts")
  size: number;            // File size in bytes
  lastModified: number;    // Modification timestamp
  hash: string;            // Content hash for change detection
  language: string | null; // Detected language
  fileName: string;        // Base filename
  directory: string;       // Parent directory
}
```

### Scan Result Summary
```typescript
{
  files: FileInfo[];           // All discovered files
  totalFiles: number;          // Count of files
  totalSize: number;           // Total bytes
  scanTimeMs: number;          // Duration
  byLanguage: Map<string, number>;   // Files per language
  byExtension: Map<string, number>;  // Files per extension
}
```

---

## Phase 2: Parsing

The `Parser` builds an AST (Abstract Syntax Tree) for each file using Tree-sitter.

### Input
| Field | Type | Description |
|-------|------|-------------|
| `fileInfo` | `FileInfo` | File metadata from scanning |
| `sourceCode` | `string` | Raw file contents |
| `language` | `string` | Language for Tree-sitter grammar |

### Process
1. Load appropriate Tree-sitter grammar for language
2. Parse source code into AST nodes
3. Handle syntax errors gracefully (partial parsing)

### Output: `ParseResult`
```typescript
{
  ast: TreeSitterNode;    // Root AST node
  language: string;       // Detected language
  errors: ParseError[];   // Syntax errors (if any)
  fileInfo: FileInfo;     // Original file info
}
```

---

## Phase 3: Extraction

The `EntityExtractor` traverses the AST to identify code entities and their relationships.

### Input
| Field | Type | Description |
|-------|------|-------------|
| `ast` | `TreeSitterNode` | Parsed AST |
| `fileInfo` | `FileInfo` | File metadata |
| `sourceCode` | `string` | Original source for snippet extraction |

### Entities Extracted

| Entity Type | Description | Key Fields |
|-------------|-------------|------------|
| `file` | Source file | path, hash, language |
| `module` | ES/Python module | name, exports |
| `class` | Class definition | name, methods, extends, implements |
| `interface` | TypeScript interface | name, properties, extends |
| `function` | Function/method | name, parameters, return type, async |
| `type_alias` | Type alias | name, definition |
| `variable` | Exported variable/const | name, type, value |

### Relationships Extracted

| Relationship | Description |
|--------------|-------------|
| `contains` | File contains entity |
| `calls` | Function calls another function |
| `imports` | File imports from another file |
| `extends` | Class extends another class |
| `implements` | Class implements interface |
| `uses_type` | Entity references a type |
| `depends_on` | Entity depends on another |

### Output: `ExtractionResult`
```typescript
{
  entities: Entity[];           // All extracted entities
  relationships: Relationship[]; // All extracted relationships
  fileId: string;               // Source file ID
  stats: {
    functions: number;
    classes: number;
    interfaces: number;
    imports: number;
  }
}
```

---

## Phase 4: Graph Writing

The `GraphWriter` stores entities and relationships in CozoDB.

### Input
| Field | Type | Description |
|-------|------|-------------|
| `entities` | `Entity[]` | Entities to store |
| `relationships` | `Relationship[]` | Relationships to store |

### Process
1. Upsert entities into appropriate relations (tables)
2. Create relationship edges
3. Update HNSW indices for vector search (if embeddings exist)
4. Handle conflicts via idempotent upserts

### Output: `WriteResult`
```typescript
{
  entitiesWritten: number;       // Entities stored
  relationshipsWritten: number;  // Relationships stored
  fileId: string;                // Processed file
  durationMs: number;            // Write duration
}
```

---

## Batching & Concurrency

The `IndexerCoordinator` processes files in batches for efficiency.

### Configuration
| Option | Default | Description |
|--------|---------|-------------|
| `batchSize` | 50 | Files per batch |
| `concurrency` | 4 | Parallel processing threads |
| `continueOnError` | true | Skip failed files vs. abort |

### Batch Processing Flow
```
Files [1..2400]
       │
       ▼
┌─────────────────────────────────────────────┐
│  BATCH 1: Files 1-50                        │
│  ├─ Thread 1: Parse + Extract files 1-12    │
│  ├─ Thread 2: Parse + Extract files 13-25   │
│  ├─ Thread 3: Parse + Extract files 26-38   │
│  └─ Thread 4: Parse + Extract files 39-50   │
│                                             │
│  → Write all to graph (single transaction)  │
└─────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│  BATCH 2: Files 51-100                      │
│  (same parallel processing)                 │
└─────────────────────────────────────────────┘
       │
       ▼
      ...
       │
       ▼
┌─────────────────────────────────────────────┐
│  BATCH N: Final files                       │
└─────────────────────────────────────────────┘
```

---

## Incremental Indexing

For file changes, only affected files are reprocessed.

### Change Detection
```typescript
// Compare current vs. stored hashes
const changes = await scanner.scanForChanges(previousFileHashes);
// Returns: { added: FileInfo[], modified: FileInfo[], removed: string[] }
```

### Incremental Flow
1. Detect changed files via hash comparison
2. Remove old entities for modified/deleted files
3. Reindex only added/modified files
4. Preserve unchanged file data

---

## Final Output: Knowledge Graph

After indexing, the graph contains:

### Stored Relations (Tables)
| Relation | Description |
|----------|-------------|
| `file` | All indexed files |
| `function` | All functions/methods |
| `class` | All class definitions |
| `interface` | All interface definitions |
| `type_alias` | All type aliases |
| `variable` | All exported variables |
| `module` | All module definitions |
| `contains` | File → Entity relationships |
| `calls` | Function → Function calls |
| `imports` | File → File imports |
| `extends_class` | Class → Class inheritance |
| `implements_interface` | Class → Interface implementation |

### Example Query
```datalog
// Find all functions in a file
?[name, signature] := 
  *file{id: file_id, path: "/src/auth/login.ts"},
  *contains{from: file_id, to: fn_id},
  *function{id: fn_id, name, signature}
```

---

## Progress Reporting

The indexer emits progress events during execution:

```typescript
interface IndexingProgressEvent {
  phase: "scanning" | "parsing" | "extracting" | "writing";
  currentFile?: string;
  processed: number;
  total: number;
  percentage: number;
  message: string;
}
```

### Example Progress Flow
```
scanning:   [████████░░░░░░░░░░░░] 40% - Discovering files...
parsing:    [██████████░░░░░░░░░░] 50% - src/auth/login.ts
extracting: [████████████████░░░░] 80% - Processing batch 4/5
writing:    [████████████████████] 100% - Complete
```

---

## Error Handling

Errors are collected but don't stop the pipeline:

```typescript
interface IndexingError {
  filePath: string;
  phase: "scanning" | "parsing" | "extracting" | "writing";
  error: string;
  recoverable: boolean;
}
```

Non-recoverable errors are logged, and processing continues for remaining files.

---

## Summary

| Phase | Input | Output | Duration |
|-------|-------|--------|----------|
| Scan | Project config | `FileInfo[]` | ~1-5s |
| Parse | Source files | AST nodes | ~10-30s |
| Extract | AST nodes | Entities + Relations | ~5-15s |
| Write | Entities | Graph database | ~5-10s |

**Total typical indexing time**: 20-60 seconds for a medium-sized project (~500 files).

---

# Part 2: Business Justification Layer

After structural indexing, the **Justification Layer** enriches entities with business context using LLM inference.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        JUSTIFICATION PIPELINE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────┐    ┌────────────┐    ┌─────────────┐    ┌────────────┐  │
│   │  HIERARCHY   │ →  │  TRIVIAL   │ →  │  LLM BATCH  │ →  │  CONTEXT   │  │
│   │  ORDERING    │    │  FILTER    │    │  INFERENCE  │    │ PROPAGATE  │  │
│   │              │    │            │    │             │    │            │  │
│   │ Build deps   │    │ Skip known │    │ Structured  │    │ Enrich     │  │
│   │ graph        │    │ patterns   │    │ output      │    │ children   │  │
│   └──────────────┘    └────────────┘    └─────────────┘    └────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 5: Justification

The `LLMJustificationService` infers business purpose for each code entity.

### Input
| Field | Type | Description |
|-------|------|-------------|
| `entityIds` | `string[]` | Entities to justify |
| `graphStore` | `IGraphStore` | Graph for context lookup |
| `modelRouter` | `IModelRouter` | LLM routing service |

### Step 5.1: Dependency Graph & Hierarchy

Entities are processed in hierarchical order (leaves first, then dependents).

```
Level 0: Leaf functions (no dependencies)
    ↓
Level 1: Functions that call Level 0
    ↓
Level 2: Classes containing Level 1 methods
    ↓
Level N: Files and modules
```

This ensures parent entities have context from their children.

### Step 5.2: Trivial Entity Filtering

Entities matching common patterns are auto-justified without LLM:

| Pattern | Example | Default Justification |
|---------|---------|----------------------|
| Getter | `getName()` | "Accessor for Name property" |
| Setter | `setEnabled(value)` | "Mutator for Enabled property" |
| Constructor | `constructor()` | "Initializes class instance" |
| Index re-export | `export * from './utils'` | "Re-exports module contents" |

### Step 5.3: LLM Batch Inference

Non-trivial entities are sent to the LLM in optimized batches.

---

## LLM Request Structure

### Request to LLM (`ModelRequest`)
```typescript
{
  prompt: string;           // Entity context + instructions
  systemPrompt: string;     // "You are a code analyst..."
  taskType: "justification";
  parameters: {
    maxTokens: number;      // Calculated per batch size
    temperature: 0.3;       // Low for consistency
    thinkingLevel: "medium"; // Gemini 3 reasoning depth
  },
  schema: JSON_SCHEMA;      // Structured output schema
}
```

### Batch Prompt Format
```
Analyze these code entities and provide business justifications:

## Entity 1: getUserProfile
- Type: function
- File: src/api/users.ts
- Signature: async getUserProfile(userId: string): Promise<User>
- Exported: true

## Entity 2: AuthService  
- Type: class
- File: src/auth/service.ts
- Methods: login, logout, validateToken
- Exported: true

[... more entities ...]

For each entity, provide:
1. purposeSummary - What does this do?
2. businessValue - Why does it exist?
3. featureContext - Which feature/domain?
4. tags - Relevant keywords
5. confidenceScore - 0.0 to 1.0
```

---

## LLM Response Structure

### JSON Schema for Structured Output
```typescript
{
  "type": "object",
  "properties": {
    "justifications": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "purposeSummary": { "type": "string" },
          "businessValue": { "type": "string" },
          "featureContext": { "type": "string" },
          "tags": { "type": "array", "items": { "type": "string" } },
          "confidenceScore": { "type": "number" }
        },
        "required": ["id", "purposeSummary", "businessValue", "confidenceScore"]
      }
    }
  },
  "required": ["justifications"]
}
```

### Example LLM Response (`response.parsed`)
```json
{
  "justifications": [
    {
      "id": "fn-getUserProfile-abc123",
      "purposeSummary": "Fetches complete user profile data including preferences and settings",
      "businessValue": "Core API for user profile display across dashboard and settings pages",
      "featureContext": "User Management",
      "tags": ["api", "user-profile", "data-fetching"],
      "confidenceScore": 0.85
    },
    {
      "id": "class-AuthService-def456",
      "purposeSummary": "Centralized authentication service handling login, logout, and token management",
      "businessValue": "Single source of truth for auth state, enables secure session handling",
      "featureContext": "Authentication",
      "tags": ["auth", "security", "session-management"],
      "confidenceScore": 0.92
    }
  ]
}
```

---

## Token-Based Dynamic Batching

### The Problem
- Too few entities per batch = Many API calls = Slow
- Too many entities per batch = Exceed context limits = Errors

### The Solution: Dual Constraint Batching

```
### The Solution: Dual Constraint Batching

```
┌─────────────────────────────────────────────────────────────┐
│                    TOKEN BUDGET CALCULATOR                  │
│  ─────────────────────────────────────────────────────────  │
│  Model: Configured via Registry.ts (e.g., Gemini 3 Pro)     │
│  Context Window: Defined in Registry.ProviderMetadata       │
│  Max Output: Defined in Registry.ProviderMetadata           │
│  Reserve Buffer: 15%                                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
         ┌─────────────────────────────────────────┐
         │         CONSTRAINT CALCULATION          │
         │  ─────────────────────────────────────  │
         │  Input limit:  (Window * 0.85) tokens   │
         │  Output limit: (MaxOutput * 0.85) tokens│
         │                                         │
         │  Avg input per entity:  ~300 tokens     │
         │  Avg output per entity: ~150 tokens     │
         │                                         │
         │  Max by input:  InputLimit / 300        │
         │  Max by output: OutputLimit / 150       │
         │                                         │
         │  ✓ Batch size = min(ByInput, ByOutput)  │
         │  → Typically ~50-100 for safety margin  │
         └─────────────────────────────────────────┘
```

### Batch Configuration
Configuration is sourced dynamically from `src/core/models/Registry.ts`.
Values adapt to the selected provider (OpenAI, Anthropic, Google, Local).

| Parameter | Source | Description |
|-----------|--------|-------------|
| `contextWindow` | `Registry.ts` | Model-specific context limit |
| `maxOutputTokens` | `Registry.ts` | Max response size |
| `outputTokensPerEntity` | 500 | Estimated JSON per entity |
| `safetyMargin` | 0.20 | 20% buffer for uncertainty |

---

## Justification Output

### Stored Justification (`EntityJustification`)
```typescript
{
  id: string;                    // "just-fn-abc123"
  entityId: string;              // "fn-getUserProfile-abc123"
  entityType: "function" | "class" | "interface" | ...;
  name: string;                  // "getUserProfile"
  filePath: string;              // "src/api/users.ts"
  
  // Business Context (from LLM)
  purposeSummary: string;        // What it does
  businessValue: string;         // Why it exists
  featureContext: string;        // Which feature
  detailedDescription?: string;  // Extended explanation
  tags: string[];                // Keywords
  
  // Confidence
  confidenceScore: number;       // 0.0 - 1.0
  confidenceLevel: "low" | "medium" | "high";
  reasoning: string;             // How confidence was determined
  
  // Provenance
  inferredFrom: "llm_inferred" | "code_pattern" | "user_confirmed";
  evidenceSources: string[];     // Files used for context
  
  // Hierarchy
  parentJustificationId?: string;
  hierarchyDepth: number;
  
  // Clarification
  clarificationPending: boolean;
  pendingQuestions?: ClarificationQuestion[];
  
  // Timestamps
  createdAt: number;
  updatedAt: number;
}
```

---

## Context Propagation

After LLM inference, context flows upward through the hierarchy:

```
┌─────────────────────────────────────────┐
│  Level 0: Leaf Functions                │
│  ├─ validateEmail() → "Input validation"│
│  └─ hashPassword() → "Security utility" │
└─────────────────────────────────────────┘
                    │ propagate
                    ▼
┌─────────────────────────────────────────┐
│  Level 1: Parent Class                  │
│  AuthService:                           │
│    Inherits: "Handles security,         │
│               input validation"         │
└─────────────────────────────────────────┘
                    │ propagate
                    ▼
┌─────────────────────────────────────────┐
│  Level 2: File                          │
│  auth/service.ts:                       │
│    "Authentication module with          │
│     security utilities"                 │
└─────────────────────────────────────────┘
```

---

## Justification Result

### Final Output (`JustificationResult`)
```typescript
{
  justified: EntityJustification[];      // Successfully justified
  failed: { entityId: string; error: string }[];  // Failed entities
  needingClarification: EntityJustification[];    // Low confidence
  stats: {
    total: number;           // Total entities processed
    succeeded: number;       // Successfully justified
    failed: number;          // Errors
    skipped: number;         // Already justified or trivial
    pendingClarification: number;  // Need human input
    averageConfidence: number;     // Mean confidence score
    durationMs: number;            // Total time
  }
}
```

---

## Complete Pipeline Summary

| Phase | Component | Input | Output | Duration |
|-------|-----------|-------|--------|----------|
| 1. Scan | `FileScanner` | Project path | `FileInfo[]` | ~1-5s |
| 2. Parse | `Parser` | Source code | AST nodes | ~10-30s |
| 3. Extract | `EntityExtractor` | AST | Entities + Relations | ~5-15s |
| 4. Write | `GraphWriter` | Entities | Graph database | ~5-10s |
| 5. Justify | `LLMJustificationService` | Entity IDs | Justifications | ~30-120s |

**Total with justification**: 50-180 seconds for a medium project (~500 files, ~2000 entities).

---

## Example End-to-End Flow

```
Input: Project at /myapp

Step 1: Scan → 423 files discovered
Step 2: Parse → 423 ASTs built
Step 3: Extract → 2,847 entities, 5,234 relationships
Step 4: Write → Graph populated
Step 5: Justify:
  ├─ Filter trivial: 412 entities skipped (getters, setters)
  ├─ Build hierarchy: 4 levels detected
  ├─ Level 0: 1,200 leaf functions → 24 batches → LLM
  ├─ Level 1: 800 methods → 16 batches → LLM
  ├─ Level 2: 300 classes → 6 batches → LLM
  ├─ Level 3: 135 files → 3 batches → LLM
  └─ Propagate context upward

Output:
  - 2,435 entities justified
  - Average confidence: 0.78
  - 23 entities need clarification
  - Duration: 94 seconds
```

---

# Part 3: Improvement Plan

This section outlines a phased approach to enhance Code-Synapse's indexing pipeline, entity extraction, and business justification capabilities. The goal is to transform Code-Synapse into a more complete "second brain" that captures not just structural code relationships, but also semantic intent, data flow, behavioral patterns, and architectural insights.

---

## Current State Analysis

### What We Have (Strengths)

| Capability | Implementation | Quality |
|------------|----------------|---------|
| **Structural Extraction** | 7 entity types (File, Function, Class, Interface, Import, Export, Symbol) | ✅ Solid |
| **Relationship Mapping** | 9 relationship types (defines, imports, exports, extends, implements, etc.) | ✅ Good |
| **Semantic Analysis** | TypeScript Compiler API for type resolution | ✅ Good for TS/JS |
| **Business Justification** | LLM-powered intent inference with confidence scoring | ✅ Functional |
| **Incremental Indexing** | Hash-based change detection, file watching | ✅ Efficient |
| **Vector Embeddings** | Chunk-based embeddings for similarity search | ✅ Basic |

### What's Missing (Critical Gaps)

| Gap | Impact | Priority |
|-----|--------|----------|
| **No Data Flow Analysis** | Can't trace how data moves through the system | 🔴 HIGH |
| **No Control Flow Analysis** | Can't understand execution paths, branching | 🔴 HIGH |
| **Limited Parameter Semantics** | Parameters extracted but not analyzed for purpose | 🟡 MEDIUM |
| **No Design Pattern Detection** | Missing architectural insights (Factory, Observer, etc.) | 🟡 MEDIUM |
| **No Side-Effect Tracking** | Can't identify I/O, mutations, external calls | 🔴 HIGH |
| **No API Contract Extraction** | Missing input/output schemas, error contracts | 🟡 MEDIUM |
| **No Error Handling Tracking** | Can't map error propagation paths | 🟡 MEDIUM |
| **No Semantic Similarity** | Vector embeddings not used for related code discovery | 🟢 LOW |
| **No Cross-File Data Dependencies** | Can't trace data structures across modules | 🔴 HIGH |

---

## Phased Implementation Plan

### Phase 1: Enhanced Entity Semantics (Foundation)

**Goal:** Enrich existing entities with deeper semantic information without changing the extraction architecture.

#### 1.1 Parameter Semantic Analysis

**Current State:** Parameters are extracted with name/type but no semantic meaning.

**Enhancement:**
```typescript
// NEW: Add to src/core/extraction/analyzers/parameter-analyzer.ts
interface ParameterSemantics {
  name: string;
  type: string;
  // NEW fields
  purpose: 'input' | 'output' | 'config' | 'callback' | 'context';
  isOptional: boolean;
  defaultValue?: string;
  validationRules?: string[];  // e.g., "non-null", "positive integer"
  derivedFrom?: string;        // Parameter origin tracing
  usedIn: string[];            // Where this param is used in body
}
```

**Implementation Steps:**
1. Create `src/core/extraction/analyzers/parameter-analyzer.ts`
2. Analyze function body to trace parameter usage
3. Infer purpose from naming conventions and usage patterns
4. Store enhanced semantics in `function_parameters` relation

**Schema Addition:**
```datalog
:create function_parameter_semantics {
  function_id: String,
  param_name: String,
  param_index: Int,
  purpose: String,        # input|output|config|callback|context
  is_optional: Bool,
  default_value: String?,
  validation_rules: [String]?,
  used_in_expressions: [String]?,
  =>
  analyzed_at: Int
}
```

#### 1.2 Return Value Analysis

**Current State:** Return types extracted but not analyzed for semantic meaning.

**Enhancement:**
```typescript
// NEW: Add to src/core/extraction/analyzers/return-analyzer.ts
interface ReturnSemantics {
  type: string;
  // NEW fields
  possibleValues: string[];      // For unions, enums
  errorConditions: string[];     // When it throws/returns error
  nullConditions: string[];      // When it returns null/undefined
  derivedFrom: string[];         // Data sources for return value
  transformations: string[];     // Operations applied before return
}
```

**Implementation Steps:**
1. Create `src/core/extraction/analyzers/return-analyzer.ts`
2. Trace all return statements in function body
3. Identify conditional returns and their conditions
4. Map data flow from parameters to return value

#### 1.3 Error Path Extraction

**Current State:** No tracking of error handling or propagation.

**Enhancement:**
```typescript
// NEW: src/core/extraction/analyzers/error-analyzer.ts
interface ErrorPath {
  functionId: string;
  errorType: string;           // Error class/type thrown
  condition: string;           // When this error occurs
  isHandled: boolean;          // Caught within function?
  propagatesTo: string[];      // Functions that receive this error
  recoveryStrategy?: string;   // How it's handled if caught
}
```

**Schema Addition:**
```datalog
:create error_paths {
  function_id: String,
  error_type: String,
  condition: String?,
  is_handled: Bool,
  propagates_to: [String]?,
  recovery_strategy: String?,
  =>
  source_location: String
}
```

---

### Phase 2: Data Flow Analysis (Core Enhancement)

**Goal:** Track how data moves through the codebase to answer questions like "Where does user input go?" or "What affects this calculation?"

#### 2.1 Intra-Function Data Flow

**New Module:** `src/core/analysis/data-flow/`

```typescript
// src/core/analysis/data-flow/interfaces.ts
interface DataFlowNode {
  id: string;
  kind: 'parameter' | 'variable' | 'return' | 'property' | 'call-result';
  name: string;
  scope: string;  // Function/block scope
}

interface DataFlowEdge {
  source: DataFlowNode;
  target: DataFlowNode;
  operation: 'assign' | 'transform' | 'pass' | 'spread' | 'destructure';
  transformDescription?: string;  // e.g., "map", "filter", "JSON.parse"
}

interface FunctionDataFlow {
  functionId: string;
  nodes: DataFlowNode[];
  edges: DataFlowEdge[];
  sources: DataFlowNode[];   // Entry points (params, globals)
  sinks: DataFlowNode[];     // Exit points (returns, mutations)
}
```

**Implementation Strategy: Lazy Evaluation (On-Demand)**
*   **Problem:** Eagerly computing SSA/Data Flow for every function will explode the graph size (~50x nodes) and kill indexing performance.
*   **Solution:**
    *   **Index Time:** Complete Phase 1 (Scanning, Parsing, Basic Extraction).
    *   **Runtime:** When an agent requests `trace_data(fn_id)`, *then* compute the SSA graph for that specific function and cache it.
    *   **Storage:** Store a *compressed summary* (Input Params → Output Return) on the Function node, not the full flow graph.

**Schema Addition (Lazy Cache):**
```datalog
:create data_flow_cache {
  function_id: String,
  flow_summary_json: Json, // Compressed { inputs: [], outputs: [] }
  full_graph_json: Json,   // Cached full SSA graph
  =>
  computed_at: Int
}
```

**Schema Addition:**
```datalog
:create data_flow_nodes {
  node_id: String,
  function_id: String,
  kind: String,
  name: String,
  scope: String,
  =>
  source_location: String
}

:create data_flow_edges {
  source_node: String,
  target_node: String,
  operation: String,
  transform_description: String?,
  =>
  function_id: String
}
```

#### 2.2 Inter-Function Data Flow

**Goal:** Track data across function boundaries.

```typescript
// src/core/analysis/data-flow/cross-function.ts
interface CrossFunctionFlow {
  sourceFunction: string;
  sourceOutput: string;      // Which return/mutation
  targetFunction: string;
  targetInput: string;       // Which parameter
  callSite: string;          // Where the call happens
  transformations: string[]; // Any transformations between
}
```

**Implementation:**
1. At each call site, map arguments to parameters
2. Track return value usage
3. Build cross-function data flow graph

#### 2.3 Data Flow Queries

**New MCP Tools:**
```typescript
// "trace_data" tool
interface TraceDataRequest {
  startPoint: string;  // e.g., "UserController.createUser.req.body"
  direction: 'forward' | 'backward' | 'both';
  maxDepth?: number;
}

// Returns all data flow paths from/to the start point
```

---

### Phase 3: Side-Effect Analysis (Critical for Understanding) ✅ IMPLEMENTED

**Status:** Implemented in Schema v8, fully integrated into indexing pipeline

**Integration:** Side-effect analysis runs automatically during indexing when `enableSemanticAnalysis: true` is set. The `SemanticAnalysisService` now includes the `SideEffectAnalyzer` alongside parameter, return, and error analyzers.

**Goal:** Identify and categorize side effects to understand what code actually *does* beyond its return value.

#### 3.1 Side-Effect Categories

```typescript
// src/core/analysis/side-effects/interfaces.ts
type SideEffectCategory =
  | 'io-file'           // File system operations (fs.*, readFile, writeFile)
  | 'io-network'        // Network operations (fetch, axios, http.*)
  | 'io-database'       // Database operations (ORM calls, raw SQL)
  | 'io-console'        // Console/logging operations
  | 'mutation-param'    // Mutates input parameter
  | 'mutation-global'   // Mutates global/module-level state
  | 'mutation-this'     // Mutates object state (this.*)
  | 'mutation-closure'  // Mutates closure variable
  | 'async-spawn'       // Spawns async operations (setTimeout, Promise)
  | 'external-service'  // Calls external APIs/services
  | 'dom-manipulation'  // DOM operations (browser)
  | 'event-emission'    // Emits events
  | 'unknown';          // Detected but uncategorized

interface SideEffect {
  id: string;
  functionId: string;
  category: SideEffectCategory;
  description: string;
  target: string | null;     // What is affected (e.g., "this.state", "database")
  isConditional: boolean;    // Only happens under certain conditions
  condition: string | null;  // The condition
  apiCall: string;           // The API/method call causing the side effect
  location: { line: number; column: number };
  confidence: DetectionConfidence; // 'high' | 'medium' | 'low'
  evidence: string[];        // Evidence for detection
}
```

#### 3.2 Implementation Structure

```
src/core/analysis/side-effects/
├── index.ts           # Module exports
├── interfaces.ts      # All type definitions and interfaces
├── categorizer.ts     # SideEffectCategorizer - pattern matching engine
└── detector.ts        # SideEffectAnalyzer - AST traversal and detection
```

#### 3.3 Detection Strategies

| Category | Detection Method | Confidence |
|----------|------------------|------------|
| `io-file` | Pattern match: `fs.*`, `readFile`, `writeFile`, `createWriteStream` | High |
| `io-network` | Pattern match: `fetch`, `axios.*`, `http.*`, `WebSocket` | High |
| `io-database` | Pattern match: `.query`, `.save`, `prisma.*`, `mongoose.*` | High/Medium |
| `io-console` | Pattern match: `console.*`, `logger.*`, `pino`, `winston` | High |
| `mutation-param` | AST: Track assignments to parameter properties | High |
| `mutation-global` | AST: Track assignments to `window`, `global`, `process` | High |
| `mutation-this` | AST: Track `this.*` assignments in methods | High |
| `mutation-closure` | AST: Track assignments to outer-scope variables | Medium |
| `async-spawn` | Pattern match: `setTimeout`, `setInterval`, `Worker` | High |
| `external-service` | Pattern match: `stripe.*`, `aws.*`, `firebase.*` | High |
| `dom-manipulation` | Pattern match: `document.*`, `innerHTML`, `localStorage` | High |
| `event-emission` | Pattern match: `.emit`, `.dispatch`, `.trigger` | Medium |

**Built-in Patterns:** 80+ patterns defined in `DEFAULT_SIDE_EFFECT_PATTERNS` covering:
- File system operations (14 patterns)
- Network operations (13 patterns)
- Database operations (14 patterns)
- Console/logging (11 patterns)
- Async operations (11 patterns)
- External services (12 patterns)
- DOM manipulation (13 patterns)
- Event emission (6 patterns)

#### 3.4 Schema (v8)

```datalog
:create side_effect {
  id: String,
  =>
  function_id: String,
  file_path: String,
  category: String,
  description: String,
  target: String?,
  api_call: String,
  is_conditional: Bool,
  condition: String?,
  confidence: String,
  evidence_json: Json,
  source_line: Int,
  source_column: Int,
  analyzed_at: Int
}

:create function_side_effect_summary {
  function_id: String,
  =>
  file_path: String,
  total_count: Int,
  is_pure: Bool,
  all_conditional: Bool,
  primary_categories_json: Json,
  risk_level: String,
  confidence: Float,
  analyzed_at: Int
}

:create has_side_effect {
  from_id: String,  # Function ID
  to_id: String     # SideEffect ID
}

:create has_side_effect_summary {
  from_id: String,  # Function ID
  to_id: String     # Function ID (same as summary primary key)
}
```

#### 3.5 MCP Tool

```typescript
// get_side_effects tool
interface GetSideEffectsInput {
  functionName: string;
  filePath?: string;
  categories?: string[];      // Filter by category
  minConfidence?: string;     // 'high' | 'medium' | 'low'
}

interface SideEffectResult {
  functionId: string;
  functionName: string;
  filePath: string;
  summary: {
    totalCount: number;
    isPure: boolean;
    allConditional: boolean;
    primaryCategories: string[];
    riskLevel: 'low' | 'medium' | 'high';
    confidence: number;
  };
  sideEffects: Array<{
    id: string;
    category: string;
    description: string;
    target: string | null;
    apiCall: string;
    isConditional: boolean;
    condition: string | null;
    confidence: string;
    location: { line: number; column: number };
  }>;
}
```

#### 3.6 Usage Example

```typescript
import { createSideEffectAnalyzer, createSideEffectCategorizer } from './core/analysis/side-effects';

const categorizer = createSideEffectCategorizer();
const analyzer = createSideEffectAnalyzer(categorizer);

const result = analyzer.analyze(
  functionNode,    // tree-sitter AST node
  functionBody,    // source code string
  functionId,
  filePath
);

console.log(result.summary.isPure);           // false
console.log(result.summary.riskLevel);        // 'medium'
console.log(result.sideEffects[0].category);  // 'io-database'
```

---

### Phase 4: Design Pattern Detection (Architectural Insights) ✅ IMPLEMENTED

**Status:** Implemented in Schema v9, MCP tools available

**Goal:** Automatically detect common design patterns to provide architectural context.

#### 4.1 Detectable Patterns

| Pattern | Detection Heuristics | Confidence |
|---------|---------------------|------------|
| **Factory** | Function returning new instances, `create*`/`make*`/`build*` methods, `new` keyword | High |
| **Singleton** | Private constructor, static `getInstance`, module-level instance | High |
| **Observer** | `subscribe`/`unsubscribe`/`on`/`off` methods, event emitter patterns | High |
| **Repository** | CRUD methods (`find*`, `get*`, `create*`, `update*`, `delete*`), entity type parameter | High |
| **Service** | Stateless class ending in `Service`, injected dependencies, business methods | Medium |
| **Adapter** | Implements interface, wraps another type, method delegation | Medium |
| **Builder** | Method chaining returning `this`, `build()` method, fluent setters | High |
| **Strategy** | Interface with 1-3 methods, multiple implementations, context class | Medium |
| **Decorator** | Wraps same interface, constructor parameter of same type, delegates | Medium |

#### 4.2 Implementation Structure

```
src/core/analysis/patterns/
├── index.ts              # Module exports
├── interfaces.ts         # All type definitions and interfaces
├── service.ts            # PatternAnalysisService - orchestrator
└── detectors/
    ├── index.ts          # Detector exports
    ├── base-detector.ts  # BasePatternDetector abstract class
    ├── factory-detector.ts
    ├── singleton-detector.ts
    ├── observer-detector.ts
    ├── repository-detector.ts
    ├── service-detector.ts
    ├── builder-detector.ts
    ├── strategy-detector.ts
    └── decorator-detector.ts
```

#### 4.3 Interfaces

```typescript
// src/core/analysis/patterns/interfaces.ts
interface DetectedPattern {
  id: string;
  patternType: DesignPatternType;
  name: string;
  confidence: number;          // 0.0 - 1.0
  confidenceLevel: 'high' | 'medium' | 'low';
  participants: PatternParticipant[];
  evidence: string[];          // Why we think it's this pattern
  filePaths: string[];
  description?: string;
  detectedAt: number;
}

interface PatternParticipant {
  role: PatternRole;           // e.g., "factory", "product", "singleton"
  entityId: string;
  entityType: 'class' | 'function' | 'interface' | 'variable' | 'method';
  entityName: string;
  filePath: string;
  evidence: string[];
}

interface IPatternDetector {
  readonly patternType: DesignPatternType;
  detect(context: PatternAnalysisContext, options?: PatternDetectionOptions): DetectedPattern[];
  getHeuristics(): PatternHeuristic[];
}

interface IPatternAnalysisService {
  analyze(context: PatternAnalysisContext, options?: PatternDetectionOptions): PatternAnalysisResult;
  analyzeFile(classes, functions, interfaces, filePath, options?): PatternAnalysisResult;
  registerDetector(detector: IPatternDetector): void;
}
```

#### 4.4 Schema (v9)

```datalog
:create design_pattern {
  id: String,
  =>
  pattern_type: String,     # 'factory' | 'singleton' | 'observer' | etc.
  name: String,
  confidence: Float,
  confidence_level: String, # 'high' | 'medium' | 'low'
  evidence_json: Json,      # string[]
  file_paths_json: Json,    # string[]
  description: String?,
  detected_at: Int
}

:create pattern_participant {
  id: String,
  =>
  pattern_id: String,
  entity_id: String,
  role: String,             # 'factory' | 'product' | 'singleton' | etc.
  entity_type: String,      # 'class' | 'function' | 'interface' | etc.
  entity_name: String,
  file_path: String,
  evidence_json: Json       # string[]
}

:create has_pattern {
  from_id: String,          # Entity ID
  to_id: String,            # Pattern ID
  =>
  role: String
}

:create pattern_has_participant {
  from_id: String,          # Pattern ID
  to_id: String             # Participant ID
}
```

#### 4.5 MCP Tools

```typescript
// find_patterns tool
interface FindPatternsInput {
  patternType?: DesignPatternType; // Filter by pattern type
  minConfidence?: number;          // 0.0 - 1.0 threshold
  filePath?: string;               // Filter by file
  limit?: number;                  // Max results (default: 20)
}

interface FindPatternsResult {
  patterns: PatternResult[];
  stats: {
    total: number;
    byType: Record<string, number>;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  };
}

// get_pattern tool
interface GetPatternInput {
  patternId: string;
}
```

#### 4.6 Usage Example

```typescript
import { createPatternAnalysisService, type ClassInfo } from './core/analysis';

const service = createPatternAnalysisService({ minConfidence: 0.5 });

const result = service.analyze({
  classes: extractedClasses,
  functions: extractedFunctions,
  interfaces: extractedInterfaces,
});

console.log(`Found ${result.stats.totalPatterns} patterns`);
for (const pattern of result.patterns) {
  console.log(`${pattern.patternType}: ${pattern.name} (${pattern.confidenceLevel})`);
  for (const p of pattern.participants) {
    console.log(`  - ${p.role}: ${p.entityName} (${p.entityType})`);
  }
}
```

---

### Phase 5: Enhanced Business Justification (LLM Improvements)

**Goal:** Improve justification quality through better context and more focused prompts.

#### 5.1 Context Enhancement

**Current:** Justification uses function signature + body + call graph.

**Enhanced Context:**
```typescript
interface EnhancedJustificationContext {
  // Existing
  functionSignature: string;
  functionBody: string;
  callGraph: string[];

  // NEW: Add these
  dataFlowSummary: string;      // "Receives user input, transforms to DTO, stores in DB"
  sideEffects: string[];        // ["Writes to database", "Sends HTTP request"]
  errorBehavior: string;        // "Throws ValidationError on invalid input"
  relatedPatterns: string[];    // ["Part of Repository pattern", "Uses Factory"]
  domainContext: string;        // Inferred domain (auth, payments, etc.)
  callerIntents: string[];      // Why callers use this function
}
```

#### 5.2 Specialized Prompts

Create domain-specific justification prompts:

```typescript
// src/core/justification/prompts/domain-prompts.ts
const DOMAIN_PROMPTS = {
  authentication: `Analyze this authentication-related code...`,
  dataAccess: `Analyze this data access code...`,
  apiEndpoint: `Analyze this API endpoint...`,
  validation: `Analyze this validation logic...`,
  transformation: `Analyze this data transformation...`,
};
```

#### 5.3 Confidence Calibration

Improve confidence scoring:

```typescript
interface JustificationConfidence {
  overall: number;
  factors: {
    codeClarity: number;      // How clear is the code itself?
    contextRichness: number;  // How much context did we have?
    patternMatch: number;     // Does it match known patterns?
    nameQuality: number;      // How descriptive are names?
  };
  uncertainties: string[];    // What we're unsure about
}
```

#### 5.4 Enhanced Justification Fields

The current schema captures *what* an entity does and *why* it exists. Future versions will add deeper business context:

```typescript
interface EnhancedEntityJustification extends EntityJustification {
  // User Impact
  userImpact?: string;           // Who benefits from this entity?

  // Dependency Analysis
  dependencyRisk?: "low" | "medium" | "high" | "critical";
  dependentCount?: number;        // Number of entities that depend on this
  breakageImpact?: string[];      // Features that would break if removed

  // Business Metrics
  usageFrequency?: "rare" | "occasional" | "frequent" | "critical-path";
  businessCriticality?: number;   // 0.0 - 1.0 score

  // Design Rationale
  alternativesConsidered?: string; // Why this approach over others?

  // Change Risk Assessment
  changeRiskLevel?: "low" | "medium" | "high" | "requires-review";
  securityBoundary?: boolean;     // Does this touch security-sensitive code?
  complianceRelevant?: boolean;   // Affects regulatory compliance?
}
```

---

### Phase 6: Semantic Similarity & Related Code Discovery

**Goal:** Use vector embeddings to find semantically related code.

#### 6.1 Embedding Strategy

**Current:** Chunks are embedded but not used for similarity.

**Enhanced:**
```typescript
// src/core/embeddings/similarity-service.ts
interface SimilarityService {
  // Find functions with similar purpose
  findSimilarFunctions(functionId: string, limit: number): Promise<SimilarFunction[]>;

  // Find code that handles similar data
  findSimilarDataHandlers(dataType: string, limit: number): Promise<Function[]>;

  // Find code with similar business justification
  findSimilarBusinessLogic(justification: string, limit: number): Promise<Function[]>;

  // Cluster related code by semantic similarity
  clusterRelatedCode(threshold: number): Promise<CodeCluster[]>;
}
```

#### 6.2 Multi-Vector Approach

Store multiple embeddings per entity:

```typescript
interface EntityEmbeddings {
  entityId: string;
  vectors: {
    structural: number[];    // Based on AST structure
    semantic: number[];      // Based on code meaning
    justification: number[]; // Based on business purpose
    signature: number[];     // Based on interface/API
  };
}
```

---

## Implementation Priority & Timeline

### Phase 1: Foundation Enhancements ✅ COMPLETE

| Task | Status | Location |
|------|--------|----------|
| Parameter semantic analysis | ✅ Complete | `src/core/extraction/analyzers/parameter-analyzer.ts` |
| Return value analysis | ✅ Complete | `src/core/extraction/analyzers/return-analyzer.ts` |
| Error path extraction | ✅ Complete | `src/core/extraction/analyzers/error-analyzer.ts` |
| Schema migrations | ✅ Complete | Schema v8 |

### Phase 2: Data Flow ✅ COMPLETE

| Task | Status | Location |
|------|--------|----------|
| Intra-function data flow | ✅ Complete | `src/core/analysis/data-flow/intra-function.ts` |
| Cross-function data flow | ✅ Complete | `src/core/analysis/data-flow/cross-function.ts` |
| Data flow MCP tools | ✅ Complete | `get_data_flow` tool in `src/mcp/tools.ts` |

### Phase 3: Side Effects ✅ COMPLETE

| Task | Status | Location |
|------|--------|----------|
| Side-effect detection | ✅ Complete | `src/core/analysis/side-effects/detector.ts` |
| Side-effect categorization | ✅ Complete | `src/core/analysis/side-effects/categorizer.ts` |
| Side-effect MCP tool | ✅ Complete | `get_side_effects` tool in `src/mcp/tools.ts` |
| Pipeline integration | ✅ Complete | `SemanticAnalysisService` in coordinator |

### Phase 4: Design Patterns ✅ COMPLETE

| Task | Status | Location |
|------|--------|----------|
| Pattern interfaces & types | ✅ Complete | `src/core/analysis/patterns/interfaces.ts` |
| Factory detector | ✅ Complete | `src/core/analysis/patterns/detectors/factory-detector.ts` |
| Singleton detector | ✅ Complete | `src/core/analysis/patterns/detectors/singleton-detector.ts` |
| Observer detector | ✅ Complete | `src/core/analysis/patterns/detectors/observer-detector.ts` |
| Repository detector | ✅ Complete | `src/core/analysis/patterns/detectors/repository-detector.ts` |
| Service detector | ✅ Complete | `src/core/analysis/patterns/detectors/service-detector.ts` |
| Builder detector | ✅ Complete | `src/core/analysis/patterns/detectors/builder-detector.ts` |
| Strategy detector | ✅ Complete | `src/core/analysis/patterns/detectors/strategy-detector.ts` |
| Decorator detector | ✅ Complete | `src/core/analysis/patterns/detectors/decorator-detector.ts` |
| Pattern analysis service | ✅ Complete | `src/core/analysis/patterns/service.ts` |
| UCE-to-Pattern converter | ✅ Complete | `src/core/analysis/patterns/uce-converter.ts` |
| Schema definitions | ✅ Complete | Schema v9 |
| MCP tools | ✅ Complete | `find_patterns`, `get_pattern` in `src/mcp/tools.ts` |
| Pipeline integration | ✅ Complete | `IndexerCoordinator` with `enablePatternDetection` |

### Phase 5: Enhanced Justification ✅ COMPLETE

| Task | Status | Location |
|------|--------|----------|
| Enhanced context types | ✅ Complete | `src/core/justification/models/justification.ts` |
| Analysis context builder | ✅ Complete | `src/core/justification/hierarchy/analysis-context-builder.ts` |
| Context propagator integration | ✅ Complete | `src/core/justification/hierarchy/context-propagator.ts` |
| Prompt generation updates | ✅ Complete | `src/core/justification/prompts/justification-prompts.ts` |

### Phase 6: Semantic Similarity ✅ COMPLETE

| Task | Status | Location |
|------|--------|----------|
| Embedding service | ✅ Complete | `src/core/embeddings/index.ts` |
| Similarity service | ✅ Complete | `src/core/embeddings/similarity-service.ts` |
| Vector search (HNSW) | ✅ Complete | Uses CozoDB `v_knn()` for HNSW indices |
| MCP tool | ✅ Complete | `find_similar_code` in `src/mcp/tools.ts` |
| Pipeline integration | ✅ Complete | `src/mcp/server.ts` service initialization |

**Implementation Details:**

- **EmbeddingService**: Uses `@huggingface/transformers` with local ONNX models (Xenova/all-MiniLM-L6-v2, 384 dimensions)
- **SimilarityService**: Provides `findSimilarByEntityId`, `findSimilarByText`, `findSimilarByEmbedding`, `computeSimilarity`, `clusterSimilarCode`
- **Vector Search**: HNSW-based similarity search using CozoDB's `~function_embedding:embedding_hnsw` index
- **MCP Tool**: `find_similar_code` allows search by entity ID or natural language description

---

## New MCP Tools

| Tool | Purpose | Status |
|------|---------|--------|
| `get_data_flow` | Get data flow analysis for a function | ✅ Implemented |
| `get_side_effects` | List side effects of a function | ✅ Implemented |
| `find_patterns` | Find design patterns in code | ✅ Implemented |
| `get_pattern` | Get details of a specific pattern | ✅ Implemented |
| `get_error_paths` | Get error propagation paths | ✅ Implemented |
| `find_similar_code` | Find semantically similar functions | ✅ Implemented |
| `trace_data_flow` | Trace data from source to sink | TODO |
| `get_data_dependencies` | Get all data dependencies for a function | TODO |
| `explain_function_behavior` | Rich explanation with all analyses | TODO |

---

## Success Metrics

### Quality Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Entities extracted per file | ~5 | ~12 (with params, errors, etc.) |
| Relationships per entity | ~2 | ~5 (with data flow, patterns) |
| Justification confidence avg | ~0.6 | ~0.8 |
| Questions answerable by graph | ~40% | ~80% |

### Completeness Metrics

| Capability | Status | Implementation |
|------------|--------|----------------|
| "What does this function do?" | ✅ Implemented | Rich with data flow, parameters, returns |
| "Where does this data go?" | ✅ Implemented | Data flow analysis (Phase 2) |
| "What side effects does this have?" | ✅ Implemented | 12 categories, 80+ patterns (Phase 3) |
| "What errors can this throw?" | ✅ Implemented | Error path analysis (Phase 1) |
| "What pattern is this?" | ✅ Implemented | 8 detectors, heuristic-based detection (Phase 4) |
| "What similar code exists?" | ✅ Implemented | Phase 6: Vector similarity with HNSW indices |

---

## File Structure After Implementation

```
src/core/
├── analysis/                    # NEW: Analysis modules
│   ├── data-flow/
│   │   ├── interfaces.ts
│   │   ├── intra-function.ts
│   │   ├── cross-function.ts
│   │   └── index.ts
│   ├── side-effects/
│   │   ├── interfaces.ts
│   │   ├── detector.ts
│   │   ├── categorizer.ts
│   │   └── index.ts
│   └── patterns/
│       ├── interfaces.ts
│       ├── detectors/
│       │   ├── factory-detector.ts
│       │   ├── singleton-detector.ts
│       │   ├── observer-detector.ts
│       │   ├── repository-detector.ts
│       │   └── index.ts
│       └── index.ts
├── extraction/
│   ├── analyzers/              # NEW: Enhanced analyzers
│   │   ├── parameter-analyzer.ts
│   │   ├── return-analyzer.ts
│   │   └── error-analyzer.ts
│   └── ... (existing)
├── embeddings/
│   ├── similarity-service.ts   # NEW
│   └── ... (existing)
├── justification/
│   ├── prompts/
│   │   ├── domain-prompts.ts   # NEW
│   │   └── ... (existing)
│   ├── context-builder.ts      # NEW: Enhanced context
│   └── ... (existing)
└── ... (existing)
```

---

# Part 4: Technology Accelerator Strategy

To implement these advanced capabilities quickly without reinventing the wheel, we should leverage existing open-source tools:

## 1. Data Flow & Name Resolution
*   **[stack-graphs](https://github.com/github/stack-graphs)** (GitHub):
    *   *Role:* Solves the "Jump to Definition" and cross-file reference problem incrementally.
    *   *Why:* Built on Tree-sitter, handles complex scope rules, extremely fast. Use this instead of custom semantic analyzers for Phase 2.2.
*   **[tree-sitter-graph](https://github.com/tree-sitter/tree-sitter-graph)**:
    *   *Role:* Construct arbitrary graphs from ASTs using a declarative DSL.
    *   *Why:* Perfect for building Control Flow Graphs (CFG) and Data Flow Graphs (DFG) without writing custom traversal logic for every language.

## 2. Vector Search (Embeddings)
*   **[LanceDB](https://lancedb.com/)** or **[Chroma](https://www.trychroma.com/)**:
    *   *Role:* Lightweight, embedded vector search for Phase 6.
    *   *Why:* CozoDB has vector support, but dedicated embedded vector DBs offer better DX for multi-modal similarity (code + documentation).

## 3. Static Analysis Standards
*   **[SCIP](https://github.com/sourcegraph/scip)** (Source Code Intelligence Protocol):
    *   *Role:* Standard format for code intelligence.
    *   *Strategy:* Instead of inventing a custom graph schema, align our Data Flow nodes with SCIP for interoperability.

---

## Conclusion

This plan transforms Code-Synapse from a structural code index into a comprehensive "second brain" that understands:

1. **Structure** (existing) - What code exists and how it's organized
2. **Behavior** (new) - What code does, including side effects
3. **Data Flow** (new) - How data moves through the system
4. **Patterns** (new) - What architectural patterns are used
5. **Intent** (enhanced) - Why code exists and its business purpose
6. **Relationships** (enhanced) - How code relates semantically

The phased approach allows incremental delivery of value while building toward the complete vision.

---

## Other Future Enhancements

### Runtime Usage Integration
- Connect to APM/telemetry to get real `usageFrequency`
- Correlate code paths with user journeys

### Code Review Integration
- Link entities to past PR discussions
- Surface "why" from historical code review comments

### Documentation Mining
- Extract design rationale from README, ADRs, wiki
- Cross-reference with entity justifications

---

# Part 4: Implementation Status

## Phase 1: Enhanced Entity Semantics - IMPLEMENTED

Phase 1 has been implemented with the following components:

### Files Created

| File | Purpose |
|------|---------|
| `src/core/analysis/interfaces.ts` | Interface definitions for all analyzers |
| `src/core/analysis/index.ts` | Module exports |
| `src/core/extraction/analyzers/parameter-analyzer.ts` | Parameter semantic analysis |
| `src/core/extraction/analyzers/return-analyzer.ts` | Return value analysis |
| `src/core/extraction/analyzers/error-analyzer.ts` | Error path analysis |
| `src/core/extraction/analyzers/index.ts` | Analyzer exports |

### Schema Additions (Version 6)

The following tables were added to `src/core/graph/schema-definitions.ts`:

```typescript
// Node tables
FunctionParameterSemantics  // Enhanced parameter info per function
FunctionReturnSemantics     // Return value analysis per function
ErrorPath                   // Individual error paths
FunctionErrorAnalysis       // Error analysis summary per function

// Relationship tables
HAS_PARAMETER_SEMANTICS     // Function → FunctionParameterSemantics
HAS_RETURN_SEMANTICS        // Function → FunctionReturnSemantics
HAS_ERROR_ANALYSIS          // Function → FunctionErrorAnalysis
HAS_ERROR_PATH              // Function → ErrorPath
ERROR_PROPAGATES_TO         // ErrorPath → Function (cross-function)
```

### Interfaces

**IParameterAnalyzer** - Analyzes function parameters:
- Purpose classification (input, output, config, callback, context)
- Usage tracking within function body
- Validation rule extraction
- Mutation detection

**IReturnAnalyzer** - Analyzes return values:
- All return points with conditions
- Possible values for union types
- Data source tracing
- Transformation identification

**IErrorAnalyzer** - Analyzes error handling:
- Throw point detection
- Try/catch block analysis
- Error propagation paths
- Handling strategy classification

### Row Types Added

```typescript
// In src/core/extraction/types.ts
ParameterSemanticsRow  // 16 columns
ReturnSemanticsRow     // 14 columns
ErrorPathRow           // 12 columns
ErrorAnalysisRow       // 9 columns
```

### CozoBatch Extension

```typescript
// Added to CozoBatch interface
parameterSemantics: ParameterSemanticsRow[]
returnSemantics: ReturnSemanticsRow[]
errorPaths: ErrorPathRow[]
errorAnalysis: ErrorAnalysisRow[]
```

### Pipeline Integration

The `EntityPipeline` class now includes:

```typescript
// Analyzer instances
private parameterAnalyzer: ParameterAnalyzer;
private returnAnalyzer: ReturnAnalyzer;
private errorAnalyzer: ErrorAnalyzer;

// Conversion methods for database rows
convertParameterAnalysisToRows(result: ParameterAnalysisResult): ParameterSemanticsRow[]
convertReturnAnalysisToRow(result: ReturnAnalysisResult): ReturnSemanticsRow
convertErrorAnalysisToRows(result: ErrorAnalysisResult): { errorPaths, errorAnalysis }

// Accessor methods for direct AST analysis
getParameterAnalyzer(): ParameterAnalyzer
getReturnAnalyzer(): ReturnAnalyzer
getErrorAnalyzer(): ErrorAnalyzer
```

### Usage Example

```typescript
import { createEntityPipeline, type Node } from "./core/extraction/index.js";

const pipeline = createEntityPipeline({
  projectRoot: "/project",
  semanticAnalysis: true
});

// Get analyzers for direct AST analysis
const paramAnalyzer = pipeline.getParameterAnalyzer();
const returnAnalyzer = pipeline.getReturnAnalyzer();
const errorAnalyzer = pipeline.getErrorAnalyzer();

// Analyze a function AST node
const paramResult = paramAnalyzer.analyze(functionNode, functionBody, functionId);
const returnResult = returnAnalyzer.analyze(functionNode, functionBody, functionId);
const errorResult = errorAnalyzer.analyze(functionNode, functionBody, functionId);

// Convert to database rows
const paramRows = pipeline.convertParameterAnalysisToRows(paramResult);
const returnRow = pipeline.convertReturnAnalysisToRow(returnResult);
const { errorPaths, errorAnalysis } = pipeline.convertErrorAnalysisToRows(errorResult);

// Add to batch
batch.parameterSemantics.push(...paramRows);
batch.returnSemantics.push(returnRow);
batch.errorPaths.push(...errorPaths);
batch.errorAnalysis.push(errorAnalysis);
```

### Architecture Notes

The analyzers follow the **decoupling philosophy**:

1. **Interfaces first** - All analyzers implement interfaces defined in `src/core/analysis/interfaces.ts`
2. **No vendor lock-in** - Analyzers work with standard Tree-sitter `Node` objects
3. **Storage-agnostic** - Row types can be stored in any backend via `IStorageAdapter`
4. **Lazy evaluation ready** - Analyzers can be called on-demand (not at index time)

### Integration Points

The semantic analysis integrates at the **IndexerCoordinator** level where both:
- Parsed AST nodes are available
- Function entity IDs have been generated

This allows running analysis after parsing but before or during entity extraction.

### Completed Integration

- [x] **Integrate analyzers into IndexerCoordinator** - `SemanticAnalysisService` bridges UCE entities with AST analyzers
- [x] **Add database write operations** - `cozo-graph-store.ts` now writes Phase 1 tables
- [x] **Create MCP tools** - `get_function_semantics` and `get_error_paths` tools added
- [x] **Schema tables auto-generated** - Phase 1 tables included in `generateExecutableCozoScript()`

### Enabling Semantic Analysis

To enable Phase 1 semantic analysis during indexing:

```typescript
const coordinator = new IndexerCoordinator({
  parser,
  store,
  project,
  enableSemanticAnalysis: true,  // Enable Phase 1-3 (parameters, returns, errors, side effects)
  semanticAnalysisOptions: {
    analyzeParameters: true,
    analyzeReturns: true,
    analyzeErrors: true,
    analyzeSideEffects: true,
    timeoutPerFunction: 5000,
  },
});
```

### Enabling Pattern Detection

To enable Phase 4 design pattern detection during indexing:

```typescript
const coordinator = new IndexerCoordinator({
  parser,
  store,
  project,
  enablePatternDetection: true,  // Enable Phase 4
  patternDetectionOptions: {
    minConfidence: 0.5,          // Minimum confidence threshold (0.0-1.0)
    patternTypes: [              // Which patterns to detect (default: all)
      "factory", "singleton", "observer", "repository",
      "service", "builder", "strategy", "decorator"
    ],
    crossFileAnalysis: true,     // Analyze patterns across files
    maxDepth: 3,                 // Max depth for relationship analysis
  },
});
```

### Enabling Both Semantic Analysis and Pattern Detection

For comprehensive analysis, enable both:

```typescript
const coordinator = new IndexerCoordinator({
  parser,
  store,
  project,
  enableSemanticAnalysis: true,   // Phase 1-3
  enablePatternDetection: true,   // Phase 4
});
```

### MCP Tools Available

| Tool | Description |
|------|-------------|
| `get_function_semantics` | Get parameter, return, and error analysis for a function |
| `get_error_paths` | Get error propagation paths for a function |

---

## Phase 2: Data Flow Analysis - IMPLEMENTED

Phase 2 has been implemented with the following components:

### Files Created

| File | Purpose |
|------|---------|
| `src/core/analysis/data-flow/interfaces.ts` | Interface definitions for data flow analysis |
| `src/core/analysis/data-flow/intra-function.ts` | Intra-function data flow analyzer |
| `src/core/analysis/data-flow/cross-function.ts` | Cross-function data flow analyzer |
| `src/core/analysis/data-flow/cache.ts` | Lazy evaluation cache service |
| `src/core/analysis/data-flow/index.ts` | Module exports |

### Schema Additions (Version 7)

The following tables were added to `src/core/graph/schema-definitions.ts`:

```typescript
// Node tables
DataFlowCache          // Cached data flow analysis for a function (lazy evaluation)
DataFlowNode           // Individual node in a data flow graph
CrossFunctionFlow      // Data flow across function boundaries
TaintSource            // Tracks external data sources that introduce taint

// Relationship tables
HAS_DATA_FLOW_CACHE    // Function → DataFlowCache
DATA_FLOWS_TO          // DataFlowNode → DataFlowNode (data flow edge)
HAS_CROSS_FLOW         // Function → CrossFunctionFlow
HAS_TAINT_SOURCE       // Function → TaintSource
TAINT_FLOWS_TO         // TaintSource → DataFlowNode
```

### Interfaces

**IDataFlowAnalyzer** - Analyzes intra-function data flow:
- Parameter to return tracing
- Variable assignment tracking
- Taint source detection
- Side-effect identification
- Pure function detection

**ICrossFunctionAnalyzer** - Analyzes cross-function data flow:
- Argument to parameter mapping
- Return value usage tracking
- Taint propagation across calls
- Call graph data flow traversal

**IDataFlowCache** - Lazy evaluation cache:
- On-demand computation
- File hash-based staleness detection
- LRU eviction policy
- Cache statistics

### Data Flow Node Types

```typescript
type DataFlowNodeKind =
  | "parameter"      // Function parameter
  | "variable"       // Local variable
  | "return"         // Return statement
  | "call_result"    // Result of a function call
  | "property"       // Object property access
  | "literal"        // Literal value
  | "external"       // External input
  | "unknown";
```

### Data Flow Edge Types

```typescript
type DataFlowEdgeKind =
  | "assign"         // Direct assignment (x = y)
  | "transform"      // Transformation (x = f(y))
  | "read"           // Read from property/variable
  | "write"          // Write to property/variable
  | "parameter"      // Passed as parameter to function
  | "return"         // Returned from function
  | "conditional"    // Conditionally flows
  | "merge"          // Merge point (phi node)
  | "propagate";     // Taint propagation
```

### Taint Source Categories

```typescript
type TaintSource =
  | "user_input"     // User-provided data
  | "network"        // Data from network requests
  | "filesystem"     // Data read from files
  | "database"       // Data from database queries
  | "environment"    // Environment variables
  | "time"           // Time-dependent values
  | "random"         // Random/non-deterministic values
  | "external_api"   // Third-party API responses
  | "unknown";
```

### Row Types Added

```typescript
// In src/core/extraction/types.ts
DataFlowCacheRow       // 17 columns
DataFlowNodeRow        // 9 columns
CrossFunctionFlowRow   // 10 columns
TaintSourceRow         // 9 columns
DataFlowsToRow         // 7 columns (relationship)
HasCrossFlowRow        // 3 columns (relationship)
TaintFlowsToRow        // 4 columns (relationship)
```

### CozoBatch Extension

```typescript
// Added to CozoBatch interface
dataFlowCache: DataFlowCacheRow[]
dataFlowNodes: DataFlowNodeRow[]
crossFunctionFlows: CrossFunctionFlowRow[]
taintSources: TaintSourceRow[]
dataFlowsTo: DataFlowsToRow[]
hasCrossFlow: HasCrossFlowRow[]
taintFlowsTo: TaintFlowsToRow[]
```

### Usage Example

```typescript
import {
  createDataFlowAnalyzer,
  createCrossFunctionAnalyzer,
  createDataFlowCache,
  type Node
} from "./core/analysis/index.js";

// Create analyzers and cache
const dataFlowAnalyzer = createDataFlowAnalyzer({ trackTaint: true });
const crossFunctionAnalyzer = createCrossFunctionAnalyzer();
const cache = createDataFlowCache({ maxEntries: 10000 });

// Analyze a function (lazy evaluation)
function analyzeFunction(functionNode: Node, functionBody: string, functionId: string, fileHash: string) {
  // Check cache first
  if (cache.isValid(functionId, fileHash)) {
    return cache.get(functionId);
  }

  // Compute on demand
  const dataFlow = dataFlowAnalyzer.analyzeFunction(functionNode, functionBody, functionId);

  // Get summary
  const summary = dataFlowAnalyzer.summarize(dataFlow);
  console.log(`Pure function: ${summary.isPure}`);
  console.log(`Has side effects: ${summary.hasSideEffects}`);
  console.log(`Inputs affecting output: ${summary.inputsAffectingOutput.join(', ')}`);

  // Detect taint flows
  const taintFlows = dataFlowAnalyzer.detectTaintFlows(dataFlow);
  for (const flow of taintFlows) {
    console.log(`Taint from ${flow.source} flows to sink at ${flow.sinkNodeId}`);
  }

  // Cache for reuse
  cache.setWithHash(functionId, dataFlow, fileId, fileHash);

  return dataFlow;
}

// Trace data across functions
function traceDataAcrossFunctions(
  functionFlows: Map<string, FunctionDataFlow>,
  callGraph: Map<string, string[]>
) {
  // Build cross-function flow graph
  const crossFlows = crossFunctionAnalyzer.buildCrossFlowGraph(functionFlows, callGraph);

  // Trace a specific parameter
  const reachableFunctions = crossFunctionAnalyzer.traceDataFlow(
    'fn-getUserInput-123',
    'input',
    functionFlows,
    crossFlows
  );

  console.log(`User input reaches: ${reachableFunctions.join(', ')}`);
}
```

### Lazy Evaluation Strategy

The data flow analysis follows a **lazy evaluation** approach:

1. **Index Time**: Only structural extraction (functions, classes, relationships)
2. **Query Time**: When an agent requests data flow, compute on-demand
3. **Cache**: Store computed results with file hash for staleness detection
4. **Invalidation**: Invalidate cache when files change

This avoids the "graph explosion" problem where eagerly computing data flow for every function would create ~50x more nodes and significantly slow indexing.

### Architecture Notes

The data flow analyzers follow the **decoupling philosophy**:

1. **Interfaces first** - All analyzers implement interfaces in `src/core/analysis/data-flow/interfaces.ts`
2. **No vendor lock-in** - Analyzers work with standard Tree-sitter `Node` objects
3. **Storage-agnostic** - Row types can be stored in any backend via `IStorageAdapter`
4. **Lazy evaluation** - Compute on-demand, cache for reuse
5. **Taint tracking** - Built-in support for tracking data provenance

### Integration Points

The data flow analysis integrates with:

1. **EntityPipeline** - Can be called after function extraction
2. **IndexerCoordinator** - For on-demand analysis during queries
3. **MCP Tools** - For exposing `trace_data_flow` and similar tools
4. **GraphWriter** - For persisting cached analysis results

### Completed Integration

- [x] **Database write operations** - `cozo-graph-store.ts` writes all Phase 2 tables
- [x] **Schema auto-generation** - Phase 2 tables included in schema (Version 7)
- [x] **MCP tool created** - `get_data_flow` tool for querying data flow analysis
- [x] **GraphWriter updated** - Entity/relationship counts include Phase 2 data

### MCP Tools Available

| Tool | Description |
|------|-------------|
| `get_function_semantics` | Get parameter, return, and error analysis for a function |
| `get_error_paths` | Get error propagation paths for a function |
| `get_data_flow` | Get data flow analysis for a function (lazy evaluated, cached) |

### Future Enhancements

- [ ] Implement batch data flow computation for initial indexing
- [ ] Add visualization support in web viewer
- [ ] Create `trace_data_flow` tool for cross-function tracing
- [ ] Create `find_taint_paths` tool for security analysis

---

## Phase 3: Side-Effect Analysis - IMPLEMENTED

Phase 3 has been fully implemented and integrated into the indexing pipeline. See the "Phase 3: Side-Effect Analysis" section above for detailed documentation.

### Pipeline Integration

Side-effect analysis runs automatically during indexing when `enableSemanticAnalysis: true` is set. The `SemanticAnalysisService` includes the `SideEffectAnalyzer` alongside the Phase 1 analyzers.

### Files Created

| File | Purpose |
|------|---------|
| `src/core/analysis/side-effects/interfaces.ts` | Interface definitions |
| `src/core/analysis/side-effects/detector.ts` | `SideEffectAnalyzer` implementation |
| `src/core/analysis/side-effects/categorizer.ts` | `SideEffectCategorizer` with 80+ patterns |
| `src/core/analysis/side-effects/index.ts` | Module exports |

### MCP Tools Available

| Tool | Description |
|------|-------------|
| `get_side_effects` | Get side effects for a function with summary |

---

## Phase 4: Design Pattern Detection - IMPLEMENTED

Phase 4 has been fully implemented and integrated into the indexing pipeline.

### Files Created

| File | Purpose |
|------|---------|
| `src/core/analysis/patterns/interfaces.ts` | All type definitions and interfaces |
| `src/core/analysis/patterns/service.ts` | `PatternAnalysisService` orchestrator |
| `src/core/analysis/patterns/uce-converter.ts` | UCE-to-PatternContext converter |
| `src/core/analysis/patterns/detectors/base-detector.ts` | `BasePatternDetector` abstract class |
| `src/core/analysis/patterns/detectors/factory-detector.ts` | Factory pattern detector |
| `src/core/analysis/patterns/detectors/singleton-detector.ts` | Singleton pattern detector |
| `src/core/analysis/patterns/detectors/observer-detector.ts` | Observer/Pub-Sub detector |
| `src/core/analysis/patterns/detectors/repository-detector.ts` | Repository pattern detector |
| `src/core/analysis/patterns/detectors/service-detector.ts` | Service pattern detector |
| `src/core/analysis/patterns/detectors/builder-detector.ts` | Builder pattern detector |
| `src/core/analysis/patterns/detectors/strategy-detector.ts` | Strategy pattern detector |
| `src/core/analysis/patterns/detectors/decorator-detector.ts` | Decorator pattern detector |
| `src/core/analysis/patterns/detectors/index.ts` | Detector exports |
| `src/core/analysis/patterns/index.ts` | Module exports |

### Pipeline Integration

Pattern detection runs automatically during indexing when `enablePatternDetection: true` is set. The `IndexerCoordinator` calls `PatternAnalysisService` after semantic analysis and before writing to the database.

**Integration flow:**
1. Parse file → UCEFile (classes, functions, interfaces)
2. Extract entities → CozoBatch
3. Semantic analysis (if enabled) → Phase 1-3 results
4. **Pattern detection (if enabled) → Phase 4 results**
5. Write to database

The `convertUCEToPatternContext()` function bridges UCE entities with the pattern analysis context format.

### Schema (v9)

```datalog
:create design_pattern {
  id: String,
  =>
  pattern_type: String,
  name: String,
  confidence: Float,
  confidence_level: String,
  evidence_json: Json,
  file_paths_json: Json,
  description: String?,
  detected_at: Int
}

:create pattern_participant {
  id: String,
  =>
  pattern_id: String,
  entity_id: String,
  role: String,
  entity_type: String,
  entity_name: String,
  file_path: String,
  evidence_json: Json
}

:create has_pattern {
  from_id: String,
  to_id: String,
  =>
  role: String
}

:create pattern_has_participant {
  from_id: String,
  to_id: String
}
```

### MCP Tools Available

| Tool | Description |
|------|-------------|
| `find_patterns` | Find design patterns with optional filtering by type, confidence, file |
| `get_pattern` | Get full details of a specific pattern by ID |

### Usage Example

```typescript
import {
  createPatternAnalysisService,
  convertUCEToPatternContext,
} from "./core/analysis/index.js";

// Create service
const patternService = createPatternAnalysisService({ minConfidence: 0.5 });

// Convert UCE entities to pattern context
const context = convertUCEToPatternContext(
  parsedFile.classes,
  parsedFile.functions,
  parsedFile.interfaces,
  fileId,
  filePath
);

// Run detection
const result = patternService.analyze(context);

console.log(`Found ${result.stats.totalPatterns} patterns:`);
for (const pattern of result.patterns) {
  console.log(`  ${pattern.patternType}: ${pattern.name} (${pattern.confidenceLevel})`);
}
```

### Architecture Notes

The pattern detection follows the **decoupling philosophy**:

1. **Interfaces first** - All detectors implement `IPatternDetector` interface
2. **No vendor lock-in** - Detectors work with generic `ClassInfo`, `FunctionInfo`, `InterfaceInfo` types
3. **Storage-agnostic** - Row types can be stored in any backend
4. **Heuristic-based** - Weighted confidence scoring with multiple signals
5. **Extensible** - New detectors can be registered via `registerDetector()`

### Detected Patterns

| Pattern | Heuristics | Typical Confidence |
|---------|------------|-------------------|
| Factory | `create*/make*/build*` methods, `new` keyword, polymorphic returns | High |
| Singleton | Private constructor, static `getInstance`, static instance property | High |
| Observer | `subscribe/unsubscribe`, `on/off`, `emit/dispatch` methods | High |
| Repository | CRUD methods (`find*/get*/create*/update*/delete*`), entity types | High |
| Service | `*Service` naming, constructor injection, stateless design | Medium |
| Builder | Method chaining returning `this`, `build()` method, fluent setters | High |
| Strategy | Single-method interface, multiple implementations, context class | Medium |
| Decorator | Wraps same interface, constructor with same-type parameter | Medium |

---

## Phase 5: Enhanced Business Justification - IMPLEMENTED

Phase 5 enhances the justification system by integrating Phase 1-4 analysis results into the LLM context, providing richer semantic information for better business value inference.

### Files Created/Modified

| File | Purpose |
|------|---------|
| `src/core/justification/models/justification.ts` | Added `EnhancedAnalysisContext` and related types |
| `src/core/justification/hierarchy/analysis-context-builder.ts` | **NEW**: Builds analysis context from Phase 1-4 results |
| `src/core/justification/hierarchy/context-propagator.ts` | Integrated `AnalysisContextBuilder` |
| `src/core/justification/prompts/justification-prompts.ts` | Added analysis context formatting in prompts |

### New Types

```typescript
// src/core/justification/models/justification.ts

interface SideEffectContext {
  totalCount: number;
  isPure: boolean;
  categories: string[];
  descriptions: string[];
  riskLevel: "low" | "medium" | "high";
}

interface ErrorBehaviorContext {
  canThrow: boolean;
  errorTypes: string[];
  allHandled: boolean;
  escapingErrorTypes: string[];
  summary: string;
}

interface DataFlowContext {
  isAnalyzed: boolean;
  isPure: boolean;
  inputsAffectingOutput: string[];
  accessesExternalState: boolean;
  summary: string;
}

interface PatternContext {
  patterns: Array<{
    patternType: string;
    role: string;
    patternName: string;
    confidenceLevel: "high" | "medium" | "low";
  }>;
}

interface EnhancedAnalysisContext {
  sideEffects?: SideEffectContext;
  errorBehavior?: ErrorBehaviorContext;
  dataFlow?: DataFlowContext;
  patterns?: PatternContext;
}
```

### JustificationContext Extension

The `JustificationContext` interface now includes an optional `analysisContext` field:

```typescript
interface JustificationContext {
  // ... existing fields ...

  /** Enhanced analysis context (Phase 1-4 results) */
  analysisContext?: EnhancedAnalysisContext;
}
```

### Integration Flow

1. **Context Building** (ContextPropagator.buildContext):
   - Standard context (parent, siblings, children, callers, callees)
   - **NEW**: Calls `AnalysisContextBuilder.buildContext()` in parallel

2. **Analysis Context Building** (AnalysisContextBuilder):
   - Queries Phase 3 side-effect summary from `function_side_effect_summary`
   - Queries Phase 1 error analysis from `function_error_analysis`
   - Queries Phase 2 data flow cache from `data_flow_cache`
   - Queries Phase 4 patterns from `has_pattern` + `design_pattern`

3. **Prompt Generation** (generateFunctionPrompt, generateClassPrompt):
   - Formats analysis context as "## Code Behavior Analysis" section
   - Includes side effects, error handling, data flow, design patterns
   - Adds task guidance to consider analysis in assessment

### Prompt Enhancement Example

Functions now receive enhanced prompts like:

```markdown
## Code Behavior Analysis

### Side Effects
- **Side effects detected**: 3
- **Risk level**: medium
- **Categories**: io-database, io-network
- **Details**:
  - Writes user data to database
  - Sends HTTP request to auth service

### Error Handling
- May throw ValidationError, AuthenticationError that propagate to callers
- **Error types**: ValidationError, AuthenticationError
- **Errors propagated to callers**: ValidationError, AuthenticationError

### Data Flow
- Accesses external state; output affected by: userId, sessionToken
- **Inputs affecting output**: userId, sessionToken

### Design Patterns
- **service** pattern: Role = `service` in "AuthService" (high confidence)
- **repository** pattern: Role = `dependency` in "UserRepository" (high confidence)

## Your Task
Analyze this function and determine:
1. What is the PURPOSE of this function?
2. What BUSINESS VALUE does it provide?
3. What FEATURE or domain does it belong to?
4. Consider the code behavior analysis above (side effects, error handling, data flow, patterns) in your assessment.
```

### Enabling Enhanced Justification Context

The enhanced analysis context is enabled by default. To disable:

```typescript
const propagator = new ContextPropagator(graphStore, {
  includeAnalysisContext: false,  // Disable Phase 5 enhancements
});
```

### Architecture Notes

The analysis context builder follows the **decoupling philosophy**:

1. **Interfaces first** - Uses existing Phase 1-4 schema types
2. **Non-blocking** - Analysis context fetching is parallel with other context
3. **Graceful degradation** - Missing analysis data returns undefined (no errors)
4. **Configurable** - Each analysis type can be enabled/disabled independently

### Benefits

| Before (Phases 1-4) | After (Phase 5) |
|---------------------|-----------------|
| LLM sees: code, parents, siblings, callers | LLM sees: code, parents, siblings, callers + **behavior analysis** |
| "Function does X" | "Function does X, has side effects (writes to DB), throws errors, participates in Repository pattern" |
| Context: structural | Context: structural + semantic + behavioral |
| Justification confidence: ~0.6 | Justification confidence: ~0.8 (projected)

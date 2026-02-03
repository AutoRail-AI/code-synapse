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

**Implementation Approach:**
1. Build SSA (Static Single Assignment) form from AST
2. Track assignments and transformations
3. Connect parameter inputs to return outputs
4. Store as graph in CozoDB

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

### Phase 3: Side-Effect Analysis (Critical for Understanding)

**Goal:** Identify and categorize side effects to understand what code actually *does* beyond its return value.

#### 3.1 Side-Effect Categories

```typescript
// src/core/analysis/side-effects/interfaces.ts
type SideEffectCategory =
  | 'io-file'           // File system operations
  | 'io-network'        // HTTP, WebSocket, etc.
  | 'io-database'       // DB queries
  | 'io-console'        // Logging, console output
  | 'mutation-param'    // Mutates input parameter
  | 'mutation-global'   // Mutates global/module state
  | 'mutation-this'     // Mutates object state
  | 'async-spawn'       // Spawns async operations
  | 'external-service'; // Calls external APIs

interface SideEffect {
  functionId: string;
  category: SideEffectCategory;
  description: string;
  target?: string;        // What is affected
  isConditional: boolean; // Only happens under certain conditions
  condition?: string;     // The condition
}
```

#### 3.2 Detection Strategies

| Category | Detection Method |
|----------|------------------|
| `io-file` | Detect `fs.*`, `readFile`, `writeFile`, `path.*` calls |
| `io-network` | Detect `fetch`, `axios`, `http.*`, WebSocket usage |
| `io-database` | Detect ORM calls, raw SQL, MongoDB operations |
| `mutation-param` | Track parameter modifications in body |
| `mutation-global` | Track assignments to module-level variables |
| `mutation-this` | Track `this.*` assignments in methods |

**Implementation:**
1. Create pattern matchers for each category
2. Analyze call expressions against known side-effect APIs
3. Track mutations through data flow analysis
4. Store categorized side effects

**Schema Addition:**
```datalog
:create side_effects {
  function_id: String,
  category: String,
  description: String,
  target: String?,
  is_conditional: Bool,
  condition: String?,
  =>
  confidence: Float,
  source_location: String
}
```

---

### Phase 4: Design Pattern Detection (Architectural Insights)

**Goal:** Automatically detect common design patterns to provide architectural context.

#### 4.1 Detectable Patterns

| Pattern | Detection Heuristics |
|---------|---------------------|
| **Factory** | Function returning new instances, multiple concrete types |
| **Singleton** | Private constructor, static getInstance, module-level instance |
| **Observer** | subscribe/unsubscribe methods, event emitter patterns |
| **Repository** | CRUD methods, entity type parameter, storage abstraction |
| **Service** | Stateless class, injected dependencies, business methods |
| **Adapter** | Implements interface, wraps another type, method delegation |
| **Builder** | Method chaining, build() method, partial construction |
| **Strategy** | Interface with single method, multiple implementations |
| **Decorator** | Wraps same interface, delegates with additions |

#### 4.2 Implementation

```typescript
// src/core/analysis/patterns/interfaces.ts
interface DetectedPattern {
  patternType: string;
  confidence: number;
  participants: {
    role: string;          // e.g., "factory", "product", "client"
    entityId: string;
    entityType: string;
  }[];
  evidence: string[];      // Why we think it's this pattern
}

// src/core/analysis/patterns/detectors/
// - factory-detector.ts
// - singleton-detector.ts
// - observer-detector.ts
// - repository-detector.ts
// etc.
```

**Schema Addition:**
```datalog
:create design_patterns {
  pattern_id: String,
  pattern_type: String,
  confidence: Float,
  evidence: [String],
  =>
  detected_at: Int
}

:create pattern_participants {
  pattern_id: String,
  entity_id: String,
  role: String,
  =>
  entity_type: String
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

### Immediate (Weeks 1-2): Foundation Enhancements

| Task | Effort | Impact |
|------|--------|--------|
| Parameter semantic analysis | 3 days | High |
| Return value analysis | 2 days | Medium |
| Error path extraction | 3 days | High |
| Schema migrations | 1 day | Required |

### Short-Term (Weeks 3-4): Data Flow

| Task | Effort | Impact |
|------|--------|--------|
| Intra-function data flow | 5 days | Critical |
| Cross-function data flow | 4 days | Critical |
| Data flow MCP tools | 2 days | High |

### Medium-Term (Weeks 5-6): Side Effects & Patterns

| Task | Effort | Impact |
|------|--------|--------|
| Side-effect detection | 4 days | High |
| Pattern detection (core 5) | 5 days | Medium |
| Pattern detection (extended) | 3 days | Medium |

### Long-Term (Weeks 7-8): Justification & Similarity

| Task | Effort | Impact |
|------|--------|--------|
| Enhanced justification context | 3 days | High |
| Domain-specific prompts | 2 days | Medium |
| Semantic similarity service | 4 days | Medium |
| Multi-vector embeddings | 3 days | Medium |

---

## New MCP Tools (Post-Implementation)

After implementation, expose these new capabilities:

| Tool | Purpose |
|------|---------|
| `trace_data_flow` | Trace data from source to sink |
| `get_side_effects` | List side effects of a function |
| `find_patterns` | Find design patterns in code |
| `get_error_paths` | Get error propagation paths |
| `find_similar_code` | Find semantically similar functions |
| `get_data_dependencies` | Get all data dependencies for a function |
| `explain_function_behavior` | Rich explanation with all analyses |

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

| Capability | Current | Target |
|------------|---------|--------|
| "What does this function do?" | ✅ Basic | ✅ Rich with data flow |
| "Where does this data go?" | ❌ No | ✅ Full trace |
| "What side effects does this have?" | ❌ No | ✅ Categorized |
| "What pattern is this?" | ❌ No | ✅ Detected |
| "What similar code exists?" | ❌ No | ✅ Semantic search |
| "What errors can this throw?" | ❌ No | ✅ Full paths |

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

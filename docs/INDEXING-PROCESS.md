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
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entityId: { type: "string" },
          purposeSummary: { type: "string" },
          businessValue: { type: "string" },
          featureContext: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          confidenceScore: { type: "number" }
        },
        required: ["entityId", "purposeSummary", "businessValue", "confidenceScore"]
      }
    }
  },
  required: ["entities"]
}
```

### Example LLM Response (`response.parsed`)
```json
{
  "entities": [
    {
      "entityId": "fn-getUserProfile-abc123",
      "purposeSummary": "Fetches complete user profile data including preferences and settings",
      "businessValue": "Core API for user profile display across dashboard and settings pages",
      "featureContext": "User Management",
      "tags": ["api", "user-profile", "data-fetching"],
      "confidenceScore": 0.85
    },
    {
      "entityId": "class-AuthService-def456",
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
┌─────────────────────────────────────────────────────────────┐
│                    TOKEN BUDGET CALCULATOR                  │
│  ─────────────────────────────────────────────────────────  │
│  Model: gemini-3-pro-preview                                │
│  Context Window: 1,000,000 tokens                           │
│  Max Output: 64,000 tokens                                  │
│  Reserve Buffer: 15%                                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
         ┌─────────────────────────────────────────┐
         │         CONSTRAINT CALCULATION          │
         │  ─────────────────────────────────────  │
         │  Input limit:  850K tokens              │
         │  Output limit: 64K tokens               │
         │                                         │
         │  Avg input per entity:  ~300 tokens     │
         │  Avg output per entity: ~150 tokens     │
         │                                         │
         │  Max by input:  850K / 300 = 2833       │
         │  Max by output: 64K / 150 = 426         │
         │                                         │
         │  ✓ Batch size = min(2833, 426) = 426    │
         │  → Typically ~50-100 for safety margin  │
         └─────────────────────────────────────────┘
```

### Batch Configuration
| Parameter | Value | Description |
|-----------|-------|-------------|
| `contextWindow` | 1,000,000 | Gemini 3 context limit |
| `maxOutputTokens` | 64,000 | Max response size |
| `outputTokensPerEntity` | ~150 | Estimated JSON per entity |
| `avgInputTokensPerEntity` | ~200-500 | Code + metadata |
| `reserveBuffer` | 15% | Safety margin |

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

# Part 3: Future Enhancements (To Be Implemented)

## Enhanced Justification Fields

The current schema captures *what* an entity does and *why* it exists. Future versions will add deeper business context:

### Proposed Additional Fields

```typescript
interface EnhancedEntityJustification extends EntityJustification {
  // User Impact
  userImpact?: string;           // Who benefits from this entity?
                                  // e.g., "Enables end-users to securely access accounts"
  
  // Dependency Analysis  
  dependencyRisk?: "low" | "medium" | "high" | "critical";
  dependentCount?: number;        // Number of entities that depend on this
  breakageImpact?: string[];      // Features that would break if removed
                                  // e.g., ["login-flow", "session-management", "api-auth"]
  
  // Business Metrics
  usageFrequency?: "rare" | "occasional" | "frequent" | "critical-path";
  businessCriticality?: number;   // 0.0 - 1.0 score
  
  // Design Rationale
  alternativesConsidered?: string; // Why this approach over others?
                                   // e.g., "Chosen over OAuth-only for enterprise SSO flexibility"
  
  // Change Risk Assessment
  changeRiskLevel?: "low" | "medium" | "high" | "requires-review";
  securityBoundary?: boolean;     // Does this touch security-sensitive code?
  complianceRelevant?: boolean;   // Affects regulatory compliance?
}
```

### Current vs. Future Comparison

| Dimension | Current (v1) | Future (v2) |
|-----------|--------------|-------------|
| **What it does** | ✅ `purposeSummary` | ✅ Same |
| **Why it exists** | ✅ `businessValue` | ✅ Enhanced with metrics |
| **Who benefits** | ❌ Not captured | ✅ `userImpact` |
| **What breaks if removed** | ❌ Not captured | ✅ `breakageImpact`, `dependentCount` |
| **How risky to change** | ❌ Not captured | ✅ `changeRiskLevel`, `securityBoundary` |
| **Why this design** | ❌ Not captured | ✅ `alternativesConsidered` |
| **Business criticality** | Implicit via confidence | ✅ Explicit `businessCriticality` |

### Example Enhanced Justification

```json
{
  "entityId": "class-AuthService-def456",
  "name": "AuthService",
  
  // Current fields
  "purposeSummary": "Centralized authentication service handling login, logout, and token management",
  "businessValue": "Single source of truth for auth state, enables secure session handling",
  "featureContext": "Authentication",
  "tags": ["auth", "security", "session-management"],
  "confidenceScore": 0.92,
  
  // Future fields (v2)
  "userImpact": "Enables all users to securely access their accounts and maintain sessions",
  "dependencyRisk": "critical",
  "dependentCount": 47,
  "breakageImpact": ["login-flow", "session-refresh", "api-authentication", "admin-panel"],
  "usageFrequency": "critical-path",
  "businessCriticality": 0.95,
  "alternativesConsidered": "OAuth-only rejected for enterprise SSO requirements; Firebase Auth rejected for data sovereignty",
  "changeRiskLevel": "requires-review",
  "securityBoundary": true,
  "complianceRelevant": true
}
```

### Implementation Considerations

| Enhancement | Source | LLM Cost Impact |
|-------------|--------|-----------------|
| `userImpact` | LLM inference | +15 tokens/entity |
| `dependencyRisk` | Static graph analysis | None (computed) |
| `dependentCount` | Static graph query | None (computed) |
| `breakageImpact` | Graph traversal + LLM | +30 tokens/entity |
| `usageFrequency` | Runtime telemetry | None (external data) |
| `businessCriticality` | LLM + usage data | +10 tokens/entity |
| `alternativesConsidered` | LLM + doc comments | +40 tokens/entity |
| `changeRiskLevel` | LLM + dependency analysis | +15 tokens/entity |
| `securityBoundary` | Static pattern matching | None (computed) |

### Phased Rollout Plan

**Phase 1 (Current)**: Basic justification with `purposeSummary`, `businessValue`, `featureContext`

**Phase 2**: Add dependency-based fields (computed from graph):
- `dependentCount`
- `dependencyRisk`
- `breakageImpact`

**Phase 3**: Add LLM-inferred business context:
- `userImpact`
- `businessCriticality`
- `alternativesConsidered`

**Phase 4**: Add change risk assessment:
- `changeRiskLevel`
- `securityBoundary`
- `complianceRelevant`

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

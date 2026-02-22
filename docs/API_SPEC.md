# Code-Synapse API Specification

This document describes every API surface exposed by Code-Synapse:

1. **MCP Tools** — invoked by AI agents via the Model Context Protocol (stdio transport)
2. **MCP Resources** — read-only data accessible via MCP resource URIs
3. **REST API** — HTTP endpoints served by the Web Viewer (`code-synapse viewer`)

---

## Table of Contents

- [MCP Tools (36 total)](#mcp-tools)
  - [Search & Discovery](#1-search--discovery)
  - [Entity Inspection](#2-entity-inspection)
  - [Dependency & Relationship Analysis](#3-dependency--relationship-analysis)
  - [Semantic Analysis](#4-semantic-analysis)
  - [Design Pattern Detection](#5-design-pattern-detection)
  - [Change Notification & Indexing](#6-change-notification--indexing)
  - [Prompt & Generation Context](#7-prompt--generation-context)
  - [Lazarus Migration Tools](#8-lazarus-migration-tools)
  - [Vibe Coding Tools](#9-vibe-coding-tools)
- [MCP Resources](#mcp-resources)
- [REST API](#rest-api)
  - [Health](#rest-health)
  - [Statistics](#rest-statistics)
  - [Files](#rest-files)
  - [Entities](#rest-entities)
  - [Functions](#rest-functions)
  - [Classes](#rest-classes)
  - [Interfaces](#rest-interfaces)
  - [Search](#rest-search)
  - [Graph](#rest-graph)
  - [Justifications](#rest-justifications)
  - [Classifications](#rest-classifications)
  - [Ledger](#rest-ledger)
  - [Adaptive Indexing](#rest-adaptive-indexing)
  - [Memory](#rest-memory)
  - [Compaction](#rest-compaction)
  - [Reconciliation](#rest-reconciliation)
  - [Operations](#rest-operations)
  - [Semantic Analysis (MCP)](#rest-semantic-analysis)
  - [Design Patterns (MCP)](#rest-design-patterns)
  - [Operations — MCP Tools](#rest-operations-mcp)
  - [Lazarus Migration (MCP)](#rest-lazarus-migration)
  - [Entity Tagging (MCP)](#rest-entity-tagging)
  - [Vibe Coding Sessions (MCP)](#rest-vibe-coding-sessions)

---

## MCP Tools

All MCP tools return `{ content: [{ type: "text", text: "<JSON>" }] }`. The JSON payloads are documented below. Tools that modify state include `isError: true` on failure.

### 1. Search & Discovery

#### `search_code`

Search for code entities by name or pattern. When hybrid search is available, returns enriched results with justification, patterns, and classification.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | `string` | Yes | — | Search query string |
| `limit` | `number` | No | `10` | Maximum results |
| `entityType` | `"function" \| "class" \| "interface" \| "variable" \| "file"` | No | all | Filter by entity type |

**Output** — `SearchResult[]`:

```json
[
  {
    "id": "fn_abc123",
    "name": "createParser",
    "type": "function",
    "filePath": "/src/core/parser/index.ts",
    "line": 42,
    "signature": "createParser(config: ProjectConfig): Parser",
    "docComment": "Creates a new parser instance",
    "entityType": "function",
    "entityId": "fn_abc123",
    "source": "semantic",
    "justification": {
      "purposeSummary": "Factory function for parser creation",
      "featureContext": "Code Parsing",
      "businessValue": "Enables multi-language AST parsing",
      "confidence": 0.92
    },
    "patterns": ["factory"],
    "classification": { "category": "Infrastructure", "subCategory": "Parsing" }
  }
]
```

---

#### `search_code_exact`

Exact/regex code search using Zoekt. Returns file paths and matching lines with entity resolution.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | `string` | Yes | — | Search query (literal or regex) |
| `filePattern` | `string` | No | — | File glob pattern to restrict search |
| `limit` | `number` | No | `20` | Maximum results |

**Output** — Zoekt search result with entity annotations:

```json
{
  "results": [
    {
      "fileName": "src/core/parser/index.ts",
      "lineMatches": [
        {
          "lineNumber": 42,
          "line": "export function createParser(config: ProjectConfig): Parser {",
          "entityId": "fn_abc123",
          "entityName": "createParser",
          "entityType": "function"
        }
      ]
    }
  ],
  "totalMatches": 3
}
```

**Requires**: Zoekt (`scripts/setup-zoekt.sh`). Returns error message if unavailable.

---

#### `hybrid_search`

Combined semantic + lexical search with optional AI synthesis.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | `string` | Yes | — | Natural language or exact phrase |
| `businessContext` | `string` | No | — | Feature/domain scope (e.g. `"Payments"`) |
| `limit` | `number` | No | `30` | Maximum total results |
| `enableSynthesis` | `boolean` | No | `false` | Generate AI answer summary |

**Output** — `HybridSearchResponse`:

```json
{
  "results": [
    {
      "entityId": "fn_abc",
      "name": "validatePayment",
      "entityType": "function",
      "filePath": "src/payments/validator.ts",
      "lineNumber": 15,
      "snippet": "export async function validatePayment(...)",
      "source": "both",
      "score": 0.87,
      "justification": {
        "purposeSummary": "Validates payment requests",
        "featureContext": "Payment Processing",
        "businessValue": "Ensures payment integrity",
        "confidence": 0.95
      },
      "patterns": ["service"]
    }
  ],
  "synthesis": "The payment validation flow starts with...",
  "meta": {
    "intent": "question",
    "semanticCount": 15,
    "lexicalCount": 10,
    "totalBeforeMerge": 25,
    "timingMs": { "semantic": 45, "lexical": 12, "merge": 3, "synthesis": 200 }
  }
}
```

**Requires**: Embeddings + Zoekt.

---

#### `find_similar_code`

Find semantically similar code using vector embeddings.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `entityId` | `string` | No | — | Entity ID to find similar code for |
| `text` | `string` | No | — | Natural language description |
| `limit` | `number` | No | `10` | Maximum results |
| `minSimilarity` | `number` | No | `0.5` | Similarity threshold (0.0–1.0) |
| `entityTypes` | `string[]` | No | all | Filter: `"function"`, `"class"`, `"interface"`, `"method"` |
| `filePathPattern` | `string` | No | — | File path regex filter |

Provide **either** `entityId` or `text`, not both.

**Output** — `FindSimilarCodeResult`:

```json
{
  "results": [
    {
      "entityId": "fn_xyz",
      "entityType": "function",
      "name": "parseConfig",
      "filePath": "src/utils/config.ts",
      "similarity": 0.89,
      "signature": "parseConfig(raw: string): Config",
      "description": "Parses raw configuration string"
    }
  ],
  "query": { "type": "text", "value": "parse configuration" },
  "stats": { "total": 5, "avgSimilarity": 0.82, "searchTimeMs": 34 }
}
```

---

### 2. Entity Inspection

#### `get_function`

Get detailed information about a function.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Function name |
| `filePath` | `string` | No | — | File path to narrow search |

**Output** — `FunctionDetails`:

```json
{
  "id": "fn_abc123",
  "name": "createParser",
  "filePath": "/src/core/parser/index.ts",
  "startLine": 42,
  "endLine": 55,
  "signature": "createParser(config: ProjectConfig): Parser",
  "returnType": "Parser",
  "isExported": true,
  "isAsync": false,
  "docComment": "Creates a new parser instance",
  "complexity": 3,
  "callers": [{ "name": "initIndexer", "filePath": "src/core/indexer/index.ts", "line": 18 }],
  "callees": [{ "name": "Parser", "filePath": "src/core/parser/parser.ts", "line": 10 }],
  "justification": {
    "purposeSummary": "Factory for parser creation",
    "featureArea": "Code Parsing",
    "confidence": 0.92
  }
}
```

Returns `isError: true` with `"Function not found"` when no match.

---

#### `get_class`

Get detailed information about a class.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Class name |
| `filePath` | `string` | No | — | File path to narrow search |

**Output** — `ClassDetails`:

```json
{
  "id": "cls_abc123",
  "name": "CozoGraphStore",
  "filePath": "/src/core/graph/cozo-graph-store.ts",
  "startLine": 88,
  "endLine": 357,
  "isExported": true,
  "isAbstract": false,
  "extendsClass": "",
  "implementsInterfaces": ["IGraphStore"],
  "docComment": "CozoDB implementation of IGraphStore",
  "methods": [
    { "name": "initialize", "signature": "initialize(): Promise<void>", "visibility": "public" },
    { "name": "query", "signature": "query<T>(script: string, params?): Promise<QueryResult<T>>", "visibility": "public" }
  ],
  "justification": {
    "purposeSummary": "Graph + vector storage adapter for CozoDB",
    "featureArea": "Data Layer",
    "confidence": 0.95
  }
}
```

---

#### `get_file_symbols`

Get all symbols defined in a file.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `filePath` | `string` | Yes | — | File path (relative or absolute) |

**Output** — `FileSymbols`:

```json
{
  "filePath": "/src/core/parser/index.ts",
  "functions": [{ "name": "createParser", "line": 42, "signature": "createParser(config): Parser" }],
  "classes": [{ "name": "Parser", "line": 10 }],
  "interfaces": [{ "name": "ParserOptions", "line": 5 }],
  "variables": [{ "name": "DEFAULT_TIMEOUT", "line": 3, "isConst": true }]
}
```

---

#### `get_project_stats`

Get aggregate project statistics.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| *(none)* | — | — | — | — |

**Output**:

```json
{
  "files": 273,
  "functions": 3010,
  "classes": 136,
  "interfaces": 774,
  "variables": 520
}
```

---

### 3. Dependency & Relationship Analysis

#### `get_callers`

Get all functions that call a specific function (1-hop).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `functionName` | `string` | Yes | — | Function name |

**Output** — `Array<{ name, filePath, line }>`:

```json
[
  { "name": "initIndexer", "filePath": "src/core/indexer/index.ts", "line": 18 }
]
```

---

#### `get_callees`

Get all functions called by a specific function (1-hop).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `functionName` | `string` | Yes | — | Function name |

**Output** — Same shape as `get_callers`.

---

#### `get_dependencies`

Get file-level import/imported-by relationships.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `filePath` | `string` | Yes | — | File path |

**Output** — `FileDependency`:

```json
{
  "filePath": "/src/core/parser/index.ts",
  "imports": [
    { "from": "/src/types/index.ts", "symbols": ["ProjectConfig", "Symbol"] }
  ],
  "importedBy": [
    { "from": "/src/core/indexer/index.ts", "symbols": ["createParser"] }
  ]
}
```

---

### 4. Semantic Analysis

#### `get_function_semantics`

Deep semantic analysis of a function — parameters, return values, error handling.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Function name |
| `filePath` | `string` | No | — | File path to narrow search |

**Output** — `FunctionSemanticsResult`:

```json
{
  "functionId": "fn_abc",
  "functionName": "createParser",
  "filePath": "src/core/parser/index.ts",
  "parameters": [
    {
      "name": "config",
      "index": 0,
      "type": "ProjectConfig",
      "purpose": "Configuration for parser initialization",
      "isOptional": false,
      "isRest": false,
      "isDestructured": false,
      "defaultValue": null,
      "isMutated": false,
      "confidence": 0.9
    }
  ],
  "returnSemantics": {
    "declaredType": "Parser",
    "inferredType": "Parser",
    "canReturnVoid": false,
    "alwaysThrows": false,
    "possibleValues": [],
    "nullConditions": [],
    "errorConditions": ["Invalid config throws Error"],
    "confidence": 0.85
  },
  "errorAnalysis": {
    "neverThrows": false,
    "hasTopLevelCatch": false,
    "escapingErrorTypes": ["Error"],
    "throwPoints": 1,
    "tryCatchBlocks": 0,
    "confidence": 0.8
  }
}
```

---

#### `get_error_paths`

Get error propagation paths for a function.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `functionName` | `string` | Yes | — | Function name |
| `filePath` | `string` | No | — | File path to narrow search |

**Output** — `ErrorPathsResult`:

```json
{
  "functionId": "fn_abc",
  "functionName": "parseFile",
  "filePath": "src/core/parser/index.ts",
  "errorPaths": [
    {
      "id": "ep_001",
      "errorType": "SyntaxError",
      "condition": "Invalid AST node",
      "isHandled": true,
      "handlingStrategy": "try-catch with fallback",
      "recoveryAction": "Return empty parse result",
      "propagatesTo": [],
      "sourceLocation": { "line": 55, "column": 8 },
      "confidence": 0.88
    }
  ]
}
```

---

#### `get_data_flow`

Get data flow analysis — purity, taint tracking, side effects.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `functionName` | `string` | Yes | — | Function name |
| `filePath` | `string` | No | — | File path to narrow search |
| `includeFullGraph` | `boolean` | No | `false` | Include full node/edge graph |

**Output** — `DataFlowResult`:

```json
{
  "functionId": "fn_abc",
  "functionName": "transform",
  "filePath": "src/utils/transform.ts",
  "summary": {
    "nodeCount": 12,
    "edgeCount": 15,
    "hasSideEffects": false,
    "accessesExternalState": false,
    "isPure": true,
    "inputsAffectingOutput": ["data", "options"],
    "confidence": 0.91
  },
  "fullGraph": null,
  "taintFlows": [],
  "fromCache": true
}
```

---

#### `get_side_effects`

Get side effects analysis — I/O, mutations, async operations.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `functionName` | `string` | Yes | — | Function name |
| `filePath` | `string` | No | — | File path to narrow search |
| `categories` | `string[]` | No | all | Filter: `"io-file"`, `"io-network"`, `"mutation-this"`, etc. |
| `minConfidence` | `"high" \| "medium" \| "low"` | No | all | Minimum confidence |

**Output** — `SideEffectResult`:

```json
{
  "functionId": "fn_abc",
  "functionName": "writeConfig",
  "filePath": "src/utils/config.ts",
  "summary": {
    "totalCount": 2,
    "isPure": false,
    "allConditional": false,
    "primaryCategories": ["io-file"],
    "riskLevel": "medium",
    "confidence": 0.88
  },
  "sideEffects": [
    {
      "id": "se_001",
      "category": "io-file",
      "description": "Writes config to disk via fs.writeFileSync",
      "target": "/path/to/config.json",
      "apiCall": "fs.writeFileSync",
      "isConditional": false,
      "condition": null,
      "confidence": "high",
      "location": { "line": 22, "column": 4 }
    }
  ]
}
```

---

### 5. Design Pattern Detection

#### `find_patterns`

Find design patterns across the codebase.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `patternType` | `"factory" \| "singleton" \| "observer" \| "repository" \| "service" \| "adapter" \| "builder" \| "strategy" \| "decorator"` | No | all | Filter by pattern |
| `minConfidence` | `number` | No | `0.5` | Threshold (0.0–1.0) |
| `filePath` | `string` | No | — | Scope to a file |
| `limit` | `number` | No | `20` | Maximum results |

**Output** — `FindPatternsResult`:

```json
{
  "patterns": [
    {
      "id": "pat_001",
      "patternType": "factory",
      "name": "ParserFactory",
      "confidence": 0.92,
      "confidenceLevel": "high",
      "description": "Factory function pattern for parser creation",
      "filePaths": ["src/core/parser/index.ts"],
      "evidence": ["Creates and returns new instance", "Named create*"],
      "participants": [
        {
          "role": "factory",
          "entityName": "createParser",
          "entityType": "function",
          "filePath": "src/core/parser/index.ts",
          "evidence": ["Returns new Parser instance"]
        }
      ]
    }
  ],
  "stats": {
    "total": 12,
    "byType": { "factory": 5, "service": 4, "repository": 3 },
    "highConfidence": 8,
    "mediumConfidence": 3,
    "lowConfidence": 1
  }
}
```

---

#### `get_pattern`

Get details of a specific pattern by ID.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `patternId` | `string` | Yes | — | Pattern ID |

**Output** — Single `PatternResult` (same shape as items in `find_patterns`).

---

### 6. Change Notification & Indexing

#### `notify_file_changed`

Notify the knowledge graph about a file change. Triggers incremental re-indexing.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `filePath` | `string` | Yes | — | Changed file path |
| `changeType` | `"created" \| "modified" \| "deleted" \| "renamed"` | Yes | — | Type of change |
| `previousPath` | `string` | No | — | Previous path (for renames) |
| `changeDescription` | `string` | No | — | Description of what changed |
| `aiGenerated` | `boolean` | No | `true` | Whether AI-generated |

**Output** — `NotifyFileChangedResult`:

```json
{
  "acknowledged": true,
  "reindexQueued": true,
  "message": "File modified notification received for src/utils/config.ts"
}
```

**Ledger**: Tracked via observer.

---

#### `request_reindex`

Request re-indexing of specific files or patterns.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `paths` | `string[]` | Yes | — | File paths or glob patterns |
| `reason` | `string` | No | — | Why re-indexing is needed |
| `priority` | `"low" \| "normal" \| "high" \| "immediate"` | No | `"normal"` | Priority level |

**Output** — `RequestReindexResult`:

```json
{
  "requestId": "reindex_1700000000_abc1234",
  "queued": 3,
  "message": "Queued 3 items for reindexing"
}
```

**Ledger**: Tracked via observer.

---

### 7. Prompt & Generation Context

#### `enhance_prompt`

Enhance a user prompt with relevant codebase context before code generation.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | `string` | Yes | — | Original prompt |
| `targetFile` | `string` | No | — | Target file path |
| `taskType` | `"create" \| "modify" \| "refactor" \| "fix" \| "document" \| "test"` | No | `"modify"` | Task type |
| `includeContext` | `boolean` | No | `true` | Include related code context |
| `maxContextTokens` | `number` | No | `2000` | Maximum context tokens |

**Output** — `EnhancePromptResult`:

```json
{
  "enhancedPrompt": "Add email validation...\n\n---\nCodebase Context:\nRelated code: createUser (function)...",
  "addedContext": {
    "relatedFiles": ["src/auth/user.ts"],
    "relatedEntities": [{ "name": "createUser", "type": "function", "filePath": "src/auth/user.ts" }],
    "projectPatterns": ["Interface-driven design"],
    "relevantJustifications": ["createUser: Handles user registration and validation"]
  },
  "suggestions": [
    "Ensure backward compatibility if this is a public API",
    "Update related tests if behavior changes"
  ]
}
```

**Ledger**: Tracked via observer.

---

#### `create_generation_context`

Create justification and context after code generation. Records to change ledger.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `originalPrompt` | `string` | Yes | — | Prompt used for generation |
| `affectedFiles` | `Array<{filePath, changeType, summary?}>` | Yes | — | Files affected |
| `sessionId` | `string` | No | — | Session ID for grouping |
| `generationNotes` | `string` | No | — | Additional notes |

`affectedFiles[].changeType`: `"created" | "modified"`

**Output** — `CreateGenerationContextResult`:

```json
{
  "contextId": "gen_1700000000_abc1234",
  "justification": {
    "summary": "Code generation based on: \"Add email validation...\"",
    "businessValue": "Implements user request: Add email validation to user registration",
    "impactedAreas": ["src/auth/validator.ts"],
    "tags": ["ai-generated", "email", "validation"]
  },
  "ledgerEntryId": "led_abc123",
  "reindexQueued": ["src/auth/validator.ts"]
}
```

**Ledger**: Always recorded when ledger is available.

---

### 8. Lazarus Migration Tools

#### `get_entity_source`

Get the actual source code of any entity. Reads the file from disk.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `entityId` | `string` | No | — | Entity ID (preferred) |
| `name` | `string` | No | — | Entity name (fallback) |
| `filePath` | `string` | No | — | File path to narrow search |
| `entityType` | `"function" \| "class" \| "interface" \| "variable"` | No | all | Filter by type |
| `contextLines` | `number` | No | `0` | Extra lines above/below |

Provide at least one of `entityId` or `name`.

**Output** — `EntitySourceResult`:

```json
{
  "entityId": "fn_abc123",
  "name": "createParser",
  "entityType": "function",
  "filePath": "/src/core/parser/index.ts",
  "startLine": 42,
  "endLine": 55,
  "language": "typescript",
  "sourceCode": "42: export function createParser(config: ProjectConfig): Parser {\n43:   return new Parser(config);\n...",
  "lineCount": 14
}
```

---

#### `get_feature_map`

Get a map of all features/business domains, grouped by `feature_context` from the justification table.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `featureContext` | `string` | No | — | Filter by feature name (substring match) |
| `includeEntities` | `boolean` | No | `false` | Include entity list per feature |
| `limit` | `number` | No | `50` | Maximum features |

**Output** — `FeatureMapResult`:

```json
{
  "features": [
    {
      "name": "Code Parsing",
      "entityCount": 28,
      "fileCount": 6,
      "files": ["src/core/parser/index.ts", "src/core/parser/parser.ts"],
      "breakdown": { "functions": 20, "classes": 3, "interfaces": 5, "variables": 0 },
      "entities": [
        {
          "id": "fn_abc",
          "name": "createParser",
          "type": "function",
          "filePath": "src/core/parser/index.ts",
          "purposeSummary": "Factory for parser creation"
        }
      ]
    }
  ],
  "totalFeatures": 12,
  "totalEntities": 340
}
```

`entities` is only present when `includeEntities=true`.

---

#### `get_migration_context`

Build a **Code Contract** for a feature slice — the complete context needed to migrate a feature.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `featureContext` | `string` | No | — | Resolve entities by feature name |
| `entityIds` | `string[]` | No | — | Explicit entity list (alternative) |
| `includeSource` | `boolean` | No | `false` | Include source code per entity |
| `includeDataFlow` | `boolean` | No | `false` | Include data flow summaries |
| `includeSideEffects` | `boolean` | No | `false` | Include side effects |

Provide **either** `featureContext` or `entityIds`.

**Output** — `MigrationContextResult`:

```json
{
  "entities": [
    {
      "id": "fn_abc",
      "name": "validatePayment",
      "type": "function",
      "filePath": "src/payments/validator.ts",
      "startLine": 10,
      "endLine": 45,
      "signature": "validatePayment(req: PaymentRequest): ValidationResult",
      "sourceCode": "...(if includeSource)",
      "justification": {
        "purposeSummary": "Validates payment request fields",
        "businessValue": "Prevents invalid payment submissions",
        "featureContext": "Payment Processing",
        "confidence": 0.93
      },
      "sideEffects": [
        { "category": "io-network", "description": "Calls fraud detection API", "target": "fraud-api" }
      ],
      "dataFlow": { "isPure": false, "summary": "{...}" }
    }
  ],
  "internalDependencies": [
    { "fromId": "fn_abc", "fromName": "validatePayment", "toId": "fn_def", "toName": "checkFraud", "type": "calls" }
  ],
  "externalDependencies": [
    { "entityId": "fn_abc", "entityName": "validatePayment", "externalName": "axios.post", "externalFile": "axios", "type": "external_reference" }
  ],
  "businessRules": [
    { "entityName": "validatePayment", "rule": "Prevents invalid payment submissions", "confidence": 0.93 }
  ],
  "patterns": [
    { "patternType": "service", "name": "PaymentService", "participants": ["validatePayment", "processPayment"] }
  ],
  "stats": {
    "entityCount": 8,
    "fileCount": 3,
    "internalCallCount": 12,
    "externalDepCount": 4
  }
}
```

---

#### `analyze_blast_radius`

Multi-hop BFS impact analysis. Traces callers/callees up to N hops.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `entityId` | `string` | Yes | — | Entity ID to analyze |
| `maxDepth` | `number` | No | `3` | Maximum traversal depth |
| `direction` | `"callers" \| "callees" \| "both"` | No | `"callers"` | Traversal direction |

**Output** — `BlastRadiusResult`:

```json
{
  "root": { "id": "fn_abc", "name": "validatePayment", "type": "function", "filePath": "src/payments/validator.ts" },
  "maxDepth": 3,
  "direction": "callers",
  "hops": [
    {
      "depth": 1,
      "entities": [
        { "id": "fn_def", "name": "processOrder", "type": "function", "filePath": "src/orders/processor.ts", "relationship": "calls", "via": "fn_abc" }
      ]
    },
    {
      "depth": 2,
      "entities": [
        { "id": "fn_ghi", "name": "handleCheckout", "type": "function", "filePath": "src/routes/checkout.ts", "relationship": "calls", "via": "fn_def" }
      ]
    }
  ],
  "summary": {
    "totalAffected": 5,
    "affectedFiles": ["src/orders/processor.ts", "src/routes/checkout.ts", "src/payments/validator.ts"],
    "byType": { "function": 5 }
  }
}
```

---

#### `get_entity_tests`

Find test files that cover a given entity by checking imports, name references, and path conventions.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `entityId` | `string` | No | — | Entity ID |
| `name` | `string` | No | — | Entity name |
| `filePath` | `string` | No | — | File path |

**Output** — `EntityTestsResult`:

```json
{
  "entityId": "fn_abc",
  "entityName": "createParser",
  "filePath": "src/core/parser/index.ts",
  "testFiles": [
    {
      "path": "src/core/parser/__tests__/parser.test.ts",
      "matchType": "import",
      "relevantLines": [
        { "lineNumber": 3, "content": "import { createParser } from '../index.js';" },
        { "lineNumber": 15, "content": "const parser = createParser(config);" }
      ]
    }
  ],
  "coverageEstimate": "high"
}
```

`matchType`:
- `"import"` — file imports the entity's module AND references its name (highest confidence)
- `"nameReference"` — file references the entity name but doesn't import its module
- `"pathConvention"` — file matches by naming convention only (e.g. `foo.test.ts` for `foo.ts`)

`coverageEstimate`: `"high"` (import+name), `"medium"` (name only), `"low"` (convention only), `"none"` (no test files found).

---

#### `tag_entity`

Add migration tags to an entity. Tags persist in the `entity_tag` relation.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `entityId` | `string` | Yes | — | Entity ID to tag |
| `tags` | `string[]` | Yes | — | Tags to add (e.g. `["legacy", "migrating"]`) |
| `source` | `string` | No | `"user"` | Who/what added the tag |

**Output** — `TagEntityResult`:

```json
{
  "entityId": "fn_abc",
  "tags": ["legacy", "migrating"],
  "added": 2,
  "message": "Added 2 tag(s) to entity fn_abc"
}
```

**Ledger**: Tracked via observer (write operation).

---

#### `get_tagged_entities`

Find all entities with a specific tag.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tag` | `string` | Yes | — | Tag to search for |
| `entityType` | `"function" \| "class" \| "interface" \| "variable" \| "file"` | No | all | Filter by type |

**Output** — `GetTaggedResult`:

```json
{
  "tag": "legacy",
  "entities": [
    {
      "id": "fn_abc",
      "name": "oldPaymentHandler",
      "type": "function",
      "filePath": "src/payments/legacy.ts",
      "tags": ["legacy", "deprecated"],
      "source": "lazarus-agent"
    }
  ],
  "count": 1
}
```

---

#### `remove_entity_tags`

Remove specific tags from an entity.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `entityId` | `string` | Yes | — | Entity ID |
| `tags` | `string[]` | Yes | — | Tags to remove |

**Output** — `RemoveEntityTagsResult`:

```json
{
  "entityId": "fn_abc",
  "removed": 1,
  "message": "Removed 1 tag(s) from entity fn_abc"
}
```

**Ledger**: Tracked via observer (write operation).

---

#### `resolve_entity_at_location`

Resolve which code entity exists at a specific file path and line number. Essential for the self-healing diagnosis engine to go from test error locations to knowledge graph entities.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `filePath` | `string` | Yes | — | File path (relative or absolute) |
| `line` | `number` | Yes | — | Line number to resolve |

**Output** — `ResolveEntityAtLocationResult`:

```json
{
  "entityId": "fn_abc123",
  "name": "calculateTax",
  "entityType": "function",
  "filePath": "src/lib/checkout.ts",
  "startLine": 10,
  "endLine": 18,
  "language": "typescript",
  "signature": "calculateTax(amount: number): number",
  "justification": {
    "purposeSummary": "Calculates tax at configured rate",
    "featureContext": "Checkout",
    "businessValue": "Applies tax rules to order totals",
    "confidence": 0.91
  }
}
```

Returns `isError: true` with `"No entity found at the specified location"` when no match.

---

#### `get_migration_progress`

Get migration progress aggregated by feature. Shows tag counts per feature and overall, with progress percentages. Powers the Glass Brain Dashboard confidence display.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `featureContext` | `string` | No | — | Filter to a specific feature (substring match) |
| `tags` | `string[]` | No | all | Filter to specific tags |

**Output** — `MigrationProgressResult`:

```json
{
  "features": [
    {
      "name": "Payment Processing",
      "totalEntities": 28,
      "taggedEntities": 20,
      "tags": { "legacy": 5, "migrating": 8, "migrated": 7 },
      "progressPercent": 71
    },
    {
      "name": "User Authentication",
      "totalEntities": 15,
      "taggedEntities": 15,
      "tags": { "migrated": 15 },
      "progressPercent": 100
    }
  ],
  "overall": {
    "totalEntities": 43,
    "taggedEntities": 35,
    "tags": { "legacy": 5, "migrating": 8, "migrated": 22 },
    "progressPercent": 81
  }
}
```

---

#### `get_slice_dependencies`

Compute inter-feature dependency ordering for migration slice planning. Analyzes cross-feature function calls to determine which features depend on which, and returns a topological execution order with circular dependency detection.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `features` | `string[]` | No | all | Filter to specific features (substring match) |

**Output** — `SliceDependenciesResult`:

```json
{
  "features": [
    {
      "name": "User Authentication",
      "entityCount": 15,
      "dependsOn": []
    },
    {
      "name": "Payment Processing",
      "entityCount": 28,
      "dependsOn": [
        {
          "feature": "User Authentication",
          "connectionCount": 3,
          "connections": [
            { "fromName": "processPayment", "toName": "getCurrentUser" },
            { "fromName": "validateCard", "toName": "getAuthToken" },
            { "fromName": "createOrder", "toName": "getUserId" }
          ]
        }
      ]
    },
    {
      "name": "Inventory Management",
      "entityCount": 22,
      "dependsOn": [
        {
          "feature": "Payment Processing",
          "connectionCount": 2,
          "connections": [
            { "fromName": "checkStock", "toName": "getOrderItems" },
            { "fromName": "reserveItems", "toName": "createHold" }
          ]
        }
      ]
    }
  ],
  "executionOrder": ["User Authentication", "Payment Processing", "Inventory Management"],
  "circularDependencies": []
}
```

`executionOrder` is a topological sort — features with no dependencies come first. `circularDependencies` lists any cycles detected (features that mutually depend on each other).

---

### 9. Vibe Coding Tools

Session-based coding assistance with context enrichment and change tracking.

#### `vibe_start`

Start a vibe coding session. Enriches your prompt with relevant codebase context.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `intent` | `string` | Yes | — | What you want to do |
| `targetFiles` | `string[]` | No | `[]` | Files you plan to modify |
| `relatedConcepts` | `string[]` | No | `[]` | Additional keywords/concepts |
| `maxContextItems` | `number` | No | `8` | Max relevant code items |

**Output**:

```json
{
  "sessionId": "vibe_1700000000_abc123",
  "context": {
    "originalIntent": "Add email validation to user registration",
    "enrichedPrompt": "# Your Coding Task\nAdd email validation...\n\n---\n# Relevant Code Context\n...",
    "relevantCode": [
      {
        "entity": { "id": "fn_abc", "name": "createUser", "type": "function", "filePath": "src/auth/user.ts", "code": "...", "startLine": 10, "endLine": 30 },
        "justification": { "purposeSummary": "...", "businessValue": "...", "featureContext": "Auth", "confidence": 0.9 },
        "relationships": { "callers": [...], "callees": [...], "dependencies": [] },
        "relevanceScore": 0.95,
        "relevanceReason": "Name contains \"User\""
      }
    ],
    "patterns": [{ "pattern": "Service Layer", "description": "Found 4 implementations", "examples": [...] }],
    "conventions": {
      "namingPatterns": { "functions": "camelCase", "classes": "PascalCase", "interfaces": "PascalCase with I prefix", "files": "kebab-case.ts" },
      "fileOrganization": "Feature-based folders with index.ts exports",
      "errorHandling": "Throw errors with descriptive messages, use try/catch at boundaries",
      "importStyle": "Named imports with .js extension for ESM",
      "typeUsage": "Strict TypeScript with explicit types on public APIs"
    },
    "architectureNotes": ["Target file(s): src/auth/user.ts", "Detected patterns: Service Layer, Repository Pattern"]
  }
}
```

**Ledger**: Session start recorded.

---

#### `vibe_change`

Record a file change during a vibe coding session. Triggers re-index and re-justification.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `sessionId` | `string` | No | — | Vibe session ID |
| `filePath` | `string` | Yes | — | Changed file |
| `changeType` | `"created" \| "modified" \| "deleted" \| "renamed"` | Yes | — | Change type |
| `description` | `string` | Yes | — | What was changed and why |
| `previousPath` | `string` | No | — | Previous path (renames) |

**Output**:

```json
{
  "success": true,
  "entitiesAffected": ["fn_abc", "fn_def"],
  "message": "Change recorded. 2 entities affected and re-indexed."
}
```

**Ledger**: Change recorded with impacted files/entities.

---

#### `vibe_complete`

Complete a vibe coding session.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `sessionId` | `string` | Yes | — | Session ID |
| `summary` | `string` | No | — | What was accomplished |

**Output**:

```json
{
  "session": {
    "id": "vibe_1700000000_abc123",
    "startedAt": "2025-01-15T10:00:00.000Z",
    "intent": "Add email validation",
    "targetFiles": ["src/auth/user.ts"],
    "relatedConcepts": [],
    "enrichedContext": { "..." : "..." },
    "changes": [
      { "filePath": "src/auth/validator.ts", "changeType": "created", "description": "Added email validator", "timestamp": "...", "entitiesAffected": ["fn_new"] }
    ],
    "status": "completed"
  },
  "message": "Session completed. 1 changes recorded."
}
```

**Ledger**: Completion recorded with duration and total changes.

---

#### `vibe_status`

Get the status of a vibe session.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `sessionId` | `string` | Yes | — | Session ID |

**Output**:

```json
{
  "session": { "id": "...", "status": "active", "changes": [...], "..." : "..." }
}
```

Returns `{ "session": null }` if not found.

---

## MCP Resources

Read-only data accessible via MCP resource URIs. All return `application/json`.

| URI | Name | Description |
|-----|------|-------------|
| `file://` | Files | List all indexed files with symbol counts |
| `file://{path}` | File | Get details for a specific file by path |
| `symbols://` | Symbols | List all symbols (functions, classes, interfaces, variables) |
| `symbols://?type={type}` | Symbols by Type | Filter symbols by type |
| `symbols://{id}` | Symbol | Get details for a specific symbol by ID |
| `graph://` | Graph Overview | Node and edge counts |

### `file://` — List Files

```json
{
  "files": [
    { "path": "/src/core/parser/index.ts", "hash": "abc123", "language": "typescript", "size": 4096, "lastIndexed": "2025-01-15", "symbolCount": 12 }
  ],
  "total": 273
}
```

### `file://{path}` — File Details

```json
{
  "path": "/src/core/parser/index.ts",
  "hash": "abc123",
  "language": "typescript",
  "size": 4096,
  "lastIndexed": "2025-01-15",
  "symbolCount": 12
}
```

### `symbols://` — List Symbols

```json
{
  "symbols": [
    { "id": "fn_abc", "name": "createParser", "type": "function", "filePath": "/src/core/parser/index.ts", "startLine": 42, "endLine": 55, "signature": "...", "isExported": true }
  ],
  "total": 4430
}
```

### `graph://` — Graph Overview

```json
{
  "nodes": { "files": 273, "functions": 3010, "classes": 136, "interfaces": 774, "variables": 520 },
  "edges": { "contains": 4430, "calls": 1200, "imports": 825, "extends": 42, "implements": 68 }
}
```

---

## REST API

Served by the Web Viewer on `http://localhost:{port}`. Default port: `3000`.

All endpoints return JSON. Error responses: `{ "error": "<message>" }` with appropriate HTTP status.

### REST: Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |

Returns: `{ "status": "ok" }`

---

### REST: Statistics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/stats/overview` | Aggregate counts (files, functions, classes, interfaces, relationships, embeddings) |
| `GET` | `/api/stats/entities` | Entity counts by type |
| `GET` | `/api/stats/relationships` | Relationship counts by type |
| `GET` | `/api/stats/languages` | File counts by language |
| `GET` | `/api/stats/complexity` | Function complexity distribution |

---

### REST: Files

| Method | Path | Query Params | Description |
|--------|------|-------------|-------------|
| `GET` | `/api/files` | `?limit=100&offset=0&language=typescript` | List files with pagination |
| `GET` | `/api/files/tree` | — | File tree structure |
| `GET` | `/api/files/content` | `?path=<filePath>` | Read file content from disk |
| `GET` | `/api/files/entities` | `?path=<filePath>` | Get entities in a file |
| `GET` | `/api/files/:id` | — | Get file by ID |
| `GET` | `/api/files/:id/imports` | — | What this file imports |
| `GET` | `/api/files/:id/importers` | — | What files import this file |

---

### REST: Entities

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/entities/:id` | Get entity details by ID (any type) |
| `GET` | `/api/entities/:id/relationships` | Get entity relationships (calls, callers, extends, etc.) |

---

### REST: Functions

| Method | Path | Query Params | Description |
|--------|------|-------------|-------------|
| `GET` | `/api/functions` | `?limit=100&offset=0` | List functions |
| `GET` | `/api/functions/most-called` | `?limit=20` | Functions sorted by caller count |
| `GET` | `/api/functions/most-complex` | `?limit=20` | Functions sorted by complexity |
| `GET` | `/api/functions/:id` | — | Get function by ID |
| `GET` | `/api/functions/:id/callers` | — | Get function's callers |
| `GET` | `/api/functions/:id/callees` | — | Get function's callees |

---

### REST: Classes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/classes` | List classes |
| `GET` | `/api/classes/:id` | Get class by ID (includes methods) |
| `GET` | `/api/classes/:id/hierarchy` | Get class inheritance hierarchy |

---

### REST: Interfaces

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/interfaces` | List interfaces |
| `GET` | `/api/interfaces/:id` | Get interface by ID (includes properties) |

---

### REST: Search

| Method | Path | Query/Body | Description |
|--------|------|-----------|-------------|
| `GET` | `/api/search` | `?q=<query>&type=<entityType>&limit=20` | Text search across entities |
| `GET` | `/api/search/natural` | `?q=<query>&limit=10` | Natural language search |
| `GET` | `/api/search/semantic` | `?q=<query>&limit=10` | Vector similarity search |
| `GET` | `/api/search/exact` | `?q=<query>&limit=20` | Exact/regex search (alias) |
| `POST` | `/api/search/hybrid` | `{ query, businessContext?, limit?, enableSynthesis? }` | Hybrid semantic+lexical search |
| `GET` | `/api/nl-search` | `?q=<query>&limit=10` | NL search (alias) |
| `GET` | `/api/nl-search/patterns` | — | List NL search pattern examples |

---

### REST: Graph

| Method | Path | Query Params | Description |
|--------|------|-------------|-------------|
| `GET` | `/api/graph` | `?limit=200` | Graph data (nodes + edges) for visualization |
| `GET` | `/api/graph/calls` | `?limit=200` | Call graph (functions + calls edges) |
| `GET` | `/api/graph/dependencies` | `?limit=200` | Dependency graph (files + imports edges) |

---

### REST: Justifications

| Method | Path | Query Params | Description |
|--------|------|-------------|-------------|
| `GET` | `/api/justifications` | `?limit=50&offset=0` | List justifications |
| `GET` | `/api/justifications/stats` | — | Justification statistics |
| `GET` | `/api/justifications/features` | — | List feature areas |
| `GET` | `/api/justifications/search` | `?q=<query>&limit=20` | Search justifications |
| `GET` | `/api/justifications/uncertainty-hotspots` | `?limit=20` | Low-confidence clusters |
| `GET` | `/api/justifications/low-confidence` | `?limit=20&threshold=0.5` | Entities below confidence threshold |
| `GET` | `/api/justifications/uncertain-features` | `?limit=10` | Features with lowest avg confidence |
| `GET` | `/api/justifications/features/:feature` | — | Justifications for a feature |
| `GET` | `/api/justifications/file-hierarchy/:filePath` | — | File-level justification hierarchy |
| `GET` | `/api/justifications/:entityId` | — | Justification for an entity |
| `GET` | `/api/justifications/:entityId/children` | — | Child justifications |
| `GET` | `/api/justifications/:entityId/ancestors` | — | Ancestor justifications |

---

### REST: Classifications

| Method | Path | Query Params | Description |
|--------|------|-------------|-------------|
| `GET` | `/api/classifications` | `?limit=50&offset=0` | List classifications |
| `GET` | `/api/classifications/stats` | — | Classification statistics (domain vs infra) |
| `GET` | `/api/classifications/search` | `?q=<query>` | Search classifications |
| `GET` | `/api/classifications/:entityId` | — | Get classification for entity |

---

### REST: Ledger

| Method | Path | Query Params | Description |
|--------|------|-------------|-------------|
| `GET` | `/api/ledger` | `?eventType=&source=&startTime=&endTime=&limit=50&offset=0` | Query ledger entries |
| `GET` | `/api/ledger/stats` | — | Ledger statistics |
| `GET` | `/api/ledger/recent` | `?limit=20` | Most recent ledger entries |
| `GET` | `/api/ledger/timeline` | `?bucketMinutes=60` | Ledger entries grouped by time |
| `GET` | `/api/ledger/aggregations` | — | Aggregated ledger stats |
| `GET` | `/api/ledger/entity/:entityId` | — | Ledger entries for an entity |
| `GET` | `/api/ledger/:id` | — | Get specific ledger entry |

---

### REST: Adaptive Indexing

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/adaptive/stats` | Adaptive indexer statistics |
| `GET` | `/api/adaptive/hot` | Hot entities (frequently queried) |
| `GET` | `/api/adaptive/cold` | Cold entities (stale, need refresh) |
| `GET` | `/api/adaptive/priority` | Priority re-indexing queue |
| `GET` | `/api/adaptive/sessions` | List MCP sessions |
| `GET` | `/api/adaptive/sessions/:id` | Get session details |
| `GET` | `/api/adaptive/queries/recent` | Recent MCP queries |
| `GET` | `/api/adaptive/changes/recent` | Recent file changes |

---

### REST: Memory

| Method | Path | Query Params | Description |
|--------|------|-------------|-------------|
| `GET` | `/api/memory/stats` | — | Memory system statistics |
| `GET` | `/api/memory/rules` | `?scope=&category=&limit=50` | List learned rules |
| `GET` | `/api/memory/rules/:id` | — | Get specific rule |
| `GET` | `/api/memory/relevant` | `?context=<query>&limit=5` | Get contextually relevant memories |
| `GET` | `/api/memory/file/:filePath` | — | Get memories applicable to a file |

---

### REST: Compaction

| Method | Path | Query Params | Description |
|--------|------|-------------|-------------|
| `GET` | `/api/compaction/stats` | — | Compaction statistics |
| `GET` | `/api/compaction/entries` | `?limit=50&offset=0` | List compacted entries |
| `GET` | `/api/compaction/entries/:id` | — | Get specific compacted entry |
| `GET` | `/api/compaction/timeline` | — | Compaction timeline |
| `GET` | `/api/compaction/session/:sessionId` | — | Compacted entries for a session |

---

### REST: Reconciliation

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/reconciliation/status` | Current reconciliation status |
| `GET` | `/api/reconciliation/gaps` | Detect gaps in ledger history |
| `GET` | `/api/reconciliation/validation` | Validate ledger integrity |

---

### REST: Operations

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/operations/reindex` | `{ filePaths?: string[] }` | Trigger re-indexing |
| `POST` | `/api/operations/justify` | `{ entityIds?: string[], force?: boolean }` | Trigger business justification |

---

### REST: Semantic Analysis

These endpoints wrap MCP semantic analysis tools as REST APIs.

| Method | Path | Query Params | Description |
|--------|------|-------------|-------------|
| `GET` | `/api/semantics/functions` | `?name=<name>&filePath=<path>` | Get function semantics (parameters, return type, error analysis) |
| `GET` | `/api/semantics/error-paths` | `?functionName=<name>&filePath=<path>` | Get error propagation paths for a function |
| `GET` | `/api/semantics/data-flow` | `?functionName=<name>&filePath=<path>&includeFullGraph=false` | Get data flow analysis for a function |
| `GET` | `/api/semantics/side-effects` | `?functionName=<name>&filePath=<path>&categories=<csv>&minConfidence=<level>` | Get side effects analysis for a function |

**`GET /api/semantics/functions`**
- `name` (required): Function name to find
- `filePath` (optional): File path to narrow search

**`GET /api/semantics/data-flow`**
- `functionName` (required): Function name
- `includeFullGraph` (optional, default `false`): Include full node/edge graph

---

### REST: Design Patterns

| Method | Path | Query Params | Description |
|--------|------|-------------|-------------|
| `GET` | `/api/patterns` | `?patternType=<type>&minConfidence=0.5&filePath=<path>&limit=20` | Find design patterns in the codebase |
| `GET` | `/api/patterns/:id` | — | Get details of a specific pattern |

**`GET /api/patterns`**
- `patternType` (optional): One of `factory`, `singleton`, `observer`, `repository`, `service`, `adapter`, `builder`, `strategy`, `decorator`
- `minConfidence` (optional, default `0.5`): Minimum confidence threshold
- `limit` (optional, default `20`): Max results

---

### REST: Operations — MCP Tools

These extend the existing Operations section with MCP tool equivalents.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/operations/file-changed` | `{ filePath, changeType, previousPath?, changeDescription?, aiGenerated? }` | Notify that a file was changed |
| `POST` | `/api/operations/enhance-prompt` | `{ prompt, targetFile?, taskType?, includeContext?, maxContextTokens? }` | Enhance a prompt with codebase context |
| `POST` | `/api/operations/generation-context` | `{ originalPrompt, affectedFiles, sessionId?, generationNotes? }` | Create generation context after code generation |

**`POST /api/operations/file-changed`**
- `filePath` (required): Path to changed file
- `changeType` (required): `created` | `modified` | `deleted` | `renamed`
- `previousPath` (optional): Previous path for renames
- `changeDescription` (optional): Brief description
- `aiGenerated` (optional): Whether AI-generated

**`POST /api/operations/enhance-prompt`**
- `prompt` (required): Original user prompt
- `taskType` (optional): `create` | `modify` | `refactor` | `fix` | `document` | `test`
- `includeContext` (optional, default `true`): Include related code context
- `maxContextTokens` (optional, default `2000`): Max context tokens

**`POST /api/operations/generation-context`**
- `originalPrompt` (required): The prompt used
- `affectedFiles` (required): Array of `{ filePath, changeType, summary? }`
- `sessionId` (optional): Session ID for tracking
- `generationNotes` (optional): Additional context

---

### REST: Lazarus Migration

| Method | Path | Params | Description |
|--------|------|--------|-------------|
| `GET` | `/api/entities/:id/source` | `?contextLines=0` | Get source code for an entity |
| `GET` | `/api/features` | `?featureContext=<ctx>&includeEntities=false&limit=50` | Get feature map |
| `POST` | `/api/features/migration-context` | Body: `{ featureContext?, entityIds?, includeSource?, includeDataFlow?, includeSideEffects? }` | Get migration context |
| `GET` | `/api/entities/:id/blast-radius` | `?maxDepth=3&direction=callers` | Analyze blast radius of an entity |
| `GET` | `/api/entities/:id/tests` | — | Get tests for an entity |
| `GET` | `/api/resolve` | `?filePath=<path>&line=<number>` | Resolve entity at a file location |
| `GET` | `/api/migration/progress` | `?featureContext=<ctx>&tags=<csv>` | Get migration progress |
| `GET` | `/api/migration/slice-dependencies` | `?features=<csv>` | Get slice dependencies |

**`GET /api/entities/:id/blast-radius`**
- `maxDepth` (optional, default `3`): Max traversal depth
- `direction` (optional, default `callers`): `callers` | `callees` | `both`

**`GET /api/resolve`**
- `filePath` (required): File path
- `line` (required): Line number

---

### REST: Entity Tagging

| Method | Path | Params | Description |
|--------|------|--------|-------------|
| `POST` | `/api/entities/:id/tags` | Body: `{ tags: string[], source? }` | Tag an entity |
| `GET` | `/api/tags/:tag/entities` | `?entityType=<type>` | Get entities with a tag |
| `DELETE` | `/api/entities/:id/tags` | Body: `{ tags: string[] }` | Remove tags from an entity |

**`POST /api/entities/:id/tags`**
- `tags` (required): Array of tag strings
- `source` (optional): Source of the tagging

**`GET /api/tags/:tag/entities`**
- `entityType` (optional): Filter by `function` | `class` | `interface` | `variable` | `file`

---

### REST: Vibe Coding Sessions

| Method | Path | Params | Description |
|--------|------|--------|-------------|
| `POST` | `/api/sessions/start` | Body: `{ intent, targetFiles?, relatedConcepts?, maxContextItems? }` | Start a vibe coding session |
| `POST` | `/api/sessions/:sessionId/changes` | Body: `{ filePath, changeType, description, previousPath? }` | Record a change in a session |
| `POST` | `/api/sessions/:sessionId/complete` | Body: `{ summary? }` | Complete a session |
| `GET` | `/api/sessions/:sessionId` | — | Get session status |

**`POST /api/sessions/start`**
- `intent` (required): What the coding session is about
- `targetFiles` (optional): Files expected to be modified
- `relatedConcepts` (optional): Related concepts/keywords
- `maxContextItems` (optional): Max context items to include

**`POST /api/sessions/:sessionId/changes`**
- `filePath` (required): Path to changed file
- `changeType` (required): `created` | `modified` | `deleted` | `renamed`
- `description` (required): What changed
- `previousPath` (optional): Previous path for renames

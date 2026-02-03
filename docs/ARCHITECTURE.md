# Code-Synapse Architecture

**Zero-Config Smart Sidecar for AI Agents**

A comprehensive guide to the architecture, design decisions, and implementation status of Code-Synapse - an agent-first knowledge engine that transforms raw code into a structured Knowledge Graph optimized for machine reasoning.

> **Note**: This document is intended for developers who want to understand, extend, or contribute to Code-Synapse. For user-facing documentation, see [README.md](../README.md) and [HOW-IT-WORKS.md](./HOW-IT-WORKS.md).

---

## Table of Contents

1. [Overview](#overview)
2. [Core Principles](#core-principles)
3. [System Architecture](#system-architecture)
4. [Three-Layer Knowledge Model](#three-layer-knowledge-model)
5. [Technology Stack](#technology-stack)
6. [Module Architecture](#module-architecture)
7. [Data Flow](#data-flow)
8. [Storage Architecture](#storage-architecture)
9. [MCP Protocol Integration](#mcp-protocol-integration)
10. [LLM Integration](#llm-integration)
11. [Key Design Decisions](#key-design-decisions)
12. [Implementation Status](#implementation-status)
13. [Testing & Verification](#testing--verification)
14. [Risk Mitigations](#risk-mitigations)
15. [Future Roadmap](#future-roadmap)
16. [Technology References](#technology-references)

---

## Overview

Code-Synapse is a local CLI "sidecar" that runs alongside AI agents (Claude Code, Cursor, Windsurf) via the MCP (Model Context Protocol). It provides:

- **Real-time Code Understanding**: Watches file changes and maintains an up-to-date knowledge graph
- **Semantic Search**: Combines vector embeddings, keyword search, and graph traversal
- **Natural Language Search**: Query your codebase using plain English ("most complex functions", "where is createParser")
- **Cross-File Intelligence**: Tracks function calls, type hierarchies, and module dependencies
- **Local LLM Inference**: Uses small local models for business logic summarization
- **Web Viewer**: Visual dashboard with REST API for exploring indexed code

### Design Goals

1. **Privacy-First**: All processing happens locally, no external API calls
2. **Zero-Config**: Works out of the box with minimal setup
3. **Performance**: Sub-second indexing for typical projects
4. **Extensibility**: Modular architecture for easy language support
5. **Reliability**: Atomic transactions, incremental updates, error recovery

### What Makes It Different

| Traditional Approach | Code-Synapse Approach |
|---------------------|----------------------|
| Cloud-based code intelligence | Fully local, privacy-first |
| Requires API keys | Zero external dependencies |
| Keyword-only search | Hybrid semantic + graph search |
| Static analysis | Real-time incremental updates |
| Language-specific tools | Polyglot via Universal Code Entities |

---

## Core Principles

### 1. Embedded-First Design

- Single Node.js process manages all components
- No external database servers required
- All dependencies bundled or embedded (WASM)
- Zero external configuration files needed

### 2. Sidecar Process Model

- Background daemon that stays running alongside the IDE
- File system watcher for real-time updates
- MCP server for AI agent communication
- Incremental indexing for performance

### 3. Local-First Philosophy

- No cloud dependencies
- No API keys required
- All data stays on developer's machine
- Works completely offline

### 4. Agent-Optimized Output

- Results formatted for LLM consumption
- Graph context automatically included
- Confidence scores on inferred data
- Hierarchical summaries for efficient context usage

---

## System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              User / AI Agent                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                       │                      │
                    ▼                       ▼                      ▼
┌─────────────────────────┐  ┌────────────────────────┐  ┌────────────────────┐
│       CLI Layer         │  │       MCP Layer        │  │    Viewer Layer    │
│  (commander.js + chalk) │  │(@modelcontextprotocol) │  │  (HTTP + REST API) │
│  default │ init │ index │  │  Tools │ Resources     │  │  NL Search │ Stats │
│  status │ config│ start │  │                        │  │  Dashboard │ API   │
└─────────────────────────┘  └────────────────────────┘  └────────────────────┘
                    │                       │                      │
                    └───────────────────────┼──────────────────────┘
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Core Layer                                         │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Scanner   │──│   Parser    │──│  Extractor  │──│Graph Writer │        │
│  │ (fast-glob) │  │(tree-sitter)│  │ (pipeline)  │  │  (CozoDB)   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Embeddings  │  │  LLM Service│  │File Watcher │  │  NL Search  │        │
│  │  (ONNX)     │  │(llama.cpp)  │  │ (chokidar)  │  │  (Intents)  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Storage Layer                                        │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    CozoDB (RocksDB Backend)                            │  │
│  │  • Graph Relations: file, function, class, interface, variable         │  │
│  │  • Edge Relations: contains, calls, imports, extends, implements       │  │
│  │  • Vector Index: HNSW for semantic search                              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  Location: .code-synapse/data/graph.db                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Four-Part Design

| Part | Purpose | Technology |
|------|---------|------------|
| **CLI** | User interface for configuration and management | Commander.js, Chalk, Ora |
| **MCP Server** | AI agent communication via Model Context Protocol | @modelcontextprotocol/sdk |
| **Web Viewer** | Visual dashboard with REST API for exploration | Node HTTP, NL Search |
| **Core** | Shared business logic used by CLI, MCP, and Viewer | TypeScript modules |

---

## Three-Layer Knowledge Model

Code-Synapse builds understanding progressively through three layers:

```
┌─────────────────────────────────────────────────┐
│         Layer 3: Business Logic                 │
│  (LLM-inferred intent, patterns, workflows)     │
├─────────────────────────────────────────────────┤
│         Layer 2: Semantic Analysis              │
│  (Types, call chains, data flow, dependencies)  │
├─────────────────────────────────────────────────┤
│         Layer 1: Syntax Structure               │
│  (AST, functions, classes, imports, exports)    │
└─────────────────────────────────────────────────┘
```

### Layer 1: Syntax Structure

Extracted via Tree-sitter WASM parser:
- Functions, classes, interfaces, type aliases
- Import/export declarations
- Variable declarations
- JSDoc comments and annotations

### Layer 2: Semantic Analysis

Extracted via TypeScript Compiler API:
- Resolved types for all symbols
- Cross-file symbol linking
- Call graph relationships
- Module dependency graph
- Circular dependency detection

### Layer 3: Business Logic

Inferred via local LLM (Qwen 2.5):
- Natural language function summaries
- Intent classification
- Workflow pattern detection
- Hierarchical module summaries (GraphRAG pattern)

---

## Technology Stack

### Database Lock Management

Code-Synapse uses RocksDB (via CozoDB) as its embedded database, which uses file-level locking to ensure data integrity. The Lock Manager handles stale lock detection and cleanup to enable reliable multi-instance operation.

**Problem Solved**: When Code-Synapse crashes or is forcefully terminated (SIGKILL, OOM), the RocksDB `LOCK` file may remain, preventing subsequent starts. The Lock Manager automatically detects and cleans up these stale locks.

**How It Works**:

```
┌─────────────────────────────────────────────────────────────────┐
│ DATABASE INITIALIZATION                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Check if LOCK file exists                                   │
│     └── If no: Proceed normally                                 │
│     └── If yes: Continue to step 2                              │
│                                                                  │
│  2. Find lock owner PID (via lsof)                              │
│     └── If no owner: Lock is orphaned → Remove it               │
│     └── If owner found: Continue to step 3                      │
│                                                                  │
│  3. Check if owner process is running                           │
│     └── Use process.kill(pid, 0) for existence                  │
│     └── Use `ps -p` to detect zombies                           │
│     └── If dead/zombie: Lock is stale → Remove it               │
│     └── If alive: Lock is valid → Error (another instance)      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Components** (`src/utils/lock-manager.ts`):

| Function | Purpose |
|----------|---------|
| `checkLock(dbPath)` | Returns lock status: exists, isStale, ownerPid |
| `removeStaleLock(dbPath)` | Safely removes stale lock file |
| `ensureDatabaseAccessible(dbPath)` | Pre-flight check before DB init |
| `registerShutdownHandlers(cleanup)` | Registers graceful shutdown handlers |

**Multi-Instance Support**: Each Code-Synapse instance operates on a separate project directory with its own `.code-synapse/data/` folder. The lock manager ensures:
- Different projects can run simultaneously (different lock files)
- Same project cannot run multiple instances (protected by lock)
- Crashed instances don't block future starts (stale lock cleanup)

---

### Parsing Layer

| Technology | Purpose | Why This Choice |
|------------|---------|-----------------|
| **Tree-sitter (WASM)** | Fast incremental parsing | Sub-millisecond parses, incremental updates, polyglot support |
| **TypeScript Compiler API** | Semantic analysis | Type resolution, symbol linking, call graphs |
| **Worker Threads** | Isolate TS compiler | Prevents blocking main thread during heavy analysis |

### Storage Layer

| Technology | Purpose | Why This Choice |
|------------|---------|-----------------|
| **CozoDB (RocksDB)** | Graph + Vector database | Embedded, CozoScript (Datalog) queries, HNSW vector indices |

CozoDB provides both graph storage AND native vector search via HNSW indices. This unified approach eliminates synchronization issues between separate databases.

### Intelligence Layer

| Technology | Purpose | Why This Choice |
|------------|---------|-----------------|
| **node-llama-cpp** | Local LLM inference | GBNF grammar support, no API keys |
| **HuggingFace Transformers.js** | Embeddings | ONNX runtime, local generation |
| **Model Registry** | Model selection | 12 models across 4 families |

### Infrastructure Layer

| Technology | Purpose | Why This Choice |
|------------|---------|-----------------|
| **RxJS** | Reactive event handling | Backpressure, batching, deduplication |
| **Pino** | Structured logging | Fast, JSON output, component context |
| **Zod** | Schema validation | Runtime type safety, good error messages |
| **Lock Manager** | RocksDB lock management | Stale lock detection, multi-instance support |

---

## Module Architecture

### Directory Structure

```
src/
├── cli/                    # User-facing CLI
│   ├── index.ts            # Entry point, signal handlers, default command
│   └── commands/           # default, init, index, status, config, start, viewer
│
├── mcp/                    # MCP Server
│   ├── server.ts           # Server setup, tool handlers
│   ├── tools.ts            # Tool definitions
│   └── resources.ts        # Resource handlers
│
├── viewer/                 # Web Viewer & NL Search
│   ├── index.ts            # Module exports
│   ├── interfaces/         # IGraphViewer interface
│   ├── impl/               # CozoGraphViewer implementation
│   ├── ui/                 # HTTP server and REST API
│   │   ├── server.ts       # ViewerServer class
│   │   └── public/         # Static files (dashboard)
│   └── nl-search/          # Natural Language Search
│       ├── types.ts        # SearchIntent, NLSearchResult types
│       ├── intent-classifier.ts  # Intent classification
│       ├── query-builder.ts      # CozoScript query generation
│       └── nl-search-service.ts  # Search orchestration
│
├── core/                   # Business logic
│   ├── parser/             # Tree-sitter AST parsing
│   ├── graph/              # CozoDB database layer
│   ├── indexer/            # Indexing orchestration
│   ├── extraction/         # Entity extraction
│   ├── graph-builder/      # Graph construction
│   ├── embeddings/         # Vector embeddings
│   ├── llm/                # Local LLM inference
│   │   └── interfaces/     # ILLMService interface
│   ├── justification/      # Business purpose inference (V13)
│   │   ├── hierarchy/      # Dependency graph and hierarchical processing
│   ├── classification/     # Domain/Infrastructure classification (V14)
│   │   ├── models/         # Classification data models
│   │   ├── interfaces/     # IClassificationEngine, IClassificationStorage
│   │   ├── storage/        # CozoDB classification operations
│   │   └── impl/           # LLMClassificationEngine
│   ├── ledger/             # Change Ledger & Observability (V15)
│   │   ├── models/         # LedgerEntry, event types
│   │   ├── interfaces/     # IChangeLedger interface
│   │   └── impl/           # CozoChangeLedger implementation
│   ├── adaptive-indexer/   # MCP-Driven Adaptive Indexing (V16)
│   │   ├── models/         # Query/Change observation, correlations
│   │   ├── interfaces/     # IAdaptiveIndexer interface
│   │   └── impl/           # AdaptiveIndexerService
│   ├── reconciliation/     # Ledger Reconciliation (V18)
│   │   ├── interfaces/     # IReconciliationWorker, IGitIntegration
│   │   └── impl/           # ReconciliationWorker implementation
│   ├── memory/             # Persistent Developer Memory (V19)
│   │   ├── models/         # ProjectMemoryRule, MemoryStats
│   │   ├── interfaces/     # IProjectMemory, IMemoryLearner
│   │   └── impl/           # CozoProjectMemory implementation
│   ├── optimization/       # Performance Optimization Layer (V20)
│   │   ├── cache/          # LRU caches (QueryCache, ModelResponseCache)
│   │   ├── filter/         # Bloom filters, entity filters
│   │   ├── pool/           # Worker pools for parallel processing
│   │   ├── batch/          # Batch writers, write-behind ledger
│   │   ├── heat/           # Heat tracking, adaptive indexing
│   │   ├── metrics/        # Performance tracker, cost attribution
│   │   └── interfaces/     # IOptimization interfaces
│   ├── models/             # Multi-Model Intelligence Layer (V21)
│   │   ├── interfaces/     # IModelProvider, IModelRouter
│   │   ├── router/         # ModelRouter with policy engine
│   │   └── providers/      # LocalProvider, OpenAIProvider
│   └── interfaces/         # Contract interfaces
│
├── types/                  # Type definitions
└── utils/                  # Shared utilities
```

### Build Order: Horizontals First, Then Verticals

**Horizontals** are cross-cutting infrastructure used across the entire project.
**Verticals** are feature-specific modules that build on top of horizontals.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VERTICALS (Features)                               │
│  V1 Graph → V2 Scanner → V3 Parser → V4 Semantic → V5 Extract              │
│  → V6 Refactor → V7 Build → V8 Indexer → V9 MCP → V10 LLM → V11 CLI        │
│  → V12 Viewer → V13 Justify → V14 Classify → V15 Ledger → V16 Adaptive     │
│  → V17 Compaction → V18 Reconciliation → V19 Memory → V20 Optimize → V21 Models │
└─────────────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ depends on
┌─────────────────────────────┴───────────────────────────────────────────────┐
│                    HORIZONTALS (Infrastructure)                              │
│  H1 Foundation → H2 Resource Mgmt → H3 Schema → H4 Async → H5 Telemetry     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Horizontal Layers

| Layer | Purpose | Key Components |
|-------|---------|----------------|
| **H1: Foundation** | Basic utilities | Logger (Pino), Error classes, File system helpers |
| **H2: Resource Management** | Cleanup automation | Disposable interfaces, using keyword support |
| **H3: Schema & Types** | Type safety | Schema Source of Truth, UCE types, Zod validation |
| **H4: Async Infrastructure** | Async patterns | Result type, Object Pool, Event Bus, retry logic |
| **H5: Telemetry** | Observability | OpenTelemetry traces, @traced decorator |

### Vertical Modules

| Module | Purpose | Key Responsibility |
|--------|---------|-------------------|
| **V1: Graph Database** | Structural storage | CozoDB wrapper, migrations, transactions |
| **V2: File Scanner** | File discovery | Project detection, glob patterns, hashing |
| **V3: Code Parser** | Syntax extraction | Tree-sitter parsing, UCE transformation |
| **V4: Semantic Analysis** | Type intelligence | Worker thread, TypeScript Compiler API |
| **V5: Entity Extraction** | Graph building | Function/Class extraction, batch processing |
| **V6: Architecture Refactor** | Code quality | Interface contracts, storage consolidation |
| **V7: Graph Builder** | Persistence | Atomic writes, incremental updates |
| **V8: Indexer & Watcher** | Orchestration | RxJS file watching, pipeline coordination |
| **V9: MCP Server** | Agent communication | Tools, resources, hybrid search |
| **V10: LLM Integration** | Business logic | Model registry, GBNF grammars, inference |
| **V11: CLI Commands** | User interface | Full command implementations |
| **V12: Web Viewer** | Visual dashboard | REST API, NL Search, statistics |
| **V13: Justification** | Business purpose inference | LLM prompts, context propagation, clarification |
| **V14: Classification** | Domain/Infrastructure categorization | LLM classification, pattern matching, confidence |
| **V15: Change Ledger** | Append-only event log | Observability, time-travel debugging, correlation |
| **V16: Adaptive Indexer** | MCP-driven re-indexing | Query observation, semantic correlation, priorities |
| **V17: Ledger Compaction** | Session-aware log grouping | Intent clustering, semantic diffing, noise reduction |
| **V18: Reconciliation** | Offline recovery | Git integration, gap detection, synthetic entries |
| **V19: Persistent Memory** | Developer rule learning | Convention tracking, anti-patterns, confidence decay |
| **V20: Optimization** | Performance primitives | LRU caches, bloom filters, worker pools, batch writes |
| **V21: Multi-Model** | Pluggable model routing | Local + cloud providers, policy engine, cost tracking |
| **V22: Horizontal Docs** | Documentation graph | Package links, NPM metadata, SDK references |
| **V23: Self-Optimizing** | Feedback loops | Performance observation, automatic score adjustment |

### Interface Contracts

The codebase uses explicit interface contracts for testability and modularity:

| Interface | Purpose |
|-----------|---------|
| **IParser** | Universal code parser abstraction |
| **IGraphStore** | Graph database operations |
| **IScanner** | File discovery abstraction |
| **ISemanticAnalyzer** | Type resolution abstraction |
| **IExtractor** | Entity extraction abstraction |
| **IGraphViewer** | Read-only graph exploration and statistics |
| **IJustificationService** | Business justification inference and storage |
| **IClassificationEngine** | Domain/Infrastructure classification logic |
| **IClassificationStorage** | Classification persistence and queries |
| **IChangeLedger** | Append-only event logging and queries |
| **IAdaptiveIndexer** | MCP query observation and intelligent re-indexing |
| **ILedgerCompaction** | Session-aware compaction and intent grouping |
| **IReconciliationWorker** | Offline recovery and Git-based gap detection |
| **IProjectMemory** | Developer memory storage and learning |
| **IMemoryLearner** | Pattern detection from corrections and failures |
| **IModelProvider** | Unified LLM provider abstraction |
| **IModelRouter** | Intelligent model routing with policy engine |
| **IOptimizationLayer** | Performance optimization orchestration |
| **IHeatTracker** | Entity access frequency tracking |
| **IPerformanceTracker** | Operation timing and bottleneck detection |
| **IDocumentationService** | Documentation discovery and linking |
| **IDocumentationStorage** | Documentation reference persistence |
| **IFeedbackLoop** | Performance observation and score adjustment |
| **IFeedbackObserver** | Model outcome recording and statistics |
| **IFeedbackOptimizer** | Routing adjustment generation |

---

## Data Flow

### Indexing Pipeline

```
┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐
│   SCAN     │──►│   PARSE    │──►│  EXTRACT   │──►│  JUSTIFY   │──►│   WRITE    │──►│  COMPLETE  │
│            │   │            │   │            │   │            │   │            │   │            │
│ fast-glob  │   │tree-sitter │   │  pipeline  │   │ Local LLM  │   │   CozoDB   │   │   stats    │
│  project   │   │    UCE     │   │  entities  │   │  business  │   │   batch    │   │   report   │
│ detection  │   │ transform  │   │ relations  │   │  purpose   │   │   atomic   │   │            │
└────────────┘   └────────────┘   └────────────┘   └────────────┘   └────────────┘   └────────────┘
```

**Phase Details:**

1. **Scanning**: ProjectDetector analyzes package.json/tsconfig.json, reads `.gitignore`, combines 90+ default ignore patterns with gitignore rules, FileScanner uses fast-glob to find source files
2. **Parsing**: TypeScriptParser loads tree-sitter WASM, walks AST to extract functions, classes, interfaces
3. **Extraction**: EntityPipeline creates unique IDs, extracts relationships (CONTAINS, CALLS, IMPORTS, etc.)
4. **Justification**: Local LLM infers business purpose, feature context, and value for each entity
5. **Writing**: GraphWriter batches entities and justifications into CozoDB transactions atomically

### Hierarchical Justification Processing

The justification phase uses **dependency-aware processing** to ensure that foundational code is justified before code that depends on it. This enables meaningful context propagation where higher-level entities can reference the already-generated justifications of their dependencies.

**Processing Order (Leaf-to-Root)**:

```
Level 0 (Leaves):     [utility functions, base interfaces - no outgoing deps]
                              ↓
Level 1:              [code that ONLY depends on Level 0]
                              ↓
Level 2:              [code that depends on Level 0 or 1]
                              ↓
Level N (Roots):      [entry points, CLI commands, API handlers]
```

**Key Insight**: "Leaf" means code that doesn't call/depend on other project code (may call external libs).

**Dependency Graph Construction** (`src/core/justification/hierarchy/dependency-graph.ts`):

The system builds an in-memory dependency graph from existing relationships:

| Relationship | Meaning |
|--------------|---------|
| `calls` | Function A calls Function B |
| `imports` | File A imports from File B |
| `extends` | Class A extends Class B |
| `implements` | Class A implements Interface B |
| `extends_interface` | Interface A extends Interface B |

**Algorithm**:

1. **Topological Sort (Kahn's Algorithm)**: Find nodes with no outgoing dependencies → Level 0, remove them, repeat
2. **Cycle Handling (Tarjan's Algorithm)**: Detect Strongly Connected Components (SCCs) for mutual dependencies
3. **SCC Processing**: Cycles are processed together as a single batch, noting mutual dependencies

**Context Propagation**:

When processing entities at Level N, all dependencies (Level < N) already have justifications. The LLM prompt includes these:

```
## Dependencies (Already Justified)
*Use these justifications to understand what this function builds upon:*
- `validateEmail`: Validates email format using RFC 5322 regex
- `formatDate`: Formats date for display in user timezone
```

**Benefits**:

1. **Better Justifications**: LLM understands what dependencies do, not just their names
2. **Context Propagation Works**: Parent justifications exist before children are processed
3. **Consistent Batching**: Same-level entities are naturally similar in abstraction
4. **Predictable Progress**: "Processing Level 0 (utilities)... Level 1 (services)..."

**File Filtering:**

The scanner uses three layers of filtering to exclude non-source files:

| Layer | Source | Examples |
|-------|--------|----------|
| **Default (90+ patterns)** | Built-in | `node_modules/`, `dist/`, `build/`, `.cache/`, `coverage/` |
| **Gitignore** | `.gitignore` file | Custom project exclusions, auto-converted to glob format |
| **Framework-specific** | Detected framework | `.next/` (Next.js), `.nuxt/` (Nuxt), `.astro/` (Astro) |

Patterns from `.gitignore` are converted: `node_modules` → `**/node_modules/**`, `/build` → `build/**`, `*.log` → `**/*.log`

### Query Flow (Hybrid Search)

```
User Query: "how does authentication work?"
       │
       ├──► Vector Similarity (CozoDB HNSW indices)
       │
       ├──► Keyword Matching (CozoDB text search)
       │
       └──► Graph Traversal (CozoScript Datalog)
       │
       ▼
   Result Merger → Ranked Results → Graph Enrichment
```

---

## Storage Architecture

### Directory Structure

```
project-root/
└── .code-synapse/
    ├── config.json          # Project configuration
    ├── data/                # CozoDB database (RocksDB)
    │   └── graph.db/        # Graph + vector storage
    └── logs/                # Application logs
```

### Graph Schema

**Node Types:**
- `file` - Source files with path, hash, language
- `function` - Functions with signature, async flag, JSDoc
- `class` - Classes with methods, properties
- `interface` - TypeScript interfaces
- `variable` - Module-level variables and constants

**Relationship Types:**
- `contains` - File contains Function/Class/Interface/Variable
- `calls` - Function calls Function
- `imports` - File imports from File
- `extends` - Class extends Class
- `implements` - Class implements Interface

---

## MCP Protocol Integration

### How MCP Works with Code-Synapse

```
┌─────────────────┐     stdio/SSE      ┌─────────────────┐
│   AI Agent      │◄──────────────────►│  Code-Synapse   │
│  (Claude Code)  │                    │   MCP Server    │
└─────────────────┘                    └─────────────────┘
        │                                      │
        │  1. List tools                       │
        │  2. Call tool with params            │
        │  3. Receive results                  │
        ▼                                      ▼
   Agent uses results              Query graph + vectors
   to understand code              Format for LLM consumption
```

### Available MCP Tools

| Tool | Purpose |
|------|---------|
| `search_code` | Hybrid search across symbols, content, semantics |
| `get_function` | Retrieve function details with call graph |
| `get_class` | Retrieve class with inheritance hierarchy |
| `get_file` | Get file contents and symbols |
| `get_callers` | Find all callers of a function |
| `get_callees` | Find all functions called by a function |
| `get_imports` | Get import chain for a file |
| `get_project_stats` | Get project statistics |

### Available MCP Resources

| Resource | URI Pattern | Purpose |
|----------|-------------|---------|
| File content | `file://{path}` | Raw file content |
| Symbol list | `symbols://{path}` | Symbols in a file |
| Project graph | `graph://` | High-level project structure |

---

## Web Viewer & Natural Language Search

### Web Viewer Overview

The Web Viewer provides a visual dashboard and REST API for exploring indexed code without requiring AI agent integration. It runs as an HTTP server alongside the MCP server.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Web Browser                              │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ViewerServer (Node HTTP)                      │
│  • Static file serving (dashboard UI)                            │
│  • REST API routing                                              │
│  • CORS handling                                                 │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      IGraphViewer Interface                      │
│  • getOverviewStats()        • listFiles()                       │
│  • searchByName()            • getFunction()                     │
│  • nlSearch()                • getCallers()                      │
│  • getMostComplexFunctions() • getImports()                      │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        CozoGraphViewer                           │
│  • CozoScript query execution                                    │
│  • NL Search integration                                         │
└─────────────────────────────────────────────────────────────────┘
```

### REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats/overview` | GET | Index statistics (files, functions, etc.) |
| `/api/stats/languages` | GET | Language distribution |
| `/api/stats/complexity` | GET | Complexity distribution |
| `/api/files` | GET | List indexed files |
| `/api/functions` | GET | List indexed functions |
| `/api/functions/most-complex` | GET | Most complex functions |
| `/api/classes` | GET | List indexed classes |
| `/api/search?q=term` | GET | Search by name |
| `/api/nl-search?q=query` | GET | Natural language search |
| `/api/nl-search/patterns` | GET | Supported NL query patterns |
| `/api/health` | GET | Index health status |

### Natural Language Search

The NL Search feature allows querying the codebase using plain English. It uses pattern-based intent classification to convert natural language queries into CozoScript database queries.

#### Supported Intents

| Intent | Example Queries | Description |
|--------|-----------------|-------------|
| `rank_complexity` | "most complex functions", "complex code" | Find highest cyclomatic complexity |
| `rank_size` | "largest files", "biggest classes" | Rank by byte size |
| `find_location` | "where is createParser", "location of main" | Find symbol locations |
| `filter_scope` | "functions in src/cli", "code in parser/" | Filter by directory |
| `show_callers` | "what calls createParser", "callers of main" | Find calling functions |
| `show_callees` | "what does main call", "functions called by X" | Find called functions |
| `show_hierarchy` | "classes extending Error", "inheritance tree" | Class hierarchy |
| `find_dependencies` | "external dependencies", "npm imports" | External packages |

#### NL Search Architecture

```
User Query: "most complex functions"
       │
       ▼
┌──────────────────┐
│ Intent Classifier │  Pattern matching + confidence scoring
└──────────────────┘
       │
       ▼
┌──────────────────┐
│  Query Builder   │  Generates CozoScript queries
└──────────────────┘
       │
       ▼
┌──────────────────┐
│    CozoDB        │  Executes Datalog query
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Result Formatter │  Structured JSON response
└──────────────────┘
```

#### Example Response

```json
{
  "query": "most complex functions",
  "intent": {
    "intent": "rank_complexity",
    "confidence": 0.9,
    "keywords": ["most", "complex", "functions"]
  },
  "results": [
    {
      "id": "func_123",
      "name": "writeBatchToDb",
      "complexity": 33,
      "file_path": "src/core/graph/operations.ts"
    }
  ],
  "totalCount": 45,
  "executionTimeMs": 12
}
```

---

## Web Viewer UI Architecture

### Design Philosophy

The Web Viewer follows these core principles:

| Principle | Implementation |
|-----------|----------------|
| **Knowledge-First** | UI reflects the knowledge graph, not raw files. Every view answers "what does this code mean?" |
| **Unified Mental Model** | Single coherent system with cross-linked navigation. No siloed pages. |
| **Actionable Everywhere** | Every visible concept is inspectable, queryable, and operable |
| **Backend Parity** | 100% of MCP/REST operations exposed. No hidden capabilities. |
| **Human-Centric** | Optimized for human comprehension. Agents use MCP only. |

### Visual Language

```
┌─────────────────────────────────────────────────────────────────┐
│  CONFIDENCE INDICATORS                                          │
├─────────────────────────────────────────────────────────────────┤
│  ████████████  High (≥0.8)    → Green, solid                   │
│  ████████░░░░  Medium (0.5-0.8) → Yellow, partial              │
│  ████░░░░░░░░  Low (0.3-0.5)  → Orange, sparse                 │
│  ██░░░░░░░░░░  Uncertain (<0.3) → Red, pulsing                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  ENTITY TYPE BADGES                                             │
├─────────────────────────────────────────────────────────────────┤
│  [F] Function   → Blue        [C] Class      → Purple          │
│  [I] Interface  → Cyan        [V] Variable   → Gray            │
│  [T] TypeAlias  → Teal        [📁] File      → Yellow          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  CLASSIFICATION BADGES                                          │
├─────────────────────────────────────────────────────────────────┤
│  DOMAIN: [Auth] [Billing] [User] [Notification] → Blue tones   │
│  INFRA:  [DB] [Cache] [HTTP] [Logging] [Config] → Gray tones   │
└─────────────────────────────────────────────────────────────────┘
```

### UI Sections

The Web Viewer is organized into 6 main sections:

| Section | Purpose | Key Features |
|---------|---------|--------------|
| **Explorer** | Navigate codebase through files and entities | File tree, code viewer (Monaco), entity details |
| **Knowledge** | Explore business meaning and justifications | Faceted filters, clarification workflow, confidence scores |
| **Graph** | Visualize relationships as interactive graphs | Call graph, import graph, inheritance, knowledge clusters |
| **Search** | Find entities using multiple search modes | Natural language, structural, semantic, diagnostic |
| **Operations** | Execute MCP operations and view status | Indexing, justification, reconciliation panels |
| **Observability** | Inspect system internals | Change ledger, project memory, compaction, health |

### Component Library

#### Core Component Interfaces

```typescript
// EntityCard - Displays entity with justification and classification
interface EntityCardProps {
  entity: {
    id: string;
    name: string;
    type: 'function' | 'class' | 'interface' | 'variable' | 'file';
    filePath: string;
    line?: number;
  };
  justification?: {
    purposeSummary: string;
    featureContext: string;
    confidenceScore: number;
    clarificationPending: boolean;
  };
  classification?: {
    category: 'domain' | 'infrastructure';
    area: string;
  };
  showActions?: boolean;
  compact?: boolean;
}

// ConfidenceIndicator - Visual confidence score display
interface ConfidenceIndicatorProps {
  score: number;        // 0-1
  level: 'high' | 'medium' | 'low' | 'uncertain';
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

// GraphViewer - Interactive graph visualization
interface GraphViewerProps {
  type: 'call' | 'import' | 'inheritance' | 'knowledge';
  focusEntity?: string;
  depth?: number;
  layout?: 'force' | 'hierarchical' | 'circular';
  onNodeClick?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
}

// CodeViewer - Monaco-based code display
interface CodeViewerProps {
  filePath: string;
  language: string;
  highlightLines?: number[];
  entityMarkers?: Array<{
    line: number;
    type: 'definition' | 'reference';
    entityId: string;
  }>;
  onEntityClick?: (entityId: string) => void;
}
```

### UI State Management

```
┌─────────────────────────────────────────────────────────────────┐
│                      GLOBAL STATE                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐          │
│  │   Project   │   │  UI State   │   │   Cache     │          │
│  │   Context   │   │             │   │             │          │
│  ├─────────────┤   ├─────────────┤   ├─────────────┤          │
│  │ projectId   │   │ activeView  │   │ entities    │          │
│  │ stats       │   │ selectedId  │   │ graphs      │          │
│  │ config      │   │ filters     │   │ searches    │          │
│  │ mcpStatus   │   │ modals      │   │ ledger      │          │
│  └─────────────┘   └─────────────┘   └─────────────┘          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   OPERATIONS STATE                       │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ indexing: { status, progress, currentFile, log }        │   │
│  │ justification: { status, progress, batch, stats }       │   │
│  │ reconciliation: { gaps, status, preview }               │   │
│  │ adaptive: { paused, hotEntities, coldEntities }         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### UI Technology Stack

| Category | Library | Rationale |
|----------|---------|-----------|
| **Framework** | React 18+ | Component model, ecosystem |
| **State** | Zustand | Simple, performant global state |
| **Routing** | React Router v6 | Section navigation |
| **Styling** | Tailwind CSS | Utility-first, consistent design |
| **Components** | Radix UI | Accessible primitives |
| **Code Viewer** | Monaco Editor | VS Code engine, syntax highlighting |
| **Graph** | Cytoscape.js | Feature-rich graph visualization |
| **Charts** | Recharts | Simple, React-native charts |
| **Tables** | TanStack Table | Sorting, filtering, pagination |

### Real-time Updates

```typescript
// WebSocket connection for live updates
const ws = new WebSocket('ws://localhost:3100/ws');

ws.onmessage = (event) => {
  const { type, payload } = JSON.parse(event.data);

  switch (type) {
    case 'indexing:progress':
      updateIndexingProgress(payload);
      break;
    case 'justification:progress':
      updateJustificationProgress(payload);
      break;
    case 'ledger:entry':
      appendLedgerEntry(payload);
      break;
    case 'entity:updated':
      invalidateEntityCache(payload.entityId);
      break;
  }
};
```

---

## LLM Integration

### Model Registry

Code-Synapse includes a comprehensive model registry with 12 models across 4 families:

| Preset | Model | Parameters | RAM | Use Case |
|--------|-------|------------|-----|----------|
| `fastest` | Qwen 2.5 Coder 0.5B | 0.5B | 1GB | Ultra-fast, minimal resources |
| `minimal` | Qwen 2.5 Coder 1.5B | 1.5B | 2GB | Laptops with limited RAM |
| `balanced` | Qwen 2.5 Coder 3B | 3B | 4GB | **Recommended default** |
| `quality` | Qwen 2.5 Coder 7B | 7B | 8GB | Production-quality analysis |
| `maximum` | Qwen 2.5 Coder 14B | 14B | 16GB | Maximum quality |

### Model Families

| Family | Models | Strengths |
|--------|--------|-----------|
| **Qwen 2.5 Coder** | 0.5B, 1.5B, 3B, 7B, 14B | Best-in-class for code, recommended |
| **Llama 3.x** | 1B, 3B, 8B | General-purpose, Meta's latest |
| **CodeLlama** | 7B, 13B | Code-specialized, proven |
| **DeepSeek Coder** | 1.3B, 6.7B | Strong alternative to Qwen |

### Cloud Providers

Code-Synapse supports cloud model providers as an alternative to local models:

| Provider | Models | API Key Environment Variable |
|----------|--------|------------------------------|
| **OpenAI** | GPT-4o, GPT-4o Mini | `OPENAI_API_KEY` |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Haiku | `ANTHROPIC_API_KEY` |
| **Google** | Gemini 1.5 Pro, Gemini 1.5 Flash | `GOOGLE_API_KEY` |

**Configuration:**
```bash
# Interactive setup wizard
code-synapse config --setup

# Command-line configuration
code-synapse config --provider openai --api-key sk-xxx
```

### Dynamic Model Switching

Models can be switched at any time without affecting indexed data:

```bash
# Change default provider
code-synapse config --provider anthropic

# One-off provider override (doesn't change config)
code-synapse justify -p openai --model-id gpt-4o

# Switch back to local for privacy
code-synapse config --provider local --model balanced
```

**Hybrid Strategy Pattern:**
```
┌─────────────────────────────────────────────────────────────────────┐
│                    Optimal Model Usage Strategy                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Initial Indexing          Day-to-Day Operations                    │
│   ─────────────────         ────────────────────                    │
│                                                                      │
│   ┌─────────────────┐       ┌─────────────────┐                     │
│   │   Cloud Model   │       │   Local Model   │                     │
│   │  (Claude 3.5)   │       │  (Qwen 3B)      │                     │
│   │                 │       │                 │                     │
│   │  • High quality │       │  • Privacy      │                     │
│   │  • One-time cost│       │  • Zero cost    │                     │
│   │  • Best accuracy│       │  • Offline      │                     │
│   └────────┬────────┘       └────────┬────────┘                     │
│            │                         │                              │
│            └─────────┬───────────────┘                              │
│                      │                                              │
│            ┌─────────▼─────────┐                                    │
│            │  Knowledge Graph  │                                    │
│            │  (Justifications  │                                    │
│            │   persisted)      │                                    │
│            └───────────────────┘                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

This pattern maximizes initial quality while maintaining privacy and cost efficiency for ongoing development.

### Inference Features

- **GBNF Grammar Constraints**: Forces syntactically valid JSON output from small models
- **Confidence Scoring**: Quality metrics for inferred business logic
- **GraphRAG Pattern**: Hierarchical summarization (Function → Module → System)
- **Caching**: Results cached to avoid redundant inference

---

## Key Design Decisions

| Decision | Component | Rationale |
|----------|-----------|-----------|
| **TypeScript 5.2 `using`** | Resource Management | Automatic cleanup prevents memory leaks in long-running sidecar |
| **Schema Source of Truth** | Graph Database | Single source generates CozoScript DDL and TypeScript types |
| **CozoDB Unified Storage** | Storage Layer | Single database for graph + vectors eliminates sync complexity |
| **Result<T,E> type** | Error Handling | Clean error handling without exceptions |
| **Object Pool pattern** | Parser/DB | Reuse expensive resources (parsers, connections) |
| **UCE Interface** | Parser | Language-agnostic output enables polyglot support |
| **Worker Thread Isolation** | Semantic Analysis | Non-blocking analysis, prevents MCP timeouts |
| **Transactional Atomicity** | Graph Updates | Prevents corruption from interrupted updates |
| **RxJS reactive streams** | File Watching | Handles git checkout floods with backpressure |
| **GBNF Grammars** | LLM Output | Guarantees valid JSON from small local models |

---

## Implementation Status

### All Phases Complete ✅

| Phase | Name | Status |
|-------|------|--------|
| H1 | Core Foundation | ✅ Complete |
| H2 | Resource Management | ✅ Complete |
| H3 | Schema & Types | ✅ Complete |
| H4 | Async Infrastructure | ✅ Complete |
| H5 | Telemetry | ✅ Complete |
| V1 | Graph Database | ✅ Complete |
| V2 | File Scanner | ✅ Complete |
| V3 | Code Parser | ✅ Complete |
| V4 | Semantic Analysis | ✅ Complete |
| V5 | Entity Extraction | ✅ Complete |
| V6 | Architecture Refactor | ✅ Complete |
| V7 | Graph Builder | ✅ Complete |
| V8 | Indexer & Watcher | ✅ Complete |
| V9 | MCP Server | ✅ Complete |
| V10 | LLM Integration | ✅ Complete |
| V11 | CLI Commands | ✅ Complete |
| V12 | Web Viewer & NL Search | ✅ Complete |
| V13 | Business Justification Layer | ✅ Complete |
| V14 | Business Layer Classification | ✅ Complete |
| V15 | Change Ledger & Observability | ✅ Complete |
| V16 | Adaptive MCP-Driven Indexing | ✅ Complete |
| V17 | Ledger Compaction | ✅ Complete |
| V18 | Ledger Reconciliation | ✅ Complete |
| V19 | Persistent Developer Memory | ✅ Complete |
| V20 | Performance Optimization Layer | ✅ Complete |
| V21 | Multi-Model Intelligence Layer | ✅ Complete |
| V22 | Horizontal Documentation Graph | ✅ Complete |
| V23 | Self-Optimizing Feedback Loops | ✅ Complete |

---

## Testing & Verification

For a **vertical-sliced launch plan** (CLI → Indexing → Justification → AST → UI → Code Query → MCP → Prompts → Skills → Ledger → Graph → Models), see **[LAUNCH-TESTING-PLAN.md](./LAUNCH-TESTING-PLAN.md)**. It defines one slice per major component with acceptance criteria, test steps, and sign-off checklists.

### Test Organization

Code-Synapse testing is organized into three tiers:

| Tier | Type | Location | Purpose |
|------|------|----------|---------|
| **Unit Tests** | Vitest | `src/**/__tests__/*.test.ts` | Test individual modules in isolation |
| **Integration Tests** | Vitest | `src/**/__tests__/*.integration.test.ts` | Test module interactions |
| **E2E Tests** | Shell Script | `scripts/e2e-test.sh` | Test CLI commands and full workflows |

### Test Summary

- **Total Tests**: 539+ passing
- **Unit Tests**: 381+ tests across 10 test files
- **E2E Tests**: 73+ scenarios across 10 sections
- **Test Files**: 20+
- **Skipped**: 6 (MCP transport tests, tested manually)

### Running Tests

```bash
# Unit tests
pnpm test              # Watch mode
pnpm test:ci           # Single run (excludes integration tests)

# E2E tests
./scripts/e2e-test.sh              # Run all tests
./scripts/e2e-test.sh --quick      # Skip LLM tests (faster)
./scripts/e2e-test.sh --section 7  # Run specific section
./scripts/e2e-test.sh --verbose    # Show detailed output
```

### Key Test Files

| File | Purpose |
|------|---------|
| `src/core/justification/__tests__/justification.test.ts` | Justification service |
| `src/core/memory/__tests__/memory.test.ts` | Developer memory |
| `src/core/reconciliation/__tests__/reconciliation.test.ts` | Ledger reconciliation |
| `src/core/ledger/__tests__/compaction.test.ts` | Ledger compaction |
| `src/viewer/__tests__/query-builder.test.ts` | NL Search query building |
| `src/viewer/__tests__/intent-classifier.test.ts` | NL Search intent classification |
| `src/core/parser/__tests__/multi-language.test.ts` | Multi-language parsing |

### E2E Test Sections

| Section | Tests | Description |
|---------|-------|-------------|
| **1. CLI Help** | 8 | Help displays for all commands |
| **2. Initialization** | 9 | Project init workflow |
| **3. Indexing** | 5 | Code indexing functionality |
| **4. Status** | 7 | Project status display |
| **5. Configuration** | 3 | Config management |
| **6. Model Listing** | 16 | Model registry display |
| **7. Web Viewer API** | 11 | REST API endpoints |
| **8. Justification** | 3 | Business justification |
| **9. Incremental Updates** | 3 | File change detection |
| **10. Error Handling** | 4 | Error scenarios |

### API Endpoint Testing

```bash
# Start viewer
code-synapse viewer -p 3100 &

# Health & Stats
curl http://127.0.0.1:3100/api/health
curl http://127.0.0.1:3100/api/stats/overview
curl http://127.0.0.1:3100/api/stats/languages

# Entity Lists
curl http://127.0.0.1:3100/api/files
curl http://127.0.0.1:3100/api/functions
curl http://127.0.0.1:3100/api/classes

# Search
curl "http://127.0.0.1:3100/api/search?q=User"
curl "http://127.0.0.1:3100/api/nl-search?q=most+complex+functions"
```

### Performance Benchmarks

| Operation | Target | Actual |
|-----------|--------|--------|
| **Indexing 50 files** | < 3 seconds | ✅ |
| **Indexing 100 files** | < 5 seconds | ✅ |
| **Indexing 500 files** | < 20 seconds | ✅ |
| **Simple search** | < 50ms | ✅ |
| **NL search** | < 100ms | ✅ |
| **100 parses** | < 5 seconds | ✅ |
| **50 queries** | < 2 seconds | ✅ |

### Memory Benchmarks

| Operation | Target |
|-----------|--------|
| **Indexing 100 files** | < 200MB |
| **Running viewer** | < 100MB |

### Key Verifications

- CLI commands execute without errors (init, index, justify, status, config, start, viewer)
- File scanner discovers project files correctly
- Parser extracts functions, classes, imports for 24 languages
- Graph database CRUD operations work
- Incremental updates process correctly
- File watcher detects and batches changes
- MCP tools respond correctly
- LLM model registry functional with 12 models
- Web Viewer with REST API and NL Search
- Business Justification with LLM inference and clarification
- Business Layer Classification with Domain/Infrastructure categorization
- Change Ledger with append-only event logging and queries
- Adaptive Indexer with query observation and semantic correlation
- Ledger Compaction with session-aware grouping and intent clustering
- Ledger Reconciliation with Git-based gap detection and synthetic entries
- Persistent Memory with rule learning and confidence decay
- Performance Optimization with LRU caches, bloom filters, and worker pools
- Multi-Model routing with local and cloud provider support
- Horizontal Documentation with known registry and NPM metadata fetching
- Self-Optimizing Feedback with automatic routing adjustments

### Troubleshooting Test Failures

**Database Lock Error**
```bash
pkill -f "code-synapse"
rm -f .code-synapse/data/cozodb/data/LOCK
```

**Port Already in Use**
```bash
pkill -f "viewer"
pkill -f "code-synapse start"
code-synapse viewer -p 3200  # Use different port
```

**Tree-sitter WASM Error**
```bash
pnpm install
pnpm build
```

**LLM Model Not Found**
```bash
code-synapse justify --skip-llm  # Test without LLM
code-synapse config --provider anthropic  # Or configure cloud
```

**Debug Mode**
```bash
LOG_LEVEL=debug code-synapse index
code-synapse start --debug
```

**Reset Test State**
```bash
rm -rf .code-synapse && code-synapse init && code-synapse index
```

### Adding New Tests

**E2E Test Template** (in `scripts/e2e-test.sh`):
```bash
if [ -z "$SECTION" ] || [ "$SECTION" = "N" ]; then
    log_section "Section N: New Feature"
    cd "$TEST_DIR/test-project"
    run_test "description" "command" expected_exit_code
    run_test_contains "description" "command" "expected_string"
    cd "$PROJECT_ROOT"
fi
```

**Unit Test Template**:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('NewFeature', () => {
  beforeEach(async () => { /* Setup */ });
  afterEach(async () => { /* Cleanup */ });

  it('should do something', async () => {
    expect(result).toBe(expected);
  });
});
```

---

## Risk Mitigations

### Memory Pressure from TypeScript Compiler

**Risk**: TypeScript Compiler API is synchronous, blocking, and memory-intensive.

**Mitigation**: Isolate semantic analysis in dedicated Worker Thread. Main thread stays responsive for MCP queries.

### Schema Drift Between Code and Database

**Risk**: Maintaining separate CozoScript DDL and TypeScript interfaces manually causes drift.

**Mitigation**: Single Schema Source of Truth that generates both CozoScript DDL and TypeScript types.

### Data Corruption from Interrupted Updates

**Risk**: If process killed between deletion and insertion during incremental updates, graph is corrupted.

**Mitigation**: Wrap entire file update in single database transaction with automatic rollback on failure.

### File Watcher Floods

**Risk**: `git checkout` triggers hundreds of file events instantly, overwhelming indexer.

**Mitigation**: RxJS reactive streams with bufferTime, deduplication, and controlled concurrency.

### LLM Output Reliability

**Risk**: Small models produce malformed JSON, polluting the database.

**Mitigation**: GBNF grammar-constrained sampling forces syntactically valid output.

---

## Future Roadmap

### Planned Features

**High Priority (Post-Beta):**
- Performance optimizations for large codebases (10,000+ files)
- Windows platform support improvements
- Better error messages and diagnostics
- Additional MCP tools based on user feedback
- Improved logging and debugging capabilities

**Intelligence Enhancements:**
- Full GraphRAG hierarchical summarization
- Cross-model quality scoring for output comparison

**Feature Enhancements:**
- Cross-repository dependency mapping
- IDE Extensions (VS Code sidebar)
- Additional LLM models via model registry
- Enhanced Web UI dashboard (graph visualization, filtering)
- Export/import knowledge graphs
- Additional language support (Swift, Dart, Elixir, Lua - pending WASM)

### Scalability Considerations

- Graph database can be sharded by directory for monorepos
- Vector embeddings computed incrementally
- LLM inference batched and prioritized
- Telemetry enables identifying bottlenecks as codebases grow
- Database size optimization (compression, pruning old data)

## Extension Points

### Adding Language Support

To add support for a new language:

1. **Add Tree-sitter Grammar**: Install the language grammar package
2. **Extend Parser**: Add language-specific parsing logic in `src/core/parser/`
3. **Update UCE Mapping**: Map language constructs to Universal Code Entities
4. **Add Tests**: Create integration tests for the new language

Example structure:
```typescript
// src/core/parser/go-parser.ts
export class GoParser implements IParser {
  // Implement IParser interface
  async parseCode(code: string, filePath: string): Promise<ParsedFile> {
    // Parse Go code using tree-sitter-go
  }
}
```

### Adding Custom Extractors

Extractors can be extended to capture domain-specific patterns:

```typescript
// src/core/extraction/custom-extractor.ts
export class CustomExtractor implements IExtractor {
  extract(parsedFile: ParsedFile): ExtractionResult {
    // Extract custom entities and relationships
  }
}
```

### Adding MCP Tools

New MCP tools can be added in `src/mcp/tools.ts`:

```typescript
export async function myCustomTool(
  graphStore: GraphDatabase,
  args: MyToolArgs
): Promise<MyToolResult> {
  // Implement tool logic
  // Query graph database
  // Return formatted results
}
```

Then register in `src/mcp/server.ts`:
```typescript
case "my_custom_tool": {
  const result = await myCustomTool(graphStore, args);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}
```

## Security Considerations

### Data Privacy

- **Local Processing**: All code analysis happens on your machine
- **No Network Calls**: No external API requests (except optional model downloads)
- **Embedded Database**: CozoDB runs embedded, no external database server
- **No Telemetry**: No usage data is sent to external services

### Access Control

- **File System**: Code-Synapse only reads files within the project directory
- **Permissions**: Respects file system permissions
- **Sandboxing**: Can be run in isolated environments (Docker, VMs)

### Best Practices

- Keep Code-Synapse updated for security patches
- Review MCP server configuration before connecting
- Use project-specific configurations for sensitive projects
- Regularly audit indexed data in `.code-synapse/` directory

---

## API Reference

### Core Interfaces

#### IParser

Universal code parser interface for language-agnostic parsing:

```typescript
interface IParser {
  parseCode(code: string, filePath: string): Promise<ParsedFile>;
  initialize(): Promise<void>;
  close(): Promise<void>;
}
```

#### IGraphStore

Graph database operations interface:

```typescript
interface IGraphStore {
  query<T>(query: string): Promise<QueryResult<T>>;
  writeBatch(batch: CozoBatch): Promise<void>;
  hasSchema(): Promise<boolean>;
  getSchemaVersion(): Promise<number>;
  close(): Promise<void>;
}
```

#### IScanner

File discovery interface:

```typescript
interface IScanner {
  scan(projectRoot: string): Promise<FileInfo[]>;
  detectChanges(files: FileInfo[]): Promise<ChangeSet>;
}
```

### Extension Points

See [Extension Points](#extension-points) section for details on extending Code-Synapse.

## Technology References

### Production Dependencies

| Library | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| **cozo-node** | ^0.7.6 | Graph + vector database | [CozoDB Docs](https://docs.cozodb.org/en/latest/) |
| **web-tree-sitter** | ^0.26.3 | WASM-based AST parsing | [Tree-sitter Docs](https://tree-sitter.github.io/tree-sitter/) |
| **tree-sitter-typescript** | ^0.23.2 | TypeScript/TSX grammar | [GitHub](https://github.com/tree-sitter/tree-sitter-typescript) |
| **tree-sitter-javascript** | ^0.25.0 | JavaScript grammar | [GitHub](https://github.com/tree-sitter/tree-sitter-javascript) |
| **@huggingface/transformers** | ^3.5.1 | Local embeddings (ONNX) | [Transformers.js Docs](https://huggingface.co/docs/transformers.js) |
| **node-llama-cpp** | ^3.14.5 | Local LLM inference | [Docs](https://withcatai.github.io/node-llama-cpp/) |
| **@modelcontextprotocol/sdk** | ^1.25.1 | MCP server implementation | [MCP Spec](https://modelcontextprotocol.io/) |
| **commander** | ^14.0.2 | CLI framework | [Commander.js Docs](https://github.com/tj/commander.js) |
| **chalk** | ^5.6.2 | Terminal colors | [Chalk Docs](https://github.com/chalk/chalk) |
| **ora** | ^9.0.0 | Terminal spinners | [Ora Docs](https://github.com/sindresorhus/ora) |
| **chokidar** | ^5.0.0 | File watching | [Chokidar Docs](https://github.com/paulmillr/chokidar) |
| **fast-glob** | ^3.3.3 | Fast file matching | [fast-glob Docs](https://github.com/mrmlnc/fast-glob) |
| **pino** | ^10.1.0 | Structured logging | [Pino Docs](https://getpino.io/) |
| **zod** | ^4.2.1 | Schema validation | [Zod Docs](https://zod.dev/) |

### Development Dependencies

| Library | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| **typescript** | 5.9.2 | TypeScript compiler | [TypeScript Docs](https://www.typescriptlang.org/docs/) |
| **vitest** | ^4.0.16 | Testing framework | [Vitest Docs](https://vitest.dev/) |
| **eslint** | ^9.39.1 | Code linting | [ESLint Docs](https://eslint.org/docs/) |
| **prettier** | ^3.7.4 | Code formatting | [Prettier Docs](https://prettier.io/docs/en/) |

### Embedding Models

| Model | Dimensions | Use Case |
|-------|------------|----------|
| `all-MiniLM-L6-v2` | 384 | Fast, general-purpose |
| `all-mpnet-base-v2` | 768 | Higher quality, slower |
| `bge-small-en-v1.5` | 384 | Good for code |

### Why CozoDB? (Comparison with Alternatives)

| Feature | CozoDB | Neo4j | KuzuDB | SQLite |
|---------|--------|-------|--------|--------|
| **Embedded** | ✅ | ❌ | ✅ | ✅ |
| **Native Vectors** | ✅ HNSW | ❌ | ❌ | ❌ |
| **Recursive Queries** | ✅ Datalog | ✅ Cypher | ✅ Cypher | ❌ |
| **JSON Support** | ✅ Native | ✅ | ✅ | ❌ |
| **Transactions** | ✅ Block | ✅ | ✅ | ✅ |
| **Storage Backend** | RocksDB | Custom | Custom | File |

**Key Benefits:**

1. **Single Database** - Graph + Vector in one store (eliminates sync issues)
2. **Datalog** - More expressive recursive queries than Cypher
3. **Embedded** - No external server, perfect for CLI tool
4. **RocksDB Backend** - Proven performance and reliability

### Quick Links

- [CozoDB Tutorial](https://docs.cozodb.org/en/latest/tutorial.html)
- [CozoDB Functions](https://docs.cozodb.org/en/latest/functions.html)
- [Tree-sitter Query Syntax](https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax)
- [MCP Protocol Spec](https://modelcontextprotocol.io/specification)
- [TypeScript AST Viewer](https://ts-ast-viewer.com/)
- [node-llama-cpp Documentation](https://withcatai.github.io/node-llama-cpp/)

---

*Last Updated: January 16, 2026*

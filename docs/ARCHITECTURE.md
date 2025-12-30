# Code-Synapse Architecture

**Zero-Config Smart Sidecar for AI Agents**

This document describes the high-level architecture, technology choices, and design decisions for Code-Synapse - an agent-first knowledge engine that transforms raw code into a structured Knowledge Graph optimized for machine reasoning.

---

## Table of Contents

1. [Overview](#overview)
2. [Core Architecture Principles](#core-architecture-principles)
3. [Three-Layer Knowledge Model](#three-layer-knowledge-model)
4. [System Architecture](#system-architecture)
5. [Technology Stack](#technology-stack)
6. [Data Flow Pipeline](#data-flow-pipeline)
7. [Component Architecture](#component-architecture)
8. [Storage Architecture](#storage-architecture)
9. [MCP Protocol Integration](#mcp-protocol-integration)
10. [Key Architectural Decisions](#key-architectural-decisions)
11. [Risk Mitigations](#risk-mitigations)

---

## Overview

Code-Synapse is a local CLI "sidecar" that runs alongside AI agents (Claude Code, Cursor, Windsurf) via the MCP (Model Context Protocol). It provides:

- **Real-time Code Understanding**: Watches file changes and maintains an up-to-date knowledge graph
- **Semantic Search**: Combines vector embeddings, keyword search, and graph traversal
- **Cross-File Intelligence**: Tracks function calls, type hierarchies, and module dependencies
- **Local LLM Inference**: Uses small local models for business logic summarization

### What Makes It Different

| Traditional Approach | Code-Synapse Approach |
|---------------------|----------------------|
| Cloud-based code intelligence | Fully local, privacy-first |
| Requires API keys | Zero external dependencies |
| Keyword-only search | Hybrid semantic + graph search |
| Static analysis | Real-time incremental updates |
| Language-specific tools | Polyglot via Universal Code Entities |

---

## Core Architecture Principles

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

## System Architecture

### High-Level System Diagram

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
│   │ init │ start │ index│   │        │   │  Tools  │  Resources        │   │
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
│  │  │  File Watcher (RxJS) ──► Buffer ──► Dedupe ──► Process Batch    │  │ │
│  │  └──────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                          │
│  ┌────────────────┬───────────────┼───────────────┬────────────────────┐    │
│  ▼                ▼               ▼               ▼                    ▼    │
│ ┌──────┐    ┌─────────┐    ┌───────────┐    ┌─────────┐          ┌──────┐  │
│ │Parser│    │ Semantic│    │   Graph   │    │ Vector  │          │ LLM  │  │
│ │(UCE) │    │ Worker  │    │  Store    │    │  Store  │          │Service│ │
│ └──────┘    └─────────┘    └───────────┘    └─────────┘          └──────┘  │
│                  │                                                          │
│          ┌───────┴───────┐                                                  │
│          │ Worker Thread │                                                  │
│          │ (TS Compiler) │                                                  │
│          └───────────────┘                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Storage Layer                                        │
│   ┌────────────────────┐    ┌─────────────────────────────────────────────┐  │
│   │  .code-synapse/    │    │  CozoDB (RocksDB Backend)                    │  │
│   │  ├── data/         │    │  ├── Structural Graph (Nodes, Relationships) │  │
│   │  └── config.json   │    │  └── Vector Embeddings (HNSW Indices)        │  │
│   └────────────────────┘    └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Three-Part Design

| Part | Purpose | Technology |
|------|---------|------------|
| **CLI** | User interface for configuration and management | Commander.js, Chalk, Ora |
| **MCP Server** | AI agent communication via Model Context Protocol | @modelcontextprotocol/sdk |
| **Core** | Shared business logic used by both CLI and MCP | TypeScript modules |

---

## Technology Stack

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
| **Orama** | Fuzzy search | In-memory, typo-tolerant, sub-millisecond |

> **Note**: CozoDB provides both graph storage AND native vector search via HNSW indices. This unified approach eliminates synchronization issues between separate databases.

### Intelligence Layer

| Technology | Purpose | Why This Choice |
|------------|---------|-----------------|
| **node-llama-cpp** | Local LLM inference | GBNF grammar support, no API keys |
| **HuggingFace Transformers.js** | Embeddings | ONNX runtime, local generation |
| **Model Registry** | Model selection | 12 models across 4 families |

#### Supported LLM Models

Code-Synapse includes a comprehensive model registry with presets for different hardware configurations:

| Preset | Model | Parameters | RAM | Use Case |
|--------|-------|------------|-----|----------|
| `fastest` | Qwen 2.5 Coder 0.5B | 0.5B | 1GB | Ultra-fast, minimal resources |
| `minimal` | Qwen 2.5 Coder 1.5B | 1.5B | 2GB | Laptops with limited RAM |
| `balanced` | Qwen 2.5 Coder 3B | 3B | 4GB | **Recommended default** |
| `quality` | Qwen 2.5 Coder 7B | 7B | 8GB | Production-quality analysis |
| `maximum` | Qwen 2.5 Coder 14B | 14B | 16GB | Maximum quality |

**Model Families:**

| Family | Models | Strengths |
|--------|--------|-----------|
| **Qwen 2.5 Coder** | 0.5B, 1.5B, 3B, 7B, 14B | Best-in-class for code, recommended |
| **Llama 3.x** | 1B, 3B, 8B | General-purpose, Meta's latest |
| **CodeLlama** | 7B, 13B | Code-specialized, proven |
| **DeepSeek Coder** | 1.3B, 6.7B | Strong alternative to Qwen |

**Usage:**
```typescript
// Using preset (recommended)
const llm = await createInitializedLLMServiceWithPreset("balanced");

// Using specific model ID
const llm = await createInitializedLLMService({ modelId: "qwen2.5-coder-7b" });

// Using custom model path
const llm = await createInitializedLLMService({ modelPath: "/path/to/model.gguf" });
```

### Infrastructure Layer

| Technology | Purpose | Why This Choice |
|------------|---------|-----------------|
| **RxJS** | Reactive event handling | Backpressure, batching, deduplication |
| **Pino** | Structured logging | Fast, JSON output, component context |
| **Zod** | Schema validation | Runtime type safety, good error messages |
| **OpenTelemetry** | Performance tracing | Bottleneck identification, debugging |

---

## Data Flow Pipeline

### Indexing Flow

```
┌────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌────────┐
│ File   │──►│ Scanner │──►│ Parser  │──►│Semantic │──►│ Graph   │──►│ Vector │
│ System │   │         │   │ (UCE)   │   │ Worker  │   │ Writer  │   │ Writer │
└────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘   └────────┘
                                                             │
                                                             ▼
                                                       ┌───────────┐
                                                       │ LLM       │
                                                       │ Inference │
                                                       │ (async)   │
                                                       └───────────┘
```

### Query Flow (Hybrid Search)

```
User Query: "how does authentication work?"
       │
       ├──► Orama (Fuzzy) ──► Symbol names with typos tolerated
       │
       ├──► CozoDB (Semantic) ──► Vector similarity via HNSW indices
       │
       └──► CozoDB (Structural) ──► Exact matches + graph context
       │
       ▼
   Result Merger
       │
       ▼
   Ranked Results (items found in multiple sources boosted)
       │
       ▼
   Graph Enrichment (add callers, callees, dependencies)
```

---

## Component Architecture

### Build Order: Horizontals First, Then Verticals

**Horizontals** are cross-cutting infrastructure used across the entire project.
**Verticals** are feature-specific modules that build on top of horizontals.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VERTICALS (Features)                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │   V1    │ │   V2    │ │   V3    │ │   V4    │ │   V5    │ │   V6    │   │
│  │  Graph  │ │ Scanner │ │ Parser  │ │Semantic │ │  MCP    │ │  LLM    │   │
│  │   DB    │ │         │ │  (UCE)  │ │ Worker  │ │ Server  │ │Inference│   │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘   │
└───────┼──────────┼──────────┼──────────┼──────────┼──────────┼─────────────┘
        │          │          │          │          │          │
┌───────┴──────────┴──────────┴──────────┴──────────┴──────────┴─────────────┐
│                         HORIZONTALS (Infrastructure)                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ H5: Telemetry         │ OpenTelemetry tracing, @traced() decorator   │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ H4: Async Utils       │ Result<T,E>, Pool, Events, Retry, Deferred   │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ H3: Schema + Types    │ Schema Source of Truth, UCE types, Zod       │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ H2: Resource Mgmt     │ TypeScript 5.2 using, Disposable interfaces  │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ H1: Core Foundation   │ Logger, Errors, FS utils, Config paths       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
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
| **V5-V6: Entity Extraction** | Graph building | Function/Class extraction, atomic writes |
| **V7: Indexer & Watcher** | Orchestration | RxJS file watching, incremental updates |
| **V8: MCP Server** | Agent communication | Tools, resources, hybrid search |
| **V9: LLM Integration** | Business logic | GBNF grammars, GraphRAG, confidence scoring |
| **V10: CLI Commands** | User interface | Full command implementations |

---

## Storage Architecture

### Directory Structure

```
project-root/
└── .code-synapse/
    ├── config.json          # Project configuration
    ├── data/                # CozoDB database (RocksDB)
    │   ├── *.sst            # RocksDB sorted string tables
    │   ├── CURRENT          # Current manifest pointer
    │   ├── MANIFEST-*       # Database manifest
    │   └── OPTIONS-*        # RocksDB options
    ├── cache/               # Inference cache
    │   └── llm_results.json # Cached LLM outputs
    ├── traces/              # OpenTelemetry traces
    └── logs/                # Application logs
```

> **Note**: CozoDB uses RocksDB as its storage backend, storing both graph data and vector embeddings in a single unified database.

### Graph Schema

**Node Types:**
- `File` - Source files with path, hash, language
- `Function` - Functions with signature, complexity, summary
- `Class` - Classes with methods, properties
- `Interface` - TypeScript interfaces
- `Variable` - Module-level variables and constants

**Relationship Types:**
- `CONTAINS` - File contains Function/Class
- `CALLS` - Function calls Function
- `IMPORTS` - File imports from File
- `EXTENDS` - Class extends Class
- `IMPLEMENTS` - Class implements Interface
- `REFERENCES` - Symbol references Symbol

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
| `get_dependencies` | Module dependency graph for a file |
| `get_callers` | Find all callers of a function |
| `get_callees` | Find all functions called by a function |
| `explain_code` | Get LLM-generated explanation with context |

### Available MCP Resources

| Resource | URI Pattern | Purpose |
|----------|-------------|---------|
| File content | `file://{path}` | Raw file content |
| Symbol list | `symbols://{path}` | Symbols in a file |
| Project graph | `graph://overview` | High-level project structure |

---

## Key Architectural Decisions

### Decision Summary Table

| Decision | Component | Rationale |
|----------|-----------|-----------|
| **TypeScript 5.2 `using`** | Resource Management | Automatic cleanup prevents memory leaks in long-running sidecar |
| **Schema Source of Truth** | Graph Database | Single source generates CozoScript DDL and TypeScript types, preventing drift |
| **Result<T,E> type** | Error Handling | Clean error handling without exceptions, better composition |
| **Object Pool pattern** | Parser/DB | Reuse expensive resources (parsers, connections) |
| **UCE Interface** | Parser | Language-agnostic output enables polyglot support without schema changes |
| **Worker Thread Isolation** | Semantic Analysis | Non-blocking analysis, prevents MCP timeouts on large codebases |
| **Transactional Atomicity** | Graph Updates | Prevents corruption from interrupted incremental updates |
| **RxJS reactive streams** | File Watching | Handles git checkout floods with backpressure |
| **Hybrid Search** | Query Engine | Combines vector similarity, keyword matching, and graph traversal |
| **GBNF Grammars** | LLM Output | Guarantees valid JSON from small local models |
| **GraphRAG pattern** | Summarization | Hierarchical summaries reduce context needed for high-level questions |
| **Orama fuzzy search** | Symbol Search | Sub-millisecond typo-tolerant search |

---

## Risk Mitigations

### Memory Pressure from TypeScript Compiler

**Risk**: TypeScript Compiler API is synchronous, blocking, and memory-intensive. Running in main thread causes MCP timeouts on large codebases (50k+ LOC).

**Mitigation**: Isolate semantic analysis in dedicated Worker Thread. Main thread stays responsive for MCP queries during indexing. Worker can be terminated if stuck.

### Schema Drift Between Code and Database

**Risk**: Maintaining separate CozoScript DDL strings and TypeScript interfaces manually guarantees drift, causing runtime errors.

**Mitigation**: Single Schema Source of Truth that generates both CozoScript DDL and TypeScript types. Schema changes in one place automatically propagate.

### Data Corruption from Interrupted Updates

**Risk**: If process killed between deletion and insertion during incremental updates, graph is left in corrupted state.

**Mitigation**: Wrap entire file update (delete + insert + relationships) in single database transaction. Automatic rollback on failure.

### File Watcher Floods

**Risk**: When user runs `git checkout another-branch`, hundreds of file events fire instantly. Simple queues bloat memory and overwhelm indexer.

**Mitigation**: RxJS reactive streams with bufferTime, deduplication, and controlled concurrency. Handles 500+ file changes gracefully.

### LLM Output Reliability

**Risk**: Small models (1.5B parameters) often include preambles and produce malformed JSON, polluting the database.

**Mitigation**: GBNF grammar-constrained sampling forces syntactically valid output. Output cleaning and confidence scoring for quality metrics.

### Large Codebase Performance

**Risk**: Initial indexing of large projects takes too long, impacting user experience.

**Mitigation**: Incremental indexing (only changed files), parallel parsing, worker thread isolation, and progress reporting. Users see continuous progress rather than blocked UI.

---

## Future Considerations

### Potential Extensions

- **Additional Language Support**: Python, Go, Rust parsers via UCE interface
- **Remote Indexing**: Index remote repositories without full clone
- **Team Sharing**: Export/import knowledge graphs between team members
- **Additional LLM Models**: Easy to add new models via the model registry
- **IDE Plugins**: Native integrations beyond MCP protocol

### Scalability Considerations

- Graph database can be sharded by directory for monorepos
- Vector embeddings can be computed incrementally
- LLM inference can be batched and prioritized
- Telemetry enables identifying new bottlenecks as codebases grow

---

*This architecture document is maintained alongside the implementation. See `docs/implementation-plan.md` for the detailed roadmap and `docs/implementation-tracker.md` for progress tracking.*

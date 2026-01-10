# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Code-Synapse is an agent-first knowledge engine - a local CLI "sidecar" that transforms raw code into a structured Knowledge Graph optimized for machine reasoning. It runs alongside AI agents (Claude Code, Cursor, Windsurf) via MCP protocol and is designed for complete local operation with no external API calls.

## Build Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Watch mode (tsc --watch)
pnpm build            # Compile TypeScript to dist/
pnpm start            # Run CLI (node dist/cli/index.js)
pnpm lint             # Lint (strict: --max-warnings 0)
pnpm check-types      # Type check
pnpm format           # Format code with Prettier
pnpm test             # Run tests (vitest)
```

## Dependencies

### Production Dependencies

| Package | Purpose | Used In |
|---------|---------|---------|
| `@huggingface/transformers` | Local embeddings (ONNX) | `core/embeddings` |
| `cozo-node` | Graph + Vector database (CozoDB with RocksDB) | `core/graph` |
| `@modelcontextprotocol/sdk` | MCP protocol server | `mcp/` |
| `chalk` | CLI colored output | `cli/` |
| `chokidar` | File system watching | `core/indexer` |
| `commander` | CLI framework | `cli/` |
| `fast-glob` | Fast file pattern matching | `core/indexer` |
| `node-llama-cpp` | Local LLM inference | `core/llm` |
| `ora` | CLI spinners | `cli/` |
| `pino` | Structured logging | All modules |
| `tree-sitter-bash` | Bash grammar for parsing | `core/parser` |
| `tree-sitter-c` | C grammar for parsing | `core/parser` |
| `tree-sitter-c-sharp` | C# grammar for parsing | `core/parser` |
| `tree-sitter-cpp` | C++ grammar for parsing | `core/parser` |
| `tree-sitter-dart` | Dart grammar for parsing | `core/parser` |
| `tree-sitter-elixir` | Elixir grammar for parsing | `core/parser` |
| `tree-sitter-go` | Go grammar for parsing | `core/parser` |
| `tree-sitter-haskell` | Haskell grammar for parsing | `core/parser` |
| `tree-sitter-java` | Java grammar for parsing | `core/parser` |
| `tree-sitter-javascript` | JS grammar for parsing | `core/parser` |
| `tree-sitter-kotlin` | Kotlin grammar for parsing | `core/parser` |
| `tree-sitter-lua` | Lua grammar for parsing | `core/parser` |
| `tree-sitter-php` | PHP grammar for parsing | `core/parser` |
| `tree-sitter-python` | Python grammar for parsing | `core/parser` |
| `tree-sitter-ruby` | Ruby grammar for parsing | `core/parser` |
| `tree-sitter-rust` | Rust grammar for parsing | `core/parser` |
| `tree-sitter-scala` | Scala grammar for parsing | `core/parser` |
| `tree-sitter-swift` | Swift grammar for parsing | `core/parser` |
| `tree-sitter-typescript` | TS grammar for parsing | `core/parser` |
| `tree-sitter-json` | JSON grammar for parsing | `core/parser` |
| `@tree-sitter-grammars/tree-sitter-yaml` | YAML grammar for parsing | `core/parser` |
| `@tree-sitter-grammars/tree-sitter-toml` | TOML grammar for parsing | `core/parser` |
| `web-tree-sitter` | Code parsing (WASM) | `core/parser` |
| `zod` | Schema validation | `types/`, `core/` |

### Dev Dependencies

| Package | Purpose |
|---------|---------|
| `@eslint/js` | ESLint core |
| `@types/node` | Node.js types |
| `eslint` | Linting |
| `eslint-config-prettier` | ESLint + Prettier compat |
| `globals` | Global variables for ESLint |
| `pino-pretty` | Pretty log output (dev) |
| `prettier` | Code formatting |
| `typescript` | TypeScript compiler |
| `typescript-eslint` | TypeScript ESLint plugin |
| `vitest` | Testing framework |

## Project Structure

```
src/
├── cli/                    # CLI entry point (user-facing)
│   ├── index.ts            # Main CLI entry (commander)
│   └── commands/           # CLI command implementations
│       ├── default.ts      # Default command (init + index + justify + start)
│       ├── init.ts         # Initialize project
│       ├── index.ts        # Trigger indexing
│       ├── justify.ts      # Business justification command
│       ├── status.ts       # Show status
│       ├── config.ts       # LLM model configuration
│       ├── viewer.ts       # Web viewer
│       └── start.ts        # Start MCP server
│
├── mcp/                    # MCP server (AI agent communication)
│   ├── index.ts            # MCP module exports
│   └── server.ts           # MCP server implementation
│
├── core/                   # Shared core logic (used by CLI & MCP)
│   ├── index.ts            # Core module exports
│   ├── parser/             # Tree-sitter AST parsing
│   ├── graph/              # CozoDB graph + vector operations
│   ├── graph-builder/      # Atomic writes, incremental updates
│   ├── extraction/         # Entity extraction pipeline
│   ├── semantic/           # TypeScript Compiler API analysis
│   ├── interfaces/         # Core interface definitions
│   ├── embeddings/         # HuggingFace transformers
│   ├── llm/                # node-llama-cpp inference
│   │   └── interfaces/     # ILLMService interface
│   ├── justification/      # Business justification layer (V13)
│   │   ├── models/         # Justification data models
│   │   ├── interfaces/     # IJustificationService interface
│   │   ├── prompts/        # LLM prompts with GBNF grammar
│   │   ├── hierarchy/      # Context propagation (up/down)
│   │   ├── storage/        # CozoDB justification operations
│   │   ├── clarification/  # Question generation engine
│   │   └── impl/           # LLMJustificationService
│   ├── classification/     # Business layer classification (V14)
│   │   ├── models/         # Domain/Infrastructure classification models
│   │   ├── interfaces/     # IClassificationEngine, IClassificationStorage
│   │   ├── storage/        # CozoDB classification operations
│   │   └── impl/           # LLMClassificationEngine
│   ├── ledger/             # Change Ledger + Observability (V15)
│   │   ├── models/         # LedgerEntry, event types
│   │   ├── interfaces/     # IChangeLedger interface
│   │   └── impl/           # CozoChangeLedger implementation
│   ├── adaptive-indexer/   # Adaptive MCP-Driven Indexing (V16)
│   │   ├── models/         # Query/Change observation, correlations
│   │   ├── interfaces/     # IAdaptiveIndexer interface
│   │   └── impl/           # AdaptiveIndexerService
│   ├── reconciliation/     # Ledger Reconciliation (V18)
│   │   ├── interfaces/     # IReconciliationWorker interface
│   │   └── impl/           # ReconciliationWorker implementation
│   ├── memory/             # Persistent Developer Memory (V19)
│   │   ├── models/         # ProjectMemoryRule, MemoryStats
│   │   ├── interfaces/     # IProjectMemory interface
│   │   └── impl/           # CozoProjectMemory implementation
│   ├── optimization/       # Performance Optimization Layer (V20)
│   │   ├── cache/          # LRU caches (QueryCache, ModelResponseCache)
│   │   ├── filter/         # Bloom filters, entity filters
│   │   ├── pool/           # Worker pools for parallel processing
│   │   ├── batch/          # Batch writers, write-behind ledger
│   │   ├── heat/           # Heat tracking, adaptive indexing
│   │   └── metrics/        # Performance tracker, cost attribution
│   ├── models/             # Multi-Model Intelligence Layer (V21)
│   │   ├── interfaces/     # IModelProvider, IModelRouter
│   │   ├── router/         # ModelRouter with policy engine
│   │   └── providers/      # LocalProvider, OpenAIProvider
│   ├── documentation/      # Horizontal Documentation Graph (V22)
│   │   ├── interfaces/     # IDocumentationService, IDocumentationStorage
│   │   ├── models/         # DocumentationReference, EntityDocumentationLink
│   │   ├── storage/        # CozoDocumentationStorage
│   │   └── impl/           # DocumentationService
│   ├── feedback/           # Self-Optimizing Feedback Loops (V23)
│   │   ├── interfaces/     # IFeedbackLoop, IFeedbackObserver, IFeedbackOptimizer
│   │   └── impl/           # FeedbackLoop with routing adjustments
│   ├── indexer/            # Orchestrates all core modules
│   └── telemetry/          # Tracing and metrics
│
├── viewer/                 # Web viewer & NL search
│   ├── index.ts            # Module exports
│   ├── interfaces/         # IGraphViewer interface
│   ├── impl/               # CozoGraphViewer implementation
│   ├── ui/                 # HTTP server, REST API
│   └── nl-search/          # Natural language search
│
├── types/                  # Shared TypeScript types
│   └── index.ts
│
└── utils/                  # Shared utilities
    └── index.ts
```

## Code Organization Guidelines

### Where Code Should Go

| If you're adding... | Put it in... | Example |
|---------------------|--------------|---------|
| New CLI command | `src/cli/commands/` | `config.ts`, `query.ts` |
| MCP tool/resource | `src/mcp/` | `tools.ts`, `resources.ts` |
| Database operations | `src/core/graph/` | Query helpers, schema, migrations |
| Entity extraction | `src/core/extraction/` | Extractors for new entity types |
| File parsing logic | `src/core/parser/` | Language grammars, AST utils |
| Embedding generation | `src/core/embeddings/` | Model loading, batch processing |
| LLM inference | `src/core/llm/` | Prompts, inference helpers |
| Shared types/interfaces | `src/types/` | `ProjectConfig`, `Symbol` |
| Helper functions | `src/utils/` | File I/O, path helpers |

### Module Responsibilities

**`src/cli/`** - User Interface Layer
- Command parsing and validation (commander)
- User prompts and output formatting (chalk, ora)
- Calls into `core/` for business logic
- Should NOT contain business logic directly

**`src/mcp/`** - AI Agent Interface Layer
- MCP protocol implementation (@modelcontextprotocol/sdk)
- Tool definitions for AI agents
- Resource exposure for context
- Calls into `core/` for all operations

**`src/core/`** - Business Logic Layer
- All knowledge engine functionality
- Database operations (graph + vector)
- File parsing and indexing
- Embedding and inference
- Stateless where possible; state managed by `indexer`

**`src/types/`** - Type Definitions
- Interfaces and types used across modules
- No runtime code, only TypeScript types
- Export everything from `index.ts`

**`src/utils/`** - Shared Utilities
- Pure helper functions
- File system operations
- Configuration management
- No dependencies on `core/`, `cli/`, or `mcp/`

### Import Rules

```
┌─────────────────────────────────────────────────────────┐
│                         cli/                            │
│                          │                              │
│                          ▼                              │
│  ┌─────────┐        ┌─────────┐        ┌─────────┐     │
│  │  mcp/   │───────▶│  core/  │◀───────│  cli/   │     │
│  └─────────┘        └─────────┘        └─────────┘     │
│                          │                              │
│                          ▼                              │
│              ┌───────────┴───────────┐                  │
│              ▼                       ▼                  │
│         ┌─────────┐            ┌─────────┐             │
│         │ types/  │            │ utils/  │             │
│         └─────────┘            └─────────┘             │
└─────────────────────────────────────────────────────────┘
```

- `cli/` → can import from `core/`, `types/`, `utils/`, `mcp/`
- `mcp/` → can import from `core/`, `types/`, `utils/`
- `core/` → can import from `types/`, `utils/` (NOT from `cli/` or `mcp/`)
- `types/` → no imports from other src modules
- `utils/` → no imports from other src modules

### Adding a New Feature

1. **New CLI Command:**
   ```
   src/cli/commands/mycommand.ts  # Implementation
   src/cli/index.ts               # Register command
   ```

2. **New MCP Tool:**
   ```
   src/mcp/tools/mytool.ts        # Tool implementation
   src/mcp/server.ts              # Register tool
   ```

3. **New Core Capability:**
   ```
   src/core/mymodule/index.ts     # Module implementation
   src/core/index.ts              # Export module
   src/types/index.ts             # Add types if needed
   ```

## Architecture

### Three-Part Design

1. **CLI (`src/cli/`)** - User runs commands to configure and manage
2. **MCP Server (`src/mcp/`)** - AI agents connect to query knowledge
3. **Core (`src/core/`)** - Shared engine used by both CLI and MCP

### Data Flow

```
User                          AI Agent
  │                              │
  ▼                              ▼
┌─────┐                      ┌─────┐
│ CLI │                      │ MCP │
└──┬──┘                      └──┬──┘
   │                            │
   └──────────┬─────────────────┘
              ▼
    ┌─────────────────────┐
    │  IndexerCoordinator │
    └──────────┬──────────┘
               │
   ┌───────────┼───────────┬────────────┐
   ▼           ▼           ▼            ▼
┌───────┐ ┌────────┐ ┌──────────┐ ┌───────────┐
│Scanner│ │ Parser │ │Extraction│ │GraphWriter│
└───────┘ └────────┘ └──────────┘ └─────┬─────┘
                                        │
                                        ▼
                                 ┌────────────┐
                                 │  CozoDB    │
                                 │(Graph+Vec) │
                                 └────────────┘
```

### Core Modules

| Module | Purpose | Dependency |
|--------|---------|------------|
| `parser` | AST parsing (Syntax Layer) | `web-tree-sitter` |
| `semantic` | Type resolution, symbol linking | TypeScript Compiler API |
| `extraction` | Entity extraction pipeline | - |
| `graph` | Graph + vector storage | `cozo-node` (RocksDB) |
| `graph-builder` | Atomic writes, incremental updates | - |
| `embeddings` | Vector embeddings | `@huggingface/transformers` |
| `llm` | Intent inference (Business Logic Layer) | `node-llama-cpp` (12 models) |
| `justification` | Business purpose inference (V13) | `llm` module |
| `classification` | Domain/Infrastructure classification (V14) | `llm` module |
| `ledger` | Change ledger + observability (V15) | `graph` module |
| `adaptive-indexer` | MCP-driven adaptive re-indexing (V16) | `ledger`, `indexer` |
| `reconciliation` | Offline recovery from Git (V18) | `git`, `ledger` |
| `memory` | Developer rule learning (V19) | `graph`, `embeddings` |
| `optimization` | Performance primitives (V20) | LRU, bloom, worker pools |
| `models` | Multi-model routing (V21) | `llm`, providers |
| `documentation` | Horizontal documentation graph (V22) | NPM registry, graph |
| `feedback` | Self-optimizing feedback (V23) | model router |
| `indexer` | Pipeline orchestration, file watching | `chokidar` |
| `interfaces` | Core contracts (IParser, IGraphStore) | - |
| `telemetry` | Tracing and metrics | - |

### Four-Layer Knowledge Engine

1. **Syntax Layer** - Tree-sitter WASM for AST parsing
2. **Semantic Layer** - Import/export relationships, type hierarchies
3. **Architectural Layer** - Service boundaries, API contracts, design patterns
4. **Business Logic Layer** - Local SLM (Qwen 2.5) for intent inference

### LLM Model Selection

The LLM module (`src/core/llm/`) supports 12 models across 4 families with automatic download:

**Presets:**
| Preset | Model | RAM | Description |
|--------|-------|-----|-------------|
| `fastest` | qwen2.5-coder-0.5b | 1GB | Ultra-fast, minimal resources |
| `minimal` | qwen2.5-coder-1.5b | 2GB | Good for low-memory systems |
| `balanced` | qwen2.5-coder-3b | 4GB | **Recommended default** |
| `quality` | qwen2.5-coder-7b | 8GB | Production quality |
| `maximum` | qwen2.5-coder-14b | 16GB | Maximum quality |

**Model Families:**
- **Qwen 2.5 Coder**: 0.5B, 1.5B, 3B, 7B, 14B (recommended for code)
- **Llama 3.x**: 1B, 3B, 8B (general purpose)
- **CodeLlama**: 7B, 13B (code-specialized)
- **DeepSeek Coder**: 1.3B, 6.7B (alternative to Qwen)

**Usage in code:**
```typescript
import { createInitializedLLMServiceWithPreset, createInitializedLLMService } from "./core/llm/index.js";

// Using preset (recommended)
const llm = await createInitializedLLMServiceWithPreset("balanced");

// Using specific model ID
const llm = await createInitializedLLMService({ modelId: "qwen2.5-coder-7b" });

// Helper functions
import { getAvailableModels, getModelSelectionGuide, filterModels } from "./core/llm/index.js";

getAvailableModels();                          // List all 12 models
filterModels({ maxRamGb: 4, codeOptimized: true }); // Filter by criteria
getModelSelectionGuide();                       // Human-readable guide
```

## CLI Commands

```bash
# Default command (all-in-one)
code-synapse                # Auto: setup → init → index → justify → viewer → start
code-synapse --skip-justify # Skip business justification
code-synapse --skip-setup   # Skip interactive setup wizard
code-synapse --justify-only # Run only justification
code-synapse -m balanced    # Set LLM model preset

# Individual commands
code-synapse init           # Initialize project
code-synapse index          # Build knowledge graph
code-synapse justify        # Generate business justifications
code-synapse justify -i     # Interactive clarification mode
code-synapse justify --stats # Show justification statistics
code-synapse status         # Show project status
code-synapse viewer         # Start web viewer
code-synapse config --setup # Interactive setup wizard
code-synapse config --provider openai --api-key sk-xxx  # Set cloud provider
code-synapse config --list-models  # List available LLM models
code-synapse start          # Start MCP server
code-synapse start -p 3100  # Start on specific port
```

## Model Providers

Code-Synapse supports local and cloud model providers:

| Provider | Models | Environment Variable |
|----------|--------|---------------------|
| `local` (default) | Qwen 2.5 Coder (0.5B-14B) | - |
| `openai` | GPT-4o, GPT-4o Mini | `OPENAI_API_KEY` |
| `anthropic` | Claude 3.5 Sonnet, Claude 3 Haiku | `ANTHROPIC_API_KEY` |
| `google` | Gemini 1.5 Pro, Gemini 1.5 Flash | `GOOGLE_API_KEY` |

## TypeScript Guidelines

### Configuration

- **Strict mode:** Enabled (`"strict": true`)
- **Target:** ES2022
- **Module:** NodeNext (ESM)
- **Output:** `dist/` directory

### Import/Export Patterns

```typescript
// ✅ Correct - use .js extension (ESM requirement)
import { Parser } from "../core/parser/index.js";
import type { ProjectConfig } from "../types/index.js";

// ❌ Wrong - missing extension
import { Parser } from "../core/parser/index";

// ❌ Wrong - using .ts extension
import { Parser } from "../core/parser/index.ts";
```

### Type Imports

```typescript
// Use 'import type' for type-only imports (better tree-shaking)
import type { ProjectConfig, Symbol } from "../types/index.js";

// Regular import when using both types and values
import { Parser, type ParserOptions } from "../core/parser/index.js";
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Interfaces | PascalCase | `ProjectConfig`, `ParsedFile` |
| Types | PascalCase | `SymbolKind`, `Location` |
| Classes | PascalCase | `Parser`, `GraphStore` |
| Functions | camelCase | `createParser`, `parseFile` |
| Constants | UPPER_SNAKE_CASE | `CONFIG_DIR`, `DEFAULT_PORT` |
| Files | kebab-case or index.ts | `graph-store.ts`, `index.ts` |

### Class Pattern

```typescript
// Export both class and factory function
export class Parser {
  constructor(config: ProjectConfig) { }
  async initialize(): Promise<void> { }
}

export function createParser(config: ProjectConfig): Parser {
  return new Parser(config);
}
```

### Async/Error Handling

```typescript
// Always use async/await, not callbacks
async function indexFile(path: string): Promise<void> {
  // Let errors propagate - handle at CLI/MCP boundary
  const content = await readFile(path);
  await processContent(content);
}
```

### Node.js Imports

```typescript
// Use node: prefix for built-in modules
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
```

## Implementation Roadmap

See `docs/implementation-plan.md` for detailed implementation steps and `docs/implementation-tracker.md` for progress tracking.

### Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| **H1-H5** | Horizontals (Foundation, Disposables, Schema, Async, Telemetry) | ✅ Complete |
| **V1** | Graph Database Foundation (CozoDB) | ✅ Complete |
| **V2** | File System Scanner | ✅ Complete |
| **V3** | Code Parser Layer (Tree-sitter) | ✅ Complete |
| **V4** | Semantic Analysis Layer | ✅ Complete |
| **V5** | Entity Extraction | ✅ Complete |
| **V6** | Architecture Refactor (Interfaces) | ✅ Complete |
| **V7** | Graph Builder | ✅ Complete |
| **V8** | Indexer & Watcher | ✅ Complete |
| **V9** | MCP Server Implementation | ✅ Complete |
| **V10** | LLM Integration (12 models) | ✅ Complete |
| **V11** | CLI Commands | ✅ Complete |
| **V12** | Web Viewer & NL Search | ✅ Complete |
| **V13** | Business Justification Layer | ✅ Complete |
| **V14** | Business Layer Classification (Domain/Infrastructure) | ✅ Complete |
| **V15** | Change Ledger + Observability | ✅ Complete |
| **V16** | Adaptive MCP-Driven Indexing | ✅ Complete |
| **V17** | Ledger Compaction (Session Semantics) | ✅ Complete |
| **V18** | Ledger Reconciliation (Offline Recovery) | ✅ Complete |
| **V19** | Persistent Developer Memory | ✅ Complete |
| **V20** | Performance Optimization Layer | ✅ Complete |
| **V21** | Multi-Model Intelligence Layer | ✅ Complete |
| **V22** | Horizontal Documentation Graph | ✅ Complete |
| **V23** | Self-Optimizing Feedback Loops | ✅ Complete |

### Current Architecture

- **539+ tests passing** across all modules
- **CozoDB** with RocksDB backend for unified graph + vector storage
- **Interface-based architecture** (IParser, IGraphStore, IScanner, IExtractor, IJustificationService, IClassificationEngine, IChangeLedger, IAdaptiveIndexer, IProjectMemory, IModelRouter, IDocumentationService, IFeedbackLoop)
- **Incremental indexing** with file hash-based change detection
- **File watching** with event debouncing and batching
- **MCP Server** with stdio transport (primary) and HTTP transport (optional)
- **Full CLI** with all commands implemented (init, index, justify, status, config, viewer, start)
- **Business Justification** with LLM-powered inference and interactive clarification
- **Business Layer Classification** categorizing code as Domain (business logic) or Infrastructure (platform)
- **Change Ledger** for append-only event logging with time-travel debugging
- **Ledger Compaction** with session-aware grouping and intent clustering
- **Ledger Reconciliation** for self-healing history from Git when offline
- **Adaptive Indexing** that observes MCP queries and triggers intelligent re-indexing
- **Persistent Memory** that learns coding rules and conventions from human corrections
- **Performance Optimization** with LRU caches, bloom filters, heat tracking, worker pools
- **Multi-Model Routing** with unified interface for local and cloud providers (OpenAI)
- **Horizontal Documentation** linking infrastructure code to official docs and SDK references
- **Self-Optimizing Feedback** automatically adjusting model routing based on performance
- **Multi-language parsing** with support for 24 languages including TypeScript, JavaScript, Go, Rust, Python, Java, C/C++, C#, Kotlin, Ruby, PHP, Bash, Scala, Haskell, and data formats (JSON, YAML, TOML)

### Supported Languages

See [README.md](README.md#-supported-languages-24-total) for the full list of 24 supported languages including:
- **Full code analysis**: TypeScript, JavaScript, Go, Rust, Python, Java, C, C++, C#, Kotlin, Ruby, PHP, Bash, Scala, Haskell
- **Syntax validation**: Swift, Dart, Elixir, Lua (WASM pending)
- **Data formats**: JSON, YAML, TOML

### Next Steps (Post-Beta)

1. Performance optimizations for large codebases (10,000+ files)
2. Windows platform improvements
3. Better error messages and diagnostics
4. Additional MCP tools based on user feedback
5. Cross-repository dependency mapping

## Key Constraints

- **Language:** TypeScript (strict mode)
- **Package manager:** pnpm 9.0.0+
- **Node version:** >= 20 (v25 recommended for development)
- **Privacy-first:** All processing must stay local, no external API calls
- **ESM:** Use `.js` extension in imports; use `node:` prefix for built-ins

## Documentation References

For detailed architecture and implementation information, see the following documents:

| Document | Purpose |
|----------|---------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture overview and design decisions |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Detailed implementation phases and specifications |
| [`docs/implementation-tracker.md`](docs/implementation-tracker.md) | Progress tracking and change log |
| [`docs/architecture-refactor-plan.md`](docs/architecture-refactor-plan.md) | V6 interface-based architecture refactor plan |
| [`docs/references.md`](docs/references.md) | External references and documentation links |

### Key Technologies

| Technology | Documentation |
|------------|---------------|
| **CozoDB** | [docs.cozodb.org](https://docs.cozodb.org) - Datalog query language (CozoScript) |
| **Tree-sitter** | [tree-sitter.github.io](https://tree-sitter.github.io) - Incremental parsing |
| **MCP Protocol** | [modelcontextprotocol.io](https://modelcontextprotocol.io) - AI agent communication |
| **HuggingFace Transformers** | [huggingface.co/docs/transformers.js](https://huggingface.co/docs/transformers.js) - Local embeddings |
| **node-llama-cpp** | [node-llama-cpp.withcat.ai](https://node-llama-cpp.withcat.ai) - Local LLM inference |

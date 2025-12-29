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
```

## Project Structure

```
src/
├── cli/                    # CLI entry point (user-facing)
│   ├── index.ts            # Main CLI entry (commander)
│   └── commands/           # CLI command implementations
│       ├── init.ts         # Initialize project
│       └── start.ts        # Start MCP server
│
├── mcp/                    # MCP server (AI agent communication)
│   ├── index.ts            # MCP module exports
│   └── server.ts           # MCP server implementation
│
├── core/                   # Shared core logic (used by CLI & MCP)
│   ├── index.ts            # Core module exports
│   ├── parser/             # Tree-sitter AST parsing
│   ├── graph/              # KùzuDB graph operations
│   ├── vector/             # LanceDB vector operations
│   ├── embeddings/         # HuggingFace transformers
│   ├── llm/                # node-llama-cpp inference
│   └── indexer/            # Orchestrates all core modules
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
| Database operations | `src/core/graph/` or `src/core/vector/` | Query helpers, schema |
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
         ┌─────────┐
         │  Core   │
         │ Indexer │
         └────┬────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
┌───────┐ ┌───────┐ ┌───────┐
│Parser │ │ Graph │ │Vector │
└───────┘ └───────┘ └───────┘
```

### Core Modules

| Module | Purpose | Dependency |
|--------|---------|------------|
| `parser` | AST parsing (Syntax Layer) | `web-tree-sitter` |
| `graph` | Structural relationships | `@kuzu/kuzu-wasm` |
| `vector` | Semantic search | `@lancedb/lancedb` |
| `embeddings` | Vector embeddings | `@huggingface/transformers` |
| `llm` | Intent inference (Business Logic Layer) | `node-llama-cpp` |
| `indexer` | Orchestrates all modules | - |

### Four-Layer Knowledge Engine

1. **Syntax Layer** - Tree-sitter WASM for AST parsing
2. **Semantic Layer** - Import/export relationships, type hierarchies
3. **Architectural Layer** - Service boundaries, API contracts, design patterns
4. **Business Logic Layer** - Local SLM (Qwen 2.5) for intent inference

## CLI Commands

```bash
code-synapse init           # Initialize project
code-synapse start          # Start MCP server
code-synapse start -p 3100  # Start on specific port
code-synapse index          # Manual full index
code-synapse status         # Show status
```

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

See `docs/implementation-plan.md` for detailed implementation steps.

### Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1** | Project Foundation & Scaffolding | ✅ Complete |
| **Phase 2** | Graph Database Foundation (KùzuDB) | 🔲 Pending |
| **Phase 3** | File System Scanner | 🔲 Pending |
| **Phase 4** | Code Parser Layer (Tree-sitter) | 🔲 Pending |
| **Phase 5** | Semantic Analysis Layer | 🔲 Pending |
| **Phase 6** | Entity Extraction | 🔲 Pending |
| **Phase 7** | MCP Server Implementation | 🔲 Pending |
| **Phase 8** | LLM Integration (Business Logic Layer) | 🔲 Pending |

### Phase 1 Completed Items

- ✅ Project structure with cli/, mcp/, core/ separation
- ✅ TypeScript configuration (strict mode, ES2022, NodeNext)
- ✅ ESLint + Prettier configuration
- ✅ CLI framework with Commander.js (init, start, index, status commands)
- ✅ Core module scaffolding (parser, graph, vector, embeddings, llm, indexer)
- ✅ Shared types and utilities
- ✅ MCP server entry point

### Next Steps (Phase 2)

1. Implement KùzuDB wrapper in `src/core/graph/`
2. Define graph schema (File, Function, Class nodes; CALLS, IMPORTS edges)
3. Create entity models matching graph schema
4. Implement graph operations layer

## Key Constraints

- **Language:** TypeScript (strict mode)
- **Package manager:** pnpm 9.0.0+
- **Node version:** >= 18
- **Privacy-first:** All processing must stay local, no external API calls
- **ESM:** Use `.js` extension in imports; use `node:` prefix for built-ins

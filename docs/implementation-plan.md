# Code Knowledge Platform - Detailed Architecture & Implementation Plan

**Zero-Config Smart Sidecar for AI Agents**

---

## Implementation Status

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| **Phase 1** | Project Foundation & Scaffolding | ✅ **Complete** | Project structure, CLI, core modules scaffolded |
| **Phase 2** | Graph Database Foundation | 🔲 Pending | KùzuDB integration |
| **Phase 3** | File System Scanner | 🔲 Pending | Project detection, file discovery |
| **Phase 4** | Code Parser Layer | 🔲 Pending | Tree-sitter integration |
| **Phase 5** | Semantic Analysis Layer | 🔲 Pending | TypeScript Compiler API |
| **Phase 6** | Entity Extraction | 🔲 Pending | Function, Class, Import extraction |
| **Phase 7** | MCP Server Implementation | 🔲 Pending | Tool definitions, query handlers |
| **Phase 8** | LLM Integration | 🔲 Pending | Business logic inference |

### What's Been Built (Phase 1)

```
src/
├── cli/                    ✅ CLI entry point with Commander.js
│   ├── index.ts            ✅ Main CLI (init, start, index, status commands)
│   └── commands/           ✅ Command implementations
│       ├── init.ts         ✅ Project initialization
│       └── start.ts        ✅ MCP server launcher
│
├── mcp/                    ✅ MCP server module
│   ├── index.ts            ✅ Module exports
│   └── server.ts           ✅ Server entry point (stub)
│
├── core/                   ✅ Core module scaffolding
│   ├── index.ts            ✅ Module exports
│   ├── parser/             ✅ Parser module (stub)
│   ├── graph/              ✅ Graph module (stub)
│   ├── vector/             ✅ Vector module (stub)
│   ├── embeddings/         ✅ Embeddings module (stub)
│   ├── llm/                ✅ LLM module (stub)
│   └── indexer/            ✅ Indexer orchestrator (stub)
│
├── types/                  ✅ Shared TypeScript types
│   └── index.ts            ✅ Core type definitions
│
└── utils/                  ✅ Shared utilities
    └── index.ts            ✅ File system helpers, config paths
```

### Installed Dependencies

**Production:**
| Package | Version | Purpose |
|---------|---------|---------|
| `@huggingface/transformers` | ^3.5.1 | Local embeddings (ONNX) |
| `@kuzu/kuzu-wasm` | ^0.7.0 | Graph database (WASM) |
| `@lancedb/lancedb` | ^0.17.0 | Vector database |
| `@modelcontextprotocol/sdk` | ^1.25.1 | MCP protocol server |
| `chalk` | ^5.6.2 | CLI colored output |
| `chokidar` | ^5.0.0 | File system watching |
| `commander` | ^14.0.2 | CLI framework |
| `fast-glob` | ^3.3.3 | Fast file pattern matching |
| `node-llama-cpp` | ^3.14.5 | Local LLM inference |
| `ora` | ^9.0.0 | CLI spinners |
| `pino` | ^10.1.0 | Structured logging |
| `tree-sitter-javascript` | ^0.25.0 | JS grammar for parsing |
| `tree-sitter-typescript` | ^0.23.2 | TS grammar for parsing |
| `web-tree-sitter` | ^0.26.3 | Code parsing (WASM) |
| `zod` | ^4.2.1 | Schema validation |

**Development:**
| Package | Version | Purpose |
|---------|---------|---------|
| `@eslint/js` | ^9.39.1 | ESLint core |
| `@types/node` | ^22.15.3 | Node.js types |
| `eslint` | ^9.39.1 | Linting |
| `eslint-config-prettier` | ^10.1.0 | ESLint + Prettier compat |
| `globals` | ^16.2.0 | Global variables for ESLint |
| `pino-pretty` | ^13.1.3 | Pretty log output (dev) |
| `prettier` | ^3.7.4 | Code formatting |
| `typescript` | 5.9.2 | TypeScript compiler |
| `typescript-eslint` | ^8.33.0 | TypeScript ESLint plugin |
| `vitest` | ^4.0.16 | Testing framework |

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack Deep Dive](#technology-stack-deep-dive)
3. [System Components Architecture](#system-components-architecture)
4. [Implementation Plan - Phase by Phase](#implementation-plan---phase-by-phase)
5. [Database Schema & Graph Architecture](#database-schema--graph-architecture)
6. [MCP Protocol Integration](#mcp-protocol-integration)
7. [LLM Integration Architecture](#llm-integration-architecture)
8. [File System & Storage Architecture](#file-system--storage-architecture)

---

## Architecture Overview

### Core Architecture Principles

**1. Embedded-First Design**
- Single Node.js process manages all components
- No external database servers required
- All dependencies bundled or embedded
- Zero external configuration files

**2. Three-Layer Knowledge Graph**

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

**3. Sidecar Process Model**
- Background daemon that stays running
- File system watcher for real-time updates
- MCP server for AI agent communication
- Incremental indexing for performance

**4. Local-First Philosophy**
- No cloud dependencies
- No API keys required
- All data stays on developer's machine
- Works offline completely

---

## Technology Stack Deep Dive

### Core Runtime & Language

**Node.js (v18+)**
- **Why**: Native TypeScript support, rich ecosystem, cross-platform
- **Usage**: Main runtime for entire application
- **Key Features Used**:
  - Worker threads for parallel processing
  - Native file system watcher (fs.watch)
  - Stream processing for large files
  - Event emitters for component communication

**TypeScript (v5.0+)**
- **Why**: Type safety, better tooling, self-documenting code
- **Configuration**: Strict mode enabled, ES2022 target
- **Usage**: All source code written in TypeScript
- **Key Features**:
  - Advanced type inference
  - Discriminated unions for error handling
  - Generics for graph queries

### Graph Database Layer

**KùzuDB (Embedded Graph Database)**
- **Why Chosen**:
  - Embeds directly in Node.js process (no separate server)
  - Graph-native (optimized for relationship queries)
  - 10x faster than Neo4j for local queries
  - Zero configuration required
  - Columnar storage (efficient for analytics)
  
- **Architecture Details**:
  ```
  Node.js Process
  ├── KùzuDB WASM/Native Binding
  │   ├── Storage Manager (DuckDB-based)
  │   ├── Query Processor (Cypher-like)
  │   └── Transaction Manager
  └── Node.js Wrapper (@kuzu/node)
  ```

- **Storage Structure**:
  ```
  .codegraph/kuzu/
  ├── catalog.bin      (schema metadata)
  ├── nodes/           (entity storage)
  │   ├── Function.dat
  │   ├── Class.dat
  │   └── File.dat
  ├── rels/            (relationship storage)
  │   ├── CALLS.dat
  │   ├── IMPORTS.dat
  │   └── CONTAINS.dat
  └── wal/             (write-ahead log)
  ```

- **Query Language**: Cypher (compatible with Neo4j syntax)
- **Node Binding**: `@kuzu/kuzu-wasm` npm package (WASM version)
- **Installation**: `pnpm add @kuzu/kuzu-wasm`

### Code Parsing Layer

**Tree-sitter (Incremental Parser)**
- **Why Chosen**:
  - Incremental parsing (only re-parse changed sections)
  - Error-tolerant (parses incomplete/broken code)
  - Language-agnostic (supports 50+ languages)
  - Fast (written in C, 10ms per file typical)
  - AST output (structured tree format)

- **Architecture**:
  ```
  Source Code File
       ↓
  Tree-sitter Parser (WASM)
       ↓
  Concrete Syntax Tree (CST)
       ↓
  AST Transformer
       ↓
  Simplified AST
  ```

- **Language Support**:
  - TypeScript: `tree-sitter-typescript`
  - JavaScript: `tree-sitter-javascript`
  - Future: Python, Go, Rust, Java

- **Integration Method**:
  ```typescript
  // Use tree-sitter via WASM for portability
  import Parser from 'web-tree-sitter';
  
  // Load language grammar
  await Parser.init();
  const parser = new Parser();
  const TypeScript = await Parser.Language.load('tree-sitter-typescript.wasm');
  parser.setLanguage(TypeScript);
  ```

- **WASM Parsers Storage**:
  ```
  parsers/
  ├── tree-sitter-typescript.wasm  (1.2 MB)
  ├── tree-sitter-javascript.wasm  (800 KB)
  └── tree-sitter.wasm             (Core runtime)
  ```

### Semantic Analysis Layer

**TypeScript Compiler API**
- **Why Chosen**:
  - Official TypeScript type checker
  - Resolves all type information accurately
  - Understands module resolution
  - Tracks symbol references across files

- **Key APIs Used**:
  - `ts.createProgram()`: Load project with tsconfig
  - `typeChecker.getTypeAtLocation()`: Resolve types
  - `typeChecker.getSymbolAtLocation()`: Find definitions
  - `languageService.findReferences()`: Track usage

- **Architecture**:
  ```
  TypeScript Source Files
         ↓
  TS Compiler API
         ↓
  ┌──────────────────┐
  │ Type Checker     │ → Resolves all type information
  │ Symbol Table     │ → Maps identifiers to definitions  
  │ Module Resolver  │ → Resolves import paths
  └──────────────────┘
         ↓
  Type Graph + Symbol References
  ```

- **Integration**:
  ```typescript
  import * as ts from 'typescript';
  
  // Create program from tsconfig
  const program = ts.createProgram(fileNames, compilerOptions);
  const typeChecker = program.getTypeChecker();
  
  // Resolve types for each node
  const type = typeChecker.getTypeAtLocation(node);
  const symbol = typeChecker.getSymbolAtLocation(node);
  ```

### LLM Integration Layer

**Ollama (Local LLM Runtime)**
- **Why Chosen**:
  - Runs models completely locally
  - Zero API costs
  - Works offline
  - Simple HTTP API
  - Cross-platform (macOS, Linux, Windows)

- **Model Selection**: Qwen 2.5 Coder (1.5B parameters)
  - **Why This Model**:
    - Specialized for code understanding
    - Small enough (1.5B) to run on laptops
    - Fast inference (100-200 tokens/sec on M1)
    - Good at code intent extraction
    - 900MB download size

- **Architecture**:
  ```
  Your CLI Process
       ↓
  HTTP Request (localhost:11434)
       ↓
  Ollama Server (Local)
       ↓
  Qwen 2.5 Coder Model (Loaded in RAM)
       ↓
  Inference Result
  ```

- **API Integration**:
  ```typescript
  // HTTP-based API (no SDK needed)
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: 'qwen2.5-coder:1.5b',
      prompt: functionCode,
      temperature: 0.3,
      stream: false
    })
  });
  ```

- **Model Installation**:
  ```bash
  # User installs Ollama (one-time)
  curl -fsSL https://ollama.com/install.sh | sh
  
  # Pull model (automatic on first use)
  ollama pull qwen2.5-coder:1.5b
  ```

**Alternative: Transformers.js (Future Option)**
- **Why Consider**:
  - Pure JavaScript (no external dependencies)
  - Embeds directly in Node.js
  - No separate server needed
  
- **Why Not Initially**:
  - Slower inference than Ollama
  - Limited model selection
  - Higher memory usage
  
- **Keep as Fallback**: If Ollama not available

### MCP Protocol Layer

**Model Context Protocol (MCP) by Anthropic**
- **Why MCP**:
  - Standard protocol for AI tool integration
  - Works with Claude, Cursor, any MCP client
  - Simple stdio-based communication
  - JSON-RPC 2.0 format
  - Well-documented specification

- **Protocol Architecture**:
  ```
  AI Agent (Claude Desktop)
       ↓
  stdio (Standard Input/Output)
       ↓
  Your MCP Server Process
       ↓
  Request Handler
       ↓
  Query Graph Database
       ↓
  Format Response
       ↓
  Return to Agent
  ```

- **Message Format** (JSON-RPC 2.0):
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "search_code",
      "arguments": {
        "query": "authentication flow"
      }
    }
  }
  ```

- **Implementation Library**: `@modelcontextprotocol/sdk`
  ```typescript
  import { Server } from '@modelcontextprotocol/sdk/server/index.js';
  import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
  
  const server = new Server({
    name: 'code-knowledge',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
      resources: {}
    }
  });
  ```

### File System Monitoring

**Chokidar (File Watcher)**
- **Why Chosen**:
  - Cross-platform (works identically on all OSes)
  - Efficient (uses native OS APIs)
  - Debouncing built-in
  - Handles renames, moves, deletions
  - Ignores dot-files by default

- **Architecture**:
  ```
  File System Change
       ↓
  OS File System API
   (FSEvents/inotify/ReadDirectoryChangesW)
       ↓
  Chokidar Wrapper
       ↓
  Debounced Event (500ms)
       ↓
  Event Handler
       ↓
  Incremental Update
  ```

- **Configuration**:
  ```typescript
  import chokidar from 'chokidar';
  
  const watcher = chokidar.watch('src/**/*.{ts,tsx,js,jsx}', {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });
  ```

### CLI Framework

**Commander.js**
- **Why Chosen**:
  - Industry standard for Node.js CLIs
  - Automatic help generation
  - Subcommand support
  - Type-safe with TypeScript
  - Simple API

- **Command Structure**:
  ```bash
  code-synapse init     # Initialize project
  code-synapse start    # Start MCP server
  code-synapse status   # Show indexing status
  code-synapse index    # Force re-index
  ```

- **Implementation**:
  ```typescript
  import { Command } from 'commander';

  const program = new Command();
  program
    .name('code-synapse')
    .description('An agent-first knowledge engine for AI coding assistants')
    .version('0.1.0');

  program
    .command('init')
    .description('Initialize Code-Synapse for the current project')
    .action(initCommand);
  ```

### Logging & Diagnostics

**Pino (Structured Logger)**
- **Why Chosen**:
  - Extremely fast (async logging)
  - Structured JSON logs
  - Log levels (trace, debug, info, warn, error)
  - Pretty-printing for development

- **Log Storage**:
  ```
  .codegraph/logs/
  ├── indexer.log       (indexing operations)
  ├── mcp-server.log    (MCP requests/responses)
  ├── llm-inference.log (LLM calls and results)
  └── errors.log        (all errors)
  ```

- **Usage**:
  ```typescript
  import pino from 'pino';
  
  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  });
  ```

### Package Manager & Distribution

**pnpm (Package Manager)**
- **Distribution Method**: Local development / global CLI
- **Installation**: `pnpm install` (local) or `npm install -g code-synapse` (global)
- **Binary Command**: `code-synapse`

**Package Configuration**:
```json
{
  "name": "code-synapse",
  "bin": {
    "code-synapse": "./dist/cli/index.js"
  },
  "packageManager": "pnpm@9.0.0",
  "engines": {
    "node": ">=18"
  }
}
```

### Build & Compilation Tools

**TypeScript Compiler (tsc)**
- **Why Chosen**:
  - Native TypeScript compiler - no extra dependencies
  - Simpler for CLI applications
  - Direct ESM output with proper module resolution
  - Watch mode built-in

- **Build Commands**:
  ```bash
  pnpm build       # Compile to dist/
  pnpm dev         # Watch mode (tsc --watch)
  pnpm check-types # Type check without emit
  ```

### Testing Framework

**Vitest (Test Runner)**
- **Why Chosen**:
  - Fast (Vite-powered)
  - Native TypeScript support
  - Compatible with Jest API
  - Watch mode built-in

- **Test Structure**:
  ```
  src/
  ├── parser/
  │   ├── parser.ts
  │   └── parser.test.ts
  ├── graph/
  │   ├── database.ts
  │   └── database.test.ts
  └── mcp/
      ├── server.ts
      └── server.test.ts
  ```

### Process Management

**pm2 (Optional - For Production)**
- **Why Consider**:
  - Keeps process running
  - Automatic restarts
  - Log management
  - Monitoring dashboard

- **Usage** (User-optional):
  ```bash
  pm2 start code-synapse -- start
  pm2 save
  pm2 startup
  ```

---

## System Components Architecture

### Component Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│                    CLI Application                       │
│  (Commander.js - User Interface & Command Routing)      │
└────────────────────┬────────────────────────────────────┘
                     │
    ┌────────────────┼────────────────┐
    │                │                │
    ▼                ▼                ▼
┌─────────┐    ┌─────────┐    ┌──────────┐
│  Init   │    │  Serve  │    │  Status  │
│ Command │    │ Command │    │ Command  │
└────┬────┘    └────┬────┘    └─────┬────┘
     │              │                │
     ▼              │                │
┌──────────────────────────────────────────────────┐
│            Indexer Coordinator                   │
│  (Orchestrates all indexing operations)          │
└────┬─────────────────────────────────────────┬───┘
     │                                         │
     ▼                                         ▼
┌──────────────────────┐            ┌──────────────────┐
│  File System Scanner │            │   File Watcher   │
│  (Initial Discovery) │            │ (Incremental)    │
└──────────┬───────────┘            └──────────┬───────┘
           │                                   │
           └──────────────┬────────────────────┘
                          ▼
              ┌───────────────────────┐
              │   Processing Queue    │
              │  (Parallel Processor) │
              └──────────┬────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    ┌────────┐    ┌──────────┐    ┌───────────┐
    │ Parser │    │ Semantic │    │ Pattern   │
    │ Layer  │    │ Analyzer │    │ Detector  │
    └───┬────┘    └─────┬────┘    └─────┬─────┘
        │               │               │
        └───────────────┼───────────────┘
                        ▼
          ┌──────────────────────────┐
          │   Entity & Relationship  │
          │   Extractor              │
          └──────────┬───────────────┘
                     │
                     ▼
          ┌──────────────────────────┐
          │   Graph Builder          │
          │   (KùzuDB Writer)        │
          └──────────┬───────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│              KùzuDB Graph Database              │
│  Nodes: File, Function, Class, Interface        │
│  Edges: CALLS, IMPORTS, CONTAINS, EXTENDS       │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │   Query Engine      │
        │  (Cypher Queries)   │
        └─────────┬───────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │    MCP Server       │
        │  (stdio transport)  │
        └─────────┬───────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │   AI Agent Client   │
        │  (Claude, Cursor)   │
        └─────────────────────┘
```

### Component Interaction Flow

**1. Initialization Flow**
```
User runs `code-synapse init`
     ↓
CLI Commander receives command
     ↓
Init Command Handler
     ↓
Project Detector (detect language, framework)
     ↓
Configuration Generator (create .codegraph/)
     ↓
Graph Database Initializer (setup KùzuDB schema)
     ↓
File System Scanner (discover all source files)
     ↓
Indexer Coordinator (orchestrate indexing)
     ↓
Parallel Processing Queue (process files)
     ↓
Graph Builder (write to database)
     ↓
Success message to user
```

**2. File Change Flow**
```
Developer edits file.ts
     ↓
File System (OS-level change notification)
     ↓
Chokidar Watcher (receives event)
     ↓
Debounce (wait 500ms for more changes)
     ↓
Change Event Emitted
     ↓
Indexer Coordinator (receives event)
     ↓
Load affected file(s)
     ↓
Incremental Parser (parse only changed file)
     ↓
Semantic Analyzer (re-analyze types)
     ↓
Relationship Updater (update graph edges)
     ↓
Graph Database (update affected nodes/edges)
     ↓
Log update completion
```

**3. MCP Query Flow**
```
Claude asks: "How does authentication work?"
     ↓
Claude Desktop (MCP Client)
     ↓
stdio message (JSON-RPC)
     ↓
MCP Server (receives request)
     ↓
Request Parser (extract tool name and params)
     ↓
Tool Handler Dispatcher
     ↓
Query Engine (formulate Cypher query)
     ↓
KùzuDB (execute graph query)
     ↓
Result Formatter (structure response)
     ↓
JSON-RPC Response
     ↓
stdio output
     ↓
Claude Desktop (display to user)
```

---

## Implementation Plan - Phase by Phase

### Phase 1: Project Foundation & Scaffolding ✅ COMPLETE

**Goal**: Set up project structure, development environment, and core utilities

> **Status**: ✅ Complete - All scaffolding, project structure, CLI framework, and core module stubs have been implemented. The project uses a three-part architecture (CLI, MCP, Core) with shared types and utilities.

#### Step 1.1: Initialize Project Structure

**What to Build**:
```
code-knowledge-platform/
├── package.json              # Project configuration
├── tsconfig.json             # TypeScript configuration
├── tsup.config.ts            # Build configuration
├── .gitignore                # Git ignore rules
├── README.md                 # Documentation
├── LICENSE                   # Apache 2.0 license
├── src/
│   ├── index.ts              # Main entry point
│   ├── cli/
│   │   └── index.ts          # CLI entry point
│   ├── core/
│   │   ├── types.ts          # Shared type definitions
│   │   ├── constants.ts      # Global constants
│   │   └── errors.ts         # Error classes
│   ├── utils/
│   │   ├── logger.ts         # Logging utility
│   │   └── fs.ts             # File system helpers
│   └── config/
│       └── defaults.ts       # Default configuration
└── tests/
    └── fixtures/             # Test code samples
```

**Dependencies to Install**:
```bash
# Core dependencies
pnpm add @huggingface/transformers   # Local embeddings
pnpm add @kuzu/kuzu-wasm             # Graph database (WASM)
pnpm add @lancedb/lancedb            # Vector database
pnpm add @modelcontextprotocol/sdk   # MCP protocol
pnpm add chalk ora                   # CLI output
pnpm add chokidar                    # File watching
pnpm add commander                   # CLI framework
pnpm add fast-glob                   # File pattern matching
pnpm add node-llama-cpp              # Local LLM inference
pnpm add pino                        # Structured logging
pnpm add tree-sitter-typescript tree-sitter-javascript  # Parser grammars
pnpm add web-tree-sitter             # Code parser (WASM)
pnpm add zod                         # Schema validation

# Development dependencies
pnpm add -D typescript @types/node   # TypeScript
pnpm add -D eslint typescript-eslint @eslint/js  # Linting
pnpm add -D eslint-config-prettier globals       # ESLint config
pnpm add -D prettier                 # Code formatting
pnpm add -D vitest                   # Testing
pnpm add -D pino-pretty              # Pretty logs (dev)
```

**Configuration Files**:

**package.json**:
```json
{
  "name": "code-synapse",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "code-synapse": "./dist/cli/index.js"
  },
  "scripts": {
    "dev": "tsc --watch",
    "build": "tsc",
    "start": "node dist/cli/index.js",
    "test": "vitest",
    "lint": "eslint --max-warnings 0",
    "check-types": "tsc --noEmit",
    "format": "prettier --write \"**/*.{ts,tsx,md}\""
  },
  "packageManager": "pnpm@9.0.0",
  "engines": {
    "node": ">=18"
  }
}
```

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noEmitOnError": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Build Tool**: Using `tsc` directly (TypeScript compiler)
- No bundler needed for CLI applications
- Simpler setup, fewer dependencies
- ESM output with NodeNext module resolution
- Run `pnpm build` to compile, `pnpm dev` for watch mode

#### Step 1.2: Core Utilities Implementation

**What to Build**: Create foundational utility modules

**Logger Module** (`src/utils/logger.ts`):
```typescript
// Structure (no implementation):
- createLogger(component: string): Logger
- Logger interface with methods: info, warn, error, debug
- Configure log levels from environment
- Setup file logging to .codegraph/logs/
- Pretty printing for console in development
```

**File System Utilities** (`src/utils/fs.ts`):
```typescript
// Structure:
- ensureDirectory(path: string): Promise<void>
- readFileWithEncoding(path: string): Promise<string>
- getFileStats(path: string): Promise<FileStats>
- calculateFileHash(path: string): Promise<string>
- isIgnoredPath(path: string, patterns: string[]): boolean
```

**Error Classes** (`src/core/errors.ts`):
```typescript
// Structure:
class CodeKnowledgeError extends Error {
  constructor(message: string, public code: string)
}

class InitializationError extends CodeKnowledgeError
class ParsingError extends CodeKnowledgeError
class GraphError extends CodeKnowledgeError
class MCPError extends CodeKnowledgeError
```

**Type Definitions** (`src/core/types.ts`):
```typescript
// Define core types:
interface ProjectConfig {
  rootPath: string;
  language: 'typescript' | 'javascript';
  framework?: 'nextjs' | 'react' | 'express';
  sourcePatterns: string[];
  ignorePatterns: string[];
}

interface FileEntity {
  id: string;
  path: string;
  relativePath: string;
  hash: string;
  size: number;
  lastModified: Date;
}

interface FunctionEntity {
  id: string;
  name: string;
  startLine: number;
  endLine: number;
  parameters: Parameter[];
  returnType?: string;
  isExported: boolean;
  isAsync: boolean;
}

// ... more entity types
```

#### Step 1.3: CLI Framework Setup

**What to Build**: Implement basic CLI with Commander.js

**CLI Entry Point** (`src/cli/index.ts`):
```typescript
// Structure:
#!/usr/bin/env node

- Import Commander
- Define program metadata (name, version, description)
- Register commands: init, serve, status, reindex
- Parse process.argv
- Handle errors globally
- Setup signal handlers (SIGINT, SIGTERM)
```

**Command Handlers** (Create placeholders):
- `src/cli/commands/init.ts` → Initialize project
- `src/cli/commands/serve.ts` → Start MCP server
- `src/cli/commands/status.ts` → Show indexing status
- `src/cli/commands/reindex.ts` → Force re-indexing

**What Each Command Does** (Implement in later phases):
```typescript
// init command signature:
async function initCommand(options: {
  force?: boolean;
  skipLLM?: boolean;
}): Promise<void>

// serve command signature:
async function serveCommand(options: {
  port?: number;
  debug?: boolean;
}): Promise<void>

// status command signature:
async function statusCommand(): Promise<void>
```

#### Step 1.4: No Post-Install Script Needed

**Decision**: Post-install scripts are not needed because:
- Node.js version is enforced via `engines` field in package.json
- Tree-sitter WASM files are loaded directly from `node_modules` at runtime
- Ollama check is done at runtime when LLM inference is requested
- Welcome message is shown by `code-synapse init` command

All dependencies come from npm packages defined in package.json - no external downloads.

---

### Phase 2: Graph Database Foundation 🔲 UP NEXT

**Goal**: Implement KùzuDB integration and define graph schema

> **Status**: 🔲 Pending - This is the next phase to implement. Will add KùzuDB wrapper, schema definitions, and graph operations.

#### Step 2.1: Database Wrapper Layer

**What to Build**: Abstraction layer for KùzuDB

**Database Module** (`src/graph/database.ts`):
```typescript
// Structure:
class GraphDatabase {
  constructor(dbPath: string)
  
  // Connection management
  async initialize(): Promise<void>
  async close(): Promise<void>
  
  // Schema management
  async createSchema(): Promise<void>
  async dropSchema(): Promise<void>
  
  // Transaction management
  async beginTransaction(): Promise<Transaction>
  async commit(tx: Transaction): Promise<void>
  async rollback(tx: Transaction): Promise<void>
  
  // Query execution
  async query<T>(cypher: string, params?: any): Promise<T[]>
  async execute(cypher: string, params?: any): Promise<void>
  
  // Batch operations
  async batchInsert(nodes: Node[], edges: Edge[]): Promise<void>
}
```

**Implementation Details**:
- Use `@kuzu/node` package
- Connection pooling (single connection for embedded DB)
- Query parameter binding for safety
- Error handling and logging
- Transaction isolation

#### Step 2.2: Graph Schema Definition

**What to Build**: Define complete graph schema in Cypher

**Schema File** (`src/graph/schema.ts`):
```typescript
// Define schema as Cypher DDL statements

// Node Types:
const FILE_NODE = `
CREATE NODE TABLE File(
  id STRING PRIMARY KEY,
  path STRING,
  relativePath STRING,
  extension STRING,
  hash STRING,
  size INT64,
  lastModified TIMESTAMP,
  language STRING,
  framework STRING
)`;

const FUNCTION_NODE = `
CREATE NODE TABLE Function(
  id STRING PRIMARY KEY,
  name STRING,
  fileId STRING,
  startLine INT32,
  endLine INT32,
  signature STRING,
  returnType STRING,
  isExported BOOLEAN,
  isAsync BOOLEAN,
  complexity INT32,
  docComment STRING,
  businessLogic STRING  # LLM-inferred
)`;

const CLASS_NODE = `
CREATE NODE TABLE Class(
  id STRING PRIMARY KEY,
  name STRING,
  fileId STRING,
  startLine INT32,
  endLine INT32,
  isAbstract BOOLEAN,
  isExported BOOLEAN,
  docComment STRING
)`;

const INTERFACE_NODE = `
CREATE NODE TABLE Interface(
  id STRING PRIMARY KEY,
  name STRING,
  fileId STRING,
  startLine INT32,
  endLine INT32,
  isExported BOOLEAN,
  properties STRING[]  # JSON-encoded
)`;

const VARIABLE_NODE = `
CREATE NODE TABLE Variable(
  id STRING PRIMARY KEY,
  name STRING,
  fileId STRING,
  type STRING,
  isConst BOOLEAN,
  isExported BOOLEAN,
  scope STRING  # 'global', 'function', 'block'
)`;

// Relationship Types:
const CONTAINS_REL = `
CREATE REL TABLE CONTAINS(
  FROM File TO Function|Class|Interface|Variable,
  lineNumber INT32
)`;

const CALLS_REL = `
CREATE REL TABLE CALLS(
  FROM Function TO Function,
  lineNumber INT32,
  isDirectCall BOOLEAN
)`;

const IMPORTS_REL = `
CREATE REL TABLE IMPORTS(
  FROM File TO File,
  importedSymbols STRING[],
  importType STRING  # 'named', 'default', 'namespace'
)`;

const EXTENDS_REL = `
CREATE REL TABLE EXTENDS(
  FROM Class TO Class|Interface
)`;

const IMPLEMENTS_REL = `
CREATE REL TABLE IMPLEMENTS(
  FROM Class TO Interface
)`;

const USES_TYPE_REL = `
CREATE REL TABLE USES_TYPE(
  FROM Function TO Class|Interface,
  context STRING  # 'parameter', 'return', 'variable'
)`;

const DATA_FLOW_REL = `
CREATE REL TABLE DATA_FLOW(
  FROM Variable TO Variable,
  lineNumber INT32,
  operation STRING  # 'assign', 'pass', 'return'
)`;
```

**Schema Initialization Function**:
```typescript
async function initializeSchema(db: GraphDatabase): Promise<void> {
  // Drop existing schema if exists
  // Create all node tables
  // Create all relationship tables
  // Create indexes on frequently queried fields
  // Create full-text search indexes
}
```

**Index Strategy**:
```sql
-- Indexes for performance
CREATE INDEX ON File(relativePath);
CREATE INDEX ON Function(name);
CREATE INDEX ON Function(fileId);
CREATE INDEX ON Class(name);

-- Full-text search indexes
CREATE INDEX ON Function(signature) USING FULLTEXT;
CREATE INDEX ON Function(businessLogic) USING FULLTEXT;
```

#### Step 2.3: Entity Models

**What to Build**: TypeScript models matching graph schema

**Models** (`src/graph/models/`):
```typescript
// File: file.model.ts
export interface FileNode {
  id: string;
  path: string;
  relativePath: string;
  extension: string;
  hash: string;
  size: number;
  lastModified: Date;
  language: string;
  framework?: string;
}

// File: function.model.ts
export interface FunctionNode {
  id: string;
  name: string;
  fileId: string;
  startLine: number;
  endLine: number;
  signature: string;
  returnType?: string;
  isExported: boolean;
  isAsync: boolean;
  complexity: number;
  docComment?: string;
  businessLogic?: string;
  parameters: ParameterInfo[];
}

export interface ParameterInfo {
  name: string;
  type?: string;
  defaultValue?: string;
  isOptional: boolean;
}

// File: relationships.model.ts
export interface CallsRelationship {
  fromId: string;
  toId: string;
  lineNumber: number;
  isDirectCall: boolean;
}

export interface ImportsRelationship {
  fromId: string;
  toId: string;
  importedSymbols: string[];
  importType: 'named' | 'default' | 'namespace';
}

// ... more models
```

#### Step 2.4: Graph Operations Layer

**What to Build**: High-level operations for graph manipulation

**Graph Operations** (`src/graph/operations.ts`):
```typescript
// Structure:
class GraphOperations {
  constructor(private db: GraphDatabase)
  
  // Node operations
  async createFile(file: FileNode): Promise<void>
  async createFunction(fn: FunctionNode): Promise<void>
  async createClass(cls: ClassNode): Promise<void>
  
  async getFileById(id: string): Promise<FileNode | null>
  async getFunctionById(id: string): Promise<FunctionNode | null>
  
  async updateFunction(id: string, updates: Partial<FunctionNode>): Promise<void>
  
  async deleteFile(id: string): Promise<void>  # Cascade delete
  
  // Relationship operations
  async createCallRelationship(call: CallsRelationship): Promise<void>
  async createImportRelationship(imp: ImportsRelationship): Promise<void>
  
  // Batch operations
  async batchCreateNodes(nodes: Node[]): Promise<void>
  async batchCreateRelationships(rels: Relationship[]): Promise<void>
  
  // Query operations
  async getFunctionsByFile(fileId: string): Promise<FunctionNode[]>
  async getCallees(functionId: string): Promise<FunctionNode[]>
  async getCallers(functionId: string): Promise<FunctionNode[]>
  async getImportChain(fileId: string): Promise<FileNode[]>
  
  // Analytics
  async getComplexityMetrics(): Promise<ComplexityMetrics>
  async getMostCalledFunctions(limit: number): Promise<FunctionNode[]>
}
```

**Implementation Strategy**:
- Use parameterized Cypher queries
- Batch operations with transactions
- Cache frequently accessed data
- Validate input before queries

---

### Phase 3: File System Scanner

**Goal**: Discover and catalog all source files in the project

#### Step 3.1: Project Detector

**What to Build**: Automatic project type detection

**Project Detector** (`src/indexer/project-detector.ts`):
```typescript
// Structure:
class ProjectDetector {
  constructor(private rootPath: string)
  
  async detectProject(): Promise<ProjectConfig> {
    // 1. Check for package.json
    // 2. Parse package.json for dependencies
    // 3. Detect framework (Next.js, React, Express, etc.)
    // 4. Check for tsconfig.json (TypeScript)
    // 5. Determine source directories
    // 6. Build ignore patterns
    // 7. Return configuration
  }
  
  private detectFramework(packageJson: any): string | undefined
  private detectLanguage(): 'typescript' | 'javascript'
  private getSourcePatterns(): string[]
  private getIgnorePatterns(): string[]
}
```

**Detection Logic**:
```typescript
// Framework detection:
- Next.js: Check for 'next' in dependencies
- React: Check for 'react' in dependencies
- Express: Check for 'express' in dependencies
- Nest.js: Check for '@nestjs/core'

// Source patterns by framework:
- Next.js: ['app/**/*.{ts,tsx}', 'pages/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}']
- React: ['src/**/*.{ts,tsx,js,jsx}']
- Express: ['src/**/*.{ts,js}', 'routes/**/*.{ts,js}']

// Default ignore patterns:
- node_modules/
- dist/
- build/
- .next/
- coverage/
- *.test.{ts,js}
- *.spec.{ts,js}
```

#### Step 3.2: File Scanner

**What to Build**: Recursive file discovery

**File Scanner** (`src/indexer/scanner.ts`):
```typescript
// Structure:
class FileScanner {
  constructor(
    private config: ProjectConfig,
    private logger: Logger
  )
  
  async scanFiles(): Promise<FileInfo[]> {
    // 1. Start from project root
    // 2. Apply glob patterns (sourcePatterns)
    // 3. Filter using ignorePatterns
    // 4. Collect file metadata (size, modified time, hash)
    // 5. Categorize by language/extension
    // 6. Return sorted list
  }
  
  private async getFileMetadata(path: string): Promise<FileMetadata>
  private shouldIncludeFile(path: string): boolean
  private categorizeFile(extension: string): string
}

interface FileInfo {
  absolutePath: string;
  relativePath: string;
  extension: string;
  size: number;
  lastModified: Date;
  hash: string;
  language: string;
}
```

**Implementation Details**:
- Use `fast-glob` library for pattern matching
- Parallel file stat operations (limit: 10 concurrent)
- Calculate MD5 hash for change detection
- Sort files by path for deterministic processing

**Usage**:
```typescript
const scanner = new FileScanner(projectConfig, logger);
const files = await scanner.scanFiles();
// Returns: 127 files in ~1-2 seconds
```

#### Step 3.3: File Hasher

**What to Build**: Content-based change detection

**File Hasher** (`src/indexer/hasher.ts`):
```typescript
// Structure:
class FileHasher {
  // Compute hash for change detection
  async computeHash(filePath: string): Promise<string>
  
  // Compare with stored hash
  async hasFileChanged(
    filePath: string,
    storedHash: string
  ): Promise<boolean>
  
  // Batch hash computation
  async computeHashes(files: string[]): Promise<Map<string, string>>
}
```

**Hashing Strategy**:
- Use MD5 (fast, sufficient for change detection)
- Hash file contents, not metadata
- Cache hashes in memory for session
- Store hashes in graph database

---

### Phase 4: Code Parser Layer

**Goal**: Parse source files into Abstract Syntax Trees (ASTs)

#### Step 4.1: Tree-sitter Integration

**What to Build**: Tree-sitter parser wrapper

**Parser Manager** (`src/parser/parser-manager.ts`):
```typescript
// Structure:
class ParserManager {
  private parsers: Map<string, Parser>;
  
  async initialize(): Promise<void> {
    // 1. Load Tree-sitter WASM
    // 2. Load language grammars (TypeScript, JavaScript)
    // 3. Create parser instances
    // 4. Cache parsers by language
  }
  
  async parseFile(
    filePath: string,
    language: string
  ): Promise<SyntaxTree> {
    // 1. Read file contents
    // 2. Get parser for language
    // 3. Parse to Tree-sitter tree
    // 4. Return syntax tree
  }
  
  async parseCode(
    code: string,
    language: string
  ): Promise<SyntaxTree> {
    // Parse code string directly
  }
  
  async incrementalParse(
    oldTree: SyntaxTree,
    changes: FileChange[]
  ): Promise<SyntaxTree> {
    // Use Tree-sitter incremental parsing
    // Only re-parse changed sections
  }
  
  getParser(language: string): Parser
}
```

**Parser Initialization**:
```typescript
// Load WASM parsers:
await Parser.init();

const tsParser = new Parser();
const TypeScript = await Parser.Language.load(
  './parsers/tree-sitter-typescript.wasm'
);
tsParser.setLanguage(TypeScript);

const jsParser = new Parser();
const JavaScript = await Parser.Language.load(
  './parsers/tree-sitter-javascript.wasm'
);
jsParser.setLanguage(JavaScript);
```

#### Step 4.2: AST Transformer

**What to Build**: Convert Tree-sitter CST to simplified AST

**AST Transformer** (`src/parser/ast-transformer.ts`):
```typescript
// Structure:
class ASTTransformer {
  transform(tree: Tree, sourceCode: string): SimplifiedAST
  
  private extractFunctions(node: SyntaxNode): FunctionDeclaration[]
  private extractClasses(node: SyntaxNode): ClassDeclaration[]
  private extractInterfaces(node: SyntaxNode): InterfaceDeclaration[]
  private extractImports(node: SyntaxNode): ImportDeclaration[]
  private extractExports(node: SyntaxNode): ExportDeclaration[]
}

interface SimplifiedAST {
  functions: FunctionDeclaration[];
  classes: ClassDeclaration[];
  interfaces: InterfaceDeclaration[];
  variables: VariableDeclaration[];
  imports: ImportDeclaration[];
  exports: ExportDeclaration[];
}
```

**What to Extract from Tree-sitter Tree**:
```typescript
// For Functions:
{
  name: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  parameters: Parameter[];
  returnType?: string;
  isExported: boolean;
  isAsync: boolean;
  isGenerator: boolean;
  body: string;  // Raw function body text
}

// For Classes:
{
  name: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  isAbstract: boolean;
  extends?: string;
  implements: string[];
  methods: MethodDeclaration[];
  properties: PropertyDeclaration[];
}

// For Imports:
{
  source: string;  // Module path
  specifiers: {
    local: string;   // Local name
    imported: string; // Original name
    type: 'named' | 'default' | 'namespace';
  }[];
  isTypeOnly: boolean;
}
```

**Tree-sitter Query Patterns**:
```scheme
;; Function declarations
(function_declaration
  name: (identifier) @function.name
  parameters: (formal_parameters) @function.params
  return_type: (type_annotation)? @function.return
  body: (statement_block) @function.body)

;; Class declarations
(class_declaration
  name: (type_identifier) @class.name
  (class_heritage)? @class.heritage
  body: (class_body) @class.body)

;; Import statements
(import_statement
  source: (string) @import.source
  (import_clause) @import.clause)
```

#### Step 4.3: Call Graph Extractor

**What to Build**: Extract function call relationships

**Call Extractor** (`src/parser/call-extractor.ts`):
```typescript
// Structure:
class CallExtractor {
  extractCalls(
    ast: SimplifiedAST,
    sourceCode: string
  ): FunctionCall[]
  
  private findCallExpressions(
    functionBody: string
  ): CallExpression[]
  
  private resolveCalledFunction(
    callName: string,
    scope: Scope
  ): string | null
}

interface FunctionCall {
  callerName: string;
  calleeName: string;
  lineNumber: number;
  isDirectCall: boolean;  // Direct vs through variable
}
```

**Call Detection Strategy**:
```typescript
// Pattern matching in function bodies:
- function_call_expression
- method_call_expression
- new_expression (constructor calls)

// Example:
async function authenticate(token: string) {
  const user = await validateToken(token);  // ← Extract this call
  const session = createSession(user);       // ← Extract this call
  return session;
}

// Extract: authenticate → validateToken
//          authenticate → createSession
```

---

### Phase 5: Semantic Analysis Layer

**Goal**: Resolve types, symbols, and cross-file references

#### Step 5.1: TypeScript Compiler Integration

**What to Build**: TypeScript Program loader

**TS Program Manager** (`src/semantic/ts-program.ts`):
```typescript
// Structure:
class TypeScriptProgramManager {
  private program: ts.Program;
  private typeChecker: ts.TypeChecker;
  
  async loadProgram(
    rootPath: string
  ): Promise<void> {
    // 1. Find tsconfig.json
    // 2. Parse compiler options
    // 3. Collect source files
    // 4. Create TypeScript Program
    // 5. Get type checker
  }
  
  getTypeChecker(): ts.TypeChecker
  getProgram(): ts.Program
  getSourceFile(filePath: string): ts.SourceFile | undefined
}
```

**Program Creation**:
```typescript
// Load project configuration
const configPath = ts.findConfigFile(rootPath, ts.sys.fileExists);
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  path.dirname(configPath)
);

// Create program
const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: parsed.options
});

const typeChecker = program.getTypeChecker();
```

#### Step 5.2: Type Resolver

**What to Build**: Resolve types for all symbols

**Type Resolver** (`src/semantic/type-resolver.ts`):
```typescript
// Structure:
class TypeResolver {
  constructor(
    private typeChecker: ts.TypeChecker,
    private program: ts.Program
  )
  
  resolveType(node: ts.Node): TypeInfo {
    // Use TypeScript Compiler API to resolve type
    const type = this.typeChecker.getTypeAtLocation(node);
    return this.typeToString(type);
  }
  
  resolveFunctionSignature(
    functionNode: ts.FunctionDeclaration
  ): FunctionSignature {
    // Extract complete function signature with types
  }
  
  resolveParameterTypes(
    parameters: ts.NodeArray<ts.ParameterDeclaration>
  ): ParameterType[] {
    // Resolve each parameter's type
  }
  
  private typeToString(type: ts.Type): string {
    return this.typeChecker.typeToString(type);
  }
}

interface TypeInfo {
  typeString: string;
  isUnion: boolean;
  isIntersection: boolean;
  isPrimitive: boolean;
  isCustomType: boolean;
}
```

**What Types to Extract**:
```typescript
// Function parameter types:
function createUser(name: string, age: number): User {
  // Extract: name → string, age → number, return → User
}

// Variable types:
const users: User[] = [];  // Extract: users → User[]

// Complex types:
type Response<T> = {
  data: T;
  error?: Error;
};
// Extract full type definition
```

#### Step 5.3: Symbol Linker

**What to Build**: Link function calls to definitions across files

**Symbol Linker** (`src/semantic/symbol-linker.ts`):
```typescript
// Structure:
class SymbolLinker {
  constructor(
    private typeChecker: ts.TypeChecker,
    private program: ts.Program
  )
  
  linkCallToDefinition(
    callExpression: ts.CallExpression
  ): DefinitionLocation | null {
    // 1. Get called function identifier
    // 2. Use typeChecker to find symbol
    // 3. Get symbol declarations
    // 4. Return file path and location
  }
  
  findAllReferences(
    symbol: ts.Symbol
  ): ReferenceLocation[] {
    // Find all places where symbol is used
  }
  
  resolveImportedSymbol(
    importSpecifier: ts.ImportSpecifier
  ): Symbol {
    // Resolve imported symbol to its definition
  }
}

interface DefinitionLocation {
  filePath: string;
  startLine: number;
  endLine: number;
  name: string;
}
```

**Symbol Linking Example**:
```typescript
// File: auth.ts
export async function validateToken(token: string): Promise<User> {
  // ...
}

// File: middleware.ts
import { validateToken } from './auth';

async function authenticate(req: Request) {
  const user = await validateToken(req.token);
  //                  ^^^^^^^^^^^^^ 
  // Link this call → auth.ts:validateToken
}
```

**Implementation**:
```typescript
const symbol = typeChecker.getSymbolAtLocation(callExpression.expression);
if (symbol) {
  const declarations = symbol.getDeclarations();
  const declaration = declarations[0];
  const sourceFile = declaration.getSourceFile();
  
  return {
    filePath: sourceFile.fileName,
    startLine: sourceFile.getLineAndCharacterOfPosition(declaration.pos).line,
    name: symbol.getName()
  };
}
```

#### Step 5.4: Dependency Graph Builder

**What to Build**: Build complete module dependency graph

**Dependency Analyzer** (`src/semantic/dependency-analyzer.ts`):
```typescript
// Structure:
class DependencyAnalyzer {
  constructor(
    private program: ts.Program,
    private projectRoot: string
  )
  
  buildDependencyGraph(): DependencyGraph {
    // 1. Collect all import statements
    // 2. Resolve module paths
    // 3. Build directed graph of file dependencies
    // 4. Detect circular dependencies
    // 5. Calculate dependency depth
  }
  
  getFileDependencies(filePath: string): string[] {
    // Direct dependencies of a file
  }
  
  getTransitiveDependencies(filePath: string): string[] {
    // All transitive dependencies
  }
  
  detectCircularDependencies(): CircularDependency[] {
    // Find circular import chains
  }
}

interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: DependencyEdge[];
}

interface DependencyNode {
  filePath: string;
  directDependencies: string[];
  dependents: string[];  // Files that depend on this
  depth: number;         // Dependency depth from root
}
```

**Dependency Resolution**:
```typescript
// For import like:
import { User } from './models/User';

// Resolve to absolute path:
const resolvedPath = ts.resolveModuleName(
  './models/User',
  sourceFile.fileName,
  compilerOptions,
  ts.sys
).resolvedModule.resolvedFileName;

// Store as dependency edge:
{
  from: 'src/services/auth.ts',
  to: 'src/models/User.ts',
  importedSymbols: ['User']
}
```

---

### Phase 6: Entity Extraction

**Goal**: Extract structured entities from parsed code

#### Step 6.1: Function Entity Extractor

**What to Build**: Extract complete function information

**Function Extractor** (`src/extractor/function-extractor.ts`):
```typescript
// Structure:
class FunctionExtractor {
  constructor(
    private typeResolver: TypeResolver,
    private logger: Logger
  )
  
  extract(
    ast: SimplifiedAST,
    filePath: string
  ): FunctionEntity[] {
    // 1. Iterate through function declarations
    // 2. Extract metadata (name, location, etc.)
    // 3. Resolve parameter types
    // 4. Resolve return type
    // 5. Calculate complexity
    // 6. Extract JSDoc comments
    // 7. Generate unique ID
    // 8. Return entities
  }
  
  private calculateComplexity(functionBody: string): number {
    // Cyclomatic complexity calculation
  }
  
  private extractDocComment(node: ts.Node): string | undefined
  
  private generateFunctionId(
    filePath: string,
    functionName: string,
    startLine: number
  ): string {
    // Format: file:path:functionName:line
  }
}

interface FunctionEntity {
  id: string;
  name: string;
  fileId: string;
  startLine: number;
  endLine: number;
  signature: string;
  parameters: Parameter[];
  returnType?: string;
  isExported: boolean;
  isAsync: boolean;
  complexity: number;
  docComment?: string;
}
```

**Complexity Calculation**:
```typescript
// Count decision points:
- if statements
- else branches
- switch cases
- loops (for, while, do-while)
- ternary operators (? :)
- logical operators (&& ||)
- catch blocks

// Formula: Complexity = 1 + number of decision points
```

#### Step 6.2: Class Entity Extractor

**What to Build**: Extract class definitions

**Class Extractor** (`src/extractor/class-extractor.ts`):
```typescript
// Structure:
class ClassExtractor {
  constructor(
    private typeResolver: TypeResolver,
    private logger: Logger
  )
  
  extract(
    ast: SimplifiedAST,
    filePath: string
  ): ClassEntity[] {
    // Extract class metadata
    // Include methods, properties, constructors
    // Resolve extends/implements relationships
  }
  
  private extractMethods(classBody: ts.ClassBody): MethodInfo[]
  private extractProperties(classBody: ts.ClassBody): PropertyInfo[]
  private extractConstructor(classBody: ts.ClassBody): ConstructorInfo | null
}

interface ClassEntity {
  id: string;
  name: string;
  fileId: string;
  startLine: number;
  endLine: number;
  isAbstract: boolean;
  isExported: boolean;
  extends?: string;
  implements: string[];
  methods: MethodInfo[];
  properties: PropertyInfo[];
  constructor?: ConstructorInfo;
}
```

#### Step 6.3: Import/Export Extractor

**What to Build**: Extract module relationships

**Import Extractor** (`src/extractor/import-extractor.ts`):
```typescript
// Structure:
class ImportExtractor {
  extract(
    ast: SimplifiedAST,
    filePath: string
  ): ImportEntity[] {
    // 1. Extract import statements
    // 2. Resolve module paths
    // 3. Categorize import types
    // 4. Track imported symbols
  }
  
  private resolveModulePath(
    importSource: string,
    currentFile: string
  ): string | null
  
  private categorizeImport(
    importDeclaration: ts.ImportDeclaration
  ): ImportType
}

interface ImportEntity {
  id: string;
  sourceFileId: string;
  targetFileId: string;
  importedSymbols: ImportedSymbol[];
  importType: 'named' | 'default' | 'namespace';
  isTypeOnly: boolean;
  lineNumber: number;
}

interface ImportedSymbol {
  localName: string;
  originalName: string;
  isType: boolean;
}
```

**Import Type Examples**:
```typescript
// Named import:
import { User, Role } from './models';

// Default import:
import express from 'express';

// Namespace import:
import * as fs from 'fs';

// Type-only import:
import type { Config } from './config';
```

---

### Phase 7: Graph Building

**Goal**: Insert extracted entities into graph database

#### Step 7.1: Graph Writer

**What to Build**: Efficient batch insertion into KùzuDB

**Graph Writer** (`src/graph/writer.ts`):
```typescript
// Structure:
class GraphWriter {
  constructor(
    private db: GraphDatabase,
    private logger: Logger
  )
  
  async writeEntities(
    files: FileEntity[],
    functions: FunctionEntity[],
    classes: ClassEntity[],
    imports: ImportEntity[]
  ): Promise<void> {
    // Use transactions for atomicity
    const tx = await this.db.beginTransaction();
    
    try {
      // Insert in order to respect foreign keys
      await this.insertFiles(files, tx);
      await this.insertFunctions(functions, tx);
      await this.insertClasses(classes, tx);
      await this.insertRelationships(imports, tx);
      
      await this.db.commit(tx);
    } catch (error) {
      await this.db.rollback(tx);
      throw error;
    }
  }
  
  private async insertFiles(
    files: FileEntity[],
    tx: Transaction
  ): Promise<void> {
    // Batch insert: 100 nodes per query
    const batches = this.chunk(files, 100);
    for (const batch of batches) {
      await this.db.execute(
        `UNWIND $nodes AS node
         CREATE (f:File {
           id: node.id,
           path: node.path,
           ...
         })`,
        { nodes: batch },
        tx
      );
    }
  }
  
  private async insertFunctions(
    functions: FunctionEntity[],
    tx: Transaction
  ): Promise<void>
  
  private async insertRelationships(
    relationships: Relationship[],
    tx: Transaction
  ): Promise<void>
  
  private chunk<T>(array: T[], size: number): T[][]
}
```

**Batch Insertion Strategy**:
```typescript
// Batch size considerations:
- Files: 100 per batch (small nodes)
- Functions: 50 per batch (larger nodes with metadata)
- Relationships: 200 per batch (just two IDs)

// Use UNWIND for batch inserts:
UNWIND $nodes AS node
CREATE (n:Function {
  id: node.id,
  name: node.name,
  fileId: node.fileId,
  startLine: node.startLine,
  // ... more properties
})

// Why this is efficient:
- Single query for multiple nodes
- KùzuDB optimizes bulk inserts
- Reduces transaction overhead
```

#### Step 7.2: Incremental Updater

**What to Build**: Update graph for file changes

**Incremental Updater** (`src/graph/updater.ts`):
```typescript
// Structure:
class IncrementalUpdater {
  constructor(
    private db: GraphDatabase,
    private graphWriter: GraphWriter,
    private logger: Logger
  )
  
  async updateFile(
    filePath: string,
    newEntities: ExtractedEntities
  ): Promise<void> {
    // 1. Delete old nodes for this file
    // 2. Delete old relationships
    // 3. Insert new entities
    // 4. Update relationships
  }
  
  private async deleteFileNodes(
    fileId: string
  ): Promise<void> {
    // Delete all nodes belonging to file
    await this.db.execute(`
      MATCH (f:File {id: $fileId})
      OPTIONAL MATCH (f)-[:CONTAINS]->(n)
      DETACH DELETE n
    `, { fileId });
  }
  
  private async updateAffectedRelationships(
    fileId: string,
    changedSymbols: string[]
  ): Promise<void> {
    // Update call relationships if function signatures changed
    // Update import relationships if exports changed
  }
}
```

**Change Detection Strategy**:
```typescript
// On file change:
1. Compare new hash with stored hash
2. If different, extract new entities
3. Delete old entities (cascade)
4. Insert new entities
5. Update cross-file relationships
6. Update hash in database

// Affected relationships:
- If function renamed: Update CALLS relationships
- If export added/removed: Update IMPORTS relationships
- If class changed: Update EXTENDS/IMPLEMENTS
```

---

### Phase 8: Indexer Coordinator

**Goal**: Orchestrate the entire indexing pipeline

#### Step 8.1: Indexer Coordinator

**What to Build**: Main orchestration component

**Indexer Coordinator** (`src/indexer/coordinator.ts`):
```typescript
// Structure:
class IndexerCoordinator {
  constructor(
    private projectRoot: string,
    private db: GraphDatabase,
    private parserManager: ParserManager,
    private config: ProjectConfig
  )
  
  async indexProject(): Promise<IndexResult> {
    // Complete indexing pipeline
    this.logger.info('Starting project indexing...');
    
    // Phase 1: Scan files
    const files = await this.scanPhase();
    
    // Phase 2: Parse files (parallel)
    const parsed = await this.parsePhase(files);
    
    // Phase 3: Semantic analysis
    const analyzed = await this.semanticPhase(parsed);
    
    // Phase 4: Extract entities
    const entities = await this.extractionPhase(analyzed);
    
    // Phase 5: Build graph
    await this.graphBuildingPhase(entities);
    
    return this.generateReport();
  }
  
  private async scanPhase(): Promise<FileInfo[]> {
    const scanner = new FileScanner(this.config, this.logger);
    return await scanner.scanFiles();
  }
  
  private async parsePhase(
    files: FileInfo[]
  ): Promise<ParsedFile[]> {
    // Parallel parsing with p-queue
    const queue = new PQueue({ concurrency: 4 });
    
    return await Promise.all(
      files.map(file => 
        queue.add(() => this.parseFile(file))
      )
    );
  }
  
  private async parseFile(
    file: FileInfo
  ): Promise<ParsedFile> {
    const tree = await this.parserManager.parseFile(
      file.absolutePath,
      file.language
    );
    
    const ast = this.astTransformer.transform(tree);
    
    return { file, ast };
  }
  
  private async semanticPhase(
    parsed: ParsedFile[]
  ): Promise<AnalyzedFile[]> {
    // Load TypeScript program
    const tsProgram = new TypeScriptProgramManager();
    await tsProgram.loadProgram(this.projectRoot);
    
    // Analyze each file
    return await this.analyzeSemantics(parsed, tsProgram);
  }
  
  private async extractionPhase(
    analyzed: AnalyzedFile[]
  ): Promise<ExtractedEntities> {
    // Extract all entities
    const functionExtractor = new FunctionExtractor(...);
    const classExtractor = new ClassExtractor(...);
    const importExtractor = new ImportExtractor(...);
    
    const allFunctions = [];
    const allClasses = [];
    const allImports = [];
    
    for (const file of analyzed) {
      allFunctions.push(...functionExtractor.extract(file));
      allClasses.push(...classExtractor.extract(file));
      allImports.push(...importExtractor.extract(file));
    }
    
    return { allFunctions, allClasses, allImports };
  }
  
  private async graphBuildingPhase(
    entities: ExtractedEntities
  ): Promise<void> {
    const writer = new GraphWriter(this.db, this.logger);
    await writer.writeEntities(entities);
  }
  
  private generateReport(): IndexResult {
    return {
      filesIndexed: this.stats.fileCount,
      functionsFound: this.stats.functionCount,
      classesFound: this.stats.classCount,
      relationshipsCreated: this.stats.relationshipCount,
      duration: this.stats.duration,
      errors: this.errors
    };
  }
}
```

#### Step 8.2: Progress Reporter

**What to Build**: User-facing progress updates

**Progress Reporter** (`src/indexer/progress.ts`):
```typescript
// Structure:
class ProgressReporter {
  private spinner: Ora;
  
  startPhase(phase: string, total: number): void {
    // Display: ⠋ Indexing Layer 1/3: Syntax...
    this.spinner = ora({
      text: phase,
      spinner: 'dots'
    }).start();
  }
  
  updateProgress(current: number, total: number): void {
    // Update: Parsing files: 45/127 [██████░░░░] 35%
  }
  
  completePhase(duration: number): void {
    // Display: ✓ Syntax layer complete (5.2s)
    this.spinner.succeed();
  }
  
  reportError(error: Error): void {
    this.spinner.fail();
  }
}
```

**Usage in Coordinator**:
```typescript
const progress = new ProgressReporter();

progress.startPhase('Indexing Layer 1/3: Syntax...', files.length);

for (let i = 0; i < files.length; i++) {
  await this.parseFile(files[i]);
  progress.updateProgress(i + 1, files.length);
}

progress.completePhase(elapsed);
```

#### Step 8.3: Error Recovery

**What to Build**: Graceful error handling

**Error Handler** (`src/indexer/error-handler.ts`):
```typescript
// Structure:
class IndexerErrorHandler {
  handleParseError(
    file: string,
    error: Error
  ): void {
    // Log error
    // Continue with other files
    // Mark file as failed
  }
  
  handleSemanticError(
    file: string,
    error: Error
  ): void {
    // Fall back to syntax-only indexing
  }
  
  handleGraphError(error: Error): void {
    // Rollback transaction
    // Retry with exponential backoff
  }
  
  generateErrorReport(): ErrorReport {
    // Summary of all errors encountered
  }
}
```

---

### Phase 9: File Watcher

**Goal**: Real-time incremental updates

#### Step 9.1: File Watcher Implementation

**What to Build**: Monitor file system for changes

**File Watcher** (`src/watcher/file-watcher.ts`):
```typescript
// Structure:
class FileWatcher {
  private watcher: chokidar.FSWatcher;
  private debounceMap: Map<string, NodeJS.Timeout>;
  
  constructor(
    private projectRoot: string,
    private config: ProjectConfig,
    private coordinator: IndexerCoordinator
  )
  
  async start(): Promise<void> {
    this.watcher = chokidar.watch(
      this.config.sourcePatterns,
      {
        cwd: this.projectRoot,
        ignored: this.config.ignorePatterns,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100
        }
      }
    );
    
    this.watcher
      .on('add', (path) => this.handleFileAdded(path))
      .on('change', (path) => this.handleFileChanged(path))
      .on('unlink', (path) => this.handleFileDeleted(path));
    
    this.logger.info('File watcher started');
  }
  
  private handleFileAdded(path: string): void {
    this.debounce(path, async () => {
      this.logger.info(`File added: ${path}`);
      await this.coordinator.indexFile(path);
    });
  }
  
  private handleFileChanged(path: string): void {
    this.debounce(path, async () => {
      this.logger.info(`File changed: ${path}`);
      await this.coordinator.reindexFile(path);
    });
  }
  
  private handleFileDeleted(path: string): void {
    this.debounce(path, async () => {
      this.logger.info(`File deleted: ${path}`);
      await this.coordinator.removeFile(path);
    });
  }
  
  private debounce(
    path: string,
    callback: () => Promise<void>
  ): void {
    // Clear existing timeout for this file
    if (this.debounceMap.has(path)) {
      clearTimeout(this.debounceMap.get(path)!);
    }
    
    // Set new timeout
    const timeout = setTimeout(async () => {
      await callback();
      this.debounceMap.delete(path);
    }, 500);
    
    this.debounceMap.set(path, timeout);
  }
  
  async stop(): Promise<void> {
    await this.watcher.close();
  }
}
```

#### Step 9.2: Incremental Indexing

**What to Build**: Fast updates for changed files

**Incremental Indexer** (`src/indexer/incremental-indexer.ts`):
```typescript
// Structure:
class IncrementalIndexer {
  async reindexFile(filePath: string): Promise<void> {
    // 1. Read file
    // 2. Compute new hash
    // 3. Compare with stored hash
    // 4. If changed:
    //    a. Parse file (use incremental parsing if available)
    //    b. Extract entities
    //    c. Update graph database
    //    d. Update hash
  }
  
  async addFile(filePath: string): Promise<void> {
    // Full index for new file
  }
  
  async removeFile(filePath: string): Promise<void> {
    // Delete all nodes and relationships for file
    await this.db.execute(`
      MATCH (f:File {path: $path})
      OPTIONAL MATCH (f)-[:CONTAINS]->(n)
      DETACH DELETE f, n
    `, { path: filePath });
  }
}
```

**Optimization: Incremental Parsing**:
```typescript
// Tree-sitter supports incremental parsing
const oldTree = this.treeCache.get(filePath);

if (oldTree) {
  // Only re-parse changed sections
  const newTree = this.parser.parse(newCode, oldTree);
  
  // Tree-sitter tracks which nodes changed
  const changes = newTree.getChangedRanges(oldTree);
  
  // Only extract entities from changed ranges
  for (const range of changes) {
    const affectedFunctions = this.findFunctionsInRange(range);
    // Re-extract only these functions
  }
}
```

---

### Phase 10: MCP Server

**Goal**: Expose graph data to AI agents via MCP protocol

#### Step 10.1: MCP Server Implementation

**What to Build**: Standards-compliant MCP server

**MCP Server** (`src/mcp/server.ts`):
```typescript
// Structure:
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

class CodeKnowledgeMCPServer {
  private server: Server;
  private db: GraphDatabase;
  private queryEngine: QueryEngine;
  
  constructor(db: GraphDatabase) {
    this.db = db;
    this.queryEngine = new QueryEngine(db);
    
    this.server = new Server(
      {
        name: 'code-knowledge',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        },
      }
    );
    
    this.registerTools();
    this.registerResources();
  }
  
  private registerTools(): void {
    // Register MCP tools
    this.server.setRequestHandler(
      ListToolsRequestSchema,
      async () => ({
        tools: [
          {
            name: 'search_code',
            description: 'Search for code elements by name or pattern',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                type: {
                  type: 'string',
                  enum: ['function', 'class', 'interface', 'all']
                }
              },
              required: ['query']
            }
          },
          {
            name: 'get_function_context',
            description: 'Get complete context for a function',
            inputSchema: {
              type: 'object',
              properties: {
                functionName: { type: 'string' },
                filePath: { type: 'string' }
              },
              required: ['functionName']
            }
          },
          {
            name: 'find_dependencies',
            description: 'Find dependencies of a file or function',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string' }
              },
              required: ['path']
            }
          },
          {
            name: 'trace_call_chain',
            description: 'Trace the call chain from a function',
            inputSchema: {
              type: 'object',
              properties: {
                functionName: { type: 'string' },
                direction: {
                  type: 'string',
                  enum: ['callers', 'callees', 'both']
                },
                depth: { type: 'number', default: 3 }
              },
              required: ['functionName']
            }
          },
          {
            name: 'explain_feature',
            description: 'Explain how a feature works across the codebase',
            inputSchema: {
              type: 'object',
              properties: {
                feature: { type: 'string' }
              },
              required: ['feature']
            }
          }
        ]
      })
    );
    
    // Handle tool calls
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const { name, arguments: args } = request.params;
        
        switch (name) {
          case 'search_code':
            return this.handleSearchCode(args);
          case 'get_function_context':
            return this.handleGetContext(args);
          case 'find_dependencies':
            return this.handleFindDependencies(args);
          case 'trace_call_chain':
            return this.handleTraceCallChain(args);
          case 'explain_feature':
            return this.handleExplainFeature(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      }
    );
  }
  
  private registerResources(): void {
    // Register MCP resources (files, functions as resources)
    this.server.setRequestHandler(
      ListResourcesRequestSchema,
      async () => ({
        resources: [
          {
            uri: 'codegraph://functions',
            name: 'All Functions',
            mimeType: 'application/json'
          },
          {
            uri: 'codegraph://classes',
            name: 'All Classes',
            mimeType: 'application/json'
          }
        ]
      })
    );
  }
  
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    this.logger.info('MCP Server started');
    this.logger.info('Waiting for MCP client...');
  }
  
  // Tool handlers
  private async handleSearchCode(args: any): Promise<any> {
    const results = await this.queryEngine.search(
      args.query,
      args.type
    );
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2)
        }
      ]
    };
  }
  
  private async handleGetContext(args: any): Promise<any> {
    const context = await this.queryEngine.getFunctionContext(
      args.functionName,
      args.filePath
    );
    
    return {
      content: [
        {
          type: 'text',
          text: this.formatContext(context)
        }
      ]
    };
  }
  
  private async handleTraceCallChain(args: any): Promise<any> {
    const chain = await this.queryEngine.traceCallChain(
      args.functionName,
      args.direction,
      args.depth
    );
    
    return {
      content: [
        {
          type: 'text',
          text: this.formatCallChain(chain)
        }
      ]
    };
  }
}
```

#### Step 10.2: Query Engine

**What to Build**: High-level query interface for MCP tools

**Query Engine** (`src/query/engine.ts`):
```typescript
// Structure:
class QueryEngine {
  constructor(private db: GraphDatabase)
  
  async search(
    query: string,
    type?: string
  ): Promise<SearchResult[]> {
    // Full-text search across code entities
    let cypher = `
      MATCH (n)
      WHERE n.name CONTAINS $query
    `;
    
    if (type && type !== 'all') {
      cypher += ` AND labels(n)[0] = '${capitalize(type)}'`;
    }
    
    cypher += ` RETURN n LIMIT 50`;
    
    return await this.db.query(cypher, { query });
  }
  
  async getFunctionContext(
    functionName: string,
    filePath?: string
  ): Promise<FunctionContext> {
    // Get complete context for a function
    const query = `
      MATCH (f:Function {name: $name})
      OPTIONAL MATCH (file:File)-[:CONTAINS]->(f)
      OPTIONAL MATCH (f)-[:CALLS]->(callee:Function)
      OPTIONAL MATCH (caller:Function)-[:CALLS]->(f)
      OPTIONAL MATCH (f)-[:USES_TYPE]->(type)
      RETURN f, file, 
             collect(DISTINCT callee) as callees,
             collect(DISTINCT caller) as callers,
             collect(DISTINCT type) as types
    `;
    
    const result = await this.db.query(query, { 
      name: functionName 
    });
    
    return this.formatFunctionContext(result);
  }
  
  async traceCallChain(
    functionName: string,
    direction: 'callers' | 'callees' | 'both',
    depth: number
  ): Promise<CallChain> {
    // Recursive call chain traversal
    const query = direction === 'callees'
      ? this.getCalleesQuery(depth)
      : this.getCallersQuery(depth);
    
    const result = await this.db.query(query, { 
      name: functionName 
    });
    
    return this.buildCallTree(result);
  }
  
  private getCalleesQuery(depth: number): string {
    return `
      MATCH path = (start:Function {name: $name})
                   -[:CALLS*1..${depth}]->(end:Function)
      RETURN path
    `;
  }
  
  private getCallersQuery(depth: number): string {
    return `
      MATCH path = (start:Function)
                   -[:CALLS*1..${depth}]->(end:Function {name: $name})
      RETURN path
    `;
  }
  
  async findDependencies(
    filePath: string
  ): Promise<DependencyTree> {
    // Get file dependency tree
    const query = `
      MATCH (file:File {path: $path})
      OPTIONAL MATCH (file)-[:IMPORTS*1..5]->(dep:File)
      RETURN file, collect(DISTINCT dep) as dependencies
    `;
    
    const result = await this.db.query(query, { path: filePath });
    return this.buildDependencyTree(result);
  }
  
  async explainFeature(
    feature: string
  ): Promise<FeatureExplanation> {
    // Search for functions/classes related to feature
    // Use LLM-inferred business logic
    const query = `
      MATCH (n)
      WHERE n.businessLogic CONTAINS $feature
         OR n.name CONTAINS $feature
         OR n.docComment CONTAINS $feature
      RETURN n
    `;
    
    const entities = await this.db.query(query, { 
      feature: feature.toLowerCase() 
    });
    
    return this.synthesizeExplanation(entities);
  }
}
```

#### Step 10.3: Response Formatters

**What to Build**: Format graph data for AI consumption

**Response Formatter** (`src/mcp/formatter.ts`):
```typescript
// Structure:
class ResponseFormatter {
  formatContext(context: FunctionContext): string {
    // Format as readable text for AI
    return `
Function: ${context.function.name}
File: ${context.file.path}
Signature: ${context.function.signature}
Lines: ${context.function.startLine}-${context.function.endLine}

Parameters:
${context.function.parameters.map(p => 
  `  - ${p.name}: ${p.type}`
).join('\n')}

Return Type: ${context.function.returnType || 'void'}

Calls: ${context.callees.length} functions
  ${context.callees.map(f => `  - ${f.name}`).join('\n')}

Called By: ${context.callers.length} functions
  ${context.callers.map(f => `  - ${f.name}`).join('\n')}

${context.function.businessLogic ? 
  `Business Logic:\n${context.function.businessLogic}` : 
  ''
}
    `.trim();
  }
  
  formatCallChain(chain: CallChain): string {
    // Format call tree as indented text
  }
  
  formatDependencyTree(tree: DependencyTree): string {
    // Format dependencies as tree structure
  }
}
```

---

### Phase 11: LLM Integration

**Goal**: Add business logic inference layer

#### Step 11.1: Ollama Client

**What to Build**: HTTP client for Ollama

**Ollama Client** (`src/llm/ollama-client.ts`):
```typescript
// Structure:
class OllamaClient {
  private baseUrl = 'http://localhost:11434';
  
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
  
  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    const data = await response.json();
    return data.models.map((m: any) => m.name);
  }
  
  async ensureModel(modelName: string): Promise<boolean> {
    const models = await this.listModels();
    
    if (models.includes(modelName)) {
      return true;
    }
    
    // Pull model if not available
    this.logger.info(`Downloading model ${modelName}...`);
    await this.pullModel(modelName);
    return true;
  }
  
  private async pullModel(modelName: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      body: JSON.stringify({ name: modelName }),
    });
    
    // Stream download progress
    for await (const chunk of response.body) {
      // Parse and display progress
    }
  }
  
  async generate(
    prompt: string,
    options?: GenerateOptions
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5-coder:1.5b',
        prompt: prompt,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.3,
          top_p: options?.topP ?? 0.9,
          num_predict: options?.maxTokens ?? 500,
        }
      })
    });
    
    const data = await response.json();
    return data.response;
  }
}
```

#### Step 11.2: Business Logic Inferrer

**What to Build**: LLM-based code intent extraction

**Business Logic Inferrer** (`src/llm/business-logic-inferrer.ts`):
```typescript
// Structure:
class BusinessLogicInferrer {
  constructor(
    private ollama: OllamaClient,
    private cache: InferenceCache
  )
  
  async inferBusinessLogic(
    functionEntity: FunctionEntity,
    sourceCode: string
  ): Promise<string> {
    // Check cache first
    const cached = await this.cache.get(functionEntity.id);
    if (cached) {
      return cached;
    }
    
    // Construct prompt
    const prompt = this.buildPrompt(functionEntity, sourceCode);
    
    // Get LLM inference
    const inference = await this.ollama.generate(prompt, {
      temperature: 0.3,  // Low for consistency
      maxTokens: 200
    });
    
    // Parse and validate response
    const businessLogic = this.parseResponse(inference);
    
    // Cache result
    await this.cache.set(functionEntity.id, businessLogic);
    
    return businessLogic;
  }
  
  private buildPrompt(
    fn: FunctionEntity,
    source: string
  ): string {
    return `
You are a code analyst. Analyze this function and explain its business purpose in 2-3 sentences.
Focus on WHAT it does from a business perspective, not HOW it's implemented.

Function: ${fn.name}
Signature: ${fn.signature}

Code:
\`\`\`typescript
${source}
\`\`\`

Business Purpose (2-3 sentences):
    `.trim();
  }
  
  private parseResponse(response: string): string {
    // Clean up LLM response
    return response
      .trim()
      .replace(/^(Business Purpose:|Purpose:)/i, '')
      .trim();
  }
  
  async inferBatch(
    functions: FunctionEntity[],
    sourceMap: Map<string, string>
  ): Promise<Map<string, string>> {
    // Process in parallel with rate limiting
    const queue = new PQueue({ 
      concurrency: 2,  // Don't overload Ollama
      interval: 1000,  // 2 per second
      intervalCap: 2
    });
    
    const results = new Map<string, string>();
    
    await Promise.all(
      functions.map(fn =>
        queue.add(async () => {
          const source = sourceMap.get(fn.id);
          if (!source) return;
          
          const inference = await this.inferBusinessLogic(fn, source);
          results.set(fn.id, inference);
        })
      )
    );
    
    return results;
  }
}
```

#### Step 11.3: Inference Cache

**What to Build**: Cache LLM results to avoid re-inference

**Inference Cache** (`src/llm/inference-cache.ts`):
```typescript
// Structure:
class InferenceCache {
  private cacheDir: string;
  private memoryCache: Map<string, string>;
  
  constructor(projectRoot: string) {
    this.cacheDir = path.join(projectRoot, '.codegraph', 'cache');
    this.memoryCache = new Map();
  }
  
  async get(functionId: string): Promise<string | null> {
    // Check memory cache first
    if (this.memoryCache.has(functionId)) {
      return this.memoryCache.get(functionId)!;
    }
    
    // Check file cache
    const cachePath = this.getCachePath(functionId);
    if (await fs.pathExists(cachePath)) {
      const data = await fs.readFile(cachePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Populate memory cache
      this.memoryCache.set(functionId, parsed.inference);
      return parsed.inference;
    }
    
    return null;
  }
  
  async set(functionId: string, inference: string): Promise<void> {
    // Update memory cache
    this.memoryCache.set(functionId, inference);
    
    // Write to file cache
    const cachePath = this.getCachePath(functionId);
    await fs.ensureDir(path.dirname(cachePath));
    await fs.writeFile(
      cachePath,
      JSON.stringify({
        functionId,
        inference,
        timestamp: Date.now()
      })
    );
  }
  
  async invalidate(functionId: string): Promise<void> {
    // Remove from both caches
    this.memoryCache.delete(functionId);
    
    const cachePath = this.getCachePath(functionId);
    await fs.remove(cachePath);
  }
  
  private getCachePath(functionId: string): string {
    const hash = createHash('md5')
      .update(functionId)
      .digest('hex');
    
    // Organize in subdirectories by first 2 chars of hash
    return path.join(
      this.cacheDir,
      hash.substring(0, 2),
      `${hash}.json`
    );
  }
}
```

#### Step 11.4: Background Inference Worker

**What to Build**: Run LLM inference in background

**Background Worker** (`src/llm/background-worker.ts`):
```typescript
// Structure:
class BackgroundInferenceWorker {
  private queue: PQueue;
  private isRunning = false;
  
  constructor(
    private db: GraphDatabase,
    private inferrer: BusinessLogicInferrer
  )
  
  async start(): Promise<void> {
    this.isRunning = true;
    this.logger.info('Background inference worker started');
    
    // Process queue when system is idle
    await this.processQueue();
  }
  
  private async processQueue(): Promise<void> {
    while (this.isRunning) {
      // Check if system is idle
      if (!this.isSystemIdle()) {
        await this.sleep(60000);  // Wait 1 minute
        continue;
      }
      
      // Get next batch of functions without business logic
      const functions = await this.getUninferredFunctions(50);
      
      if (functions.length === 0) {
        this.logger.info('All functions inferred');
        break;
      }
      
      // Infer batch
      this.logger.info(`Inferring ${functions.length} functions...`);
      const results = await this.inferrer.inferBatch(
        functions,
        await this.loadSourceCode(functions)
      );
      
      // Update database
      await this.updateDatabase(results);
      
      // Small delay between batches
      await this.sleep(5000);
    }
  }
  
  private isSystemIdle(): boolean {
    // Check CPU usage, battery status, etc.
    // For MVP, simple heuristic:
    const cpuUsage = os.loadavg()[0] / os.cpus().length;
    return cpuUsage < 0.5;  // Less than 50% CPU
  }
  
  private async getUninferredFunctions(
    limit: number
  ): Promise<FunctionEntity[]> {
    return await this.db.query(`
      MATCH (f:Function)
      WHERE f.businessLogic IS NULL OR f.businessLogic = ''
      RETURN f
      LIMIT ${limit}
    `);
  }
  
  private async updateDatabase(
    results: Map<string, string>
  ): Promise<void> {
    for (const [functionId, inference] of results) {
      await this.db.execute(`
        MATCH (f:Function {id: $id})
        SET f.businessLogic = $inference
      `, { id: functionId, inference });
    }
  }
  
  stop(): void {
    this.isRunning = false;
  }
}
```

---

### Phase 12: CLI Commands Implementation

**Goal**: Complete all CLI commands with full functionality

#### Step 12.1: Init Command

**What to Build**: Complete initialization flow

**Init Command** (`src/cli/commands/init.ts`):
```typescript
// Structure:
export async function initCommand(
  options: InitOptions
): Promise<void> {
  const logger = createLogger('init');
  
  // 1. Check if already initialized
  if (await isInitialized() && !options.force) {
    logger.error('Project already initialized');
    logger.info('Use --force to re-initialize');
    return;
  }
  
  // 2. Detect project
  logger.info('Detecting project type...');
  const detector = new ProjectDetector(process.cwd());
  const config = await detector.detectProject();
  
  logger.info(`✓ Detected: ${config.framework || config.language} project`);
  
  // 3. Create .codegraph directory
  logger.info('Creating .codegraph directory...');
  await createCodeGraphDirectory();
  
  // 4. Initialize database
  logger.info('Initializing graph database...');
  const db = new GraphDatabase('.codegraph/kuzu');
  await db.initialize();
  await initializeSchema(db);
  
  // 5. Run initial indexing
  logger.info('Starting initial indexing...');
  const coordinator = new IndexerCoordinator(
    process.cwd(),
    db,
    config
  );
  
  const result = await coordinator.indexProject();
  
  // 6. Display results
  logger.info('\n✓ Indexing complete!');
  logger.info(`  Files indexed: ${result.filesIndexed}`);
  logger.info(`  Functions found: ${result.functionsFound}`);
  logger.info(`  Classes found: ${result.classesFound}`);
  logger.info(`  Duration: ${result.duration}s`);
  
  // 7. Check for Ollama
  const ollama = new OllamaClient();
  if (await ollama.isAvailable() && !options.skipLLM) {
    logger.info('\n✓ Ollama detected');
    logger.info('Business logic inference queued for background');
  } else {
    logger.info('\nℹ Business logic layer disabled');
    logger.info('  Install Ollama for full functionality');
  }
  
  // 8. Show next steps
  displayNextSteps();
}

function displayNextSteps(): void {
  console.log(`
Next steps:
  1. Start MCP server:
     code-synapse start

  2. Configure your AI agent to connect to the MCP server

  3. Ask your AI assistant questions about your codebase!
  `);
}
```

#### Step 12.2: Start Command

**What to Build**: Start MCP server in serving mode

**Start Command** (`src/cli/commands/start.ts`):
```typescript
// Structure:
export async function startCommand(
  options: StartOptions
): Promise<void> {
  const logger = createLogger('start');
  
  // 1. Check if initialized
  if (!await isInitialized()) {
    logger.error('Project not initialized');
    logger.info('Run: code-synapse init');
    return;
  }
  
  // 2. Load database
  const db = new GraphDatabase('.codegraph/kuzu');
  await db.initialize();
  
  // 3. Start file watcher
  const projectConfig = await loadProjectConfig();
  const watcher = new FileWatcher(
    process.cwd(),
    projectConfig,
    new IndexerCoordinator(process.cwd(), db, projectConfig)
  );
  
  await watcher.start();
  logger.info('✓ File watcher started');
  
  // 4. Start background inference worker (if Ollama available)
  const ollama = new OllamaClient();
  if (await ollama.isAvailable()) {
    const worker = new BackgroundInferenceWorker(db, ollama);
    await worker.start();
    logger.info('✓ Background inference started');
  }
  
  // 5. Start MCP server
  const mcpServer = new CodeKnowledgeMCPServer(db);
  await mcpServer.start();
  
  logger.info('\nMCP Server running');
  logger.info('Press Ctrl+C to stop');
  
  // 6. Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('\nShutting down...');
    await watcher.stop();
    await db.close();
    process.exit(0);
  });
}
```

#### Step 12.3: Status Command

**What to Build**: Display indexing status

**Status Command** (`src/cli/commands/status.ts`):
```typescript
// Structure:
export async function statusCommand(): Promise<void> {
  const logger = createLogger('status');
  
  if (!await isInitialized()) {
    logger.error('Project not initialized');
    return;
  }
  
  // Load database
  const db = new GraphDatabase('.codegraph/kuzu');
  await db.initialize();
  
  // Get statistics
  const stats = await getIndexStats(db);
  
  // Display status
  console.log('\nCode Knowledge Platform Status\n');
  console.log(`Files indexed:     ${stats.fileCount}`);
  console.log(`Functions:         ${stats.functionCount}`);
  console.log(`Classes:           ${stats.classCount}`);
  console.log(`Interfaces:        ${stats.interfaceCount}`);
  console.log(`Relationships:     ${stats.relationshipCount}`);
  console.log(`Database size:     ${formatBytes(stats.dbSize)}`);
  console.log(`Last indexed:      ${stats.lastIndexed}`);
  
  // Business logic status
  console.log(`\nBusiness Logic:`);
  console.log(`  Inferred:        ${stats.inferredCount}/${stats.functionCount}`);
  console.log(`  Progress:        ${stats.inferenceProgress}%`);
  
  await db.close();
}

async function getIndexStats(
  db: GraphDatabase
): Promise<IndexStats> {
  // Query database for statistics
  const fileCount = await db.query(`
    MATCH (f:File) RETURN count(f) as count
  `);
  
  const functionCount = await db.query(`
    MATCH (fn:Function) RETURN count(fn) as count
  `);
  
  // ... more queries
  
  return {
    fileCount: fileCount[0].count,
    functionCount: functionCount[0].count,
    // ... more stats
  };
}
```

#### Step 12.4: MCP Config Command

**What to Build**: Generate Claude Desktop configuration

**MCP Config Command** (`src/cli/commands/mcp-config.ts`):
```typescript
// Structure:
export async function mcpConfigCommand(): Promise<void> {
  const projectRoot = process.cwd();
  const projectName = path.basename(projectRoot);
  
  // Generate MCP configuration
  const config = {
    mcpServers: {
      [projectName]: {
        command: 'code-synapse',
        args: ['start'],
        cwd: projectRoot
      }
    }
  };
  
  // Output JSON to stdout (user can redirect to config file)
  console.log(JSON.stringify(config, null, 2));
}
```

**Usage**:
```bash
# User adds configuration to Claude Desktop:
code-synapse mcp-config >> ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Or manually copy the output
code-synapse mcp-config
```

---

## Database Schema & Graph Architecture

### Node Type Specifications

**File Node Properties**:
```
- id: STRING (PRIMARY KEY) → Format: "file:relative/path.ts"
- path: STRING → Absolute file path
- relativePath: STRING → Path relative to project root
- extension: STRING → File extension (.ts, .tsx, .js)
- hash: STRING → MD5 hash of file contents
- size: INT64 → File size in bytes
- lastModified: TIMESTAMP → Last modification time
- language: STRING → 'typescript' | 'javascript'
- framework: STRING → 'nextjs' | 'react' | null
```

**Function Node Properties**:
```
- id: STRING (PRIMARY KEY) → Format: "func:filepath:name:line"
- name: STRING → Function name
- fileId: STRING → Reference to File node
- startLine: INT32 → Starting line number
- endLine: INT32 → Ending line number
- signature: STRING → Full function signature
- returnType: STRING → Return type (nullable)
- isExported: BOOLEAN → Exported from module?
- isAsync: BOOLEAN → Async function?
- complexity: INT32 → Cyclomatic complexity
- docComment: STRING → JSDoc comment (nullable)
- businessLogic: STRING → LLM-inferred purpose (nullable)
```

**Class Node Properties**:
```
- id: STRING (PRIMARY KEY) → Format: "class:filepath:name:line"
- name: STRING → Class name
- fileId: STRING → Reference to File node
- startLine: INT32
- endLine: INT32
- isAbstract: BOOLEAN
- isExported: BOOLEAN
- docComment: STRING
```

**Interface Node Properties**:
```
- id: STRING (PRIMARY KEY) → Format: "interface:filepath:name:line"
- name: STRING
- fileId: STRING
- startLine: INT32
- endLine: INT32
- isExported: BOOLEAN
- properties: STRING[] → JSON-encoded property list
```

### Relationship Type Specifications

**CONTAINS** (File → Function/Class/Interface):
```
- lineNumber: INT32 → Where entity is defined
```

**CALLS** (Function → Function):
```
- lineNumber: INT32 → Where call occurs
- isDirectCall: BOOLEAN → Direct call vs callback/promise
```

**IMPORTS** (File → File):
```
- importedSymbols: STRING[] → List of imported names
- importType: STRING → 'named' | 'default' | 'namespace'
```

**EXTENDS** (Class → Class/Interface):
```
- (No additional properties)
```

**IMPLEMENTS** (Class → Interface):
```
- (No additional properties)
```

**USES_TYPE** (Function → Class/Interface):
```
- context: STRING → 'parameter' | 'return' | 'variable'
```

### Query Patterns

**Common Query Patterns for MCP Tools**:

```cypher
# Search for functions by name
MATCH (f:Function)
WHERE f.name CONTAINS $query
RETURN f
LIMIT 50

# Get function with complete context
MATCH (f:Function {name: $name})
OPTIONAL MATCH (file:File)-[:CONTAINS]->(f)
OPTIONAL MATCH (f)-[:CALLS]->(callee:Function)
OPTIONAL MATCH (caller:Function)-[:CALLS]->(f)
RETURN f, file, collect(callee), collect(caller)

# Trace call chain (callees)
MATCH path = (start:Function {name: $name})
             -[:CALLS*1..3]->(end:Function)
RETURN path

# Trace call chain (callers)
MATCH path = (start:Function)
             -[:CALLS*1..3]->(end:Function {name: $name})
RETURN path

# Find file dependencies
MATCH (file:File {path: $path})
OPTIONAL MATCH (file)-[:IMPORTS]->(dep:File)
RETURN file, collect(dep)

# Find business logic matches
MATCH (f:Function)
WHERE f.businessLogic CONTAINS $feature
RETURN f
```

---

## MCP Protocol Integration

### MCP Configuration for Claude Desktop

**Location**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)

**Configuration Format**:
```json
{
  "mcpServers": {
    "my-project": {
      "command": "code-synapse",
      "args": ["start"],
      "cwd": "/path/to/my-project"
    }
  }
}
```

**How It Works**:
1. Claude Desktop reads this config on startup
2. For each MCP server, it spawns the command as a subprocess
3. Communication happens via stdio (stdin/stdout)
4. Claude sends JSON-RPC requests to stdin
5. MCP server sends responses to stdout

### MCP Tool Definitions

**Tool 1: search_code**
```json
{
  "name": "search_code",
  "description": "Search for code elements by name or pattern. Use this to find functions, classes, or interfaces in the codebase.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query (function name, class name, or pattern)"
      },
      "type": {
        "type": "string",
        "enum": ["function", "class", "interface", "all"],
        "description": "Type of element to search for"
      }
    },
    "required": ["query"]
  }
}
```

**Tool 2: get_function_context**
```json
{
  "name": "get_function_context",
  "description": "Get complete context for a specific function, including what it calls, what calls it, parameters, return type, and business logic.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "functionName": {
        "type": "string",
        "description": "Name of the function"
      },
      "filePath": {
        "type": "string",
        "description": "Optional file path to disambiguate"
      }
    },
    "required": ["functionName"]
  }
}
```

**Tool 3: trace_call_chain**
```json
{
  "name": "trace_call_chain",
  "description": "Trace the call chain from a function - find what functions it calls (callees) or what functions call it (callers).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "functionName": {
        "type": "string",
        "description": "Starting function name"
      },
      "direction": {
        "type": "string",
        "enum": ["callers", "callees", "both"],
        "description": "Direction to trace"
      },
      "depth": {
        "type": "number",
        "default": 3,
        "description": "Maximum depth to trace"
      }
    },
    "required": ["functionName"]
  }
}
```

**Tool 4: find_dependencies**
```json
{
  "name": "find_dependencies",
  "description": "Find all dependencies of a file (what it imports) or function.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "File path or function name"
      }
    },
    "required": ["path"]
  }
}
```

**Tool 5: explain_feature**
```json
{
  "name": "explain_feature",
  "description": "Explain how a feature works across the codebase by finding related functions and their business logic.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "feature": {
        "type": "string",
        "description": "Feature or concept to explain (e.g., 'authentication', 'payment processing')"
      }
    },
    "required": ["feature"]
  }
}
```

---

## LLM Integration Architecture

### Ollama Setup & Usage

**Model Selection Criteria**:
- **Qwen 2.5 Coder (1.5B)**: Best balance of size/performance
- **Size**: 900MB download
- **RAM Usage**: ~2GB when loaded
- **Speed**: 100-200 tokens/sec on M1 Mac
- **Accuracy**: 85%+ for code intent extraction

**Alternative Models**:
- **DeepSeek Coder (1.3B)**: Slightly smaller, similar performance
- **CodeLlama (7B)**: Better accuracy but 4x slower, 5GB RAM
- **StarCoder2 (3B)**: Medium option, 1.7GB RAM

### Prompt Engineering

**Business Logic Extraction Prompt**:
```
You are a code analyst. Analyze this function and explain its business purpose in 2-3 sentences.
Focus on WHAT it does from a business perspective, not HOW it's implemented.

Function: authenticateUser
Signature: async authenticateUser(email: string, password: string): Promise<User>

Code:
```typescript
async function authenticateUser(email: string, password: string): Promise<User> {
  const user = await db.users.findOne({ email });
  if (!user) throw new AuthError('User not found');
  
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new AuthError('Invalid credentials');
  
  const token = jwt.sign({ userId: user.id }, SECRET);
  await db.sessions.create({ userId: user.id, token });
  
  return { ...user, token };
}
```

Business Purpose (2-3 sentences):
```

**Expected Output**:
```
This function authenticates a user by verifying their email and password credentials. 
It validates the user exists in the database, checks the password hash matches, then 
generates a JWT token and creates a new session for the authenticated user.
```

### Inference Caching Strategy

**Cache Key**: Function ID (unique identifier)
**Cache Invalidation**: When function source code changes
**Cache Location**: `.codegraph/cache/llm/`
**Cache Format**: JSON files with function ID, inference, timestamp

**Cache Directory Structure**:
```
.codegraph/cache/llm/
├── ab/
│   └── abc123def456.json
├── cd/
│   └── cde789fgh012.json
└── ...
```

**Benefits**:
- Avoid re-inferring unchanged functions
- Instant results for cached functions
- Reduces Ollama load
- Faster incremental updates

---

## File System & Storage Architecture

### Directory Structure

**Project Root**:
```
my-typescript-project/
├── src/                     # User's source code
│   ├── auth/
│   ├── models/
│   └── services/
├── .codegraph/              # Auto-generated (hidden)
│   ├── kuzu/                # Graph database files
│   │   ├── catalog.bin
│   │   ├── nodes/
│   │   └── rels/
│   ├── cache/               # Caches
│   │   ├── llm/             # LLM inference cache
│   │   └── parsers/         # Parser cache
│   ├── logs/                # Log files
│   │   ├── indexer.log
│   │   ├── mcp-server.log
│   │   └── errors.log
│   └── config.json          # Project configuration
├── package.json
└── tsconfig.json
```

**Global Directory** (`~/.codegraph/`):
```
~/.codegraph/
├── models/                  # Downloaded LLM models (shared)
│   └── qwen2.5-coder-1.5b/
├── parsers/                 # Tree-sitter parsers (shared)
│   ├── tree-sitter-typescript.wasm
│   └── tree-sitter-javascript.wasm
└── global-config.json       # Global settings
```

### Ignore Patterns

**Default .gitignore Addition**:
```
# Code Knowledge Platform
.codegraph/
```

**Files to Exclude from Indexing**:
```
- node_modules/
- dist/
- build/
- .next/
- coverage/
- *.test.ts
- *.spec.ts
- *.test.js
- *.spec.js
- __tests__/
- **/*.d.ts (type declaration files)
```

---

This completes the comprehensive architecture and implementation plan for the Code Knowledge Platform. The document covers all technical components, tools, frameworks, and step-by-step building instructions without code implementation, timelines, or launch strategies.

# How Code-Synapse Works

A comprehensive guide to understanding Code-Synapse's architecture, data flow, and how to run it from source.

> **Note**: This document focuses on technical details and operational workflows. For quick start instructions, see [README.md](../README.md). For architectural details, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Deep Dive](#architecture-deep-dive)
3. [Data Flow Pipeline](#data-flow-pipeline)
4. [Running from Source](#running-from-source)
5. [CLI Commands](#cli-commands)
6. [MCP Integration](#mcp-integration)
7. [Web Viewer & NL Search](#web-viewer--nl-search)
8. [Database Schema](#database-schema)
9. [LLM Integration](#llm-integration)
10. [Business Layer Classification](#business-layer-classification)
11. [Change Ledger & Observability](#change-ledger--observability)
12. [Adaptive MCP-Driven Indexing](#adaptive-mcp-driven-indexing)
13. [Ledger Compaction](#ledger-compaction)
14. [Ledger Reconciliation](#ledger-reconciliation)
15. [Persistent Developer Memory](#persistent-developer-memory)
16. [Performance Optimization](#performance-optimization)
17. [Multi-Model Intelligence](#multi-model-intelligence)

---

## System Overview

Code-Synapse is a **local knowledge engine** that transforms your codebase into a structured Knowledge Graph optimized for AI reasoning. It runs as a "sidecar" alongside AI coding assistants.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI AGENT (Claude, Cursor, etc.)                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ MCP Protocol (JSON-RPC over stdio)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CODE-SYNAPSE CLI                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   default   │  │    init     │  │    index    │  │   justify   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   status    │  │   config    │  │    start    │  │   viewer    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│                              │                                               │
│                              ▼                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         MCP SERVER (stdio transport)                   │  │
│  │  Tools: search_code, get_function, get_class, get_callers, etc.       │  │
│  │  Resources: file://, symbols://, graph://                              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CORE ENGINE                                     │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Scanner   │──│   Parser    │──│  Extractor  │──│Graph Writer │        │
│  │ (fast-glob) │  │(tree-sitter)│  │ (pipeline)  │  │  (CozoDB)   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                          │
│  │ Embeddings  │  │  LLM Service│  │File Watcher │                          │
│  │  (ONNX)     │  │(llama.cpp)  │  │ (chokidar)  │                          │
│  └─────────────┘  └─────────────┘  └─────────────┘                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              STORAGE LAYER                                   │
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

---

## Architecture Deep Dive

### Directory Structure

```
src/
├── cli/                    # User-facing CLI (commander.js)
│   ├── index.ts            # Entry point, signal handlers, default command
│   └── commands/
│       ├── default.ts      # Default command (init + index + justify + start + viewer)
│       ├── init.ts         # Initialize project
│       ├── index.ts        # Trigger indexing
│       ├── justify.ts      # Generate business justifications
│       ├── status.ts       # Show project status
│       ├── config.ts       # Model configuration
│       ├── start.ts        # Start MCP server
│       └── viewer.ts       # Start Web Viewer
│
├── mcp/                    # MCP Server (AI agent interface)
│   ├── server.ts           # Server setup, tool handlers
│   ├── tools.ts            # MCP tool definitions
│   └── resources.ts        # MCP resource handlers
│
├── viewer/                 # Web Viewer & NL Search
│   ├── index.ts            # Module exports
│   ├── interfaces/         # IGraphViewer interface
│   ├── impl/               # CozoGraphViewer implementation
│   ├── ui/                 # HTTP server and REST API
│   │   └── server.ts       # ViewerServer class
│   └── nl-search/          # Natural Language Search
│       ├── types.ts        # SearchIntent, NLSearchResult
│       ├── intent-classifier.ts
│       └── query-builder.ts
│
├── core/                   # Business logic (shared by CLI & MCP)
│   ├── parser/             # Tree-sitter AST parsing
│   │   └── typescript-parser.ts
│   │
│   ├── graph/              # CozoDB database layer
│   │   ├── database.ts     # Low-level DB operations
│   │   ├── cozo-graph-store.ts  # High-level graph API
│   │   └── migrations/     # Schema migrations
│   │
│   ├── indexer/            # Indexing orchestration
│   │   ├── coordinator.ts  # Main pipeline
│   │   ├── scanner.ts      # File discovery
│   │   ├── project-detector.ts  # Framework detection
│   │   └── watcher.ts      # File change detection
│   │
│   ├── extraction/         # Entity extraction
│   │   └── pipeline.ts     # Extract functions, classes, etc.
│   │
│   ├── graph-builder/      # Graph construction
│   │   └── graph-writer.ts # Write entities to DB
│   │
│   ├── embeddings/         # Vector embeddings (ONNX)
│   │   └── embedding-service.ts
│   │
│   ├── llm/                # Local LLM inference
│   │   ├── llm-service.ts  # llama.cpp wrapper
│   │   ├── models.ts       # Model registry (12 models)
│   │   └── business-logic-inferrer.ts
│   │
│   └── justification/      # Business justification layer
│       ├── models.ts       # Justification data models
│       ├── interfaces.ts   # IJustificationService
│       ├── prompts.ts      # LLM prompt templates
│       ├── context-propagator.ts  # Hierarchy context propagation
│       ├── storage.ts      # Database operations
│       ├── clarification-engine.ts  # Interactive clarification
│       └── llm-justification-service.ts  # Main service implementation
│
├── types/                  # TypeScript type definitions
│   └── index.ts
│
└── utils/                  # Shared utilities
    ├── logger.ts           # Pino structured logging
    └── fs.ts               # File system helpers
```

### Module Responsibilities

| Module | Responsibility | Key Tech |
|--------|---------------|----------|
| **CLI** | User commands, configuration | Commander.js, Chalk, Ora |
| **MCP** | AI agent communication | @modelcontextprotocol/sdk |
| **Viewer** | Web dashboard, REST API, NL Search | Node HTTP |
| **Parser** | AST generation from source | web-tree-sitter (WASM) |
| **Graph** | Persistent storage, queries | CozoDB with RocksDB |
| **Indexer** | Pipeline orchestration | Custom coordinator |
| **Extraction** | Entity & relationship extraction | Custom pipeline |
| **Embeddings** | Vector generation | @huggingface/transformers |
| **LLM** | Local model inference | node-llama-cpp |
| **Justification** | Business purpose inference | LLM prompts, context propagation |

---

## Data Flow Pipeline

### Complete Indexing Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: SCANNING                                                         │
│ ─────────────────                                                         │
│ Input: Project root directory                                             │
│ Process:                                                                  │
│   1. ProjectDetector analyzes package.json, tsconfig.json                │
│   2. Detects framework (Next.js, NestJS, React, etc.)                    │
│   3. Reads .gitignore and converts patterns to glob format               │
│   4. Combines 90+ default ignore patterns + .gitignore + framework rules │
│   5. FileScanner uses fast-glob to find source files                     │
│   6. Filters files by sourcePatterns and ignorePatterns                  │
│ Output: List of FileInfo { path, hash, language }                        │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: PARSING                                                          │
│ ─────────────────                                                         │
│ Input: FileInfo list                                                      │
│ Process:                                                                  │
│   1. TypeScriptParser loads tree-sitter WASM grammar                     │
│   2. Parses each file into AST (Abstract Syntax Tree)                    │
│   3. Walks AST to find: functions, classes, interfaces, variables        │
│   4. Extracts: name, location (line/column), JSDoc, parameters           │
│ Output: ParsedFile { ast, functions[], classes[], interfaces[] }         │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: EXTRACTION                                                       │
│ ─────────────────                                                         │
│ Input: ParsedFile list                                                    │
│ Process:                                                                  │
│   1. EntityPipeline processes each file                                  │
│   2. Creates unique IDs (hash of file:name:line)                         │
│   3. Extracts relationships:                                              │
│      - CONTAINS: file → function/class                                   │
│      - CALLS: function → function                                        │
│      - IMPORTS: file → file                                              │
│      - EXTENDS: class → class                                            │
│      - IMPLEMENTS: class → interface                                     │
│   4. Generates embeddings for semantic search (optional)                 │
│ Output: ExtractionResult { entities, relationships, stats }              │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: JUSTIFICATION                                                    │
│ ─────────────────────                                                     │
│ Input: Extracted entities                                                 │
│ Process:                                                                  │
│   1. JustificationService loads local LLM (Qwen 2.5 Coder)               │
│   2. For each entity, extracts context (signature, JSDoc, parent)        │
│   3. Generates prompt and infers business purpose                        │
│   4. Propagates context through hierarchy (file → class → method)        │
│ Output: Justification { purpose, featureArea, businessValue, confidence }│
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ PHASE 5: WRITING                                                          │
│ ─────────────────                                                         │
│ Input: ExtractionResult + Justifications                                  │
│ Process:                                                                  │
│   1. GraphWriter batches entities into CozoDB transactions               │
│   2. Inserts nodes: file, function, class, interface, variable           │
│   3. Inserts edges: contains, calls, imports, extends, implements        │
│   4. Stores justifications linked to entities                            │
│   5. Updates vector index for semantic search                            │
│ Output: WriteResult { entitiesWritten, relationshipsWritten }            │
└──────────────────────────────────────────────────────────────────────────┘
```

### Query Flow (MCP Tools)

```
AI Agent Request                    MCP Server                      CozoDB
      │                                  │                             │
      │ callTool("search_code",          │                             │
      │   { query: "authentication" })   │                             │
      │ ─────────────────────────────────>                             │
      │                                  │                             │
      │                                  │ Hybrid Search:              │
      │                                  │ 1. Vector similarity        │
      │                                  │ 2. Keyword matching         │
      │                                  │ ───────────────────────────>│
      │                                  │                             │
      │                                  │<─────────────────────────────
      │                                  │ Results: [functions,        │
      │                                  │   classes, files]           │
      │<──────────────────────────────────                             │
      │ { content: [{ type: "text",      │                             │
      │   text: "Found 5 matches..." }]} │                             │
```

### File Filtering

Code-Synapse intelligently filters files to index only source code, skipping generated files, dependencies, and build artifacts.

**Three-Layer Filtering:**

1. **Default Patterns (90+ rules)** - Built-in exclusions for common directories and files
2. **Gitignore Support** - Automatically parses `.gitignore` and converts patterns
3. **Framework-Specific** - Additional exclusions based on detected framework

**Default Ignore Categories:**

| Category | Patterns |
|----------|----------|
| **Dependencies** | `node_modules/`, `vendor/`, `bower_components/`, `.pnpm/`, `.yarn/` |
| **Build Outputs** | `dist/`, `build/`, `out/`, `target/`, `bin/`, `obj/` |
| **Framework Caches** | `.next/`, `.nuxt/`, `.astro/`, `.svelte-kit/`, `.vercel/`, `.serverless/` |
| **Tool Caches** | `.cache/`, `.turbo/`, `.nx/`, `.parcel-cache/`, `.vite/`, `.webpack/` |
| **Test/Coverage** | `coverage/`, `__tests__/`, `__mocks__/`, `__snapshots__/`, `*.test.ts` |
| **Version Control** | `.git/`, `.svn/`, `.hg/` |
| **IDE/Editor** | `.idea/`, `.vscode/`, `.vs/`, `*.swp`, `*.swo` |
| **Virtual Envs** | `.venv/`, `venv/`, `__pycache__/`, `site-packages/` |
| **Generated** | `*.min.js`, `*.bundle.js`, `*.d.ts`, lock files |
| **Temporary** | `tmp/`, `temp/`, `logs/`, `*.log` |

**Gitignore Pattern Conversion:**

The scanner reads `.gitignore` and converts patterns to glob format:

```
# .gitignore          →  Glob pattern
node_modules          →  **/node_modules, **/node_modules/**
/build                →  build, build/**
*.log                 →  **/*.log
dist/                 →  **/dist/**
!important.js         →  (skipped - negations not supported)
```

**How it works in code:**

```typescript
// In ProjectDetector.detect()
const baseIgnorePatterns = getIgnorePatterns(framework);  // Default + framework rules
const gitignorePatterns = await parseGitignore();         // From .gitignore
const ignorePatterns = [...new Set([...baseIgnorePatterns, ...gitignorePatterns])];

// FileScanner uses these patterns with fast-glob
const files = await glob(sourcePatterns, {
  cwd: rootPath,
  ignore: ignorePatterns,
  absolute: true
});
```

---

## Running from Source

### Prerequisites

- **Node.js**: v20.0.0 or higher (v25 recommended)
- **pnpm**: v9.0.0 or higher (recommended) or npm
- **Git**: For cloning the repository

### Step-by-Step Setup

#### 1. Clone the Repository

```bash
git clone https://github.com/your-org/code-synapse.git
cd code-synapse
```

#### 2. Install Dependencies

```bash
pnpm install
```

This installs all dependencies including:
- `web-tree-sitter` - WASM-based code parser
- `cozo-node` - Graph database with RocksDB
- `@modelcontextprotocol/sdk` - MCP protocol
- `node-llama-cpp` - Local LLM inference

#### 3. Build the Project

```bash
pnpm build
```

This compiles TypeScript to JavaScript in the `dist/` folder.

#### 4. Verify the Build

```bash
# Check CLI works
node dist/cli/index.js --help

# Run tests
pnpm test

# Type check
pnpm check-types

# Lint
pnpm lint
```

### Running the CLI from Source

#### Option A: Direct Node Execution

```bash
# Show help
node dist/cli/index.js --help

# Default command (auto-initialize, index, and start)
cd /path/to/your/project
node /path/to/code-synapse/dist/cli/index.js

# Or use individual commands
node /path/to/code-synapse/dist/cli/index.js init      # Initialize only
node /path/to/code-synapse/dist/cli/index.js index     # Index only
node /path/to/code-synapse/dist/cli/index.js status    # Check status
node /path/to/code-synapse/dist/cli/index.js config --list-models  # List models
node /path/to/code-synapse/dist/cli/index.js start     # Start server only
```

#### Option B: Using npm link (Recommended for Development)

```bash
# In the code-synapse directory
cd /path/to/code-synapse
pnpm link --global

# Now you can use 'code-synapse' anywhere
cd /path/to/your/project
code-synapse init
code-synapse index
code-synapse status
```

#### Option C: Development Watch Mode

```bash
# Watch for changes and recompile
pnpm dev

# In another terminal, run commands
node dist/cli/index.js status
```

### MCP Server Integration (from Source)

Code-Synapse uses **stdio transport** (command execution) as the primary method. The AI agent automatically starts and manages the Code-Synapse server process.

#### Primary Method: stdio Transport (Recommended)

With stdio transport, the AI agent (Claude Code, Cursor) executes Code-Synapse directly and manages its lifecycle. This is the recommended approach as it:
- Requires no manual server management
- Automatically starts/stops with the agent
- Works seamlessly across projects
- No port conflicts or manual server processes

#### Claude Code Integration

**Step 1: Configure MCP Server**

Add to `~/.claude.json` (user scope) or project-level `.mcp.json` (project scope):

```json
{
  "mcpServers": {
    "code-synapse": {
      "command": "code-synapse",
      "args": ["start"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

**Configuration Locations:**

| Location | Scope | Use Case |
|----------|-------|----------|
| `~/.claude.json` | User | Available across all projects |
| `.mcp.json` | Project | Project-specific, shared via source control |

**Step 2: Verify Connection**

Within Claude Code, check server status:
```
/mcp
```

**Managing MCP Servers in Claude Code:**

```bash
# List all configured MCP servers
claude mcp list

# Check server details
claude mcp get code-synapse

# Remove a server
claude mcp remove code-synapse
```

#### Cursor Integration

**Step 1: Configure MCP Server**

Add to `.cursor/mcp.json` (project-specific) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "code-synapse": {
      "command": "code-synapse",
      "args": ["start"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

**Configuration Locations:**

| Location | Scope | Use Case |
|----------|-------|----------|
| `.cursor/mcp.json` | Project | Project-specific, shared via source control |
| `~/.cursor/mcp.json` | Global | Available across all projects |

**Step 2: Restart Cursor**

After adding/updating `mcp.json`, restart Cursor to load the MCP server.

#### Alternative: HTTP Transport

If you prefer HTTP transport (e.g., for remote access or multiple clients), you can start Code-Synapse as an HTTP server:

**Step 1: Start HTTP Server**

```bash
# Start MCP server on default port (3100)
cd /path/to/your/project
code-synapse start --port 3100

# Start on a custom port
code-synapse start --port 3200

# Start with debug logging
code-synapse start --debug
```

The server will output:
```
Code-Synapse MCP Server
────────────────────────────────────
  Project:    my-project
  Transport:  HTTP
  Port:       3100
  Status:     Running

  Connect via: http://localhost:3100/mcp
```

**Step 2: Configure AI Agent**

**For Claude Code:**
```json
{
  "mcpServers": {
    "code-synapse": {
      "type": "http",
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

**For Cursor:**
```json
{
  "mcpServers": {
    "code-synapse": {
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

**Transport Methods Comparison:**

| Transport | Execution | Deployment | Use Case | Code-Synapse Support |
|-----------|-----------|------------|----------|---------------------|
| **stdio** | Local | Agent manages | Single user, local tools | ✅ **Recommended** |
| **HTTP** | Local/Remote | Manual server | Multiple users, remote access | ✅ Alternative |
| **SSE** | Local/Remote | Deploy as server | Multiple users | ⚠️ Planned |

**With Environment Variables:**

You can pass environment variables to the Code-Synapse process:

```json
{
  "mcpServers": {
    "code-synapse": {
      "command": "code-synapse",
      "args": ["start"],
      "cwd": "${workspaceFolder}",
      "env": {
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

**With Absolute Path:**

If Code-Synapse is not in your PATH, use an absolute path:

```json
{
  "mcpServers": {
    "code-synapse": {
      "command": "/usr/local/bin/code-synapse",
      "args": ["start"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

**HTTP Transport with Environment Variables:**

For HTTP transport, you can use environment variables in the URL:

```json
{
  "mcpServers": {
    "code-synapse": {
      "url": "${env:CODE_SYNAPSE_URL:-http://localhost:3100}/mcp"
    }
  }
}
```

**HTTP Transport with Authentication Headers:**

If you add authentication in the future:

```json
{
  "mcpServers": {
    "code-synapse": {
      "url": "http://localhost:3100/mcp",
      "headers": {
        "Authorization": "Bearer ${env:CODE_SYNAPSE_TOKEN}"
      }
    }
  }
}
```

**Cursor Configuration Locations:**

| Location | Scope | Use Case |
|----------|-------|----------|
| `.cursor/mcp.json` | Project | Project-specific tools, shared via source control |
| `~/.cursor/mcp.json` | Global | Tools available across all projects |

**Cursor Variable Interpolation:**

Cursor supports variables in `mcp.json` for `command`, `args`, `env`, `url`, and `headers`:

| Variable | Description | Example |
|----------|-------------|---------|
| `${env:NAME}` | Environment variable | `${env:CODE_SYNAPSE_URL}` |
| `${env:NAME:-default}` | Environment variable with default | `${env:PORT:-3100}` |
| `${userHome}` | Path to home folder | `/Users/username` |
| `${workspaceFolder}` | Project root directory | `/path/to/project` |
| `${workspaceFolderBasename}` | Name of project root | `my-project` |
| `${pathSeparator}` or `${/}` | OS path separator | `/` (Unix) or `\` (Windows) |

**Using Code-Synapse in Cursor:**

1. **Restart Cursor**: After adding/updating `mcp.json`, restart Cursor to load the MCP server
2. **Agent Mode**: Cursor's Agent automatically uses Code-Synapse tools when relevant
3. **Toggle Tools**: Click a tool name in the tools list to enable/disable specific tools
4. **Tool Approval**: Agent asks for approval before using MCP tools (can enable auto-run in settings)
5. **View Responses**: Expandable views show tool arguments and responses
6. **Chat Integration**: Ask questions like:
   - "Search for authentication functions"
   - "How does the payment flow work?"
   - "Find all callers of the validateToken function"
   - "What classes extend BaseService?"

**Cursor MCP Protocol Support:**

| Feature | Support | Description |
|---------|---------|-------------|
| Tools | ✅ | Functions for the AI model to execute |
| Prompts | ✅ | Templated messages and workflows |
| Resources | ✅ | Structured data sources (files, symbols, graph) |
| Roots | ✅ | Server-initiated URI inquiries |
| Elicitation | ✅ | Server-initiated requests for info |

**Troubleshooting:**

**Issue: Tools not appearing**
- Restart the AI agent (Cursor/Claude Code) after adding/updating MCP configuration
- Check agent's MCP server status in settings
- Verify Code-Synapse is initialized: `code-synapse status`

**Issue: Command not found (stdio transport)**
- Ensure Code-Synapse is in your PATH: `which code-synapse`
- Use absolute path in `command` field if needed
- Verify installation: `code-synapse --version`

**Issue: Permission errors**
- Check file permissions on Code-Synapse binary
- Ensure you have execute permissions
- On Unix systems: `chmod +x $(which code-synapse)`

**Issue: Server crashes or disconnects**
- Check Code-Synapse logs: `.code-synapse/logs/combined.log`
- Ensure project is indexed: `code-synapse index`
- Verify project is initialized: `code-synapse status`

**Issue: Server not connecting (HTTP transport)**
- Ensure Code-Synapse HTTP server is running: `code-synapse start --port 3100`
- Check the port matches in MCP configuration
- Verify firewall isn't blocking localhost connections

**Issue: Port conflicts (HTTP transport)**
- Use a different port: `code-synapse start --port 3200`
- Update the URL in MCP configuration accordingly

**Debug Mode:**

Enable debug logging for troubleshooting:

**For stdio transport**, add environment variable:
```json
{
  "mcpServers": {
    "code-synapse": {
      "command": "code-synapse",
      "args": ["start"],
      "cwd": "${workspaceFolder}",
      "env": {
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

**For HTTP transport**, start with debug flag:
```bash
code-synapse start --port 3100 --debug
```

**Multiple Projects:**

With stdio transport, each project automatically gets its own Code-Synapse instance. No manual configuration needed!

For HTTP transport, run separate instances:

```bash
# Terminal 1: Project A
cd /path/to/project-a
code-synapse start --port 3100

# Terminal 2: Project B
cd /path/to/project-b
code-synapse start --port 3200
```

Configure in global MCP settings:

**Claude Code (`~/.claude.json`):**
```json
{
  "mcpServers": {
    "project-a": {
      "type": "http",
      "url": "http://localhost:3100/mcp"
    },
    "project-b": {
      "type": "http",
      "url": "http://localhost:3200/mcp"
    }
  }
}
```

**Cursor (`~/.cursor/mcp.json`):**
```json
{
  "mcpServers": {
    "project-a": {
      "url": "http://localhost:3100/mcp"
    },
    "project-b": {
      "url": "http://localhost:3200/mcp"
    }
  }
}
```

#### MCP Scopes Explained

| Scope | Storage Location | Visibility |
|-------|------------------|------------|
| `local` | `~/.claude.json` (under project path) | Only you, current project |
| `project` | `.mcp.json` in project root | Everyone via source control |
| `user` | `~/.claude.json` | You, across all projects |

#### Workflow: Running Code-Synapse with Your Project

1. **Initialize** (one-time setup):
   ```bash
   cd /path/to/your/project
   code-synapse init
   code-synapse index
   ```

2. **Configure MCP Server** (stdio transport - recommended):
   
   **For Claude Code** - Add to `~/.claude.json` or `.mcp.json`:
   ```json
   {
     "mcpServers": {
       "code-synapse": {
         "command": "code-synapse",
         "args": ["start"],
         "cwd": "${workspaceFolder}"
       }
     }
   }
   ```
   
   **For Cursor** - Add to `.cursor/mcp.json` or `~/.cursor/mcp.json`:
   ```json
   {
     "mcpServers": {
       "code-synapse": {
         "command": "code-synapse",
         "args": ["start"],
         "cwd": "${workspaceFolder}"
       }
     }
   }
   ```

3. **Restart your AI agent** (Cursor/Claude Code)

4. **Verify connection**:
   - **Claude Code**: Type `/mcp` in chat
   - **Cursor**: Check MCP server status in settings

5. **Query your codebase**:
   - "Search for authentication functions"
   - "How does the payment flow work?"
   - "Find all callers of the validateToken function"

#### Running Multiple Projects

Run separate Code-Synapse instances for different projects:

```bash
# Terminal 1: Project A
cd /path/to/project-a
code-synapse start --port 3100

# Terminal 2: Project B
cd /path/to/project-b
code-synapse start --port 3200
```

Register multiple servers:
```bash
claude mcp add --transport http project-a http://localhost:3100/mcp
claude mcp add --transport http project-b http://localhost:3200/mcp
```

Or configure manually in `.mcp.json`:
```json
{
  "mcpServers": {
    "project-a": {
      "type": "http",
      "url": "http://localhost:3100/mcp"
    },
    "project-b": {
      "type": "http",
      "url": "http://localhost:3200/mcp"
    }
  }
}
```

#### Environment Variable Expansion

Claude Code supports environment variables in `.mcp.json`:

```json
{
  "mcpServers": {
    "code-synapse": {
      "type": "http",
      "url": "${CODE_SYNAPSE_URL:-http://localhost:3100}/mcp"
    }
  }
}
```

Supported syntax:
- `${VAR}` - Expands to value of VAR
- `${VAR:-default}` - Uses default if VAR is not set

---

## CLI Commands

### Default Command: `code-synapse`

Running `code-synapse` without any subcommand provides an all-in-one experience:

```bash
code-synapse [options]

Options:
  -p, --port <port>       Port to run the MCP server on (auto-detects if not specified)
  --viewer-port <port>    Port to run the Web Viewer on (auto-detects if not specified)
  -d, --debug             Enable debug logging
  --skip-index            Skip indexing step (if already indexed)
  --skip-viewer           Skip starting the Web Viewer
  --skip-justify          Skip business justification step
  --justify-only          Run only justification (skip indexing)
  -m, --model <preset>    LLM model preset (fastest|minimal|balanced|quality|maximum)
```

**What it does automatically:**
1. **Checks initialization** - Runs `init` if project not initialized
2. **Indexes codebase** - Runs `index` to build the knowledge graph
3. **Runs justification** - Infers business purpose for code entities using local LLM
4. **Finds available ports** - Scans ports 3100-3300 for MCP and Viewer
5. **Starts Web Viewer** - Launches the visual dashboard with NL Search API
6. **Starts MCP server** - Launches server on available port for AI agent communication

**Port Selection Behavior:**
- MCP server: Scans ports 3100-3200 for availability
- Web Viewer: Uses next available port after MCP
- If no port available in range, interactively prompts for a port
- Use `--port` and `--viewer-port` to specify ports directly

**Example:**
```bash
# Simple - auto-initialize, index, justify, start viewer and MCP server
code-synapse

# With specific ports
code-synapse --port 3200 --viewer-port 3201

# Skip indexing (if already indexed)
code-synapse --skip-index

# Skip the web viewer (MCP server only)
code-synapse --skip-viewer

# Skip justification (faster startup)
code-synapse --skip-justify

# Run only justification on already-indexed codebase
code-synapse --justify-only

# Use a specific model for justification
code-synapse --model quality

# Debug mode
code-synapse --debug
```

**Output:**
```
Checking project status...
✔ Project already initialized
Indexing project...
✔ Project indexed
Running business justification...
✔ Business justification complete
Finding available MCP port (3100-3200)...
✔ Found available MCP port: 3100
Finding available Viewer port...
✔ Found available Viewer port: 3101

Index Statistics:
────────────────────────────────────────
  Files:         92
  Functions:     951
  Classes:       64
  Interfaces:    259
  Relationships: 1474
  Embeddings:    0%
────────────────────────────────────────

Web Viewer is running!
  → Dashboard: http://127.0.0.1:3101
  → NL Search: http://127.0.0.1:3101/api/nl-search?q=your+query

Starting MCP server...
✔ MCP server started on port 3100
```

### `code-synapse init`

Initializes Code-Synapse for the current project.

```bash
code-synapse init [options]

Options:
  -f, --force           Force reinitialization
  --skip-llm            Skip LLM-based business logic inference
  -m, --model <preset>  LLM model preset (fastest|minimal|balanced|quality|maximum)
```

**What it does:**
1. Creates `.code-synapse/` directory structure
2. Detects project framework (Next.js, NestJS, etc.)
3. Writes `config.json` with project settings
4. Configures LLM model preference

**Output:**
```
✔ Code-Synapse initialized successfully!

Configuration:
  Project:    my-project
  Languages:  typescript, javascript
  Framework:  nextjs
  LLM Model:  Qwen 2.5 Coder 3B (3B)
  RAM Needed: 4GB

Created:
  .code-synapse/
    ├── config.json
    ├── data/
    └── logs/
```

### `code-synapse index`

Indexes the project and builds the knowledge graph.

```bash
code-synapse index [options]

Options:
  -f, --force    Force re-index all files
```

**What it does:**
1. Scans project for source files
2. Parses each file with tree-sitter
3. Extracts entities (functions, classes, etc.)
4. Writes to CozoDB graph database

**Output:**
```
Indexing Project
────────────────────────────────────

🔍 Scanning project files... (56/56, 100%)
📄 Parsing source files... (56/56, 100%)
⚙️ Extracting entities... (56/56, 100%)
💾 Writing to database... (56/56, 100%)

✔ Indexing complete!

Results
  Files indexed:         56
  Files failed:          0
  Entities extracted:    342
  Relationships:         187
  Duration:              2.3s

Phases
  Scanning:    56 files in 0.1s
  Parsing:     56 files in 0.8s
  Extracting:  56 files in 0.9s
  Writing:     56 files in 0.5s
```

### `code-synapse status`

Shows the current status and statistics.

```bash
code-synapse status [options]

Options:
  -v, --verbose    Show detailed statistics
```

**Output:**
```
Code-Synapse Status
────────────────────────────────────

Project
  Name:       my-project
  Root:       /Users/dev/my-project
  Languages:  typescript, javascript
  Framework:  nextjs

Storage
  Config dir:   .code-synapse
  Total size:   12.4 MB

Index Status
  Files:         56
  Functions:     187
  Classes:       42
  Interfaces:    31
  Variables:     82

LLM Settings
  Status:  Enabled
  Model:   Qwen 2.5 Coder 3B (3B)
  RAM:     4GB minimum
```

### `code-synapse config`

Manages configuration, including model providers, API keys, and LLM models.

```bash
code-synapse config [options]

Options:
  -s, --setup            Run interactive setup wizard
  --provider <name>      Set model provider (local, openai, anthropic, google)
  --api-key <key>        Set API key for cloud provider
  -m, --model <preset>   Set LLM model (preset or model ID)
  -l, --list-models      List all available models
  -g, --show-guide       Show model selection guide
```

**Model Providers:**

| Provider | Models | API Key | Environment Variable |
|----------|--------|---------|---------------------|
| `local` | Qwen 2.5 Coder (0.5B-14B) | Not required | - |
| `openai` | GPT-4o, GPT-4o Mini | Required | `OPENAI_API_KEY` |
| `anthropic` | Claude 3.5 Sonnet, Claude 3 Haiku | Required | `ANTHROPIC_API_KEY` |
| `google` | Gemini 1.5 Pro, Gemini 1.5 Flash | Required | `GOOGLE_API_KEY` |

**Configure cloud provider:**
```bash
# Interactive setup
code-synapse config --setup

# Or via command line
code-synapse config --provider openai --api-key sk-xxx
```

**List Models Output:**
```
Available LLM Models
────────────────────────────────────

Quick Presets
  ○ fastest    → Qwen 2.5 Coder 0.5B
  ★ balanced   → Qwen 2.5 Coder 3B  (RECOMMENDED)
  ○ quality    → Qwen 2.5 Coder 7B
  ○ maximum    → Qwen 2.5 Coder 14B

All Models (12 total)

QWEN
  ○ qwen2.5-coder-0.5b     0.5B   1GB RAM
  ○ qwen2.5-coder-1.5b     1.5B   2GB RAM
  ○ qwen2.5-coder-3b       3B     4GB RAM  ← RECOMMENDED
  ○ qwen2.5-coder-7b       7B     8GB RAM
  ○ qwen2.5-coder-14b      14B    16GB RAM

LLAMA
  ○ llama-3.2-1b           1B     2GB RAM
  ○ llama-3.2-3b           3B     4GB RAM
  ○ llama-3.1-8b           8B     8GB RAM

CODELLAMA
  ○ codellama-7b           7B     8GB RAM
  ○ codellama-13b          13B    16GB RAM

DEEPSEEK
  ○ deepseek-coder-1.3b    1.3B   2GB RAM
  ○ deepseek-coder-6.7b    6.7B   8GB RAM
```

### `code-synapse start`

Starts the MCP server for AI agent communication.

```bash
code-synapse start [options]

Options:
  -p, --port <port>   Port for HTTP transport (default: stdio)
  -d, --debug         Enable debug logging
```

**What it does:**
1. Loads project configuration
2. Opens CozoDB database
3. Starts MCP server on stdio (or HTTP if port specified)
4. Registers tools and resources
5. Waits for AI agent connections

### `code-synapse justify`

Generates business justifications for code entities using a local LLM.

```bash
code-synapse justify [options]

Options:
  -f, --force           Force re-justification of all entities
  -i, --interactive     Interactive mode for clarification
  --skip-llm            Skip LLM inference, use code analysis only
  -m, --model <preset>  LLM model preset (fastest|minimal|balanced|quality|maximum)
  --file <path>         Justify a specific file only
  --stats               Show justification statistics only
```

**What it does:**
1. Loads indexed code entities from the graph database
2. Processes each entity through the justification pipeline:
   - Extracts code context (signature, JSDoc, parent class/file)
   - Generates LLM prompt with context
   - Infers business purpose and feature area
   - Calculates confidence scores
3. Stores justifications in the database

**How Business Justification Works:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 1: CONTEXT EXTRACTION                                                   │
│ ─────────────────────────                                                   │
│ For each function/class, gather:                                            │
│   • Function name and signature                                             │
│   • JSDoc comments                                                          │
│   • Parent class/file name                                                  │
│   • Async/exported flags                                                    │
│   • Location (file, line numbers)                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 2: PROMPT GENERATION                                                    │
│ ─────────────────────────                                                   │
│ Build structured prompt:                                                    │
│   "You are analyzing code for business purpose..."                          │
│   - Code signature                                                          │
│   - Parent context (if any)                                                 │
│   - Questions: What is this code's purpose? What feature area?              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 3: LLM INFERENCE                                                        │
│ ─────────────────────────                                                   │
│ Local LLM (Qwen 2.5 Coder) analyzes and returns:                           │
│   {                                                                         │
│     "purpose": "Validates user authentication tokens",                      │
│     "featureArea": "Authentication",                                        │
│     "businessValue": "Security - prevents unauthorized access",             │
│     "confidence": 0.85                                                      │
│   }                                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Step 4: CONTEXT PROPAGATION                                                  │
│ ─────────────────────────                                                   │
│ Propagate context through hierarchy:                                        │
│   File → Class → Method                                                     │
│   - Methods inherit class context                                           │
│   - Classes inherit file/module context                                     │
│   - Confidence weighted by inheritance depth                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Example Output:**
```
Business Justification
────────────────────────────────────────

📊 Processing entities...

  validateToken (function)
    → Purpose: Validates JWT tokens for API authentication
    → Feature: Authentication
    → Value: Security - prevents unauthorized access
    → Confidence: 85%

  UserService (class)
    → Purpose: Manages user data and operations
    → Feature: User Management
    → Value: Core business logic for user accounts
    → Confidence: 92%

✔ Justification complete!

Results:
  Entities processed:  145
  Justifications:      142
  Skipped (cached):    3
  Avg confidence:      87%
  Duration:            12.3s
```

**Interactive Mode:**

Use `-i, --interactive` to enable clarification prompts for ambiguous code:

```bash
code-synapse justify --interactive
```

The system may ask questions like:
- "Is `processPayment` related to billing or refunds?"
- "What domain does `syncData` belong to?"

---

## MCP Integration

### Available MCP Tools

| Tool | Description | Arguments |
|------|-------------|-----------|
| `search_code` | Hybrid semantic + keyword search | `query`, `limit?`, `type?` |
| `get_function` | Get function details and callers/callees | `name` |
| `get_class` | Get class with methods and hierarchy | `name` |
| `get_file` | Get file contents and symbols | `path` |
| `get_callers` | Find all callers of a function | `name` |
| `get_callees` | Find all functions called by a function | `name` |
| `get_imports` | Get import chain for a file | `path` |
| `get_project_stats` | Get project statistics | (none) |

### Available MCP Resources

| Resource URI | Description |
|--------------|-------------|
| `file://{path}` | File contents and metadata |
| `symbols://{path}` | Symbols defined in a file |
| `graph://` | Full graph structure summary |

### Example MCP Requests

**Search for code:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "search_code",
    "arguments": {
      "query": "authentication middleware",
      "limit": 10
    }
  }
}
```

**Get function details:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "get_function",
    "arguments": {
      "name": "validateToken"
    }
  }
}
```

---

## Web Viewer & NL Search

### Overview

The Web Viewer provides a visual dashboard and REST API for exploring your indexed codebase without requiring an AI agent. It includes Natural Language Search that lets you query your code using plain English.

### `code-synapse viewer`

Starts the Web Viewer as a standalone server.

```bash
code-synapse viewer [options]

Options:
  -p, --port <port>   Port to run the viewer on (default: 3100)
  -H, --host <host>   Host to bind to (default: 127.0.0.1)
  --json              Output stats as JSON (no server)
```

**Example:**
```bash
# Start viewer on default port
code-synapse viewer

# Start on custom port
code-synapse viewer --port 3200

# Get stats as JSON
code-synapse viewer --json
```

### REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats/overview` | GET | Index statistics (files, functions, etc.) |
| `/api/stats/languages` | GET | Language distribution |
| `/api/stats/complexity` | GET | Complexity distribution by function |
| `/api/files` | GET | List indexed files (pagination supported) |
| `/api/files/:id` | GET | Get file details with functions |
| `/api/functions` | GET | List indexed functions |
| `/api/functions/most-called` | GET | Most frequently called functions |
| `/api/functions/most-complex` | GET | Highest complexity functions |
| `/api/functions/:id` | GET | Get function details |
| `/api/functions/:id/callers` | GET | Functions that call this function |
| `/api/functions/:id/callees` | GET | Functions called by this function |
| `/api/classes` | GET | List indexed classes |
| `/api/classes/:id/hierarchy` | GET | Class inheritance tree |
| `/api/interfaces` | GET | List indexed interfaces |
| `/api/search?q=term` | GET | Search by name |
| `/api/nl-search?q=query` | GET | Natural language search |
| `/api/nl-search/patterns` | GET | Supported NL query patterns |
| `/api/health` | GET | Index health status |

### Natural Language Search

Query your codebase using plain English. The NL Search engine classifies your intent and generates the appropriate database query.

**Example Queries:**

| Query | Intent | Description |
|-------|--------|-------------|
| `most complex functions` | rank_complexity | Find highest cyclomatic complexity |
| `largest files` | rank_size | Rank files by byte size |
| `where is createParser` | find_location | Find symbol location |
| `functions in src/cli/` | filter_scope | Filter by directory |
| `what calls createParser` | show_callers | Find calling functions |
| `what does main call` | show_callees | Find called functions |
| `classes extending Error` | show_hierarchy | Class inheritance |
| `external dependencies` | find_dependencies | External packages |

**API Usage:**

```bash
# Query using curl
curl "http://localhost:3101/api/nl-search?q=most%20complex%20functions"

# Response
{
  "query": "most complex functions",
  "intent": {
    "intent": "rank_complexity",
    "confidence": 0.9,
    "keywords": ["most", "complex", "functions"]
  },
  "results": [
    {
      "id": "func_abc123",
      "name": "writeBatchToDb",
      "complexity": 33,
      "file_path": "src/core/graph/operations.ts"
    }
  ],
  "totalCount": 45,
  "executionTimeMs": 12
}
```

**Get Supported Patterns:**

```bash
curl "http://localhost:3101/api/nl-search/patterns"

# Returns list of all supported query patterns with examples
```

### Using the Dashboard

1. Start Code-Synapse: `code-synapse` or `code-synapse viewer`
2. Open in browser: `http://127.0.0.1:3101`
3. View index statistics, browse files, functions, and classes
4. Use the NL Search bar to query your codebase

---

## Database Schema

### CozoDB Relations (Tables)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              NODE RELATIONS                              │
├─────────────────────────────────────────────────────────────────────────┤
│ file {                                                                   │
│   id: String (PRIMARY KEY)                                              │
│   path: String                                                          │
│   hash: String                                                          │
│   language: String                                                      │
│   size: Int                                                             │
│   last_modified: Int                                                    │
│ }                                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ function {                                                               │
│   id: String (PRIMARY KEY)                                              │
│   name: String                                                          │
│   file_id: String                                                       │
│   start_line: Int                                                       │
│   end_line: Int                                                         │
│   is_async: Bool                                                        │
│   is_exported: Bool                                                     │
│   jsdoc: String?                                                        │
│   signature: String                                                     │
│ }                                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ class {                                                                  │
│   id: String (PRIMARY KEY)                                              │
│   name: String                                                          │
│   file_id: String                                                       │
│   start_line: Int                                                       │
│   end_line: Int                                                         │
│   is_abstract: Bool                                                     │
│   is_exported: Bool                                                     │
│ }                                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ interface {                                                              │
│   id: String (PRIMARY KEY)                                              │
│   name: String                                                          │
│   file_id: String                                                       │
│   start_line: Int                                                       │
│   end_line: Int                                                         │
│   is_exported: Bool                                                     │
│ }                                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ variable {                                                               │
│   id: String (PRIMARY KEY)                                              │
│   name: String                                                          │
│   file_id: String                                                       │
│   start_line: Int                                                       │
│   is_const: Bool                                                        │
│   is_exported: Bool                                                     │
│ }                                                                        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                              EDGE RELATIONS                              │
├─────────────────────────────────────────────────────────────────────────┤
│ contains { from_id: String, to_id: String, to_type: String }            │
│   file → function | class | interface | variable                        │
├─────────────────────────────────────────────────────────────────────────┤
│ calls { from_id: String, to_id: String }                                │
│   function → function                                                    │
├─────────────────────────────────────────────────────────────────────────┤
│ imports { from_id: String, to_id: String, import_type: String }         │
│   file → file (default, named, namespace)                               │
├─────────────────────────────────────────────────────────────────────────┤
│ extends { from_id: String, to_id: String }                              │
│   class → class                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│ implements { from_id: String, to_id: String }                           │
│   class → interface                                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Example CozoScript Queries

**Find all functions in a file:**
```
?[name, start_line] :=
  *file{id: file_id, path: "/src/auth.ts"},
  *contains{from_id: file_id, to_id: fn_id, to_type: "function"},
  *function{id: fn_id, name, start_line}
```

**Find callers of a function:**
```
?[caller_name, caller_file] :=
  *function{id: target_id, name: "validateToken"},
  *calls{from_id: caller_id, to_id: target_id},
  *function{id: caller_id, name: caller_name, file_id},
  *file{id: file_id, path: caller_file}
```

**Find all imports of a file:**
```
?[importer_path] :=
  *file{id: target_id, path: "/src/utils.ts"},
  *imports{from_id: importer_id, to_id: target_id},
  *file{id: importer_id, path: importer_path}
```

---

## LLM Integration

### Model Registry

Code-Synapse supports 12 local LLM models across 4 families:

| Family | Models | Sizes | Best For |
|--------|--------|-------|----------|
| **Qwen 2.5 Coder** | 5 models | 0.5B-14B | Code understanding (recommended) |
| **Llama 3.x** | 3 models | 1B-8B | General tasks |
| **CodeLlama** | 2 models | 7B-13B | Code generation |
| **DeepSeek Coder** | 2 models | 1.3B-6.7B | Code analysis |

### How LLM Inference Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. MODEL LOADING                                                         │
│    - node-llama-cpp loads GGUF model file                               │
│    - Model downloaded from HuggingFace on first use                     │
│    - Quantized for efficient memory usage (Q4_K_M)                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. INFERENCE REQUEST                                                     │
│    - BusinessLogicInferrer prepares prompt                              │
│    - Includes: code snippet, context, question                          │
│    - Uses GBNF grammar for structured JSON output                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. STRUCTURED OUTPUT                                                     │
│    - LLM generates JSON response (100% valid due to GBNF)               │
│    - Includes: summary, purpose, confidence score                       │
│    - Example:                                                            │
│      {                                                                   │
│        "summary": "Validates JWT tokens for API auth",                  │
│        "purpose": "Security",                                            │
│        "confidence": 0.85                                                │
│      }                                                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### RAM Requirements

| Model Size | Min RAM | Recommended |
|------------|---------|-------------|
| 0.5B-1.5B | 2GB | 4GB |
| 3B | 4GB | 8GB |
| 7B | 8GB | 16GB |
| 13B-14B | 16GB | 32GB |

---

## Troubleshooting

### Common Issues

**1. "Code-Synapse is not initialized"**
```bash
# Run init first
code-synapse init
```

**2. "Database lock error"**
```bash
# Another instance is running. Stop it first.
pkill -f "code-synapse start"
```

**3. "Out of memory during LLM inference"**
```bash
# Use a smaller model
code-synapse config --model fastest
```

**4. "Tree-sitter WASM not found"**
```bash
# Reinstall dependencies
rm -rf node_modules
pnpm install
```

### Debug Mode

Enable verbose logging:

```bash
# Set environment variable
DEBUG=* code-synapse index

# Or use CLI flag
code-synapse start --debug
```

### Log Files

Logs are stored in `.code-synapse/logs/`:
- `combined.log` - All logs
- `error.log` - Errors only

---

## Performance Benchmarks

| Operation | Time | Notes |
|-----------|------|-------|
| Initial index (56 files) | 2-3s | First run |
| Incremental update (1 file) | 50-100ms | After change |
| Code search query | <50ms | Hybrid search |
| Function lookup | <10ms | Direct query |
| LLM inference (3B model) | 1-3s | Per code block |

---

## Best Practices

### Project Setup

1. **Initialize Early**: Run `code-synapse init` when starting a new project
2. **Index Regularly**: Run `code-synapse index` after major refactoring
3. **Monitor Status**: Use `code-synapse status` to verify indexing health
4. **Choose Right Model**: Use `code-synapse config --model balanced` for most projects

### Performance Optimization

- **Incremental Indexing**: Code-Synapse automatically detects changes, no need to re-index everything
- **Model Selection**: Use smaller models (fastest/minimal) for large codebases
- **File Patterns**: Configure `sourcePatterns` in config.json to exclude unnecessary files
- **Batch Processing**: Indexing is automatically batched for efficiency

### Common Use Cases

**Use Case 1: Understanding Legacy Code**
```bash
# Initialize and index
code-synapse init
code-synapse index

# Connect to AI agent and ask:
# "What are the main entry points of this application?"
# "How does authentication work in this codebase?"
```

**Use Case 2: Refactoring Safety**
```bash
# Before refactoring, ask your AI agent:
# "Find all callers of the UserService class"
# "What features depend on the payment module?"
```

**Use Case 3: Onboarding New Developers**
```bash
# New team member can quickly understand:
# "Show me the architecture of this project"
# "What are the main modules and how do they interact?"
```

**Use Case 4: Code Review**
```bash
# Review PRs with context:
# "How does this change affect other parts of the codebase?"
# "Are there any breaking changes in this refactor?"
```

---

## Business Layer Classification

Code-Synapse automatically categorizes code entities into two primary classifications:

### Classification Categories

| Category | Description | Examples |
|----------|-------------|----------|
| **Domain** | Business logic, user-facing features, product functionality | Authentication, Payments, Billing, User Management |
| **Infrastructure** | Platform services, utilities, cross-cutting concerns | Database, Cache, Logging, HTTP clients, SDKs |

### Domain Subcategories

Code classified as "Domain" is further categorized:
- `authentication` - Login, logout, session management
- `authorization` - Permissions, roles, access control
- `user-management` - User CRUD, profiles, preferences
- `billing` / `payments` - Transactions, invoices, subscriptions
- `notifications` / `messaging` - Email, SMS, push notifications
- `reporting` / `analytics` - Dashboards, metrics, reports
- `content-management` - CMS, file management
- `workflow` / `scheduling` - Job queues, cron tasks
- `api-gateway` - API routing, rate limiting

### Infrastructure Subcategories

Code classified as "Infrastructure" is further categorized:
- `database` - ORM, query builders, migrations
- `cache` - Redis, Memcached clients
- `message-queue` - RabbitMQ, Kafka, SQS
- `http-client` / `http-server` - REST clients, Express middleware
- `logging` / `monitoring` / `tracing` - Observability tools
- `security` - Encryption, hashing, token validation
- `validation` - Schema validation, input sanitization
- `sdk-client` - Third-party SDK wrappers (Stripe, AWS, etc.)

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/classifications` | GET | List all classifications |
| `/api/classifications/:entityId` | GET | Get classification for entity |
| `/api/classifications/stats` | GET | Classification statistics |
| `/api/classifications/by-category/:category` | GET | Filter by domain/infrastructure |
| `/api/classifications/by-area/:area` | GET | Filter by domain area |
| `/api/classifications/by-layer/:layer` | GET | Filter by infrastructure layer |

---

## Change Ledger & Observability

The Change Ledger is an append-only event log that tracks all meaningful system events for debugging, time-travel analysis, and observability.

### Event Types

| Event Category | Events | Description |
|----------------|--------|-------------|
| **MCP Events** | `mcp:query:received`, `mcp:query:completed` | AI agent queries |
| **Indexing Events** | `index:scan:started`, `index:file:added` | File system changes |
| **Classification Events** | `classify:domain:detected`, `classify:updated` | Entity classification |
| **Justification Events** | `justify:started`, `justify:completed` | Business purpose inference |
| **Adaptive Events** | `adaptive:query:observed`, `adaptive:reindex:triggered` | Adaptive indexing |
| **Graph Events** | `graph:node:created`, `graph:edge:deleted` | Database changes |
| **System Events** | `system:startup`, `system:error` | System lifecycle |

### Ledger Entry Structure

Each ledger entry contains:
- **Identity**: Unique ID, timestamp, sequence number
- **Event classification**: Event type, source
- **Impact tracking**: Affected files, entities, domains
- **Classification changes**: Before/after category, confidence
- **Graph diff summary**: Nodes/edges created/updated/deleted
- **MCP context**: Tool name, query, response time
- **Correlation**: Links related events together

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ledger/entries` | GET | Query ledger entries with filters |
| `/api/ledger/entry/:id` | GET | Get specific entry |
| `/api/ledger/aggregate` | GET | Aggregated statistics |
| `/api/ledger/timeline` | GET | Timeline view of events |
| `/api/ledger/entity/:entityId` | GET | Events for specific entity |
| `/api/ledger/session/:sessionId` | GET | Events for MCP session |
| `/api/ledger/correlation/:correlationId` | GET | Correlated events |

### Query Parameters

```bash
# Filter by time range
curl "/api/ledger/entries?startTime=2024-01-01T00:00:00Z&endTime=2024-01-02T00:00:00Z"

# Filter by event types
curl "/api/ledger/entries?eventTypes=classify:domain:detected,classify:updated"

# Filter by source
curl "/api/ledger/entries?sources=classification-engine,adaptive-indexer"

# Pagination
curl "/api/ledger/entries?limit=50&offset=100"
```

---

## Adaptive MCP-Driven Indexing

The Adaptive Indexer observes MCP queries and code changes to intelligently trigger re-indexing based on usage patterns.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. QUERY OBSERVATION                                             │
│    - Records all MCP tool calls (search_code, get_function)     │
│    - Tracks returned entities and response times                 │
│    - Infers query intent and related domains                    │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. CHANGE OBSERVATION                                            │
│    - Monitors file system changes (create, modify, delete)      │
│    - Tracks AI-generated vs user-edited code                    │
│    - Calculates change significance                              │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. SEMANTIC CORRELATION                                          │
│    - Links queries to subsequent code changes                   │
│    - Identifies patterns: query-then-edit, iterative refinement │
│    - Calculates correlation strength and confidence             │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. INTELLIGENT RE-INDEXING                                       │
│    - Prioritizes entities based on query frequency + recency    │
│    - Triggers re-indexing with appropriate scope                │
│    - Batches requests to avoid performance impact               │
└─────────────────────────────────────────────────────────────────┘
```

### Correlation Types

| Type | Description |
|------|-------------|
| `query-then-edit` | User queried, then edited returned results |
| `query-then-create` | User queried, then created related code |
| `query-then-delete` | User queried, then deleted code |
| `iterative-refinement` | Multiple queries refining same area |
| `exploration` | Queries exploring related areas |

### Re-indexing Triggers

| Reason | Priority | Scope |
|--------|----------|-------|
| `query-correlation` | High | Related entities |
| `change-cascade` | High | Entity + dependents |
| `semantic-drift` | Normal | Entity only |
| `stale-classification` | Normal | File |
| `dependency-update` | Low | Related entities |
| `scheduled` | Low | Entity only |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/adaptive/queries` | GET | List observed queries |
| `/api/adaptive/changes` | GET | List observed changes |
| `/api/adaptive/correlations` | GET | Semantic correlations |
| `/api/adaptive/priorities` | GET | Indexing priorities |
| `/api/adaptive/sessions` | GET | Active sessions |
| `/api/adaptive/sessions/:id` | GET | Specific session |
| `/api/adaptive/reindex-requests` | GET | Pending reindex requests |
| `/api/adaptive/config` | GET | Configuration |

### Configuration Options

```typescript
interface AdaptiveIndexerConfig {
  observeQueries: boolean;       // Enable query observation
  observeChanges: boolean;       // Enable change observation
  enableCorrelation: boolean;    // Enable semantic correlation
  correlationWindowMs: number;   // Time window for correlation (default: 60s)
  minCorrelationStrength: number; // Min strength to trigger reindex (default: 0.5)
  reindexBatchSize: number;      // Batch size for reindexing (default: 10)
  reindexDebounceMs: number;     // Debounce delay (default: 2s)
  sessionTimeoutMs: number;      // Session timeout (default: 30 min)
}
```

---

## Ledger Compaction

The Ledger Compaction service reduces noise in the change ledger by grouping related events into meaningful, session-aware summaries.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. SESSION DETECTION                                             │
│    - Groups events by session boundaries                        │
│    - Detects session start/end from MCP connections             │
│    - Handles implicit sessions from time gaps                   │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. INTENT CLUSTERING                                             │
│    - Groups events with similar semantic intent                 │
│    - Uses content hashing for deduplication                     │
│    - Identifies related operations (query → edit → save)        │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. COMPACTED ENTRY GENERATION                                    │
│    - Creates single entry per meaningful task                   │
│    - Summarizes: user prompts, MCP queries, code changes        │
│    - Preserves raw events internally for forensics              │
└─────────────────────────────────────────────────────────────────┘
```

### Compacted Entry Structure

```typescript
interface CompactedLedgerEntry {
  id: string;
  sessionId: string;
  timestampStart: string;
  timestampEnd: string;
  intentSummary: string;           // "Refactored authentication module"
  intentCategory: string;          // "feature-development" | "bug-fix" | "refactoring"
  userPrompts: string[];           // User's original questions
  mcpQueries: MCPQueryTrace[];     // Tools called, results returned
  codeAccessed: string[];          // Files read
  codeChanges: CodeChange[];       // Files modified
  semanticImpact: SemanticImpact;  // Domain/infra areas affected
  rawEventIds: string[];           // Links to original events
}
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ledger/compacted` | GET | List compacted entries |
| `/api/ledger/compacted/:id` | GET | Get specific compacted entry |
| `/api/ledger/compacted/session/:sessionId` | GET | Entries for session |

---

## Ledger Reconciliation

The Reconciliation Worker detects and fills gaps in the ledger when the system was offline, crashed, or not deployed.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. GAP DETECTION                                                 │
│    - Compares ledger entries with Git history                   │
│    - Identifies commits not recorded in ledger                  │
│    - Calculates gap duration and scope                          │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. COMMIT ANALYSIS                                               │
│    - Fetches commits from Git for the gap period                │
│    - Parses commit messages for intent                          │
│    - Extracts file changes and entity diffs                     │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. SYNTHETIC ENTRY GENERATION                                    │
│    - Creates ledger entries from Git commits                    │
│    - Infers intent category from commit messages                │
│    - Marks entries as "reconciled" for transparency             │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. INDEX SYNCHRONIZATION                                         │
│    - Triggers re-indexing for changed files                     │
│    - Updates entity classifications                              │
│    - Marks commits as synced                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Gap Types

| Reason | Description | Example |
|--------|-------------|---------|
| `system-offline` | System was not running | Server reboot |
| `crash-recovery` | Unexpected termination | OOM kill |
| `late-deployment` | Code-Synapse added to existing project | New installation |
| `manual-sync` | User-triggered reconciliation | CLI command |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/reconciliation/gaps` | GET | List detected gaps |
| `/api/reconciliation/status` | GET | Reconciliation status |
| `/api/reconciliation/trigger` | POST | Trigger reconciliation |

---

## Persistent Developer Memory

The Memory System learns coding rules, conventions, and anti-patterns from developer behavior to help AI stop repeating mistakes.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. LEARNING FROM CORRECTIONS                                     │
│    - Detects when user edits AI-generated code                  │
│    - Compares original vs corrected code                        │
│    - Extracts pattern: "Don't do X, do Y instead"               │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. LEARNING FROM FAILURES                                        │
│    - Monitors build and lint failures                           │
│    - Associates errors with recent AI changes                   │
│    - Creates rules: "This pattern causes build failure"         │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. RULE STORAGE                                                  │
│    - Stores rules with semantic embeddings                      │
│    - Tracks confidence (validated rules get boosted)            │
│    - Applies decay to unused rules                              │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. CONTEXT INJECTION                                             │
│    - Retrieves relevant rules before code generation            │
│    - Formats rules for prompt injection                         │
│    - Prioritizes high-confidence, recent rules                  │
└─────────────────────────────────────────────────────────────────┘
```

### Rule Categories

| Category | Description | Example |
|----------|-------------|---------|
| `convention` | Coding style rules | "Use camelCase for variables" |
| `architecture` | Structural patterns | "Services go in src/services/" |
| `anti-pattern` | Things to avoid | "Don't use any type in TypeScript" |
| `dependency` | Import rules | "Prefer lodash-es over lodash" |
| `formatting` | Style preferences | "Max line length is 100" |

### Memory Rule Structure

```typescript
interface ProjectMemoryRule {
  id: string;
  scope: "global" | "file" | "directory" | "entity";
  scopeTarget?: string;                    // File path or pattern
  category: MemoryRuleCategory;
  triggerType: "file-pattern" | "entity-type" | "code-pattern" | "semantic";
  triggerPattern: string;
  ruleText: string;                        // "Always use async/await instead of .then()"
  ruleExplanation?: string;
  examples?: Array<{ bad: string; good: string }>;
  confidence: number;                      // 0-1, decays over time
  validationCount: number;                 // How often rule was correct
  violationCount: number;                  // How often rule was violated
  source: "user-correction" | "build-failure" | "explicit-instruction" | "inferred";
  createdAt: string;
  lastValidatedAt?: string;
}
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/memory/rules` | GET | List all rules |
| `/api/memory/rules` | POST | Create explicit rule |
| `/api/memory/rules/:id` | GET | Get specific rule |
| `/api/memory/rules/:id` | PATCH | Update rule |
| `/api/memory/stats` | GET | Memory statistics |
| `/api/memory/relevant` | POST | Get rules for context |

---

## Performance Optimization

The Optimization Layer provides performance primitives for scaling to large codebases.

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPTIMIZATION LAYER                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │   LRU Cache   │  │ Bloom Filter  │  │ Heat Tracker  │       │
│  │ (Query/Model) │  │(Entity Check) │  │(Access Freq)  │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
│                                                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │ Worker Pool   │  │ Batch Writer  │  │  Performance  │       │
│  │(Parallel Ops) │  │(Buffered I/O) │  │   Tracker     │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### LRU Cache

- **Query Cache**: Caches database query results with TTL
- **Model Response Cache**: Caches LLM responses for identical prompts
- **O(1) Operations**: Doubly-linked list for efficient eviction

### Bloom Filter

- **Entity Existence Check**: Probabilistic membership testing
- **False Positive Rate**: Configurable (default 1%)
- **Use Case**: Skip database lookups for non-existent entities

### Heat Tracker

- **Access Frequency**: Tracks how often entities are accessed
- **Time Decay**: Recent access weighted higher
- **Hot/Cold Classification**: Identifies frequently used code

### Worker Pool

- **Parallel Processing**: Concurrent task execution
- **Priority Queue**: High-priority tasks processed first
- **Backpressure**: Prevents overwhelming system resources

### Batch Writer

- **Buffered Writes**: Batches database operations
- **Exponential Backoff**: Retry with increasing delays
- **Write-Behind Ledger**: Async ledger operations

### Performance Tracker

- **Operation Timing**: Records latency for all operations
- **Percentile Stats**: P50, P90, P99 latencies
- **Bottleneck Detection**: Identifies slow operations

### Cost Attribution

- **Token Tracking**: Records input/output tokens per operation
- **Cost Calculation**: Estimates cost based on model pricing
- **Budget Management**: Alerts when approaching limits

---

## Multi-Model Intelligence

The Multi-Model Layer provides a unified interface for routing requests to the best available model.

### Supported Providers

| Provider | Models | Use Case |
|----------|--------|----------|
| **Local** | Qwen, Llama, CodeLlama, DeepSeek | Privacy, offline, zero cost |
| **OpenAI** | GPT-4o, GPT-4o-mini | High quality, function calling |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Haiku | (Planned) |
| **Google** | Gemini 1.5 Pro, Gemini 1.5 Flash | (Planned) |

### Model Router

```
┌─────────────────────────────────────────────────────────────────┐
│                       MODEL ROUTER                               │
├─────────────────────────────────────────────────────────────────┤
│  Request                                                         │
│     │                                                            │
│     ▼                                                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 1. Find Candidates                                       │    │
│  │    - Filter by task type support                        │    │
│  │    - Filter by required capabilities                    │    │
│  │    - Apply vendor preferences                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│     │                                                            │
│     ▼                                                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 2. Score Models                                          │    │
│  │    - Quality score (model capability)                   │    │
│  │    - Latency score (response time)                      │    │
│  │    - Cost score (token pricing)                         │    │
│  │    - Local preference bonus                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│     │                                                            │
│     ▼                                                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 3. Execute with Fallback                                 │    │
│  │    - Try best model first                               │    │
│  │    - On failure, try alternatives                       │    │
│  │    - Track statistics                                   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Routing Policies

| Policy | Description | Use Case |
|--------|-------------|----------|
| `preferLocal` | Prefer local models | Privacy, offline |
| `maxLatencyMs` | Maximum acceptable latency | Real-time responses |
| `maxCostPerRequest` | Maximum cost per request | Budget control |
| `qualityThreshold` | Minimum quality score | Critical tasks |
| `fallbackOrder` | Provider fallback order | Reliability |

### Example Usage

```typescript
// Create router with providers
const router = await createInitializedModelRouter({
  enableLocal: true,
  enableOpenAI: true,
});

// Execute with policy
const response = await router.execute({
  prompt: "Explain this function...",
  taskType: "generation",
}, {
  preferLocal: true,
  maxLatencyMs: 5000,
  qualityThreshold: 0.7,
});
```

### Statistics Tracking

The router tracks:
- Total requests per model
- Requests by vendor
- Average latency
- Total tokens used
- Total cost
- Cache hit rate
- Fallback count

---

## Next Steps

1. **Explore the codebase**: Use `code-synapse status -v` to see what's indexed
2. **Query via MCP**: Connect Claude Code or Cursor and ask questions about your code
3. **Customize models**: Use `code-synapse config --model` to change LLM
4. **Read Architecture**: Check [ARCHITECTURE.md](./ARCHITECTURE.md) for technical details
5. **Contribute**: Fork the repo, run `pnpm install && pnpm dev`, and submit a PR

## Additional Resources

- **MCP Protocol**: [Model Context Protocol Specification](https://modelcontextprotocol.io/specification)
- **CozoDB**: [CozoDB Documentation](https://docs.cozodb.org/en/latest/)
- **Tree-sitter**: [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)
- **GitHub Repository**: [code-synapse/code-synapse](https://github.com/code-synapse/code-synapse)

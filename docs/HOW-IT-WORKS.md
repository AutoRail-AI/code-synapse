# How Code-Synapse Works

A comprehensive guide to understanding Code-Synapse's architecture, data flow, and how to run it from source.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Deep Dive](#architecture-deep-dive)
3. [Data Flow Pipeline](#data-flow-pipeline)
4. [Running from Source](#running-from-source)
5. [CLI Commands](#cli-commands)
6. [MCP Integration](#mcp-integration)
7. [Database Schema](#database-schema)
8. [LLM Integration](#llm-integration)

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
│  │    init     │  │    index    │  │   status    │  │   config    │        │
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
│   ├── index.ts            # Entry point, signal handlers
│   └── commands/
│       ├── init.ts         # Initialize project
│       ├── index.ts        # Trigger indexing
│       ├── status.ts       # Show project status
│       ├── config.ts       # Model configuration
│       └── start.ts        # Start MCP server
│
├── mcp/                    # MCP Server (AI agent interface)
│   ├── server.ts           # Server setup, tool handlers
│   ├── tools.ts            # MCP tool definitions
│   └── resources.ts        # MCP resource handlers
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
│   └── llm/                # Local LLM inference
│       ├── llm-service.ts  # llama.cpp wrapper
│       ├── models.ts       # Model registry (12 models)
│       └── business-logic-inferrer.ts
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
| **Parser** | AST generation from source | web-tree-sitter (WASM) |
| **Graph** | Persistent storage, queries | CozoDB with RocksDB |
| **Indexer** | Pipeline orchestration | Custom coordinator |
| **Extraction** | Entity & relationship extraction | Custom pipeline |
| **Embeddings** | Vector generation | @huggingface/transformers |
| **LLM** | Business logic inference | node-llama-cpp |

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
│   3. FileScanner uses fast-glob to find source files                     │
│   4. Filters by sourcePatterns, ignores node_modules, dist, etc.         │
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
│ PHASE 4: WRITING                                                          │
│ ─────────────────                                                         │
│ Input: ExtractionResult                                                   │
│ Process:                                                                  │
│   1. GraphWriter batches entities into CozoDB transactions               │
│   2. Inserts nodes: file, function, class, interface, variable           │
│   3. Inserts edges: contains, calls, imports, extends, implements        │
│   4. Updates vector index for semantic search                            │
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

# Initialize in a project
cd /path/to/your/project
node /path/to/code-synapse/dist/cli/index.js init

# Index the project
node /path/to/code-synapse/dist/cli/index.js index

# Check status
node /path/to/code-synapse/dist/cli/index.js status

# List available LLM models
node /path/to/code-synapse/dist/cli/index.js config --list-models

# Start MCP server
node /path/to/code-synapse/dist/cli/index.js start
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

Code-Synapse runs as an HTTP MCP server, designed to work with Claude Code and Cursor.

#### Starting the HTTP MCP Server

```bash
# Start MCP server on default port (3100)
cd /path/to/your/project
node /path/to/code-synapse/dist/cli/index.js start

# Start on a custom port
node /path/to/code-synapse/dist/cli/index.js start --port 3200

# Start with debug logging
node /path/to/code-synapse/dist/cli/index.js start --debug
```

The server will output:
```
Code-Synapse MCP Server
────────────────────────────────────
  Project:    my-project
  Transport:  HTTP (SSE)
  Port:       3100
  Status:     Running

  Connect via: http://localhost:3100/sse
```

#### Claude Code Integration

**Option 1: Using Claude Code CLI (Recommended)**

```bash
# Add Code-Synapse as an HTTP MCP server
claude mcp add --transport http code-synapse http://localhost:3100/mcp

# Or add as SSE server (alternative transport)
claude mcp add --transport sse code-synapse http://localhost:3100/sse

# Add with specific scope
claude mcp add --transport http code-synapse http://localhost:3100/mcp --scope user   # Available across all projects
claude mcp add --transport http code-synapse http://localhost:3100/mcp --scope local  # Current project only (default)
claude mcp add --transport http code-synapse http://localhost:3100/mcp --scope project # Shared via .mcp.json
```

**Option 2: Manual Configuration**

Add to `~/.claude.json` (user scope) or project-level `.mcp.json` (project scope):

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

**Managing MCP Servers in Claude Code:**

```bash
# List all configured MCP servers
claude mcp list

# Check server details
claude mcp get code-synapse

# Remove a server
claude mcp remove code-synapse

# Within Claude Code, check server status
/mcp
```

#### Cursor Integration

Cursor supports MCP through three transport methods:

| Transport | Execution | Deployment | Use Case |
|-----------|-----------|------------|----------|
| **stdio** | Local | Cursor manages | Single user, local tools |
| **SSE** | Local/Remote | Deploy as server | Multiple users |
| **Streamable HTTP** | Local/Remote | Deploy as server | Multiple users, recommended |

**Option 1: Remote Server (HTTP) - Recommended for Code-Synapse**

Create `.cursor/mcp.json` in your project root (project-specific) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "code-synapse": {
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

**Option 2: With Authentication Headers**

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

| Variable | Description |
|----------|-------------|
| `${env:NAME}` | Environment variable |
| `${userHome}` | Path to home folder |
| `${workspaceFolder}` | Project root directory |
| `${workspaceFolderBasename}` | Name of project root |
| `${pathSeparator}` or `${/}` | OS path separator |

Example with variables:
```json
{
  "mcpServers": {
    "code-synapse": {
      "url": "${env:CODE_SYNAPSE_URL:-http://localhost:3100}/mcp"
    }
  }
}
```

**Using MCP in Cursor:**

1. **Agent Mode**: Cursor's Agent automatically uses MCP tools when relevant
2. **Toggle Tools**: Click a tool name in the tools list to enable/disable
3. **Tool Approval**: Agent asks for approval before using MCP tools (can enable auto-run)
4. **View Responses**: Expandable views show tool arguments and responses

**Cursor MCP Protocol Support:**

| Feature | Support | Description |
|---------|---------|-------------|
| Tools | ✅ | Functions for the AI model to execute |
| Prompts | ✅ | Templated messages and workflows |
| Resources | ✅ | Structured data sources |
| Roots | ✅ | Server-initiated URI inquiries |
| Elicitation | ✅ | Server-initiated requests for info |

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

2. **Start the MCP server**:
   ```bash
   code-synapse start --port 3100
   ```

3. **Register with Claude Code**:
   ```bash
   claude mcp add --transport http code-synapse http://localhost:3100/mcp
   ```

4. **Verify connection** (within Claude Code):
   ```
   /mcp
   ```

5. **Query your codebase**:
   - Ask Claude Code: "Search for authentication functions"
   - Ask Claude Code: "How does the payment flow work?"

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

Manages configuration, especially LLM models.

```bash
code-synapse config [options]

Options:
  -m, --model <preset>   Set LLM model (preset or model ID)
  -l, --list-models      List all available models
  -g, --show-guide       Show model selection guide
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

## Next Steps

1. **Explore the codebase**: Use `code-synapse status -v` to see what's indexed
2. **Query via MCP**: Connect Claude Code or Cursor and ask questions about your code
3. **Customize models**: Use `code-synapse config --model` to change LLM
4. **Contribute**: Fork the repo, run `pnpm install && pnpm dev`, and submit a PR

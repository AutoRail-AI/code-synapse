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
  cli/                # CLI entry point (commander)
dist/                 # Compiled output
```

## Core Dependencies

| Package | Purpose |
|---------|---------|
| `web-tree-sitter` | AST parsing (Syntax Layer) |
| `@kuzu/kuzu-wasm` | Graph database (Structural relationships) |
| `@lancedb/lancedb` | Vector database (Semantic search) |
| `@huggingface/transformers` | Local embeddings (ONNX) |
| `node-llama-cpp` | Local LLM inference (Business Logic Layer) |
| `@modelcontextprotocol/sdk` | MCP server implementation |
| `commander` | CLI framework |
| `chokidar` | File watching for incremental indexing |

## Four-Layer Knowledge Engine

1. **Syntax Layer** - Tree-sitter WASM for AST parsing
2. **Semantic Layer** - Import/export relationships, type hierarchies
3. **Architectural Layer** - Service boundaries, API contracts, design patterns
4. **Business Logic Layer** - Local SLM (Qwen 2.5) for intent inference

## Key Constraints

- Package manager: pnpm 9.0.0+
- Node version: >= 18
- Privacy-first: All processing must stay local, no external API calls

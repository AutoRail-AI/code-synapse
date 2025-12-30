# Library References

This document catalogs all external libraries used in Code-Synapse and their official documentation sources.

## Graph Database

| Library | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| **cozo-node** | ^0.7.6 | Graph database with native vector search | [CozoDB Docs](https://docs.cozodb.org/en/latest/) |
| | | | [GitHub](https://github.com/cozodb/cozo) |
| | | | [CozoScript Tutorial](https://docs.cozodb.org/en/latest/tutorial.html) |
| | | | [Vector Search (HNSW)](https://docs.cozodb.org/en/latest/vector.html) |

### CozoDB Query Reference

```
# Creating Relations (Tables)
:create relation_name {
    key_field: Type
    =>
    value_field: Type default value
}

# Vector Index Creation
::hnsw relation_name {
    fields: [vector_field],
    m: 50,
    ef_construction: 200
}

# Querying Data
?[vars] := *relation{field1: value, field2}

# Inserting Data
?[field1, field2] <- [['value1', 'value2']]
:put relation_name {field1 => field2}

# Deleting Data
?[key_fields] := condition
:rm relation_name {key_fields}

# Recursive Queries (Datalog)
reachable[to] := *calls{from: 'start', to}
reachable[to] := reachable[mid], *calls{from: mid, to}
?[result] := reachable[result]

# Vector Search (KNN)
?[id, distance] := *relation{id, embedding: vec},
                   v_knn(vec, $query_vec, 10, distance)
```

## Vector Database (Legacy)

| Library | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| **@lancedb/lancedb** | ^0.17.0 | Vector similarity search (optional fallback) | [LanceDB Docs](https://lancedb.github.io/lancedb/) |
| | | | [GitHub](https://github.com/lancedb/lancedb) |

> **Note**: CozoDB now provides native vector search via HNSW indices. LanceDB is retained for specialized use cases requiring Apache Arrow integration.

## Code Parsing

| Library | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| **web-tree-sitter** | ^0.26.3 | WASM-based AST parsing | [Tree-sitter Docs](https://tree-sitter.github.io/tree-sitter/) |
| | | | [GitHub](https://github.com/tree-sitter/tree-sitter) |
| **tree-sitter-typescript** | ^0.23.2 | TypeScript/TSX grammar | [GitHub](https://github.com/tree-sitter/tree-sitter-typescript) |
| **tree-sitter-javascript** | ^0.25.0 | JavaScript grammar | [GitHub](https://github.com/tree-sitter/tree-sitter-javascript) |

### Tree-sitter Query Reference

```scheme
;; Query function declarations
(function_declaration
  name: (identifier) @function.name
  parameters: (formal_parameters) @function.params
  body: (statement_block) @function.body)

;; Query class declarations
(class_declaration
  name: (identifier) @class.name
  body: (class_body) @class.body)

;; Query imports
(import_statement
  source: (string) @import.source)
```

## Embeddings & AI

| Library | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| **@huggingface/transformers** | ^3.5.1 | Local embedding generation (ONNX) | [Transformers.js Docs](https://huggingface.co/docs/transformers.js) |
| | | | [GitHub](https://github.com/xenova/transformers.js) |
| **node-llama-cpp** | ^3.14.5 | Local LLM inference | [GitHub](https://github.com/withcatai/node-llama-cpp) |
| | | | [Docs](https://withcatai.github.io/node-llama-cpp/) |

### Embedding Models

| Model | Dimensions | Use Case |
|-------|------------|----------|
| `all-MiniLM-L6-v2` | 384 | Fast, general-purpose |
| `all-mpnet-base-v2` | 768 | Higher quality, slower |
| `bge-small-en-v1.5` | 384 | Good for code |

## MCP Protocol

| Library | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| **@modelcontextprotocol/sdk** | ^1.25.1 | MCP server implementation | [MCP Spec](https://modelcontextprotocol.io/) |
| | | | [GitHub](https://github.com/modelcontextprotocol/sdk) |

### MCP Server Example

```typescript
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';

const server = new Server({ name: 'code-synapse', version: '0.1.0' });

server.setRequestHandler('tools/list', async () => ({
  tools: [{ name: 'search', description: 'Search codebase' }]
}));
```

## CLI & Utilities

| Library | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| **commander** | ^14.0.2 | CLI framework | [Commander.js Docs](https://github.com/tj/commander.js) |
| **chalk** | ^5.6.2 | Terminal colors | [Chalk Docs](https://github.com/chalk/chalk) |
| **ora** | ^9.0.0 | Terminal spinners | [Ora Docs](https://github.com/sindresorhus/ora) |
| **chokidar** | ^5.0.0 | File watching | [Chokidar Docs](https://github.com/paulmillr/chokidar) |
| **fast-glob** | ^3.3.3 | Fast file matching | [fast-glob Docs](https://github.com/mrmlnc/fast-glob) |
| **pino** | ^10.1.0 | Structured logging | [Pino Docs](https://getpino.io/) |
| **zod** | ^4.2.1 | Schema validation | [Zod Docs](https://zod.dev/) |

## TypeScript Compiler API

The TypeScript Compiler API is used for semantic analysis (type resolution, call graphs).

| API | Purpose | Documentation |
|-----|---------|---------------|
| `ts.createProgram()` | Create type checker | [TS Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) |
| `ts.TypeChecker` | Resolve types | [Type Checker](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#type-checker) |
| `ts.Symbol` | Symbol resolution | [Working with Symbols](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#using-the-type-checker) |

### TypeScript API Example

```typescript
import * as ts from 'typescript';

const program = ts.createProgram(files, compilerOptions);
const checker = program.getTypeChecker();

// Get type of a node
const type = checker.getTypeAtLocation(node);
const typeString = checker.typeToString(type);

// Get symbol for identifier
const symbol = checker.getSymbolAtLocation(identifier);
const declarations = symbol?.getDeclarations();
```

## Development Dependencies

| Library | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| **typescript** | 5.9.2 | TypeScript compiler | [TypeScript Docs](https://www.typescriptlang.org/docs/) |
| **vitest** | ^4.0.16 | Testing framework | [Vitest Docs](https://vitest.dev/) |
| **eslint** | ^9.39.1 | Code linting | [ESLint Docs](https://eslint.org/docs/) |
| **prettier** | ^3.7.4 | Code formatting | [Prettier Docs](https://prettier.io/docs/en/) |

## Architecture Decision: Why CozoDB?

### Comparison with Alternatives

| Feature | CozoDB | Neo4j | KuzuDB | SQLite |
|---------|--------|-------|--------|--------|
| **Embedded** | ✅ | ❌ | ✅ | ✅ |
| **Native Vectors** | ✅ HNSW | ❌ | ❌ | ❌ |
| **Recursive Queries** | ✅ Datalog | ✅ Cypher | ✅ Cypher | ❌ |
| **JSON Support** | ✅ Native | ✅ | ✅ | ❌ |
| **Transactions** | ✅ Block | ✅ | ✅ | ✅ |
| **Storage Backend** | RocksDB | Custom | Custom | File |

### Key Benefits

1. **Single Database**: Graph + Vector in one store (eliminates LanceDB sync issues)
2. **Datalog**: More expressive recursive queries than Cypher
3. **Embedded**: No external server, perfect for CLI tool
4. **RocksDB Backend**: Proven performance and reliability

## Quick Links

- [CozoDB Tutorial](https://docs.cozodb.org/en/latest/tutorial.html)
- [CozoDB Functions](https://docs.cozodb.org/en/latest/functions.html)
- [CozoDB Aggregations](https://docs.cozodb.org/en/latest/aggregations.html)
- [Tree-sitter Query Syntax](https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax)
- [MCP Protocol Spec](https://modelcontextprotocol.io/specification)
- [TypeScript AST Viewer](https://ts-ast-viewer.com/)

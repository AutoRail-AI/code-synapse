# Hybrid Search Implementation Plan

> **The Dual-Hemisphere Brain**: Combining Semantic (Embeddings) + Lexical (Zoekt) Search for Business-Aware Code Intelligence

## Executive Summary

Code-Synapse requires **both** semantic and lexical search to deliver its core value proposition:

| Search Type | Technology | Purpose | Priority |
|-------------|------------|---------|----------|
| **Semantic** | HuggingFace Embeddings + CozoDB HNSW | "What does this code mean?" | **Phase 1** (Fix broken pipeline) |
| **Lexical** | Zoekt Binary | "Where exactly is this code?" | **Phase 2** (Add new capability) |

---

## Phase 1: Activate the Dormant Embedding Layer

**Goal:** Wire up the existing `EmbeddingService` so vectors are actually generated and stored during indexing.

### Current State Analysis (Post Phase 1)

| Component | Status | Gap |
|-----------|--------|-----|
| `EmbeddingService` | ✅ Implemented | None |
| `service.initialize()` | ✅ Called in `Indexer` | None |
| Extractors produce `EmbeddingChunk` | ✅ Working | None |
| `EmbeddingChunk` → Vector generation | ✅ **Done** | Wired in IndexerCoordinator + indexFile |
| Vector storage in CozoDB | ✅ **Done** | `entity_embedding` relation + HNSW index |
| `vectorSearch` implementation | ✅ **Done** | Prefers `entity_embedding`, fallback to `function_embedding` |

### Implementation Steps

#### 1.1 Update Extraction Types & Batch Scope

**File:** `src/core/extraction/types.ts`

**Objective:** Integrate embeddings directly into the batch structure for atomic-like writes.

```typescript
// Add new row type
export type EntityEmbeddingRow = [
  string, // entity_id
  string, // file_id
  number[], // vector
  string, // text_hash
  string, // model
  number  // created_at
];

// Update CozoBatch interface
export interface CozoBatch {
  // ... existing tables
  entityEmbeddings: EntityEmbeddingRow[];
}

// Update createEmptyBatch() to initialize the array
```

---

#### 1.2 Add HNSW Vector Index Schema

**File:** `src/core/graph/schema-definitions.ts`

**Key Change:** Add `file_id` to `entity_embedding` to enable efficient cleanup when files are modified.

```datalog
# New relation for entity embeddings
:create entity_embedding {
  entity_id: String,
  file_id: String      # Added for O(1) cleanup by file
  =>
  vector: [F32; 384],    # all-MiniLM-L6-v2 dimension
  text_hash: String,     # To detect when re-embedding needed
  model: String,
  created_at: Int
}

# HNSW index for fast similarity search
::hnsw create entity_embedding:embedding_idx {
  dim: 384,
  m: 16,
  ef_construction: 200,
  fields: [vector]
}
```

---

#### 1.3 Update CozoGraphStore to Handle Embeddings

**File:** `src/core/graph/cozo-graph-store.ts`

**Update `writeBatchToDb`:**

```typescript
// Inside writeBatchToDb function
if (batch.entityEmbeddings.length > 0) {
  // Convert chunks to native Cozo arrays for insertion
  const rows = batch.entityEmbeddings;
  await db.execute(`
    ?[entity_id, file_id, vector, text_hash, model, created_at] <- $rows
    :put entity_embedding { entity_id, file_id => vector, text_hash, model, created_at }
  `, { rows });
}
```

**Implement `vectorSearch`:**

```typescript
async vectorSearch(
  queryVector: number[], 
  k: number = 10
): Promise<VectorSearchResult[]> {
  const result = await this.db.query<{
    entity_id: string;
    distance: number;
    // can join with other tables here if needed to return names immediately
  }>(`
    ?[entity_id, distance] :=
      ~entity_embedding:embedding_idx {
        entity_id, vector |
        query: $query,
        k: $k,
        ef: 100
      },
      distance = vec_cosine_distance(vector, $query)
    :order distance
    :limit $k
  `, { query: queryVector, k });
  
  return result.rows.map(r => ({
    entityId: r.entity_id, // Accessing by column name property if using query<T>
    score: 1 - r.distance,
  }));
}
```

---

#### 1.4 Wire Embeddings into IndexerCoordinator

**File:** `src/core/indexer/coordinator.ts`

**Changes:**
1.  Inject `embeddingService` into constructor.
2.  In `processBatch` (or `indexFile`), process `embeddingChunks`.
3.  Compute embeddings and inject into `batch.entityEmbeddings` **before** calling `graphWriter.writeFile`.

```typescript
// In IndexerCoordinator.processFile (or equivalent batch processor)

// 1. Extract
const result = await this.pipeline.extract(file, hash, size);

// 2. Generate Embeddings (if enabled)
if (result.embeddingChunks.length > 0) {
  const texts = result.embeddingChunks.map(c => c.text);
  const embeddings = await this.embeddingService.embedBatch(texts);
  
  // 3. Inject into Batch
  const now = Date.now();
  result.batch.entityEmbeddings = result.embeddingChunks.map((chunk, i) => [
    chunk.entityId,
    result.fileId,
    embeddings[i].vector,
    hash(chunk.text), // md5 or similar checks
    'all-MiniLM-L6-v2',
    now
  ]);
}

// 4. Write (Atomic update including embeddings)
await this.writer.writeFile(result);
```

---

#### 1.5 Update GraphWriter for Cleanup

**Crucial Step:** We must ensure old embeddings are deleted when a file is re-indexed.

**File:** `src/core/graph-builder/graph-writer.ts`

**Update `deleteFileEntities` method:**

```typescript
// Inside deleteFileEntities(fileId: string)

// ... existing cleanup code ...

// Efficiently delete all embeddings for this file using the new file_id column
await safeExecute(
  `?[file_id] := *entity_embedding{file_id}, file_id = $fileId
   :rm entity_embedding {file_id}`,
  { fileId }
);

// ... continue with entity deletion
```

---

#### 1.6 Update Indexer to Pass EmbeddingService

**File:** `src/core/indexer/index.ts`

Update `initialize` to inject `embeddingService` into `IndexerCoordinator`.

---

#### 1.7 Expose via MCP Tool

**File:** `src/mcp/tools.ts`

Add `find_similar_code` tool wrapping `graphStore.vectorSearch`.

---

### Phase 1 Implementation Summary (Completed)

Phase 1 has been implemented. Summary of changes:

| Step | File(s) | What was done |
|------|--------|----------------|
| **1.1** | `src/core/extraction/types.ts` | Added `EntityEmbeddingRow` type, `entityEmbeddings` on `CozoBatch`, and `createEmptyBatch()` initialisation. |
| **1.2** | `src/core/graph/cozo-graph-store.ts` | Added `entity_embedding` relation and HNSW index in `ensureEntityEmbeddingSchema()`; called from `createSchema()` (new DBs) and `initialize()` (existing DBs). No new migration file; schema ensured on init. |
| **1.3** | `src/core/graph/cozo-graph-store.ts` | `writeBatchToDb` writes `batch.entityEmbeddings` into `entity_embedding`. `vectorSearch()` queries `~entity_embedding:embedding_idx` first, then falls back to `function_embedding`. |
| **1.4** | `src/core/indexer/coordinator.ts` | Optional `embeddingService` in options; in `processBatch` and `indexFile`, after extract, embeddings are computed via `embedBatch`, `text_hash` via SHA-256, and `batch.entityEmbeddings` set before write. |
| **1.5** | `src/core/graph-builder/graph-writer.ts` | In `deleteFileEntities`, added removal of `entity_embedding` rows by `file_id` (`?[entity_id, file_id] := *entity_embedding{...}, file_id = $fileId :rm entity_embedding {entity_id, file_id}`). |
| **1.6** | `src/core/indexer/index.ts` | `IndexerCoordinator` is constructed with `embeddingService: this.embeddingService`. |
| **1.7** | MCP + SimilarityService | `find_similar_code` already existed. `SimilarityService.findSimilarByEmbedding()` now uses `store.vectorSearch()` first (so it uses `entity_embedding` when populated), then enriches with `getEntityNameAndPath()`; fallback remains the previous `function_embedding` query. |

**Additional details:**

- **Text hash:** `coordinator` uses `createHash("sha256").update(text, "utf8").digest("hex")` for `text_hash` (re-embedding detection).
- **Model id:** Taken from `embeddingService.getModelId()` (e.g. `Xenova/all-MiniLM-L6-v2`).
- **Entity cleanup:** When a file is re-indexed or removed, `deleteFileEntities` deletes all `entity_embedding` rows for that `file_id` before entity deletion.
- **Backward compatibility:** If `entity_embedding` has no rows, `vectorSearch` and `findSimilarByEmbedding` use the existing `function_embedding` path.
- **Stats:** `GraphWriter.countEntities()` includes `batch.entityEmbeddings.length` in the written-entity count.


---

## Phase 2: Add Zoekt Lexical Search Engine

**Goal:** Embed Zoekt as a subprocess for blazing-fast regex/symbol search.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Code-Synapse Process                    │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │   Node.js       │    │   Zoekt (Go Binary)             │ │
│  │   Main Process  │───▶│   - zoekt-webserver :6070       │ │
│  │                 │◀───│   - zoekt-index (on changes)    │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Steps

#### 2.1 Binary Setup Script

**File:** `scripts/setup-zoekt.sh`

*   Download platform–specific binaries (Mac ARM/Intel, Linux).
*   Place in `bin/` (ensure `.gitignore` includes `bin/`).

#### 2.2 Zoekt Process Manager

**File:** `src/core/search/zoekt-manager.ts`

**Enhancements:**
*   **Port Configuration:** Accept port in constructor (default 6070) to avoid conflicts.
*   **Health Check:** `waitForReady` should hit `/` or `/healthz`.
*   **Crash Recovery:** Monitor process 'exit' and restart if unexpected.

```typescript
import { spawn, ChildProcess } from 'child_process';
import { createLogger } from '../../utils/logger.js';
import * as path from 'path';
import * as fs from 'fs';
import { net } from 'net';

const logger = createLogger('zoekt-manager');

export class ZoektManager {
  private webserver: ChildProcess | null = null;
  private indexDir: string;
  private port: number;
  private binDir: string;

  constructor(options: {
    repoRoot: string;
    dataDir: string;
    port?: number;
  }) {
    // ... assignment ...
    this.port = options.port || 6070;
  }

  async start(): Promise<void> {
    if (!(await this.isPortFree(this.port))) {
      throw new Error(`Port ${this.port} is already in use`);
    }

    // Ensure index directory exists
    fs.mkdirSync(this.indexDir, { recursive: true });

    // Start webserver
    const webserverBin = path.join(this.binDir, 'zoekt-webserver');
    this.webserver = spawn(webserverBin, [
      '-listen', `:${this.port}`,
      '-index', this.indexDir,
    ], {
       // Detached true allows the search to survive parent restarts (optional)
       // but typically we want it tied to the parent process lifecycle
      detached: false, 
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.webserver.stderr?.on('data', (data) => {
      // Zoekt logs are useful but verbose
      logger.debug({ data: data.toString() }, 'Zoekt stderr');
    });

    try {
      await this.waitForReady();
      logger.info({ port: this.port }, 'Zoekt webserver started');
    } catch (e) {
      this.stop(); // Cleanup if failed
      throw e;
    }
  }

  // Health check with exponential backoff
  private async waitForReady(timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    let delay = 100;
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://localhost:${this.port}/`);
        if (res.ok) return;
      } catch {
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 1.5, 500); 
      }
    }
    throw new Error('Zoekt webserver failed to start');
  }

  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  }
}
```

#### 2.3 Integrate into Initialization

**File:** `src/cli/commands/start.ts`

*   Initialize `ZoektManager`.
*   Connect watcher events to `zoekt.reindex()`.
*   **Optimization:** Debounce re-indexing (e.g., 30s) to avoid thrashing Zoekt on massive changes (like `npm install`).

```typescript
// ...
const zoekt = new ZoektManager({ ... });
await zoekt.start();

// Debounce re-indexing
let reindexTimer: NodeJS.Timeout;
watcher.on('change', () => {
  clearTimeout(reindexTimer);
  reindexTimer = setTimeout(() => {
    zoekt.reindex().catch(err => logger.error({ err }, "Zoekt reindex failed"));
  }, 30_000);
});
```

---

#### 2.4 MCP Tool for Lexical Search

**File:** `src/mcp/tools.ts`

```typescript
{
  name: "search_code_exact",
  description: "Exact/regex code search using Zoekt",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query (supports regex)" },
      filePattern: { type: "string", description: "File glob pattern" },
      limit: { type: "number", default: 20 }
    },
    required: ["query"]
  },
  handler: async ({ query, filePattern, limit }) => {
    return zoektManager.search(query, { filePattern, maxResults: limit });
  }
}
```

---

### Phase 2 Implementation Summary (Completed)

Phase 2 has been implemented. Summary of changes:

| Step | File(s) | What was done |
|------|--------|----------------|
| **2.1** | `scripts/setup-zoekt.sh`, `.gitignore` | Setup script creates `bin/`, installs `zoekt-webserver` and `zoekt-git-index` via `go install` when Go is available; otherwise prints manual instructions. `.gitignore` updated to include `bin/`. |
| **2.2** | `src/core/search/zoekt-manager.ts`, `src/core/search/index.ts` | `ZoektManager` with configurable port (default 6070), `repoRoot`, `dataDir`, `binDir`. `start()` / `stop()`, `waitForReady()` (GET `/healthz` with backoff), `isPortFree()`, `reindex()` (runs `zoekt-git-index -index <indexDir> <repoRoot>` when binary and `.git` exist), `search(query, opts)` (GET `/search?q=...&format=json&num=...`). Binary resolution: `binDir` first, then PATH. Exported from `core/search/index.ts` and re-exported in `core/index.ts`. |
| **2.3** | `src/mcp/server.ts` | Zoekt started in `startServer()` after indexer/embedding init (non-fatal: on failure, lexical search is unavailable). File watcher `onBatch` schedules debounced reindex with `ZOEKT_REINDEX_DEBOUNCE_MS` (30s). On `stopServer()`, reindex timer cleared and `zoektManager.stop()` called. Integration is in the MCP server lifecycle (not in `start.ts`) so Zoekt runs only when the MCP server runs. |
| **2.4** | `src/mcp/server.ts` | MCP tool `search_code_exact` added to `TOOL_DEFINITIONS` with `query` (required), `filePattern`, `limit`. Handler calls `zoektManager.search()`; if Zoekt is not available, returns a message directing the user to run `scripts/setup-zoekt.sh`. `McpServerOptions` extended with `zoektManager`. |

**Notes:**

- **Binaries:** Zoekt does not publish pre-built releases; the setup script uses `go install github.com/sourcegraph/zoekt/cmd/zoekt-webserver@latest` and `zoekt-git-index@latest`. Users without Go get clear instructions.
- **Reindex:** Runs only when the project root is a git repo (`.git` present) and `zoekt-git-index` is available. Reindex is debounced (30s) to avoid thrashing on large change sets.
- **Search API:** Zoekt webserver is queried via GET `/search?q=...&format=json&num=...`; response is parsed and returned as `ZoektSearchResult` (file matches and line matches).
- **Graceful degradation:** If Zoekt fails to start or binaries are missing, the MCP server still runs; `search_code_exact` then returns an explanatory message.

---

## Phase 3: The Hybrid Search Service (The Secret Sauce)

**Goal:** Combine semantic and lexical search for complex queries.

### Implementation

**File:** `src/core/search/hybrid-service.ts`

```typescript
export class HybridSearchService {
  constructor(
    private graphStore: IGraphStore,
    private embeddingService: EmbeddingService,
    private zoekt: ZoektManager,
  ) {}

  async searchWithJustification(
    query: string,
    businessContext?: string
  ): Promise<HybridSearchResult[]> {
    // Step 1: Semantic scope (find relevant business area)
    let scopeFiles: string[] | undefined;
    
    if (businessContext) {
      // Query graph for files related to this business context
      const contextNodes = await this.graphStore.query(`
        ?[file_path] := 
          *justification{entity_id, feature_context},
          feature_context = $context,
          *function{id, file_id}, id = entity_id,
          *file{id, relative_path}, id = file_id,
          file_path = relative_path
      `, { context: businessContext });
      
      scopeFiles = contextNodes.rows.map(r => r[0]);
    }

    // Step 2: Semantic search for conceptual matches
    const queryEmbedding = await this.embeddingService.embed(query);
    const semanticResults = await this.graphStore.vectorSearch(
      queryEmbedding.vector, 
      20
    );

    // Step 3: Lexical search (optionally scoped)
    const filePattern = scopeFiles?.length 
      ? `(${scopeFiles.join('|')})` 
      : undefined;
    const lexicalResults = await this.zoekt.search(query, { filePattern });

    // Step 4: Merge and enrich with justification
    return this.mergeResults(semanticResults, lexicalResults);
  }
}
```

### Phase 3 Implementation Summary (Completed)

Phase 3 has been implemented. Summary of changes:

| Step | File(s) | What was done |
|------|--------|----------------|
| **3.1** | `src/core/search/hybrid-service.ts` | Added `HybridSearchService` with `searchWithJustification(query, options)`. Step 1: optional business scoping via `getScopeFilesByContext(context)` querying `justification` joined with `function`, `class`, and `interface` to get file paths for that feature context. Step 2: semantic search using `embeddingService.embed(query)` and `graphStore.vectorSearch()`. Step 3: lexical search via `zoekt.search()` with optional `filePattern` built from scope files (regex-escaped). Step 4: `mergeAndEnrich()` resolves file IDs to paths, fetches justification snippets from `justification` table for semantic hits, merges semantic + lexical results, sorts by score, and returns up to `limit`. Types: `HybridSearchResult`, `HybridSearchOptions`, `HybridJustificationSnippet`, `HybridSearchSource`. |
| **3.2** | `src/core/search/index.ts` | Exported `HybridSearchService`, `HybridSearchResult`, `HybridSearchOptions`, `HybridSearchSource`, `HybridJustificationSnippet`. Re-exported from `src/core/index.ts` via existing `./search/index.js`. |
| **3.3** | `src/mcp/server.ts` | Created `HybridSearchService` in `startServer()` when both `embeddingService` and `zoektManager` are available (after Zoekt init). Passed as `hybridSearchService` in `McpServerOptions`. Added MCP tool `hybrid_search` with `query` (required), `businessContext`, `limit`; handler calls `searchWithJustification()` and returns `{ results }`. If hybrid service is unavailable, returns a clear error. Set `hybridSearchService = null` in `stopServer()`. |

**Notes:**

- **Scoping:** Business context uses the existing `justification` table; scope files are derived from entities (function/class/interface) whose justification has matching `feature_context`. Lexical search is then restricted to those files via a Zoekt file pattern (regex OR of escaped paths).
- **Scores:** Semantic results use score `1 / (1 + distance)`; lexical hits use score `1`. Results are merged and sorted by score descending.
- **Enrichment:** Justification snippets (`purposeSummary`, `featureContext`, `businessValue`) are loaded in batch from `justification` for semantic entity IDs and attached to `HybridSearchResult.justification`.
- **Graceful degradation:** The hybrid service is created only when both `embeddingService` and `zoektManager` are available. If either is missing, the service is not created and the `hybrid_search` tool returns an explanatory error asking the user to ensure embeddings and Zoekt are initialized.

---

## Verification Plan

### Phase 1 Verification
1. **Unit Test:** `EmbeddingService.embed()` returns 384-dim vector
2. **Integration Test:** After indexing, `entity_embedding` relation has rows
3. **E2E Test:** `vectorSearch("authentication logic")` returns relevant entities

### Phase 2 Verification
1. **Script Test:** `scripts/setup-zoekt.sh` completes on Mac/Linux
2. **Process Test:** `ZoektManager.start()` spawns process, `search()` returns results
3. **E2E Test:** `search_code_exact("processPayment")` finds exact matches

### Phase 3 Verification
1. **Hybrid Test:** Query "GDPR compliance" returns code files even without literal match
2. **Scoped Test:** Query with `businessContext: "Payments"` restricts to payment files

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1 (Embeddings) | 2-3 days | None |
| Phase 2 (Zoekt) | 2-3 days | None (parallel) |
| Phase 3 (Hybrid) | 1-2 days | Phase 1 + 2 |
| **Total** | **5-8 days** | |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Embedding model slows startup | Lazy load on first `embed()` call |
| Zoekt binary not available | Fallback to pure Graph search |
| HNSW index grows large | Periodic index compaction |
| Re-indexing Zoekt is slow | Debounce changes, incremental if supported |


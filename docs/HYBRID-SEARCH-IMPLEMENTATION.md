# Hybrid Search — Design Document

> How Code-Synapse combines semantic vector search, lexical text search, and LLM synthesis to deliver business-aware code intelligence.

## 1. Overview

Hybrid search merges two complementary search strategies into a single pipeline:

| Strategy | Engine | Answers the question |
|----------|--------|----------------------|
| **Semantic** | HuggingFace Embeddings + CozoDB HNSW | "What does this code *mean*?" |
| **Lexical** | Zoekt (Go binary) | "Where *exactly* is this code?" |

A query enters the `HybridSearchService`, runs through both engines in parallel, and exits as a merged, enriched, ranked result set. An optional third layer — **LLM Answer Synthesis** ("Deep Search") — can generate a natural-language answer grounded in the results with inline citations.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        HybridSearchService                          │
│                                                                      │
│  ┌────────────────┐   ┌──────────────────┐   ┌────────────────────┐  │
│  │ Lexical Search │   │ Semantic Search   │   │  LLM Synthesis     │  │
│  │ (Zoekt)        │   │ (Embeddings +    │   │  (RouterLLMService │  │
│  │ - Exact text   │   │  CozoDB HNSW)    │   │   via ModelRouter) │  │
│  │ - Regex        │   │ - Cosine sim.    │   │  - Answer gen      │  │
│  │ - File scoping │   │ - 384-dim vecs   │   │  - Citations       │  │
│  └───────┬────────┘   └────────┬─────────┘   └─────────┬──────────┘  │
│          │                     │                        │             │
│          └──────────┬──────────┘                        │             │
│                     ▼                                   │             │
│          ┌─────────────────────┐                        │             │
│          │ Merge & Enrich      │────────────────────────┘             │
│          │ (score, rank, add   │                                      │
│          │  justifications &   │                                      │
│          │  design patterns)   │                                      │
│          └─────────────────────┘                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Key files:**

| Component | File |
|-----------|------|
| Orchestrator | `src/core/search/hybrid-service.ts` |
| Zoekt Manager | `src/core/search/zoekt-manager.ts` |
| Embedding Service | `src/core/embeddings/index.ts` |
| Graph Store (HNSW) | `src/core/graph/cozo-graph-store.ts` |
| LLM Adapter | `src/core/llm/router-llm-service.ts` |
| REST API | `src/viewer/ui/server.ts` |
| Frontend | `src/viewer/ui/app/src/components/search/` |

---

## 3. Data Flow — Query Lifecycle

A query travels through four stages before reaching the user:

```
User Query
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│ Stage 1: Business Context Scoping (optional)             │
│   If businessContext provided → query justification table │
│   to find relevant file paths → scope lexical search     │
└──────────────────────┬───────────────────────────────────┘
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
┌──────────────────┐   ┌──────────────────┐
│ Stage 2: Semantic│   │ Stage 3: Lexical │
│ embed(query) →   │   │ zoekt.search()   │
│ HNSW kNN search  │   │ (optionally file │
│ (top 20)         │   │  scoped)         │
└────────┬─────────┘   └────────┬─────────┘
         │                      │
         └──────────┬───────────┘
                    ▼
┌───────────────────────────────────────────┐
│ Stage 4: Merge & Enrich                   │
│  - Resolve file_id → relative_path        │
│  - Fetch justification snippets (batch)   │
│  - Fetch design patterns (batch)          │
│  - Score and rank                         │
│  - Trim to limit                          │
└───────────────────────────────────────────┘
                    │
         ┌──────────┴──────────┐
         │ (if Deep Search)    │
         ▼                     ▼
┌──────────────────┐   ┌──────────────┐
│ LLM Synthesis    │   │ Return as-is │
│ buildPrompt() →  │   │              │
│ infer() →        │   │              │
│ AISummary +      │   │              │
│ citations        │   │              │
└──────────────────┘   └──────────────┘
```

### Stage-by-stage detail

**Stage 1 — Business Context Scoping** (`getScopeFilesByContext`)

When the caller supplies a `businessContext` string (e.g. "Payments"), a CozoScript query joins the `justification` table with `function`, `class`, and `interface` relations to find every file that participates in that feature context. The resulting file paths are passed to Zoekt as a regex file filter, narrowing lexical search to only the business-relevant subset.

```
justification{entity_id, feature_context} ─┬─ function{id, file_id} ─► file{id, relative_path}
                                            ├─ class{id, file_id}    ─► file{id, relative_path}
                                            └─ interface{id, file_id}─► file{id, relative_path}
```

**Stage 2 — Semantic Search** (`runSemanticSearch`)

1. The query string is embedded via `embeddingService.embed(query)` → 384-dimensional vector.
2. CozoDB's HNSW index (`entity_embedding:embedding_idx`) performs approximate nearest neighbor search with `ef=100`, returning up to `k` results with cosine distance.

**Stage 3 — Lexical Search** (`runLexicalSearch`)

Zoekt webserver receives a GET request: `/search?q=<query>&format=json&num=<limit>`. If file scoping is active, the `f` parameter contains a regex OR of file paths. Returns file matches with line-level granularity.

**Stage 4 — Merge & Enrich** (`mergeAndEnrich`)

1. **File path resolution** — semantic results carry `file_id`; a batch CozoScript query resolves these to `relative_path`.
2. **Justification enrichment** — entity IDs from semantic results are batch-queried against the `justification` relation to attach `purposeSummary`, `featureContext`, `businessValue`, and `confidence`.
3. **Design pattern enrichment** — entity IDs are queried via `has_pattern` → `design_pattern` to attach pattern names (e.g. "Factory", "Observer").
4. **Scoring** — Semantic results are scored as `1 / (1 + distance)`. Lexical hits receive a flat score of `1`.
5. **Sort & trim** — all results are sorted by score descending and trimmed to `limit` (default 30).

---

## 4. Embedding Pipeline

### 4.1 Indexing-time embedding generation

During file indexing, the extraction pipeline produces `EmbeddingChunk` objects — one per entity — containing the entity's representative text. The `IndexerCoordinator` passes these chunks to `embeddingService.embedBatch()`, which uses `@huggingface/transformers` (model: `Xenova/all-MiniLM-L6-v2`, ONNX runtime, 384 dimensions) to generate vectors locally.

Each embedding is stored alongside a SHA-256 `text_hash` for change detection: if an entity's text hasn't changed, re-embedding is skipped.

### 4.2 Storage — CozoDB `entity_embedding` relation

```
entity_embedding {
  entity_id: String,     ── key
  file_id: String        ── key (enables O(1) cleanup by file)
  =>
  vector: <F32; 384>,    ── embedding vector
  text_hash: String,     ── SHA-256 of source text
  model: String,         ── e.g. "Xenova/all-MiniLM-L6-v2"
  created_at: Int         ── timestamp
}

HNSW index: entity_embedding:embedding_idx
  dim: 384, m: 16, ef_construction: 200
```

**Write path:** Embeddings are written in a single batched `:put` operation per file. All writes to `entity_embedding` (both `:put` and `:rm`) are serialized through an async `Mutex` in `GraphWriter` to avoid RocksDB contention — other entity types (function, class, etc.) write to separate relations and remain fully concurrent.

**Cleanup:** When a file is re-indexed, `deleteFileEntities` removes all `entity_embedding` rows matching the `file_id` before writing new ones.

### 4.3 Query-time vector search

`CozoGraphStore.vectorSearch()` queries the HNSW index:

```cozoscript
?[entity_id, file_id, distance] :=
  q = vec($embedding),
  ~entity_embedding:embedding_idx{
    entity_id, file_id, vector |
    query: q, k: $k, ef: 100, bind_distance: distance
  }
 :order distance
 :limit $k
```

Returns `VectorSearchResult[]` with `{ id, fileId, distance, name }`. Falls back to the legacy `function_embedding` relation if `entity_embedding` is empty (backward compatibility).

---

## 5. Lexical Search — Zoekt

### 5.1 Binary management

`ZoektManager` manages two Zoekt binaries:

| Binary | Purpose |
|--------|---------|
| `zoekt-webserver` | HTTP server for search queries |
| `zoekt-git-index` | Git-aware indexing of repository files |

Binary resolution order: `binDir/` (data directory) → `$PATH`. If binaries are missing and Go is on `$PATH`, `ensureBinaries()` auto-installs them via `go install` with `GOBIN` set to `binDir` (120s timeout per binary).

### 5.2 Lifecycle

1. **Start** — Checks port availability (default 6070), creates index directory, spawns `zoekt-webserver` as a child process, waits for `/healthz` with exponential backoff (100ms → 500ms, 5s timeout).
2. **Reindex** — Runs `zoekt-git-index -index <indexDir> <repoRoot>` as a subprocess. Triggered on file changes, debounced at 30 seconds to avoid thrashing during large change sets (e.g. `npm install`).
3. **Stop** — Sends `SIGTERM` to the webserver process.

### 5.3 Search API

```
GET http://127.0.0.1:6070/search?q=<query>&format=json&num=<limit>[&f=<filePattern>]
```

The response is parsed from Zoekt's JSON format into `ZoektFileMatch[]`, each containing `fileName`, `repository`, and `lineMatches[]` with `lineNumber`, `line`, and `matchRanges`.

### 5.4 Graceful degradation

If Zoekt fails to start (binaries missing, port conflict) or the search request fails, the hybrid service continues with semantic-only results. The MCP tool `search_code_exact` returns an explanatory message directing the user to install Zoekt.

---

## 6. Hybrid Merge & Enrichment

The merge step (`mergeAndEnrich`) combines results from both engines into a single ranked list:

### 6.1 Scoring

| Source | Score formula | Rationale |
|--------|---------------|-----------|
| Semantic | `1 / (1 + cosine_distance)` | Normalizes to 0–1; closer vectors = higher score |
| Lexical | `1.0` (flat) | Zoekt returns exact matches; all are equally "matching" |

### 6.2 Enrichment queries

Two batch CozoScript queries run in parallel via `Promise.all`:

1. **Justification snippets** — Fetches `purpose_summary`, `feature_context`, `business_value`, `confidence_score` from the `justification` relation for all semantic entity IDs.
2. **Design patterns** — Fetches pattern types by joining `has_pattern` → `design_pattern` for all semantic entity IDs.

These are attached to each `HybridSearchResult` object before returning.

### 6.3 Result structure

```typescript
interface HybridSearchResult {
  source: "semantic" | "lexical";
  score: number;                     // 0–1
  filePath: string;
  entityId?: string;                 // semantic only
  name?: string;                     // semantic only
  snippet?: string;                  // lexical line content
  lineNumber?: number;               // lexical line number
  justification?: {
    purposeSummary?: string;
    featureContext?: string;
    businessValue?: string;
    confidence?: number;             // 0–1
  };
  patterns?: string[];               // e.g. ["Factory", "Observer"]
}
```

---

## 7. LLM Answer Synthesis (Deep Search)

When `enableSynthesis` is true and the query is classified as a question (starts with who/what/where/why/how/etc. or ends with `?`), the service invokes `synthesizeAnswer()`.

### 7.1 Prompt construction

The top 5 results are formatted into a structured prompt:

```
[Citation 1] File: src/auth/service.ts:42
Feature Context: Authentication & Security
Business Value: Revenue Critical (Confidence: 95%)
Design Patterns: Observer, Factory
Code Snippet:
\`\`\`
async login(credentials) { ... }
\`\`\`

[Citation 2] File: ...
```

The prompt instructs the LLM to:
1. Provide a concise answer in Markdown.
2. Reference code snippets using `[1]`, `[2]` notation.
3. Mention business purpose when relevant.
4. Acknowledge gaps if the snippets don't fully answer.

### 7.2 LLM execution

The `RouterLLMService` wraps `IModelRouter`, which routes to the configured provider:

| Provider | Engine | Privacy |
|----------|--------|---------|
| `local` (default) | node-llama-cpp (Qwen 2.5 Coder) | Code never leaves the machine |
| `openai` | OpenAI API | Requires API key |
| `anthropic` | Anthropic API | Requires API key |
| `google` | Google AI API | Requires API key |

### 7.3 Response

```typescript
interface AISummary {
  answer: string;        // Markdown with [1], [2] citation references
  citations: Citation[]; // { index, filePath, lineNumber, snippet, justification }
  modelUsed: string;
  timestamp: string;
}
```

### 7.4 Graceful degradation

If the LLM is not configured, not initialized, or inference fails, `searchWithSynthesis` catches the error and returns `{ summary: null, results, meta }` — the caller always gets search results even when synthesis fails.

---

## 8. Business Context Scoping

The `businessContext` parameter enables callers to narrow results to a specific feature area. This leverages the justification data produced during indexing.

**Flow:**
1. Caller passes `businessContext: "Payments"`.
2. `getScopeFilesByContext("Payments")` queries the `justification` table for entities where `feature_context = "Payments"`.
3. Joins through `function`, `class`, and `interface` relations to `file` to get `relative_path`.
4. Unique file paths become a Zoekt file regex filter: `(src/payments/service\.ts|src/payments/handler\.ts)`.
5. Lexical search is restricted to those files. Semantic search is not scoped (it naturally favors relevant embeddings).

---

## 9. Frontend — Chat UI

The web viewer (`http://localhost:3101`) presents hybrid search as a conversational chat interface.

### 9.1 Component hierarchy

```
SearchView (main container)
├── WelcomeScreen (empty state with example queries)
├── UserMessage (user query bubble)
├── AssistantMessage
│   ├── SmartSummary (LLM answer with typewriter effect)
│   │   └── Interactive [1] citations → scroll to card
│   └── Grouped JustificationCards
│       └── JustificationCard (single result)
│           ├── Confidence badge (shield icon, color-coded)
│           ├── Confidence bar (pulse animation >90%)
│           ├── Design pattern badges
│           └── Code snippet
└── Input bar (query input + Deep Search toggle + submit)
```

### 9.2 State management (Zustand)

The `useSearchStore` manages:
- `chatHistory: ChatTurn[]` — conversation turns, each with query + results + summary.
- `enableDeepSearch: boolean` — toggles LLM synthesis.
- `addChatTurn()`, `updateLastTurn()`, `clearChat()` — immutable updates.

A `ChatTurn` represents one query-response pair:

```typescript
interface ChatTurn {
  id: string;
  query: string;
  results: HybridSearchResult[];
  summary: HybridSearchSummary | null;
  timestamp: number;
  isLoading: boolean;
  error?: string;
}
```

### 9.3 API client

`searchHybrid(query, options)` sends `POST /api/search/hybrid` with JSON body `{ query, enableSynthesis, limit, businessContext }`. Returns `HybridSearchResponse`.

### 9.4 Result grouping

Results are grouped by `justification.featureContext` when present, falling back to the parent directory path. Each group renders as a labeled section with its cards.

### 9.5 UI details

| Feature | Implementation |
|---------|---------------|
| **Typewriter effect** | `SmartSummary` reveals text incrementally (2 chars/tick, 30ms interval) |
| **Interactive citations** | `[N]` in the LLM answer are parsed via regex and rendered as buttons that scroll to `#search-result-{N-1}` |
| **Glassmorphism** | High-confidence cards use `bg-white/10 backdrop-blur-md` |
| **Confidence visualization** | Shield icon (green/yellow/orange), progress bar, pulse animation when >90% |
| **Loading state** | Animated bouncing dots with "Analyzing codebase..." text |

---

## 10. API Contract

### Endpoint

```
POST /api/search/hybrid
Content-Type: application/json
```

### Request body

```json
{
  "query": "How does authentication work?",
  "businessContext": "Authentication",
  "limit": 30,
  "enableSynthesis": true
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | `string` | (required) | Search query |
| `businessContext` | `string?` | — | Feature context to scope results |
| `limit` | `number?` | `30` | Max results |
| `enableSynthesis` | `boolean?` | `false` | Enable LLM answer generation |

### Response — `HybridSearchResponse`

```json
{
  "summary": {
    "answer": "Authentication is handled by [1] AuthService.login() which...",
    "citations": [
      {
        "index": 1,
        "filePath": "src/auth/service.ts",
        "lineNumber": 42,
        "snippet": "async login(creds) { ... }",
        "justification": "Validates user credentials"
      }
    ],
    "modelUsed": "Code-Synapse AI",
    "timestamp": "2026-01-15T10:30:00.000Z"
  },
  "results": [
    {
      "source": "semantic",
      "score": 0.87,
      "filePath": "src/auth/service.ts",
      "entityId": "fn:auth-service:login",
      "name": "login",
      "justification": {
        "purposeSummary": "Validates user credentials",
        "featureContext": "Authentication & Security",
        "businessValue": "Revenue Critical",
        "confidence": 0.95
      },
      "patterns": ["Observer"]
    },
    {
      "source": "lexical",
      "score": 1.0,
      "filePath": "src/auth/middleware.ts",
      "snippet": "const token = req.headers.authorization;",
      "lineNumber": 15
    }
  ],
  "meta": {
    "processingTimeMs": 342,
    "semanticCount": 12,
    "lexicalCount": 8,
    "queryType": "question",
    "sources": ["semantic", "lexical"]
  }
}
```

When `enableSynthesis` is `false` or the query is not a question, `summary` is `null`.

When hybrid search is unavailable (embeddings or Zoekt not initialized), the endpoint returns `503` with:

```json
{
  "error": "Hybrid search not available",
  "hint": "Hybrid search requires embeddings and Zoekt. Run 'code-synapse' (full pipeline) to enable."
}
```

---

## 11. MCP Tool

The `hybrid_search` MCP tool exposes the same capability to AI agents:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | yes | Search query |
| `businessContext` | `string` | no | Feature context scope |
| `limit` | `number` | no | Max results (default 30) |
| `enableSynthesis` | `boolean` | no | Enable LLM answer (default false) |

The handler delegates to `HybridSearchService.searchWithSynthesis()` or `searchWithJustification()` depending on the synthesis flag.

---

## 12. Implementation Roadmap for Realistic Quality

To ensure search results are not just "technically correct" but **realistically useful** to developers, the following refinement tasks must be implemented:

### Phase 1: Ranking & Relevance (The "Smart Merge")
- [x] **Implement Reciprocal Rank Fusion (RRF)**
    - *Problem:* Naive scoring (`1/(1+dist)` vs `1.0`) biases heavily towards one engine depending on the query.
    - *Solution:* Use RRF formula: `score = 1 / (k + rank_semantic) + 1 / (k + rank_lexical)`. This normalizes the influence of both engines without arbitrary weighting.
    - *Implementation:* `fuseResults()` in `hybrid-service.ts` — intent-tuned k constants via `INTENT_CONFIGS`, file-level fusion with score normalization to 0–1.
- [x] **Heuristic Boosting**
    - Boost exact filename matches (if query matches `src/auth/login.ts`, that file should be #1).
    - Boost definitions over usages (class `Auth` > `import Auth`).
    - Boost "popular" entities (high degree centrality in the graph).
    - *Implementation:* `applyBoosts()` — filename match (1.5x), definition boost (1.1x), popularity boost via `getIncomingCallCounts()`.

### Phase 2: Query Understanding
- [x] **Query Expansion (LLM-based)**
    - *Problem:* User searches for "login" but code uses "authenticate" or "signin".
    - *Solution:* Before searching, do a fast LLM pass to generate 2-3 synonyms/related terms.
    - *Prompt:* "User searching for `{query}`. generate 3 technical synonyms or related class names present in a typical codebase."
    - *Implementation:* `expandQuery()` — opt-in via `enableQueryExpansion` option, deduplicates via `mergeSemanticResults()`.
- [x] **Intent Classification**
    - Detect if user wants a *definition* ("where is X defined?"), a *usage* ("who calls X?"), or *conceptual answer* ("how does X work?").
    - Tune `cozo` vs `zoekt` weight based on intent.
    - *Implementation:* `classifyIntent()` — regex-based, 4 intents (definition, usage, conceptual, keyword), drives RRF k-constants.

### Phase 3: Result Presentation
- [x] **Intelligent Snippet Selection**
    - *Problem:* Semantic search returns a whole 50-line function. Zoekt returns a single line.
    - *Solution:* For semantic results, fetch entity signatures/declarations from function, class, and interface relations. Show signature as snippet with line number.
    - *Implementation:* `getEntitySnippets()` — parallel queries for function signatures, class declarations, interface names.
- [x] **Deduplication & Grouping**
    - Collapse multiple matches from the same file into a single result via file-level RRF fusion.
    - Lexical snippet preferred over semantic when both available; source determined by best-ranked engine.
    - *Implementation:* `fuseResults()` deduplicates by filePath; `fusedToHybridResult()` picks best snippet and source.

### Phase 4: Verification Loop
- [x] **Relevance Evaluation Set**
    - Create a `golden_queries.json` with 20 input queries and "expected" top 3 files.
    - Run an automated script to measure *Mean Reciprocal Rank (MRR)* after every unified search logic change.
    - *Implementation:* `src/core/search/__tests__/evaluation/golden-queries.json` + `evaluate-mrr.ts` (skipped by default, requires pre-indexed codebase).

## 13. Experience Enhancements (The "Wow" Factor)

To deliver a premium search experience, the following "wow" factors have been implemented:

### 13.1 Business Value Visualization
Results now surface the *Business Value* (e.g., "Revenue Critical", "Core Infrastructure") directly in the search card. This helps developers immediately identify high-impact code.

### 13.2 Popularity Metrics
A "Popularity" indicator (flame icon) shows how many other files reference a given entity. This highlights the architectural importance of a result—highly reused components bubble up visually.

### 13.3 "Used By" Relationships
Each result now includes a "Used By" section, listing the top 3 callers. This allows developers to instantly navigate to usage examples, answering "how do I use this?" without a separate search step.

### 13.4 Visual Polish
- **Glassmorphism**: High-confidence results feature a frosted glass effect ().
- **Interactive Badges**: Justification and pattern badges provide quick context at a glance.

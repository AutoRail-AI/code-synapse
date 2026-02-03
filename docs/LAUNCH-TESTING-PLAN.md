# Code-Synapse Launch Testing Plan (Vertical Slices)

A **vertical-sliced** testing plan to verify each major component end-to-end before launch. Each slice is self-contained: you can run and validate one slice at a time, then move to the next.

**Principles:**
- **One slice at a time** — finish and sign off each slice before moving on.
- **Vertical** — each slice tests a full user/feature path (CLI → core → storage/API), not just a single layer.
- **Traceable** — each slice maps to docs, scripts, and acceptance criteria you can check off.

---

## Table of Contents

1. [Overview & Slice Order](#overview--slice-order)
2. [Slice 1: CLI & Options](#slice-1-cli--options)
3. [Slice 2: Indexing](#slice-2-indexing)
4. [Slice 3: AST / Parser](#slice-3-ast--parser)
5. [Slice 4: Justification](#slice-4-justification)
6. [Slice 5: UI & Viewer API](#slice-5-ui--viewer-api)
7. [Slice 6: Code Query (Search & NL)](#slice-6-code-query-search--nl)
8. [Slice 7: MCP Server](#slice-7-mcp-server)
9. [Slice 8: Prompt Enhancement](#slice-8-prompt-enhancement)
10. [Slice 9: Skills](#slice-9-skills)
11. [Slice 10: Ledger & Storage](#slice-10-ledger--storage)
12. [Slice 11: Graph Store & Migrations](#slice-11-graph-store--migrations)
13. [Slice 12: Model Router & Providers](#slice-12-model-router--providers)
14. [Checklist Summary](#checklist-summary)

---

## Overview & Slice Order

Recommended order (dependencies flow left → right):

| Order | Slice | Depends On | E2E Script Section |
|-------|--------|------------|--------------------|
| 1 | CLI & Options | — | 1 |
| 2 | Indexing | CLI, init | 2, 3 |
| 3 | AST / Parser | — (unit/integration) | — |
| 4 | Justification | Indexing | 8 |
| 5 | UI & Viewer API | Indexing | 7 |
| 6 | Code Query | Indexing, UI | 7 (partial) |
| 7 | MCP Server | Indexing | — |
| 8 | Prompt Enhancement | Justification, Classification | — |
| 9 | Skills | MCP, config | — |
| 10 | Ledger & Storage | Indexing, Graph | — |
| 11 | Graph Store & Migrations | — | — |
| 12 | Model Router & Providers | Config | 5, 6 |

**Quick reference:** Run full E2E by section: `./scripts/e2e-test.sh --section N`. Run all: `./scripts/e2e-test.sh`. Quick (no LLM): `./scripts/e2e-test.sh --quick`.

---

## Slice 1: CLI & Options

**Goal:** Every CLI command and option is discoverable, documented, and exits correctly.

**Scope:** `src/cli/` (main, commands: init, start, index, status, config, viewer, justify, default).

### Acceptance Criteria

- [ ] `code-synapse --help` shows usage and all commands.
- [ ] `code-synapse --version` (or version in help) works.
- [ ] Each subcommand has `--help` and shows its options.
- [ ] Default command (no subcommand) runs with options: `--port`, `--viewer-port`, `--debug`, `--skip-index`, `--skip-viewer`, `--skip-justify`, `--justify-only`, `--model`.
- [ ] Invalid or missing required args produce clear errors and non-zero exit.

### Test Steps

1. **Automated (E2E Section 1)**  
   `./scripts/e2e-test.sh --section 1`

2. **Manual**  
   - Run `code-synapse`, `code-synapse init --help`, `code-synapse index --help`, `code-synapse status --help`, `code-synapse config --help`, `code-synapse viewer --help`, `code-synapse start --help`, `code-synapse justify --help`.  
   - Run default with flags: e.g. `code-synapse --skip-index --skip-viewer` and confirm it exits without starting index/viewer.

### Sign-off

- [ ] All acceptance criteria met.  
- [ ] E2E Section 1 passes.

---

## Slice 2: Indexing

**Goal:** Full and incremental indexing (scan → parse → extract → write) work and produce correct graph data.

**Scope:** `src/core/indexer/`, `src/core/extraction/`, `src/core/graph-builder/`, scanner, parser, pipeline, coordinator, graph writer.

### Acceptance Criteria

- [ ] `code-synapse init` then `code-synapse index` completes without error.
- [ ] Results show files indexed, entities written, relationships written, phase timings.
- [ ] `code-synapse index --force` re-indexes everything.
- [ ] `code-synapse status` shows Files, Functions, Classes, Interfaces (and optional verbose stats).
- [ ] Incremental run: add a new file, run `index` again; new file is indexed. Delete file, run `index`; graph reflects removal.
- [ ] No crash on empty project or single-file project.

### Test Steps

1. **Automated (E2E Sections 2, 3, 4, 9)**  
   `./scripts/e2e-test.sh --section 2`  
   `./scripts/e2e-test.sh --section 3`  
   `./scripts/e2e-test.sh --section 4`  
   `./scripts/e2e-test.sh --section 9`

2. **Unit/Integration**  
   - `src/core/indexer/__tests__/coordinator.test.ts`  
   - `src/core/indexer/__tests__/watcher.test.ts`  
   - `src/core/graph-builder/__tests__/graph-writer.test.ts`  
   - `src/core/graph-builder/__tests__/incremental-updater.test.ts`  
   - `src/core/__tests__/indexing-pipeline.integration.test.ts`

3. **Manual**  
   - Init in a real repo, run `index`, then `status --verbose`. Inspect entity/relationship counts.  
   - Run `index --force` and confirm duration/stats.  
   - Add/remove a file and run `index` again; confirm status changes.

### Sign-off

- [ ] All acceptance criteria met.  
- [ ] E2E Sections 2, 3, 4, 9 pass.  
- [ ] Indexing unit/integration tests pass.

---

## Slice 3: AST / Parser

**Goal:** Parser produces correct AST for TypeScript/JavaScript; extraction pipeline yields expected entities and relationships.

**Scope:** `src/core/parser/`, `src/core/extraction/`, AST types, multi-language support if applicable.

### Acceptance Criteria

- [ ] Parsing a `.ts`/`.tsx`/`.js` file returns a valid AST (no throw).
- [ ] Extracted entities: functions, classes, interfaces, variables, file node — match source (names, locations).
- [ ] Relationships: CONTAINS, CALLS, IMPORTS, EXTENDS, IMPLEMENTS, HAS_METHOD, USES_TYPE, REFERENCES_EXTERNAL — present where expected.
- [ ] Multi-language parser manager (if used) selects correct parser by extension.

### Test Steps

1. **Unit/Integration**  
   - `src/core/parser/__tests__/multi-language.test.ts`  
   - `src/core/interfaces/__tests__/IParser.contract.test.ts`  
   - Extraction tests that feed known source into parser + pipeline and assert entities/relations.

2. **Manual**  
   - Run index on a small file with known structure; use viewer or debug to inspect graph for that file and confirm entities/relationships.

### Sign-off

- [ ] All acceptance criteria met.  
- [ ] Parser and extraction tests pass.

---

## Slice 4: Justification

**Goal:** Business justification (and optional LLM) runs without error and stores/retrieves justification data.

**Scope:** `src/core/justification/`, `src/cli/commands/justify.ts`, justification storage, hierarchy, prompts.

### Acceptance Criteria

- [ ] `code-synapse justify --stats` shows Total entities and related stats.
- [ ] `code-synapse justify --skip-llm` completes and produces justifications (e.g. code-pattern defaults).
- [ ] With LLM enabled: `code-synapse justify` (or default with justify step) completes; justifications are stored and readable.
- [ ] No crash when LLM is unavailable (graceful fallback or clear message).

### Test Steps

1. **Automated (E2E Section 8)**  
   `./scripts/e2e-test.sh --section 8`  
   Or quick: `./scripts/e2e-test.sh --quick` (skips LLM justification).

2. **Unit/Integration**  
   - `src/core/justification/__tests__/justification.test.ts`

3. **Manual**  
   - After index: `justify --skip-llm` then `justify --stats`.  
   - If LLM configured: run full justify and check viewer/API for justification data.

### Sign-off

- [ ] All acceptance criteria met.  
- [ ] E2E Section 8 (or quick path) and justification tests pass.

---

## Slice 5: UI & Viewer API

**Goal:** Web viewer starts and serves all documented API endpoints; UI loads and shows overview/data.

**Scope:** `src/viewer/`, `src/viewer/ui/` (server, app, API client).

### Acceptance Criteria

- [ ] `code-synapse viewer -p <port>` starts; `/api/health` returns healthy.
- [ ] Endpoints respond with expected shape: `/api/stats/overview`, `/api/stats/languages`, `/api/stats/complexity`, `/api/files`, `/api/functions`, `/api/classes`, `/api/interfaces`, `/api/search?q=...`.
- [ ] UI loads (Explorer, Graph, Search, Knowledge, Observability, Operations views if applicable).
- [ ] `viewer --json` (if supported) outputs stats as JSON and exits.

### Test Steps

1. **Automated (E2E Section 7)**  
   `./scripts/e2e-test.sh --section 7`

2. **Manual**  
   - Start viewer, open browser, click through main views.  
   - Call key API endpoints with curl/Postman and assert status and JSON shape.

### Sign-off

- [ ] All acceptance criteria met.  
- [ ] E2E Section 7 passes.

---

## Slice 6: Code Query (Search & NL)

**Goal:** Keyword search, NL search patterns, and code query features return correct results from the graph.

**Scope:** `src/viewer/impl/`, `src/viewer/nl-search/`, viewer API search and nl-search routes.

### Acceptance Criteria

- [ ] `/api/search?q=<term>` returns entities matching the term (name, path, signature, etc.).
- [ ] `/api/nl-search/patterns` returns list of NL patterns.
- [ ] `/api/nl-search?q=<nl query>` returns results for queries like "most complex functions", "where is X", etc.
- [ ] UI Search and NL search panels return and display results.

### Test Steps

1. **Automated**  
   - E2E Section 7 covers basic search and nl-search endpoints.

2. **Unit**  
   - `src/viewer/__tests__/query-builder.test.ts`  
   - `src/viewer/__tests__/intent-classifier.test.ts`  
   - `src/viewer/__tests__/viewer.integration.test.ts`

3. **Manual**  
   - After indexing a known project: run NL queries and verify result quality and relevance.

### Sign-off

- [ ] All acceptance criteria met.  
- [ ] Viewer integration and query tests pass.

---

## Slice 7: MCP Server

**Goal:** MCP server starts, exposes tools and resources, and responds correctly to tool calls.

**Scope:** `src/mcp/server.ts`, `src/mcp/tools.ts`, `src/mcp/resources.ts`, `src/mcp/observer.ts`, `src/mcp/vibe-coding.ts`.

### Acceptance Criteria

- [ ] `code-synapse start -p <port>` (or default) starts MCP server; client can connect.
- [ ] Tools: search_code, get_function, get_class, get_file_symbols, get_callers, get_callees, get_dependencies (and any others) return valid responses for indexed data.
- [ ] Resources (if exposed) are listable and readable.
- [ ] File watcher / observer: changing a file triggers re-index or update as designed; no crash.

### Test Steps

1. **Integration**  
   - `src/core/__tests__/mcp-server.integration.test.ts`  
   - `src/mcp/__tests__/tools.test.ts`  
   - `src/mcp/__tests__/observer.test.ts`

2. **Manual**  
   - Connect an MCP client (e.g. Claude Code, Cursor) to the server; invoke each tool with known inputs and check responses.  
   - Edit a file and confirm index/observer behavior.

### Sign-off

- [ ] All acceptance criteria met.  
- [ ] MCP and observer tests pass.

---

## Slice 8: Prompt Enhancement

**Goal:** Justification and classification prompts produce consistent, parseable output; quality is acceptable.

**Scope:** `src/core/justification/prompts/`, classification prompts in `LLMClassificationEngine`, any other prompt modules.

### Acceptance Criteria

- [ ] Justification prompts (single + batch) produce JSON that parses and matches expected schema.
- [ ] Classification prompt produces category/area/confidence; schema validation passes.
- [ ] Prompt changes don’t break existing tests; optional: add snapshot or golden tests for key prompts.

### Test Steps

1. **Unit/Integration**  
   - Justification tests that call LLM or mocked infer and assert parsed structure.  
   - Classification tests that assert output shape and schema.

2. **Manual**  
   - Run justification and classification on a fixed set of entities; review output quality and consistency.

### Sign-off

- [ ] All acceptance criteria met.  
- [ ] No regressions in justification/classification tests.

---

## Slice 9: Skills

**Goal:** Skill packs (Claude Code, Cursor, etc.) are valid and load correctly; MCP config and instructions work.

**Scope:** `skills/claude-code/`, `skills/cursor/`, `skills/README.md`, MCP configs and vibe-coding / rules.

### Acceptance Criteria

- [ ] Each skill directory has valid `mcp-config.json` (or equivalent) and instructions (e.g. `vibe-coding.md`, `cursor-rules.txt`).
- [ ] Documentation (e.g. `skills/README.md`) describes how to use each skill.
- [ ] When an IDE uses the skill, it can connect to Code-Synapse MCP and use tools (covered by Slice 7).

### Test Steps

1. **Manual**  
   - Validate JSON in each skill config.  
   - Follow README to attach skill to Claude Code / Cursor and run a few tool calls.

### Sign-off

- [ ] All acceptance criteria met.  
- [ ] At least one skill verified with real IDE.

---

## Slice 10: Ledger & Storage

**Goal:** Change ledger records updates correctly; compaction (if enabled) runs without error and preserves consistency.

**Scope:** `src/core/ledger/`, graph schema for ledger tables, reconciliation if it consumes ledger.

### Acceptance Criteria

- [ ] After indexing (or file change), ledger contains expected events/entries for the updated files.
- [ ] Compaction (if run) completes; ledger size or retention matches design; no data loss for active files.
- [ ] Reconciliation (if used) reads ledger and behaves correctly.

### Test Steps

1. **Unit/Integration**  
   - `src/core/ledger/__tests__/compaction.test.ts`  
   - `src/core/reconciliation/__tests__/reconciliation.test.ts`

2. **Manual**  
   - Index project, inspect ledger store (e.g. Cozo relations). Run compaction if available; re-check state.

### Sign-off

- [ ] All acceptance criteria met.  
- [ ] Ledger and reconciliation tests pass.

---

## Slice 11: Graph Store & Migrations

**Goal:** Cozo DB initializes; all migrations run in order; schema matches code expectations.

**Scope:** `src/core/graph/`, migrations in `src/core/graph/migrations/`, schema definitions.

### Acceptance Criteria

- [ ] New project: first run creates DB and runs all migrations successfully.
- [ ] Existing project: startup runs any pending migrations without error.
- [ ] Queries used by indexer, viewer, justification, ledger use existing relations and don’t throw schema errors.

### Test Steps

1. **Unit/Integration**  
   - `src/core/interfaces/__tests__/IGraphStore.contract.test.ts`  
   - `src/core/__tests__/integration.smoke.test.ts`  
   - Any migration runner tests.

2. **Manual**  
   - Delete `.code-synapse/data` (or equivalent), run init + index; confirm no migration errors.  
   - Run full E2E to exercise all graph usage paths.

### Sign-off

- [ ] All acceptance criteria met.  
- [ ] Graph and migration tests pass.

---

## Slice 12: Model Router & Providers

**Goal:** Config commands work; model list and selection are correct; router and providers don’t crash when used.

**Scope:** `src/core/models/`, `src/cli/commands/config.ts`, provider implementations (local, OpenAI, etc.).

### Acceptance Criteria

- [ ] `code-synapse config --list-models` shows expected presets and providers (local, OpenAI, Anthropic, Google).
- [ ] `config --provider`, `--model`, `--api-key` (or equivalent) update config and are persisted.
- [ ] Justification/classification using router (or direct provider) complete when model is available; graceful failure when not.

### Test Steps

1. **Automated (E2E Sections 5, 6)**  
   `./scripts/e2e-test.sh --section 5`  
   `./scripts/e2e-test.sh --section 6`

2. **Manual**  
   - Set provider/model, run justify; confirm correct model is used (log or behavior).  
   - Disable/remove model and confirm clear error or fallback.

### Sign-off

- [ ] All acceptance criteria met.  
- [ ] E2E Sections 5 and 6 pass.

---

## Checklist Summary

Use this for a final pass before launch:

| # | Slice | E2E Section | Unit/Integration | Sign-off |
|---|--------|-------------|------------------|----------|
| 1 | CLI & Options | 1 | — | ☐ |
| 2 | Indexing | 2, 3, 4, 9 | coordinator, watcher, graph-writer, incremental, pipeline | ☐ |
| 3 | AST / Parser | — | parser, IParser, extraction | ☐ |
| 4 | Justification | 8 | justification | ☐ |
| 5 | UI & Viewer API | 7 | viewer integration | ☐ |
| 6 | Code Query | 7 | query-builder, intent-classifier, viewer | ☐ |
| 7 | MCP Server | — | mcp-server, tools, observer | ☐ |
| 8 | Prompt Enhancement | — | justification/classification with prompts | ☐ |
| 9 | Skills | — | Manual | ☐ |
| 10 | Ledger & Storage | — | ledger, reconciliation | ☐ |
| 11 | Graph Store & Migrations | — | IGraphStore, migrations | ☐ |
| 12 | Model Router & Providers | 5, 6 | — | ☐ |

**Full E2E:** `./scripts/e2e-test.sh`  
**Unit/Integration:** `pnpm test` (or project test command)

---

## Document Info

- **Location:** `docs/LAUNCH-TESTING-PLAN.md`
- **E2E script:** `scripts/e2e-test.sh` (see `--section`, `--quick`, `--help`)
- **Related:** `docs/ARCHITECTURE.md` (Testing & Verification), `docs/BUSINESS-AWARE-TESTING.md`

Update this plan when adding new vertical slices or changing component boundaries.

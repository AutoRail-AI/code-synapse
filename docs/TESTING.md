# Code-Synapse Testing Guide

This document describes the testing strategy, test scenarios, and procedures for validating Code-Synapse functionality.

---

## Table of Contents

1. [Overview](#overview)
2. [Test Types](#test-types)
3. [E2E Test Script](#e2e-test-script)
4. [Test Scenarios by Section](#test-scenarios-by-section)
5. [Manual Testing Procedures](#manual-testing-procedures)
6. [API Endpoint Testing](#api-endpoint-testing)
7. [Performance Testing](#performance-testing)
8. [Troubleshooting Test Failures](#troubleshooting-test-failures)

---

## Overview

Code-Synapse testing is organized into three tiers:

| Tier | Type | Location | Purpose |
|------|------|----------|---------|
| **Unit Tests** | Vitest | `src/**/__tests__/*.test.ts` | Test individual modules in isolation |
| **Integration Tests** | Vitest | `src/**/__tests__/*.integration.test.ts` | Test module interactions |
| **E2E Tests** | Shell Script | `scripts/e2e-test.sh` | Test CLI commands and full workflows |

### Current Test Coverage

- **Unit Tests**: 381+ tests across 10 test files
- **E2E Tests**: 73+ scenarios across 10 sections

---

## Test Types

### Unit Tests (Vitest)

Run with:
```bash
pnpm test              # Watch mode
pnpm test:ci           # Single run (excludes integration tests)
```

Key test files:
- `src/core/justification/__tests__/justification.test.ts` - Justification service
- `src/core/memory/__tests__/memory.test.ts` - Developer memory
- `src/core/reconciliation/__tests__/reconciliation.test.ts` - Ledger reconciliation
- `src/core/ledger/__tests__/compaction.test.ts` - Ledger compaction
- `src/viewer/__tests__/query-builder.test.ts` - NL Search query building
- `src/viewer/__tests__/intent-classifier.test.ts` - NL Search intent classification
- `src/core/parser/__tests__/multi-language.test.ts` - Multi-language parsing

### E2E Tests (Shell Script)

Run with:
```bash
./scripts/e2e-test.sh              # Run all tests
./scripts/e2e-test.sh --quick      # Skip LLM tests (faster)
./scripts/e2e-test.sh --section 7  # Run specific section
./scripts/e2e-test.sh --verbose    # Show detailed output
```

---

## E2E Test Script

### Usage

```bash
# Full test suite
./scripts/e2e-test.sh

# Quick mode (skips LLM-dependent tests)
./scripts/e2e-test.sh --quick

# Run specific section
./scripts/e2e-test.sh --section 1   # CLI Help
./scripts/e2e-test.sh --section 2   # Initialization
./scripts/e2e-test.sh --section 3   # Indexing
./scripts/e2e-test.sh --section 7   # Web Viewer API

# Verbose output for debugging
./scripts/e2e-test.sh --verbose
```

### Test Directory Structure

The E2E tests create temporary test projects in `/tmp/code-synapse-e2e-test-<pid>/`:

```
/tmp/code-synapse-e2e-test-12345/
├── init-test/                 # For initialization tests
│   ├── package.json
│   ├── tsconfig.json
│   ├── .gitignore
│   ├── src/
│   │   ├── index.ts
│   │   ├── user-service.ts
│   │   ├── auth-service.ts
│   │   └── utils.ts
│   └── .code-synapse/         # Created by init
│
├── index-test/                # For indexing tests
│   └── ...
│
└── uninit-test/               # For error handling tests
```

---

## Test Scenarios by Section

### Section 1: CLI Help and Version

Tests that all CLI commands display help information correctly.

| Test | Description | Expected |
|------|-------------|----------|
| `CLI --help shows usage` | Main help displays | Exit 0 |
| `CLI --help shows commands` | Lists all commands | Contains "Commands:" |
| `init --help works` | Init command help | Exit 0 |
| `index --help works` | Index command help | Exit 0 |
| `status --help works` | Status command help | Exit 0 |
| `config --help works` | Config command help | Exit 0 |
| `viewer --help works` | Viewer command help | Exit 0 |
| `start --help works` | Start command help | Exit 0 |

### Section 2: Project Initialization

Tests project initialization workflow.

| Test | Description | Expected |
|------|-------------|----------|
| `init command succeeds` | Basic initialization | Exit 0 |
| `.code-synapse directory created` | Directory structure | Exists |
| `config.json created` | Configuration file | Exists |
| `data directory created` | Database directory | Exists |
| `config has project name` | Config content | Name matches |
| `init without --force shows message` | Shows already initialized | Contains message |
| `init --force succeeds` | Forces reinit | Exit 0 |
| `init --skip-llm succeeds` | Skip LLM config | Exit 0 |
| `init --model fastest succeeds` | Model preset | Exit 0 |

### Section 3: Indexing

Tests code indexing functionality.

| Test | Description | Expected |
|------|-------------|----------|
| `index command succeeds` | Basic indexing | Exit 0 |
| `index reports files` | Shows progress | Contains "Files indexed" |
| `status shows indexed files` | DB populated | Contains "Files:" |
| `status shows functions` | Entities extracted | Contains "Functions:" |
| `index --force succeeds` | Full re-index | Exit 0 |

### Section 4: Status Command

Tests project status display.

| Test | Description | Expected |
|------|-------------|----------|
| `status command succeeds` | Basic status | Exit 0 |
| `status shows project name` | Project info | Contains name |
| `status shows Files` | File count | Contains "Files:" |
| `status shows Functions` | Function count | Contains "Functions:" |
| `status shows Classes` | Class count | Contains "Classes:" |
| `status shows Interfaces` | Interface count | Contains "Interfaces:" |
| `status --verbose succeeds` | Detailed output | Exit 0 |

### Section 5: Configuration

Tests configuration management.

| Test | Description | Expected |
|------|-------------|----------|
| `config command succeeds` | Show config | Exit 0 |
| `config shows project name` | Current config | Contains name |
| `config --provider local` | Set provider | Contains "Provider set to" |

### Section 6: Model Listing

Tests model configuration display.

| Test | Description | Expected |
|------|-------------|----------|
| `config --list-models succeeds` | List all models | Exit 0 |
| `shows fastest preset` | Local preset | Contains "fastest" |
| `shows balanced preset` | Local preset | Contains "balanced" |
| `shows quality preset` | Local preset | Contains "quality" |
| `shows maximum preset` | Local preset | Contains "maximum" |
| `shows ANTHROPIC` | Cloud provider | Contains "ANTHROPIC" |
| `shows OPENAI` | Cloud provider | Contains "OPENAI" |
| `shows GOOGLE` | Cloud provider | Contains "GOOGLE" |
| `shows Claude Sonnet` | Anthropic model | Contains "claude-sonnet" |
| `shows GPT-4o` | OpenAI model | Contains "gpt-4o" |
| `shows Gemini` | Google model | Contains "gemini" |
| `shows QWEN` | Local family | Contains "QWEN" |
| `shows LLAMA` | Local family | Contains "LLAMA" |
| `shows CODELLAMA` | Local family | Contains "CODELLAMA" |
| `shows DEEPSEEK` | Local family | Contains "DEEPSEEK" |
| `shows context windows` | Model info | Contains "ctx" |
| `shows batch sizes` | Model info | Contains "batch" |

### Section 7: Web Viewer API

Tests REST API endpoints.

| Test | Description | Expected |
|------|-------------|----------|
| `Viewer started successfully` | Server starts | Port 3199 responds |
| `GET /api/health` | Health check | Contains "isHealthy" |
| `GET /api/stats/overview` | Overview stats | Contains "totalFunctions" |
| `GET /api/stats/languages` | Language stats | Contains "typescript" |
| `GET /api/files` | File list | Exit 0 |
| `GET /api/functions` | Function list | Exit 0 |
| `GET /api/classes` | Class list | Exit 0 |
| `GET /api/interfaces` | Interface list | Exit 0 |
| `GET /api/search?q=User` | Name search | Contains "User" |
| `GET /api/nl-search/patterns` | NL patterns | Contains "pattern" |
| `GET /api/nl-search?q=query` | NL search | Exit 0 |

### Section 8: Justification

Tests business justification features.

| Test | Description | Expected |
|------|-------------|----------|
| `justify --stats succeeds` | Stats display | Exit 0 |
| `justify --stats shows Total` | Stats content | Contains "Total entities" |
| `justify --skip-llm succeeds` | Code analysis only | Exit 0 |

### Section 9: Incremental Updates

Tests file change detection.

| Test | Description | Expected |
|------|-------------|----------|
| `incremental index succeeds` | New file indexed | Exit 0 |
| `new file appears in status` | DB updated | Contains file |
| `index after delete succeeds` | Removed from DB | Exit 0 |

### Section 10: Error Handling

Tests error scenarios.

| Test | Description | Expected |
|------|-------------|----------|
| `status on uninit project` | Not initialized | Contains "not initialized" |
| `index on uninit project` | Not initialized | Contains "not initialized" |
| `invalid model preset` | Graceful handling | Exit 0 |
| `viewer on non-existent dir` | Directory error | Exit 1 |

---

## Manual Testing Procedures

### Testing MCP Server Integration

1. **Start MCP Server**:
   ```bash
   cd /path/to/test/project
   code-synapse init
   code-synapse index
   code-synapse start
   ```

2. **Test with Claude Code**:
   - Add to `~/.claude.json`:
     ```json
     {
       "mcpServers": {
         "code-synapse": {
           "command": "code-synapse",
           "args": ["start"],
           "cwd": "/path/to/test/project"
         }
       }
     }
     ```
   - In Claude Code, use `/mcp` to verify connection
   - Test queries: "Find all authentication functions"

3. **Test with Cursor**:
   - Add to `.cursor/mcp.json`
   - Restart Cursor
   - Use Agent mode to query codebase

### Testing Default Command

The default command (`code-synapse` without subcommand) runs the full workflow:

```bash
cd /path/to/test/project
code-synapse                    # Full workflow
code-synapse --skip-justify     # Skip justification
code-synapse --skip-viewer      # Skip web viewer
code-synapse --port 3200        # Custom MCP port
code-synapse --viewer-port 3201 # Custom viewer port
```

Expected behavior:
1. Checks initialization (runs init if needed)
2. Runs indexing
3. Runs justification (unless --skip-justify)
4. Finds available ports
5. Starts web viewer (unless --skip-viewer)
6. Starts MCP server

### Testing Interactive Setup

```bash
code-synapse config --setup
```

Expected flow:
1. Select AI provider (Local, Anthropic, OpenAI, Google)
2. For cloud providers: enter API key or use environment variable
3. Select model
4. Confirm and save configuration

### Testing Cloud Providers

```bash
# Set API key via environment
export ANTHROPIC_API_KEY="sk-ant-..."
code-synapse config --provider anthropic

# Or pass directly
code-synapse config --provider openai --api-key "sk-..."

# Run justification with cloud model
code-synapse justify
```

---

## API Endpoint Testing

### Complete API Test Suite

Use curl to test all viewer API endpoints:

```bash
# Start viewer
code-synapse viewer -p 3100 &

# Health & Stats
curl http://127.0.0.1:3100/api/health
curl http://127.0.0.1:3100/api/stats/overview
curl http://127.0.0.1:3100/api/stats/languages
curl http://127.0.0.1:3100/api/stats/complexity

# Entity Lists
curl http://127.0.0.1:3100/api/files
curl http://127.0.0.1:3100/api/files?limit=10
curl http://127.0.0.1:3100/api/functions
curl http://127.0.0.1:3100/api/functions/most-called
curl http://127.0.0.1:3100/api/functions/most-complex
curl http://127.0.0.1:3100/api/classes
curl http://127.0.0.1:3100/api/interfaces

# Search
curl "http://127.0.0.1:3100/api/search?q=User"
curl "http://127.0.0.1:3100/api/nl-search?q=most+complex+functions"
curl http://127.0.0.1:3100/api/nl-search/patterns

# Cleanup
pkill -f "viewer"
```

### Expected API Responses

**GET /api/stats/overview**
```json
{
  "files": 4,
  "functions": 12,
  "classes": 3,
  "interfaces": 2,
  "variables": 5,
  "relationships": 15,
  "embeddingCoverage": 0
}
```

**GET /api/nl-search?q=most complex functions**
```json
{
  "query": "most complex functions",
  "intent": {
    "intent": "rank_complexity",
    "confidence": 0.9,
    "keywords": ["most", "complex", "functions"]
  },
  "results": [...],
  "totalCount": 12,
  "executionTimeMs": 15
}
```

---

## Performance Testing

### Indexing Performance

Test indexing time for different project sizes:

```bash
# Time indexing
time code-synapse index

# Expected benchmarks:
# - 50 files: < 3 seconds
# - 100 files: < 5 seconds
# - 500 files: < 20 seconds
```

### Query Performance

Test query response times:

```bash
# Test search performance
time curl "http://127.0.0.1:3100/api/search?q=User"

# Test NL search performance
time curl "http://127.0.0.1:3100/api/nl-search?q=most+complex"

# Expected benchmarks:
# - Simple search: < 50ms
# - NL search: < 100ms
```

### Memory Usage

Monitor memory during operations:

```bash
# Start with memory monitoring
node --max-old-space-size=512 dist/cli/index.js index

# Expected:
# - Indexing 100 files: < 200MB
# - Running viewer: < 100MB
```

---

## Troubleshooting Test Failures

### Common Issues

**Database Lock Error**
```
Error: Database is locked
```
Solution:
```bash
pkill -f "code-synapse"
rm -f .code-synapse/data/cozodb/data/LOCK
```

**Port Already in Use**
```
Error: EADDRINUSE: address already in use
```
Solution:
```bash
pkill -f "viewer"
pkill -f "code-synapse start"
# Or use different port
code-synapse viewer -p 3200
```

**Tree-sitter WASM Error**
```
Error: Cannot find module 'tree-sitter-typescript.wasm'
```
Solution:
```bash
pnpm install
pnpm build
```

**LLM Model Not Found**
```
Error: Model not found
```
Solution:
```bash
# Use --skip-llm for testing without LLM
code-synapse justify --skip-llm

# Or configure a cloud provider
code-synapse config --provider anthropic
```

### Debug Mode

Enable verbose logging:

```bash
# Set log level
LOG_LEVEL=debug code-synapse index

# Or use CLI flag
code-synapse start --debug
```

Check logs:
```bash
cat .code-synapse/logs/combined.log
```

### Resetting Test State

```bash
# Full reset
rm -rf .code-synapse
code-synapse init
code-synapse index

# Reset database only
rm -rf .code-synapse/data
code-synapse index
```

---

## Adding New Tests

### E2E Test Template

Add new tests to `scripts/e2e-test.sh`:

```bash
# Section N: New Feature
if [ -z "$SECTION" ] || [ "$SECTION" = "N" ]; then
    log_section "Section N: New Feature"

    cd "$TEST_DIR/test-project"

    run_test "description" "command" expected_exit_code
    run_test_contains "description" "command" "expected_string"
    run_test_not_contains "description" "command" "unexpected_string"
    check_file_exists "description" "path/to/file"
    check_json_field "description" "file.json" "field" "expected_value"

    cd "$PROJECT_ROOT"
fi
```

### Unit Test Template

Add new tests to `src/**/__tests__/*.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('NewFeature', () => {
  beforeEach(async () => {
    // Setup
  });

  afterEach(async () => {
    // Cleanup
  });

  it('should do something', async () => {
    // Arrange
    // Act
    // Assert
    expect(result).toBe(expected);
  });
});
```

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm build
      - run: pnpm test:ci
      - run: ./scripts/e2e-test.sh --quick
```

---

*Last Updated: January 2026*

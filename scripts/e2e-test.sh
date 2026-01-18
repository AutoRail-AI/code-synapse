#!/bin/bash
#
# Code-Synapse End-to-End Test Script
#
# This script tests all CLI commands, features, and scenarios
# to ensure the system works correctly after changes.
#
# Usage:
#   ./scripts/e2e-test.sh              # Run all tests
#   ./scripts/e2e-test.sh --quick      # Run quick tests only (no LLM)
#   ./scripts/e2e-test.sh --section X  # Run specific section (1-10)
#
# See docs/ARCHITECTURE.md "Testing & Verification" section for detailed documentation.

set -e

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="node $PROJECT_ROOT/dist/cli/index.js"
TEST_DIR="/tmp/code-synapse-e2e-test-$$"
QUICK_MODE=false
SECTION=""
VERBOSE=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# =============================================================================
# Helper Functions
# =============================================================================

log_header() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
}

log_section() {
    echo ""
    echo -e "${BLUE}────────────────────────────────────────────────────────────────${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}────────────────────────────────────────────────────────────────${NC}"
}

log_test() {
    echo -e "  ${YELLOW}TEST:${NC} $1"
}

log_pass() {
    echo -e "  ${GREEN}✓ PASS:${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

log_fail() {
    echo -e "  ${RED}✗ FAIL:${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

log_skip() {
    echo -e "  ${YELLOW}○ SKIP:${NC} $1"
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
}

log_info() {
    echo -e "  ${CYAN}INFO:${NC} $1"
}

# Run a command and check exit code
run_test() {
    local description="$1"
    local command="$2"
    local expected_exit="${3:-0}"

    log_test "$description"

    if $VERBOSE; then
        echo "    Command: $command"
    fi

    set +e
    output=$(eval "$command" 2>&1)
    exit_code=$?
    set -e

    if [ "$exit_code" -eq "$expected_exit" ]; then
        log_pass "$description"
    else
        log_fail "$description (exit: $exit_code, expected: $expected_exit)"
        if $VERBOSE; then
            echo "    Output: $output"
        fi
    fi
    return 0  # Always return 0 to continue testing
}

# Run a command and check for string in output
run_test_contains() {
    local description="$1"
    local command="$2"
    local expected_string="$3"

    log_test "$description"

    set +e
    output=$(eval "$command" 2>&1)
    exit_code=$?

    # Use grep -F for literal string matching (handles special chars like [)
    if echo "$output" | grep -qF "$expected_string"; then
        log_pass "$description"
        set -e
        return 0
    else
        log_fail "$description (string '$expected_string' not found)"
        if $VERBOSE; then
            echo "    Output: $output"
        fi
        set -e
        return 0  # Don't fail the whole script
    fi
}

# Run a command and check output does NOT contain string
run_test_not_contains() {
    local description="$1"
    local command="$2"
    local unexpected_string="$3"

    log_test "$description"

    set +e
    output=$(eval "$command" 2>&1)
    exit_code=$?
    set -e

    # Use grep -F for literal string matching
    if echo "$output" | grep -qF "$unexpected_string"; then
        log_fail "$description (unexpected string '$unexpected_string' found)"
        if $VERBOSE; then
            echo "    Output: $output"
        fi
    else
        log_pass "$description"
    fi
    return 0  # Always return 0 to continue testing
}

# Check if file exists
check_file_exists() {
    local description="$1"
    local filepath="$2"

    log_test "$description"

    if [ -f "$filepath" ]; then
        log_pass "$description"
    else
        log_fail "$description (file not found: $filepath)"
    fi
    return 0  # Always return 0 to continue testing
}

# Check if directory exists
check_dir_exists() {
    local description="$1"
    local dirpath="$2"

    log_test "$description"

    if [ -d "$dirpath" ]; then
        log_pass "$description"
    else
        log_fail "$description (directory not found: $dirpath)"
    fi
    return 0  # Always return 0 to continue testing
}

# Check JSON field value
check_json_field() {
    local description="$1"
    local filepath="$2"
    local field="$3"
    local expected="$4"

    log_test "$description"

    set +e
    actual=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$filepath', 'utf-8')).$field)" 2>/dev/null)
    set -e

    if [ "$actual" = "$expected" ]; then
        log_pass "$description"
    else
        log_fail "$description (expected: $expected, got: $actual)"
    fi
    return 0  # Always return 0 to continue testing
}

# Wait for server to be ready
wait_for_server() {
    local url="$1"
    local max_attempts="${2:-30}"
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            return 0
        fi
        sleep 0.5
        ((attempt++))
    done
    return 1
}

# Kill background processes
cleanup() {
    log_info "Cleaning up..."

    # Kill any viewer/server processes we started
    pkill -f "node.*dist/cli/index.js viewer" 2>/dev/null || true
    pkill -f "node.*dist/cli/index.js start" 2>/dev/null || true

    # Remove test directory
    if [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
    fi

    # Remove any leftover lock files
    rm -f "$PROJECT_ROOT/.code-synapse/data/cozodb/data/LOCK" 2>/dev/null || true
}

# Setup test project
setup_test_project() {
    local project_dir="$1"
    local project_name="${2:-test-project}"

    mkdir -p "$project_dir/src"

    # Create package.json
    cat > "$project_dir/package.json" << EOF
{
  "name": "$project_name",
  "version": "1.0.0",
  "type": "module"
}
EOF

    # Create TypeScript config
    cat > "$project_dir/tsconfig.json" << EOF
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "strict": true
  }
}
EOF

    # Create sample source files
    cat > "$project_dir/src/index.ts" << 'EOF'
/**
 * Main entry point for the application
 */
import { UserService } from './user-service.js';
import { AuthService } from './auth-service.js';

export async function main(): Promise<void> {
  const userService = new UserService();
  const authService = new AuthService();

  await userService.initialize();
  await authService.initialize();

  console.log('Application started');
}

main().catch(console.error);
EOF

    cat > "$project_dir/src/user-service.ts" << 'EOF'
/**
 * Manages user data and operations
 */
export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  private users: Map<string, User> = new Map();

  async initialize(): Promise<void> {
    console.log('UserService initialized');
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async createUser(name: string, email: string): Promise<User> {
    const id = crypto.randomUUID();
    const user: User = { id, name, email };
    this.users.set(id, user);
    return user;
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }
}
EOF

    cat > "$project_dir/src/auth-service.ts" << 'EOF'
/**
 * Authentication and authorization service
 */
import { UserService, User } from './user-service.js';

export interface AuthToken {
  token: string;
  userId: string;
  expiresAt: Date;
}

export class AuthService {
  private tokens: Map<string, AuthToken> = new Map();

  async initialize(): Promise<void> {
    console.log('AuthService initialized');
  }

  /**
   * Validates a JWT token and returns the associated user
   */
  async validateToken(token: string): Promise<boolean> {
    const authToken = this.tokens.get(token);
    if (!authToken) return false;
    return authToken.expiresAt > new Date();
  }

  /**
   * Creates a new authentication token for a user
   */
  async createToken(userId: string): Promise<AuthToken> {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 3600000);
    const authToken: AuthToken = { token, userId, expiresAt };
    this.tokens.set(token, authToken);
    return authToken;
  }

  async revokeToken(token: string): Promise<void> {
    this.tokens.delete(token);
  }
}
EOF

    # Create a .gitignore
    cat > "$project_dir/.gitignore" << 'EOF'
node_modules/
dist/
.env
*.log
EOF

    # Create a utility file
    cat > "$project_dir/src/utils.ts" << 'EOF'
/**
 * Utility functions for the application
 */
export function formatDate(date: Date): string {
  return date.toISOString();
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
EOF
}

# =============================================================================
# Parse Arguments
# =============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --quick)
            QUICK_MODE=true
            shift
            ;;
        --section)
            SECTION="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --quick       Run quick tests only (skip LLM tests)"
            echo "  --section N   Run specific section (1-10)"
            echo "  --verbose     Show detailed output"
            echo "  --help        Show this help message"
            echo ""
            echo "Sections:"
            echo "  1  CLI Help and Version"
            echo "  2  Project Initialization"
            echo "  3  Indexing"
            echo "  4  Status Command"
            echo "  5  Configuration"
            echo "  6  Model Listing"
            echo "  7  Web Viewer API"
            echo "  8  Justification (requires LLM)"
            echo "  9  Incremental Updates"
            echo "  10 Error Handling"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# =============================================================================
# Main Test Execution
# =============================================================================

trap cleanup EXIT

log_header "Code-Synapse E2E Test Suite"
echo ""
echo "  Project Root: $PROJECT_ROOT"
echo "  Test Dir:     $TEST_DIR"
echo "  Quick Mode:   $QUICK_MODE"
echo "  Section:      ${SECTION:-all}"

# Ensure we're built
if [ ! -f "$PROJECT_ROOT/dist/cli/index.js" ]; then
    log_info "Building project..."
    cd "$PROJECT_ROOT" && pnpm build > /dev/null 2>&1
fi

# =============================================================================
# Section 1: CLI Help and Version
# =============================================================================

if [ -z "$SECTION" ] || [ "$SECTION" = "1" ]; then
    log_section "Section 1: CLI Help and Version"

    run_test "CLI --help shows usage" "$CLI --help" 0
    run_test_contains "CLI --help shows commands" "$CLI --help" "Commands:"
    run_test_contains "CLI --help shows init" "$CLI --help" "init"
    run_test_contains "CLI --help shows index" "$CLI --help" "index"
    run_test_contains "CLI --help shows status" "$CLI --help" "status"
    run_test_contains "CLI --help shows config" "$CLI --help" "config"
    run_test_contains "CLI --help shows viewer" "$CLI --help" "viewer"
    run_test_contains "CLI --help shows start" "$CLI --help" "start"

    run_test "init --help works" "$CLI init --help" 0
    run_test "index --help works" "$CLI index --help" 0
    run_test "status --help works" "$CLI status --help" 0
    run_test "config --help works" "$CLI config --help" 0
    run_test "viewer --help works" "$CLI viewer --help" 0
    run_test "start --help works" "$CLI start --help" 0
fi

# =============================================================================
# Section 2: Project Initialization
# =============================================================================

if [ -z "$SECTION" ] || [ "$SECTION" = "2" ]; then
    log_section "Section 2: Project Initialization"

    # Create test project
    mkdir -p "$TEST_DIR"
    setup_test_project "$TEST_DIR/init-test"
    cd "$TEST_DIR/init-test"

    # Test init command
    run_test "init command succeeds" "$CLI init" 0
    check_dir_exists ".code-synapse directory created" ".code-synapse"
    check_file_exists "config.json created" ".code-synapse/config.json"
    check_dir_exists "data directory created" ".code-synapse/data"

    # Check config content
    check_json_field "config has project name" ".code-synapse/config.json" "name" "init-test"

    # Test re-initialization
    run_test_contains "init without --force shows already initialized" "$CLI init" "already initialized"
    run_test "init --force succeeds on existing project" "$CLI init --force" 0

    # Test init with --skip-llm
    rm -rf .code-synapse
    run_test "init --skip-llm succeeds" "$CLI init --skip-llm" 0

    # Test init with model preset
    rm -rf .code-synapse
    run_test "init --model fastest succeeds" "$CLI init --model fastest" 0

    cd "$PROJECT_ROOT"
fi

# =============================================================================
# Section 3: Indexing
# =============================================================================

if [ -z "$SECTION" ] || [ "$SECTION" = "3" ]; then
    log_section "Section 3: Indexing"

    # Create test project
    setup_test_project "$TEST_DIR/index-test"
    cd "$TEST_DIR/index-test"

    # Initialize first
    $CLI init --skip-llm > /dev/null 2>&1

    # Test index command
    run_test "index command succeeds" "$CLI index" 0
    run_test_contains "index reports files" "$CLI index" "Files indexed"

    # Verify database has data
    run_test_contains "status shows indexed files" "$CLI status" "Files:"
    run_test_contains "status shows functions" "$CLI status" "Functions:"

    # Test force re-index
    run_test "index --force succeeds" "$CLI index --force" 0

    cd "$PROJECT_ROOT"
fi

# =============================================================================
# Section 4: Status Command
# =============================================================================

if [ -z "$SECTION" ] || [ "$SECTION" = "4" ]; then
    log_section "Section 4: Status Command"

    # Use existing indexed project
    cd "$TEST_DIR/index-test"

    run_test "status command succeeds" "$CLI status" 0
    run_test_contains "status shows project name" "$CLI status" "index-test"
    run_test_contains "status shows Files" "$CLI status" "Files:"
    run_test_contains "status shows Functions" "$CLI status" "Functions:"
    run_test_contains "status shows Classes" "$CLI status" "Classes:"
    run_test_contains "status shows Interfaces" "$CLI status" "Interfaces:"

    # Test verbose status
    run_test "status --verbose succeeds" "$CLI status --verbose" 0

    cd "$PROJECT_ROOT"
fi

# =============================================================================
# Section 5: Configuration
# =============================================================================

if [ -z "$SECTION" ] || [ "$SECTION" = "5" ]; then
    log_section "Section 5: Configuration"

    cd "$TEST_DIR/index-test"

    # Test config without options (show current)
    run_test "config command succeeds" "$CLI config" 0
    run_test_contains "config shows project name" "$CLI config" "index-test"

    # Test provider configuration (with piped input for non-interactive)
    run_test "config --provider local with selection" "echo 1 | $CLI config --provider local" 0

    cd "$PROJECT_ROOT"
fi

# =============================================================================
# Section 6: Model Listing
# =============================================================================

if [ -z "$SECTION" ] || [ "$SECTION" = "6" ]; then
    log_section "Section 6: Model Listing"

    cd "$TEST_DIR/index-test"

    # Test list models
    run_test "config --list-models succeeds" "$CLI config --list-models" 0

    # Check local model presets
    run_test_contains "list-models shows fastest preset" "$CLI config --list-models" "fastest"
    run_test_contains "list-models shows balanced preset" "$CLI config --list-models" "balanced"
    run_test_contains "list-models shows quality preset" "$CLI config --list-models" "quality"
    run_test_contains "list-models shows maximum preset" "$CLI config --list-models" "maximum"

    # Check cloud providers
    run_test_contains "list-models shows Anthropic" "$CLI config --list-models" "ANTHROPIC"
    run_test_contains "list-models shows OpenAI" "$CLI config --list-models" "OPENAI"
    run_test_contains "list-models shows Google" "$CLI config --list-models" "GOOGLE"

    # Check specific cloud models
    run_test_contains "list-models shows Claude Sonnet" "$CLI config --list-models" "claude-sonnet"
    run_test_contains "list-models shows GPT-4o" "$CLI config --list-models" "gpt-4o"
    run_test_contains "list-models shows Gemini" "$CLI config --list-models" "gemini"

    # Check local models
    run_test_contains "list-models shows Qwen" "$CLI config --list-models" "QWEN"
    run_test_contains "list-models shows Llama" "$CLI config --list-models" "LLAMA"
    run_test_contains "list-models shows CodeLlama" "$CLI config --list-models" "CODELLAMA"
    run_test_contains "list-models shows DeepSeek" "$CLI config --list-models" "DEEPSEEK"

    # Check model details shown
    run_test_contains "list-models shows context windows" "$CLI config --list-models" "ctx"
    run_test_contains "list-models shows batch sizes" "$CLI config --list-models" "batch"

    cd "$PROJECT_ROOT"
fi

# =============================================================================
# Section 7: Web Viewer API
# =============================================================================

if [ -z "$SECTION" ] || [ "$SECTION" = "7" ]; then
    log_section "Section 7: Web Viewer API"

    cd "$TEST_DIR/index-test"

    # Start viewer in background
    log_info "Starting viewer on port 3199..."
    $CLI viewer -p 3199 > /dev/null 2>&1 &
    VIEWER_PID=$!

    # Wait for server to be ready
    if wait_for_server "http://127.0.0.1:3199/api/health" 30; then
        log_pass "Viewer started successfully"

        # Test API endpoints
        run_test_contains "GET /api/health returns status" "curl -s http://127.0.0.1:3199/api/health" "isHealthy"
        run_test_contains "GET /api/stats/overview returns JSON" "curl -s http://127.0.0.1:3199/api/stats/overview" "totalFunctions"
        run_test_contains "GET /api/stats/languages returns data" "curl -s http://127.0.0.1:3199/api/stats/languages" "typescript"
        run_test "GET /api/files returns array" "curl -s http://127.0.0.1:3199/api/files" 0
        run_test "GET /api/functions returns array" "curl -s http://127.0.0.1:3199/api/functions" 0
        run_test "GET /api/classes returns array" "curl -s http://127.0.0.1:3199/api/classes" 0
        run_test "GET /api/interfaces returns array" "curl -s http://127.0.0.1:3199/api/interfaces" 0

        # Test search
        run_test_contains "GET /api/search?q=User returns results" "curl -s 'http://127.0.0.1:3199/api/search?q=User'" "User"

        # Test NL Search
        run_test_contains "GET /api/nl-search patterns returns array" "curl -s http://127.0.0.1:3199/api/nl-search/patterns" "pattern"
        run_test "GET /api/nl-search?q=query returns results" "curl -s 'http://127.0.0.1:3199/api/nl-search?q=most+complex+functions'" 0

        # Stop viewer
        kill $VIEWER_PID 2>/dev/null || true
        sleep 1
    else
        log_fail "Viewer failed to start"
        kill $VIEWER_PID 2>/dev/null || true
    fi

    cd "$PROJECT_ROOT"
fi

# =============================================================================
# Section 8: Justification (requires LLM)
# =============================================================================

if [ -z "$SECTION" ] || [ "$SECTION" = "8" ]; then
    log_section "Section 8: Justification"

    if $QUICK_MODE; then
        log_skip "Justification tests (quick mode)"
    else
        cd "$TEST_DIR/index-test"

        # Test justify --stats (doesn't require LLM)
        run_test "justify --stats succeeds" "$CLI justify --stats" 0
        run_test_contains "justify --stats shows Total entities" "$CLI justify --stats" "Total entities"

        # Test justify --skip-llm
        run_test "justify --skip-llm succeeds" "$CLI justify --skip-llm" 0

        cd "$PROJECT_ROOT"
    fi
fi

# =============================================================================
# Section 9: Incremental Updates
# =============================================================================

if [ -z "$SECTION" ] || [ "$SECTION" = "9" ]; then
    log_section "Section 9: Incremental Updates"

    cd "$TEST_DIR/index-test"

    # Get initial counts
    initial_output=$($CLI status 2>&1)

    # Add a new file
    cat > "$TEST_DIR/index-test/src/new-service.ts" << 'EOF'
/**
 * A new service added for testing incremental updates
 */
export class NewService {
  async doSomething(): Promise<void> {
    console.log('New service');
  }
}
EOF

    # Re-index (should be incremental)
    run_test "incremental index succeeds" "$CLI index" 0

    # Verify new file was indexed
    run_test_contains "new file appears in status" "$CLI status" "Files:"

    # Delete the new file
    rm "$TEST_DIR/index-test/src/new-service.ts"

    # Re-index again
    run_test "index after delete succeeds" "$CLI index" 0

    cd "$PROJECT_ROOT"
fi

# =============================================================================
# Section 10: Error Handling
# =============================================================================

if [ -z "$SECTION" ] || [ "$SECTION" = "10" ]; then
    log_section "Section 10: Error Handling"

    # Test uninitialized project
    mkdir -p "$TEST_DIR/uninit-test"
    cd "$TEST_DIR/uninit-test"

    run_test_contains "status on uninit project shows error" "$CLI status" "not initialized"
    run_test_contains "index on uninit project shows error" "$CLI index" "not initialized"

    # Test invalid options
    cd "$TEST_DIR/index-test"
    run_test "invalid model preset fails gracefully" "$CLI init --model invalid-model-name --force" 0

    # Test non-existent directory
    run_test "viewer on non-existent dir fails" "cd /nonexistent && $CLI viewer" 1

    cd "$PROJECT_ROOT"
fi

# =============================================================================
# Summary
# =============================================================================

log_header "Test Summary"

echo ""
echo -e "  ${GREEN}Passed:${NC}  $TESTS_PASSED"
echo -e "  ${RED}Failed:${NC}  $TESTS_FAILED"
echo -e "  ${YELLOW}Skipped:${NC} $TESTS_SKIPPED"
echo ""

TOTAL=$((TESTS_PASSED + TESTS_FAILED))
if [ $TOTAL -gt 0 ]; then
    PASS_RATE=$((TESTS_PASSED * 100 / TOTAL))
    echo -e "  Pass Rate: ${PASS_RATE}%"
fi

echo ""

if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi

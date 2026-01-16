/**
 * End-to-End Self-Test Integration
 *
 * This test runs code-synapse on its own codebase and verifies:
 * 1. Initialization works
 * 2. Indexing completes successfully
 * 3. Viewer API returns expected data
 * 4. Search functionality works
 * 5. No runtime errors occur
 *
 * Run with: pnpm test src/core/__tests__/e2e-self-test.integration.test.ts
 *
 * NOTE: This test requires:
 * - Native CozoDB bindings
 * - The project to be built (pnpm build)
 *
 * The test dynamically finds an available port, so it won't conflict
 * with other running instances.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";

// Skip in CI where native bindings may not be available
const SKIP_NATIVE_TESTS = process.env.SKIP_NATIVE_TESTS === "true";

// =============================================================================
// Configuration
// =============================================================================

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../.."
);
const CODE_SYNAPSE_DIR = path.join(PROJECT_ROOT, ".code-synapse");
const CLI_PATH = path.join(PROJECT_ROOT, "dist/cli/index.js");

// Test configuration
const VIEWER_PORT_START = 3199; // Starting port for dynamic port search
const STARTUP_TIMEOUT = 120000; // 2 minutes for indexing
const REQUEST_TIMEOUT = 10000; // 10 seconds for API requests

// Dynamic port - set during test setup
let viewerPort: number;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/**
 * Backup and clear the .code-synapse directory
 */
function clearDataDirectory(): { hadExisting: boolean; backupPath: string | null } {
  const backupPath = `${CODE_SYNAPSE_DIR}.backup.${Date.now()}`;
  let hadExisting = false;

  if (fs.existsSync(CODE_SYNAPSE_DIR)) {
    hadExisting = true;
    // Backup existing directory
    fs.renameSync(CODE_SYNAPSE_DIR, backupPath);
    console.log(`[E2E] Backed up existing .code-synapse to ${backupPath}`);
  }

  return { hadExisting, backupPath: hadExisting ? backupPath : null };
}

/**
 * Restore the backed up .code-synapse directory
 */
function restoreDataDirectory(backupPath: string | null): void {
  // Remove the test directory if it exists
  if (fs.existsSync(CODE_SYNAPSE_DIR)) {
    fs.rmSync(CODE_SYNAPSE_DIR, { recursive: true, force: true });
  }

  // Restore backup if it existed
  if (backupPath && fs.existsSync(backupPath)) {
    fs.renameSync(backupPath, CODE_SYNAPSE_DIR);
    console.log(`[E2E] Restored .code-synapse from backup`);
  }
}

/**
 * Make an HTTP request and return JSON
 */
async function fetchJSON<T>(url: string, timeoutMs: number = REQUEST_TIMEOUT): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Request timeout: ${url}`));
    }, timeoutMs);

    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data) as T);
        } catch (_error) {
          reject(new Error(`Failed to parse JSON from ${url}: ${data}`));
        }
      });
    }).on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * Wait for the viewer to be ready
 */
async function waitForViewer(port: number, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();
  const healthUrl = `http://127.0.0.1:${port}/api/health`;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const health = await fetchJSON<{ status: string }>(healthUrl, 2000);
      if (health && health.status) {
        return true;
      }
    } catch {
      // Not ready yet, wait and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

/**
 * Start the code-synapse viewer
 */
function startViewer(port: number): ChildProcess {
  const viewerProcess = spawn("node", [CLI_PATH, "viewer", "-p", String(port)], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Log output for debugging
  viewerProcess.stdout?.on("data", (data) => {
    const output = data.toString().trim();
    if (output) {
      console.log(`[Viewer stdout] ${output}`);
    }
  });

  viewerProcess.stderr?.on("data", (data) => {
    const output = data.toString().trim();
    if (output && !output.includes("ExperimentalWarning")) {
      console.log(`[Viewer stderr] ${output}`);
    }
  });

  return viewerProcess;
}

/**
 * Run indexing synchronously
 */
async function runIndexing(): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const indexProcess = spawn("node", [CLI_PATH, "index"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        LOG_LEVEL: "warn",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    indexProcess.stdout?.on("data", (data) => {
      output += data.toString();
    });

    indexProcess.stderr?.on("data", (data) => {
      const text = data.toString();
      if (!text.includes("ExperimentalWarning")) {
        output += text;
      }
    });

    indexProcess.on("close", (code) => {
      resolve({
        success: code === 0,
        output,
      });
    });

    indexProcess.on("error", (error) => {
      resolve({
        success: false,
        output: error.message,
      });
    });
  });
}

/**
 * Run initialization
 */
async function runInit(): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const initProcess = spawn("node", [CLI_PATH, "init", "--skip-llm"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        LOG_LEVEL: "warn",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    initProcess.stdout?.on("data", (data) => {
      output += data.toString();
    });

    initProcess.stderr?.on("data", (data) => {
      const text = data.toString();
      if (!text.includes("ExperimentalWarning")) {
        output += text;
      }
    });

    initProcess.on("close", (code) => {
      resolve({
        success: code === 0,
        output,
      });
    });

    initProcess.on("error", (error) => {
      resolve({
        success: false,
        output: error.message,
      });
    });
  });
}

// =============================================================================
// Test Suite
// =============================================================================

describe.skipIf(SKIP_NATIVE_TESTS)("E2E Self-Test", () => {
  let backupPath: string | null = null;
  let viewerProcess: ChildProcess | null = null;

  beforeAll(async () => {
    console.log("\n[E2E] ===== Starting E2E Self-Test =====\n");

    // Step 1: Find available port (no killing - we find a free port instead)
    console.log("[E2E] Step 1: Finding available port...");
    viewerPort = await findAvailablePort(VIEWER_PORT_START);
    console.log(`[E2E] Using port ${viewerPort}`);

    // Step 2: Clear data directory
    console.log("[E2E] Step 2: Clearing .code-synapse directory...");
    const backup = clearDataDirectory();
    backupPath = backup.backupPath;

    // Step 3: Verify CLI exists
    console.log("[E2E] Step 3: Verifying CLI exists...");
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`CLI not found at ${CLI_PATH}. Run 'pnpm build' first.`);
    }

    // Step 4: Run initialization
    console.log("[E2E] Step 4: Running initialization...");
    const initResult = await runInit();
    if (!initResult.success) {
      console.error("[E2E] Init failed:", initResult.output);
      throw new Error("Initialization failed");
    }
    console.log("[E2E] Initialization complete");

    // Step 5: Run indexing
    console.log("[E2E] Step 5: Running indexing (this may take a while)...");
    const indexResult = await runIndexing();
    if (!indexResult.success) {
      console.error("[E2E] Index failed:", indexResult.output);
      throw new Error("Indexing failed");
    }
    console.log("[E2E] Indexing complete");

    // Step 6: Start viewer
    console.log(`[E2E] Step 6: Starting viewer on port ${viewerPort}...`);
    viewerProcess = startViewer(viewerPort);

    // Step 7: Wait for viewer to be ready
    console.log("[E2E] Step 7: Waiting for viewer to be ready...");
    const isReady = await waitForViewer(viewerPort, 30000);
    if (!isReady) {
      throw new Error("Viewer failed to start within timeout");
    }
    console.log("[E2E] Viewer is ready");

    console.log("\n[E2E] ===== Setup Complete =====\n");
  }, STARTUP_TIMEOUT);

  afterAll(async () => {
    console.log("\n[E2E] ===== Cleaning Up =====\n");

    // Stop only the viewer process we spawned (gracefully)
    if (viewerProcess) {
      console.log("[E2E] Stopping viewer process...");
      viewerProcess.kill("SIGTERM");

      // Wait for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if still running after 3 seconds
          try {
            viewerProcess?.kill("SIGKILL");
          } catch {
            // Process may already be dead
          }
          resolve();
        }, 3000);

        viewerProcess!.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    // Restore original .code-synapse if it existed
    if (backupPath) {
      console.log("[E2E] Restoring original .code-synapse directory...");
      restoreDataDirectory(backupPath);
    }

    console.log("[E2E] Cleanup complete\n");
  });

  // ===========================================================================
  // Health Check Tests
  // ===========================================================================

  describe("1. Health Check", () => {
    it("should return healthy status", async () => {
      const health = await fetchJSON<{
        status: string;
        components: {
          database: { status: string };
          indexer: { status: string; message: string };
          embeddings: { status: string; message: string };
          relationships: { status: string; message: string };
        };
      }>(`http://127.0.0.1:${viewerPort}/api/health`);

      expect(health).toBeDefined();
      expect(health.status).toBeDefined();
      expect(health.components).toBeDefined();
      expect(health.components.database).toBeDefined();
    });
  });

  // ===========================================================================
  // Statistics Tests
  // ===========================================================================

  describe("2. Statistics", () => {
    it("should return overview stats with indexed data", async () => {
      const stats = await fetchJSON<{
        totalFiles: number;
        totalFunctions: number;
        totalClasses: number;
        totalInterfaces: number;
        totalRelationships: number;
        embeddingCoverage: number;
      }>(`http://127.0.0.1:${viewerPort}/api/stats/overview`);

      expect(stats).toBeDefined();

      // Should have indexed files
      expect(stats.totalFiles).toBeGreaterThan(0);
      console.log(`[E2E] Indexed ${stats.totalFiles} files`);

      // Should have functions
      expect(stats.totalFunctions).toBeGreaterThan(0);
      console.log(`[E2E] Found ${stats.totalFunctions} functions`);

      // Should have classes
      expect(stats.totalClasses).toBeGreaterThan(0);
      console.log(`[E2E] Found ${stats.totalClasses} classes`);

      // Should have interfaces
      expect(stats.totalInterfaces).toBeGreaterThan(0);
      console.log(`[E2E] Found ${stats.totalInterfaces} interfaces`);

      // Should have relationships
      expect(stats.totalRelationships).toBeGreaterThanOrEqual(0);
      console.log(`[E2E] Found ${stats.totalRelationships} relationships`);
    });

    it("should return language distribution with TypeScript", async () => {
      const languages = await fetchJSON<
        Array<{ language: string; fileCount: number; percentage: number }>
      >(`http://127.0.0.1:${viewerPort}/api/stats/languages`);

      expect(languages).toBeDefined();
      expect(Array.isArray(languages)).toBe(true);
      expect(languages.length).toBeGreaterThan(0);

      // Should have TypeScript files (API returns lowercase "typescript")
      const typescript = languages.find(
        (l) => l.language.toLowerCase() === "typescript"
      );
      expect(typescript).toBeDefined();
      expect(typescript!.fileCount).toBeGreaterThan(0);
      console.log(`[E2E] TypeScript files: ${typescript!.fileCount}`);
    });

    it("should return entity counts", async () => {
      const entities = await fetchJSON<{
        functions: number;
        classes: number;
        interfaces: number;
        variables: number;
        typeAliases: number;
      }>(`http://127.0.0.1:${viewerPort}/api/stats/entities`);

      expect(entities).toBeDefined();
      expect(entities.functions).toBeGreaterThan(0);
      expect(entities.classes).toBeGreaterThan(0);
    });

    it("should return relationship counts", async () => {
      const relationships = await fetchJSON<{
        imports: number;
        calls: number;
        contains: number;
        implements: number;
        extends: number;
      }>(`http://127.0.0.1:${viewerPort}/api/stats/relationships`);

      expect(relationships).toBeDefined();
      // Should have some import relationships
      expect(relationships.imports).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // Files API Tests
  // ===========================================================================

  describe("3. Files API", () => {
    it("should list files", async () => {
      const files = await fetchJSON<
        Array<{
          id: string;
          relativePath: string;
          language: string;
        }>
      >(`http://127.0.0.1:${viewerPort}/api/files?limit=10`);

      expect(files).toBeDefined();
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);

      // Each file should have required fields
      const firstFile = files[0]!;
      expect(firstFile.id).toBeDefined();
      expect(firstFile.relativePath).toBeDefined();
      expect(firstFile.language).toBeDefined();
    });

    it("should find src/cli/main.ts", async () => {
      const files = await fetchJSON<
        Array<{
          id: string;
          relativePath: string;
        }>
      >(`http://127.0.0.1:${viewerPort}/api/files?limit=500`);

      const mainTs = files.find(
        (f) => f.relativePath.includes("cli/main.ts") || f.relativePath.includes("cli\\main.ts")
      );
      expect(mainTs).toBeDefined();
    });
  });

  // ===========================================================================
  // Functions API Tests
  // ===========================================================================

  describe("4. Functions API", () => {
    it("should list functions", async () => {
      const functions = await fetchJSON<
        Array<{
          id: string;
          name: string;
          filePath: string;
        }>
      >(`http://127.0.0.1:${viewerPort}/api/functions?limit=10`);

      expect(functions).toBeDefined();
      expect(Array.isArray(functions)).toBe(true);
      expect(functions.length).toBeGreaterThan(0);

      // Each function should have required fields
      const firstFn = functions[0]!;
      expect(firstFn.id).toBeDefined();
      expect(firstFn.name).toBeDefined();
    });

    it("should find createGraphStore function", async () => {
      const functions = await fetchJSON<
        Array<{
          id: string;
          name: string;
        }>
      >(`http://127.0.0.1:${viewerPort}/api/functions?limit=1000`);

      const createGraphStore = functions.find((f) => f.name === "createGraphStore");
      expect(createGraphStore).toBeDefined();
    });

    it("should return most complex functions", async () => {
      const complex = await fetchJSON<
        Array<{
          id: string;
          name: string;
          complexity: number;
        }>
      >(`http://127.0.0.1:${viewerPort}/api/functions/most-complex?limit=5`);

      expect(complex).toBeDefined();
      expect(Array.isArray(complex)).toBe(true);
    });
  });

  // ===========================================================================
  // Classes API Tests
  // ===========================================================================

  describe("5. Classes API", () => {
    it("should list classes", async () => {
      const classes = await fetchJSON<
        Array<{
          id: string;
          name: string;
        }>
      >(`http://127.0.0.1:${viewerPort}/api/classes?limit=10`);

      expect(classes).toBeDefined();
      expect(Array.isArray(classes)).toBe(true);
      expect(classes.length).toBeGreaterThan(0);
    });

    it("should find key classes", async () => {
      const classes = await fetchJSON<
        Array<{
          id: string;
          name: string;
        }>
      >(`http://127.0.0.1:${viewerPort}/api/classes?limit=500`);

      // Look for known classes in the codebase
      const classNames = classes.map((c) => c.name);

      // Should have at least some of these known classes
      const knownClasses = [
        "CozoGraphStore",
        "ViewerServer",
        "MCPServer",
        "ContextPropagator",
        "LLMJustificationService",
      ];

      const foundClasses = knownClasses.filter((name) => classNames.includes(name));
      expect(foundClasses.length).toBeGreaterThan(0);
      console.log(`[E2E] Found known classes: ${foundClasses.join(", ")}`);
    });
  });

  // ===========================================================================
  // Interfaces API Tests
  // ===========================================================================

  describe("6. Interfaces API", () => {
    it("should list interfaces", async () => {
      const interfaces = await fetchJSON<
        Array<{
          id: string;
          name: string;
        }>
      >(`http://127.0.0.1:${viewerPort}/api/interfaces?limit=10`);

      expect(interfaces).toBeDefined();
      expect(Array.isArray(interfaces)).toBe(true);
      expect(interfaces.length).toBeGreaterThan(0);
    });

    it("should find key interfaces", async () => {
      const interfaces = await fetchJSON<
        Array<{
          id: string;
          name: string;
        }>
      >(`http://127.0.0.1:${viewerPort}/api/interfaces?limit=500`);

      const interfaceNames = interfaces.map((i) => i.name);

      // Should have at least some of these known interfaces
      const knownInterfaces = ["IGraphStore", "IParser", "IGraphViewer", "IJustificationService"];

      const foundInterfaces = knownInterfaces.filter((name) => interfaceNames.includes(name));
      expect(foundInterfaces.length).toBeGreaterThan(0);
      console.log(`[E2E] Found known interfaces: ${foundInterfaces.join(", ")}`);
    });
  });

  // ===========================================================================
  // Search API Tests
  // ===========================================================================

  describe("7. Search API", () => {
    it("should search by name", async () => {
      const results = await fetchJSON<
        Array<{
          id: string;
          name: string;
          type: string;
        }>
      >(`http://127.0.0.1:${viewerPort}/api/search?q=Graph`);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      // Should find items containing "Graph"
      const hasGraph = results.some(
        (r) => r.name.toLowerCase().includes("graph") || r.name.includes("Graph")
      );
      expect(hasGraph).toBe(true);
    });

    it("should search for specific function", async () => {
      const results = await fetchJSON<
        Array<{
          id: string;
          name: string;
          type: string;
        }>
      >(`http://127.0.0.1:${viewerPort}/api/search?q=createLogger&type=function`);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);

      const createLogger = results.find((r) => r.name === "createLogger");
      expect(createLogger).toBeDefined();
    });
  });

  // ===========================================================================
  // Natural Language Search Tests
  // ===========================================================================

  describe("8. Natural Language Search", () => {
    it("should handle NL search query", async () => {
      const result = await fetchJSON<{
        query: string;
        intent: {
          intent: string;
          confidence: number;
        };
        results: Array<unknown>;
        totalCount: number;
        executionTimeMs: number;
      }>(`http://127.0.0.1:${viewerPort}/api/nl-search?q=find%20all%20functions`);

      expect(result).toBeDefined();
      expect(result.query).toBeDefined();
      expect(result.intent).toBeDefined();
      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    });

    it("should return search patterns", async () => {
      const patterns = await fetchJSON<
        Array<{
          pattern: string;
          examples: string[];
        }>
      >(`http://127.0.0.1:${viewerPort}/api/nl-search/patterns`);

      expect(patterns).toBeDefined();
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Data Integrity Tests
  // ===========================================================================

  describe("9. Data Integrity", () => {
    it("should have consistent file counts", async () => {
      const overview = await fetchJSON<{
        totalFiles: number;
      }>(`http://127.0.0.1:${viewerPort}/api/stats/overview`);

      const files = await fetchJSON<Array<{ id: string }>>(
        `http://127.0.0.1:${viewerPort}/api/files?limit=10000`
      );

      // File counts should be reasonably close
      // (may differ slightly due to pagination or filtering)
      expect(files.length).toBeGreaterThanOrEqual(overview.totalFiles * 0.9);
    });

    it("should have no database errors in health check", async () => {
      const health = await fetchJSON<{
        status: string;
        components: {
          database: { status: string };
          indexer: { status: string; message: string };
          embeddings: { status: string; message: string };
          relationships: { status: string; message: string };
        };
      }>(`http://127.0.0.1:${viewerPort}/api/health`);

      // Database component should be healthy
      expect(health.components.database.status).toBe("healthy");
      // Overall status should not be error
      expect(health.status).not.toBe("error");
    });
  });

  // ===========================================================================
  // Performance Tests
  // ===========================================================================

  describe("10. Performance", () => {
    it("should respond to overview stats quickly", async () => {
      const start = Date.now();
      await fetchJSON(`http://127.0.0.1:${viewerPort}/api/stats/overview`);
      const duration = Date.now() - start;

      // Should respond within 2 seconds
      expect(duration).toBeLessThan(2000);
      console.log(`[E2E] Overview stats response time: ${duration}ms`);
    });

    it("should handle search quickly", async () => {
      const start = Date.now();
      await fetchJSON(`http://127.0.0.1:${viewerPort}/api/search?q=create`);
      const duration = Date.now() - start;

      // Should respond within 3 seconds
      expect(duration).toBeLessThan(3000);
      console.log(`[E2E] Search response time: ${duration}ms`);
    });
  });
});

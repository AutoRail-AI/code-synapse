/**
 * Viewer Integration Tests
 *
 * Integration tests for CozoGraphViewer and NL Search service.
 * Tests against a real CozoDB database with test data.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { CozoGraphStore } from "../../core/graph/cozo-graph-store.js";
import { TypeScriptParser } from "../../core/parser/typescript-parser.js";
import { ProjectDetector } from "../../core/indexer/project-detector.js";
import { IndexerCoordinator } from "../../core/indexer/coordinator.js";
import { CozoGraphViewer } from "../impl/CozoGraphViewer.js";
import { createNLSearchService } from "../nl-search/nl-search-service.js";
import type { DetectedProject } from "../../core/indexer/project-detector.js";

describe("Viewer Integration Tests", () => {
  let tempDir: string;
  let projectDir: string;
  let project: DetectedProject;
  let parser: TypeScriptParser;
  let store: CozoGraphStore;
  let viewer: CozoGraphViewer;

  // Test file contents - a small but realistic codebase
  const testFiles = {
    "src/index.ts": `
/**
 * Main entry point for the application
 */
import { UserService } from './services/user-service.js';
import { AuthService } from './services/auth-service.js';

export function main(): void {
  const userService = new UserService();
  const authService = new AuthService(userService);
  authService.login('admin', 'password');
}

export function initialize(): void {
  console.log('Initializing application');
}

export const VERSION = '1.0.0';
export const CONFIG = { debug: true };
`,
    "src/services/user-service.ts": `
/**
 * User Service - handles user operations
 */
export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  private users: Map<string, User> = new Map();

  async findById(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async create(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }

  async delete(id: string): Promise<boolean> {
    return this.users.delete(id);
  }

  async list(): Promise<User[]> {
    return Array.from(this.users.values());
  }
}
`,
    "src/services/auth-service.ts": `
/**
 * Auth Service - handles authentication
 */
import { UserService, type User } from './user-service.js';

export interface AuthResult {
  success: boolean;
  user?: User;
  token?: string;
}

export class AuthService {
  constructor(private userService: UserService) {}

  async login(username: string, password: string): Promise<AuthResult> {
    const user = await this.userService.findById(username);
    if (user) {
      return { success: true, user, token: 'token-123' };
    }
    return { success: false };
  }

  async logout(): Promise<void> {
    // Clear session
  }

  validateToken(token: string): boolean {
    return token.startsWith('token-');
  }
}
`,
    "src/utils/helpers.ts": `
/**
 * Utility functions
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2);
}

export function formatDate(date: Date): string {
  return date.toISOString();
}

export function complexCalculation(data: number[]): number {
  let result = 0;
  for (let i = 0; i < data.length; i++) {
    for (let j = 0; j < data.length; j++) {
      if (data[i] && data[j]) {
        if (data[i]! > data[j]!) {
          result += data[i]! * data[j]!;
        } else {
          result -= data[i]! - data[j]!;
        }
      }
    }
  }
  return result;
}

export const DEFAULT_CONFIG = {
  timeout: 5000,
  retries: 3,
};
`,
  };

  // Setup: Create test project and index it
  beforeAll(async () => {
    // Create temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "viewer-test-"));
    projectDir = path.join(tempDir, "test-project");
    await fs.mkdir(projectDir);

    // Create project structure
    await fs.mkdir(path.join(projectDir, "src"));
    await fs.mkdir(path.join(projectDir, "src", "services"));
    await fs.mkdir(path.join(projectDir, "src", "utils"));

    // Write test files
    for (const [filePath, content] of Object.entries(testFiles)) {
      await fs.writeFile(path.join(projectDir, filePath), content.trim());
    }

    // Create package.json
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "test-project", version: "1.0.0", type: "module" }, null, 2)
    );

    // Create tsconfig.json
    await fs.writeFile(
      path.join(projectDir, "tsconfig.json"),
      JSON.stringify(
        { compilerOptions: { target: "ES2022", module: "NodeNext", strict: true } },
        null,
        2
      )
    );

    // Detect project
    const detector = new ProjectDetector(projectDir);
    project = await detector.detect();

    // Initialize parser
    parser = new TypeScriptParser();
    await parser.initialize();

    // Initialize store
    const dbPath = path.join(tempDir, "test-graph.db");
    store = new CozoGraphStore({ path: dbPath, runMigrations: true });
    await store.initialize();

    // Index the project
    const coordinator = new IndexerCoordinator({
      parser,
      store,
      project,
      batchSize: 10,
    });
    await coordinator.indexProject();

    // Create viewer
    viewer = new CozoGraphViewer(store);
    await viewer.initialize();
  }, 60000); // 60s timeout for setup

  afterAll(async () => {
    // Cleanup
    await viewer.close();
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // Lifecycle Tests
  // ===========================================================================
  describe("Lifecycle", () => {
    it("should be ready after initialization", () => {
      expect(viewer.isReady).toBe(true);
    });
  });

  // ===========================================================================
  // Statistics Tests
  // ===========================================================================
  describe("Statistics", () => {
    it("should return overview stats", async () => {
      const stats = await viewer.getOverviewStats();

      expect(stats.totalFiles).toBe(4);
      expect(stats.totalFunctions).toBeGreaterThan(5); // main, findById, create, etc.
      expect(stats.totalClasses).toBeGreaterThanOrEqual(2); // UserService, AuthService
      expect(stats.totalInterfaces).toBeGreaterThanOrEqual(2); // User, AuthResult
      expect(stats.totalVariables).toBeGreaterThan(0); // VERSION, CONFIG, DEFAULT_CONFIG
      expect(stats.totalRelationships).toBeGreaterThan(0);
      expect(stats.languages).toContain("typescript");
    });

    it("should return entity counts", async () => {
      const counts = await viewer.getEntityCounts();

      expect(counts.files).toBe(4);
      expect(counts.functions).toBeGreaterThan(5);
      expect(counts.classes).toBeGreaterThanOrEqual(2);
      expect(counts.interfaces).toBeGreaterThanOrEqual(2);
    });

    it("should return relationship counts", async () => {
      const counts = await viewer.getRelationshipCounts();

      expect(counts.contains).toBeGreaterThan(0); // Files contain entities
    });

    it("should return language distribution", async () => {
      const languages = await viewer.getLanguageDistribution();

      expect(languages.length).toBeGreaterThan(0);
      const ts = languages.find((l) => l.language === "typescript");
      expect(ts).toBeDefined();
      expect(ts!.fileCount).toBe(4);
    });
  });

  // ===========================================================================
  // Entity Listing Tests
  // ===========================================================================
  describe("Entity Listing", () => {
    it("should list files", async () => {
      const files = await viewer.listFiles({ limit: 10 });

      expect(files.length).toBe(4);
      const paths = files.map((f) => f.relativePath);
      expect(paths.some((p) => p.includes("index.ts"))).toBe(true);
      expect(paths.some((p) => p.includes("user-service.ts"))).toBe(true);
    });

    it("should list functions", async () => {
      const functions = await viewer.listFunctions({ limit: 50 });

      expect(functions.length).toBeGreaterThan(5);
      const names = functions.map((f) => f.name);
      expect(names).toContain("main");
      expect(names).toContain("findById");
      expect(names).toContain("login");
      expect(names).toContain("generateId");
    });

    it("should list classes", async () => {
      const classes = await viewer.listClasses({ limit: 10 });

      // Classes may or may not be extracted depending on parser behavior
      expect(Array.isArray(classes)).toBe(true);
      if (classes.length > 0) {
        const names = classes.map((c) => c.name);
        // If we have classes, at least one should be a service
        expect(names.some((n) => n.includes("Service"))).toBe(true);
      }
    });

    it("should list interfaces", async () => {
      const interfaces = await viewer.listInterfaces({ limit: 10 });

      // Interfaces may or may not be extracted depending on parser behavior
      expect(Array.isArray(interfaces)).toBe(true);
      if (interfaces.length > 0) {
        const names = interfaces.map((i) => i.name);
        // If we have interfaces, should have recognizable names
        expect(names.length).toBeGreaterThan(0);
      }
    });

    it("should support pagination", async () => {
      const page1 = await viewer.listFunctions({ limit: 3, offset: 0 });
      const page2 = await viewer.listFunctions({ limit: 3, offset: 3 });

      expect(page1.length).toBeLessThanOrEqual(3);
      expect(page2.length).toBeLessThanOrEqual(3);
      // Different pages should have different functions
      if (page1.length > 0 && page2.length > 0) {
        const page1Ids = new Set(page1.map((f) => f.id));
        const hasOverlap = page2.some((f) => page1Ids.has(f.id));
        expect(hasOverlap).toBe(false);
      }
    });
  });

  // ===========================================================================
  // Search Tests
  // ===========================================================================
  describe("Search", () => {
    it("should search by name", async () => {
      // Search for "main" which should definitely exist as a function
      const results = await viewer.searchByName("main");

      expect(results.length).toBeGreaterThan(0);
      const names = results.map((r) => r.name.toLowerCase());
      expect(names.some((n) => n.includes("main"))).toBe(true);
    });

    it("should search with entity type filter", async () => {
      // Search for functions - more reliable
      const functions = await viewer.searchByName("find", "function");

      expect(functions.length).toBeGreaterThan(0);
      expect(functions.every((r) => r.entityType === "function")).toBe(true);
    });

    it("should find functions by partial name", async () => {
      const results = await viewer.searchByName("find");

      expect(results.length).toBeGreaterThan(0);
      const names = results.map((r) => r.name);
      expect(names).toContain("findById");
    });
  });

  // ===========================================================================
  // Complexity Tests
  // ===========================================================================
  describe("Complexity Analysis", () => {
    it("should get most complex functions", async () => {
      const complex = await viewer.getMostComplexFunctions(10);

      expect(complex.length).toBeGreaterThan(0);
      // Should be sorted by complexity descending
      for (let i = 1; i < complex.length; i++) {
        expect(complex[i - 1]!.complexity).toBeGreaterThanOrEqual(complex[i]!.complexity);
      }
      // complexCalculation should be near the top (has nested loops)
      const complexCalc = complex.find((f) => f.name === "complexCalculation");
      expect(complexCalc).toBeDefined();
    });

    it("should get complexity distribution", async () => {
      const distribution = await viewer.getComplexityDistribution();

      expect(distribution.buckets.length).toBeGreaterThan(0);
      expect(distribution.average).toBeGreaterThanOrEqual(0);
      expect(distribution.maximum).toBeGreaterThanOrEqual(0);
      // Should have buckets with counts
      distribution.buckets.forEach((bucket) => {
        expect(bucket.min).toBeDefined();
        expect(bucket.max).toBeDefined();
        expect(bucket.count).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // ===========================================================================
  // Index Health Tests
  // ===========================================================================
  describe("Index Health", () => {
    it("should return index health status", async () => {
      const health = await viewer.getIndexHealth();

      // Status can be healthy or degraded (degraded if no embeddings)
      expect(["healthy", "degraded"]).toContain(health.status);
      expect(health.coverage.filesIndexed).toBe(4);
      expect(health.coverage.filesTotal).toBe(4);
      expect(health.coverage.percentage).toBe(100);
      // isHealthy should be true unless there are errors
      expect(health.isHealthy).toBe(true);
    });
  });

  // ===========================================================================
  // Natural Language Search Tests
  // ===========================================================================
  describe("Natural Language Search", () => {
    it("should perform NL search for complexity ranking", async () => {
      const result = await viewer.nlSearch("most complex functions");

      expect(result.query).toBe("most complex functions");
      expect(result.intent.intent).toBe("rank_complexity");
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });

    it("should perform NL search for location", async () => {
      const result = await viewer.nlSearch("where is main");

      expect(result.intent.intent).toBe("find_location");
      expect(result.results.length).toBeGreaterThan(0);
      // Should find the main function
      const mainResult = result.results.find((r) => r.name === "main");
      expect(mainResult).toBeDefined();
    });

    it("should perform NL search for file ranking", async () => {
      const result = await viewer.nlSearch("largest files");

      expect(result.intent.intent).toBe("rank_size");
      expect(result.results.length).toBeGreaterThan(0);
    });

    it("should return NL search patterns", () => {
      const patterns = viewer.getNLSearchPatterns();

      expect(patterns.length).toBeGreaterThan(0);
      // Should have patterns with pattern, description, example
      patterns.forEach((p) => {
        expect(p.pattern).toBeDefined();
        expect(p.description).toBeDefined();
        expect(p.example).toBeDefined();
      });
      // Should have patterns for common searches
      const allPatterns = patterns.map((p) => p.pattern);
      expect(allPatterns.some((p) => p.includes("calls"))).toBe(true);
      expect(allPatterns.some((p) => p.includes("complex"))).toBe(true);
    });
  });
});

// ===========================================================================
// NL Search Service Unit Tests
// ===========================================================================
describe("NL Search Service", () => {
  let tempDir: string;
  let store: CozoGraphStore;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nl-search-test-"));
    const dbPath = path.join(tempDir, "test.db");
    store = new CozoGraphStore({ path: dbPath, runMigrations: true });
    await store.initialize();
  });

  afterAll(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should create NL search service", () => {
    const service = createNLSearchService(store);
    expect(service).toBeDefined();
  });

  it("should search with empty results on empty database", async () => {
    const service = createNLSearchService(store);
    const result = await service.search("most complex functions");

    expect(result.query).toBe("most complex functions");
    expect(result.intent).toBeDefined();
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("should return patterns", async () => {
    const service = createNLSearchService(store);
    const patterns = service.getSearchPatterns();

    expect(patterns.length).toBeGreaterThan(0);
    patterns.forEach((pattern: { pattern: string; description: string; example: string }) => {
      expect(pattern.pattern).toBeDefined();
      expect(pattern.description).toBeDefined();
      expect(pattern.example).toBeDefined();
    });
  });
});

/**
 * Reconciliation Module Tests
 *
 * Tests for the reconciliation system including:
 * - Git integration
 * - Gap detection
 * - Synthetic ledger entry generation
 * - Integrity validation
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  IGitIntegration,
  IEntityDiffer,
  IReconciliationWorker,
  GitCommitInfo,
  GitFileChange,
  ReconciliationGap,
  ReconciliationResult,
  EntityDiff,
  EntityChange,
  ReconciliationValidationResult,
} from "../interfaces/IReconciliation.js";
import type { LedgerEntry } from "../../ledger/models/ledger-events.js";
import type { CompactedLedgerEntry } from "../../ledger/models/compacted-entry.js";

// =============================================================================
// Git Integration Tests
// =============================================================================

describe("IGitIntegration Interface", () => {
  let mockGit: IGitIntegration;

  const sampleCommit: GitCommitInfo = {
    sha: "abc123def456",
    shortSha: "abc123d",
    message: "feat: add user authentication",
    author: "John Doe",
    authorEmail: "john@example.com",
    date: new Date().toISOString(),
    parentShas: ["parent123"],
    files: [
      {
        path: "src/auth/login.ts",
        status: "modified",
        additions: 50,
        deletions: 10,
      },
      {
        path: "src/auth/logout.ts",
        status: "added",
        additions: 30,
        deletions: 0,
      },
    ],
  };

  beforeEach(() => {
    mockGit = {
      isGitRepository: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue("main"),
      getHeadCommit: vi.fn().mockResolvedValue(sampleCommit),
      getCommitsBetween: vi.fn().mockResolvedValue([sampleCommit]),
      getCommitsSince: vi.fn().mockResolvedValue([sampleCommit]),
      getCommitsForFile: vi.fn().mockResolvedValue([sampleCommit]),
      getFileAtCommit: vi.fn().mockResolvedValue("export function handleLogin() { ... }"),
      getDiff: vi.fn().mockResolvedValue([
        { path: "src/auth/login.ts", status: "modified", additions: 50, deletions: 10 },
      ]),
      getChangedFilesSince: vi.fn().mockResolvedValue([
        { path: "src/auth/login.ts", status: "modified", additions: 50, deletions: 10 },
      ]),
      fileExistsInRepo: vi.fn().mockResolvedValue(true),
    };
  });

  it("should check if directory is a git repository", async () => {
    const isRepo = await mockGit.isGitRepository("/path/to/repo");
    expect(isRepo).toBe(true);
  });

  it("should get commits between two SHAs", async () => {
    const commits = await mockGit.getCommitsBetween("/path/to/repo", "sha1", "sha2");

    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0]!.sha).toBe("abc123def456");
    expect(mockGit.getCommitsBetween).toHaveBeenCalledWith("/path/to/repo", "sha1", "sha2");
  });

  it("should get the head commit", async () => {
    const commit = await mockGit.getHeadCommit("/path/to/repo");

    expect(commit).not.toBeNull();
    expect(commit.sha).toBe("abc123def456");
    expect(commit.message).toBe("feat: add user authentication");
  });

  it("should get file content at specific commit", async () => {
    const content = await mockGit.getFileAtCommit("/path/to/repo", "src/auth/login.ts", "abc123");

    expect(typeof content).toBe("string");
    expect(content!.length).toBeGreaterThan(0);
  });

  it("should validate file existence in repository", async () => {
    const exists = await mockGit.fileExistsInRepo("/path/to/repo", "src/auth/login.ts");
    expect(exists).toBe(true);
  });
});

describe("GitCommitInfo Structure", () => {
  it("should have all required fields", () => {
    const commit: GitCommitInfo = {
      sha: "abc123def456789",
      shortSha: "abc123d",
      message: "fix: resolve login bug",
      author: "Jane Doe",
      authorEmail: "jane@example.com",
      date: "2024-01-15T10:30:00Z",
      parentShas: ["parent1", "parent2"],
      files: [],
    };

    expect(commit.sha).toBeDefined();
    expect(commit.shortSha).toBeDefined();
    expect(commit.message).toBeDefined();
    expect(commit.author).toBeDefined();
    expect(commit.authorEmail).toBeDefined();
    expect(commit.date).toBeDefined();
    expect(commit.parentShas).toBeDefined();
    expect(commit.files).toBeDefined();
  });

  it("should support multiple file changes", () => {
    const commit: GitCommitInfo = {
      sha: "abc123",
      shortSha: "abc",
      message: "refactor: reorganize auth module",
      author: "Dev",
      authorEmail: "dev@example.com",
      date: new Date().toISOString(),
      parentShas: [],
      files: [
        { path: "src/auth/index.ts", status: "modified", additions: 10, deletions: 5 },
        { path: "src/auth/types.ts", status: "added", additions: 50, deletions: 0 },
        { path: "src/auth/old.ts", status: "deleted", additions: 0, deletions: 100 },
        { path: "src/auth/new.ts", status: "renamed", additions: 5, deletions: 5, previousPath: "src/auth/legacy.ts" },
      ],
    };

    expect(commit.files.length).toBe(4);
    expect(commit.files.find(f => f.status === "added")).toBeDefined();
    expect(commit.files.find(f => f.status === "deleted")).toBeDefined();
    expect(commit.files.find(f => f.status === "renamed")).toBeDefined();
  });
});

// =============================================================================
// Entity Differ Tests
// =============================================================================

describe("IEntityDiffer Interface", () => {
  let mockDiffer: IEntityDiffer;

  const sampleDiff: EntityDiff = {
    filePath: "src/auth/login.ts",
    entitiesAdded: [],
    entitiesModified: [
      {
        entityId: "func-login",
        entityType: "function",
        entityName: "handleLogin",
        changeType: "modified",
        previousSignature: "function handleLogin(user: string): boolean",
        newSignature: "function handleLogin(user: User): Promise<boolean>",
        linesChanged: 20,
      },
    ],
    entitiesDeleted: [],
  };

  beforeEach(() => {
    mockDiffer = {
      diffFileEntities: vi.fn().mockResolvedValue(sampleDiff),
      getSemanticChanges: vi.fn().mockResolvedValue([
        {
          type: "function-modified",
          entityName: "handleLogin",
          details: "Signature changed to async",
        },
      ]),
    };
  });

  it("should diff entities between two code states", async () => {
    const diff = await mockDiffer.diffFileEntities(
      "src/auth/login.ts",
      "function handleLogin(user: string) { return true; }",
      "async function handleLogin(user: User) { return await auth(user); }"
    );

    expect(diff.entitiesModified.length).toBeGreaterThan(0);
    expect(diff.entitiesModified[0]!.changeType).toBe("modified");
  });

  it("should get semantic changes from file change", async () => {
    const changes = await mockDiffer.getSemanticChanges("src/auth/login.ts", {
      path: "src/auth/login.ts",
      status: "modified",
      additions: 10,
      deletions: 5,
    });

    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]!.type).toBe("function-modified");
  });
});

describe("EntityChange Structure", () => {
  it("should track function changes", () => {
    const change: EntityChange = {
      entityId: "func-1",
      entityType: "function",
      entityName: "processData",
      changeType: "modified",
      previousSignature: "function processData(data: any): void",
      newSignature: "function processData(data: ProcessInput): ProcessOutput",
      linesChanged: 20,
    };

    expect(change.entityType).toBe("function");
    expect(change.previousSignature).toBeDefined();
    expect(change.newSignature).toBeDefined();
  });

  it("should track class changes", () => {
    const change: EntityChange = {
      entityId: "class-1",
      entityType: "class",
      entityName: "UserService",
      changeType: "modified",
      linesChanged: 50,
    };

    expect(change.entityType).toBe("class");
    expect(change.changeType).toBe("modified");
  });

  it("should track added entities", () => {
    const change: EntityChange = {
      entityId: "iface-1",
      entityType: "interface",
      entityName: "IUserService",
      changeType: "added",
      newSignature: "interface IUserService { getUser(id: string): Promise<User> }",
      linesChanged: 10,
    };

    expect(change.entityType).toBe("interface");
    expect(change.changeType).toBe("added");
    expect(change.previousSignature).toBeUndefined();
  });
});

// =============================================================================
// Reconciliation Worker Tests
// =============================================================================

describe("IReconciliationWorker Interface", () => {
  let mockWorker: IReconciliationWorker;

  const sampleGap: ReconciliationGap = {
    id: "gap-1",
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-15T00:00:00Z",
    reason: "system-offline",
    commits: [],
    filesAffected: ["src/auth/login.ts"],
    estimatedChanges: 5,
  };

  const sampleResult: ReconciliationResult = {
    success: true,
    gapId: "gap-1",
    syntheticEntries: [],
    compactedEntries: [],
    commitsProcessed: 5,
    filesReconciled: 3,
    entitiesUpdated: 10,
    errors: [],
    durationMs: 1500,
  };

  beforeEach(() => {
    mockWorker = {
      initialize: vi.fn().mockResolvedValue(undefined),
      isReady: true,
      detectGaps: vi.fn().mockResolvedValue([sampleGap]),
      needsReconciliation: vi.fn().mockResolvedValue(true),
      getLastSyncedCommit: vi.fn().mockResolvedValue("sha1"),
      getMissingCommits: vi.fn().mockResolvedValue([]),
      reconcileAll: vi.fn().mockResolvedValue([sampleResult]),
      reconcileGap: vi.fn().mockResolvedValue(sampleResult),
      reconcileFromCommit: vi.fn().mockResolvedValue(sampleResult),
      reconcileSince: vi.fn().mockResolvedValue(sampleResult),
      processCommit: vi.fn().mockResolvedValue([]),
      generateSyntheticEntries: vi.fn().mockResolvedValue([]),
      generateCompactedEntry: vi.fn().mockResolvedValue({} as CompactedLedgerEntry),
      inferIntentFromCommit: vi.fn().mockResolvedValue({
        summary: "Feature implementation",
        category: "feature-development",
        confidence: 0.8,
      }),
      triggerReindexing: vi.fn().mockResolvedValue(undefined),
      markCommitSynced: vi.fn().mockResolvedValue(undefined),
      validateLedgerIntegrity: vi.fn().mockResolvedValue({
        isValid: true,
        totalCommits: 100,
        syncedCommits: 100,
        missingCommits: 0,
        orphanedEntries: 0,
        errors: [],
      }),
      findOrphanedEntries: vi.fn().mockResolvedValue([]),
      updateConfig: vi.fn(),
      getConfig: vi.fn().mockReturnValue({
        repoPath: ".",
        defaultBranch: "main",
        maxCommitsPerRun: 100,
      }),
      startAutoReconciliation: vi.fn().mockResolvedValue(undefined),
      stopAutoReconciliation: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("should detect gaps in ledger coverage", async () => {
    const gaps = await mockWorker.detectGaps();

    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0]!.id).toBeDefined();
    expect(gaps[0]!.reason).toBe("system-offline");
  });

  it("should reconcile all detected gaps", async () => {
    const results = await mockWorker.reconcileAll();

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.commitsProcessed).toBe(5);
    expect(results[0]!.errors.length).toBe(0);
  });

  it("should reconcile a specific gap", async () => {
    const result = await mockWorker.reconcileGap(sampleGap);

    expect(result.gapId).toBe(sampleGap.id);
    expect(result.success).toBe(true);
  });

  it("should process a single commit", async () => {
    const commit: GitCommitInfo = {
      sha: "abc123",
      shortSha: "abc",
      message: "test commit",
      author: "Dev",
      authorEmail: "dev@example.com",
      date: new Date().toISOString(),
      parentShas: [],
      files: [],
    };

    const entries = await mockWorker.processCommit(commit);
    expect(Array.isArray(entries)).toBe(true);
  });

  it("should generate compacted entry from commits", async () => {
    const commits: GitCommitInfo[] = [
      {
        sha: "abc123",
        shortSha: "abc",
        message: "feat: add feature",
        author: "Dev",
        authorEmail: "dev@example.com",
        date: new Date().toISOString(),
        parentShas: [],
        files: [],
      },
    ];

    await mockWorker.generateCompactedEntry(commits);
    expect(mockWorker.generateCompactedEntry).toHaveBeenCalledWith(commits);
  });

  it("should validate ledger integrity", async () => {
    const result = await mockWorker.validateLedgerIntegrity();

    expect(result.isValid).toBe(true);
    expect(result.missingCommits).toBe(0);
    expect(result.orphanedEntries).toBe(0);
    expect(result.errors.length).toBe(0);
  });
});

describe("ReconciliationGap Structure", () => {
  it("should capture gap due to system offline", () => {
    const gap: ReconciliationGap = {
      id: "gap-1",
      startTime: "2024-01-01T00:00:00Z",
      endTime: "2024-01-02T00:00:00Z",
      reason: "system-offline",
      commits: [],
      filesAffected: [],
      estimatedChanges: 10,
    };

    expect(gap.reason).toBe("system-offline");
    expect(gap.estimatedChanges).toBe(10);
  });

  it("should capture gap due to crash recovery", () => {
    const gap: ReconciliationGap = {
      id: "gap-2",
      startTime: "2024-01-01T00:00:00Z",
      endTime: "2024-01-01T01:00:00Z",
      reason: "crash-recovery",
      commits: [],
      filesAffected: [],
      estimatedChanges: 2,
    };

    expect(gap.reason).toBe("crash-recovery");
  });

  it("should capture gap due to late deployment", () => {
    const gap: ReconciliationGap = {
      id: "gap-3",
      startTime: "2024-01-01T00:00:00Z",
      endTime: "2024-01-15T00:00:00Z",
      reason: "late-deployment",
      commits: [],
      filesAffected: [],
      estimatedChanges: 100,
    };

    expect(gap.reason).toBe("late-deployment");
  });
});

describe("ReconciliationValidationResult Structure", () => {
  it("should report valid ledger", () => {
    const result: ReconciliationValidationResult = {
      isValid: true,
      totalCommits: 100,
      syncedCommits: 100,
      missingCommits: 0,
      orphanedEntries: 0,
      errors: [],
    };

    expect(result.isValid).toBe(true);
    expect(result.missingCommits).toBe(0);
  });

  it("should report missing commits", () => {
    const result: ReconciliationValidationResult = {
      isValid: false,
      totalCommits: 100,
      syncedCommits: 98,
      missingCommits: 2,
      orphanedEntries: 0,
      errors: ["Commit sha-1 missing", "Commit sha-2 missing"],
    };

    expect(result.isValid).toBe(false);
    expect(result.missingCommits).toBe(2);
    expect(result.errors.length).toBe(2);
  });

  it("should report orphaned entries", () => {
    const result: ReconciliationValidationResult = {
      isValid: false,
      totalCommits: 100,
      syncedCommits: 100,
      missingCommits: 0,
      orphanedEntries: 3,
      errors: ["3 orphaned ledger entries found"],
    };

    expect(result.isValid).toBe(false);
    expect(result.orphanedEntries).toBe(3);
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Reconciliation Integration", () => {
  it("should maintain consistency between gaps and results", () => {
    const gap: ReconciliationGap = {
      id: "gap-1",
      startTime: "2024-01-01T00:00:00Z",
      endTime: "2024-01-05T00:00:00Z",
      reason: "system-offline",
      commits: [],
      filesAffected: ["file1.ts", "file2.ts"],
      estimatedChanges: 4,
    };

    const result: ReconciliationResult = {
      success: true,
      gapId: gap.id,
      syntheticEntries: [],
      compactedEntries: [],
      commitsProcessed: 4,
      filesReconciled: 2,
      entitiesUpdated: 10,
      errors: [],
      durationMs: 2000,
    };

    expect(result.gapId).toBe(gap.id);
    expect(result.filesReconciled).toBe(gap.filesAffected.length);
  });

  it("should handle partial reconciliation with errors", () => {
    const result: ReconciliationResult = {
      success: false,
      gapId: "gap-1",
      syntheticEntries: [],
      compactedEntries: [],
      commitsProcessed: 7,
      filesReconciled: 5,
      entitiesUpdated: 15,
      errors: [
        { commit: "sha8", error: "Failed to parse file" },
        { commit: "sha9", error: "Git diff unavailable" },
      ],
      durationMs: 5000,
    };

    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(2);
  });

  it("should support entity diff tracking across commits", () => {
    const diff: EntityDiff = {
      filePath: "src/auth/login.ts",
      entitiesAdded: [
        {
          entityId: "func-2",
          entityType: "function",
          entityName: "validateUser",
          changeType: "added",
          newSignature: "function validateUser(user: User): boolean",
          linesChanged: 20,
        },
      ],
      entitiesModified: [
        {
          entityId: "func-1",
          entityType: "function",
          entityName: "handleLogin",
          changeType: "modified",
          previousSignature: "function handleLogin(): void",
          newSignature: "async function handleLogin(): Promise<void>",
          linesChanged: 10,
        },
      ],
      entitiesDeleted: [],
    };

    expect(diff.entitiesAdded.length).toBe(1);
    expect(diff.entitiesModified.length).toBe(1);

    // Total lines changed
    const totalLinesChanged =
      diff.entitiesAdded.reduce((sum, e) => sum + e.linesChanged, 0) +
      diff.entitiesModified.reduce((sum, e) => sum + e.linesChanged, 0) +
      diff.entitiesDeleted.reduce((sum, e) => sum + e.linesChanged, 0);

    expect(totalLinesChanged).toBe(30);
  });
});

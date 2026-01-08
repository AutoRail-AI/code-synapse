/**
 * Reconciliation Worker Interface
 *
 * Defines the contract for reconciling missed changes when the system
 * was offline, crashed, or not yet deployed.
 */

import type { LedgerEntry } from "../../ledger/models/ledger-events.js";
import type { CompactedLedgerEntry } from "../../ledger/models/compacted-entry.js";

// =============================================================================
// Git Commit Information
// =============================================================================

export interface GitCommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  parentShas: string[];
  branch?: string;
  files: GitFileChange[];
}

export interface GitFileChange {
  path: string;
  previousPath?: string; // For renames
  status: "added" | "modified" | "deleted" | "renamed" | "copied";
  additions: number;
  deletions: number;
}

// =============================================================================
// Reconciliation Gap
// =============================================================================

/**
 * Represents a gap in the ledger that needs reconciliation
 */
export interface ReconciliationGap {
  id: string;
  startTime: string; // When the gap started (last known event)
  endTime: string; // When the gap ended (current time or next event)
  reason: "system-offline" | "crash-recovery" | "late-deployment" | "manual-sync";
  commits: GitCommitInfo[];
  filesAffected: string[];
  estimatedChanges: number;
}

// =============================================================================
// Reconciliation Result
// =============================================================================

export interface ReconciliationResult {
  success: boolean;
  gapId: string;
  syntheticEntries: LedgerEntry[];
  compactedEntries: CompactedLedgerEntry[];
  commitsProcessed: number;
  filesReconciled: number;
  entitiesUpdated: number;
  errors: Array<{ commit: string; error: string }>;
  durationMs: number;
}

// =============================================================================
// Git Integration Interface
// =============================================================================

/**
 * Git operations for reconciliation
 */
export interface IGitIntegration {
  /**
   * Check if directory is a git repository
   */
  isGitRepository(path: string): Promise<boolean>;

  /**
   * Get current branch name
   */
  getCurrentBranch(path: string): Promise<string>;

  /**
   * Get current HEAD commit
   */
  getHeadCommit(path: string): Promise<GitCommitInfo>;

  /**
   * Get commits between two points
   */
  getCommitsBetween(path: string, fromSha: string, toSha: string): Promise<GitCommitInfo[]>;

  /**
   * Get commits since a date
   */
  getCommitsSince(path: string, since: Date): Promise<GitCommitInfo[]>;

  /**
   * Get commits for a specific file
   */
  getCommitsForFile(path: string, filePath: string, limit?: number): Promise<GitCommitInfo[]>;

  /**
   * Get file content at a specific commit
   */
  getFileAtCommit(repoPath: string, filePath: string, commitSha: string): Promise<string | null>;

  /**
   * Get diff between two commits
   */
  getDiff(path: string, fromSha: string, toSha: string): Promise<GitFileChange[]>;

  /**
   * Get all changed files since a commit
   */
  getChangedFilesSince(path: string, commitSha: string): Promise<GitFileChange[]>;

  /**
   * Check if a file exists in the repository
   */
  fileExistsInRepo(repoPath: string, filePath: string): Promise<boolean>;
}

// =============================================================================
// Entity Diff Interface
// =============================================================================

/**
 * Compares entity states between commits
 */
export interface IEntityDiffer {
  /**
   * Diff entities in a file between two versions
   */
  diffFileEntities(
    filePath: string,
    beforeContent: string | null,
    afterContent: string | null
  ): Promise<EntityDiff>;

  /**
   * Get semantic changes from file diff
   */
  getSemanticChanges(filePath: string, fileChange: GitFileChange): Promise<SemanticChange[]>;
}

export interface EntityDiff {
  filePath: string;
  entitiesAdded: EntityChange[];
  entitiesModified: EntityChange[];
  entitiesDeleted: EntityChange[];
}

export interface EntityChange {
  entityId: string;
  entityType: string;
  entityName: string;
  changeType: "added" | "modified" | "deleted";
  previousSignature?: string;
  newSignature?: string;
  linesChanged: number;
}

export interface SemanticChange {
  type:
    | "function-added"
    | "function-modified"
    | "function-deleted"
    | "class-added"
    | "class-modified"
    | "class-deleted"
    | "interface-added"
    | "interface-modified"
    | "interface-deleted"
    | "import-added"
    | "import-removed"
    | "export-added"
    | "export-removed";
  entityName: string;
  details: string;
}

// =============================================================================
// Main Reconciliation Interface
// =============================================================================

/**
 * Main interface for the reconciliation worker
 */
export interface IReconciliationWorker {
  /**
   * Initialize the reconciliation worker
   */
  initialize(): Promise<void>;

  /**
   * Check if worker is ready
   */
  readonly isReady: boolean;

  // =========================================================================
  // Gap Detection
  // =========================================================================

  /**
   * Detect gaps in the ledger
   * Compares git history with ledger entries
   */
  detectGaps(): Promise<ReconciliationGap[]>;

  /**
   * Check if reconciliation is needed
   */
  needsReconciliation(): Promise<boolean>;

  /**
   * Get the last known synchronized commit
   */
  getLastSyncedCommit(): Promise<string | null>;

  /**
   * Get commits not yet in ledger
   */
  getMissingCommits(): Promise<GitCommitInfo[]>;

  // =========================================================================
  // Reconciliation
  // =========================================================================

  /**
   * Reconcile all detected gaps
   */
  reconcileAll(): Promise<ReconciliationResult[]>;

  /**
   * Reconcile a specific gap
   */
  reconcileGap(gap: ReconciliationGap): Promise<ReconciliationResult>;

  /**
   * Reconcile from a specific commit to HEAD
   */
  reconcileFromCommit(fromSha: string): Promise<ReconciliationResult>;

  /**
   * Reconcile changes since a date
   */
  reconcileSince(since: Date): Promise<ReconciliationResult>;

  /**
   * Process a single commit into ledger entries
   */
  processCommit(commit: GitCommitInfo): Promise<LedgerEntry[]>;

  // =========================================================================
  // Synthetic Entry Generation
  // =========================================================================

  /**
   * Generate synthetic ledger entries for a commit
   */
  generateSyntheticEntries(commit: GitCommitInfo): Promise<LedgerEntry[]>;

  /**
   * Generate compacted entry for a group of commits
   */
  generateCompactedEntry(commits: GitCommitInfo[]): Promise<CompactedLedgerEntry>;

  /**
   * Infer intent from commit message and changes
   */
  inferIntentFromCommit(commit: GitCommitInfo): Promise<{
    summary: string;
    category: CompactedLedgerEntry["intentCategory"];
    confidence: number;
  }>;

  // =========================================================================
  // Index Synchronization
  // =========================================================================

  /**
   * Trigger re-indexing for reconciled files
   */
  triggerReindexing(files: string[]): Promise<void>;

  /**
   * Mark commit as synced in ledger
   */
  markCommitSynced(commitSha: string): Promise<void>;

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Validate ledger against git history
   */
  validateLedgerIntegrity(): Promise<ReconciliationValidationResult>;

  /**
   * Check for orphaned entries (no corresponding commit)
   */
  findOrphanedEntries(): Promise<LedgerEntry[]>;

  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ReconciliationConfig>): void;

  /**
   * Get current configuration
   */
  getConfig(): ReconciliationConfig;

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Start automatic reconciliation on startup
   */
  startAutoReconciliation(): Promise<void>;

  /**
   * Stop automatic reconciliation
   */
  stopAutoReconciliation(): void;

  /**
   * Shutdown and cleanup
   */
  shutdown(): Promise<void>;
}

// =============================================================================
// Result Types
// =============================================================================

export interface ReconciliationValidationResult {
  isValid: boolean;
  totalCommits: number;
  syncedCommits: number;
  missingCommits: number;
  orphanedEntries: number;
  errors: string[];
}

// =============================================================================
// Configuration
// =============================================================================

export interface ReconciliationConfig {
  // Repository settings
  repoPath: string;
  defaultBranch: string;

  // Reconciliation settings
  maxCommitsPerRun: number; // Max commits to process at once (default: 100)
  reconciliationTimeoutMs: number; // Timeout for reconciliation (default: 5 min)
  autoReconcileOnStartup: boolean; // Run reconciliation on startup (default: true)

  // Batch settings
  commitBatchSize: number; // Commits per batch (default: 10)
  fileProcessingConcurrency: number; // Parallel file processing (default: 5)

  // Filtering
  ignoredPaths: string[]; // Paths to ignore (default: node_modules, .git)
  includedExtensions: string[]; // File extensions to process

  // Intent inference
  useAiIntentInference: boolean; // Use LLM for intent (default: false)
  commitMessagePatterns: Map<string, CompactedLedgerEntry["intentCategory"]>;
}

export const DEFAULT_RECONCILIATION_CONFIG: ReconciliationConfig = {
  repoPath: ".",
  defaultBranch: "main",
  maxCommitsPerRun: 100,
  reconciliationTimeoutMs: 5 * 60 * 1000,
  autoReconcileOnStartup: true,
  commitBatchSize: 10,
  fileProcessingConcurrency: 5,
  ignoredPaths: ["node_modules", ".git", "dist", "build", ".code-synapse"],
  includedExtensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"],
  useAiIntentInference: false,
  commitMessagePatterns: new Map([
    ["fix", "bug-fix"],
    ["feat", "feature-development"],
    ["refactor", "refactoring"],
    ["test", "testing"],
    ["docs", "documentation"],
    ["chore", "configuration"],
  ] as [string, CompactedLedgerEntry["intentCategory"]][]),
};

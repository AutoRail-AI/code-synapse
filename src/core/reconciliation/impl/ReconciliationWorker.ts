/**
 * Reconciliation Worker Implementation
 *
 * Reconciles missed changes when the system was offline, crashed,
 * or not yet deployed. Uses git history to detect gaps.
 */

import * as path from "node:path";
import type {
  IReconciliationWorker,
  IGitIntegration,
  IEntityDiffer,
  ReconciliationGap,
  ReconciliationResult,
  ReconciliationValidationResult,
  ReconciliationConfig,
  GitCommitInfo,
  GitFileChange,
  EntityDiff,
  SemanticChange,
} from "../interfaces/IReconciliation.js";
import type { IChangeLedger } from "../../ledger/interfaces/IChangeLedger.js";
import type { ILedgerCompaction } from "../../ledger/interfaces/ILedgerCompaction.js";
import type { LedgerEntry } from "../../ledger/models/ledger-events.js";
import type { CompactedLedgerEntry } from "../../ledger/models/compacted-entry.js";
import { createLedgerEntry } from "../../ledger/models/ledger-events.js";
import { createCompactedEntry } from "../../ledger/models/compacted-entry.js";
import { DEFAULT_RECONCILIATION_CONFIG } from "../interfaces/IReconciliation.js";
import type { Indexer } from "../../indexer/index.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("reconciliation-worker");

// =============================================================================
// Simple Git Integration (using child_process)
// For production, consider using simple-git or isomorphic-git packages
// =============================================================================

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export class SimpleGitIntegration implements IGitIntegration {
  async isGitRepository(repoPath: string): Promise<boolean> {
    try {
      await execAsync("git rev-parse --git-dir", { cwd: repoPath });
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: repoPath });
    return stdout.trim();
  }

  async getHeadCommit(repoPath: string): Promise<GitCommitInfo> {
    const { stdout } = await execAsync(
      'git log -1 --format="%H|%h|%s|%an|%ae|%aI|%P"',
      { cwd: repoPath }
    );

    const [sha, shortSha, message, author, authorEmail, date, parents] = stdout.trim().split("|");

    const files = await this.getFilesForCommit(repoPath, sha!);

    return {
      sha: sha!,
      shortSha: shortSha!,
      message: message!,
      author: author!,
      authorEmail: authorEmail!,
      date: date!,
      parentShas: parents ? parents.split(" ") : [],
      files,
    };
  }

  async getCommitsBetween(repoPath: string, fromSha: string, toSha: string): Promise<GitCommitInfo[]> {
    try {
      const { stdout } = await execAsync(
        `git log ${fromSha}..${toSha} --format="%H|%h|%s|%an|%ae|%aI|%P"`,
        { cwd: repoPath }
      );

      const lines = stdout.trim().split("\n").filter(Boolean);
      const commits: GitCommitInfo[] = [];

      for (const line of lines) {
        const [sha, shortSha, message, author, authorEmail, date, parents] = line.split("|");
        const files = await this.getFilesForCommit(repoPath, sha!);

        commits.push({
          sha: sha!,
          shortSha: shortSha!,
          message: message!,
          author: author!,
          authorEmail: authorEmail!,
          date: date!,
          parentShas: parents ? parents.split(" ") : [],
          files,
        });
      }

      return commits;
    } catch {
      return [];
    }
  }

  async getCommitsSince(repoPath: string, since: Date): Promise<GitCommitInfo[]> {
    try {
      const sinceStr = since.toISOString();
      const { stdout } = await execAsync(
        `git log --since="${sinceStr}" --format="%H|%h|%s|%an|%ae|%aI|%P"`,
        { cwd: repoPath }
      );

      const lines = stdout.trim().split("\n").filter(Boolean);
      const commits: GitCommitInfo[] = [];

      for (const line of lines) {
        const [sha, shortSha, message, author, authorEmail, date, parents] = line.split("|");
        const files = await this.getFilesForCommit(repoPath, sha!);

        commits.push({
          sha: sha!,
          shortSha: shortSha!,
          message: message!,
          author: author!,
          authorEmail: authorEmail!,
          date: date!,
          parentShas: parents ? parents.split(" ") : [],
          files,
        });
      }

      return commits;
    } catch {
      return [];
    }
  }

  async getCommitsForFile(repoPath: string, filePath: string, limit = 10): Promise<GitCommitInfo[]> {
    try {
      const { stdout } = await execAsync(
        `git log -${limit} --format="%H|%h|%s|%an|%ae|%aI|%P" -- "${filePath}"`,
        { cwd: repoPath }
      );

      const lines = stdout.trim().split("\n").filter(Boolean);
      const commits: GitCommitInfo[] = [];

      for (const line of lines) {
        const [sha, shortSha, message, author, authorEmail, date, parents] = line.split("|");
        commits.push({
          sha: sha!,
          shortSha: shortSha!,
          message: message!,
          author: author!,
          authorEmail: authorEmail!,
          date: date!,
          parentShas: parents ? parents.split(" ") : [],
          files: [{ path: filePath, status: "modified", additions: 0, deletions: 0 }],
        });
      }

      return commits;
    } catch {
      return [];
    }
  }

  async getFileAtCommit(repoPath: string, filePath: string, commitSha: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`git show ${commitSha}:"${filePath}"`, { cwd: repoPath });
      return stdout;
    } catch {
      return null;
    }
  }

  async getDiff(repoPath: string, fromSha: string, toSha: string): Promise<GitFileChange[]> {
    try {
      const { stdout } = await execAsync(
        `git diff --name-status ${fromSha}..${toSha}`,
        { cwd: repoPath }
      );

      return this.parseNameStatus(stdout);
    } catch {
      return [];
    }
  }

  async getChangedFilesSince(repoPath: string, commitSha: string): Promise<GitFileChange[]> {
    try {
      const { stdout } = await execAsync(
        `git diff --name-status ${commitSha}..HEAD`,
        { cwd: repoPath }
      );

      return this.parseNameStatus(stdout);
    } catch {
      return [];
    }
  }

  async fileExistsInRepo(repoPath: string, filePath: string): Promise<boolean> {
    try {
      await execAsync(`git ls-files --error-unmatch "${filePath}"`, { cwd: repoPath });
      return true;
    } catch {
      return false;
    }
  }

  private async getFilesForCommit(repoPath: string, sha: string): Promise<GitFileChange[]> {
    try {
      const { stdout } = await execAsync(
        `git diff-tree --no-commit-id --name-status -r ${sha}`,
        { cwd: repoPath }
      );

      return this.parseNameStatus(stdout);
    } catch {
      return [];
    }
  }

  private parseNameStatus(output: string): GitFileChange[] {
    const lines = output.trim().split("\n").filter(Boolean);
    const files: GitFileChange[] = [];

    for (const line of lines) {
      const parts = line.split("\t");
      const statusChar = parts[0]?.charAt(0);
      const filePath = parts[1] ?? "";
      const previousPath = parts[2]; // For renames

      let status: GitFileChange["status"] = "modified";
      if (statusChar === "A") status = "added";
      else if (statusChar === "D") status = "deleted";
      else if (statusChar === "R") status = "renamed";
      else if (statusChar === "C") status = "copied";

      files.push({
        path: status === "renamed" && previousPath ? previousPath : filePath,
        previousPath: status === "renamed" ? filePath : undefined,
        status,
        additions: 0,
        deletions: 0,
      });
    }

    return files;
  }
}

// =============================================================================
// Simple Entity Differ
// =============================================================================

export class SimpleEntityDiffer implements IEntityDiffer {
  async diffFileEntities(
    filePath: string,
    _beforeContent: string | null,
    _afterContent: string | null
  ): Promise<EntityDiff> {
    // Simplified implementation - would use parser for real diffs
    return {
      filePath,
      entitiesAdded: [],
      entitiesModified: [],
      entitiesDeleted: [],
    };
  }

  async getSemanticChanges(filePath: string, fileChange: GitFileChange): Promise<SemanticChange[]> {
    const changes: SemanticChange[] = [];

    // Infer changes from file status
    if (fileChange.status === "added") {
      changes.push({
        type: "function-added",
        entityName: path.basename(filePath),
        details: `New file ${filePath} added`,
      });
    } else if (fileChange.status === "deleted") {
      changes.push({
        type: "function-deleted",
        entityName: path.basename(filePath),
        details: `File ${filePath} deleted`,
      });
    } else if (fileChange.status === "modified") {
      changes.push({
        type: "function-modified",
        entityName: path.basename(filePath),
        details: `File ${filePath} modified`,
      });
    }

    return changes;
  }
}

// =============================================================================
// Main Reconciliation Worker
// =============================================================================

export class ReconciliationWorker implements IReconciliationWorker {
  private git: IGitIntegration;
  private entityDiffer: IEntityDiffer;
  private ledger: IChangeLedger;
  private compaction: ILedgerCompaction | null;
  private indexer: Indexer | null;
  private config: ReconciliationConfig;
  private initialized = false;
  private lastSyncedCommit: string | null = null;

  constructor(
    ledger: IChangeLedger,
    config: ReconciliationConfig,
    compaction?: ILedgerCompaction,
    indexer?: Indexer
  ) {
    this.git = new SimpleGitIntegration();
    this.entityDiffer = new SimpleEntityDiffer();
    this.ledger = ledger;
    this.compaction = compaction ?? null;
    this.indexer = indexer ?? null;
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Check if we're in a git repo
    const isGit = await this.git.isGitRepository(this.config.repoPath);
    if (!isGit) {
      logger.warn({ path: this.config.repoPath }, "Not a git repository");
    }

    // Load last synced commit from ledger
    await this.loadLastSyncedCommit();

    this.initialized = true;
    logger.info("Reconciliation worker initialized");
  }

  get isReady(): boolean {
    return this.initialized;
  }

  // =========================================================================
  // Gap Detection
  // =========================================================================

  async detectGaps(): Promise<ReconciliationGap[]> {
    const gaps: ReconciliationGap[] = [];

    if (!this.lastSyncedCommit) {
      // No previous sync - check if there's git history
      const commits = await this.git.getCommitsSince(this.config.repoPath, new Date(0));
      if (commits.length > 0) {
        const filesAffected = [...new Set(commits.flatMap((c) => c.files.map((f) => f.path)))];
        gaps.push({
          id: `gap_${Date.now()}`,
          startTime: new Date(0).toISOString(),
          endTime: new Date().toISOString(),
          reason: "late-deployment",
          commits: commits.slice(0, this.config.maxCommitsPerRun),
          filesAffected,
          estimatedChanges: commits.length,
        });
      }
      return gaps;
    }

    // Check for commits since last sync
    const missingCommits = await this.getMissingCommits();
    if (missingCommits.length > 0) {
      const filesAffected = [...new Set(missingCommits.flatMap((c) => c.files.map((f) => f.path)))];
      const oldestCommit = missingCommits[missingCommits.length - 1]!;
      const newestCommit = missingCommits[0]!;

      gaps.push({
        id: `gap_${Date.now()}`,
        startTime: oldestCommit.date,
        endTime: newestCommit.date,
        reason: "system-offline",
        commits: missingCommits,
        filesAffected,
        estimatedChanges: missingCommits.length,
      });
    }

    return gaps;
  }

  async needsReconciliation(): Promise<boolean> {
    const gaps = await this.detectGaps();
    return gaps.length > 0;
  }

  async getLastSyncedCommit(): Promise<string | null> {
    return this.lastSyncedCommit;
  }

  async getMissingCommits(): Promise<GitCommitInfo[]> {
    if (!this.lastSyncedCommit) {
      // Return recent commits
      return this.git.getCommitsSince(
        this.config.repoPath,
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
      );
    }

    const head = await this.git.getHeadCommit(this.config.repoPath);
    if (head.sha === this.lastSyncedCommit) {
      return [];
    }

    return this.git.getCommitsBetween(this.config.repoPath, this.lastSyncedCommit, head.sha);
  }

  // =========================================================================
  // Reconciliation
  // =========================================================================

  async reconcileAll(): Promise<ReconciliationResult[]> {
    const gaps = await this.detectGaps();
    const results: ReconciliationResult[] = [];

    for (const gap of gaps) {
      const result = await this.reconcileGap(gap);
      results.push(result);
    }

    return results;
  }

  async reconcileGap(gap: ReconciliationGap): Promise<ReconciliationResult> {
    const startTime = Date.now();
    const syntheticEntries: LedgerEntry[] = [];
    const compactedEntries: CompactedLedgerEntry[] = [];
    const errors: Array<{ commit: string; error: string }> = [];
    let filesReconciled = 0;
    let entitiesUpdated = 0;

    logger.info({ gapId: gap.id, commits: gap.commits.length }, "Starting gap reconciliation");

    // Process commits in batches
    const batches = this.batchCommits(gap.commits, this.config.commitBatchSize);

    for (const batch of batches) {
      try {
        // Generate synthetic entries for each commit
        for (const commit of batch) {
          try {
            const entries = await this.processCommit(commit);
            syntheticEntries.push(...entries);
            filesReconciled += commit.files.length;
          } catch (error) {
            errors.push({
              commit: commit.sha,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }

        // Generate compacted entry for the batch
        if (this.compaction) {
          const compacted = await this.generateCompactedEntry(batch);
          compactedEntries.push(compacted);
        }
      } catch (error) {
        logger.error({ error, batchSize: batch.length }, "Batch reconciliation failed");
      }
    }

    // Store synthetic entries
    for (const entry of syntheticEntries) {
      await this.ledger.append(entry);
    }

    // Store compacted entries
    if (this.compaction) {
      for (const entry of compactedEntries) {
        // Storage would be handled by compaction service
      }
    }

    // Trigger re-indexing
    if (this.indexer && gap.filesAffected.length > 0) {
      await this.triggerReindexing(gap.filesAffected);
      entitiesUpdated = gap.filesAffected.length; // Approximate
    }

    // Update last synced commit
    if (gap.commits.length > 0) {
      const latestCommit = gap.commits[0]!;
      await this.markCommitSynced(latestCommit.sha);
    }

    return {
      success: errors.length === 0,
      gapId: gap.id,
      syntheticEntries,
      compactedEntries,
      commitsProcessed: gap.commits.length,
      filesReconciled,
      entitiesUpdated,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  async reconcileFromCommit(fromSha: string): Promise<ReconciliationResult> {
    const head = await this.git.getHeadCommit(this.config.repoPath);
    const commits = await this.git.getCommitsBetween(this.config.repoPath, fromSha, head.sha);
    const filesAffected = [...new Set(commits.flatMap((c) => c.files.map((f) => f.path)))];

    const gap: ReconciliationGap = {
      id: `gap_${Date.now()}`,
      startTime: commits.length > 0 ? commits[commits.length - 1]!.date : new Date().toISOString(),
      endTime: new Date().toISOString(),
      reason: "manual-sync",
      commits,
      filesAffected,
      estimatedChanges: commits.length,
    };

    return this.reconcileGap(gap);
  }

  async reconcileSince(since: Date): Promise<ReconciliationResult> {
    const commits = await this.git.getCommitsSince(this.config.repoPath, since);
    const filesAffected = [...new Set(commits.flatMap((c) => c.files.map((f) => f.path)))];

    const gap: ReconciliationGap = {
      id: `gap_${Date.now()}`,
      startTime: since.toISOString(),
      endTime: new Date().toISOString(),
      reason: "manual-sync",
      commits,
      filesAffected,
      estimatedChanges: commits.length,
    };

    return this.reconcileGap(gap);
  }

  async processCommit(commit: GitCommitInfo): Promise<LedgerEntry[]> {
    const entries: LedgerEntry[] = [];

    // Create main commit event
    const mainEntry = createLedgerEntry(
      "index:batch:completed",
      "filesystem",
      `Reconciled commit: ${commit.shortSha} - ${commit.message}`,
      {
        impactedFiles: commit.files.map((f) => f.path),
        metadata: {
          reconciliation: true,
          commitSha: commit.sha,
          commitMessage: commit.message,
          author: commit.author,
          authorEmail: commit.authorEmail,
          commitDate: commit.date,
        },
        correlationId: `reconcile_${commit.sha}`,
      }
    );
    entries.push(mainEntry);

    // Create file-level events
    for (const file of commit.files) {
      if (this.shouldIgnoreFile(file.path)) continue;

      let eventType: LedgerEntry["eventType"] = "index:file:modified";
      if (file.status === "added") eventType = "index:file:added";
      else if (file.status === "deleted") eventType = "index:file:deleted";

      const fileEntry = createLedgerEntry(
        eventType,
        "filesystem",
        `Reconciled: ${file.status} ${file.path}`,
        {
          impactedFiles: [file.path],
          metadata: {
            reconciliation: true,
            commitSha: commit.sha,
            fileStatus: file.status,
          },
          correlationId: `reconcile_${commit.sha}`,
          parentEventId: mainEntry.id,
        }
      );
      entries.push(fileEntry);
    }

    return entries;
  }

  // =========================================================================
  // Synthetic Entry Generation
  // =========================================================================

  async generateSyntheticEntries(commit: GitCommitInfo): Promise<LedgerEntry[]> {
    return this.processCommit(commit);
  }

  async generateCompactedEntry(commits: GitCommitInfo[]): Promise<CompactedLedgerEntry> {
    if (commits.length === 0) {
      throw new Error("Cannot generate compacted entry from empty commits");
    }

    const firstCommit = commits[commits.length - 1]!;
    const lastCommit = commits[0]!;

    // Aggregate files
    const filesModified: string[] = [];
    const filesCreated: string[] = [];
    const filesDeleted: string[] = [];

    for (const commit of commits) {
      for (const file of commit.files) {
        if (file.status === "added") filesCreated.push(file.path);
        else if (file.status === "deleted") filesDeleted.push(file.path);
        else filesModified.push(file.path);
      }
    }

    // Infer intent from commit messages
    const intentInfo = await this.inferIntentFromCommits(commits);

    return createCompactedEntry(
      `reconcile_${firstCommit.sha}_${lastCommit.sha}`,
      "reconciliation",
      intentInfo.summary,
      firstCommit.date,
      lastCommit.date,
      {
        intentCategory: intentInfo.category,
        userPrompts: commits.map((c) => c.message),
        codeAccessed: {
          files: [...new Set([...filesModified, ...filesCreated])],
          entities: [],
          uniqueFilesCount: new Set([...filesModified, ...filesCreated]).size,
          uniqueEntitiesCount: 0,
        },
        codeChanges: {
          filesModified: [...new Set(filesModified)],
          filesCreated: [...new Set(filesCreated)],
          filesDeleted: [...new Set(filesDeleted)],
          functionsChanged: [],
          classesChanged: [],
          interfacesChanged: [],
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
        },
        rawEventCount: commits.length,
        confidenceScore: intentInfo.confidence,
        completeness: 0.6, // Reconciliation has limited info
        gitCommitSha: lastCommit.sha,
        gitBranch: lastCommit.branch,
      }
    );
  }

  async inferIntentFromCommit(commit: GitCommitInfo): Promise<{
    summary: string;
    category: CompactedLedgerEntry["intentCategory"];
    confidence: number;
  }> {
    return this.inferIntentFromCommits([commit]);
  }

  private async inferIntentFromCommits(commits: GitCommitInfo[]): Promise<{
    summary: string;
    category: CompactedLedgerEntry["intentCategory"];
    confidence: number;
  }> {
    const messages = commits.map((c) => c.message.toLowerCase());

    // Check commit message patterns
    let category: CompactedLedgerEntry["intentCategory"] = "unknown";
    let confidence = 0.5;

    for (const message of messages) {
      for (const [pattern, cat] of this.config.commitMessagePatterns) {
        if (message.startsWith(pattern) || message.includes(`(${pattern})`)) {
          category = cat;
          confidence = 0.8;
          break;
        }
      }
      if (category !== "unknown") break;
    }

    // Generate summary
    const fileCount = new Set(commits.flatMap((c) => c.files.map((f) => f.path))).size;
    const summary =
      commits.length === 1
        ? `Reconciled: ${commits[0]!.message}`
        : `Reconciled ${commits.length} commits affecting ${fileCount} files`;

    return { summary, category, confidence };
  }

  // =========================================================================
  // Index Synchronization
  // =========================================================================

  async triggerReindexing(files: string[]): Promise<void> {
    if (!this.indexer) {
      logger.warn("No indexer available for re-indexing");
      return;
    }

    // Filter to supported files
    const supportedFiles = files.filter((f) => {
      const ext = path.extname(f);
      return this.config.includedExtensions.includes(ext);
    });

    if (supportedFiles.length === 0) return;

    logger.info({ fileCount: supportedFiles.length }, "Triggering re-indexing for reconciled files");

    // Would trigger indexer
    // await this.indexer.reindexFiles(supportedFiles);
  }

  async markCommitSynced(commitSha: string): Promise<void> {
    this.lastSyncedCommit = commitSha;

    // Store in ledger metadata
    const entry = createLedgerEntry("system:startup", "system", `Reconciliation sync point: ${commitSha}`, {
      metadata: {
        reconciliationSyncPoint: commitSha,
        timestamp: new Date().toISOString(),
      },
    });

    await this.ledger.append(entry);
    logger.info({ commitSha }, "Marked commit as synced");
  }

  // =========================================================================
  // Validation
  // =========================================================================

  async validateLedgerIntegrity(): Promise<ReconciliationValidationResult> {
    const errors: string[] = [];
    let totalCommits = 0;
    let syncedCommits = 0;
    let missingCommits = 0;

    try {
      // Get all git commits
      const allCommits = await this.git.getCommitsSince(
        this.config.repoPath,
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
      );
      totalCommits = allCommits.length;

      // Check which commits are in ledger
      const recentEntries = await this.ledger.getRecent(10000);
      const reconciledShas = new Set(
        recentEntries
          .filter((e) => e.metadata?.reconciliation || e.metadata?.commitSha)
          .map((e) => (e.metadata?.commitSha as string) ?? "")
          .filter(Boolean)
      );

      for (const commit of allCommits) {
        if (reconciledShas.has(commit.sha)) {
          syncedCommits++;
        } else {
          missingCommits++;
        }
      }

      const orphaned = await this.findOrphanedEntries();

      return {
        isValid: missingCommits === 0 && orphaned.length === 0,
        totalCommits,
        syncedCommits,
        missingCommits,
        orphanedEntries: orphaned.length,
        errors,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Unknown error");
      return {
        isValid: false,
        totalCommits,
        syncedCommits,
        missingCommits,
        orphanedEntries: 0,
        errors,
      };
    }
  }

  async findOrphanedEntries(): Promise<LedgerEntry[]> {
    // Find entries with commit references that don't exist
    // This is a simplified implementation
    return [];
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  updateConfig(config: Partial<ReconciliationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ReconciliationConfig {
    return { ...this.config };
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async startAutoReconciliation(): Promise<void> {
    if (this.config.autoReconcileOnStartup) {
      const needs = await this.needsReconciliation();
      if (needs) {
        logger.info("Auto-reconciliation starting");
        await this.reconcileAll();
      }
    }
  }

  stopAutoReconciliation(): void {
    // No continuous process to stop in this implementation
  }

  async shutdown(): Promise<void> {
    this.stopAutoReconciliation();
    logger.info("Reconciliation worker shut down");
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private async loadLastSyncedCommit(): Promise<void> {
    try {
      const recentEntries = await this.ledger.getRecent(1000);
      const syncEntry = recentEntries.find((e) => e.metadata?.reconciliationSyncPoint);

      if (syncEntry) {
        this.lastSyncedCommit = syncEntry.metadata.reconciliationSyncPoint as string;
        logger.info({ lastSyncedCommit: this.lastSyncedCommit }, "Loaded last synced commit");
      }
    } catch {
      logger.warn("Failed to load last synced commit");
    }
  }

  private shouldIgnoreFile(filePath: string): boolean {
    for (const ignored of this.config.ignoredPaths) {
      if (filePath.startsWith(ignored) || filePath.includes(`/${ignored}/`)) {
        return true;
      }
    }

    const ext = path.extname(filePath);
    if (this.config.includedExtensions.length > 0) {
      return !this.config.includedExtensions.includes(ext);
    }

    return false;
  }

  private batchCommits(commits: GitCommitInfo[], batchSize: number): GitCommitInfo[][] {
    const batches: GitCommitInfo[][] = [];
    for (let i = 0; i < commits.length; i += batchSize) {
      batches.push(commits.slice(i, i + batchSize));
    }
    return batches;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createGitIntegration(): IGitIntegration {
  return new SimpleGitIntegration();
}

export function createEntityDiffer(): IEntityDiffer {
  return new SimpleEntityDiffer();
}

export function createReconciliationWorker(
  ledger: IChangeLedger,
  config?: Partial<ReconciliationConfig>,
  compaction?: ILedgerCompaction,
  indexer?: Indexer
): IReconciliationWorker {
  return new ReconciliationWorker(
    ledger,
    { ...DEFAULT_RECONCILIATION_CONFIG, ...config },
    compaction,
    indexer
  );
}

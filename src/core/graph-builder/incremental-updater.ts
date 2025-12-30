/**
 * Incremental Updater
 *
 * Handles smart updates to the graph database by detecting
 * which files have changed and only updating those.
 *
 * @module
 */

import type { IGraphStore } from "../interfaces/IGraphStore.js";
import type { ExtractionResult } from "../extraction/types.js";
import { GraphWriter, type WriteResult } from "./graph-writer.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Change detection result for a single file.
 */
export interface GraphFileChange {
  /** File ID */
  fileId: string;
  /** File path */
  filePath: string;
  /** Type of change */
  changeType: "added" | "modified" | "deleted" | "unchanged";
  /** Previous hash (for modified/deleted) */
  previousHash?: string;
  /** Current hash (for added/modified) */
  currentHash?: string;
}

/**
 * Result of change detection across all files.
 */
export interface ChangeDetectionResult {
  /** Files that were added */
  added: GraphFileChange[];
  /** Files that were modified */
  modified: GraphFileChange[];
  /** Files that were deleted */
  deleted: GraphFileChange[];
  /** Files that are unchanged */
  unchanged: GraphFileChange[];
  /** Total files in current scan */
  totalFiles: number;
  /** Total files in graph */
  totalInGraph: number;
}

/**
 * Result of an incremental update operation.
 */
export interface IncrementalUpdateResult {
  /** Change detection results */
  changes: ChangeDetectionResult;
  /** Write results for added files */
  addedResults: WriteResult[];
  /** Write results for modified files */
  modifiedResults: WriteResult[];
  /** Number of files deleted from graph */
  deletedCount: number;
  /** Total time in milliseconds */
  durationMs: number;
  /** Summary statistics */
  stats: {
    filesProcessed: number;
    entitiesWritten: number;
    entitiesDeleted: number;
    errors: number;
  };
}

/**
 * File info for change detection.
 */
export interface GraphFileInfo {
  /** File ID */
  fileId: string;
  /** File path */
  filePath: string;
  /** Content hash */
  hash: string;
}

/**
 * Options for IncrementalUpdater.
 */
export interface IncrementalUpdaterOptions {
  /** Skip unchanged files (default: true) */
  skipUnchanged?: boolean;
  /** Continue on error (default: true) */
  continueOnError?: boolean;
  /** Callback for progress updates */
  onProgress?: (progress: UpdateProgress) => void;
}

/**
 * Progress update during incremental update.
 */
export interface UpdateProgress {
  phase: "detecting" | "deleting" | "writing";
  current: number;
  total: number;
  currentFile?: string;
}

// =============================================================================
// IncrementalUpdater Implementation
// =============================================================================

/**
 * Handles incremental updates to the graph database.
 *
 * Compares file hashes to detect changes and only updates
 * files that have been added, modified, or deleted.
 *
 * @example
 * ```typescript
 * const updater = new IncrementalUpdater(store);
 *
 * // Detect changes
 * const changes = await updater.detectChanges(currentFiles);
 *
 * // Update only changed files
 * const result = await updater.update(extractionResults);
 * ```
 */
export class IncrementalUpdater {
  private store: IGraphStore;
  private writer: GraphWriter;
  private options: Required<IncrementalUpdaterOptions>;

  constructor(store: IGraphStore, options: IncrementalUpdaterOptions = {}) {
    this.store = store;
    this.writer = new GraphWriter(store);
    this.options = {
      skipUnchanged: options.skipUnchanged ?? true,
      continueOnError: options.continueOnError ?? true,
      onProgress: options.onProgress ?? (() => {}),
    };
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Detect changes between current files and what's stored in the graph.
   *
   * @param currentFiles - Current file info from scanner
   * @returns Change detection result
   */
  async detectChanges(currentFiles: GraphFileInfo[]): Promise<ChangeDetectionResult> {
    this.options.onProgress({
      phase: "detecting",
      current: 0,
      total: currentFiles.length,
    });

    // Get all files currently in the graph
    const graphFiles = await this.writer.getAllFileHashes();

    const added: GraphFileChange[] = [];
    const modified: GraphFileChange[] = [];
    const unchanged: GraphFileChange[] = [];
    const deleted: GraphFileChange[] = [];

    // Track which graph files we've seen
    const seenFiles = new Set<string>();

    // Check each current file
    for (let i = 0; i < currentFiles.length; i++) {
      const file = currentFiles[i]!;
      seenFiles.add(file.fileId);

      const graphHash = graphFiles.get(file.fileId);

      if (!graphHash) {
        // File not in graph - it's new
        added.push({
          fileId: file.fileId,
          filePath: file.filePath,
          changeType: "added",
          currentHash: file.hash,
        });
      } else if (graphHash !== file.hash) {
        // Hash differs - file modified
        modified.push({
          fileId: file.fileId,
          filePath: file.filePath,
          changeType: "modified",
          previousHash: graphHash,
          currentHash: file.hash,
        });
      } else {
        // Same hash - unchanged
        unchanged.push({
          fileId: file.fileId,
          filePath: file.filePath,
          changeType: "unchanged",
          currentHash: file.hash,
        });
      }

      this.options.onProgress({
        phase: "detecting",
        current: i + 1,
        total: currentFiles.length,
        currentFile: file.filePath,
      });
    }

    // Find deleted files (in graph but not in current)
    for (const [fileId, hash] of graphFiles) {
      if (!seenFiles.has(fileId)) {
        // Need to get file path from graph
        const pathResult = await this.store.query<{ path: string }>(
          `?[path] := *file{id, path}, id = $fileId`,
          { fileId }
        );
        const filePath = pathResult.rows[0]?.path ?? "unknown";

        deleted.push({
          fileId,
          filePath,
          changeType: "deleted",
          previousHash: hash,
        });
      }
    }

    return {
      added,
      modified,
      deleted,
      unchanged,
      totalFiles: currentFiles.length,
      totalInGraph: graphFiles.size,
    };
  }

  /**
   * Perform an incremental update with the given extraction results.
   *
   * Only writes files that have changed based on hash comparison.
   *
   * @param extractionResults - Extraction results to write
   * @param currentFiles - Current file info (for change detection)
   * @returns Update result with statistics
   */
  async update(
    extractionResults: ExtractionResult[],
    currentFiles: GraphFileInfo[]
  ): Promise<IncrementalUpdateResult> {
    const startTime = Date.now();

    // Detect changes
    const changes = await this.detectChanges(currentFiles);

    // Create map of extraction results by fileId
    const resultsByFileId = new Map<string, ExtractionResult>();
    for (const result of extractionResults) {
      resultsByFileId.set(result.fileId, result);
    }

    const addedResults: WriteResult[] = [];
    const modifiedResults: WriteResult[] = [];
    let deletedCount = 0;
    let totalEntitiesWritten = 0;
    let totalEntitiesDeleted = 0;
    let errorCount = 0;

    // Delete removed files
    const filesToDelete = changes.deleted;
    for (let i = 0; i < filesToDelete.length; i++) {
      const file = filesToDelete[i]!;
      this.options.onProgress({
        phase: "deleting",
        current: i + 1,
        total: filesToDelete.length,
        currentFile: file.filePath,
      });

      try {
        const deleted = await this.writer.deleteFileEntities(file.fileId);
        totalEntitiesDeleted += deleted;
        deletedCount++;
      } catch (error) {
        errorCount++;
        if (!this.options.continueOnError) {
          throw error;
        }
      }
    }

    // Write added files
    const filesToAdd = changes.added;
    for (let i = 0; i < filesToAdd.length; i++) {
      const file = filesToAdd[i]!;
      const result = resultsByFileId.get(file.fileId);

      if (!result) {
        continue; // No extraction result for this file
      }

      this.options.onProgress({
        phase: "writing",
        current: i + 1,
        total: filesToAdd.length + changes.modified.length,
        currentFile: file.filePath,
      });

      try {
        const writeResult = await this.writer.writeFile(result);
        addedResults.push(writeResult);
        if (writeResult.success) {
          totalEntitiesWritten += writeResult.stats.entitiesWritten;
        } else {
          errorCount++;
        }
      } catch (error) {
        errorCount++;
        if (!this.options.continueOnError) {
          throw error;
        }
      }
    }

    // Write modified files
    const filesToModify = changes.modified;
    for (let i = 0; i < filesToModify.length; i++) {
      const file = filesToModify[i]!;
      const result = resultsByFileId.get(file.fileId);

      if (!result) {
        continue; // No extraction result for this file
      }

      this.options.onProgress({
        phase: "writing",
        current: filesToAdd.length + i + 1,
        total: filesToAdd.length + filesToModify.length,
        currentFile: file.filePath,
      });

      try {
        const writeResult = await this.writer.writeFile(result);
        modifiedResults.push(writeResult);
        if (writeResult.success) {
          totalEntitiesWritten += writeResult.stats.entitiesWritten;
          totalEntitiesDeleted += writeResult.stats.entitiesDeleted;
        } else {
          errorCount++;
        }
      } catch (error) {
        errorCount++;
        if (!this.options.continueOnError) {
          throw error;
        }
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      changes,
      addedResults,
      modifiedResults,
      deletedCount,
      durationMs,
      stats: {
        filesProcessed:
          addedResults.length + modifiedResults.length + deletedCount,
        entitiesWritten: totalEntitiesWritten,
        entitiesDeleted: totalEntitiesDeleted,
        errors: errorCount,
      },
    };
  }

  /**
   * Full re-index: delete all existing data and write new.
   * Use when you want to start fresh.
   *
   * @param extractionResults - All extraction results to write
   * @returns Write results
   */
  async fullReindex(extractionResults: ExtractionResult[]): Promise<WriteResult[]> {
    const results: WriteResult[] = [];

    // Get all files currently in graph
    const graphFiles = await this.writer.getAllFileHashes();

    // Delete all existing files
    this.options.onProgress({
      phase: "deleting",
      current: 0,
      total: graphFiles.size,
    });

    let deleteIndex = 0;
    for (const [fileId] of graphFiles) {
      this.options.onProgress({
        phase: "deleting",
        current: ++deleteIndex,
        total: graphFiles.size,
      });
      await this.writer.deleteFileEntities(fileId);
    }

    // Write all new files
    for (let i = 0; i < extractionResults.length; i++) {
      const result = extractionResults[i]!;
      this.options.onProgress({
        phase: "writing",
        current: i + 1,
        total: extractionResults.length,
        currentFile: result.filePath,
      });

      const writeResult = await this.writer.writeFile(result);
      results.push(writeResult);
    }

    return results;
  }

  /**
   * Get statistics about what's currently in the graph.
   */
  async getGraphStats(): Promise<{
    files: number;
    functions: number;
    classes: number;
    interfaces: number;
    typeAliases: number;
    variables: number;
    ghostNodes: number;
  }> {
    // Helper to safely count rows in a relation
    const safeCount = async (relation: string): Promise<number> => {
      try {
        const result = await this.store.query<{ id: string }>(
          `?[id] := *${relation}{id}`
        );
        return result.rows.length;
      } catch {
        // Relation might be empty or not exist yet
        return 0;
      }
    };

    const [files, functions, classes, interfaces, typeAliases, variables, ghostNodes] =
      await Promise.all([
        safeCount("file"),
        safeCount("function"),
        safeCount("class"),
        safeCount("interface"),
        safeCount("type_alias"),
        safeCount("variable"),
        safeCount("ghost_node"),
      ]);

    return {
      files,
      functions,
      classes,
      interfaces,
      typeAliases,
      variables,
      ghostNodes,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates an IncrementalUpdater instance.
 */
export function createIncrementalUpdater(
  store: IGraphStore,
  options?: IncrementalUpdaterOptions
): IncrementalUpdater {
  return new IncrementalUpdater(store, options);
}

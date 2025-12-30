/**
 * File Scanner
 *
 * Discovers and catalogs all source files in a project.
 * Collects file metadata including size, modification time, and content hash.
 *
 * @module
 */

import * as path from "node:path";
import type { DetectedProject } from "./project-detector.js";
import {
  findFiles,
  getFileStats,
  calculateFileHash,
  detectLanguage,
  getRelativePath,
} from "../../utils/fs.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Detailed information about a discovered file
 */
export interface FileInfo {
  /** Unique identifier (relative path based) */
  id: string;
  /** Absolute path to the file */
  absolutePath: string;
  /** Path relative to project root */
  relativePath: string;
  /** File extension (e.g., ".ts") */
  extension: string;
  /** File size in bytes */
  size: number;
  /** Last modification timestamp (ms since epoch) */
  lastModified: number;
  /** MD5 hash of file contents */
  hash: string;
  /** Detected programming language */
  language: string | null;
  /** File name without path */
  fileName: string;
  /** Directory containing the file */
  directory: string;
}

/**
 * Scan result with statistics
 */
export interface ScanResult {
  /** All discovered files */
  files: FileInfo[];
  /** Number of files found */
  totalFiles: number;
  /** Total size of all files in bytes */
  totalSize: number;
  /** Time taken to scan in milliseconds */
  scanTimeMs: number;
  /** Files grouped by language */
  byLanguage: Map<string, number>;
  /** Files grouped by extension */
  byExtension: Map<string, number>;
}

/**
 * Options for file scanning
 */
export interface ScanOptions {
  /** Maximum number of concurrent file operations */
  concurrency?: number;
  /** Whether to compute file hashes (slower but needed for change detection) */
  computeHashes?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, file: string) => void;
  /** Additional patterns to include */
  includePatterns?: string[];
  /** Additional patterns to exclude */
  excludePatterns?: string[];
}

// =============================================================================
// File Scanner Class
// =============================================================================

/**
 * Scans project directories to discover and catalog source files.
 *
 * @example
 * ```typescript
 * const scanner = new FileScanner(projectConfig);
 * const result = await scanner.scan();
 *
 * console.log(`Found ${result.totalFiles} files`);
 * console.log(`TypeScript: ${result.byLanguage.get('typescript')}`);
 *
 * for (const file of result.files) {
 *   console.log(`${file.relativePath} (${file.language})`);
 * }
 * ```
 */
export class FileScanner {
  private project: DetectedProject;

  constructor(project: DetectedProject) {
    this.project = project;
  }

  /**
   * Scans the project for source files.
   */
  async scan(options: ScanOptions = {}): Promise<ScanResult> {
    const startTime = Date.now();

    const {
      concurrency = 10,
      computeHashes = true,
      onProgress,
      includePatterns = [],
      excludePatterns = [],
    } = options;

    // Combine patterns
    const patterns = [...this.project.sourcePatterns, ...includePatterns];
    const ignore = [...this.project.ignorePatterns, ...excludePatterns];

    // Discover files
    const filePaths = await findFiles({
      patterns,
      ignore,
      cwd: this.project.rootPath,
      absolute: true,
    });

    // Process files in batches for controlled concurrency
    const files: FileInfo[] = [];
    const byLanguage = new Map<string, number>();
    const byExtension = new Map<string, number>();
    let totalSize = 0;

    // Process files with concurrency control
    const batches = this.chunk(filePaths, concurrency);
    let processed = 0;

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async (filePath) => {
          const info = await this.processFile(filePath, computeHashes);
          processed++;

          if (onProgress) {
            onProgress(processed, filePaths.length, filePath);
          }

          return info;
        })
      );

      for (const info of batchResults) {
        if (info) {
          files.push(info);
          totalSize += info.size;

          // Track by language
          const lang = info.language ?? "unknown";
          byLanguage.set(lang, (byLanguage.get(lang) ?? 0) + 1);

          // Track by extension
          byExtension.set(
            info.extension,
            (byExtension.get(info.extension) ?? 0) + 1
          );
        }
      }
    }

    // Sort files by path for deterministic ordering
    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    return {
      files,
      totalFiles: files.length,
      totalSize,
      scanTimeMs: Date.now() - startTime,
      byLanguage,
      byExtension,
    };
  }

  /**
   * Scans for files that have changed since last scan.
   *
   * @param previousFiles - Map of relativePath -> hash from previous scan
   */
  async scanForChanges(
    previousFiles: Map<string, string>,
    options: ScanOptions = {}
  ): Promise<{
    added: FileInfo[];
    modified: FileInfo[];
    removed: string[];
  }> {
    const currentResult = await this.scan({ ...options, computeHashes: true });

    const added: FileInfo[] = [];
    const modified: FileInfo[] = [];
    const currentPaths = new Set<string>();

    for (const file of currentResult.files) {
      currentPaths.add(file.relativePath);

      const previousHash = previousFiles.get(file.relativePath);

      if (!previousHash) {
        added.push(file);
      } else if (previousHash !== file.hash) {
        modified.push(file);
      }
    }

    // Find removed files
    const removed: string[] = [];
    for (const prevPath of previousFiles.keys()) {
      if (!currentPaths.has(prevPath)) {
        removed.push(prevPath);
      }
    }

    return { added, modified, removed };
  }

  /**
   * Gets a single file's info.
   */
  async getFileInfo(
    filePath: string,
    computeHash = true
  ): Promise<FileInfo | null> {
    return this.processFile(filePath, computeHash);
  }

  /**
   * Processes a single file to extract metadata.
   */
  private async processFile(
    absolutePath: string,
    computeHash: boolean
  ): Promise<FileInfo | null> {
    try {
      const stats = await getFileStats(absolutePath);

      if (!stats.isFile) {
        return null;
      }

      const relativePath = getRelativePath(absolutePath, this.project.rootPath);
      const extension = path.extname(absolutePath).toLowerCase();
      const fileName = path.basename(absolutePath);
      const directory = path.dirname(relativePath);

      // Generate ID from relative path
      const id = `file:${relativePath.replace(/[/\\]/g, ":")}`;

      // Compute hash if requested
      const hash = computeHash ? await calculateFileHash(absolutePath) : "";

      // Detect language
      const language = detectLanguage(absolutePath);

      return {
        id,
        absolutePath,
        relativePath,
        extension,
        size: stats.size,
        lastModified: stats.lastModified.getTime(),
        hash,
        language,
        fileName,
        directory,
      };
    } catch {
      // File might have been deleted or inaccessible
      return null;
    }
  }

  /**
   * Splits an array into chunks.
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  // ===========================================================================
  // Streaming API (Memory-Efficient)
  // ===========================================================================

  /**
   * Streams files as they are discovered using async generators.
   * Memory-efficient for large codebases - processes files incrementally.
   *
   * @example
   * ```typescript
   * const scanner = new FileScanner(project);
   *
   * // Process files as they are found (low memory)
   * for await (const file of scanner.streamFiles()) {
   *   await processFile(file);
   * }
   * ```
   */
  async *streamFiles(options: ScanOptions = {}): AsyncGenerator<FileInfo, void, unknown> {
    const { computeHashes = true, includePatterns = [], excludePatterns = [] } = options;

    // Combine patterns
    const patterns = [...this.project.sourcePatterns, ...includePatterns];
    const ignore = [...this.project.ignorePatterns, ...excludePatterns];

    // Use fast-glob stream for memory-efficient file discovery
    const fg = await import("fast-glob");
    const stream = fg.stream(patterns, {
      ignore,
      cwd: this.project.rootPath,
      absolute: true,
    });

    // Yield files as they are discovered
    for await (const filePath of stream) {
      const info = await this.processFile(filePath.toString(), computeHashes);
      if (info) {
        yield info;
      }
    }
  }

  /**
   * Streams files in batches for optimized processing.
   * Balances memory efficiency with processing throughput.
   *
   * @param batchSize - Number of files per batch
   */
  async *streamBatches(
    batchSize: number = 50,
    options: ScanOptions = {}
  ): AsyncGenerator<FileInfo[], void, unknown> {
    let batch: FileInfo[] = [];

    for await (const file of this.streamFiles(options)) {
      batch.push(file);

      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }

    // Yield remaining files
    if (batch.length > 0) {
      yield batch;
    }
  }

  /**
   * Counts files without loading all metadata into memory.
   * Useful for progress bars and estimation.
   */
  async countFiles(options: ScanOptions = {}): Promise<number> {
    const { includePatterns = [], excludePatterns = [] } = options;

    const patterns = [...this.project.sourcePatterns, ...includePatterns];
    const ignore = [...this.project.ignorePatterns, ...excludePatterns];

    const filePaths = await findFiles({
      patterns,
      ignore,
      cwd: this.project.rootPath,
      absolute: false,
    });

    return filePaths.length;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a FileScanner instance.
 */
export function createFileScanner(project: DetectedProject): FileScanner {
  return new FileScanner(project);
}

/**
 * Scans a project for source files.
 * Convenience function that creates a scanner and runs a scan.
 */
export async function scanProject(
  project: DetectedProject,
  options?: ScanOptions
): Promise<ScanResult> {
  const scanner = new FileScanner(project);
  return scanner.scan(options);
}

/**
 * Streams project files incrementally (memory-efficient).
 * Use this for large codebases to avoid loading all files into memory.
 */
export async function* streamProjectFiles(
  project: DetectedProject,
  options?: ScanOptions
): AsyncGenerator<FileInfo, void, unknown> {
  const scanner = new FileScanner(project);
  yield* scanner.streamFiles(options);
}

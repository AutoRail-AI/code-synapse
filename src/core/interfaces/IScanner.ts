/**
 * IScanner - File discovery interface
 *
 * Handles file system scanning, project detection, and change tracking.
 *
 * @module
 */

/**
 * Scan configuration options.
 */
export interface ScanOptions {
  /** Glob patterns to include */
  patterns?: string[];
  /** Glob patterns to exclude */
  ignorePatterns?: string[];
  /** Maximum directory depth */
  maxDepth?: number;
  /** Whether to follow symlinks */
  followSymlinks?: boolean;
}

/**
 * Metadata about a scanned file.
 */
export interface FileMetadata {
  /** Absolute file path */
  path: string;
  /** Path relative to project root */
  relativePath: string;
  /** Content hash for change detection */
  hash: string;
  /** File size in bytes */
  size: number;
  /** Detected programming language */
  language: string;
  /** Last modification timestamp (unix ms) */
  lastModified: number;
  /** File extension */
  extension: string;
}

/**
 * Project information detected from filesystem.
 */
export interface ProjectInfo {
  /** Project name (from package.json, etc) */
  name: string;
  /** Detected project type */
  type: "node" | "typescript" | "javascript" | "monorepo" | "unknown";
  /** Detected framework (react, express, etc) */
  framework: string | null;
  /** Root directory path */
  rootPath: string;
  /** TypeScript config path (if exists) */
  tsconfigPath: string | null;
  /** Package.json path (if exists) */
  packageJsonPath: string | null;
}

/**
 * Files that have changed since last scan.
 */
export interface ChangedFiles {
  /** New files that were added */
  added: FileMetadata[];
  /** Files that were modified */
  modified: FileMetadata[];
  /** Files that were deleted (only paths) */
  deleted: string[];
}

/**
 * Scanner interface for file discovery.
 *
 * @example
 * ```typescript
 * const scanner = createScanner();
 *
 * // Scan project
 * for await (const file of scanner.scan('/project')) {
 *   console.log(file.relativePath, file.language);
 * }
 *
 * // Detect project type
 * const info = await scanner.detectProjectType('/project');
 *
 * // Check for changes
 * const changes = await scanner.scanForChanges('/project', existingHashes);
 * ```
 */
export interface IScanner {
  /**
   * Scan directory for code files
   * @param rootPath - Project root directory
   * @param options - Scan configuration
   */
  scan(rootPath: string, options?: ScanOptions): AsyncIterable<FileMetadata>;

  /**
   * Detect project type and framework
   */
  detectProjectType(rootPath: string): Promise<ProjectInfo>;

  /**
   * Check for file changes since last scan
   * @param rootPath - Project root directory
   * @param knownFiles - Map of known file paths to their hashes
   */
  scanForChanges(
    rootPath: string,
    knownFiles: Map<string, string>
  ): Promise<ChangedFiles>;

  /**
   * Get the default include patterns for a project type
   */
  getDefaultPatterns(projectType: ProjectInfo["type"]): string[];

  /**
   * Get the default ignore patterns
   */
  getDefaultIgnorePatterns(): string[];
}

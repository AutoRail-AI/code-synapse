/**
 * File System Utilities
 * Advanced file operations for indexing and processing
 */

import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import fg from "fast-glob";

/**
 * File statistics with useful metadata
 */
export interface FileStats {
  path: string;
  size: number;
  lastModified: Date;
  isDirectory: boolean;
  isFile: boolean;
  extension: string;
}

/**
 * Options for file discovery
 */
export interface GlobOptions {
  patterns: string[];
  ignore?: string[];
  cwd?: string;
  absolute?: boolean;
  onlyFiles?: boolean;
}

/**
 * Ensures a directory exists, creating it recursively if needed
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Directory already exists
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

/**
 * Synchronous version of ensureDirectory
 */
export function ensureDirectorySync(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Read a file with automatic encoding detection
 * Defaults to UTF-8
 */
export async function readFileWithEncoding(
  filePath: string,
  encoding: BufferEncoding = "utf-8"
): Promise<string> {
  return fsPromises.readFile(filePath, { encoding });
}

/**
 * Get detailed file statistics
 */
export async function getFileStats(filePath: string): Promise<FileStats> {
  const stats = await fsPromises.stat(filePath);
  return {
    path: filePath,
    size: stats.size,
    lastModified: stats.mtime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    extension: path.extname(filePath).toLowerCase(),
  };
}

/**
 * Synchronous version of getFileStats
 */
export function getFileStatsSync(filePath: string): FileStats {
  const stats = fs.statSync(filePath);
  return {
    path: filePath,
    size: stats.size,
    lastModified: stats.mtime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    extension: path.extname(filePath).toLowerCase(),
  };
}

/**
 * Calculate MD5 hash of a file for change detection
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  const content = await fsPromises.readFile(filePath);
  return crypto.createHash("md5").update(content).digest("hex");
}

/**
 * Calculate hash from string content
 */
export function calculateContentHash(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

/**
 * Check if a path should be ignored based on patterns
 *
 * @param filePath - Path to check (relative or absolute)
 * @param patterns - Array of glob patterns to match against
 * @returns true if the path matches any ignore pattern
 */
export function isIgnoredPath(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;

  const normalizedPath = filePath.replace(/\\/g, "/");

  for (const pattern of patterns) {
    // Simple pattern matching
    const regexPattern = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, ".");

    const regex = new RegExp(`^${regexPattern}$|/${regexPattern}$|/${regexPattern}/`);
    if (regex.test(normalizedPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Find files matching glob patterns
 *
 * @param options - Glob options
 * @returns Array of matching file paths
 */
export async function findFiles(options: GlobOptions): Promise<string[]> {
  const {
    patterns,
    ignore = [],
    cwd = process.cwd(),
    absolute = true,
    onlyFiles = true,
  } = options;

  return fg(patterns, {
    cwd,
    absolute,
    onlyFiles,
    ignore: [
      // Default ignores
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      ...ignore,
    ],
    dot: false, // Don't include dotfiles
  });
}

/**
 * Get the relative path from project root
 */
export function getRelativePath(filePath: string, projectRoot: string): string {
  return path.relative(projectRoot, filePath);
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Synchronous file exists check
 */
export function fileExistsSync(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Write content to a file, creating parent directories if needed
 */
export async function writeFile(
  filePath: string,
  content: string | Buffer
): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await fsPromises.writeFile(filePath, content);
}

/**
 * Detect file language based on extension
 */
export function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
    ".sql": "sql",
    ".dart": "dart",
    ".ex": "elixir",
    ".exs": "elixir",
    ".lua": "lua",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".toml": "toml",
  };

  return languageMap[ext] ?? null;
}

/**
 * Get all source files from a directory
 */
export async function getSourceFiles(
  rootDir: string,
  sourcePatterns: string[] = ["**/*.{ts,tsx,js,jsx}"],
  ignorePatterns: string[] = []
): Promise<string[]> {
  return findFiles({
    patterns: sourcePatterns,
    ignore: ignorePatterns,
    cwd: rootDir,
    absolute: true,
  });
}

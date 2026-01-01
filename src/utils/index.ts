/**
 * Shared utilities
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Re-export logger module
export * from "./logger.js";
export * from "./port.js";

// Re-export file system utilities
export * from "./fs.js";

// Re-export disposable utilities
export * from "./disposable.js";

// Re-export validation utilities
export * from "./validation.js";

// Re-export async utilities
export * from "./async.js";

// Re-export object pool
export * from "./pool.js";

// Re-export event bus
export * from "./events.js";

// =============================================================================
// Configuration Paths
// =============================================================================

export const CONFIG_DIR = ".code-synapse";
export const CONFIG_FILE = "config.json";

export function getProjectRoot(): string {
  return process.cwd();
}

export function getConfigDir(projectRoot: string = getProjectRoot()): string {
  return path.join(projectRoot, CONFIG_DIR);
}

export function getConfigPath(projectRoot: string = getProjectRoot()): string {
  return path.join(getConfigDir(projectRoot), CONFIG_FILE);
}

export function getDataDir(projectRoot: string = getProjectRoot()): string {
  return path.join(getConfigDir(projectRoot), "data");
}

export function getLogsDir(projectRoot: string = getProjectRoot()): string {
  return path.join(getConfigDir(projectRoot), "logs");
}

export function getGraphDbPath(projectRoot: string = getProjectRoot()): string {
  return path.join(getDataDir(projectRoot), "cozodb");
}

/**
 * @deprecated Vector storage is now handled by CozoDB HNSW indices.
 * This function is kept for backward compatibility but returns embeddings cache path.
 */
export function getVectorDbPath(projectRoot: string = getProjectRoot()): string {
  return path.join(getDataDir(projectRoot), "embeddings");
}

// =============================================================================
// Basic File Operations (kept for backward compatibility)
// =============================================================================

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * @deprecated Use fileExistsSync from ./fs.js instead
 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function readJson<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// =============================================================================
// ID Generation
// =============================================================================

/**
 * Generate a unique ID for a file entity
 */
export function generateFileId(relativePath: string): string {
  return `file:${relativePath.replace(/\\/g, "/")}`;
}

/**
 * Generate a unique ID for a function entity
 */
export function generateFunctionId(
  fileRelativePath: string,
  functionName: string,
  startLine: number
): string {
  return `fn:${fileRelativePath.replace(/\\/g, "/")}:${functionName}:${startLine}`;
}

/**
 * Generate a unique ID for a class entity
 */
export function generateClassId(
  fileRelativePath: string,
  className: string,
  startLine: number
): string {
  return `class:${fileRelativePath.replace(/\\/g, "/")}:${className}:${startLine}`;
}

/**
 * Generate a unique ID for an interface entity
 */
export function generateInterfaceId(
  fileRelativePath: string,
  interfaceName: string,
  startLine: number
): string {
  return `iface:${fileRelativePath.replace(/\\/g, "/")}:${interfaceName}:${startLine}`;
}

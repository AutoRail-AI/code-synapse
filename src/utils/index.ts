/**
 * Shared utilities
 */

import * as fs from "node:fs";
import * as path from "node:path";

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

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

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

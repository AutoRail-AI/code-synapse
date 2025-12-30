/**
 * File Hasher
 *
 * Content-based change detection using MD5 hashes.
 * Provides utilities for computing and comparing file hashes.
 *
 * @module
 */

import { calculateFileHash, calculateContentHash } from "../../utils/fs.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Hash cache entry with metadata
 */
export interface HashEntry {
  /** File path */
  path: string;
  /** MD5 hash of content */
  hash: string;
  /** When the hash was computed (ms since epoch) */
  computedAt: number;
  /** File size at computation time */
  size: number;
}

/**
 * Change detection result for a single file
 */
export interface FileChangeStatus {
  /** File path */
  path: string;
  /** Whether the file has changed */
  changed: boolean;
  /** Previous hash (if known) */
  previousHash: string | null;
  /** Current hash */
  currentHash: string;
  /** Change type */
  changeType: "added" | "modified" | "unchanged";
}

/**
 * Batch hash result
 */
export interface BatchHashResult {
  /** Map of path to hash */
  hashes: Map<string, string>;
  /** Paths that failed to hash */
  errors: Map<string, Error>;
  /** Time taken in milliseconds */
  timeMs: number;
}

// =============================================================================
// File Hasher Class
// =============================================================================

/**
 * Manages file hashing for change detection.
 *
 * @example
 * ```typescript
 * const hasher = new FileHasher();
 *
 * // Hash a single file
 * const hash = await hasher.hashFile('/path/to/file.ts');
 *
 * // Check if file changed
 * const changed = await hasher.hasChanged('/path/to/file.ts', previousHash);
 *
 * // Batch hash multiple files
 * const result = await hasher.hashFiles(['/path/to/a.ts', '/path/to/b.ts']);
 * ```
 */
export class FileHasher {
  /** In-memory hash cache for the session */
  private cache = new Map<string, HashEntry>();

  /**
   * Computes the MD5 hash of a file's contents.
   *
   * @param filePath - Absolute path to the file
   * @param useCache - Whether to use cached hash if available
   */
  async hashFile(filePath: string, useCache = true): Promise<string> {
    // Check cache first
    if (useCache) {
      const cached = this.cache.get(filePath);
      if (cached) {
        return cached.hash;
      }
    }

    const hash = await calculateFileHash(filePath);

    // Update cache
    this.cache.set(filePath, {
      path: filePath,
      hash,
      computedAt: Date.now(),
      size: 0, // We don't need size for basic caching
    });

    return hash;
  }

  /**
   * Computes the MD5 hash of string content.
   */
  hashContent(content: string): string {
    return calculateContentHash(content);
  }

  /**
   * Checks if a file has changed since a previous hash.
   *
   * @param filePath - Absolute path to the file
   * @param previousHash - The hash to compare against
   */
  async hasChanged(filePath: string, previousHash: string): Promise<boolean> {
    const currentHash = await this.hashFile(filePath, false);
    return currentHash !== previousHash;
  }

  /**
   * Gets the change status for a file.
   */
  async getChangeStatus(
    filePath: string,
    previousHash: string | null
  ): Promise<FileChangeStatus> {
    const currentHash = await this.hashFile(filePath, false);

    let changeType: FileChangeStatus["changeType"];

    if (previousHash === null) {
      changeType = "added";
    } else if (previousHash !== currentHash) {
      changeType = "modified";
    } else {
      changeType = "unchanged";
    }

    return {
      path: filePath,
      changed: changeType !== "unchanged",
      previousHash,
      currentHash,
      changeType,
    };
  }

  /**
   * Computes hashes for multiple files in parallel.
   *
   * @param filePaths - Array of absolute file paths
   * @param concurrency - Maximum concurrent hash operations
   */
  async hashFiles(
    filePaths: string[],
    concurrency = 10
  ): Promise<BatchHashResult> {
    const startTime = Date.now();
    const hashes = new Map<string, string>();
    const errors = new Map<string, Error>();

    // Process in batches
    const batches = this.chunk(filePaths, concurrency);

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async (filePath) => {
          const hash = await this.hashFile(filePath, false);
          return { filePath, hash };
        })
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const filePath = batch[i]!;

        if (result.status === "fulfilled") {
          hashes.set(filePath, result.value.hash);
        } else {
          errors.set(filePath, result.reason as Error);
        }
      }
    }

    return {
      hashes,
      errors,
      timeMs: Date.now() - startTime,
    };
  }

  /**
   * Compares current file hashes with stored hashes.
   *
   * @param filePaths - Files to check
   * @param storedHashes - Map of path to previously stored hash
   */
  async detectChanges(
    filePaths: string[],
    storedHashes: Map<string, string>
  ): Promise<{
    added: string[];
    modified: string[];
    unchanged: string[];
    removed: string[];
  }> {
    const result = await this.hashFiles(filePaths);

    const added: string[] = [];
    const modified: string[] = [];
    const unchanged: string[] = [];
    const currentPaths = new Set(filePaths);

    for (const [filePath, currentHash] of result.hashes) {
      const previousHash = storedHashes.get(filePath);

      if (!previousHash) {
        added.push(filePath);
      } else if (previousHash !== currentHash) {
        modified.push(filePath);
      } else {
        unchanged.push(filePath);
      }
    }

    // Find removed files
    const removed: string[] = [];
    for (const storedPath of storedHashes.keys()) {
      if (!currentPaths.has(storedPath)) {
        removed.push(storedPath);
      }
    }

    return { added, modified, unchanged, removed };
  }

  /**
   * Clears the hash cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Removes a specific path from the cache.
   */
  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }

  /**
   * Gets the cached hash for a file if available.
   */
  getCached(filePath: string): string | null {
    return this.cache.get(filePath)?.hash ?? null;
  }

  /**
   * Gets cache statistics.
   */
  getCacheStats(): { entries: number; paths: string[] } {
    return {
      entries: this.cache.size,
      paths: Array.from(this.cache.keys()),
    };
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
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a FileHasher instance.
 */
export function createFileHasher(): FileHasher {
  return new FileHasher();
}

/**
 * Singleton hasher for shared caching across the application.
 */
let sharedHasher: FileHasher | null = null;

/**
 * Gets a shared FileHasher instance.
 * Use this for application-wide hash caching.
 */
export function getSharedHasher(): FileHasher {
  if (!sharedHasher) {
    sharedHasher = new FileHasher();
  }
  return sharedHasher;
}

/**
 * Resets the shared hasher instance.
 * Useful for testing or when cache should be cleared.
 */
export function resetSharedHasher(): void {
  if (sharedHasher) {
    sharedHasher.clearCache();
  }
  sharedHasher = null;
}

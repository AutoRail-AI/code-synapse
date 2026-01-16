/**
 * Lock Manager for RocksDB Database
 *
 * Handles detection and cleanup of stale lock files left by crashed processes.
 * This allows multiple code-synapse instances to run in different repos simultaneously.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { createLogger } from "./logger.js";

const logger = createLogger("lock-manager");

/**
 * Result of checking a lock file
 */
export interface LockCheckResult {
  /** Whether a lock file exists */
  exists: boolean;
  /** Whether the lock is stale (owning process is dead) */
  isStale: boolean;
  /** PID of the process holding the lock (if any) */
  ownerPid?: number;
  /** Path to the lock file */
  lockPath: string;
}

/**
 * Gets the lock file path for a RocksDB database
 */
export function getLockFilePath(dbPath: string): string {
  return path.join(dbPath, "data", "LOCK");
}

/**
 * Checks if a process with given PID is actually running (not zombie or dead)
 */
function isProcessRunning(pid: number): boolean {
  try {
    // First check if process exists
    process.kill(pid, 0);

    // Process exists, but could be a zombie. Check actual state using ps.
    // On macOS/Linux, 'ps' shows process state - Z means zombie
    try {
      const output = execSync(`ps -p ${pid} -o state= 2>/dev/null`, {
        encoding: "utf-8",
        timeout: 2000,
      }).trim();

      // If state starts with Z, it's a zombie (dead but not reaped)
      if (output.startsWith("Z") || output === "") {
        return false;
      }

      return true;
    } catch {
      // ps failed - process might have just died, consider it not running
      return false;
    }
  } catch {
    // process.kill failed - process doesn't exist
    return false;
  }
}

/**
 * Gets the PID of the process holding a lock file using lsof
 */
function getLockOwnerPid(lockPath: string): number | null {
  try {
    // Use lsof to find the process holding the lock
    const output = execSync(`lsof "${lockPath}" 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    });

    // Parse lsof output - second column is PID
    const lines = output.trim().split("\n");
    if (lines.length > 1) {
      // Skip header line
      const dataLine = lines[1];
      if (dataLine) {
        const parts = dataLine.split(/\s+/);
        const pidStr = parts[1];
        if (pidStr) {
          const pid = parseInt(pidStr, 10);
          if (!isNaN(pid)) {
            return pid;
          }
        }
      }
    }
  } catch {
    // lsof failed or no process found - that's fine
  }
  return null;
}

/**
 * Checks the status of a RocksDB lock file
 */
export function checkLock(dbPath: string): LockCheckResult {
  const lockPath = getLockFilePath(dbPath);

  // Check if lock file exists
  if (!fs.existsSync(lockPath)) {
    return {
      exists: false,
      isStale: false,
      lockPath,
    };
  }

  // Lock file exists - check if owner is alive
  const ownerPid = getLockOwnerPid(lockPath);

  if (ownerPid === null) {
    // Lock file exists but no process is holding it - definitely stale
    return {
      exists: true,
      isStale: true,
      lockPath,
    };
  }

  // Check if the owning process is still running
  const isRunning = isProcessRunning(ownerPid);

  return {
    exists: true,
    isStale: !isRunning,
    ownerPid,
    lockPath,
  };
}

/**
 * Removes a stale lock file
 *
 * @returns true if lock was removed, false otherwise
 */
export function removeStaleLock(dbPath: string): boolean {
  const result = checkLock(dbPath);

  if (!result.exists) {
    logger.debug({ dbPath }, "No lock file exists");
    return true;
  }

  if (!result.isStale) {
    logger.warn(
      { dbPath, ownerPid: result.ownerPid },
      "Lock is held by running process - cannot remove"
    );
    return false;
  }

  // Lock is stale - safe to remove
  try {
    fs.unlinkSync(result.lockPath);
    logger.info(
      { dbPath, lockPath: result.lockPath, previousOwner: result.ownerPid },
      "Removed stale RocksDB lock file"
    );
    return true;
  } catch (error) {
    logger.error(
      { error, lockPath: result.lockPath },
      "Failed to remove stale lock file"
    );
    return false;
  }
}

/**
 * Ensures the database is accessible by cleaning stale locks if necessary.
 * This is the main entry point for lock management.
 *
 * @param dbPath - Path to the RocksDB database
 * @returns true if database is accessible, false if locked by another process
 */
export function ensureDatabaseAccessible(dbPath: string): boolean {
  const result = checkLock(dbPath);

  if (!result.exists) {
    // No lock - database is accessible
    return true;
  }

  if (result.isStale) {
    // Stale lock - try to clean it
    logger.info(
      { dbPath, previousOwner: result.ownerPid },
      "Detected stale database lock from crashed process - cleaning up"
    );
    return removeStaleLock(dbPath);
  }

  // Lock is held by running process
  logger.error(
    { dbPath, ownerPid: result.ownerPid },
    "Database is locked by another running process"
  );
  return false;
}

/**
 * Registers cleanup handlers for graceful shutdown.
 * Call this once at application startup.
 */
export function registerShutdownHandlers(cleanupFn: () => Promise<void>): void {
  let shuttingDown = false;

  const handleShutdown = async (signal: string) => {
    if (shuttingDown) {
      // Already shutting down - force exit on second signal
      logger.warn("Forced shutdown - killing process");
      process.exit(1);
    }

    shuttingDown = true;
    logger.info({ signal }, "Received shutdown signal");

    try {
      await cleanupFn();
      logger.info("Graceful shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Error during shutdown");
      process.exit(1);
    }
  };

  // Handle various termination signals
  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGHUP", () => handleShutdown("SIGHUP"));

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    logger.fatal({ error }, "Uncaught exception - forcing shutdown");
    cleanupFn().finally(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "Unhandled rejection - forcing shutdown");
    cleanupFn().finally(() => process.exit(1));
  });
}

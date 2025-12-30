/**
 * Workers Module
 *
 * Worker thread implementations for CPU-intensive operations.
 *
 * @module
 */

// Note: Worker files are not exported as modules.
// They are loaded directly by Worker threads.
// This file exists for module structure completeness.

export const WORKER_FILES = {
  semantic: "semantic.worker.js",
} as const;

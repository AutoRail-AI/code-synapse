#!/usr/bin/env node

/**
 * Code-Synapse CLI Entry Point
 *
 * This file sets up process configuration BEFORE any other modules are loaded.
 * ESM static imports are hoisted, so we use dynamic imports to ensure
 * process configuration happens first.
 */

import { EventEmitter } from "node:events";

// Set max listeners BEFORE loading any other modules
// This prevents MaxListenersExceededWarning when multiple commands run
process.setMaxListeners(100);
EventEmitter.defaultMaxListeners = 100;

// Now dynamically load the main CLI
async function main() {
  await import("./main.js");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * Code-Synapse CLI
 * User-facing command line interface for configuration and server management
 */

import { Command } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { indexCommand } from "./commands/index.js";
import { configCommand } from "./commands/config.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("cli");

// Create the main program
const program = new Command();

program
  .name("code-synapse")
  .description("An agent-first knowledge engine for AI coding assistants")
  .version("0.1.0")
  .configureOutput({
    writeErr: (str) => process.stderr.write(chalk.red(str)),
  });

// =============================================================================
// Commands
// =============================================================================

program
  .command("init")
  .description("Initialize Code-Synapse for the current project")
  .option("-f, --force", "Force reinitialization even if already initialized")
  .option("--skip-llm", "Skip LLM-based business logic inference")
  .option("-m, --model <preset>", "LLM model preset (fastest, minimal, balanced, quality, maximum)")
  .action(initCommand);

program
  .command("start")
  .description("Start the MCP server")
  .option("-p, --port <port>", "Port to run the server on", parseInt)
  .option("-d, --debug", "Enable debug logging")
  .action(startCommand);

program
  .command("index")
  .description("Manually trigger a full project index")
  .option("-f, --force", "Force re-index all files, ignoring cache")
  .action(indexCommand);

program
  .command("status")
  .description("Show the current status of Code-Synapse")
  .option("-v, --verbose", "Show detailed statistics")
  .action(statusCommand);

program
  .command("config")
  .description("Manage Code-Synapse configuration")
  .option("-m, --model <preset>", "Set LLM model (preset or model ID)")
  .option("-l, --list-models", "List all available models")
  .option("-g, --show-guide", "Show model selection guide")
  .action(configCommand);

// =============================================================================
// Global Error Handling
// =============================================================================

/**
 * Handle uncaught errors gracefully
 */
function handleError(error: unknown): void {
  if (error instanceof Error) {
    logger.error({ err: error }, "CLI error occurred");
    console.error(chalk.red(`\nError: ${error.message}`));
    if (process.env.DEBUG || process.env.NODE_ENV === "development") {
      console.error(chalk.dim(error.stack));
    }
  } else {
    logger.error({ error }, "Unknown error occurred");
    console.error(chalk.red("\nAn unexpected error occurred"));
  }
  process.exit(1);
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
  handleError(reason);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "Uncaught exception");
  handleError(error);
});

// =============================================================================
// Signal Handlers
// =============================================================================

let isShuttingDown = false;

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn("Forced shutdown");
    process.exit(1);
  }

  isShuttingDown = true;
  logger.info({ signal }, "Received shutdown signal");
  console.log(chalk.dim(`\nReceived ${signal}, shutting down gracefully...`));

  // Give ongoing operations a chance to complete
  setTimeout(() => {
    logger.warn("Shutdown timeout, forcing exit");
    process.exit(1);
  }, 5000);

  // Cleanup will be handled by individual commands
  process.exit(0);
}

// Handle SIGINT (Ctrl+C)
process.on("SIGINT", () => shutdown("SIGINT"));

// Handle SIGTERM (kill command)
process.on("SIGTERM", () => shutdown("SIGTERM"));

// =============================================================================
// Parse and Execute
// =============================================================================

// Parse command line arguments
program.parseAsync(process.argv).catch(handleError);

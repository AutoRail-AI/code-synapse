#!/usr/bin/env node

/**
 * Code-Synapse CLI
 * User-facing command line interface for configuration and server management
 */

// Set max listeners FIRST, before any imports that might add listeners
// This prevents MaxListenersExceededWarning when multiple commands run
process.setMaxListeners(30);

import { Command } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { indexCommand } from "./commands/index.js";
import { configCommand } from "./commands/config.js";
import { defaultCommand } from "./commands/default.js";
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
// Default Command (when no subcommand is provided)
// =============================================================================

// Add default action to main program
program
  .option("-p, --port <port>", "Port to run the server on", parseInt)
  .option("-d, --debug", "Enable debug logging")
  .option("--skip-index", "Skip indexing step")
  .action(async (options) => {
    // Only run default command if no subcommand was provided
    // Commander.js will call this action if no subcommand matches
    const args = process.argv.slice(2);
    const hasSubcommand = args.some(arg => 
      ["init", "start", "index", "status", "config"].includes(arg)
    );
    
    if (!hasSubcommand) {
      await defaultCommand({
        port: options.port,
        debug: options.debug,
        skipIndex: options.skipIndex,
      });
    }
  });

// =============================================================================
// Subcommands
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

// =============================================================================
// Process Event Listeners (register only once)
// =============================================================================

// Track if listeners are already registered to prevent duplicates
let listenersRegistered = false;

/**
 * Register process event listeners (only once)
 */
function registerProcessListeners(): void {
  if (listenersRegistered) {
    return;
  }

  // Increase max listeners BEFORE adding any listeners to prevent warnings
  // This handles cases where multiple commands might add listeners
  process.setMaxListeners(30);

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

  listenersRegistered = true;
}

// Register listeners once
registerProcessListeners();

// =============================================================================
// Parse and Execute
// =============================================================================

// If no command provided, run default command
// Otherwise, parse and execute the provided command
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  // If no arguments or first argument is a flag (starts with -), run default command
  if (args.length === 0 || (args[0]?.startsWith("-") && !args[0]?.startsWith("--"))) {
    // Parse default command options manually
    const defaultOptions: Parameters<typeof defaultCommand>[0] = {
      debug: args.includes("--debug") || args.includes("-d"),
      skipIndex: args.includes("--skip-index"),
    };
    
    // Extract port if provided
    const portIndex = args.findIndex(arg => arg === "-p" || arg === "--port");
    if (portIndex !== -1 && portIndex + 1 < args.length) {
      const portArg = args[portIndex + 1];
      if (portArg) {
        const port = parseInt(portArg, 10);
        if (!isNaN(port)) {
          defaultOptions.port = port;
        }
      }
    }
    
    await defaultCommand(defaultOptions);
  } else {
    // Parse and execute subcommand
    await program.parseAsync(process.argv);
  }
}

main().catch(handleError);

/**
 * start command - Start the MCP server
 */

import chalk from "chalk";
import ora from "ora";
import {
  fileExists,
  getConfigPath,
  readJson,
  getDataDir,
  createLogger,
} from "../../utils/index.js";
import type { ProjectConfig } from "../../types/index.js";
import { startServer, stopServer } from "../../mcp/server.js";

export interface StartOptions {
  port?: number;
  debug?: boolean;
}

const DEFAULT_PORT = 3100;

// Keep track of server state for cleanup
let isServerRunning = false;
let beforeExitHandler: (() => void) | null = null;

/**
 * Start the MCP server
 */
export async function startCommand(options: StartOptions): Promise<void> {
  // Set log level based on debug flag
  if (options.debug) {
    process.env.LOG_LEVEL = "debug";
  }

  const logger = createLogger("start");
  const configPath = getConfigPath();

  logger.info({ options }, "Starting MCP server");

  // Check if initialized
  if (!fileExists(configPath)) {
    console.log(chalk.red("Code-Synapse is not initialized in this project."));
    console.log(
      chalk.dim("Run"),
      chalk.white("code-synapse init"),
      chalk.dim("first.")
    );
    process.exit(1);
  }

  // Load configuration
  const config = readJson<ProjectConfig>(configPath);
  if (!config) {
    console.log(chalk.red("Failed to read configuration."));
    console.log(chalk.dim("Try running"), chalk.white("code-synapse init --force"));
    process.exit(1);
  }

  const port = options.port ?? DEFAULT_PORT;
  const spinner = ora("Starting MCP server...").start();

  // Setup cleanup handler
  const cleanup = async () => {
    if (isServerRunning) {
      logger.info("Stopping server...");
      await stopServer();
      isServerRunning = false;
    }
  };

  // Register cleanup on exit (remove previous handler if exists to prevent duplicates)
  if (beforeExitHandler) {
    process.removeListener("beforeExit", beforeExitHandler);
  }
  
  beforeExitHandler = () => {
    // Only cleanup if server is actually running
    // Don't cleanup on beforeExit if we're in stdio mode and stdin is still open
    if (isServerRunning) {
      // beforeExit doesn't support async, so we call cleanup but don't await
      cleanup().catch((err) => {
        logger.error({ err }, "Error during cleanup");
      });
    }
  };
  process.on("beforeExit", beforeExitHandler);

  try {
    spinner.text = "Initializing indexer...";
    logger.debug({ config: config.name, port }, "Server configuration");

    await startServer({
      port,
      config,
      dataDir: getDataDir(),
    });

    isServerRunning = true;
    spinner.succeed(chalk.green(`MCP server started on port ${port}`));

    console.log();
    console.log(chalk.cyan("Server is ready to accept connections from AI agents."));
    console.log();

    // Display configuration for AI agents
    console.log(chalk.dim("MCP Configuration (stdio transport - recommended):"));
    console.log();
    
    console.log(chalk.dim("For Claude Code - Add to ~/.claude.json or .mcp.json:"));
    console.log(chalk.white(JSON.stringify({
      mcpServers: {
        [config.name]: {
          command: "code-synapse",
          args: ["start"],
          cwd: config.root,
        },
      },
    }, null, 2)));
    console.log();
    
    console.log(chalk.dim("For Cursor - Add to .cursor/mcp.json or ~/.cursor/mcp.json:"));
    console.log(chalk.white(JSON.stringify({
      mcpServers: {
        [config.name]: {
          command: "code-synapse",
          args: ["start"],
          cwd: config.root,
        },
      },
    }, null, 2)));
    console.log();
    
    console.log(chalk.dim("Alternative: HTTP transport"));
    console.log(chalk.dim(`  URL: http://localhost:${port}/mcp`));
    console.log();

    if (options.debug) {
      console.log(chalk.yellow("Debug mode enabled - verbose logging active"));
      console.log();
    }

    console.log(chalk.dim("Press Ctrl+C to stop the server."));

    // Keep process running
    logger.info({ port }, "Server running");

    // Keep process alive - wait for stdin to close (when AI agent disconnects) or signal
    // For stdio transport, the MCP SDK handles stdin, but we need to prevent premature exit
    // When running manually from terminal, stdin is a TTY and we need to wait for signals
    // When running via AI agent, stdin is a pipe and we wait for it to close
    
    // Keep stdin open to prevent premature exit
    // In stdio mode, we need stdin to stay open for MCP communication
    if (!process.stdin.isTTY) {
      // When running via AI agent (pipe), stdin is managed by MCP SDK
      // Just wait for it to close
      await new Promise<void>((resolve) => {
        const onClose = () => {
          resolve();
        };
        process.stdin.once("end", onClose);
        process.stdin.once("close", onClose);
        process.once("SIGINT", onClose);
        process.once("SIGTERM", onClose);
      });
    } else {
      // When running manually in terminal (TTY), keep process alive
      // Wait for Ctrl+C or kill signal
      // The MCP SDK's stdio transport will handle stdin, but we need to prevent exit
      await new Promise<void>((resolve) => {
        const onSignal = () => {
          resolve();
        };
        process.once("SIGINT", onSignal);
        process.once("SIGTERM", onSignal);
        
        // Keep stdin readable to prevent event loop from becoming empty
        // This prevents beforeExit from firing prematurely
        if (process.stdin.readable) {
          process.stdin.resume();
        }
      });
    }
  } catch (error) {
    spinner.fail(chalk.red("Failed to start MCP server"));
    logger.error({ err: error }, "Server start failed");
    await cleanup();
    throw error;
  }
}

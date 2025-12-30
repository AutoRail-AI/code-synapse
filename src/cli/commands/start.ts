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

  // Register cleanup on exit
  process.on("beforeExit", cleanup);

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

    // Display configuration for AI agent
    console.log(chalk.dim("MCP Configuration for Claude Desktop:"));
    console.log(chalk.dim("Add this to your claude_desktop_config.json:"));
    console.log();
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

    if (options.debug) {
      console.log(chalk.yellow("Debug mode enabled - verbose logging active"));
      console.log();
    }

    console.log(chalk.dim("Press Ctrl+C to stop the server."));

    // Keep process running
    logger.info({ port }, "Server running");
  } catch (error) {
    spinner.fail(chalk.red("Failed to start MCP server"));
    logger.error({ err: error }, "Server start failed");
    await cleanup();
    throw error;
  }
}

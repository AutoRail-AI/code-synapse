/**
 * Default command - Auto-initialize, index, and start the MCP server + Web Viewer
 */

import chalk from "chalk";
import ora from "ora";
import * as readline from "node:readline/promises";
import * as fs from "node:fs";
import { stdin, stdout } from "node:process";
import {
  fileExists,
  getConfigPath,
  getProjectRoot,
  getGraphDbPath,
  createLogger,
} from "../../utils/index.js";
import { findAvailablePort, isPortAvailable } from "../../utils/port.js";
import { initCommand } from "./init.js";
import { indexCommand } from "./index.js";
import { startCommand } from "./start.js";
import { createGraphStore } from "../../core/graph/index.js";
import { createGraphViewer, startViewerServer } from "../../viewer/index.js";

const logger = createLogger("default");

export interface DefaultOptions {
  port?: number;
  viewerPort?: number;
  debug?: boolean;
  skipIndex?: boolean;
  skipViewer?: boolean;
}

const PORT_RANGE_START = 3100;
const PORT_RANGE_END = 3200;

/**
 * Prompt user for a port number
 */
async function promptForPort(): Promise<number> {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
  });

  try {
    while (true) {
      const answer = await rl.question(
        chalk.yellow("Enter a port number (1024-65535): ")
      );

      const port = parseInt(answer.trim(), 10);

      if (isNaN(port) || port < 1024 || port > 65535) {
        console.log(chalk.red("Invalid port. Please enter a number between 1024 and 65535."));
        continue;
      }

      const available = await isPortAvailable(port);
      if (!available) {
        console.log(chalk.red(`Port ${port} is already in use. Please choose another port.`));
        continue;
      }

      return port;
    }
  } finally {
    rl.close();
  }
}

/**
 * Default command - handles init, index, and start in one go
 * Starts both the MCP server and the Web Viewer
 */
export async function defaultCommand(options: DefaultOptions): Promise<void> {
  logger.info({ options }, "Running default command");

  const spinner = ora("Checking project status...").start();

  // Track resources for cleanup
  let viewerServer: Awaited<ReturnType<typeof startViewerServer>> | null = null;
  let graphStore: Awaited<ReturnType<typeof createGraphStore>> | null = null;
  let viewer: ReturnType<typeof createGraphViewer> | null = null;

  try {
    // Step 1: Check if initialized, if not run init
    const configPath = getConfigPath();
    if (!fileExists(configPath)) {
      spinner.info(chalk.yellow("Project not initialized"));
      spinner.start("Initializing project...");

      await initCommand({});
      spinner.succeed(chalk.green("Project initialized"));
    } else {
      spinner.succeed(chalk.green("Project already initialized"));
    }

    // Step 2: Run indexing (unless skipped)
    if (!options.skipIndex) {
      spinner.start("Indexing project...");
      await indexCommand({});
      spinner.succeed(chalk.green("Project indexed"));
    } else {
      spinner.info(chalk.dim("Skipping indexing (--skip-index flag)"));
    }

    // Step 3: Find available ports (one for MCP, one for Viewer)
    let mcpPort: number;
    let viewerPort: number;

    // Find MCP port
    if (options.port) {
      spinner.start(`Checking MCP port ${options.port}...`);
      const available = await isPortAvailable(options.port);
      if (!available) {
        spinner.fail(chalk.red(`Port ${options.port} is already in use`));
        console.log();
        console.log(chalk.yellow("MCP port is not available. Please choose another port."));
        mcpPort = await promptForPort();
      } else {
        spinner.succeed(chalk.green(`MCP port ${options.port} is available`));
        mcpPort = options.port;
      }
    } else {
      spinner.start("Finding available MCP port (3100-3200)...");
      const availablePort = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);

      if (availablePort) {
        spinner.succeed(chalk.green(`Found available MCP port: ${availablePort}`));
        mcpPort = availablePort;
      } else {
        spinner.fail(chalk.red("No available ports in range 3100-3200"));
        console.log();
        console.log(chalk.yellow("All ports in the range 3100-3200 are in use."));
        mcpPort = await promptForPort();
      }
    }

    // Find Viewer port (skip the MCP port)
    if (!options.skipViewer) {
      if (options.viewerPort) {
        spinner.start(`Checking Viewer port ${options.viewerPort}...`);
        const available = await isPortAvailable(options.viewerPort);
        if (!available) {
          spinner.fail(chalk.red(`Viewer port ${options.viewerPort} is already in use`));
          console.log();
          console.log(chalk.yellow("Viewer port is not available. Please choose another port."));
          viewerPort = await promptForPort();
        } else {
          spinner.succeed(chalk.green(`Viewer port ${options.viewerPort} is available`));
          viewerPort = options.viewerPort;
        }
      } else {
        spinner.start("Finding available Viewer port...");
        // Find a port different from MCP port
        const availableViewerPort = await findAvailablePort(mcpPort + 1, PORT_RANGE_END + 100);

        if (availableViewerPort) {
          spinner.succeed(chalk.green(`Found available Viewer port: ${availableViewerPort}`));
          viewerPort = availableViewerPort;
        } else {
          spinner.fail(chalk.red("No available ports for Viewer"));
          console.log();
          console.log(chalk.yellow("Could not find an available port for Viewer."));
          viewerPort = await promptForPort();
        }
      }
    } else {
      viewerPort = 0; // Not used
    }

    // Step 4: Start the Web Viewer (if not skipped)
    if (!options.skipViewer) {
      spinner.start("Starting Web Viewer...");

      const projectRoot = getProjectRoot();
      const dbPath = getGraphDbPath(projectRoot);

      // Check if database exists
      if (!fs.existsSync(dbPath)) {
        spinner.warn(chalk.yellow("No index database found - skipping Viewer"));
        console.log(chalk.dim("Run indexing first to enable the Viewer."));
      } else {
        // Create graph store (read-only access)
        logger.info({ dbPath }, "Opening graph database for Viewer");
        graphStore = await createGraphStore({
          path: dbPath,
          engine: "rocksdb",
          runMigrations: false,
        });
        await graphStore.initialize();

        // Create viewer
        viewer = createGraphViewer(graphStore);
        await viewer.initialize();

        // Get stats for display
        const stats = await viewer.getOverviewStats();

        // Start viewer server
        viewerServer = await startViewerServer(viewer, viewerPort, "127.0.0.1");

        spinner.succeed(chalk.green(`Web Viewer started on port ${viewerPort}`));

        // Display stats
        console.log();
        console.log(chalk.bold("Index Statistics:"));
        console.log(chalk.dim("─".repeat(40)));
        console.log(`  Files:         ${chalk.cyan(stats.totalFiles)}`);
        console.log(`  Functions:     ${chalk.cyan(stats.totalFunctions)}`);
        console.log(`  Classes:       ${chalk.cyan(stats.totalClasses)}`);
        console.log(`  Interfaces:    ${chalk.cyan(stats.totalInterfaces)}`);
        console.log(`  Relationships: ${chalk.cyan(stats.totalRelationships)}`);
        console.log(`  Embeddings:    ${chalk.cyan(Math.round(stats.embeddingCoverage * 100))}%`);
        console.log(chalk.dim("─".repeat(40)));
        console.log();
        console.log(chalk.green.bold("Web Viewer is running!"));
        console.log(`  ${chalk.cyan("→")} Dashboard: ${chalk.underline(`http://127.0.0.1:${viewerPort}`)}`);
        console.log(`  ${chalk.cyan("→")} NL Search: ${chalk.underline(`http://127.0.0.1:${viewerPort}/api/nl-search?q=your+query`)}`);
        console.log();
      }
    }

    // Step 5: Setup cleanup handler for viewer
    const cleanup = async () => {
      if (viewerServer) {
        logger.info("Stopping Viewer server...");
        await viewerServer.stop();
      }
      if (viewer) {
        await viewer.close();
      }
      if (graphStore) {
        await graphStore.close();
      }
    };

    // Handle shutdown signals
    const handleShutdown = async () => {
      console.log(chalk.dim("\nShutting down..."));
      await cleanup();
    };

    process.once("SIGINT", handleShutdown);
    process.once("SIGTERM", handleShutdown);

    // Step 6: Start the MCP server (this blocks until shutdown)
    console.log();
    await startCommand({
      port: mcpPort,
      debug: options.debug,
    });
  } catch (error) {
    spinner.fail(chalk.red("Failed to start Code-Synapse"));
    logger.error({ err: error }, "Default command failed");
    throw error;
  }
}


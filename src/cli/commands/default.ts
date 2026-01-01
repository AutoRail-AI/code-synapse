/**
 * Default command - Auto-initialize, index, and start the MCP server
 */

import chalk from "chalk";
import ora from "ora";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  fileExists,
  getConfigPath,
  createLogger,
} from "../../utils/index.js";
import { findAvailablePort, isPortAvailable } from "../../utils/port.js";
import { initCommand } from "./init.js";
import { indexCommand } from "./index.js";
import { startCommand } from "./start.js";

const logger = createLogger("default");

export interface DefaultOptions {
  port?: number;
  debug?: boolean;
  skipIndex?: boolean;
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
 */
export async function defaultCommand(options: DefaultOptions): Promise<void> {
  logger.info({ options }, "Running default command");

  const spinner = ora("Checking project status...").start();

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

    // Step 3: Find available port or use provided port
    let port: number;

    if (options.port) {
      // User provided a port, check if it's available
      spinner.start(`Checking port ${options.port}...`);
      const available = await isPortAvailable(options.port);
      if (!available) {
        spinner.fail(chalk.red(`Port ${options.port} is already in use`));
        console.log();
        console.log(chalk.yellow("Port is not available. Please choose another port."));
        port = await promptForPort();
      } else {
        spinner.succeed(chalk.green(`Port ${options.port} is available`));
        port = options.port;
      }
    } else {
      // Auto-find available port in range 3100-3200
      spinner.start("Finding available port (3100-3200)...");
      const availablePort = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);
      
      if (availablePort) {
        spinner.succeed(chalk.green(`Found available port: ${availablePort}`));
        port = availablePort;
      } else {
        spinner.fail(chalk.red("No available ports in range 3100-3200"));
        console.log();
        console.log(chalk.yellow("All ports in the range 3100-3200 are in use."));
        port = await promptForPort();
      }
    }

    // Step 4: Start the server
    console.log();
    await startCommand({
      port,
      debug: options.debug,
    });
  } catch (error) {
    spinner.fail(chalk.red("Failed to start Code-Synapse"));
    logger.error({ err: error }, "Default command failed");
    throw error;
  }
}


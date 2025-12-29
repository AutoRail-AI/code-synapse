/**
 * start command - Start the MCP server
 */

import chalk from "chalk";
import ora from "ora";
import { fileExists, getConfigPath, readJson, getDataDir } from "../../utils/index.js";
import type { ProjectConfig } from "../../types/index.js";
import { startServer } from "../../mcp/server.js";

export interface StartOptions {
  port?: number;
}

const DEFAULT_PORT = 3100;

export async function startCommand(options: StartOptions): Promise<void> {
  const configPath = getConfigPath();

  if (!fileExists(configPath)) {
    console.log(chalk.red("Code-Synapse is not initialized in this project."));
    console.log(chalk.dim("Run"), chalk.white("code-synapse init"), chalk.dim("first."));
    process.exit(1);
  }

  const config = readJson<ProjectConfig>(configPath);
  if (!config) {
    console.log(chalk.red("Failed to read configuration."));
    process.exit(1);
  }

  const port = options.port ?? DEFAULT_PORT;
  const spinner = ora("Starting MCP server...").start();

  try {
    await startServer({
      port,
      config,
      dataDir: getDataDir(),
    });

    spinner.succeed(chalk.green(`MCP server started on port ${port}`));
    console.log();
    console.log(chalk.cyan("Server is ready to accept connections from AI agents."));
    console.log(chalk.dim("Press Ctrl+C to stop the server."));
  } catch (error) {
    spinner.fail(chalk.red("Failed to start MCP server"));
    throw error;
  }
}

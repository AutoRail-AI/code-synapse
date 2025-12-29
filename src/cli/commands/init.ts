/**
 * init command - Initialize Code-Synapse for a project
 */

import chalk from "chalk";
import ora from "ora";
import type { ProjectConfig } from "../../types/index.js";
import {
  getConfigDir,
  getConfigPath,
  getDataDir,
  ensureDir,
  writeJson,
  fileExists,
} from "../../utils/index.js";

export interface InitOptions {
  force?: boolean;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const configPath = getConfigPath();

  if (fileExists(configPath) && !options.force) {
    console.log(
      chalk.yellow("Code-Synapse is already initialized in this project.")
    );
    console.log(chalk.dim("Use --force to reinitialize."));
    return;
  }

  const spinner = ora("Initializing Code-Synapse...").start();

  try {
    // Create directories
    ensureDir(getConfigDir());
    ensureDir(getDataDir());

    // Create default config
    const config: ProjectConfig = {
      root: process.cwd(),
      languages: ["typescript", "javascript", "python"],
      exclude: ["node_modules", "dist", "build", ".git"],
    };

    writeJson(configPath, config);

    spinner.succeed(chalk.green("Code-Synapse initialized successfully!"));
    console.log();
    console.log(chalk.dim("Created:"));
    console.log(chalk.dim(`  ${getConfigDir()}/`));
    console.log(chalk.dim(`  ${configPath}`));
    console.log();
    console.log(
      chalk.cyan("Next steps:")
    );
    console.log(chalk.dim("  1. Run"), chalk.white("code-synapse start"), chalk.dim("to start the MCP server"));
    console.log(chalk.dim("  2. Configure your AI agent to connect to the server"));
  } catch (error) {
    spinner.fail(chalk.red("Failed to initialize Code-Synapse"));
    throw error;
  }
}

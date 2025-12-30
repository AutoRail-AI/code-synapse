/**
 * status command - Show the current status of Code-Synapse
 */

import chalk from "chalk";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  fileExists,
  getConfigPath,
  getConfigDir,
  getDataDir,
  getGraphDbPath,
  getVectorDbPath,
  readJson,
  createLogger,
} from "../../utils/index.js";
import type { ProjectConfig, IndexStats } from "../../types/index.js";

const logger = createLogger("status");

export interface StatusOptions {
  verbose?: boolean;
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Get directory size recursively
 */
function getDirectorySize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;

  let size = 0;
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      size += getDirectorySize(filePath);
    } else {
      size += stats.size;
    }
  }

  return size;
}

/**
 * Show the current status of Code-Synapse
 */
export async function statusCommand(options: StatusOptions): Promise<void> {
  logger.info({ options }, "Checking status");

  const configPath = getConfigPath();

  // Check if initialized
  if (!fileExists(configPath)) {
    console.log(chalk.red("Code-Synapse is not initialized in this project."));
    console.log(
      chalk.dim("Run"),
      chalk.white("code-synapse init"),
      chalk.dim("to get started.")
    );
    return;
  }

  // Load configuration
  const config = readJson<ProjectConfig>(configPath);
  if (!config) {
    console.log(chalk.red("Failed to read configuration."));
    return;
  }

  console.log();
  console.log(chalk.cyan.bold("Code-Synapse Status"));
  console.log(chalk.dim("─".repeat(40)));

  // Project info
  console.log();
  console.log(chalk.white.bold("Project"));
  console.log(`  Name:       ${chalk.cyan(config.name)}`);
  console.log(`  Root:       ${chalk.dim(config.root)}`);
  console.log(`  Languages:  ${config.languages.join(", ")}`);
  if (config.framework) {
    console.log(`  Framework:  ${config.framework}`);
  }

  // Storage info
  console.log();
  console.log(chalk.white.bold("Storage"));

  const configDir = getConfigDir();
  const _dataDir = getDataDir(); // Reserved for future use
  const graphDbPath = getGraphDbPath();
  const vectorDbPath = getVectorDbPath();

  const configDirSize = getDirectorySize(configDir);
  const graphDbSize = getDirectorySize(graphDbPath);
  const vectorDbSize = getDirectorySize(vectorDbPath);

  console.log(`  Config dir:   ${chalk.dim(configDir)}`);
  console.log(`  Total size:   ${formatBytes(configDirSize)}`);

  if (options.verbose) {
    console.log(`  Graph DB:     ${formatBytes(graphDbSize)}`);
    console.log(`  Vector DB:    ${formatBytes(vectorDbSize)}`);
  }

  // Try to get index stats (placeholder for now)
  console.log();
  console.log(chalk.white.bold("Index Status"));

  // Check if databases exist
  const graphDbExists = fs.existsSync(graphDbPath) && fs.readdirSync(graphDbPath).length > 0;
  const vectorDbExists = fs.existsSync(vectorDbPath) && fs.readdirSync(vectorDbPath).length > 0;

  if (!graphDbExists && !vectorDbExists) {
    console.log(chalk.yellow("  Not indexed yet"));
    console.log(
      chalk.dim("  Run"),
      chalk.white("code-synapse index"),
      chalk.dim("to index the project")
    );
  } else {
    // TODO: Read actual stats from database
    const stats: Partial<IndexStats> = {
      fileCount: 0,
      functionCount: 0,
      classCount: 0,
      interfaceCount: 0,
      relationshipCount: 0,
    };

    console.log(`  Files:         ${stats.fileCount}`);
    console.log(`  Functions:     ${stats.functionCount}`);
    console.log(`  Classes:       ${stats.classCount}`);
    console.log(`  Interfaces:    ${stats.interfaceCount}`);
    console.log(`  Relationships: ${stats.relationshipCount}`);

    if (options.verbose) {
      console.log();
      console.log(chalk.white.bold("Business Logic Inference"));
      console.log(`  Inferred:    ${stats.inferredCount ?? 0}/${stats.functionCount}`);
      console.log(`  Progress:    ${stats.inferenceProgress ?? 0}%`);
    }
  }

  // Configuration patterns
  if (options.verbose) {
    console.log();
    console.log(chalk.white.bold("Source Patterns"));
    for (const pattern of config.sourcePatterns) {
      console.log(`  ${chalk.dim("•")} ${pattern}`);
    }

    console.log();
    console.log(chalk.white.bold("Ignore Patterns"));
    for (const pattern of config.ignorePatterns.slice(0, 5)) {
      console.log(`  ${chalk.dim("•")} ${pattern}`);
    }
    if (config.ignorePatterns.length > 5) {
      console.log(chalk.dim(`  ... and ${config.ignorePatterns.length - 5} more`));
    }
  }

  console.log();
  console.log(chalk.dim("─".repeat(40)));

  logger.info("Status check complete");
}

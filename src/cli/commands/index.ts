/**
 * index command - Manually trigger project indexing
 */

import chalk from "chalk";
import ora from "ora";
import {
  fileExists,
  getConfigPath,
  getDataDir,
  readJson,
  createLogger,
  findFiles,
} from "../../utils/index.js";
import type { ProjectConfig, IndexResult } from "../../types/index.js";
import { createIndexer } from "../../core/indexer/index.js";

const logger = createLogger("index");

export interface IndexOptions {
  force?: boolean;
}

/**
 * Format duration in human readable format
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}

/**
 * Manually trigger project indexing
 */
export async function indexCommand(options: IndexOptions): Promise<void> {
  logger.info({ options }, "Starting manual index");

  const configPath = getConfigPath();

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
    process.exit(1);
  }

  console.log();
  console.log(chalk.cyan.bold("Indexing Project"));
  console.log(chalk.dim("─".repeat(40)));
  console.log();

  const spinner = ora("Discovering files...").start();
  const startTime = Date.now();

  try {
    // Discover files first
    const files = await findFiles({
      patterns: config.sourcePatterns,
      ignore: config.ignorePatterns,
      cwd: config.root,
      absolute: true,
    });

    spinner.text = `Found ${files.length} files to index`;
    logger.info({ fileCount: files.length }, "Files discovered");

    // Initialize indexer
    spinner.text = "Initializing indexer...";
    const indexer = createIndexer({
      config,
      dataDir: getDataDir(),
    });

    await indexer.initialize();

    // Run indexing
    spinner.text = `Indexing ${files.length} files...`;

    // TODO: Replace with actual indexing when implemented
    // For now, simulate progress
    const result: IndexResult = {
      filesIndexed: files.length,
      functionsFound: 0,
      classesFound: 0,
      duration: 0,
      errors: [],
    };

    // Process files (placeholder - will be implemented in later phases)
    let processed = 0;
    for (const file of files) {
      processed++;
      if (processed % 10 === 0 || processed === files.length) {
        spinner.text = `Indexing files... (${processed}/${files.length})`;
      }

      // TODO: Actually parse and index the file
      // const parsed = await parser.parseFile(file);
      // await graphDb.insertFile(parsed);
      // await vectorDb.insertEmbeddings(parsed);

      logger.debug({ file }, "Indexed file");
    }

    const duration = (Date.now() - startTime) / 1000;
    result.duration = duration;

    // Close indexer
    await indexer.close();

    spinner.succeed(chalk.green("Indexing complete!"));

    // Display results
    console.log();
    console.log(chalk.white.bold("Results"));
    console.log(`  Files indexed:    ${result.filesIndexed}`);
    console.log(`  Functions found:  ${result.functionsFound}`);
    console.log(`  Classes found:    ${result.classesFound}`);
    console.log(`  Duration:         ${formatDuration(result.duration)}`);

    if (result.errors.length > 0) {
      console.log();
      console.log(chalk.yellow.bold(`Errors (${result.errors.length})`));
      for (const err of result.errors.slice(0, 5)) {
        console.log(`  ${chalk.red("✗")} ${err.file}: ${err.error}`);
      }
      if (result.errors.length > 5) {
        console.log(chalk.dim(`  ... and ${result.errors.length - 5} more errors`));
      }
    }

    console.log();
    console.log(chalk.dim("─".repeat(40)));

    if (options.force) {
      console.log(chalk.dim("Full re-index completed (--force flag used)"));
    }

    logger.info({ result }, "Indexing complete");
  } catch (error) {
    spinner.fail(chalk.red("Indexing failed"));
    logger.error({ err: error }, "Indexing failed");
    throw error;
  }
}

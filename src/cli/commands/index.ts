/**
 * index command - Manually trigger project indexing
 */

import chalk from "chalk";
import ora from "ora";
import {
  fileExists,
  getConfigPath,
  
  getGraphDbPath,
  readJson,
  createLogger,
} from "../../utils/index.js";
import type { ProjectConfig } from "../../types/index.js";
import { createGraphStore } from "../../core/graph/index.js";
import { createIParser } from "../../core/parser/index.js";
import {
  createIndexerCoordinator,
  detectProject,
  type IndexingProgressEvent,
} from "../../core/indexer/index.js";

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

  const spinner = ora("Initializing...").start();
  const startTime = Date.now();

  try {
    // Detect project
    spinner.text = "Detecting project structure...";
    const project = await detectProject(config.root);

    if (!project) {
      spinner.fail(chalk.red("Could not detect project"));
      console.log(chalk.dim("Make sure you're in a valid project directory"));
      process.exit(1);
    }

    // Initialize parser
    spinner.text = "Initializing parser...";
    const parser = await createIParser();

    // Initialize graph store
    spinner.text = "Initializing database...";
    const graphDbPath = getGraphDbPath();
    const store = await createGraphStore({ path: graphDbPath });

    // Create indexer coordinator
    const indexer = createIndexerCoordinator({
      parser,
      store,
      project,
      batchSize: 10,
      continueOnError: true,
      onProgress: (event: IndexingProgressEvent) => {
        updateSpinner(spinner, event);
      },
    });

    // Run indexing
    spinner.text = "Scanning project files...";
    const result = await indexer.indexProject();

    const duration = (Date.now() - startTime) / 1000;

    // Close resources
    await store.close();

    if (result.success) {
      spinner.succeed(chalk.green("Indexing complete!"));
    } else {
      spinner.warn(chalk.yellow("Indexing completed with errors"));
    }

    // Display results
    console.log();
    console.log(chalk.white.bold("Results"));
    console.log(`  Files indexed:         ${result.filesIndexed}`);
    console.log(`  Files failed:          ${result.filesFailed}`);
    console.log(`  Entities extracted:    ${result.entitiesWritten}`);
    console.log(`  Relationships:         ${result.relationshipsWritten}`);
    console.log(`  Duration:              ${formatDuration(duration)}`);

    // Show phase breakdown
    console.log();
    console.log(chalk.white.bold("Phases"));
    console.log(`  Scanning:    ${result.phases.scanning.files} files in ${formatDuration(result.phases.scanning.durationMs / 1000)}`);
    console.log(`  Parsing:     ${result.phases.parsing.files} files in ${formatDuration(result.phases.parsing.durationMs / 1000)}`);
    console.log(`  Extracting:  ${result.phases.extracting.files} files in ${formatDuration(result.phases.extracting.durationMs / 1000)}`);
    console.log(`  Writing:     ${result.phases.writing.files} files in ${formatDuration(result.phases.writing.durationMs / 1000)}`);

    if (result.errors.length > 0) {
      console.log();
      console.log(chalk.yellow.bold(`Errors (${result.errors.length})`));
      for (const err of result.errors.slice(0, 5)) {
        console.log(`  ${chalk.red("✗")} ${err.filePath}: ${err.error}`);
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

    console.log(chalk.dim("Run 'code-synapse status' to view index details"));

    logger.info({ result }, "Indexing complete");
  } catch (error) {
    spinner.fail(chalk.red("Indexing failed"));
    logger.error({ err: error }, "Indexing failed");
    throw error;
  }
}

/**
 * Update spinner text based on indexing progress
 */
function updateSpinner(spinner: ReturnType<typeof ora>, event: IndexingProgressEvent): void {
  const phaseEmoji: Record<string, string> = {
    scanning: "🔍",
    parsing: "📄",
    extracting: "⚙️",
    writing: "💾",
    complete: "✅",
  };

  const emoji = phaseEmoji[event.phase] || "⏳";
  const progress = `${event.processed}/${event.total}`;
  const percent = `${event.percentage}%`;

  if (event.currentFile) {
    const shortFile = event.currentFile.length > 30
      ? "..." + event.currentFile.slice(-27)
      : event.currentFile;
    spinner.text = `${emoji} ${event.message} (${progress}, ${percent}) - ${shortFile}`;
  } else {
    spinner.text = `${emoji} ${event.message} (${progress}, ${percent})`;
  }
}

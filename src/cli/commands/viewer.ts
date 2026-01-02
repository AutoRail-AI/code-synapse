/**
 * Viewer Command
 *
 * Starts the Index Viewer UI server for visualizing indexed code knowledge.
 * This provides a read-only web dashboard to explore what has been indexed.
 *
 * @module
 */

import chalk from "chalk";
import ora from "ora";
import * as fs from "node:fs";
import { createGraphStore } from "../../core/graph/index.js";
import { createGraphViewer, startViewerServer } from "../../viewer/index.js";
import { createLogger, getProjectRoot, getConfigDir, getGraphDbPath } from "../../utils/index.js";

const logger = createLogger("cli:viewer");

// =============================================================================
// Command Options
// =============================================================================

interface ViewerCommandOptions {
  port?: number;
  host?: string;
  json?: boolean;
}

// =============================================================================
// Command Implementation
// =============================================================================

/**
 * Start the Index Viewer UI server
 */
export async function viewerCommand(options: ViewerCommandOptions): Promise<void> {
  const port = options.port ?? 3100;
  const host = options.host ?? "127.0.0.1";
  const jsonOutput = options.json ?? false;

  // Find project root (look for .code-synapse directory)
  let projectRoot: string;
  try {
    projectRoot = getProjectRoot();
  } catch {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: "Not in a Code-Synapse project" }));
    } else {
      console.log(chalk.red("Error: Not in a Code-Synapse project."));
      console.log(chalk.dim("Run 'code-synapse init' first to initialize the project."));
    }
    process.exit(1);
  }

  const configDir = getConfigDir(projectRoot);
  const dbPath = getGraphDbPath(projectRoot);

  // Check if config directory exists
  if (!fs.existsSync(configDir)) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: "Not in a Code-Synapse project" }));
    } else {
      console.log(chalk.red("Error: Not in a Code-Synapse project."));
      console.log(chalk.dim("Run 'code-synapse init' first to initialize the project."));
    }
    process.exit(1);
  }

  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: "No index database found" }));
    } else {
      console.log(chalk.red("Error: No index database found."));
      console.log(chalk.dim("Run 'code-synapse index' first to index the project."));
    }
    process.exit(1);
  }

  // If JSON output, just return stats
  if (jsonOutput) {
    await outputStatsAsJson(dbPath);
    return;
  }

  const spinner = ora("Starting Index Viewer...").start();

  try {
    // Create graph store (read-only access)
    logger.info({ dbPath }, "Opening graph database");
    const graphStore = await createGraphStore({
      path: dbPath,
      engine: "rocksdb",
      runMigrations: false, // Don't run migrations - read-only
    });
    await graphStore.initialize();

    // Create viewer
    const viewer = createGraphViewer(graphStore);
    await viewer.initialize();

    spinner.text = "Getting index statistics...";

    // Get stats for display
    const stats = await viewer.getOverviewStats();

    spinner.succeed("Index Viewer ready");

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

    // Start server
    console.log(chalk.dim("Starting HTTP server..."));

    const server = await startViewerServer(viewer, port, host);

    console.log();
    console.log(chalk.green.bold("Index Viewer is running!"));
    console.log();
    console.log(`  ${chalk.cyan("→")} Local:   ${chalk.underline(`http://${host}:${port}`)}`);
    console.log();
    console.log(chalk.dim("Press Ctrl+C to stop the server"));

    // Handle shutdown
    const shutdown = async () => {
      console.log(chalk.dim("\nShutting down..."));
      await server.stop();
      await viewer.close();
      await graphStore.close();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep process alive
    await new Promise(() => {
      // Never resolves - server runs until interrupted
    });
  } catch (error) {
    spinner.fail("Failed to start viewer");
    logger.error({ err: error }, "Viewer command failed");

    if (error instanceof Error) {
      console.error(chalk.red(`\nError: ${error.message}`));
    }
    process.exit(1);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Output stats as JSON (for scripting)
 */
async function outputStatsAsJson(dbPath: string): Promise<void> {
  try {
    const graphStore = await createGraphStore({
      path: dbPath,
      engine: "rocksdb",
      runMigrations: false,
    });
    await graphStore.initialize();

    const viewer = createGraphViewer(graphStore);
    await viewer.initialize();

    const [overview, entities, relationships, health] = await Promise.all([
      viewer.getOverviewStats(),
      viewer.getEntityCounts(),
      viewer.getRelationshipCounts(),
      viewer.getIndexHealth(),
    ]);

    console.log(
      JSON.stringify(
        {
          overview,
          entities,
          relationships,
          health,
        },
        null,
        2
      )
    );

    await viewer.close();
    await graphStore.close();
  } catch (error) {
    console.log(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      })
    );
    process.exit(1);
  }
}

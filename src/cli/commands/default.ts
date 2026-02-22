/**
 * Default command - Auto-initialize, index, and start the MCP server + Web Viewer
 *
 * This command shares a single database connection across all steps to avoid
 * RocksDB lock conflicts.
 */

// Note: Max listeners is set in cli/index.ts at module level

import * as path from "node:path";
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
  getDataDir,
  readJson,
  createLogger,
} from "../../utils/index.js";
import { findAvailablePort, isPortAvailable } from "../../utils/port.js";
import { initCommand } from "./init.js";
import { startCommand } from "./start.js";
import { createGraphStore, createStorageAdapter, type IGraphStore } from "../../core/graph/index.js";
import type { GraphDatabase } from "../../core/graph/index.js";
import { createGraphViewer, startViewerServer } from "../../viewer/index.js";
import type { ViewerServerOptions } from "../../viewer/ui/server.js";
import { createIParser } from "../../core/parser/index.js";
import {
  createChangeLedger,
  createLedgerStorage,
  createLedgerEntry,
  type IChangeLedger,
} from "../../core/ledger/index.js";
import {
  createIndexerCoordinator,
  detectProject,
  type IndexingProgressEvent,
} from "../../core/indexer/index.js";
import {
  createEmbeddingService,
  type IEmbeddingService,
} from "../../core/embeddings/index.js";
import {
  ZoektManager,
  HybridSearchService,
} from "../../core/search/index.js";
import {
  createLLMJustificationService,
  type JustificationProgress,
} from "../../core/justification/index.js";
import {
  createConfiguredModelRouter,
  type IModelRouter,
} from "../../core/models/index.js";
import {
  type ModelPreset,
  MODEL_PRESETS,
  getDefaultModelForProvider,
} from "../../core/llm/index.js";
import type { ProjectConfig } from "../../types/index.js";
import { InteractiveSetup, type CodeSynapseConfig } from "./setup.js";
import { runInteractiveClarification, createReadlineInterface, askQuestion } from "../interactive.js";
import { getProviderDisplay } from "../provider-display.js";


const logger = createLogger("default");

export interface DefaultOptions {
  port?: number;
  viewerPort?: number;
  debug?: boolean;
  skipIndex?: boolean;
  skipViewer?: boolean;
  /** Skip business justification step */
  skipJustify?: boolean;
  /** Run only business justification (skip index) */
  justifyOnly?: boolean;
  /** LLM model preset for justification */
  model?: ModelPreset;
}

const PORT_RANGE_START = 3100;
const PORT_RANGE_END = 3200;



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
 * Format confidence with color
 */
function formatConfidence(score: number): string {
  const percent = Math.round(score * 100);
  if (score >= 0.8) {
    return chalk.green(`${percent}%`);
  } else if (score >= 0.5) {
    return chalk.yellow(`${percent}%`);
  } else if (score >= 0.3) {
    return chalk.red(`${percent}%`);
  }
  return chalk.gray(`${percent}%`);
}

/**
 * Prompt user for a port number
 */
async function promptForPort(): Promise<number> {
  // Import logging control (already re-exported from utils)
  const { pauseLogging, resumeLogging } = await import("../../utils/index.js");

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
  });

  try {
    while (true) {
      pauseLogging();
      const answer = await rl.question(
        chalk.yellow("Enter a port number (1024-65535): ")
      );
      resumeLogging();

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
 * Run indexing with shared database connection
 */
async function runIndexing(
  store: IGraphStore,
  config: ProjectConfig,
  spinner: ReturnType<typeof ora>,
  embeddingService?: IEmbeddingService
): Promise<boolean> {
  const startTime = Date.now();

  try {
    // Detect project
    spinner.text = "Detecting project structure...";
    const project = await detectProject(config.root);

    if (!project) {
      spinner.fail(chalk.red("Could not detect project"));
      return false;
    }

    // Initialize parser
    spinner.text = "Initializing parser...";
    const parser = await createIParser();

    // Create indexer coordinator
    const indexer = createIndexerCoordinator({
      parser,
      store,
      project,
      batchSize: 10,
      continueOnError: true,
      embeddingService,
      onProgress: (event: IndexingProgressEvent) => {
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
      },
    });

    // Run indexing
    spinner.text = "Scanning project files...";
    const result = await indexer.indexProject();

    const duration = (Date.now() - startTime) / 1000;

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

    return result.success;
  } catch (error) {
    spinner.fail(chalk.red("Indexing failed"));
    logger.error({ err: error }, "Indexing failed");
    return false;
  }
}

/**
 * Run justification with shared database connection
 */
async function runJustification(
  store: IGraphStore,
  modelPreset: ModelPreset | undefined,
  spinner: ReturnType<typeof ora>
): Promise<boolean> {
  let modelRouter: IModelRouter | null = null;

  try {
    // Read config to get model provider setting
    const configPath = getConfigPath();
    const config = readJson<CodeSynapseConfig>(configPath);
    const modelProvider = config?.modelProvider ?? "local";
    const savedModelId = config?.llmModel;

    // Get API key from config if available
    const apiKey = config?.apiKeys?.[modelProvider as keyof typeof config.apiKeys];

    // Initialize Model Router based on provider
    const preset = modelPreset || "balanced";
    let actualModelId: string | undefined;

    try {
      spinner.text = "Initializing model router...";

      // Determine model ID based on provider type
      const providerDisplay = getProviderDisplay(modelProvider);
      if (providerDisplay.isLocal) {
        actualModelId = MODEL_PRESETS[preset];
      } else {
        actualModelId = savedModelId || getDefaultModelForProvider(modelProvider);
      }

      // Use clean public API - handles API key injection and provider setup
      const result = await createConfiguredModelRouter({
        provider: modelProvider,
        apiKey,
        modelId: actualModelId,
      });

      modelRouter = result.router;

      if (providerDisplay.isLocal) {
        spinner.text = `Local model router initialized (${preset})`;
      } else {
        spinner.text = `${result.providerDisplayName} API connected`;
        console.log(chalk.dim(`  Using ${result.providerDisplayName} API (${result.modelId})`));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      spinner.warn(chalk.yellow(`LLM not available: ${errorMessage}`));
      console.log(chalk.dim("  Continuing with code analysis only"));
      modelRouter = null;
    }

    // Create justification service
    const justificationService = createLLMJustificationService(store, modelRouter ?? undefined);
    await justificationService.initialize();

    // Run justification
    spinner.text = "Analyzing code...";

    const result = await justificationService.justifyProject({
      force: false,
      skipLLM: modelRouter === null,
      modelId: actualModelId,
      onProgress: (progress: JustificationProgress) => {
        spinner.text = `${progress.phase}: ${progress.current}/${progress.total}`;
      },
    });

    spinner.succeed(chalk.green("Justification complete!"));

    // Display results
    console.log();
    console.log(chalk.white.bold("Justification Results"));
    console.log(`  Entities justified:    ${result.stats.succeeded}`);
    console.log(`  Entities failed:       ${result.stats.failed}`);
    console.log(`  Entities skipped:      ${result.stats.skipped}`);
    console.log(`  Pending clarification: ${result.stats.pendingClarification}`);
    console.log(
      `  Average confidence:    ${formatConfidence(result.stats.averageConfidence)}`
    );
    console.log(`  Duration:              ${formatDuration(result.stats.durationMs / 1000)}`);

    console.log();
    console.log(chalk.dim("─".repeat(50)));

    // Interactive mode for pending clarifications
    if (result.stats.pendingClarification > 0) {
      console.log();
      console.log(chalk.yellow(`There are ${result.stats.pendingClarification} entities that need clarification.`));

      // Pause logging briefly to let any async logs flush
      await new Promise(resolve => setTimeout(resolve, 100));

      const rl = createReadlineInterface();
      const answer = await askQuestion(rl, chalk.white("Do you want to answer clarification questions now? (Y/n) "));
      rl.close();

      if (answer.toLowerCase() !== 'n' && answer.toLowerCase() !== 'no') {
        try {
          await runInteractiveClarification(justificationService, false);
        } catch (clarificationError) {
          logger.error({ err: clarificationError }, "Interactive clarification failed");
          console.error(chalk.red(`\nCLARIFICATION ERROR: ${clarificationError instanceof Error ? clarificationError.message : String(clarificationError)}\n`));
        }
      }
    }

    return true;
  } catch (error) {
    spinner.fail(chalk.red("Justification failed"));
    logger.error({ err: error }, "Justification failed");
    return false;
  } finally {
    if (modelRouter) {
      try {
        await modelRouter.shutdown();
      } catch {
        // Ignore shutdown errors
      }
    }
  }
}



/**
 * Default command - handles init, index, and start in one go
 * Starts both the MCP server and the Web Viewer
 * Uses a shared database connection to avoid RocksDB lock conflicts.
 */
export async function defaultCommand(options: DefaultOptions): Promise<void> {
  // Track resources for cleanup
  let viewerServer: Awaited<ReturnType<typeof startViewerServer>> | null = null;
  let graphStore: IGraphStore | null = null;
  let viewer: ReturnType<typeof createGraphViewer> | null = null;
  let changeLedger: IChangeLedger | null = null;
  // Phase 6: Hybrid search (shared between viewer and MCP)
  let hybridEmbeddingService: IEmbeddingService | null = null;
  let hybridZoektManager: ZoektManager | null = null;
  let hybridSearchService: HybridSearchService | null = null;

  // Step 1: Check if initialized, if not run interactive setup (before any logging)
  const configPath = getConfigPath();
  if (!fileExists(configPath)) {
    // Run interactive setup to get user preferences
    const setup = new InteractiveSetup();
    const setupConfig = await setup.run();

    // Now we can log (after interactive setup is complete)
    logger.debug({ options }, "Running default command");

    const spinner = ora("Initializing project...").start();
    try {
      await initCommand({
        model: setupConfig?.llmModel,
        skipLlm: setupConfig?.skipLlm ?? false,
        modelProvider: setupConfig?.modelProvider,
        apiKeys: setupConfig?.apiKeys,
      });
      spinner.succeed(chalk.green("Project initialized"));
    } catch (error) {
      spinner.fail(chalk.red("Failed to initialize project"));
      throw error;
    }
  } else {
    logger.debug({ options }, "Running default command");
  }

  const spinner = ora("Checking project status...").start();

  try {
    if (fileExists(configPath)) {
      spinner.succeed(chalk.green("Project already initialized"));
    }

    // Load configuration
    const config = readJson<ProjectConfig>(configPath);
    if (!config) {
      spinner.fail(chalk.red("Failed to read configuration"));
      return;
    }

    // Get database path
    const projectRoot = getProjectRoot();
    const dbPath = getGraphDbPath(projectRoot);

    // Step 2: Open shared database connection
    spinner.start("Opening database...");
    graphStore = await createGraphStore({
      path: dbPath,
      engine: "rocksdb",
      runMigrations: true,
    });
    await graphStore.initialize();
    spinner.succeed(chalk.green("Database opened"));

    // Create change ledger for observability
    spinner.start("Initializing change ledger...");
    const ledgerAdapter = createStorageAdapter(graphStore);
    const ledgerStorage = createLedgerStorage(ledgerAdapter);
    changeLedger = createChangeLedger(ledgerStorage, {
      memoryCacheSize: 10000,
      persistToDisk: true,
      flushIntervalMs: 1000,
      maxBatchSize: 100,
      retentionDays: 90,
      enableSubscriptions: true,
    });
    await changeLedger.initialize();
    spinner.succeed(chalk.green("Change ledger initialized"));

    // Log system startup
    await changeLedger.append(
      createLedgerEntry(
        "system:startup",
        "user-interface",
        "Code-Synapse started - default command"
      )
    );

    // Step 3: Run indexing (unless skipped or justify-only)
    if (!options.skipIndex && !options.justifyOnly) {
      console.log();
      console.log(chalk.cyan.bold("Indexing Project"));
      console.log(chalk.dim("─".repeat(40)));
      console.log();

      // Initialize embedding service for vector generation during indexing
      let embeddingService: IEmbeddingService | undefined;
      try {
        spinner.start("Initializing embedding model...");
        embeddingService = createEmbeddingService();
        await embeddingService.initialize();
        spinner.succeed(chalk.green("Embedding model loaded"));
      } catch (embeddingError) {
        spinner.warn(chalk.yellow("Embedding model unavailable - indexing without embeddings"));
        logger.warn({ err: embeddingError }, "Failed to initialize embedding service for indexing");
        embeddingService = undefined;
      }

      spinner.start("Indexing project...");
      await runIndexing(graphStore, config, spinner, embeddingService);

      // Log indexing completion
      if (changeLedger) {
        await changeLedger.append(
          createLedgerEntry(
            "index:scan:completed",
            "filesystem",
            "Indexing completed successfully"
          )
        );
      }
    } else if (options.justifyOnly) {
      spinner.info(chalk.dim("Skipping indexing (--justify-only flag)"));
    } else {
      spinner.info(chalk.dim("Skipping indexing (--skip-index flag)"));
    }

    // Step 4: Run business justification (unless skipped)
    let modelRouterForClassification: IModelRouter | null = null;
    if (!options.skipJustify) {
      console.log();
      console.log(chalk.cyan.bold("Business Justification Layer"));
      console.log(chalk.dim("─".repeat(50)));
      console.log();

      spinner.start("Running business justification...");
      // Note: We don't get the router back from runJustification, so we can't reuse it easily here
      // For now, runClassification will re-initialize or we should refactor runJustification to return it
      // To keep it simple for this fix, we'll pass null to classification if we can't get it, 
      // but ideally we should refactor. 
      // Actually, let's just initialize it again in runClassification if needed, or pass null.
      // But wait, runJustification initializes it locally.

      const justifySuccess = await runJustification(graphStore, options.model, spinner);
      if (!justifySuccess) {
        spinner.warn(chalk.yellow("Business justification had issues, continuing..."));
      }

      // Log justification completion
      if (changeLedger) {
        await changeLedger.append(
          createLedgerEntry(
            "justify:completed",
            "justification-engine",
            "Business justification completed"
          )
        );
      }
    } else {
      spinner.info(chalk.dim("Skipping justification (--skip-justify flag)"));
    }

    // Step 4.5: Run classification (Domain/Infrastructure)
    // Deprecated: Classification is now part of the unified Justification process (Phase 6)
    // if (!options.skipJustify) {
    //   console.log();
    //   console.log(chalk.cyan.bold("Business Classification Layer"));
    //   console.log(chalk.dim("─".repeat(50)));
    //   console.log();
    //
    //   spinner.start("Running classification...");
    //   // Classification is now handled during justification
    //   spinner.info(chalk.dim("Classification matched with Justification (Unified Analysis)"));
    // }

    // Step 5: Find available ports (one for MCP, one for Viewer)
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

    // Step 5.5: Initialize hybrid search services (Phase 6 - shared by viewer and MCP)
    if (!options.skipViewer) {
      try {
        spinner.start("Initializing hybrid search (embeddings + Zoekt)...");
        hybridEmbeddingService = createEmbeddingService();
        await hybridEmbeddingService.initialize();
        hybridZoektManager = new ZoektManager({
          repoRoot: config.root,
          dataDir: getDataDir(projectRoot),
          port: 6070,
          binDir: path.join(config.root, "bin"),
        });
        await hybridZoektManager.start();
        hybridSearchService = new HybridSearchService(
          graphStore as unknown as import("../../core/interfaces/IGraphStore.js").IGraphStore,
          hybridEmbeddingService,
          hybridZoektManager,
          undefined // LLM injected by MCP server for synthesis
        );
        spinner.succeed(chalk.green("Hybrid search ready"));
      } catch (hybridErr) {
        logger.warn({ err: hybridErr }, "Hybrid search unavailable - Insight tab will show 503");
        spinner.info(chalk.dim("Hybrid search unavailable (embeddings/Zoekt)"));
        hybridEmbeddingService = null;
        hybridZoektManager = null;
        hybridSearchService = null;
      }
    }

    // Step 6: Start the Web Viewer (if not skipped)
    if (!options.skipViewer) {
      spinner.start("Starting Web Viewer...");

      // Create viewer using the shared graph store
      viewer = createGraphViewer(graphStore);
      await viewer.initialize();

      // Get stats for display
      const stats = await viewer.getOverviewStats();

      // Start viewer server with classification, ledger, hybrid search, and MCP tool REST APIs
      const graphDatabase = (graphStore as unknown as { getDatabase(): GraphDatabase }).getDatabase();
      const viewerOptions: ViewerServerOptions = {
        changeLedger: changeLedger ?? undefined,
        hybridSearchService: hybridSearchService ?? undefined,
        graphDatabase,
        graphStore,
      };
      viewerServer = await startViewerServer(viewer, viewerPort, "127.0.0.1", viewerOptions);

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

    // Step 7: Setup cleanup handler
    const cleanup = async () => {
      // Close change ledger FIRST (stops flush timer before DB close)
      if (changeLedger) {
        try {
          await changeLedger.shutdown();
        } catch {
          // Ignore shutdown errors
        }
      }
      if (viewerServer) {
        logger.info("Stopping Viewer server...");
        await viewerServer.stop();
      }
      if (viewer) {
        await viewer.close();
      }
      // Note: graphStore is closed in the finally block
    };

    // Handle shutdown signals
    const handleShutdown = async () => {
      console.log(chalk.dim("\nShutting down..."));
      await cleanup();
    };

    process.once("SIGINT", handleShutdown);
    process.once("SIGTERM", handleShutdown);

    // Step 8: Start the MCP server (this blocks until shutdown)
    // Pass existing graphStore and hybrid search services to avoid port conflicts
    console.log();
    await startCommand({
      port: mcpPort,
      debug: options.debug,
      existingStore: graphStore,
      existingEmbeddingService: hybridEmbeddingService ?? undefined,
      existingZoektManager: hybridZoektManager ?? undefined,
    });
  } catch (error) {
    spinner.fail(chalk.red("Failed to start Code-Synapse"));
    logger.error({ err: error }, "Default command failed");
    throw error;
  } finally {
    // Always cleanup - ledger MUST be closed before database
    if (changeLedger) {
      try {
        await changeLedger.shutdown();
      } catch {
        // Ignore shutdown errors
      }
    }
    // Close database connection after ledger
    if (graphStore) {
      try {
        await graphStore.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

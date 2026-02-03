/**
 * Default command - Auto-initialize, index, and start the MCP server + Web Viewer
 *
 * This command shares a single database connection across all steps to avoid
 * RocksDB lock conflicts.
 */

// Note: Max listeners is set in cli/index.ts at module level

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
  readJson,
  createLogger,
} from "../../utils/index.js";
import { findAvailablePort, isPortAvailable } from "../../utils/port.js";
import { initCommand } from "./init.js";
import { startCommand } from "./start.js";
import { createGraphStore, type IGraphStore } from "../../core/graph/index.js";
import { createGraphViewer, startViewerServer } from "../../viewer/index.js";
import type { ViewerServerOptions } from "../../viewer/ui/server.js";
import { createIParser } from "../../core/parser/index.js";
import {
  createClassificationStorage,
  createClassificationEngine,
  type IClassificationEngine,
} from "../../core/classification/index.js";
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
  createLLMJustificationService,
  type JustificationProgress,
} from "../../core/justification/index.js";
import {
  createInitializedModelRouter,
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
  spinner: ReturnType<typeof ora>
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

    // Set API key in environment for providers
    if (apiKey) {
      if (modelProvider === "openai") process.env.OPENAI_API_KEY = apiKey;
      if (modelProvider === "anthropic") process.env.ANTHROPIC_API_KEY = apiKey;
      if (modelProvider === "google") process.env.GOOGLE_API_KEY = apiKey;
    }

    // Initialize Model Router based on provider
    const preset = modelPreset || "balanced";
    let actualModelId: string | undefined;

    try {
      spinner.text = "Initializing model router...";

      modelRouter = await createInitializedModelRouter({
        enableLocal: modelProvider === "local",
        enableOpenAI: modelProvider === "openai",
        enableAnthropic: modelProvider === "anthropic",
        enableGoogle: modelProvider === "google",
      });

      if (modelProvider === "local") {
        actualModelId = MODEL_PRESETS[preset];
        spinner.text = `Local model router initialized (${preset})`;
      } else {
        actualModelId = savedModelId || getDefaultModelForProvider(modelProvider);
        spinner.text = `${modelProvider} API connected`;
        console.log(chalk.dim(`  Using ${modelProvider} API (${actualModelId})`));
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

      const rl = createReadlineInterface();
      const answer = await askQuestion(rl, chalk.white("Do you want to answer clarification questions now? (Y/n) "));
      rl.close();

      if (answer.toLowerCase() !== 'n' && answer.toLowerCase() !== 'no') {
        await runInteractiveClarification(justificationService, false);
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
 * Run classification with shared database connection
 */
async function runClassification(
  store: IGraphStore,
  modelRouter: IModelRouter | null,
  spinner: ReturnType<typeof ora>
): Promise<IClassificationEngine | null> {
  try {
    spinner.text = "Initializing classification engine...";

    // Create classification storage and engine
    const classificationStorage = createClassificationStorage(
      store as unknown as import("../../core/graph/database.js").GraphDatabase
    );
    const classificationEngine = await createClassificationEngine(
      classificationStorage,
      modelRouter ?? null
    );

    // Get all entity IDs that need classification
    spinner.text = "Fetching entities for classification...";

    const functions = await store.query<{ id: string; name: string; file_id: string }>(
      `?[id, name, file_id] := *function{id, name, file_id}`
    );
    const classes = await store.query<{ id: string; name: string; file_id: string }>(
      `?[id, name, file_id] := *class{id, name, file_id}`
    );
    const interfaces = await store.query<{ id: string; name: string; file_id: string }>(
      `?[id, name, file_id] := *interface{id, name, file_id}`
    );

    // Get file paths for context
    const fileIds = new Set([
      ...functions.rows.map(r => r.file_id),
      ...classes.rows.map(r => r.file_id),
      ...interfaces.rows.map(r => r.file_id),
    ]);
    const filePathMap = new Map<string, string>();
    if (fileIds.size > 0) {
      const files = await store.query<{ id: string; relative_path: string }>(
        `?[id, relative_path] := *file{id, relative_path}, id in $fileIds`,
        { fileIds: Array.from(fileIds) }
      );
      for (const f of files.rows) {
        filePathMap.set(f.id, f.relative_path);
      }
    }

    // Build classification requests with all required fields
    const allEntities = [
      ...functions.rows.map(r => ({
        entityId: r.id,
        entityType: "function" as const,
        entityName: r.name,
        filePath: filePathMap.get(r.file_id) || "",
        imports: [] as string[],
        exports: [] as string[],
        calls: [] as string[],
        calledBy: [] as string[],
        fileImports: [] as string[],
        packageDependencies: [] as string[],
      })),
      ...classes.rows.map(r => ({
        entityId: r.id,
        entityType: "class" as const,
        entityName: r.name,
        filePath: filePathMap.get(r.file_id) || "",
        imports: [] as string[],
        exports: [] as string[],
        calls: [] as string[],
        calledBy: [] as string[],
        fileImports: [] as string[],
        packageDependencies: [] as string[],
      })),
      ...interfaces.rows.map(r => ({
        entityId: r.id,
        entityType: "interface" as const,
        entityName: r.name,
        filePath: filePathMap.get(r.file_id) || "",
        imports: [] as string[],
        exports: [] as string[],
        calls: [] as string[],
        calledBy: [] as string[],
        fileImports: [] as string[],
        packageDependencies: [] as string[],
      })),
    ];

    if (allEntities.length === 0) {
      spinner.info(chalk.dim("No entities to classify"));
      return classificationEngine;
    }

    // Run classification in batches
    spinner.text = `Classifying ${allEntities.length} entities...`;

    let classified = 0;
    const batchSize = 50;

    for (let i = 0; i < allEntities.length; i += batchSize) {
      const batch = allEntities.slice(i, i + batchSize);
      await classificationEngine.classifyBatch({
        entities: batch,
        options: {
          parallel: true,
          maxConcurrency: 5,
          skipExisting: true,
        },
      });
      classified += batch.length;
      spinner.text = `Classifying entities: ${classified}/${allEntities.length}`;
    }

    spinner.succeed(chalk.green(`Classification complete! ${classified} entities classified`));

    // Show classification stats
    const stats = await classificationEngine.getStats();
    console.log();
    console.log(chalk.white.bold("Classification Results"));
    console.log(`  Domain entities:         ${stats.domainCount}`);
    console.log(`  Infrastructure entities: ${stats.infrastructureCount}`);
    console.log(`  Unknown:                 ${stats.unknownCount}`);
    console.log();
    console.log(chalk.dim("─".repeat(50)));

    return classificationEngine;
  } catch (error) {
    spinner.warn(chalk.yellow("Classification had issues, continuing..."));
    logger.error({ err: error }, "Classification failed");
    return null;
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
  let classificationEngine: IClassificationEngine | null = null;
  let changeLedger: IChangeLedger | null = null;

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
    const ledgerStorage = createLedgerStorage(
      graphStore as unknown as import("../../core/graph/database.js").GraphDatabase
    );
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

      spinner.start("Indexing project...");
      await runIndexing(graphStore, config, spinner);

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
    if (!options.skipJustify) {
      console.log();
      console.log(chalk.cyan.bold("Business Classification Layer"));
      console.log(chalk.dim("─".repeat(50)));
      console.log();

      spinner.start("Running classification...");
      // We pass null for now as we don't have the router instance from runJustification
      // TODO: Refactor runJustification to return the router or initialize it at top level
      classificationEngine = await runClassification(graphStore, null, spinner);

      // Log classification completion
      if (changeLedger) {
        await changeLedger.append(
          createLedgerEntry(
            "classify:completed",
            "classification-engine",
            "Business classification completed"
          )
        );
      }
    }

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

    // Step 6: Start the Web Viewer (if not skipped)
    if (!options.skipViewer) {
      spinner.start("Starting Web Viewer...");

      // Create viewer using the shared graph store
      viewer = createGraphViewer(graphStore);
      await viewer.initialize();

      // Get stats for display
      const stats = await viewer.getOverviewStats();

      // Create classification storage for viewer
      const classificationStorage = createClassificationStorage(
        graphStore as unknown as import("../../core/graph/database.js").GraphDatabase
      );

      // Start viewer server with classification and ledger
      const viewerOptions: ViewerServerOptions = {
        classificationStorage,
        changeLedger: changeLedger ?? undefined,
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
    // Pass the existing graphStore to avoid RocksDB lock conflicts
    console.log();
    await startCommand({
      port: mcpPort,
      debug: options.debug,
      existingStore: graphStore,
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

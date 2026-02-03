/**
 * justify command - Generate business justifications for code entities
 *
 * Uses local LLM to infer purpose, business value, and feature context
 * for indexed code entities. Supports interactive clarification workflow.
 */

import chalk from "chalk";
import ora from "ora";
// readline removed in favor of common interactive module

import {
  fileExists,
  getConfigPath,
  getGraphDbPath,
  readJson,
  createLogger,
} from "../../utils/index.js";
import type { ProjectConfig } from "../../types/index.js";
import { createGraphStore } from "../../core/graph/index.js";
import {
  createLLMJustificationService,
  type JustificationProgress,
} from "../../core/justification/index.js";
import {
  createConfiguredModelRouter,
  type IModelRouter,
  type ModelVendor,
} from "../../core/models/index.js";
import { getDefaultModelId } from "../../core/models/Registry.js";
import {
  type ModelPreset,
  MODEL_PRESETS,
} from "../../core/llm/index.js";
import { getProviderDisplay } from "../provider-display.js";

const logger = createLogger("justify");

/**
 * Extended config with LLM settings
 */
interface CodeSynapseConfig extends ProjectConfig {
  llmModel?: string;
  skipLlm?: boolean;
  modelProvider?: ModelVendor;
  apiKeys?: {
    anthropic?: string;
    openai?: string;
    google?: string;
  };
}

export interface JustifyOptions {
  /** Force re-justification of all entities */
  force?: boolean;
  /** Interactive mode for clarification */
  interactive?: boolean;
  /** Skip LLM inference, use code analysis only */
  skipLlm?: boolean;
  /** LLM model preset to use */
  model?: ModelPreset;
  /** Specific file path to justify */
  file?: string;
  /** Show statistics only */
  stats?: boolean;
  /** Override model provider (local, openai, anthropic, google) */
  provider?: string;
  /** Override model ID for this run */
  modelId?: string;
}

/**
 * Format duration in human readable format
 */
function formatDuration(ms: number): string {
  const seconds = ms / 1000;
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
 * Create a readline interface for interactive mode
 */
/**
 * Run interactive clarification workflow
 */
import { runInteractiveClarification } from "../interactive.js";


/**
 * Generate business justifications for code entities
 */
export async function justifyCommand(options: JustifyOptions): Promise<void> {
  logger.info({ options }, "Starting justify command");

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
  console.log(chalk.cyan.bold("Business Justification Layer"));
  console.log(chalk.dim("─".repeat(50)));
  console.log();

  const spinner = ora("Initializing...").start();

  // Track resources for cleanup
  let store: Awaited<ReturnType<typeof createGraphStore>> | null = null;
  let modelRouter: IModelRouter | null = null;

  try {
    // Initialize graph store
    spinner.text = "Connecting to database...";
    const graphDbPath = getGraphDbPath();
    store = await createGraphStore({ path: graphDbPath });

    // Read extended config for modelProvider setting
    const extendedConfig = readJson<CodeSynapseConfig>(configPath);

    // Command-line options override config settings
    const modelProvider = (options.provider as ModelVendor) ?? extendedConfig?.modelProvider ?? "local";
    const savedModelId = options.modelId ?? extendedConfig?.llmModel;

    // Get API key from config if available
    const apiKey = extendedConfig?.apiKeys?.[modelProvider as keyof typeof extendedConfig.apiKeys];

    // Initialize Model Router if not skipping
    let actualModelId: string | undefined;

    if (!options.skipLlm) {
      const preset = options.model || "balanced";

      try {
        spinner.text = "Initializing model router...";

        // Determine model ID based on provider type
        const providerDisplay = getProviderDisplay(modelProvider);
        if (providerDisplay.isLocal) {
          actualModelId = MODEL_PRESETS[preset];
        } else {
          actualModelId = savedModelId || getDefaultModelId(modelProvider);
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
    }

    // Create justification service
    const justificationService = createLLMJustificationService(store, modelRouter ?? undefined);
    await justificationService.initialize();

    // Stats mode
    if (options.stats) {
      spinner.stop();
      const stats = await justificationService.getStats();

      console.log(chalk.white.bold("Justification Statistics"));
      console.log();
      console.log(`  Total entities:        ${stats.totalEntities}`);
      console.log(`  Justified:             ${stats.justifiedEntities}`);
      console.log(
        `  Coverage:              ${formatConfidence(stats.coveragePercentage / 100)}`
      );
      console.log();
      console.log(chalk.white.bold("By Confidence"));
      console.log(`  High (≥80%):           ${stats.highConfidence}`);
      console.log(`  Medium (50-79%):       ${stats.mediumConfidence}`);
      console.log(`  Low (30-49%):          ${stats.lowConfidence}`);
      console.log(`  Pending clarification: ${stats.pendingClarification}`);
      console.log(`  User confirmed:        ${stats.userConfirmed}`);
      console.log();
      return;
    }

    // Interactive mode
    if (options.interactive) {
      spinner.stop();
      await runInteractiveClarification(justificationService);

      // Show final stats
      const stats = await justificationService.getStats();
      console.log();
      console.log(chalk.white.bold("Updated Statistics"));
      console.log(`  Justified:  ${stats.justifiedEntities}/${stats.totalEntities}`);
      console.log(
        `  Coverage:   ${formatConfidence(stats.coveragePercentage / 100)}`
      );
      return;
    }

    // Run justification
    spinner.text = "Analyzing code...";

    let result;
    if (options.file) {
      result = await justificationService.justifyFile(options.file, {
        force: options.force,
        skipLLM: options.skipLlm,
        modelId: actualModelId,
        onProgress: (progress: JustificationProgress) => {
          spinner.text = `${progress.phase}: ${progress.current}/${progress.total}`;
        },
      });
    } else {
      result = await justificationService.justifyProject({
        force: options.force,
        skipLLM: options.skipLlm,
        modelId: actualModelId,
        onProgress: (progress: JustificationProgress) => {
          spinner.text = `${progress.phase}: ${progress.current}/${progress.total}`;
        },
      });
    }

    spinner.succeed(chalk.green("Justification complete!"));

    // Display results
    console.log();
    console.log(chalk.white.bold("Results"));
    console.log(`  Entities justified:    ${result.stats.succeeded}`);
    console.log(`  Entities failed:       ${result.stats.failed}`);
    console.log(`  Entities skipped:      ${result.stats.skipped}`);
    console.log(`  Pending clarification: ${result.stats.pendingClarification}`);
    console.log(
      `  Average confidence:    ${formatConfidence(result.stats.averageConfidence)}`
    );
    console.log(`  Duration:              ${formatDuration(result.stats.durationMs)}`);

    if (result.failed.length > 0) {
      console.log();
      console.log(chalk.yellow.bold(`Errors (${result.failed.length})`));
      for (const err of result.failed.slice(0, 5)) {
        console.log(`  ${chalk.red("✗")} ${err.entityId}: ${err.error}`);
      }
      if (result.failed.length > 5) {
        console.log(chalk.dim(`  ... and ${result.failed.length - 5} more errors`));
      }
    }

    if (result.stats.pendingClarification > 0) {
      console.log();
      console.log(chalk.yellow.bold("Pending Clarification"));
      console.log(
        chalk.dim(
          `${result.stats.pendingClarification} entities need clarification.`
        )
      );
      console.log(
        chalk.dim("Run 'code-synapse justify --interactive' to provide answers.")
      );
    }

    console.log();
    console.log(chalk.dim("─".repeat(50)));
    console.log(chalk.dim("Run 'code-synapse justify --stats' to view statistics"));

    logger.info({ result: result.stats }, "Justification complete");
  } catch (error) {
    spinner.fail(chalk.red("Justification failed"));
    logger.error({ err: error }, "Justification failed");
    throw error;
  } finally {
    // Always cleanup resources
    if (modelRouter) {
      try {
        await modelRouter.shutdown();
      } catch {
        // Ignore shutdown errors
      }
    }
    if (store) {
      try {
        await store.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

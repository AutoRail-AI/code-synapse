/**
 * justify command - Generate business justifications for code entities
 *
 * Uses local LLM to infer purpose, business value, and feature context
 * for indexed code entities. Supports interactive clarification workflow.
 */

import chalk from "chalk";
import ora from "ora";
import * as readline from "node:readline";
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
  type ClarificationBatch,
} from "../../core/justification/index.js";
import {
  createLLMServiceWithPreset,
  createInitializedAPILLMService,
  MODEL_PRESETS,
  type ModelPreset,
  type APIProvider,
  type ILLMService,
} from "../../core/llm/index.js";

const logger = createLogger("justify");

/**
 * Get default model ID for an API provider
 */
function getDefaultApiModel(provider: string): string {
  const defaults: Record<string, string> = {
    anthropic: "claude-sonnet-4-20250514",
    openai: "gpt-4o",
    google: "gemini-1.5-pro",
  };
  return defaults[provider] || "claude-sonnet-4-20250514";
}

/**
 * Extended config with LLM settings
 */
interface CodeSynapseConfig extends ProjectConfig {
  llmModel?: string;
  skipLlm?: boolean;
  modelProvider?: "local" | "openai" | "anthropic" | "google";
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
function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Ask a question and get user input
 */
async function askQuestion(
  rl: readline.Interface,
  question: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Run interactive clarification workflow
 */
async function runInteractiveClarification(
  service: ReturnType<typeof createLLMJustificationService>
): Promise<void> {
  const rl = createReadlineInterface();

  console.log();
  console.log(chalk.cyan.bold("Interactive Clarification Mode"));
  console.log(chalk.dim("─".repeat(50)));
  console.log(chalk.dim("Answer questions to improve code understanding."));
  console.log(chalk.dim("Press Enter to skip, Ctrl+C to exit."));
  console.log();

  try {
    let batch: ClarificationBatch;

    while (true) {
      batch = await service.getNextClarificationBatch(5);

      if (batch.questions.length === 0) {
        console.log(chalk.green("No more questions! All entities clarified."));
        break;
      }

      console.log(
        chalk.white.bold(
          `Questions (${batch.questions.length} of ${batch.totalPendingEntities} pending)`
        )
      );
      console.log();

      const answers = new Map<string, string>();

      for (const question of batch.questions) {
        console.log(chalk.cyan(`[${question.category}]`));
        console.log(chalk.white(question.question));

        if (question.context) {
          console.log(chalk.dim(question.context));
        }

        if (question.suggestedAnswers && question.suggestedAnswers.length > 0) {
          console.log(chalk.dim("Suggestions:"));
          question.suggestedAnswers.forEach((suggestion, i) => {
            console.log(chalk.dim(`  ${i + 1}. ${suggestion}`));
          });
        }

        const answer = await askQuestion(rl, chalk.green("> "));

        if (answer) {
          // Check if answer is a number (selecting from suggestions)
          const suggestionIndex = parseInt(answer, 10) - 1;
          if (
            !isNaN(suggestionIndex) &&
            question.suggestedAnswers &&
            suggestionIndex >= 0 &&
            suggestionIndex < question.suggestedAnswers.length
          ) {
            answers.set(question.id, question.suggestedAnswers[suggestionIndex]!);
          } else {
            answers.set(question.id, answer);
          }
          console.log(chalk.green("✓ Saved"));
        } else {
          console.log(chalk.dim("Skipped"));
        }

        console.log();
      }

      // Apply answers
      if (answers.size > 0) {
        await service.applyClarificationAnswers(answers);
        console.log(chalk.green(`Applied ${answers.size} answer(s)`));
      }

      // Ask if user wants to continue
      const continueAnswer = await askQuestion(
        rl,
        chalk.dim("Continue with more questions? (Y/n) ")
      );
      if (
        continueAnswer.toLowerCase() === "n" ||
        continueAnswer.toLowerCase() === "no"
      ) {
        break;
      }

      console.log();
    }
  } finally {
    rl.close();
  }
}

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
  let llmService: ILLMService | null = null;

  try {
    // Initialize graph store
    spinner.text = "Connecting to database...";
    const graphDbPath = getGraphDbPath();
    store = await createGraphStore({ path: graphDbPath });

    // Read extended config for modelProvider setting
    const extendedConfig = readJson<CodeSynapseConfig>(configPath);

    // Command-line options override config settings
    const modelProvider = (options.provider as APIProvider | "local") ?? extendedConfig?.modelProvider ?? "local";
    const savedModelId = options.modelId ?? extendedConfig?.llmModel;

    // Get API key from config if available
    const apiKey = extendedConfig?.apiKeys?.[modelProvider as keyof typeof extendedConfig.apiKeys];

    // Initialize LLM service if not skipping
    let actualModelId: string | undefined;

    if (!options.skipLlm) {
      const preset = options.model || "balanced";

      try {
        if (modelProvider === "anthropic" || modelProvider === "openai" || modelProvider === "google") {
          // Use API-based LLM service
          // If saved modelId is a local model (contains "qwen", "llama", "codellama", "deepseek"),
          // don't pass it - let the API service use its default
          const isLocalModel = savedModelId &&
            (savedModelId.includes("qwen") || savedModelId.includes("llama") ||
             savedModelId.includes("codellama") || savedModelId.includes("deepseek"));
          const apiModelId = isLocalModel ? undefined : savedModelId;

          spinner.text = `Connecting to ${modelProvider} API...`;
          llmService = await createInitializedAPILLMService({
            provider: modelProvider as APIProvider,
            modelId: apiModelId,
            apiKey: apiKey,
          });
          spinner.text = `${modelProvider} API connected`;
          actualModelId = apiModelId || getDefaultApiModel(modelProvider);
          console.log(chalk.dim(`  Using ${modelProvider} API (${actualModelId}) for LLM inference`));
        } else {
          // Use local LLM service
          spinner.text = "Loading local LLM model...";
          const localService = createLLMServiceWithPreset(preset);
          await localService.initialize();
          llmService = localService;
          actualModelId = MODEL_PRESETS[preset];
          spinner.text = `Local LLM model loaded (${preset})`;
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        spinner.warn(chalk.yellow(`LLM not available: ${errorMessage}`));
        console.log(chalk.dim("  Continuing with code analysis only"));
        llmService = null;
      }
    }

    // Create justification service
    const justificationService = createLLMJustificationService(store, llmService ?? undefined);
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
    if (llmService) {
      try {
        await llmService.shutdown();
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

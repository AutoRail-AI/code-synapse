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
  type ModelPreset,
} from "../../core/llm/index.js";

const logger = createLogger("justify");

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

  try {
    // Initialize graph store
    spinner.text = "Connecting to database...";
    const graphDbPath = getGraphDbPath();
    const store = await createGraphStore({ path: graphDbPath });

    // Initialize LLM service if not skipping
    let llmService = undefined;
    if (!options.skipLlm) {
      spinner.text = "Loading LLM model...";
      const preset = options.model || "balanced";
      try {
        llmService = createLLMServiceWithPreset(preset);
        await llmService.initialize();
        spinner.text = `LLM model loaded (${preset})`;
      } catch (error) {
        spinner.warn(chalk.yellow("LLM not available, using code analysis only"));
        llmService = undefined;
      }
    }

    // Create justification service
    const justificationService = createLLMJustificationService(store, llmService);
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

      await store.close();
      if (llmService) {
        await llmService.close();
      }
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

      await store.close();
      if (llmService) {
        await llmService.close();
      }
      return;
    }

    // Run justification
    spinner.text = "Analyzing code...";

    let result;
    if (options.file) {
      result = await justificationService.justifyFile(options.file, {
        force: options.force,
        skipLLM: options.skipLlm,
        onProgress: (progress: JustificationProgress) => {
          spinner.text = `${progress.phase}: ${progress.current}/${progress.total}`;
        },
      });
    } else {
      result = await justificationService.justifyProject({
        force: options.force,
        skipLLM: options.skipLlm,
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

    // Cleanup
    await store.close();
    if (llmService) {
      await llmService.close();
    }

    logger.info({ result: result.stats }, "Justification complete");
  } catch (error) {
    spinner.fail(chalk.red("Justification failed"));
    logger.error({ err: error }, "Justification failed");
    throw error;
  }
}

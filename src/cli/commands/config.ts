/**
 * config command - Manage Code-Synapse configuration
 */

import chalk from "chalk";
import {
  fileExists,
  getConfigPath,
  readJson,
  writeJson,
  createLogger,
} from "../../utils/index.js";
import type { ProjectConfig } from "../../types/index.js";
import {
  MODEL_PRESETS,
  getModelById,
  getAvailableModels,
  getModelSelectionGuide,
  listDownloadedModels,
  type ModelPreset,
} from "../../core/llm/index.js";

const logger = createLogger("config");

export interface ConfigOptions {
  model?: string;
  listModels?: boolean;
  showGuide?: boolean;
}

/**
 * Manage Code-Synapse configuration
 */
export async function configCommand(options: ConfigOptions): Promise<void> {
  logger.info({ options }, "Config command");

  // Handle --list-models flag
  if (options.listModels) {
    showAvailableModels();
    return;
  }

  // Handle --show-guide flag
  if (options.showGuide) {
    console.log(getModelSelectionGuide());
    return;
  }

  const configPath = getConfigPath();

  // Check if initialized
  if (!fileExists(configPath)) {
    console.log(chalk.red("Code-Synapse is not initialized in this project."));
    console.log(
      chalk.dim("Run"),
      chalk.white("code-synapse init"),
      chalk.dim("first.")
    );
    return;
  }

  // Load configuration
  const config = readJson<ProjectConfig & { llmModel?: string; skipLlm?: boolean }>(configPath);
  if (!config) {
    console.log(chalk.red("Failed to read configuration."));
    return;
  }

  // Handle --model flag to set the model
  if (options.model) {
    await setModel(config, configPath, options.model);
    return;
  }

  // No options - show current config
  showCurrentConfig(config);
}

/**
 * Show current configuration
 */
function showCurrentConfig(config: ProjectConfig & { llmModel?: string; skipLlm?: boolean }): void {
  console.log();
  console.log(chalk.cyan.bold("Code-Synapse Configuration"));
  console.log(chalk.dim("─".repeat(50)));

  console.log();
  console.log(chalk.white.bold("Project"));
  console.log(`  Name:       ${chalk.cyan(config.name)}`);
  console.log(`  Root:       ${chalk.dim(config.root)}`);
  console.log(`  Languages:  ${config.languages.join(", ")}`);
  if (config.framework) {
    console.log(`  Framework:  ${config.framework}`);
  }

  console.log();
  console.log(chalk.white.bold("LLM Settings"));
  if (config.skipLlm) {
    console.log(`  Status:     ${chalk.yellow("Disabled")}`);
  } else {
    const modelId = config.llmModel || MODEL_PRESETS.balanced;
    const modelSpec = getModelById(modelId);

    console.log(`  Status:     ${chalk.green("Enabled")}`);
    if (modelSpec) {
      console.log(`  Model:      ${chalk.cyan(modelSpec.name)} (${modelSpec.parameters})`);
      console.log(`  Family:     ${modelSpec.family}`);
      console.log(`  RAM:        ${modelSpec.minRamGb}GB minimum`);
      console.log(`  Quality:    ${"★".repeat(Math.floor(modelSpec.codeQuality / 2))}${"☆".repeat(5 - Math.floor(modelSpec.codeQuality / 2))} (${modelSpec.codeQuality}/10)`);
      console.log(`  Speed:      ${"★".repeat(Math.floor(modelSpec.speed / 2))}${"☆".repeat(5 - Math.floor(modelSpec.speed / 2))} (${modelSpec.speed}/10)`);
    } else {
      console.log(`  Model:      ${modelId}`);
    }
  }

  // Show downloaded models
  const downloaded = listDownloadedModels();
  if (downloaded.length > 0) {
    console.log();
    console.log(chalk.white.bold("Downloaded Models"));
    for (const model of downloaded) {
      const isCurrent = model.id === (config.llmModel || MODEL_PRESETS.balanced);
      const marker = isCurrent ? chalk.green("●") : chalk.dim("○");
      console.log(`  ${marker} ${model.name} (${model.parameters})`);
    }
  }

  console.log();
  console.log(chalk.dim("─".repeat(50)));
  console.log(chalk.dim("To change model: code-synapse config --model <preset>"));
  console.log(chalk.dim("To list models:  code-synapse config --list-models"));
  console.log(chalk.dim("For help:        code-synapse config --show-guide"));
  console.log();
}

/**
 * Set the LLM model
 */
async function setModel(
  config: ProjectConfig & { llmModel?: string; skipLlm?: boolean },
  configPath: string,
  modelInput: string
): Promise<void> {
  let modelId: string;

  // Check if it's a preset name
  if (modelInput in MODEL_PRESETS) {
    modelId = MODEL_PRESETS[modelInput as ModelPreset];
    console.log(chalk.dim(`Using preset '${modelInput}'`));
  } else {
    // Check if it's a direct model ID
    const model = getModelById(modelInput);
    if (model) {
      modelId = modelInput;
    } else {
      console.log(chalk.red(`Unknown model: ${modelInput}`));
      console.log();
      console.log(chalk.dim("Available presets: fastest, minimal, balanced, quality, maximum"));
      console.log(chalk.dim("Run 'code-synapse config --list-models' to see all models"));
      return;
    }
  }

  const modelSpec = getModelById(modelId);
  if (!modelSpec) {
    console.log(chalk.red(`Model not found: ${modelId}`));
    return;
  }

  // Update config
  config.llmModel = modelId;
  delete config.skipLlm;

  // Save config
  writeJson(configPath, config);

  console.log();
  console.log(chalk.green(`✓ Model set to: ${modelSpec.name}`));
  console.log();
  console.log(chalk.dim("Model details:"));
  console.log(chalk.dim(`  Parameters: ${modelSpec.parameters}`));
  console.log(chalk.dim(`  RAM needed: ${modelSpec.minRamGb}GB`));
  console.log(chalk.dim(`  File size:  ~${modelSpec.fileSizeGb}GB`));
  console.log();
  console.log(chalk.dim(modelSpec.description));
  console.log();

  logger.info({ modelId, modelName: modelSpec.name }, "Model configuration updated");
}

/**
 * Show available models
 */
function showAvailableModels(): void {
  console.log();
  console.log(chalk.cyan.bold("Available LLM Models"));
  console.log(chalk.dim("─".repeat(80)));
  console.log();

  // Show presets first
  console.log(chalk.white.bold("Quick Presets"));
  console.log(chalk.dim("Use these with: code-synapse config --model <preset>"));
  console.log();

  const presetDescriptions: Record<string, string> = {
    fastest: "Ultra-fast inference, minimal resources",
    minimal: "Good balance for low-memory systems (2GB RAM)",
    balanced: "RECOMMENDED - Best balance of speed and quality",
    quality: "High quality analysis, needs 8GB RAM",
    maximum: "Maximum quality, requires 16GB+ RAM",
  };

  for (const [preset, modelId] of Object.entries(MODEL_PRESETS)) {
    const model = getModelById(modelId);
    const isRecommended = preset === "balanced";
    const marker = isRecommended ? chalk.green("★") : chalk.dim("○");
    console.log(`  ${marker} ${chalk.cyan(preset.padEnd(10))} → ${model?.name || modelId}`);
    console.log(chalk.dim(`    ${presetDescriptions[preset]}`));
  }

  console.log();
  console.log(chalk.white.bold("All Models"));
  console.log();

  // Group by family
  const models = getAvailableModels();
  const byFamily = new Map<string, typeof models>();

  for (const model of models) {
    const list = byFamily.get(model.family) || [];
    list.push(model);
    byFamily.set(model.family, list);
  }

  for (const [family, familyModels] of byFamily) {
    console.log(chalk.yellow(`${family.toUpperCase()}`));
    for (const model of familyModels) {
      const downloaded = listDownloadedModels().some(m => m.id === model.id);
      const marker = downloaded ? chalk.green("✓") : chalk.dim("○");
      console.log(`  ${marker} ${chalk.white(model.id.padEnd(22))} ${model.parameters.padEnd(6)} ${model.minRamGb}GB RAM  ${chalk.dim(model.description.substring(0, 40))}`);
    }
    console.log();
  }

  console.log(chalk.dim("─".repeat(80)));
  console.log(chalk.dim("✓ = downloaded, ○ = not downloaded"));
  console.log(chalk.dim("Models are downloaded automatically on first use."));
  console.log();
}

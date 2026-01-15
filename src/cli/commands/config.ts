/**
 * config command - Manage Code-Synapse configuration
 */

import chalk from "chalk";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
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
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  GOOGLE_MODELS,
  LOCAL_MODELS,
  type ModelPreset,
  type ModelConfig,
} from "../../core/llm/index.js";
import {
  InteractiveSetup,
  PROVIDERS,
  getApiKey,
  getConfiguredProvider,
  type ModelProvider,
  type CodeSynapseConfig,
} from "./setup.js";

const logger = createLogger("config");

export interface ConfigOptions {
  model?: string;
  listModels?: boolean;
  showGuide?: boolean;
  setup?: boolean;
  provider?: string;
  apiKey?: string;
}

/**
 * Manage Code-Synapse configuration
 */
export async function configCommand(options: ConfigOptions): Promise<void> {
  logger.debug({ options }, "Config command");

  // Handle --setup flag - interactive wizard
  if (options.setup) {
    const setup = new InteractiveSetup();
    await setup.run();
    return;
  }

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
  const config = readJson<CodeSynapseConfig>(configPath);
  if (!config) {
    console.log(chalk.red("Failed to read configuration."));
    return;
  }

  // Handle --provider flag
  if (options.provider) {
    await setProvider(config, configPath, options.provider, options.apiKey);
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
 * Set the model provider and optionally API key
 */
async function setProvider(
  config: CodeSynapseConfig,
  configPath: string,
  providerInput: string,
  apiKey?: string
): Promise<void> {
  const provider = providerInput.toLowerCase() as ModelProvider;

  if (!PROVIDERS[provider]) {
    console.log(chalk.red(`Unknown provider: ${providerInput}`));
    console.log(chalk.dim("Valid providers: local, openai, anthropic, google"));
    return;
  }

  const providerInfo = PROVIDERS[provider];

  // Initialize apiKeys if needed
  if (!config.apiKeys) {
    config.apiKeys = {};
  }

  // Set provider
  config.modelProvider = provider;
  config.skipLlm = false;

  // Handle API key for cloud providers
  if (providerInfo.requiresApiKey) {
    if (apiKey) {
      config.apiKeys[provider as keyof typeof config.apiKeys] = apiKey;
      console.log(chalk.green(`✓ API key saved for ${providerInfo.name}`));
    } else {
      // Check if API key exists in environment or config
      const existingKey = getApiKey(provider);
      if (!existingKey) {
        console.log(chalk.yellow(`Note: ${providerInfo.name} requires an API key.`));
        console.log(chalk.dim(`Set ${providerInfo.envVar} in your environment or use --api-key flag.`));
      }
    }
    // Set default model for cloud provider
    if (!config.llmModel || !isModelForProvider(config.llmModel, provider)) {
      config.llmModel = providerInfo.models[0]?.id;
      console.log(chalk.green(`✓ Default model set to: ${providerInfo.models[0]?.name}`));
    }
  } else if (provider === "local") {
    // Interactive model selection for local provider
    const selectedModel = await selectLocalModel();
    if (selectedModel) {
      config.llmModel = selectedModel;
    }
  }

  // Save config
  writeJson(configPath, config);
  console.log(chalk.green(`✓ Provider set to: ${providerInfo.name}`));

  logger.info({ provider, hasApiKey: !!apiKey }, "Provider configuration updated");
}

/**
 * Interactive local model selection
 */
async function selectLocalModel(): Promise<string | null> {
  console.log();
  console.log(chalk.cyan.bold("Select Local Model"));
  console.log(chalk.dim("─".repeat(50)));
  console.log();

  const presetDescriptions: Record<string, { ram: string; description: string }> = {
    fastest: { ram: "1GB", description: "Ultra-fast, minimal resources" },
    minimal: { ram: "2GB", description: "Good for low-memory systems" },
    balanced: { ram: "4GB", description: "Recommended - best balance" },
    quality: { ram: "8GB", description: "High quality analysis" },
    maximum: { ram: "16GB", description: "Maximum quality" },
  };

  const presetNames = Object.keys(MODEL_PRESETS) as ModelPreset[];
  const downloaded = listDownloadedModels();

  // Display options
  presetNames.forEach((preset, index) => {
    const modelId = MODEL_PRESETS[preset];
    const modelSpec = getModelById(modelId);
    const info = presetDescriptions[preset] ?? { ram: "?", description: "Unknown" };
    const isDownloaded = downloaded.some(m => m.id === modelId);
    const isRecommended = preset === "balanced";

    const marker = isRecommended ? chalk.green("★") : chalk.dim(`${index + 1}`);
    const downloadStatus = isDownloaded ? chalk.green(" ✓") : chalk.dim(" ○");
    const recommendedTag = isRecommended ? chalk.green(" (Recommended)") : "";

    console.log(`  ${marker}. ${chalk.cyan(preset.padEnd(10))} ${info.ram.padEnd(5)} ${info.description}${downloadStatus}${recommendedTag}`);
    if (modelSpec) {
      console.log(chalk.dim(`     → ${modelSpec.name}`));
    }
  });

  console.log();
  console.log(chalk.dim("  ✓ = downloaded, ○ = will download on first use"));
  console.log();

  // Prompt for selection
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const answer = await rl.question(chalk.white("Select model (1-5 or name) [balanced]: "));
    const input = answer.trim().toLowerCase() || "balanced";

    // Check if input is a number
    const num = parseInt(input, 10);
    if (num >= 1 && num <= presetNames.length) {
      const selectedPreset = presetNames[num - 1]!;
      const modelId = MODEL_PRESETS[selectedPreset];
      const modelSpec = getModelById(modelId);
      console.log(chalk.green(`✓ Model set to: ${modelSpec?.name || modelId} (${selectedPreset})`));
      return modelId;
    }

    // Check if input is a preset name
    if (input in MODEL_PRESETS) {
      const modelId = MODEL_PRESETS[input as ModelPreset];
      const modelSpec = getModelById(modelId);
      console.log(chalk.green(`✓ Model set to: ${modelSpec?.name || modelId} (${input})`));
      return modelId;
    }

    // Check if input is a direct model ID
    const modelSpec = getModelById(input);
    if (modelSpec) {
      console.log(chalk.green(`✓ Model set to: ${modelSpec.name}`));
      return input;
    }

    console.log(chalk.yellow(`Unknown model: ${input}, using balanced`));
    return MODEL_PRESETS.balanced;
  } finally {
    rl.close();
  }
}

/**
 * Check if a model ID belongs to a provider
 */
function isModelForProvider(modelId: string, provider: ModelProvider): boolean {
  return PROVIDERS[provider].models.some((m) => m.id === modelId);
}

/**
 * Show current configuration
 */
function showCurrentConfig(config: CodeSynapseConfig): void {
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
    console.log(`  Status:     ${chalk.green("Enabled")}`);

    // Show provider
    const provider = config.modelProvider ?? "local";
    const providerInfo = PROVIDERS[provider];
    console.log(`  Provider:   ${chalk.cyan(providerInfo?.name ?? provider)}`);

    // Show API key status for cloud providers
    if (providerInfo?.requiresApiKey) {
      const hasKey = !!getApiKey(provider);
      if (hasKey) {
        console.log(`  API Key:    ${chalk.green("✓ Configured")}`);
      } else {
        console.log(`  API Key:    ${chalk.red("✗ Not configured")}`);
        console.log(chalk.dim(`              Set ${providerInfo.envVar} or use --api-key`));
      }
    }

    // Show model
    const modelId = config.llmModel || MODEL_PRESETS.balanced;
    const modelSpec = getModelById(modelId);

    if (modelSpec) {
      console.log(`  Model:      ${chalk.cyan(modelSpec.name)} (${modelSpec.parameters})`);
      console.log(`  Family:     ${modelSpec.family}`);
      console.log(`  RAM:        ${modelSpec.minRamGb}GB minimum`);
      console.log(`  Quality:    ${"★".repeat(Math.floor(modelSpec.codeQuality / 2))}${"☆".repeat(5 - Math.floor(modelSpec.codeQuality / 2))} (${modelSpec.codeQuality}/10)`);
      console.log(`  Speed:      ${"★".repeat(Math.floor(modelSpec.speed / 2))}${"☆".repeat(5 - Math.floor(modelSpec.speed / 2))} (${modelSpec.speed}/10)`);
    } else if (provider !== "local") {
      // Cloud model
      const cloudModel = providerInfo?.models.find(m => m.id === modelId);
      if (cloudModel) {
        console.log(`  Model:      ${chalk.cyan(cloudModel.name)}`);
        console.log(chalk.dim(`              ${cloudModel.description}`));
      } else {
        console.log(`  Model:      ${modelId}`);
      }
    } else {
      console.log(`  Model:      ${modelId}`);
    }
  }

  // Show downloaded models (only for local provider)
  if (config.modelProvider === "local" || !config.modelProvider) {
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
  }

  console.log();
  console.log(chalk.dim("─".repeat(50)));
  console.log(chalk.dim("Interactive setup:  code-synapse config --setup"));
  console.log(chalk.dim("Change provider:    code-synapse config --provider <name>"));
  console.log(chalk.dim("Change model:       code-synapse config --model <preset>"));
  console.log(chalk.dim("List models:        code-synapse config --list-models"));
  console.log(chalk.dim("Help:               code-synapse config --show-guide"));
  console.log();
}

/**
 * Set the LLM model
 */
async function setModel(
  config: CodeSynapseConfig,
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
 * Format number with K/M suffixes
 */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(0)}K`;
  }
  return num.toString();
}

/**
 * Show available models
 */
function showAvailableModels(): void {
  console.log();
  console.log(chalk.cyan.bold("Available LLM Models"));
  console.log(chalk.dim("─".repeat(90)));
  console.log();

  // Show local presets first
  console.log(chalk.white.bold("Local Model Presets"));
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

  // Show cloud providers
  console.log();
  console.log(chalk.dim("─".repeat(90)));
  console.log();
  console.log(chalk.white.bold("Cloud API Models"));
  console.log(chalk.dim("Set with: code-synapse config --provider <anthropic|openai|google>"));
  console.log();

  // Anthropic Models
  console.log(chalk.magenta.bold("ANTHROPIC (Claude)"));
  console.log(chalk.dim("  Set ANTHROPIC_API_KEY environment variable"));
  console.log();
  showModelTable(Object.values(ANTHROPIC_MODELS));

  // OpenAI Models
  console.log(chalk.green.bold("OPENAI (GPT)"));
  console.log(chalk.dim("  Set OPENAI_API_KEY environment variable"));
  console.log();
  showModelTable(Object.values(OPENAI_MODELS));

  // Google Models
  console.log(chalk.blue.bold("GOOGLE (Gemini)"));
  console.log(chalk.dim("  Set GOOGLE_API_KEY environment variable"));
  console.log();
  showModelTable(Object.values(GOOGLE_MODELS));

  // Local Models
  console.log(chalk.dim("─".repeat(90)));
  console.log();
  console.log(chalk.white.bold("Local Models (node-llama-cpp)"));
  console.log(chalk.dim("Privacy-first, no API costs. Models download on first use."));
  console.log();

  // Group local models by family
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
      const localConfig = LOCAL_MODELS[model.id];
      const contextStr = localConfig ? formatNumber(localConfig.contextWindow) : "?";
      console.log(`  ${marker} ${chalk.white(model.id.padEnd(22))} ${model.parameters.padEnd(6)} ${String(model.minRamGb).padStart(2)}GB RAM  ${contextStr.padStart(5)} ctx  ${chalk.dim(model.description.substring(0, 35))}`);
    }
    console.log();
  }

  console.log(chalk.dim("─".repeat(90)));
  console.log(chalk.dim("✓ = downloaded, ○ = not downloaded (local models only)"));
  console.log(chalk.dim("Local models are downloaded automatically on first use."));
  console.log();
}

/**
 * Show model table for cloud providers
 */
function showModelTable(models: ModelConfig[]): void {
  for (const model of models) {
    const contextStr = formatNumber(model.contextWindow);
    const outputStr = formatNumber(model.maxOutputTokens);
    const priceStr = model.pricing
      ? `$${model.pricing.inputPerMillion}/$${model.pricing.outputPerMillion}`
      : "-";
    const batchStr = String(model.recommendedBatchSize);

    const codeTag = model.codeOptimized ? chalk.cyan(" [code]") : "";
    const reasonTag = model.isReasoningModel ? chalk.yellow(" [reason]") : "";

    console.log(
      `  ${chalk.white(model.id.padEnd(30))} ${contextStr.padStart(6)} ctx  ${outputStr.padStart(6)} out  ${priceStr.padStart(10)}/M  batch:${batchStr.padStart(3)}${codeTag}${reasonTag}`
    );
  }
  console.log();
}

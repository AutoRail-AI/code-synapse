/**
 * Interactive Setup Wizard
 *
 * Guides users through configuring Code-Synapse with:
 * - Model provider selection (local vs cloud)
 * - API key configuration for cloud providers
 * - Model selection
 * - Other preferences
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
  type ModelPreset,
} from "../../core/llm/index.js";

const logger = createLogger("setup");

// =============================================================================
// Types
// =============================================================================

export type ModelProvider = "local" | "openai" | "anthropic" | "google";

export interface ModelProviderConfig {
  provider: ModelProvider;
  apiKey?: string;
  modelId?: string;
  preset?: ModelPreset;
}

export interface CodeSynapseConfig extends ProjectConfig {
  llmModel?: string;
  skipLlm?: boolean;
  modelProvider?: ModelProvider;
  apiKeys?: {
    openai?: string;
    anthropic?: string;
    google?: string;
  };
}

// =============================================================================
// Provider Definitions
// =============================================================================

const PROVIDERS: Record<ModelProvider, {
  name: string;
  description: string;
  requiresApiKey: boolean;
  envVar?: string;
  models: Array<{ id: string; name: string; description: string }>;
}> = {
  local: {
    name: "Local Models (Recommended)",
    description: "Run models locally on your machine. Privacy-first, no API costs.",
    requiresApiKey: false,
    models: [
      { id: "qwen2.5-coder-0.5b", name: "Qwen 2.5 Coder 0.5B", description: "Ultra-fast, 1GB RAM" },
      { id: "qwen2.5-coder-1.5b", name: "Qwen 2.5 Coder 1.5B", description: "Low memory, 2GB RAM" },
      { id: "qwen2.5-coder-3b", name: "Qwen 2.5 Coder 3B", description: "Balanced (recommended), 4GB RAM" },
      { id: "qwen2.5-coder-7b", name: "Qwen 2.5 Coder 7B", description: "High quality, 8GB RAM" },
      { id: "qwen2.5-coder-14b", name: "Qwen 2.5 Coder 14B", description: "Maximum quality, 16GB RAM" },
    ],
  },
  openai: {
    name: "OpenAI",
    description: "GPT-4o models. Requires API key.",
    requiresApiKey: true,
    envVar: "OPENAI_API_KEY",
    models: [
      { id: "gpt-4o", name: "GPT-4o", description: "Most capable, higher cost" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", description: "Fast and affordable" },
    ],
  },
  anthropic: {
    name: "Anthropic",
    description: "Claude models. Requires API key.",
    requiresApiKey: true,
    envVar: "ANTHROPIC_API_KEY",
    models: [
      { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", description: "Best for code" },
      { id: "claude-3-haiku", name: "Claude 3 Haiku", description: "Fast and affordable" },
    ],
  },
  google: {
    name: "Google AI (Gemini)",
    description: "Gemini models. Requires API key.",
    requiresApiKey: true,
    envVar: "GOOGLE_API_KEY",
    models: [
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", description: "Large context, high quality" },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", description: "Fast and efficient" },
    ],
  },
};

// =============================================================================
// Interactive Setup
// =============================================================================

export class InteractiveSetup {
  private rl: readline.Interface | null = null;

  private async getReadline(): Promise<readline.Interface> {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: stdin,
        output: stdout,
      });
    }
    return this.rl;
  }

  private async close(): Promise<void> {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  private async ask(question: string): Promise<string> {
    const rl = await this.getReadline();
    return rl.question(question);
  }

  private async askChoice(
    question: string,
    options: Array<{ key: string; label: string; description?: string }>
  ): Promise<string> {
    console.log();
    console.log(chalk.cyan.bold(question));
    console.log();

    for (const opt of options) {
      console.log(`  ${chalk.yellow(`[${opt.key}]`)} ${opt.label}`);
      if (opt.description) {
        console.log(chalk.dim(`      ${opt.description}`));
      }
    }

    console.log();
    const validKeys = options.map((o) => o.key.toLowerCase());

    while (true) {
      const answer = (await this.ask(chalk.dim("Enter choice: "))).trim().toLowerCase();
      if (validKeys.includes(answer)) {
        return answer;
      }
      console.log(chalk.red(`Invalid choice. Please enter one of: ${validKeys.join(", ")}`));
    }
  }

  private async askYesNo(question: string, defaultValue = true): Promise<boolean> {
    const defaultHint = defaultValue ? "Y/n" : "y/N";
    const answer = (await this.ask(`${question} ${chalk.dim(`(${defaultHint})`)}: `)).trim().toLowerCase();

    if (answer === "") {
      return defaultValue;
    }
    return answer === "y" || answer === "yes";
  }

  private async askApiKey(provider: ModelProvider): Promise<string | undefined> {
    const providerInfo = PROVIDERS[provider];
    if (!providerInfo.requiresApiKey) return undefined;

    // Check environment variable first
    const envValue = providerInfo.envVar ? process.env[providerInfo.envVar] : undefined;
    if (envValue) {
      console.log(chalk.green(`✓ Found ${providerInfo.envVar} in environment`));
      const useEnv = await this.askYesNo("Use the API key from environment?", true);
      if (useEnv) {
        return envValue;
      }
    }

    console.log();
    console.log(chalk.yellow(`${providerInfo.name} requires an API key.`));
    console.log(chalk.dim(`You can also set ${providerInfo.envVar} in your environment.`));
    console.log();

    const apiKey = await this.ask(chalk.dim("Enter API key (will be stored locally): "));
    return apiKey.trim() || undefined;
  }

  /**
   * Run the full interactive setup wizard
   */
  async run(): Promise<CodeSynapseConfig | null> {
    console.log();
    console.log(chalk.cyan.bold("╔══════════════════════════════════════════════════════════════╗"));
    console.log(chalk.cyan.bold("║               Welcome to Code-Synapse Setup                  ║"));
    console.log(chalk.cyan.bold("║         Let's configure your AI code intelligence           ║"));
    console.log(chalk.cyan.bold("╚══════════════════════════════════════════════════════════════╝"));
    console.log();

    try {
      // Step 1: Choose model provider
      const providerChoice = await this.askChoice(
        "Which model provider would you like to use?",
        [
          { key: "1", label: PROVIDERS.local.name, description: PROVIDERS.local.description },
          { key: "2", label: PROVIDERS.openai.name, description: PROVIDERS.openai.description },
          { key: "3", label: PROVIDERS.anthropic.name, description: PROVIDERS.anthropic.description },
          { key: "4", label: PROVIDERS.google.name, description: PROVIDERS.google.description },
          { key: "s", label: "Skip LLM features", description: "Use Code-Synapse without AI features" },
        ]
      );

      const providerMap: Record<string, ModelProvider | "skip"> = {
        "1": "local",
        "2": "openai",
        "3": "anthropic",
        "4": "google",
        "s": "skip",
      };

      const provider = providerMap[providerChoice];

      // Load existing config if available
      const configPath = getConfigPath();
      let config: CodeSynapseConfig = fileExists(configPath)
        ? (readJson<CodeSynapseConfig>(configPath) ?? {} as CodeSynapseConfig)
        : {} as CodeSynapseConfig;

      // Initialize apiKeys object if needed
      if (!config.apiKeys) {
        config.apiKeys = {};
      }

      if (provider === "skip") {
        config.skipLlm = true;
        config.modelProvider = undefined;
        console.log();
        console.log(chalk.yellow("LLM features disabled. You can enable them later with:"));
        console.log(chalk.dim("  code-synapse config --setup"));
        await this.close();
        return config;
      }

      // TypeScript: after the skip check, provider is definitely ModelProvider
      const selectedProvider = provider as ModelProvider;
      config.modelProvider = selectedProvider;
      config.skipLlm = false;

      const providerInfo = PROVIDERS[selectedProvider];

      // Step 2: Get API key if needed
      if (providerInfo.requiresApiKey) {
        const apiKey = await this.askApiKey(selectedProvider);
        if (!apiKey) {
          console.log();
          console.log(chalk.yellow("No API key provided. You'll need to set it before using LLM features."));
          console.log(chalk.dim(`Set ${providerInfo.envVar} in your environment or run setup again.`));
        } else {
          config.apiKeys[selectedProvider as keyof typeof config.apiKeys] = apiKey;
          console.log(chalk.green("✓ API key saved"));
        }
      }

      // Step 3: Choose model
      const models = providerInfo.models;
      const modelOptions = models.map((m: { id: string; name: string; description: string }, i: number) => ({
        key: String(i + 1),
        label: m.name,
        description: m.description,
      }));

      console.log();
      const modelChoice = await this.askChoice(
        `Which ${providerInfo.name} model would you like to use?`,
        modelOptions
      );

      const selectedModel = models[parseInt(modelChoice) - 1];
      if (selectedModel) {
        config.llmModel = selectedModel.id;
        console.log();
        console.log(chalk.green(`✓ Model set to: ${selectedModel.name}`));
      }

      // Step 4: Additional preferences for local models
      if (selectedProvider === "local") {
        console.log();
        console.log(chalk.dim("Local models are downloaded automatically on first use."));
        console.log(chalk.dim(`Selected model will use approximately ${this.getModelSize(selectedModel?.id)} of disk space.`));
      }

      await this.close();

      // Save configuration
      if (fileExists(configPath)) {
        writeJson(configPath, config);
        console.log();
        console.log(chalk.green("✓ Configuration saved"));
      }

      return config;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  /**
   * Quick setup - just ask for model provider and key
   */
  async quickSetup(): Promise<ModelProviderConfig | null> {
    try {
      // Step 1: Choose provider
      const providerChoice = await this.askChoice(
        "Select model provider:",
        [
          { key: "1", label: "Local (free, private)", description: "Runs on your machine" },
          { key: "2", label: "OpenAI", description: "Requires API key" },
          { key: "3", label: "Anthropic", description: "Requires API key" },
          { key: "4", label: "Google", description: "Requires API key" },
        ]
      );

      const providerMap: Record<string, ModelProvider> = {
        "1": "local",
        "2": "openai",
        "3": "anthropic",
        "4": "google",
      };

      const provider = providerMap[providerChoice]!;
      const result: ModelProviderConfig = { provider };
      const providerInfo = PROVIDERS[provider];

      // Step 2: Get API key if needed
      if (providerInfo.requiresApiKey) {
        result.apiKey = await this.askApiKey(provider);
      }

      // Step 3: Choose model for local
      if (provider === "local") {
        const presetChoice = await this.askChoice(
          "Select model size:",
          [
            { key: "1", label: "Fastest (0.5B)", description: "Ultra-fast, minimal resources" },
            { key: "2", label: "Minimal (1.5B)", description: "Good for low-memory systems" },
            { key: "3", label: "Balanced (3B)", description: "Recommended for most users" },
            { key: "4", label: "Quality (7B)", description: "Higher quality, needs 8GB RAM" },
            { key: "5", label: "Maximum (14B)", description: "Best quality, needs 16GB RAM" },
          ]
        );

        const presetMap: Record<string, ModelPreset> = {
          "1": "fastest",
          "2": "minimal",
          "3": "balanced",
          "4": "quality",
          "5": "maximum",
        };

        const preset = presetMap[presetChoice];
        result.preset = preset;
        if (preset) {
          result.modelId = MODEL_PRESETS[preset];
        }
      } else {
        // Use default model for cloud providers
        result.modelId = providerInfo.models[0]?.id;
      }

      await this.close();
      return result;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private getModelSize(modelId?: string): string {
    if (!modelId) return "unknown";
    const model = getModelById(modelId);
    return model ? `${model.fileSizeGb}GB` : "unknown";
  }
}

// =============================================================================
// Setup Command
// =============================================================================

export interface SetupOptions {
  provider?: string;
  apiKey?: string;
  model?: string;
  interactive?: boolean;
}

/**
 * Setup command - configure model provider and API keys
 */
export async function setupCommand(options: SetupOptions): Promise<void> {
  logger.info({ options }, "Setup command");

  const configPath = getConfigPath();

  // If specific options provided, apply them directly
  if (options.provider || options.apiKey || options.model) {
    const config: CodeSynapseConfig = fileExists(configPath)
      ? (readJson<CodeSynapseConfig>(configPath) ?? {} as CodeSynapseConfig)
      : {} as CodeSynapseConfig;

    if (!config.apiKeys) {
      config.apiKeys = {};
    }

    if (options.provider) {
      const provider = options.provider.toLowerCase() as ModelProvider;
      if (!PROVIDERS[provider]) {
        console.log(chalk.red(`Unknown provider: ${options.provider}`));
        console.log(chalk.dim("Valid providers: local, openai, anthropic, google"));
        return;
      }
      config.modelProvider = provider;
      config.skipLlm = false;
      console.log(chalk.green(`✓ Provider set to: ${PROVIDERS[provider].name}`));
    }

    if (options.apiKey && config.modelProvider) {
      const provider = config.modelProvider;
      if (PROVIDERS[provider].requiresApiKey) {
        config.apiKeys[provider as keyof typeof config.apiKeys] = options.apiKey;
        console.log(chalk.green(`✓ API key saved for ${PROVIDERS[provider].name}`));
      }
    }

    if (options.model) {
      config.llmModel = options.model;
      console.log(chalk.green(`✓ Model set to: ${options.model}`));
    }

    writeJson(configPath, config);
    return;
  }

  // Run interactive setup
  const setup = new InteractiveSetup();
  await setup.run();
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get API key for a provider from config or environment
 */
export function getApiKey(provider: ModelProvider): string | undefined {
  const configPath = getConfigPath();
  const providerInfo = PROVIDERS[provider];

  // Check environment first
  if (providerInfo.envVar) {
    const envValue = process.env[providerInfo.envVar];
    if (envValue) return envValue;
  }

  // Check config
  if (fileExists(configPath)) {
    const config = readJson<CodeSynapseConfig>(configPath);
    if (config?.apiKeys) {
      return config.apiKeys[provider as keyof typeof config.apiKeys];
    }
  }

  return undefined;
}

/**
 * Check if a provider is configured
 */
export function isProviderConfigured(provider: ModelProvider): boolean {
  if (!PROVIDERS[provider].requiresApiKey) return true;
  return !!getApiKey(provider);
}

/**
 * Get the configured model provider
 */
export function getConfiguredProvider(): ModelProvider | undefined {
  const configPath = getConfigPath();
  if (fileExists(configPath)) {
    const config = readJson<CodeSynapseConfig>(configPath);
    return config?.modelProvider;
  }
  return undefined;
}

/**
 * Export provider info for use in other modules
 */
export { PROVIDERS };

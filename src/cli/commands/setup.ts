/**
 * Interactive Setup Wizard
 *
 * Modern, enterprise-grade setup experience using @clack/prompts.
 * Guides users through configuring Code-Synapse with:
 * - Model provider selection (local vs cloud)
 * - API key configuration for cloud providers
 * - Model selection
 */

import * as p from "@clack/prompts";
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
  type ModelPreset,
} from "../../core/llm/index.js";
import {
  PROVIDER_METADATA,
  getModelsByVendor,
  getDefaultModelId,
  validateApiKey,
  requiresApiKey,
  getAllProviderIds,
  getEnvVarName,
} from "../../core/models/Registry.js";
import type { ModelVendor } from "../../core/models/interfaces/IModel.js";
import {
  getProviderDisplay,
  getProviderSelectOptions,
  getQuickSelectOptions,
  formatProviderStatus,
  type ProviderDisplayInfo,
} from "../provider-display.js";

const logger = createLogger("setup");

// =============================================================================
// Types
// =============================================================================

/**
 * ModelProvider is an alias for ModelVendor from the Registry
 * Kept for backward compatibility with existing code
 */
export type ModelProvider = ModelVendor;

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

/**
 * Model descriptions for UI display (supplements Registry data)
 */
const MODEL_DESCRIPTIONS: Record<string, string> = {
  // Local models
  "qwen2.5-coder-0.5b": "Ultra-fast, 1GB RAM",
  "qwen2.5-coder-1.5b": "Low memory, 2GB RAM",
  "qwen2.5-coder-3b": "Balanced (recommended), 4GB RAM",
  "qwen2.5-coder-7b": "High quality, 8GB RAM",
  "qwen2.5-coder-14b": "Maximum quality, 16GB RAM",
  // OpenAI
  "gpt-4o": "Most capable, higher cost",
  "gpt-4o-mini": "Fast and affordable",
  "o3": "Reasoning model, highest quality",
  // Anthropic
  "claude-sonnet-4-20250514": "Best for code (recommended)",
  "claude-sonnet-4-5-20250929": "Latest Claude Sonnet",
  "claude-3-5-sonnet": "Fast and capable",
  "claude-3-haiku": "Fast and affordable",
  // Google
  "gemini-3-pro-preview": "Self-reasoning, 1M context",
  "gemini-3-flash-preview": "Ultra-fast, 1M context",
  "gemini-1.5-pro": "Large context, high quality",
  "gemini-1.5-flash": "Fast, 1M context",
};

/**
 * Build provider info from Registry dynamically
 */
function buildProviderInfo(provider: ModelProvider): {
  name: string;
  description: string;
  requiresApiKey: boolean;
  envVar?: string;
  defaultModel: string;
  models: Array<{ id: string; name: string; description: string }>;
} {
  const metadata = PROVIDER_METADATA[provider];
  const models = getModelsByVendor(provider);

  // Get display info from centralized provider-display module
  const displayInfo = getProviderDisplay(provider);

  return {
    name: metadata?.name ?? provider,
    description: displayInfo.description,
    requiresApiKey: requiresApiKey(provider),
    envVar: getEnvVarName(provider) ?? undefined,
    defaultModel: getDefaultModelId(provider) ?? models[0]?.id ?? "",
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      description: MODEL_DESCRIPTIONS[m.id] ?? "",
    })),
  };
}

/**
 * PROVIDERS object - dynamically built from Registry
 * Adding a new provider to Registry automatically includes it here
 */
const PROVIDERS: Record<ModelProvider, ReturnType<typeof buildProviderInfo>> = Object.fromEntries(
  getAllProviderIds().map((id) => [id, buildProviderInfo(id as ModelProvider)])
) as Record<ModelProvider, ReturnType<typeof buildProviderInfo>>;

// =============================================================================
// Interactive Setup
// =============================================================================

export class InteractiveSetup {
  /**
   * Run the full interactive setup wizard
   */
  async run(): Promise<CodeSynapseConfig | null> {
    console.clear();

    p.intro(chalk.bgCyan.black(" Code-Synapse Setup "));

    // Load existing config
    const configPath = getConfigPath();
    const config: CodeSynapseConfig = fileExists(configPath)
      ? (readJson<CodeSynapseConfig>(configPath) ?? {} as CodeSynapseConfig)
      : {} as CodeSynapseConfig;

    if (!config.apiKeys) {
      config.apiKeys = {};
    }

    // Step 1: Choose model provider (options auto-generated from Registry)
    const providerOptions = getProviderSelectOptions();
    const providerResult = await p.select({
      message: "Select your AI provider",
      options: providerOptions,
    });

    if (p.isCancel(providerResult)) {
      p.cancel("Setup cancelled");
      return null;
    }

    const provider = providerResult as ModelProvider;
    const providerDisplay = getProviderDisplay(provider);
    const providerInfo = PROVIDERS[provider];
    config.modelProvider = provider;
    config.skipLlm = false;

    // Step 2: Get API key if needed
    if (providerInfo.requiresApiKey) {
      // Check environment variable first
      const envValue = providerInfo.envVar ? process.env[providerInfo.envVar] : undefined;

      if (envValue) {
        const useEnv = await p.confirm({
          message: `Found ${providerInfo.envVar} in environment. Use it?`,
          initialValue: true,
        });

        if (p.isCancel(useEnv)) {
          p.cancel("Setup cancelled");
          return null;
        }

        if (useEnv) {
          config.apiKeys[provider as keyof typeof config.apiKeys] = envValue;
          p.log.success("Using API key from environment");
        }
      }

      if (!config.apiKeys[provider as keyof typeof config.apiKeys]) {
        const apiKey = await p.password({
          message: `Enter your ${providerInfo.name} API key`,
          validate: (value) => {
            const result = validateApiKey(provider, value);
            if (!result.valid) {
              return result.message;
            }
          },
        });

        if (p.isCancel(apiKey)) {
          p.cancel("Setup cancelled");
          return null;
        }

        config.apiKeys[provider as keyof typeof config.apiKeys] = apiKey;
        p.log.success("API key saved securely");
      }
    }

    // Step 3: Choose model
    const modelOptions = providerInfo.models.map((m) => ({
      value: m.id,
      label: m.name,
      hint: m.description,
    }));

    const modelResult = await p.select({
      message: `Select ${providerInfo.name} model`,
      options: modelOptions,
      initialValue: providerInfo.defaultModel,
    });

    if (p.isCancel(modelResult)) {
      p.cancel("Setup cancelled");
      return null;
    }

    config.llmModel = modelResult as string;
    const selectedModel = providerInfo.models.find((m) => m.id === modelResult);

    // Step 4: Summary and confirmation
    const summary = [
      `Provider: ${providerDisplay.color(providerDisplay.name)}`,
      `Model: ${chalk.cyan(selectedModel?.name || modelResult)}`,
    ];

    if (providerDisplay.isLocal && selectedModel) {
      const model = getModelById(selectedModel.id);
      if (model) {
        summary.push(`RAM needed: ${chalk.yellow(model.minRamGb + "GB")}`);
        summary.push(`Download size: ${chalk.yellow(model.fileSizeGb + "GB")}`);
      }
    }

    p.note(summary.join("\n"), "Configuration");

    // Save configuration
    if (fileExists(configPath)) {
      writeJson(configPath, config);
    }

    p.outro(chalk.green("Setup complete! Run `code-synapse` to start."));

    return config;
  }

  /**
   * Quick setup - minimal prompts for experienced users
   */
  async quickSetup(): Promise<ModelProviderConfig | null> {
    // Options auto-generated from Registry
    const quickOptions = getQuickSelectOptions();
    const providerResult = await p.select({
      message: "Select provider",
      options: quickOptions,
    });

    if (p.isCancel(providerResult)) {
      return null;
    }

    const provider = providerResult as ModelProvider;
    const providerDisplay = getProviderDisplay(provider);
    const providerInfo = PROVIDERS[provider];
    const result: ModelProviderConfig = { provider };

    if (providerDisplay.requiresApiKey) {
      const apiKey = await p.password({
        message: "API key",
      });
      if (p.isCancel(apiKey)) return null;
      result.apiKey = apiKey;
    }

    if (providerDisplay.isLocal) {
      const presetResult = await p.select({
        message: "Model size",
        options: [
          { value: "fastest", label: "Fastest (0.5B)", hint: "1GB RAM" },
          { value: "minimal", label: "Minimal (1.5B)", hint: "2GB RAM" },
          { value: "balanced", label: "Balanced (3B)", hint: "4GB RAM - recommended" },
          { value: "quality", label: "Quality (7B)", hint: "8GB RAM" },
          { value: "maximum", label: "Maximum (14B)", hint: "16GB RAM" },
        ],
        initialValue: "balanced",
      });
      if (p.isCancel(presetResult)) return null;
      result.preset = presetResult as ModelPreset;
      result.modelId = MODEL_PRESETS[result.preset];
    } else {
      result.modelId = providerInfo.defaultModel;
    }

    return result;
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

  // If specific options provided, apply them directly (non-interactive)
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
        p.log.error(`Unknown provider: ${options.provider}`);
        p.log.info("Valid providers: local, openai, anthropic, google");
        return;
      }
      config.modelProvider = provider;
      config.skipLlm = false;
      p.log.success(`Provider set to ${PROVIDERS[provider].name}`);
    }

    if (options.apiKey && config.modelProvider) {
      const provider = config.modelProvider;
      if (PROVIDERS[provider].requiresApiKey) {
        config.apiKeys[provider as keyof typeof config.apiKeys] = options.apiKey;
        p.log.success(`API key saved for ${PROVIDERS[provider].name}`);
      }
    }

    if (options.model) {
      config.llmModel = options.model;
      p.log.success(`Model set to ${options.model}`);
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

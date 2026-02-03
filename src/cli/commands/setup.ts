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
  defaultModel: string;
  models: Array<{ id: string; name: string; description: string }>;
}> = {
  local: {
    name: "Local Models",
    description: "Run models locally. Privacy-first, no API costs.",
    requiresApiKey: false,
    defaultModel: "qwen2.5-coder-3b",
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
    defaultModel: "gpt-4o",
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
    defaultModel: "claude-sonnet-4-20250514",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", description: "Best for code (recommended)" },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", description: "Fast and capable" },
      { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", description: "Fast and affordable" },
    ],
  },
  google: {
    name: "Google AI",
    description: "Gemini models. Requires API key.",
    requiresApiKey: true,
    envVar: "GOOGLE_API_KEY",
    defaultModel: "gemini-3-pro-preview",
    models: [
      { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", description: "Self-reasoning, 1M context" },
      { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", description: "Ultra-fast, 1M context" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", description: "Large context, high quality" },
    ],
  },
};

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
    let config: CodeSynapseConfig = fileExists(configPath)
      ? (readJson<CodeSynapseConfig>(configPath) ?? {} as CodeSynapseConfig)
      : {} as CodeSynapseConfig;

    if (!config.apiKeys) {
      config.apiKeys = {};
    }

    // Step 1: Choose model provider
    const providerResult = await p.select({
      message: "Select your AI provider",
      options: [
        {
          value: "google",
          label: "Google (Gemini)",
          hint: "recommended - requires API key"
        },
        {
          value: "local",
          label: "Local Models",
          hint: "privacy-first, no API costs"
        },
        {
          value: "anthropic",
          label: "Anthropic (Claude)",
          hint: "requires API key"
        },
        {
          value: "openai",
          label: "OpenAI (GPT-4)",
          hint: "requires API key"
        },
      ],
    });

    if (p.isCancel(providerResult)) {
      p.cancel("Setup cancelled");
      return null;
    }

    const provider = providerResult as ModelProvider;
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
            if (!value || value.trim().length === 0) {
              return "API key is required";
            }
            if (provider === "anthropic" && !value.startsWith("sk-ant-")) {
              return "Anthropic API keys start with 'sk-ant-'";
            }
            if (provider === "openai" && !value.startsWith("sk-")) {
              return "OpenAI API keys start with 'sk-'";
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
      `Provider: ${chalk.cyan(providerInfo.name)}`,
      `Model: ${chalk.cyan(selectedModel?.name || modelResult)}`,
    ];

    if (provider === "local" && selectedModel) {
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
    const providerResult = await p.select({
      message: "Select provider",
      options: [
        { value: "local", label: "Local", hint: "free, private" },
        { value: "anthropic", label: "Anthropic", hint: "Claude models" },
        { value: "openai", label: "OpenAI", hint: "GPT models" },
        { value: "google", label: "Google", hint: "Gemini models" },
      ],
    });

    if (p.isCancel(providerResult)) {
      return null;
    }

    const provider = providerResult as ModelProvider;
    const providerInfo = PROVIDERS[provider];
    const result: ModelProviderConfig = { provider };

    if (providerInfo.requiresApiKey) {
      const apiKey = await p.password({
        message: "API key",
      });
      if (p.isCancel(apiKey)) return null;
      result.apiKey = apiKey;
    }

    if (provider === "local") {
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

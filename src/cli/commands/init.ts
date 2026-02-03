/**
 * init command - Initialize Code-Synapse for a project
 */

import chalk from "chalk";
import ora from "ora";
import * as path from "node:path";
import type { ProjectConfig } from "../../types/index.js";
import {
  getConfigDir,
  getConfigPath,
  getDataDir,
  getLogsDir,
  ensureDir,
  writeJson,
  fileExists,
  createLogger,
} from "../../utils/index.js";
import {
  MODEL_PRESETS,
  getModelById,
  type ModelPreset,
} from "../../core/llm/index.js";
import { getDefaultModelId } from "../../core/models/Registry.js";
import type { ModelVendor } from "../../core/models/interfaces/IModel.js";
import { getProviderDisplay } from "../provider-display.js";

const logger = createLogger("init");

/**
 * Get default model ID for an API provider
 * Uses the central Registry as source of truth
 */
function getDefaultApiModel(provider: ModelVendor): string {
  const defaultModel = getDefaultModelId(provider);
  if (!defaultModel) {
    throw new Error(`No default model configured for provider: ${provider}`);
  }
  return defaultModel;
}

export interface InitOptions {
  force?: boolean;
  skipLlm?: boolean;
  model?: string;
  /** Model provider (local, openai, anthropic, google) */
  modelProvider?: ModelVendor;
  /** API keys for cloud providers */
  apiKeys?: {
    openai?: string;
    anthropic?: string;
    google?: string;
  };
}

/**
 * Initialize Code-Synapse for the current project
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const configPath = getConfigPath();

  logger.info({ options }, "Starting initialization");

  // Check if already initialized
  if (fileExists(configPath) && !options.force) {
    console.log(
      chalk.yellow("Code-Synapse is already initialized in this project.")
    );
    console.log(chalk.dim("Use --force to reinitialize."));
    logger.info("Already initialized, skipping");
    return;
  }

  const spinner = ora("Initializing Code-Synapse...").start();

  try {
    // Create directory structure
    spinner.text = "Creating directory structure...";
    const configDir = getConfigDir();
    const dataDir = getDataDir();
    const logsDir = getLogsDir();

    ensureDir(configDir);
    ensureDir(dataDir);
    ensureDir(logsDir);

    logger.debug({ configDir, dataDir, logsDir }, "Created directories");

    // Detect project configuration
    spinner.text = "Detecting project configuration...";
    const projectConfig = await detectProjectConfig(options);

    // Write configuration
    spinner.text = "Writing configuration...";
    writeJson(configPath, projectConfig);

    logger.info({ configPath }, "Configuration saved");

    spinner.succeed(chalk.green("Code-Synapse initialized successfully!"));

    // Display summary
    console.log();
    console.log(chalk.dim("Configuration:"));
    console.log(chalk.dim(`  Project:    ${projectConfig.name}`));
    console.log(chalk.dim(`  Languages:  ${projectConfig.languages.join(", ")}`));
    if (projectConfig.framework) {
      console.log(chalk.dim(`  Framework:  ${projectConfig.framework}`));
    }

    // Show LLM model info
    if (options.skipLlm) {
      console.log(chalk.dim(`  LLM:        disabled`));
    } else {
      const modelId = (projectConfig as ProjectConfig & { llmModel?: string }).llmModel || MODEL_PRESETS.balanced;
      const modelSpec = getModelById(modelId);
      if (modelSpec) {
        console.log(chalk.dim(`  LLM Model:  ${modelSpec.name} (${modelSpec.parameters})`));
        console.log(chalk.dim(`  RAM Needed: ${modelSpec.minRamGb}GB`));
      } else {
        console.log(chalk.dim(`  LLM Model:  ${modelId}`));
      }
    }

    console.log();
    console.log(chalk.dim("Created:"));
    console.log(chalk.dim(`  ${configDir}/`));
    console.log(chalk.dim(`    ├── ${path.basename(configPath)}`));
    console.log(chalk.dim(`    ├── data/`));
    console.log(chalk.dim(`    └── logs/`));

    console.log();
    console.log(chalk.cyan("Next steps:"));
    console.log(
      chalk.dim("  1. Run"),
      chalk.white("code-synapse index"),
      chalk.dim("to index the project")
    );
    console.log(
      chalk.dim("  2. Run"),
      chalk.white("code-synapse start"),
      chalk.dim("to start the MCP server")
    );
    console.log(
      chalk.dim("  3. Configure your AI agent to connect to the server")
    );

    if (!options.skipLlm) {
      console.log();
      console.log(chalk.dim("LLM model will be downloaded automatically on first use."));
      console.log(chalk.dim("To change model: code-synapse config --model <preset>"));
      console.log(chalk.dim("Available presets: fastest, minimal, balanced, quality, maximum"));
    }
  } catch (error) {
    spinner.fail(chalk.red("Failed to initialize Code-Synapse"));
    logger.error({ err: error }, "Initialization failed");
    throw error;
  }
}

/**
 * Detect project configuration from the current directory
 */
async function detectProjectConfig(options: InitOptions): Promise<ProjectConfig> {
  const projectRoot = process.cwd();
  const projectName = path.basename(projectRoot);

  // Try to read package.json for more info
  let detectedFramework: ProjectConfig["framework"] | undefined;
  let detectedLanguages: ProjectConfig["languages"] = ["typescript", "javascript"];

  const packageJsonPath = path.join(projectRoot, "package.json");
  if (fileExists(packageJsonPath)) {
    try {
      const packageJson = await import(packageJsonPath, {
        with: { type: "json" },
      });
      const pkg = packageJson.default;

      // Detect framework from dependencies
      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      if (deps.next) {
        detectedFramework = "nextjs";
      } else if (deps["@nestjs/core"]) {
        detectedFramework = "nestjs";
      } else if (deps.express) {
        detectedFramework = "express";
      } else if (deps.fastify) {
        detectedFramework = "fastify";
      } else if (deps.koa) {
        detectedFramework = "koa";
      } else if (deps.react && !deps.next) {
        detectedFramework = "react";
      } else if (deps.vue) {
        detectedFramework = "vue";
      } else if (deps["@angular/core"]) {
        detectedFramework = "angular";
      } else if (deps.svelte) {
        detectedFramework = "svelte";
      }

      // Check for TypeScript
      if (deps.typescript) {
        detectedLanguages = ["typescript", "javascript"];
      } else {
        detectedLanguages = ["javascript"];
      }

      logger.debug({ detectedFramework, detectedLanguages }, "Detected project settings");
    } catch {
      logger.debug("Could not parse package.json");
    }
  }

  // Build source patterns based on framework
  let sourcePatterns: string[];
  switch (detectedFramework) {
    case "nextjs":
      sourcePatterns = [
        "app/**/*.{ts,tsx,js,jsx}",
        "pages/**/*.{ts,tsx,js,jsx}",
        "src/**/*.{ts,tsx,js,jsx}",
        "components/**/*.{ts,tsx,js,jsx}",
        "lib/**/*.{ts,tsx,js,jsx}",
      ];
      break;
    case "nestjs":
      sourcePatterns = [
        "src/**/*.ts",
        "libs/**/*.ts",
      ];
      break;
    default:
      sourcePatterns = ["src/**/*.{ts,tsx,js,jsx}", "**/*.{ts,tsx,js,jsx}"];
  }

  const config: ProjectConfig = {
    root: projectRoot,
    name: projectName,
    languages: detectedLanguages,
    framework: detectedFramework,
    sourcePatterns,
    ignorePatterns: [
      "node_modules/**",
      "dist/**",
      "build/**",
      ".git/**",
      ".next/**",
      "coverage/**",
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/__tests__/**",
      "**/__mocks__/**",
    ],
  };

  // Store LLM preference in config (optional field)
  const extendedConfig = config as ProjectConfig & {
    skipLlm?: boolean;
    llmModel?: string;
    modelProvider?: ModelVendor;
    apiKeys?: {
      openai?: string;
      anthropic?: string;
      google?: string;
    };
  };

  if (options.skipLlm) {
    extendedConfig.skipLlm = true;
  } else {
    // Set model based on provider type
    let modelId: string;

    if (options.modelProvider && !getProviderDisplay(options.modelProvider).isLocal) {
      // For API providers, use the model name directly (e.g., "claude-3-5-sonnet", "gpt-4o")
      // Don't validate against local model list
      modelId = options.model || getDefaultApiModel(options.modelProvider);
      logger.debug({ modelProvider: options.modelProvider, modelId }, "Using API model");
    } else {
      // For local provider, validate against known local models
      modelId = MODEL_PRESETS.balanced; // Default

      if (options.model) {
        // Check if it's a preset name
        if (options.model in MODEL_PRESETS) {
          modelId = MODEL_PRESETS[options.model as ModelPreset];
        } else {
          // Check if it's a direct model ID
          const model = getModelById(options.model);
          if (model) {
            modelId = options.model;
          } else {
            logger.warn({ model: options.model }, "Unknown local model, using balanced preset");
          }
        }
      }
    }

    extendedConfig.llmModel = modelId;
  }

  // Store provider settings if provided
  if (options.modelProvider) {
    extendedConfig.modelProvider = options.modelProvider;
  }

  if (options.apiKeys) {
    extendedConfig.apiKeys = options.apiKeys;
  }

  return extendedConfig;
}

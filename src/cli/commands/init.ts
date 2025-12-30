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

const logger = createLogger("init");

export interface InitOptions {
  force?: boolean;
  skipLlm?: boolean;
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
    console.log(chalk.dim(`  LLM:        ${options.skipLlm ? "disabled" : "enabled"}`));

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
      chalk.white("code-synapse start"),
      chalk.dim("to start the MCP server")
    );
    console.log(
      chalk.dim("  2. Configure your AI agent to connect to the server")
    );

    if (!options.skipLlm) {
      console.log();
      console.log(chalk.dim("For business logic inference, ensure Ollama is running:"));
      console.log(chalk.dim("  ollama pull qwen2.5-coder:1.5b"));
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
  if (options.skipLlm) {
    (config as ProjectConfig & { skipLlm?: boolean }).skipLlm = true;
  }

  return config;
}

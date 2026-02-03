/**
 * Provider Display Utilities
 *
 * Centralizes all provider-related display logic for the CLI.
 * This module handles UI concerns (colors, labels, descriptions)
 * keeping vendor-specific presentation separate from business logic.
 *
 * @module
 */

import chalk from "chalk";

/** Type for a chalk color function */
type ChalkColor = typeof chalk.cyan;
import {
  getAllProviderIds,
  getProviderDisplayName,
  getEnvVarName,
  requiresApiKey,
  getModelsByVendor,
} from "../core/models/Registry.js";
import type { ModelVendor } from "../core/models/interfaces/IModel.js";

// =============================================================================
// Types
// =============================================================================

export interface ProviderDisplayInfo {
  /** Provider ID (e.g., "openai", "anthropic") */
  id: ModelVendor;
  /** Human-readable name (e.g., "OpenAI") */
  name: string;
  /** Short alias for display (e.g., "GPT", "Claude") */
  alias: string;
  /** ChalkColor color function for styling */
  color: ChalkColor;
  /** Short description for help text */
  description: string;
  /** Hint text for selection prompts */
  hint: string;
  /** Whether this provider requires an API key */
  requiresApiKey: boolean;
  /** Environment variable name for API key */
  envVar: string | null;
  /** Whether this is a local provider (no network) */
  isLocal: boolean;
  /** Whether this is recommended */
  isRecommended: boolean;
}

export interface ProviderSelectOption {
  value: string;
  label: string;
  hint: string;
}

// =============================================================================
// Provider Display Configuration
// =============================================================================

/**
 * Provider-specific display configuration
 * This is the ONLY place vendor-specific UI configuration should exist
 */
const PROVIDER_DISPLAY_CONFIG: Record<string, {
  alias: string;
  color: ChalkColor;
  description: string;
  hint: string;
  isRecommended?: boolean;
}> = {
  local: {
    alias: "Local",
    color: chalk.cyan,
    description: "Run models locally. Privacy-first, no API costs.",
    hint: "privacy-first, no API costs",
    isRecommended: false,
  },
  openai: {
    alias: "GPT",
    color: chalk.green,
    description: "GPT-4o models. Requires API key.",
    hint: "requires API key",
    isRecommended: false,
  },
  anthropic: {
    alias: "Claude",
    color: chalk.magenta,
    description: "Claude models. Requires API key.",
    hint: "requires API key",
    isRecommended: false,
  },
  google: {
    alias: "Gemini",
    color: chalk.blue,
    description: "Gemini models. Requires API key.",
    hint: "recommended - requires API key",
    isRecommended: true,
  },
};

/**
 * Default display config for unknown providers
 */
const DEFAULT_DISPLAY_CONFIG = {
  alias: "Unknown",
  color: chalk.white,
  description: "Unknown provider",
  hint: "",
  isRecommended: false,
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Get display information for a provider
 * All vendor-specific UI logic goes through this function
 */
export function getProviderDisplay(providerId: string): ProviderDisplayInfo {
  const config = PROVIDER_DISPLAY_CONFIG[providerId] ?? DEFAULT_DISPLAY_CONFIG;

  return {
    id: providerId as ModelVendor,
    name: getProviderDisplayName(providerId),
    alias: config.alias,
    color: config.color,
    description: config.description,
    hint: config.hint,
    requiresApiKey: requiresApiKey(providerId),
    envVar: getEnvVarName(providerId),
    isLocal: providerId === "local",
    isRecommended: config.isRecommended ?? false,
  };
}

/**
 * Get display info for all registered providers
 */
export function getAllProviderDisplays(): ProviderDisplayInfo[] {
  return getAllProviderIds().map(getProviderDisplay);
}

/**
 * Get cloud providers only (non-local)
 */
export function getCloudProviderDisplays(): ProviderDisplayInfo[] {
  return getAllProviderDisplays().filter(p => !p.isLocal);
}

/**
 * Generate select options for provider selection prompts
 * Ordered with recommended first
 */
export function getProviderSelectOptions(): ProviderSelectOption[] {
  const displays = getAllProviderDisplays();

  // Sort: recommended first, then alphabetically
  const sorted = displays.sort((a, b) => {
    if (a.isRecommended && !b.isRecommended) return -1;
    if (!a.isRecommended && b.isRecommended) return 1;
    return a.name.localeCompare(b.name);
  });

  return sorted.map(display => ({
    value: display.id,
    label: display.isLocal
      ? display.name
      : `${display.name} (${display.alias})`,
    hint: display.hint,
  }));
}

/**
 * Generate quick select options (for compact prompts)
 */
export function getQuickSelectOptions(): ProviderSelectOption[] {
  const displays = getAllProviderDisplays();

  return displays.map(display => ({
    value: display.id,
    label: display.name,
    hint: display.isLocal ? "free, private" : display.alias + " models",
  }));
}

/**
 * Format provider name with color
 */
export function formatProviderName(providerId: string): string {
  const display = getProviderDisplay(providerId);
  return display.color(display.name);
}

/**
 * Format provider status message (for spinners/logs)
 */
export function formatProviderStatus(providerId: string, status: "initializing" | "connected" | "failed"): string {
  const display = getProviderDisplay(providerId);

  switch (status) {
    case "initializing":
      return `Initializing ${display.name}...`;
    case "connected":
      return display.isLocal
        ? `${display.name} model router initialized`
        : `${display.name} API connected`;
    case "failed":
      return `Failed to initialize ${display.name}`;
  }
}

/**
 * Format model info for display
 */
export function formatModelInfo(providerId: string, modelId: string): string {
  const display = getProviderDisplay(providerId);
  return `Using ${display.name} (${modelId})`;
}

/**
 * Check if a provider ID is valid/known
 */
export function isKnownProvider(providerId: string): boolean {
  return getAllProviderIds().includes(providerId);
}

/**
 * Get the recommended provider ID
 */
export function getRecommendedProviderId(): string | undefined {
  const displays = getAllProviderDisplays();
  return displays.find(d => d.isRecommended)?.id;
}

// =============================================================================
// CLI Formatting Utilities
// =============================================================================

/**
 * Print provider table header
 */
export function printProviderHeader(providerId: string): void {
  const display = getProviderDisplay(providerId);
  console.log(display.color.bold(`${display.name.toUpperCase()} (${display.alias})`));
  if (display.envVar) {
    console.log(chalk.dim(`  Set ${display.envVar} environment variable`));
  }
  console.log();
}

/**
 * Get API key setup instructions
 */
export function getApiKeyInstructions(providerId: string): string {
  const display = getProviderDisplay(providerId);
  if (!display.requiresApiKey) {
    return "";
  }
  return `Set ${display.envVar} in your environment or use --api-key flag.`;
}

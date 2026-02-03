/**
 * Multi-Model Abstraction Layer
 *
 * Unified interface for LLM interactions across multiple providers:
 * - Local models (node-llama-cpp: Qwen, Llama, CodeLlama, DeepSeek)
 * - OpenAI (GPT-4o, GPT-4o-mini)
 * - Anthropic (Claude 3.5 Sonnet, Claude 3 Haiku)
 * - Google (Gemini 3 Pro, Gemini 3 Flash)
 *
 * Features:
 * - Intelligent routing based on task type, cost, and latency
 * - Automatic fallback on provider failures
 * - Response caching
 * - Usage tracking and cost attribution
 *
 * @module
 */

// Interfaces
export * from "./interfaces/IModel.js";

// Registry (Model Definitions)
export * from "./Registry.js";

// Router
export * from "./router/ModelRouter.js";

// Providers
export * from "./providers/LocalProvider.js";
export * from "./providers/OpenAIProvider.js";
export * from "./providers/GoogleProvider.js";
export * from "./providers/AnthropicProvider.js";

// =============================================================================
// Convenience Factory
// =============================================================================

import { ModelRouter, createModelRouter } from "./router/ModelRouter.js";
import { createLocalProvider } from "./providers/LocalProvider.js";
import { createOpenAIProvider } from "./providers/OpenAIProvider.js";
import { createGoogleProvider } from "./providers/GoogleProvider.js";
import { createAnthropicProvider } from "./providers/AnthropicProvider.js";
import type { RoutingPolicy, IModelRouter, ModelVendor } from "./interfaces/IModel.js";
import {
  getDefaultModelId,
  getApiKeyFromEnv,
  requiresApiKey,
  validateApiKey,
  getProviderDisplayName,
} from "./Registry.js";
// Internal utility - not part of public API
import { setApiKeyInEnv } from "./internal/index.js";

// =============================================================================
// High-Level Public API - createConfiguredModelRouter
// =============================================================================

/**
 * Configuration for creating a model router
 * This is the ONLY configuration consumers need to provide
 */
export interface ModelRouterConfig {
  /**
   * The provider to use: "local", "openai", "anthropic", "google"
   * Default: "local"
   */
  provider?: ModelVendor | string;

  /**
   * API key for cloud providers
   * If not provided, reads from environment variable
   * Not required for "local" provider
   */
  apiKey?: string;

  /**
   * Specific model ID to use
   * If not provided, uses the provider's default model
   */
  modelId?: string;

  /**
   * Custom routing policy
   * If not provided, uses a sensible default based on provider
   */
  routingPolicy?: RoutingPolicy;
}

/**
 * Result from creating a configured model router
 */
export interface ConfiguredModelRouterResult {
  /** The initialized model router */
  router: IModelRouter;
  /** The provider that was configured */
  provider: string;
  /** The model ID that will be used (default or specified) */
  modelId: string;
  /** Whether the provider requires an API key */
  requiresApiKey: boolean;
  /** Human-readable provider name */
  providerDisplayName: string;
}

/**
 * Create a fully configured and initialized model router
 *
 * This is the PRIMARY public API for obtaining a model router.
 * It handles all internal setup including:
 * - API key injection into environment
 * - Provider selection and initialization
 * - Default model selection
 * - Routing policy configuration
 *
 * @example
 * ```typescript
 * // Local models (no API key needed)
 * const { router } = await createConfiguredModelRouter({ provider: "local" });
 *
 * // Cloud provider with API key
 * const { router } = await createConfiguredModelRouter({
 *   provider: "anthropic",
 *   apiKey: "sk-ant-xxx"
 * });
 *
 * // Specific model
 * const { router } = await createConfiguredModelRouter({
 *   provider: "openai",
 *   apiKey: process.env.OPENAI_API_KEY,
 *   modelId: "gpt-4o-mini"
 * });
 * ```
 */
export async function createConfiguredModelRouter(
  config: ModelRouterConfig = {}
): Promise<ConfiguredModelRouterResult> {
  const provider = config.provider ?? "local";

  // Handle API key: use provided key, or check environment
  let apiKey = config.apiKey;
  const needsApiKey = requiresApiKey(provider);

  if (needsApiKey) {
    // Try to get from environment if not provided
    if (!apiKey) {
      apiKey = getApiKeyFromEnv(provider);
    }

    // Set in environment for providers that read from env
    if (apiKey) {
      setApiKeyInEnv(provider, apiKey);
    }

    // Validate if we have a key
    if (apiKey) {
      const validation = validateApiKey(provider, apiKey);
      if (!validation.valid) {
        throw new Error(`Invalid API key for ${getProviderDisplayName(provider)}: ${validation.message}`);
      }
    }
  }

  // Get model ID: use provided, or get default
  // Use provided model ID, or get default from Registry
  const defaultModel = getDefaultModelId(provider);
  if (!config.modelId && !defaultModel) {
    throw new Error(`No default model configured for provider: ${provider}`);
  }
  const modelId = config.modelId ?? defaultModel!;

  // Create enable map for just this provider
  const enableMap = {
    enableLocal: provider === "local",
    enableOpenAI: provider === "openai",
    enableAnthropic: provider === "anthropic",
    enableGoogle: provider === "google",
  };

  // Create and initialize the router
  const router = await createInitializedModelRouter(enableMap);

  return {
    router,
    provider,
    modelId,
    requiresApiKey: needsApiKey,
    providerDisplayName: getProviderDisplayName(provider),
  };
}

/**
 * Create a fully initialized model router with all available providers
 */
export async function createInitializedModelRouter(options?: {
  enableLocal?: boolean;
  enableOpenAI?: boolean;
  enableAnthropic?: boolean;
  enableGoogle?: boolean;
}): Promise<ModelRouter> {
  const {
    enableLocal = true,
    enableOpenAI = true,
    enableAnthropic = false, // Not implemented yet
    enableGoogle = true,
  } = options ?? {};

  const router = createModelRouter();

  // Register providers
  if (enableLocal) {
    router.registerProvider(createLocalProvider());
  }

  if (enableOpenAI) {
    router.registerProvider(createOpenAIProvider());
  }

  if (enableAnthropic) {
    router.registerProvider(createAnthropicProvider());
  }

  if (enableGoogle) {
    router.registerProvider(createGoogleProvider());
  }

  // Initialize all providers
  await router.initialize();

  return router;
}

/**
 * Create a default routing policy optimized for local-first operation
 */
export function createLocalFirstPolicy(): RoutingPolicy {
  return {
    preferLocal: true,
    maxLatencyMs: 10000,
    qualityThreshold: 0.5,
    fallbackOrder: ["local", "google", "anthropic", "openai"],
  };
}

/**
 * Create a routing policy optimized for quality
 */
export function createQualityFirstPolicy(): RoutingPolicy {
  return {
    preferLocal: false,
    qualityThreshold: 0.9,
    fallbackOrder: ["openai", "anthropic", "google", "local"],
  };
}

/**
 * Create a routing policy optimized for cost
 */
export function createCostOptimizedPolicy(): RoutingPolicy {
  return {
    preferLocal: true,
    maxCostPerRequest: 0.01,
    qualityThreshold: 0.6,
    fallbackOrder: ["local", "google", "anthropic", "openai"],
  };
}

/**
 * Create a routing policy optimized for speed
 */
export function createLowLatencyPolicy(): RoutingPolicy {
  return {
    preferLocal: false,
    maxLatencyMs: 2000,
    qualityThreshold: 0.7,
    fallbackOrder: ["google", "local", "openai", "anthropic"],
  };
}

/**
 * Create a routing policy that uses Gemini 3 models exclusively if possible
 */
export function createGemini3ExclusivePolicy(): RoutingPolicy {
  return {
    preferLocal: false,
    qualityThreshold: 0.9,
    fallbackOrder: ["google"],
  };
}

/**
 * Multi-Model Abstraction Layer
 *
 * Unified interface for LLM interactions across multiple providers:
 * - Local models (node-llama-cpp: Qwen, Llama, CodeLlama, DeepSeek)
 * - OpenAI (GPT-4o, GPT-4o-mini)
 * - Anthropic (Claude 3.5 Sonnet, Claude 3 Haiku)
 * - Google (Gemini 1.5 Pro, Gemini 1.5 Flash)
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

// Router
export * from "./router/ModelRouter.js";

// Providers
export * from "./providers/LocalProvider.js";
export * from "./providers/OpenAIProvider.js";

// =============================================================================
// Convenience Factory
// =============================================================================

import { ModelRouter, createModelRouter } from "./router/ModelRouter.js";
import { createLocalProvider } from "./providers/LocalProvider.js";
import { createOpenAIProvider } from "./providers/OpenAIProvider.js";
import type { RoutingPolicy } from "./interfaces/IModel.js";

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
    enableGoogle = false, // Not implemented yet
  } = options ?? {};

  const router = createModelRouter();

  // Register providers
  if (enableLocal) {
    router.registerProvider(createLocalProvider());
  }

  if (enableOpenAI) {
    router.registerProvider(createOpenAIProvider());
  }

  // TODO: Add Anthropic and Google providers when implemented
  if (enableAnthropic) {
    // router.registerProvider(createAnthropicProvider());
  }

  if (enableGoogle) {
    // router.registerProvider(createGoogleProvider());
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

/**
 * Model Configuration Registry
 *
 * Comprehensive configuration for all supported LLM models including:
 * - Context window sizes
 * - Rate limits (requests/tokens per minute)
 * - Pricing information
 * - Max output tokens
 * - Recommended batch sizes
 *
 * Used by the dynamic batcher and rate limiter to optimize API usage.
 *
 * @module
 */

import { createLogger } from "../../utils/logger.js";

const logger = createLogger("model-configs");

// =============================================================================
// Types
// =============================================================================

export interface ModelRateLimits {
  /** Requests per minute */
  requestsPerMinute: number;
  /** Input tokens per minute */
  inputTokensPerMinute: number;
  /** Output tokens per minute */
  outputTokensPerMinute: number;
}

export interface ModelPricing {
  /** Price per million input tokens in USD */
  inputPerMillion: number;
  /** Price per million output tokens in USD */
  outputPerMillion: number;
}

export interface ModelConfig {
  /** Model identifier used in API calls */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider (anthropic, openai, google, local) */
  provider: "anthropic" | "openai" | "google" | "local";
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
  /** Rate limits (API models only) */
  rateLimits?: ModelRateLimits;
  /** Pricing (API models only) */
  pricing?: ModelPricing;
  /** Recommended max entities per batch for justification */
  recommendedBatchSize: number;
  /** Whether this model supports extended context */
  supportsExtendedContext?: boolean;
  /** Extended context window size (if supported) */
  extendedContextWindow?: number;
  /** Knowledge cutoff date */
  knowledgeCutoff?: string;
  /** Whether this is a reasoning model */
  isReasoningModel?: boolean;
  /** Minimum RAM required (local models) */
  minRamGb?: number;
  /** Model file size (local models) */
  fileSizeGb?: number;
  /** Whether optimized for code */
  codeOptimized?: boolean;
}

// =============================================================================
// Anthropic Models
// =============================================================================

export const ANTHROPIC_MODELS: Record<string, ModelConfig> = {
  // Claude 4.x Series
  "claude-sonnet-4-20250514": {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 64000,
    rateLimits: {
      requestsPerMinute: 4000,
      inputTokensPerMinute: 2000000,
      outputTokensPerMinute: 400000,
    },
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
    },
    // 200K context / ~220 tokens per entity = ~900 max, limited by 64K output / ~100 tokens = ~640
    // Conservative: 500 to leave room for variation
    recommendedBatchSize: 500,
    knowledgeCutoff: "Jan 2025",
    isReasoningModel: true,
    codeOptimized: true,
  },
  "claude-opus-4-20250514": {
    id: "claude-opus-4-20250514",
    name: "Claude Opus 4",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 64000,
    rateLimits: {
      requestsPerMinute: 4000,
      inputTokensPerMinute: 2000000,
      outputTokensPerMinute: 400000,
    },
    pricing: {
      inputPerMillion: 5,
      outputPerMillion: 25,
    },
    recommendedBatchSize: 500,
    knowledgeCutoff: "May 2025",
    isReasoningModel: true,
    codeOptimized: true,
  },

  // Claude 4.5 Series
  "claude-sonnet-4-5-20250929": {
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 64000,
    supportsExtendedContext: true,
    extendedContextWindow: 1000000,
    rateLimits: {
      requestsPerMinute: 4000,
      inputTokensPerMinute: 2000000,
      outputTokensPerMinute: 400000,
    },
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
    },
    recommendedBatchSize: 500,
    knowledgeCutoff: "Jan 2025",
    isReasoningModel: true,
    codeOptimized: true,
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 64000,
    rateLimits: {
      requestsPerMinute: 4000,
      inputTokensPerMinute: 4000000,
      outputTokensPerMinute: 800000,
    },
    pricing: {
      inputPerMillion: 1,
      outputPerMillion: 5,
    },
    recommendedBatchSize: 500,
    knowledgeCutoff: "Feb 2025",
    isReasoningModel: true,
    codeOptimized: false,
  },
  "claude-opus-4-5": {
    id: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 64000,
    rateLimits: {
      requestsPerMinute: 4000,
      inputTokensPerMinute: 2000000,
      outputTokensPerMinute: 400000,
    },
    pricing: {
      inputPerMillion: 5,
      outputPerMillion: 25,
    },
    recommendedBatchSize: 500,
    knowledgeCutoff: "May 2025",
    isReasoningModel: true,
    codeOptimized: true,
  },

  // Claude 3.5 Series (8K max output = ~80 entities max)
  "claude-3-5-sonnet-20241022": {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    rateLimits: {
      requestsPerMinute: 4000,
      inputTokensPerMinute: 200000,
      outputTokensPerMinute: 80000,
    },
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
    },
    // Limited by 8K max output / ~100 tokens per entity = 80
    recommendedBatchSize: 80,
    knowledgeCutoff: "Apr 2024",
    isReasoningModel: false,
    codeOptimized: true,
  },
  "claude-3-5-sonnet-latest": {
    id: "claude-3-5-sonnet-latest",
    name: "Claude 3.5 Sonnet (Latest)",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    rateLimits: {
      requestsPerMinute: 4000,
      inputTokensPerMinute: 200000,
      outputTokensPerMinute: 80000,
    },
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
    },
    recommendedBatchSize: 80,
    isReasoningModel: false,
    codeOptimized: true,
  },
  "claude-3-5-haiku-20241022": {
    id: "claude-3-5-haiku-20241022",
    name: "Claude 3.5 Haiku",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    rateLimits: {
      requestsPerMinute: 4000,
      inputTokensPerMinute: 400000,
      outputTokensPerMinute: 80000,
    },
    pricing: {
      inputPerMillion: 1,
      outputPerMillion: 5,
    },
    recommendedBatchSize: 80,
    isReasoningModel: false,
    codeOptimized: false,
  },

  // Claude 3 Series
  "claude-3-opus-20240229": {
    id: "claude-3-opus-20240229",
    name: "Claude 3 Opus",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 4096,
    rateLimits: {
      requestsPerMinute: 4000,
      inputTokensPerMinute: 200000,
      outputTokensPerMinute: 80000,
    },
    pricing: {
      inputPerMillion: 15,
      outputPerMillion: 75,
    },
    recommendedBatchSize: 50,
    knowledgeCutoff: "Aug 2023",
    isReasoningModel: false,
    codeOptimized: false,
  },
  "claude-3-sonnet-20240229": {
    id: "claude-3-sonnet-20240229",
    name: "Claude 3 Sonnet",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 4096,
    rateLimits: {
      requestsPerMinute: 4000,
      inputTokensPerMinute: 200000,
      outputTokensPerMinute: 80000,
    },
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
    },
    recommendedBatchSize: 80,
    knowledgeCutoff: "Aug 2023",
    isReasoningModel: false,
    codeOptimized: false,
  },
  "claude-3-haiku-20240307": {
    id: "claude-3-haiku-20240307",
    name: "Claude 3 Haiku",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 4096,
    rateLimits: {
      requestsPerMinute: 4000,
      inputTokensPerMinute: 400000,
      outputTokensPerMinute: 80000,
    },
    pricing: {
      inputPerMillion: 0.25,
      outputPerMillion: 1.25,
    },
    recommendedBatchSize: 100,
    knowledgeCutoff: "Aug 2023",
    isReasoningModel: false,
    codeOptimized: false,
  },
};

// =============================================================================
// OpenAI Models
// =============================================================================

export const OPENAI_MODELS: Record<string, ModelConfig> = {
  // GPT-5.2 Series (Latest) - 100K max output = ~1000 entities max
  "gpt-5.2": {
    id: "gpt-5.2",
    name: "GPT-5.2",
    provider: "openai",
    contextWindow: 200000,
    maxOutputTokens: 100000,
    rateLimits: {
      requestsPerMinute: 10000,
      inputTokensPerMinute: 30000000,
      outputTokensPerMinute: 10000000,
    },
    pricing: {
      inputPerMillion: 2.5,
      outputPerMillion: 10,
    },
    recommendedBatchSize: 600,
    knowledgeCutoff: "Aug 2025",
    isReasoningModel: true,
    codeOptimized: true,
  },
  "gpt-5.2-pro": {
    id: "gpt-5.2-pro",
    name: "GPT-5.2 Pro",
    provider: "openai",
    contextWindow: 200000,
    maxOutputTokens: 100000,
    rateLimits: {
      requestsPerMinute: 10000,
      inputTokensPerMinute: 30000000,
      outputTokensPerMinute: 10000000,
    },
    pricing: {
      inputPerMillion: 5,
      outputPerMillion: 20,
    },
    recommendedBatchSize: 600,
    knowledgeCutoff: "Aug 2025",
    isReasoningModel: true,
    codeOptimized: true,
  },

  // GPT-5 Series - 65K max output = ~650 entities max
  "gpt-5-mini": {
    id: "gpt-5-mini",
    name: "GPT-5 Mini",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 65536,
    rateLimits: {
      requestsPerMinute: 30000,
      inputTokensPerMinute: 150000000,
      outputTokensPerMinute: 30000000,
    },
    pricing: {
      inputPerMillion: 0.4,
      outputPerMillion: 1.6,
    },
    recommendedBatchSize: 400,
    isReasoningModel: true,
    codeOptimized: false,
  },
  "gpt-5-nano": {
    id: "gpt-5-nano",
    name: "GPT-5 Nano",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 65536,
    rateLimits: {
      requestsPerMinute: 30000,
      inputTokensPerMinute: 150000000,
      outputTokensPerMinute: 30000000,
    },
    pricing: {
      inputPerMillion: 0.1,
      outputPerMillion: 0.4,
    },
    recommendedBatchSize: 400,
    isReasoningModel: false,
    codeOptimized: false,
  },

  // GPT-4o Series - 16K max output = ~160 entities max
  "gpt-4o": {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    rateLimits: {
      requestsPerMinute: 10000,
      inputTokensPerMinute: 30000000,
      outputTokensPerMinute: 10000000,
    },
    pricing: {
      inputPerMillion: 2.5,
      outputPerMillion: 10,
    },
    recommendedBatchSize: 150,
    knowledgeCutoff: "Oct 2023",
    isReasoningModel: false,
    codeOptimized: true,
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    rateLimits: {
      requestsPerMinute: 30000,
      inputTokensPerMinute: 150000000,
      outputTokensPerMinute: 30000000,
    },
    pricing: {
      inputPerMillion: 0.15,
      outputPerMillion: 0.6,
    },
    recommendedBatchSize: 150,
    knowledgeCutoff: "Oct 2023",
    isReasoningModel: false,
    codeOptimized: false,
  },

  // o3/o4 Reasoning Series
  "o3": {
    id: "o3",
    name: "o3",
    provider: "openai",
    contextWindow: 200000,
    maxOutputTokens: 100000,
    rateLimits: {
      requestsPerMinute: 10000,
      inputTokensPerMinute: 30000000,
      outputTokensPerMinute: 10000000,
    },
    pricing: {
      inputPerMillion: 10,
      outputPerMillion: 40,
    },
    recommendedBatchSize: 600,
    isReasoningModel: true,
    codeOptimized: true,
  },
  "o4-mini": {
    id: "o4-mini",
    name: "o4 Mini",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 65536,
    rateLimits: {
      requestsPerMinute: 30000,
      inputTokensPerMinute: 150000000,
      outputTokensPerMinute: 30000000,
    },
    pricing: {
      inputPerMillion: 1.1,
      outputPerMillion: 4.4,
    },
    recommendedBatchSize: 400,
    isReasoningModel: true,
    codeOptimized: false,
  },

  // Legacy GPT-4 (for compatibility)
  "gpt-4-turbo": {
    id: "gpt-4-turbo",
    name: "GPT-4 Turbo",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    rateLimits: {
      requestsPerMinute: 10000,
      inputTokensPerMinute: 2000000,
      outputTokensPerMinute: 300000,
    },
    pricing: {
      inputPerMillion: 10,
      outputPerMillion: 30,
    },
    recommendedBatchSize: 50,
    knowledgeCutoff: "Dec 2023",
    isReasoningModel: false,
    codeOptimized: false,
  },
  "gpt-3.5-turbo": {
    id: "gpt-3.5-turbo",
    name: "GPT-3.5 Turbo",
    provider: "openai",
    contextWindow: 16385,
    maxOutputTokens: 4096,
    rateLimits: {
      requestsPerMinute: 10000,
      inputTokensPerMinute: 2000000,
      outputTokensPerMinute: 300000,
    },
    pricing: {
      inputPerMillion: 0.5,
      outputPerMillion: 1.5,
    },
    recommendedBatchSize: 30,
    knowledgeCutoff: "Sep 2021",
    isReasoningModel: false,
    codeOptimized: false,
  },
};

// =============================================================================
// Google Gemini Models
// =============================================================================

export const GOOGLE_MODELS: Record<string, ModelConfig> = {
  // Gemini 3 Series (Latest) - 65K max output = ~650 entities max
  "gemini-3-pro-preview": {
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro",
    provider: "google",
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    rateLimits: {
      requestsPerMinute: 1000,
      inputTokensPerMinute: 4000000,
      outputTokensPerMinute: 400000,
    },
    pricing: {
      inputPerMillion: 2,
      outputPerMillion: 12,
    },
    recommendedBatchSize: 500,
    knowledgeCutoff: "Jan 2025",
    isReasoningModel: true,
    codeOptimized: true,
  },
  "gemini-3-flash-preview": {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash",
    provider: "google",
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    rateLimits: {
      requestsPerMinute: 2000,
      inputTokensPerMinute: 4000000,
      outputTokensPerMinute: 400000,
    },
    pricing: {
      inputPerMillion: 0.5,
      outputPerMillion: 3,
    },
    recommendedBatchSize: 500,
    knowledgeCutoff: "Jan 2025",
    isReasoningModel: true,
    codeOptimized: true,
  },

  // Gemini 2.5 Series - 65K max output = ~650 entities max
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    rateLimits: {
      requestsPerMinute: 1000,
      inputTokensPerMinute: 4000000,
      outputTokensPerMinute: 400000,
    },
    pricing: {
      inputPerMillion: 1.25,
      outputPerMillion: 10,
    },
    recommendedBatchSize: 500,
    knowledgeCutoff: "Jan 2025",
    isReasoningModel: true,
    codeOptimized: true,
  },
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    rateLimits: {
      requestsPerMinute: 2000,
      inputTokensPerMinute: 4000000,
      outputTokensPerMinute: 400000,
    },
    pricing: {
      inputPerMillion: 0.15,
      outputPerMillion: 0.6,
    },
    recommendedBatchSize: 500,
    knowledgeCutoff: "Jan 2025",
    isReasoningModel: true,
    codeOptimized: false,
  },

  // Gemini 1.5 Series - 8K max output = ~80 entities max
  "gemini-1.5-pro": {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "google",
    contextWindow: 2000000,
    maxOutputTokens: 8192,
    rateLimits: {
      requestsPerMinute: 360,
      inputTokensPerMinute: 4000000,
      outputTokensPerMinute: 400000,
    },
    pricing: {
      inputPerMillion: 1.25,
      outputPerMillion: 5,
    },
    // Limited by 8K max output
    recommendedBatchSize: 80,
    knowledgeCutoff: "Nov 2023",
    isReasoningModel: false,
    codeOptimized: false,
  },
  "gemini-1.5-flash": {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    provider: "google",
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    rateLimits: {
      requestsPerMinute: 1000,
      inputTokensPerMinute: 4000000,
      outputTokensPerMinute: 400000,
    },
    pricing: {
      inputPerMillion: 0.075,
      outputPerMillion: 0.3,
    },
    // Limited by 8K max output
    recommendedBatchSize: 80,
    knowledgeCutoff: "Nov 2023",
    isReasoningModel: false,
    codeOptimized: false,
  },
};

// =============================================================================
// Local Models (node-llama-cpp)
// =============================================================================

export const LOCAL_MODELS: Record<string, ModelConfig> = {
  // Qwen 2.5 Coder Series (Recommended for code)
  "qwen2.5-coder-0.5b": {
    id: "qwen2.5-coder-0.5b",
    name: "Qwen 2.5 Coder 0.5B",
    provider: "local",
    contextWindow: 4096,
    maxOutputTokens: 2048,
    recommendedBatchSize: 10,
    minRamGb: 1,
    fileSizeGb: 0.4,
    codeOptimized: true,
  },
  "qwen2.5-coder-1.5b": {
    id: "qwen2.5-coder-1.5b",
    name: "Qwen 2.5 Coder 1.5B",
    provider: "local",
    contextWindow: 4096,
    maxOutputTokens: 2048,
    recommendedBatchSize: 10,
    minRamGb: 2,
    fileSizeGb: 1.0,
    codeOptimized: true,
  },
  "qwen2.5-coder-3b": {
    id: "qwen2.5-coder-3b",
    name: "Qwen 2.5 Coder 3B",
    provider: "local",
    contextWindow: 4096,
    maxOutputTokens: 2048,
    recommendedBatchSize: 15,
    minRamGb: 4,
    fileSizeGb: 2.0,
    codeOptimized: true,
  },
  "qwen2.5-coder-7b": {
    id: "qwen2.5-coder-7b",
    name: "Qwen 2.5 Coder 7B",
    provider: "local",
    contextWindow: 8192,
    maxOutputTokens: 4096,
    recommendedBatchSize: 20,
    minRamGb: 8,
    fileSizeGb: 4.5,
    codeOptimized: true,
  },
  "qwen2.5-coder-14b": {
    id: "qwen2.5-coder-14b",
    name: "Qwen 2.5 Coder 14B",
    provider: "local",
    contextWindow: 8192,
    maxOutputTokens: 4096,
    recommendedBatchSize: 25,
    minRamGb: 16,
    fileSizeGb: 9.0,
    codeOptimized: true,
  },

  // Llama 3.x Series
  "llama-3.2-1b": {
    id: "llama-3.2-1b",
    name: "Llama 3.2 1B",
    provider: "local",
    contextWindow: 4096,
    maxOutputTokens: 2048,
    recommendedBatchSize: 10,
    minRamGb: 1,
    fileSizeGb: 0.7,
    codeOptimized: false,
  },
  "llama-3.2-3b": {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B",
    provider: "local",
    contextWindow: 4096,
    maxOutputTokens: 2048,
    recommendedBatchSize: 15,
    minRamGb: 3,
    fileSizeGb: 2.0,
    codeOptimized: false,
  },
  "llama-3.1-8b": {
    id: "llama-3.1-8b",
    name: "Llama 3.1 8B",
    provider: "local",
    contextWindow: 8192,
    maxOutputTokens: 4096,
    recommendedBatchSize: 20,
    minRamGb: 8,
    fileSizeGb: 4.7,
    codeOptimized: false,
  },

  // CodeLlama Series
  "codellama-7b": {
    id: "codellama-7b",
    name: "CodeLlama 7B",
    provider: "local",
    contextWindow: 4096,
    maxOutputTokens: 2048,
    recommendedBatchSize: 15,
    minRamGb: 8,
    fileSizeGb: 4.0,
    codeOptimized: true,
  },
  "codellama-13b": {
    id: "codellama-13b",
    name: "CodeLlama 13B",
    provider: "local",
    contextWindow: 4096,
    maxOutputTokens: 2048,
    recommendedBatchSize: 15,
    minRamGb: 16,
    fileSizeGb: 7.5,
    codeOptimized: true,
  },

  // DeepSeek Coder Series
  "deepseek-coder-1.3b": {
    id: "deepseek-coder-1.3b",
    name: "DeepSeek Coder 1.3B",
    provider: "local",
    contextWindow: 4096,
    maxOutputTokens: 2048,
    recommendedBatchSize: 10,
    minRamGb: 2,
    fileSizeGb: 0.8,
    codeOptimized: true,
  },
  "deepseek-coder-6.7b": {
    id: "deepseek-coder-6.7b",
    name: "DeepSeek Coder 6.7B",
    provider: "local",
    contextWindow: 4096,
    maxOutputTokens: 2048,
    recommendedBatchSize: 15,
    minRamGb: 8,
    fileSizeGb: 4.0,
    codeOptimized: true,
  },
};

// =============================================================================
// Combined Registry
// =============================================================================

export const ALL_MODELS: Record<string, ModelConfig> = {
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
  ...GOOGLE_MODELS,
  ...LOCAL_MODELS,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get configuration for a specific model
 */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  // Direct lookup
  if (ALL_MODELS[modelId]) {
    return ALL_MODELS[modelId];
  }

  // Try partial match for versioned model IDs
  const normalizedId = modelId.toLowerCase();

  // Check for Claude models
  if (normalizedId.includes("claude-sonnet-4") && normalizedId.includes("2025")) {
    return ANTHROPIC_MODELS["claude-sonnet-4-20250514"];
  }
  if (normalizedId.includes("claude-opus-4") && normalizedId.includes("2025")) {
    return ANTHROPIC_MODELS["claude-opus-4-20250514"];
  }
  if (normalizedId.includes("claude-3-5-sonnet")) {
    return ANTHROPIC_MODELS["claude-3-5-sonnet-20241022"];
  }
  if (normalizedId.includes("claude-3-haiku")) {
    return ANTHROPIC_MODELS["claude-3-haiku-20240307"];
  }

  // Check for Gemini models
  if (normalizedId.includes("gemini-3-pro")) {
    return GOOGLE_MODELS["gemini-3-pro-preview"];
  }
  if (normalizedId.includes("gemini-3-flash")) {
    return GOOGLE_MODELS["gemini-3-flash-preview"];
  }
  if (normalizedId.includes("gemini-1.5-pro")) {
    return GOOGLE_MODELS["gemini-1.5-pro"];
  }
  if (normalizedId.includes("gemini-1.5-flash")) {
    return GOOGLE_MODELS["gemini-1.5-flash"];
  }

  // Check for GPT models
  if (normalizedId.includes("gpt-4o-mini")) {
    return OPENAI_MODELS["gpt-4o-mini"];
  }
  if (normalizedId.includes("gpt-4o")) {
    return OPENAI_MODELS["gpt-4o"];
  }
  if (normalizedId.includes("gpt-5.2")) {
    return OPENAI_MODELS["gpt-5.2"];
  }

  logger.warn({ modelId }, "Unknown model ID, using defaults");
  return undefined;
}

/**
 * Get the context window size for a model
 */
export function getContextWindow(modelId: string): number {
  const config = getModelConfig(modelId);
  return config?.contextWindow ?? 4096; // Default to 4K for unknown models
}

/**
 * Get the recommended batch size for a model
 */
export function getRecommendedBatchSize(modelId: string): number {
  const config = getModelConfig(modelId);
  return config?.recommendedBatchSize ?? 20; // Conservative default
}

/**
 * Get rate limits for a model
 */
export function getRateLimits(modelId: string): ModelRateLimits | undefined {
  const config = getModelConfig(modelId);
  return config?.rateLimits;
}

/**
 * Check if a model is a local model
 */
export function isLocalModel(modelId: string): boolean {
  const config = getModelConfig(modelId);
  return config?.provider === "local";
}

/**
 * Check if a model is an API model
 */
export function isApiModel(modelId: string): boolean {
  const config = getModelConfig(modelId);
  return config?.provider !== "local" && config?.provider !== undefined;
}

/**
 * Get all models for a specific provider
 */
export function getModelsByProvider(provider: ModelConfig["provider"]): ModelConfig[] {
  return Object.values(ALL_MODELS).filter((m) => m.provider === provider);
}

/**
 * Get default model for a provider
 */
export function getDefaultModelForProvider(provider: ModelConfig["provider"]): string {
  const defaults: Record<string, string> = {
    anthropic: "claude-sonnet-4-20250514",
    openai: "gpt-4o",
    google: "gemini-1.5-pro",
    local: "qwen2.5-coder-3b",
  };
  return defaults[provider] ?? "qwen2.5-coder-3b";
}

/**
 * Calculate optimal batch size based on available tokens
 */
export function calculateOptimalBatchSize(
  modelId: string,
  avgEntityTokens: number = 200,
  systemPromptTokens: number = 500,
  responseTokensPerEntity: number = 150
): number {
  const config = getModelConfig(modelId);
  if (!config) {
    return 10; // Conservative default
  }

  const contextWindow = config.contextWindow;
  const maxBatchSize = config.recommendedBatchSize;

  // Reserve 15% buffer
  const availableTokens = Math.floor(contextWindow * 0.85) - systemPromptTokens;

  // Calculate how many entities fit
  const tokensPerEntity = avgEntityTokens + responseTokensPerEntity;
  const calculatedBatchSize = Math.floor(availableTokens / tokensPerEntity);

  // Return the smaller of calculated and recommended
  return Math.max(1, Math.min(calculatedBatchSize, maxBatchSize));
}

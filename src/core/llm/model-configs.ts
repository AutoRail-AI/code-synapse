/**
 * Model Configuration Registry (Legacy Adapter)
 *
 * Adapts the new core/models/Registry to the legacy ModelConfig interface.
 * Preserves backward compatibility for the CLI and other consumers.
 *
 * @module
 */

import { createLogger } from "../../utils/logger.js";
import {
  ALL_MODELS as REGISTRY_ALL_MODELS,
  LOCAL_MODELS as REGISTRY_LOCAL_MODELS,
  OPENAI_MODELS as REGISTRY_OPENAI_MODELS,
  ANTHROPIC_MODELS as REGISTRY_ANTHROPIC_MODELS,
  GOOGLE_MODELS as REGISTRY_GOOGLE_MODELS,
} from "../models/Registry.js";
import type { ModelConfig as RegistryConfig, ModelVendor } from "../models/interfaces/IModel.js";

const logger = createLogger("model-configs");

// =============================================================================
// Types (Legacy)
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
// Adapter Logic
// =============================================================================

function adaptConfig(config: RegistryConfig): ModelConfig {
  // Synthesize pricing from costPer1k
  const pricing: ModelPricing = {
    inputPerMillion: config.costPer1kInputTokens * 1000,
    outputPerMillion: config.costPer1kOutputTokens * 1000,
  };

  // Default Rate Limits (Approximate, as they are not in Registry)
  const rateLimits: ModelRateLimits = {
    requestsPerMinute: config.isLocal ? 0 : 1000,
    inputTokensPerMinute: config.isLocal ? 0 : 200000,
    outputTokensPerMinute: config.isLocal ? 0 : 40000,
  };

  // Determine recommended batch size based on context window and type
  let recommendedBatchSize = 20;
  if (config.contextWindow >= 100000) recommendedBatchSize = 100;
  if (config.contextWindow >= 1000000) recommendedBatchSize = 500;
  if (config.isLocal) recommendedBatchSize = 10;

  return {
    id: config.id,
    name: config.name,
    provider: config.vendor as "anthropic" | "openai" | "google" | "local",
    contextWindow: config.contextWindow,
    maxOutputTokens: config.maxOutputTokens,
    rateLimits,
    pricing,
    recommendedBatchSize,
    // defaults for missing fields
    supportsExtendedContext: false,
    isReasoningModel: false,
    codeOptimized: config.capabilities.includes("code-generation"),
  };
}

function adaptModelList(models: RegistryConfig[]): Record<string, ModelConfig> {
  const record: Record<string, ModelConfig> = {};
  for (const model of models) {
    record[model.id] = adaptConfig(model);
  }
  return record;
}

// =============================================================================
// Exported Record Maps
// =============================================================================

export const ANTHROPIC_MODELS = adaptModelList(REGISTRY_ANTHROPIC_MODELS);
export const OPENAI_MODELS = adaptModelList(REGISTRY_OPENAI_MODELS);
export const GOOGLE_MODELS = adaptModelList(REGISTRY_GOOGLE_MODELS);
export const LOCAL_MODELS = adaptModelList(REGISTRY_LOCAL_MODELS);

export const ALL_MODELS = {
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
  ...GOOGLE_MODELS,
  ...LOCAL_MODELS,
};

// =============================================================================
// Helper Functions
// =============================================================================

export function getModelConfig(modelId: string): ModelConfig | undefined {
  return ALL_MODELS[modelId];
}

export function getContextWindow(modelId: string): number {
  return ALL_MODELS[modelId]?.contextWindow ?? 4096;
}

export function getRecommendedBatchSize(modelId: string): number {
  return ALL_MODELS[modelId]?.recommendedBatchSize ?? 20;
}

export function getRateLimits(modelId: string): ModelRateLimits | undefined {
  return ALL_MODELS[modelId]?.rateLimits;
}

export function isLocalModel(modelId: string): boolean {
  return ALL_MODELS[modelId]?.provider === "local";
}

export function isApiModel(modelId: string): boolean {
  const config = ALL_MODELS[modelId];
  return config !== undefined && config.provider !== "local";
}

export function getModelsByProvider(provider: "anthropic" | "openai" | "google" | "local"): ModelConfig[] {
  return Object.values(ALL_MODELS).filter((m) => m.provider === provider);
}

export function getDefaultModelForProvider(provider: string): string {
  const defaults: Record<string, string> = {
    anthropic: "claude-sonnet-4-20250514",
    openai: "gpt-4o",
    google: "gemini-3-pro-preview",
    local: "qwen2.5-coder-3b",
  };
  return defaults[provider] ?? "qwen2.5-coder-3b";
}

export function calculateOptimalBatchSize(
  modelId: string,
  avgEntityTokens: number = 200,
  systemPromptTokens: number = 500,
  responseTokensPerEntity: number = 150
): number {
  const config = getModelConfig(modelId);
  if (!config) return 10;

  const contextWindow = config.contextWindow;
  const maxBatchSize = config.recommendedBatchSize;
  const availableTokens = Math.floor(contextWindow * 0.85) - systemPromptTokens;
  const tokensPerEntity = avgEntityTokens + responseTokensPerEntity;
  const calculatedBatchSize = Math.floor(availableTokens / tokensPerEntity);

  return Math.max(1, Math.min(calculatedBatchSize, maxBatchSize));
}

/**
 * Model Registry
 *
 * Central source of truth for all supported LLM models.
 * Contains configuration, pricing, capabilities, and rate limits.
 */

import type { ModelConfig } from "./interfaces/IModel.js";

// =============================================================================
// Provider Metadata
// =============================================================================

export interface ProviderMetadata {
    name: string;
    envVar: string | null;
    defaultModelId: string;
}

export const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
    anthropic: {
        name: "Anthropic",
        envVar: "ANTHROPIC_API_KEY",
        defaultModelId: "claude-sonnet-4-20250514",
    },
    openai: {
        name: "OpenAI",
        envVar: "OPENAI_API_KEY",
        defaultModelId: "gpt-4o",
    },
    google: {
        name: "Google",
        envVar: "GOOGLE_API_KEY",
        defaultModelId: "gemini-3-pro-preview",
    },
    local: {
        name: "Local",
        envVar: null,
        defaultModelId: "qwen2.5-coder-3b",
    },
};

// =============================================================================
// Anthropic Models
// =============================================================================

export const ANTHROPIC_MODELS: ModelConfig[] = [
    {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        vendor: "anthropic",
        capabilities: ["text-generation", "code-generation", "code-analysis", "function-calling", "vision"],
        contextWindow: 200000,
        maxOutputTokens: 64000,
        costPer1kInputTokens: 0.003,
        costPer1kOutputTokens: 0.015,
        latencyMs: { typical: 1200, p95: 4000 },
        qualityScore: 0.95,
        isLocal: false,
        requiresApiKey: true,
        supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
    },
    {
        id: "claude-sonnet-4-5-20250929",
        name: "Claude Sonnet 4.5",
        vendor: "anthropic",
        contextWindow: 200000,
        maxOutputTokens: 64000,
        capabilities: ["text-generation", "code-generation", "code-analysis", "function-calling", "vision"],
        costPer1kInputTokens: 0.003,
        costPer1kOutputTokens: 0.015,
        latencyMs: { typical: 1200, p95: 4000 },
        qualityScore: 0.98,
        isLocal: false,
        requiresApiKey: true,
        supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
    },
    {
        id: "claude-3-5-sonnet",
        name: "Claude 3.5 Sonnet",
        vendor: "anthropic",
        capabilities: ["text-generation", "code-generation", "code-analysis", "function-calling", "vision"],
        contextWindow: 200000,
        maxOutputTokens: 8192,
        costPer1kInputTokens: 0.003,
        costPer1kOutputTokens: 0.015,
        latencyMs: { typical: 1200, p95: 4000 },
        qualityScore: 0.95,
        isLocal: false,
        requiresApiKey: true,
        supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
    },
    {
        id: "claude-3-haiku",
        name: "Claude 3 Haiku",
        vendor: "anthropic",
        capabilities: ["text-generation", "code-generation", "code-analysis"],
        contextWindow: 200000,
        maxOutputTokens: 4096,
        costPer1kInputTokens: 0.00025,
        costPer1kOutputTokens: 0.00125,
        latencyMs: { typical: 500, p95: 1500 },
        qualityScore: 0.8,
        isLocal: false,
        requiresApiKey: true,
        supportedTasks: ["classification", "extraction", "summarization"],
    },
];

// =============================================================================
// OpenAI Models
// =============================================================================

export const OPENAI_MODELS: ModelConfig[] = [
    {
        id: "gpt-4o",
        name: "GPT-4o",
        vendor: "openai",
        capabilities: ["text-generation", "code-generation", "code-analysis", "function-calling", "vision"],
        contextWindow: 128000,
        maxOutputTokens: 16384,
        costPer1kInputTokens: 0.005,
        costPer1kOutputTokens: 0.015,
        latencyMs: { typical: 1500, p95: 5000 },
        qualityScore: 0.95,
        isLocal: false,
        requiresApiKey: true,
        supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
    },
    {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        vendor: "openai",
        capabilities: ["text-generation", "code-generation", "code-analysis", "function-calling"],
        contextWindow: 128000,
        maxOutputTokens: 16384,
        costPer1kInputTokens: 0.00015,
        costPer1kOutputTokens: 0.0006,
        latencyMs: { typical: 800, p95: 2000 },
        qualityScore: 0.85,
        isLocal: false,
        requiresApiKey: true,
        supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
    },
    {
        id: "o3",
        name: "o3",
        vendor: "openai",
        capabilities: ["text-generation", "code-generation", "code-analysis"],
        contextWindow: 200000,
        maxOutputTokens: 100000,
        costPer1kInputTokens: 0.01,
        costPer1kOutputTokens: 0.04,
        latencyMs: { typical: 2000, p95: 6000 },
        qualityScore: 0.97,
        isLocal: false,
        requiresApiKey: true,
        supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
    },
];

// =============================================================================
// Google Models
// =============================================================================

export const GOOGLE_MODELS: ModelConfig[] = [
    {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro",
        vendor: "google",
        capabilities: ["text-generation", "code-generation", "code-analysis", "function-calling", "vision", "streaming"],
        contextWindow: 1000000,
        maxOutputTokens: 64000,
        costPer1kInputTokens: 0.002, // From documentation ($2 per 1M)
        costPer1kOutputTokens: 0.012, // From documentation ($12 per 1M)
        latencyMs: { typical: 1500, p95: 5000 },
        qualityScore: 0.98,
        isLocal: false,
        requiresApiKey: true,
        supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
    },
    {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash",
        vendor: "google",
        capabilities: ["text-generation", "code-generation", "code-analysis", "function-calling", "vision", "streaming"],
        contextWindow: 1000000,
        maxOutputTokens: 64000,
        costPer1kInputTokens: 0.0005, // From documentation ($0.50 per 1M)
        costPer1kOutputTokens: 0.003, // From documentation ($3 per 1M)
        latencyMs: { typical: 600, p95: 1500 },
        qualityScore: 0.92,
        isLocal: false,
        requiresApiKey: true,
        supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
    },
    {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        vendor: "google",
        capabilities: ["text-generation", "code-generation", "code-analysis", "function-calling", "vision"],
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        costPer1kInputTokens: 0.00125,
        costPer1kOutputTokens: 0.005,
        latencyMs: { typical: 1000, p95: 3000 },
        qualityScore: 0.9,
        isLocal: false,
        requiresApiKey: true,
        supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
    },
    {
        id: "gemini-1.5-flash",
        name: "Gemini 1.5 Flash",
        vendor: "google",
        capabilities: ["text-generation", "code-generation", "code-analysis"],
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        costPer1kInputTokens: 0.000075,
        costPer1kOutputTokens: 0.0003,
        latencyMs: { typical: 400, p95: 1000 },
        qualityScore: 0.8,
        isLocal: false,
        requiresApiKey: true,
        supportedTasks: ["classification", "extraction", "summarization"],
    },
];

// =============================================================================
// Local Models
// =============================================================================

export const LOCAL_MODELS: ModelConfig[] = [
    {
        id: "qwen2.5-coder-0.5b",
        name: "Qwen 2.5 Coder 0.5B",
        vendor: "local",
        capabilities: ["text-generation", "code-generation", "code-analysis"],
        contextWindow: 32768,
        maxOutputTokens: 8192,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
        latencyMs: { typical: 500, p95: 1000 },
        qualityScore: 0.5,
        isLocal: true,
        requiresApiKey: false,
        supportedTasks: ["classification", "extraction"],
    },
    {
        id: "qwen2.5-coder-1.5b",
        name: "Qwen 2.5 Coder 1.5B",
        vendor: "local",
        capabilities: ["text-generation", "code-generation", "code-analysis"],
        contextWindow: 32768,
        maxOutputTokens: 8192,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
        latencyMs: { typical: 800, p95: 1500 },
        qualityScore: 0.6,
        isLocal: true,
        requiresApiKey: false,
        supportedTasks: ["classification", "extraction", "summarization"],
    },
    {
        id: "qwen2.5-coder-3b",
        name: "Qwen 2.5 Coder 3B",
        vendor: "local",
        capabilities: ["text-generation", "code-generation", "code-analysis"],
        contextWindow: 32768,
        maxOutputTokens: 8192,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
        latencyMs: { typical: 1200, p95: 2500 },
        qualityScore: 0.7,
        isLocal: true,
        requiresApiKey: false,
        supportedTasks: ["justification", "classification", "extraction", "summarization"],
    },
    {
        id: "qwen2.5-coder-7b",
        name: "Qwen 2.5 Coder 7B",
        vendor: "local",
        capabilities: ["text-generation", "code-generation", "code-analysis"],
        contextWindow: 32768,
        maxOutputTokens: 8192,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
        latencyMs: { typical: 2000, p95: 4000 },
        qualityScore: 0.8,
        isLocal: true,
        requiresApiKey: false,
        supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
    },
];

export const ALL_MODELS: ModelConfig[] = [
    ...LOCAL_MODELS,
    ...OPENAI_MODELS,
    ...ANTHROPIC_MODELS,
    ...GOOGLE_MODELS,
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get provider metadata by vendor ID
 */
export function getProviderMetadata(vendorId: string): ProviderMetadata | undefined {
    return PROVIDER_METADATA[vendorId];
}

/**
 * Get all registered provider IDs
 */
export function getAllProviderIds(): string[] {
    return Object.keys(PROVIDER_METADATA);
}

/**
 * Get the default model ID for a provider
 */
export function getDefaultModelId(vendorId: string): string | undefined {
    return PROVIDER_METADATA[vendorId]?.defaultModelId;
}

/**
 * Get the environment variable name for a provider's API key
 */
export function getEnvVarName(vendorId: string): string | null {
    return PROVIDER_METADATA[vendorId]?.envVar ?? null;
}

/**
 * Validate an API key for a specific provider
 */
export function validateApiKey(vendorId: string, apiKey: string): { valid: boolean; message?: string } {
    if (!apiKey || apiKey.trim().length === 0) {
        return { valid: false, message: "API key is required" };
    }

    // Provider-specific validation patterns
    switch (vendorId) {
        case "anthropic":
            if (!apiKey.startsWith("sk-ant-")) {
                return { valid: false, message: "Anthropic API keys start with 'sk-ant-'" };
            }
            break;
        case "openai":
            if (!apiKey.startsWith("sk-")) {
                return { valid: false, message: "OpenAI API keys start with 'sk-'" };
            }
            break;
        case "google":
            // Google API keys don't have a specific prefix pattern
            break;
        case "local":
            // Local models don't require API keys
            return { valid: true };
    }

    return { valid: true };
}

/**
 * Check if a provider requires an API key
 */
export function requiresApiKey(vendorId: string): boolean {
    const metadata = PROVIDER_METADATA[vendorId];
    return metadata !== undefined && metadata.envVar !== null;
}

/**
 * Get a model configuration by ID
 */
export function getModelById(modelId: string): ModelConfig | undefined {
    return ALL_MODELS.find((m) => m.id === modelId);
}

/**
 * Get all models for a specific vendor
 */
export function getModelsByVendor(vendorId: string): ModelConfig[] {
    return ALL_MODELS.filter((m) => m.vendor === vendorId);
}

/**
 * Get cost information for a model
 */
export function getModelCost(modelId: string): { inputCost: number; outputCost: number } | undefined {
    const model = getModelById(modelId);
    if (!model) return undefined;
    return {
        inputCost: model.costPer1kInputTokens,
        outputCost: model.costPer1kOutputTokens,
    };
}

/**
 * Get API key from environment for a provider
 */
export function getApiKeyFromEnv(vendorId: string): string | undefined {
    const envVar = getEnvVarName(vendorId);
    if (envVar) {
        return process.env[envVar];
    }
    return undefined;
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(vendorId: string): string {
    return PROVIDER_METADATA[vendorId]?.name ?? vendorId;
}

// Note: setApiKeyInEnv and createProviderEnableMap have been moved to
// internal/index.ts. Use createConfiguredModelRouter from the public API instead.

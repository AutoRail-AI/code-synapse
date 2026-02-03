/**
 * Internal Model Layer Utilities
 *
 * This module contains internal utilities that should NOT be exported
 * from the public API. These are implementation details used by providers
 * and the router internally.
 *
 * @internal
 */

import { PROVIDER_METADATA } from "../Registry.js";

// =============================================================================
// Internal API Key Management
// =============================================================================

/**
 * Set API key in environment for a provider
 * @internal - Do not use directly, use createConfiguredModelRouter instead
 */
export function setApiKeyInEnv(vendorId: string, apiKey: string): boolean {
    const metadata = PROVIDER_METADATA[vendorId];
    if (metadata?.envVar) {
        process.env[metadata.envVar] = apiKey;
        return true;
    }
    return false;
}

/**
 * Get API key from environment for a provider
 * @internal
 */
export function getApiKeyFromEnv(vendorId: string): string | undefined {
    const metadata = PROVIDER_METADATA[vendorId];
    if (metadata?.envVar) {
        return process.env[metadata.envVar];
    }
    return undefined;
}

// =============================================================================
// Internal Provider Enable Map
// =============================================================================

/**
 * Create a provider enable map for router initialization
 * @internal - Do not use directly, use createConfiguredModelRouter instead
 */
export function createProviderEnableMap(activeProvider: string): {
    enableLocal: boolean;
    enableOpenAI: boolean;
    enableAnthropic: boolean;
    enableGoogle: boolean;
} {
    return {
        enableLocal: activeProvider === "local",
        enableOpenAI: activeProvider === "openai",
        enableAnthropic: activeProvider === "anthropic",
        enableGoogle: activeProvider === "google",
    };
}

// =============================================================================
// LLM Service Factory Type
// =============================================================================

/**
 * Interface for the LLM service used by LocalProvider
 * This is a simplified interface that LocalProvider expects
 * @internal
 */
export interface ILocalLLMService {
    generateText(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string>;
    streamText?(prompt: string, options?: { maxTokens?: number; temperature?: number }): AsyncIterable<string>;
    shutdown?(): Promise<void>;
}

/**
 * Factory function type for creating local LLM services
 * @internal
 */
export type LocalLLMServiceFactory = (modelId: string) => Promise<ILocalLLMService>;

/**
 * Default factory that uses the legacy LLM service
 * This is the bridge between the new model layer and legacy llm layer
 * @internal
 */
export async function createDefaultLocalLLMService(modelId: string): Promise<ILocalLLMService> {
    // Dynamic import to avoid circular dependencies
    const { createInitializedLLMService } = await import("../../llm/index.js");
    const service = await createInitializedLLMService({ modelId });

    // Adapt the ILLMService to ILocalLLMService
    return {
        async generateText(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string> {
            const result = await service.infer(prompt, {
                maxTokens: options?.maxTokens,
                temperature: options?.temperature,
            });
            return result.text;
        },
        async shutdown(): Promise<void> {
            await service.shutdown();
        },
    };
}

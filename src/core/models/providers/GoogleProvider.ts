/**
 * Google Gemini Model Provider
 *
 * Provider for Google Gemini models (Gemini 3 Pro, Gemini 3 Flash, etc.)
 * Uses the @google/genai SDK.
 * Requires GOOGLE_API_KEY environment variable.
 */

import { GoogleGenAI } from "@google/genai";
import type {
    IModelProvider,
    ModelConfig,
    ModelRequest,
    ModelResponse,
    StreamChunk,
    ModelVendor,
} from "../interfaces/IModel.js";
import { GOOGLE_MODELS } from "../Registry.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("google-provider");

// =============================================================================
// Google Provider Implementation
// =============================================================================

export class GoogleProvider implements IModelProvider {
    readonly vendorId: ModelVendor = "google";

    private client: GoogleGenAI | null = null;
    private _isAvailable = false;
    private _isReady = false;

    get isAvailable(): boolean {
        return this._isAvailable;
    }

    async initialize(): Promise<void> {
        logger.debug("Initializing Google provider");

        const apiKey = process.env.GOOGLE_API_KEY;

        if (!apiKey) {
            logger.warn("GOOGLE_API_KEY not set, Google models unavailable");
            this._isAvailable = false;
            this._isReady = false;
            return;
        }

        try {
            this.client = new GoogleGenAI({ apiKey });

            // Simple validation by listing models or similar
            // The SDK doesn't have a direct "ping", but we can assume it's ready if key exists
            // For now, let's just mark it as available
            this._isAvailable = true;
            this._isReady = true;
            logger.info("Google provider initialized");
        } catch (error) {
            logger.warn({ error }, "Failed to initialize Google Gemini client");
            this._isAvailable = false;
            this._isReady = false;
        }
    }

    isReady(): boolean {
        return this._isReady;
    }

    getAvailableModels(): ModelConfig[] {
        if (!this._isAvailable) return [];
        return GOOGLE_MODELS;
    }

    getModel(modelId: string): ModelConfig | undefined {
        return GOOGLE_MODELS.find((m) => m.id === modelId);
    }

    async complete(modelId: string, request: ModelRequest): Promise<ModelResponse> {
        if (!this._isReady || !this.client) {
            throw new Error("Google provider not ready");
        }

        const startTime = Date.now();
        const isGemini3 = modelId.startsWith("gemini-3");

        try {
            const config: any = {
                maxOutputTokens: request.parameters?.maxTokens ?? (isGemini3 ? 64000 : 8192),
                temperature: isGemini3 ? 1.0 : (request.parameters?.temperature ?? 0.7),
                stopSequences: request.parameters?.stopSequences,
            };

            if (request.parameters?.thinkingLevel) {
                config.thinkingConfig = {
                    thinkingLevel: request.parameters.thinkingLevel,
                };
            }

            if (request.schema) {
                config.responseMimeType = "application/json";
                config.responseJsonSchema = request.schema;
            }

            // Format prompt
            let fullPrompt = request.prompt;
            if (request.systemPrompt) {
                fullPrompt = `${request.systemPrompt}\n\n${request.prompt}`;
            }

            const response = await this.client.models.generateContent({
                model: modelId,
                contents: fullPrompt,
                config,
            });

            const latencyMs = Date.now() - startTime;
            const text = response.text || "";

            // Estimate usage if not provided (SDK might provide it in metadata)
            const inputTokens = this.estimateTokens(fullPrompt);
            const outputTokens = this.estimateTokens(text);

            // Parse structured output if schema was provided
            let parsed: any = undefined;
            if (request.schema && text) {
                try {
                    parsed = JSON.parse(text);
                } catch (parseError) {
                    logger.warn({ text, error: parseError }, "Failed to parse structured output from Gemini response");
                }
            }

            return {
                content: text,
                finishReason: "stop",
                usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                },
                latencyMs,
                modelId,
                parsed,
            };
        } catch (error) {
            logger.error({ modelId, error }, "Google Gemini completion failed");
            throw error;
        }
    }

    async *stream(modelId: string, request: ModelRequest): AsyncIterable<StreamChunk> {
        if (!this._isReady || !this.client) {
            throw new Error("Google provider not ready");
        }

        const isGemini3 = modelId.startsWith("gemini-3");

        try {
            const config: any = {
                maxOutputTokens: request.parameters?.maxTokens ?? (isGemini3 ? 64000 : 8192),
                temperature: isGemini3 ? 1.0 : (request.parameters?.temperature ?? 0.7),
                stopSequences: request.parameters?.stopSequences,
            };

            if (request.parameters?.thinkingLevel) {
                config.thinkingConfig = {
                    thinkingLevel: request.parameters.thinkingLevel,
                };
            }

            // Format prompt
            let fullPrompt = request.prompt;
            if (request.systemPrompt) {
                fullPrompt = `${request.systemPrompt}\n\n${request.prompt}`;
            }

            const stream = await this.client.models.generateContentStream({
                model: modelId,
                contents: fullPrompt,
                config,
            });

            let totalContent = "";
            for await (const chunk of stream) {
                const text = chunk.text || "";
                totalContent += text;
                yield { content: text, done: false };
            }

            const inputTokens = this.estimateTokens(fullPrompt);
            const outputTokens = this.estimateTokens(totalContent);

            yield {
                content: "",
                done: true,
                usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                },
            };
        } catch (error) {
            logger.error({ modelId, error }, "Google Gemini streaming failed");
            throw error;
        }
    }

    async embed(modelId: string, texts: string[]): Promise<number[][]> {
        if (!this._isReady || !this.client) {
            throw new Error("Google provider not ready");
        }

        // Default embedding model for Google
        const embeddingModel = "text-embedding-004";

        try {
            const results = await Promise.all(
                texts.map((text) =>
                    this.client!.models.embedContent({
                        model: embeddingModel,
                        contents: [{ parts: [{ text }] }],
                    })
                )
            );

            return results.map((r) => r.embeddings?.[0]?.values || []);
        } catch (error) {
            logger.error({ modelId, error }, "Google Gemini embedding failed");
            throw error;
        }
    }

    estimateTokens(text: string): number {
        // Gemini tokenization is roughly 4 characters per token
        return Math.ceil(text.length / 4);
    }

    async shutdown(): Promise<void> {
        this._isReady = false;
        this.client = null;
        logger.info("Google provider shutdown");
    }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createGoogleProvider(): GoogleProvider {
    return new GoogleProvider();
}

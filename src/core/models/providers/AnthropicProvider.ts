/**
 * Anthropic Model Provider
 *
 * Provider for Anthropic models (Claude 3.5 Sonnet, Claude 3 Haiku, etc.)
 * Uses the @anthropic-ai/sdk.
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
    IModelProvider,
    ModelConfig,
    ModelRequest,
    ModelResponse,
    StreamChunk,
    ModelVendor,
} from "../interfaces/IModel.js";
import { ANTHROPIC_MODELS } from "../Registry.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("anthropic-provider");

// =============================================================================
// Anthropic Provider Implementation
// =============================================================================

export class AnthropicProvider implements IModelProvider {
    readonly vendorId: ModelVendor = "anthropic";

    private client: Anthropic | null = null;
    private _isAvailable = false;
    private _isReady = false;

    get isAvailable(): boolean {
        return this._isAvailable;
    }

    async initialize(): Promise<void> {
        logger.debug("Initializing Anthropic provider");

        const apiKey = process.env.ANTHROPIC_API_KEY;

        if (!apiKey) {
            logger.warn("ANTHROPIC_API_KEY not set, Anthropic models unavailable");
            this._isAvailable = false;
            this._isReady = false;
            return;
        }

        try {
            this.client = new Anthropic({
                apiKey,
            });

            this._isAvailable = true;
            this._isReady = true;
            logger.info("Anthropic provider initialized");
        } catch (error) {
            logger.warn({ error }, "Failed to initialize Anthropic client");
            this._isAvailable = false;
            this._isReady = false;
        }
    }

    isReady(): boolean {
        return this._isReady;
    }

    getAvailableModels(): ModelConfig[] {
        if (!this._isAvailable) return [];
        return ANTHROPIC_MODELS;
    }

    getModel(modelId: string): ModelConfig | undefined {
        return ANTHROPIC_MODELS.find((m) => m.id === modelId);
    }

    async complete(modelId: string, request: ModelRequest): Promise<ModelResponse> {
        if (!this._isReady || !this.client) {
            throw new Error("Anthropic provider not ready");
        }

        const startTime = Date.now();

        try {
            const systemPrompt = request.systemPrompt;
            const messages: Anthropic.MessageParam[] = [
                { role: "user", content: request.prompt },
            ];

            // If schema is present, we might want to append instruction, 
            // though the system prompt usually handles this.
            // Anthropic doesn't have a strict 'json_object' mode flag like OpenAI, But we can prefill.
            if (request.schema) {
                // Optionally force JSON by prefilling
                // messages.push({ role: "assistant", content: "{" });
            }

            const response = await this.client.messages.create({
                model: modelId,
                max_tokens: request.parameters?.maxTokens ?? 4096,
                messages,
                system: systemPrompt,
                temperature: request.parameters?.temperature ?? 0.7,
                stop_sequences: request.parameters?.stopSequences,
            });

            const latencyMs = Date.now() - startTime;

            const contentBlock = response.content[0];
            const text = contentBlock?.type === 'text' ? contentBlock.text : "";

            // Estimate tokens
            const inputTokens = response.usage.input_tokens;
            const outputTokens = response.usage.output_tokens;

            return {
                content: text,
                finishReason: this.mapFinishReason(response.stop_reason),
                usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                },
                latencyMs,
                modelId,
            };
        } catch (error) {
            logger.error({ modelId, error }, "Anthropic completion failed");
            throw error;
        }
    }

    async *stream(modelId: string, request: ModelRequest): AsyncIterable<StreamChunk> {
        if (!this._isReady || !this.client) {
            throw new Error("Anthropic provider not ready");
        }

        try {
            const stream = this.client.messages.stream({
                model: modelId,
                max_tokens: request.parameters?.maxTokens ?? 4096,
                messages: [{ role: "user", content: request.prompt }],
                system: request.systemPrompt,
                temperature: request.parameters?.temperature ?? 0.7,
            });

            let totalContent = "";

            for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    const text = chunk.delta.text;
                    totalContent += text;
                    yield { content: text, done: false };
                }
            }

            // Usage is available at the end of the stream in the 'message_stop' event usually,
            // but wrapper might need to await finalMessage()
            const finalMessage = await stream.finalMessage();

            yield {
                content: "",
                done: true,
                usage: {
                    inputTokens: finalMessage.usage.input_tokens,
                    outputTokens: finalMessage.usage.output_tokens,
                    totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens
                }
            };

        } catch (error) {
            logger.error({ modelId, error }, "Anthropic streaming failed");
            throw error;
        }
    }

    async embed(modelId: string, texts: string[]): Promise<number[][]> {
        throw new Error("Embeddings not supported by Anthropic provider");
    }

    estimateTokens(text: string): number {
        // Anthropic tokenization approximation (~4 chars)
        return Math.ceil(text.length / 4);
    }

    async shutdown(): Promise<void> {
        this._isReady = false;
        this.client = null;
        logger.info("Anthropic provider shutdown");
    }

    private mapFinishReason(reason: string | null): ModelResponse["finishReason"] {
        switch (reason) {
            case "end_turn":
                return "stop";
            case "max_tokens":
                return "length";
            case "stop_sequence":
                return "stop";
            case "tool_use":
                return "function_call";
            default:
                return "stop";
        }
    }
}

export function createAnthropicProvider(): AnthropicProvider {
    return new AnthropicProvider();
}

/**
 * OpenAI Model Provider
 *
 * Provider for OpenAI models (GPT-4o, GPT-4o-mini, etc.)
 * Requires OPENAI_API_KEY environment variable.
 */

import type {
  IModelProvider,
  ModelConfig,
  ModelRequest,
  ModelResponse,
  StreamChunk,
  ModelVendor,
} from "../interfaces/IModel.js";
import { OPENAI_MODELS } from "../interfaces/IModel.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("openai-provider");

// =============================================================================
// OpenAI Provider Implementation
// =============================================================================

export class OpenAIProvider implements IModelProvider {
  readonly vendorId: ModelVendor = "openai";

  private apiKey: string | null = null;
  private baseUrl = "https://api.openai.com/v1";
  private _isAvailable = false;
  private _isReady = false;

  get isAvailable(): boolean {
    return this._isAvailable;
  }

  async initialize(): Promise<void> {
    logger.debug("Initializing OpenAI provider");

    this.apiKey = process.env.OPENAI_API_KEY ?? null;

    if (!this.apiKey) {
      logger.warn("OPENAI_API_KEY not set, OpenAI models unavailable");
      this._isAvailable = false;
      this._isReady = false;
      return;
    }

    // Verify API key with a simple request
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (response.ok) {
        this._isAvailable = true;
        this._isReady = true;
        logger.info("OpenAI provider initialized");
      } else {
        logger.warn({ status: response.status }, "OpenAI API key validation failed");
        this._isAvailable = false;
        this._isReady = false;
      }
    } catch (error) {
      logger.warn({ error }, "Failed to verify OpenAI API key");
      this._isAvailable = false;
      this._isReady = false;
    }
  }

  isReady(): boolean {
    return this._isReady;
  }

  getAvailableModels(): ModelConfig[] {
    if (!this._isAvailable) return [];
    return OPENAI_MODELS;
  }

  getModel(modelId: string): ModelConfig | undefined {
    return OPENAI_MODELS.find((m) => m.id === modelId);
  }

  async complete(modelId: string, request: ModelRequest): Promise<ModelResponse> {
    if (!this._isReady || !this.apiKey) {
      throw new Error("OpenAI provider not ready");
    }

    const startTime = Date.now();

    const messages: Array<{ role: string; content: string }> = [];

    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: request.prompt });

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      max_tokens: request.parameters?.maxTokens ?? 4096,
      temperature: request.parameters?.temperature ?? 0.7,
    };

    if (request.parameters?.topP !== undefined) {
      body.top_p = request.parameters.topP;
    }
    if (request.parameters?.frequencyPenalty !== undefined) {
      body.frequency_penalty = request.parameters.frequencyPenalty;
    }
    if (request.parameters?.presencePenalty !== undefined) {
      body.presence_penalty = request.parameters.presencePenalty;
    }
    if (request.parameters?.stopSequences) {
      body.stop = request.parameters.stopSequences;
    }

    // Function calling
    if (request.functions && request.functions.length > 0) {
      body.functions = request.functions;
      body.function_call = "auto";
    }

    // JSON mode for structured output
    if (request.schema) {
      body.response_format = { type: "json_object" };
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as {
        choices: Array<{
          message: { content: string | null; function_call?: { name: string; arguments: string } };
          finish_reason: string;
        }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      const latencyMs = Date.now() - startTime;
      const choice = data.choices[0]!;

      return {
        content: choice.message.content ?? "",
        finishReason: this.mapFinishReason(choice.finish_reason),
        usage: {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        },
        latencyMs,
        modelId,
        functionCall: choice.message.function_call,
      };
    } catch (error) {
      logger.error({ modelId, error }, "OpenAI completion failed");
      throw error;
    }
  }

  async *stream(modelId: string, request: ModelRequest): AsyncIterable<StreamChunk> {
    if (!this._isReady || !this.apiKey) {
      throw new Error("OpenAI provider not ready");
    }

    const messages: Array<{ role: string; content: string }> = [];

    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: request.prompt });

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      max_tokens: request.parameters?.maxTokens ?? 4096,
      temperature: request.parameters?.temperature ?? 0.7,
      stream: true,
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let totalContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              // Estimate tokens
              const inputTokens = Math.ceil((request.prompt.length + (request.systemPrompt?.length ?? 0)) / 4);
              const outputTokens = Math.ceil(totalContent.length / 4);

              yield {
                content: "",
                done: true,
                usage: {
                  inputTokens,
                  outputTokens,
                  totalTokens: inputTokens + outputTokens,
                },
              };
              return;
            }

            try {
              const parsed = JSON.parse(data) as {
                choices: Array<{ delta: { content?: string } }>;
              };
              const content = parsed.choices[0]?.delta?.content ?? "";
              if (content) {
                totalContent += content;
                yield { content, done: false };
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      logger.error({ modelId, error }, "OpenAI streaming failed");
      throw error;
    }
  }

  async embed(modelId: string, texts: string[]): Promise<number[][]> {
    if (!this._isReady || !this.apiKey) {
      throw new Error("OpenAI provider not ready");
    }

    // Use text-embedding-3-small by default
    const embeddingModel = "text-embedding-3-small";

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: embeddingModel,
          input: texts,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
      };

      return data.data.map((d) => d.embedding);
    } catch (error) {
      logger.error({ modelId, error }, "OpenAI embedding failed");
      throw error;
    }
  }

  estimateTokens(text: string): number {
    // GPT tokenization is roughly 4 characters per token
    return Math.ceil(text.length / 4);
  }

  async shutdown(): Promise<void> {
    this._isReady = false;
    logger.info("OpenAI provider shutdown");
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private mapFinishReason(reason: string): ModelResponse["finishReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "function_call":
        return "function_call";
      case "content_filter":
        return "content_filter";
      default:
        return "stop";
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createOpenAIProvider(): OpenAIProvider {
  return new OpenAIProvider();
}

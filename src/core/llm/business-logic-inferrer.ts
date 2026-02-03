/**
 * Business Logic Inferrer
 *
 * Uses local LLM to infer business intent and generate summaries for code entities.
 * Optimized for Qwen 2.5 Coder models.
 *
 * @module
 */

import { createLogger } from "../../utils/logger.js";
import type { JsonSchema } from "./llm-service.js";
import type { ILLMService } from "./interfaces/ILLMService.js";

const logger = createLogger("business-logic-inferrer");

// =============================================================================
// Types
// =============================================================================

export interface FunctionContext {
  /** Function name */
  name: string;
  /** Function signature */
  signature: string;
  /** Function body (may be truncated) */
  body: string;
  /** JSDoc comment if present */
  docComment?: string;
  /** File path */
  filePath: string;
  /** Class name if method */
  className?: string;
  /** Parameter names */
  parameterNames?: string[];
  /** Return type */
  returnType?: string;
}

export interface InferenceOutput {
  /** One-line summary of what the function does */
  summary: string;
  /** Business logic tags for categorization */
  tags: string[];
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** Inferred business domain */
  domain?: string;
  /** Side effects detected */
  sideEffects?: string[];
}

export interface InferredBusinessLogic {
  /** Raw LLM output */
  raw: string;
  /** Cleaned and parsed output */
  output: InferenceOutput;
  /** Whether cleaning was needed */
  wasCleaned: boolean;
  /** Source of the result */
  source: "llm" | "cache" | "fallback";
  /** Inference duration in ms */
  durationMs: number;
}

export interface BusinessLogicInferrerConfig {
  /** Maximum body length to include in prompt (default: 1500) */
  maxBodyLength?: number;
  /** Minimum confidence threshold (default: 0.3) */
  minConfidence?: number;
  /** Temperature for inference (default: 0.3 for consistency) */
  temperature?: number;
  /** Maximum retries on parse failure (default: 2) */
  maxRetries?: number;
}

// =============================================================================
// JSON Schema for Structured Output
// =============================================================================

const INFERENCE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
    },
    tags: {
      type: "array",
      items: { type: "string" },
    },
    confidence: {
      type: "number",
    },
    domain: {
      type: "string",
    },
    sideEffects: {
      type: "array",
      items: { type: "string" },
    },
  },
};

// =============================================================================
// Prompt Templates
// =============================================================================

const SYSTEM_PROMPT = `You are a code analysis assistant. Your task is to analyze TypeScript/JavaScript functions and describe their business purpose.

Rules:
1. Focus on WHAT the function does from a business perspective, not HOW it's implemented
2. Use clear, concise language
3. Tags should be lowercase, hyphenated (e.g., "user-authentication", "data-validation")
4. Confidence should reflect how certain you are about the function's purpose
5. Domain should describe the business area (e.g., "payments", "user-management")
6. Side effects should list external interactions (e.g., "database-write", "api-call")

Respond with valid JSON only.`;

function createFunctionPrompt(ctx: FunctionContext): string {
  const parts: string[] = [];

  parts.push(`Analyze this function and describe its business purpose:\n`);

  // Add context
  if (ctx.className) {
    parts.push(`Class: ${ctx.className}`);
  }
  parts.push(`Function: ${ctx.name}`);
  parts.push(`File: ${ctx.filePath}`);

  if (ctx.docComment) {
    parts.push(`\nDocumentation:\n${ctx.docComment}`);
  }

  parts.push(`\nSignature:\n${ctx.signature}`);

  if (ctx.body) {
    parts.push(`\nBody:\n${ctx.body}`);
  }

  parts.push(`\nProvide your analysis as JSON with: summary, tags, confidence, domain, sideEffects`);

  return parts.join("\n");
}

// =============================================================================
// Output Cleaning
// =============================================================================

/**
 * Clean common LLM output artifacts
 */
function cleanOutput(raw: string): string {
  let cleaned = raw;

  // Remove common preambles
  const preamblePatterns = [
    /^(Sure|Here|Okay|The function|This function|Based on|Looking at|After analyzing)[^{]*[.:]\s*/gi,
    /^["'`]+/,
    /["'`]+$/,
    /^```json\s*/i,
    /\s*```$/,
  ];

  for (const pattern of preamblePatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  // Trim whitespace
  cleaned = cleaned.trim();

  // Try to extract JSON if wrapped in other text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  return cleaned;
}

/**
 * Calculate confidence based on cleaning and content
 */
function calculateAdjustedConfidence(
  raw: string,
  cleaned: string,
  parsedConfidence: number
): number {
  let adjustment = 0;

  // Penalize if heavy cleaning was needed
  if (cleaned.length / raw.length < 0.6) {
    adjustment -= 0.2;
  } else if (cleaned !== raw.trim()) {
    adjustment -= 0.1;
  }

  // Penalize very short summaries
  if (cleaned.length < 30) {
    adjustment -= 0.2;
  }

  // Boost if no cleaning needed
  if (cleaned === raw.trim()) {
    adjustment += 0.1;
  }

  return Math.max(0, Math.min(1, parsedConfidence + adjustment));
}

/**
 * Validate and fix parsed output
 */
function validateOutput(parsed: unknown): InferenceOutput {
  const obj = parsed as Record<string, unknown>;

  // Ensure summary exists and is a string
  let summary = String(obj.summary || "Unknown function purpose");
  if (summary.length > 200) {
    summary = summary.substring(0, 197) + "...";
  }

  // Ensure tags is an array of strings
  let tags: string[] = [];
  if (Array.isArray(obj.tags)) {
    tags = obj.tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.toLowerCase().replace(/\s+/g, "-"))
      .slice(0, 10);
  }

  // Ensure confidence is a number between 0 and 1
  let confidence = 0.5;
  if (typeof obj.confidence === "number") {
    confidence = Math.max(0, Math.min(1, obj.confidence));
  }

  // Optional domain
  const domain = typeof obj.domain === "string" ? obj.domain : undefined;

  // Optional side effects
  let sideEffects: string[] | undefined;
  if (Array.isArray(obj.sideEffects)) {
    sideEffects = obj.sideEffects
      .filter((s): s is string => typeof s === "string")
      .slice(0, 5);
  }

  return {
    summary,
    tags,
    confidence,
    domain,
    sideEffects,
  };
}

/**
 * Generate fallback output when inference fails
 */
function generateFallback(ctx: FunctionContext): InferenceOutput {
  const summary = ctx.docComment
    ? extractFirstSentence(ctx.docComment)
    : `${ctx.className ? `Method ${ctx.name} of ${ctx.className}` : `Function ${ctx.name}`}`;

  // Infer basic tags from name
  const tags: string[] = [];
  const nameLower = ctx.name.toLowerCase();

  if (nameLower.startsWith("get") || nameLower.startsWith("fetch")) {
    tags.push("data-retrieval");
  }
  if (nameLower.startsWith("set") || nameLower.startsWith("update")) {
    tags.push("data-mutation");
  }
  if (nameLower.startsWith("is") || nameLower.startsWith("has") || nameLower.startsWith("can")) {
    tags.push("predicate");
  }
  if (nameLower.includes("valid")) {
    tags.push("validation");
  }
  if (nameLower.includes("auth")) {
    tags.push("authentication");
  }
  if (nameLower.includes("handle") || nameLower.includes("process")) {
    tags.push("handler");
  }

  if (tags.length === 0) {
    tags.push("utility");
  }

  return {
    summary,
    tags,
    confidence: 0.2, // Low confidence for fallback
  };
}

function extractFirstSentence(text: string): string {
  // Remove JSDoc markers
  const cleaned = text
    .replace(/^\/\*\*\s*/g, "")
    .replace(/\s*\*\/$/g, "")
    .replace(/^\s*\*\s*/gm, "")
    .trim();

  // Get first sentence
  const match = cleaned.match(/^[^.!?]+[.!?]?/);
  return match ? match[0].trim() : cleaned.substring(0, 100);
}

// =============================================================================
// Business Logic Inferrer
// =============================================================================

export class BusinessLogicInferrer {
  private llmService: ILLMService;
  private config: Required<BusinessLogicInferrerConfig>;

  constructor(llmService: ILLMService, config: BusinessLogicInferrerConfig = {}) {
    this.llmService = llmService;
    this.config = {
      maxBodyLength: config.maxBodyLength ?? 1500,
      minConfidence: config.minConfidence ?? 0.3,
      temperature: config.temperature ?? 0.3,
      maxRetries: config.maxRetries ?? 2,
    };
  }

  /**
   * Infer business logic for a function
   */
  async inferFunction(ctx: FunctionContext): Promise<InferredBusinessLogic> {
    const startTime = Date.now();

    // Truncate body if too long
    const truncatedBody =
      ctx.body.length > this.config.maxBodyLength
        ? ctx.body.substring(0, this.config.maxBodyLength) + "\n// ... (truncated)"
        : ctx.body;

    const contextWithTruncatedBody = { ...ctx, body: truncatedBody };

    // Check if LLM service is ready
    if (!this.llmService.isReady) {
      logger.warn("LLM service not ready, using fallback");
      return {
        raw: "",
        output: generateFallback(ctx),
        wasCleaned: false,
        source: "fallback",
        durationMs: Date.now() - startTime,
      };
    }

    // Try inference with retries
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await this.tryInference(contextWithTruncatedBody, attempt > 0);

        return {
          ...result,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.debug({ error, attempt }, "Inference attempt failed");
      }
    }

    // All retries failed, use fallback
    logger.warn({ error: lastError, functionName: ctx.name }, "All inference attempts failed, using fallback");
    return {
      raw: "",
      output: generateFallback(ctx),
      wasCleaned: false,
      source: "fallback",
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Try a single inference attempt
   */
  private async tryInference(
    ctx: FunctionContext,
    skipCache: boolean
  ): Promise<Omit<InferredBusinessLogic, "durationMs">> {
    const prompt = `${SYSTEM_PROMPT}\n\n${createFunctionPrompt(ctx)}`;

    const result = await this.llmService.infer(prompt, {
      maxTokens: 256,
      temperature: this.config.temperature,
      jsonSchema: INFERENCE_SCHEMA,
      skipCache,
    });

    // Clean the output
    const cleaned = cleanOutput(result.text);
    const wasCleaned = cleaned !== result.text.trim();

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = result.parsed ?? JSON.parse(cleaned);
    } catch (_parseError) {
      throw new Error(`Failed to parse inference output: ${cleaned}`);
    }

    // Validate and normalize output
    const output = validateOutput(parsed);

    // Adjust confidence based on cleaning
    output.confidence = calculateAdjustedConfidence(
      result.text,
      cleaned,
      output.confidence
    );

    return {
      raw: result.text,
      output,
      wasCleaned,
      source: result.fromCache ? "cache" : "llm",
    };
  }

  /**
   * Infer business logic for multiple functions in batch
   */
  async inferBatch(
    contexts: FunctionContext[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, InferredBusinessLogic>> {
    const results = new Map<string, InferredBusinessLogic>();
    const total = contexts.length;

    for (let i = 0; i < contexts.length; i++) {
      const ctx = contexts[i]!;
      const key = `${ctx.filePath}:${ctx.className ?? ""}:${ctx.name}`;

      try {
        const result = await this.inferFunction(ctx);
        results.set(key, result);
      } catch (error) {
        logger.error({ error, key }, "Failed to infer business logic");
        results.set(key, {
          raw: "",
          output: generateFallback(ctx),
          wasCleaned: false,
          source: "fallback",
          durationMs: 0,
        });
      }

      onProgress?.(i + 1, total);
    }

    return results;
  }

  /**
   * Get inference statistics
   */
  getStats(): {
    llmStats: ReturnType<ILLMService["getStats"]>;
    config: Required<BusinessLogicInferrerConfig>;
  } {
    return {
      llmStats: this.llmService.getStats(),
      config: this.config,
    };
  }
}

/**
 * Create a business logic inferrer
 */
export function createBusinessLogicInferrer(
  llmService: ILLMService,
  config?: BusinessLogicInferrerConfig
): BusinessLogicInferrer {
  return new BusinessLogicInferrer(llmService, config);
}

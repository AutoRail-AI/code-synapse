/**
 * Dynamic Batcher for LLM Inference
 *
 * Token-based batching system that:
 * - Ignores entity/file count limits entirely
 * - Batches based on BOTH input AND output token budgets
 * - Maximizes LLM context utilization without overflow
 * - Ensures model can generate complete responses for all entities
 *
 * Uses greedy sequential packing algorithm to fit as many
 * entities as possible within BOTH:
 * 1. Input token budget (prompt size)
 * 2. Output token budget (response size = entities × tokens_per_entity)
 *
 * The batch size is limited by whichever constraint is tighter.
 *
 * @module
 */

import { createLogger } from "../../../utils/logger.js";
import type { BatchEntityInput } from "../prompts/justification-prompts.js";
import { getModelConfig } from "../../llm/model-configs.js";

const logger = createLogger("dynamic-batcher");

// =============================================================================
// Token Estimation
// =============================================================================

/**
 * Estimate token count for a string using character-based heuristic
 *
 * For code, we use ~3.5 characters per token (more conservative than
 * English text ~4 chars/token due to special symbols and short identifiers)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

/**
 * Estimate token count for an entity in batch prompt format
 *
 * This estimates the INPUT tokens needed to represent this entity
 * in the batch prompt sent to the LLM.
 */
export function estimateEntityTokens(entity: BatchEntityInput): number {
  let tokens = 0;

  // Entity header (markdown formatting)
  // "## Entity N (ID: xxx)\n- **Name**: `name`\n- **Type**: type\n- **File**: `path`"
  tokens += 25;

  // Name, type, file path
  tokens += estimateTokens(entity.name);
  tokens += estimateTokens(entity.type);
  tokens += estimateTokens(entity.filePath);
  tokens += 20; // Labels: "- **Name**:", "- **Type**:", "- **File**:"

  // Signature if present
  if (entity.signature) {
    tokens += estimateTokens(entity.signature);
    tokens += 15; // "- **Signature**: `...`"
  }

  // Doc comment (first line only in batch mode)
  if (entity.docComment) {
    const firstLine = entity.docComment.split("\n")[0] || "";
    tokens += estimateTokens(firstLine);
    tokens += 12; // "- **Doc**: ..."
  }

  // Code snippet (truncated to 10 lines in batch prompt)
  if (entity.codeSnippet) {
    const lines = entity.codeSnippet.split("\n");
    const truncatedCode = lines.slice(0, 10).join("\n");
    tokens += estimateTokens(truncatedCode);
    tokens += 8; // "```\n...\n```"

    // Add indicator if truncated
    if (lines.length > 10) {
      tokens += 15; // "... (N more lines)"
    }
  }

  return tokens;
}

/**
 * Estimate total input tokens for a batch of entities
 */
export function estimateBatchInputTokens(
  entities: BatchEntityInput[],
  systemPromptTokens: number = 500
): number {
  // System prompt
  let tokens = systemPromptTokens;

  // Batch header
  // "# Batch Analysis Request\nAnalyze these N code entities...\n"
  tokens += 30;

  // Each entity
  for (const entity of entities) {
    tokens += estimateEntityTokens(entity);
  }

  // Footer
  // "## Your Task\nAnalyze all N entities above and output a JSON array..."
  tokens += 40;

  return tokens;
}

// =============================================================================
// Batch Configuration
// =============================================================================

export interface TokenBatchConfig {
  /** Maximum context window in tokens (model's total capacity) */
  maxContextTokens: number;
  /** Maximum output tokens the model can generate */
  maxOutputTokens: number;
  /** Tokens reserved for system prompt */
  systemPromptTokens: number;
  /** Estimated tokens per entity in the output response */
  outputTokensPerEntity: number;
  /** Safety margin percentage (0.10 = 10%, 0.15 = 15%) */
  safetyMargin: number;
  /** Maximum number of entities per batch (hard limit) */
  maxEntitiesPerBatch: number;
}

/**
 * Default configuration for unknown models (conservative)
 */
export const DEFAULT_TOKEN_BATCH_CONFIG: TokenBatchConfig = {
  maxContextTokens: 4096,
  maxOutputTokens: 2048,
  systemPromptTokens: 500,
  outputTokensPerEntity: 500, // Conservative estimate to prevent truncation
  safetyMargin: 0.80,
  maxEntitiesPerBatch: 25, // Safe default hard limit
};

/**
 * Get token batch config for a specific model
 */
export function getTokenBatchConfig(
  modelId: string,
  overrides?: Partial<TokenBatchConfig>
): TokenBatchConfig {
  const modelConfig = getModelConfig(modelId);

  if (!modelConfig) {
    logger.warn({ modelId }, "Unknown model, using default token batch config");
    return { ...DEFAULT_TOKEN_BATCH_CONFIG, ...overrides };
  }

  const config: TokenBatchConfig = {
    // Reduce capacity to 50% to prevent timeouts and truncation
    maxContextTokens: Math.floor(modelConfig.contextWindow * 0.5),
    maxOutputTokens: Math.floor(modelConfig.maxOutputTokens * 0.5),
    systemPromptTokens: 500,
    outputTokensPerEntity: 500,
    safetyMargin: 0.80, // Increased to 80% as requested by user
    maxEntitiesPerBatch: 25, // Hard limit to prevent massive batches
  };

  logger.debug(
    {
      modelId,
      maxContextTokens: config.maxContextTokens,
      maxOutputTokens: config.maxOutputTokens,
      safetyMargin: config.safetyMargin,
      provider: modelConfig.provider,
    },
    "Loaded token batch config"
  );

  return { ...config, ...overrides };
}

// =============================================================================
// Token Budget Calculator
// =============================================================================

export interface TokenBudget {
  /** Maximum input tokens available for the prompt */
  maxInputTokens: number;
  /** Maximum output tokens available for response */
  maxOutputTokens: number;
  /** Total context available (input + output) */
  totalContextTokens: number;
}

/**
 * Calculate the available token budget for batching
 *
 * The key insight: we need to balance input vs output tokens.
 * - Input: system prompt + entity descriptions
 * - Output: JSON array with justifications
 *
 * We reserve output budget based on the model's max output capacity,
 * then allocate remaining context to input.
 */
export function calculateTokenBudget(config: TokenBatchConfig): TokenBudget {
  const safetyMultiplier = 1 - config.safetyMargin;

  // Reserve output budget (with safety margin)
  const reservedOutputTokens = Math.floor(config.maxOutputTokens * safetyMultiplier);

  // Calculate available input tokens
  // Total context - system prompt - reserved output - safety buffer
  const availableForInput = config.maxContextTokens - config.systemPromptTokens - reservedOutputTokens;
  const maxInputTokens = Math.floor(availableForInput * safetyMultiplier);

  return {
    maxInputTokens: Math.max(1000, maxInputTokens), // Minimum 1000 tokens
    maxOutputTokens: reservedOutputTokens,
    totalContextTokens: config.maxContextTokens,
  };
}

// =============================================================================
// Batch Result Types
// =============================================================================

export interface Batch {
  /** Entities in this batch */
  entities: BatchEntityInput[];
  /** Estimated input tokens for this batch */
  inputTokens: number;
  /** Estimated output tokens for this batch */
  outputTokens: number;
  /** Total estimated tokens (input + output) */
  totalTokens: number;
  /** Batch index (0-based) */
  batchIndex: number;
}

export interface BatchingResult {
  /** All created batches */
  batches: Batch[];
  /** Total entities processed */
  totalEntities: number;
  /** Number of batches created */
  totalBatches: number;
  /** Average entities per batch */
  averageBatchSize: number;
  /** Total input tokens across all batches */
  totalInputTokens: number;
  /** Total output tokens across all batches */
  totalOutputTokens: number;
  /** Token budget used for batching */
  tokenBudget: TokenBudget;
  /** Entities that exceeded single-batch token limit */
  oversizedEntities: string[];
}

// =============================================================================
// Token-Based Dynamic Batcher
// =============================================================================

/**
 * Token-based dynamic batcher using greedy sequential packing
 *
 * Algorithm:
 * 1. Calculate token budgets based on model config:
 *    - Input budget: context_window - system_prompt - output_reserve
 *    - Output budget: max_output_tokens × safety_margin
 *    - Max entities by output: output_budget / tokens_per_entity
 * 2. For each entity (in stable order):
 *    - Estimate entity's input tokens
 *    - If entity alone exceeds input budget: log warning, process alone
 *    - If adding entity exceeds input OR output budget: emit batch, start new
 *    - Otherwise: add entity to current batch
 * 3. Emit final batch (even if partial)
 *
 * Key properties:
 * - NO arbitrary entity count limits
 * - Dual-constrained: respects BOTH input AND output token limits
 * - Deterministic ordering (stable, reproducible batches)
 * - Maximum context utilization within safe bounds
 * - Batch size limited by whichever constraint is tighter
 */
export class TokenBasedBatcher {
  private config: TokenBatchConfig;
  private budget: TokenBudget;

  constructor(config: TokenBatchConfig) {
    this.config = config;
    this.budget = calculateTokenBudget(config);
  }

  /**
   * Get the token budget being used
   */
  getTokenBudget(): TokenBudget {
    return this.budget;
  }

  /**
   * Create batches from entities using greedy token packing
   *
   * Considers BOTH input token limits AND output token limits to ensure
   * the model can generate complete responses for all entities in the batch.
   *
   * @param entities - Entities to batch (order is preserved)
   * @returns Batching result with all batches
   */
  createBatches(entities: BatchEntityInput[]): BatchingResult {
    const batches: Batch[] = [];
    let currentBatch: BatchEntityInput[] = [];
    let currentInputTokens = 0;
    let batchIndex = 0;
    const oversizedEntities: string[] = [];

    const maxInputTokens = this.budget.maxInputTokens;
    const maxOutputTokens = this.budget.maxOutputTokens;
    const basePromptTokens = this.config.systemPromptTokens + 70; // System + batch header/footer

    // Calculate max entities based on output token budget
    // Each entity needs ~outputTokensPerEntity tokens in the response
    const maxEntitiesPerBatchByOutput = Math.floor(
      maxOutputTokens / this.config.outputTokensPerEntity
    );

    logger.debug(
      {
        totalEntities: entities.length,
        maxInputTokens,
        maxOutputTokens,
        outputTokensPerEntity: this.config.outputTokensPerEntity,
        maxEntitiesPerBatchByOutput,
        totalContextTokens: this.budget.totalContextTokens,
        safetyMargin: `${this.config.safetyMargin * 100}%`,
      },
      "Starting token-based batching (input + output constrained)"
    );

    for (const entity of entities) {
      const entityTokens = estimateEntityTokens(entity);

      // Check if single entity exceeds input budget
      if (entityTokens + basePromptTokens > maxInputTokens) {
        logger.warn(
          {
            entityId: entity.id,
            entityName: entity.name,
            entityTokens,
            maxInputTokens,
          },
          "Entity exceeds input token budget, will be processed alone"
        );
        oversizedEntities.push(entity.id);

        // Emit current batch first if not empty
        if (currentBatch.length > 0) {
          batches.push(this.createBatchObject(currentBatch, currentInputTokens, batchIndex++));
          currentBatch = [];
          currentInputTokens = 0;
        }

        // Create single-entity batch for oversized entity
        batches.push(this.createBatchObject([entity], entityTokens, batchIndex++));
        continue;
      }

      // Check if adding this entity would exceed input OR output budget
      const tokensAfterAdd = currentInputTokens + entityTokens + basePromptTokens;
      const entitiesAfterAdd = currentBatch.length + 1;

      const exceedsInputBudget = tokensAfterAdd > maxInputTokens;
      const exceedsOutputBudget = entitiesAfterAdd > maxEntitiesPerBatchByOutput;
      const exceedsHardLimit = entitiesAfterAdd > this.config.maxEntitiesPerBatch;

      if (currentBatch.length > 0 && (exceedsInputBudget || exceedsOutputBudget || exceedsHardLimit)) {
        // Log why we're emitting the batch
        if (exceedsHardLimit && !exceedsInputBudget && !exceedsOutputBudget) {
          logger.debug(
            {
              currentEntities: currentBatch.length,
              hardLimit: this.config.maxEntitiesPerBatch,
              currentInputTokens,
            },
            "Batch limited by hard entity count cap"
          );
        } else if (exceedsOutputBudget && !exceedsInputBudget) {
          logger.debug(
            {
              currentEntities: currentBatch.length,
              maxEntitiesPerBatchByOutput,
              currentInputTokens,
              maxInputTokens,
            },
            "Batch limited by output token budget"
          );
        }

        // Emit current batch
        batches.push(this.createBatchObject(currentBatch, currentInputTokens, batchIndex++));
        currentBatch = [];
        currentInputTokens = 0;
      }

      // Add entity to current batch
      currentBatch.push(entity);
      currentInputTokens += entityTokens;
    }

    // Emit final batch if not empty
    if (currentBatch.length > 0) {
      batches.push(this.createBatchObject(currentBatch, currentInputTokens, batchIndex));
    }

    const result: BatchingResult = {
      batches,
      totalEntities: entities.length,
      totalBatches: batches.length,
      averageBatchSize: entities.length > 0 ? entities.length / Math.max(1, batches.length) : 0,
      totalInputTokens: batches.reduce((sum, b) => sum + b.inputTokens, 0),
      totalOutputTokens: batches.reduce((sum, b) => sum + b.outputTokens, 0),
      tokenBudget: this.budget,
      oversizedEntities,
    };

    // Calculate utilization percentages for both input and output
    const inputUtilization = (result.totalInputTokens / (result.totalBatches * maxInputTokens)) * 100;
    const outputUtilization = (result.totalOutputTokens / (result.totalBatches * maxOutputTokens)) * 100;
    const limitingFactor = outputUtilization > inputUtilization ? "output" : "input";

    logger.debug(
      {
        totalEntities: result.totalEntities,
        totalBatches: result.totalBatches,
        averageBatchSize: result.averageBatchSize.toFixed(1),
        maxEntitiesPerBatchByOutput,
        totalInputTokens: result.totalInputTokens,
        totalOutputTokens: result.totalOutputTokens,
        oversizedCount: oversizedEntities.length,
        inputUtilizationPercent: `${inputUtilization.toFixed(1)}%`,
        outputUtilizationPercent: `${outputUtilization.toFixed(1)}%`,
        limitingFactor,
      },
      "Token-based batching complete"
    );

    return result;
  }

  /**
   * Create a batch object with token calculations
   */
  private createBatchObject(
    entities: BatchEntityInput[],
    inputTokens: number,
    batchIndex: number
  ): Batch {
    const outputTokens = entities.length * this.config.outputTokensPerEntity;

    return {
      entities,
      inputTokens: inputTokens + this.config.systemPromptTokens + 70, // Include prompt overhead
      outputTokens,
      totalTokens: inputTokens + this.config.systemPromptTokens + 70 + outputTokens,
      batchIndex,
    };
  }

  /**
   * Calculate how many entities can fit in a single batch
   * Considers BOTH input and output token limits.
   * Useful for progress estimation.
   */
  estimateRemainingCapacity(entities: BatchEntityInput[]): number {
    if (entities.length === 0) return 0;

    const maxInputTokens = this.budget.maxInputTokens;
    const maxOutputTokens = this.budget.maxOutputTokens;
    const basePromptTokens = this.config.systemPromptTokens + 70;

    // Max entities based on output token budget
    const maxEntitiesByOutput = Math.floor(
      maxOutputTokens / this.config.outputTokensPerEntity
    );

    let totalTokens = basePromptTokens;
    let count = 0;

    for (const entity of entities) {
      // Check output limit first (simple count check)
      if (count >= maxEntitiesByOutput) break;

      // Check input limit
      const entityTokens = estimateEntityTokens(entity);
      if (totalTokens + entityTokens > maxInputTokens) break;

      totalTokens += entityTokens;
      count++;
    }

    return count;
  }

  /**
   * Get the maximum entities per batch based on output token limit
   */
  getMaxEntitiesByOutput(): number {
    return Math.floor(this.budget.maxOutputTokens / this.config.outputTokensPerEntity);
  }
}

// =============================================================================
// Legacy Compatibility Layer
// =============================================================================

/**
 * @deprecated Use TokenBatchConfig instead
 */
export interface BatchConfig {
  maxContextTokens: number;
  maxOutputTokens: number;
  systemPromptTokens: number;
  responseTokensPerEntity: number;
  minBatchSize: number;
  maxBatchSize: number;
  bufferPercent: number;
}

/**
 * @deprecated Use DEFAULT_TOKEN_BATCH_CONFIG instead
 */
export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxContextTokens: 4096,
  maxOutputTokens: 2048,
  systemPromptTokens: 500,
  responseTokensPerEntity: 120,
  minBatchSize: 1,
  maxBatchSize: 1000, // Effectively unlimited - token-based now
  bufferPercent: 0.12,
};

/**
 * @deprecated Use getTokenBatchConfig instead
 */
export function getBatchConfigForModel(
  modelId: string,
  overrides?: Partial<BatchConfig>
): BatchConfig {
  const tokenConfig = getTokenBatchConfig(modelId);

  return {
    maxContextTokens: tokenConfig.maxContextTokens,
    maxOutputTokens: tokenConfig.maxOutputTokens,
    systemPromptTokens: tokenConfig.systemPromptTokens,
    responseTokensPerEntity: tokenConfig.outputTokensPerEntity,
    minBatchSize: 1,
    maxBatchSize: 10000, // Effectively unlimited
    bufferPercent: tokenConfig.safetyMargin,
    ...overrides,
  };
}

/**
 * @deprecated Use TokenBasedBatcher instead
 * Maintains backward compatibility with existing code
 */
export class DynamicBatcher {
  private tokenBatcher: TokenBasedBatcher;

  constructor(config: BatchConfig) {
    const tokenConfig: TokenBatchConfig = {
      maxContextTokens: config.maxContextTokens,
      maxOutputTokens: config.maxOutputTokens,
      systemPromptTokens: config.systemPromptTokens,
      outputTokensPerEntity: config.responseTokensPerEntity,
      safetyMargin: config.bufferPercent,
      maxEntitiesPerBatch: config.maxBatchSize > 0 ? config.maxBatchSize : 25,
    };
    this.tokenBatcher = new TokenBasedBatcher(tokenConfig);
  }

  createBatches(entities: BatchEntityInput[]): BatchingResult {
    return this.tokenBatcher.createBatches(entities);
  }

  getOptimalBatchSize(entities: BatchEntityInput[]): number {
    return this.tokenBatcher.estimateRemainingCapacity(entities);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a token-based batcher for a specific model
 */
export function createTokenBatcher(
  modelId: string,
  overrides?: Partial<TokenBatchConfig>
): TokenBasedBatcher {
  const config = getTokenBatchConfig(modelId, overrides);
  return new TokenBasedBatcher(config);
}

/**
 * Create batches for entities using token-based sizing
 */
export function createTokenBasedBatches(
  entities: BatchEntityInput[],
  modelId: string,
  overrides?: Partial<TokenBatchConfig>
): BatchingResult {
  const batcher = createTokenBatcher(modelId, overrides);
  return batcher.createBatches(entities);
}

/**
 * @deprecated Use createTokenBatcher instead
 */
export function createDynamicBatcher(
  modelId: string,
  overrides?: Partial<BatchConfig>
): DynamicBatcher {
  const config = getBatchConfigForModel(modelId, overrides);
  return new DynamicBatcher(config);
}

/**
 * @deprecated Use createTokenBasedBatches instead
 */
export function createDynamicBatches(
  entities: BatchEntityInput[],
  modelId: string,
  overrides?: Partial<BatchConfig>
): BatchingResult {
  const batcher = createDynamicBatcher(modelId, overrides);
  return batcher.createBatches(entities);
}

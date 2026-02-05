/**
 * LLM Justification Service Implementation
 *
 * Core implementation of the Business Justification Layer.
 * Uses local LLM to infer purpose, business value, and feature context
 * for code entities.
 *
 * @module
 */

import { createLogger } from "../../../utils/logger.js";
import type { IGraphStore } from "../../interfaces/IGraphStore.js";
import type { IModelRouter } from "../../models/interfaces/IModel.js";
import { getDefaultModelId } from "../../models/Registry.js";
import * as fs from "fs";
import * as path from "path";
import type {
  IJustificationService,
  JustifyOptions,
  JustificationResult,
  JustificationHierarchy,
  SearchOptions,
  UserJustificationInput,
  FileCoverage,
} from "../interfaces/IJustificationService.js";
import type {
  EntityJustification,
  JustificationContext,
  JustificationStats,
  ClarificationBatch,
  ClarificationQuestion,
  FeatureJustification,
  JustifiableEntityType,
  LLMJustificationResponse,
} from "../models/justification.js";
import {
  createEntityJustification,
  scoreToConfidenceLevel,
  createClarificationQuestion,
} from "../models/justification.js";
import {
  JustificationStorage,
  createJustificationStorage,
} from "../storage/justification-storage.js";
import {
  ContextPropagator,
  createContextPropagator,
} from "../hierarchy/context-propagator.js";
import {
  ClarificationEngine,
  createClarificationEngine,
} from "../clarification/clarification-engine.js";
import {
  JUSTIFICATION_SYSTEM_PROMPT,
  generateJustificationPrompt,
  parseJustificationResponse,
  createDefaultResponse,
  BATCH_JUSTIFICATION_SYSTEM_PROMPT,
  generateBatchPrompt,
  parseBatchResponse,
  BATCH_JUSTIFICATION_JSON_SCHEMA,
  type BatchEntityInput,
} from "../prompts/justification-prompts.js";
import {
  filterTrivialEntities,
  checkTrivialEntity,
  type EntityInfo,
} from "../utils/trivial-filter.js";
import {
  createTokenBatcher,
  getTokenBatchConfig,
} from "../utils/dynamic-batcher.js";
import {
  buildProcessingOrder,
  type ProcessingOrder,
  type ProcessingLevel,
  type DependencyGraph,
} from "../hierarchy/dependency-graph.js";
import { DEFAULT_IGNORE_PATTERNS } from "../../indexer/project-detector.js";
import { minimatch } from "minimatch";

const logger = createLogger("justification-service");

// =============================================================================
// Service Configuration
// =============================================================================

/**
 * JSON schema for structured LLM output
 */
const JUSTIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    purposeSummary: { type: "string" },
    businessValue: { type: "string" },
    featureContext: { type: "string" },
    detailedDescription: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    confidenceScore: { type: "number" },
    reasoning: { type: "string" },
    needsClarification: { type: "boolean" },
    clarificationQuestions: { type: "array", items: { type: "string" } },
    category: { enum: ["domain", "infrastructure", "test", "config", "unknown"] },
    domain: { type: "string" },
    architecturalPattern: { enum: ["pure_domain", "pure_infrastructure", "mixed", "adapter", "unknown"] },
  },
  required: ["purposeSummary", "businessValue", "confidenceScore", "category", "architecturalPattern"],
};

/**
 * Default options for justification operations
 */
const DEFAULT_OPTIONS: JustifyOptions = {
  force: false,
  minConfidence: 0.3,
  skipLLM: false,
  propagateContext: true,
  batchSize: 10,
  llmBatchSize: 10, // Number of entities to process in a single LLM call (fallback if dynamic fails)
  skipTrivial: true, // Skip trivial entities like simple getters/setters
  useDynamicBatching: true, // Use dynamic batching based on context window
  filterIgnoredPaths: true, // Filter out gitignored and build artifact paths
};

/**
 * Check if a file path should be ignored based on default patterns
 */
function shouldIgnorePath(filePath: string): boolean {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, "/");

  for (const pattern of DEFAULT_IGNORE_PATTERNS) {
    if (minimatch(normalizedPath, pattern, { dot: true })) {
      return true;
    }
  }

  return false;
}

// =============================================================================
// LLM Justification Service
// =============================================================================

/**
 * Implements the Business Justification Layer using local LLM inference.
 */
export class LLMJustificationService implements IJustificationService {
  private storage: JustificationStorage;
  private propagator: ContextPropagator;
  private clarificationEngine: ClarificationEngine;
  private ready: boolean = false;

  // Performance optimization: Cache entity types to avoid repeated DB lookups
  // LRU-style cache with max 10,000 entries
  private entityTypeCache: Map<string, JustifiableEntityType> = new Map();
  private static readonly ENTITY_TYPE_CACHE_MAX_SIZE = 10000;

  constructor(
    private graphStore: IGraphStore,
    private modelRouter?: IModelRouter
  ) {
    this.storage = createJustificationStorage(graphStore);
    this.propagator = createContextPropagator(graphStore);
    this.clarificationEngine = createClarificationEngine(this.storage);
  }

  /**
   * Clear the entity type cache (useful for testing or after major index updates)
   */
  clearEntityTypeCache(): void {
    this.entityTypeCache.clear();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async initialize(): Promise<void> {
    logger.debug("Initializing justification service");

    if (!this.graphStore.isReady) {
      throw new Error("Graph store not initialized");
    }

    // LLM service is optional - we can work without it using defaults
    if (this.modelRouter) {
      // Router usually initialized globally, but we can ensure it's ready
      // or just proceed assuming it is/will be
    }

    this.ready = true;
    logger.debug("Justification service initialized");
  }

  async close(): Promise<void> {
    logger.debug("Closing justification service");
    this.ready = false;
  }

  isReady(): boolean {
    return this.ready;
  }

  // ===========================================================================
  // Core Justification
  // ===========================================================================

  async justifyEntities(
    entityIds: string[],
    options: JustifyOptions = {}
  ): Promise<JustificationResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();

    const result: JustificationResult = {
      justified: [],
      failed: [],
      needingClarification: [],
      stats: {
        total: entityIds.length,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        pendingClarification: 0,
        averageConfidence: 0,
        durationMs: 0,
      },
    };

    // Get existing justifications
    // When processing hierarchically (_hierarchyLevel is set), fetch ALL existing justifications
    // so that context building can include justifications from previous levels (dependencies)
    let existing: Map<string, EntityJustification>;
    if (opts._hierarchyLevel !== undefined && opts._hierarchyLevel > 0) {
      // Hierarchical mode: fetch all justifications for richer context
      existing = await this.storage.getAllJustifications();
      logger.debug(
        { level: opts._hierarchyLevel, totalExisting: existing.size },
        "Fetched all existing justifications for hierarchical context"
      );
    } else {
      // Normal mode or Level 0: only fetch for current entities
      existing = await this.storage.getByEntityIds(entityIds);
    }

    // Filter entities that need justification
    // Step 0: Get file hashes for incremental check
    const entityFileHashes = await this.getEntityFileHashes(entityIds);

    // Filter entities that need justification
    const toProcess = entityIds.filter((id) => {
      if (opts.force) return true;
      const existing_j = existing.get(id);
      if (!existing_j) return true;

      // Check for file hash mismatch (incremental update)
      const currentHash = entityFileHashes.get(id);
      if (currentHash && existing_j.fileHash !== currentHash) {
        return true; // File changed, re-justify
      }

      return existing_j.confidenceScore < opts.minConfidence!;
    });

    result.stats.skipped = entityIds.length - toProcess.length;

    logger.debug({ total: entityIds.length, toProcess: toProcess.length }, "Starting justification");

    // Step 1: Bulk fetch entity types (major optimization - single query instead of N*7 queries)
    const entityTypeMap = await this.getEntityTypes(toProcess);
    logger.debug({ resolved: entityTypeMap.size, total: toProcess.length }, "Entity types resolved");

    // Step 1.1: Get LIGHTWEIGHT entity info for trivial filtering
    // This uses bulk queries instead of building full context for each entity
    const lightweightInfos = await this.getLightweightEntityInfos(toProcess, entityTypeMap);
    logger.debug({ count: lightweightInfos.length }, "Lightweight entity info collected");

    // Convert to EntityInfo format for trivial filtering
    const entityInfos: EntityInfo[] = lightweightInfos;

    // Step 1.5: Filter out gitignored and build artifact paths if enabled
    let filteredEntityInfos = entityInfos;
    let ignoredCount = 0;

    if (opts.filterIgnoredPaths) {
      filteredEntityInfos = entityInfos.filter((entity) => {
        if (shouldIgnorePath(entity.filePath)) {
          ignoredCount++;
          return false;
        }
        return true;
      });

      if (ignoredCount > 0) {
        logger.debug(
          { ignored: ignoredCount, remaining: filteredEntityInfos.length },
          "Filtered out ignored/generated paths"
        );
        result.stats.skipped += ignoredCount;
      }
    }

    // Step 2: Filter trivial entities if enabled
    let trivialEntities: Array<EntityInfo & { result: ReturnType<typeof checkTrivialEntity> }> = [];
    let nonTrivialEntities: EntityInfo[] = filteredEntityInfos;

    if (opts.skipTrivial) {
      const filterResult = filterTrivialEntities(filteredEntityInfos);
      trivialEntities = filterResult.trivial;
      nonTrivialEntities = filterResult.nonTrivial;

      logger.debug(
        { trivial: trivialEntities.length, nonTrivial: nonTrivialEntities.length },
        "Filtered trivial entities"
      );

      // Process trivial entities with default justifications (no LLM needed)
      for (const entity of trivialEntities) {
        try {
          const defaultJust = entity.result.defaultJustification;
          if (!defaultJust) continue;

          const entityType = entity.type as JustifiableEntityType;
          const now = Date.now();

          const justification = createEntityJustification({
            id: `just-${entity.id}`,
            entityId: entity.id,
            entityType,
            name: entity.name,
            filePath: entity.filePath,
            purposeSummary: defaultJust.purposeSummary,
            businessValue: defaultJust.businessValue,
            featureContext: defaultJust.featureContext,
            tags: defaultJust.tags,
            inferredFrom: "code_pattern",
            confidenceScore: defaultJust.confidenceScore,
            confidenceLevel: scoreToConfidenceLevel(defaultJust.confidenceScore),
            reasoning: `Trivial entity: ${entity.result.reason}`,
            evidenceSources: [entity.filePath],
            createdAt: now,
            updatedAt: now,
            ...(await this.calculateDependencyMetrics(entity.id, entityType)),
          });

          await this.storage.storeJustification(justification);
          result.justified.push(justification);
          result.stats.succeeded++;

          if (opts.onProgress) {
            opts.onProgress({
              phase: "inferring",
              current: result.stats.succeeded,
              total: toProcess.length,
              currentEntity: entity.id,
              message: `Trivial: ${entity.name}`,
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.failed.push({ entityId: entity.id, error: errorMessage });
          result.stats.failed++;
        }
      }
    }

    // Step 3: Process non-trivial entities with LLM (batch or single)
    const useBatchLLM = !!this.modelRouter && !opts.skipLLM && opts.llmBatchSize! > 1;

    if (useBatchLLM) {
      // Convert EntityInfo[] to BatchEntityInput[] for dynamic batching
      const batchInputs: BatchEntityInput[] = nonTrivialEntities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        filePath: entity.filePath,
        codeSnippet: entity.codeSnippet || "",
        signature: entity.signature,
        docComment: entity.docComment,
        isExported: entity.isExported,
      }));

      // Use token-based batching (always enabled now)
      // Get model ID for token budget calculation
      const modelId = opts.modelId || getDefaultModelId("local") || "qwen2.5-coder-3b"; // Registry default
      const batcher = createTokenBatcher(modelId);
      const batchingResult = batcher.createBatches(batchInputs);
      const tokenBudget = batcher.getTokenBudget();

      // Calculate which constraint is limiting batch size
      const maxEntitiesByOutput = batcher.getMaxEntitiesByOutput();
      const avgInputTokensPerEntity = batchingResult.totalEntities > 0
        ? Math.round(batchingResult.totalInputTokens / batchingResult.totalEntities)
        : 0;
      const maxEntitiesByInput = avgInputTokensPerEntity > 0
        ? Math.floor(tokenBudget.maxInputTokens / avgInputTokensPerEntity)
        : 0;
      const limitingConstraint = maxEntitiesByOutput < maxEntitiesByInput ? "output" : "input";

      logger.info(
        {
          modelId,
          totalEntities: batchingResult.totalEntities,
          totalBatches: batchingResult.totalBatches,
          averageBatchSize: batchingResult.averageBatchSize.toFixed(1),
          maxEntitiesByOutput,
          maxEntitiesByInput: maxEntitiesByInput || "N/A",
          limitingConstraint,
          totalInputTokens: batchingResult.totalInputTokens,
          totalOutputTokens: batchingResult.totalOutputTokens,
          maxInputTokens: tokenBudget.maxInputTokens,
          maxOutputTokens: tokenBudget.maxOutputTokens,
          oversizedEntities: batchingResult.oversizedEntities.length,
        },
        "Token-based batching configured (dual input+output constraint)"
      );

      // Convert batches back to EntityInfo[]
      const batches = batchingResult.batches.map((batch) =>
        batch.entities
          .map((batchEntity) => nonTrivialEntities.find((e) => e.id === batchEntity.id))
          .filter((e): e is EntityInfo => e !== undefined)
      );

      // Process each batch
      // Process batches with concurrency control
      const concurrencyLimit = Math.max(1, parseInt(process.env.LLM_CONCURRENCY || "1", 10));
      logger.info({ concurrencyLimit, totalBatches: batches.length }, "Processing batches with concurrency");

      for (let i = 0; i < batches.length; i += concurrencyLimit) {
        const batchChunk = batches.slice(i, i + concurrencyLimit);
        const chunkPromises = batchChunk.map(async (batchEntities, relativeIdx) => {
          const batchIdx = i + relativeIdx;
          const batchInfo = batchingResult.batches[batchIdx];

          if (!batchEntities || batchEntities.length === 0) return;

          if (opts.onProgress) {
            const tokenInfo = batchInfo ? ` [${batchInfo.inputTokens} input tokens]` : "";
            opts.onProgress({
              phase: "inferring",
              current: result.stats.succeeded,
              total: toProcess.length,
              message: `Batch ${batchIdx + 1}/${batches.length} (${batchEntities.length} entities)${tokenInfo}`,
            });
          }

          try {
            const batchResults = await this.executeWithRetry(
              async () => this.processBatch(batchEntities, existing, opts),
              `batch-${batchIdx}`,
              3,
              5000 // Start with 5s delay
            );

            for (const justification of batchResults) {
              if (justification.clarificationPending) {
                result.needingClarification.push(justification);
                result.stats.pendingClarification++;
              } else {
                result.justified.push(justification);
                result.stats.succeeded++;
              }
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(
              { err: error, errorMessage, batchSize: batchEntities.length, batchIdx },
              "Batch inference failed, falling back to single"
            );

            // Fallback to single processing for this batch
            for (const entity of batchEntities) {
              try {
                const justification = await this.justifyEntity(entity.id, existing, opts);
                if (justification.clarificationPending) {
                  result.needingClarification.push(justification);
                  result.stats.pendingClarification++;
                } else {
                  result.justified.push(justification);
                  result.stats.succeeded++;
                }
              } catch (singleError) {
                const singleErrorMessage =
                  singleError instanceof Error ? singleError.message : String(singleError);
                result.failed.push({ entityId: entity.id, error: singleErrorMessage });
                result.stats.failed++;
              }
            }
          }
        });

        await Promise.all(chunkPromises);
      }
    } else {
      // Single entity processing (original behavior)
      for (let i = 0; i < nonTrivialEntities.length; i += opts.batchSize!) {
        const batch = nonTrivialEntities.slice(i, i + opts.batchSize!);

        for (const entity of batch) {
          try {
            if (opts.onProgress) {
              opts.onProgress({
                phase: "inferring",
                current: result.stats.succeeded + result.stats.failed + 1,
                total: toProcess.length,
                currentEntity: entity.id,
              });
            }

            const justification = await this.justifyEntity(entity.id, existing, opts);

            if (justification.clarificationPending) {
              result.needingClarification.push(justification);
              result.stats.pendingClarification++;
            } else {
              result.justified.push(justification);
              result.stats.succeeded++;
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(
              { entityId: entity.id, err: error, errorMessage },
              "Failed to justify entity %s: %s",
              entity.id,
              errorMessage
            );
            result.failed.push({
              entityId: entity.id,
              error: errorMessage,
            });
            result.stats.failed++;
          }
        }
      }
    }

    // Context propagation
    if (opts.propagateContext && result.justified.length > 0) {
      if (opts.onProgress) {
        opts.onProgress({
          phase: "propagating",
          current: 0,
          total: result.justified.length,
          message: "Propagating context through hierarchy",
        });
      }

      await this.propagateAllContext(result.justified);
    }

    // Calculate stats
    const allJustified = [...result.justified, ...result.needingClarification];
    if (allJustified.length > 0) {
      result.stats.averageConfidence =
        allJustified.reduce((sum, j) => sum + j.confidenceScore, 0) / allJustified.length;
    }
    result.stats.durationMs = Date.now() - startTime;

    logger.debug(
      {
        succeeded: result.stats.succeeded,
        failed: result.stats.failed,
        pending: result.stats.pendingClarification,
        trivialSkipped: trivialEntities.length,
        ignoredPaths: ignoredCount,
        batchedLLM: useBatchLLM,
        dynamicBatching: opts.useDynamicBatching,
        durationMs: result.stats.durationMs,
      },
      "Justification complete"
    );

    return result;
  }

  /**
   * Process a batch of entities with a single LLM call
   */
  private async processBatch(
    entities: EntityInfo[],
    existingJustifications: Map<string, EntityJustification>,
    options: JustifyOptions
  ): Promise<EntityJustification[]> {
    if (!this.modelRouter) {
      throw new Error("Model router not available for batch processing");
    }

    // Build batch input
    const batchInput: BatchEntityInput[] = entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      filePath: entity.filePath,
      codeSnippet: entity.codeSnippet || "",
      signature: entity.signature,
      docComment: entity.docComment,
      isExported: entity.isExported,
    }));

    // Generate batch prompt
    const prompt = generateBatchPrompt(batchInput);

    // Get token configuration for the model
    const modelId = options.modelId || getDefaultModelId("local") || "qwen2.5-coder-3b";
    const tokenConfig = getTokenBatchConfig(modelId);

    // Calculate output tokens based on entity count
    // Use model's max output tokens as ceiling, entity count * tokens per entity as floor
    const outputTokensPerEntity = tokenConfig.outputTokensPerEntity;
    const estimatedResponseTokens = Math.min(
      tokenConfig.maxOutputTokens,
      Math.max(4096, entities.length * outputTokensPerEntity)
    );

    logger.debug(
      {
        batchSize: entities.length,
        outputTokensPerEntity,
        estimatedResponseTokens,
        modelId,
      },
      "Processing batch with token-based limits"
    );

    const inferenceResult = await this.modelRouter.execute({
      prompt: prompt,
      systemPrompt: BATCH_JUSTIFICATION_SYSTEM_PROMPT,
      taskType: "justification",
      parameters: {
        maxTokens: estimatedResponseTokens,
        temperature: 0.0,
        thinkingLevel: "high",
      },
      schema: BATCH_JUSTIFICATION_JSON_SCHEMA,
    });

    // Use native parsed results if available
    // Note: parsed from providers like Gemini is a plain object, not a Map
    // parseBatchResponse handles both objects and strings, converting to Map<string, BatchEntityResponse>
    const batchResponses = inferenceResult.parsed instanceof Map
      ? inferenceResult.parsed as Map<string, any>
      : parseBatchResponse(inferenceResult.parsed ?? inferenceResult.content);

    // Get file hashes for all entities in batch
    const fileHashes = await this.getFileHashes(entities.map(e => e.filePath));

    // Create justifications for each entity
    const justifications: EntityJustification[] = [];
    const now = Date.now();

    for (const entity of entities) {
      const response = batchResponses.get(entity.id);
      const entityType = entity.type as JustifiableEntityType;

      let justification: EntityJustification;

      if (response) {
        // Use batch response
        // Auto-generate clarification questions if confidence < 0.5
        const needsClarification = response.confidenceScore < 0.5;
        const clarificationQuestions: ClarificationQuestion[] = [];

        if (needsClarification) {
          // Generate contextual clarification questions based on what's missing
          if (!response.purposeSummary || response.purposeSummary.length < 10) {
            clarificationQuestions.push(
              createClarificationQuestion({
                id: `q-${entity.id}-purpose`,
                question: `What is the primary purpose of "${entity.name}"?`,
                entityId: entity.id,
                category: "purpose",
                priority: 0,
                context: `File: ${entity.filePath}`,
              })
            );
          }
          if (!response.businessValue || response.businessValue.length < 10) {
            clarificationQuestions.push(
              createClarificationQuestion({
                id: `q-${entity.id}-business`,
                question: `Why does "${entity.name}" exist? What problem does it solve?`,
                entityId: entity.id,
                category: "business_value",
                priority: 1,
                context: `Current understanding: ${response.purposeSummary || "Unknown"}`,
              })
            );
          }
          if (!response.featureContext || response.featureContext === "General") {
            clarificationQuestions.push(
              createClarificationQuestion({
                id: `q-${entity.id}-feature`,
                question: `Which feature or domain does "${entity.name}" belong to?`,
                entityId: entity.id,
                category: "feature_context",
                priority: 2,
              })
            );
          }
        }

        justification = createEntityJustification({
          id: `just-${entity.id}`,
          entityId: entity.id,
          entityType,
          name: entity.name,
          filePath: entity.filePath,
          purposeSummary: response.purposeSummary,
          businessValue: response.businessValue,
          featureContext: response.featureContext,
          tags: response.tags,
          inferredFrom: "llm_inferred",
          confidenceScore: response.confidenceScore,
          confidenceLevel: scoreToConfidenceLevel(response.confidenceScore),
          reasoning: "Batch LLM inference",
          evidenceSources: [entity.filePath],
          clarificationPending: needsClarification,
          pendingQuestions: clarificationQuestions,
          createdAt: now,
          updatedAt: now,
          fileHash: fileHashes.get(entity.filePath) || "",
          ...(await this.calculateDependencyMetrics(entity.id, entityType)),
        });
      } else {
        // Fallback to code analysis
        logger.warn({ entityId: entity.id }, "Entity not found in batch response, using code analysis");
        const context = await this.propagator.buildContext(entity.id, entityType, existingJustifications);
        const fallbackResponse = this.inferFromCodeAnalysis(context);

        justification = createEntityJustification({
          id: `just-${entity.id}`,
          entityId: entity.id,
          entityType,
          name: entity.name,
          filePath: entity.filePath,
          purposeSummary: fallbackResponse.purposeSummary,
          businessValue: fallbackResponse.businessValue,
          featureContext: fallbackResponse.featureContext,
          tags: fallbackResponse.tags,
          inferredFrom: "file_name",
          confidenceScore: fallbackResponse.confidenceScore,
          confidenceLevel: scoreToConfidenceLevel(fallbackResponse.confidenceScore),
          reasoning: fallbackResponse.reasoning,
          evidenceSources: [entity.filePath],
          clarificationPending: fallbackResponse.needsClarification,
          pendingQuestions: fallbackResponse.clarificationQuestions.map((q, i) =>
            createClarificationQuestion({
              id: `q-${entity.id}-${i}`,
              question: q,
              entityId: entity.id,
              category: "purpose",
              priority: i,
            })
          ),
          createdAt: now,
          updatedAt: now,
          fileHash: fileHashes.get(entity.filePath) || "",
          ...(await this.calculateDependencyMetrics(entity.id, entityType)),
        });
      }

      await this.storage.storeJustification(justification);
      justifications.push(justification);
    }

    return justifications;
  }

  async justifyFile(filePath: string, options?: JustifyOptions): Promise<JustificationResult> {
    // Get all entity IDs in the file
    const hierarchy = await this.propagator.buildFileHierarchy(filePath);
    const entityIds = hierarchy.map((node) => node.entityId);

    return this.justifyEntities(entityIds, options);
  }

  async justifyProject(options?: JustifyOptions): Promise<JustificationResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();

    // Build dependency graph and compute hierarchical processing order
    logger.info("Building dependency graph for hierarchical justification");

    if (opts.onProgress) {
      opts.onProgress({
        phase: "initializing",
        current: 0,
        total: 0,
        message: "Building dependency graph...",
      });
    }

    const { graph, order } = await buildProcessingOrder(this.graphStore);

    logger.info(
      {
        totalEntities: order.totalEntities,
        totalLevels: order.levels.length,
        cycleCount: order.cycleCount,
        entitiesInCycles: order.entitiesInCycles,
      },
      "Dependency graph built, processing hierarchically"
    );

    // Initialize combined result
    const result: JustificationResult = {
      justified: [],
      failed: [],
      needingClarification: [],
      stats: {
        total: order.totalEntities,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        pendingClarification: 0,
        averageConfidence: 0,
        durationMs: 0,
      },
    };

    // Process each level in order (leaves first, then dependents)
    for (let levelIdx = 0; levelIdx < order.levels.length; levelIdx++) {
      const level = order.levels[levelIdx]!;
      const levelType = level.isCycle ? "cycle" : "standard";

      logger.info(
        {
          level: level.level,
          entityCount: level.entityIds.length,
          isCycle: level.isCycle,
          cycleSize: level.cycleSize,
          progress: `${levelIdx + 1}/${order.levels.length}`,
        },
        `Processing level ${level.level} (${levelType})`
      );

      if (opts.onProgress) {
        const cycleInfo = level.isCycle ? ` [cycle of ${level.cycleSize}]` : "";
        opts.onProgress({
          phase: "inferring",
          current: result.stats.succeeded + result.stats.failed,
          total: order.totalEntities,
          message: `Level ${level.level}/${order.levels.length - 1}: ${level.entityIds.length} entities${cycleInfo}`,
        });
      }

      // Process this level's entities
      // Note: justifyEntities will fetch existing justifications which now includes
      // all justifications from previous levels - enabling context propagation
      const levelResult = await this.justifyEntities(level.entityIds, {
        ...opts,
        // Don't propagate context within level processing - we do it at the end
        propagateContext: false,
        // Pass level info for enhanced context building
        _hierarchyLevel: level.level,
        _isInCycle: level.isCycle,
      });

      // Merge level results into combined result
      result.justified.push(...levelResult.justified);
      result.failed.push(...levelResult.failed);
      result.needingClarification.push(...levelResult.needingClarification);
      result.stats.succeeded += levelResult.stats.succeeded;
      result.stats.failed += levelResult.stats.failed;
      result.stats.skipped += levelResult.stats.skipped;
      result.stats.pendingClarification += levelResult.stats.pendingClarification;

      logger.debug(
        {
          level: level.level,
          levelSucceeded: levelResult.stats.succeeded,
          totalSucceeded: result.stats.succeeded,
          totalFailed: result.stats.failed,
        },
        `Completed level ${level.level}`
      );
    }

    // Context propagation across all levels (after all justifications are done)
    if (opts.propagateContext && result.justified.length > 0) {
      if (opts.onProgress) {
        opts.onProgress({
          phase: "propagating",
          current: 0,
          total: result.justified.length,
          message: "Propagating context through hierarchy",
        });
      }

      await this.propagateAllContext(result.justified);
    }

    // Calculate final stats
    const allJustified = [...result.justified, ...result.needingClarification];
    if (allJustified.length > 0) {
      const totalConfidence = allJustified.reduce(
        (sum, j) => sum + j.confidenceScore,
        0
      );
      result.stats.averageConfidence = totalConfidence / allJustified.length;
    }

    result.stats.durationMs = Date.now() - startTime;

    logger.info(
      {
        succeeded: result.stats.succeeded,
        failed: result.stats.failed,
        pending: result.stats.pendingClarification,
        skipped: result.stats.skipped,
        levels: order.levels.length,
        cycles: order.cycleCount,
        durationMs: result.stats.durationMs,
      },
      "Hierarchical justification complete"
    );

    return result;
  }

  async rejustifyUncertain(): Promise<JustificationResult> {
    const uncertain = await this.storage.getEntitiesNeedingClarification();
    const entityIds = uncertain.map((j) => j.entityId);

    return this.justifyEntities(entityIds, { force: true });
  }

  // ===========================================================================
  // Single Entity Justification
  // ===========================================================================

  /**
   * Justify a single entity
   */
  private async justifyEntity(
    entityId: string,
    existingJustifications: Map<string, EntityJustification>,
    options: JustifyOptions
  ): Promise<EntityJustification> {
    // Determine entity type
    const entityType = await this.getEntityType(entityId);
    if (!entityType) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    // Build context
    const context = await this.propagator.buildContext(
      entityId,
      entityType,
      existingJustifications
    );

    // Generate prompt
    const prompt = generateJustificationPrompt(context.entity, context);

    // Get LLM response
    let llmResponse: LLMJustificationResponse;

    if (this.modelRouter && !options.skipLLM) {
      try {
        const inferenceResult = await this.executeWithRetry(
          async () =>
            this.modelRouter!.execute({
              prompt: prompt,
              systemPrompt: JUSTIFICATION_SYSTEM_PROMPT,
              taskType: "justification",
              parameters: {
                maxTokens: 1024,
                temperature: 0.0,
                thinkingLevel: "high",
              },
              schema: JUSTIFICATION_JSON_SCHEMA,
            }),
          `entity-${entityId}`,
          3,
          5000 // Start with 5s delay
        );

        const parsed = inferenceResult.parsed || parseJustificationResponse(inferenceResult.content);
        llmResponse = (parsed as LLMJustificationResponse) || createDefaultResponse(context.entity);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(
          {
            entityId,
            err: error,
            errorMessage,
          },
          "LLM inference failed for %s, using defaults: %s",
          entityId,
          errorMessage
        );
        llmResponse = createDefaultResponse(context.entity);
      }
    } else {
      // No LLM available - use code analysis only
      llmResponse = this.inferFromCodeAnalysis(context);
    }

    // Create justification
    const now = Date.now();
    const justification = createEntityJustification({
      id: `just-${entityId}`,
      entityId,
      entityType,
      name: context.entity.name,
      filePath: context.entity.filePath,
      fileHash: (await this.getFileHashes([context.entity.filePath])).get(context.entity.filePath) || "",
      purposeSummary: llmResponse.purposeSummary,
      businessValue: llmResponse.businessValue,
      featureContext: llmResponse.featureContext,
      detailedDescription: llmResponse.detailedDescription,
      tags: llmResponse.tags,
      inferredFrom: this.modelRouter ? "llm_inferred" : "file_name",
      confidenceScore: llmResponse.confidenceScore,
      confidenceLevel: scoreToConfidenceLevel(llmResponse.confidenceScore),
      reasoning: llmResponse.reasoning,
      evidenceSources: [context.entity.filePath],
      parentJustificationId: context.parentContext?.justification?.id || null,
      hierarchyDepth: context.parentContext ? context.parentContext.justification!.hierarchyDepth + 1 : 0,
      clarificationPending: llmResponse.needsClarification,
      category: llmResponse.category,
      domain: llmResponse.domain,
      architecturalPattern: llmResponse.architecturalPattern,
      pendingQuestions: llmResponse.clarificationQuestions.map((q, i) =>
        createClarificationQuestion({
          id: `q-${entityId}-${i}`,
          question: q,
          entityId: entityId,
          category: "purpose",
          priority: i,
        })
      ),
      createdAt: now,
      updatedAt: now,
      ...(await this.calculateDependencyMetrics(entityId, entityType)),
    });

    // Store
    await this.storage.storeJustification(justification);

    return justification;
  }

  /**
   * Calculate dependency metrics (Phase 2)
   */
  private async calculateDependencyMetrics(
    entityId: string,
    entityType: JustifiableEntityType
  ): Promise<{ dependentCount: number; dependencyRisk: "low" | "medium" | "high" | "critical" }> {
    let count = 0;
    try {
      if (entityType === "function" || entityType === "method") {
        const result = await this.graphStore.query<{ count: number }>(
          `?[count] := count(*calls{to_id: $entityId})`,
          { entityId }
        );
        count = result.rows[0]?.count || 0;
      } else if (entityType === "class" || entityType === "interface" || entityType === "type_alias") {
        const result = await this.graphStore.query<{ count: number }>(
          `?[count] := count(*uses_type{to_id: $entityId})`,
          { entityId }
        );
        count = result.rows[0]?.count || 0;
      } else if (entityType === "file" || entityType === "module") {
        const result = await this.graphStore.query<{ count: number }>(
          `?[count] := count(*imports{to_id: $entityId})`,
          { entityId }
        );
        count = result.rows[0]?.count || 0;
      }
    } catch (error) {
      count = 0; // Ignore query errors
    }

    let dependencyRisk: "low" | "medium" | "high" | "critical" = "low";
    if (count > 50) dependencyRisk = "critical";
    else if (count > 20) dependencyRisk = "high";
    else if (count > 5) dependencyRisk = "medium";

    return { dependentCount: count, dependencyRisk };
  }

  /**
   * Infer justification from code analysis only (no LLM)
   * Creates MEANINGFUL descriptions based on code patterns, not generic placeholders
   */
  private inferFromCodeAnalysis(context: JustificationContext): LLMJustificationResponse {
    const entity = context.entity;
    const name = entity.name;
    const code = entity.codeSnippet || "";

    // Extract meaningful context from file path
    const pathParts = entity.filePath.split("/");
    let featureContext = this.inferFeatureFromPath(pathParts);
    const tags: string[] = [];
    let confidenceScore = 0.4;

    // Analyze entity type and generate appropriate description
    let purposeSummary: string;
    let businessValue: string;

    if (entity.type === "interface") {
      const result = this.analyzeInterface(name, code, featureContext);
      purposeSummary = result.purposeSummary;
      businessValue = result.businessValue;
      tags.push(...result.tags);
      confidenceScore = result.confidence;
    } else if (entity.type === "class") {
      const result = this.analyzeClass(name, code, featureContext);
      purposeSummary = result.purposeSummary;
      businessValue = result.businessValue;
      tags.push(...result.tags);
      confidenceScore = result.confidence;
    } else {
      const result = this.analyzeFunction(name, code, featureContext);
      purposeSummary = result.purposeSummary;
      businessValue = result.businessValue;
      tags.push(...result.tags);
      confidenceScore = result.confidence;
    }

    // Enhance with doc comment if available
    if (entity.docComment) {
      const cleanDoc = entity.docComment
        .replace(/^\/\*\*?\s*|\s*\*\/$/g, "")
        .replace(/^\s*\*\s*/gm, "")
        .trim();
      const firstLine = cleanDoc.split("\n")[0] || "";
      if (firstLine.length > 15 && !firstLine.startsWith("@")) {
        purposeSummary = firstLine;
        confidenceScore = Math.min(0.75, confidenceScore + 0.15);
      }
    }

    // Update feature context if still generic
    if (featureContext === "General" && context.parentContext?.justification) {
      featureContext = context.parentContext.justification.featureContext;
      businessValue = `Supports ${context.parentContext.justification.purposeSummary}`;
      confidenceScore = Math.min(0.7, confidenceScore + 0.1);
    }

    return {
      purposeSummary,
      businessValue,
      featureContext,
      detailedDescription: "",
      tags: [...new Set(tags)].slice(0, 5),
      confidenceScore,
      reasoning: "Inferred from naming conventions, code structure, and file location",
      needsClarification: confidenceScore < 0.5,
      clarificationQuestions: confidenceScore < 0.5
        ? [`What business problem does ${name} solve?`, `How is ${name} used in the system?`]
        : [],
      category: "unknown",
      domain: featureContext,
      architecturalPattern: "unknown",
    };
  }

  /**
   * Analyze interface to generate meaningful description
   */
  private analyzeInterface(name: string, code: string, feature: string): {
    purposeSummary: string;
    businessValue: string;
    tags: string[];
    confidence: number;
  } {
    const tags: string[] = ["contract", "type-safety"];

    // Analyze interface purpose from name patterns
    if (/^I[A-Z]/.test(name)) {
      const baseName = name.slice(1);
      return {
        purposeSummary: `Defines the contract for ${this.camelToReadable(baseName)} implementations, enabling dependency injection and testability`,
        businessValue: `Allows swapping ${this.camelToReadable(baseName)} implementations without changing dependent code`,
        tags: [...tags, "dependency-injection", "abstraction"],
        confidence: 0.65,
      };
    }

    if (/Options$|Config$|Settings$|Params$/.test(name)) {
      const baseName = name.replace(/(Options|Config|Settings|Params)$/, "");
      return {
        purposeSummary: `Defines configuration parameters for ${this.camelToReadable(baseName)} behavior and customization`,
        businessValue: `Enables flexible configuration of ${this.camelToReadable(baseName)} without code changes`,
        tags: [...tags, "configuration"],
        confidence: 0.6,
      };
    }

    if (/Props$/.test(name)) {
      const baseName = name.replace(/Props$/, "");
      return {
        purposeSummary: `Defines the expected input properties for ${this.camelToReadable(baseName)} component`,
        businessValue: `Ensures type-safe data passing to ${this.camelToReadable(baseName)} component`,
        tags: [...tags, "component-props", "ui"],
        confidence: 0.6,
      };
    }

    if (/Result$|Response$|Output$/.test(name)) {
      const baseName = name.replace(/(Result|Response|Output)$/, "");
      return {
        purposeSummary: `Defines the structure of ${this.camelToReadable(baseName)} operation output for consistent data handling`,
        businessValue: `Enables type-safe consumption of ${this.camelToReadable(baseName)} results across the codebase`,
        tags: [...tags, "data-structure", "output"],
        confidence: 0.6,
      };
    }

    if (/Request$|Input$/.test(name)) {
      const baseName = name.replace(/(Request|Input)$/, "");
      return {
        purposeSummary: `Defines the required input structure for ${this.camelToReadable(baseName)} operations`,
        businessValue: `Ensures valid input data for ${this.camelToReadable(baseName)} processing`,
        tags: [...tags, "data-structure", "input", "validation"],
        confidence: 0.6,
      };
    }

    // Analyze code content for clues
    if (code.includes("(): Promise<") || code.includes("async")) {
      return {
        purposeSummary: `Defines async operations contract for ${this.camelToReadable(name)} capability`,
        businessValue: `Establishes consistent async API for ${feature} operations`,
        tags: [...tags, "async-operations"],
        confidence: 0.5,
      };
    }

    // Generic but still meaningful
    return {
      purposeSummary: `Defines the data structure and contract for ${this.camelToReadable(name)} in ${feature}`,
      businessValue: `Provides type safety and documentation for ${this.camelToReadable(name)} usage`,
      tags,
      confidence: 0.45,
    };
  }

  /**
   * Analyze class to generate meaningful description
   */
  private analyzeClass(name: string, code: string, feature: string): {
    purposeSummary: string;
    businessValue: string;
    tags: string[];
    confidence: number;
  } {
    const tags: string[] = [];

    if (/Service$/.test(name)) {
      const baseName = name.replace(/Service$/, "");
      return {
        purposeSummary: `Provides ${this.camelToReadable(baseName)} business logic and operations as a centralized service`,
        businessValue: `Encapsulates ${this.camelToReadable(baseName)} complexity and exposes clean API for consumers`,
        tags: ["service", "business-logic", this.camelToKebab(baseName)],
        confidence: 0.65,
      };
    }

    if (/Controller$/.test(name)) {
      const baseName = name.replace(/Controller$/, "");
      return {
        purposeSummary: `Coordinates ${this.camelToReadable(baseName)} request handling and response formatting`,
        businessValue: `Manages ${this.camelToReadable(baseName)} API endpoint logic and request lifecycle`,
        tags: ["controller", "api", "request-handling"],
        confidence: 0.65,
      };
    }

    if (/Repository$|Storage$|Store$/.test(name)) {
      const baseName = name.replace(/(Repository|Storage|Store)$/, "");
      return {
        purposeSummary: `Manages persistence and retrieval of ${this.camelToReadable(baseName)} data`,
        businessValue: `Abstracts data storage details for ${this.camelToReadable(baseName)}, enabling storage backend changes`,
        tags: ["data-access", "persistence", "storage"],
        confidence: 0.65,
      };
    }

    if (/Factory$/.test(name)) {
      const baseName = name.replace(/Factory$/, "");
      return {
        purposeSummary: `Creates and configures ${this.camelToReadable(baseName)} instances with proper initialization`,
        businessValue: `Centralizes ${this.camelToReadable(baseName)} creation logic and ensures consistent configuration`,
        tags: ["factory", "creational-pattern", "initialization"],
        confidence: 0.6,
      };
    }

    if (/Builder$/.test(name)) {
      const baseName = name.replace(/Builder$/, "");
      return {
        purposeSummary: `Constructs ${this.camelToReadable(baseName)} objects step-by-step with fluent API`,
        businessValue: `Simplifies complex ${this.camelToReadable(baseName)} construction with readable builder pattern`,
        tags: ["builder", "creational-pattern", "fluent-api"],
        confidence: 0.6,
      };
    }

    if (/Error$|Exception$/.test(name)) {
      const baseName = name.replace(/(Error|Exception)$/, "");
      return {
        purposeSummary: `Represents ${this.camelToReadable(baseName)} error conditions with contextual information`,
        businessValue: `Enables specific error handling for ${this.camelToReadable(baseName)} failures`,
        tags: ["error-handling", "exception"],
        confidence: 0.6,
      };
    }

    // Generic but meaningful
    return {
      purposeSummary: `Implements ${this.camelToReadable(name)} logic and state management for ${feature}`,
      businessValue: `Encapsulates ${this.camelToReadable(name)} behavior and provides reusable functionality`,
      tags: ["implementation", this.camelToKebab(name)],
      confidence: 0.45,
    };
  }

  /**
   * Analyze function to generate meaningful description
   */
  private analyzeFunction(name: string, code: string, feature: string): {
    purposeSummary: string;
    businessValue: string;
    tags: string[];
    confidence: number;
  } {
    const tags: string[] = [];

    // Factory functions
    if (/^create[A-Z]/.test(name)) {
      const what = name.replace(/^create/, "");
      return {
        purposeSummary: `Creates and initializes a configured ${this.camelToReadable(what)} instance`,
        businessValue: `Provides consistent ${this.camelToReadable(what)} initialization across the codebase`,
        tags: ["factory", "initialization", this.camelToKebab(what)],
        confidence: 0.6,
      };
    }

    // Getters
    if (/^get[A-Z]/.test(name)) {
      const what = name.replace(/^get/, "");
      return {
        purposeSummary: `Retrieves ${this.camelToReadable(what)} data from the appropriate source`,
        businessValue: `Provides access to ${this.camelToReadable(what)} for dependent operations`,
        tags: ["data-access", "getter", this.camelToKebab(what)],
        confidence: 0.55,
      };
    }

    // Setters/Updates
    if (/^(set|update)[A-Z]/.test(name)) {
      const what = name.replace(/^(set|update)/, "");
      return {
        purposeSummary: `Updates ${this.camelToReadable(what)} with new values and handles side effects`,
        businessValue: `Enables modification of ${this.camelToReadable(what)} state`,
        tags: ["mutation", "setter", this.camelToKebab(what)],
        confidence: 0.55,
      };
    }

    // Validation
    if (/^(validate|check|verify|is|has|can)[A-Z]/.test(name)) {
      const what = name.replace(/^(validate|check|verify|is|has|can)/, "");
      return {
        purposeSummary: `Validates ${this.camelToReadable(what)} to ensure data integrity and business rules`,
        businessValue: `Prevents invalid ${this.camelToReadable(what)} from causing downstream errors`,
        tags: ["validation", "data-integrity", this.camelToKebab(what)],
        confidence: 0.6,
      };
    }

    // Parsing/Transformation
    if (/^(parse|transform|convert|format|normalize)[A-Z]/.test(name)) {
      const what = name.replace(/^(parse|transform|convert|format|normalize)/, "");
      return {
        purposeSummary: `Transforms ${this.camelToReadable(what)} into the required format for processing`,
        businessValue: `Enables interoperability by converting ${this.camelToReadable(what)} between formats`,
        tags: ["transformation", "data-processing", this.camelToKebab(what)],
        confidence: 0.6,
      };
    }

    // Handlers
    if (/^handle[A-Z]|Handler$/.test(name)) {
      const what = name.replace(/^handle|Handler$/, "");
      return {
        purposeSummary: `Handles ${this.camelToReadable(what)} events and coordinates appropriate responses`,
        businessValue: `Manages ${this.camelToReadable(what)} event lifecycle and error handling`,
        tags: ["event-handling", "handler", this.camelToKebab(what)],
        confidence: 0.6,
      };
    }

    // Processing
    if (/^(process|execute|run|perform)[A-Z]/.test(name)) {
      const what = name.replace(/^(process|execute|run|perform)/, "");
      return {
        purposeSummary: `Executes ${this.camelToReadable(what)} operation and returns results`,
        businessValue: `Performs core ${this.camelToReadable(what)} processing logic`,
        tags: ["processing", "execution", this.camelToKebab(what)],
        confidence: 0.55,
      };
    }

    // Loading/Fetching
    if (/^(load|fetch|read|retrieve)[A-Z]/.test(name)) {
      const what = name.replace(/^(load|fetch|read|retrieve)/, "");
      return {
        purposeSummary: `Loads ${this.camelToReadable(what)} from storage or external source`,
        businessValue: `Provides ${this.camelToReadable(what)} data for application operations`,
        tags: ["data-loading", "io", this.camelToKebab(what)],
        confidence: 0.55,
      };
    }

    // Saving/Writing
    if (/^(save|write|store|persist)[A-Z]/.test(name)) {
      const what = name.replace(/^(save|write|store|persist)/, "");
      return {
        purposeSummary: `Persists ${this.camelToReadable(what)} to storage for later retrieval`,
        businessValue: `Ensures ${this.camelToReadable(what)} data durability and recovery`,
        tags: ["persistence", "data-storage", this.camelToKebab(what)],
        confidence: 0.55,
      };
    }

    // Generic fallback - still meaningful
    return {
      purposeSummary: `Performs ${this.camelToReadable(name)} operation within ${feature}`,
      businessValue: `Provides ${this.camelToReadable(name)} capability for system functionality`,
      tags: [this.camelToKebab(name), feature.toLowerCase().replace(/\s+/g, "-")],
      confidence: 0.4,
    };
  }

  /**
   * Infer feature context from file path
   */
  private inferFeatureFromPath(pathParts: string[]): string {
    const featureMap: Record<string, string> = {
      auth: "Authentication",
      authentication: "Authentication",
      api: "API Layer",
      routes: "API Routing",
      endpoints: "API Endpoints",
      cli: "CLI Commands",
      commands: "CLI Commands",
      core: "Core Engine",
      parser: "Code Parsing",
      graph: "Knowledge Graph",
      indexer: "Code Indexer",
      mcp: "MCP Protocol",
      viewer: "Web Viewer",
      justification: "Business Justification",
      classification: "Code Classification",
      ledger: "Change Ledger",
      embeddings: "Vector Embeddings",
      llm: "LLM Integration",
      utils: "Utilities",
      types: "Type Definitions",
      models: "Data Models",
      interfaces: "Interface Contracts",
      storage: "Data Storage",
      cache: "Caching",
      optimization: "Performance Optimization",
    };

    for (const part of pathParts) {
      const lower = part.toLowerCase();
      if (featureMap[lower]) {
        return featureMap[lower];
      }
    }
    return "General";
  }

  /**
   * Convert camelCase to readable string
   */
  private camelToReadable(str: string): string {
    return str
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (s) => s.toUpperCase())
      .trim();
  }

  /**
   * Convert camelCase to kebab-case
   */
  private camelToKebab(str: string): string {
    return str
      .replace(/([A-Z])/g, "-$1")
      .toLowerCase()
      .replace(/^-/, "");
  }

  /**
   * Get entity type from ID (with caching)
   */
  private async getEntityType(entityId: string): Promise<JustifiableEntityType | null> {
    // Check cache first
    const cached = this.entityTypeCache.get(entityId);
    if (cached) {
      return cached;
    }

    // Single query to check all entity types at once
    const result = await this.graphStore.query<{ id: string; entity_type: string }>(
      `?[id, entity_type] :=
        id = $entityId,
        (
          (*function{id}, entity_type = "function") or
          (*class{id}, entity_type = "class") or
          (*interface{id}, entity_type = "interface") or
          (*type_alias{id}, entity_type = "type_alias") or
          (*variable{id}, entity_type = "variable") or
          (*file{id}, entity_type = "file") or
          (*module{id}, entity_type = "module")
        )`,
      { entityId }
    );

    if (result.rows.length > 0 && result.rows[0]) {
      const entityType = result.rows[0].entity_type as JustifiableEntityType;
      this.cacheEntityType(entityId, entityType);
      return entityType;
    }

    return null;
  }

  /**
   * Bulk get entity types for multiple IDs (much more efficient for batch operations)
   * Returns a Map of entityId -> entityType
   */
  private async getEntityTypes(entityIds: string[]): Promise<Map<string, JustifiableEntityType>> {
    const result = new Map<string, JustifiableEntityType>();
    const uncachedIds: string[] = [];

    // Check cache first
    for (const id of entityIds) {
      const cached = this.entityTypeCache.get(id);
      if (cached) {
        result.set(id, cached);
      } else {
        uncachedIds.push(id);
      }
    }

    // If all were cached, return early
    if (uncachedIds.length === 0) {
      return result;
    }

    // Batch query for uncached IDs - process in chunks to avoid query size limits
    const BATCH_SIZE = 500;
    for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
      const batch = uncachedIds.slice(i, i + BATCH_SIZE);

      // Build a query that checks all entity types for all IDs in one go
      const queryResult = await this.graphStore.query<{ id: string; entity_type: string }>(
        `?[id, entity_type] :=
          id in $entityIds,
          (
            (*function{id}, entity_type = "function") or
            (*class{id}, entity_type = "class") or
            (*interface{id}, entity_type = "interface") or
            (*type_alias{id}, entity_type = "type_alias") or
            (*variable{id}, entity_type = "variable") or
            (*file{id}, entity_type = "file") or
            (*module{id}, entity_type = "module")
          )`,
        { entityIds: batch }
      );

      // Process results and cache them
      for (const row of queryResult.rows) {
        const entityType = row.entity_type as JustifiableEntityType;
        result.set(row.id, entityType);
        this.cacheEntityType(row.id, entityType);
      }
    }

    logger.debug(
      { total: entityIds.length, cached: entityIds.length - uncachedIds.length, fetched: uncachedIds.length },
      "Bulk entity type lookup complete"
    );

    return result;
  }

  /**
   * Add entity type to cache with LRU eviction
   */
  private cacheEntityType(entityId: string, entityType: JustifiableEntityType): void {
    // Simple LRU: if cache is full, delete oldest entries (first 10%)
    if (this.entityTypeCache.size >= LLMJustificationService.ENTITY_TYPE_CACHE_MAX_SIZE) {
      const entriesToDelete = Math.floor(LLMJustificationService.ENTITY_TYPE_CACHE_MAX_SIZE * 0.1);
      const iterator = this.entityTypeCache.keys();
      for (let i = 0; i < entriesToDelete; i++) {
        const key = iterator.next().value;
        if (key) this.entityTypeCache.delete(key);
      }
    }
    this.entityTypeCache.set(entityId, entityType);
  }

  /**
   * Get lightweight entity info for trivial filtering using bulk queries.
   * This is MUCH faster than building full context for each entity.
   * Only fetches the fields needed for trivial filtering: name, filePath, lineCount, signature, etc.
   */
  private async getLightweightEntityInfos(
    entityIds: string[],
    entityTypeMap: Map<string, JustifiableEntityType>
  ): Promise<EntityInfo[]> {
    const results: EntityInfo[] = [];

    // Group entity IDs by type for efficient bulk queries
    const functionIds: string[] = [];
    const classIds: string[] = [];
    const interfaceIds: string[] = [];
    const fileIds: string[] = [];

    for (const id of entityIds) {
      const type = entityTypeMap.get(id);
      switch (type) {
        case "function":
        case "method":
          functionIds.push(id);
          break;
        case "class":
          classIds.push(id);
          break;
        case "interface":
          interfaceIds.push(id);
          break;
        case "file":
          fileIds.push(id);
          break;
      }
    }

    // Bulk fetch functions (includes methods)
    if (functionIds.length > 0) {
      const fnResult = await this.graphStore.query<{
        id: string;
        name: string;
        file_id: string;
        start_line: number;
        end_line: number;
        signature: string;
        is_exported: boolean;
        doc_comment: string | null;
      }>(
        `?[id, name, file_id, start_line, end_line, signature, is_exported, doc_comment] :=
          *function{id, name, file_id, start_line, end_line, signature, is_exported, doc_comment},
          id in $entityIds`,
        { entityIds: functionIds }
      );

      // Get file paths for these functions in bulk
      const fileIdSet = new Set(fnResult.rows.map((r) => r.file_id));
      const filePathMap = await this.getFilePathsBulk([...fileIdSet]);

      for (const fn of fnResult.rows) {
        results.push({
          id: fn.id,
          name: fn.name,
          type: entityTypeMap.get(fn.id) === "method" ? "method" : "function",
          filePath: filePathMap.get(fn.file_id) || "",
          codeSnippet: fn.signature,
          lineCount: fn.end_line - fn.start_line + 1,
          isExported: fn.is_exported,
          signature: fn.signature,
          docComment: fn.doc_comment || undefined,
        });
      }
    }

    // Bulk fetch classes
    if (classIds.length > 0) {
      const classResult = await this.graphStore.query<{
        id: string;
        name: string;
        file_id: string;
        start_line: number;
        end_line: number;
        is_exported: boolean;
        doc_comment: string | null;
      }>(
        `?[id, name, file_id, start_line, end_line, is_exported, doc_comment] :=
          *class{id, name, file_id, start_line, end_line, is_exported, doc_comment},
          id in $entityIds`,
        { entityIds: classIds }
      );

      const fileIdSet = new Set(classResult.rows.map((r) => r.file_id));
      const filePathMap = await this.getFilePathsBulk([...fileIdSet]);

      for (const cls of classResult.rows) {
        results.push({
          id: cls.id,
          name: cls.name,
          type: "class",
          filePath: filePathMap.get(cls.file_id) || "",
          codeSnippet: `class ${cls.name}`,
          lineCount: cls.end_line - cls.start_line + 1,
          isExported: cls.is_exported,
          docComment: cls.doc_comment || undefined,
        });
      }
    }

    // Bulk fetch interfaces
    if (interfaceIds.length > 0) {
      const ifaceResult = await this.graphStore.query<{
        id: string;
        name: string;
        file_id: string;
        start_line: number;
        end_line: number;
        is_exported: boolean;
        doc_comment: string | null;
      }>(
        `?[id, name, file_id, start_line, end_line, is_exported, doc_comment] :=
          *interface{id, name, file_id, start_line, end_line, is_exported, doc_comment},
          id in $entityIds`,
        { entityIds: interfaceIds }
      );

      const fileIdSet = new Set(ifaceResult.rows.map((r) => r.file_id));
      const filePathMap = await this.getFilePathsBulk([...fileIdSet]);

      for (const iface of ifaceResult.rows) {
        results.push({
          id: iface.id,
          name: iface.name,
          type: "interface",
          filePath: filePathMap.get(iface.file_id) || "",
          codeSnippet: `interface ${iface.name}`,
          lineCount: iface.end_line - iface.start_line + 1,
          isExported: iface.is_exported,
          docComment: iface.doc_comment || undefined,
        });
      }
    }

    // Bulk fetch files
    if (fileIds.length > 0) {
      const fileResult = await this.graphStore.query<{
        id: string;
        relative_path: string;
      }>(
        `?[id, relative_path] := *file{id, relative_path}, id in $entityIds`,
        { entityIds: fileIds }
      );

      for (const file of fileResult.rows) {
        results.push({
          id: file.id,
          name: file.relative_path.split("/").pop() || file.relative_path,
          type: "file",
          filePath: file.relative_path,
          codeSnippet: "",
          lineCount: 1,
          isExported: true,
        });
      }
    }

    return results;
  }

  /**
   * Get file paths for multiple file IDs in bulk
   */
  private async getFilePathsBulk(fileIds: string[]): Promise<Map<string, string>> {
    if (fileIds.length === 0) return new Map();

    const result = await this.graphStore.query<{ id: string; relative_path: string }>(
      `?[id, relative_path] := *file{id, relative_path}, id in $fileIds`,
      { fileIds }
    );

    const map = new Map<string, string>();
    for (const row of result.rows) {
      map.set(row.id, row.relative_path);
    }
    return map;
  }

  // ===========================================================================
  // Context Building & Propagation
  // ===========================================================================

  async buildContext(entityId: string): Promise<JustificationContext> {
    const entityType = await this.getEntityType(entityId);
    if (!entityType) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    const existing = await this.storage.getByEntityIds([entityId]);
    return this.propagator.buildContext(entityId, entityType, existing);
  }

  async propagateContextDown(parentId: string): Promise<void> {
    const parentJustification = await this.storage.getById(parentId);
    if (!parentJustification) return;

    // Get children from hierarchy
    const entityType = await this.getEntityType(parentJustification.entityId);
    if (!entityType) return;

    const filePath = parentJustification.filePath;
    const hierarchy = await this.propagator.buildFileHierarchy(filePath);

    // Find children of this parent
    const parentNode = hierarchy.find(
      (n) => n.entityId === parentJustification.entityId
    );
    if (!parentNode) return;

    for (const childId of parentNode.childIds) {
      const childJustification = await this.storage.getByEntityId(childId);
      if (childJustification) {
        const propagated = this.propagator.propagateDown(
          parentJustification,
          childJustification
        );
        await this.storage.storeJustification(propagated);
      }
    }
  }

  async aggregateContextUp(parentId: string): Promise<EntityJustification> {
    const parentJustification = await this.storage.getByEntityId(parentId);
    if (!parentJustification) {
      throw new Error(`Justification not found for entity: ${parentId}`);
    }

    // Get children
    const filePath = parentJustification.filePath;
    const hierarchy = await this.propagator.buildFileHierarchy(filePath);

    const parentNode = hierarchy.find((n) => n.entityId === parentId);
    if (!parentNode) {
      return parentJustification;
    }

    const childJustifications: EntityJustification[] = [];
    for (const childId of parentNode.childIds) {
      const childJust = await this.storage.getByEntityId(childId);
      if (childJust) {
        childJustifications.push(childJust);
      }
    }

    const aggregated = this.propagator.aggregateUp(
      parentJustification,
      childJustifications
    );

    await this.storage.storeJustification(aggregated);
    return aggregated;
  }

  /**
   * Propagate context for all justified entities
   * Optimized: Uses Map-based lookups instead of O(N) array.find() operations
   */
  private async propagateAllContext(
    justifications: EntityJustification[]
  ): Promise<void> {
    // Group by file
    const byFile = new Map<string, EntityJustification[]>();
    for (const j of justifications) {
      const list = byFile.get(j.filePath) || [];
      list.push(j);
      byFile.set(j.filePath, list);
    }

    // Process each file
    for (const [filePath, fileJustifications] of byFile) {
      const hierarchy = await this.propagator.buildFileHierarchy(filePath);

      // Build a Map for O(1) lookups instead of O(N) find() operations
      const justificationMap = new Map<string, EntityJustification>();
      for (const j of fileJustifications) {
        justificationMap.set(j.entityId, j);
      }

      // Top-down propagation (O(N) with Map vs O(N²) with find)
      const topDown = this.propagator.getTopDownOrder(hierarchy);
      for (const node of topDown) {
        if (!node.parentId) continue;

        const parentJ = justificationMap.get(node.parentId);
        const childJ = justificationMap.get(node.entityId);

        if (parentJ && childJ) {
          const propagated = this.propagator.propagateDown(parentJ, childJ);
          await this.storage.storeJustification(propagated);
          // Update the map with the propagated version
          justificationMap.set(propagated.entityId, propagated);
        }
      }

      // Bottom-up aggregation (O(N) with Map vs O(N²) with filter)
      const bottomUp = this.propagator.getBottomUpOrder(hierarchy);
      for (const node of bottomUp) {
        if (node.childIds.length === 0) continue;

        const parentJ = justificationMap.get(node.entityId);
        if (!parentJ) continue;

        // Use Set for O(1) membership checking instead of includes()
        const childIdSet = new Set(node.childIds);
        const childJs: EntityJustification[] = [];
        for (const [entityId, j] of justificationMap) {
          if (childIdSet.has(entityId)) {
            childJs.push(j);
          }
        }

        if (childJs.length > 0) {
          const aggregated = this.propagator.aggregateUp(parentJ, childJs);
          await this.storage.storeJustification(aggregated);
          // Update the map with the aggregated version
          justificationMap.set(aggregated.entityId, aggregated);
        }
      }
    }
  }

  // ===========================================================================
  // Retrieval
  // ===========================================================================

  async getJustification(entityId: string): Promise<EntityJustification | null> {
    return this.storage.getByEntityId(entityId);
  }

  async getJustifications(
    entityIds: string[]
  ): Promise<Map<string, EntityJustification>> {
    return this.storage.getByEntityIds(entityIds);
  }

  async getFileJustifications(filePath: string): Promise<EntityJustification[]> {
    return this.storage.getByFilePath(filePath);
  }

  async getJustificationHierarchy(
    entityId: string,
    depth?: number
  ): Promise<JustificationHierarchy> {
    const justification = await this.storage.getByEntityId(entityId);
    if (!justification) {
      throw new Error(`Justification not found: ${entityId}`);
    }

    const hierarchy: JustificationHierarchy = {
      justification,
      children: [],
    };

    if (depth === 0) return hierarchy;

    // Get children from file hierarchy
    const fileHierarchy = await this.propagator.buildFileHierarchy(
      justification.filePath
    );
    const node = fileHierarchy.find((n) => n.entityId === entityId);

    if (node) {
      for (const childId of node.childIds) {
        const childHierarchy = await this.getJustificationHierarchy(
          childId,
          depth !== undefined ? depth - 1 : undefined
        );
        hierarchy.children.push(childHierarchy);
      }
    }

    return hierarchy;
  }

  async searchJustifications(
    query: string,
    options?: SearchOptions
  ): Promise<EntityJustification[]> {
    let results = await this.storage.searchByText(query, options?.limit || 50);

    // Apply filters
    if (options?.entityTypes) {
      results = results.filter((j) =>
        options.entityTypes!.includes(j.entityType)
      );
    }

    if (options?.minConfidence !== undefined) {
      results = results.filter(
        (j) => j.confidenceScore >= options.minConfidence!
      );
    }

    if (options?.featureContext) {
      results = results.filter((j) =>
        j.featureContext
          .toLowerCase()
          .includes(options.featureContext!.toLowerCase())
      );
    }

    if (!options?.includePending) {
      results = results.filter((j) => !j.clarificationPending);
    }

    return results.slice(0, options?.limit || 50);
  }

  // ===========================================================================
  // Clarification Workflow
  // ===========================================================================

  async getNextClarificationBatch(
    _maxQuestions?: number
  ): Promise<ClarificationBatch> {
    return this.clarificationEngine.getNextBatch();
  }

  async getAllPendingClarifications(): Promise<ClarificationQuestion[]> {
    return this.storage.getPendingClarifications(1000);
  }

  async applyClarificationAnswers(answers: Map<string, string>): Promise<void> {
    await this.clarificationEngine.applyAnswers(answers);
  }

  async skipClarification(entityId: string): Promise<void> {
    await this.clarificationEngine.skipEntity(entityId);
  }

  async setUserJustification(
    entityId: string,
    input: UserJustificationInput
  ): Promise<EntityJustification> {
    let justification = await this.storage.getByEntityId(entityId);

    if (!justification) {
      const entityType = await this.getEntityType(entityId);
      if (!entityType) {
        throw new Error(`Entity not found: ${entityId}`);
      }

      // Get entity details for name and file path
      const context = await this.buildContext(entityId);

      justification = createEntityJustification({
        id: `just-${entityId}`,
        entityId,
        entityType,
        name: context.entity.name,
        filePath: context.entity.filePath,
      });
    }

    // Apply user input
    const updated: EntityJustification = {
      ...justification,
      purposeSummary: input.purposeSummary || justification.purposeSummary,
      businessValue: input.businessValue || justification.businessValue,
      featureContext: input.featureContext || justification.featureContext,
      detailedDescription:
        input.detailedDescription || justification.detailedDescription,
      tags: input.tags || justification.tags,
      inferredFrom: "user_provided",
      confidenceScore: 1.0,
      confidenceLevel: "high",
      clarificationPending: false,
      pendingQuestions: [],
      lastConfirmedByUser: Date.now(),
      updatedAt: Date.now(),
      version: justification.version + 1,
    };

    await this.storage.storeJustification(updated);
    return updated;
  }

  // ===========================================================================
  // Statistics & Reporting
  // ===========================================================================

  async getStats(): Promise<JustificationStats> {
    return this.storage.getStats();
  }

  async getCoverageByFile(): Promise<Map<string, FileCoverage>> {
    const result = new Map<string, FileCoverage>();

    // Get all files
    const files = await this.graphStore.query<{ id: string; relativePath: string }>(
      `?[id, relative_path] := *file{id, relative_path}`
    );

    for (const file of files.rows) {
      const justifications = await this.storage.getByFilePath(file.relativePath);

      // Count entities in file
      type CountRow = Record<string, number>;
      const functionsResult = await this.graphStore.query<CountRow>(
        `?[count(id)] := *function{id, file_id}, file_id = $fileId`,
        { fileId: file.id }
      );
      const classesResult = await this.graphStore.query<CountRow>(
        `?[count(id)] := *class{id, file_id}, file_id = $fileId`,
        { fileId: file.id }
      );

      const getCount = (row?: CountRow): number => {
        if (!row) return 0;
        const values = Object.values(row);
        return typeof values[0] === "number" ? values[0] : 0;
      };

      const totalEntities =
        getCount(functionsResult.rows[0]) +
        getCount(classesResult.rows[0]) +
        1; // +1 for file itself

      const highConfidence = justifications.filter(
        (j) => j.confidenceScore >= 0.8
      ).length;
      const pendingClarification = justifications.filter(
        (j) => j.clarificationPending
      ).length;

      result.set(file.relativePath, {
        filePath: file.relativePath,
        totalEntities,
        justifiedEntities: justifications.length,
        highConfidence,
        pendingClarification,
        coveragePercentage:
          totalEntities > 0 ? (justifications.length / totalEntities) * 100 : 0,
      });
    }

    return result;
  }

  async getFeatureJustifications(): Promise<FeatureJustification[]> {
    // Get all justifications
    const allResult = await this.graphStore.query<{
      featureContext: string;
    }>(
      `?[feature_context] := *justification{feature_context}, feature_context != "General", feature_context != ""`
    );

    // Group by feature
    const featureCounts = new Map<string, number>();
    for (const row of allResult.rows) {
      const count = featureCounts.get(row.featureContext) || 0;
      featureCounts.set(row.featureContext, count + 1);
    }

    const features: FeatureJustification[] = [];

    for (const [featureName, _count] of featureCounts) {
      const entities = await this.storage.searchByText(featureName, 100);
      const featureEntities = entities.filter(
        (e) => e.featureContext === featureName
      );

      if (featureEntities.length === 0) continue;

      const overallConfidence =
        featureEntities.reduce((sum, e) => sum + e.confidenceScore, 0) /
        featureEntities.length;

      features.push({
        featureName,
        description: `${featureName} functionality`,
        entities: featureEntities,
        overallConfidence,
        coveragePercentage: 100, // All entities in this feature
      });
    }

    return features.sort((a, b) => b.entities.length - a.entities.length);
  }

  async getEntitiesNeedingAttention(): Promise<EntityJustification[]> {
    return this.storage.getEntitiesNeedingClarification();
  }

  // ===========================================================================
  // Maintenance
  // ===========================================================================

  async deleteJustification(entityId: string): Promise<void> {
    await this.storage.deleteByEntityId(entityId);
  }

  async deleteFileJustifications(filePath: string): Promise<void> {
    await this.storage.deleteByFilePath(filePath);
  }

  async clearAllJustifications(): Promise<void> {
    await this.storage.clearAll();
  }

  /**
   * Execute a function with exponential backoff retry for specific errors
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    contextId: string,
    maxRetries: number = 3,
    initialDelayMs: number = 5000
  ): Promise<T> {
    let lastError: any;
    let delay = initialDelayMs;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check if error is retryable (5XX or JSON parse error)
        const isModelOverloaded = errorMessage.includes("503") || errorMessage.includes("overloaded");
        const isParseError = errorMessage.includes("Failed to parse") || errorMessage.includes("JSON");
        const isFetchFailed = errorMessage.includes("fetch failed");

        if (attempt <= maxRetries && (isModelOverloaded || isParseError || isFetchFailed)) {
          logger.warn(
            { contextId, attempt, delay, error: errorMessage },
            `Retryable error encountered, waiting ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = initialDelayMs * (attempt + 1); // Linear increase (5, 10, 15)
        } else {
          // Final failure or non-retryable
          break;
        }
      }
    }

    // Log to file if completely failed
    this.logFailureToFile(contextId, lastError);
    throw lastError;
  }

  /**
   * Log failure details to a file for persistent tracking
   */
  private logFailureToFile(contextId: string, error: any): void {
    try {
      const logFile = path.resolve(process.cwd(), "llm_failures.log");
      const timestamp = new Date().toISOString();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : "";

      const logEntry = `[${timestamp}] [${contextId}] FAILED\nError: ${errorMessage}\nStack: ${errorStack}\n----------------------------------------\n`;

      fs.appendFileSync(logFile, logEntry);
    } catch (fsError) {
      logger.error({ err: fsError }, "Failed to write to llm_failures.log");
    }
  }

  /**
   * Bulk get file hashes for multiple entities (for incremental updates)
   */
  private async getEntityFileHashes(entityIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (entityIds.length === 0) return result;

    // Process in chunks to avoid query limits
    const BATCH_SIZE = 500;
    for (let i = 0; i < entityIds.length; i += BATCH_SIZE) {
      const batch = entityIds.slice(i, i + BATCH_SIZE);
      try {
        const queryResult = await this.graphStore.query<{ id: string; hash: string }>(
          `?[id, hash] :=
            id in $entityIds,
            (
              (*function{id, fileId}, *file{id: fileId, hash}) or
              (*class{id, fileId}, *file{id: fileId, hash}) or
              (*interface{id, fileId}, *file{id: fileId, hash}) or
              (*type_alias{id, fileId}, *file{id: fileId, hash}) or
              (*variable{id, fileId}, *file{id: fileId, hash}) or
              (*file{id, hash})
            )`,
          { entityIds: batch }
        );

        for (const row of queryResult.rows) {
          if (row.hash) {
            result.set(row.id, row.hash);
          }
        }
      } catch (error) {
        logger.warn({ error }, "Failed to fetch entity file hashes");
      }
    }
    return result;
  }

  /**
   * Get hashes for file paths
   */
  private async getFileHashes(filePaths: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (filePaths.length === 0) return result;

    const uniquePaths = [...new Set(filePaths)];
    const BATCH_SIZE = 500;

    for (let i = 0; i < uniquePaths.length; i += BATCH_SIZE) {
      const batch = uniquePaths.slice(i, i + BATCH_SIZE);
      try {
        const queryResult = await this.graphStore.query<{ path: string; hash: string }>(
          `?[path, hash] := *file{path, hash}, path in $paths`,
          { paths: batch }
        );

        for (const row of queryResult.rows) {
          if (row.hash) {
            result.set(row.path, row.hash);
          }
        }
      } catch (error) {
        logger.warn({ error }, "Failed to fetch file hashes");
      }
    }
    return result;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an LLM justification service instance
 */
export function createLLMJustificationService(
  graphStore: IGraphStore,
  modelRouter?: IModelRouter
): LLMJustificationService {
  return new LLMJustificationService(graphStore, modelRouter);
}

/**
 * Create and initialize an LLM justification service
 */
export async function createInitializedJustificationService(
  graphStore: IGraphStore,
  modelRouter?: IModelRouter
): Promise<LLMJustificationService> {
  const service = new LLMJustificationService(graphStore, modelRouter);
  await service.initialize();
  return service;
}

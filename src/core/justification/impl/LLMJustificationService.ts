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
import type { LLMService } from "../../llm/llm-service.js";
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
} from "../prompts/justification-prompts.js";

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
  },
  required: ["purposeSummary", "businessValue", "confidenceScore"],
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
};

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

  constructor(
    private graphStore: IGraphStore,
    private llmService?: LLMService
  ) {
    this.storage = createJustificationStorage(graphStore);
    this.propagator = createContextPropagator(graphStore);
    this.clarificationEngine = createClarificationEngine(this.storage);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async initialize(): Promise<void> {
    logger.info("Initializing justification service");

    if (!this.graphStore.isReady) {
      throw new Error("Graph store not initialized");
    }

    // LLM service is optional - we can work without it using defaults
    if (this.llmService && !this.llmService.isReady()) {
      logger.warn("LLM service not ready - justifications will use fallback inference");
    }

    this.ready = true;
    logger.info("Justification service initialized");
  }

  async close(): Promise<void> {
    logger.info("Closing justification service");
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
    const existing = await this.storage.getByEntityIds(entityIds);

    // Filter entities that need justification
    const toProcess = entityIds.filter((id) => {
      if (opts.force) return true;
      const existing_j = existing.get(id);
      return !existing_j || existing_j.confidenceScore < opts.minConfidence!;
    });

    result.stats.skipped = entityIds.length - toProcess.length;

    logger.info({ total: entityIds.length, toProcess: toProcess.length }, "Starting justification");

    // Process in batches
    for (let i = 0; i < toProcess.length; i += opts.batchSize!) {
      const batch = toProcess.slice(i, i + opts.batchSize!);

      for (const entityId of batch) {
        try {
          // Report progress
          if (opts.onProgress) {
            opts.onProgress({
              phase: "inferring",
              current: i + batch.indexOf(entityId) + 1,
              total: toProcess.length,
              currentEntity: entityId,
            });
          }

          const justification = await this.justifyEntity(entityId, existing, opts);

          if (justification.clarificationPending) {
            result.needingClarification.push(justification);
            result.stats.pendingClarification++;
          } else {
            result.justified.push(justification);
            result.stats.succeeded++;
          }
        } catch (error) {
          logger.error({ entityId, error }, "Failed to justify entity");
          result.failed.push({
            entityId,
            error: error instanceof Error ? error.message : String(error),
          });
          result.stats.failed++;
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

    logger.info(
      {
        succeeded: result.stats.succeeded,
        failed: result.stats.failed,
        pending: result.stats.pendingClarification,
        durationMs: result.stats.durationMs,
      },
      "Justification complete"
    );

    return result;
  }

  async justifyFile(filePath: string, options?: JustifyOptions): Promise<JustificationResult> {
    // Get all entity IDs in the file
    const hierarchy = await this.propagator.buildFileHierarchy(filePath);
    const entityIds = hierarchy.map((node) => node.entityId);

    return this.justifyEntities(entityIds, options);
  }

  async justifyProject(options?: JustifyOptions): Promise<JustificationResult> {
    // Get all files
    const result = await this.graphStore.query<{ id: string }>(
      `?[id] := *File{id}`
    );

    const allEntityIds: string[] = [];

    // Get entities from each file
    for (const { id: fileId } of result.rows) {
      // Get functions
      const functions = await this.graphStore.query<{ id: string }>(
        `?[id] := *Function{id, fileId}, fileId = $fileId`,
        { fileId }
      );
      allEntityIds.push(...functions.rows.map((r) => r.id));

      // Get classes
      const classes = await this.graphStore.query<{ id: string }>(
        `?[id] := *Class{id, fileId}, fileId = $fileId`,
        { fileId }
      );
      allEntityIds.push(...classes.rows.map((r) => r.id));

      // Get interfaces
      const interfaces = await this.graphStore.query<{ id: string }>(
        `?[id] := *Interface{id, fileId}, fileId = $fileId`,
        { fileId }
      );
      allEntityIds.push(...interfaces.rows.map((r) => r.id));

      // Add file itself
      allEntityIds.push(fileId);
    }

    return this.justifyEntities(allEntityIds, options);
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

    if (this.llmService?.isReady() && !options.skipLLM) {
      try {
        const inferenceResult = await this.llmService.complete(
          `${JUSTIFICATION_SYSTEM_PROMPT}\n\n${prompt}`,
          {
            maxTokens: 1024,
            temperature: 0.3,
            jsonSchema: JUSTIFICATION_JSON_SCHEMA,
          }
        );

        const parsed = parseJustificationResponse(inferenceResult.text);
        llmResponse = parsed || createDefaultResponse(context.entity);
      } catch (error) {
        logger.warn({ entityId, error }, "LLM inference failed, using defaults");
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
      purposeSummary: llmResponse.purposeSummary,
      businessValue: llmResponse.businessValue,
      featureContext: llmResponse.featureContext,
      detailedDescription: llmResponse.detailedDescription,
      tags: llmResponse.tags,
      inferredFrom: this.llmService?.isReady() ? "llm_inferred" : "file_name",
      confidenceScore: llmResponse.confidenceScore,
      confidenceLevel: scoreToConfidenceLevel(llmResponse.confidenceScore),
      reasoning: llmResponse.reasoning,
      evidenceSources: [context.entity.filePath],
      parentJustificationId: context.parentContext?.justification?.id || null,
      hierarchyDepth: context.parentContext ? 1 : 0,
      clarificationPending: llmResponse.needsClarification,
      pendingQuestions: llmResponse.clarificationQuestions.map((q, i) =>
        createClarificationQuestion({
          id: `q-${entityId}-${i}`,
          question: q,
          entityId,
          category: "purpose",
          priority: i,
        })
      ),
      createdAt: now,
      updatedAt: now,
    });

    // Store
    await this.storage.storeJustification(justification);

    return justification;
  }

  /**
   * Infer justification from code analysis only (no LLM)
   */
  private inferFromCodeAnalysis(context: JustificationContext): LLMJustificationResponse {
    const entity = context.entity;
    const name = entity.name;

    // Infer from naming patterns
    let purposeSummary = `${entity.type} named ${name}`;
    let businessValue = "Provides functionality";
    let featureContext = "General";
    const tags: string[] = [];
    let confidenceScore = 0.3;

    // Extract feature from path
    const pathParts = entity.filePath.split("/");
    for (const part of pathParts) {
      if (["auth", "authentication"].includes(part.toLowerCase())) {
        featureContext = "Authentication";
        tags.push("security");
        break;
      }
      if (["api", "routes", "endpoints"].includes(part.toLowerCase())) {
        featureContext = "API";
        tags.push("api");
        break;
      }
      if (["cli", "commands"].includes(part.toLowerCase())) {
        featureContext = "CLI";
        tags.push("cli");
        break;
      }
      if (["core"].includes(part.toLowerCase())) {
        featureContext = "Core";
        break;
      }
    }

    // Naming pattern inference
    if (/Handler$/.test(name)) {
      purposeSummary = `Handles ${name.replace(/Handler$/, "")} operations`;
      tags.push("handler");
      confidenceScore = 0.5;
    } else if (/Service$/.test(name)) {
      purposeSummary = `Provides ${name.replace(/Service$/, "")} services`;
      businessValue = "Core service component";
      tags.push("service");
      confidenceScore = 0.5;
    } else if (/Controller$/.test(name)) {
      purposeSummary = `Controls ${name.replace(/Controller$/, "")} flow`;
      tags.push("controller");
      confidenceScore = 0.5;
    } else if (/Factory$/.test(name)) {
      purposeSummary = `Creates ${name.replace(/Factory$/, "")} instances`;
      tags.push("factory");
      confidenceScore = 0.5;
    } else if (/^create/.test(name)) {
      purposeSummary = `Creates and initializes ${name.replace(/^create/, "")}`;
      tags.push("factory");
      confidenceScore = 0.4;
    } else if (/^get/.test(name)) {
      purposeSummary = `Retrieves ${name.replace(/^get/, "")}`;
      tags.push("getter");
      confidenceScore = 0.4;
    } else if (/^set/.test(name)) {
      purposeSummary = `Updates ${name.replace(/^set/, "")}`;
      tags.push("setter");
      confidenceScore = 0.4;
    } else if (/^validate/.test(name)) {
      purposeSummary = `Validates ${name.replace(/^validate/, "")}`;
      tags.push("validation");
      confidenceScore = 0.5;
    } else if (/^parse/.test(name)) {
      purposeSummary = `Parses ${name.replace(/^parse/, "")}`;
      tags.push("parsing");
      confidenceScore = 0.5;
    } else if (/^render/.test(name)) {
      purposeSummary = `Renders ${name.replace(/^render/, "")}`;
      tags.push("ui");
      featureContext = "UI";
      confidenceScore = 0.5;
    } else if (/^handle/.test(name)) {
      purposeSummary = `Handles ${name.replace(/^handle/, "")}`;
      tags.push("handler");
      confidenceScore = 0.4;
    }

    // Use doc comment if available
    if (entity.docComment) {
      const firstLine = (entity.docComment.split("\n")[0] || "").replace(/^\*?\s*/, "");
      if (firstLine.length > 10) {
        purposeSummary = firstLine;
        confidenceScore = Math.min(0.7, confidenceScore + 0.2);
      }
    }

    // Use parent context if available
    if (context.parentContext?.justification) {
      businessValue = `Part of ${context.parentContext.justification.featureContext}`;
      if (!featureContext || featureContext === "General") {
        featureContext = context.parentContext.justification.featureContext;
      }
      confidenceScore = Math.min(0.8, confidenceScore + 0.1);
    }

    return {
      purposeSummary,
      businessValue,
      featureContext,
      detailedDescription: "",
      tags,
      confidenceScore,
      reasoning: "Inferred from code structure and naming patterns",
      needsClarification: confidenceScore < 0.5,
      clarificationQuestions:
        confidenceScore < 0.5 ? [`What is the purpose of ${name}?`] : [],
    };
  }

  /**
   * Get entity type from ID
   */
  private async getEntityType(entityId: string): Promise<JustifiableEntityType | null> {
    // Check each entity table
    const tables: Array<{ table: string; type: JustifiableEntityType }> = [
      { table: "Function", type: "function" },
      { table: "Class", type: "class" },
      { table: "Interface", type: "interface" },
      { table: "TypeAlias", type: "type_alias" },
      { table: "Variable", type: "variable" },
      { table: "File", type: "file" },
      { table: "Module", type: "module" },
    ];

    for (const { table, type } of tables) {
      const result = await this.graphStore.query<{ id: string }>(
        `?[id] := *${table}{id}, id = $entityId`,
        { entityId }
      );
      if (result.rows.length > 0) {
        return type;
      }
    }

    return null;
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

      // Top-down propagation
      const topDown = this.propagator.getTopDownOrder(hierarchy);
      for (const node of topDown) {
        const parentJ = fileJustifications.find(
          (j) => j.entityId === node.parentId
        );
        const childJ = fileJustifications.find(
          (j) => j.entityId === node.entityId
        );

        if (parentJ && childJ) {
          const propagated = this.propagator.propagateDown(parentJ, childJ);
          await this.storage.storeJustification(propagated);
        }
      }

      // Bottom-up aggregation
      const bottomUp = this.propagator.getBottomUpOrder(hierarchy);
      for (const node of bottomUp) {
        if (node.childIds.length > 0) {
          const parentJ = fileJustifications.find(
            (j) => j.entityId === node.entityId
          );
          if (parentJ) {
            const childJs = fileJustifications.filter((j) =>
              node.childIds.includes(j.entityId)
            );
            const aggregated = this.propagator.aggregateUp(parentJ, childJs);
            await this.storage.storeJustification(aggregated);
          }
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
      `?[id, relativePath] := *File{id, relativePath}`
    );

    for (const file of files.rows) {
      const justifications = await this.storage.getByFilePath(file.relativePath);

      // Count entities in file
      type CountRow = Record<string, number>;
      const functionsResult = await this.graphStore.query<CountRow>(
        `?[count(id)] := *Function{id, fileId}, fileId = $fileId`,
        { fileId: file.id }
      );
      const classesResult = await this.graphStore.query<CountRow>(
        `?[count(id)] := *Class{id, fileId}, fileId = $fileId`,
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
      `?[featureContext] := *Justification{featureContext}, featureContext != "General", featureContext != ""`
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
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an LLM justification service instance
 */
export function createLLMJustificationService(
  graphStore: IGraphStore,
  llmService?: LLMService
): LLMJustificationService {
  return new LLMJustificationService(graphStore, llmService);
}

/**
 * Create and initialize an LLM justification service
 */
export async function createInitializedJustificationService(
  graphStore: IGraphStore,
  llmService?: LLMService
): Promise<LLMJustificationService> {
  const service = new LLMJustificationService(graphStore, llmService);
  await service.initialize();
  return service;
}

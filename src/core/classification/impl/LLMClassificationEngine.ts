/**
 * LLM Classification Engine
 *
 * Uses local LLM to classify code entities as Domain or Infrastructure.
 * Integrates with justification data when available.
 */

import type {
  IClassificationEngine,
  IClassificationStorage,
  ClassificationEngineConfig,
  QueryOptions,
  SearchOptions,
} from "../interfaces/IClassificationEngine.js";
import type {
  ClassificationRequest,
  ClassificationResult,
  BatchClassificationRequest,
  BatchClassificationResult,
  EntityClassification,
  ClassificationStats,
  ClassificationCategory,
  DomainArea,
  InfrastructureLayer,
} from "../models/classification.js";
import {
  createDomainClassification,
  createInfrastructureClassification,
  DomainAreaSchema,
  InfrastructureLayerSchema,
} from "../models/classification.js";
import type { ILLMService } from "../../llm/interfaces/ILLMService.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("classification-engine");

// =============================================================================
// Pattern-Based Classification
// =============================================================================

/**
 * Pattern indicators for domain classification
 */
const DOMAIN_PATTERNS: Record<DomainArea, RegExp[]> = {
  authentication: [/auth/i, /login/i, /logout/i, /signin/i, /signout/i, /oauth/i, /sso/i],
  authorization: [/permission/i, /role/i, /access.?control/i, /rbac/i, /acl/i, /authorize/i],
  "user-management": [/user/i, /account/i, /profile/i, /registration/i, /onboard/i],
  billing: [/bill/i, /invoice/i, /charge/i, /price/i, /cost/i],
  payments: [/payment/i, /pay/i, /checkout/i, /stripe/i, /paypal/i, /transaction/i],
  subscriptions: [/subscription/i, /subscribe/i, /plan/i, /tier/i, /recurring/i],
  notifications: [/notification/i, /notify/i, /alert/i, /email/i, /sms/i, /push/i],
  messaging: [/message/i, /chat/i, /inbox/i, /conversation/i, /dm/i],
  reporting: [/report/i, /export/i, /download/i, /generate.*report/i],
  analytics: [/analytics/i, /metric/i, /stat/i, /track/i, /event/i, /telemetry/i],
  search: [/search/i, /find/i, /query/i, /filter/i, /index/i],
  "content-management": [/content/i, /cms/i, /article/i, /post/i, /page/i, /blog/i],
  "file-management": [/file/i, /upload/i, /download/i, /storage/i, /asset/i, /media/i],
  workflow: [/workflow/i, /step/i, /stage/i, /pipeline/i, /process/i],
  scheduling: [/schedule/i, /calendar/i, /appointment/i, /booking/i, /cron/i, /job/i],
  integration: [/webhook/i, /callback/i, /sync/i, /import/i, /connector/i],
  "api-gateway": [/gateway/i, /proxy/i, /route/i, /endpoint/i, /middleware/i],
  "other-business": [],
};

/**
 * Pattern indicators for infrastructure classification
 */
const INFRASTRUCTURE_PATTERNS: Record<InfrastructureLayer, RegExp[]> = {
  database: [/database/i, /db/i, /sql/i, /query/i, /repository/i, /dao/i, /orm/i, /mongo/i, /postgres/i, /mysql/i, /cozo/i],
  cache: [/cache/i, /redis/i, /memcache/i, /lru/i, /ttl/i],
  "message-queue": [/queue/i, /kafka/i, /rabbitmq/i, /pubsub/i, /amqp/i, /sqs/i],
  "http-client": [/http/i, /fetch/i, /axios/i, /request/i, /client/i, /api.*call/i],
  "http-server": [/express/i, /fastify/i, /koa/i, /hapi/i, /server/i, /router/i, /middleware/i],
  logging: [/log/i, /logger/i, /pino/i, /winston/i, /debug/i],
  monitoring: [/monitor/i, /health/i, /heartbeat/i, /prometheus/i, /grafana/i],
  tracing: [/trace/i, /span/i, /opentelemetry/i, /jaeger/i, /zipkin/i],
  configuration: [/config/i, /env/i, /setting/i, /option/i],
  security: [/encrypt/i, /decrypt/i, /hash/i, /crypto/i, /jwt/i, /token/i, /secret/i],
  serialization: [/serialize/i, /deserialize/i, /json/i, /xml/i, /protobuf/i, /marshal/i],
  validation: [/valid/i, /schema/i, /zod/i, /yup/i, /joi/i, /sanitize/i],
  "error-handling": [/error/i, /exception/i, /throw/i, /catch/i, /handler/i],
  testing: [/test/i, /mock/i, /stub/i, /fixture/i, /spec/i, /vitest/i, /jest/i],
  "build-tools": [/build/i, /bundle/i, /webpack/i, /vite/i, /esbuild/i, /rollup/i],
  deployment: [/deploy/i, /docker/i, /k8s/i, /kubernetes/i, /ci/i, /cd/i],
  "sdk-client": [/sdk/i, /client/i, /api/i, /service/i],
  utility: [/util/i, /helper/i, /common/i, /shared/i, /lib/i],
  "other-infrastructure": [],
};

/**
 * Known infrastructure libraries
 */
const KNOWN_LIBRARIES: Record<string, { layer: InfrastructureLayer; patterns: RegExp[] }> = {
  redis: { layer: "cache", patterns: [/redis/i, /ioredis/i] },
  postgres: { layer: "database", patterns: [/pg/i, /postgres/i, /knex/i] },
  mongodb: { layer: "database", patterns: [/mongo/i, /mongoose/i] },
  axios: { layer: "http-client", patterns: [/axios/i] },
  pino: { layer: "logging", patterns: [/pino/i] },
  winston: { layer: "logging", patterns: [/winston/i] },
  zod: { layer: "validation", patterns: [/zod/i] },
  express: { layer: "http-server", patterns: [/express/i] },
  fastify: { layer: "http-server", patterns: [/fastify/i] },
};

// =============================================================================
// Classification Prompt
// =============================================================================

const CLASSIFICATION_PROMPT = `You are a code classifier. Analyze the following code entity and classify it as either:

1. DOMAIN - Business logic, product features, user-facing functionality
   - Examples: Authentication, Payments, User Management, Billing, Notifications

2. INFRASTRUCTURE - Platform services, utilities, cross-cutting concerns
   - Examples: Database, Cache, Logging, HTTP Client, Validation, Configuration

Entity Information:
- Name: {entityName}
- Type: {entityType}
- File: {filePath}
- Code:
\`\`\`
{sourceCode}
\`\`\`

{justificationContext}

Imports: {imports}

Respond in this exact JSON format:
{
  "category": "domain" | "infrastructure",
  "area": "<specific area like 'authentication' or 'database'>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation>",
  "indicators": ["<indicator1>", "<indicator2>"],
  "library": "<library name if infrastructure, null otherwise>",
  "libraryVersion": "<version if known, null otherwise>"
}`;

const CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: { enum: ["domain", "infrastructure"] },
    area: { type: "string" },
    confidence: { type: "number" },
    reasoning: { type: "string" },
    indicators: { type: "array", items: { type: "string" } },
    library: { type: ["string", "null"] },
    libraryVersion: { type: ["string", "null"] },
  },
  required: ["category", "area", "confidence"],
};

// =============================================================================
// Implementation
// =============================================================================

export class LLMClassificationEngine implements IClassificationEngine {
  private storage: IClassificationStorage;
  private llm: ILLMService | null;
  private config: ClassificationEngineConfig;
  private initialized = false;

  constructor(
    storage: IClassificationStorage,
    llm: ILLMService | null,
    config: ClassificationEngineConfig
  ) {
    this.storage = storage;
    this.llm = llm;
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.storage.initialize();
    this.initialized = true;
    logger.info("Classification engine initialized");
  }

  async classify(request: ClassificationRequest): Promise<ClassificationResult> {
    const startTime = Date.now();

    try {
      // Try pattern-based classification first
      if (this.config.usePatterns) {
        const patternResult = this.classifyByPattern(request);
        if (patternResult && patternResult.confidence >= this.config.confidenceThreshold) {
          await this.storage.store(patternResult);
          return {
            success: true,
            classification: patternResult,
            processingTimeMs: Date.now() - startTime,
          };
        }
      }

      // Try dependency-based classification
      if (this.config.useDependencyAnalysis) {
        const depResult = this.classifyByDependency(request);
        if (depResult && depResult.confidence >= this.config.confidenceThreshold) {
          await this.storage.store(depResult);
          return {
            success: true,
            classification: depResult,
            processingTimeMs: Date.now() - startTime,
          };
        }
      }

      // Fall back to LLM classification
      if (this.config.useLLM && this.llm) {
        const llmResult = await this.classifyByLLM(request);
        if (llmResult) {
          await this.storage.store(llmResult);
          return {
            success: true,
            classification: llmResult,
            processingTimeMs: Date.now() - startTime,
          };
        }
      }

      // Return unknown classification
      const unknownClassification: EntityClassification = {
        entityId: request.entityId,
        entityType: request.entityType,
        entityName: request.entityName,
        filePath: request.filePath,
        category: "unknown",
        confidence: 0,
        classificationMethod: "heuristic",
        reasoning: "Could not determine classification",
        indicators: [],
        relatedEntities: [],
        dependsOn: [],
        usedBy: [],
        classifiedAt: new Date().toISOString(),
        classifiedBy: "system",
        version: 1,
      };

      await this.storage.store(unknownClassification);
      return {
        success: true,
        classification: unknownClassification,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      logger.error({ error, entityId: request.entityId }, "Classification failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  async classifyBatch(request: BatchClassificationRequest): Promise<BatchClassificationResult> {
    const startTime = Date.now();
    const results: EntityClassification[] = [];
    const errors: { entityId: string; error: string }[] = [];
    let skipped = 0;

    for (const entity of request.entities) {
      // Skip if exists and skipExisting is true
      if (request.options?.skipExisting !== false) {
        const exists = await this.storage.exists(entity.entityId);
        if (exists) {
          skipped++;
          continue;
        }
      }

      const result = await this.classify(entity);
      if (result.success && result.classification) {
        results.push(result.classification);
      } else {
        errors.push({
          entityId: entity.entityId,
          error: result.error ?? "Unknown error",
        });
      }
    }

    return {
      total: request.entities.length,
      successful: results.length,
      failed: errors.length,
      skipped,
      classifications: results,
      errors,
      processingTimeMs: Date.now() - startTime,
    };
  }

  async getClassification(entityId: string): Promise<EntityClassification | null> {
    return this.storage.get(entityId);
  }

  async updateClassification(
    entityId: string,
    updates: Partial<EntityClassification>
  ): Promise<EntityClassification | null> {
    return this.storage.update(entityId, updates);
  }

  async deleteClassification(entityId: string): Promise<boolean> {
    return this.storage.delete(entityId);
  }

  async queryByCategory(
    category: ClassificationCategory,
    options?: QueryOptions
  ): Promise<EntityClassification[]> {
    return this.storage.queryByCategory(category, options);
  }

  async queryDomainByArea(
    area: DomainArea,
    options?: QueryOptions
  ): Promise<EntityClassification[]> {
    return this.storage.queryDomainByArea(area, options);
  }

  async queryInfrastructureByLayer(
    layer: InfrastructureLayer,
    options?: QueryOptions
  ): Promise<EntityClassification[]> {
    return this.storage.queryInfrastructureByLayer(layer, options);
  }

  async search(query: string, options?: SearchOptions): Promise<EntityClassification[]> {
    return this.storage.search(query, options);
  }

  async getStats(): Promise<ClassificationStats> {
    return this.storage.getStats();
  }

  async getClassificationsForFile(filePath: string): Promise<EntityClassification[]> {
    return this.storage.getByFile(filePath);
  }

  async getClassificationsByLibrary(library: string): Promise<EntityClassification[]> {
    return this.storage.getByLibrary(library);
  }

  async reclassifyChanged(entityIds: string[]): Promise<BatchClassificationResult> {
    // Delete existing and reclassify
    for (const entityId of entityIds) {
      await this.storage.delete(entityId);
    }

    // Note: Would need to get entity data from graph to reclassify
    // For now, return empty result
    return {
      total: entityIds.length,
      successful: 0,
      failed: 0,
      skipped: entityIds.length,
      classifications: [],
      errors: [],
      processingTimeMs: 0,
    };
  }

  async confirmClassification(
    entityId: string,
    confirmed: boolean,
    correction?: {
      category?: ClassificationCategory;
      area?: DomainArea;
      layer?: InfrastructureLayer;
    }
  ): Promise<EntityClassification | null> {
    const existing = await this.storage.get(entityId);
    if (!existing) return null;

    const updates: Partial<EntityClassification> = {
      classificationMethod: "user",
      confidence: confirmed ? 1.0 : existing.confidence,
    };

    if (correction) {
      if (correction.category) {
        updates.category = correction.category;
      }
      if (correction.area && correction.category === "domain") {
        updates.domainMetadata = {
          area: correction.area,
          userFacing: existing.domainMetadata?.userFacing ?? false,
          revenueImpact: existing.domainMetadata?.revenueImpact ?? "none",
          featureArea: existing.domainMetadata?.featureArea,
          businessCapability: existing.domainMetadata?.businessCapability,
        };
      }
      if (correction.layer && correction.category === "infrastructure") {
        updates.infrastructureMetadata = {
          layer: correction.layer,
          isWrapper: existing.infrastructureMetadata?.isWrapper ?? false,
          library: existing.infrastructureMetadata?.library,
          libraryVersion: existing.infrastructureMetadata?.libraryVersion,
          runtimePlatform: existing.infrastructureMetadata?.runtimePlatform,
          crossCutting: existing.infrastructureMetadata?.crossCutting ?? true,
          dependencySource: existing.infrastructureMetadata?.dependencySource,
          affectedLayers: existing.infrastructureMetadata?.affectedLayers ?? [],
          wrappedLibrary: existing.infrastructureMetadata?.wrappedLibrary,
        };
      }
    }

    return this.storage.update(entityId, updates);
  }

  async shutdown(): Promise<void> {
    logger.info("Classification engine shutting down");
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private classifyByPattern(request: ClassificationRequest): EntityClassification | null {
    const text = `${request.entityName} ${request.filePath} ${request.sourceCode ?? ""}`;

    // Check domain patterns
    for (const [area, patterns] of Object.entries(DOMAIN_PATTERNS)) {
      const matchCount = patterns.filter((p) => p.test(text)).length;
      if (matchCount > 0) {
        const confidence = Math.min(0.5 + matchCount * 0.1, 0.9);
        return createDomainClassification(
          request.entityId,
          request.entityType,
          request.entityName,
          request.filePath,
          area as DomainArea,
          confidence,
          `Pattern match: ${area}`,
          {}
        );
      }
    }

    // Check infrastructure patterns
    for (const [layer, patterns] of Object.entries(INFRASTRUCTURE_PATTERNS)) {
      const matchCount = patterns.filter((p) => p.test(text)).length;
      if (matchCount > 0) {
        const confidence = Math.min(0.5 + matchCount * 0.1, 0.9);
        return createInfrastructureClassification(
          request.entityId,
          request.entityType,
          request.entityName,
          request.filePath,
          layer as InfrastructureLayer,
          confidence,
          `Pattern match: ${layer}`,
          {}
        );
      }
    }

    return null;
  }

  private classifyByDependency(request: ClassificationRequest): EntityClassification | null {
    const allImports = [...request.imports, ...request.fileImports, ...request.packageDependencies];
    const importText = allImports.join(" ");

    // Check known libraries
    for (const [lib, info] of Object.entries(KNOWN_LIBRARIES)) {
      if (info.patterns.some((p) => p.test(importText))) {
        return createInfrastructureClassification(
          request.entityId,
          request.entityType,
          request.entityName,
          request.filePath,
          info.layer,
          0.8,
          `Uses ${lib} library`,
          { library: lib }
        );
      }
    }

    return null;
  }

  private async classifyByLLM(request: ClassificationRequest): Promise<EntityClassification | null> {
    if (!this.llm) return null;

    try {
      const justificationContext = request.justification
        ? `Business Context:
- Purpose: ${request.justification.purposeSummary}
- Business Value: ${request.justification.businessValue}
- Feature: ${request.justification.featureContext}`
        : "";

      const prompt = CLASSIFICATION_PROMPT.replace("{entityName}", request.entityName)
        .replace("{entityType}", request.entityType)
        .replace("{filePath}", request.filePath)
        .replace("{sourceCode}", request.sourceCode?.substring(0, 2000) ?? "N/A")
        .replace("{justificationContext}", justificationContext)
        .replace("{imports}", request.imports.join(", ") || "None");

      const response = await this.llm.infer(prompt, {
        maxTokens: 500,
        temperature: 0.1,
        jsonSchema: CLASSIFICATION_JSON_SCHEMA,
      });

      const parsed = (response.parsed || {}) as any;

      if (!parsed.category) {
        return null;
      }

      if (parsed.category === "domain") {
        const area = DomainAreaSchema.safeParse(parsed.area);
        return createDomainClassification(
          request.entityId,
          request.entityType,
          request.entityName,
          request.filePath,
          area.success ? area.data : "other-business",
          parsed.confidence ?? 0.7,
          parsed.reasoning ?? "LLM classification",
          {}
        );
      } else if (parsed.category === "infrastructure") {
        const layer = InfrastructureLayerSchema.safeParse(parsed.area);
        return createInfrastructureClassification(
          request.entityId,
          request.entityType,
          request.entityName,
          request.filePath,
          layer.success ? layer.data : "other-infrastructure",
          parsed.confidence ?? 0.7,
          parsed.reasoning ?? "LLM classification",
          {
            library: parsed.library,
            libraryVersion: parsed.libraryVersion,
          }
        );
      }

      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          err: error,
          errorMessage,
          errorStack: error instanceof Error ? error.stack : undefined,
          entityId: request.entityId,
          entityType: request.entityType,
          entityName: request.entityName,
          filePath: request.filePath,
        },
        "LLM classification failed for %s (%s): %s",
        request.entityName,
        request.entityType,
        errorMessage
      );
      return null;
    }
  }
}

/**
 * Factory function
 */
export async function createClassificationEngine(
  storage: IClassificationStorage,
  llm: ILLMService | null,
  config?: Partial<ClassificationEngineConfig>
): Promise<IClassificationEngine> {
  const defaultConfig: ClassificationEngineConfig = {
    confidenceThreshold: 0.6,
    useLLM: !!llm,
    usePatterns: true,
    useDependencyAnalysis: true,
    maxRetries: 2,
    timeout: 30000,
  };

  const engine = new LLMClassificationEngine(storage, llm, { ...defaultConfig, ...config });
  await engine.initialize();
  return engine;
}

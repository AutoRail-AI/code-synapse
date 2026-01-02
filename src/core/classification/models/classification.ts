/**
 * Classification Models
 *
 * Defines the data structures for business layer classification:
 * - Domain: Product/Feature/Business logic (Payment, Auth, Billing)
 * - Infrastructure: Platform/Cross-cutting (Redis, DB, SDKs)
 */

import { z } from "zod";

// =============================================================================
// Classification Types
// =============================================================================

/**
 * Primary classification category
 * - domain: Business logic, product features, user-facing functionality
 * - infrastructure: Platform services, utilities, cross-cutting concerns
 */
export type ClassificationCategory = "domain" | "infrastructure" | "unknown";

/**
 * Domain subcategories - business/product areas
 */
export const DomainAreaSchema = z.enum([
  "authentication",
  "authorization",
  "user-management",
  "billing",
  "payments",
  "subscriptions",
  "notifications",
  "messaging",
  "reporting",
  "analytics",
  "search",
  "content-management",
  "file-management",
  "workflow",
  "scheduling",
  "integration",
  "api-gateway",
  "other-business",
]);

export type DomainArea = z.infer<typeof DomainAreaSchema>;

/**
 * Infrastructure subcategories - platform/cross-cutting layers
 */
export const InfrastructureLayerSchema = z.enum([
  "database",
  "cache",
  "message-queue",
  "http-client",
  "http-server",
  "logging",
  "monitoring",
  "tracing",
  "configuration",
  "security",
  "serialization",
  "validation",
  "error-handling",
  "testing",
  "build-tools",
  "deployment",
  "sdk-client",
  "utility",
  "other-infrastructure",
]);

export type InfrastructureLayer = z.infer<typeof InfrastructureLayerSchema>;

// =============================================================================
// Classification Metadata
// =============================================================================

/**
 * Domain classification details
 */
export const DomainMetadataSchema = z.object({
  area: DomainAreaSchema,
  featureArea: z.string().optional(),
  businessCapability: z.string().optional(),
  userFacing: z.boolean().default(false),
  revenueImpact: z.enum(["direct", "indirect", "none"]).default("none"),
});

export type DomainMetadata = z.infer<typeof DomainMetadataSchema>;

/**
 * Infrastructure classification details - includes dependency info
 */
export const InfrastructureMetadataSchema = z.object({
  layer: InfrastructureLayerSchema,
  // Library/SDK information
  library: z.string().optional(),
  libraryVersion: z.string().optional(),
  // Dependency source
  dependencySource: z
    .enum(["npm", "pip", "cargo", "maven", "nuget", "go-mod", "bundled", "native", "other"])
    .optional(),
  // Runtime hints
  runtimePlatform: z.enum(["node", "browser", "both", "worker", "native", "other"]).optional(),
  // Whether this is a wrapper/adapter
  isWrapper: z.boolean().default(false),
  wrappedLibrary: z.string().optional(),
  // Cross-cutting concerns
  crossCutting: z.boolean().default(true),
  affectedLayers: z.array(z.string()).default([]),
});

export type InfrastructureMetadata = z.infer<typeof InfrastructureMetadataSchema>;

// =============================================================================
// Main Classification Schema
// =============================================================================

/**
 * Complete classification for an entity
 */
export const EntityClassificationSchema = z.object({
  // Identity
  entityId: z.string(),
  entityType: z.enum(["function", "class", "interface", "type", "variable", "module", "file"]),
  entityName: z.string(),
  filePath: z.string(),

  // Primary classification
  category: z.enum(["domain", "infrastructure", "unknown"]),

  // Category-specific metadata (one will be populated)
  domainMetadata: DomainMetadataSchema.optional(),
  infrastructureMetadata: InfrastructureMetadataSchema.optional(),

  // Classification confidence
  confidence: z.number().min(0).max(1),
  classificationMethod: z.enum(["llm", "pattern", "dependency", "heuristic", "user"]),

  // Reasoning
  reasoning: z.string(),
  indicators: z.array(z.string()).default([]),

  // Relationships
  relatedEntities: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  usedBy: z.array(z.string()).default([]),

  // Audit
  classifiedAt: z.string().datetime(),
  classifiedBy: z.string().default("system"),
  lastUpdated: z.string().datetime().optional(),
  version: z.number().default(1),
});

export type EntityClassification = z.infer<typeof EntityClassificationSchema>;

// =============================================================================
// Classification Request/Response
// =============================================================================

/**
 * Input for classification request
 */
export const ClassificationRequestSchema = z.object({
  entityId: z.string(),
  entityType: z.enum(["function", "class", "interface", "type", "variable", "module", "file"]),
  entityName: z.string(),
  filePath: z.string(),

  // Context for classification
  sourceCode: z.string().optional(),
  docstring: z.string().optional(),
  justification: z
    .object({
      purposeSummary: z.string(),
      businessValue: z.string(),
      featureContext: z.string(),
    })
    .optional(),

  // Dependencies and relationships
  imports: z.array(z.string()).default([]),
  exports: z.array(z.string()).default([]),
  calls: z.array(z.string()).default([]),
  calledBy: z.array(z.string()).default([]),

  // File context
  fileImports: z.array(z.string()).default([]),
  packageDependencies: z.array(z.string()).default([]),
});

export type ClassificationRequest = z.infer<typeof ClassificationRequestSchema>;

/**
 * Classification result
 */
export const ClassificationResultSchema = z.object({
  success: z.boolean(),
  classification: EntityClassificationSchema.optional(),
  error: z.string().optional(),
  processingTimeMs: z.number(),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

// =============================================================================
// Batch Operations
// =============================================================================

export const BatchClassificationRequestSchema = z.object({
  entities: z.array(ClassificationRequestSchema),
  options: z
    .object({
      parallel: z.boolean().default(true),
      maxConcurrency: z.number().default(5),
      skipExisting: z.boolean().default(true),
    })
    .optional(),
});

export type BatchClassificationRequest = z.infer<typeof BatchClassificationRequestSchema>;

export const BatchClassificationResultSchema = z.object({
  total: z.number(),
  successful: z.number(),
  failed: z.number(),
  skipped: z.number(),
  classifications: z.array(EntityClassificationSchema),
  errors: z.array(
    z.object({
      entityId: z.string(),
      error: z.string(),
    })
  ),
  processingTimeMs: z.number(),
});

export type BatchClassificationResult = z.infer<typeof BatchClassificationResultSchema>;

// =============================================================================
// Classification Statistics
// =============================================================================

export interface ClassificationStats {
  totalEntities: number;
  classifiedEntities: number;
  domainCount: number;
  infrastructureCount: number;
  unknownCount: number;
  averageConfidence: number;
  byArea: Record<string, number>;
  byLayer: Record<string, number>;
  byMethod: Record<string, number>;
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createDomainClassification(
  entityId: string,
  entityType: EntityClassification["entityType"],
  entityName: string,
  filePath: string,
  area: DomainArea,
  confidence: number,
  reasoning: string,
  options?: Partial<DomainMetadata>
): EntityClassification {
  return {
    entityId,
    entityType,
    entityName,
    filePath,
    category: "domain",
    domainMetadata: {
      area,
      featureArea: options?.featureArea,
      businessCapability: options?.businessCapability,
      userFacing: options?.userFacing ?? false,
      revenueImpact: options?.revenueImpact ?? "none",
    },
    confidence,
    classificationMethod: "llm",
    reasoning,
    indicators: [],
    relatedEntities: [],
    dependsOn: [],
    usedBy: [],
    classifiedAt: new Date().toISOString(),
    classifiedBy: "system",
    version: 1,
  };
}

export function createInfrastructureClassification(
  entityId: string,
  entityType: EntityClassification["entityType"],
  entityName: string,
  filePath: string,
  layer: InfrastructureLayer,
  confidence: number,
  reasoning: string,
  options?: Partial<InfrastructureMetadata>
): EntityClassification {
  return {
    entityId,
    entityType,
    entityName,
    filePath,
    category: "infrastructure",
    infrastructureMetadata: {
      layer,
      library: options?.library,
      libraryVersion: options?.libraryVersion,
      dependencySource: options?.dependencySource,
      runtimePlatform: options?.runtimePlatform,
      isWrapper: options?.isWrapper ?? false,
      wrappedLibrary: options?.wrappedLibrary,
      crossCutting: options?.crossCutting ?? true,
      affectedLayers: options?.affectedLayers ?? [],
    },
    confidence,
    classificationMethod: "llm",
    reasoning,
    indicators: [],
    relatedEntities: [],
    dependsOn: [],
    usedBy: [],
    classifiedAt: new Date().toISOString(),
    classifiedBy: "system",
    version: 1,
  };
}

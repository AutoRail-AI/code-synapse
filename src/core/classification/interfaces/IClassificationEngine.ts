/**
 * Classification Engine Interface
 *
 * Black-box interface for classifying code entities as:
 * - Domain (business/product logic)
 * - Infrastructure (platform/cross-cutting)
 *
 * Implementations may use LLM, pattern matching, or heuristics.
 */

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

/**
 * Configuration for classification engine
 */
export interface ClassificationEngineConfig {
  /** Minimum confidence threshold to accept classification */
  confidenceThreshold: number;
  /** Whether to use LLM for classification */
  useLLM: boolean;
  /** Whether to use pattern-based classification */
  usePatterns: boolean;
  /** Whether to use dependency analysis */
  useDependencyAnalysis: boolean;
  /** Maximum retries for failed classifications */
  maxRetries: number;
  /** Timeout for single classification (ms) */
  timeout: number;
}

/**
 * Default configuration
 */
export const DEFAULT_CLASSIFICATION_CONFIG: ClassificationEngineConfig = {
  confidenceThreshold: 0.6,
  useLLM: true,
  usePatterns: true,
  useDependencyAnalysis: true,
  maxRetries: 2,
  timeout: 30000,
};

/**
 * Classification Engine Interface
 *
 * Responsible for determining whether code entities belong to
 * domain (business) or infrastructure (platform) layers.
 */
export interface IClassificationEngine {
  /**
   * Initialize the classification engine
   */
  initialize(): Promise<void>;

  /**
   * Classify a single entity
   */
  classify(request: ClassificationRequest): Promise<ClassificationResult>;

  /**
   * Classify multiple entities in batch
   */
  classifyBatch(request: BatchClassificationRequest): Promise<BatchClassificationResult>;

  /**
   * Get existing classification for an entity
   */
  getClassification(entityId: string): Promise<EntityClassification | null>;

  /**
   * Update an existing classification
   */
  updateClassification(
    entityId: string,
    updates: Partial<EntityClassification>
  ): Promise<EntityClassification | null>;

  /**
   * Delete a classification
   */
  deleteClassification(entityId: string): Promise<boolean>;

  /**
   * Query classifications by category
   */
  queryByCategory(
    category: ClassificationCategory,
    options?: QueryOptions
  ): Promise<EntityClassification[]>;

  /**
   * Query domain classifications by area
   */
  queryDomainByArea(area: DomainArea, options?: QueryOptions): Promise<EntityClassification[]>;

  /**
   * Query infrastructure classifications by layer
   */
  queryInfrastructureByLayer(
    layer: InfrastructureLayer,
    options?: QueryOptions
  ): Promise<EntityClassification[]>;

  /**
   * Search classifications
   */
  search(query: string, options?: SearchOptions): Promise<EntityClassification[]>;

  /**
   * Get classification statistics
   */
  getStats(): Promise<ClassificationStats>;

  /**
   * Get classifications for a file
   */
  getClassificationsForFile(filePath: string): Promise<EntityClassification[]>;

  /**
   * Get classifications that depend on a library
   */
  getClassificationsByLibrary(library: string): Promise<EntityClassification[]>;

  /**
   * Reclassify entities that have changed
   */
  reclassifyChanged(entityIds: string[]): Promise<BatchClassificationResult>;

  /**
   * Confirm or correct a classification (user feedback)
   */
  confirmClassification(
    entityId: string,
    confirmed: boolean,
    correction?: {
      category?: ClassificationCategory;
      area?: DomainArea;
      layer?: InfrastructureLayer;
    }
  ): Promise<EntityClassification | null>;

  /**
   * Shutdown and cleanup
   */
  shutdown(): Promise<void>;
}

/**
 * Query options for listing classifications
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  minConfidence?: number;
  orderBy?: "confidence" | "classifiedAt" | "entityName";
  orderDirection?: "asc" | "desc";
}

/**
 * Search options
 */
export interface SearchOptions extends QueryOptions {
  searchIn?: ("entityName" | "filePath" | "reasoning")[];
  category?: ClassificationCategory;
}

/**
 * Classification Storage Interface
 *
 * Abstraction for persisting classifications.
 */
export interface IClassificationStorage {
  /**
   * Initialize storage (create tables/indices)
   */
  initialize(): Promise<void>;

  /**
   * Store a classification
   */
  store(classification: EntityClassification): Promise<void>;

  /**
   * Store multiple classifications
   */
  storeBatch(classifications: EntityClassification[]): Promise<void>;

  /**
   * Get a classification by entity ID
   */
  get(entityId: string): Promise<EntityClassification | null>;

  /**
   * Update a classification
   */
  update(entityId: string, updates: Partial<EntityClassification>): Promise<EntityClassification | null>;

  /**
   * Delete a classification
   */
  delete(entityId: string): Promise<boolean>;

  /**
   * Delete classifications for a file
   */
  deleteForFile(filePath: string): Promise<number>;

  /**
   * Query by category
   */
  queryByCategory(category: ClassificationCategory, options?: QueryOptions): Promise<EntityClassification[]>;

  /**
   * Query domain by area
   */
  queryDomainByArea(area: DomainArea, options?: QueryOptions): Promise<EntityClassification[]>;

  /**
   * Query infrastructure by layer
   */
  queryInfrastructureByLayer(
    layer: InfrastructureLayer,
    options?: QueryOptions
  ): Promise<EntityClassification[]>;

  /**
   * Search classifications
   */
  search(query: string, options?: SearchOptions): Promise<EntityClassification[]>;

  /**
   * Get by file path
   */
  getByFile(filePath: string): Promise<EntityClassification[]>;

  /**
   * Get by library
   */
  getByLibrary(library: string): Promise<EntityClassification[]>;

  /**
   * Get statistics
   */
  getStats(): Promise<ClassificationStats>;

  /**
   * Check if entity is classified
   */
  exists(entityId: string): Promise<boolean>;
}

/**
 * Factory function type for creating classification engines
 */
export type ClassificationEngineFactory = (
  config?: Partial<ClassificationEngineConfig>
) => Promise<IClassificationEngine>;

/**
 * IJustificationService Interface
 *
 * Defines the contract for the Business Justification Layer.
 * This is a black-box interface - implementations can be swapped
 * without affecting consumers.
 *
 * @module
 */

import type {
  EntityJustification,
  JustificationContext,
  JustificationStats,
  ClarificationBatch,
  ClarificationQuestion,
  JustifiableEntityType,
  FeatureJustification,
} from "../models/justification.js";

// =============================================================================
// Core Interface
// =============================================================================

/**
 * Service for inferring and managing business justifications for code entities.
 *
 * The justification service is responsible for:
 * 1. Inferring purpose/business value from code structure
 * 2. Propagating context through the entity hierarchy
 * 3. Managing user clarification workflow
 * 4. Persisting justifications to storage
 *
 * @example
 * ```typescript
 * const service = createJustificationService(graphStore, llmService);
 * await service.initialize();
 *
 * // Justify a batch of entities
 * const results = await service.justifyEntities(entityIds);
 *
 * // Get pending clarifications
 * const batch = await service.getNextClarificationBatch();
 *
 * // Apply user answers
 * await service.applyClarificationAnswers(batch.id, answers);
 * ```
 */
export interface IJustificationService {
  // === Lifecycle ===

  /**
   * Initialize the service (load models, connect to storage)
   */
  initialize(): Promise<void>;

  /**
   * Close the service and release resources
   */
  close(): Promise<void>;

  /**
   * Check if service is ready
   */
  isReady(): boolean;

  // === Core Justification ===

  /**
   * Generate justifications for a list of entity IDs.
   * This is the main entry point for the JUSTIFY pipeline stage.
   *
   * @param entityIds - IDs of entities to justify
   * @param options - Justification options
   * @returns Results with justifications and any errors
   */
  justifyEntities(
    entityIds: string[],
    options?: JustifyOptions
  ): Promise<JustificationResult>;

  /**
   * Justify all entities in a file
   *
   * @param filePath - Path to file
   * @param options - Justification options
   */
  justifyFile(filePath: string, options?: JustifyOptions): Promise<JustificationResult>;

  /**
   * Justify all entities in the project
   *
   * @param options - Justification options
   */
  justifyProject(options?: JustifyOptions): Promise<JustificationResult>;

  /**
   * Re-justify entities that have low confidence or pending clarification
   */
  rejustifyUncertain(): Promise<JustificationResult>;

  // === Context Building ===

  /**
   * Build full context for an entity (used for LLM inference)
   *
   * @param entityId - Entity to build context for
   */
  buildContext(entityId: string): Promise<JustificationContext>;

  /**
   * Propagate justification context from parent to children
   *
   * @param parentId - Parent justification ID
   */
  propagateContextDown(parentId: string): Promise<void>;

  /**
   * Aggregate child justifications into parent summary
   *
   * @param parentId - Parent entity ID
   */
  aggregateContextUp(parentId: string): Promise<EntityJustification>;

  // === Retrieval ===

  /**
   * Get justification for a specific entity
   *
   * @param entityId - Entity ID
   */
  getJustification(entityId: string): Promise<EntityJustification | null>;

  /**
   * Get justifications for multiple entities
   *
   * @param entityIds - Entity IDs
   */
  getJustifications(entityIds: string[]): Promise<Map<string, EntityJustification>>;

  /**
   * Get all justifications for a file
   *
   * @param filePath - File path
   */
  getFileJustifications(filePath: string): Promise<EntityJustification[]>;

  /**
   * Get justification hierarchy (entity + children)
   *
   * @param entityId - Root entity ID
   * @param depth - How deep to traverse (default: all)
   */
  getJustificationHierarchy(
    entityId: string,
    depth?: number
  ): Promise<JustificationHierarchy>;

  /**
   * Search justifications by purpose/business value
   *
   * @param query - Search query
   * @param options - Search options
   */
  searchJustifications(
    query: string,
    options?: SearchOptions
  ): Promise<EntityJustification[]>;

  // === Clarification Workflow ===

  /**
   * Get the next batch of clarification questions.
   * Questions are prioritized top-down (file → class → method).
   *
   * @param maxQuestions - Maximum questions to return
   */
  getNextClarificationBatch(maxQuestions?: number): Promise<ClarificationBatch>;

  /**
   * Get all pending clarification questions
   */
  getAllPendingClarifications(): Promise<ClarificationQuestion[]>;

  /**
   * Apply user answers to clarification questions
   *
   * @param answers - Map of question ID to answer
   */
  applyClarificationAnswers(answers: Map<string, string>): Promise<void>;

  /**
   * Skip clarification for an entity (mark as "unknown" with low confidence)
   *
   * @param entityId - Entity to skip
   */
  skipClarification(entityId: string): Promise<void>;

  /**
   * User directly provides/edits justification
   *
   * @param entityId - Entity ID
   * @param justification - User-provided justification content
   */
  setUserJustification(
    entityId: string,
    justification: UserJustificationInput
  ): Promise<EntityJustification>;

  // === Statistics & Reporting ===

  /**
   * Get overall justification statistics
   */
  getStats(): Promise<JustificationStats>;

  /**
   * Get justification coverage by file
   */
  getCoverageByFile(): Promise<Map<string, FileCoverage>>;

  /**
   * Get feature-level justification aggregations
   */
  getFeatureJustifications(): Promise<FeatureJustification[]>;

  /**
   * Get entities needing attention (low confidence, pending clarification)
   */
  getEntitiesNeedingAttention(): Promise<EntityJustification[]>;

  // === Maintenance ===

  /**
   * Delete justification for an entity
   *
   * @param entityId - Entity ID
   */
  deleteJustification(entityId: string): Promise<void>;

  /**
   * Delete all justifications for a file (used during re-indexing)
   *
   * @param filePath - File path
   */
  deleteFileJustifications(filePath: string): Promise<void>;

  /**
   * Clear all justifications (reset)
   */
  clearAllJustifications(): Promise<void>;
}

// =============================================================================
// Supporting Types
// =============================================================================

/**
 * Options for justification operations
 */
export interface JustifyOptions {
  /** Force re-justification even if already exists */
  force?: boolean;

  /** Minimum confidence threshold to accept */
  minConfidence?: number;

  /** Skip LLM inference, use only code analysis */
  skipLLM?: boolean;

  /** Include context propagation */
  propagateContext?: boolean;

  /** Batch size for processing */
  batchSize?: number;

  /** Number of entities to process in a single LLM call (batch inference) */
  llmBatchSize?: number;

  /** Skip trivial entities like simple getters/setters (uses defaults) */
  skipTrivial?: boolean;

  /** Use dynamic batching based on LLM context window size */
  useDynamicBatching?: boolean;

  /** Filter out gitignored and build artifact paths */
  filterIgnoredPaths?: boolean;

  /** Model ID for dynamic batch sizing (used to determine context window) */
  modelId?: string;

  /** Progress callback */
  onProgress?: (progress: JustificationProgress) => void;

  /** Project context for better inference */
  projectContext?: {
    name?: string;
    description?: string;
    domain?: string;
    features?: string[];
  };
}

/**
 * Progress information during justification
 */
export interface JustificationProgress {
  phase: "building_context" | "inferring" | "propagating" | "storing";
  current: number;
  total: number;
  currentEntity?: string;
  message?: string;
}

/**
 * Result of justification operation
 */
export interface JustificationResult {
  /** Successfully justified entities */
  justified: EntityJustification[];

  /** Entities that failed justification */
  failed: Array<{
    entityId: string;
    error: string;
  }>;

  /** Entities needing clarification */
  needingClarification: EntityJustification[];

  /** Statistics */
  stats: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    pendingClarification: number;
    averageConfidence: number;
    durationMs: number;
  };
}

/**
 * Justification hierarchy tree
 */
export interface JustificationHierarchy {
  justification: EntityJustification;
  children: JustificationHierarchy[];
}

/**
 * Search options for justifications
 */
export interface SearchOptions {
  /** Filter by entity type */
  entityTypes?: JustifiableEntityType[];

  /** Filter by minimum confidence */
  minConfidence?: number;

  /** Filter by feature context */
  featureContext?: string;

  /** Maximum results */
  limit?: number;

  /** Include entities pending clarification */
  includePending?: boolean;
}

/**
 * User input for manual justification
 */
export interface UserJustificationInput {
  purposeSummary?: string;
  businessValue?: string;
  featureContext?: string;
  detailedDescription?: string;
  tags?: string[];
}

/**
 * File-level coverage information
 */
export interface FileCoverage {
  filePath: string;
  totalEntities: number;
  justifiedEntities: number;
  highConfidence: number;
  pendingClarification: number;
  coveragePercentage: number;
}

// =============================================================================
// Factory Function Type
// =============================================================================

/**
 * Dependencies required to create a JustificationService
 */
export interface JustificationServiceDependencies {
  /** Graph store for reading entities and storing justifications */
  graphStore: unknown; // IGraphStore - avoiding circular import

  /** LLM service for inference */
  llmService?: unknown; // ILLMService - optional, can work without

  /** Logger */
  logger?: unknown;
}

/**
 * Factory function signature for creating JustificationService
 */
export type CreateJustificationService = (
  deps: JustificationServiceDependencies
) => IJustificationService;

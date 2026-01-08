/**
 * Project Memory System Interface
 *
 * Defines the contract for storing and retrieving developer memory rules.
 * Enables AI to remember past corrections, conventions, and patterns.
 */

import type {
  ProjectMemoryRule,
  MemoryQuery,
  SemanticMemoryQuery,
  MemoryStats,
  MemoryRuleScope,
  MemoryRuleCategory,
  TriggerType,
} from "../models/memory-models.js";

// =============================================================================
// Memory Storage Interface
// =============================================================================

/**
 * Storage backend for memory rules
 */
export interface IMemoryStorage {
  /**
   * Initialize storage (create tables, indexes)
   */
  initialize(): Promise<void>;

  /**
   * Store a memory rule
   */
  store(rule: ProjectMemoryRule): Promise<void>;

  /**
   * Store multiple rules atomically
   */
  storeBatch(rules: ProjectMemoryRule[]): Promise<void>;

  /**
   * Update an existing rule
   */
  update(rule: ProjectMemoryRule): Promise<void>;

  /**
   * Get rule by ID
   */
  getById(id: string): Promise<ProjectMemoryRule | null>;

  /**
   * Query rules with filters
   */
  query(query: MemoryQuery): Promise<ProjectMemoryRule[]>;

  /**
   * Search by semantic similarity
   */
  searchSemantic(embedding: number[], limit: number, minSimilarity?: number): Promise<ProjectMemoryRule[]>;

  /**
   * Get rules matching a trigger pattern
   */
  getByTrigger(triggerType: TriggerType, pattern: string): Promise<ProjectMemoryRule[]>;

  /**
   * Delete a rule
   */
  delete(id: string): Promise<boolean>;

  /**
   * Get memory statistics
   */
  getStats(): Promise<MemoryStats>;

  /**
   * Apply confidence decay to old rules
   */
  applyDecay(decayFactor: number, minConfidence: number): Promise<number>;
}

// =============================================================================
// Memory Learning Interface
// =============================================================================

/**
 * Detects patterns and learns new rules from events
 */
export interface IMemoryLearner {
  /**
   * Learn from user correction of AI output
   */
  learnFromCorrection(
    originalCode: string,
    correctedCode: string,
    filePath: string,
    sessionId: string
  ): Promise<ProjectMemoryRule | null>;

  /**
   * Learn from build/lint failure
   */
  learnFromBuildFailure(
    errorMessage: string,
    errorCode: string | undefined,
    filePath: string,
    sessionId: string
  ): Promise<ProjectMemoryRule | null>;

  /**
   * Learn from manual refactor
   */
  learnFromRefactor(
    beforeCode: string,
    afterCode: string,
    filePath: string,
    sessionId: string
  ): Promise<ProjectMemoryRule | null>;

  /**
   * Learn from explicit user instruction
   */
  learnFromInstruction(
    instruction: string,
    scope: MemoryRuleScope,
    category: MemoryRuleCategory,
    sessionId: string
  ): Promise<ProjectMemoryRule>;

  /**
   * Infer patterns from repeated behavior
   */
  inferPatterns(minOccurrences: number): Promise<ProjectMemoryRule[]>;
}

// =============================================================================
// Memory Retrieval Interface
// =============================================================================

/**
 * Retrieves relevant memories for code generation context
 */
export interface IMemoryRetriever {
  /**
   * Get memories relevant to a code generation context
   */
  getRelevantMemories(query: SemanticMemoryQuery): Promise<ProjectMemoryRule[]>;

  /**
   * Get memories for a specific file
   */
  getMemoriesForFile(filePath: string): Promise<ProjectMemoryRule[]>;

  /**
   * Get memories for an entity type
   */
  getMemoriesForEntityType(entityType: string): Promise<ProjectMemoryRule[]>;

  /**
   * Get active conventions for scope
   */
  getConventions(scope: MemoryRuleScope, target?: string): Promise<ProjectMemoryRule[]>;

  /**
   * Get anti-patterns to avoid
   */
  getAntiPatterns(scope: MemoryRuleScope, target?: string): Promise<ProjectMemoryRule[]>;

  /**
   * Format memories for injection into prompt context
   */
  formatForPrompt(rules: ProjectMemoryRule[], maxLength?: number): string;
}

// =============================================================================
// Main Project Memory Interface
// =============================================================================

/**
 * Main interface for the developer memory system
 */
export interface IProjectMemory {
  /**
   * Initialize the memory system
   */
  initialize(): Promise<void>;

  /**
   * Check if memory system is ready
   */
  readonly isReady: boolean;

  // =========================================================================
  // Rule Management
  // =========================================================================

  /**
   * Create a new memory rule
   */
  createRule(
    scope: MemoryRuleScope,
    category: MemoryRuleCategory,
    triggerType: TriggerType,
    triggerPattern: string,
    ruleText: string,
    source: ProjectMemoryRule["source"],
    options?: {
      scopeTarget?: string;
      ruleExplanation?: string;
      examples?: Array<{ bad: string; good: string; explanation?: string }>;
      confidence?: number;
      sessionId?: string;
      eventId?: string;
    }
  ): Promise<ProjectMemoryRule>;

  /**
   * Get a rule by ID
   */
  getRule(id: string): Promise<ProjectMemoryRule | null>;

  /**
   * Update a rule
   */
  updateRule(id: string, updates: Partial<ProjectMemoryRule>): Promise<ProjectMemoryRule | null>;

  /**
   * Deprecate a rule
   */
  deprecateRule(id: string, reason: string): Promise<boolean>;

  /**
   * Delete a rule permanently
   */
  deleteRule(id: string): Promise<boolean>;

  /**
   * List rules with filters
   */
  listRules(query: MemoryQuery): Promise<ProjectMemoryRule[]>;

  // =========================================================================
  // Learning
  // =========================================================================

  /**
   * Learn from user correction
   */
  learnFromCorrection(
    originalCode: string,
    correctedCode: string,
    filePath: string,
    sessionId: string
  ): Promise<ProjectMemoryRule | null>;

  /**
   * Learn from build failure
   */
  learnFromBuildFailure(
    errorMessage: string,
    errorCode: string | undefined,
    filePath: string,
    sessionId: string
  ): Promise<ProjectMemoryRule | null>;

  /**
   * Learn from explicit instruction
   */
  learnFromInstruction(
    instruction: string,
    scope: MemoryRuleScope,
    category: MemoryRuleCategory,
    sessionId: string
  ): Promise<ProjectMemoryRule>;

  // =========================================================================
  // Retrieval
  // =========================================================================

  /**
   * Get memories relevant to context
   */
  getRelevantMemories(query: SemanticMemoryQuery): Promise<ProjectMemoryRule[]>;

  /**
   * Get memories for file
   */
  getMemoriesForFile(filePath: string): Promise<ProjectMemoryRule[]>;

  /**
   * Format memories for prompt injection
   */
  formatForPrompt(rules: ProjectMemoryRule[], maxLength?: number): string;

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Record that a rule was validated (correct behavior observed)
   */
  validateRule(id: string, sessionId?: string): Promise<void>;

  /**
   * Record that a rule was violated
   */
  recordViolation(id: string, details: string, sessionId?: string): Promise<void>;

  // =========================================================================
  // Maintenance
  // =========================================================================

  /**
   * Apply confidence decay to old rules
   */
  applyConfidenceDecay(options?: { decayFactor?: number; minConfidence?: number }): Promise<number>;

  /**
   * Get statistics
   */
  getStats(): Promise<MemoryStats>;

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Shutdown and cleanup
   */
  shutdown(): Promise<void>;
}

// =============================================================================
// Configuration
// =============================================================================

export interface ProjectMemoryConfig {
  // Confidence settings
  initialConfidence: number; // Default confidence for new rules (default: 0.5)
  validationBoost: number; // Confidence boost on validation (default: 0.1)
  violationPenalty: number; // Confidence penalty on violation (default: 0.15)
  minActiveConfidence: number; // Below this, rule is auto-deprecated (default: 0.2)

  // Decay settings
  enableDecay: boolean; // Enable automatic confidence decay
  decayIntervalMs: number; // How often to run decay (default: 24 hours)
  decayFactor: number; // Multiplier per decay cycle (default: 0.95)

  // Retrieval settings
  defaultRetrievalLimit: number; // Default number of rules to retrieve (default: 10)
  minRetrievalSimilarity: number; // Min similarity for semantic search (default: 0.6)

  // Learning settings
  enableAutoLearning: boolean; // Enable automatic pattern learning
  minPatternOccurrences: number; // Min occurrences to infer pattern (default: 3)
}

export const DEFAULT_MEMORY_CONFIG: ProjectMemoryConfig = {
  initialConfidence: 0.5,
  validationBoost: 0.1,
  violationPenalty: 0.15,
  minActiveConfidence: 0.2,
  enableDecay: true,
  decayIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
  decayFactor: 0.95,
  defaultRetrievalLimit: 10,
  minRetrievalSimilarity: 0.6,
  enableAutoLearning: true,
  minPatternOccurrences: 3,
};

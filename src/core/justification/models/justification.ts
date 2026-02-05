/**
 * Justification Layer Data Models
 *
 * Defines the core data structures for storing business justifications,
 * purpose inference, and clarification state for code entities.
 *
 * @module
 */

// =============================================================================
// Entity Types
// =============================================================================

/**
 * Types of entities that can have justifications
 */
export type JustifiableEntityType =
  | "file"
  | "module"
  | "class"
  | "interface"
  | "function"
  | "method"
  | "variable"
  | "type_alias";

/**
 * How the justification was derived
 */
export type JustificationSource =
  | "llm_inferred" // Inferred by local LLM
  | "user_provided" // Directly provided by user
  | "propagated_down" // Inherited from parent context
  | "propagated_up" // Aggregated from children
  | "code_comment" // Extracted from JSDoc/docstring
  | "file_name" // Inferred from naming conventions
  | "code_pattern"; // Inferred from trivial code patterns (getters/setters/etc)

/**
 * Confidence levels for justification accuracy
 */
export type ConfidenceLevel = "high" | "medium" | "low" | "uncertain";

// =============================================================================
// Core Justification Model
// =============================================================================

/**
 * Complete justification record for a code entity
 */
export interface EntityJustification {
  /** Unique identifier for this justification */
  id: string;

  /** ID of the entity this justifies (function, class, etc.) */
  entityId: string;

  /** Type of entity being justified */
  entityType: JustifiableEntityType;

  /** Name of the entity */
  name: string;

  /** File path where entity is defined */
  filePath: string;

  /** Content hash of the file (for incremental updates) */
  fileHash?: string;

  // === Semantic Content ===

  /** One-line summary of what this code does */
  purposeSummary: string;

  /** Why this code exists from a business/product perspective */
  businessValue: string;

  /** Which feature/domain this belongs to */
  featureContext: string;

  /** Detailed explanation of the code's role */
  detailedDescription: string;

  /** Keywords/tags for categorization */
  tags: string[];

  // === Provenance ===

  /** How this justification was derived */
  inferredFrom: JustificationSource;

  /** Confidence score (0.0 to 1.0) */
  confidenceScore: number;

  /** Human-readable confidence level */
  confidenceLevel: ConfidenceLevel;

  /** LLM's reasoning chain (for transparency) */
  reasoning: string;

  /** Sources used for inference (parent IDs, code patterns, etc.) */
  evidenceSources: string[];

  // === Hierarchy ===

  /** Parent justification ID (e.g., class for method, file for function) */
  parentJustificationId: string | null;

  /** Depth in hierarchy (0 = file/module level) */
  hierarchyDepth: number;

  // === User Interaction ===

  /** Whether user confirmation is needed */
  clarificationPending: boolean;

  /** Specific questions for user */
  pendingQuestions: ClarificationQuestion[];

  /** Timestamp when user last confirmed/edited */
  lastConfirmedByUser: number | null;

  /** User who confirmed (for audit) */
  confirmedByUserId: string | null;

  // === Timestamps ===

  /** When justification was created */
  createdAt: number;

  /** When justification was last updated */
  /** Timestamp when justification was last updated */
  updatedAt: number;

  /** Version for optimistic locking */
  version: number;

  // === Dependency Analysis (Phase 2) ===

  /** Number of other entities that depend on this one */
  dependentCount?: number;

  /** Assessed risk of changing this entity based on dependencies */
  dependencyRisk?: "low" | "medium" | "high" | "critical";

  // === Unified Classification (Phase 6) ===

  /** Primary classification category */
  category: "domain" | "infrastructure" | "test" | "config" | "unknown";

  /** Specific domain or layer (e.g., "Authentication", "Database") */
  domain: string;

  /** Architectural pattern detection (for bad pattern identification) */
  architecturalPattern: "pure_domain" | "pure_infrastructure" | "mixed" | "adapter" | "unknown";
}
// ... (skip down to LLMJustificationResponse)
// Since the file is large, I'll do this in two chunks or use multi_replace.
// Let's stick to the EntityJustification interface first, then I'll add the factory function update and LLMJustificationResponse in a moment.
// Actually, I can do it all here if I target the right block, but I need to be careful with line numbers.
// The replace_file_content tool works on contiguous blocks.
// I will just update the interface first.

// =============================================================================
// Clarification System
// =============================================================================

/**
 * A question to ask the user for clarification
 */
export interface ClarificationQuestion {
  /** Unique question ID */
  id: string;

  /** The question text */
  question: string;

  /** Why we're asking this */
  context: string;

  /** Entity this question is about */
  entityId: string;

  /** Priority (lower = ask first) */
  priority: number;

  /** Question category */
  category: QuestionCategory;

  /** Suggested answers (if applicable) */
  suggestedAnswers?: string[];

  /** Whether this has been answered */
  answered: boolean;

  /** User's answer (if answered) */
  answer?: string;

  /** Timestamp when answered */
  answeredAt?: number;
}

/**
 * Categories of clarification questions
 */
export type QuestionCategory =
  | "purpose" // What does this do?
  | "business_value" // Why does this exist?
  | "feature_context" // What feature is this part of?
  | "naming" // Is this name accurate?
  | "relationship" // How does this relate to X?
  | "ownership"; // Who owns/maintains this?

/**
 * A batch of questions grouped for user presentation
 */
export interface ClarificationBatch {
  /** Batch ID */
  id: string;

  /** Questions in priority order */
  questions: ClarificationQuestion[];

  /** Total entities needing clarification */
  totalPendingEntities: number;

  /** Estimated time to answer (minutes) */
  estimatedTime: number;

  /** Created timestamp */
  createdAt: number;
}

// =============================================================================
// Inference Context
// =============================================================================

/**
 * Context provided to LLM for justification inference
 */
export interface JustificationContext {
  /** The entity being justified */
  entity: EntityForJustification;

  /** Parent entity context (if available) */
  parentContext?: ParentContext;

  /** Sibling entities for context */
  siblings: SiblingContext[];

  /** Child entities (for aggregation) */
  children: ChildContext[];

  /** Import/dependency context */
  dependencies: DependencyContext[];

  /** Call graph context */
  callers: CallerContext[];
  callees: CalleeContext[];

  /** Project-level context */
  projectContext: ProjectContext;

  /** Enhanced analysis context (Phase 1-4 results) */
  analysisContext?: EnhancedAnalysisContext;
}

/**
 * Entity data for justification
 */
export interface EntityForJustification {
  id: string;
  type: JustifiableEntityType;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
  codeSnippet: string;
  docComment?: string;
  isExported: boolean;
  isAsync?: boolean;
  parameters?: ParameterInfo[];
  returnType?: string;
}

export interface ParameterInfo {
  name: string;
  type?: string;
}

export interface ParentContext {
  id: string;
  type: JustifiableEntityType;
  name: string;
  justification?: EntityJustification;
}

export interface SiblingContext {
  id: string;
  type: JustifiableEntityType;
  name: string;
  purposeSummary?: string;
}

export interface ChildContext {
  id: string;
  type: JustifiableEntityType;
  name: string;
  purposeSummary?: string;
  businessValue?: string;
}

export interface DependencyContext {
  modulePath: string;
  importedNames: string[];
  isExternal: boolean;
}

export interface CallerContext {
  functionName: string;
  filePath: string;
  purposeSummary?: string;
}

export interface CalleeContext {
  functionName: string;
  filePath: string;
  purposeSummary?: string;
}

export interface ProjectContext {
  projectName: string;
  projectDescription?: string;
  framework?: string;
  domain?: string;
  knownFeatures: string[];
}

// =============================================================================
// Phase 5: Enhanced Analysis Context
// =============================================================================

/**
 * Side-effect summary for context enrichment (from Phase 3).
 */
export interface SideEffectContext {
  /** Total number of side effects detected */
  totalCount: number;
  /** Whether the function is pure (no side effects) */
  isPure: boolean;
  /** Primary categories of side effects */
  categories: string[];
  /** Human-readable descriptions of side effects */
  descriptions: string[];
  /** Risk level based on side effects */
  riskLevel: "low" | "medium" | "high";
}

/**
 * Error handling summary for context enrichment (from Phase 1).
 */
export interface ErrorBehaviorContext {
  /** Whether the function can throw errors */
  canThrow: boolean;
  /** Types of errors that can be thrown */
  errorTypes: string[];
  /** Whether all errors are handled internally */
  allHandled: boolean;
  /** Types of errors that escape the function */
  escapingErrorTypes: string[];
  /** Human-readable summary of error behavior */
  summary: string;
}

/**
 * Data flow summary for context enrichment (from Phase 2).
 */
export interface DataFlowContext {
  /** Whether data flow has been analyzed */
  isAnalyzed: boolean;
  /** Whether the function is pure (no side effects, deterministic) */
  isPure: boolean;
  /** Parameters that affect the return value */
  inputsAffectingOutput: string[];
  /** Whether the function accesses external state */
  accessesExternalState: boolean;
  /** Human-readable summary of data flow */
  summary: string;
}

/**
 * Pattern participation summary for context enrichment (from Phase 4).
 */
export interface PatternContext {
  /** Patterns this entity participates in */
  patterns: Array<{
    /** Pattern type (factory, singleton, etc.) */
    patternType: string;
    /** Role in the pattern (factory, product, singleton, etc.) */
    role: string;
    /** Pattern instance name */
    patternName: string;
    /** Confidence level */
    confidenceLevel: "high" | "medium" | "low";
  }>;
}

/**
 * Enhanced analysis context combining Phase 1-4 results.
 * Used to enrich LLM prompts with deeper code understanding.
 */
export interface EnhancedAnalysisContext {
  /** Side-effect analysis summary (Phase 3) */
  sideEffects?: SideEffectContext;
  /** Error handling analysis summary (Phase 1) */
  errorBehavior?: ErrorBehaviorContext;
  /** Data flow analysis summary (Phase 2) */
  dataFlow?: DataFlowContext;
  /** Design pattern participation (Phase 4) */
  patterns?: PatternContext;
}

// =============================================================================
// LLM Response Types
// =============================================================================

/**
 * Raw LLM response for justification inference
 */
export interface LLMJustificationResponse {
  purposeSummary: string;
  businessValue: string;
  featureContext: string;
  detailedDescription: string;
  tags: string[];
  confidenceScore: number;
  reasoning: string;
  needsClarification: boolean;
  clarificationQuestions: string[];

  // === Unified Classification ===
  category: "domain" | "infrastructure" | "test" | "config" | "unknown";
  domain: string;
  architecturalPattern: "pure_domain" | "pure_infrastructure" | "mixed" | "adapter" | "unknown";
}

// =============================================================================
// Aggregation Types
// =============================================================================

/**
 * Summary statistics for justification coverage
 */
export interface JustificationStats {
  totalEntities: number;
  justifiedEntities: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  pendingClarification: number;
  userConfirmed: number;
  coveragePercentage: number;
}

/**
 * Feature-level aggregation
 */
export interface FeatureJustification {
  featureName: string;
  description: string;
  entities: EntityJustification[];
  overallConfidence: number;
  coveragePercentage: number;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a new EntityJustification with defaults
 */
export function createEntityJustification(
  partial: Partial<EntityJustification> &
    Pick<EntityJustification, "id" | "entityId" | "entityType" | "name" | "filePath">
): EntityJustification {
  const now = Date.now();
  return {
    purposeSummary: "",
    businessValue: "",
    featureContext: "",
    detailedDescription: "",
    tags: [],
    inferredFrom: "llm_inferred",
    confidenceScore: 0,
    confidenceLevel: "uncertain",
    reasoning: "",
    evidenceSources: [],
    parentJustificationId: null,
    hierarchyDepth: 0,
    clarificationPending: false,
    pendingQuestions: [],
    lastConfirmedByUser: null,
    confirmedByUserId: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
    dependentCount: 0,
    dependencyRisk: "low",
    category: "unknown",
    domain: "unknown",
    architecturalPattern: "unknown",
    fileHash: "",
    ...partial,
  };
}

/**
 * Converts confidence score to level
 */
export function scoreToConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  if (score >= 0.3) return "low";
  return "uncertain";
}

/**
 * Creates a clarification question
 */
export function createClarificationQuestion(
  partial: Partial<ClarificationQuestion> &
    Pick<ClarificationQuestion, "id" | "question" | "entityId" | "category">
): ClarificationQuestion {
  return {
    context: "",
    priority: 50,
    suggestedAnswers: [],
    answered: false,
    ...partial,
  };
}

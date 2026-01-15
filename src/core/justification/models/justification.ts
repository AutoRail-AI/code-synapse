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
  updatedAt: number;

  /** Version for optimistic locking */
  version: number;
}

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

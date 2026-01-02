/**
 * Business Justification Layer
 *
 * Provides semantic understanding of code purpose, business value,
 * and feature context through local LLM inference and hierarchy propagation.
 *
 * @module
 */

// Core service interface
export type {
  IJustificationService,
  JustifyOptions,
  JustificationResult,
  JustificationProgress,
  JustificationHierarchy,
  SearchOptions,
  UserJustificationInput,
  FileCoverage,
  JustificationServiceDependencies,
  CreateJustificationService,
} from "./interfaces/IJustificationService.js";

// Data models
export type {
  EntityJustification,
  JustifiableEntityType,
  JustificationSource,
  ConfidenceLevel,
  ClarificationQuestion,
  QuestionCategory,
  ClarificationBatch,
  JustificationContext,
  EntityForJustification,
  ParentContext,
  SiblingContext,
  ChildContext,
  DependencyContext,
  CallerContext,
  CalleeContext,
  ProjectContext,
  LLMJustificationResponse,
  JustificationStats,
  FeatureJustification,
  ParameterInfo,
} from "./models/justification.js";

export {
  createEntityJustification,
  scoreToConfidenceLevel,
  createClarificationQuestion,
} from "./models/justification.js";

// Service implementation
export {
  LLMJustificationService,
  createLLMJustificationService,
  createInitializedJustificationService,
} from "./impl/LLMJustificationService.js";

// Storage
export {
  JustificationStorage,
  createJustificationStorage,
} from "./storage/justification-storage.js";

// Context propagation
export {
  ContextPropagator,
  createContextPropagator,
  type HierarchyNode,
  type IGraphStoreForPropagation,
} from "./hierarchy/context-propagator.js";

// Clarification engine
export {
  ClarificationEngine,
  createClarificationEngine,
  DEFAULT_CONFIG as CLARIFICATION_DEFAULT_CONFIG,
  type ClarificationEngineConfig,
} from "./clarification/clarification-engine.js";

// Prompts
export {
  JUSTIFICATION_GRAMMAR,
  JUSTIFICATION_SYSTEM_PROMPT,
  generateJustificationPrompt,
  generateFunctionPrompt,
  generateClassPrompt,
  generateFilePrompt,
  generateInterfacePrompt,
  generateAggregationPrompt,
  generateClarificationPrompt,
  parseJustificationResponse,
  createDefaultResponse,
} from "./prompts/justification-prompts.js";

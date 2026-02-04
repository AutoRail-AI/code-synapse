/**
 * Analysis Module
 *
 * Enhanced code analysis capabilities including:
 * - Parameter semantic analysis
 * - Return value analysis
 * - Error path analysis
 * - Data flow analysis (Phase 2)
 * - Side-effect analysis (Phase 3)
 *
 * @module
 */

// =============================================================================
// Phase 1: Enhanced Entity Semantics
// =============================================================================

// Interfaces and types
export type {
  // Parameter analysis
  ParameterPurpose,
  ParameterSemantics,
  ParameterUsage,
  ParameterAnalysisResult,
  IParameterAnalyzer,
  CreateParameterAnalyzer,
  // Return analysis
  ReturnPoint,
  ReturnSemantics,
  ReturnAnalysisResult,
  IReturnAnalyzer,
  CreateReturnAnalyzer,
  // Error analysis
  ErrorHandlingStrategy,
  ThrowPoint,
  TryCatchBlock,
  ErrorPath,
  ErrorAnalysisResult,
  IErrorAnalyzer,
  CreateErrorAnalyzer,
  // Combined
  FunctionSemanticAnalysis,
  SemanticAnalysisOptions,
  ISemanticAnalysisService,
  CreateSemanticAnalysisService,
} from "./interfaces.js";

// =============================================================================
// Phase 2: Data Flow Analysis
// =============================================================================

export type {
  // Data flow node types
  DataFlowNodeKind,
  DataFlowNode,
  // Data flow edge types
  DataFlowEdgeKind,
  DataFlowEdge,
  // Intra-function types
  FunctionDataFlow,
  FunctionDataFlowSummary,
  // Cross-function types
  CrossFunctionFlow,
  ArgumentFlow,
  ReturnUsage,
  // Taint analysis types
  TaintSource,
  TaintFlow,
  // Interfaces
  IDataFlowAnalyzer,
  ICrossFunctionAnalyzer,
  IDataFlowCache,
  // Cache stats
  DataFlowCacheStats,
  // Options
  DataFlowAnalysisOptions,
} from "./data-flow/index.js";

export { DEFAULT_DATA_FLOW_OPTIONS } from "./data-flow/index.js";

// Data Flow Implementations
export {
  DataFlowAnalyzer,
  createDataFlowAnalyzer,
  CrossFunctionAnalyzer,
  createCrossFunctionAnalyzer,
  DataFlowCache,
  createDataFlowCache,
} from "./data-flow/index.js";

// =============================================================================
// Semantic Analysis Service (Phase 1 Integration)
// =============================================================================

export {
  SemanticAnalysisService,
  createSemanticAnalysisService,
  type FunctionSemanticAnalysisResult,
  type FileSemanticAnalysisResult,
  type SemanticAnalysisOptions as SemanticAnalysisServiceOptions,
} from "./semantic-analysis-service.js";

// =============================================================================
// Phase 3: Side-Effect Analysis
// =============================================================================

export type {
  // Categories and confidence
  SideEffectCategory,
  DetectionConfidence,
  // Pattern definition
  SideEffectPattern,
  // Detection results
  SideEffect,
  SideEffectSummary,
  SideEffectAnalysisResult,
  // Options
  SideEffectAnalysisOptions,
  // Interfaces
  ISideEffectAnalyzer,
  ISideEffectCategorizer,
  // Factory types
  CreateSideEffectAnalyzer,
  CreateSideEffectCategorizer,
  // Database row types
  SideEffectRow as SideEffectDbRow,
  FunctionSideEffectSummaryRow,
} from "./side-effects/index.js";

// Side-Effect Implementations
export {
  SideEffectAnalyzer,
  createSideEffectAnalyzer,
  SideEffectCategorizer,
  createSideEffectCategorizer,
  DEFAULT_SIDE_EFFECT_PATTERNS,
} from "./side-effects/index.js";

// =============================================================================
// Phase 4: Design Pattern Detection
// =============================================================================

export type {
  // Pattern types
  DesignPatternType,
  PatternRole,
  PatternConfidence,
  // Detection results
  PatternParticipant,
  DetectedPattern,
  PatternAnalysisResult,
  // Heuristics
  PatternHeuristic,
  HeuristicMatch,
  // Input types
  ClassInfo,
  MethodInfo,
  PropertyInfo,
  ParameterInfo as PatternParameterInfo,
  FunctionInfo as PatternFunctionInfo,
  InterfaceInfo as PatternInterfaceInfo,
  PatternAnalysisContext,
  // Options
  PatternDetectionOptions,
  // Interfaces
  IPatternDetector,
  IPatternAnalysisService,
  // Database row types
  DesignPatternRow,
  PatternParticipantRow,
  // Factory types
  CreatePatternDetector,
  CreatePatternAnalysisService,
} from "./patterns/index.js";

export { DEFAULT_PATTERN_OPTIONS } from "./patterns/index.js";

// Pattern Detection Implementations
export {
  BasePatternDetector,
  FactoryDetector,
  createFactoryDetector,
  SingletonDetector,
  createSingletonDetector,
  ObserverDetector,
  createObserverDetector,
  RepositoryDetector,
  createRepositoryDetector,
  ServiceDetector,
  createServiceDetector,
  BuilderDetector,
  createBuilderDetector,
  StrategyDetector,
  createStrategyDetector,
  DecoratorDetector,
  createDecoratorDetector,
  createAllDetectors,
  PatternAnalysisService,
  createPatternAnalysisService,
  // UCE converter for indexing integration
  convertUCEToPatternContext,
} from "./patterns/index.js";

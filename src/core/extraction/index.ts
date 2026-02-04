/**
 * Entity Extraction Module
 *
 * Converts UCE (Universal Code Entities) into CozoDB-native batch format.
 *
 * Architecture:
 * - Pass 1: Extract entities, create local relationships, track unresolved refs
 * - Pass 2: Resolve cross-file calls and type references using symbol registry
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Row types
  FileRow,
  FunctionRow,
  ClassRow,
  InterfaceRow,
  TypeAliasRow,
  VariableRow,
  GhostNodeRow,
  ContainsRow,
  CallsRow,
  ImportsRow,
  ExtendsRow,
  ImplementsRow,
  ExtendsInterfaceRow,
  HasMethodRow,
  UsesTypeRow,
  ReferencesExternalRow,
  // Phase 1: Enhanced Entity Semantics row types
  ParameterSemanticsRow,
  ReturnSemanticsRow,
  ErrorPathRow,
  ErrorAnalysisRow,
  // Phase 2: Data Flow Analysis row types
  DataFlowCacheRow,
  DataFlowNodeRow,
  CrossFunctionFlowRow,
  TaintSourceRow,
  DataFlowsToRow,
  HasCrossFlowRow,
  TaintFlowsToRow,
  // Batch types
  CozoBatch,
  // Unresolved refs
  UnresolvedCall,
  UnresolvedTypeRef,
  // Embedding
  EmbeddingChunk,
  // Results
  ExtractionResult,
  ExtractionStats,
  ExtractionError,
  // Symbol registry
  SymbolRegistry,
} from "./types.js";

export { createEmptyBatch, createEmptyRegistry } from "./types.js";

// =============================================================================
// ID Generation
// =============================================================================

export {
  generateEntityId,
  generateFileId,
  generateGhostId,
  generateModuleId,
  createParamDisambiguator,
  createSignatureDisambiguator,
  buildQualifiedName,
  parseQualifiedName,
  isValidEntityId,
} from "./id-generator.js";

// =============================================================================
// Extractors
// =============================================================================

export {
  FunctionExtractor,
  createFunctionExtractor,
  type FunctionExtractionResult,
  type MethodExtractionResult,
} from "./function-extractor.js";

export {
  ClassExtractor,
  createClassExtractor,
  type ClassExtractionResult,
} from "./class-extractor.js";

export {
  InterfaceExtractor,
  createInterfaceExtractor,
  type InterfaceExtractionResult,
  type TypeAliasExtractionResult,
} from "./interface-extractor.js";

export {
  ImportExtractor,
  createImportExtractor,
  type ImportExtractionResult,
  type ImportedSymbolInfo,
  type VariableExtractionResult,
} from "./import-extractor.js";

// =============================================================================
// Pipeline
// =============================================================================

export {
  EntityPipeline,
  createEntityPipeline,
  type PipelineOptions,
} from "./pipeline.js";

// =============================================================================
// Analyzers (Phase 1: Enhanced Entity Semantics)
// =============================================================================

export {
  ParameterAnalyzer,
  createParameterAnalyzer,
  ReturnAnalyzer,
  createReturnAnalyzer,
  ErrorAnalyzer,
  createErrorAnalyzer,
} from "./analyzers/index.js";

export type {
  // Parameter analysis types
  IParameterAnalyzer,
  ParameterSemantics,
  ParameterAnalysisResult,
  ParameterPurpose,
  ParameterUsage,
  // Return analysis types
  IReturnAnalyzer,
  ReturnSemantics,
  ReturnAnalysisResult,
  ReturnPoint,
  // Error analysis types
  IErrorAnalyzer,
  ErrorAnalysisResult,
  ErrorPath,
  ThrowPoint,
  TryCatchBlock,
  ErrorHandlingStrategy,
} from "./analyzers/index.js";

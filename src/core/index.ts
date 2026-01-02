/**
 * Core module - Shared functionality between CLI and MCP server
 */

// Re-export error classes
export * from "./errors.js";

// Re-export all core modules
export * from "./parser/index.js";
export * from "./graph/index.js";
// Vector storage removed - now using CozoDB HNSW indices
// export * from "./vector/index.js";
export * from "./embeddings/index.js";
export * from "./llm/index.js";
export * from "./indexer/index.js";
export * from "./telemetry/index.js";
export * from "./extraction/index.js";
export * from "./graph-builder/index.js";
export * from "./justification/index.js";

// Re-export semantic types (using 'export type' for isolatedModules)
export type {
  TypeInfo,
  ResolvedParameter,
  ResolvedFunctionSignature,
  DefinitionLocation,
  ReferenceLocation,
  LinkedSymbol,
  DependencyEdge,
  DependencyNode,
  DependencyGraph,
  CircularDependency,
  AnalyzedFile,
  SymbolReference,
  ResolvedImport,
  ResolvedExport,
  SemanticDiagnostic,
  SemanticRequest,
  SemanticResponse,
  ProgressInfo,
  SemanticError,
  SemanticAnalysisOptions,
  ProgressCallback,
  WorkerState,
  TSProgramOptions,
  TSProgramInfo,
} from "./semantic/index.js";

// Re-export semantic classes
export {
  TypeScriptProgramManager,
  TypeResolver,
  SymbolLinker,
  DependencyAnalyzer,
  SemanticWorkerManager,
  SemanticAnalyzer,
} from "./semantic/index.js";

// Re-export semantic factory functions and utilities
export {
  createTSProgramManager,
  createInitializedTSProgramManager,
  createTypeResolver,
  createSymbolLinker,
  createDependencyAnalyzer,
  createSemanticWorkerManager,
  createInitializedSemanticWorkerManager,
  createSemanticAnalyzer,
  createInitializedSemanticAnalyzer,
  getNodePosition,
  getNodeEndPosition,
  getNodeRange,
  formatDiagnostic,
  DEFAULT_SEMANTIC_OPTIONS,
} from "./semantic/index.js";

// Re-export semantic SymbolKind with alias (type-only)
export type { SymbolKind as SemanticSymbolKind } from "./semantic/index.js";

// Re-export types
export * from "../types/index.js";

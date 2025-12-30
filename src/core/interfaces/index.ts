/**
 * Core Interfaces Module
 *
 * Defines all module interfaces for the Code-Synapse knowledge engine.
 * These interfaces enable:
 * - Testability via mock implementations
 * - Replaceability of concrete implementations
 * - Clear contracts between modules
 *
 * @module
 */

// Parser interface
export type { IParser } from "./IParser.js";

// Graph store interface
export type {
  IGraphStore,
  ITransaction,
  QueryResult,
  VectorSearchResult,
  GraphStoreConfig,
} from "./IGraphStore.js";

// Scanner interface
export type {
  IScanner,
  ScanOptions,
  FileMetadata,
  ProjectInfo,
  ChangedFiles,
} from "./IScanner.js";

// Semantic analyzer interface
export type {
  ISemanticAnalyzer,
  SemanticInfo,
  TypeInfo,
  SymbolInfo,
  Location,
  DependencyGraph,
  DependencyNode,
} from "./ISemanticAnalyzer.js";

// Extractor interface
export type {
  IExtractor,
  ExtractorOptions,
  CreateExtractor,
} from "./IExtractor.js";

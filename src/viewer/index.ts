/**
 * Graph Viewer Module
 *
 * Read-only visualization layer for observing indexed code knowledge.
 * This module is completely separate from core - it only reads data
 * through the IGraphStore interface.
 *
 * Design Principles:
 * - Black-box boundary: Does not know how core works
 * - Read-only: Cannot modify indexed data
 * - Replaceable: Can be completely rewritten or removed
 *
 * @module
 */

// Re-export interface types
export type {
  // Data types
  OverviewStats,
  EntityCounts,
  RelationshipCounts,
  LanguageDistribution,
  FileInfo,
  FunctionInfo,
  ClassInfo,
  InterfaceInfo,
  CallGraphNode,
  ImportGraphNode,
  InheritanceNode,
  SearchResult,
  SimilarityResult,
  ComplexityBucket,
  ComplexityDistribution,
  ExternalDependency,
  HealthIssue,
  IndexHealth,
  ListOptions,
  EntityType,
  // Main interface
  IGraphViewer,
  GraphViewerConfig,
} from "./interfaces/IGraphViewer.js";

// Implementation exports
export { CozoGraphViewer, createGraphViewer } from "./impl/CozoGraphViewer.js";

// UI exports
export { ViewerServer, startViewerServer } from "./ui/server.js";

// Natural Language Search exports
export type {
  SearchIntent,
  IntentClassification,
  NLSearchResult,
  NLSearchResponse,
  NLSearchConfig,
} from "./nl-search/index.js";

export {
  NaturalLanguageSearchService,
  createNLSearchService,
  createNLSearchServiceWithLLM,
  IntentClassifier,
  createIntentClassifier,
  QueryBuilder,
  createQueryBuilder,
} from "./nl-search/index.js";

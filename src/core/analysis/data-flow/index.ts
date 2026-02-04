/**
 * Data Flow Analysis Module
 *
 * Provides interfaces and implementations for tracking data flow
 * within and across functions. Designed for lazy evaluation.
 *
 * @module
 */

// =============================================================================
// Interfaces and Types
// =============================================================================

export type {
  // Node types
  DataFlowNodeKind,
  DataFlowNode,
  // Edge types
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
} from "./interfaces.js";

export { DEFAULT_DATA_FLOW_OPTIONS } from "./interfaces.js";

// =============================================================================
// Implementations
// =============================================================================

export { DataFlowAnalyzer, createDataFlowAnalyzer } from "./intra-function.js";
export { CrossFunctionAnalyzer, createCrossFunctionAnalyzer } from "./cross-function.js";
export { DataFlowCache, createDataFlowCache } from "./cache.js";

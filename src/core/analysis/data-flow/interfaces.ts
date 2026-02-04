/**
 * Data Flow Analysis Interfaces
 *
 * Defines contracts for tracking how data moves through functions
 * and across function boundaries. Designed for lazy evaluation -
 * compute on-demand rather than at index time.
 *
 * Key Design Decisions:
 * 1. Lazy evaluation to avoid graph explosion at index time
 * 2. Caching layer for frequently accessed data flows
 * 3. Separate intra-function and cross-function analysis
 * 4. Taint tracking for side-effect detection
 *
 * @module
 */

import type { Node as SyntaxNode } from "web-tree-sitter";

// =============================================================================
// Data Flow Node Types
// =============================================================================

/**
 * Types of data flow nodes in the graph.
 */
export type DataFlowNodeKind =
  | "parameter"      // Function parameter
  | "variable"       // Local variable
  | "return"         // Return statement
  | "call_result"    // Result of a function call
  | "property"       // Object property access
  | "literal"        // Literal value
  | "external"       // External input (API, file, user input)
  | "unknown";       // Cannot be determined

/**
 * Represents a node in the data flow graph.
 */
export interface DataFlowNode {
  /** Unique identifier for this node */
  id: string;
  /** Kind of data flow node */
  kind: DataFlowNodeKind;
  /** Human-readable name (variable name, parameter name, etc.) */
  name: string;
  /** Source code location */
  location: {
    line: number;
    column: number;
  };
  /** Inferred or declared type */
  type: string | null;
  /** Whether this node represents a tainted (side-effect) value */
  isTainted: boolean;
  /** Taint source if tainted (e.g., "user_input", "network", "filesystem") */
  taintSource: string | null;
}

// =============================================================================
// Data Flow Edge Types
// =============================================================================

/**
 * Types of data flow edges.
 */
export type DataFlowEdgeKind =
  | "assign"         // Direct assignment (x = y)
  | "transform"      // Transformation (x = f(y))
  | "read"           // Read from property/variable
  | "write"          // Write to property/variable
  | "parameter"      // Passed as parameter to function
  | "return"         // Returned from function
  | "conditional"    // Conditionally flows (through if/switch)
  | "merge"          // Merge point (phi node from multiple branches)
  | "propagate";     // Taint propagation

/**
 * Represents an edge in the data flow graph.
 */
export interface DataFlowEdge {
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Kind of data flow */
  kind: DataFlowEdgeKind;
  /** Transformation applied (if kind is "transform") */
  transformation: string | null;
  /** Condition for flow (if kind is "conditional") */
  condition: string | null;
  /** Line number where the flow occurs */
  lineNumber: number;
  /** Whether this edge propagates taint */
  propagatesTaint: boolean;
}

// =============================================================================
// Intra-Function Data Flow
// =============================================================================

/**
 * Data flow analysis result for a single function.
 */
export interface FunctionDataFlow {
  /** Function entity ID this analysis belongs to */
  functionId: string;
  /** All data flow nodes in this function */
  nodes: DataFlowNode[];
  /** All data flow edges in this function */
  edges: DataFlowEdge[];
  /** Entry points (parameters, captured variables) */
  entryPoints: string[];
  /** Exit points (return statements, mutations) */
  exitPoints: string[];
  /** Variables that are mutated */
  mutatedVariables: string[];
  /** External dependencies accessed */
  externalDependencies: string[];
  /** Confidence score (0-1) */
  confidence: number;
  /** Timestamp when this analysis was performed */
  analyzedAt: number;
}

/**
 * Summary of a function's data flow for quick lookup.
 */
export interface FunctionDataFlowSummary {
  /** Function entity ID */
  functionId: string;
  /** Number of data flow nodes */
  nodeCount: number;
  /** Number of data flow edges */
  edgeCount: number;
  /** Whether function has side effects */
  hasSideEffects: boolean;
  /** Whether function accesses external state */
  accessesExternalState: boolean;
  /** Whether function is pure (no side effects, deterministic) */
  isPure: boolean;
  /** Input parameters that affect the return value */
  inputsAffectingOutput: string[];
}

// =============================================================================
// Cross-Function Data Flow
// =============================================================================

/**
 * Represents data flow across function boundaries.
 */
export interface CrossFunctionFlow {
  /** ID of the calling function */
  callerId: string;
  /** ID of the called function */
  calleeId: string;
  /** Line number where the call occurs */
  callSite: number;
  /** Arguments passed and their source nodes */
  arguments: ArgumentFlow[];
  /** How the return value is used */
  returnUsage: ReturnUsage | null;
  /** Whether taint propagates through this call */
  propagatesTaint: boolean;
}

/**
 * Describes how an argument flows into a function call.
 */
export interface ArgumentFlow {
  /** Parameter index in the called function */
  parameterIndex: number;
  /** Parameter name in the called function */
  parameterName: string;
  /** Source data flow node in the caller */
  sourceNodeId: string;
  /** Whether this argument is tainted */
  isTainted: boolean;
}

/**
 * Describes how a function's return value is used.
 */
export interface ReturnUsage {
  /** How the return value is used */
  usageKind: "assigned" | "returned" | "passed" | "ignored" | "conditional";
  /** Target node ID if assigned or passed */
  targetNodeId: string | null;
  /** Variable name if assigned */
  assignedTo: string | null;
}

// =============================================================================
// Taint Analysis
// =============================================================================

/**
 * Taint source categories for tracking data provenance.
 */
export type TaintSource =
  | "user_input"     // User-provided data (form inputs, CLI args)
  | "network"        // Data from network requests
  | "filesystem"     // Data read from files
  | "database"       // Data from database queries
  | "environment"    // Environment variables
  | "time"           // Time-dependent values
  | "random"         // Random/non-deterministic values
  | "external_api"   // Third-party API responses
  | "unknown";       // Unknown external source

/**
 * Represents a taint flow path through the code.
 */
export interface TaintFlow {
  /** Taint source category */
  source: TaintSource;
  /** Data flow node where taint originates */
  originNodeId: string;
  /** Path of node IDs from source to sink */
  path: string[];
  /** Data flow node where tainted data is used (sink) */
  sinkNodeId: string;
  /** Whether the taint is sanitized along the path */
  isSanitized: boolean;
  /** Node ID where sanitization occurs (if any) */
  sanitizationPoint: string | null;
}

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Interface for intra-function data flow analysis.
 */
export interface IDataFlowAnalyzer {
  /**
   * Analyze data flow within a single function.
   *
   * @param functionNode - AST node of the function
   * @param functionBody - Source code of the function body
   * @param functionId - Entity ID of the function
   * @returns Data flow analysis result
   */
  analyzeFunction(
    functionNode: SyntaxNode,
    functionBody: string,
    functionId: string
  ): FunctionDataFlow;

  /**
   * Get a summary of a function's data flow.
   *
   * @param dataFlow - Full data flow analysis
   * @returns Summary for quick lookup
   */
  summarize(dataFlow: FunctionDataFlow): FunctionDataFlowSummary;

  /**
   * Detect taint flows within a function.
   *
   * @param dataFlow - Full data flow analysis
   * @returns Array of taint flows found
   */
  detectTaintFlows(dataFlow: FunctionDataFlow): TaintFlow[];
}

/**
 * Interface for cross-function data flow analysis.
 */
export interface ICrossFunctionAnalyzer {
  /**
   * Analyze data flow between two functions at a call site.
   *
   * @param callerFlow - Data flow of the calling function
   * @param calleeFlow - Data flow of the called function
   * @param callSiteNode - AST node of the call expression
   * @returns Cross-function flow information
   */
  analyzeCall(
    callerFlow: FunctionDataFlow,
    calleeFlow: FunctionDataFlow,
    callSiteNode: SyntaxNode
  ): CrossFunctionFlow;

  /**
   * Build a complete data flow graph across multiple functions.
   *
   * @param functionFlows - Map of function ID to data flow
   * @param callGraph - Map of caller ID to array of callee IDs
   * @returns Array of all cross-function flows
   */
  buildCrossFlowGraph(
    functionFlows: Map<string, FunctionDataFlow>,
    callGraph: Map<string, string[]>
  ): CrossFunctionFlow[];

  /**
   * Trace data flow from a source function to all reachable functions.
   *
   * @param sourceId - Starting function ID
   * @param parameterName - Parameter to trace
   * @param functionFlows - Map of function ID to data flow
   * @param crossFlows - Array of cross-function flows
   * @returns Array of function IDs where the data reaches
   */
  traceDataFlow(
    sourceId: string,
    parameterName: string,
    functionFlows: Map<string, FunctionDataFlow>,
    crossFlows: CrossFunctionFlow[]
  ): string[];
}

/**
 * Interface for caching data flow analysis results.
 * Supports the lazy evaluation strategy - compute on demand, cache for reuse.
 */
export interface IDataFlowCache {
  /**
   * Get cached data flow for a function.
   *
   * @param functionId - Function entity ID
   * @returns Cached data flow or null if not cached
   */
  get(functionId: string): FunctionDataFlow | null;

  /**
   * Store data flow analysis result in cache.
   *
   * @param functionId - Function entity ID
   * @param dataFlow - Data flow analysis result
   */
  set(functionId: string, dataFlow: FunctionDataFlow): void;

  /**
   * Check if data flow is cached and still valid.
   *
   * @param functionId - Function entity ID
   * @param fileHash - Current file hash for staleness check
   * @returns True if cached and valid
   */
  isValid(functionId: string, fileHash: string): boolean;

  /**
   * Invalidate cache for a function.
   *
   * @param functionId - Function entity ID
   */
  invalidate(functionId: string): void;

  /**
   * Invalidate all cache entries for a file.
   *
   * @param fileId - File entity ID
   */
  invalidateFile(fileId: string): void;

  /**
   * Get cache statistics.
   */
  getStats(): DataFlowCacheStats;

  /**
   * Clear all cached data.
   */
  clear(): void;
}

/**
 * Statistics for the data flow cache.
 */
export interface DataFlowCacheStats {
  /** Number of entries in cache */
  entries: number;
  /** Cache hit count */
  hits: number;
  /** Cache miss count */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Total memory used (estimated bytes) */
  memoryUsage: number;
}

// =============================================================================
// Analysis Options
// =============================================================================

/**
 * Options for data flow analysis.
 */
export interface DataFlowAnalysisOptions {
  /** Maximum depth for interprocedural analysis */
  maxCallDepth: number;
  /** Whether to track taint propagation */
  trackTaint: boolean;
  /** Taint sources to track */
  taintSources: TaintSource[];
  /** Whether to include literal values as nodes */
  includeLiterals: boolean;
  /** Whether to analyze property accesses */
  analyzeProperties: boolean;
  /** Timeout for analysis (milliseconds) */
  timeout: number;
}

/**
 * Default options for data flow analysis.
 */
export const DEFAULT_DATA_FLOW_OPTIONS: DataFlowAnalysisOptions = {
  maxCallDepth: 5,
  trackTaint: true,
  taintSources: ["user_input", "network", "filesystem", "database"],
  includeLiterals: false,
  analyzeProperties: true,
  timeout: 5000,
};

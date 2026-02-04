/**
 * Side-Effect Analysis Interfaces
 *
 * This module defines interfaces for detecting and categorizing side effects
 * in functions. Side effects are operations that affect state outside the
 * function's return value.
 *
 * Following the decoupling philosophy:
 * - Interfaces are defined separately from implementations
 * - No vendor-specific code in interfaces
 * - Implementations depend on interfaces, not vice versa
 *
 * @module
 */

import type { Node as SyntaxNode } from "web-tree-sitter";

// =============================================================================
// Side-Effect Categories
// =============================================================================

/**
 * Categories of side effects that can be detected.
 */
export type SideEffectCategory =
  | "io-file"           // File system operations (fs.*, readFile, writeFile)
  | "io-network"        // Network operations (fetch, axios, http.*)
  | "io-database"       // Database operations (ORM calls, raw SQL)
  | "io-console"        // Console/logging operations
  | "mutation-param"    // Mutates input parameter
  | "mutation-global"   // Mutates global/module-level state
  | "mutation-this"     // Mutates object state (this.*)
  | "mutation-closure"  // Mutates closure variable
  | "async-spawn"       // Spawns async operations (setTimeout, Promise)
  | "external-service"  // Calls external APIs/services
  | "dom-manipulation"  // DOM operations (browser)
  | "event-emission"    // Emits events
  | "unknown";          // Detected but uncategorized

/**
 * Confidence level for side-effect detection.
 */
export type DetectionConfidence = "high" | "medium" | "low";

/**
 * Known API patterns for side-effect detection.
 * Maps API names/patterns to their side-effect category.
 */
export interface SideEffectPattern {
  /** Pattern to match (can be regex string or literal) */
  pattern: string;
  /** Category of side effect */
  category: SideEffectCategory;
  /** Description of the side effect */
  description: string;
  /** Confidence level for this pattern */
  confidence: DetectionConfidence;
  /** Whether this is a sink (writes) or source (reads) */
  kind: "sink" | "source" | "both";
}

// =============================================================================
// Side-Effect Detection Results
// =============================================================================

/**
 * A detected side effect in a function.
 */
export interface SideEffect {
  /** Unique ID for this side effect */
  id: string;
  /** Function ID where this side effect occurs */
  functionId: string;
  /** Category of the side effect */
  category: SideEffectCategory;
  /** Human-readable description */
  description: string;
  /** What is affected (e.g., "this.state", "process.env", "database") */
  target: string | null;
  /** Whether the side effect only happens under certain conditions */
  isConditional: boolean;
  /** The condition under which this side effect occurs (if conditional) */
  condition: string | null;
  /** The API/method call causing the side effect */
  apiCall: string;
  /** Source location */
  location: {
    line: number;
    column: number;
  };
  /** Confidence level of detection */
  confidence: DetectionConfidence;
  /** Evidence for why we detected this as a side effect */
  evidence: string[];
}

/**
 * Summary of side effects for a function.
 */
export interface SideEffectSummary {
  /** Total number of side effects */
  totalCount: number;
  /** Count by category */
  byCategory: Record<SideEffectCategory, number>;
  /** Whether the function is pure (no side effects) */
  isPure: boolean;
  /** Whether all side effects are conditional */
  allConditional: boolean;
  /** Primary side effect categories (most significant) */
  primaryCategories: SideEffectCategory[];
  /** Risk level for this function */
  riskLevel: "low" | "medium" | "high";
}

/**
 * Result of side-effect analysis for a function.
 */
export interface SideEffectAnalysisResult {
  /** Function ID this analysis belongs to */
  functionId: string;
  /** File path containing the function */
  filePath: string;
  /** All detected side effects */
  sideEffects: SideEffect[];
  /** Summary of side effects */
  summary: SideEffectSummary;
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** Analysis timestamp */
  analyzedAt: number;
}

// =============================================================================
// Side-Effect Analyzer Interface
// =============================================================================

/**
 * Options for side-effect analysis.
 */
export interface SideEffectAnalysisOptions {
  /** Additional patterns to detect */
  additionalPatterns?: SideEffectPattern[];
  /** Categories to skip */
  skipCategories?: SideEffectCategory[];
  /** Minimum confidence level to report */
  minConfidence?: DetectionConfidence;
  /** Whether to analyze nested function calls */
  analyzeNestedCalls?: boolean;
  /** Maximum depth for nested analysis */
  maxNestedDepth?: number;
}

/**
 * Interface for side-effect analysis.
 *
 * Analyzes functions to detect and categorize side effects:
 * - I/O operations (file, network, database, console)
 * - State mutations (parameters, globals, this)
 * - Async operations
 * - External service calls
 */
export interface ISideEffectAnalyzer {
  /**
   * Analyze a function for side effects.
   *
   * @param functionNode - AST node of the function
   * @param functionBody - Source code of the function body
   * @param functionId - Unique ID of the function
   * @param filePath - Path to the file containing the function
   * @param options - Analysis options
   * @returns Analysis result with detected side effects
   */
  analyze(
    functionNode: SyntaxNode,
    functionBody: string,
    functionId: string,
    filePath: string,
    options?: SideEffectAnalysisOptions
  ): SideEffectAnalysisResult;

  /**
   * Check if a specific API call is known to have side effects.
   *
   * @param apiCall - The API call expression (e.g., "fs.writeFile")
   * @returns Pattern info if known, null otherwise
   */
  getKnownPattern(apiCall: string): SideEffectPattern | null;

  /**
   * Get all registered side-effect patterns.
   *
   * @returns Array of all known patterns
   */
  getAllPatterns(): SideEffectPattern[];

  /**
   * Register a custom side-effect pattern.
   *
   * @param pattern - The pattern to register
   */
  registerPattern(pattern: SideEffectPattern): void;
}

// =============================================================================
// Side-Effect Categorizer Interface
// =============================================================================

/**
 * Interface for categorizing detected side effects.
 *
 * Takes raw detection results and assigns categories based on
 * patterns and heuristics.
 */
export interface ISideEffectCategorizer {
  /**
   * Categorize an API call.
   *
   * @param apiCall - The API call expression
   * @param context - Additional context (arguments, surrounding code)
   * @returns Category and confidence
   */
  categorize(
    apiCall: string,
    context?: string
  ): { category: SideEffectCategory; confidence: DetectionConfidence } | null;

  /**
   * Calculate risk level based on side effects.
   *
   * @param sideEffects - Detected side effects
   * @returns Risk level assessment
   */
  calculateRiskLevel(sideEffects: SideEffect[]): "low" | "medium" | "high";

  /**
   * Determine primary categories from a list of side effects.
   *
   * @param sideEffects - All detected side effects
   * @returns Most significant categories
   */
  getPrimaryCategories(sideEffects: SideEffect[]): SideEffectCategory[];
}

// =============================================================================
// Factory Types
// =============================================================================

/**
 * Factory function type for creating a side-effect analyzer.
 */
export type CreateSideEffectAnalyzer = (
  categorizer?: ISideEffectCategorizer
) => ISideEffectAnalyzer;

/**
 * Factory function type for creating a side-effect categorizer.
 */
export type CreateSideEffectCategorizer = () => ISideEffectCategorizer;

// =============================================================================
// Database Row Types (for storage)
// =============================================================================

/**
 * Row type for storing side effects in the database.
 * Matches the schema definition for side_effects table.
 */
export interface SideEffectRow {
  /** Side effect ID */
  id: string;
  /** Function ID */
  function_id: string;
  /** File path */
  file_path: string;
  /** Category */
  category: string;
  /** Description */
  description: string;
  /** Target (nullable) */
  target: string | null;
  /** API call expression */
  api_call: string;
  /** Whether conditional */
  is_conditional: boolean;
  /** Condition (nullable) */
  condition: string | null;
  /** Confidence level */
  confidence: string;
  /** Evidence (JSON array) */
  evidence_json: string;
  /** Source line */
  source_line: number;
  /** Source column */
  source_column: number;
  /** Analysis timestamp */
  analyzed_at: number;
}

/**
 * Row type for function side-effect summary.
 */
export interface FunctionSideEffectSummaryRow {
  /** Function ID */
  function_id: string;
  /** File path */
  file_path: string;
  /** Total side effect count */
  total_count: number;
  /** Is pure function */
  is_pure: boolean;
  /** All side effects are conditional */
  all_conditional: boolean;
  /** Primary categories (JSON array) */
  primary_categories_json: string;
  /** Risk level */
  risk_level: string;
  /** Overall confidence */
  confidence: number;
  /** Analysis timestamp */
  analyzed_at: number;
}

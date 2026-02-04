/**
 * Analysis Layer Interfaces
 *
 * This module defines interfaces for enhanced code analysis capabilities:
 * - Parameter semantic analysis
 * - Return value analysis
 * - Error path analysis
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
// Parameter Semantic Analysis
// =============================================================================

/**
 * Purpose classification for function parameters.
 */
export type ParameterPurpose =
  | "input"      // Data passed in for processing
  | "output"     // Reference to receive results (rare in JS/TS)
  | "config"     // Configuration/options object
  | "callback"   // Function to be called
  | "context"    // Context object (this, req, ctx)
  | "unknown";   // Could not determine purpose

/**
 * Enhanced semantic information about a function parameter.
 */
export interface ParameterSemantics {
  /** Parameter name */
  name: string;
  /** Parameter index (0-based) */
  index: number;
  /** Declared type (if any) */
  type: string | null;
  /** Inferred purpose category */
  purpose: ParameterPurpose;
  /** Whether the parameter is optional */
  isOptional: boolean;
  /** Default value expression (if any) */
  defaultValue: string | null;
  /** Is a rest parameter (...args) */
  isRest: boolean;
  /** Is destructured */
  isDestructured: boolean;
  /** Validation patterns detected (e.g., "non-null", "positive") */
  validationRules: string[];
  /** Expressions where this parameter is used */
  usedInExpressions: ParameterUsage[];
  /** Whether the parameter is mutated in the function body */
  isMutated: boolean;
  /** Lines where the parameter is accessed */
  accessedAtLines: number[];
}

/**
 * Describes how a parameter is used within a function.
 */
export interface ParameterUsage {
  /** Type of usage */
  kind: "read" | "write" | "call" | "property-access" | "spread" | "passed";
  /** Line number where usage occurs */
  line: number;
  /** Brief description of the usage context */
  context: string;
  /** Expression text (truncated) */
  expression: string;
}

/**
 * Result of parameter semantic analysis for a function.
 */
export interface ParameterAnalysisResult {
  /** Function ID this analysis belongs to */
  functionId: string;
  /** Analyzed parameters with semantics */
  parameters: ParameterSemantics[];
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** Analysis timestamp */
  analyzedAt: number;
}

/**
 * Interface for parameter semantic analysis.
 *
 * Analyzes function parameters to determine:
 * - Purpose (input, config, callback, etc.)
 * - Usage patterns within the function body
 * - Validation rules applied to the parameter
 */
export interface IParameterAnalyzer {
  /**
   * Analyze parameters of a function.
   *
   * @param functionNode - AST node of the function
   * @param functionBody - Source code of the function body
   * @param functionId - Unique ID of the function
   * @returns Analysis result with parameter semantics
   */
  analyze(
    functionNode: SyntaxNode,
    functionBody: string,
    functionId: string
  ): ParameterAnalysisResult;
}

// =============================================================================
// Return Value Analysis
// =============================================================================

/**
 * A single return point in a function.
 */
export interface ReturnPoint {
  /** Line number of the return statement */
  line: number;
  /** Column of the return statement */
  column: number;
  /** The expression being returned (truncated) */
  expression: string | null;
  /** Type of value being returned */
  valueType: "literal" | "variable" | "call" | "expression" | "void" | "implicit";
  /** Whether this return is conditional */
  isConditional: boolean;
  /** Condition that leads to this return (if conditional) */
  condition: string | null;
  /** Whether this is an early return */
  isEarlyReturn: boolean;
}

/**
 * Enhanced semantic information about function return values.
 */
export interface ReturnSemantics {
  /** Declared return type (if any) */
  declaredType: string | null;
  /** Inferred return type from analysis */
  inferredType: string | null;
  /** All return points in the function */
  returnPoints: ReturnPoint[];
  /** Possible values for union/enum types */
  possibleValues: string[];
  /** Conditions under which null/undefined is returned */
  nullConditions: string[];
  /** Conditions under which errors are thrown instead of returning */
  errorConditions: string[];
  /** Data sources that contribute to the return value */
  derivedFrom: string[];
  /** Transformations applied to data before returning */
  transformations: string[];
  /** Whether function can return void/undefined */
  canReturnVoid: boolean;
  /** Whether function always throws (never returns) */
  alwaysThrows: boolean;
}

/**
 * Result of return value analysis for a function.
 */
export interface ReturnAnalysisResult {
  /** Function ID this analysis belongs to */
  functionId: string;
  /** Return semantics */
  returnSemantics: ReturnSemantics;
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** Analysis timestamp */
  analyzedAt: number;
}

/**
 * Interface for return value analysis.
 *
 * Analyzes function return values to determine:
 * - All return points and their conditions
 * - Possible values for union types
 * - Data sources contributing to returns
 */
export interface IReturnAnalyzer {
  /**
   * Analyze return values of a function.
   *
   * @param functionNode - AST node of the function
   * @param functionBody - Source code of the function body
   * @param functionId - Unique ID of the function
   * @returns Analysis result with return semantics
   */
  analyze(
    functionNode: SyntaxNode,
    functionBody: string,
    functionId: string
  ): ReturnAnalysisResult;
}

// =============================================================================
// Error Path Analysis
// =============================================================================

/**
 * Categories of error handling patterns.
 */
export type ErrorHandlingStrategy =
  | "throw"           // Throws error to caller
  | "catch-rethrow"   // Catches and rethrows (possibly wrapped)
  | "catch-handle"    // Catches and handles (recovers)
  | "catch-log"       // Catches and logs, then continues
  | "catch-ignore"    // Catches and ignores (empty catch)
  | "catch-return"    // Catches and returns error value
  | "propagate";      // Let error propagate (no try/catch)

/**
 * Information about a throw statement.
 */
export interface ThrowPoint {
  /** Line number of the throw statement */
  line: number;
  /** Column of the throw statement */
  column: number;
  /** Error type/class being thrown */
  errorType: string;
  /** Error message (if literal string) */
  errorMessage: string | null;
  /** Condition that leads to this throw (if conditional) */
  condition: string | null;
  /** Whether this is inside a try block (will be caught) */
  isInsideTry: boolean;
  /** Expression text of the throw */
  expression: string;
}

/**
 * Information about a try/catch block.
 */
export interface TryCatchBlock {
  /** Start line of try block */
  tryStartLine: number;
  /** End line of try block */
  tryEndLine: number;
  /** Caught error variable name (if any) */
  catchVariable: string | null;
  /** Caught error type annotation (if any) */
  catchType: string | null;
  /** How the error is handled */
  handlingStrategy: ErrorHandlingStrategy;
  /** Start line of catch block */
  catchStartLine: number;
  /** End line of catch block */
  catchEndLine: number;
  /** Whether there's a finally block */
  hasFinally: boolean;
  /** Start line of finally block (if any) */
  finallyStartLine: number | null;
  /** End line of finally block (if any) */
  finallyEndLine: number | null;
}

/**
 * An error path through the function.
 */
export interface ErrorPath {
  /** Unique ID for this error path */
  id: string;
  /** Function ID this error path belongs to */
  functionId: string;
  /** Error type/class */
  errorType: string;
  /** Condition that triggers this error */
  condition: string | null;
  /** Whether the error is handled within this function */
  isHandled: boolean;
  /** How the error is handled (if handled) */
  handlingStrategy: ErrorHandlingStrategy | null;
  /** Recovery action taken (if handled) */
  recoveryAction: string | null;
  /** Functions that will receive this error if propagated */
  propagatesTo: string[];
  /** Source location of the throw/error */
  sourceLocation: {
    line: number;
    column: number;
  };
  /** Full stack context (nested try/catch info) */
  stackContext: string[];
}

/**
 * Result of error path analysis for a function.
 */
export interface ErrorAnalysisResult {
  /** Function ID this analysis belongs to */
  functionId: string;
  /** All throw points in the function */
  throwPoints: ThrowPoint[];
  /** All try/catch blocks in the function */
  tryCatchBlocks: TryCatchBlock[];
  /** Extracted error paths */
  errorPaths: ErrorPath[];
  /** Whether the function is guaranteed to never throw */
  neverThrows: boolean;
  /** Whether the function has a top-level try/catch (catches all) */
  hasTopLevelCatch: boolean;
  /** Error types that can escape this function */
  escapingErrorTypes: string[];
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** Analysis timestamp */
  analyzedAt: number;
}

/**
 * Interface for error path analysis.
 *
 * Analyzes functions to determine:
 * - All throw points and error types
 * - Try/catch block structure
 * - Error propagation paths
 */
export interface IErrorAnalyzer {
  /**
   * Analyze error handling in a function.
   *
   * @param functionNode - AST node of the function
   * @param functionBody - Source code of the function body
   * @param functionId - Unique ID of the function
   * @returns Analysis result with error paths
   */
  analyze(
    functionNode: SyntaxNode,
    functionBody: string,
    functionId: string
  ): ErrorAnalysisResult;
}

// =============================================================================
// Combined Analysis Service
// =============================================================================

/**
 * Combined result of all semantic analyses for a function.
 */
export interface FunctionSemanticAnalysis {
  /** Function ID */
  functionId: string;
  /** Parameter analysis */
  parameters: ParameterAnalysisResult | null;
  /** Return analysis */
  returns: ReturnAnalysisResult | null;
  /** Error analysis */
  errors: ErrorAnalysisResult | null;
  /** Overall analysis timestamp */
  analyzedAt: number;
}

/**
 * Options for semantic analysis.
 */
export interface SemanticAnalysisOptions {
  /** Whether to analyze parameters */
  analyzeParameters?: boolean;
  /** Whether to analyze return values */
  analyzeReturns?: boolean;
  /** Whether to analyze error paths */
  analyzeErrors?: boolean;
  /** Maximum function body size to analyze (chars) */
  maxBodySize?: number;
}

/**
 * Interface for the combined semantic analysis service.
 *
 * Orchestrates parameter, return, and error analysis.
 */
export interface ISemanticAnalysisService {
  /**
   * Perform semantic analysis on a function.
   *
   * @param functionNode - AST node of the function
   * @param functionBody - Source code of the function body
   * @param functionId - Unique ID of the function
   * @param options - Analysis options
   * @returns Combined analysis result
   */
  analyze(
    functionNode: SyntaxNode,
    functionBody: string,
    functionId: string,
    options?: SemanticAnalysisOptions
  ): FunctionSemanticAnalysis;
}

// =============================================================================
// Factory Types
// =============================================================================

/**
 * Factory function type for creating a parameter analyzer.
 */
export type CreateParameterAnalyzer = () => IParameterAnalyzer;

/**
 * Factory function type for creating a return analyzer.
 */
export type CreateReturnAnalyzer = () => IReturnAnalyzer;

/**
 * Factory function type for creating an error analyzer.
 */
export type CreateErrorAnalyzer = () => IErrorAnalyzer;

/**
 * Factory function type for creating a semantic analysis service.
 */
export type CreateSemanticAnalysisService = (
  parameterAnalyzer?: IParameterAnalyzer,
  returnAnalyzer?: IReturnAnalyzer,
  errorAnalyzer?: IErrorAnalyzer
) => ISemanticAnalysisService;

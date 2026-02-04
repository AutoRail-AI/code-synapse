/**
 * Enhanced Entity Analyzers
 *
 * Provides semantic analysis for extracted entities:
 * - Parameter semantic analysis
 * - Return value analysis
 * - Error path analysis
 *
 * Part of Phase 1: Enhanced Entity Semantics
 *
 * @module
 */

// Parameter analyzer
export { ParameterAnalyzer, createParameterAnalyzer } from "./parameter-analyzer.js";

// Return analyzer
export { ReturnAnalyzer, createReturnAnalyzer } from "./return-analyzer.js";

// Error analyzer
export { ErrorAnalyzer, createErrorAnalyzer } from "./error-analyzer.js";

// Re-export types from analysis interfaces
export type {
  // Parameter types
  IParameterAnalyzer,
  ParameterSemantics,
  ParameterAnalysisResult,
  ParameterPurpose,
  ParameterUsage,
  // Return types
  IReturnAnalyzer,
  ReturnSemantics,
  ReturnAnalysisResult,
  ReturnPoint,
  // Error types
  IErrorAnalyzer,
  ErrorAnalysisResult,
  ErrorPath,
  ThrowPoint,
  TryCatchBlock,
  ErrorHandlingStrategy,
} from "../../analysis/interfaces.js";

/**
 * Side-Effect Analysis Module
 *
 * Provides tools for detecting and categorizing side effects in functions:
 * - I/O operations (file, network, database, console)
 * - State mutations (parameters, globals, this, closures)
 * - Async operations (setTimeout, workers, child processes)
 * - External service calls
 * - DOM manipulation
 * - Event emission
 *
 * Following the decoupling philosophy:
 * - All interfaces exported from interfaces.ts
 * - Implementations in categorizer.ts and detector.ts
 * - Factory functions for creating instances
 *
 * @module
 */

// =============================================================================
// Interface Exports
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
  SideEffectRow,
  FunctionSideEffectSummaryRow,
} from "./interfaces.js";

// =============================================================================
// Implementation Exports
// =============================================================================

export {
  // Categorizer
  SideEffectCategorizer,
  createSideEffectCategorizer,
  DEFAULT_SIDE_EFFECT_PATTERNS,
} from "./categorizer.js";

export {
  // Detector/Analyzer
  SideEffectAnalyzer,
  createSideEffectAnalyzer,
} from "./detector.js";

/**
 * Design Pattern Detection Module
 *
 * Provides automatic detection of common design patterns in code.
 * Part of Phase 4: Design Pattern Detection.
 *
 * Supported Patterns:
 * - Factory: Function returning new instances
 * - Singleton: Private constructor, static getInstance
 * - Observer: subscribe/unsubscribe, event emitter patterns
 * - Repository: CRUD methods, storage abstraction
 * - Service: Stateless class, dependency injection
 * - Adapter: Implements interface, wraps another type
 * - Builder: Method chaining, build() method
 * - Strategy: Interface with single method, multiple implementations
 * - Decorator: Wraps same interface, adds behavior
 *
 * @module
 */

// =============================================================================
// Interfaces and Types
// =============================================================================

export type {
  // Pattern types
  DesignPatternType,
  PatternRole,
  PatternConfidence,
  // Detection results
  PatternParticipant,
  DetectedPattern,
  PatternAnalysisResult,
  // Heuristics
  PatternHeuristic,
  HeuristicMatch,
  // Input types
  ClassInfo,
  MethodInfo,
  PropertyInfo,
  ParameterInfo,
  FunctionInfo,
  InterfaceInfo,
  PatternAnalysisContext,
  // Options
  PatternDetectionOptions,
  // Interfaces
  IPatternDetector,
  IPatternAnalysisService,
  // Database row types
  DesignPatternRow,
  PatternParticipantRow,
  // Factory types
  CreatePatternDetector,
  CreatePatternAnalysisService,
} from "./interfaces.js";

export { DEFAULT_PATTERN_OPTIONS } from "./interfaces.js";

// =============================================================================
// Detectors
// =============================================================================

export {
  BasePatternDetector,
  FactoryDetector,
  createFactoryDetector,
  SingletonDetector,
  createSingletonDetector,
  ObserverDetector,
  createObserverDetector,
  RepositoryDetector,
  createRepositoryDetector,
  ServiceDetector,
  createServiceDetector,
  BuilderDetector,
  createBuilderDetector,
  StrategyDetector,
  createStrategyDetector,
  DecoratorDetector,
  createDecoratorDetector,
  createAllDetectors,
} from "./detectors/index.js";

// =============================================================================
// Service
// =============================================================================

export {
  PatternAnalysisService,
  createPatternAnalysisService,
} from "./service.js";

// =============================================================================
// UCE Converter
// =============================================================================

export { convertUCEToPatternContext } from "./uce-converter.js";

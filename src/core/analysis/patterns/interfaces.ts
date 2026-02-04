/**
 * Design Pattern Detection Interfaces
 *
 * Provides interfaces for detecting common design patterns in code.
 * Part of Phase 4: Design Pattern Detection.
 *
 * Supported Patterns:
 * - Factory: Function returning new instances, multiple concrete types
 * - Singleton: Private constructor, static getInstance, module-level instance
 * - Observer: subscribe/unsubscribe methods, event emitter patterns
 * - Repository: CRUD methods, entity type parameter, storage abstraction
 * - Service: Stateless class, injected dependencies, business methods
 * - Adapter: Implements interface, wraps another type, method delegation
 * - Builder: Method chaining, build() method, partial construction
 * - Strategy: Interface with single method, multiple implementations
 * - Decorator: Wraps same interface, delegates with additions
 *
 * @module
 */

import type { Node as SyntaxNode } from "web-tree-sitter";

// =============================================================================
// Pattern Types
// =============================================================================

/**
 * Types of design patterns that can be detected.
 */
export type DesignPatternType =
  | "factory"
  | "singleton"
  | "observer"
  | "repository"
  | "service"
  | "adapter"
  | "builder"
  | "strategy"
  | "decorator"
  | "facade"
  | "proxy"
  | "composite"
  | "unknown";

/**
 * Roles that entities can play in a design pattern.
 */
export type PatternRole =
  // Factory pattern roles
  | "factory"
  | "product"
  | "concrete_product"
  // Singleton pattern roles
  | "singleton"
  | "instance_holder"
  // Observer pattern roles
  | "subject"
  | "observer"
  | "event_emitter"
  | "event_listener"
  // Repository pattern roles
  | "repository"
  | "entity"
  | "data_source"
  // Service pattern roles
  | "service"
  | "dependency"
  | "client"
  // Adapter pattern roles
  | "adapter"
  | "adaptee"
  | "target"
  // Builder pattern roles
  | "builder"
  | "director"
  | "built_product"
  // Strategy pattern roles
  | "strategy_interface"
  | "concrete_strategy"
  | "context"
  // Decorator pattern roles
  | "decorator"
  | "component"
  | "decorated_component"
  // Facade pattern roles
  | "facade"
  | "subsystem"
  // Proxy pattern roles
  | "proxy"
  | "real_subject"
  // Composite pattern roles
  | "composite"
  | "leaf"
  // Generic
  | "participant"
  | "unknown";

/**
 * Confidence level for pattern detection.
 */
export type PatternConfidence = "high" | "medium" | "low";

// =============================================================================
// Pattern Detection Results
// =============================================================================

/**
 * A participant in a detected design pattern.
 */
export interface PatternParticipant {
  /** Role of this participant in the pattern */
  role: PatternRole;
  /** Entity ID of the participant */
  entityId: string;
  /** Type of entity (class, function, interface, etc.) */
  entityType: "class" | "function" | "interface" | "variable" | "method";
  /** Name of the entity */
  entityName: string;
  /** File where the entity is defined */
  filePath: string;
  /** Why this entity is considered this role */
  evidence: string[];
}

/**
 * A detected design pattern instance.
 */
export interface DetectedPattern {
  /** Unique identifier for this pattern instance */
  id: string;
  /** Type of pattern detected */
  patternType: DesignPatternType;
  /** Name for this pattern instance (e.g., "UserFactory", "LoggerSingleton") */
  name: string;
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** Confidence level classification */
  confidenceLevel: PatternConfidence;
  /** Participants in this pattern */
  participants: PatternParticipant[];
  /** Evidence supporting this pattern detection */
  evidence: string[];
  /** File(s) where this pattern is primarily located */
  filePaths: string[];
  /** Optional description of the pattern instance */
  description?: string;
  /** When this pattern was detected */
  detectedAt: number;
}

/**
 * Result of pattern analysis for a file or codebase.
 */
export interface PatternAnalysisResult {
  /** Detected patterns */
  patterns: DetectedPattern[];
  /** Statistics */
  stats: {
    /** Total patterns detected */
    totalPatterns: number;
    /** Patterns by type */
    patternsByType: Record<DesignPatternType, number>;
    /** High confidence patterns */
    highConfidenceCount: number;
    /** Medium confidence patterns */
    mediumConfidenceCount: number;
    /** Low confidence patterns */
    lowConfidenceCount: number;
    /** Total entities analyzed */
    entitiesAnalyzed: number;
    /** Analysis duration in ms */
    analysisTimeMs: number;
  };
  /** Overall confidence in the analysis */
  confidence: number;
  /** Timestamp */
  analyzedAt: number;
}

// =============================================================================
// Pattern Detection Heuristics
// =============================================================================

/**
 * Heuristic rule for detecting a pattern.
 */
export interface PatternHeuristic {
  /** Name of the heuristic */
  name: string;
  /** Pattern type this heuristic detects */
  patternType: DesignPatternType;
  /** Weight of this heuristic (0.0 - 1.0) */
  weight: number;
  /** Description of what this heuristic looks for */
  description: string;
}

/**
 * Result of applying a single heuristic.
 */
export interface HeuristicMatch {
  /** The heuristic that matched */
  heuristic: PatternHeuristic;
  /** Confidence of this match (0.0 - 1.0) */
  confidence: number;
  /** Evidence for this match */
  evidence: string[];
  /** Entity IDs involved */
  entityIds: string[];
}

// =============================================================================
// Input Types
// =============================================================================

/**
 * Information about a class for pattern analysis.
 */
export interface ClassInfo {
  id: string;
  name: string;
  filePath: string;
  methods: MethodInfo[];
  properties: PropertyInfo[];
  constructorParams: ParameterInfo[];
  extendsClass?: string;
  implementsInterfaces: string[];
  isAbstract: boolean;
  isExported: boolean;
  hasPrivateConstructor: boolean;
  astNode?: SyntaxNode;
}

/**
 * Information about a method for pattern analysis.
 */
export interface MethodInfo {
  id: string;
  name: string;
  classId: string;
  parameters: ParameterInfo[];
  returnType?: string;
  isStatic: boolean;
  isAsync: boolean;
  isPrivate: boolean;
  isPublic: boolean;
  body?: string;
  astNode?: SyntaxNode;
}

/**
 * Information about a property for pattern analysis.
 */
export interface PropertyInfo {
  name: string;
  type?: string;
  isStatic: boolean;
  isPrivate: boolean;
  defaultValue?: string;
}

/**
 * Information about a parameter for pattern analysis.
 */
export interface ParameterInfo {
  name: string;
  type?: string;
  isOptional: boolean;
}

/**
 * Information about a function for pattern analysis.
 */
export interface FunctionInfo {
  id: string;
  name: string;
  filePath: string;
  parameters: ParameterInfo[];
  returnType?: string;
  isExported: boolean;
  isAsync: boolean;
  body?: string;
  astNode?: SyntaxNode;
}

/**
 * Information about an interface for pattern analysis.
 */
export interface InterfaceInfo {
  id: string;
  name: string;
  filePath: string;
  methods: Array<{
    name: string;
    parameters: ParameterInfo[];
    returnType?: string;
  }>;
  properties: Array<{
    name: string;
    type?: string;
    isOptional: boolean;
  }>;
  extendsInterfaces: string[];
  isExported: boolean;
}

/**
 * Context for pattern analysis containing all relevant entities.
 */
export interface PatternAnalysisContext {
  /** Classes in the codebase/file */
  classes: ClassInfo[];
  /** Functions in the codebase/file */
  functions: FunctionInfo[];
  /** Interfaces in the codebase/file */
  interfaces: InterfaceInfo[];
  /** File path being analyzed (optional) */
  filePath?: string;
  /** Call graph information */
  callGraph?: Map<string, string[]>;
  /** Import relationships */
  imports?: Map<string, string[]>;
}

// =============================================================================
// Detector Interfaces
// =============================================================================

/**
 * Options for pattern detection.
 */
export interface PatternDetectionOptions {
  /** Minimum confidence threshold (0.0 - 1.0) */
  minConfidence?: number;
  /** Pattern types to detect (default: all) */
  patternTypes?: DesignPatternType[];
  /** Whether to analyze cross-file patterns */
  crossFileAnalysis?: boolean;
  /** Maximum depth for relationship analysis */
  maxDepth?: number;
}

/**
 * Default pattern detection options.
 */
export const DEFAULT_PATTERN_OPTIONS: Required<PatternDetectionOptions> = {
  minConfidence: 0.5,
  patternTypes: [
    "factory",
    "singleton",
    "observer",
    "repository",
    "service",
    "adapter",
    "builder",
    "strategy",
    "decorator",
  ],
  crossFileAnalysis: true,
  maxDepth: 3,
};

/**
 * Interface for a single pattern detector.
 */
export interface IPatternDetector {
  /** Pattern type this detector handles */
  readonly patternType: DesignPatternType;

  /**
   * Detect patterns in the given context.
   *
   * @param context - Analysis context with classes, functions, interfaces
   * @param options - Detection options
   * @returns Detected patterns
   */
  detect(
    context: PatternAnalysisContext,
    options?: PatternDetectionOptions
  ): DetectedPattern[];

  /**
   * Get the heuristics used by this detector.
   */
  getHeuristics(): PatternHeuristic[];
}

/**
 * Interface for the pattern analysis service.
 */
export interface IPatternAnalysisService {
  /**
   * Analyze a context for all supported design patterns.
   *
   * @param context - Analysis context
   * @param options - Detection options
   * @returns Pattern analysis result
   */
  analyze(
    context: PatternAnalysisContext,
    options?: PatternDetectionOptions
  ): PatternAnalysisResult;

  /**
   * Analyze a single file for design patterns.
   *
   * @param classes - Classes in the file
   * @param functions - Functions in the file
   * @param interfaces - Interfaces in the file
   * @param filePath - Path to the file
   * @param options - Detection options
   * @returns Pattern analysis result
   */
  analyzeFile(
    classes: ClassInfo[],
    functions: FunctionInfo[],
    interfaces: InterfaceInfo[],
    filePath: string,
    options?: PatternDetectionOptions
  ): PatternAnalysisResult;

  /**
   * Register a custom pattern detector.
   *
   * @param detector - Detector to register
   */
  registerDetector(detector: IPatternDetector): void;

  /**
   * Get all registered detectors.
   */
  getDetectors(): IPatternDetector[];

  /**
   * Get detector for a specific pattern type.
   */
  getDetector(patternType: DesignPatternType): IPatternDetector | undefined;
}

// =============================================================================
// Database Row Types
// =============================================================================

/**
 * Row type for design_patterns table.
 * [id, patternType, name, confidence, confidenceLevel, evidenceJson, filePathsJson, description, detectedAt]
 */
export type DesignPatternRow = [
  string,  // id
  string,  // patternType
  string,  // name
  number,  // confidence
  string,  // confidenceLevel
  string,  // evidenceJson (JSON array of strings)
  string,  // filePathsJson (JSON array of strings)
  string | null, // description
  number,  // detectedAt
];

/**
 * Row type for pattern_participants table.
 * [patternId, entityId, role, entityType, entityName, filePath, evidenceJson]
 */
export type PatternParticipantRow = [
  string,  // patternId
  string,  // entityId
  string,  // role
  string,  // entityType
  string,  // entityName
  string,  // filePath
  string,  // evidenceJson (JSON array of strings)
];

// =============================================================================
// Factory Types
// =============================================================================

/**
 * Factory function type for creating pattern detectors.
 */
export type CreatePatternDetector = () => IPatternDetector;

/**
 * Factory function type for creating pattern analysis service.
 */
export type CreatePatternAnalysisService = (
  options?: PatternDetectionOptions
) => IPatternAnalysisService;

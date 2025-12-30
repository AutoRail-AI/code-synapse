/**
 * Semantic Analysis Types
 *
 * Type definitions for semantic analysis using TypeScript Compiler API.
 *
 * @module
 */

// =============================================================================
// Type Information
// =============================================================================

/**
 * Detailed type information from TypeScript Compiler API.
 */
export interface TypeInfo {
  /** String representation of the type */
  typeString: string;
  /** Whether this is a union type (A | B) */
  isUnion: boolean;
  /** Whether this is an intersection type (A & B) */
  isIntersection: boolean;
  /** Whether this is a primitive type (string, number, boolean, etc.) */
  isPrimitive: boolean;
  /** Whether this is a user-defined type */
  isCustomType: boolean;
  /** Whether this is an array type */
  isArray: boolean;
  /** Whether this is a function type */
  isFunction: boolean;
  /** Whether this is a generic type */
  isGeneric: boolean;
  /** Type arguments for generic types */
  typeArguments?: string[];
}

/**
 * Resolved parameter information with types.
 */
export interface ResolvedParameter {
  /** Parameter name */
  name: string;
  /** Resolved type */
  type: TypeInfo;
  /** Whether the parameter is optional */
  isOptional: boolean;
  /** Whether the parameter is a rest parameter */
  isRest: boolean;
  /** Default value expression if any */
  defaultValue?: string;
}

/**
 * Complete function signature with resolved types.
 */
export interface ResolvedFunctionSignature {
  /** Function name */
  name: string;
  /** Resolved parameters */
  parameters: ResolvedParameter[];
  /** Resolved return type */
  returnType: TypeInfo;
  /** Type parameters for generics */
  typeParameters: string[];
  /** Full signature string */
  signatureString: string;
  /** Whether the function is async */
  isAsync: boolean;
  /** Whether the function is a generator */
  isGenerator: boolean;
}

// =============================================================================
// Symbol Information
// =============================================================================

/**
 * Location of a symbol definition.
 */
export interface DefinitionLocation {
  /** Absolute file path */
  filePath: string;
  /** Start line (1-indexed) */
  startLine: number;
  /** End line (1-indexed) */
  endLine: number;
  /** Start column (0-indexed) */
  startColumn: number;
  /** End column (0-indexed) */
  endColumn: number;
  /** Symbol name */
  name: string;
  /** Kind of symbol (function, class, variable, etc.) */
  kind: SymbolKind;
}

/**
 * Reference to a symbol in code.
 */
export interface ReferenceLocation {
  /** File where reference occurs */
  filePath: string;
  /** Line number of reference */
  line: number;
  /** Column of reference */
  column: number;
  /** Whether this is a write reference (assignment) */
  isWrite: boolean;
  /** Whether this is in a type position */
  isTypeReference: boolean;
}

/**
 * Kinds of symbols.
 */
export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "constant"
  | "enum"
  | "enum-member"
  | "property"
  | "method"
  | "parameter"
  | "type-parameter"
  | "module"
  | "unknown";

/**
 * Linked symbol with definition and references.
 */
export interface LinkedSymbol {
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: SymbolKind;
  /** Definition location */
  definition: DefinitionLocation;
  /** All references to this symbol */
  references: ReferenceLocation[];
  /** Resolved type if applicable */
  type?: TypeInfo;
  /** Documentation comment */
  documentation?: string;
}

// =============================================================================
// Dependency Information
// =============================================================================

/**
 * A dependency edge between two files.
 */
export interface DependencyEdge {
  /** Source file (importing file) */
  from: string;
  /** Target file (imported file) */
  to: string;
  /** Symbols imported */
  importedSymbols: string[];
  /** Whether this is a type-only import */
  isTypeOnly: boolean;
  /** Whether this is a dynamic import */
  isDynamic: boolean;
}

/**
 * Node in the dependency graph.
 */
export interface DependencyNode {
  /** Absolute file path */
  filePath: string;
  /** Files this file imports from */
  directDependencies: string[];
  /** Files that import this file */
  dependents: string[];
  /** Depth from root (0 = entry point) */
  depth: number;
  /** Whether this file is an entry point */
  isEntryPoint: boolean;
}

/**
 * Complete dependency graph for a project.
 */
export interface DependencyGraph {
  /** Map of file path to dependency node */
  nodes: Map<string, DependencyNode>;
  /** All dependency edges */
  edges: DependencyEdge[];
  /** Entry point files */
  entryPoints: string[];
  /** Detected circular dependencies */
  circularDependencies: CircularDependency[];
}

/**
 * A circular dependency chain.
 */
export interface CircularDependency {
  /** Files in the circular chain */
  chain: string[];
  /** Starting file */
  startFile: string;
}

// =============================================================================
// Analysis Results
// =============================================================================

/**
 * Complete semantic analysis result for a file.
 */
export interface AnalyzedFile {
  /** Absolute file path */
  filePath: string;
  /** Resolved types for all symbols */
  types: Map<string, TypeInfo>;
  /** Linked symbols with definitions */
  symbols: LinkedSymbol[];
  /** Outgoing references (calls to other files) */
  outgoingReferences: SymbolReference[];
  /** Incoming references (calls from other files) */
  incomingReferences: SymbolReference[];
  /** Import information */
  imports: ResolvedImport[];
  /** Export information */
  exports: ResolvedExport[];
  /** Analysis errors/warnings */
  diagnostics: SemanticDiagnostic[];
}

/**
 * A reference from one symbol to another.
 */
export interface SymbolReference {
  /** Calling/referencing symbol */
  from: {
    filePath: string;
    name: string;
    line: number;
  };
  /** Called/referenced symbol */
  to: {
    filePath: string;
    name: string;
    line: number;
  };
  /** Type of reference */
  referenceType: "call" | "type" | "extends" | "implements" | "uses";
}

/**
 * Resolved import with target file.
 */
export interface ResolvedImport {
  /** Import statement location */
  location: { line: number; column: number };
  /** Module specifier as written */
  moduleSpecifier: string;
  /** Resolved absolute path (null if external) */
  resolvedPath: string | null;
  /** Whether this is an external package */
  isExternal: boolean;
  /** Imported symbols */
  symbols: Array<{
    name: string;
    alias?: string;
    isType: boolean;
  }>;
  /** Whether this is a namespace import (import * as) */
  isNamespace: boolean;
  /** Whether this is a default import */
  isDefault: boolean;
  /** Whether this is a side-effect import */
  isSideEffect: boolean;
}

/**
 * Resolved export information.
 */
export interface ResolvedExport {
  /** Export location */
  location: { line: number; column: number };
  /** Exported symbol name */
  name: string;
  /** Local name if different */
  localName?: string;
  /** Whether this is a default export */
  isDefault: boolean;
  /** Whether this is a type export */
  isType: boolean;
  /** Whether this is a re-export */
  isReExport: boolean;
  /** Source module for re-exports */
  sourceModule?: string;
}

/**
 * Diagnostic from semantic analysis.
 */
export interface SemanticDiagnostic {
  /** Diagnostic message */
  message: string;
  /** Severity level */
  severity: "error" | "warning" | "info";
  /** Location */
  location: {
    line: number;
    column: number;
  };
  /** TypeScript error code if applicable */
  code?: number;
}

// =============================================================================
// Worker Communication
// =============================================================================

/**
 * Request sent to semantic analysis worker.
 */
export interface SemanticRequest {
  /** Request type */
  type: "analyze" | "initialize" | "shutdown";
  /** Request ID for correlation */
  requestId: string;
  /** File paths to analyze */
  filePaths?: string[];
  /** Project root directory */
  projectRoot?: string;
  /** Path to tsconfig.json */
  tsconfigPath?: string;
}

/**
 * Response from semantic analysis worker.
 */
export interface SemanticResponse {
  /** Response type */
  type: "result" | "error" | "progress" | "initialized" | "shutdown";
  /** Request ID for correlation */
  requestId: string;
  /** Result data */
  data?: AnalyzedFile[] | SemanticError | ProgressInfo;
}

/**
 * Progress information during analysis.
 */
export interface ProgressInfo {
  /** Current file index */
  current: number;
  /** Total files */
  total: number;
  /** Current file path */
  filePath: string;
  /** Phase of analysis */
  phase: "parsing" | "type-checking" | "linking" | "complete";
}

/**
 * Error from semantic analysis.
 */
export interface SemanticError {
  /** Error message */
  message: string;
  /** Stack trace */
  stack?: string;
  /** File that caused error */
  filePath?: string;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Options for semantic analysis.
 */
export interface SemanticAnalysisOptions {
  /** Whether to include type information */
  includeTypes?: boolean;
  /** Whether to resolve cross-file references */
  resolveReferences?: boolean;
  /** Whether to build dependency graph */
  buildDependencyGraph?: boolean;
  /** Maximum depth for transitive dependencies */
  maxDependencyDepth?: number;
  /** Whether to include node_modules */
  includeNodeModules?: boolean;
  /** Files/patterns to exclude */
  exclude?: string[];
  /** Timeout for analysis in milliseconds */
  timeout?: number;
}

/**
 * Default semantic analysis options.
 */
export const DEFAULT_SEMANTIC_OPTIONS: Required<SemanticAnalysisOptions> = {
  includeTypes: true,
  resolveReferences: true,
  buildDependencyGraph: true,
  maxDependencyDepth: 10,
  includeNodeModules: false,
  exclude: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
  timeout: 60000,
};

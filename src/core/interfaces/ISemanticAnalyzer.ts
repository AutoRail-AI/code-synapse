/**
 * ISemanticAnalyzer - Type resolution interface
 *
 * Hides worker thread implementation detail.
 * Provides type information and dependency graph construction.
 *
 * @module
 */

/**
 * Type information for a symbol.
 */
export interface TypeInfo {
  /** Type as a string (e.g., "string", "number[]", "User") */
  typeString: string;
  /** Whether the type is primitive */
  isPrimitive: boolean;
  /** Whether the type is from an external module */
  isExternal: boolean;
  /** Source module if external */
  sourceModule?: string;
}

/**
 * Symbol information.
 */
export interface SymbolInfo {
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: "function" | "class" | "interface" | "type" | "variable" | "method" | "property";
  /** Type information */
  type: TypeInfo | null;
  /** Source file path */
  filePath: string;
  /** Line number */
  line: number;
  /** Whether exported */
  isExported: boolean;
}

/**
 * Source code location.
 */
export interface Location {
  filePath: string;
  line: number;
  column: number;
}

/**
 * Semantic information for a file.
 */
export interface SemanticInfo {
  /** File path */
  filePath: string;
  /** Types defined in this file */
  types: Map<string, TypeInfo>;
  /** Symbols defined in this file */
  symbols: Map<string, SymbolInfo>;
  /** References to other symbols */
  references: Map<string, Location[]>;
  /** Files this file depends on */
  dependencies: string[];
}

/**
 * Dependency graph node.
 */
export interface DependencyNode {
  /** File path */
  filePath: string;
  /** Files this file imports */
  imports: string[];
  /** Files that import this file */
  importedBy: string[];
}

/**
 * Dependency graph for the project.
 */
export interface DependencyGraph {
  /** All nodes in the graph */
  nodes: Map<string, DependencyNode>;
  /** Circular dependencies detected */
  cycles: string[][];
}

/**
 * Semantic analyzer interface.
 *
 * @example
 * ```typescript
 * const analyzer = createSemanticAnalyzer();
 * await analyzer.initialize('/project', '/project/tsconfig.json');
 *
 * // Analyze files
 * for await (const info of analyzer.analyze(files)) {
 *   console.log(info.filePath, info.symbols.size);
 * }
 *
 * // Get type for symbol
 * const type = await analyzer.getTypeFor('/src/index.ts', 'User');
 *
 * // Get dependency graph
 * const deps = await analyzer.getDependencyGraph();
 *
 * await analyzer.shutdown();
 * ```
 */
export interface ISemanticAnalyzer {
  /**
   * Analyze files for type information
   */
  analyze(files: string[]): AsyncIterable<SemanticInfo>;

  /**
   * Get type for a specific symbol
   */
  getTypeFor(filePath: string, symbolName: string): Promise<TypeInfo | null>;

  /**
   * Build dependency graph for project
   */
  getDependencyGraph(): Promise<DependencyGraph>;

  /**
   * Initialize analyzer with project configuration
   */
  initialize(projectRoot: string, tsconfigPath?: string): Promise<void>;

  /**
   * Shutdown analyzer and release resources
   */
  shutdown(): Promise<void>;

  /**
   * Check if analyzer is initialized
   */
  readonly isInitialized: boolean;
}

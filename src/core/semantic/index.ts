/**
 * Semantic Analysis Module
 *
 * Provides semantic analysis capabilities using TypeScript Compiler API.
 * Includes type resolution, symbol linking, and dependency analysis.
 *
 * @module
 */

// Re-export types
export * from "./types.js";

// Re-export TypeScript Program Manager
export {
  TypeScriptProgramManager,
  createTSProgramManager,
  createInitializedTSProgramManager,
  getNodePosition,
  getNodeEndPosition,
  getNodeRange,
  formatDiagnostic,
  type TSProgramOptions,
  type TSProgramInfo,
} from "./ts-program.js";

// Re-export Type Resolver
export {
  TypeResolver,
  createTypeResolver,
} from "./type-resolver.js";

// Re-export Symbol Linker
export {
  SymbolLinker,
  createSymbolLinker,
} from "./symbol-linker.js";

// Re-export Dependency Analyzer
export {
  DependencyAnalyzer,
  createDependencyAnalyzer,
} from "./dependency-analyzer.js";

// Re-export Worker Manager
export {
  SemanticWorkerManager,
  createSemanticWorkerManager,
  createInitializedSemanticWorkerManager,
  type ProgressCallback,
  type WorkerState,
} from "./worker-manager.js";

// =============================================================================
// Convenience Functions
// =============================================================================

import { TypeScriptProgramManager } from "./ts-program.js";
import { TypeResolver } from "./type-resolver.js";
import { SymbolLinker } from "./symbol-linker.js";
import { DependencyAnalyzer } from "./dependency-analyzer.js";
import type { DependencyGraph, AnalyzedFile, SemanticAnalysisOptions } from "./types.js";

/**
 * Semantic Analyzer facade that combines all semantic analysis capabilities.
 *
 * @example
 * ```typescript
 * const analyzer = new SemanticAnalyzer();
 * await analyzer.initialize({ projectRoot: '/path/to/project' });
 *
 * // Get dependency graph
 * const graph = analyzer.getDependencyGraph();
 *
 * // Analyze specific files
 * const results = await analyzer.analyzeFiles(['/path/to/file.ts']);
 *
 * analyzer.dispose();
 * ```
 */
export class SemanticAnalyzer {
  private programManager: TypeScriptProgramManager;
  private typeResolver: TypeResolver | null = null;
  private symbolLinker: SymbolLinker | null = null;
  private dependencyAnalyzer: DependencyAnalyzer | null = null;
  private initialized = false;

  constructor() {
    this.programManager = new TypeScriptProgramManager();
  }

  /**
   * Initializes the semantic analyzer with a project.
   *
   * @param options - Initialization options
   */
  async initialize(options: {
    projectRoot: string;
    tsconfigPath?: string;
  }): Promise<void> {
    await this.programManager.loadProgram({
      projectRoot: options.projectRoot,
      tsconfigPath: options.tsconfigPath,
    });

    const typeChecker = this.programManager.getTypeChecker();
    const program = this.programManager.getProgram();

    this.typeResolver = new TypeResolver(typeChecker, program);
    this.symbolLinker = new SymbolLinker(typeChecker, program);
    this.dependencyAnalyzer = new DependencyAnalyzer(program, options.projectRoot);

    this.initialized = true;
  }

  /**
   * Gets the dependency graph for the project.
   */
  getDependencyGraph(): DependencyGraph {
    this.ensureInitialized();
    return this.dependencyAnalyzer!.buildDependencyGraph();
  }

  /**
   * Analyzes specific files for semantic information.
   *
   * @param filePaths - Files to analyze
   * @param _options - Analysis options
   */
  async analyzeFiles(
    filePaths: string[],
    _options?: SemanticAnalysisOptions
  ): Promise<AnalyzedFile[]> {
    this.ensureInitialized();

    const results: AnalyzedFile[] = [];

    for (const filePath of filePaths) {
      const sourceFile = this.programManager.getSourceFile(filePath);
      if (!sourceFile) {
        continue;
      }

      // Get exported symbols
      const symbols = this.symbolLinker!.getExportedSymbols(sourceFile);

      // Get cross-file references
      const outgoingReferences = this.symbolLinker!.getCrossFileReferences(sourceFile);

      // Get imports and exports
      const imports = this.dependencyAnalyzer!.extractImports(sourceFile);
      const exports = this.dependencyAnalyzer!.extractExports(sourceFile);

      // Get diagnostics
      const tsDiagnostics = this.programManager.getDiagnostics(sourceFile);
      const diagnostics = tsDiagnostics.map((d) => ({
        message: formatDiagnosticMessage(d),
        severity: getDiagnosticSeverity(d),
        location: getDiagnosticLocation(d),
        code: d.code,
      }));

      results.push({
        filePath,
        types: new Map(), // Types extracted on demand
        symbols,
        outgoingReferences,
        incomingReferences: [], // Would require full project scan
        imports,
        exports,
        diagnostics,
      });
    }

    return results;
  }

  /**
   * Gets the type resolver.
   */
  getTypeResolver(): TypeResolver {
    this.ensureInitialized();
    return this.typeResolver!;
  }

  /**
   * Gets the symbol linker.
   */
  getSymbolLinker(): SymbolLinker {
    this.ensureInitialized();
    return this.symbolLinker!;
  }

  /**
   * Gets the dependency analyzer.
   */
  getDependencyAnalyzer(): DependencyAnalyzer {
    this.ensureInitialized();
    return this.dependencyAnalyzer!;
  }

  /**
   * Gets the program manager.
   */
  getProgramManager(): TypeScriptProgramManager {
    return this.programManager;
  }

  /**
   * Whether the analyzer is initialized.
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Disposes of resources.
   */
  dispose(): void {
    this.programManager.dispose();
    this.typeResolver = null;
    this.symbolLinker = null;
    this.dependencyAnalyzer = null;
    this.initialized = false;
  }

  /**
   * Ensures the analyzer is initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("SemanticAnalyzer not initialized. Call initialize() first.");
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

import * as ts from "typescript";

function formatDiagnosticMessage(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

function getDiagnosticSeverity(
  diagnostic: ts.Diagnostic
): "error" | "warning" | "info" {
  switch (diagnostic.category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    default:
      return "info";
  }
}

function getDiagnosticLocation(
  diagnostic: ts.Diagnostic
): { line: number; column: number } {
  if (diagnostic.file && diagnostic.start !== undefined) {
    const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return { line: pos.line + 1, column: pos.character };
  }
  return { line: 0, column: 0 };
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a SemanticAnalyzer instance.
 */
export function createSemanticAnalyzer(): SemanticAnalyzer {
  return new SemanticAnalyzer();
}

/**
 * Creates and initializes a SemanticAnalyzer.
 *
 * @param projectRoot - Project root directory
 * @param tsconfigPath - Optional path to tsconfig.json
 */
export async function createInitializedSemanticAnalyzer(
  projectRoot: string,
  tsconfigPath?: string
): Promise<SemanticAnalyzer> {
  const analyzer = new SemanticAnalyzer();
  await analyzer.initialize({ projectRoot, tsconfigPath });
  return analyzer;
}

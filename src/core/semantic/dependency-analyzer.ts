/**
 * Dependency Analyzer
 *
 * Builds complete module dependency graph for a TypeScript project.
 * Detects circular dependencies and calculates dependency depth.
 *
 * @module
 */

import * as ts from "typescript";
import type {
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  CircularDependency,
  ResolvedImport,
  ResolvedExport,
} from "./types.js";
import { getNodePosition } from "./ts-program.js";

// =============================================================================
// Dependency Analyzer Class
// =============================================================================

/**
 * Analyzes module dependencies in a TypeScript project.
 *
 * @example
 * ```typescript
 * const analyzer = new DependencyAnalyzer(program, projectRoot);
 *
 * // Build complete dependency graph
 * const graph = analyzer.buildDependencyGraph();
 *
 * // Get dependencies for a specific file
 * const deps = analyzer.getFileDependencies(filePath);
 *
 * // Detect circular dependencies
 * const cycles = analyzer.detectCircularDependencies();
 * ```
 */
export class DependencyAnalyzer {
  private compilerOptions: ts.CompilerOptions;

  constructor(
    private program: ts.Program,
    private projectRoot: string
  ) {
    this.compilerOptions = program.getCompilerOptions();
  }

  /**
   * Builds a complete dependency graph for the project.
   *
   * @returns Complete dependency graph
   */
  buildDependencyGraph(): DependencyGraph {
    const nodes = new Map<string, DependencyNode>();
    const edges: DependencyEdge[] = [];
    const entryPoints: string[] = [];

    // Process all source files
    for (const sourceFile of this.program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue;

      const filePath = sourceFile.fileName;

      // Skip node_modules by default
      if (filePath.includes("node_modules")) continue;

      // Initialize node if not exists
      if (!nodes.has(filePath)) {
        nodes.set(filePath, this.createDependencyNode(filePath));
      }

      // Extract imports and create edges
      const imports = this.extractImports(sourceFile);
      const dependencies: string[] = [];

      for (const imp of imports) {
        if (imp.resolvedPath && !imp.isExternal) {
          dependencies.push(imp.resolvedPath);

          // Create edge
          edges.push({
            from: filePath,
            to: imp.resolvedPath,
            importedSymbols: imp.symbols.map((s) => s.name),
            isTypeOnly: imp.symbols.every((s) => s.isType),
            isDynamic: false, // Static imports only for now
          });

          // Ensure target node exists
          if (!nodes.has(imp.resolvedPath)) {
            nodes.set(imp.resolvedPath, this.createDependencyNode(imp.resolvedPath));
          }

          // Add reverse reference (dependent)
          const targetNode = nodes.get(imp.resolvedPath)!;
          if (!targetNode.dependents.includes(filePath)) {
            targetNode.dependents.push(filePath);
          }
        }
      }

      // Update node with dependencies
      const node = nodes.get(filePath)!;
      node.directDependencies = dependencies;
    }

    // Find entry points (files with no dependents)
    for (const [filePath, node] of nodes) {
      if (node.dependents.length === 0) {
        node.isEntryPoint = true;
        entryPoints.push(filePath);
      }
    }

    // Calculate depths from entry points
    this.calculateDepths(nodes, entryPoints);

    // Detect circular dependencies
    const circularDependencies = this.detectCircularDependencies(nodes, edges);

    return {
      nodes,
      edges,
      entryPoints,
      circularDependencies,
    };
  }

  /**
   * Gets direct dependencies for a file.
   *
   * @param filePath - Absolute file path
   * @returns Array of file paths this file depends on
   */
  getFileDependencies(filePath: string): string[] {
    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) {
      return [];
    }

    const imports = this.extractImports(sourceFile);
    return imports
      .filter((imp) => imp.resolvedPath && !imp.isExternal)
      .map((imp) => imp.resolvedPath!);
  }

  /**
   * Gets all transitive dependencies for a file.
   *
   * @param filePath - Absolute file path
   * @param maxDepth - Maximum depth to traverse (default: 10)
   * @returns Array of all transitively dependent file paths
   */
  getTransitiveDependencies(
    filePath: string,
    maxDepth: number = 10
  ): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (path: string, depth: number): void => {
      if (visited.has(path) || depth > maxDepth) return;
      visited.add(path);

      const dependencies = this.getFileDependencies(path);
      for (const dep of dependencies) {
        if (!visited.has(dep)) {
          result.push(dep);
          visit(dep, depth + 1);
        }
      }
    };

    visit(filePath, 0);
    return result;
  }

  /**
   * Gets all files that depend on a given file.
   *
   * @param filePath - Absolute file path
   * @returns Array of files that import this file
   */
  getDependents(filePath: string): string[] {
    const dependents: string[] = [];

    for (const sourceFile of this.program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue;
      if (sourceFile.fileName === filePath) continue;

      const imports = this.extractImports(sourceFile);
      if (imports.some((imp) => imp.resolvedPath === filePath)) {
        dependents.push(sourceFile.fileName);
      }
    }

    return dependents;
  }

  /**
   * Extracts all imports from a source file.
   *
   * @param sourceFile - Source file to analyze
   * @returns Array of resolved imports
   */
  extractImports(sourceFile: ts.SourceFile): ResolvedImport[] {
    const imports: ResolvedImport[] = [];

    ts.forEachChild(sourceFile, (node) => {
      if (ts.isImportDeclaration(node)) {
        const imp = this.parseImportDeclaration(node, sourceFile);
        if (imp) {
          imports.push(imp);
        }
      }
    });

    return imports;
  }

  /**
   * Extracts all exports from a source file.
   *
   * @param sourceFile - Source file to analyze
   * @returns Array of resolved exports
   */
  extractExports(sourceFile: ts.SourceFile): ResolvedExport[] {
    const exports: ResolvedExport[] = [];

    ts.forEachChild(sourceFile, (node) => {
      // Export declarations (export { ... }, export * from)
      if (ts.isExportDeclaration(node)) {
        const parsed = this.parseExportDeclaration(node);
        exports.push(...parsed);
      }

      // Export assignments (export default, export =)
      if (ts.isExportAssignment(node)) {
        const position = getNodePosition(node);
        exports.push({
          location: { line: position.line, column: position.column },
          name: "default",
          isDefault: true,
          isType: false,
          isReExport: false,
        });
      }

      // Exported declarations (export function, export class, etc.)
      if (this.hasExportModifier(node)) {
        const exp = this.parseExportedDeclaration(node);
        if (exp) {
          exports.push(exp);
        }
      }
    });

    return exports;
  }

  /**
   * Detects circular dependencies in the graph.
   *
   * @param nodes - Dependency nodes
   * @param edges - Dependency edges
   * @returns Array of circular dependency chains
   */
  detectCircularDependencies(
    nodes: Map<string, DependencyNode>,
    _edges: DependencyEdge[]
  ): CircularDependency[] {
    const cycles: CircularDependency[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (filePath: string): void => {
      visited.add(filePath);
      recursionStack.add(filePath);
      path.push(filePath);

      const node = nodes.get(filePath);
      if (node) {
        for (const dep of node.directDependencies) {
          if (!visited.has(dep)) {
            dfs(dep);
          } else if (recursionStack.has(dep)) {
            // Found a cycle
            const cycleStart = path.indexOf(dep);
            const chain = [...path.slice(cycleStart), dep];
            cycles.push({
              chain,
              startFile: dep,
            });
          }
        }
      }

      path.pop();
      recursionStack.delete(filePath);
    };

    for (const filePath of nodes.keys()) {
      if (!visited.has(filePath)) {
        dfs(filePath);
      }
    }

    return cycles;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Creates a new dependency node.
   */
  private createDependencyNode(filePath: string): DependencyNode {
    return {
      filePath,
      directDependencies: [],
      dependents: [],
      depth: 0,
      isEntryPoint: false,
    };
  }

  /**
   * Calculates depths from entry points using BFS.
   */
  private calculateDepths(
    nodes: Map<string, DependencyNode>,
    entryPoints: string[]
  ): void {
    // Use BFS from entry points
    const queue: Array<{ filePath: string; depth: number }> = [];
    const visited = new Set<string>();

    // Start from entry points
    for (const entry of entryPoints) {
      queue.push({ filePath: entry, depth: 0 });
    }

    while (queue.length > 0) {
      const { filePath, depth } = queue.shift()!;

      if (visited.has(filePath)) continue;
      visited.add(filePath);

      const node = nodes.get(filePath);
      if (node) {
        node.depth = Math.max(node.depth, depth);

        // Add dependencies to queue
        for (const dep of node.directDependencies) {
          if (!visited.has(dep)) {
            queue.push({ filePath: dep, depth: depth + 1 });
          }
        }
      }
    }
  }

  /**
   * Parses an import declaration.
   */
  private parseImportDeclaration(
    node: ts.ImportDeclaration,
    sourceFile: ts.SourceFile
  ): ResolvedImport | null {
    const moduleSpecifier = node.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) {
      return null;
    }

    const specifierText = moduleSpecifier.text;
    const position = getNodePosition(node);

    // Resolve the module path
    const resolved = ts.resolveModuleName(
      specifierText,
      sourceFile.fileName,
      this.compilerOptions,
      ts.sys
    );

    const resolvedPath = resolved.resolvedModule?.resolvedFileName ?? null;
    const isExternal = resolved.resolvedModule?.isExternalLibraryImport ?? true;

    // Parse import clause
    const importClause = node.importClause;
    const symbols: Array<{ name: string; alias?: string; isType: boolean }> = [];
    let isNamespace = false;
    let isDefault = false;
    const isSideEffect = !importClause;

    if (importClause) {
      // Type-only import
      const isTypeOnlyImport = !!importClause.isTypeOnly;

      // Default import
      if (importClause.name) {
        isDefault = true;
        symbols.push({
          name: "default",
          alias: importClause.name.text,
          isType: isTypeOnlyImport,
        });
      }

      // Named bindings
      if (importClause.namedBindings) {
        if (ts.isNamespaceImport(importClause.namedBindings)) {
          // import * as name
          isNamespace = true;
          symbols.push({
            name: "*",
            alias: importClause.namedBindings.name.text,
            isType: isTypeOnlyImport,
          });
        } else if (ts.isNamedImports(importClause.namedBindings)) {
          // import { a, b as c }
          for (const element of importClause.namedBindings.elements) {
            symbols.push({
              name: element.propertyName?.text ?? element.name.text,
              alias: element.propertyName ? element.name.text : undefined,
              isType: isTypeOnlyImport || !!element.isTypeOnly,
            });
          }
        }
      }
    }

    return {
      location: { line: position.line, column: position.column },
      moduleSpecifier: specifierText,
      resolvedPath,
      isExternal,
      symbols,
      isNamespace,
      isDefault,
      isSideEffect,
    };
  }

  /**
   * Parses an export declaration.
   */
  private parseExportDeclaration(node: ts.ExportDeclaration): ResolvedExport[] {
    const exports: ResolvedExport[] = [];
    const position = getNodePosition(node);
    const isTypeOnly = !!node.isTypeOnly;

    // Re-export from another module
    const sourceModule = node.moduleSpecifier
      ? (node.moduleSpecifier as ts.StringLiteral).text
      : undefined;

    if (node.exportClause) {
      if (ts.isNamespaceExport(node.exportClause)) {
        // export * as name from '...'
        exports.push({
          location: { line: position.line, column: position.column },
          name: node.exportClause.name.text,
          isDefault: false,
          isType: isTypeOnly,
          isReExport: !!sourceModule,
          sourceModule,
        });
      } else if (ts.isNamedExports(node.exportClause)) {
        // export { a, b as c }
        for (const element of node.exportClause.elements) {
          exports.push({
            location: { line: position.line, column: position.column },
            name: element.name.text,
            localName: element.propertyName?.text,
            isDefault: false,
            isType: isTypeOnly || !!element.isTypeOnly,
            isReExport: !!sourceModule,
            sourceModule,
          });
        }
      }
    } else if (sourceModule) {
      // export * from '...'
      exports.push({
        location: { line: position.line, column: position.column },
        name: "*",
        isDefault: false,
        isType: isTypeOnly,
        isReExport: true,
        sourceModule,
      });
    }

    return exports;
  }

  /**
   * Parses an exported declaration.
   */
  private parseExportedDeclaration(node: ts.Node): ResolvedExport | null {
    const position = getNodePosition(node);
    let name: string | null = null;
    let isType = false;

    if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text;
    } else if (ts.isClassDeclaration(node) && node.name) {
      name = node.name.text;
    } else if (ts.isInterfaceDeclaration(node)) {
      name = node.name.text;
      isType = true;
    } else if (ts.isTypeAliasDeclaration(node)) {
      name = node.name.text;
      isType = true;
    } else if (ts.isEnumDeclaration(node)) {
      name = node.name.text;
    } else if (ts.isVariableStatement(node)) {
      // Get first variable name
      const declaration = node.declarationList.declarations[0];
      if (declaration && ts.isIdentifier(declaration.name)) {
        name = declaration.name.text;
      }
    }

    if (!name) {
      return null;
    }

    return {
      location: { line: position.line, column: position.column },
      name,
      isDefault: false,
      isType,
      isReExport: false,
    };
  }

  /**
   * Checks if a node has the export modifier.
   */
  private hasExportModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a DependencyAnalyzer instance.
 *
 * @param program - TypeScript Program
 * @param projectRoot - Project root directory
 */
export function createDependencyAnalyzer(
  program: ts.Program,
  projectRoot: string
): DependencyAnalyzer {
  return new DependencyAnalyzer(program, projectRoot);
}

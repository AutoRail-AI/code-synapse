/**
 * Symbol Linker
 *
 * Links function calls to definitions across files.
 * Resolves symbols to their original declarations.
 *
 * @module
 */

import * as ts from "typescript";
import type {
  DefinitionLocation,
  ReferenceLocation,
  SymbolKind,
  LinkedSymbol,
  SymbolReference,
} from "./types.js";
import { getNodePosition, getNodeRange } from "./ts-program.js";

// =============================================================================
// Symbol Linker Class
// =============================================================================

/**
 * Links symbols to their definitions and finds all references.
 *
 * @example
 * ```typescript
 * const linker = new SymbolLinker(typeChecker, program);
 *
 * // Link a call to its definition
 * const definition = linker.linkCallToDefinition(callExpression);
 *
 * // Find all references to a symbol
 * const refs = linker.findAllReferences(symbol);
 * ```
 */
export class SymbolLinker {
  constructor(
    private typeChecker: ts.TypeChecker,
    private program: ts.Program
  ) {}

  /**
   * Links a call expression to its definition.
   *
   * @param callExpression - The call expression node
   * @returns Definition location or null if not found
   */
  linkCallToDefinition(
    callExpression: ts.CallExpression
  ): DefinitionLocation | null {
    // Get the function being called
    const expression = callExpression.expression;
    const symbol = this.typeChecker.getSymbolAtLocation(expression);

    if (!symbol) {
      return null;
    }

    return this.getSymbolDefinition(symbol);
  }

  /**
   * Links an identifier to its definition.
   *
   * @param identifier - The identifier node
   * @returns Definition location or null if not found
   */
  linkIdentifierToDefinition(
    identifier: ts.Identifier
  ): DefinitionLocation | null {
    const symbol = this.typeChecker.getSymbolAtLocation(identifier);
    if (!symbol) {
      return null;
    }
    return this.getSymbolDefinition(symbol);
  }

  /**
   * Gets the definition location for a symbol.
   *
   * @param symbol - TypeScript symbol
   * @returns Definition location
   */
  getSymbolDefinition(symbol: ts.Symbol): DefinitionLocation | null {
    // Follow aliases to get the original symbol
    const resolvedSymbol = this.resolveAlias(symbol);
    const declarations = resolvedSymbol.getDeclarations();

    if (!declarations || declarations.length === 0) {
      return null;
    }

    // Get the first declaration (primary definition)
    const declaration = declarations[0];
    if (!declaration) {
      return null;
    }

    const sourceFile = declaration.getSourceFile();

    // Skip declaration files unless explicitly requested
    if (sourceFile.isDeclarationFile) {
      return null;
    }

    const range = getNodeRange(declaration);

    return {
      filePath: sourceFile.fileName,
      startLine: range.startLine,
      endLine: range.endLine,
      startColumn: range.startColumn,
      endColumn: range.endColumn,
      name: resolvedSymbol.getName(),
      kind: this.getSymbolKind(declaration),
    };
  }

  /**
   * Finds all references to a symbol in the program.
   *
   * @param symbol - Symbol to find references for
   * @returns Array of reference locations
   */
  findAllReferences(symbol: ts.Symbol): ReferenceLocation[] {
    const references: ReferenceLocation[] = [];
    const resolvedSymbol = this.resolveAlias(symbol);
    const symbolName = resolvedSymbol.getName();

    // Search through all source files
    for (const sourceFile of this.program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue;

      this.visitNode(sourceFile, (node) => {
        if (ts.isIdentifier(node) && node.text === symbolName) {
          const nodeSymbol = this.typeChecker.getSymbolAtLocation(node);
          if (nodeSymbol && this.isSameSymbol(nodeSymbol, resolvedSymbol)) {
            const position = getNodePosition(node);
            references.push({
              filePath: sourceFile.fileName,
              line: position.line,
              column: position.column,
              isWrite: this.isWriteReference(node),
              isTypeReference: this.isTypePosition(node),
            });
          }
        }
      });
    }

    return references;
  }

  /**
   * Resolves an import specifier to its original symbol.
   *
   * @param importSpecifier - Import specifier node
   * @returns Original symbol or null
   */
  resolveImportedSymbol(
    importSpecifier: ts.ImportSpecifier
  ): ts.Symbol | null {
    const symbol = this.typeChecker.getSymbolAtLocation(
      importSpecifier.name ?? importSpecifier.propertyName!
    );

    if (!symbol) {
      return null;
    }

    return this.resolveAlias(symbol);
  }

  /**
   * Gets all symbols exported from a file.
   *
   * @param sourceFile - Source file to analyze
   * @returns Array of exported symbols with their definitions
   */
  getExportedSymbols(sourceFile: ts.SourceFile): LinkedSymbol[] {
    const exportedSymbols: LinkedSymbol[] = [];
    const moduleSymbol = this.typeChecker.getSymbolAtLocation(sourceFile);

    if (!moduleSymbol) {
      return exportedSymbols;
    }

    const exports = this.typeChecker.getExportsOfModule(moduleSymbol);

    for (const exportSymbol of exports) {
      const definition = this.getSymbolDefinition(exportSymbol);
      if (definition) {
        exportedSymbols.push({
          name: exportSymbol.getName(),
          kind: definition.kind,
          definition,
          references: [], // Can be populated with findAllReferences if needed
          documentation: this.getSymbolDocumentation(exportSymbol),
        });
      }
    }

    return exportedSymbols;
  }

  /**
   * Gets cross-file references from a source file.
   *
   * @param sourceFile - Source file to analyze
   * @returns Array of symbol references to other files
   */
  getCrossFileReferences(sourceFile: ts.SourceFile): SymbolReference[] {
    const references: SymbolReference[] = [];
    const currentFilePath = sourceFile.fileName;

    this.visitNode(sourceFile, (node) => {
      // Check call expressions
      if (ts.isCallExpression(node)) {
        const definition = this.linkCallToDefinition(node);
        if (definition && definition.filePath !== currentFilePath) {
          const position = getNodePosition(node);
          references.push({
            from: {
              filePath: currentFilePath,
              name: this.getCallerName(node),
              line: position.line,
            },
            to: {
              filePath: definition.filePath,
              name: definition.name,
              line: definition.startLine,
            },
            referenceType: "call",
          });
        }
      }

      // Check type references
      if (ts.isTypeReferenceNode(node)) {
        const symbol = this.typeChecker.getSymbolAtLocation(node.typeName);
        if (symbol) {
          const definition = this.getSymbolDefinition(symbol);
          if (definition && definition.filePath !== currentFilePath) {
            const position = getNodePosition(node);
            references.push({
              from: {
                filePath: currentFilePath,
                name: node.typeName.getText(),
                line: position.line,
              },
              to: {
                filePath: definition.filePath,
                name: definition.name,
                line: definition.startLine,
              },
              referenceType: "type",
            });
          }
        }
      }

      // Check class heritage (extends)
      if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ExtendsKeyword) {
        for (const type of node.types) {
          const symbol = this.typeChecker.getSymbolAtLocation(type.expression);
          if (symbol) {
            const definition = this.getSymbolDefinition(symbol);
            if (definition && definition.filePath !== currentFilePath) {
              const position = getNodePosition(type);
              references.push({
                from: {
                  filePath: currentFilePath,
                  name: this.getContainingClassName(node) ?? "<anonymous>",
                  line: position.line,
                },
                to: {
                  filePath: definition.filePath,
                  name: definition.name,
                  line: definition.startLine,
                },
                referenceType: "extends",
              });
            }
          }
        }
      }

      // Check implements
      if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ImplementsKeyword) {
        for (const type of node.types) {
          const symbol = this.typeChecker.getSymbolAtLocation(type.expression);
          if (symbol) {
            const definition = this.getSymbolDefinition(symbol);
            if (definition && definition.filePath !== currentFilePath) {
              const position = getNodePosition(type);
              references.push({
                from: {
                  filePath: currentFilePath,
                  name: this.getContainingClassName(node) ?? "<anonymous>",
                  line: position.line,
                },
                to: {
                  filePath: definition.filePath,
                  name: definition.name,
                  line: definition.startLine,
                },
                referenceType: "implements",
              });
            }
          }
        }
      }
    });

    return references;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Resolves symbol aliases to get the original symbol.
   */
  private resolveAlias(symbol: ts.Symbol): ts.Symbol {
    while (symbol.flags & ts.SymbolFlags.Alias) {
      const aliased = this.typeChecker.getAliasedSymbol(symbol);
      if (aliased === symbol) break;
      symbol = aliased;
    }
    return symbol;
  }

  /**
   * Checks if two symbols are the same.
   */
  private isSameSymbol(a: ts.Symbol, b: ts.Symbol): boolean {
    const resolvedA = this.resolveAlias(a);
    const resolvedB = this.resolveAlias(b);
    return resolvedA === resolvedB;
  }

  /**
   * Determines the kind of a symbol from its declaration.
   */
  private getSymbolKind(declaration: ts.Declaration): SymbolKind {
    if (ts.isFunctionDeclaration(declaration) || ts.isFunctionExpression(declaration)) {
      return "function";
    }
    if (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)) {
      return "class";
    }
    if (ts.isInterfaceDeclaration(declaration)) {
      return "interface";
    }
    if (ts.isTypeAliasDeclaration(declaration)) {
      return "type";
    }
    if (ts.isEnumDeclaration(declaration)) {
      return "enum";
    }
    if (ts.isEnumMember(declaration)) {
      return "enum-member";
    }
    if (ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration)) {
      return "method";
    }
    if (ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration)) {
      return "property";
    }
    if (ts.isParameter(declaration)) {
      return "parameter";
    }
    if (ts.isTypeParameterDeclaration(declaration)) {
      return "type-parameter";
    }
    if (ts.isModuleDeclaration(declaration)) {
      return "module";
    }
    if (ts.isVariableDeclaration(declaration)) {
      // Check if it's a const
      const parent = declaration.parent;
      if (ts.isVariableDeclarationList(parent)) {
        if (parent.flags & ts.NodeFlags.Const) {
          return "constant";
        }
      }
      return "variable";
    }
    return "unknown";
  }

  /**
   * Checks if a reference is a write (assignment).
   */
  private isWriteReference(node: ts.Identifier): boolean {
    const parent = node.parent;

    // Assignment expressions
    if (ts.isBinaryExpression(parent)) {
      return (
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        parent.left === node
      );
    }

    // Variable declarations
    if (ts.isVariableDeclaration(parent) && parent.name === node) {
      return true;
    }

    // Property assignments
    if (ts.isPropertyAssignment(parent) && parent.name === node) {
      return true;
    }

    // Shorthand property assignments
    if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
      return true;
    }

    // Update expressions (++, --)
    if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
      return (
        parent.operator === ts.SyntaxKind.PlusPlusToken ||
        parent.operator === ts.SyntaxKind.MinusMinusToken
      );
    }

    return false;
  }

  /**
   * Checks if a node is in a type position.
   */
  private isTypePosition(node: ts.Node): boolean {
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (
        ts.isTypeReferenceNode(current) ||
        ts.isTypeAliasDeclaration(current) ||
        ts.isInterfaceDeclaration(current) ||
        ts.isTypeParameterDeclaration(current) ||
        ts.isExpressionWithTypeArguments(current)
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Gets the documentation comment for a symbol.
   */
  private getSymbolDocumentation(symbol: ts.Symbol): string | undefined {
    const documentation = symbol.getDocumentationComment(this.typeChecker);
    if (documentation.length > 0) {
      return documentation.map((part) => part.text).join("");
    }
    return undefined;
  }

  /**
   * Gets the name of the caller context for a call expression.
   */
  private getCallerName(callExpression: ts.CallExpression): string {
    let current: ts.Node | undefined = callExpression.parent;
    while (current) {
      if (ts.isFunctionDeclaration(current) && current.name) {
        return current.name.text;
      }
      if (ts.isMethodDeclaration(current) && current.name) {
        return current.name.getText();
      }
      if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
        const parent = current.parent;
        if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
          return parent.name.text;
        }
      }
      current = current.parent;
    }
    return "<module>";
  }

  /**
   * Gets the containing class name for a heritage clause.
   */
  private getContainingClassName(node: ts.HeritageClause): string | null {
    const parent = node.parent;
    if (ts.isClassDeclaration(parent) && parent.name) {
      return parent.name.text;
    }
    return null;
  }

  /**
   * Visits all nodes in a tree.
   */
  private visitNode(node: ts.Node, visitor: (node: ts.Node) => void): void {
    visitor(node);
    ts.forEachChild(node, (child) => this.visitNode(child, visitor));
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a SymbolLinker instance.
 *
 * @param typeChecker - TypeScript TypeChecker
 * @param program - TypeScript Program
 */
export function createSymbolLinker(
  typeChecker: ts.TypeChecker,
  program: ts.Program
): SymbolLinker {
  return new SymbolLinker(typeChecker, program);
}

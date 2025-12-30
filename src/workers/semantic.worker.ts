/**
 * Semantic Analysis Worker
 *
 * Runs TypeScript Compiler API in an isolated Worker Thread.
 * Prevents blocking the main thread during heavy semantic analysis.
 *
 * @module
 */

import { parentPort } from "node:worker_threads";
import * as ts from "typescript";
import * as path from "node:path";
import type {
  SemanticRequest,
  SemanticResponse,
  AnalyzedFile,
  ProgressInfo,
  SemanticError,
  LinkedSymbol,
  ResolvedImport,
  ResolvedExport,
  SymbolReference,
  SemanticDiagnostic,
  TypeInfo,
  DefinitionLocation,
  SymbolKind,
} from "../core/semantic/types.js";

// =============================================================================
// Worker State
// =============================================================================

let program: ts.Program | null = null;
let typeChecker: ts.TypeChecker | null = null;
let _projectRoot: string | null = null;
let compilerOptions: ts.CompilerOptions | null = null;

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initializes the TypeScript program for analysis.
 */
function initializeProgram(tsconfigPath: string, root: string): void {
  _projectRoot = root;

  // Read tsconfig.json
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Failed to read tsconfig.json: ${ts.flattenDiagnosticMessageText(
        configFile.error.messageText,
        "\n"
      )}`
    );
  }

  // Parse configuration
  const configDir = path.dirname(tsconfigPath);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    configDir
  );

  compilerOptions = parsedConfig.options;

  // Create program
  const host = ts.createCompilerHost(parsedConfig.options);
  program = ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
    host,
  });

  typeChecker = program.getTypeChecker();
}

// =============================================================================
// Analysis Functions
// =============================================================================

/**
 * Analyzes a single file.
 */
function analyzeFile(filePath: string): AnalyzedFile {
  if (!program || !typeChecker) {
    throw new Error("Program not initialized");
  }

  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  // Extract symbols
  const symbols = extractSymbols(sourceFile);

  // Extract imports
  const imports = extractImports(sourceFile);

  // Extract exports
  const exports = extractExports(sourceFile);

  // Get cross-file references
  const { outgoingReferences, incomingReferences } = extractReferences(
    sourceFile,
    filePath
  );

  // Extract types
  const types = extractTypes(sourceFile);

  // Get diagnostics
  const diagnostics = extractDiagnostics(sourceFile);

  return {
    filePath,
    types,
    symbols,
    outgoingReferences,
    incomingReferences,
    imports,
    exports,
    diagnostics,
  };
}

/**
 * Extracts all symbols from a source file.
 */
function extractSymbols(sourceFile: ts.SourceFile): LinkedSymbol[] {
  const symbols: LinkedSymbol[] = [];

  const visit = (node: ts.Node): void => {
    let symbol: ts.Symbol | undefined;
    let name: string | undefined;
    let kind: SymbolKind = "unknown";

    if (ts.isFunctionDeclaration(node) && node.name) {
      symbol = typeChecker!.getSymbolAtLocation(node.name);
      name = node.name.text;
      kind = "function";
    } else if (ts.isClassDeclaration(node) && node.name) {
      symbol = typeChecker!.getSymbolAtLocation(node.name);
      name = node.name.text;
      kind = "class";
    } else if (ts.isInterfaceDeclaration(node)) {
      symbol = typeChecker!.getSymbolAtLocation(node.name);
      name = node.name.text;
      kind = "interface";
    } else if (ts.isTypeAliasDeclaration(node)) {
      symbol = typeChecker!.getSymbolAtLocation(node.name);
      name = node.name.text;
      kind = "type";
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      symbol = typeChecker!.getSymbolAtLocation(node.name);
      name = node.name.text;
      // Check if const
      const parent = node.parent;
      if (ts.isVariableDeclarationList(parent) && parent.flags & ts.NodeFlags.Const) {
        kind = "constant";
      } else {
        kind = "variable";
      }
    } else if (ts.isEnumDeclaration(node)) {
      symbol = typeChecker!.getSymbolAtLocation(node.name);
      name = node.name.text;
      kind = "enum";
    }

    if (symbol && name) {
      const definition = getDefinitionLocation(node, name, kind);
      if (definition) {
        const documentation = getDocumentation(symbol);
        symbols.push({
          name,
          kind,
          definition,
          references: [], // Can be populated later if needed
          documentation,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return symbols;
}

/**
 * Gets definition location from a node.
 */
function getDefinitionLocation(
  node: ts.Node,
  name: string,
  kind: SymbolKind
): DefinitionLocation | null {
  const sourceFile = node.getSourceFile();
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

  return {
    filePath: sourceFile.fileName,
    startLine: start.line + 1,
    endLine: end.line + 1,
    startColumn: start.character,
    endColumn: end.character,
    name,
    kind,
  };
}

/**
 * Gets documentation comment for a symbol.
 */
function getDocumentation(symbol: ts.Symbol): string | undefined {
  const docs = symbol.getDocumentationComment(typeChecker!);
  if (docs.length > 0) {
    return docs.map((d) => d.text).join("");
  }
  return undefined;
}

/**
 * Extracts imports from a source file.
 */
function extractImports(sourceFile: ts.SourceFile): ResolvedImport[] {
  const imports: ResolvedImport[] = [];

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) return;

      const specifierText = moduleSpecifier.text;
      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());

      // Resolve module
      const resolved = ts.resolveModuleName(
        specifierText,
        sourceFile.fileName,
        compilerOptions!,
        ts.sys
      );

      const resolvedPath = resolved.resolvedModule?.resolvedFileName ?? null;
      const isExternal = resolved.resolvedModule?.isExternalLibraryImport ?? true;

      // Parse symbols
      const symbols: Array<{ name: string; alias?: string; isType: boolean }> = [];
      const importClause = node.importClause;
      let isNamespace = false;
      let isDefault = false;
      const isSideEffect = !importClause;
      const isTypeOnly = !!importClause?.isTypeOnly;

      if (importClause) {
        if (importClause.name) {
          isDefault = true;
          symbols.push({
            name: "default",
            alias: importClause.name.text,
            isType: isTypeOnly,
          });
        }

        if (importClause.namedBindings) {
          if (ts.isNamespaceImport(importClause.namedBindings)) {
            isNamespace = true;
            symbols.push({
              name: "*",
              alias: importClause.namedBindings.name.text,
              isType: isTypeOnly,
            });
          } else if (ts.isNamedImports(importClause.namedBindings)) {
            for (const element of importClause.namedBindings.elements) {
              symbols.push({
                name: element.propertyName?.text ?? element.name.text,
                alias: element.propertyName ? element.name.text : undefined,
                isType: isTypeOnly || !!element.isTypeOnly,
              });
            }
          }
        }
      }

      imports.push({
        location: { line: pos.line + 1, column: pos.character },
        moduleSpecifier: specifierText,
        resolvedPath,
        isExternal,
        symbols,
        isNamespace,
        isDefault,
        isSideEffect,
      });
    }
  });

  return imports;
}

/**
 * Extracts exports from a source file.
 */
function extractExports(sourceFile: ts.SourceFile): ResolvedExport[] {
  const exports: ResolvedExport[] = [];

  ts.forEachChild(sourceFile, (node) => {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    if (ts.isExportDeclaration(node)) {
      const isTypeOnly = !!node.isTypeOnly;
      const sourceModule = node.moduleSpecifier
        ? (node.moduleSpecifier as ts.StringLiteral).text
        : undefined;

      if (node.exportClause) {
        if (ts.isNamespaceExport(node.exportClause)) {
          exports.push({
            location: { line: pos.line + 1, column: pos.character },
            name: node.exportClause.name.text,
            isDefault: false,
            isType: isTypeOnly,
            isReExport: !!sourceModule,
            sourceModule,
          });
        } else if (ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            exports.push({
              location: { line: pos.line + 1, column: pos.character },
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
        exports.push({
          location: { line: pos.line + 1, column: pos.character },
          name: "*",
          isDefault: false,
          isType: isTypeOnly,
          isReExport: true,
          sourceModule,
        });
      }
    }

    if (ts.isExportAssignment(node)) {
      exports.push({
        location: { line: pos.line + 1, column: pos.character },
        name: "default",
        isDefault: true,
        isType: false,
        isReExport: false,
      });
    }

    // Check for export modifier on declarations
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const hasExport = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

    if (hasExport) {
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
      } else if (ts.isVariableStatement(node)) {
        const decl = node.declarationList.declarations[0];
        if (decl && ts.isIdentifier(decl.name)) {
          name = decl.name.text;
        }
      }

      if (name) {
        exports.push({
          location: { line: pos.line + 1, column: pos.character },
          name,
          isDefault: false,
          isType,
          isReExport: false,
        });
      }
    }
  });

  return exports;
}

/**
 * Extracts cross-file references.
 */
function extractReferences(
  sourceFile: ts.SourceFile,
  currentFilePath: string
): {
  outgoingReferences: SymbolReference[];
  incomingReferences: SymbolReference[];
} {
  const outgoingReferences: SymbolReference[] = [];
  // Incoming references would require scanning all files, skip for now
  const incomingReferences: SymbolReference[] = [];

  const visit = (node: ts.Node): void => {
    // Check call expressions
    if (ts.isCallExpression(node)) {
      const symbol = typeChecker!.getSymbolAtLocation(node.expression);
      if (symbol) {
        const declarations = symbol.getDeclarations();
        if (declarations && declarations.length > 0) {
          const decl = declarations[0];
          if (!decl) return;

          const declFile = decl.getSourceFile().fileName;

          if (declFile !== currentFilePath && !declFile.includes("node_modules")) {
            const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            const declPos = decl.getSourceFile().getLineAndCharacterOfPosition(decl.getStart());

            outgoingReferences.push({
              from: {
                filePath: currentFilePath,
                name: getCallerName(node),
                line: pos.line + 1,
              },
              to: {
                filePath: declFile,
                name: symbol.getName(),
                line: declPos.line + 1,
              },
              referenceType: "call",
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { outgoingReferences, incomingReferences };
}

/**
 * Gets the caller name for a call expression.
 */
function getCallerName(callExpression: ts.CallExpression): string {
  let current: ts.Node | undefined = callExpression.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text;
    }
    if (ts.isMethodDeclaration(current) && current.name) {
      return current.name.getText();
    }
    current = current.parent;
  }
  return "<module>";
}

/**
 * Extracts type information for all declarations.
 */
function extractTypes(sourceFile: ts.SourceFile): Map<string, TypeInfo> {
  const types = new Map<string, TypeInfo>();

  const visit = (node: ts.Node): void => {
    let key: string | null = null;

    if (ts.isFunctionDeclaration(node) && node.name) {
      key = node.name.text;
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      key = node.name.text;
    } else if (ts.isClassDeclaration(node) && node.name) {
      key = node.name.text;
    }

    if (key) {
      const type = typeChecker!.getTypeAtLocation(node);
      const typeInfo = analyzeType(type);
      types.set(key, typeInfo);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return types;
}

/**
 * Analyzes a TypeScript type.
 */
function analyzeType(type: ts.Type): TypeInfo {
  const typeString = typeChecker!.typeToString(type);
  const flags = type.getFlags();

  return {
    typeString,
    isUnion: !!(flags & ts.TypeFlags.Union),
    isIntersection: !!(flags & ts.TypeFlags.Intersection),
    isPrimitive: !!(
      flags & ts.TypeFlags.String ||
      flags & ts.TypeFlags.Number ||
      flags & ts.TypeFlags.Boolean
    ),
    isCustomType: false, // Simplified
    isArray: typeString.endsWith("[]") || typeString.startsWith("Array<"),
    isFunction: type.getCallSignatures().length > 0,
    isGeneric: !!(type as ts.TypeReference).typeArguments?.length,
  };
}

/**
 * Extracts diagnostics for a source file.
 */
function extractDiagnostics(sourceFile: ts.SourceFile): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  const syntactic = program!.getSyntacticDiagnostics(sourceFile);
  const semantic = program!.getSemanticDiagnostics(sourceFile);

  for (const diag of [...syntactic, ...semantic]) {
    if (diag.file && diag.start !== undefined) {
      const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
      diagnostics.push({
        message: ts.flattenDiagnosticMessageText(diag.messageText, "\n"),
        severity:
          diag.category === ts.DiagnosticCategory.Error
            ? "error"
            : diag.category === ts.DiagnosticCategory.Warning
              ? "warning"
              : "info",
        location: { line: pos.line + 1, column: pos.character },
        code: diag.code,
      });
    }
  }

  return diagnostics;
}

// =============================================================================
// Message Handler
// =============================================================================

parentPort?.on("message", async (request: SemanticRequest) => {
  const response: SemanticResponse = {
    type: "error",
    requestId: request.requestId,
  };

  try {
    switch (request.type) {
      case "initialize":
        if (request.tsconfigPath && request.projectRoot) {
          initializeProgram(request.tsconfigPath, request.projectRoot);
          response.type = "initialized";
        } else {
          throw new Error("Missing tsconfigPath or projectRoot for initialization");
        }
        break;

      case "analyze": {
        if (!program || !typeChecker) {
          throw new Error("Program not initialized. Send 'initialize' first.");
        }

        if (!request.filePaths || request.filePaths.length === 0) {
          throw new Error("No file paths provided for analysis");
        }

        const results: AnalyzedFile[] = [];

        for (let i = 0; i < request.filePaths.length; i++) {
          const filePath = request.filePaths[i];
          if (!filePath) continue;

          // Report progress
          const progressInfo: ProgressInfo = {
            current: i + 1,
            total: request.filePaths.length,
            filePath,
            phase: "type-checking",
          };

          parentPort?.postMessage({
            type: "progress",
            requestId: request.requestId,
            data: progressInfo,
          } as SemanticResponse);

          try {
            results.push(analyzeFile(filePath));
          } catch (fileError) {
            // Log error but continue with other files
            console.error(`Error analyzing ${filePath}:`, fileError);
          }
        }

        response.type = "result";
        response.data = results;
        break;
      }

      case "shutdown":
        program = null;
        typeChecker = null;
        _projectRoot = null;
        compilerOptions = null;
        response.type = "shutdown";
        break;

      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }
  } catch (error) {
    response.type = "error";
    response.data = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    } as SemanticError;
  }

  parentPort?.postMessage(response);
});

// Report ready
parentPort?.postMessage({
  type: "initialized",
  requestId: "startup",
  data: { ready: true },
});

/**
 * Import/Export and Ghost Node Extractor
 *
 * Handles:
 * - IMPORTS relationships between files
 * - GhostNode creation for external dependencies
 * - Variable extraction for module-level exports
 *
 * @module
 */

import * as path from "node:path";
import * as fs from "node:fs";
import type { UCEImport, UCEVariable } from "../../types/uce.js";
import type {
  ImportsRow,
  GhostNodeRow,
  VariableRow,
  ReferencesExternalRow,
} from "./types.js";
import { generateFileId, generateGhostId, generateEntityId } from "./id-generator.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of extracting imports from a file.
 */
export interface ImportExtractionResult {
  /** IMPORTS relationship rows (file -> file) */
  importsRows: ImportsRow[];
  /** GhostNode rows for external packages */
  ghostNodeRows: GhostNodeRow[];
  /** REFERENCES_EXTERNAL rows (for function/class -> ghost) */
  referencesExternalRows: ReferencesExternalRow[];
  /** Map of imported symbol -> source info (for call resolution) */
  importedSymbols: Map<string, ImportedSymbolInfo>;
}

/**
 * Information about an imported symbol.
 */
export interface ImportedSymbolInfo {
  /** Original name in source module */
  originalName: string;
  /** Local name in this file */
  localName: string;
  /** Source module path */
  source: string;
  /** Whether it's from external package */
  isExternal: boolean;
  /** Resolved file ID if internal */
  resolvedFileId: string | null;
  /** Ghost node ID if external */
  ghostNodeId: string | null;
}

/**
 * Result of extracting a variable.
 */
export interface VariableExtractionResult {
  /** CozoDB row for the variable table */
  row: VariableRow;
}

// =============================================================================
// Import Extractor
// =============================================================================

/**
 * Extracts import/export relationships and creates ghost nodes.
 *
 * @example
 * ```typescript
 * const extractor = new ImportExtractor('/project/root');
 *
 * const result = extractor.extractImports(
 *   uceFile.imports,
 *   fileId,
 *   '/project/src/module.ts'
 * );
 *
 * batch.imports.push(...result.importsRows);
 * batch.ghostNode.push(...result.ghostNodeRows);
 * ```
 */
export class ImportExtractor {
  private projectRoot: string;
  private knownGhosts: Set<string> = new Set();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Extracts import relationships and creates ghost nodes.
   *
   * @param imports - UCE import statements
   * @param fileId - ID of the importing file
   * @param filePath - Path of the importing file
   */
  extractImports(
    imports: UCEImport[],
    fileId: string,
    filePath: string
  ): ImportExtractionResult {
    const importsRows: ImportsRow[] = [];
    const ghostNodeRows: GhostNodeRow[] = [];
    const referencesExternalRows: ReferencesExternalRow[] = [];
    const importedSymbols = new Map<string, ImportedSymbolInfo>();

    for (const imp of imports) {
      const isExternal = this.isExternalImport(imp.source);

      if (isExternal) {
        // External package -> create ghost nodes
        const packageName = this.extractPackageName(imp.source);

        for (const spec of imp.specifiers) {
          const ghostId = generateGhostId(packageName, spec.imported);

          // Avoid duplicates
          if (!this.knownGhosts.has(ghostId)) {
            this.knownGhosts.add(ghostId);

            const ghostRow: GhostNodeRow = [
              ghostId,                                  // id
              spec.imported,                            // name
              packageName,                              // package_name
              this.inferEntityType(spec.imported),      // entity_type
              null,                                     // signature (unknown)
              true,                                     // is_external
            ];
            ghostNodeRows.push(ghostRow);
          }

          // Track imported symbol
          importedSymbols.set(spec.local, {
            originalName: spec.imported,
            localName: spec.local,
            source: imp.source,
            isExternal: true,
            resolvedFileId: null,
            ghostNodeId: ghostId,
          });

          // REFERENCES_EXTERNAL will be added when we know what uses this import
          // For now, track the import for call resolution
        }
      } else {
        // Internal import -> create IMPORTS relationship
        const resolvedPath = this.resolveImportPath(imp.source, filePath);

        if (resolvedPath) {
          const targetFileId = generateFileId(resolvedPath);

          // Determine import type
          let importType: "named" | "default" | "namespace" | "side-effect" = "named";
          if (imp.isSideEffect) {
            importType = "side-effect";
          } else if (imp.specifiers.some((s) => s.type === "namespace")) {
            importType = "namespace";
          } else if (imp.specifiers.some((s) => s.type === "default")) {
            importType = "default";
          }

          const importsRow: ImportsRow = [
            fileId,                                     // from_id
            targetFileId,                               // to_id
            imp.specifiers.map((s) => s.imported),      // imported_symbols
            importType,                                 // import_type
            imp.isTypeOnly,                             // is_type_only
          ];
          importsRows.push(importsRow);

          // Track imported symbols for call resolution
          for (const spec of imp.specifiers) {
            importedSymbols.set(spec.local, {
              originalName: spec.imported,
              localName: spec.local,
              source: imp.source,
              isExternal: false,
              resolvedFileId: targetFileId,
              ghostNodeId: null,
            });
          }
        }
      }
    }

    return {
      importsRows,
      ghostNodeRows,
      referencesExternalRows,
      importedSymbols,
    };
  }

  /**
   * Extracts a module-level variable.
   *
   * @param variable - UCE variable entity
   * @param fileId - ID of the containing file
   * @param filePath - Path of the containing file
   */
  extractVariable(
    variable: UCEVariable,
    fileId: string,
    filePath: string
  ): VariableExtractionResult {
    const variableId = generateEntityId(filePath, "variable", variable.name);

    const row: VariableRow = [
      variableId,                           // id
      variable.name,                        // name
      fileId,                               // file_id
      variable.location.startLine,          // line
      variable.location.startColumn,        // column
      variable.type,                        // variable_type (nullable)
      variable.isConst,                     // is_const
      variable.isExported,                  // is_exported
      "module",                             // scope
    ];

    return { row };
  }

  /**
   * Resets the known ghosts set (useful between projects).
   */
  resetGhostCache(): void {
    this.knownGhosts.clear();
  }

  // ===========================================================================
  // Path Resolution
  // ===========================================================================

  /**
   * Checks if an import is external (from node_modules).
   */
  private isExternalImport(source: string): boolean {
    // Relative imports start with . or ..
    if (source.startsWith(".")) {
      return false;
    }

    // Node.js built-ins start with node:
    if (source.startsWith("node:")) {
      return true;
    }

    // Absolute imports (bare specifiers) are external
    return true;
  }

  /**
   * Extracts package name from import source.
   *
   * @example
   * 'react' -> 'react'
   * '@scope/package' -> '@scope/package'
   * '@scope/package/sub' -> '@scope/package'
   * 'lodash/debounce' -> 'lodash'
   * 'node:fs' -> 'node:fs'
   */
  private extractPackageName(source: string): string {
    // Handle node: prefix
    if (source.startsWith("node:")) {
      return source;
    }

    // Handle scoped packages
    if (source.startsWith("@")) {
      const parts = source.split("/");
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
      return source;
    }

    // Regular package
    const parts = source.split("/");
    return parts[0] ?? source;
  }

  /**
   * Resolves a relative import to an absolute file path.
   *
   * @returns Resolved path or null if not found
   */
  private resolveImportPath(source: string, fromPath: string): string | null {
    if (!source.startsWith(".")) {
      return null;
    }

    const dir = path.dirname(fromPath);
    const resolved = path.resolve(dir, source);

    // Try common extensions
    const extensions = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

    for (const ext of extensions) {
      const fullPath = resolved + ext;
      if (this.fileExists(fullPath)) {
        return fullPath;
      }
    }

    // Check if it's already a full path
    if (this.fileExists(resolved)) {
      return resolved;
    }

    return null;
  }

  /**
   * Checks if a file exists (with caching for performance).
   */
  private fileExists(filePath: string): boolean {
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Infers entity type from name using naming conventions.
   *
   * @example
   * 'useState' -> 'function' (camelCase)
   * 'Component' -> 'class' (PascalCase)
   * 'Props' -> 'interface' (PascalCase + common suffix)
   */
  private inferEntityType(name: string): string {
    // Check for common interface/type suffixes
    if (name.endsWith("Props") || name.endsWith("State") || name.endsWith("Config")) {
      return "interface";
    }

    if (name.endsWith("Type") || name.endsWith("Options")) {
      return "type";
    }

    // PascalCase usually indicates class/component
    const firstChar = name[0];
    if (firstChar && firstChar === firstChar.toUpperCase() && /[a-z]/.test(name)) {
      return "class";
    }

    // camelCase indicates function
    return "function";
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates an ImportExtractor instance.
 */
export function createImportExtractor(projectRoot: string): ImportExtractor {
  return new ImportExtractor(projectRoot);
}

/**
 * Call Graph Linker - Pass 2 Cross-File Resolution
 *
 * Resolves unresolved function calls by building a global symbol registry
 * and using import information to link calls across files.
 *
 * Architecture:
 * - Pass 1 (EntityPipeline): Extracts entities, resolves same-file calls
 * - Pass 2 (CallGraphLinker): Resolves cross-file calls using global registry
 *
 * @module
 */

import type { ExtractionResult, CallsRow, UnresolvedCall } from "./types.js";
import type { IGraphStore } from "../interfaces/IGraphStore.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("call-graph-linker");

// =============================================================================
// Types
// =============================================================================

/**
 * Global symbol registry for cross-file resolution.
 */
export interface GlobalSymbolRegistry {
  /** Map of "filePath:functionName" -> entityId for functions */
  functions: Map<string, string>;
  /** Map of "filePath:className.methodName" -> entityId for methods */
  methods: Map<string, string>;
  /** Map of "filePath:className" -> entityId for classes */
  classes: Map<string, string>;
  /** Map of file path -> file ID */
  files: Map<string, string>;
  /** Map of "filePath:exportedName" -> { entityId, kind } for exports */
  exports: Map<string, ExportInfo>;
}

/**
 * Information about an exported symbol.
 */
export interface ExportInfo {
  entityId: string;
  kind: "function" | "class" | "method" | "interface" | "variable";
  name: string;
}

/**
 * Import mapping for a file.
 */
export interface FileImportMap {
  /** Map of local name -> { sourceFile, originalName } */
  imports: Map<string, ImportedSymbol>;
}

/**
 * Information about an imported symbol.
 */
export interface ImportedSymbol {
  /** Resolved source file path (null if external) */
  sourceFilePath: string | null;
  /** Original name in source file */
  originalName: string;
  /** Whether this is from an external package */
  isExternal: boolean;
}

/**
 * Result of cross-file call resolution.
 */
export interface LinkingResult {
  /** Resolved calls ready to write to database */
  resolvedCalls: CallsRow[];
  /** Calls that couldn't be resolved (external or unknown) */
  unresolvedCount: number;
  /** Statistics */
  stats: {
    totalUnresolved: number;
    resolvedCount: number;
    externalCount: number;
    unknownCount: number;
  };
}

// =============================================================================
// Call Graph Linker
// =============================================================================

/**
 * Links function calls across files by resolving unresolved calls
 * from Pass 1 extraction.
 *
 * @example
 * ```typescript
 * const linker = new CallGraphLinker(store);
 *
 * // After Pass 1 extraction
 * const results: ExtractionResult[] = await extractAll();
 *
 * // Pass 2: Resolve cross-file calls
 * const linkingResult = await linker.linkCalls(results);
 *
 * // Write resolved calls to database
 * await store.writeBatch({ calls: linkingResult.resolvedCalls, ... });
 * ```
 */
export class CallGraphLinker {
  private store: IGraphStore;

  constructor(store: IGraphStore) {
    this.store = store;
  }

  /**
   * Resolves cross-file calls from extraction results.
   */
  async linkCalls(results: ExtractionResult[]): Promise<LinkingResult> {
    // Step 1: Build global symbol registry
    const registry = this.buildSymbolRegistry(results);
    logger.debug({
      functions: registry.functions.size,
      methods: registry.methods.size,
      exports: registry.exports.size,
      files: registry.files.size
    }, "Built global symbol registry");

    // Step 2: Build import maps for each file
    const importMaps = await this.buildImportMaps(results);
    logger.debug({ fileCount: importMaps.size }, "Built import maps");

    // Step 3: Resolve unresolved calls
    const resolvedCalls: CallsRow[] = [];
    let externalCount = 0;
    let unknownCount = 0;
    let totalUnresolved = 0;

    for (const result of results) {
      totalUnresolved += result.unresolvedCalls.length;

      for (const call of result.unresolvedCalls) {
        const resolved = this.resolveCall(
          call,
          result.filePath,
          registry,
          importMaps.get(result.filePath)
        );

        if (resolved) {
          if (resolved.isExternal) {
            externalCount++;
          } else {
            resolvedCalls.push(resolved.callRow);
          }
        } else {
          unknownCount++;
        }
      }
    }

    const stats = {
      totalUnresolved,
      resolvedCount: resolvedCalls.length,
      externalCount,
      unknownCount,
    };

    logger.info(stats, "Cross-file call resolution complete");

    return {
      resolvedCalls,
      unresolvedCount: externalCount + unknownCount,
      stats,
    };
  }

  /**
   * Builds a global symbol registry from all extraction results.
   */
  private buildSymbolRegistry(results: ExtractionResult[]): GlobalSymbolRegistry {
    const registry: GlobalSymbolRegistry = {
      functions: new Map(),
      methods: new Map(),
      classes: new Map(),
      files: new Map(),
      exports: new Map(),
    };

    for (const result of results) {
      const filePath = result.filePath;
      registry.files.set(filePath, result.fileId);

      // Extract function info from batch
      // FunctionRow: [id, name, file_id, start_line, end_line, start_column, end_column, signature, return_type, is_exported, ...]
      for (const fnRow of result.batch.function) {
        const id = fnRow[0];
        const name = fnRow[1];
        const isExported = fnRow[9]; // is_exported is at index 9
        const key = `${filePath}:${name}`;
        registry.functions.set(key, id);

        // Track exports
        if (isExported) {
          registry.exports.set(key, {
            entityId: id,
            kind: "function",
            name,
          });
        }
      }

      // Extract class info from batch
      // ClassRow: [id, name, file_id, start_line, end_line, is_abstract, is_exported, ...]
      for (const clsRow of result.batch.class) {
        const id = clsRow[0];
        const name = clsRow[1];
        const isExported = clsRow[6]; // is_exported is at index 6
        const key = `${filePath}:${name}`;
        registry.classes.set(key, id);

        if (isExported) {
          registry.exports.set(key, {
            entityId: id,
            kind: "class",
            name,
          });
        }
      }

      // Extract method info from hasMethod relationships
      for (const hmRow of result.batch.hasMethod) {
        const [classId, methodId] = hmRow;
        // Find the class name for this method
        const classEntry = result.batch.class.find(c => c[0] === classId);
        if (classEntry) {
          const className = classEntry[1]; // name is at index 1
          // Find the method/function name
          const fnEntry = result.batch.function.find(f => f[0] === methodId);
          if (fnEntry) {
            const methodName = fnEntry[1]; // name is at index 1
            const key = `${filePath}:${className}.${methodName}`;
            registry.methods.set(key, methodId);
          }
        }
      }
    }

    return registry;
  }

  /**
   * Builds import maps for all files by querying the imports table.
   */
  private async buildImportMaps(
    results: ExtractionResult[]
  ): Promise<Map<string, FileImportMap>> {
    const importMaps = new Map<string, FileImportMap>();

    // Build file ID to path mapping
    const fileIdToPath = new Map<string, string>();
    for (const result of results) {
      fileIdToPath.set(result.fileId, result.filePath);
    }

    // Query imports from database
    try {
      const importsResult = await this.store.query<{
        from_id: string;
        to_id: string;
        imported_symbols: string[];
      }>(`
        ?[from_id, to_id, imported_symbols] := *imports{from_id, to_id, imported_symbols}
      `);

      for (const row of importsResult.rows) {
        const sourceFilePath = fileIdToPath.get(row.from_id);
        const targetFilePath = fileIdToPath.get(row.to_id);

        if (!sourceFilePath) continue;

        let fileMap = importMaps.get(sourceFilePath);
        if (!fileMap) {
          fileMap = { imports: new Map() };
          importMaps.set(sourceFilePath, fileMap);
        }

        // Each imported symbol maps to the target file
        for (const symbolName of row.imported_symbols) {
          fileMap.imports.set(symbolName, {
            sourceFilePath: targetFilePath ?? null,
            originalName: symbolName,
            isExternal: !targetFilePath,
          });
        }
      }
    } catch (error) {
      logger.warn({ error }, "Failed to query imports for call resolution");
    }

    return importMaps;
  }

  /**
   * Attempts to resolve a single unresolved call.
   */
  private resolveCall(
    call: UnresolvedCall,
    callerFilePath: string,
    registry: GlobalSymbolRegistry,
    importMap?: FileImportMap
  ): { callRow: CallsRow; isExternal: false } | { isExternal: true } | null {
    const { callerId, calleeName, lineNumber, isDirectCall, isAsync } = call;

    // Skip if we don't have a valid caller ID
    if (!callerId || callerId.includes(":")) {
      // Caller ID is a placeholder, not a real entity ID
      // This happens when the caller itself couldn't be resolved
      return null;
    }

    // Try to resolve the callee

    // Strategy 1: Check if it's imported
    if (importMap) {
      const importedSymbol = importMap.imports.get(calleeName);
      if (importedSymbol) {
        if (importedSymbol.isExternal) {
          // External package call (e.g., fs.readFile, lodash.map)
          return { isExternal: true };
        }

        if (importedSymbol.sourceFilePath) {
          // Internal import - look up in registry
          const exportKey = `${importedSymbol.sourceFilePath}:${importedSymbol.originalName}`;
          const exportInfo = registry.exports.get(exportKey);

          if (exportInfo) {
            return {
              callRow: [callerId, exportInfo.entityId, lineNumber, isDirectCall, isAsync],
              isExternal: false,
            };
          }

          // Try function registry directly
          const fnKey = `${importedSymbol.sourceFilePath}:${importedSymbol.originalName}`;
          const fnId = registry.functions.get(fnKey);
          if (fnId) {
            return {
              callRow: [callerId, fnId, lineNumber, isDirectCall, isAsync],
              isExternal: false,
            };
          }
        }
      }
    }

    // Strategy 2: Check if it's a global/built-in (like console.log)
    const builtIns = ["console", "Math", "JSON", "Object", "Array", "String", "Number", "Boolean", "Date", "Promise", "Error"];
    const receiver = calleeName.split(".")[0];
    if (builtIns.includes(receiver || "")) {
      return { isExternal: true };
    }

    // Strategy 3: Check for local definition (same file)
    // Construct key: filePath:functionName
    const localKey = `${callerFilePath}:${calleeName}`;
    const localFnId = registry.functions.get(localKey);
    if (localFnId) {
      return {
        callRow: [callerId, localFnId, lineNumber, isDirectCall, isAsync],
        isExternal: false,
      };
    }

    // Strategy 4: Could be a method call on a local object
    // For now, we can't resolve these without type information

    return null;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a CallGraphLinker instance.
 */
export function createCallGraphLinker(store: IGraphStore): CallGraphLinker {
  return new CallGraphLinker(store);
}

/**
 * Entity Extraction Pipeline
 *
 * Orchestrates all extractors to convert UCE files into CozoDB-native batches.
 *
 * Two-Pass Architecture:
 * - Pass 1 (this file): Extract all entities, create local relationships, track unresolved refs
 * - Pass 2 (CallGraphLinker): Resolve cross-file calls using complete symbol registry
 *
 * @module
 */

import * as path from "node:path";
import type { Tree } from "web-tree-sitter";
import type { UCEFile } from "../../types/uce.js";
import {
  type CozoBatch,
  type ExtractionResult,
  type ExtractionStats,
  type ExtractionError,
  type UnresolvedCall,
  type UnresolvedTypeRef,
  type EmbeddingChunk,
  type FileRow,
  type ContainsRow,
  type CallsRow,
  type ParameterSemanticsRow,
  type ReturnSemanticsRow,
  type ErrorPathRow,
  type ErrorAnalysisRow,
  createEmptyBatch,
} from "./types.js";
import { generateFileId, generateEntityId } from "./id-generator.js";
import { FunctionExtractor } from "./function-extractor.js";
import { ClassExtractor } from "./class-extractor.js";
import { InterfaceExtractor } from "./interface-extractor.js";
import { ImportExtractor } from "./import-extractor.js";
import { CallExtractor, type FunctionCall } from "../parser/call-extractor.js";
import { ParameterAnalyzer } from "./analyzers/parameter-analyzer.js";
import { ReturnAnalyzer } from "./analyzers/return-analyzer.js";
import { ErrorAnalyzer } from "./analyzers/error-analyzer.js";
import type {
  ParameterAnalysisResult,
  ReturnAnalysisResult,
  ErrorAnalysisResult,
} from "../analysis/interfaces.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("extraction-pipeline");

// =============================================================================
// Pipeline Options
// =============================================================================

/**
 * Options for the extraction pipeline.
 */
export interface PipelineOptions {
  /** Project root directory */
  projectRoot: string;
  /** Whether to extract embedding text */
  extractEmbeddings?: boolean;
  /** Whether to track call sites for Pass 2 */
  trackCalls?: boolean;
  /** Whether to perform enhanced semantic analysis (Phase 1) */
  semanticAnalysis?: boolean;
}

// =============================================================================
// Entity Pipeline
// =============================================================================

/**
 * Main extraction pipeline that coordinates all extractors.
 *
 * @example
 * ```typescript
 * const pipeline = new EntityPipeline({ projectRoot: '/project' });
 *
 * // Pass 1: Extract from each file
 * const results: ExtractionResult[] = [];
 * for (const file of parsedFiles) {
 *   results.push(await pipeline.extract(file, fileHash, fileSize));
 * }
 *
 * // Merge batches and write to CozoDB
 * const merged = pipeline.mergeBatches(results.map(r => r.batch));
 * await graphWriter.writeBatch(merged);
 *
 * // Pass 2: Resolve cross-file calls
 * const callLinks = callGraphLinker.resolve(results);
 * ```
 */
export class EntityPipeline {
  private functionExtractor: FunctionExtractor;
  private classExtractor: ClassExtractor;
  private interfaceExtractor: InterfaceExtractor;
  private importExtractor: ImportExtractor;
  private callExtractor: CallExtractor;
  private parameterAnalyzer: ParameterAnalyzer;
  private returnAnalyzer: ReturnAnalyzer;
  private errorAnalyzer: ErrorAnalyzer;
  private options: Required<PipelineOptions>;

  constructor(options: PipelineOptions) {
    this.options = {
      extractEmbeddings: true,
      trackCalls: true,
      semanticAnalysis: false, // Disabled by default for backwards compatibility
      ...options,
    };

    this.functionExtractor = new FunctionExtractor();
    this.classExtractor = new ClassExtractor();
    this.interfaceExtractor = new InterfaceExtractor();
    this.importExtractor = new ImportExtractor(options.projectRoot);
    this.callExtractor = new CallExtractor();

    // Phase 1: Enhanced Entity Semantics analyzers
    this.parameterAnalyzer = new ParameterAnalyzer();
    this.returnAnalyzer = new ReturnAnalyzer();
    this.errorAnalyzer = new ErrorAnalyzer();
  }

  /**
   * Extracts all entities from a parsed file.
   *
   * @param uceFile - Parsed file in UCE format
   * @param fileHash - Content hash for change detection
   * @param fileSize - File size in bytes
   * @param framework - Detected framework (optional)
   * @param tree - Optional Tree-sitter parse tree for call extraction
   * @param sourceCode - Optional source code (required if tree is provided)
   */
  async extract(
    uceFile: UCEFile,
    fileHash: string,
    fileSize: number,
    framework: string | null = null,
    tree?: Tree,
    sourceCode?: string
  ): Promise<ExtractionResult> {
    const batch = createEmptyBatch();
    const errors: ExtractionError[] = [];
    const unresolvedCalls: UnresolvedCall[] = [];
    const unresolvedTypes: UnresolvedTypeRef[] = [];
    const embeddingChunks: EmbeddingChunk[] = [];

    const filePath = uceFile.filePath;
    const fileId = generateFileId(filePath);

    // Map of full scope name to Entity ID for hierarchy resolution
    const scopeMap = new Map<string, string>();

    // ===========================================================================
    // 1. File Entity
    // ===========================================================================
    const fileRow: FileRow = [
      fileId,
      filePath,
      path.relative(this.options.projectRoot, filePath),
      path.extname(filePath),
      fileHash,
      fileSize,
      Date.now(),
      uceFile.language,
      framework,
    ];
    batch.file.push(fileRow);

    // ===========================================================================
    // 2. Functions
    // ===========================================================================
    for (const fn of uceFile.functions) {
      try {
        const result = this.functionExtractor.extract(fn, fileId, filePath);

        batch.function.push(result.row);

        // Register in scope map
        const fullName = fn.parentScope ? `${fn.parentScope}.${fn.name}` : fn.name;
        scopeMap.set(fullName, result.row[0]);

        // CONTAINS relationship
        let containerId = fileId;
        if (fn.parentScope && scopeMap.has(fn.parentScope)) {
          containerId = scopeMap.get(fn.parentScope)!;
        }

        const containsRow: ContainsRow = [containerId, result.row[0], fn.location.startLine];
        batch.contains.push(containsRow);

        if (this.options.extractEmbeddings) {
          embeddingChunks.push(result.embeddingChunk);
        }

        unresolvedTypes.push(...result.unresolvedTypes);
      } catch (e) {
        errors.push({
          kind: "function",
          name: fn.name,
          error: String(e),
          location: { line: fn.location.startLine, column: fn.location.startColumn },
        });
      }
    }

    // ===========================================================================
    // 3. Classes
    // ===========================================================================
    for (const cls of uceFile.classes) {
      try {
        const result = this.classExtractor.extract(cls, fileId, filePath);

        // Add class row
        batch.class.push(result.classRow);

        // Register class in scope map
        const fullName = cls.parentScope ? `${cls.parentScope}.${cls.name}` : cls.name;
        scopeMap.set(fullName, result.classRow[0]);

        // Add method rows and register them
        batch.function.push(...result.methodRows);
        for (const methodRow of result.methodRows) {
          // methodRow[1] is name, methodRow[0] is id
          // Method scope is class name.
          const methodFullName = `${fullName}.${methodRow[1]}`;
          scopeMap.set(methodFullName, methodRow[0]);
        }

        // Add HAS_METHOD relationships
        batch.hasMethod.push(...result.hasMethodRows);

        // CONTAINS relationship for class
        let containerId = fileId;
        if (cls.parentScope && scopeMap.has(cls.parentScope)) {
          containerId = scopeMap.get(cls.parentScope)!;
        }

        const containsRow: ContainsRow = [containerId, result.classRow[0], cls.location.startLine];
        batch.contains.push(containsRow);

        if (this.options.extractEmbeddings) {
          embeddingChunks.push(...result.embeddingChunks);
        }

        unresolvedTypes.push(...result.unresolvedTypes);

        // Create EXTENDS relationship (unresolved - target ID is placeholder)
        if (result.unresolvedExtends) {
          // Use a placeholder ID based on the class name for now
          // This will be resolved in Pass 2 when we have the full symbol registry
          const placeholderTargetId = `unresolved:class:${result.unresolvedExtends}`;
          batch.extends.push([result.classRow[0], placeholderTargetId]);

          unresolvedTypes.push({
            sourceId: result.classRow[0],
            typeName: result.unresolvedExtends,
            context: "extends",
            parameterName: null,
          });
        }

        // Create IMPLEMENTS relationships (unresolved - target IDs are placeholders)
        for (const iface of result.unresolvedImplements) {
          const placeholderTargetId = `unresolved:interface:${iface}`;
          batch.implements.push([result.classRow[0], placeholderTargetId]);

          unresolvedTypes.push({
            sourceId: result.classRow[0],
            typeName: iface,
            context: "implements",
            parameterName: null,
          });
        }
      } catch (e) {
        errors.push({
          kind: "class",
          name: cls.name,
          error: String(e),
          location: { line: cls.location.startLine, column: cls.location.startColumn },
        });
      }
    }

    // ===========================================================================
    // 4. Interfaces
    // ===========================================================================
    for (const iface of uceFile.interfaces) {
      try {
        const result = this.interfaceExtractor.extractInterface(iface, fileId, filePath);

        batch.interface.push(result.row);

        // CONTAINS relationship
        const containsRow: ContainsRow = [fileId, result.row[0], iface.location.startLine];
        batch.contains.push(containsRow);

        if (this.options.extractEmbeddings) {
          embeddingChunks.push(result.embeddingChunk);
        }

        // Track unresolved EXTENDS_INTERFACE
        for (const ext of result.unresolvedExtends) {
          unresolvedTypes.push({
            sourceId: result.row[0],
            typeName: ext,
            context: "extends_interface",
            parameterName: null,
          });
        }
      } catch (e) {
        errors.push({
          kind: "interface",
          name: iface.name,
          error: String(e),
          location: { line: iface.location.startLine, column: iface.location.startColumn },
        });
      }
    }

    // ===========================================================================
    // 5. Type Aliases
    // ===========================================================================
    for (const typeAlias of uceFile.typeAliases) {
      try {
        const result = this.interfaceExtractor.extractTypeAlias(typeAlias, fileId, filePath);

        batch.typeAlias.push(result.row);

        // CONTAINS relationship
        const containsRow: ContainsRow = [fileId, result.row[0], typeAlias.location.startLine];
        batch.contains.push(containsRow);

        if (this.options.extractEmbeddings) {
          embeddingChunks.push(result.embeddingChunk);
        }
      } catch (e) {
        errors.push({
          kind: "typeAlias",
          name: typeAlias.name,
          error: String(e),
          location: { line: typeAlias.location.startLine, column: typeAlias.location.startColumn },
        });
      }
    }

    // ===========================================================================
    // 6. Variables
    // ===========================================================================
    for (const variable of uceFile.variables) {
      try {
        const result = this.importExtractor.extractVariable(variable, fileId, filePath);

        batch.variable.push(result.row);

        // CONTAINS relationship
        const containsRow: ContainsRow = [fileId, result.row[0], variable.location.startLine];
        batch.contains.push(containsRow);
      } catch (e) {
        errors.push({
          kind: "variable",
          name: variable.name,
          error: String(e),
          location: { line: variable.location.startLine, column: variable.location.startColumn },
        });
      }
    }

    // ===========================================================================
    // 7. Imports (IMPORTS relationships + GhostNodes)
    // ===========================================================================
    try {
      const importResult = this.importExtractor.extractImports(
        uceFile.imports,
        fileId,
        filePath
      );

      batch.imports.push(...importResult.importsRows);
      batch.ghostNode.push(...importResult.ghostNodeRows);
      batch.referencesExternal.push(...importResult.referencesExternalRows);

      // Store imported symbols for call resolution (if needed)
      // This would be passed to CallGraphLinker in Pass 2
    } catch (e) {
      errors.push({
        kind: "imports",
        name: filePath,
        error: String(e),
      });
    }

    // ===========================================================================
    // 7. Function Calls (if tree is provided)
    // ===========================================================================
    if (tree && sourceCode && this.options.trackCalls) {
      try {
        // Extract raw calls from the AST using tree-walking (more reliable than position matching)
        const callGraph = this.callExtractor.extractFromTree(tree, sourceCode, filePath);
        const rawCalls = callGraph.calls;

        // Debug: log raw call count for first few files
        if (rawCalls.length > 0) {
          logger.debug({ filePath, rawCallCount: rawCalls.length }, "Raw calls extracted");
        }

        // Build a map of function names to their IDs for resolution
        // Include top-level functions
        const nameToId = new Map<string, string>();
        for (const fn of uceFile.functions) {
          const fnId = generateEntityId(filePath, "function", fn.name, "", String(fn.location.startLine));
          nameToId.set(fn.name, fnId);
        }

        // Include class methods with "ClassName.methodName" format
        for (const cls of uceFile.classes) {
          for (const method of cls.methods) {
            const methodId = generateEntityId(filePath, "function", method.name, cls.name, String(method.location.startLine));
            nameToId.set(`${cls.name}.${method.name}`, methodId);
            // Also try just the method name for this.method() calls within the class
            if (!nameToId.has(method.name)) {
              nameToId.set(method.name, methodId);
            }
          }
          // Constructor
          if (cls.constructor) {
            const ctorId = generateEntityId(filePath, "function", "constructor", cls.name, String(cls.constructor.location.startLine));
            nameToId.set(`${cls.name}.constructor`, ctorId);
          }
        }

        // Resolve calls to CallsRow entries
        for (const call of rawCalls) {
          // Try to resolve caller ID
          let callerId: string | null = null;
          if (call.callerName === "<module>") {
            callerId = fileId; // Module-level call, caller is the file
          } else {
            callerId = nameToId.get(call.callerName) ?? null;
          }

          // Try to resolve callee ID
          const calleeId = nameToId.get(call.calleeName) ?? null;

          if (callerId && calleeId) {
            // Both resolved - create a CallsRow
            const callsRow: CallsRow = [
              callerId,
              calleeId,
              call.lineNumber,
              call.isDirectCall,
              call.isAwait,
            ];
            batch.calls.push(callsRow);
          } else {
            // Store as unresolved for Pass 2 cross-file resolution
            unresolvedCalls.push({
              callerId: callerId ?? `${filePath}:${call.callerName}`,
              calleeName: call.calleeName,
              modulePath: null, // TODO: Extract module path for imported calls
              lineNumber: call.lineNumber,
              isDirectCall: call.isDirectCall,
              isAsync: call.isAwait,
            });
          }
        }

        // Log resolution stats
        if (rawCalls.length > 0) {
          logger.debug({
            filePath,
            rawCalls: rawCalls.length,
            resolvedCalls: batch.calls.length,
            unresolvedCalls: unresolvedCalls.length
          }, "Call resolution stats");
        }
      } catch (e) {
        errors.push({
          kind: "calls",
          name: filePath,
          error: String(e),
        });
      }
    }

    // ===========================================================================
    // Build Statistics
    // ===========================================================================
    const stats: ExtractionStats = {
      functions: uceFile.functions.length,
      classes: uceFile.classes.length,
      interfaces: uceFile.interfaces.length,
      typeAliases: uceFile.typeAliases.length,
      variables: uceFile.variables.length,
      imports: uceFile.imports.length,
      exports: uceFile.exports.length,
      ghostNodes: batch.ghostNode.length,
    };

    return {
      fileId,
      filePath,
      batch,
      unresolvedCalls,
      unresolvedTypes,
      embeddingChunks,
      errors,
      stats,
    };
  }

  /**
   * Merges multiple CozoBatches into a single batch.
   * Useful for batch database insertion.
   */
  mergeBatches(batches: CozoBatch[]): CozoBatch {
    const merged = createEmptyBatch();

    for (const batch of batches) {
      merged.file.push(...batch.file);
      merged.function.push(...batch.function);
      merged.class.push(...batch.class);
      merged.interface.push(...batch.interface);
      merged.typeAlias.push(...batch.typeAlias);
      merged.variable.push(...batch.variable);
      merged.ghostNode.push(...batch.ghostNode);
      merged.contains.push(...batch.contains);
      merged.calls.push(...batch.calls);
      merged.imports.push(...batch.imports);
      merged.extends.push(...batch.extends);
      merged.implements.push(...batch.implements);
      merged.extendsInterface.push(...batch.extendsInterface);
      merged.hasMethod.push(...batch.hasMethod);
      merged.usesType.push(...batch.usesType);
      merged.referencesExternal.push(...batch.referencesExternal);
      // Phase 1: Enhanced Entity Semantics
      merged.parameterSemantics.push(...batch.parameterSemantics);
      merged.returnSemantics.push(...batch.returnSemantics);
      merged.errorPaths.push(...batch.errorPaths);
      merged.errorAnalysis.push(...batch.errorAnalysis);
    }

    // Deduplicate ghost nodes by ID
    const seenGhosts = new Set<string>();
    merged.ghostNode = merged.ghostNode.filter((row) => {
      if (seenGhosts.has(row[0])) return false;
      seenGhosts.add(row[0]);
      return true;
    });

    return merged;
  }

  /**
   * Gets batch statistics.
   */
  getBatchStats(batch: CozoBatch): Record<string, number> {
    return {
      files: batch.file.length,
      functions: batch.function.length,
      classes: batch.class.length,
      interfaces: batch.interface.length,
      typeAliases: batch.typeAlias.length,
      variables: batch.variable.length,
      ghostNodes: batch.ghostNode.length,
      contains: batch.contains.length,
      calls: batch.calls.length,
      imports: batch.imports.length,
      extends: batch.extends.length,
      implements: batch.implements.length,
      extendsInterface: batch.extendsInterface.length,
      hasMethod: batch.hasMethod.length,
      usesType: batch.usesType.length,
      referencesExternal: batch.referencesExternal.length,
      // Phase 1: Enhanced Entity Semantics
      parameterSemantics: batch.parameterSemantics.length,
      returnSemantics: batch.returnSemantics.length,
      errorPaths: batch.errorPaths.length,
      errorAnalysis: batch.errorAnalysis.length,
    };
  }

  // ===========================================================================
  // Semantic Analysis Methods (Phase 1)
  // ===========================================================================

  /**
   * Convert parameter analysis result to database rows.
   * Call this when you have AST access (at indexer level).
   *
   * @param analysisResult - Result from ParameterAnalyzer
   * @returns Rows ready for CozoDB insertion
   */
  convertParameterAnalysisToRows(
    analysisResult: ParameterAnalysisResult
  ): ParameterSemanticsRow[] {
    const rows: ParameterSemanticsRow[] = [];

    for (const param of analysisResult.parameters) {
      const id = generateEntityId(
        analysisResult.functionId,
        "param-semantics",
        param.name,
        "",
        param.index.toString()
      );

      rows.push([
        id,
        analysisResult.functionId,
        param.name,
        param.index,
        param.type,
        param.purpose,
        param.isOptional,
        param.isRest,
        param.isDestructured,
        param.defaultValue,
        JSON.stringify(param.validationRules),
        JSON.stringify(param.usedInExpressions),
        param.isMutated,
        JSON.stringify(param.accessedAtLines),
        analysisResult.confidence,
        analysisResult.analyzedAt,
      ]);
    }

    return rows;
  }

  /**
   * Convert return analysis result to database row.
   * Call this when you have AST access (at indexer level).
   *
   * @param analysisResult - Result from ReturnAnalyzer
   * @returns Row ready for CozoDB insertion
   */
  convertReturnAnalysisToRow(
    analysisResult: ReturnAnalysisResult
  ): ReturnSemanticsRow {
    const id = generateEntityId(
      analysisResult.functionId,
      "return-semantics",
      "return",
      "",
      ""
    );

    const { returnSemantics } = analysisResult;

    return [
      id,
      analysisResult.functionId,
      returnSemantics.declaredType,
      returnSemantics.inferredType,
      JSON.stringify(returnSemantics.returnPoints),
      JSON.stringify(returnSemantics.possibleValues),
      JSON.stringify(returnSemantics.nullConditions),
      JSON.stringify(returnSemantics.errorConditions),
      JSON.stringify(returnSemantics.derivedFrom),
      JSON.stringify(returnSemantics.transformations),
      returnSemantics.canReturnVoid,
      returnSemantics.alwaysThrows,
      analysisResult.confidence,
      analysisResult.analyzedAt,
    ];
  }

  /**
   * Convert error analysis result to database rows.
   * Call this when you have AST access (at indexer level).
   *
   * @param analysisResult - Result from ErrorAnalyzer
   * @returns Object with error paths and analysis summary rows
   */
  convertErrorAnalysisToRows(
    analysisResult: ErrorAnalysisResult
  ): { errorPaths: ErrorPathRow[]; errorAnalysis: ErrorAnalysisRow } {
    // Convert error paths
    const errorPathRows: ErrorPathRow[] = analysisResult.errorPaths.map((path) => [
      path.id,
      path.functionId,
      path.errorType,
      path.condition,
      path.isHandled,
      path.handlingStrategy,
      path.recoveryAction,
      JSON.stringify(path.propagatesTo),
      JSON.stringify(path.sourceLocation),
      JSON.stringify(path.stackContext),
      analysisResult.confidence,
      analysisResult.analyzedAt,
    ]);

    // Create analysis summary row
    const analysisId = generateEntityId(
      analysisResult.functionId,
      "error-analysis",
      "summary",
      "",
      ""
    );

    const errorAnalysisRow: ErrorAnalysisRow = [
      analysisId,
      analysisResult.functionId,
      JSON.stringify(analysisResult.throwPoints),
      JSON.stringify(analysisResult.tryCatchBlocks),
      analysisResult.neverThrows,
      analysisResult.hasTopLevelCatch,
      JSON.stringify(analysisResult.escapingErrorTypes),
      analysisResult.confidence,
      analysisResult.analyzedAt,
    ];

    return { errorPaths: errorPathRows, errorAnalysis: errorAnalysisRow };
  }

  /**
   * Runs Pass 2 to resolve cross-file function calls.
   *
   * @param results - Extraction results from Pass 1
   * @param store - Graph store instance
   * @returns Resolved call rows ready for insertion
   */
  async runPass2(
    results: ExtractionResult[],
    store: any // Using any to avoid circular dependency with IGraphStore
  ): Promise<CallsRow[]> {
    // Dynamic import to avoid circular dependency
    const { createCallGraphLinker } = await import("./call-graph-linker.js");
    const linker = createCallGraphLinker(store);

    const result = await linker.linkCalls(results);
    return result.resolvedCalls;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates an EntityPipeline instance.
 */
export function createEntityPipeline(options: PipelineOptions): EntityPipeline {
  return new EntityPipeline(options);
}

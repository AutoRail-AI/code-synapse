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
  createEmptyBatch,
} from "./types.js";
import { generateFileId } from "./id-generator.js";
import { FunctionExtractor } from "./function-extractor.js";
import { ClassExtractor } from "./class-extractor.js";
import { InterfaceExtractor } from "./interface-extractor.js";
import { ImportExtractor } from "./import-extractor.js";

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
  private options: Required<PipelineOptions>;

  constructor(options: PipelineOptions) {
    this.options = {
      extractEmbeddings: true,
      trackCalls: true,
      ...options,
    };

    this.functionExtractor = new FunctionExtractor();
    this.classExtractor = new ClassExtractor();
    this.interfaceExtractor = new InterfaceExtractor();
    this.importExtractor = new ImportExtractor(options.projectRoot);
  }

  /**
   * Extracts all entities from a parsed file.
   *
   * @param uceFile - Parsed file in UCE format
   * @param fileHash - Content hash for change detection
   * @param fileSize - File size in bytes
   * @param framework - Detected framework (optional)
   */
  async extract(
    uceFile: UCEFile,
    fileHash: string,
    fileSize: number,
    framework: string | null = null
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
    };
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

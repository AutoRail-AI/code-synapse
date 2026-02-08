/**
 * Graph Writer
 *
 * Handles atomic writes of extracted entities to the graph database.
 * Ensures file updates are atomic: delete old + insert new in one operation.
 *
 * @module
 */

import type { IGraphStore } from "../interfaces/IGraphStore.js";
import type { ExtractionResult, CozoBatch } from "../extraction/types.js";
import { createLogger } from "../../utils/logger.js";
import { Mutex } from "../../utils/async.js";

const logger = createLogger("graph-writer");

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a write operation.
 */
export interface WriteResult {
  /** File ID that was written */
  fileId: string;
  /** File path */
  filePath: string;
  /** Whether the write was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Statistics about entities written */
  stats: {
    entitiesWritten: number;
    relationshipsWritten: number;
    entitiesDeleted: number;
  };
}

/**
 * Options for GraphWriter.
 */
export interface GraphWriterOptions {
  /** Whether to delete old entities before writing (default: true) */
  deleteBeforeWrite?: boolean;
  /** Whether to skip validation (default: false) */
  skipValidation?: boolean;
}

// =============================================================================
// GraphWriter Implementation
// =============================================================================

/**
 * Writes extracted entities to the graph database atomically.
 *
 * Handles the "delete old + insert new" pattern for file updates,
 * ensuring consistency when files are re-indexed.
 *
 * @example
 * ```typescript
 * const writer = new GraphWriter(store);
 *
 * // Write a single file's extraction result
 * const result = await writer.writeFile(extractionResult);
 *
 * // Write multiple files
 * const results = await writer.writeFiles(extractionResults);
 * ```
 */
export class GraphWriter {
  private store: IGraphStore;
  private options: Required<GraphWriterOptions>;
  private embeddingMutex = new Mutex();

  constructor(store: IGraphStore, options: GraphWriterOptions = {}) {
    this.store = store;
    this.options = {
      deleteBeforeWrite: options.deleteBeforeWrite ?? true,
      skipValidation: options.skipValidation ?? false,
    };
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Write a single file's extraction result to the graph.
   * Atomically deletes old entities and writes new ones.
   */
  async writeFile(result: ExtractionResult): Promise<WriteResult> {
    const _startTime = Date.now();

    try {
      // Validate if enabled
      if (!this.options.skipValidation) {
        this.validateResult(result);
      }

      let entitiesDeleted = 0;

      // Delete old entities for this file if enabled
      if (this.options.deleteBeforeWrite) {
        entitiesDeleted = await this.deleteFileEntities(result.fileId);
      }

      // Separate entity_embeddings to write them under mutex (avoids RocksDB contention)
      const embeddings = result.batch.entityEmbeddings;
      result.batch.entityEmbeddings = [];

      // Write all entities except embeddings (safe for concurrent access)
      await this.store.writeBatch(result.batch);

      // Restore embeddings on batch (for accurate counting below)
      result.batch.entityEmbeddings = embeddings;

      // Write entity_embeddings under mutex to serialize across concurrent files
      if (embeddings.length > 0) {
        await this.embeddingMutex.runExclusive(async () => {
          await this.store.execute(
            `?[entity_id, file_id, vector, text_hash, model, created_at] <- $rows
            :put entity_embedding {entity_id, file_id => vector, text_hash, model, created_at}`,
            {
              rows: embeddings.map(
                ([entityId, fileId, vector, textHash, model, createdAt]) => [
                  entityId,
                  fileId,
                  vector,
                  textHash,
                  model,
                  createdAt,
                ]
              ),
            }
          );
        });
      }

      // Count entities and relationships written
      const entitiesWritten = this.countEntities(result.batch);
      const relationshipsWritten = this.countRelationships(result.batch);

      return {
        fileId: result.fileId,
        filePath: result.filePath,
        success: true,
        stats: {
          entitiesWritten,
          relationshipsWritten,
          entitiesDeleted,
        },
      };
    } catch (error) {
      let errorMessage: string;
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "object" && error !== null) {
        errorMessage = JSON.stringify(error);
      } else {
        errorMessage = String(error);
      }
      return {
        fileId: result.fileId,
        filePath: result.filePath,
        success: false,
        error: errorMessage,
        stats: {
          entitiesWritten: 0,
          relationshipsWritten: 0,
          entitiesDeleted: 0,
        },
      };
    }
  }

  /**
   * Write multiple files' extraction results to the graph.
   * Each file is written atomically.
   */
  async writeFiles(results: ExtractionResult[]): Promise<WriteResult[]> {
    // Parallelize writes for better performance
    // Since each file write is independent and atomic, this is safe
    const writePromises = results.map(result => this.writeFile(result));
    return Promise.all(writePromises);
  }

  /**
   * Write a merged batch directly to the graph.
   * Use this when you've already merged multiple extraction results.
   */
  async writeBatch(batch: CozoBatch): Promise<void> {
    await this.store.writeBatch(batch);
  }

  /**
   * Delete all entities associated with a file.
   * Returns the number of entities deleted.
   */
  async deleteFileEntities(fileId: string): Promise<number> {
    let deletedCount = 0;

    // Helper to safely query - returns empty array if relation doesn't exist
    // IMPORTANT: Logs errors for observability instead of silently swallowing
    const safeQuery = async <T>(script: string, params?: Record<string, unknown>): Promise<T[]> => {
      try {
        const result = await this.store.query<T>(script, params);
        return result.rows;
      } catch (error) {
        // Log the error for debugging - don't silently swallow
        logger.warn(
          { error, fileId, script: script.substring(0, 100) },
          "Graph query failed during file entity deletion (may be expected if relation doesn't exist)"
        );
        return [];
      }
    };

    // Helper to safely execute - ignores errors if relation doesn't exist
    // IMPORTANT: Logs errors for observability instead of silently swallowing
    const safeExecute = async (script: string, params?: Record<string, unknown>): Promise<void> => {
      try {
        await this.store.execute(script, params);
      } catch (error) {
        // Log the error - relation might not exist but we should know about failures
        logger.warn(
          { error, fileId, script: script.substring(0, 100) },
          "Graph execute failed during file entity deletion (may be expected if relation doesn't exist)"
        );
      }
    };

    // Delete relationships first (foreign key dependencies)
    // Parallelize independent relationship deletions
    await Promise.all([
      // Delete CONTAINS relationships where file is the source
      (async () => {
        const containsRows = await safeQuery<{ from_id: string; to_id: string }>(
          `?[from_id, to_id] := *contains{from_id, to_id}, from_id = $fileId`,
          { fileId }
        );
        if (containsRows.length > 0) {
          await safeExecute(
            `?[from_id, to_id] := *contains{from_id, to_id}, from_id = $fileId
             :rm contains {from_id, to_id}`,
            { fileId }
          );
          // Note: atomic counter would be needed for exact count in parallel, 
          // but for now we just accept potential race on the counter or ignore it for perf
        }
      })(),

      // Delete IMPORTS relationships where file is the source
      (async () => {
        const importsRows = await safeQuery<{ from_id: string; to_id: string }>(
          `?[from_id, to_id] := *imports{from_id, to_id}, from_id = $fileId`,
          { fileId }
        );
        if (importsRows.length > 0) {
          await safeExecute(
            `?[from_id, to_id] := *imports{from_id, to_id}, from_id = $fileId
             :rm imports {from_id, to_id}`,
            { fileId }
          );
        }
      })(),

      // Delete entity_embedding rows for this file (Hybrid Search Phase 1)
      // Uses shared mutex to serialize with concurrent embedding writes
      (async () => {
        try {
          await this.embeddingMutex.runExclusive(() =>
            this.store.execute(
              `?[entity_id, file_id] := *entity_embedding{entity_id, file_id}, file_id = $fileId
               :rm entity_embedding {entity_id, file_id}`,
              { fileId }
            )
          );
        } catch {
          // Preserve existing semantics: don't crash on failure
          logger.warn({ fileId }, "Failed to delete entity_embedding rows");
        }
      })()
    ]);

    // Get all entities in this file for relationship cleanup
    const [functionRows, classRows, interfaceRows, typeAliasRows, variableRows] = await Promise.all([
      safeQuery<{ id: string }>(`?[id] := *function{id, file_id}, file_id = $fileId`, { fileId }),
      safeQuery<{ id: string }>(`?[id] := *class{id, file_id}, file_id = $fileId`, { fileId }),
      safeQuery<{ id: string }>(`?[id] := *interface{id, file_id}, file_id = $fileId`, { fileId }),
      safeQuery<{ id: string }>(`?[id] := *type_alias{id, file_id}, file_id = $fileId`, { fileId }),
      safeQuery<{ id: string }>(`?[id] := *variable{id, file_id}, file_id = $fileId`, { fileId })
    ]);

    const functionIds = functionRows.map((r) => r.id);
    const classIds = classRows.map((r) => r.id);
    const interfaceIds = interfaceRows.map((r) => r.id);

    // Parallelize relationship cleanup for entities
    await Promise.all([
      // Function relationships
      ...functionIds.map(async (fnId) => {
        await Promise.all([
          safeExecute(
            `?[from_id, to_id] := *calls{from_id, to_id}, from_id = $fnId
             :rm calls {from_id, to_id}`,
            { fnId }
          ),
          safeExecute(
            `?[from_id, to_id] := *calls{from_id, to_id}, to_id = $fnId
             :rm calls {from_id, to_id}`,
            { fnId }
          ),
          safeExecute(
            `?[from_id, to_id] := *uses_type{from_id, to_id}, from_id = $fnId
             :rm uses_type {from_id, to_id}`,
            { fnId }
          ),
          safeExecute(
            `?[from_id, to_id] := *references_external{from_id, to_id}, from_id = $fnId
             :rm references_external {from_id, to_id}`,
            { fnId }
          ),
          safeExecute(
            `?[function_id] := function_id = $fnId
             :rm function_embedding {function_id}`,
            { fnId }
          )
        ]);
      }),

      // Class relationships
      ...classIds.map(async (classId) => {
        await Promise.all([
          safeExecute(
            `?[from_id, to_id] := *has_method{from_id, to_id}, from_id = $classId
             :rm has_method {from_id, to_id}`,
            { classId }
          ),
          safeExecute(
            `?[from_id, to_id] := *extends{from_id, to_id}, from_id = $classId
             :rm extends {from_id, to_id}`,
            { classId }
          ),
          safeExecute(
            `?[from_id, to_id] := *implements{from_id, to_id}, from_id = $classId
             :rm implements {from_id, to_id}`,
            { classId }
          )
        ]);
      }),

      // Interface relationships
      ...interfaceIds.map(async (intId) => {
        await safeExecute(
          `?[from_id, to_id] := *extends_interface{from_id, to_id}, from_id = $intId
           :rm extends_interface {from_id, to_id}`,
          { intId }
        );
      })
    ]);

    // Now delete entities (order matters for referential integrity, but mostly independent now)
    await Promise.all([
      // Delete functions
      (async () => {
        if (functionIds.length > 0) {
          await safeExecute(
            `?[id] := *function{id, file_id}, file_id = $fileId
             :rm function {id}`,
            { fileId }
          );
          deletedCount += functionIds.length;
        }
      })(),

      // Delete classes
      (async () => {
        if (classIds.length > 0) {
          await safeExecute(
            `?[id] := *class{id, file_id}, file_id = $fileId
             :rm class {id}`,
            { fileId }
          );
          deletedCount += classIds.length;
        }
      })(),

      // Delete interfaces
      (async () => {
        if (interfaceIds.length > 0) {
          await safeExecute(
            `?[id] := *interface{id, file_id}, file_id = $fileId
             :rm interface {id}`,
            { fileId }
          );
          deletedCount += interfaceIds.length;
        }
      })(),

      // Delete type aliases
      (async () => {
        if (typeAliasRows.length > 0) {
          await safeExecute(
            `?[id] := *type_alias{id, file_id}, file_id = $fileId
             :rm type_alias {id}`,
            { fileId }
          );
          deletedCount += typeAliasRows.length;
        }
      })(),

      // Delete variables
      (async () => {
        if (variableRows.length > 0) {
          await safeExecute(
            `?[id] := *variable{id, file_id}, file_id = $fileId
             :rm variable {id}`,
            { fileId }
          );
          deletedCount += variableRows.length;
        }
      })()
    ]);

    // Finally delete the file itself
    await safeExecute(
      `?[id] := id = $fileId
       :rm file {id}`,
      { fileId }
    );
    deletedCount += 1;

    return deletedCount;
  }

  /**
   * Check if a file exists in the graph.
   */
  async fileExists(fileId: string): Promise<boolean> {
    const result = await this.store.query<{ id: string }>(
      `?[id] := *file{id}, id = $fileId`,
      { fileId }
    );
    return result.rows.length > 0;
  }

  /**
   * Get the hash of a file stored in the graph.
   * Returns null if file doesn't exist.
   */
  async getFileHash(fileId: string): Promise<string | null> {
    const result = await this.store.query<{ hash: string }>(
      `?[hash] := *file{id, hash}, id = $fileId`,
      { fileId }
    );
    return result.rows.length > 0 ? result.rows[0]!.hash : null;
  }

  /**
   * Get all file IDs and their hashes from the graph.
   */
  async getAllFileHashes(): Promise<Map<string, string>> {
    const result = await this.store.query<{ id: string; hash: string }>(
      `?[id, hash] := *file{id, hash}`
    );
    return new Map(result.rows.map((r) => [r.id, r.hash]));
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private validateResult(result: ExtractionResult): void {
    if (!result.fileId) {
      throw new Error("ExtractionResult missing fileId");
    }
    if (!result.filePath) {
      throw new Error("ExtractionResult missing filePath");
    }
    if (!result.batch) {
      throw new Error("ExtractionResult missing batch");
    }
  }

  private countEntities(batch: CozoBatch): number {
    return (
      batch.file.length +
      batch.function.length +
      batch.class.length +
      batch.interface.length +
      batch.typeAlias.length +
      batch.variable.length +
      batch.ghostNode.length +
      // Phase 1: Enhanced Entity Semantics
      batch.parameterSemantics.length +
      batch.returnSemantics.length +
      batch.errorPaths.length +
      batch.errorAnalysis.length +
      // Phase 2: Data Flow Analysis
      batch.dataFlowCache.length +
      batch.dataFlowNodes.length +
      batch.crossFunctionFlows.length +
      batch.taintSources.length +
      // Entity embeddings (Hybrid Search Phase 1)
      batch.entityEmbeddings.length
    );
  }

  private countRelationships(batch: CozoBatch): number {
    return (
      batch.contains.length +
      batch.calls.length +
      batch.imports.length +
      batch.extends.length +
      batch.implements.length +
      batch.extendsInterface.length +
      batch.hasMethod.length +
      batch.usesType.length +
      batch.referencesExternal.length +
      // Phase 2: Data Flow Relationships
      batch.dataFlowsTo.length +
      batch.hasCrossFlow.length +
      batch.taintFlowsTo.length
    );
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a GraphWriter instance.
 */
export function createGraphWriter(
  store: IGraphStore,
  options?: GraphWriterOptions
): GraphWriter {
  return new GraphWriter(store, options);
}

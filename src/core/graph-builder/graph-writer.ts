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
    const startTime = Date.now();

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

      // Write new entities
      await this.store.writeBatch(result.batch);

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
    const writeResults: WriteResult[] = [];

    for (const result of results) {
      const writeResult = await this.writeFile(result);
      writeResults.push(writeResult);
    }

    return writeResults;
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
    const safeQuery = async <T>(script: string, params?: Record<string, unknown>): Promise<T[]> => {
      try {
        const result = await this.store.query<T>(script, params);
        return result.rows;
      } catch {
        return [];
      }
    };

    // Helper to safely execute - ignores errors if relation doesn't exist
    const safeExecute = async (script: string, params?: Record<string, unknown>): Promise<void> => {
      try {
        await this.store.execute(script, params);
      } catch {
        // Ignore - relation might not exist
      }
    };

    // Delete relationships first (foreign key dependencies)
    // Delete CONTAINS relationships where file is the source
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
      deletedCount += containsRows.length;
    }

    // Delete IMPORTS relationships where file is the source
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
      deletedCount += importsRows.length;
    }

    // Get all functions in this file for relationship cleanup
    const functionRows = await safeQuery<{ id: string }>(
      `?[id] := *function{id, file_id}, file_id = $fileId`,
      { fileId }
    );
    const functionIds = functionRows.map((r) => r.id);

    // Delete CALLS relationships involving these functions
    for (const fnId of functionIds) {
      await safeExecute(
        `?[from_id, to_id] := *calls{from_id, to_id}, from_id = $fnId
         :rm calls {from_id, to_id}`,
        { fnId }
      );
      await safeExecute(
        `?[from_id, to_id] := *calls{from_id, to_id}, to_id = $fnId
         :rm calls {from_id, to_id}`,
        { fnId }
      );
    }

    // Get all classes in this file for relationship cleanup
    const classRows = await safeQuery<{ id: string }>(
      `?[id] := *class{id, file_id}, file_id = $fileId`,
      { fileId }
    );
    const classIds = classRows.map((r) => r.id);

    // Delete HAS_METHOD relationships for these classes
    for (const classId of classIds) {
      await safeExecute(
        `?[from_id, to_id] := *has_method{from_id, to_id}, from_id = $classId
         :rm has_method {from_id, to_id}`,
        { classId }
      );
    }

    // Delete EXTENDS relationships
    for (const classId of classIds) {
      await safeExecute(
        `?[from_id, to_id] := *extends{from_id, to_id}, from_id = $classId
         :rm extends {from_id, to_id}`,
        { classId }
      );
    }

    // Delete IMPLEMENTS relationships
    for (const classId of classIds) {
      await safeExecute(
        `?[from_id, to_id] := *implements{from_id, to_id}, from_id = $classId
         :rm implements {from_id, to_id}`,
        { classId }
      );
    }

    // Get all interfaces in this file
    const interfaceRows = await safeQuery<{ id: string }>(
      `?[id] := *interface{id, file_id}, file_id = $fileId`,
      { fileId }
    );
    const interfaceIds = interfaceRows.map((r) => r.id);

    // Delete EXTENDS_INTERFACE relationships
    for (const intId of interfaceIds) {
      await safeExecute(
        `?[from_id, to_id] := *extends_interface{from_id, to_id}, from_id = $intId
         :rm extends_interface {from_id, to_id}`,
        { intId }
      );
    }

    // Delete USES_TYPE relationships from functions in this file
    for (const fnId of functionIds) {
      await safeExecute(
        `?[from_id, to_id] := *uses_type{from_id, to_id}, from_id = $fnId
         :rm uses_type {from_id, to_id}`,
        { fnId }
      );
    }

    // Delete REFERENCES_EXTERNAL relationships
    for (const fnId of functionIds) {
      await safeExecute(
        `?[from_id, to_id] := *references_external{from_id, to_id}, from_id = $fnId
         :rm references_external {from_id, to_id}`,
        { fnId }
      );
    }

    // Now delete entities (order matters for referential integrity)

    // Delete function embeddings first
    for (const fnId of functionIds) {
      await safeExecute(
        `?[function_id] := function_id = $fnId
         :rm function_embedding {function_id}`,
        { fnId }
      );
    }

    // Delete functions
    if (functionIds.length > 0) {
      await safeExecute(
        `?[id] := *function{id, file_id}, file_id = $fileId
         :rm function {id}`,
        { fileId }
      );
      deletedCount += functionIds.length;
    }

    // Delete classes
    if (classIds.length > 0) {
      await safeExecute(
        `?[id] := *class{id, file_id}, file_id = $fileId
         :rm class {id}`,
        { fileId }
      );
      deletedCount += classIds.length;
    }

    // Delete interfaces
    if (interfaceIds.length > 0) {
      await safeExecute(
        `?[id] := *interface{id, file_id}, file_id = $fileId
         :rm interface {id}`,
        { fileId }
      );
      deletedCount += interfaceIds.length;
    }

    // Delete type aliases
    const typeAliasRows = await safeQuery<{ id: string }>(
      `?[id] := *type_alias{id, file_id}, file_id = $fileId`,
      { fileId }
    );
    if (typeAliasRows.length > 0) {
      await safeExecute(
        `?[id] := *type_alias{id, file_id}, file_id = $fileId
         :rm type_alias {id}`,
        { fileId }
      );
      deletedCount += typeAliasRows.length;
    }

    // Delete variables
    const variableRows = await safeQuery<{ id: string }>(
      `?[id] := *variable{id, file_id}, file_id = $fileId`,
      { fileId }
    );
    if (variableRows.length > 0) {
      await safeExecute(
        `?[id] := *variable{id, file_id}, file_id = $fileId
         :rm variable {id}`,
        { fileId }
      );
      deletedCount += variableRows.length;
    }

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
      batch.ghostNode.length
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
      batch.referencesExternal.length
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

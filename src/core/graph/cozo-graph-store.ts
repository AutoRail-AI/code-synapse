/**
 * CozoDB Graph Store Adapter
 *
 * Implements the IGraphStore interface for CozoDB.
 * Provides transactional graph storage with vector similarity search.
 *
 * @module
 */

import type {
  IGraphStore,
  ITransaction,
  QueryResult,
  VectorSearchResult,
  GraphStoreConfig,
} from "../interfaces/IGraphStore.js";
import type { CozoBatch } from "../extraction/types.js";
import { GraphDatabase } from "./database.js";
import { MigrationRunner } from "./migration-runner.js";
import { migrations } from "./migrations/index.js";

// =============================================================================
// CozoTransaction Adapter
// =============================================================================

/**
 * Transaction adapter that implements ITransaction.
 *
 * Note: CozoDB's block-based transactions don't support parameterized queries
 * properly (params are lost when statements are joined). Therefore, this
 * transaction adapter executes statements immediately rather than accumulating
 * them. This means operations within a "transaction" are not truly atomic,
 * but CozoDB doesn't support multi-statement transactions with rollback anyway.
 */
class CozoTransaction implements ITransaction {
  constructor(private db: GraphDatabase) {}

  async writeBatch(batch: CozoBatch): Promise<void> {
    // Execute immediately - no tx accumulation due to param limitations
    await writeBatchToDb(this.db, batch);
  }

  async query<T = Record<string, unknown>>(
    script: string,
    params?: Record<string, unknown>
  ): Promise<QueryResult<T>> {
    // Execute immediately
    const rows = await this.db.query<T>(script, params);
    return {
      rows,
      stats: { rowsAffected: rows.length, executionTimeMs: 0 },
    };
  }

  async execute(script: string, params?: Record<string, unknown>): Promise<void> {
    // Execute immediately
    await this.db.execute(script, params);
  }
}

// =============================================================================
// CozoGraphStore Implementation
// =============================================================================

/**
 * CozoDB implementation of IGraphStore.
 *
 * @example
 * ```typescript
 * const store = new CozoGraphStore({ path: './data/graph.db' });
 * await store.initialize();
 *
 * // Write batch
 * await store.writeBatch(extractionResult.batch);
 *
 * // Query
 * const result = await store.query('?[name] := *function{name}');
 *
 * // Vector search
 * const similar = await store.vectorSearch(embedding, 10);
 *
 * await store.close();
 * ```
 */
export class CozoGraphStore implements IGraphStore {
  private db: GraphDatabase;
  private config: Required<GraphStoreConfig>;
  private initialized = false;

  constructor(config: GraphStoreConfig) {
    this.config = {
      path: config.path,
      engine: config.engine ?? "rocksdb",
      runMigrations: config.runMigrations ?? true,
    };

    this.db = new GraphDatabase({
      dbPath: this.config.path,
      engine: this.config.engine,
      createIfNotExists: true,
    });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.db.initialize();

    // Run migrations if enabled
    if (this.config.runMigrations) {
      const runner = new MigrationRunner(this.db);
      runner.registerMigrations(migrations);
      await runner.migrate();
    }

    this.initialized = true;
  }

  async close(): Promise<void> {
    if (!this.initialized) return;
    await this.db.close();
    this.initialized = false;
  }

  get isReady(): boolean {
    return this.initialized && this.db.isReady;
  }

  /**
   * Get the underlying database instance.
   * Used by storage adapter factory to create adapters.
   * @internal
   */
  get database(): GraphDatabase {
    return this.db;
  }

  // ===========================================================================
  // Write Operations
  // ===========================================================================

  async writeBatch(batch: CozoBatch): Promise<void> {
    this.ensureReady();
    await writeBatchToDb(this.db, batch);
  }

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  async query<T = Record<string, unknown>>(
    script: string,
    params?: Record<string, unknown>
  ): Promise<QueryResult<T>> {
    this.ensureReady();
    const rows = await this.db.query<T>(script, params);
    return {
      rows,
      stats: { rowsAffected: rows.length, executionTimeMs: 0 },
    };
  }

  async execute(script: string, params?: Record<string, unknown>): Promise<void> {
    this.ensureReady();
    await this.db.execute(script, params);
  }

  // ===========================================================================
  // Transaction Support
  // ===========================================================================

  async transaction<T>(fn: (tx: ITransaction) => Promise<T>): Promise<T> {
    this.ensureReady();
    // Note: CozoDB doesn't support true multi-statement transactions with params.
    // This provides a transaction-like API but operations execute immediately.
    const txAdapter = new CozoTransaction(this.db);
    return fn(txAdapter);
  }

  // ===========================================================================
  // Vector Search
  // ===========================================================================

  async vectorSearch(embedding: number[], k: number): Promise<VectorSearchResult[]> {
    this.ensureReady();
    try {
      // Join function_embedding with function to get function details
      const results = await this.db.query<{
        id: string;
        name: string;
        file_id: string;
        distance: number;
      }>(
        `?[id, name, file_id, distance] :=
          *function_embedding{function_id: id, embedding: emb},
          *function{id, name, file_id},
          distance = l2_dist(emb, $embedding)
         :order distance
         :limit $k`,
        { embedding, k }
      );

      return results.map((r) => ({
        id: r.id,
        distance: r.distance,
        name: r.name,
        fileId: r.file_id,
      }));
    } catch {
      // If no embeddings exist yet, return empty array
      return [];
    }
  }

  // ===========================================================================
  // Schema Methods
  // ===========================================================================

  async hasSchema(): Promise<boolean> {
    return this.db.hasSchema();
  }

  async getSchemaVersion(): Promise<number> {
    return this.db.getSchemaVersion();
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  private ensureReady(): void {
    if (!this.isReady) {
      throw new Error("GraphStore not initialized. Call initialize() first.");
    }
  }

  /**
   * Get the underlying database for advanced operations.
   * Use with caution - prefer interface methods.
   */
  getDatabase(): GraphDatabase {
    return this.db;
  }
}

// =============================================================================
// Batch Write Helper
// =============================================================================

/**
 * Writes a CozoBatch to the database.
 * Executes all operations immediately (no transaction batching).
 */
async function writeBatchToDb(
  db: GraphDatabase,
  batch: CozoBatch
): Promise<void> {
  // Write nodes
  if (batch.file.length > 0) {
    for (const row of batch.file) {
      await db.execute(
        `?[id, path, relative_path, extension, hash, size, last_modified, language, framework] <- [[
          $id, $path, $relativePath, $extension, $hash, $size, $lastModified, $language, $framework
        ]]
        :put file {id => path, relative_path, extension, hash, size, last_modified, language, framework}`,
        {
          id: row[0],
          path: row[1],
          relativePath: row[2],
          extension: row[3],
          hash: row[4],
          size: row[5],
          lastModified: row[6],
          language: row[7],
          framework: row[8],
        },
      );
    }
  }

  if (batch.function.length > 0) {
    for (const row of batch.function) {
      await db.execute(
        `?[id, name, file_id, start_line, end_line, start_column, end_column, signature, return_type,
          is_exported, is_async, is_generator, complexity, parameter_count, doc_comment, business_logic, inference_confidence] <- [[
          $id, $name, $fileId, $startLine, $endLine, $startColumn, $endColumn, $signature, $returnType,
          $isExported, $isAsync, $isGenerator, $complexity, $parameterCount, $docComment, $businessLogic, $inferenceConfidence
        ]]
        :put function {id => name, file_id, start_line, end_line, start_column, end_column, signature, return_type,
          is_exported, is_async, is_generator, complexity, parameter_count, doc_comment, business_logic, inference_confidence}`,
        {
          id: row[0],
          name: row[1],
          fileId: row[2],
          startLine: row[3],
          endLine: row[4],
          startColumn: row[5],
          endColumn: row[6],
          signature: row[7],
          returnType: row[8],
          isExported: row[9],
          isAsync: row[10],
          isGenerator: row[11],
          complexity: row[12],
          parameterCount: row[13],
          docComment: row[14],
          businessLogic: row[15],
          inferenceConfidence: row[16],
        },
      );
    }
  }

  if (batch.class.length > 0) {
    for (const row of batch.class) {
      await db.execute(
        `?[id, name, file_id, start_line, end_line, is_abstract, is_exported, extends_class, implements_interfaces, doc_comment] <- [[
          $id, $name, $fileId, $startLine, $endLine, $isAbstract, $isExported, $extendsClass, $implementsInterfaces, $docComment
        ]]
        :put class {id => name, file_id, start_line, end_line, is_abstract, is_exported, extends_class, implements_interfaces, doc_comment}`,
        {
          id: row[0],
          name: row[1],
          fileId: row[2],
          startLine: row[3],
          endLine: row[4],
          isAbstract: row[5],
          isExported: row[6],
          extendsClass: row[7],
          implementsInterfaces: row[8],
          docComment: row[9],
        },
      );
    }
  }

  if (batch.interface.length > 0) {
    for (const row of batch.interface) {
      await db.execute(
        `?[id, name, file_id, start_line, end_line, is_exported, extends_interfaces, doc_comment, properties] <- [[
          $id, $name, $fileId, $startLine, $endLine, $isExported, $extendsInterfaces, $docComment, $properties
        ]]
        :put interface {id => name, file_id, start_line, end_line, is_exported, extends_interfaces, doc_comment, properties}`,
        {
          id: row[0],
          name: row[1],
          fileId: row[2],
          startLine: row[3],
          endLine: row[4],
          isExported: row[5],
          extendsInterfaces: row[6],
          docComment: row[7],
          properties: row[8],
        },
      );
    }
  }

  if (batch.typeAlias.length > 0) {
    for (const row of batch.typeAlias) {
      await db.execute(
        `?[id, name, file_id, start_line, end_line, is_exported, type_definition, doc_comment] <- [[
          $id, $name, $fileId, $startLine, $endLine, $isExported, $typeDefinition, $docComment
        ]]
        :put type_alias {id => name, file_id, start_line, end_line, is_exported, type_definition, doc_comment}`,
        {
          id: row[0],
          name: row[1],
          fileId: row[2],
          startLine: row[3],
          endLine: row[4],
          isExported: row[5],
          typeDefinition: row[6],
          docComment: row[7],
        },
      );
    }
  }

  if (batch.variable.length > 0) {
    for (const row of batch.variable) {
      await db.execute(
        `?[id, name, file_id, line, column, variable_type, is_const, is_exported, scope] <- [[
          $id, $name, $fileId, $line, $column, $variableType, $isConst, $isExported, $scope
        ]]
        :put variable {id => name, file_id, line, column, variable_type, is_const, is_exported, scope}`,
        {
          id: row[0],
          name: row[1],
          fileId: row[2],
          line: row[3],
          column: row[4],
          variableType: row[5],
          isConst: row[6],
          isExported: row[7],
          scope: row[8],
        },
      );
    }
  }

  if (batch.ghostNode.length > 0) {
    for (const row of batch.ghostNode) {
      await db.execute(
        `?[id, name, package_name, entity_type, signature, is_external] <- [[
          $id, $name, $packageName, $entityType, $signature, $isExternal
        ]]
        :put ghost_node {id => name, package_name, entity_type, signature, is_external}`,
        {
          id: row[0],
          name: row[1],
          packageName: row[2],
          entityType: row[3],
          signature: row[4],
          isExternal: row[5],
        },
      );
    }
  }

  // Write relationships
  if (batch.contains.length > 0) {
    for (const row of batch.contains) {
      await db.execute(
        `?[from_id, to_id, line_number] <- [[$fromId, $toId, $lineNumber]]
        :put contains {from_id, to_id => line_number}`,
        { fromId: row[0], toId: row[1], lineNumber: row[2] },
      );
    }
  }

  if (batch.calls.length > 0) {
    for (const row of batch.calls) {
      await db.execute(
        `?[from_id, to_id, line_number, is_direct_call, is_await] <- [[$fromId, $toId, $lineNumber, $isDirectCall, $isAwait]]
        :put calls {from_id, to_id => line_number, is_direct_call, is_await}`,
        {
          fromId: row[0],
          toId: row[1],
          lineNumber: row[2],
          isDirectCall: row[3],
          isAwait: row[4],
        },
      );
    }
  }

  if (batch.imports.length > 0) {
    for (const row of batch.imports) {
      await db.execute(
        `?[from_id, to_id, imported_symbols, import_type, is_type_only] <- [[$fromId, $toId, $importedSymbols, $importType, $isTypeOnly]]
        :put imports {from_id, to_id => imported_symbols, import_type, is_type_only}`,
        {
          fromId: row[0],
          toId: row[1],
          importedSymbols: row[2],
          importType: row[3],
          isTypeOnly: row[4],
        },
      );
    }
  }

  if (batch.extends.length > 0) {
    for (const row of batch.extends) {
      await db.execute(
        `?[from_id, to_id] <- [[$fromId, $toId]]
        :put extends {from_id, to_id}`,
        { fromId: row[0], toId: row[1] },
      );
    }
  }

  if (batch.implements.length > 0) {
    for (const row of batch.implements) {
      await db.execute(
        `?[from_id, to_id] <- [[$fromId, $toId]]
        :put implements {from_id, to_id}`,
        { fromId: row[0], toId: row[1] },
      );
    }
  }

  if (batch.extendsInterface.length > 0) {
    for (const row of batch.extendsInterface) {
      await db.execute(
        `?[from_id, to_id] <- [[$fromId, $toId]]
        :put extends_interface {from_id, to_id}`,
        { fromId: row[0], toId: row[1] },
      );
    }
  }

  if (batch.hasMethod.length > 0) {
    for (const row of batch.hasMethod) {
      await db.execute(
        `?[from_id, to_id, visibility, is_static, is_abstract] <- [[$fromId, $toId, $visibility, $isStatic, $isAbstract]]
        :put has_method {from_id, to_id => visibility, is_static, is_abstract}`,
        {
          fromId: row[0],
          toId: row[1],
          visibility: row[2],
          isStatic: row[3],
          isAbstract: row[4],
        },
      );
    }
  }

  if (batch.usesType.length > 0) {
    for (const row of batch.usesType) {
      await db.execute(
        `?[from_id, to_id, context, parameter_name] <- [[$fromId, $toId, $context, $parameterName]]
        :put uses_type {from_id, to_id => context, parameter_name}`,
        {
          fromId: row[0],
          toId: row[1],
          context: row[2],
          parameterName: row[3],
        },
      );
    }
  }

  if (batch.referencesExternal.length > 0) {
    for (const row of batch.referencesExternal) {
      await db.execute(
        `?[from_id, to_id, context, line_number] <- [[$fromId, $toId, $context, $lineNumber]]
        :put references_external {from_id, to_id => context, line_number}`,
        {
          fromId: row[0],
          toId: row[1],
          context: row[2],
          lineNumber: row[3],
        },
      );
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a CozoGraphStore instance.
 *
 * @example
 * ```typescript
 * const store = await createGraphStore({ path: './data/graph.db' });
 * ```
 */
export async function createGraphStore(config: GraphStoreConfig): Promise<IGraphStore> {
  const store = new CozoGraphStore(config);
  await store.initialize();
  return store;
}

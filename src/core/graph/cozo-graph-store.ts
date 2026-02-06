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
  constructor(private db: GraphDatabase) { }

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

    // Check if schema exists by looking for a core table
    const hasSchema = await this.db.relationExists("file");

    if (!hasSchema) {
      // Create all tables directly (simpler than migrations for development)
      await this.createSchema();
    } else {
      // Ensure entity_embedding exists (Hybrid Search Phase 1 upgrade path)
      await this.ensureEntityEmbeddingSchema();
    }

    this.initialized = true;
  }

  /**
   * Creates all schema tables directly.
   * Used for fresh database initialization during development.
   */
  private async createSchema(): Promise<void> {
    const { migration: initialMigration } = await import("./migrations/001_initial_schema.js");
    const { SCHEMA_VERSION } = await import("./schema-definitions.js");

    // Create schema_version table first
    await this.db.execute(`
      :create schema_version {
        id: String
        =>
        version: Int,
        updated_at: Float
      }
    `);

    // Initialize version
    await this.db.execute(`
      ?[id, version, updated_at] <- [['version', ${SCHEMA_VERSION}, now()]]
      :put schema_version {id => version, updated_at}
    `);

    // Use the migration's up() function which creates all tables
    const tx = { id: "init", active: false, _statements: [] as string[] };
    await initialMigration.up(this.db, tx);

    // Create vector indices
    try {
      await this.db.execute(`
        ::hnsw create function_embedding:embedding_hnsw {
          embedding
        }
      `);
    } catch (e) {
      // Ignore if already exists
    }

    // Entity embeddings for semantic search (Hybrid Search Phase 1)
    await this.ensureEntityEmbeddingSchema();
  }

  /**
   * Ensures entity_embedding relation and HNSW index exist.
   * Used for both fresh DBs (from createSchema) and existing DBs (upgrade path).
   */
  private async ensureEntityEmbeddingSchema(): Promise<void> {
    const exists = await this.db.relationExists("entity_embedding");
    if (exists) return;

    // entity_id + file_id as key for O(1) cleanup by file on re-index
    await this.db.execute(`
      :create entity_embedding {
        entity_id: String,
        file_id: String
        =>
        vector: <F32; 384>,
        text_hash: String,
        model: String,
        created_at: Int
      }
    `);

    try {
      await this.db.execute(`
        ::hnsw create entity_embedding:embedding_idx {
          dim: 384,
          m: 16,
          ef_construction: 200,
          fields: [vector]
        }
      `);
    } catch (e) {
      // Ignore if index already exists
    }
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
      // Prefer entity_embedding (Hybrid Search Phase 1) when populated; fallback to function_embedding
      const entityResults = await this.db.query<{
        entity_id: string;
        file_id: string;
        distance: number;
      }>(
        `?[entity_id, file_id, distance] :=
          ~entity_embedding:embedding_idx{entity_id, file_id, vector | query: $embedding, k: $k, ef: 100, bind_distance: distance}
         :order distance
         :limit $k`,
        { embedding, k }
      );

      if (entityResults.length > 0) {
        return entityResults.map((r) => ({
          id: r.entity_id,
          distance: r.distance,
          fileId: r.file_id,
        }));
      }

      // Fallback: function_embedding for backward compatibility
      const fnResults = await this.db.query<{
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

      return fnResults.map((r) => ({
        id: r.id,
        distance: r.distance,
        name: r.name,
        fileId: r.file_id,
      }));
    } catch {
      // If no embeddings or index exist yet, return empty array
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

  // =========================================================================
  // Phase 1: Enhanced Entity Semantics
  // =========================================================================

  if (batch.parameterSemantics.length > 0) {
    for (const row of batch.parameterSemantics) {
      await db.execute(
        `?[id, function_id, param_name, param_index, param_type, purpose, is_optional, is_rest,
          is_destructured, default_value, validation_rules, used_in_expressions, is_mutated,
          accessed_at_lines, confidence, analyzed_at] <- [[
          $id, $functionId, $paramName, $paramIndex, $paramType, $purpose, $isOptional, $isRest,
          $isDestructured, $defaultValue, $validationRules, $usedInExpressions, $isMutated,
          $accessedAtLines, $confidence, $analyzedAt
        ]]
        :put function_parameter_semantics {id => function_id, param_name, param_index, param_type, purpose,
          is_optional, is_rest, is_destructured, default_value, validation_rules, used_in_expressions,
          is_mutated, accessed_at_lines, confidence, analyzed_at}`,
        {
          id: row[0],
          functionId: row[1],
          paramName: row[2],
          paramIndex: row[3],
          paramType: row[4],
          purpose: row[5],
          isOptional: row[6],
          isRest: row[7],
          isDestructured: row[8],
          defaultValue: row[9],
          validationRules: row[10],
          usedInExpressions: row[11],
          isMutated: row[12],
          accessedAtLines: row[13],
          confidence: row[14],
          analyzedAt: row[15],
        },
      );
    }
  }

  if (batch.returnSemantics.length > 0) {
    for (const row of batch.returnSemantics) {
      await db.execute(
        `?[id, function_id, declared_type, inferred_type, return_points, possible_values,
          null_conditions, error_conditions, derived_from, transformations, can_return_void,
          always_throws, confidence, analyzed_at] <- [[
          $id, $functionId, $declaredType, $inferredType, $returnPoints, $possibleValues,
          $nullConditions, $errorConditions, $derivedFrom, $transformations, $canReturnVoid,
          $alwaysThrows, $confidence, $analyzedAt
        ]]
        :put function_return_semantics {id => function_id, declared_type, inferred_type, return_points,
          possible_values, null_conditions, error_conditions, derived_from, transformations,
          can_return_void, always_throws, confidence, analyzed_at}`,
        {
          id: row[0],
          functionId: row[1],
          declaredType: row[2],
          inferredType: row[3],
          returnPoints: row[4],
          possibleValues: row[5],
          nullConditions: row[6],
          errorConditions: row[7],
          derivedFrom: row[8],
          transformations: row[9],
          canReturnVoid: row[10],
          alwaysThrows: row[11],
          confidence: row[12],
          analyzedAt: row[13],
        },
      );
    }
  }

  if (batch.errorPaths.length > 0) {
    for (const row of batch.errorPaths) {
      await db.execute(
        `?[id, function_id, error_type, condition, is_handled, handling_strategy, recovery_action,
          propagates_to, source_location, stack_context, confidence, analyzed_at] <- [[
          $id, $functionId, $errorType, $condition, $isHandled, $handlingStrategy, $recoveryAction,
          $propagatesTo, $sourceLocation, $stackContext, $confidence, $analyzedAt
        ]]
        :put error_path {id => function_id, error_type, condition, is_handled, handling_strategy,
          recovery_action, propagates_to, source_location, stack_context, confidence, analyzed_at}`,
        {
          id: row[0],
          functionId: row[1],
          errorType: row[2],
          condition: row[3],
          isHandled: row[4],
          handlingStrategy: row[5],
          recoveryAction: row[6],
          propagatesTo: row[7],
          sourceLocation: row[8],
          stackContext: row[9],
          confidence: row[10],
          analyzedAt: row[11],
        },
      );
    }
  }

  if (batch.errorAnalysis.length > 0) {
    for (const row of batch.errorAnalysis) {
      await db.execute(
        `?[id, function_id, throw_points, try_catch_blocks, never_throws, has_top_level_catch,
          escaping_error_types, confidence, analyzed_at] <- [[
          $id, $functionId, $throwPoints, $tryCatchBlocks, $neverThrows, $hasTopLevelCatch,
          $escapingErrorTypes, $confidence, $analyzedAt
        ]]
        :put function_error_analysis {id => function_id, throw_points, try_catch_blocks, never_throws,
          has_top_level_catch, escaping_error_types, confidence, analyzed_at}`,
        {
          id: row[0],
          functionId: row[1],
          throwPoints: row[2],
          tryCatchBlocks: row[3],
          neverThrows: row[4],
          hasTopLevelCatch: row[5],
          escapingErrorTypes: row[6],
          confidence: row[7],
          analyzedAt: row[8],
        },
      );
    }
  }

  // =========================================================================
  // Phase 2: Data Flow Analysis
  // =========================================================================

  if (batch.dataFlowCache.length > 0) {
    for (const row of batch.dataFlowCache) {
      await db.execute(
        `?[id, function_id, file_id, file_hash, node_count, edge_count, has_side_effects,
          accesses_external_state, is_pure, inputs_affecting_output, flow_summary_json,
          full_graph_json, taint_flows_json, confidence, computed_at, access_count, last_accessed_at] <- [[
          $id, $functionId, $fileId, $fileHash, $nodeCount, $edgeCount, $hasSideEffects,
          $accessesExternalState, $isPure, $inputsAffectingOutput, $flowSummaryJson,
          $fullGraphJson, $taintFlowsJson, $confidence, $computedAt, $accessCount, $lastAccessedAt
        ]]
        :put data_flow_cache {id => function_id, file_id, file_hash, node_count, edge_count,
          has_side_effects, accesses_external_state, is_pure, inputs_affecting_output,
          flow_summary_json, full_graph_json, taint_flows_json, confidence, computed_at,
          access_count, last_accessed_at}`,
        {
          id: row[0],
          functionId: row[1],
          fileId: row[2],
          fileHash: row[3],
          nodeCount: row[4],
          edgeCount: row[5],
          hasSideEffects: row[6],
          accessesExternalState: row[7],
          isPure: row[8],
          inputsAffectingOutput: row[9],
          flowSummaryJson: row[10],
          fullGraphJson: row[11],
          taintFlowsJson: row[12],
          confidence: row[13],
          computedAt: row[14],
          accessCount: row[15],
          lastAccessedAt: row[16],
        },
      );
    }
  }

  if (batch.dataFlowNodes.length > 0) {
    for (const row of batch.dataFlowNodes) {
      await db.execute(
        `?[id, function_id, kind, name, line, column, inferred_type, is_tainted, taint_source] <- [[
          $id, $functionId, $kind, $name, $line, $column, $inferredType, $isTainted, $taintSource
        ]]
        :put data_flow_node {id => function_id, kind, name, line, column, inferred_type, is_tainted, taint_source}`,
        {
          id: row[0],
          functionId: row[1],
          kind: row[2],
          name: row[3],
          line: row[4],
          column: row[5],
          inferredType: row[6],
          isTainted: row[7],
          taintSource: row[8],
        },
      );
    }
  }

  if (batch.crossFunctionFlows.length > 0) {
    for (const row of batch.crossFunctionFlows) {
      await db.execute(
        `?[id, caller_id, callee_id, call_site_line, arguments_json, return_usage_json,
          propagates_taint, tainted_arguments, confidence, analyzed_at] <- [[
          $id, $callerId, $calleeId, $callSiteLine, $argumentsJson, $returnUsageJson,
          $propagatesTaint, $taintedArguments, $confidence, $analyzedAt
        ]]
        :put cross_function_flow {id => caller_id, callee_id, call_site_line, arguments_json,
          return_usage_json, propagates_taint, tainted_arguments, confidence, analyzed_at}`,
        {
          id: row[0],
          callerId: row[1],
          calleeId: row[2],
          callSiteLine: row[3],
          argumentsJson: row[4],
          returnUsageJson: row[5],
          propagatesTaint: row[6],
          taintedArguments: row[7],
          confidence: row[8],
          analyzedAt: row[9],
        },
      );
    }
  }

  if (batch.taintSources.length > 0) {
    for (const row of batch.taintSources) {
      await db.execute(
        `?[id, function_id, source_category, node_id, description, line, is_sanitized,
          sanitization_point, discovered_at] <- [[
          $id, $functionId, $sourceCategory, $nodeId, $description, $line, $isSanitized,
          $sanitizationPoint, $discoveredAt
        ]]
        :put taint_source {id => function_id, source_category, node_id, description, line,
          is_sanitized, sanitization_point, discovered_at}`,
        {
          id: row[0],
          functionId: row[1],
          sourceCategory: row[2],
          nodeId: row[3],
          description: row[4],
          line: row[5],
          isSanitized: row[6],
          sanitizationPoint: row[7],
          discoveredAt: row[8],
        },
      );
    }
  }

  // =========================================================================
  // Phase 2: Data Flow Relationships
  // =========================================================================

  if (batch.dataFlowsTo.length > 0) {
    for (const row of batch.dataFlowsTo) {
      await db.execute(
        `?[from_id, to_id, edge_kind, transformation, condition, line_number, propagates_taint] <- [[
          $fromId, $toId, $edgeKind, $transformation, $condition, $lineNumber, $propagatesTaint
        ]]
        :put data_flows_to {from_id, to_id => edge_kind, transformation, condition, line_number, propagates_taint}`,
        {
          fromId: row[0],
          toId: row[1],
          edgeKind: row[2],
          transformation: row[3],
          condition: row[4],
          lineNumber: row[5],
          propagatesTaint: row[6],
        },
      );
    }
  }

  if (batch.hasCrossFlow.length > 0) {
    for (const row of batch.hasCrossFlow) {
      await db.execute(
        `?[from_id, to_id, role] <- [[$fromId, $toId, $role]]
        :put has_cross_flow {from_id, to_id => role}`,
        {
          fromId: row[0],
          toId: row[1],
          role: row[2],
        },
      );
    }
  }

  if (batch.taintFlowsTo.length > 0) {
    for (const row of batch.taintFlowsTo) {
      await db.execute(
        `?[from_id, to_id, path_length, is_sanitized] <- [[$fromId, $toId, $pathLength, $isSanitized]]
        :put taint_flows_to {from_id, to_id => path_length, is_sanitized}`,
        {
          fromId: row[0],
          toId: row[1],
          pathLength: row[2],
          isSanitized: row[3],
        },
      );
    }
  }

  // =========================================================================
  // Phase 3: Side-Effect Analysis
  // =========================================================================

  if (batch.sideEffects.length > 0) {
    for (const row of batch.sideEffects) {
      await db.execute(
        `?[id, function_id, file_path, category, description, target, api_call,
          is_conditional, condition, confidence, evidence_json, source_line,
          source_column, analyzed_at] <- [[
          $id, $functionId, $filePath, $category, $description, $target, $apiCall,
          $isConditional, $condition, $confidence, $evidenceJson, $sourceLine,
          $sourceColumn, $analyzedAt
        ]]
        :put side_effect {id => function_id, file_path, category, description, target,
          api_call, is_conditional, condition, confidence, evidence_json, source_line,
          source_column, analyzed_at}`,
        {
          id: row[0],
          functionId: row[1],
          filePath: row[2],
          category: row[3],
          description: row[4],
          target: row[5],
          apiCall: row[6],
          isConditional: row[7],
          condition: row[8],
          confidence: row[9],
          evidenceJson: row[10],
          sourceLine: row[11],
          sourceColumn: row[12],
          analyzedAt: row[13],
        },
      );
    }
  }

  if (batch.sideEffectSummaries.length > 0) {
    for (const row of batch.sideEffectSummaries) {
      await db.execute(
        `?[function_id, file_path, total_count, is_pure, all_conditional,
          primary_categories_json, risk_level, confidence, analyzed_at] <- [[
          $functionId, $filePath, $totalCount, $isPure, $allConditional,
          $primaryCategoriesJson, $riskLevel, $confidence, $analyzedAt
        ]]
        :put function_side_effect_summary {function_id => file_path, total_count, is_pure,
          all_conditional, primary_categories_json, risk_level, confidence, analyzed_at}`,
        {
          functionId: row[0],
          filePath: row[1],
          totalCount: row[2],
          isPure: row[3],
          allConditional: row[4],
          primaryCategoriesJson: row[5],
          riskLevel: row[6],
          confidence: row[7],
          analyzedAt: row[8],
        },
      );
    }
  }

  if (batch.hasSideEffect.length > 0) {
    for (const row of batch.hasSideEffect) {
      await db.execute(
        `?[from_id, to_id] <- [[$fromId, $toId]]
        :put has_side_effect {from_id, to_id}`,
        {
          fromId: row[0],
          toId: row[1],
        },
      );
    }
  }

  if (batch.hasSideEffectSummary.length > 0) {
    for (const row of batch.hasSideEffectSummary) {
      await db.execute(
        `?[from_id, to_id] <- [[$fromId, $toId]]
        :put has_side_effect_summary {from_id, to_id}`,
        {
          fromId: row[0],
          toId: row[1],
        },
      );
    }
  }

  // =========================================================================
  // Entity embeddings (Hybrid Search Phase 1)
  // =========================================================================

  if (batch.entityEmbeddings.length > 0) {
    for (const row of batch.entityEmbeddings) {
      const [entityId, fileId, vector, textHash, model, createdAt] = row;
      await db.execute(
        `?[entity_id, file_id, vector, text_hash, model, created_at] <- [[$entityId, $fileId, $vector, $textHash, $model, $createdAt]]
        :put entity_embedding {entity_id, file_id => vector, text_hash, model, created_at}`,
        {
          entityId,
          fileId,
          vector,
          textHash,
          model,
          createdAt,
        }
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

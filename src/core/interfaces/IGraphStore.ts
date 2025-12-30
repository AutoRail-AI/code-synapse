/**
 * IGraphStore - Abstract graph database interface
 *
 * Provides transactional graph storage with support for:
 * - Atomic batch writes
 * - Query execution
 * - Vector similarity search (via CozoDB HNSW)
 *
 * @module
 */

import type { CozoBatch, ExtractionResult } from "../extraction/types.js";

/**
 * Query result from the graph store.
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Result rows */
  rows: T[];
  /** Query execution statistics */
  stats: {
    rowsAffected: number;
    executionTimeMs: number;
  };
}

/**
 * Vector search result.
 */
export interface VectorSearchResult {
  /** Entity ID */
  id: string;
  /** Distance from query vector (lower is more similar) */
  distance: number;
  /** Entity name (if available) */
  name?: string;
  /** File ID (if applicable) */
  fileId?: string;
}

/**
 * Transaction interface for atomic operations.
 */
export interface ITransaction {
  /**
   * Write a batch of entities within this transaction
   */
  writeBatch(batch: CozoBatch): Promise<void>;

  /**
   * Execute a query within this transaction
   */
  query<T = Record<string, unknown>>(
    script: string,
    params?: Record<string, unknown>
  ): Promise<QueryResult<T>>;

  /**
   * Execute a statement within this transaction
   */
  execute(script: string, params?: Record<string, unknown>): Promise<void>;
}

/**
 * Graph store interface - abstracts over CozoDB implementation.
 *
 * @example
 * ```typescript
 * const store = await createGraphStore({ path: './data/graph.db' });
 *
 * // Write entities
 * await store.writeBatch(extractionResult.batch);
 *
 * // Query
 * const result = await store.query('?[name] := *function{name}');
 *
 * // Transaction
 * await store.transaction(async (tx) => {
 *   await tx.writeBatch(batch1);
 *   await tx.writeBatch(batch2);
 * });
 *
 * // Vector search
 * const similar = await store.vectorSearch(embedding, 10);
 *
 * await store.close();
 * ```
 */
export interface IGraphStore {
  /**
   * Initialize the graph store (run migrations, etc)
   */
  initialize(): Promise<void>;

  /**
   * Write a batch of entities atomically
   */
  writeBatch(batch: CozoBatch): Promise<void>;

  /**
   * Execute a query against the graph
   * @param script - CozoScript/Datalog query
   * @param params - Query parameters
   */
  query<T = Record<string, unknown>>(
    script: string,
    params?: Record<string, unknown>
  ): Promise<QueryResult<T>>;

  /**
   * Execute a statement that doesn't return results
   */
  execute(script: string, params?: Record<string, unknown>): Promise<void>;

  /**
   * Execute a function within a transaction
   * Automatically commits on success, rolls back on error
   */
  transaction<T>(fn: (tx: ITransaction) => Promise<T>): Promise<T>;

  /**
   * Vector similarity search on function embeddings
   * @param embedding - Query vector
   * @param k - Number of results
   */
  vectorSearch(embedding: number[], k: number): Promise<VectorSearchResult[]>;

  /**
   * Check if schema has been initialized
   */
  hasSchema(): Promise<boolean>;

  /**
   * Get current schema version
   */
  getSchemaVersion(): Promise<number>;

  /**
   * Close database connection
   */
  close(): Promise<void>;

  /**
   * Whether the store is initialized and ready
   */
  readonly isReady: boolean;
}

/**
 * Configuration for creating a graph store.
 */
export interface GraphStoreConfig {
  /** Path to the database directory */
  path: string;
  /** Storage engine: 'rocksdb' | 'sqlite' | 'mem' */
  engine?: "rocksdb" | "sqlite" | "mem";
  /** Whether to run migrations on initialization */
  runMigrations?: boolean;
}

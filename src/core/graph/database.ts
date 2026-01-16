/**
 * Graph Database Wrapper
 *
 * Provides a high-level interface to CozoDB for storing and querying
 * the code knowledge graph. Handles connection management, transactions,
 * and query execution.
 *
 * @module
 */

import { CozoDb } from "cozo-node";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AsyncDisposable } from "../../utils/disposable.js";
import type { Result } from "../../types/result.js";
import { ok, err } from "../../types/result.js";
import { ensureDatabaseAccessible } from "../../utils/lock-manager.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("graph-database");

// =============================================================================
// Types
// =============================================================================

/**
 * Query parameters for parameterized CozoScript queries
 */
export type QueryParams = Record<string, unknown>;

/**
 * CozoDB query result structure
 */
export interface CozoResult {
  headers: string[];
  rows: unknown[][];
}

/**
 * Transaction handle for atomic operations.
 * In CozoDB, transactions are handled via block syntax in scripts.
 * This interface maintains API compatibility.
 */
export interface Transaction {
  /** Unique transaction identifier */
  id: string;
  /** Whether the transaction is still active */
  active: boolean;
  /** Accumulated statements for batch execution */
  _statements: string[];
}

/**
 * Database configuration options
 */
export interface DatabaseConfig {
  /** Path to the database directory */
  dbPath: string;
  /** Whether to create the database if it doesn't exist */
  createIfNotExists?: boolean;
  /** Storage engine: 'rocksdb' | 'sqlite' | 'mem' */
  engine?: "rocksdb" | "sqlite" | "mem";
}

/**
 * Query result metadata
 */
export interface QueryMetadata {
  /** Number of rows returned */
  rowCount: number;
  /** Query execution time in milliseconds */
  executionTimeMs: number;
  /** Columns in the result */
  columns: string[];
}

// =============================================================================
// Database Implementation
// =============================================================================

/**
 * CozoDB graph database wrapper.
 *
 * Provides connection management, transaction support, and query execution
 * for the code knowledge graph.
 *
 * @example
 * ```typescript
 * const db = new GraphDatabase({ dbPath: '.code-synapse/data/cozodb' });
 * await db.initialize();
 *
 * // Simple query
 * const files = await db.query<{ id: string; path: string }>('?[id, path] := *file{id, path}');
 *
 * // Transaction (using block syntax)
 * await db.withTransaction(async (tx) => {
 *   await db.execute("?[id, path] <- [[$id, $path]]; :put file {id, path}", { id: 'file:1', path: '/test.ts' }, tx);
 * });
 *
 * await db.close();
 * ```
 */
export class GraphDatabase implements AsyncDisposable {
  private config: Required<DatabaseConfig>;
  private database: CozoDb | null = null;
  private initialized = false;
  private transactionCounter = 0;
  private activeTransactions = new Map<string, Transaction>();

  constructor(config: DatabaseConfig) {
    this.config = {
      dbPath: config.dbPath,
      createIfNotExists: config.createIfNotExists ?? true,
      engine: config.engine ?? "rocksdb",
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Initializes the database connection.
   * Creates the database directory if it doesn't exist.
   * Automatically cleans up stale lock files from crashed processes.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure directory exists for persistent storage
    if (this.config.createIfNotExists && this.config.engine !== "mem") {
      const dir = path.dirname(this.config.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Check for stale locks (RocksDB only)
    if (this.config.engine === "rocksdb") {
      const isAccessible = ensureDatabaseAccessible(this.config.dbPath);
      if (!isAccessible) {
        throw new Error(
          `Database is locked by another running process. ` +
          `If you believe this is incorrect, check for zombie processes or manually remove: ` +
          `${path.join(this.config.dbPath, "data", "LOCK")}`
        );
      }
      logger.debug({ dbPath: this.config.dbPath }, "Database lock check passed");
    }

    // Create CozoDB instance
    // CozoDb(engine, path, options)
    // engine: 'mem' | 'sqlite' | 'rocksdb'
    this.database = new CozoDb(this.config.engine, this.config.dbPath);

    this.initialized = true;
    logger.info({ dbPath: this.config.dbPath, engine: this.config.engine }, "Database initialized");
  }

  /**
   * Closes the database connection and releases resources.
   */
  async close(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    logger.debug({ dbPath: this.config.dbPath }, "Closing database connection");

    // Clear any active transactions
    this.activeTransactions.clear();

    // Close database
    if (this.database) {
      this.database.close();
      this.database = null;
    }

    this.initialized = false;
    logger.info({ dbPath: this.config.dbPath }, "Database closed - lock released");
  }

  /**
   * Implements AsyncDisposable for use with `await using`.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /**
   * Whether the database is initialized and ready.
   */
  get isReady(): boolean {
    return this.initialized && this.database !== null;
  }

  // ===========================================================================
  // Query Execution
  // ===========================================================================

  /**
   * Executes a CozoScript query and returns the results.
   *
   * @param script - CozoScript query string
   * @param params - Optional query parameters
   * @param tx - Optional active transaction to accumulate statements
   * @returns Array of result rows
   */
  async query<T = Record<string, unknown>>(
    script: string,
    params?: QueryParams,
    tx?: Transaction
  ): Promise<T[]> {
    this.ensureReady();

    // If in an active transaction, accumulate statements for batch execution
    if (tx && tx.active) {
      tx._statements.push(script);
      return [];
    }

    const result = await this.database!.run(script, params ?? {});
    return this.convertResult<T>(result);
  }

  /**
   * Executes a CozoScript query and returns a Result type.
   * Use this for operations where you want to handle errors without exceptions.
   */
  async queryResult<T = Record<string, unknown>>(
    script: string,
    params?: QueryParams,
    tx?: Transaction
  ): Promise<Result<T[], Error>> {
    try {
      const rows = await this.query<T>(script, params, tx);
      return ok(rows);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Executes a CozoScript statement that doesn't return results (:create, :put, :rm, etc.).
   *
   * @param script - CozoScript statement
   * @param params - Optional query parameters
   * @param tx - Optional active transaction to accumulate statements
   */
  async execute(
    script: string,
    params?: QueryParams,
    tx?: Transaction
  ): Promise<void> {
    this.ensureReady();

    // If in an active transaction, accumulate statements for batch execution
    if (tx && tx.active) {
      tx._statements.push(script);
      return;
    }

    await this.database!.run(script, params ?? {});
  }

  /**
   * Executes multiple CozoScript statements in sequence.
   *
   * @param statements - Array of CozoScript statements
   * @param tx - Optional transaction to execute within
   */
  async executeMany(statements: string[], tx?: Transaction): Promise<void> {
    for (const statement of statements) {
      if (statement.trim()) {
        await this.execute(statement, undefined, tx);
      }
    }
  }

  /**
   * Execute raw CozoScript and return the raw result.
   * Useful for debugging or advanced queries.
   */
  async runRaw(script: string, params?: QueryParams): Promise<CozoResult> {
    this.ensureReady();
    return await this.database!.run(script, params ?? {});
  }

  // ===========================================================================
  // Transaction Management
  // ===========================================================================

  /**
   * Begins a new transaction.
   * CozoDB transactions are handled via atomic block execution.
   *
   * @returns Transaction handle
   */
  async beginTransaction(): Promise<Transaction> {
    this.ensureReady();

    const id = `tx_${++this.transactionCounter}_${Date.now()}`;

    const tx: Transaction = {
      id,
      active: true,
      _statements: [],
    };

    this.activeTransactions.set(id, tx);

    return tx;
  }

  /**
   * Commits a transaction by executing all accumulated statements atomically.
   *
   * @param tx - Transaction to commit
   */
  async commit(tx: Transaction): Promise<void> {
    if (!tx.active) {
      throw new Error("Transaction is no longer active");
    }

    // Execute all accumulated statements as a single atomic block
    if (tx._statements.length > 0) {
      const blockScript = `{ ${tx._statements.join("\n")} }`;
      await this.database!.run(blockScript);
    }

    tx.active = false;
    this.activeTransactions.delete(tx.id);
  }

  /**
   * Rolls back a transaction by discarding accumulated statements.
   *
   * @param tx - Transaction to rollback
   */
  async rollback(tx: Transaction): Promise<void> {
    if (!tx.active) {
      return; // Already rolled back or committed
    }

    // Simply discard the accumulated statements
    tx._statements = [];
    tx.active = false;
    this.activeTransactions.delete(tx.id);
  }

  /**
   * Executes a function within a transaction, automatically committing
   * on success or rolling back on error.
   *
   * @param fn - Function to execute within the transaction
   * @returns Result of the function
   */
  async withTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx = await this.beginTransaction();
    try {
      const result = await fn(tx);
      await this.commit(tx);
      return result;
    } catch (error) {
      await this.rollback(tx);
      throw error;
    }
  }

  // ===========================================================================
  // Schema Management
  // ===========================================================================

  /**
   * Checks if the database has any schema (relations).
   */
  async hasSchema(): Promise<boolean> {
    try {
      const result = await this.runRaw("::relations");
      return result.rows.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Gets the current schema version from the database.
   * Note: Table named 'schema_version' (not '_schema_version') because
   * CozoDB treats underscore-prefixed relations as system/hidden.
   */
  async getSchemaVersion(): Promise<number> {
    try {
      // First check if the relation exists
      const exists = await this.relationExists("schema_version");
      if (!exists) {
        return 0;
      }

      const result = await this.query<{ version: number }>(
        "?[version] := *schema_version{id: 'version', version}"
      );
      return result[0]?.version ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Sets the schema version in the database.
   */
  async setSchemaVersion(version: number, tx?: Transaction): Promise<void> {
    const script = `
      ?[id, version, updated_at] <- [['version', $version, now()]]
      :put schema_version {id => version, updated_at}
    `;
    await this.execute(script, { version }, tx);
  }

  /**
   * Lists all relations in the database.
   */
  async listRelations(): Promise<string[]> {
    const result = await this.runRaw("::relations");
    // First column is the relation name
    return result.rows.map((row) => row[0] as string);
  }

  /**
   * Checks if a relation exists.
   */
  async relationExists(name: string): Promise<boolean> {
    const relations = await this.listRelations();
    return relations.includes(name);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Ensures the database is ready for operations.
   */
  private ensureReady(): void {
    if (!this.isReady) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
  }

  /**
   * Converts a CozoDB result to an array of typed objects.
   */
  private convertResult<T>(result: CozoResult): T[] {
    const { headers, rows } = result;

    return rows.map((row) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj as T;
    });
  }

  /**
   * Gets database statistics.
   */
  async getStats(): Promise<{
    relationCount: number;
    schemaVersion: number;
  }> {
    const [relations, version] = await Promise.all([
      this.listRelations().catch(() => []),
      this.getSchemaVersion(),
    ]);

    return {
      relationCount: relations.length,
      schemaVersion: version,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new GraphDatabase instance.
 */
export function createGraphDatabase(config: DatabaseConfig): GraphDatabase {
  return new GraphDatabase(config);
}

// =============================================================================
// Backwards Compatibility (deprecated)
// =============================================================================

/**
 * @deprecated Use GraphDatabase instead
 */
export class GraphStore extends GraphDatabase {
  constructor(dbPath: string) {
    super({ dbPath });
  }

  async addNode(_node: {
    id: string;
    type: string;
    properties: Record<string, unknown>;
  }): Promise<void> {
    throw new Error("Not implemented - use GraphOperations instead");
  }

  async addEdge(_edge: {
    source: string;
    target: string;
    type: string;
    properties: Record<string, unknown>;
  }): Promise<void> {
    throw new Error("Not implemented - use GraphOperations instead");
  }

  async findReferences(_symbolId: string): Promise<unknown[]> {
    throw new Error("Not implemented - use GraphOperations instead");
  }

  async findDependencies(_fileId: string): Promise<unknown[]> {
    throw new Error("Not implemented - use GraphOperations instead");
  }
}

/**
 * @deprecated Use createGraphDatabase instead
 */
export function createGraphStore(dbPath: string): GraphStore {
  return new GraphStore(dbPath);
}

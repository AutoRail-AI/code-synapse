/**
 * Generic Storage Adapter Interface
 *
 * Provides database-agnostic CRUD operations for storage classes.
 * This is the ONLY interface storage classes should depend on.
 *
 * Implementations (CozoStorageAdapter, PostgresAdapter, etc.) handle
 * database-specific query generation internally.
 *
 * @module
 */

// =============================================================================
// Query Types
// =============================================================================

/**
 * Comparison operators for query conditions
 */
export type ComparisonOperator =
  | "eq"      // Equal
  | "ne"      // Not equal
  | "gt"      // Greater than
  | "gte"     // Greater than or equal
  | "lt"      // Less than
  | "lte"     // Less than or equal
  | "in"      // Value in array
  | "nin"     // Value not in array
  | "like"    // SQL LIKE pattern
  | "contains" // Array contains value
  | "isNull"  // Is null
  | "isNotNull"; // Is not null

/**
 * Query condition for filtering entities
 */
export interface QueryCondition {
  /** Field name (camelCase - adapter handles conversion) */
  field: string;
  /** Comparison operator */
  operator: ComparisonOperator;
  /** Value to compare against */
  value: unknown;
}

/**
 * Logical grouping of conditions
 */
export interface QueryConditionGroup {
  /** Logical operator for conditions */
  logic: "and" | "or";
  /** Conditions in this group */
  conditions: (QueryCondition | QueryConditionGroup)[];
}

/**
 * Sort order specification
 */
export interface SortOrder {
  /** Field name to sort by */
  field: string;
  /** Sort direction */
  direction: "asc" | "desc";
}

/**
 * Options for store operations
 */
export interface StoreOptions {
  /** Upsert mode - update if exists, insert if not */
  upsert?: boolean;
  /** Fields to update on conflict (for upsert) */
  updateFields?: string[];
}

/**
 * Options for query operations
 */
export interface QueryOptions {
  /** Fields to select (default: all) */
  select?: string[];
  /** Sort order */
  orderBy?: SortOrder[];
  /** Maximum number of results */
  limit?: number;
  /** Number of results to skip (pagination) */
  offset?: number;
  /** Include soft-deleted records */
  includeDeleted?: boolean;
}

/**
 * Options for count operations
 */
export interface CountOptions {
  /** Include soft-deleted records */
  includeDeleted?: boolean;
}

/**
 * Result of a store operation
 */
export interface StoreResult {
  /** Number of entities stored */
  stored: number;
  /** Number of entities updated (in upsert mode) */
  updated: number;
}

/**
 * Result of a delete operation
 */
export interface DeleteResult {
  /** Number of entities deleted */
  deleted: number;
}

// =============================================================================
// Storage Adapter Interface
// =============================================================================

/**
 * Generic storage adapter interface for database-agnostic CRUD operations.
 *
 * Storage classes depend on this interface instead of specific database
 * implementations (GraphDatabase, CozoDB, etc.).
 *
 * @example
 * ```typescript
 * class ClassificationStorage {
 *   constructor(private storage: IStorageAdapter) {}
 *
 *   async store(classification: EntityClassification): Promise<void> {
 *     await this.storage.store('EntityClassification', [classification], { upsert: true });
 *   }
 *
 *   async getByEntityId(entityId: string): Promise<EntityClassification | null> {
 *     return this.storage.findOne('EntityClassification', [
 *       { field: 'entityId', operator: 'eq', value: entityId }
 *     ]);
 *   }
 * }
 * ```
 */
export interface IStorageAdapter {
  // ===========================================================================
  // Store Operations
  // ===========================================================================

  /**
   * Store one or more entities in a table
   *
   * @param table - Table name (matches schema registry)
   * @param entities - Entities to store (camelCase properties)
   * @param options - Store options (upsert, etc.)
   */
  store<T extends Record<string, unknown>>(
    table: string,
    entities: T[],
    options?: StoreOptions
  ): Promise<StoreResult>;

  /**
   * Store a single entity (convenience method)
   */
  storeOne<T extends Record<string, unknown>>(
    table: string,
    entity: T,
    options?: StoreOptions
  ): Promise<void>;

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  /**
   * Query entities from a table
   *
   * @param table - Table name
   * @param conditions - Filter conditions (optional)
   * @param options - Query options (select, orderBy, limit, etc.)
   */
  query<T>(
    table: string,
    conditions?: QueryCondition[] | QueryConditionGroup,
    options?: QueryOptions
  ): Promise<T[]>;

  /**
   * Find a single entity matching conditions
   * Returns null if not found
   */
  findOne<T>(
    table: string,
    conditions: QueryCondition[] | QueryConditionGroup,
    options?: Omit<QueryOptions, "limit" | "offset">
  ): Promise<T | null>;

  /**
   * Get entity by primary key ID
   */
  getById<T>(table: string, id: string): Promise<T | null>;

  /**
   * Get multiple entities by IDs
   * Returns Map for efficient lookup
   */
  getByIds<T>(table: string, ids: string[]): Promise<Map<string, T>>;

  // ===========================================================================
  // Update Operations
  // ===========================================================================

  /**
   * Update entity by ID
   *
   * @param table - Table name
   * @param id - Entity ID
   * @param updates - Fields to update (partial entity)
   */
  update<T extends Record<string, unknown>>(
    table: string,
    id: string,
    updates: Partial<T>
  ): Promise<void>;

  /**
   * Update entities matching conditions
   *
   * @param table - Table name
   * @param conditions - Filter conditions
   * @param updates - Fields to update
   * @returns Number of entities updated
   */
  updateWhere<T extends Record<string, unknown>>(
    table: string,
    conditions: QueryCondition[] | QueryConditionGroup,
    updates: Partial<T>
  ): Promise<number>;

  // ===========================================================================
  // Delete Operations
  // ===========================================================================

  /**
   * Delete entity by ID
   */
  delete(table: string, id: string): Promise<boolean>;

  /**
   * Delete entities matching conditions
   *
   * @returns Number of entities deleted
   */
  deleteWhere(
    table: string,
    conditions: QueryCondition[] | QueryConditionGroup
  ): Promise<number>;

  // ===========================================================================
  // Aggregate Operations
  // ===========================================================================

  /**
   * Count entities matching conditions
   */
  count(
    table: string,
    conditions?: QueryCondition[] | QueryConditionGroup,
    options?: CountOptions
  ): Promise<number>;

  /**
   * Check if any entity matches conditions
   */
  exists(
    table: string,
    conditions: QueryCondition[] | QueryConditionGroup
  ): Promise<boolean>;

  // ===========================================================================
  // Transaction Support
  // ===========================================================================

  /**
   * Execute operations within a transaction
   * Automatically commits on success, rolls back on error
   */
  transaction<T>(fn: (adapter: IStorageAdapter) => Promise<T>): Promise<T>;

  // ===========================================================================
  // Raw Query (Escape Hatch)
  // ===========================================================================

  /**
   * Execute a raw query for complex operations not covered by CRUD methods
   *
   * NOTE: Use sparingly - raw queries couple code to specific database.
   * Prefer using the typed CRUD methods above.
   *
   * @param query - Database-specific query string
   * @param params - Query parameters
   */
  rawQuery<T>(query: string, params?: Record<string, unknown>): Promise<T[]>;

  /**
   * Execute a raw statement that doesn't return results
   */
  rawExecute(query: string, params?: Record<string, unknown>): Promise<void>;
}

// =============================================================================
// Factory Type
// =============================================================================

/**
 * Factory function type for creating storage adapters
 */
export type StorageAdapterFactory = () => IStorageAdapter;

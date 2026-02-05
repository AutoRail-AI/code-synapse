/**
 * CozoDB Storage Adapter Implementation
 *
 * Implements IStorageAdapter for CozoDB, handling:
 * - CozoScript query generation from generic CRUD operations
 * - Field name conversion (camelCase <-> snake_case)
 * - JSON serialization for complex types
 * - Transaction support
 *
 * This is the ONLY file in the storage layer that should contain CozoScript.
 *
 * @module
 */

import type {
  IStorageAdapter,
  QueryCondition,
  QueryConditionGroup,
  QueryOptions,
  StoreOptions,
  StoreResult,
  CountOptions,
  SortOrder,
} from "../interfaces/IStorageAdapter.js";
import type { GraphDatabase } from "../database.js";
import { createLogger } from "../../../utils/logger.js";

const logger = createLogger("cozo-storage-adapter");

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert camelCase to snake_case
 */
function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
}

/**
 * Convert snake_case to camelCase
 */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert object keys from camelCase to snake_case
 */
function keysToSnakeCase<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toSnakeCase(key)] = value;
  }
  return result;
}

/**
 * Convert object keys from snake_case to camelCase
 */
function keysToCamelCase<T>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toCamelCase(key)] = value;
  }
  return result as T;
}

/**
 * Serialize a value for storage (handles arrays, objects)
 */
function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "object" && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return value;
}

/**
 * Deserialize a value from storage
 */
function deserializeValue(value: unknown, isJsonField: boolean = false): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (isJsonField && typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

// =============================================================================
// CozoStorageAdapter Implementation
// =============================================================================

/**
 * CozoDB implementation of IStorageAdapter
 *
 * Provides database-agnostic CRUD operations by generating CozoScript
 * queries internally. Storage classes use this adapter instead of
 * directly accessing GraphDatabase.
 */
export class CozoStorageAdapter implements IStorageAdapter {
  private jsonFields: Map<string, Set<string>> = new Map();

  constructor(private db: GraphDatabase) {
    // Register known JSON fields for proper deserialization
    this.registerJsonFields();
  }

  /**
   * Register fields that should be deserialized as JSON
   */
  private registerJsonFields(): void {
    // Note: EntityClassification was merged into Justification table

    // LedgerEntry
    this.jsonFields.set("LedgerEntry", new Set([
      "changes", "metadata", "context"
    ]));

    // Justification
    this.jsonFields.set("justification", new Set([
      "tags", "pendingQuestions", "evidenceSources"
    ]));

    // CompactedLedgerEntry (V17)
    this.jsonFields.set("CompactedLedgerEntry", new Set([
      "user_prompts", "mcp_queries", "unique_tools_used",
      "code_accessed", "code_changes", "semantic_impact",
      "index_updates", "memory_updates", "memory_rules_applied",
      "raw_event_ids", "correlated_sessions"
    ]));

    // ProjectMemoryRule (V19)
    this.jsonFields.set("ProjectMemoryRule", new Set([
      "examples"
    ]));
  }

  /**
   * Check if a field should be treated as JSON
   */
  private isJsonField(table: string, field: string): boolean {
    return this.jsonFields.get(table)?.has(field) ?? false;
  }

  // ===========================================================================
  // Store Operations
  // ===========================================================================

  async store<T extends Record<string, unknown>>(
    table: string,
    entities: T[],
    options?: StoreOptions
  ): Promise<StoreResult> {
    if (entities.length === 0) {
      return { stored: 0, updated: 0 };
    }

    // Get field names from first entity (assumes all entities have same shape)
    const firstEntity = entities[0]!;
    const fields = Object.keys(firstEntity);
    const snakeFields = fields.map(toSnakeCase);

    // Build parameter placeholders
    const paramPlaceholders = fields.map((_, i) => `$p${i}`).join(", ");

    // Generate query for each entity
    for (const entity of entities) {
      const params: Record<string, unknown> = {};
      fields.forEach((field, i) => {
        params[`p${i}`] = serializeValue(entity[field]);
      });

      const query = `
        ?[${snakeFields.join(", ")}] <- [[${paramPlaceholders}]]
        :put ${table} { ${snakeFields.join(", ")} }
      `;

      await this.db.query(query, params);
    }

    return { stored: entities.length, updated: 0 };
  }

  async storeOne<T extends Record<string, unknown>>(
    table: string,
    entity: T,
    options?: StoreOptions
  ): Promise<void> {
    await this.store(table, [entity], options);
  }

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  async query<T>(
    table: string,
    conditions?: QueryCondition[] | QueryConditionGroup,
    options?: QueryOptions
  ): Promise<T[]> {
    const { whereClause, params } = this.buildWhereClause(conditions);
    const selectFields = options?.select?.map(toSnakeCase).join(", ") || "*";

    // For CozoDB, we need to list all fields we want to return
    // When selectFields is "*", we need to get them from the table
    let query: string;

    if (selectFields === "*") {
      // Generic query that returns all matched rows
      query = `?[id] := *${table}{id}${whereClause}`;

      // Then fetch full entities by id
      const idResults = await this.db.query<{ id: string }>(query, params);
      if (idResults.length === 0) return [];

      return this.getByIdsInternal<T>(table, idResults.map(r => r.id));
    } else {
      query = `?[${selectFields}] := *${table}{${selectFields}}${whereClause}`;
    }

    // Apply ordering
    if (options?.orderBy && options.orderBy.length > 0) {
      const orderFields = options.orderBy
        .map(o => `${toSnakeCase(o.field)} ${o.direction}`)
        .join(", ");
      query += ` :order ${orderFields}`;
    }

    // Apply limit
    if (options?.limit) {
      query += ` :limit ${options.limit}`;
    }

    // Apply offset
    if (options?.offset) {
      query += ` :offset ${options.offset}`;
    }

    const rows = await this.db.query<Record<string, unknown>>(query, params);
    return rows.map(row => this.deserializeRow<T>(table, row));
  }

  async findOne<T>(
    table: string,
    conditions: QueryCondition[] | QueryConditionGroup,
    options?: Omit<QueryOptions, "limit" | "offset">
  ): Promise<T | null> {
    const results = await this.query<T>(table, conditions, { ...options, limit: 1 });
    return results[0] || null;
  }

  async getById<T>(table: string, id: string): Promise<T | null> {
    return this.findOne<T>(table, [{ field: "id", operator: "eq", value: id }]);
  }

  async getByIds<T>(table: string, ids: string[]): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    if (ids.length === 0) return results;

    const entities = await this.getByIdsInternal<T>(table, ids);
    for (const entity of entities) {
      const id = (entity as Record<string, unknown>)["id"] as string;
      if (id) {
        results.set(id, entity);
      }
    }
    return results;
  }

  private async getByIdsInternal<T>(table: string, ids: string[]): Promise<T[]> {
    if (ids.length === 0) return [];

    const query = `?[id] := *${table}{id}, id in $ids`;
    const idResults = await this.db.query<{ id: string }>(query, { ids });

    // Fetch full rows for each id
    const results: T[] = [];
    for (const { id } of idResults) {
      const rowQuery = `?[k, v] := *${table}{id: $id, ..rest}, k = each(rest), v = get(rest, k)`;
      const kvRows = await this.db.query<{ k: string; v: unknown }>(rowQuery, { id });

      const obj: Record<string, unknown> = { id };
      for (const { k, v } of kvRows) {
        obj[k] = v;
      }
      results.push(this.deserializeRow<T>(table, obj));
    }
    return results;
  }

  // ===========================================================================
  // Update Operations
  // ===========================================================================

  async update<T extends Record<string, unknown>>(
    table: string,
    id: string,
    updates: Partial<T>
  ): Promise<void> {
    // CozoDB uses :put for updates (upsert semantics)
    // First get the existing entity
    const existing = await this.getById<T>(table, id);
    if (!existing) {
      throw new Error(`Entity not found in ${table}: ${id}`);
    }

    // Merge updates
    const merged = { ...existing, ...updates, id } as T;
    await this.storeOne(table, merged as Record<string, unknown>);
  }

  async updateWhere<T extends Record<string, unknown>>(
    table: string,
    conditions: QueryCondition[] | QueryConditionGroup,
    updates: Partial<T>
  ): Promise<number> {
    // Get matching entities
    const entities = await this.query<T & { id: string }>(table, conditions);

    // Update each one
    for (const entity of entities) {
      await this.update(table, entity.id, updates);
    }

    return entities.length;
  }

  // ===========================================================================
  // Delete Operations
  // ===========================================================================

  async delete(table: string, id: string): Promise<boolean> {
    const query = `?[id] <- [[$id]] :rm ${table} { id }`;
    try {
      await this.db.query(query, { id });
      return true;
    } catch {
      return false;
    }
  }

  async deleteWhere(
    table: string,
    conditions: QueryCondition[] | QueryConditionGroup
  ): Promise<number> {
    // Get matching IDs first
    const entities = await this.query<{ id: string }>(table, conditions, { select: ["id"] });

    // Delete each
    let deleted = 0;
    for (const entity of entities) {
      const success = await this.delete(table, entity.id);
      if (success) deleted++;
    }

    return deleted;
  }

  // ===========================================================================
  // Aggregate Operations
  // ===========================================================================

  async count(
    table: string,
    conditions?: QueryCondition[] | QueryConditionGroup,
    _options?: CountOptions
  ): Promise<number> {
    const { whereClause, params } = this.buildWhereClause(conditions);
    const query = `?[count(id)] := *${table}{id}${whereClause}`;
    const result = await this.db.query<Record<string, number>>(query, params);
    return Object.values(result[0] || {})[0] || 0;
  }

  async exists(
    table: string,
    conditions: QueryCondition[] | QueryConditionGroup
  ): Promise<boolean> {
    const count = await this.count(table, conditions);
    return count > 0;
  }

  // ===========================================================================
  // Transaction Support
  // ===========================================================================

  async transaction<T>(fn: (adapter: IStorageAdapter) => Promise<T>): Promise<T> {
    // CozoDB doesn't have true transaction isolation, but we can
    // ensure atomicity by executing all operations through a single
    // connection. For now, we just pass through to the function.
    // A more robust implementation would batch operations.
    return fn(this);
  }

  // ===========================================================================
  // Raw Query (Escape Hatch)
  // ===========================================================================

  async rawQuery<T>(query: string, params?: Record<string, unknown>): Promise<T[]> {
    return this.db.query<T>(query, params);
  }

  async rawExecute(query: string, params?: Record<string, unknown>): Promise<void> {
    await this.db.execute(query, params);
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Build WHERE clause from conditions
   */
  private buildWhereClause(
    conditions?: QueryCondition[] | QueryConditionGroup
  ): { whereClause: string; params: Record<string, unknown> } {
    if (!conditions) {
      return { whereClause: "", params: {} };
    }

    const params: Record<string, unknown> = {};
    let paramIndex = 0;

    const buildCondition = (condition: QueryCondition): string => {
      const field = toSnakeCase(condition.field);
      const paramName = `c${paramIndex++}`;
      params[paramName] = serializeValue(condition.value);

      switch (condition.operator) {
        case "eq":
          return `, ${field} = $${paramName}`;
        case "ne":
          return `, ${field} != $${paramName}`;
        case "gt":
          return `, ${field} > $${paramName}`;
        case "gte":
          return `, ${field} >= $${paramName}`;
        case "lt":
          return `, ${field} < $${paramName}`;
        case "lte":
          return `, ${field} <= $${paramName}`;
        case "in":
          return `, ${field} in $${paramName}`;
        case "nin":
          return `, not ${field} in $${paramName}`;
        case "like":
          return `, like(${field}, $${paramName})`;
        case "contains":
          return `, contains(${field}, $${paramName})`;
        case "isNull":
          return `, is_null(${field})`;
        case "isNotNull":
          return `, not is_null(${field})`;
        default:
          throw new Error(`Unknown operator: ${condition.operator}`);
      }
    };

    const buildGroup = (group: QueryConditionGroup): string => {
      const parts = group.conditions.map(c => {
        if ("logic" in c) {
          return buildGroup(c as QueryConditionGroup);
        }
        return buildCondition(c as QueryCondition);
      });

      // For CozoDB, we handle AND by default (comma-separated)
      // OR requires special handling with `or` keyword
      if (group.logic === "or") {
        // This is a simplification - full OR support would need query restructuring
        logger.warn("OR conditions have limited support in CozoDB adapter");
      }
      return parts.join("");
    };

    let whereClause: string;
    if (Array.isArray(conditions)) {
      whereClause = conditions.map(buildCondition).join("");
    } else {
      whereClause = buildGroup(conditions);
    }

    return { whereClause, params };
  }

  /**
   * Deserialize a row from the database
   */
  private deserializeRow<T>(table: string, row: Record<string, unknown>): T {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const camelKey = toCamelCase(key);
      const isJson = this.isJsonField(table, camelKey);
      result[camelKey] = deserializeValue(value, isJson);
    }
    return result as T;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a CozoStorageAdapter from a GraphDatabase instance
 */
export function createCozoStorageAdapter(db: GraphDatabase): CozoStorageAdapter {
  return new CozoStorageAdapter(db);
}

/**
 * Graph Database Module
 *
 * CozoDB-based graph database for storing and querying the code knowledge graph.
 * Handles structural relationships (imports, calls, inheritance) between code entities.
 * Supports native vector search for semantic queries.
 *
 * @module
 */

// Re-export interface types
export type {
  IGraphStore,
  ITransaction,
  QueryResult,
  VectorSearchResult,
  GraphStoreConfig,
} from "../interfaces/IGraphStore.js";

// Re-export IGraphStore implementation and factory
export { CozoGraphStore, createGraphStore } from "./cozo-graph-store.js";

// Re-export schema definitions and generator
export * from "./schema-definitions.js";
export * from "./schema-generator.js";

// Re-export database
export * from "./database.js";

// Re-export migration runner
export * from "./migration-runner.js";

// Re-export migrations registry
export { migrations, getMigration, getLatestVersion } from "./migrations/index.js";

// Re-export operations
export * from "./operations.js";

// Re-export query builder
export * from "./query-builder.js";

// Re-export ghost resolver for external dependencies
export * from "./ghost-resolver.js";

// =============================================================================
// Storage Adapter Layer (Database-agnostic CRUD)
// =============================================================================

// Re-export storage adapter interfaces
export type {
  IStorageAdapter,
  QueryCondition,
  QueryConditionGroup,
  QueryOptions,
  StoreOptions,
  StoreResult,
  CountOptions,
  DeleteResult,
  SortOrder,
  ComparisonOperator,
  StorageAdapterFactory,
} from "./interfaces/IStorageAdapter.js";

// Re-export CozoDB adapter implementation
export {
  CozoStorageAdapter,
  createCozoStorageAdapter,
} from "./adapters/CozoStorageAdapter.js";

// =============================================================================
// Factory Functions for Storage Layer
// =============================================================================

import { CozoStorageAdapter } from "./adapters/CozoStorageAdapter.js";
import type { GraphDatabase } from "./database.js";
import type { IStorageAdapter } from "./interfaces/IStorageAdapter.js";
import type { IGraphStore } from "../interfaces/IGraphStore.js";

/**
 * Create a storage adapter from a GraphStore or GraphDatabase instance.
 *
 * This is the preferred way to create storage adapters for use in
 * storage classes. It decouples storage classes from the specific
 * database implementation.
 *
 * @example
 * ```typescript
 * const store = await createGraphStore({ path: './data' });
 * const adapter = createStorageAdapter(store);
 *
 * // Use adapter in storage classes
 * const classificationStorage = new ClassificationStorage(adapter);
 * ```
 */
export function createStorageAdapter(storeOrDb: IGraphStore | GraphDatabase): IStorageAdapter {
  // Check if it's a GraphDatabase (has `runRaw` method)
  if ("runRaw" in storeOrDb) {
    // It's a GraphDatabase
    return new CozoStorageAdapter(storeOrDb as GraphDatabase);
  }

  // It's an IGraphStore - get underlying database via the database getter
  const cozoStore = storeOrDb as unknown as { database: GraphDatabase };
  if (cozoStore.database) {
    return new CozoStorageAdapter(cozoStore.database);
  }

  throw new Error("Cannot create storage adapter: incompatible store type");
}

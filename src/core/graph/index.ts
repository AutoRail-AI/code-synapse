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

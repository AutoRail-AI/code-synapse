/**
 * Migration 002: Vector Index Support
 *
 * Placeholder migration for vector search support.
 * Vector embeddings are stored in the separate function_embedding relation
 * (created in migration 001) to work around CozoDB's non-nullable vector fields.
 *
 * HNSW indices are created dynamically when needed.
 *
 * @module
 */

import type { Migration } from "../migration-runner.js";
import type { GraphDatabase, Transaction } from "../database.js";

/**
 * Vector index support migration.
 * The function_embedding relation is created by the schema generator in migration 001.
 * This migration exists to track that vector support is enabled.
 */
export const migration: Migration = {
  version: 2,
  name: "vector_index_support",
  description: "Enable vector search support via function_embedding relation",

  async up(_db: GraphDatabase, _tx: Transaction): Promise<void> {
    // Note: function_embedding relation is created by generateExecutableCozoScript()
    // in migration 001. This migration is a marker that vector support is available.
    //
    // To create an HNSW index for faster searches, run:
    // ::hnsw create function_embedding:embedding_idx {
    //   dim: 384,
    //   m: 16,
    //   dtype: F32,
    //   fields: [embedding],
    //   distance: L2
    // }
  },

  async down(_db: GraphDatabase, _tx: Transaction): Promise<void> {
    // No-op - function_embedding relation is managed by schema
  },
};

/**
 * Add Vector Indices
 *
 * Adds HNSW vector indices to embedding tables for scalable similarity search.
 *
 * @module
 */

import type { Migration } from "../migration-runner.js";
import type { GraphDatabase, Transaction } from "../database.js";

export const migration: Migration = {
    version: 2,
    name: "add_vector_indices",
    description: "Adds HNSW vector indices for similarity search",

    async up(db: GraphDatabase, tx: Transaction): Promise<void> {
        // FunctionEmbedding - HNSW index on embedding vector
        // Using default HNSW parameters (m=16, ef_construction=200)
        await db.execute(`
      ::hnsw create function_embedding:embedding_hnsw {
        embedding
      }
    `, undefined, tx);
    },

    async down(db: GraphDatabase, tx: Transaction): Promise<void> {
        await db.execute(`::remove function_embedding:embedding_hnsw`, undefined, tx);
    },
};

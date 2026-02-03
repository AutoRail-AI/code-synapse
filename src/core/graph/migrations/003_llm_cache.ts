/**
 * LLM Cache Migration
 *
 * Adds a table to store cached LLM inference results.
 * This allows the cache to persist across restarts.
 *
 * @module
 */

import type { Migration } from "../migration-runner.js";
import type { GraphDatabase, Transaction } from "../database.js";

export const migration: Migration = {
    version: 3,
    name: "llm_cache",
    description: "Adds LLM cache table",

    async up(db: GraphDatabase, tx: Transaction): Promise<void> {
        await db.execute(`
      :create llm_cache {
        cache_key: String
        =>
        result: Json,
        timestamp: Int
      }
    `, undefined, tx);
    },

    async down(db: GraphDatabase, tx: Transaction): Promise<void> {
        await db.execute("::remove llm_cache", undefined, tx);
    },
};

/**
 * Migration 001: Initial Schema
 *
 * Creates the initial graph schema with all stored relations.
 * Generated from schema-definitions.ts for consistency.
 *
 * @module
 */

import type { Migration } from "../migration-runner.js";
import type { GraphDatabase, Transaction } from "../database.js";
import { generateExecutableCozoScript, getRelationName } from "../schema-generator.js";
import { SCHEMA } from "../schema-definitions.js";

/**
 * Initial schema migration.
 * Creates all node and relationship relations.
 */
export const migration: Migration = {
  version: 1,
  name: "initial_schema",
  description: "Creates the initial graph schema with all stored relations",

  async up(db: GraphDatabase, tx: Transaction): Promise<void> {
    // Generate CozoScript statements from schema definitions
    const statements = generateExecutableCozoScript();

    // Execute each statement
    for (const statement of statements) {
      // Skip comments and empty lines
      if (statement.startsWith("#") || !statement.trim()) {
        continue;
      }

      await db.execute(statement, undefined, tx);
    }
  },

  async down(db: GraphDatabase, tx: Transaction): Promise<void> {
    // Remove relations in reverse order (relationships first, then nodes)
    const relTables = Object.keys(SCHEMA.relationships);
    const nodeTables = Object.keys(SCHEMA.nodes);

    // Remove relationship relations first
    for (const relName of relTables) {
      try {
        const relationName = getRelationName(relName);
        await db.execute(`::remove ${relationName}`, undefined, tx);
      } catch {
        // Ignore errors if relation doesn't exist
      }
    }

    // Remove node relations (except _SchemaVersion which is managed separately)
    for (const nodeName of nodeTables) {
      if (nodeName === "_SchemaVersion") continue;
      try {
        const relationName = getRelationName(nodeName);
        await db.execute(`::remove ${relationName}`, undefined, tx);
      } catch {
        // Ignore errors if relation doesn't exist
      }
    }

    // Remove schema version relation (named without underscore prefix)
    try {
      await db.execute("::remove schema_version", undefined, tx);
    } catch {
      // Ignore if doesn't exist
    }
  },
};

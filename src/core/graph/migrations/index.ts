/**
 * Migration Registry
 *
 * Exports all migrations in order. Add new migrations here.
 *
 * @module
 */

import type { Migration } from "../migration-runner.js";
import { migration as migration001 } from "./001_initial_schema.js";
import { migration as migration002 } from "./002_add_vector_indices.js";

/**
 * All registered migrations in version order.
 * Add new migrations to this array as they are created.
 */
export const migrations: Migration[] = [
  migration001,
  migration002,
  // Add future migrations here:
  // migration003,
];

/**
 * Gets a migration by version number.
 */
export function getMigration(version: number): Migration | undefined {
  return migrations.find((m) => m.version === version);
}

/**
 * Gets the latest migration version.
 */
export function getLatestVersion(): number {
  return migrations.length > 0 ? migrations[migrations.length - 1]!.version : 0;
}

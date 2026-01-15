/**
 * Migration Registry
 *
 * Exports all migrations in order.
 *
 * @module
 */

import type { Migration } from "../migration-runner.js";
import { migration as migration001 } from "./001_initial_schema.js";

/**
 * All registered migrations in version order.
 */
export const migrations: Migration[] = [migration001];

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

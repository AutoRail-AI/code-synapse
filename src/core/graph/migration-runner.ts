/**
 * Schema Migration Runner
 *
 * Handles versioned database schema migrations. Ensures schema changes
 * are applied safely with rollback support.
 *
 * @module
 */

import type { GraphDatabase, Transaction } from "./database.js";
import { SCHEMA_VERSION } from "./schema-definitions.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Migration definition interface.
 * Each migration has an up (apply) and down (revert) function.
 */
export interface Migration {
  /** Migration version number (must be sequential) */
  version: number;
  /** Human-readable migration name */
  name: string;
  /** Description of what this migration does */
  description?: string;
  /**
   * Applies the migration (upgrades schema).
   * @param db - Database instance
   * @param tx - Transaction to execute within
   */
  up: (db: GraphDatabase, tx: Transaction) => Promise<void>;
  /**
   * Reverts the migration (downgrades schema).
   * @param db - Database instance
   * @param tx - Transaction to execute within
   */
  down: (db: GraphDatabase, tx: Transaction) => Promise<void>;
}

/**
 * Migration status for tracking
 */
export interface MigrationStatus {
  /** Current schema version */
  currentVersion: number;
  /** Target schema version */
  targetVersion: number;
  /** List of pending migrations */
  pendingMigrations: Migration[];
  /** Whether migration is needed */
  needsMigration: boolean;
}

/**
 * Migration result
 */
export interface MigrationResult {
  /** Whether migration was successful */
  success: boolean;
  /** Starting version */
  fromVersion: number;
  /** Ending version */
  toVersion: number;
  /** Migrations that were applied */
  appliedMigrations: string[];
  /** Error if migration failed */
  error?: Error;
}

// =============================================================================
// Migration Runner
// =============================================================================

/**
 * Manages database schema migrations.
 *
 * @example
 * ```typescript
 * const runner = new MigrationRunner(db);
 *
 * // Check migration status
 * const status = await runner.getStatus();
 * if (status.needsMigration) {
 *   await runner.migrate();
 * }
 *
 * // Migrate to specific version
 * await runner.migrate(2);
 *
 * // Rollback to previous version
 * await runner.rollback();
 * ```
 */
export class MigrationRunner {
  private migrations: Migration[] = [];

  constructor(private db: GraphDatabase) {}

  /**
   * Registers migrations to be managed by this runner.
   *
   * @param migrations - Array of migration definitions
   */
  registerMigrations(migrations: Migration[]): void {
    // Sort by version and validate
    const sorted = [...migrations].sort((a, b) => a.version - b.version);

    // Validate sequential versions
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i]!.version !== i + 1) {
        throw new Error(
          `Migration versions must be sequential. Expected version ${i + 1}, got ${sorted[i]!.version}`
        );
      }
    }

    this.migrations = sorted;
  }

  /**
   * Gets the current migration status.
   */
  async getStatus(): Promise<MigrationStatus> {
    const currentVersion = await this.getCurrentVersion();
    const targetVersion = SCHEMA_VERSION;
    const pendingMigrations = this.migrations.filter(
      (m) => m.version > currentVersion && m.version <= targetVersion
    );

    return {
      currentVersion,
      targetVersion,
      pendingMigrations,
      needsMigration: currentVersion !== targetVersion,
    };
  }

  /**
   * Gets the current schema version from the database.
   */
  async getCurrentVersion(): Promise<number> {
    return this.db.getSchemaVersion();
  }

  /**
   * Migrates the database to the target version.
   *
   * @param targetVersion - Version to migrate to (defaults to latest)
   * @returns Migration result
   */
  async migrate(targetVersion: number = SCHEMA_VERSION): Promise<MigrationResult> {
    // Ensure version table exists before doing anything
    await this.ensureVersionTable();

    const currentVersion = await this.getCurrentVersion();
    const appliedMigrations: string[] = [];

    if (currentVersion === targetVersion) {
      return {
        success: true,
        fromVersion: currentVersion,
        toVersion: targetVersion,
        appliedMigrations: [],
      };
    }

    try {
      if (currentVersion < targetVersion) {
        // Migrate up
        const migrationsToApply = this.migrations.filter(
          (m) => m.version > currentVersion && m.version <= targetVersion
        );

        for (const migration of migrationsToApply) {
          await this.runMigration(migration, "up");
          appliedMigrations.push(`${migration.version}_${migration.name}`);
        }
      } else {
        // Migrate down
        const migrationsToRevert = this.migrations
          .filter((m) => m.version <= currentVersion && m.version > targetVersion)
          .reverse();

        for (const migration of migrationsToRevert) {
          await this.runMigration(migration, "down");
          appliedMigrations.push(`${migration.version}_${migration.name} (reverted)`);
        }
      }

      return {
        success: true,
        fromVersion: currentVersion,
        toVersion: targetVersion,
        appliedMigrations,
      };
    } catch (error) {
      return {
        success: false,
        fromVersion: currentVersion,
        toVersion: await this.getCurrentVersion(),
        appliedMigrations,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Rolls back the last applied migration.
   */
  async rollback(): Promise<MigrationResult> {
    const currentVersion = await this.getCurrentVersion();

    if (currentVersion === 0) {
      return {
        success: true,
        fromVersion: 0,
        toVersion: 0,
        appliedMigrations: [],
      };
    }

    return this.migrate(currentVersion - 1);
  }

  /**
   * Resets the database by rolling back all migrations.
   */
  async reset(): Promise<MigrationResult> {
    return this.migrate(0);
  }

  /**
   * Runs a single migration in the specified direction.
   *
   * Note: CozoDB block transactions don't work properly with :create statements
   * (only the last statement in a block executes). Therefore, migrations run
   * each statement directly without transaction wrapping. Schema version
   * tracking provides recovery for failed migrations.
   */
  private async runMigration(
    migration: Migration,
    direction: "up" | "down"
  ): Promise<void> {
    // Create a non-accumulating transaction object for API compatibility
    // The key is that _statements array will be ignored - statements execute immediately
    const immediateTx: Transaction = {
      id: `migration_${migration.version}_${direction}`,
      active: false, // Setting active=false makes db.execute() skip tx accumulation
      _statements: [],
    };

    try {
      // Run the migration - statements execute immediately because tx.active is false
      await migration[direction](this.db, immediateTx);

      // Update schema version after successful migration
      const newVersion = direction === "up" ? migration.version : migration.version - 1;
      await this.db.setSchemaVersion(newVersion);
    } catch (error) {
      // Note: No rollback possible - schema changes in CozoDB are immediate
      // Failed migrations may leave partial state - next run will retry
      throw error;
    }
  }

  /**
   * Creates the schema version table if it doesn't exist.
   * This is needed before the first migration can run.
   * Note: Table named 'schema_version' (not '_schema_version') because
   * CozoDB treats underscore-prefixed relations as system/hidden.
   */
  async ensureVersionTable(): Promise<void> {
    const relationExists = await this.db.relationExists("schema_version");

    if (!relationExists) {
      // Create schema_version relation using CozoScript
      await this.db.execute(`
        :create schema_version {
          id: String
          =>
          version: Int,
          updated_at: Float
        }
      `);

      // Initialize version to 0
      await this.db.execute(`
        ?[id, version, updated_at] <- [['version', 0, now()]]
        :put schema_version {id => version, updated_at}
      `);
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new MigrationRunner instance.
 */
export function createMigrationRunner(db: GraphDatabase): MigrationRunner {
  return new MigrationRunner(db);
}

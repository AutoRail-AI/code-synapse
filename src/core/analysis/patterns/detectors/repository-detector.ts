/**
 * Repository Pattern Detector
 *
 * Detects Repository design pattern instances:
 * - Data access abstraction layer
 * - CRUD operations for entities
 * - Storage/persistence abstraction
 *
 * Heuristics:
 * - Has CRUD methods (find, get, create, update, delete, save)
 * - Class name contains "Repository", "Store", "Dao"
 * - Methods return entity types or collections
 * - Abstracts data source (database, API, etc.)
 *
 * @module
 */

import { BasePatternDetector } from "./base-detector.js";
import type {
  DesignPatternType,
  PatternHeuristic,
  DetectedPattern,
  PatternParticipant,
  PatternAnalysisContext,
  PatternDetectionOptions,
  ClassInfo,
} from "../interfaces.js";

// Repository method patterns
const CRUD_PATTERNS = {
  create: ["create", "add", "insert", "save", "store", "persist"],
  read: ["find", "get", "fetch", "read", "load", "query", "search", "list"],
  update: ["update", "modify", "edit", "patch", "put"],
  delete: ["delete", "remove", "destroy", "erase"],
};

const ALL_CRUD_PATTERNS = [
  ...CRUD_PATTERNS.create,
  ...CRUD_PATTERNS.read,
  ...CRUD_PATTERNS.update,
  ...CRUD_PATTERNS.delete,
];

const REPOSITORY_CLASS_PATTERNS = [
  "Repository",
  "Store",
  "Dao",
  "DataAccess",
  "Storage",
  "Persistence",
];

/**
 * Detector for Repository design pattern.
 */
export class RepositoryDetector extends BasePatternDetector {
  readonly patternType: DesignPatternType = "repository";

  getHeuristics(): PatternHeuristic[] {
    return [
      {
        name: "repository-naming",
        patternType: "repository",
        weight: 0.25,
        description: "Class name suggests repository pattern",
      },
      {
        name: "has-crud-methods",
        patternType: "repository",
        weight: 0.4,
        description: "Class has CRUD (Create, Read, Update, Delete) methods",
      },
      {
        name: "entity-type-parameter",
        patternType: "repository",
        weight: 0.2,
        description: "Methods work with entity types",
      },
      {
        name: "async-data-operations",
        patternType: "repository",
        weight: 0.15,
        description: "Methods are async (suggests I/O operations)",
      },
    ];
  }

  detect(
    context: PatternAnalysisContext,
    options?: PatternDetectionOptions
  ): DetectedPattern[] {
    if (!this.isPatternTypeEnabled(options)) {
      return [];
    }

    const patterns: DetectedPattern[] = [];

    for (const cls of context.classes) {
      const pattern = this.detectRepository(cls, context);
      if (pattern && this.meetsConfidenceThreshold(pattern.confidence, options)) {
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  private detectRepository(
    cls: ClassInfo,
    context: PatternAnalysisContext
  ): DetectedPattern | null {
    const evidence: string[] = [];
    const signals: Array<{ weight: number; matched: boolean }> = [];

    // Check class name
    const hasRepositoryName = REPOSITORY_CLASS_PATTERNS.some(
      (pattern) =>
        cls.name.endsWith(pattern) ||
        cls.name.includes(pattern)
    );
    signals.push({ weight: 0.25, matched: hasRepositoryName });
    if (hasRepositoryName) {
      evidence.push(`Class name "${cls.name}" suggests repository pattern`);
    }

    // Check for CRUD methods
    const crudCoverage = this.calculateCrudCoverage(cls);
    const hasCrudMethods = crudCoverage.total >= 2;
    signals.push({ weight: 0.4, matched: hasCrudMethods });
    if (hasCrudMethods) {
      const ops: string[] = [];
      if (crudCoverage.create > 0) ops.push(`Create (${crudCoverage.create})`);
      if (crudCoverage.read > 0) ops.push(`Read (${crudCoverage.read})`);
      if (crudCoverage.update > 0) ops.push(`Update (${crudCoverage.update})`);
      if (crudCoverage.delete > 0) ops.push(`Delete (${crudCoverage.delete})`);
      evidence.push(`Has CRUD operations: ${ops.join(", ")}`);
    }

    // Check if methods handle entity types
    const hasEntityMethods = cls.methods.some(
      (m) =>
        m.returnType &&
        (m.returnType.includes("[]") ||
          m.returnType.includes("Promise<") ||
          m.returnType.includes("Observable<"))
    );
    signals.push({ weight: 0.2, matched: hasEntityMethods });
    if (hasEntityMethods) {
      evidence.push("Methods return entity types or collections");
    }

    // Check for async methods (typical for data access)
    const asyncMethods = cls.methods.filter((m) => m.isAsync);
    const hasAsyncMethods = asyncMethods.length >= 2;
    signals.push({ weight: 0.15, matched: hasAsyncMethods });
    if (hasAsyncMethods) {
      evidence.push(`${asyncMethods.length} async methods (suggests I/O operations)`);
    }

    const confidence = this.calculateWeightedConfidence(signals);

    if (confidence < 0.4) {
      return null;
    }

    // Identify entity type from class name or methods
    const entityName = this.inferEntityName(cls);

    const participants: PatternParticipant[] = [
      {
        role: "repository",
        entityId: cls.id,
        entityType: "class",
        entityName: cls.name,
        filePath: cls.filePath,
        evidence: [`Repository for ${entityName || "unknown"} entities`],
      },
    ];

    // Try to find the entity class
    if (entityName) {
      const entityClass = context.classes.find(
        (c) => c.name === entityName || c.name === `${entityName}Entity`
      );
      if (entityClass) {
        participants.push({
          role: "entity",
          entityId: entityClass.id,
          entityType: "class",
          entityName: entityClass.name,
          filePath: entityClass.filePath,
          evidence: ["Entity managed by repository"],
        });
      }
    }

    return this.createPattern({
      name: cls.name,
      confidence,
      participants,
      evidence,
      filePaths: [cls.filePath],
      description: `Repository pattern "${cls.name}" abstracts ${entityName || "data"} persistence`,
    });
  }

  private calculateCrudCoverage(cls: ClassInfo): {
    create: number;
    read: number;
    update: number;
    delete: number;
    total: number;
  } {
    const result = { create: 0, read: 0, update: 0, delete: 0, total: 0 };

    for (const method of cls.methods) {
      const name = method.name.toLowerCase();
      if (CRUD_PATTERNS.create.some((p) => name.startsWith(p) || name.includes(p))) {
        result.create++;
      }
      if (CRUD_PATTERNS.read.some((p) => name.startsWith(p) || name.includes(p))) {
        result.read++;
      }
      if (CRUD_PATTERNS.update.some((p) => name.startsWith(p) || name.includes(p))) {
        result.update++;
      }
      if (CRUD_PATTERNS.delete.some((p) => name.startsWith(p) || name.includes(p))) {
        result.delete++;
      }
    }

    result.total =
      (result.create > 0 ? 1 : 0) +
      (result.read > 0 ? 1 : 0) +
      (result.update > 0 ? 1 : 0) +
      (result.delete > 0 ? 1 : 0);

    return result;
  }

  private inferEntityName(cls: ClassInfo): string | null {
    // Try to extract from class name (e.g., "UserRepository" -> "User")
    for (const pattern of REPOSITORY_CLASS_PATTERNS) {
      if (cls.name.endsWith(pattern)) {
        const entity = cls.name.slice(0, -pattern.length);
        if (entity.length > 0) {
          return entity;
        }
      }
    }
    return null;
  }
}

/**
 * Create a repository pattern detector.
 */
export function createRepositoryDetector(): RepositoryDetector {
  return new RepositoryDetector();
}

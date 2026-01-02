/**
 * Classification Storage Implementation
 *
 * CozoDB-backed storage for entity classifications.
 */

import type {
  EntityClassification,
  ClassificationStats,
  ClassificationCategory,
  DomainArea,
  InfrastructureLayer,
} from "../models/classification.js";
import type {
  IClassificationStorage,
  QueryOptions,
  SearchOptions,
} from "../interfaces/IClassificationEngine.js";
import type { GraphDatabase } from "../../graph/database.js";

// Row type for classification queries
interface ClassificationRow {
  id: string;
  entityId: string;
  entityType: string;
  entityName: string;
  filePath: string;
  category: string;
  domainMetadata: string | null;
  infrastructureMetadata: string | null;
  confidence: number;
  classificationMethod: string;
  reasoning: string;
  indicators: string;
  relatedEntities: string;
  dependsOn: string;
  usedBy: string;
  classifiedAt: string;
  classifiedBy: string;
  lastUpdated: string | null;
  version: number;
}

/**
 * CozoDB-backed classification storage
 */
export class CozoClassificationStorage implements IClassificationStorage {
  private db: GraphDatabase;
  private initialized = false;

  constructor(db: GraphDatabase) {
    this.db = db;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    // Schema is created by the graph database schema generator
    this.initialized = true;
  }

  async store(classification: EntityClassification): Promise<void> {
    const query = `
      ?[id, entityId, entityType, entityName, filePath, category,
        domainMetadata, infrastructureMetadata, confidence, classificationMethod,
        reasoning, indicators, relatedEntities, dependsOn, usedBy,
        classifiedAt, classifiedBy, lastUpdated, version] <- [[
        $id, $entityId, $entityType, $entityName, $filePath, $category,
        $domainMetadata, $infrastructureMetadata, $confidence, $classificationMethod,
        $reasoning, $indicators, $relatedEntities, $dependsOn, $usedBy,
        $classifiedAt, $classifiedBy, $lastUpdated, $version
      ]]
      :put EntityClassification {
        id, entityId, entityType, entityName, filePath, category,
        domainMetadata, infrastructureMetadata, confidence, classificationMethod,
        reasoning, indicators, relatedEntities, dependsOn, usedBy,
        classifiedAt, classifiedBy, lastUpdated, version
      }
    `;

    await this.db.query(query, {
      id: classification.entityId, // Use entityId as primary key
      entityId: classification.entityId,
      entityType: classification.entityType,
      entityName: classification.entityName,
      filePath: classification.filePath,
      category: classification.category,
      domainMetadata: classification.domainMetadata
        ? JSON.stringify(classification.domainMetadata)
        : null,
      infrastructureMetadata: classification.infrastructureMetadata
        ? JSON.stringify(classification.infrastructureMetadata)
        : null,
      confidence: classification.confidence,
      classificationMethod: classification.classificationMethod,
      reasoning: classification.reasoning,
      indicators: JSON.stringify(classification.indicators),
      relatedEntities: JSON.stringify(classification.relatedEntities),
      dependsOn: JSON.stringify(classification.dependsOn),
      usedBy: JSON.stringify(classification.usedBy),
      classifiedAt: classification.classifiedAt,
      classifiedBy: classification.classifiedBy,
      lastUpdated: classification.lastUpdated ?? null,
      version: classification.version,
    });
  }

  async storeBatch(classifications: EntityClassification[]): Promise<void> {
    // Use transaction for batch operations
    for (const classification of classifications) {
      await this.store(classification);
    }
  }

  async get(entityId: string): Promise<EntityClassification | null> {
    const query = `
      ?[id, entityId, entityType, entityName, filePath, category,
        domainMetadata, infrastructureMetadata, confidence, classificationMethod,
        reasoning, indicators, relatedEntities, dependsOn, usedBy,
        classifiedAt, classifiedBy, lastUpdated, version] :=
        *EntityClassification{
          id, entityId, entityType, entityName, filePath, category,
          domainMetadata, infrastructureMetadata, confidence, classificationMethod,
          reasoning, indicators, relatedEntities, dependsOn, usedBy,
          classifiedAt, classifiedBy, lastUpdated, version
        },
        entityId == $entityId
    `;

    const rows = await this.db.query<ClassificationRow>(query, { entityId });
    if (rows.length === 0) {
      return null;
    }

    return this.rowToClassification(rows[0]!);
  }

  async update(
    entityId: string,
    updates: Partial<EntityClassification>
  ): Promise<EntityClassification | null> {
    const existing = await this.get(entityId);
    if (!existing) return null;

    const updated: EntityClassification = {
      ...existing,
      ...updates,
      lastUpdated: new Date().toISOString(),
      version: existing.version + 1,
    };

    await this.store(updated);
    return updated;
  }

  async delete(entityId: string): Promise<boolean> {
    const query = `
      ?[id] := *EntityClassification{id, entityId}, entityId == $entityId
      :rm EntityClassification {id}
    `;

    try {
      await this.db.query(query, { entityId });
      return true;
    } catch {
      return false;
    }
  }

  async deleteForFile(filePath: string): Promise<number> {
    // First count the existing entries
    const countQuery = `
      ?[cnt] := cnt = count(id), *EntityClassification{id, filePath: fp}, fp == $filePath
    `;
    const countRows = await this.db.query<{ cnt: number }>(countQuery, { filePath });
    const count = countRows[0]?.cnt ?? 0;

    // Then delete them
    const deleteQuery = `
      ?[id] := *EntityClassification{id, filePath: fp}, fp == $filePath
      :rm EntityClassification {id}
    `;
    await this.db.query(deleteQuery, { filePath });

    return count;
  }

  async queryByCategory(
    category: ClassificationCategory,
    options?: QueryOptions
  ): Promise<EntityClassification[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const orderBy = options?.orderBy ?? "classifiedAt";
    const orderDirection = options?.orderDirection ?? "desc";

    const query = `
      ?[id, entityId, entityType, entityName, filePath, category,
        domainMetadata, infrastructureMetadata, confidence, classificationMethod,
        reasoning, indicators, relatedEntities, dependsOn, usedBy,
        classifiedAt, classifiedBy, lastUpdated, version] :=
        *EntityClassification{
          id, entityId, entityType, entityName, filePath, category,
          domainMetadata, infrastructureMetadata, confidence, classificationMethod,
          reasoning, indicators, relatedEntities, dependsOn, usedBy,
          classifiedAt, classifiedBy, lastUpdated, version
        },
        category == $category
        ${options?.minConfidence ? `, confidence >= $minConfidence` : ""}
      :order ${orderDirection === "desc" ? "-" : ""}${orderBy}
      :limit $limit
      :offset $offset
    `;

    const rows = await this.db.query<ClassificationRow>(query, {
      category,
      limit,
      offset,
      minConfidence: options?.minConfidence,
    });

    return rows.map((row) => this.rowToClassification(row));
  }

  async queryDomainByArea(
    area: DomainArea,
    options?: QueryOptions
  ): Promise<EntityClassification[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const query = `
      ?[id, entityId, entityType, entityName, filePath, category,
        domainMetadata, infrastructureMetadata, confidence, classificationMethod,
        reasoning, indicators, relatedEntities, dependsOn, usedBy,
        classifiedAt, classifiedBy, lastUpdated, version] :=
        *EntityClassification{
          id, entityId, entityType, entityName, filePath, category,
          domainMetadata, infrastructureMetadata, confidence, classificationMethod,
          reasoning, indicators, relatedEntities, dependsOn, usedBy,
          classifiedAt, classifiedBy, lastUpdated, version
        },
        category == "domain",
        domainMetadata != null
      :limit $limit
      :offset $offset
    `;

    const rows = await this.db.query<ClassificationRow>(query, { area, limit, offset });

    // Filter by area in application layer (JSON field)
    return rows
      .map((row) => this.rowToClassification(row))
      .filter((c) => c.domainMetadata?.area === area);
  }

  async queryInfrastructureByLayer(
    layer: InfrastructureLayer,
    options?: QueryOptions
  ): Promise<EntityClassification[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const query = `
      ?[id, entityId, entityType, entityName, filePath, category,
        domainMetadata, infrastructureMetadata, confidence, classificationMethod,
        reasoning, indicators, relatedEntities, dependsOn, usedBy,
        classifiedAt, classifiedBy, lastUpdated, version] :=
        *EntityClassification{
          id, entityId, entityType, entityName, filePath, category,
          domainMetadata, infrastructureMetadata, confidence, classificationMethod,
          reasoning, indicators, relatedEntities, dependsOn, usedBy,
          classifiedAt, classifiedBy, lastUpdated, version
        },
        category == "infrastructure",
        infrastructureMetadata != null
      :limit $limit
      :offset $offset
    `;

    const rows = await this.db.query<ClassificationRow>(query, { layer, limit, offset });

    // Filter by layer in application layer (JSON field)
    return rows
      .map((row) => this.rowToClassification(row))
      .filter((c) => c.infrastructureMetadata?.layer === layer);
  }

  async search(searchQuery: string, options?: SearchOptions): Promise<EntityClassification[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    // Use full-text search on reasoning field
    const dbQuery = `
      ?[id, entityId, entityType, entityName, filePath, category,
        domainMetadata, infrastructureMetadata, confidence, classificationMethod,
        reasoning, indicators, relatedEntities, dependsOn, usedBy,
        classifiedAt, classifiedBy, lastUpdated, version] :=
        *EntityClassification{
          id, entityId, entityType, entityName, filePath, category,
          domainMetadata, infrastructureMetadata, confidence, classificationMethod,
          reasoning, indicators, relatedEntities, dependsOn, usedBy,
          classifiedAt, classifiedBy, lastUpdated, version
        },
        (contains(entityName, $searchQuery) || contains(reasoning, $searchQuery) || contains(filePath, $searchQuery))
        ${options?.category ? `, category == $category` : ""}
      :limit $limit
      :offset $offset
    `;

    const rows = await this.db.query<ClassificationRow>(dbQuery, {
      searchQuery,
      limit,
      offset,
      category: options?.category,
    });

    return rows.map((row) => this.rowToClassification(row));
  }

  async getByFile(filePath: string): Promise<EntityClassification[]> {
    const query = `
      ?[id, entityId, entityType, entityName, filePath, category,
        domainMetadata, infrastructureMetadata, confidence, classificationMethod,
        reasoning, indicators, relatedEntities, dependsOn, usedBy,
        classifiedAt, classifiedBy, lastUpdated, version] :=
        *EntityClassification{
          id, entityId, entityType, entityName, filePath, category,
          domainMetadata, infrastructureMetadata, confidence, classificationMethod,
          reasoning, indicators, relatedEntities, dependsOn, usedBy,
          classifiedAt, classifiedBy, lastUpdated, version
        },
        filePath == $filePath
    `;

    const rows = await this.db.query<ClassificationRow>(query, { filePath });
    return rows.map((row) => this.rowToClassification(row));
  }

  async getByLibrary(library: string): Promise<EntityClassification[]> {
    const query = `
      ?[id, entityId, entityType, entityName, filePath, category,
        domainMetadata, infrastructureMetadata, confidence, classificationMethod,
        reasoning, indicators, relatedEntities, dependsOn, usedBy,
        classifiedAt, classifiedBy, lastUpdated, version] :=
        *EntityClassification{
          id, entityId, entityType, entityName, filePath, category,
          domainMetadata, infrastructureMetadata, confidence, classificationMethod,
          reasoning, indicators, relatedEntities, dependsOn, usedBy,
          classifiedAt, classifiedBy, lastUpdated, version
        },
        category == "infrastructure",
        infrastructureMetadata != null
    `;

    const rows = await this.db.query<ClassificationRow>(query, {});

    // Filter by library in application layer (JSON field)
    return rows
      .map((row) => this.rowToClassification(row))
      .filter((c) => c.infrastructureMetadata?.library === library);
  }

  async getStats(): Promise<ClassificationStats> {
    const countQuery = `
      ?[category, cnt] :=
        *EntityClassification{category},
        cnt = count(category)
    `;

    const confidenceQuery = `
      ?[avg_conf] :=
        avg_conf = mean(c),
        *EntityClassification{confidence: c}
    `;

    const [countRows, confRows] = await Promise.all([
      this.db.query<{ category: string; cnt: number }>(countQuery, {}),
      this.db.query<{ avg_conf: number }>(confidenceQuery, {}),
    ]);

    const counts: Record<string, number> = {};
    for (const row of countRows) {
      counts[row.category] = row.cnt;
    }

    const avgConfidence = confRows[0]?.avg_conf ?? 0;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    return {
      totalEntities: total,
      classifiedEntities: total,
      domainCount: counts["domain"] ?? 0,
      infrastructureCount: counts["infrastructure"] ?? 0,
      unknownCount: counts["unknown"] ?? 0,
      averageConfidence: avgConfidence,
      byArea: {}, // Would need additional queries
      byLayer: {}, // Would need additional queries
      byMethod: {}, // Would need additional queries
    };
  }

  async exists(entityId: string): Promise<boolean> {
    const query = `
      ?[cnt] := cnt = count(id), *EntityClassification{id, entityId}, entityId == $entityId
    `;

    const rows = await this.db.query<{ cnt: number }>(query, { entityId });
    return (rows[0]?.cnt ?? 0) > 0;
  }

  private rowToClassification(row: ClassificationRow): EntityClassification {
    return {
      entityId: row.entityId,
      entityType: row.entityType as EntityClassification["entityType"],
      entityName: row.entityName,
      filePath: row.filePath,
      category: row.category as ClassificationCategory,
      domainMetadata: row.domainMetadata ? JSON.parse(row.domainMetadata) : undefined,
      infrastructureMetadata: row.infrastructureMetadata ? JSON.parse(row.infrastructureMetadata) : undefined,
      confidence: row.confidence,
      classificationMethod: row.classificationMethod as EntityClassification["classificationMethod"],
      reasoning: row.reasoning,
      indicators: JSON.parse(row.indicators),
      relatedEntities: JSON.parse(row.relatedEntities),
      dependsOn: JSON.parse(row.dependsOn),
      usedBy: JSON.parse(row.usedBy),
      classifiedAt: row.classifiedAt,
      classifiedBy: row.classifiedBy,
      lastUpdated: row.lastUpdated ?? undefined,
      version: row.version,
    };
  }
}

/**
 * Factory function
 */
export function createClassificationStorage(db: GraphDatabase): IClassificationStorage {
  return new CozoClassificationStorage(db);
}

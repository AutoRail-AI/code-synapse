/**
 * Classification Storage Implementation
 *
 * Storage adapter-backed storage for entity classifications.
 * Uses IStorageAdapter for database-agnostic CRUD operations.
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
import type { IStorageAdapter, QueryCondition } from "../../graph/interfaces/IStorageAdapter.js";

// Table name constant
const TABLE_NAME = "EntityClassification";

// Storage record type (snake_case for database)
interface ClassificationRecord {
  id: string;
  entity_id: string;
  entity_type: string;
  entity_name: string;
  file_path: string;
  category: string;
  domain_metadata: string | null;
  infrastructure_metadata: string | null;
  confidence: number;
  classification_method: string;
  reasoning: string;
  indicators: string;
  related_entities: string;
  depends_on: string;
  used_by: string;
  classified_at: number;
  classified_by: string;
  last_updated: number | null;
  version: number;
}

/**
 * Storage adapter-backed classification storage
 */
export class CozoClassificationStorage implements IClassificationStorage {
  private adapter: IStorageAdapter;
  private initialized = false;

  constructor(adapter: IStorageAdapter) {
    this.adapter = adapter;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    // Schema is created by the graph database schema generator
    this.initialized = true;
  }

  async store(classification: EntityClassification): Promise<void> {
    const record = this.classificationToRecord(classification);
    await this.adapter.storeOne(TABLE_NAME, record as unknown as Record<string, unknown>);
  }

  async storeBatch(classifications: EntityClassification[]): Promise<void> {
    const records = classifications.map((c) => this.classificationToRecord(c));
    await this.adapter.store(TABLE_NAME, records as unknown as Record<string, unknown>[]);
  }

  async get(entityId: string): Promise<EntityClassification | null> {
    const record = await this.adapter.findOne<ClassificationRecord>(
      TABLE_NAME,
      [{ field: "entity_id", operator: "eq", value: entityId }]
    );

    if (!record) {
      return null;
    }

    return this.recordToClassification(record);
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
      lastUpdated: Date.now(),
      version: existing.version + 1,
    };

    await this.store(updated);
    return updated;
  }

  async delete(entityId: string): Promise<boolean> {
    // Find the record first to get its ID
    const record = await this.adapter.findOne<ClassificationRecord>(
      TABLE_NAME,
      [{ field: "entity_id", operator: "eq", value: entityId }]
    );

    if (!record) {
      return false;
    }

    return this.adapter.delete(TABLE_NAME, record.id);
  }

  async deleteForFile(filePath: string): Promise<number> {
    return this.adapter.deleteWhere(TABLE_NAME, [
      { field: "file_path", operator: "eq", value: filePath },
    ]);
  }

  async queryByCategory(
    category: ClassificationCategory,
    options?: QueryOptions
  ): Promise<EntityClassification[]> {
    const conditions: QueryCondition[] = [
      { field: "category", operator: "eq", value: category },
    ];

    if (options?.minConfidence) {
      conditions.push({
        field: "confidence",
        operator: "gte",
        value: options.minConfidence,
      });
    }

    const records = await this.adapter.query<ClassificationRecord>(
      TABLE_NAME,
      conditions,
      {
        limit: options?.limit ?? 100,
        offset: options?.offset ?? 0,
        orderBy: [
          {
            field: options?.orderBy ?? "classified_at",
            direction: options?.orderDirection ?? "desc",
          },
        ],
      }
    );

    return records.map((r) => this.recordToClassification(r));
  }

  async queryDomainByArea(
    area: DomainArea,
    options?: QueryOptions
  ): Promise<EntityClassification[]> {
    const conditions: QueryCondition[] = [
      { field: "category", operator: "eq", value: "domain" },
      { field: "domain_metadata", operator: "isNotNull", value: null },
    ];

    const records = await this.adapter.query<ClassificationRecord>(
      TABLE_NAME,
      conditions,
      {
        limit: options?.limit ?? 100,
        offset: options?.offset ?? 0,
      }
    );

    // Filter by area in application layer (JSON field)
    return records
      .map((r) => this.recordToClassification(r))
      .filter((c) => c.domainMetadata?.area === area);
  }

  async queryInfrastructureByLayer(
    layer: InfrastructureLayer,
    options?: QueryOptions
  ): Promise<EntityClassification[]> {
    const conditions: QueryCondition[] = [
      { field: "category", operator: "eq", value: "infrastructure" },
      { field: "infrastructure_metadata", operator: "isNotNull", value: null },
    ];

    const records = await this.adapter.query<ClassificationRecord>(
      TABLE_NAME,
      conditions,
      {
        limit: options?.limit ?? 100,
        offset: options?.offset ?? 0,
      }
    );

    // Filter by layer in application layer (JSON field)
    return records
      .map((r) => this.recordToClassification(r))
      .filter((c) => c.infrastructureMetadata?.layer === layer);
  }

  async search(
    searchQuery: string,
    options?: SearchOptions
  ): Promise<EntityClassification[]> {
    // Use rawQuery for complex text search with OR conditions
    // This is a database-specific operation that requires the escape hatch
    const dbQuery = `
      ?[id, entity_id, entity_type, entity_name, file_path, category,
        domain_metadata, infrastructure_metadata, confidence, classification_method,
        reasoning, indicators, related_entities, depends_on, used_by,
        classified_at, classified_by, last_updated, version] :=
        *EntityClassification{
          id,
          entity_id,
          entity_type,
          entity_name,
          file_path,
          category,
          domain_metadata,
          infrastructure_metadata,
          confidence,
          classification_method,
          reasoning,
          indicators,
          related_entities,
          depends_on,
          used_by,
          classified_at,
          classified_by,
          last_updated,
          version
        },
        (contains(entity_name, $searchQuery) || contains(reasoning, $searchQuery) || contains(file_path, $searchQuery))
        ${options?.category ? `, category == $category` : ""}
      :limit $limit
      :offset $offset
    `;

    const rows = await this.adapter.rawQuery<ClassificationRecord>(dbQuery, {
      searchQuery,
      limit: options?.limit ?? 100,
      offset: options?.offset ?? 0,
      category: options?.category,
    });

    return rows.map((row) => this.recordToClassification(row));
  }

  async getByFile(filePath: string): Promise<EntityClassification[]> {
    const records = await this.adapter.query<ClassificationRecord>(TABLE_NAME, [
      { field: "file_path", operator: "eq", value: filePath },
    ]);

    return records.map((r) => this.recordToClassification(r));
  }

  async getByLibrary(library: string): Promise<EntityClassification[]> {
    const conditions: QueryCondition[] = [
      { field: "category", operator: "eq", value: "infrastructure" },
      { field: "infrastructure_metadata", operator: "isNotNull", value: null },
    ];

    const records = await this.adapter.query<ClassificationRecord>(
      TABLE_NAME,
      conditions
    );

    // Filter by library in application layer (JSON field)
    return records
      .map((r) => this.recordToClassification(r))
      .filter((c) => c.infrastructureMetadata?.library === library);
  }

  async getStats(): Promise<ClassificationStats> {
    // Use rawQuery for complex aggregations
    const countQuery = `
      ?[category, count(id)] :=
        *EntityClassification{id, category}
    `;

    const confidenceQuery = `
      ?[mean(c)] :=
        *EntityClassification{confidence: c}
    `;

    const [countRows, confRows] = await Promise.all([
      this.adapter.rawQuery<Record<string, unknown>>(countQuery, {}),
      this.adapter.rawQuery<Record<string, unknown>>(confidenceQuery, {}),
    ]);

    const counts: Record<string, number> = {};
    if (Array.isArray(countRows)) {
      for (const row of countRows) {
        const category = row.category as string;
        const cnt =
          (Object.values(row).find((v) => typeof v === "number") as number) ||
          0;
        counts[category] = cnt;
      }
    }

    let avgConfidence = 0;
    if (Array.isArray(confRows) && confRows.length > 0) {
      const firstConfRow = confRows[0];
      avgConfidence = firstConfRow
        ? (Object.values(firstConfRow)[0] as number)
        : 0;
    }

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
    return this.adapter.exists(TABLE_NAME, [
      { field: "entity_id", operator: "eq", value: entityId },
    ]);
  }

  // ===========================================================================
  // Conversion Helpers
  // ===========================================================================

  private classificationToRecord(
    classification: EntityClassification
  ): ClassificationRecord {
    return {
      id: classification.entityId, // Use entityId as primary key
      entity_id: classification.entityId,
      entity_type: classification.entityType,
      entity_name: classification.entityName,
      file_path: classification.filePath,
      category: classification.category,
      domain_metadata: classification.domainMetadata
        ? JSON.stringify(classification.domainMetadata)
        : null,
      infrastructure_metadata: classification.infrastructureMetadata
        ? JSON.stringify(classification.infrastructureMetadata)
        : null,
      confidence: classification.confidence,
      classification_method: classification.classificationMethod,
      reasoning: classification.reasoning,
      indicators: JSON.stringify(classification.indicators),
      related_entities: JSON.stringify(classification.relatedEntities),
      depends_on: JSON.stringify(classification.dependsOn),
      used_by: JSON.stringify(classification.usedBy),
      classified_at: classification.classifiedAt,
      classified_by: classification.classifiedBy,
      last_updated: classification.lastUpdated ?? null,
      version: classification.version,
    };
  }

  private recordToClassification(
    record: ClassificationRecord
  ): EntityClassification {
    return {
      entityId: record.entity_id,
      entityType: record.entity_type as EntityClassification["entityType"],
      entityName: record.entity_name,
      filePath: record.file_path,
      category: record.category as ClassificationCategory,
      domainMetadata: record.domain_metadata
        ? JSON.parse(record.domain_metadata)
        : undefined,
      infrastructureMetadata: record.infrastructure_metadata
        ? JSON.parse(record.infrastructure_metadata)
        : undefined,
      confidence: record.confidence,
      classificationMethod:
        record.classification_method as EntityClassification["classificationMethod"],
      reasoning: record.reasoning,
      indicators: JSON.parse(record.indicators),
      relatedEntities: JSON.parse(record.related_entities),
      dependsOn: JSON.parse(record.depends_on),
      usedBy: JSON.parse(record.used_by),
      classifiedAt: record.classified_at,
      classifiedBy: record.classified_by,
      lastUpdated: record.last_updated ?? undefined,
      version: record.version,
    };
  }
}

/**
 * Factory function
 */
export function createClassificationStorage(
  adapter: IStorageAdapter
): IClassificationStorage {
  return new CozoClassificationStorage(adapter);
}

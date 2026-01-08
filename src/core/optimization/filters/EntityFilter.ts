/**
 * Entity Filter
 *
 * Specialized filter for code entities with:
 * - Type-specific bloom filters
 * - Quick existence checks
 * - Memory-efficient entity tracking
 */

import type { IBloomFilter } from "../interfaces/IOptimization.js";
import { BloomFilter, createOptimalBloomFilter } from "./BloomFilter.js";

// =============================================================================
// Entity Filter Configuration
// =============================================================================

export interface EntityFilterConfig {
  expectedEntitiesPerType: number;
  falsePositiveRate: number;
  entityTypes: string[];
}

export const DEFAULT_ENTITY_FILTER_CONFIG: EntityFilterConfig = {
  expectedEntitiesPerType: 10000,
  falsePositiveRate: 0.01,
  entityTypes: ["file", "function", "class", "interface", "type_alias", "variable"],
};

// =============================================================================
// Entity Filter Implementation
// =============================================================================

export class EntityFilter {
  private typeFilters: Map<string, BloomFilter> = new Map();
  private globalFilter: BloomFilter;
  private config: EntityFilterConfig;

  constructor(config: Partial<EntityFilterConfig> = {}) {
    this.config = { ...DEFAULT_ENTITY_FILTER_CONFIG, ...config };

    // Create type-specific filters
    for (const type of this.config.entityTypes) {
      this.typeFilters.set(
        type,
        createOptimalBloomFilter(
          this.config.expectedEntitiesPerType,
          this.config.falsePositiveRate
        )
      );
    }

    // Create global filter (larger)
    this.globalFilter = createOptimalBloomFilter(
      this.config.expectedEntitiesPerType * this.config.entityTypes.length,
      this.config.falsePositiveRate
    );
  }

  addEntity(entityId: string, entityType: string): void {
    // Add to global filter
    this.globalFilter.add(entityId);

    // Add to type-specific filter
    const typeFilter = this.typeFilters.get(entityType);
    if (typeFilter) {
      typeFilter.add(entityId);
    }
  }

  addEntities(entities: Array<{ id: string; type: string }>): void {
    for (const entity of entities) {
      this.addEntity(entity.id, entity.type);
    }
  }

  mightExist(entityId: string): boolean {
    return this.globalFilter.mightContain(entityId);
  }

  mightExistOfType(entityId: string, entityType: string): boolean {
    const typeFilter = this.typeFilters.get(entityType);
    if (!typeFilter) return false;
    return typeFilter.mightContain(entityId);
  }

  filterPossibleEntities(entityIds: string[]): string[] {
    return entityIds.filter((id) => this.mightExist(id));
  }

  filterPossibleEntitiesOfType(entityIds: string[], entityType: string): string[] {
    return entityIds.filter((id) => this.mightExistOfType(id, entityType));
  }

  getTypeStats(): Record<string, { count: number; fpr: number }> {
    const stats: Record<string, { count: number; fpr: number }> = {};

    for (const [type, filter] of this.typeFilters) {
      stats[type] = {
        count: filter.estimatedCount(),
        fpr: filter.falsePositiveRate(),
      };
    }

    return stats;
  }

  getGlobalStats(): { count: number; fpr: number } {
    return {
      count: this.globalFilter.estimatedCount(),
      fpr: this.globalFilter.falsePositiveRate(),
    };
  }

  clear(): void {
    this.globalFilter.clear();
    for (const filter of this.typeFilters.values()) {
      filter.clear();
    }
  }

  serialize(): Uint8Array {
    // Serialize all filters
    const serialized: Uint8Array[] = [];

    // Global filter
    const globalData = this.globalFilter.serialize();
    const globalLen = new Uint8Array(4);
    new DataView(globalLen.buffer).setUint32(0, globalData.length, true);
    serialized.push(globalLen, globalData);

    // Type filters
    const typeCount = new Uint8Array(4);
    new DataView(typeCount.buffer).setUint32(0, this.typeFilters.size, true);
    serialized.push(typeCount);

    for (const [type, filter] of this.typeFilters) {
      // Type name
      const typeBytes = new TextEncoder().encode(type);
      const typeLen = new Uint8Array(4);
      new DataView(typeLen.buffer).setUint32(0, typeBytes.length, true);
      serialized.push(typeLen, typeBytes);

      // Filter data
      const filterData = filter.serialize();
      const filterLen = new Uint8Array(4);
      new DataView(filterLen.buffer).setUint32(0, filterData.length, true);
      serialized.push(filterLen, filterData);
    }

    // Combine all parts
    const totalLength = serialized.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of serialized) {
      result.set(arr, offset);
      offset += arr.length;
    }

    return result;
  }

  deserialize(data: Uint8Array): void {
    let offset = 0;

    // Global filter
    const globalLen = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(
      0,
      true
    );
    offset += 4;
    const globalData = data.slice(offset, offset + globalLen);
    offset += globalLen;
    this.globalFilter.deserialize(globalData);

    // Type count
    const typeCount = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(
      0,
      true
    );
    offset += 4;

    // Type filters
    this.typeFilters.clear();
    for (let i = 0; i < typeCount; i++) {
      // Type name
      const typeLen = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(
        0,
        true
      );
      offset += 4;
      const typeBytes = data.slice(offset, offset + typeLen);
      offset += typeLen;
      const type = new TextDecoder().decode(typeBytes);

      // Filter data
      const filterLen = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(
        0,
        true
      );
      offset += 4;
      const filterData = data.slice(offset, offset + filterLen);
      offset += filterLen;

      const filter = createOptimalBloomFilter(
        this.config.expectedEntitiesPerType,
        this.config.falsePositiveRate
      );
      filter.deserialize(filterData);
      this.typeFilters.set(type, filter);
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createEntityFilter(config?: Partial<EntityFilterConfig>): EntityFilter {
  return new EntityFilter(config);
}

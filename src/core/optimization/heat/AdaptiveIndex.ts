/**
 * Adaptive Index
 *
 * Uses heat tracking data to make intelligent indexing decisions:
 * - Prioritize hot entities for faster access
 * - Defer cold entity updates
 * - Suggest index creation/removal
 */

import type { IHeatTracker, HeatEntry } from "../interfaces/IOptimization.js";
import { HeatTracker, type HeatTrackerConfig } from "./HeatTracker.js";

// =============================================================================
// Adaptive Index Configuration
// =============================================================================

export interface AdaptiveIndexConfig {
  heatConfig?: Partial<HeatTrackerConfig>;
  hotEntityThreshold: number;
  coldEntityThreshold: number;
  indexSuggestionMinAccess: number;
  reindexCheckIntervalMs: number;
}

export const DEFAULT_ADAPTIVE_INDEX_CONFIG: AdaptiveIndexConfig = {
  hotEntityThreshold: 0.7,
  coldEntityThreshold: 0.2,
  indexSuggestionMinAccess: 50,
  reindexCheckIntervalMs: 300000, // 5 minutes
};

// =============================================================================
// Index Suggestion Types
// =============================================================================

export interface IndexSuggestion {
  type: "create" | "remove" | "optimize";
  entityType: string;
  reason: string;
  priority: "high" | "medium" | "low";
  affectedEntities: number;
}

export interface ReindexDecision {
  shouldReindex: boolean;
  entityIds: string[];
  reason: string;
  priority: number;
}

// =============================================================================
// Adaptive Index Implementation
// =============================================================================

export class AdaptiveIndex {
  private heatTracker: HeatTracker;
  private config: AdaptiveIndexConfig;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private pendingReindexes: Map<string, number> = new Map(); // entityId -> priority

  constructor(config: Partial<AdaptiveIndexConfig> = {}) {
    this.config = { ...DEFAULT_ADAPTIVE_INDEX_CONFIG, ...config };
    this.heatTracker = new HeatTracker(this.config.heatConfig);
  }

  async initialize(): Promise<void> {
    await this.heatTracker.initialize();

    // Start periodic reindex check
    this.checkTimer = setInterval(() => {
      this.checkReindexNeeds();
    }, this.config.reindexCheckIntervalMs);
  }

  // ==========================================================================
  // Access Recording
  // ==========================================================================

  recordAccess(entityId: string, entityType: string, weight = 1): void {
    this.heatTracker.recordAccess(entityId, entityType, weight);
  }

  recordQueryAccess(entityIds: string[], entityType: string): void {
    this.heatTracker.recordBatchAccess(
      entityIds.map((id) => ({ entityId: id, entityType }))
    );
  }

  // ==========================================================================
  // Index Decisions
  // ==========================================================================

  shouldPrioritizeIndexing(entityId: string): boolean {
    return this.heatTracker.isHot(entityId);
  }

  shouldDeferIndexing(entityId: string): boolean {
    return this.heatTracker.isCold(entityId);
  }

  getIndexingPriority(entityIds: string[]): Array<{ entityId: string; priority: number }> {
    return entityIds
      .map((entityId) => ({
        entityId,
        priority: this.heatTracker.getHeat(entityId),
      }))
      .sort((a, b) => b.priority - a.priority);
  }

  // ==========================================================================
  // Index Suggestions
  // ==========================================================================

  getIndexSuggestions(): IndexSuggestion[] {
    const suggestions: IndexSuggestion[] = [];
    const stats = this.heatTracker.stats();

    // Suggest creating indexes for hot entity types
    for (const [type, count] of Object.entries(stats.typeDistribution)) {
      const hotEntities = this.heatTracker.getHotByType(type);
      const hotRatio = hotEntities.length / count;

      if (hotRatio > 0.3 && count >= this.config.indexSuggestionMinAccess) {
        suggestions.push({
          type: "create",
          entityType: type,
          reason: `${Math.round(hotRatio * 100)}% of ${type} entities are frequently accessed`,
          priority: hotRatio > 0.5 ? "high" : "medium",
          affectedEntities: hotEntities.length,
        });
      }

      // Suggest removing indexes for cold entity types
      const coldEntities = this.heatTracker.getColdEntities().filter((e) => e.entityType === type);
      const coldRatio = coldEntities.length / count;

      if (coldRatio > 0.8 && count >= this.config.indexSuggestionMinAccess) {
        suggestions.push({
          type: "remove",
          entityType: type,
          reason: `${Math.round(coldRatio * 100)}% of ${type} entities are rarely accessed`,
          priority: "low",
          affectedEntities: coldEntities.length,
        });
      }
    }

    // Suggest optimization based on access patterns
    const hotEntities = this.heatTracker.getHotEntities(50);
    const typeGroups = this.groupByType(hotEntities);

    for (const [type, entities] of Object.entries(typeGroups)) {
      if (entities.length >= 10) {
        const risingCount = entities.filter((e) => {
          const pattern = this.heatTracker.getAccessPattern(e.entityId);
          return pattern.trend === "rising";
        }).length;

        if (risingCount > entities.length * 0.5) {
          suggestions.push({
            type: "optimize",
            entityType: type,
            reason: `${type} access is increasing - consider preloading`,
            priority: "medium",
            affectedEntities: risingCount,
          });
        }
      }
    }

    return suggestions;
  }

  // ==========================================================================
  // Reindex Management
  // ==========================================================================

  getReindexDecision(): ReindexDecision {
    const pending = Array.from(this.pendingReindexes.entries())
      .sort(([, a], [, b]) => b - a);

    if (pending.length === 0) {
      return {
        shouldReindex: false,
        entityIds: [],
        reason: "No entities need reindexing",
        priority: 0,
      };
    }

    const highPriority = pending.filter(([, p]) => p > 0.7);
    if (highPriority.length > 0) {
      return {
        shouldReindex: true,
        entityIds: highPriority.map(([id]) => id),
        reason: `${highPriority.length} hot entities need immediate reindexing`,
        priority: 1,
      };
    }

    const mediumPriority = pending.filter(([, p]) => p > 0.3);
    if (mediumPriority.length >= 10) {
      return {
        shouldReindex: true,
        entityIds: mediumPriority.map(([id]) => id),
        reason: `${mediumPriority.length} entities queued for batch reindexing`,
        priority: 0.5,
      };
    }

    return {
      shouldReindex: false,
      entityIds: [],
      reason: "Reindex can be deferred",
      priority: 0,
    };
  }

  markForReindex(entityId: string, priority?: number): void {
    const heat = priority ?? this.heatTracker.getHeat(entityId);
    this.pendingReindexes.set(entityId, heat);
  }

  clearReindexed(entityIds: string[]): void {
    for (const id of entityIds) {
      this.pendingReindexes.delete(id);
    }
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  getHeatStats() {
    return this.heatTracker.stats();
  }

  getHotEntities(limit = 100) {
    return this.heatTracker.getHotEntities(limit);
  }

  getColdEntities(limit = 100) {
    return this.heatTracker.getColdEntities(limit);
  }

  getPendingReindexCount(): number {
    return this.pendingReindexes.size;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async shutdown(): Promise<void> {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    await this.heatTracker.shutdown();
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private checkReindexNeeds(): void {
    // Check hot entities that might need reindexing
    const hotEntities = this.heatTracker.getHotEntities(100);

    for (const entity of hotEntities) {
      const pattern = this.heatTracker.getAccessPattern(entity.entityId);

      // Rising access pattern + high heat = candidate for reindex
      if (pattern.trend === "rising" && entity.heat > this.config.hotEntityThreshold) {
        if (!this.pendingReindexes.has(entity.entityId)) {
          this.pendingReindexes.set(entity.entityId, entity.heat);
        }
      }
    }
  }

  private groupByType(entries: HeatEntry[]): Record<string, HeatEntry[]> {
    const groups: Record<string, HeatEntry[]> = {};

    for (const entry of entries) {
      if (!groups[entry.entityType]) {
        groups[entry.entityType] = [];
      }
      groups[entry.entityType]!.push(entry);
    }

    return groups;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createAdaptiveIndex(config?: Partial<AdaptiveIndexConfig>): AdaptiveIndex {
  return new AdaptiveIndex(config);
}

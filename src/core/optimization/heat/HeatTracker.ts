/**
 * Heat Tracker
 *
 * Tracks entity access frequency and patterns for:
 * - Adaptive indexing decisions
 * - Cache warming strategies
 * - Query optimization
 */

import type { IHeatTracker, HeatStats, HeatEntry } from "../interfaces/IOptimization.js";

// =============================================================================
// Heat Tracker Configuration
// =============================================================================

export interface HeatTrackerConfig {
  maxEntries: number;
  decayIntervalMs: number;
  decayFactor: number;
  coldThreshold: number;
  hotThreshold: number;
}

export const DEFAULT_HEAT_CONFIG: HeatTrackerConfig = {
  maxEntries: 10000,
  decayIntervalMs: 60000, // 1 minute
  decayFactor: 0.95,
  coldThreshold: 0.1,
  hotThreshold: 0.8,
};

// =============================================================================
// Heat Entry Implementation
// =============================================================================

interface InternalHeatEntry {
  entityId: string;
  entityType: string;
  heat: number;
  accessCount: number;
  lastAccess: number;
  firstAccess: number;
  accessPattern: number[]; // timestamps of recent accesses
}

// =============================================================================
// Heat Tracker Implementation
// =============================================================================

export class HeatTracker implements IHeatTracker {
  private entries: Map<string, InternalHeatEntry> = new Map();
  private config: HeatTrackerConfig;
  private decayTimer: ReturnType<typeof setInterval> | null = null;
  private maxHeat = 1.0;

  constructor(config: Partial<HeatTrackerConfig> = {}) {
    this.config = { ...DEFAULT_HEAT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    // Start decay timer
    this.decayTimer = setInterval(() => {
      this.applyDecay();
    }, this.config.decayIntervalMs);
  }

  recordAccess(entityId: string, entityType: string, weight = 1): void {
    const now = Date.now();
    const existing = this.entries.get(entityId);

    if (existing) {
      // Update existing entry
      existing.accessCount++;
      existing.heat = Math.min(1.0, existing.heat + weight * 0.1);
      existing.lastAccess = now;

      // Track recent access pattern (keep last 10)
      existing.accessPattern.push(now);
      if (existing.accessPattern.length > 10) {
        existing.accessPattern.shift();
      }
    } else {
      // Create new entry
      this.entries.set(entityId, {
        entityId,
        entityType,
        heat: Math.min(1.0, weight * 0.1),
        accessCount: 1,
        lastAccess: now,
        firstAccess: now,
        accessPattern: [now],
      });

      // Evict cold entries if at capacity
      if (this.entries.size > this.config.maxEntries) {
        this.evictColdest();
      }
    }

    // Update max heat for normalization
    const entry = this.entries.get(entityId)!;
    if (entry.heat > this.maxHeat) {
      this.maxHeat = entry.heat;
    }
  }

  recordBatchAccess(accesses: Array<{ entityId: string; entityType: string; weight?: number }>): void {
    for (const access of accesses) {
      this.recordAccess(access.entityId, access.entityType, access.weight);
    }
  }

  getHeat(entityId: string): number {
    const entry = this.entries.get(entityId);
    return entry ? this.normalizeHeat(entry.heat) : 0;
  }

  getHotEntities(limit = 100): HeatEntry[] {
    const sorted = Array.from(this.entries.values())
      .sort((a, b) => b.heat - a.heat)
      .slice(0, limit);

    return sorted.map((entry) => ({
      entityId: entry.entityId,
      entityType: entry.entityType,
      heat: this.normalizeHeat(entry.heat),
      accessCount: entry.accessCount,
      lastAccess: entry.lastAccess,
    }));
  }

  getColdEntities(limit = 100): HeatEntry[] {
    const sorted = Array.from(this.entries.values())
      .sort((a, b) => a.heat - b.heat)
      .slice(0, limit);

    return sorted.map((entry) => ({
      entityId: entry.entityId,
      entityType: entry.entityType,
      heat: this.normalizeHeat(entry.heat),
      accessCount: entry.accessCount,
      lastAccess: entry.lastAccess,
    }));
  }

  getHotByType(entityType: string, limit = 50): HeatEntry[] {
    const filtered = Array.from(this.entries.values())
      .filter((e) => e.entityType === entityType)
      .sort((a, b) => b.heat - a.heat)
      .slice(0, limit);

    return filtered.map((entry) => ({
      entityId: entry.entityId,
      entityType: entry.entityType,
      heat: this.normalizeHeat(entry.heat),
      accessCount: entry.accessCount,
      lastAccess: entry.lastAccess,
    }));
  }

  isHot(entityId: string): boolean {
    const heat = this.getHeat(entityId);
    return heat >= this.config.hotThreshold;
  }

  isCold(entityId: string): boolean {
    const heat = this.getHeat(entityId);
    return heat <= this.config.coldThreshold;
  }

  getAccessPattern(entityId: string): { frequency: number; recency: number; trend: "rising" | "stable" | "falling" } {
    const entry = this.entries.get(entityId);
    if (!entry) {
      return { frequency: 0, recency: 0, trend: "stable" };
    }

    const now = Date.now();
    const age = now - entry.firstAccess;
    const frequency = age > 0 ? entry.accessCount / (age / 1000 / 60) : 0; // accesses per minute
    const recency = Math.max(0, 1 - (now - entry.lastAccess) / this.config.decayIntervalMs);

    // Calculate trend from access pattern
    const pattern = entry.accessPattern;
    let trend: "rising" | "stable" | "falling" = "stable";

    if (pattern.length >= 3) {
      const recentGap = pattern[pattern.length - 1]! - pattern[pattern.length - 2]!;
      const olderGap = pattern[pattern.length - 2]! - pattern[pattern.length - 3]!;

      if (recentGap < olderGap * 0.7) {
        trend = "rising";
      } else if (recentGap > olderGap * 1.3) {
        trend = "falling";
      }
    }

    return { frequency, recency, trend };
  }

  stats(): HeatStats {
    const heats = Array.from(this.entries.values()).map((e) => this.normalizeHeat(e.heat));
    const hotCount = heats.filter((h) => h >= this.config.hotThreshold).length;
    const coldCount = heats.filter((h) => h <= this.config.coldThreshold).length;

    const typeDistribution: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      typeDistribution[entry.entityType] = (typeDistribution[entry.entityType] ?? 0) + 1;
    }

    return {
      totalTracked: this.entries.size,
      hotCount,
      coldCount,
      averageHeat: heats.length > 0 ? heats.reduce((a, b) => a + b, 0) / heats.length : 0,
      typeDistribution,
    };
  }

  clear(): void {
    this.entries.clear();
    this.maxHeat = 1.0;
  }

  async shutdown(): Promise<void> {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private applyDecay(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, entry] of this.entries) {
      // Apply time-based decay
      const timeSinceAccess = now - entry.lastAccess;
      const decayMultiplier = Math.pow(
        this.config.decayFactor,
        timeSinceAccess / this.config.decayIntervalMs
      );
      entry.heat *= decayMultiplier;

      // Mark for removal if too cold
      if (entry.heat < 0.001) {
        toRemove.push(id);
      }
    }

    // Remove entries that decayed to near-zero
    for (const id of toRemove) {
      this.entries.delete(id);
    }

    // Recalculate max heat
    this.maxHeat = 1.0;
    for (const entry of this.entries.values()) {
      if (entry.heat > this.maxHeat) {
        this.maxHeat = entry.heat;
      }
    }
  }

  private evictColdest(): void {
    // Find and remove the coldest entry
    let coldest: InternalHeatEntry | null = null;
    let coldestId: string | null = null;

    for (const [id, entry] of this.entries) {
      if (!coldest || entry.heat < coldest.heat) {
        coldest = entry;
        coldestId = id;
      }
    }

    if (coldestId) {
      this.entries.delete(coldestId);
    }
  }

  private normalizeHeat(heat: number): number {
    return this.maxHeat > 0 ? heat / this.maxHeat : 0;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createHeatTracker(config?: Partial<HeatTrackerConfig>): HeatTracker {
  return new HeatTracker(config);
}

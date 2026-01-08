/**
 * Self-Optimizing Feedback Loop Implementation
 *
 * Observes model performance and automatically adjusts routing scores
 * to improve overall system quality, cost, and latency.
 */

import type {
  IFeedbackLoop,
  ModelOutcome,
  ModelStats,
  RoutingAdjustment,
  FeedbackConfig,
} from "../interfaces/IFeedback.js";
import { DEFAULT_FEEDBACK_CONFIG } from "../interfaces/IFeedback.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("feedback-loop");

// =============================================================================
// FeedbackLoop Implementation
// =============================================================================

export class FeedbackLoop implements IFeedbackLoop {
  private config: FeedbackConfig;
  private outcomes: ModelOutcome[] = [];
  private modelStatsCache: Map<string, ModelStats> = new Map();
  private activeAdjustments: Map<string, RoutingAdjustment> = new Map();
  private disabledModels: Set<string> = new Set();
  private recalculationTimer: NodeJS.Timeout | null = null;
  private lastRecalculationAt: string = new Date().toISOString();
  private totalOutcomesProcessed = 0;
  private initialized = false;

  constructor(config: Partial<FeedbackConfig> = {}) {
    this.config = { ...DEFAULT_FEEDBACK_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.debug("Initializing feedback loop");

    // Start periodic recalculation
    if (this.config.enableAutoAdjust) {
      this.recalculationTimer = setInterval(() => {
        this.recalculate();
      }, this.config.recalculationIntervalMs);
    }

    this.initialized = true;
    logger.info({ config: this.config }, "Feedback loop initialized");
  }

  async shutdown(): Promise<void> {
    if (this.recalculationTimer) {
      clearInterval(this.recalculationTimer);
      this.recalculationTimer = null;
    }
    this.initialized = false;
    logger.info("Feedback loop shutdown");
  }

  // ---------------------------------------------------------------------------
  // Observer Methods
  // ---------------------------------------------------------------------------

  recordOutcome(outcome: ModelOutcome): void {
    this.outcomes.push(outcome);
    this.totalOutcomesProcessed++;

    // Update model stats cache
    this.updateModelStats(outcome.modelId);

    // Trim old outcomes to prevent memory bloat
    const cutoff = Date.now() - this.config.recentWindowMs * 2;
    this.outcomes = this.outcomes.filter(
      (o) => new Date(o.timestamp).getTime() > cutoff
    );

    logger.debug(
      { modelId: outcome.modelId, success: outcome.success, latencyMs: outcome.latencyMs },
      "Recorded model outcome"
    );
  }

  getModelStats(modelId: string): ModelStats | null {
    return this.modelStatsCache.get(modelId) ?? null;
  }

  getAllModelStats(): ModelStats[] {
    return Array.from(this.modelStatsCache.values());
  }

  getRecentOutcomes(limit = 100): ModelOutcome[] {
    return this.outcomes.slice(-limit);
  }

  getModelOutcomes(modelId: string, limit = 100): ModelOutcome[] {
    return this.outcomes
      .filter((o) => o.modelId === modelId)
      .slice(-limit);
  }

  clear(): void {
    this.outcomes = [];
    this.modelStatsCache.clear();
    this.activeAdjustments.clear();
    this.disabledModels.clear();
    this.totalOutcomesProcessed = 0;
    logger.info("Feedback data cleared");
  }

  // ---------------------------------------------------------------------------
  // Optimizer Methods
  // ---------------------------------------------------------------------------

  analyze(): RoutingAdjustment[] {
    const adjustments: RoutingAdjustment[] = [];
    const now = new Date().toISOString();

    for (const [modelId, stats] of this.modelStatsCache) {
      // Skip models with insufficient data
      if (stats.totalRequests < this.config.minSamplesForAdjustment) {
        continue;
      }

      // Check success rate
      if (stats.successRate < this.config.successRateThreshold) {
        const penalty = Math.min(
          this.config.maxScorePenalty,
          (this.config.successRateThreshold - stats.successRate) * 50
        );

        adjustments.push({
          modelId,
          type: "score-penalty",
          value: penalty,
          reason: `Low success rate: ${(stats.successRate * 100).toFixed(1)}%`,
          confidence: Math.min(1, stats.totalRequests / 50),
          createdAt: now,
        });
      }

      // Check latency (p90)
      if (stats.p90LatencyMs > this.config.latencyPercentileThreshold) {
        const penalty = Math.min(
          this.config.maxScorePenalty * 0.5,
          (stats.p90LatencyMs / this.config.latencyPercentileThreshold - 1) * 10
        );

        adjustments.push({
          modelId,
          type: "score-penalty",
          value: penalty,
          reason: `High p90 latency: ${stats.p90LatencyMs.toFixed(0)}ms`,
          confidence: Math.min(1, stats.totalRequests / 50),
          createdAt: now,
        });
      }

      // Check for excellent performance - give boost
      if (
        stats.successRate > 0.98 &&
        stats.p90LatencyMs < this.config.latencyPercentileThreshold * 0.5
      ) {
        const boost = Math.min(
          this.config.maxScoreBoost,
          (stats.successRate - 0.95) * 200 +
            (1 - stats.p90LatencyMs / this.config.latencyPercentileThreshold) * 10
        );

        adjustments.push({
          modelId,
          type: "score-boost",
          value: boost,
          reason: `Excellent performance: ${(stats.successRate * 100).toFixed(1)}% success, ${stats.p90LatencyMs.toFixed(0)}ms p90`,
          confidence: Math.min(1, stats.totalRequests / 50),
          createdAt: now,
        });
      }

      // Check for very high failure rate - consider disabling
      if (stats.successRate < 0.5 && stats.totalRequests >= 20) {
        adjustments.push({
          modelId,
          type: "disable",
          value: 0,
          reason: `Very low success rate: ${(stats.successRate * 100).toFixed(1)}%`,
          confidence: Math.min(1, stats.totalRequests / 50),
          expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour
          createdAt: now,
        });
      }
    }

    return adjustments;
  }

  getActiveAdjustments(): RoutingAdjustment[] {
    return Array.from(this.activeAdjustments.values());
  }

  getModelAdjustment(modelId: string): RoutingAdjustment | null {
    return this.activeAdjustments.get(modelId) ?? null;
  }

  getAdjustedScore(modelId: string, baseScore: number): number {
    // Check if disabled
    if (this.disabledModels.has(modelId)) {
      return -Infinity;
    }

    const adjustment = this.activeAdjustments.get(modelId);
    if (!adjustment) {
      return baseScore;
    }

    switch (adjustment.type) {
      case "score-boost":
        return baseScore + adjustment.value * adjustment.confidence;
      case "score-penalty":
        return baseScore - adjustment.value * adjustment.confidence;
      case "disable":
        return -Infinity;
      default:
        return baseScore;
    }
  }

  recalculate(): void {
    logger.debug("Recalculating routing adjustments");

    // Decay existing adjustments
    for (const [modelId, adjustment] of this.activeAdjustments) {
      // Remove expired adjustments
      if (adjustment.expiresAt && new Date(adjustment.expiresAt) < new Date()) {
        this.activeAdjustments.delete(modelId);
        if (adjustment.type === "disable") {
          this.disabledModels.delete(modelId);
        }
        continue;
      }

      // Apply decay
      adjustment.value *= 1 - this.config.adjustmentDecayRate;
      if (Math.abs(adjustment.value) < 1) {
        this.activeAdjustments.delete(modelId);
      }
    }

    // Analyze and apply new adjustments
    const newAdjustments = this.analyze();

    for (const adjustment of newAdjustments) {
      const existing = this.activeAdjustments.get(adjustment.modelId);

      if (adjustment.type === "disable") {
        this.disabledModels.add(adjustment.modelId);
        this.activeAdjustments.set(adjustment.modelId, adjustment);
      } else if (existing) {
        // Merge adjustments
        if (existing.type === adjustment.type) {
          existing.value = (existing.value + adjustment.value) / 2;
          existing.confidence = Math.max(existing.confidence, adjustment.confidence);
          existing.reason = adjustment.reason;
        } else if (adjustment.confidence > existing.confidence) {
          this.activeAdjustments.set(adjustment.modelId, adjustment);
        }
      } else {
        this.activeAdjustments.set(adjustment.modelId, adjustment);
      }
    }

    this.lastRecalculationAt = new Date().toISOString();

    logger.debug(
      { activeAdjustments: this.activeAdjustments.size, disabledModels: this.disabledModels.size },
      "Routing adjustments recalculated"
    );
  }

  getStats(): {
    totalOutcomesProcessed: number;
    activeAdjustments: number;
    modelsWithPenalty: number;
    modelsWithBoost: number;
    modelsDisabled: number;
    lastRecalculationAt: string;
  } {
    let modelsWithPenalty = 0;
    let modelsWithBoost = 0;

    for (const adjustment of this.activeAdjustments.values()) {
      if (adjustment.type === "score-penalty") modelsWithPenalty++;
      if (adjustment.type === "score-boost") modelsWithBoost++;
    }

    return {
      totalOutcomesProcessed: this.totalOutcomesProcessed,
      activeAdjustments: this.activeAdjustments.size,
      modelsWithPenalty,
      modelsWithBoost,
      modelsDisabled: this.disabledModels.size,
      lastRecalculationAt: this.lastRecalculationAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Configuration Methods
  // ---------------------------------------------------------------------------

  getConfig(): FeedbackConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<FeedbackConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart recalculation timer if interval changed
    if (config.recalculationIntervalMs && this.recalculationTimer) {
      clearInterval(this.recalculationTimer);
      this.recalculationTimer = setInterval(() => {
        this.recalculate();
      }, this.config.recalculationIntervalMs);
    }

    logger.info({ config: this.config }, "Feedback config updated");
  }

  // ---------------------------------------------------------------------------
  // Model Management
  // ---------------------------------------------------------------------------

  isModelDisabled(modelId: string): boolean {
    return this.disabledModels.has(modelId);
  }

  disableModel(modelId: string, reason: string, durationMs?: number): void {
    this.disabledModels.add(modelId);

    const adjustment: RoutingAdjustment = {
      modelId,
      type: "disable",
      value: 0,
      reason,
      confidence: 1.0,
      expiresAt: durationMs
        ? new Date(Date.now() + durationMs).toISOString()
        : undefined,
      createdAt: new Date().toISOString(),
    };

    this.activeAdjustments.set(modelId, adjustment);
    logger.warn({ modelId, reason, durationMs }, "Model manually disabled");
  }

  enableModel(modelId: string): void {
    this.disabledModels.delete(modelId);
    const adjustment = this.activeAdjustments.get(modelId);
    if (adjustment?.type === "disable") {
      this.activeAdjustments.delete(modelId);
    }
    logger.info({ modelId }, "Model manually enabled");
  }

  // ---------------------------------------------------------------------------
  // Health Check
  // ---------------------------------------------------------------------------

  getHealth(): {
    healthy: boolean;
    message: string;
    lastUpdate: string;
  } {
    const timeSinceRecalc = Date.now() - new Date(this.lastRecalculationAt).getTime();
    const expectedInterval = this.config.recalculationIntervalMs * 2;

    if (!this.initialized) {
      return {
        healthy: false,
        message: "Feedback loop not initialized",
        lastUpdate: this.lastRecalculationAt,
      };
    }

    if (timeSinceRecalc > expectedInterval) {
      return {
        healthy: false,
        message: `Recalculation overdue by ${Math.floor((timeSinceRecalc - expectedInterval) / 1000)}s`,
        lastUpdate: this.lastRecalculationAt,
      };
    }

    return {
      healthy: true,
      message: `${this.activeAdjustments.size} active adjustments, ${this.disabledModels.size} disabled models`,
      lastUpdate: this.lastRecalculationAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private updateModelStats(modelId: string): void {
    const recentCutoff = Date.now() - this.config.recentWindowMs;
    const modelOutcomes = this.outcomes.filter(
      (o) => o.modelId === modelId && new Date(o.timestamp).getTime() > recentCutoff
    );

    if (modelOutcomes.length === 0) {
      this.modelStatsCache.delete(modelId);
      return;
    }

    const successfulOutcomes = modelOutcomes.filter((o) => o.success);
    const latencies = modelOutcomes.map((o) => o.latencyMs).sort((a, b) => a - b);
    const totalCost = modelOutcomes.reduce((sum, o) => sum + o.cost, 0);
    const qualityScores = modelOutcomes
      .filter((o) => o.qualityScore !== undefined)
      .map((o) => o.qualityScore!);
    const fallbacks = modelOutcomes.filter((o) => o.usedFallback);

    const stats: ModelStats = {
      modelId,
      vendor: modelOutcomes[0]!.vendor,
      totalRequests: modelOutcomes.length,
      successfulRequests: successfulOutcomes.length,
      successRate: successfulOutcomes.length / modelOutcomes.length,
      avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      p50LatencyMs: this.percentile(latencies, 50),
      p90LatencyMs: this.percentile(latencies, 90),
      p99LatencyMs: this.percentile(latencies, 99),
      totalCost,
      avgCostPerRequest: totalCost / modelOutcomes.length,
      avgQualityScore:
        qualityScores.length > 0
          ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
          : undefined,
      fallbackRate: fallbacks.length / modelOutcomes.length,
      lastUpdated: new Date().toISOString(),
    };

    this.modelStatsCache.set(modelId, stats);
  }

  private percentile(sortedArr: number[], p: number): number {
    if (sortedArr.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedArr.length) - 1;
    return sortedArr[Math.max(0, index)]!;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createFeedbackLoop(config?: Partial<FeedbackConfig>): FeedbackLoop {
  return new FeedbackLoop(config);
}

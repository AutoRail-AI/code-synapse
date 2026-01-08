/**
 * Self-Optimizing Feedback Loop Interfaces
 *
 * Interfaces for automatically adjusting model routing and system behavior
 * based on observed performance metrics, costs, and outcomes.
 */

import type { ModelVendor, TaskType } from "../../models/interfaces/IModel.js";

// =============================================================================
// Feedback Data Types
// =============================================================================

/**
 * Observed outcome of a model request
 */
export interface ModelOutcome {
  /** Unique request ID */
  requestId: string;

  /** Model that was used */
  modelId: string;

  /** Vendor */
  vendor: ModelVendor;

  /** Task type */
  taskType: TaskType;

  /** Whether the request succeeded */
  success: boolean;

  /** Latency in milliseconds */
  latencyMs: number;

  /** Tokens used */
  inputTokens: number;
  outputTokens: number;

  /** Cost in USD */
  cost: number;

  /** Quality score (if available, 0-1) */
  qualityScore?: number;

  /** Error message if failed */
  errorMessage?: string;

  /** Whether fallback was used */
  usedFallback: boolean;

  /** Timestamp */
  timestamp: string;
}

/**
 * Aggregated statistics for a model
 */
export interface ModelStats {
  /** Model ID */
  modelId: string;

  /** Vendor */
  vendor: ModelVendor;

  /** Total requests */
  totalRequests: number;

  /** Successful requests */
  successfulRequests: number;

  /** Success rate (0-1) */
  successRate: number;

  /** Average latency */
  avgLatencyMs: number;

  /** P50 latency */
  p50LatencyMs: number;

  /** P90 latency */
  p90LatencyMs: number;

  /** P99 latency */
  p99LatencyMs: number;

  /** Total cost */
  totalCost: number;

  /** Average cost per request */
  avgCostPerRequest: number;

  /** Average quality score */
  avgQualityScore?: number;

  /** Fallback rate */
  fallbackRate: number;

  /** Last updated */
  lastUpdated: string;
}

/**
 * Routing adjustment recommendation
 */
export interface RoutingAdjustment {
  /** Model to adjust */
  modelId: string;

  /** Type of adjustment */
  type:
    | "score-boost" // Increase routing score
    | "score-penalty" // Decrease routing score
    | "disable" // Temporarily disable
    | "enable" // Re-enable disabled model
    | "latency-threshold" // Adjust latency threshold
    | "cost-threshold"; // Adjust cost threshold

  /** Adjustment value */
  value: number;

  /** Reason for adjustment */
  reason: string;

  /** Confidence in this recommendation (0-1) */
  confidence: number;

  /** When this adjustment should expire */
  expiresAt?: string;

  /** Timestamp */
  createdAt: string;
}

/**
 * Feedback loop configuration
 */
export interface FeedbackConfig {
  /** Enable automatic adjustments */
  enableAutoAdjust: boolean;

  /** Minimum samples before making adjustments */
  minSamplesForAdjustment: number;

  /** Time window for recent data (ms) */
  recentWindowMs: number;

  /** Success rate threshold to trigger penalty */
  successRateThreshold: number;

  /** Latency percentile threshold (e.g., p90) */
  latencyPercentileThreshold: number;

  /** Maximum score boost */
  maxScoreBoost: number;

  /** Maximum score penalty */
  maxScorePenalty: number;

  /** How often to recalculate adjustments (ms) */
  recalculationIntervalMs: number;

  /** Adjustment decay rate (per recalculation) */
  adjustmentDecayRate: number;
}

/**
 * Default feedback configuration
 */
export const DEFAULT_FEEDBACK_CONFIG: FeedbackConfig = {
  enableAutoAdjust: true,
  minSamplesForAdjustment: 10,
  recentWindowMs: 3600000, // 1 hour
  successRateThreshold: 0.9,
  latencyPercentileThreshold: 5000, // 5 seconds
  maxScoreBoost: 20,
  maxScorePenalty: 30,
  recalculationIntervalMs: 300000, // 5 minutes
  adjustmentDecayRate: 0.1,
};

// =============================================================================
// Feedback Observer Interface
// =============================================================================

/**
 * Observes model outcomes and collects feedback data
 */
export interface IFeedbackObserver {
  /**
   * Record a model outcome
   */
  recordOutcome(outcome: ModelOutcome): void;

  /**
   * Get statistics for a model
   */
  getModelStats(modelId: string): ModelStats | null;

  /**
   * Get statistics for all models
   */
  getAllModelStats(): ModelStats[];

  /**
   * Get recent outcomes
   */
  getRecentOutcomes(limit?: number): ModelOutcome[];

  /**
   * Get outcomes for a specific model
   */
  getModelOutcomes(modelId: string, limit?: number): ModelOutcome[];

  /**
   * Clear all recorded data
   */
  clear(): void;
}

// =============================================================================
// Feedback Optimizer Interface
// =============================================================================

/**
 * Analyzes feedback data and generates routing adjustments
 */
export interface IFeedbackOptimizer {
  /**
   * Initialize the optimizer
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the optimizer
   */
  shutdown(): Promise<void>;

  /**
   * Analyze current data and generate adjustments
   */
  analyze(): RoutingAdjustment[];

  /**
   * Get current active adjustments
   */
  getActiveAdjustments(): RoutingAdjustment[];

  /**
   * Get adjustment for a specific model
   */
  getModelAdjustment(modelId: string): RoutingAdjustment | null;

  /**
   * Calculate adjusted score for a model
   * @param modelId Model ID
   * @param baseScore Original routing score
   * @returns Adjusted score
   */
  getAdjustedScore(modelId: string, baseScore: number): number;

  /**
   * Force recalculation of adjustments
   */
  recalculate(): void;

  /**
   * Get optimization statistics
   */
  getStats(): {
    totalOutcomesProcessed: number;
    activeAdjustments: number;
    modelsWithPenalty: number;
    modelsWithBoost: number;
    modelsDisabled: number;
    lastRecalculationAt: string;
  };
}

// =============================================================================
// Feedback Loop Interface
// =============================================================================

/**
 * Main interface combining observation and optimization
 */
export interface IFeedbackLoop extends IFeedbackObserver, IFeedbackOptimizer {
  /**
   * Get current configuration
   */
  getConfig(): FeedbackConfig;

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FeedbackConfig>): void;

  /**
   * Check if a model is currently disabled
   */
  isModelDisabled(modelId: string): boolean;

  /**
   * Manually disable a model
   */
  disableModel(modelId: string, reason: string, durationMs?: number): void;

  /**
   * Manually enable a model
   */
  enableModel(modelId: string): void;

  /**
   * Get health status of the feedback system
   */
  getHealth(): {
    healthy: boolean;
    message: string;
    lastUpdate: string;
  };
}

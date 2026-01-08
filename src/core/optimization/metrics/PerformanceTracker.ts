/**
 * Performance Tracker
 *
 * Comprehensive performance monitoring for:
 * - Operation timing
 * - Resource utilization
 * - Bottleneck identification
 * - Trend analysis
 */

import type {
  IPerformanceTracker,
  PerformanceMetrics,
  TimingStats,
  OperationStats,
} from "../interfaces/IOptimization.js";

// =============================================================================
// Performance Tracker Configuration
// =============================================================================

export interface PerformanceTrackerConfig {
  maxHistorySize: number;
  bucketIntervalMs: number;
  slowThresholdMs: number;
  reportIntervalMs: number;
}

export const DEFAULT_PERF_CONFIG: PerformanceTrackerConfig = {
  maxHistorySize: 10000,
  bucketIntervalMs: 60000, // 1 minute buckets
  slowThresholdMs: 1000,
  reportIntervalMs: 300000, // 5 minute reports
};

// =============================================================================
// Types
// =============================================================================

export interface TimingRecord {
  operation: string;
  subsystem: string;
  durationMs: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface OperationBucket {
  startTime: number;
  endTime: number;
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  minDurationMs: number;
  errorCount: number;
}

interface ActiveOperation {
  operation: string;
  subsystem: string;
  startTime: number;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Performance Tracker Implementation
// =============================================================================

export class PerformanceTracker implements IPerformanceTracker {
  private config: PerformanceTrackerConfig;
  private history: TimingRecord[] = [];
  private buckets: Map<string, OperationBucket[]> = new Map();
  private activeOperations: Map<string, ActiveOperation> = new Map();
  private operationIdCounter = 0;
  private reportTimer: ReturnType<typeof setInterval> | null = null;

  // Aggregate stats
  private totalOperations = 0;
  private totalDurationMs = 0;
  private operationCounts: Map<string, number> = new Map();
  private subsystemCounts: Map<string, number> = new Map();

  constructor(config: Partial<PerformanceTrackerConfig> = {}) {
    this.config = { ...DEFAULT_PERF_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    // Start periodic reporting
    this.reportTimer = setInterval(() => {
      this.generateReport();
    }, this.config.reportIntervalMs);
  }

  // ==========================================================================
  // Timing Operations
  // ==========================================================================

  startTiming(operation: string, subsystem: string, metadata?: Record<string, unknown>): string {
    const operationId = `op-${++this.operationIdCounter}-${Date.now()}`;

    this.activeOperations.set(operationId, {
      operation,
      subsystem,
      startTime: Date.now(),
      metadata,
    });

    return operationId;
  }

  endTiming(operationId: string): number {
    const active = this.activeOperations.get(operationId);
    if (!active) {
      return 0;
    }

    const durationMs = Date.now() - active.startTime;
    this.activeOperations.delete(operationId);

    this.recordTiming(active.operation, active.subsystem, durationMs, active.metadata);

    return durationMs;
  }

  recordTiming(
    operation: string,
    subsystem: string,
    durationMs: number,
    metadata?: Record<string, unknown>
  ): void {
    const timestamp = Date.now();

    // Add to history
    const record: TimingRecord = {
      operation,
      subsystem,
      durationMs,
      timestamp,
      metadata,
    };

    this.history.push(record);
    if (this.history.length > this.config.maxHistorySize) {
      this.history.shift();
    }

    // Update aggregates
    this.totalOperations++;
    this.totalDurationMs += durationMs;
    this.operationCounts.set(operation, (this.operationCounts.get(operation) ?? 0) + 1);
    this.subsystemCounts.set(subsystem, (this.subsystemCounts.get(subsystem) ?? 0) + 1);

    // Add to bucket
    this.addToBucket(operation, timestamp, durationMs, false);
  }

  recordError(operation: string, subsystem: string, error: Error): void {
    const timestamp = Date.now();
    this.addToBucket(operation, timestamp, 0, true);

    // Log error with context
    this.history.push({
      operation,
      subsystem,
      durationMs: -1, // indicates error
      timestamp,
      metadata: { error: error.message },
    });
  }

  // ==========================================================================
  // Stats Retrieval
  // ==========================================================================

  getTimingStats(operation: string): TimingStats {
    const records = this.history.filter((r) => r.operation === operation && r.durationMs >= 0);

    if (records.length === 0) {
      return {
        count: 0,
        minMs: 0,
        maxMs: 0,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
      };
    }

    const durations = records.map((r) => r.durationMs).sort((a, b) => a - b);
    const count = durations.length;

    return {
      count,
      minMs: durations[0]!,
      maxMs: durations[count - 1]!,
      avgMs: durations.reduce((a, b) => a + b, 0) / count,
      p50Ms: this.percentile(durations, 0.5),
      p95Ms: this.percentile(durations, 0.95),
      p99Ms: this.percentile(durations, 0.99),
    };
  }

  getOperationStats(operation: string): OperationStats {
    const bucketList = this.buckets.get(operation) ?? [];
    const recentBuckets = bucketList.slice(-10);

    const totalCount = recentBuckets.reduce((sum, b) => sum + b.count, 0);
    const totalDuration = recentBuckets.reduce((sum, b) => sum + b.totalDurationMs, 0);
    const totalErrors = recentBuckets.reduce((sum, b) => sum + b.errorCount, 0);

    // Calculate trend
    let trend: "improving" | "stable" | "degrading" = "stable";
    if (recentBuckets.length >= 3) {
      const recentAvg = recentBuckets.slice(-3).reduce((sum, b) => sum + (b.count > 0 ? b.totalDurationMs / b.count : 0), 0) / 3;
      const olderAvg = recentBuckets.slice(0, 3).reduce((sum, b) => sum + (b.count > 0 ? b.totalDurationMs / b.count : 0), 0) / 3;

      if (recentAvg < olderAvg * 0.8) {
        trend = "improving";
      } else if (recentAvg > olderAvg * 1.2) {
        trend = "degrading";
      }
    }

    return {
      operation,
      totalCount,
      totalDurationMs: totalDuration,
      averageDurationMs: totalCount > 0 ? totalDuration / totalCount : 0,
      errorCount: totalErrors,
      errorRate: totalCount > 0 ? totalErrors / totalCount : 0,
      trend,
    };
  }

  getSubsystemStats(subsystem: string): OperationStats {
    const records = this.history.filter((r) => r.subsystem === subsystem);
    const validRecords = records.filter((r) => r.durationMs >= 0);
    const errorRecords = records.filter((r) => r.durationMs < 0);

    const totalDuration = validRecords.reduce((sum, r) => sum + r.durationMs, 0);

    return {
      operation: subsystem,
      totalCount: validRecords.length,
      totalDurationMs: totalDuration,
      averageDurationMs: validRecords.length > 0 ? totalDuration / validRecords.length : 0,
      errorCount: errorRecords.length,
      errorRate: records.length > 0 ? errorRecords.length / records.length : 0,
      trend: "stable", // Simplified for subsystem
    };
  }

  // ==========================================================================
  // Metrics & Analysis
  // ==========================================================================

  getMetrics(): PerformanceMetrics {
    const now = Date.now();
    const recentRecords = this.history.filter(
      (r) => r.timestamp > now - this.config.bucketIntervalMs * 10
    );

    // Calculate throughput
    const timeWindowMs = Math.min(
      now - (recentRecords[0]?.timestamp ?? now),
      this.config.bucketIntervalMs * 10
    );
    const throughput = timeWindowMs > 0 ? (recentRecords.length / timeWindowMs) * 1000 : 0;

    // Find slow operations
    const slowOperations = recentRecords
      .filter((r) => r.durationMs >= this.config.slowThresholdMs)
      .map((r) => r.operation);

    // Group by operation for bottleneck analysis
    const operationTimes: Map<string, number[]> = new Map();
    for (const record of recentRecords) {
      if (record.durationMs >= 0) {
        const times = operationTimes.get(record.operation) ?? [];
        times.push(record.durationMs);
        operationTimes.set(record.operation, times);
      }
    }

    // Find bottlenecks (operations with high average time)
    const bottlenecks: string[] = [];
    for (const [op, times] of operationTimes) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      if (avg >= this.config.slowThresholdMs * 0.5 && times.length >= 5) {
        bottlenecks.push(op);
      }
    }

    return {
      totalOperations: this.totalOperations,
      totalDurationMs: this.totalDurationMs,
      averageDurationMs: this.totalOperations > 0 ? this.totalDurationMs / this.totalOperations : 0,
      operationsPerSecond: throughput,
      slowOperations: [...new Set(slowOperations)],
      bottlenecks,
    };
  }

  getSlowOperations(thresholdMs?: number): TimingRecord[] {
    const threshold = thresholdMs ?? this.config.slowThresholdMs;
    return this.history
      .filter((r) => r.durationMs >= threshold)
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 100);
  }

  getBottlenecks(): Array<{ operation: string; avgMs: number; count: number }> {
    const operationTimes: Map<string, number[]> = new Map();

    for (const record of this.history) {
      if (record.durationMs >= 0) {
        const times = operationTimes.get(record.operation) ?? [];
        times.push(record.durationMs);
        operationTimes.set(record.operation, times);
      }
    }

    const bottlenecks: Array<{ operation: string; avgMs: number; count: number }> = [];

    for (const [operation, times] of operationTimes) {
      const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
      if (avgMs >= this.config.slowThresholdMs * 0.3 && times.length >= 3) {
        bottlenecks.push({ operation, avgMs, count: times.length });
      }
    }

    return bottlenecks.sort((a, b) => b.avgMs * b.count - a.avgMs * a.count);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  clear(): void {
    this.history = [];
    this.buckets.clear();
    this.activeOperations.clear();
    this.totalOperations = 0;
    this.totalDurationMs = 0;
    this.operationCounts.clear();
    this.subsystemCounts.clear();
  }

  async shutdown(): Promise<void> {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private addToBucket(operation: string, timestamp: number, durationMs: number, isError: boolean): void {
    const bucketStart = Math.floor(timestamp / this.config.bucketIntervalMs) * this.config.bucketIntervalMs;
    const bucketEnd = bucketStart + this.config.bucketIntervalMs;

    let bucketList = this.buckets.get(operation);
    if (!bucketList) {
      bucketList = [];
      this.buckets.set(operation, bucketList);
    }

    // Find or create bucket
    let bucket = bucketList.find((b) => b.startTime === bucketStart);
    if (!bucket) {
      bucket = {
        startTime: bucketStart,
        endTime: bucketEnd,
        count: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        minDurationMs: Infinity,
        errorCount: 0,
      };
      bucketList.push(bucket);

      // Limit bucket history
      if (bucketList.length > 60) {
        bucketList.shift();
      }
    }

    if (isError) {
      bucket.errorCount++;
    } else {
      bucket.count++;
      bucket.totalDurationMs += durationMs;
      bucket.maxDurationMs = Math.max(bucket.maxDurationMs, durationMs);
      bucket.minDurationMs = Math.min(bucket.minDurationMs, durationMs);
    }
  }

  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil(p * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)]!;
  }

  private generateReport(): void {
    // This could emit events or log reports
    // For now, just a placeholder for future enhancement
    const metrics = this.getMetrics();
    if (metrics.bottlenecks.length > 0) {
      // Could log or emit warning about bottlenecks
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createPerformanceTracker(config?: Partial<PerformanceTrackerConfig>): PerformanceTracker {
  return new PerformanceTracker(config);
}

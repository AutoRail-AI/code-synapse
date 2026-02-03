/**
 * Cost Attribution
 *
 * Tracks and attributes costs across:
 * - LLM inference (tokens, compute time)
 * - Embedding generation
 * - Graph operations
 * - Storage usage
 */

// =============================================================================
// Cost Attribution Types
// =============================================================================

export interface ModelCostConfig {
  modelId: string;
  inputTokenCost: number; // cost per 1K tokens
  outputTokenCost: number;
  embeddingCost: number; // cost per 1K tokens
}

export interface CostEntry {
  id: string;
  timestamp: number;
  category: CostCategory;
  operation: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  embeddingTokens?: number;
  computeTimeMs?: number;
  storageBytes?: number;
  cost: number;
  metadata?: Record<string, unknown>;
}

export type CostCategory = "llm" | "embedding" | "graph" | "storage" | "compute";

export interface CostSummary {
  totalCost: number;
  byCategory: Record<CostCategory, number>;
  byModel: Record<string, number>;
  byOperation: Record<string, number>;
  tokenUsage: {
    input: number;
    output: number;
    embedding: number;
  };
  timeRange: {
    start: number;
    end: number;
  };
}

export interface CostBudget {
  maxDailyCost: number;
  maxMonthlyCost: number;
  alertThreshold: number; // percentage of budget
}

// =============================================================================
// Cost Attribution Configuration
// =============================================================================

export interface CostAttributionConfig {
  modelCosts: ModelCostConfig[];
  computeCostPerMinute: number;
  storageCostPerGb: number;
  budget?: CostBudget;
  maxHistorySize: number;
}

export const DEFAULT_COST_CONFIG: CostAttributionConfig = {
  modelCosts: [
    // Local models (no direct cost, just compute)
    { modelId: "qwen2.5-coder-0.5b", inputTokenCost: 0, outputTokenCost: 0, embeddingCost: 0 },
    { modelId: "qwen2.5-coder-1.5b", inputTokenCost: 0, outputTokenCost: 0, embeddingCost: 0 },
    { modelId: "qwen2.5-coder-3b", inputTokenCost: 0, outputTokenCost: 0, embeddingCost: 0 },
    { modelId: "qwen2.5-coder-7b", inputTokenCost: 0, outputTokenCost: 0, embeddingCost: 0 },
    // Cloud models (example pricing)
    { modelId: "gpt-4o", inputTokenCost: 0.005, outputTokenCost: 0.015, embeddingCost: 0.0001 },
    { modelId: "gpt-4o-mini", inputTokenCost: 0.00015, outputTokenCost: 0.0006, embeddingCost: 0.00002 },
    { modelId: "claude-3-5-sonnet", inputTokenCost: 0.003, outputTokenCost: 0.015, embeddingCost: 0 },
    { modelId: "claude-3-haiku", inputTokenCost: 0.00025, outputTokenCost: 0.00125, embeddingCost: 0 },
    { modelId: "gemini-3-pro-preview", inputTokenCost: 0.002, outputTokenCost: 0.012, embeddingCost: 0.00001 },
    { modelId: "gemini-3-flash-preview", inputTokenCost: 0.0005, outputTokenCost: 0.003, embeddingCost: 0.00001 },
    { modelId: "gemini-1.5-pro", inputTokenCost: 0.00125, outputTokenCost: 0.005, embeddingCost: 0.00001 },
    { modelId: "gemini-1.5-flash", inputTokenCost: 0.000075, outputTokenCost: 0.0003, embeddingCost: 0.00001 },
  ],
  computeCostPerMinute: 0.001, // $0.001 per minute for local compute
  storageCostPerGb: 0.02, // $0.02 per GB per month
  maxHistorySize: 50000,
};

// =============================================================================
// Cost Attribution Implementation
// =============================================================================

export class CostAttribution {
  private config: CostAttributionConfig;
  private entries: CostEntry[] = [];
  private modelCostMap: Map<string, ModelCostConfig> = new Map();
  private entryIdCounter = 0;

  // Aggregated costs
  private dailyCosts: Map<string, number> = new Map(); // YYYY-MM-DD -> cost
  private monthlyCosts: Map<string, number> = new Map(); // YYYY-MM -> cost

  constructor(config: Partial<CostAttributionConfig> = {}) {
    this.config = { ...DEFAULT_COST_CONFIG, ...config };

    // Build model cost lookup
    for (const modelCost of this.config.modelCosts) {
      this.modelCostMap.set(modelCost.modelId, modelCost);
    }
  }

  // ==========================================================================
  // Cost Recording
  // ==========================================================================

  recordLLMCost(
    operation: string,
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    computeTimeMs: number,
    metadata?: Record<string, unknown>
  ): CostEntry {
    const modelCost = this.modelCostMap.get(modelId);
    let cost = 0;

    if (modelCost) {
      cost =
        (inputTokens / 1000) * modelCost.inputTokenCost +
        (outputTokens / 1000) * modelCost.outputTokenCost;
    }

    // Add compute cost for local models
    if (cost === 0 && computeTimeMs > 0) {
      cost = (computeTimeMs / 60000) * this.config.computeCostPerMinute;
    }

    return this.recordEntry({
      category: "llm",
      operation,
      modelId,
      inputTokens,
      outputTokens,
      computeTimeMs,
      cost,
      metadata,
    });
  }

  recordEmbeddingCost(
    operation: string,
    modelId: string,
    tokens: number,
    computeTimeMs: number,
    metadata?: Record<string, unknown>
  ): CostEntry {
    const modelCost = this.modelCostMap.get(modelId);
    let cost = 0;

    if (modelCost) {
      cost = (tokens / 1000) * modelCost.embeddingCost;
    }

    // Add compute cost for local embeddings
    if (cost === 0 && computeTimeMs > 0) {
      cost = (computeTimeMs / 60000) * this.config.computeCostPerMinute;
    }

    return this.recordEntry({
      category: "embedding",
      operation,
      modelId,
      embeddingTokens: tokens,
      computeTimeMs,
      cost,
      metadata,
    });
  }

  recordGraphCost(
    operation: string,
    computeTimeMs: number,
    metadata?: Record<string, unknown>
  ): CostEntry {
    const cost = (computeTimeMs / 60000) * this.config.computeCostPerMinute;

    return this.recordEntry({
      category: "graph",
      operation,
      computeTimeMs,
      cost,
      metadata,
    });
  }

  recordStorageCost(
    operation: string,
    storageBytes: number,
    metadata?: Record<string, unknown>
  ): CostEntry {
    // Calculate monthly storage cost prorated
    const gbMonths = storageBytes / (1024 * 1024 * 1024);
    const cost = gbMonths * this.config.storageCostPerGb;

    return this.recordEntry({
      category: "storage",
      operation,
      storageBytes,
      cost,
      metadata,
    });
  }

  recordComputeCost(
    operation: string,
    computeTimeMs: number,
    metadata?: Record<string, unknown>
  ): CostEntry {
    const cost = (computeTimeMs / 60000) * this.config.computeCostPerMinute;

    return this.recordEntry({
      category: "compute",
      operation,
      computeTimeMs,
      cost,
      metadata,
    });
  }

  // ==========================================================================
  // Cost Queries
  // ==========================================================================

  getSummary(since?: number): CostSummary {
    const startTime = since ?? 0;
    const relevantEntries = this.entries.filter((e) => e.timestamp >= startTime);

    const byCategory: Record<CostCategory, number> = {
      llm: 0,
      embedding: 0,
      graph: 0,
      storage: 0,
      compute: 0,
    };

    const byModel: Record<string, number> = {};
    const byOperation: Record<string, number> = {};
    let totalCost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let embeddingTokens = 0;

    for (const entry of relevantEntries) {
      totalCost += entry.cost;
      byCategory[entry.category] += entry.cost;

      if (entry.modelId) {
        byModel[entry.modelId] = (byModel[entry.modelId] ?? 0) + entry.cost;
      }
      byOperation[entry.operation] = (byOperation[entry.operation] ?? 0) + entry.cost;

      inputTokens += entry.inputTokens ?? 0;
      outputTokens += entry.outputTokens ?? 0;
      embeddingTokens += entry.embeddingTokens ?? 0;
    }

    return {
      totalCost,
      byCategory,
      byModel,
      byOperation,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        embedding: embeddingTokens,
      },
      timeRange: {
        start: relevantEntries[0]?.timestamp ?? startTime,
        end: relevantEntries[relevantEntries.length - 1]?.timestamp ?? Date.now(),
      },
    };
  }

  getDailyCost(date?: Date): number {
    const key = this.getDateKey(date ?? new Date());
    return this.dailyCosts.get(key) ?? 0;
  }

  getMonthlyCost(date?: Date): number {
    const key = this.getMonthKey(date ?? new Date());
    return this.monthlyCosts.get(key) ?? 0;
  }

  getCostByModel(modelId: string, since?: number): number {
    const startTime = since ?? 0;
    return this.entries
      .filter((e) => e.modelId === modelId && e.timestamp >= startTime)
      .reduce((sum, e) => sum + e.cost, 0);
  }

  getCostByOperation(operation: string, since?: number): number {
    const startTime = since ?? 0;
    return this.entries
      .filter((e) => e.operation === operation && e.timestamp >= startTime)
      .reduce((sum, e) => sum + e.cost, 0);
  }

  getCostByCategory(category: CostCategory, since?: number): number {
    const startTime = since ?? 0;
    return this.entries
      .filter((e) => e.category === category && e.timestamp >= startTime)
      .reduce((sum, e) => sum + e.cost, 0);
  }

  // ==========================================================================
  // Budget Management
  // ==========================================================================

  checkBudget(): {
    withinBudget: boolean;
    dailyUsage: number;
    monthlyUsage: number;
    alerts: string[];
  } {
    if (!this.config.budget) {
      return {
        withinBudget: true,
        dailyUsage: 0,
        monthlyUsage: 0,
        alerts: [],
      };
    }

    const dailyCost = this.getDailyCost();
    const monthlyCost = this.getMonthlyCost();
    const alerts: string[] = [];

    const dailyUsage = dailyCost / this.config.budget.maxDailyCost;
    const monthlyUsage = monthlyCost / this.config.budget.maxMonthlyCost;

    if (dailyUsage >= 1) {
      alerts.push(`Daily budget exceeded: $${dailyCost.toFixed(4)} / $${this.config.budget.maxDailyCost}`);
    } else if (dailyUsage >= this.config.budget.alertThreshold) {
      alerts.push(`Daily budget warning: ${Math.round(dailyUsage * 100)}% used`);
    }

    if (monthlyUsage >= 1) {
      alerts.push(`Monthly budget exceeded: $${monthlyCost.toFixed(4)} / $${this.config.budget.maxMonthlyCost}`);
    } else if (monthlyUsage >= this.config.budget.alertThreshold) {
      alerts.push(`Monthly budget warning: ${Math.round(monthlyUsage * 100)}% used`);
    }

    return {
      withinBudget: dailyUsage < 1 && monthlyUsage < 1,
      dailyUsage,
      monthlyUsage,
      alerts,
    };
  }

  setBudget(budget: CostBudget): void {
    this.config.budget = budget;
  }

  // ==========================================================================
  // Model Cost Management
  // ==========================================================================

  setModelCost(modelCost: ModelCostConfig): void {
    this.modelCostMap.set(modelCost.modelId, modelCost);
  }

  getModelCost(modelId: string): ModelCostConfig | undefined {
    return this.modelCostMap.get(modelId);
  }

  estimateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const modelCost = this.modelCostMap.get(modelId);
    if (!modelCost) return 0;

    return (
      (inputTokens / 1000) * modelCost.inputTokenCost +
      (outputTokens / 1000) * modelCost.outputTokenCost
    );
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  clear(): void {
    this.entries = [];
    this.dailyCosts.clear();
    this.monthlyCosts.clear();
  }

  getRecentEntries(limit = 100): CostEntry[] {
    return this.entries.slice(-limit);
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private recordEntry(entry: Omit<CostEntry, "id" | "timestamp">): CostEntry {
    const fullEntry: CostEntry = {
      ...entry,
      id: `cost-${++this.entryIdCounter}`,
      timestamp: Date.now(),
    };

    this.entries.push(fullEntry);

    // Update aggregates
    const dateKey = this.getDateKey(new Date(fullEntry.timestamp));
    const monthKey = this.getMonthKey(new Date(fullEntry.timestamp));

    this.dailyCosts.set(dateKey, (this.dailyCosts.get(dateKey) ?? 0) + fullEntry.cost);
    this.monthlyCosts.set(monthKey, (this.monthlyCosts.get(monthKey) ?? 0) + fullEntry.cost);

    // Limit history
    if (this.entries.length > this.config.maxHistorySize) {
      this.entries.shift();
    }

    return fullEntry;
  }

  private getDateKey(date: Date): string {
    return date.toISOString().split("T")[0]!;
  }

  private getMonthKey(date: Date): string {
    return date.toISOString().slice(0, 7);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createCostAttribution(config?: Partial<CostAttributionConfig>): CostAttribution {
  return new CostAttribution(config);
}

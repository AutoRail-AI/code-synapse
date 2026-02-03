/**
 * Model Router Implementation
 *
 * Intelligent routing of requests to the best available model based on:
 * - Task type and requirements
 * - Quality, latency, and cost constraints
 * - Provider availability and health
 * - User-defined policies
 */

import type {
  IModelProvider,
  IModelRouter,
  ModelConfig,
  ModelRequest,
  ModelResponse,
  StreamChunk,
  TaskType,
  RoutingPolicy,
  RoutingDecision,
  RouterStats,
  ModelVendor,
} from "../interfaces/IModel.js";
import { ALL_MODELS, getAllProviderIds } from "../Registry.js";
import type { IFeedbackLoop, ModelOutcome } from "../../feedback/interfaces/IFeedback.js";
import { createLogger } from "../../telemetry/logger.js";
import * as crypto from "node:crypto";

const logger = createLogger("model-router");

// =============================================================================
// Default Routing Policy
// =============================================================================

/**
 * Get default fallback order from Registry
 * Prefers: google (best quality), local (always available), then others
 */
function getDefaultFallbackOrder(): ModelVendor[] {
  const allProviders = getAllProviderIds();
  // Preferred order: google first (high quality), local (always available), then alphabetical rest
  const preferred: ModelVendor[] = ["google", "local"];
  const rest = allProviders.filter((p) => !preferred.includes(p as ModelVendor)) as ModelVendor[];
  return [...preferred, ...rest.sort()];
}

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  preferLocal: false,
  maxLatencyMs: 20000,
  maxCostPerRequest: 0.20,
  qualityThreshold: 0.8,
  fallbackOrder: getDefaultFallbackOrder(),
};

// =============================================================================
// Model Router Implementation
// =============================================================================

export class ModelRouter implements IModelRouter {
  private providers: Map<ModelVendor, IModelProvider> = new Map();
  private modelCache: Map<string, { config: ModelConfig; provider: IModelProvider }> = new Map();
  private _isInitialized = false;
  private feedbackLoop: IFeedbackLoop | null = null;

  // Statistics
  private stats: RouterStats = {
    totalRequests: 0,
    requestsByModel: {},
    requestsByVendor: {
      local: 0,
      openai: 0,
      anthropic: 0,
      google: 0,
    },
    averageLatencyMs: 0,
    totalTokensUsed: 0,
    totalCost: 0,
    cacheHitRate: 0,
    fallbackCount: 0,
  };

  private totalLatencyMs = 0;
  private cacheHits = 0;

  async initialize(): Promise<void> {
    if (this._isInitialized) return;

    logger.debug("Initializing model router");

    // Initialize all registered providers
    const initPromises: Promise<void>[] = [];
    for (const provider of this.providers.values()) {
      initPromises.push(
        provider.initialize().catch((err) => {
          logger.warn({ vendor: provider.vendorId, error: err }, "Failed to initialize provider");
        })
      );
    }

    await Promise.all(initPromises);

    // Build model cache
    this.buildModelCache();

    this._isInitialized = true;
    logger.info({ providerCount: this.providers.size, modelCount: this.modelCache.size }, "Model router initialized");
  }

  registerProvider(provider: IModelProvider): void {
    this.providers.set(provider.vendorId, provider);
    logger.debug({ vendor: provider.vendorId }, "Registered model provider");
  }

  /**
   * Set the feedback loop for self-optimizing routing
   */
  setFeedbackLoop(feedbackLoop: IFeedbackLoop): void {
    this.feedbackLoop = feedbackLoop;
    logger.debug("Feedback loop attached to model router");
  }

  /**
   * Get the attached feedback loop
   */
  getFeedbackLoop(): IFeedbackLoop | null {
    return this.feedbackLoop;
  }

  getAllModels(): ModelConfig[] {
    const models: ModelConfig[] = [];
    for (const { config } of this.modelCache.values()) {
      models.push(config);
    }
    return models;
  }

  async route(taskType: TaskType, policy: RoutingPolicy = DEFAULT_ROUTING_POLICY): Promise<RoutingDecision> {
    const candidates = this.findCandidates(taskType, policy);

    if (candidates.length === 0) {
      throw new Error(`No model available for task type: ${taskType}`);
    }

    // Score and rank candidates
    const scored = candidates.map((c) => ({
      ...c,
      score: this.scoreModel(c.config, taskType, policy),
    }));

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0]!;
    const alternatives = scored.slice(1, 4).map((c) => ({
      modelId: c.config.id,
      reason: this.getSelectionReason(c.config, c.score, policy),
    }));

    return {
      modelId: best.config.id,
      modelConfig: best.config,
      provider: best.provider,
      reason: this.getSelectionReason(best.config, best.score, policy),
      alternatives,
    };
  }

  async execute(request: ModelRequest, policy: RoutingPolicy = DEFAULT_ROUTING_POLICY): Promise<ModelResponse> {
    const taskType = request.taskType ?? "generation";
    const routing = await this.route(taskType, policy);
    const requestId = this.generateRequestId();

    try {
      const startTime = Date.now();
      const response = await routing.provider.complete(routing.modelId, request);
      const latencyMs = Date.now() - startTime;

      this.recordRequest(routing.modelConfig, response, latencyMs);

      // Record successful outcome to feedback loop
      this.recordOutcome({
        requestId,
        modelId: routing.modelId,
        vendor: routing.modelConfig.vendor,
        taskType,
        success: true,
        latencyMs,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cost: this.calculateCost(routing.modelConfig, response.usage.inputTokens, response.usage.outputTokens),
        usedFallback: false,
        timestamp: new Date().toISOString(),
      });

      return response;
    } catch (error) {
      // Record failed outcome
      this.recordOutcome({
        requestId,
        modelId: routing.modelId,
        vendor: routing.modelConfig.vendor,
        taskType,
        success: false,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
        usedFallback: false,
        timestamp: new Date().toISOString(),
      });

      logger.warn({ modelId: routing.modelId, error }, "Primary model failed, trying fallback");

      // Try fallbacks
      for (const alt of routing.alternatives) {
        const cached = this.modelCache.get(alt.modelId);
        if (!cached) continue;

        // Skip if model is disabled by feedback loop
        if (this.feedbackLoop?.isModelDisabled(alt.modelId)) {
          continue;
        }

        try {
          const startTime = Date.now();
          const response = await cached.provider.complete(alt.modelId, request);
          const latencyMs = Date.now() - startTime;

          this.stats.fallbackCount++;
          this.recordRequest(cached.config, response, latencyMs);

          // Record successful fallback outcome
          this.recordOutcome({
            requestId: this.generateRequestId(),
            modelId: alt.modelId,
            vendor: cached.config.vendor,
            taskType,
            success: true,
            latencyMs,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            cost: this.calculateCost(cached.config, response.usage.inputTokens, response.usage.outputTokens),
            usedFallback: true,
            timestamp: new Date().toISOString(),
          });

          return response;
        } catch (fallbackError) {
          // Record failed fallback outcome
          this.recordOutcome({
            requestId: this.generateRequestId(),
            modelId: alt.modelId,
            vendor: cached.config.vendor,
            taskType,
            success: false,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            cost: 0,
            errorMessage: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            usedFallback: true,
            timestamp: new Date().toISOString(),
          });
          continue;
        }
      }

      throw error;
    }
  }

  async *executeStream(
    request: ModelRequest,
    policy: RoutingPolicy = DEFAULT_ROUTING_POLICY
  ): AsyncIterable<StreamChunk> {
    const taskType = request.taskType ?? "generation";
    const routing = await this.route(taskType, policy);

    const startTime = Date.now();
    let totalTokens = 0;

    try {
      for await (const chunk of routing.provider.stream(routing.modelId, request)) {
        yield chunk;

        if (chunk.usage) {
          totalTokens = chunk.usage.totalTokens;
        }
      }

      const latencyMs = Date.now() - startTime;
      this.recordStreamRequest(routing.modelConfig, totalTokens, latencyMs);
    } catch (error) {
      logger.error({ modelId: routing.modelId, error }, "Streaming failed");
      throw error;
    }
  }

  async embed(texts: string[], policy: RoutingPolicy = DEFAULT_ROUTING_POLICY): Promise<number[][]> {
    // Find an embedding-capable model
    const modifiedPolicy = {
      ...policy,
      requiredCapabilities: [...(policy.requiredCapabilities ?? []), "embedding" as const],
    };

    const routing = await this.route("embedding", modifiedPolicy);
    return routing.provider.embed(routing.modelId, texts);
  }

  getStats(): RouterStats {
    const total = this.stats.totalRequests;
    return {
      ...this.stats,
      averageLatencyMs: total > 0 ? this.totalLatencyMs / total : 0,
      cacheHitRate: total > 0 ? this.cacheHits / total : 0,
    };
  }

  async shutdown(): Promise<void> {
    logger.debug("Shutting down model router");

    const shutdownPromises: Promise<void>[] = [];
    for (const provider of this.providers.values()) {
      shutdownPromises.push(
        provider.shutdown().catch((err) => {
          logger.warn({ vendor: provider.vendorId, error: err }, "Error during provider shutdown");
        })
      );
    }

    await Promise.all(shutdownPromises);
    this._isInitialized = false;
    logger.info("Model router shutdown complete");
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private buildModelCache(): void {
    this.modelCache.clear();

    for (const provider of this.providers.values()) {
      if (!provider.isReady()) continue;

      for (const model of provider.getAvailableModels()) {
        this.modelCache.set(model.id, { config: model, provider });
      }
    }

    // Add static model configs for models we know about but provider might not expose
    for (const model of ALL_MODELS) {
      if (!this.modelCache.has(model.id)) {
        const provider = this.providers.get(model.vendor);
        if (provider?.isReady()) {
          this.modelCache.set(model.id, { config: model, provider });
        }
      }
    }
  }

  private findCandidates(
    taskType: TaskType,
    policy: RoutingPolicy
  ): Array<{ config: ModelConfig; provider: IModelProvider }> {
    const candidates: Array<{ config: ModelConfig; provider: IModelProvider }> = [];

    for (const [, { config, provider }] of this.modelCache) {
      // Skip models disabled by feedback loop
      if (this.feedbackLoop?.isModelDisabled(config.id)) {
        continue;
      }

      // Check task support
      if (!config.supportedTasks.includes(taskType)) continue;

      // Check required capabilities
      if (policy.requiredCapabilities) {
        const hasAll = policy.requiredCapabilities.every((cap) => config.capabilities.includes(cap));
        if (!hasAll) continue;
      }

      // Check vendor preference
      if (policy.preferredVendors && !policy.preferredVendors.includes(config.vendor)) {
        continue;
      }

      // Check quality threshold
      if (policy.qualityThreshold && config.qualityScore < policy.qualityThreshold) {
        continue;
      }

      // Check latency constraint
      if (policy.maxLatencyMs && config.latencyMs.typical > policy.maxLatencyMs) {
        continue;
      }

      // Estimate cost and check constraint
      if (policy.maxCostPerRequest) {
        const estimatedCost = (config.costPer1kInputTokens + config.costPer1kOutputTokens) * 2; // ~2k tokens typical
        if (estimatedCost > policy.maxCostPerRequest) {
          continue;
        }
      }

      candidates.push({ config, provider });
    }

    return candidates;
  }

  private scoreModel(config: ModelConfig, _taskType: TaskType, policy: RoutingPolicy): number {
    let score = config.qualityScore * 100;

    // Boost for local models if preferred
    if (policy.preferLocal && config.isLocal) {
      score += 30;
    }

    // Boost for lower latency
    const latencyFactor = 1 - Math.min(config.latencyMs.typical / 5000, 1);
    score += latencyFactor * 20;

    // Boost for lower cost
    const costFactor = 1 - Math.min((config.costPer1kInputTokens + config.costPer1kOutputTokens) / 0.02, 1);
    score += costFactor * 15;

    // Boost for larger context window
    const contextFactor = Math.min(config.contextWindow / 200000, 1);
    score += contextFactor * 10;

    // Vendor preference order bonus
    if (policy.fallbackOrder) {
      const vendorIndex = policy.fallbackOrder.indexOf(config.vendor);
      if (vendorIndex >= 0) {
        score += (policy.fallbackOrder.length - vendorIndex) * 5;
      }
    }

    // Apply feedback-based adjustments
    if (this.feedbackLoop) {
      score = this.feedbackLoop.getAdjustedScore(config.id, score);
    }

    return score;
  }

  private getSelectionReason(config: ModelConfig, score: number, policy: RoutingPolicy): string {
    const reasons: string[] = [];

    if (policy.preferLocal && config.isLocal) {
      reasons.push("local model preferred");
    }

    if (config.qualityScore >= 0.9) {
      reasons.push("high quality");
    }

    if (config.costPer1kInputTokens === 0) {
      reasons.push("zero cost");
    } else if (config.costPer1kInputTokens < 0.001) {
      reasons.push("low cost");
    }

    if (config.latencyMs.typical < 1000) {
      reasons.push("low latency");
    }

    if (reasons.length === 0) {
      reasons.push(`score: ${score.toFixed(1)}`);
    }

    return reasons.join(", ");
  }

  private recordRequest(config: ModelConfig, response: ModelResponse, latencyMs: number): void {
    this.stats.totalRequests++;
    this.stats.requestsByModel[config.id] = (this.stats.requestsByModel[config.id] ?? 0) + 1;
    this.stats.requestsByVendor[config.vendor] = (this.stats.requestsByVendor[config.vendor] ?? 0) + 1;
    this.stats.totalTokensUsed += response.usage.totalTokens;
    this.totalLatencyMs += latencyMs;

    const cost =
      (response.usage.inputTokens / 1000) * config.costPer1kInputTokens +
      (response.usage.outputTokens / 1000) * config.costPer1kOutputTokens;
    this.stats.totalCost += cost;

    if (response.cached) {
      this.cacheHits++;
    }
  }

  private recordStreamRequest(config: ModelConfig, totalTokens: number, latencyMs: number): void {
    this.stats.totalRequests++;
    this.stats.requestsByModel[config.id] = (this.stats.requestsByModel[config.id] ?? 0) + 1;
    this.stats.requestsByVendor[config.vendor] = (this.stats.requestsByVendor[config.vendor] ?? 0) + 1;
    this.stats.totalTokensUsed += totalTokens;
    this.totalLatencyMs += latencyMs;
  }

  private recordOutcome(outcome: ModelOutcome): void {
    if (this.feedbackLoop) {
      this.feedbackLoop.recordOutcome(outcome);
    }
  }

  private calculateCost(config: ModelConfig, inputTokens: number, outputTokens: number): number {
    return (
      (inputTokens / 1000) * config.costPer1kInputTokens +
      (outputTokens / 1000) * config.costPer1kOutputTokens
    );
  }

  private generateRequestId(): string {
    return crypto.randomUUID();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createModelRouter(): ModelRouter {
  return new ModelRouter();
}

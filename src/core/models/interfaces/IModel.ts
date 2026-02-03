/**
 * Model Abstraction Interfaces
 *
 * Unified interface for interacting with various LLM providers:
 * - Local models (node-llama-cpp)
 * - OpenAI (GPT-4, GPT-4o, GPT-4o-mini)
 * - Anthropic (Claude 3.5 Sonnet, Claude 3 Haiku)
 * - Google (Gemini 1.5 Pro, Gemini 1.5 Flash)
 */

// =============================================================================
// Model Types
// =============================================================================

export type ModelVendor = "local" | "openai" | "anthropic" | "google";

export type ModelCapability =
  | "text-generation"
  | "code-generation"
  | "code-analysis"
  | "embedding"
  | "function-calling"
  | "vision"
  | "streaming";

export type TaskType =
  | "justification"
  | "classification"
  | "analysis"
  | "summarization"
  | "generation"
  | "extraction"
  | "embedding";

// =============================================================================
// Model Configuration
// =============================================================================

export interface ModelConfig {
  id: string;
  name: string;
  vendor: ModelVendor;
  capabilities: ModelCapability[];
  contextWindow: number;
  maxOutputTokens: number;
  costPer1kInputTokens: number;
  costPer1kOutputTokens: number;
  latencyMs: {
    typical: number;
    p95: number;
  };
  qualityScore: number; // 0-1, relative quality rating
  isLocal: boolean;
  requiresApiKey: boolean;
  supportedTasks: TaskType[];
}

export interface ModelParameters {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  frequencyPenalty?: number;
  presencePenalty?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  mediaResolution?: "low" | "medium" | "high" | "ultra_high";
}

// =============================================================================
// Request/Response Types
// =============================================================================

export interface ModelRequest {
  prompt: string;
  systemPrompt?: string;
  parameters?: ModelParameters;
  taskType?: TaskType;
  schema?: object; // JSON schema for structured output
  images?: string[]; // Base64 encoded images for vision
  functions?: FunctionDefinition[];
}

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: object; // JSON schema
}

export interface ModelResponse {
  content: string;
  finishReason: "stop" | "length" | "function_call" | "content_filter" | "error";
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  modelId: string;
  cached?: boolean;
  parsed?: any; // Structured output data
  functionCall?: {
    name: string;
    arguments: string;
  };
}

export interface StreamChunk {
  content: string;
  done: boolean;
  usage?: ModelResponse["usage"];
}

// =============================================================================
// Model Provider Interface
// =============================================================================

export interface IModelProvider {
  readonly vendorId: ModelVendor;
  readonly isAvailable: boolean;

  /**
   * Initialize the provider (load models, verify API keys, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Check if provider is ready to accept requests
   */
  isReady(): boolean;

  /**
   * Get available models from this provider
   */
  getAvailableModels(): ModelConfig[];

  /**
   * Get a specific model by ID
   */
  getModel(modelId: string): ModelConfig | undefined;

  /**
   * Generate a completion
   */
  complete(modelId: string, request: ModelRequest): Promise<ModelResponse>;

  /**
   * Generate a streaming completion
   */
  stream(modelId: string, request: ModelRequest): AsyncIterable<StreamChunk>;

  /**
   * Generate embeddings
   */
  embed(modelId: string, texts: string[]): Promise<number[][]>;

  /**
   * Estimate token count for text
   */
  estimateTokens(text: string): number;

  /**
   * Shutdown and cleanup resources
   */
  shutdown(): Promise<void>;
}

// =============================================================================
// Model Router Interface
// =============================================================================

export interface RoutingPolicy {
  preferLocal: boolean;
  maxLatencyMs?: number;
  maxCostPerRequest?: number;
  requiredCapabilities?: ModelCapability[];
  preferredVendors?: ModelVendor[];
  fallbackOrder?: ModelVendor[];
  qualityThreshold?: number;
}

export interface RoutingDecision {
  modelId: string;
  modelConfig: ModelConfig;
  provider: IModelProvider;
  reason: string;
  alternatives: Array<{
    modelId: string;
    reason: string;
  }>;
}

export interface IModelRouter {
  /**
   * Initialize all providers
   */
  initialize(): Promise<void>;

  /**
   * Register a model provider
   */
  registerProvider(provider: IModelProvider): void;

  /**
   * Get all available models across providers
   */
  getAllModels(): ModelConfig[];

  /**
   * Route a request to the best model based on policy
   */
  route(taskType: TaskType, policy?: RoutingPolicy): Promise<RoutingDecision>;

  /**
   * Execute a request with automatic routing
   */
  execute(request: ModelRequest, policy?: RoutingPolicy): Promise<ModelResponse>;

  /**
   * Execute a streaming request with automatic routing
   */
  executeStream(request: ModelRequest, policy?: RoutingPolicy): AsyncIterable<StreamChunk>;

  /**
   * Generate embeddings with the best available model
   */
  embed(texts: string[], policy?: RoutingPolicy): Promise<number[][]>;

  /**
   * Get routing statistics
   */
  getStats(): RouterStats;

  /**
   * Shutdown all providers
   */
  shutdown(): Promise<void>;
}

export interface RouterStats {
  totalRequests: number;
  requestsByModel: Record<string, number>;
  requestsByVendor: Record<ModelVendor, number>;
  averageLatencyMs: number;
  totalTokensUsed: number;
  totalCost: number;
  cacheHitRate: number;
  fallbackCount: number;
}

// =============================================================================
// Model Registry
// =============================================================================

export interface ModelRegistry {
  models: ModelConfig[];
  defaultModel: string;
  embeddingModel: string;
}



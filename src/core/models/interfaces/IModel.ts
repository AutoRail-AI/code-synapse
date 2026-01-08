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

// =============================================================================
// Built-in Model Configurations
// =============================================================================

export const LOCAL_MODELS: ModelConfig[] = [
  {
    id: "qwen2.5-coder-0.5b",
    name: "Qwen 2.5 Coder 0.5B",
    vendor: "local",
    capabilities: ["text-generation", "code-generation", "code-analysis"],
    contextWindow: 32768,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    latencyMs: { typical: 500, p95: 1000 },
    qualityScore: 0.5,
    isLocal: true,
    requiresApiKey: false,
    supportedTasks: ["classification", "extraction"],
  },
  {
    id: "qwen2.5-coder-1.5b",
    name: "Qwen 2.5 Coder 1.5B",
    vendor: "local",
    capabilities: ["text-generation", "code-generation", "code-analysis"],
    contextWindow: 32768,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    latencyMs: { typical: 800, p95: 1500 },
    qualityScore: 0.6,
    isLocal: true,
    requiresApiKey: false,
    supportedTasks: ["classification", "extraction", "summarization"],
  },
  {
    id: "qwen2.5-coder-3b",
    name: "Qwen 2.5 Coder 3B",
    vendor: "local",
    capabilities: ["text-generation", "code-generation", "code-analysis"],
    contextWindow: 32768,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    latencyMs: { typical: 1200, p95: 2500 },
    qualityScore: 0.7,
    isLocal: true,
    requiresApiKey: false,
    supportedTasks: ["justification", "classification", "extraction", "summarization"],
  },
  {
    id: "qwen2.5-coder-7b",
    name: "Qwen 2.5 Coder 7B",
    vendor: "local",
    capabilities: ["text-generation", "code-generation", "code-analysis"],
    contextWindow: 32768,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    latencyMs: { typical: 2000, p95: 4000 },
    qualityScore: 0.8,
    isLocal: true,
    requiresApiKey: false,
    supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
  },
];

export const OPENAI_MODELS: ModelConfig[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    vendor: "openai",
    capabilities: ["text-generation", "code-generation", "code-analysis", "function-calling", "vision"],
    contextWindow: 128000,
    maxOutputTokens: 16384,
    costPer1kInputTokens: 0.005,
    costPer1kOutputTokens: 0.015,
    latencyMs: { typical: 1500, p95: 5000 },
    qualityScore: 0.95,
    isLocal: false,
    requiresApiKey: true,
    supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    vendor: "openai",
    capabilities: ["text-generation", "code-generation", "code-analysis", "function-calling"],
    contextWindow: 128000,
    maxOutputTokens: 16384,
    costPer1kInputTokens: 0.00015,
    costPer1kOutputTokens: 0.0006,
    latencyMs: { typical: 800, p95: 2000 },
    qualityScore: 0.85,
    isLocal: false,
    requiresApiKey: true,
    supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
  },
];

export const ANTHROPIC_MODELS: ModelConfig[] = [
  {
    id: "claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    vendor: "anthropic",
    capabilities: ["text-generation", "code-generation", "code-analysis", "function-calling", "vision"],
    contextWindow: 200000,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0.003,
    costPer1kOutputTokens: 0.015,
    latencyMs: { typical: 1200, p95: 4000 },
    qualityScore: 0.95,
    isLocal: false,
    requiresApiKey: true,
    supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
  },
  {
    id: "claude-3-haiku",
    name: "Claude 3 Haiku",
    vendor: "anthropic",
    capabilities: ["text-generation", "code-generation", "code-analysis"],
    contextWindow: 200000,
    maxOutputTokens: 4096,
    costPer1kInputTokens: 0.00025,
    costPer1kOutputTokens: 0.00125,
    latencyMs: { typical: 500, p95: 1500 },
    qualityScore: 0.8,
    isLocal: false,
    requiresApiKey: true,
    supportedTasks: ["classification", "extraction", "summarization"],
  },
];

export const GOOGLE_MODELS: ModelConfig[] = [
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    vendor: "google",
    capabilities: ["text-generation", "code-generation", "code-analysis", "function-calling", "vision"],
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0.00125,
    costPer1kOutputTokens: 0.005,
    latencyMs: { typical: 1000, p95: 3000 },
    qualityScore: 0.9,
    isLocal: false,
    requiresApiKey: true,
    supportedTasks: ["justification", "classification", "analysis", "extraction", "summarization", "generation"],
  },
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    vendor: "google",
    capabilities: ["text-generation", "code-generation", "code-analysis"],
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0.000075,
    costPer1kOutputTokens: 0.0003,
    latencyMs: { typical: 400, p95: 1000 },
    qualityScore: 0.8,
    isLocal: false,
    requiresApiKey: true,
    supportedTasks: ["classification", "extraction", "summarization"],
  },
];

export const ALL_MODELS: ModelConfig[] = [
  ...LOCAL_MODELS,
  ...OPENAI_MODELS,
  ...ANTHROPIC_MODELS,
  ...GOOGLE_MODELS,
];

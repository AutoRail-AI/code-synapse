/**
 * LLM Integration Module
 *
 * Provides local LLM inference capabilities using node-llama-cpp:
 * - LLMService: Core model management and inference
 * - BusinessLogicInferrer: Function summarization with confidence scoring
 * - GraphRAGSummarizer: Hierarchical summaries (Function → File → Module → System)
 *
 * @module
 */

// Core LLM Service
export {
  LLMService,
  createLLMService,
  createInitializedLLMService,
  createLLMServiceWithPreset,
  createInitializedLLMServiceWithPreset,
  type LLMServiceConfig,
  type InferenceOptions,
  type InferenceResult,
  type LLMStats,
} from "./llm-service.js";

// Business Logic Inference
export {
  BusinessLogicInferrer,
  createBusinessLogicInferrer,
  type FunctionContext,
  type InferenceOutput,
  type InferredBusinessLogic,
  type BusinessLogicInferrerConfig,
} from "./business-logic-inferrer.js";

// GraphRAG Summarization
export {
  GraphRAGSummarizer,
  createGraphRAGSummarizer,
  type FunctionSummary,
  type FileSummary,
  type ModuleSummary,
  type SystemSummary,
  type SummaryHierarchy,
  type GraphRAGConfig,
} from "./graph-rag-summarizer.js";

// API-based LLM Service (Anthropic, OpenAI, Google)
export {
  APILLMService,
  createAPILLMService,
  createInitializedAPILLMService,
  type APIProvider,
  type APILLMServiceConfig,
} from "./api-llm-service.js";

// LLM Service Interface
export type { ILLMService } from "./interfaces/ILLMService.js";

// Model Registry and Selection
export {
  MODEL_REGISTRY,
  MODEL_PRESETS,
  getAvailableModels,
  getModelById,
  filterModels,
  resolveModel,
  getModelsDirectory,
  isModelDownloaded,
  getModelPath,
  listDownloadedModels,
  getRecommendedModel,
  getModelsByFamily,
  formatModelInfo,
  printModelComparison,
  getModelFromPreset,
  getModelSelectionGuide,
  getRecommendationForSystem,
  type ModelFamily,
  type ModelSize,
  type ModelTask,
  type ModelSpec,
  type ModelResolution,
  type ModelPreset,
} from "./models.js";

// Model Configurations (context windows, rate limits, pricing)
export {
  ALL_MODELS,
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  GOOGLE_MODELS,
  LOCAL_MODELS,
  getModelConfig,
  getContextWindow,
  getRecommendedBatchSize,
  calculateOptimalBatchSize,
  getModelsByProvider,
  getDefaultModelForProvider,
  getRateLimits,
  isLocalModel,
  isApiModel,
  type ModelConfig,
  type ModelRateLimits,
  type ModelPricing,
} from "./model-configs.js";

/**
 * LLM Service Interface
 *
 * Black-box interface for LLM inference operations.
 * Allows swapping implementations without affecting consumers.
 */

/**
 * JSON schema type for structured output
 */
export type JsonSchema = Record<string, unknown>;

/**
 * Options for inference requests
 */
export interface InferenceOptions {
  /** Maximum tokens to generate (default: 512) */
  maxTokens?: number;
  /** Temperature for sampling (default: 0.7) */
  temperature?: number;
  /** Stop sequences to end generation */
  stopSequences?: string[];
  /** JSON schema for structured output */
  jsonSchema?: JsonSchema;
  /** Skip cache lookup for this request */
  skipCache?: boolean;
  /** Thinking level for reasoning models (e.g. Gemini 3) */
  thinkingLevel?: "low" | "high";
}

/**
 * Result of an inference operation
 */
export interface InferenceResult {
  /** Generated text */
  text: string;
  /** Parsed JSON if jsonSchema was provided */
  parsed?: unknown;
  /** Whether result came from cache */
  fromCache: boolean;
  /** Tokens generated (estimated) */
  tokensGenerated: number;
  /** Generation time in ms */
  durationMs: number;
}

/**
 * LLM service statistics
 */
export interface LLMStats {
  /** Total inference calls */
  totalCalls: number;
  /** Cache hits */
  cacheHits: number;
  /** Cache misses */
  cacheMisses: number;
  /** Total tokens generated */
  totalTokens: number;
  /** Average generation time in ms */
  avgDurationMs: number;
  /** Model loaded status */
  modelLoaded: boolean;
}

/**
 * LLM Service Interface
 *
 * Provides inference capabilities for code analysis,
 * classification, and summarization.
 */
export interface ILLMService {
  /**
   * Whether the service is initialized and ready
   */
  readonly isReady: boolean;

  /**
   * Initialize the service
   */
  initialize(): Promise<void>;

  /**
   * Run inference with the given prompt
   */
  infer(prompt: string, options?: InferenceOptions): Promise<InferenceResult>;

  /**
   * Get service statistics
   */
  getStats(): LLMStats;

  /**
   * Clear the inference cache
   */
  clearCache(): void;

  /**
   * Shutdown the service
   */
  shutdown(): Promise<void>;
}

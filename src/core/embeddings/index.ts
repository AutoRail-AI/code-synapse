/**
 * HuggingFace Transformers Embedding Service
 *
 * Generates vector embeddings for semantic search using local ONNX models.
 * Part of Phase 6: Semantic Similarity & Related Code Discovery.
 *
 * Uses @huggingface/transformers for local inference without external API calls.
 *
 * @module
 */

import type { EmbeddingResult } from "../../types/index.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("embedding-service");

// Lazy load the transformers library to avoid blocking startup
let pipeline: typeof import("@huggingface/transformers").pipeline | null = null;
let featureExtractor: unknown = null;

/**
 * Interface for the embedding service.
 */
export interface IEmbeddingService {
  initialize(): Promise<void>;
  embed(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
  isInitialized(): boolean;
  getModelId(): string;
  getDimension(): number;
}

/**
 * Options for the embedding service.
 */
export interface EmbeddingServiceOptions {
  /** Model ID from Hugging Face Hub */
  modelId?: string;
  /** Maximum text length (truncated if exceeded) */
  maxLength?: number;
  /** Whether to normalize embeddings */
  normalize?: boolean;
  /** Batch size for processing */
  batchSize?: number;
}

const DEFAULT_OPTIONS: Required<EmbeddingServiceOptions> = {
  modelId: "Xenova/all-MiniLM-L6-v2",
  maxLength: 512,
  normalize: true,
  batchSize: 32,
};

/**
 * Embedding Service using HuggingFace Transformers.
 *
 * Generates dense vector embeddings for text using local ONNX models.
 * The embeddings can be used for semantic similarity search.
 *
 * @example
 * ```typescript
 * const service = createEmbeddingService();
 * await service.initialize();
 *
 * const result = await service.embed("function that validates user input");
 * console.log(result.vector.length); // 384 for MiniLM
 * ```
 */
export class EmbeddingService implements IEmbeddingService {
  private options: Required<EmbeddingServiceOptions>;
  private initialized = false;
  private dimension = 384; // Default for MiniLM

  constructor(options?: EmbeddingServiceOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Set dimension based on model
    if (this.options.modelId.includes("MiniLM")) {
      this.dimension = 384;
    } else if (this.options.modelId.includes("mpnet")) {
      this.dimension = 768;
    }
  }

  /**
   * Initialize the embedding model.
   * Loads the ONNX model from HuggingFace Hub.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      logger.info({ modelId: this.options.modelId }, "Loading embedding model");

      // Dynamically import transformers to avoid issues in tests
      const transformers = await import("@huggingface/transformers");
      pipeline = transformers.pipeline;

      // Create the feature extraction pipeline
      featureExtractor = await pipeline("feature-extraction", this.options.modelId, {
        // Use ONNX runtime for efficient inference
        device: "cpu",
        dtype: "fp32",
      });

      this.initialized = true;
      logger.info({ modelId: this.options.modelId }, "Embedding model loaded");
    } catch (error) {
      logger.error({ error, modelId: this.options.modelId }, "Failed to load embedding model");
      throw new Error(`Failed to initialize embedding model: ${error}`);
    }
  }

  /**
   * Generate embedding for a single text.
   *
   * @param text - The text to embed
   * @returns Embedding result with vector
   */
  async embed(text: string): Promise<EmbeddingResult> {
    if (!this.initialized || !featureExtractor) {
      throw new Error("Embedding service not initialized. Call initialize() first.");
    }

    try {
      // Truncate text if needed
      const truncatedText = text.slice(0, this.options.maxLength);

      // Generate embedding
      const result = await (featureExtractor as (text: string, options?: { pooling: string; normalize: boolean }) => Promise<{ data: number[] }>)(
        truncatedText,
        { pooling: "mean", normalize: this.options.normalize }
      );

      // Extract the vector from the result
      const vector = Array.from(result.data);

      return {
        text: truncatedText,
        vector,
        model: this.options.modelId,
      };
    } catch (error) {
      logger.error({ error, textLength: text.length }, "Failed to generate embedding");
      throw new Error(`Failed to generate embedding: ${error}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch.
   *
   * @param texts - Array of texts to embed
   * @returns Array of embedding results
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.initialized || !featureExtractor) {
      throw new Error("Embedding service not initialized. Call initialize() first.");
    }

    const results: EmbeddingResult[] = [];

    // Process in batches to manage memory
    for (let i = 0; i < texts.length; i += this.options.batchSize) {
      const batch = texts.slice(i, i + this.options.batchSize);

      // Process each text in the batch
      // Note: @huggingface/transformers processes one at a time internally
      for (const text of batch) {
        try {
          const result = await this.embed(text);
          results.push(result);
        } catch (error) {
          logger.warn({ error, text: text.slice(0, 50) }, "Failed to embed text, using zero vector");
          results.push({
            text: text.slice(0, this.options.maxLength),
            vector: new Array(this.dimension).fill(0),
            model: this.options.modelId,
          });
        }
      }

      // Log progress for large batches
      if (texts.length > 100 && (i + this.options.batchSize) % 100 === 0) {
        logger.debug(
          { progress: Math.min(i + this.options.batchSize, texts.length), total: texts.length },
          "Embedding batch progress"
        );
      }
    }

    return results;
  }

  /**
   * Check if the service is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the model ID.
   */
  getModelId(): string {
    return this.options.modelId;
  }

  /**
   * Get the embedding dimension.
   */
  getDimension(): number {
    return this.dimension;
  }
}

/**
 * Create an embedding service instance.
 */
export function createEmbeddingService(options?: EmbeddingServiceOptions): EmbeddingService {
  return new EmbeddingService(options);
}

// Re-export types
export type { EmbeddingResult };

// Re-export similarity service
export {
  SimilarityService,
  createSimilarityService,
  type ISimilarityService,
  type SimilarEntity,
  type SimilaritySearchOptions,
  type ClusterOptions,
  type CodeCluster,
} from "./similarity-service.js";

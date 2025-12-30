/**
 * IExtractor - UCE to graph entity converter
 *
 * Converts parsed UCE files into CozoBatch format for database storage.
 * This interface formalizes the existing EntityPipeline API from V5.
 *
 * @module
 */

import type { UCEFile } from "../../types/uce.js";
import type { CozoBatch, ExtractionResult, ExtractionStats } from "../extraction/types.js";

/**
 * Extractor options.
 */
export interface ExtractorOptions {
  /** Project root directory */
  projectRoot: string;
  /** Whether to extract embedding text */
  extractEmbeddings?: boolean;
  /** Whether to track call sites for Pass 2 */
  trackCalls?: boolean;
}

/**
 * Extractor interface for converting UCE to graph entities.
 *
 * @example
 * ```typescript
 * const extractor = createExtractor({ projectRoot: '/project' });
 *
 * // Extract from parsed file
 * const result = await extractor.extract(uceFile, fileHash, fileSize);
 *
 * // Check for errors
 * if (result.errors.length > 0) {
 *   console.warn('Extraction errors:', result.errors);
 * }
 *
 * // Merge multiple batches
 * const merged = extractor.mergeBatches([result1.batch, result2.batch]);
 *
 * // Get statistics
 * const stats = extractor.getBatchStats(merged);
 * ```
 */
export interface IExtractor {
  /**
   * Extract graph entities from parsed file
   * @param uceFile - Parsed file from IParser
   * @param fileHash - Content hash for change detection
   * @param fileSize - File size in bytes
   * @param framework - Detected framework (optional)
   */
  extract(
    uceFile: UCEFile,
    fileHash: string,
    fileSize: number,
    framework?: string | null
  ): Promise<ExtractionResult>;

  /**
   * Merge multiple extraction batches
   * Deduplicates ghost nodes automatically
   */
  mergeBatches(batches: CozoBatch[]): CozoBatch;

  /**
   * Get statistics for a batch
   */
  getBatchStats(batch: CozoBatch): Record<string, number>;
}

/**
 * Factory function type for creating extractors.
 */
export type CreateExtractor = (options: ExtractorOptions) => IExtractor;

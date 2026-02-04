/**
 * Indexer Coordinator
 *
 * Orchestrates the full indexing pipeline: Scan → Parse → Extract → Write
 * Provides progress reporting and error recovery.
 *
 * @module
 */

import type { IParser } from "../interfaces/IParser.js";
import type { IGraphStore } from "../interfaces/IGraphStore.js";
import type { DetectedProject } from "./project-detector.js";
import type { FileInfo } from "./scanner.js";
import type { ExtractionResult as _ExtractionResult } from "../extraction/types.js";
import type { WriteResult, GraphFileInfo } from "../graph-builder/index.js";

import { FileScanner } from "./scanner.js";
import { EntityPipeline } from "../extraction/pipeline.js";
import { GraphWriter, IncrementalUpdater } from "../graph-builder/index.js";
import { createLogger } from "../../utils/logger.js";
import { mapConcurrent } from "../../utils/async.js";
import {
  SemanticAnalysisService,
  type SemanticAnalysisServiceOptions,
  PatternAnalysisService,
  convertUCEToPatternContext,
  type PatternDetectionOptions,
} from "../analysis/index.js";
import type {
  DesignPatternRow,
  PatternParticipantRow,
  HasPatternRow,
  PatternHasParticipantRow,
} from "../extraction/types.js";
import { generateEntityId } from "../extraction/id-generator.js";

const logger = createLogger("indexer-coordinator");

// =============================================================================
// Types
// =============================================================================

/**
 * Indexing phases
 */
export type IndexingPhase = "scanning" | "parsing" | "extracting" | "writing" | "complete";

/**
 * Progress event for indexing
 */
export interface IndexingProgressEvent {
  /** Current phase */
  phase: IndexingPhase;
  /** Current file being processed (if applicable) */
  currentFile?: string;
  /** Number of items processed in current phase */
  processed: number;
  /** Total items in current phase */
  total: number;
  /** Overall percentage complete (0-100) */
  percentage: number;
  /** Message describing current activity */
  message: string;
}

/**
 * Error during indexing
 */
export interface IndexingError {
  /** File that caused the error */
  filePath: string;
  /** Phase where error occurred */
  phase: IndexingPhase;
  /** Error message */
  error: string;
  /** Whether the error is recoverable */
  recoverable: boolean;
}

/**
 * Result of indexing operation
 */
export interface IndexingCoordinatorResult {
  /** Whether indexing completed successfully */
  success: boolean;
  /** Number of files indexed */
  filesIndexed: number;
  /** Number of files that failed */
  filesFailed: number;
  /** Total entities written */
  entitiesWritten: number;
  /** Total relationships written */
  relationshipsWritten: number;
  /** Time taken in milliseconds */
  durationMs: number;
  /** Errors encountered */
  errors: IndexingError[];
  /** Phase statistics */
  phases: {
    scanning: { files: number; durationMs: number };
    parsing: { files: number; durationMs: number };
    extracting: { files: number; durationMs: number };
    writing: { files: number; durationMs: number };
  };
}

/**
 * Options for IndexerCoordinator
 */
export interface IndexerCoordinatorOptions {
  /** Parser implementation */
  parser: IParser;
  /** Graph store implementation */
  store: IGraphStore;
  /** Project configuration */
  project: DetectedProject;
  /** Batch size for processing files (default: 10) */
  batchSize?: number;
  /** Concurrency limit for processing files (default: 4) */
  concurrency?: number;
  /** Whether to continue on errors (default: true) */
  continueOnError?: boolean;
  /** Progress callback */
  onProgress?: (event: IndexingProgressEvent) => void;
  /** Error callback */
  onError?: (error: IndexingError) => void;
  /** Enable Phase 1 semantic analysis (parameter, return, error analysis) */
  enableSemanticAnalysis?: boolean;
  /** Options for semantic analysis */
  semanticAnalysisOptions?: SemanticAnalysisServiceOptions;
  /** Enable Phase 4 pattern detection */
  enablePatternDetection?: boolean;
  /** Options for pattern detection */
  patternDetectionOptions?: PatternDetectionOptions;
}

// =============================================================================
// IndexerCoordinator Implementation
// =============================================================================

/**
 * Orchestrates the full indexing pipeline.
 *
 * @example
 * ```typescript
 * const coordinator = new IndexerCoordinator({
 *   parser,
 *   store,
 *   project,
 *   onProgress: (event) => {
 *     console.log(`${event.phase}: ${event.percentage}%`);
 *   }
 * });
 *
 * // Full project indexing
 * const result = await coordinator.indexProject();
 *
 * // Incremental update
 * const incrementalResult = await coordinator.indexProjectIncremental();
 * ```
 */
export class IndexerCoordinator {
  private parser: IParser;
  private store: IGraphStore;
  private project: DetectedProject;
  private scanner: FileScanner;
  private pipeline: EntityPipeline;
  private writer: GraphWriter;
  private updater: IncrementalUpdater;
  private semanticAnalyzer: SemanticAnalysisService | null = null;
  private patternAnalyzer: PatternAnalysisService | null = null;
  private options: Required<Omit<IndexerCoordinatorOptions, "onProgress" | "onError" | "semanticAnalysisOptions" | "patternDetectionOptions">> & {
    onProgress?: (event: IndexingProgressEvent) => void;
    onError?: (error: IndexingError) => void;
    semanticAnalysisOptions?: SemanticAnalysisServiceOptions;
    patternDetectionOptions?: PatternDetectionOptions;
  };

  constructor(options: IndexerCoordinatorOptions) {
    this.parser = options.parser;
    this.store = options.store;
    this.project = options.project;

    this.options = {
      parser: options.parser,
      store: options.store,
      project: options.project,
      batchSize: options.batchSize ?? 10,
      concurrency: options.concurrency ?? 4,
      continueOnError: options.continueOnError ?? true,
      enableSemanticAnalysis: options.enableSemanticAnalysis ?? false,
      enablePatternDetection: options.enablePatternDetection ?? false,
      onProgress: options.onProgress,
      onError: options.onError,
      semanticAnalysisOptions: options.semanticAnalysisOptions,
      patternDetectionOptions: options.patternDetectionOptions,
    };

    // Initialize components
    this.scanner = new FileScanner(this.project);
    this.pipeline = new EntityPipeline({ projectRoot: this.project.rootPath });
    this.writer = new GraphWriter(this.store);
    this.updater = new IncrementalUpdater(this.store);

    // Initialize semantic analyzer if enabled
    if (this.options.enableSemanticAnalysis) {
      this.semanticAnalyzer = new SemanticAnalysisService(this.options.semanticAnalysisOptions);
      logger.info("Semantic analysis enabled");
    }

    // Initialize pattern analyzer if enabled
    if (this.options.enablePatternDetection) {
      this.patternAnalyzer = new PatternAnalysisService(this.options.patternDetectionOptions);
      logger.info("Pattern detection enabled");
    }
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Indexes the entire project from scratch.
   * Clears existing data and reindexes all files.
   */
  async indexProject(): Promise<IndexingCoordinatorResult> {
    const startTime = Date.now();
    const errors: IndexingError[] = [];
    const phaseStats = {
      scanning: { files: 0, durationMs: 0 },
      parsing: { files: 0, durationMs: 0 },
      extracting: { files: 0, durationMs: 0 },
      writing: { files: 0, durationMs: 0 },
    };

    let totalEntitiesWritten = 0;
    let totalRelationshipsWritten = 0;

    try {
      // Phase 1: Scanning
      this.emitProgress("scanning", 0, 0, 0, "Discovering files...");
      const scanStart = Date.now();
      const files = await this.scanFiles();
      phaseStats.scanning = { files: files.length, durationMs: Date.now() - scanStart };

      logger.info({ fileCount: files.length }, "Scanning complete");

      if (files.length === 0) {
        return this.buildResult(true, 0, 0, 0, 0, Date.now() - startTime, errors, phaseStats);
      }

      // Phase 2-4: Process files in batches
      const batches = this.chunk(files, this.options.batchSize);
      let processedFiles = 0;

      for (const batch of batches) {
        const batchResults = await this.processBatch(
          batch,
          processedFiles,
          files.length,
          errors,
          phaseStats
        );

        for (const result of batchResults) {
          if (result.success) {
            totalEntitiesWritten += result.stats.entitiesWritten;
            totalRelationshipsWritten += result.stats.relationshipsWritten;
          }
        }

        processedFiles += batch.length;
      }

      this.emitProgress("complete", files.length, files.length, 100, "Indexing complete");

      return this.buildResult(
        errors.length === 0,
        files.length - errors.length,
        errors.length,
        totalEntitiesWritten,
        totalRelationshipsWritten,
        Date.now() - startTime,
        errors,
        phaseStats
      );
    } catch (error) {
      const err: IndexingError = {
        filePath: "",
        phase: "scanning",
        error: error instanceof Error ? error.message : String(error),
        recoverable: false,
      };
      errors.push(err);
      this.options.onError?.(err);

      return this.buildResult(false, 0, 0, 0, 0, Date.now() - startTime, errors, phaseStats);
    }
  }

  /**
   * Performs incremental indexing - only processes changed files.
   */
  async indexProjectIncremental(): Promise<IndexingCoordinatorResult> {
    const startTime = Date.now();
    const errors: IndexingError[] = [];
    const phaseStats = {
      scanning: { files: 0, durationMs: 0 },
      parsing: { files: 0, durationMs: 0 },
      extracting: { files: 0, durationMs: 0 },
      writing: { files: 0, durationMs: 0 },
    };

    let totalEntitiesWritten = 0;
    let totalRelationshipsWritten = 0;

    try {
      // Phase 1: Scanning
      this.emitProgress("scanning", 0, 0, 0, "Discovering files...");
      const scanStart = Date.now();
      const files = await this.scanFiles();
      phaseStats.scanning = { files: files.length, durationMs: Date.now() - scanStart };

      // Detect changes
      const currentFiles: GraphFileInfo[] = files.map((f) => ({
        fileId: f.id,
        filePath: f.absolutePath,
        hash: f.hash,
      }));

      const changes = await this.updater.detectChanges(currentFiles);
      const filesToProcess = [...changes.added, ...changes.modified];

      logger.info(
        {
          added: changes.added.length,
          modified: changes.modified.length,
          deleted: changes.deleted.length,
          unchanged: changes.unchanged.length,
        },
        "Change detection complete"
      );

      if (filesToProcess.length === 0 && changes.deleted.length === 0) {
        this.emitProgress("complete", 0, 0, 100, "No changes detected");
        return this.buildResult(true, 0, 0, 0, 0, Date.now() - startTime, errors, phaseStats);
      }

      // Delete removed files
      for (const deleted of changes.deleted) {
        try {
          await this.writer.deleteFileEntities(deleted.fileId);
        } catch (error) {
          errors.push({
            filePath: deleted.filePath,
            phase: "writing",
            error: error instanceof Error ? error.message : String(error),
            recoverable: true,
          });
        }
      }

      // Filter files to only those that need processing
      const filesToIndex = files.filter((f) =>
        filesToProcess.some((p) => p.fileId === f.id)
      );

      if (filesToIndex.length === 0) {
        this.emitProgress("complete", 0, 0, 100, "Only deletions processed");
        return this.buildResult(true, 0, 0, 0, 0, Date.now() - startTime, errors, phaseStats);
      }

      // Process changed files in batches
      const batches = this.chunk(filesToIndex, this.options.batchSize);
      let processedFiles = 0;

      for (const batch of batches) {
        const batchResults = await this.processBatch(
          batch,
          processedFiles,
          filesToIndex.length,
          errors,
          phaseStats
        );

        for (const result of batchResults) {
          if (result.success) {
            totalEntitiesWritten += result.stats.entitiesWritten;
            totalRelationshipsWritten += result.stats.relationshipsWritten;
          }
        }

        processedFiles += batch.length;
      }

      this.emitProgress("complete", filesToIndex.length, filesToIndex.length, 100, "Indexing complete");

      return this.buildResult(
        errors.length === 0,
        filesToIndex.length - errors.length,
        errors.length,
        totalEntitiesWritten,
        totalRelationshipsWritten,
        Date.now() - startTime,
        errors,
        phaseStats
      );
    } catch (error) {
      const err: IndexingError = {
        filePath: "",
        phase: "scanning",
        error: error instanceof Error ? error.message : String(error),
        recoverable: false,
      };
      errors.push(err);
      this.options.onError?.(err);

      return this.buildResult(false, 0, 0, 0, 0, Date.now() - startTime, errors, phaseStats);
    }
  }

  /**
   * Indexes a single file.
   */
  async indexFile(filePath: string): Promise<WriteResult | null> {
    try {
      // Get file info
      const fileInfo = await this.scanner.getFileInfo(filePath, true);
      if (!fileInfo) {
        return null;
      }

      // Parse
      const parsed = await this.parser.parseFile(filePath);

      // Extract
      const extracted = await this.pipeline.extract(parsed, fileInfo.hash, fileInfo.size);

      // Write
      const result = await this.writer.writeFile(extracted);

      return result;
    } catch (error) {
      logger.error({ filePath, error }, "Failed to index file");
      return {
        fileId: `file:${filePath}`,
        filePath,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stats: {
          entitiesWritten: 0,
          relationshipsWritten: 0,
          entitiesDeleted: 0,
        },
      };
    }
  }

  /**
   * Removes a file from the index.
   */
  async removeFile(filePath: string): Promise<number> {
    const fileId = `file:${filePath.replace(/[/\\]/g, ":")}`;
    return this.writer.deleteFileEntities(fileId);
  }

  /**
   * Gets current graph statistics.
   */
  async getStats(): Promise<{
    files: number;
    functions: number;
    classes: number;
    interfaces: number;
  }> {
    return this.updater.getGraphStats();
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Scans the project for files.
   */
  private async scanFiles(): Promise<FileInfo[]> {
    const result = await this.scanner.scan({ computeHashes: true });
    return result.files;
  }

  /**
   * Processes a batch of files through the pipeline.
   */
  private async processBatch(
    files: FileInfo[],
    processedSoFar: number,
    totalFiles: number,
    errors: IndexingError[],
    phaseStats: IndexingCoordinatorResult["phases"]
  ): Promise<WriteResult[]> {
    // Process files concurrently with configured limit
    const CONCURRENCY = this.options.concurrency;

    return mapConcurrent(
      files,
      async (file: FileInfo, index: number) => {
        // Calculate progress based on start index + current index
        // Note: In concurrent execution, completion order isn't guaranteed,
        // so progress percentage will jump around slightly or need atomic counter
        // For simplicity, we just use the index for estimation
        const overallProcessed = processedSoFar + index;
        const percentage = Math.round((overallProcessed / totalFiles) * 100);

        try {
          // Phase 2: Parsing
          const parseStart = Date.now();
          this.emitProgress("parsing", overallProcessed, totalFiles, percentage, `Parsing ${file.relativePath}`);

          const parsed = await this.parser.parseFile(file.absolutePath);
          phaseStats.parsing.files++;
          phaseStats.parsing.durationMs += Date.now() - parseStart;

          // Phase 3: Extracting
          const extractStart = Date.now();
          this.emitProgress("extracting", overallProcessed, totalFiles, percentage, `Extracting ${file.relativePath}`);

          const extracted = await this.pipeline.extract(parsed, file.hash, file.size);
          phaseStats.extracting.files++;
          phaseStats.extracting.durationMs += Date.now() - extractStart;

          // Log extraction errors (non-fatal)
          if (extracted.errors.length > 0) {
            for (const err of extracted.errors) {
              logger.warn({ file: file.relativePath, error: err }, "Extraction warning");
            }
          }

          // Phase 3.5: Semantic Analysis (if enabled)
          if (this.semanticAnalyzer) {
            try {
              const semanticResult = await this.semanticAnalyzer.analyzeFile(
                parsed.functions,
                parsed.classes,
                extracted.fileId,
                file.absolutePath,
                parsed.language,
                this.parser
              );

              // Add semantic analysis results to the batch
              for (const fnResult of semanticResult.functions) {
                // Phase 1: Parameter, Return, Error analysis
                extracted.batch.parameterSemantics.push(...fnResult.parameterSemantics);
                if (fnResult.returnSemantics) {
                  extracted.batch.returnSemantics.push(fnResult.returnSemantics);
                }
                extracted.batch.errorPaths.push(...fnResult.errorPaths);
                if (fnResult.errorAnalysis) {
                  extracted.batch.errorAnalysis.push(fnResult.errorAnalysis);
                }
                // Phase 3: Side-Effect analysis
                extracted.batch.sideEffects.push(...fnResult.sideEffects);
                if (fnResult.sideEffectSummary) {
                  extracted.batch.sideEffectSummaries.push(fnResult.sideEffectSummary);
                }
                extracted.batch.hasSideEffect.push(...fnResult.hasSideEffect);
                if (fnResult.hasSideEffectSummary) {
                  extracted.batch.hasSideEffectSummary.push(fnResult.hasSideEffectSummary);
                }
              }

              logger.debug(
                {
                  file: file.relativePath,
                  functionsAnalyzed: semanticResult.stats.functionsAnalyzed,
                  parametersAnalyzed: semanticResult.stats.parametersAnalyzed,
                  sideEffectsFound: semanticResult.stats.sideEffectsFound,
                  pureFunctions: semanticResult.stats.pureFunctionsFound,
                },
                "Semantic analysis complete"
              );
            } catch (semanticError) {
              logger.warn(
                { file: file.relativePath, error: semanticError },
                "Semantic analysis failed (continuing without)"
              );
            }
          }

          // Phase 4: Design Pattern Detection (if enabled)
          if (this.patternAnalyzer) {
            try {
              // Convert UCE entities to pattern analysis context
              const patternContext = convertUCEToPatternContext(
                parsed.classes,
                parsed.functions,
                parsed.interfaces,
                extracted.fileId,
                file.absolutePath
              );

              // Run pattern detection
              const patternResult = this.patternAnalyzer.analyze(
                patternContext,
                this.options.patternDetectionOptions
              );

              // Add pattern detection results to the batch
              for (const pattern of patternResult.patterns) {
                // Add design pattern row
                const patternRow: DesignPatternRow = [
                  pattern.id,
                  pattern.patternType,
                  pattern.name,
                  pattern.confidence,
                  pattern.confidenceLevel,
                  JSON.stringify(pattern.evidence),
                  JSON.stringify(pattern.filePaths),
                  pattern.description ?? null,
                  pattern.detectedAt,
                ];
                extracted.batch.designPatterns.push(patternRow);

                // Add participants
                for (const participant of pattern.participants) {
                  const participantId = generateEntityId(
                    pattern.id,
                    "participant",
                    participant.entityId,
                    participant.role,
                    ""
                  );

                  const participantRow: PatternParticipantRow = [
                    participantId,
                    pattern.id,
                    participant.entityId,
                    participant.role,
                    participant.entityType,
                    participant.entityName,
                    participant.filePath,
                    JSON.stringify(participant.evidence),
                  ];
                  extracted.batch.patternParticipants.push(participantRow);

                  // Add HAS_PATTERN relationship (entity -> pattern)
                  const hasPatternRow: HasPatternRow = [
                    participant.entityId,
                    pattern.id,
                    participant.role,
                  ];
                  extracted.batch.hasPattern.push(hasPatternRow);

                  // Add PATTERN_HAS_PARTICIPANT relationship (pattern -> participant)
                  const patternHasParticipantRow: PatternHasParticipantRow = [
                    pattern.id,
                    participantId,
                  ];
                  extracted.batch.patternHasParticipant.push(patternHasParticipantRow);
                }
              }

              if (patternResult.patterns.length > 0) {
                logger.debug(
                  {
                    file: file.relativePath,
                    patternsFound: patternResult.patterns.length,
                    stats: patternResult.stats.patternsByType,
                  },
                  "Pattern detection complete"
                );
              }
            } catch (patternError) {
              logger.warn(
                { file: file.relativePath, error: patternError },
                "Pattern detection failed (continuing without)"
              );
            }
          }

          // Phase 5: Writing
          const writeStart = Date.now();
          this.emitProgress("writing", overallProcessed, totalFiles, percentage, `Writing ${file.relativePath}`);

          const writeResult = await this.writer.writeFile(extracted);
          phaseStats.writing.files++;
          phaseStats.writing.durationMs += Date.now() - writeStart;

          if (!writeResult.success) {
            const err: IndexingError = {
              filePath: file.absolutePath,
              phase: "writing",
              error: writeResult.error ?? "Unknown write error",
              recoverable: true,
            };
            errors.push(err);
            this.options.onError?.(err);
          }

          return writeResult;
        } catch (error) {
          const err: IndexingError = {
            filePath: file.absolutePath,
            phase: "parsing",
            error: error instanceof Error ? error.message : String(error),
            recoverable: true,
          };
          errors.push(err);
          this.options.onError?.(err);

          if (!this.options.continueOnError) {
            throw error;
          }

          // Return failed result
          return {
            fileId: `file:${file.absolutePath}`,
            filePath: file.absolutePath,
            success: false,
            error: err.error,
            stats: { entitiesWritten: 0, relationshipsWritten: 0, entitiesDeleted: 0 }
          };
        }
      },
      CONCURRENCY
    );
  }

  /**
   * Emits a progress event.
   */
  private emitProgress(
    phase: IndexingPhase,
    processed: number,
    total: number,
    percentage: number,
    message: string
  ): void {
    this.options.onProgress?.({
      phase,
      processed,
      total,
      percentage,
      message,
    });
  }

  /**
   * Builds the final result object.
   */
  private buildResult(
    success: boolean,
    filesIndexed: number,
    filesFailed: number,
    entitiesWritten: number,
    relationshipsWritten: number,
    durationMs: number,
    errors: IndexingError[],
    phases: IndexingCoordinatorResult["phases"]
  ): IndexingCoordinatorResult {
    return {
      success,
      filesIndexed,
      filesFailed,
      entitiesWritten,
      relationshipsWritten,
      durationMs,
      errors,
      phases,
    };
  }

  /**
   * Splits an array into chunks.
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates an IndexerCoordinator instance.
 */
export function createIndexerCoordinator(
  options: IndexerCoordinatorOptions
): IndexerCoordinator {
  return new IndexerCoordinator(options);
}

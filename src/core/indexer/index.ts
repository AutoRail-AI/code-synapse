/**
 * Indexer Module
 *
 * Orchestrates the knowledge graph indexing process.
 * Coordinates file scanning, parsing, graph building, and vector storage.
 *
 * @module
 */

// Re-export sub-modules
export * from "./project-detector.js";
export * from "./scanner.js";
export * from "./hasher.js";
export * from "./coordinator.js";
export * from "./watcher.js";

// Re-export types
export type {
  DetectedProject,
  DetectedFramework,
  DetectedLanguage,
  ProjectType,
} from "./project-detector.js";

export type {
  FileInfo,
  ScanResult,
  ScanOptions,
} from "./scanner.js";

export type {
  HashEntry,
  FileChangeStatus,
  BatchHashResult,
} from "./hasher.js";

export type {
  IndexingPhase,
  IndexingProgressEvent,
  IndexingError,
  IndexingCoordinatorResult,
  IndexerCoordinatorOptions,
} from "./coordinator.js";

export type {
  FileChangeType,
  FileChangeEvent,
  FileChangeBatch,
  BatchHandler,
  ChangeHandler,
  FileWatcherOptions,
  WatcherState,
} from "./watcher.js";

// =============================================================================
// Indexer Orchestrator (to be expanded in later phases)
// =============================================================================

import type { ProjectConfig } from "../../types/index.js";
import { createParser, type Parser } from "../parser/index.js";
import { CozoGraphStore, type IGraphStore, type GraphDatabase } from "../graph/index.js";
// Vector storage now handled by CozoDB HNSW indices in GraphDatabase
import { createEmbeddingService, type EmbeddingService } from "../embeddings/index.js";
import { ProjectDetector, type DetectedProject } from "./project-detector.js";
import { FileScanner, type ScanResult } from "./scanner.js";
import { FileHasher } from "./hasher.js";
import { IndexerCoordinator } from "./coordinator.js";
import type { IJustificationService } from "../justification/interfaces/IJustificationService.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("indexer");

/**
 * Options for the indexer
 */
export interface IndexerOptions {
  /** Project configuration */
  config: ProjectConfig;
  /** Data directory for databases */
  dataDir: string;
  /** Optional existing graph store to use (avoids creating a new one) */
  existingStore?: IGraphStore;
}

/**
 * Indexing progress event
 */
export interface IndexingProgress {
  /** Current phase */
  phase: "scanning" | "parsing" | "analyzing" | "storing";
  /** Current file being processed */
  currentFile?: string;
  /** Number of files processed */
  processed: number;
  /** Total files to process */
  total: number;
  /** Percentage complete */
  percentage: number;
}

/**
 * Indexing result
 */
export interface IndexingResult {
  /** Whether indexing succeeded */
  success: boolean;
  /** Number of files indexed */
  filesIndexed: number;
  /** Number of files that failed */
  filesFailed: number;
  /** Total time in milliseconds */
  totalTimeMs: number;
  /** Errors encountered */
  errors: Array<{ file: string; error: string }>;
}

/**
 * Orchestrates the knowledge graph indexing process.
 *
 * @example
 * ```typescript
 * const indexer = new Indexer({
 *   config: projectConfig,
 *   dataDir: '.code-synapse/data',
 * });
 *
 * await indexer.initialize();
 *
 * // Index entire project
 * const result = await indexer.indexProject((progress) => {
 *   console.log(`${progress.phase}: ${progress.percentage}%`);
 * });
 *
 * // Incremental update
 * await indexer.indexFile('/path/to/changed-file.ts');
 *
 * await indexer.close();
 * ```
 */
export class Indexer {
  private options: IndexerOptions;
  private parser: Parser;
  private graphStore: IGraphStore;
  private ownsGraphStore: boolean; // Whether we own the graph store and should close it
  // Vector storage now handled by CozoDB HNSW indices in GraphDatabase
  private embeddingService: EmbeddingService;
  private projectDetector: ProjectDetector;
  private scanner: FileScanner | null = null;
  private hasher: FileHasher;
  private detectedProject: DetectedProject | null = null;
  private coordinator: IndexerCoordinator | null = null;
  private justificationService: IJustificationService | null = null;
  private initialized = false;

  constructor(options: IndexerOptions) {
    this.options = options;
    this.parser = createParser(options.config);
    // Use existing store if provided, otherwise create a new CozoGraphStore with migrations enabled
    if (options.existingStore) {
      this.graphStore = options.existingStore;
      this.ownsGraphStore = false;
    } else {
      this.graphStore = new CozoGraphStore({
        path: `${options.dataDir}/cozodb`,
        engine: "rocksdb",
        runMigrations: true,
      });
      this.ownsGraphStore = true;
    }
    // Vector storage now handled by CozoDB HNSW indices in GraphDatabase
    this.embeddingService = createEmbeddingService();
    this.projectDetector = new ProjectDetector(options.config.root);
    this.hasher = new FileHasher();
  }

  /**
   * Sets the justification service for incremental justification.
   */
  setJustificationService(service: IJustificationService): void {
    this.justificationService = service;
  }

  /**
   * Gets the justification service if set.
   */
  getJustificationService(): IJustificationService | null {
    return this.justificationService;
  }

  /**
   * Initializes all services.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Detect project configuration
    this.detectedProject = await this.projectDetector.detect();
    this.scanner = new FileScanner(this.detectedProject);

    // Initialize all services in parallel
    // Vector storage now handled by CozoDB HNSW indices in GraphDatabase
    await Promise.all([
      this.parser.initialize(),
      this.graphStore.initialize(),
      this.embeddingService.initialize(),
    ]);

    // Create the coordinator for incremental indexing (with embedding service for Phase 1 hybrid search)
    this.coordinator = new IndexerCoordinator({
      parser: this.parser as unknown as import("../interfaces/IParser.js").IParser,
      store: this.graphStore,
      project: this.detectedProject,
      embeddingService: this.embeddingService,
    });

    this.initialized = true;
  }

  /**
   * Closes all services.
   */
  async close(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    // Only close the graph store if we own it (didn't receive it from outside)
    if (this.ownsGraphStore) {
      await this.graphStore.close();
    }

    this.initialized = false;
  }

  /**
   * Gets the detected project configuration.
   */
  getProject(): DetectedProject | null {
    return this.detectedProject;
  }

  /**
   * Scans the project for files without indexing.
   */
  async scanProject(): Promise<ScanResult> {
    this.ensureInitialized();
    return this.scanner!.scan();
  }

  /**
   * Indexes the entire project.
   */
  async indexProject(
    onProgress?: (progress: IndexingProgress) => void
  ): Promise<IndexingResult> {
    this.ensureInitialized();

    const startTime = Date.now();
    const errors: Array<{ file: string; error: string }> = [];
    let filesIndexed = 0;

    // Phase 1: Scan files
    onProgress?.({
      phase: "scanning",
      processed: 0,
      total: 0,
      percentage: 0,
    });

    const scanResult = await this.scanner!.scan({
      onProgress: (current, total, file) => {
        onProgress?.({
          phase: "scanning",
          currentFile: file,
          processed: current,
          total,
          percentage: Math.round((current / total) * 100),
        });
      },
    });

    // TODO: Phases 2-4 will be implemented in V3-V6
    // For now, we just return the scan results

    filesIndexed = scanResult.totalFiles;

    return {
      success: errors.length === 0,
      filesIndexed,
      filesFailed: errors.length,
      totalTimeMs: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Indexes a single file (for incremental updates).
   * Also triggers incremental justification if a justification service is set.
   */
  async indexFile(filePath: string): Promise<void> {
    this.ensureInitialized();

    if (!this.coordinator) {
      throw new Error("Coordinator not initialized");
    }

    logger.info({ filePath }, "Indexing file incrementally");

    // Index the file using the coordinator
    const result = await this.coordinator.indexFile(filePath);

    if (!result) {
      logger.warn({ filePath }, "File not found or could not be indexed");
      return;
    }

    if (!result.success) {
      logger.error({ filePath, error: result.error }, "Failed to index file");
      throw new Error(result.error || "Failed to index file");
    }

    logger.info(
      {
        filePath,
        entitiesWritten: result.stats.entitiesWritten,
        relationshipsWritten: result.stats.relationshipsWritten,
      },
      "File indexed successfully"
    );

    // Trigger incremental justification if service is available
    if (this.justificationService && result.stats.entitiesWritten > 0) {
      try {
        logger.debug({ filePath }, "Triggering incremental justification");

        // Run justification for entities in this file
        const justifyResult = await this.justificationService.justifyFile(filePath);

        logger.info(
          {
            filePath,
            justified: justifyResult.justified,
            failed: justifyResult.failed,
          },
          "Incremental justification completed"
        );
      } catch (justifyError) {
        // Log but don't fail - justification is optional
        logger.warn(
          { filePath, error: justifyError },
          "Incremental justification failed (non-fatal)"
        );
      }
    }
  }

  /**
   * Indexes multiple files (for batch incremental updates).
   */
  async indexFiles(filePaths: string[]): Promise<void> {
    this.ensureInitialized();

    logger.info({ fileCount: filePaths.length }, "Indexing files incrementally");

    const results = await Promise.allSettled(
      filePaths.map((path) => this.indexFile(path))
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      logger.warn(
        { failedCount: failures.length, totalCount: filePaths.length },
        "Some files failed to index"
      );
    }
  }

  /**
   * Removes a file from the index.
   */
  async removeFile(filePath: string): Promise<void> {
    this.ensureInitialized();

    if (!this.coordinator) {
      throw new Error("Coordinator not initialized");
    }

    logger.info({ filePath }, "Removing file from index");

    const deletedCount = await this.coordinator.removeFile(filePath);

    logger.info({ filePath, deletedCount }, "File removed from index");
  }

  /**
   * Gets the underlying graph database.
   * Returns as GraphDatabase type for compatibility with legacy code.
   */
  getGraphDatabase(): GraphDatabase {
    // CozoGraphStore implements IGraphStore and wraps a GraphDatabase
    // Cast to unknown first to satisfy TypeScript
    return this.graphStore as unknown as GraphDatabase;
  }

  /**
   * Ensures the indexer is initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("Indexer not initialized. Call initialize() first.");
    }
  }
}

/**
 * Creates an Indexer instance.
 */
export function createIndexer(options: IndexerOptions): Indexer {
  return new Indexer(options);
}

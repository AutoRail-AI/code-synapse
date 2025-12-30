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
import { createGraphDatabase, type GraphDatabase } from "../graph/index.js";
// Vector storage now handled by CozoDB HNSW indices in GraphDatabase
import { createEmbeddingService, type EmbeddingService } from "../embeddings/index.js";
import { ProjectDetector, type DetectedProject } from "./project-detector.js";
import { FileScanner, type ScanResult } from "./scanner.js";
import { FileHasher } from "./hasher.js";

/**
 * Options for the indexer
 */
export interface IndexerOptions {
  /** Project configuration */
  config: ProjectConfig;
  /** Data directory for databases */
  dataDir: string;
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
  private graphDb: GraphDatabase;
  // Vector storage now handled by CozoDB HNSW indices in GraphDatabase
  private embeddingService: EmbeddingService;
  private projectDetector: ProjectDetector;
  private scanner: FileScanner | null = null;
  private hasher: FileHasher;
  private detectedProject: DetectedProject | null = null;
  private initialized = false;

  constructor(options: IndexerOptions) {
    this.options = options;
    this.parser = createParser(options.config);
    this.graphDb = createGraphDatabase({ dbPath: `${options.dataDir}/graph` });
    // Vector storage now handled by CozoDB HNSW indices in GraphDatabase
    this.embeddingService = createEmbeddingService();
    this.projectDetector = new ProjectDetector(options.config.root);
    this.hasher = new FileHasher();
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
      this.graphDb.initialize(),
      this.embeddingService.initialize(),
    ]);

    this.initialized = true;
  }

  /**
   * Closes all services.
   */
  async close(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    // Vector storage now handled by CozoDB, only close graph database
    await this.graphDb.close();

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
   */
  async indexFile(_filePath: string): Promise<void> {
    this.ensureInitialized();
    // TODO: Implement in V7 (Indexer & Watcher)
    throw new Error("Not implemented - coming in V7");
  }

  /**
   * Removes a file from the index.
   */
  async removeFile(_filePath: string): Promise<void> {
    this.ensureInitialized();
    // TODO: Implement in V7 (Indexer & Watcher)
    throw new Error("Not implemented - coming in V7");
  }

  /**
   * Gets the underlying graph database.
   */
  getGraphDatabase(): GraphDatabase {
    return this.graphDb;
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

/**
 * File Watcher
 *
 * Watches for file system changes and triggers indexing updates.
 * Provides event batching, deduplication, and controlled concurrency.
 *
 * @module
 */

import { watch, type FSWatcher } from "chokidar";
import type { DetectedProject } from "./project-detector.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("file-watcher");

// =============================================================================
// Types
// =============================================================================

/**
 * Types of file change events
 */
export type FileChangeType = "add" | "change" | "unlink";

/**
 * A file change event
 */
export interface FileChangeEvent {
  /** Type of change */
  type: FileChangeType;
  /** Absolute path to the file */
  filePath: string;
  /** Timestamp when the change was detected */
  timestamp: number;
}

/**
 * A batch of file change events
 */
export interface FileChangeBatch {
  /** All events in the batch */
  events: FileChangeEvent[];
  /** Deduplicated files to add/update */
  filesToUpdate: string[];
  /** Files to remove */
  filesToRemove: string[];
  /** Batch timestamp */
  timestamp: number;
}

/**
 * Callback for handling file change batches
 */
export type BatchHandler = (batch: FileChangeBatch) => Promise<void>;

/**
 * Callback for individual file changes
 */
export type ChangeHandler = (event: FileChangeEvent) => void;

/**
 * Options for FileWatcher
 */
export interface FileWatcherOptions {
  /** Project to watch */
  project: DetectedProject;
  /** Debounce interval in ms (default: 300) */
  debounceMs?: number;
  /** Maximum batch size before forcing processing (default: 50) */
  maxBatchSize?: number;
  /** Whether to use polling (useful for network drives) */
  usePolling?: boolean;
  /** Polling interval in ms (default: 1000) */
  pollInterval?: number;
  /** Batch handler callback */
  onBatch?: BatchHandler;
  /** Individual change handler (for real-time UI updates) */
  onChange?: ChangeHandler;
  /** Error handler */
  onError?: (error: Error) => void;
  /** Ready handler (called when watcher is ready) */
  onReady?: () => void;
}

/**
 * State of the watcher
 */
export type WatcherState = "stopped" | "starting" | "watching" | "processing" | "stopping";

// =============================================================================
// FileWatcher Implementation
// =============================================================================

/**
 * Watches for file system changes and batches them for efficient processing.
 *
 * Features:
 * - Event debouncing: Waits for rapid changes to settle
 * - Deduplication: Multiple changes to the same file become one event
 * - Batching: Groups changes for efficient processing
 * - Controlled concurrency: Prevents overlapping batch processing
 *
 * @example
 * ```typescript
 * const watcher = new FileWatcher({
 *   project,
 *   onBatch: async (batch) => {
 *     for (const file of batch.filesToUpdate) {
 *       await coordinator.indexFile(file);
 *     }
 *     for (const file of batch.filesToRemove) {
 *       await coordinator.removeFile(file);
 *     }
 *   }
 * });
 *
 * await watcher.start();
 *
 * // Later...
 * await watcher.stop();
 * ```
 */
export class FileWatcher {
  private project: DetectedProject;
  private options: Required<Omit<FileWatcherOptions, "onBatch" | "onChange" | "onError" | "onReady">> & {
    onBatch?: BatchHandler;
    onChange?: ChangeHandler;
    onError?: (error: Error) => void;
    onReady?: () => void;
  };

  private watcher: FSWatcher | null = null;
  private state: WatcherState = "stopped";
  private eventBuffer: FileChangeEvent[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;

  constructor(options: FileWatcherOptions) {
    this.project = options.project;
    this.options = {
      project: options.project,
      debounceMs: options.debounceMs ?? 300,
      maxBatchSize: options.maxBatchSize ?? 50,
      usePolling: options.usePolling ?? false,
      pollInterval: options.pollInterval ?? 1000,
      onBatch: options.onBatch,
      onChange: options.onChange,
      onError: options.onError,
      onReady: options.onReady,
    };
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Starts watching for file changes.
   */
  async start(): Promise<void> {
    if (this.state !== "stopped") {
      return;
    }

    this.state = "starting";
    logger.debug({ rootPath: this.project.rootPath }, "Starting file watcher");

    // Build glob patterns for watching
    const patterns = this.project.sourcePatterns.map((p) =>
      `${this.project.rootPath}/${p}`
    );

    this.watcher = watch(patterns, {
      ignored: this.project.ignorePatterns,
      persistent: true,
      ignoreInitial: true, // Don't emit events for existing files
      usePolling: this.options.usePolling,
      interval: this.options.pollInterval,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    // Set up event handlers
    this.watcher.on("add", (path) => this.handleEvent("add", path));
    this.watcher.on("change", (path) => this.handleEvent("change", path));
    this.watcher.on("unlink", (path) => this.handleEvent("unlink", path));

    this.watcher.on("error", (error: unknown) => {
      logger.error({ error }, "Watcher error");
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    });

    // Wait for watcher to be ready
    return new Promise<void>((resolve) => {
      this.watcher!.on("ready", () => {
        this.state = "watching";
        logger.info({ rootPath: this.project.rootPath }, "File watcher ready");
        this.options.onReady?.();
        resolve();
      });
    });
  }

  /**
   * Stops watching for file changes.
   */
  async stop(): Promise<void> {
    if (this.state === "stopped" || this.state === "stopping") {
      return;
    }

    this.state = "stopping";

    // Clear any pending debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Process any remaining events
    if (this.eventBuffer.length > 0) {
      await this.processBatch();
    }

    // Close the watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.state = "stopped";
    logger.info("File watcher stopped");
  }

  /**
   * Gets the current watcher state.
   */
  getState(): WatcherState {
    return this.state;
  }

  /**
   * Gets the number of pending events in the buffer.
   */
  getPendingEventCount(): number {
    return this.eventBuffer.length;
  }

  /**
   * Forces immediate processing of buffered events.
   */
  async flush(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.eventBuffer.length > 0) {
      await this.processBatch();
    }
  }

  // ===========================================================================
  // Private Event Handling
  // ===========================================================================

  /**
   * Handles a file change event.
   */
  private handleEvent(type: FileChangeType, filePath: string): void {
    const event: FileChangeEvent = {
      type,
      filePath,
      timestamp: Date.now(),
    };

    logger.debug({ type, filePath }, "File change detected");

    // Notify immediate change handler
    this.options.onChange?.(event);

    // Add to buffer
    this.eventBuffer.push(event);

    // Check if we should process immediately (max batch size reached)
    if (this.eventBuffer.length >= this.options.maxBatchSize) {
      this.scheduleProcessing(0);
      return;
    }

    // Schedule debounced processing
    this.scheduleProcessing(this.options.debounceMs);
  }

  /**
   * Schedules batch processing with debouncing.
   */
  private scheduleProcessing(delayMs: number): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processBatch().catch((error) => {
        logger.error({ error }, "Error processing batch");
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      });
    }, delayMs);
  }

  /**
   * Processes the buffered events as a batch.
   */
  private async processBatch(): Promise<void> {
    if (this.processing || this.eventBuffer.length === 0) {
      return;
    }

    this.processing = true;
    const previousState = this.state;
    this.state = "processing";

    try {
      // Take all events from buffer
      const events = [...this.eventBuffer];
      this.eventBuffer = [];

      // Deduplicate and categorize
      const batch = this.buildBatch(events);

      logger.info(
        {
          updateCount: batch.filesToUpdate.length,
          removeCount: batch.filesToRemove.length,
          eventCount: events.length,
        },
        "Processing file change batch"
      );

      // Call batch handler
      if (this.options.onBatch && (batch.filesToUpdate.length > 0 || batch.filesToRemove.length > 0)) {
        await this.options.onBatch(batch);
      }
    } finally {
      this.processing = false;
      this.state = previousState === "processing" ? "watching" : previousState;
    }
  }

  /**
   * Builds a deduplicated batch from raw events.
   */
  private buildBatch(events: FileChangeEvent[]): FileChangeBatch {
    // Track the latest event for each file
    const fileEvents = new Map<string, FileChangeEvent>();

    for (const event of events) {
      const existing = fileEvents.get(event.filePath);

      // Use the latest event, but handle special cases:
      // - add followed by unlink = remove from updates
      // - unlink followed by add = update (file recreated)
      // - multiple changes = keep as update
      if (!existing || event.timestamp > existing.timestamp) {
        fileEvents.set(event.filePath, event);
      }
    }

    // Categorize files
    const filesToUpdate: string[] = [];
    const filesToRemove: string[] = [];

    for (const [filePath, event] of fileEvents) {
      if (event.type === "unlink") {
        filesToRemove.push(filePath);
      } else {
        filesToUpdate.push(filePath);
      }
    }

    return {
      events,
      filesToUpdate,
      filesToRemove,
      timestamp: Date.now(),
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a FileWatcher instance.
 */
export function createFileWatcher(options: FileWatcherOptions): FileWatcher {
  return new FileWatcher(options);
}

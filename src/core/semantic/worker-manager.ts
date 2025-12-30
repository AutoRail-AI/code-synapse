/**
 * Semantic Worker Manager
 *
 * Manages the semantic analysis worker thread.
 * Provides async interface for sending requests and receiving results.
 *
 * @module
 */

import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AsyncDisposable } from "../../utils/disposable.js";
import { createLogger } from "../../utils/logger.js";
import type {
  SemanticRequest,
  SemanticResponse,
  AnalyzedFile,
  ProgressInfo,
  SemanticAnalysisOptions,
} from "./types.js";

const logger = createLogger("semantic-worker");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Types
// =============================================================================

/**
 * Callback for progress updates during analysis.
 */
export type ProgressCallback = (progress: ProgressInfo) => void;

/**
 * State of the worker.
 */
export type WorkerState = "idle" | "initializing" | "analyzing" | "terminated";

// =============================================================================
// Semantic Worker Manager
// =============================================================================

/**
 * Manages a worker thread for semantic analysis.
 *
 * @example
 * ```typescript
 * const manager = new SemanticWorkerManager();
 *
 * // Initialize with project config
 * await manager.initialize({
 *   projectRoot: '/path/to/project',
 *   tsconfigPath: '/path/to/project/tsconfig.json'
 * });
 *
 * // Analyze files
 * const results = await manager.analyze(filePaths, (progress) => {
 *   console.log(`Analyzing ${progress.filePath} (${progress.current}/${progress.total})`);
 * });
 *
 * // Clean up
 * await manager.terminate();
 * ```
 */
export class SemanticWorkerManager implements AsyncDisposable {
  private worker: Worker | null = null;
  private state: WorkerState = "idle";
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      onProgress?: ProgressCallback;
    }
  >();
  private projectRoot: string | null = null;
  private tsconfigPath: string | null = null;

  /**
   * Initializes the worker with project configuration.
   *
   * @param options - Initialization options
   */
  async initialize(options: {
    projectRoot: string;
    tsconfigPath: string;
  }): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`Cannot initialize worker in state: ${this.state}`);
    }

    this.state = "initializing";
    this.projectRoot = options.projectRoot;
    this.tsconfigPath = options.tsconfigPath;

    try {
      // Create worker
      const workerPath = path.join(__dirname, "../../workers/semantic.worker.js");
      this.worker = new Worker(workerPath, {
        workerData: { projectRoot: options.projectRoot },
      });

      // Set up message handler
      this.worker.on("message", (response: SemanticResponse) => {
        this.handleMessage(response);
      });

      // Set up error handler
      this.worker.on("error", (error) => {
        logger.error({ error: error.message }, "Worker error");
        this.rejectAllPending(error);
      });

      // Set up exit handler
      this.worker.on("exit", (code) => {
        if (code !== 0) {
          logger.warn({ code }, "Worker exited with code");
        }
        this.state = "terminated";
        this.worker = null;
      });

      // Send initialization request
      await this.sendRequest({
        type: "initialize",
        requestId: randomUUID(),
        projectRoot: options.projectRoot,
        tsconfigPath: options.tsconfigPath,
      });

      this.state = "idle";
      logger.info({ projectRoot: options.projectRoot }, "Semantic worker initialized");
    } catch (error) {
      this.state = "idle";
      await this.terminate();
      throw error;
    }
  }

  /**
   * Analyzes files for semantic information.
   *
   * @param filePaths - Files to analyze
   * @param onProgress - Optional progress callback
   * @param options - Analysis options
   * @returns Analysis results
   */
  async analyze(
    filePaths: string[],
    onProgress?: ProgressCallback,
    _options?: SemanticAnalysisOptions
  ): Promise<AnalyzedFile[]> {
    if (!this.worker) {
      throw new Error("Worker not initialized. Call initialize() first.");
    }

    if (this.state === "analyzing") {
      throw new Error("Worker is already analyzing. Wait for current analysis to complete.");
    }

    this.state = "analyzing";

    try {
      const result = await this.sendRequest(
        {
          type: "analyze",
          requestId: randomUUID(),
          filePaths,
        },
        onProgress
      );

      this.state = "idle";
      return result as AnalyzedFile[];
    } catch (error) {
      this.state = "idle";
      throw error;
    }
  }

  /**
   * Terminates the worker.
   */
  async terminate(): Promise<void> {
    if (!this.worker) {
      return;
    }

    try {
      // Send shutdown request
      await this.sendRequest({
        type: "shutdown",
        requestId: randomUUID(),
      });
    } catch {
      // Ignore errors during shutdown
    }

    // Terminate worker
    await this.worker.terminate();
    this.worker = null;
    this.state = "terminated";
    this.pendingRequests.clear();

    logger.info("Semantic worker terminated");
  }

  /**
   * Gets the current worker state.
   */
  getState(): WorkerState {
    return this.state;
  }

  /**
   * Checks if the worker is ready for analysis.
   */
  get isReady(): boolean {
    return this.worker !== null && this.state === "idle";
  }

  /**
   * Implements AsyncDisposable for use with `await using`.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.terminate();
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Sends a request to the worker and waits for response.
   */
  private sendRequest(
    request: SemanticRequest,
    onProgress?: ProgressCallback
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not available"));
        return;
      }

      this.pendingRequests.set(request.requestId, {
        resolve,
        reject,
        onProgress,
      });

      this.worker.postMessage(request);
    });
  }

  /**
   * Handles messages from the worker.
   */
  private handleMessage(response: SemanticResponse): void {
    const pending = this.pendingRequests.get(response.requestId);

    switch (response.type) {
      case "progress":
        if (pending?.onProgress && response.data) {
          pending.onProgress(response.data as ProgressInfo);
        }
        break;

      case "result":
        if (pending) {
          this.pendingRequests.delete(response.requestId);
          pending.resolve(response.data);
        }
        break;

      case "error":
        if (pending) {
          this.pendingRequests.delete(response.requestId);
          const errorData = response.data as { message: string; stack?: string };
          const error = new Error(errorData?.message ?? "Unknown worker error");
          if (errorData?.stack) {
            error.stack = errorData.stack;
          }
          pending.reject(error);
        }
        break;

      case "initialized":
        if (pending) {
          this.pendingRequests.delete(response.requestId);
          pending.resolve(undefined);
        }
        break;

      case "shutdown":
        if (pending) {
          this.pendingRequests.delete(response.requestId);
          pending.resolve(undefined);
        }
        break;

      default:
        logger.warn({ type: (response as SemanticResponse).type }, "Unknown response type from worker");
    }
  }

  /**
   * Rejects all pending requests with an error.
   */
  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a SemanticWorkerManager instance.
 */
export function createSemanticWorkerManager(): SemanticWorkerManager {
  return new SemanticWorkerManager();
}

/**
 * Creates and initializes a SemanticWorkerManager.
 *
 * @param projectRoot - Project root directory
 * @param tsconfigPath - Path to tsconfig.json
 */
export async function createInitializedSemanticWorkerManager(
  projectRoot: string,
  tsconfigPath: string
): Promise<SemanticWorkerManager> {
  const manager = new SemanticWorkerManager();
  await manager.initialize({ projectRoot, tsconfigPath });
  return manager;
}

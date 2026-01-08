/**
 * Worker Pool Implementation
 *
 * High-performance worker pool for parallel task processing with:
 * - Dynamic pool sizing
 * - Priority-based task scheduling
 * - Task timeout handling
 * - Comprehensive statistics
 */

import type {
  IWorkerPool,
  IWorkerTask,
  IWorkerResult,
  WorkerPoolStats,
} from "../interfaces/IOptimization.js";

// =============================================================================
// Types
// =============================================================================

export interface WorkerPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  taskTimeoutMs: number;
  maxQueueSize: number;
  idleTimeoutMs: number;
}

interface QueuedTask<TInput, TOutput> {
  task: IWorkerTask<TInput, TOutput>;
  resolve: (result: IWorkerResult<TOutput>) => void;
  reject: (error: Error) => void;
  queuedAt: number;
}

interface WorkerState {
  id: string;
  busy: boolean;
  currentTaskId: string | null;
  startedAt: number | null;
  completedTasks: number;
  failedTasks: number;
}

// =============================================================================
// Abstract Worker Pool
// =============================================================================

export abstract class WorkerPool<TInput, TOutput> implements IWorkerPool<TInput, TOutput> {
  protected workers: Map<string, WorkerState> = new Map();
  protected taskQueue: QueuedTask<TInput, TOutput>[] = [];
  protected config: WorkerPoolConfig;
  protected isShutdown = false;

  // Statistics
  protected _stats = {
    totalSubmitted: 0,
    totalCompleted: 0,
    totalFailed: 0,
    totalDurationMs: 0,
    queueWaitTimeMs: 0,
  };

  constructor(config: Partial<WorkerPoolConfig> = {}) {
    this.config = {
      minWorkers: config.minWorkers ?? 2,
      maxWorkers: config.maxWorkers ?? 8,
      taskTimeoutMs: config.taskTimeoutMs ?? 30000,
      maxQueueSize: config.maxQueueSize ?? 1000,
      idleTimeoutMs: config.idleTimeoutMs ?? 60000,
    };
  }

  async initialize(): Promise<void> {
    // Create minimum number of workers
    for (let i = 0; i < this.config.minWorkers; i++) {
      await this.createWorker();
    }
  }

  async submit(task: IWorkerTask<TInput, TOutput>): Promise<IWorkerResult<TOutput>> {
    if (this.isShutdown) {
      throw new Error("Worker pool is shutdown");
    }

    if (this.taskQueue.length >= this.config.maxQueueSize) {
      throw new Error("Task queue is full");
    }

    this._stats.totalSubmitted++;

    return new Promise((resolve, reject) => {
      const queuedTask: QueuedTask<TInput, TOutput> = {
        task,
        resolve,
        reject,
        queuedAt: Date.now(),
      };

      // Insert by priority (higher priority first)
      const priority = task.priority ?? 0;
      let inserted = false;
      for (let i = 0; i < this.taskQueue.length; i++) {
        const existingPriority = this.taskQueue[i]!.task.priority ?? 0;
        if (priority > existingPriority) {
          this.taskQueue.splice(i, 0, queuedTask);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        this.taskQueue.push(queuedTask);
      }

      this.processQueue();
    });
  }

  async submitBatch(tasks: IWorkerTask<TInput, TOutput>[]): Promise<IWorkerResult<TOutput>[]> {
    const promises = tasks.map((task) => this.submit(task));
    return Promise.all(promises);
  }

  async resize(size: number): Promise<void> {
    const targetSize = Math.max(
      this.config.minWorkers,
      Math.min(this.config.maxWorkers, size)
    );

    const currentSize = this.workers.size;

    if (targetSize > currentSize) {
      // Scale up
      for (let i = 0; i < targetSize - currentSize; i++) {
        await this.createWorker();
      }
    } else if (targetSize < currentSize) {
      // Scale down - remove idle workers
      const idleWorkers = Array.from(this.workers.values()).filter((w) => !w.busy);
      const toRemove = Math.min(idleWorkers.length, currentSize - targetSize);

      for (let i = 0; i < toRemove; i++) {
        const worker = idleWorkers[i];
        if (worker) {
          await this.destroyWorker(worker.id);
        }
      }
    }
  }

  stats(): WorkerPoolStats {
    const workers = Array.from(this.workers.values());
    const activeWorkers = workers.filter((w) => w.busy).length;

    return {
      activeWorkers,
      idleWorkers: this.workers.size - activeWorkers,
      pendingTasks: this.taskQueue.length,
      totalSubmitted: this._stats.totalSubmitted,
      totalCompleted: this._stats.totalCompleted,
      totalFailed: this._stats.totalFailed,
      totalDurationMs: this._stats.totalDurationMs,
      queueWaitTimeMs: this._stats.queueWaitTimeMs,
    };
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;

    // Reject all pending tasks
    for (const queued of this.taskQueue) {
      queued.reject(new Error("Worker pool shutdown"));
    }
    this.taskQueue = [];

    // Destroy all workers
    const workerIds = Array.from(this.workers.keys());
    await Promise.all(workerIds.map((id) => this.destroyWorker(id)));
  }

  // ==========================================================================
  // Abstract Methods (to be implemented by specific worker types)
  // ==========================================================================

  protected abstract createWorker(): Promise<string>;
  protected abstract destroyWorker(workerId: string): Promise<void>;
  protected abstract executeTask(
    workerId: string,
    task: IWorkerTask<TInput, TOutput>
  ): Promise<TOutput>;

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  protected async processQueue(): Promise<void> {
    if (this.isShutdown || this.taskQueue.length === 0) return;

    // Find idle worker
    const idleWorker = Array.from(this.workers.values()).find((w) => !w.busy);

    if (!idleWorker) {
      // Try to scale up if possible
      if (this.workers.size < this.config.maxWorkers) {
        await this.createWorker();
        this.processQueue();
      }
      return;
    }

    // Get next task
    const queued = this.taskQueue.shift();
    if (!queued) return;

    // Mark worker as busy
    idleWorker.busy = true;
    idleWorker.currentTaskId = queued.task.id;
    idleWorker.startedAt = Date.now();

    const queueWaitTime = Date.now() - queued.queuedAt;
    this._stats.queueWaitTimeMs += queueWaitTime;

    // Execute with timeout
    const timeout = queued.task.timeout ?? this.config.taskTimeoutMs;
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        this.executeTask(idleWorker.id, queued.task),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Task timeout")), timeout)
        ),
      ]);

      const durationMs = Date.now() - startTime;
      this._stats.totalCompleted++;
      this._stats.totalDurationMs += durationMs;
      idleWorker.completedTasks++;

      queued.resolve({
        taskId: queued.task.id,
        success: true,
        output: result,
        durationMs,
        workerId: idleWorker.id,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this._stats.totalFailed++;
      idleWorker.failedTasks++;

      queued.resolve({
        taskId: queued.task.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs,
        workerId: idleWorker.id,
      });
    } finally {
      // Mark worker as idle
      idleWorker.busy = false;
      idleWorker.currentTaskId = null;
      idleWorker.startedAt = null;

      // Process next task
      this.processQueue();
    }
  }
}

// =============================================================================
// In-Process Worker Pool (for CPU-bound tasks)
// =============================================================================

export type TaskExecutor<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

export class InProcessWorkerPool<TInput, TOutput> extends WorkerPool<TInput, TOutput> {
  private executor: TaskExecutor<TInput, TOutput>;
  private workerIdCounter = 0;

  constructor(executor: TaskExecutor<TInput, TOutput>, config?: Partial<WorkerPoolConfig>) {
    super(config);
    this.executor = executor;
  }

  protected async createWorker(): Promise<string> {
    const workerId = `worker-${++this.workerIdCounter}`;
    this.workers.set(workerId, {
      id: workerId,
      busy: false,
      currentTaskId: null,
      startedAt: null,
      completedTasks: 0,
      failedTasks: 0,
    });
    return workerId;
  }

  protected async destroyWorker(workerId: string): Promise<void> {
    this.workers.delete(workerId);
  }

  protected async executeTask(
    _workerId: string,
    task: IWorkerTask<TInput, TOutput>
  ): Promise<TOutput> {
    return this.executor(task.input);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createInProcessWorkerPool<TInput, TOutput>(
  executor: TaskExecutor<TInput, TOutput>,
  config?: Partial<WorkerPoolConfig>
): InProcessWorkerPool<TInput, TOutput> {
  return new InProcessWorkerPool(executor, config);
}

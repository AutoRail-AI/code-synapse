/**
 * Disposable Pattern for Automatic Resource Cleanup
 *
 * Uses TypeScript 5.2+ Explicit Resource Management (ECMAScript proposal).
 * Enables the `using` keyword for automatic cleanup when scope exits.
 *
 * @example
 * ```typescript
 * // Resources auto-cleanup when function exits (normal or exception)
 * async function updateFile(fileId: string): Promise<void> {
 *   using tx = new TransactionScope(db);
 *   using parser = await parserPool.acquire();
 *
 *   const ast = parser.parse(content);
 *   await tx.execute('...');
 *   tx.commit();
 *   // Both auto-disposed here, even if error thrown
 * }
 * ```
 *
 * @module
 */

// =============================================================================
// Disposable Interfaces
// =============================================================================

/**
 * Synchronous disposable resource.
 * Implement this interface to enable `using` keyword support.
 *
 * @example
 * ```typescript
 * class FileHandle implements Disposable {
 *   [Symbol.dispose](): void {
 *     this.close();
 *   }
 * }
 *
 * function readFile(): void {
 *   using handle = new FileHandle('file.txt');
 *   // handle auto-closed when scope exits
 * }
 * ```
 */
export interface Disposable {
  [Symbol.dispose](): void;
}

/**
 * Asynchronous disposable resource.
 * Implement this interface to enable `await using` keyword support.
 *
 * @example
 * ```typescript
 * class DatabaseConnection implements AsyncDisposable {
 *   async [Symbol.asyncDispose](): Promise<void> {
 *     await this.close();
 *   }
 * }
 *
 * async function query(): Promise<void> {
 *   await using conn = await pool.acquire();
 *   // conn auto-closed when scope exits
 * }
 * ```
 */
export interface AsyncDisposable {
  [Symbol.asyncDispose](): Promise<void>;
}

// =============================================================================
// Base Classes
// =============================================================================

/**
 * Base class for synchronous disposable resources.
 *
 * Provides:
 * - Idempotent disposal (safe to call dispose multiple times)
 * - Disposal state tracking
 * - Use-after-dispose protection via `throwIfDisposed()`
 *
 * Subclasses must implement `disposeCore()` with actual cleanup logic.
 *
 * @example
 * ```typescript
 * class ParserHandle extends DisposableResource {
 *   private parser: Parser;
 *
 *   constructor(parser: Parser) {
 *     super();
 *     this.parser = parser;
 *   }
 *
 *   parse(content: string): Tree {
 *     this.throwIfDisposed();
 *     return this.parser.parse(content);
 *   }
 *
 *   protected disposeCore(): void {
 *     this.parser.delete();
 *   }
 * }
 * ```
 */
export abstract class DisposableResource implements Disposable {
  private _disposed = false;

  /**
   * Whether this resource has been disposed.
   */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Throws an error if this resource has been disposed.
   * Call this at the start of methods that require the resource to be valid.
   *
   * @throws {Error} If the resource has been disposed
   */
  protected throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`${this.constructor.name} has been disposed`);
    }
  }

  /**
   * Disposes this resource. Safe to call multiple times.
   * Called automatically when using the `using` keyword.
   */
  [Symbol.dispose](): void {
    if (!this._disposed) {
      this._disposed = true;
      this.disposeCore();
    }
  }

  /**
   * Override this method to implement actual cleanup logic.
   * Called exactly once when the resource is disposed.
   */
  protected abstract disposeCore(): void;
}

/**
 * Base class for asynchronous disposable resources.
 *
 * Provides:
 * - Idempotent disposal (safe to call dispose multiple times)
 * - Disposal state tracking
 * - Use-after-dispose protection via `throwIfDisposed()`
 *
 * Subclasses must implement `disposeAsyncCore()` with actual cleanup logic.
 *
 * @example
 * ```typescript
 * class WorkerHandle extends AsyncDisposableResource {
 *   private worker: Worker;
 *
 *   constructor(worker: Worker) {
 *     super();
 *     this.worker = worker;
 *   }
 *
 *   async analyze(files: string[]): Promise<Result> {
 *     this.throwIfDisposed();
 *     return this.worker.postMessage({ files });
 *   }
 *
 *   protected async disposeAsyncCore(): Promise<void> {
 *     await this.worker.terminate();
 *   }
 * }
 * ```
 */
export abstract class AsyncDisposableResource implements AsyncDisposable {
  private _disposed = false;

  /**
   * Whether this resource has been disposed.
   */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Throws an error if this resource has been disposed.
   * Call this at the start of methods that require the resource to be valid.
   *
   * @throws {Error} If the resource has been disposed
   */
  protected throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`${this.constructor.name} has been disposed`);
    }
  }

  /**
   * Disposes this resource asynchronously. Safe to call multiple times.
   * Called automatically when using the `await using` keyword.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    if (!this._disposed) {
      this._disposed = true;
      await this.disposeAsyncCore();
    }
  }

  /**
   * Override this method to implement actual async cleanup logic.
   * Called exactly once when the resource is disposed.
   */
  protected abstract disposeAsyncCore(): Promise<void>;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Creates a disposable from a cleanup function.
 * Useful for wrapping existing cleanup logic without creating a class.
 *
 * @param cleanup - Function to call when disposed
 * @returns A Disposable that calls the cleanup function
 *
 * @example
 * ```typescript
 * function withTempFile(): Disposable {
 *   const path = createTempFile();
 *   return createDisposable(() => fs.unlinkSync(path));
 * }
 *
 * function process(): void {
 *   using _cleanup = withTempFile();
 *   // temp file deleted when scope exits
 * }
 * ```
 */
export function createDisposable(cleanup: () => void): Disposable {
  return { [Symbol.dispose]: cleanup };
}

/**
 * Creates an async disposable from a cleanup function.
 * Useful for wrapping existing async cleanup logic without creating a class.
 *
 * @param cleanup - Async function to call when disposed
 * @returns An AsyncDisposable that calls the cleanup function
 *
 * @example
 * ```typescript
 * async function withConnection(): Promise<AsyncDisposable> {
 *   const conn = await db.connect();
 *   return createAsyncDisposable(() => conn.close());
 * }
 *
 * async function query(): Promise<void> {
 *   await using _cleanup = await withConnection();
 *   // connection closed when scope exits
 * }
 * ```
 */
export function createAsyncDisposable(
  cleanup: () => Promise<void>
): AsyncDisposable {
  return { [Symbol.asyncDispose]: cleanup };
}

// =============================================================================
// Disposable Stack
// =============================================================================

/**
 * A stack of disposables that are disposed in reverse order (LIFO).
 * Useful for managing multiple related resources.
 *
 * @example
 * ```typescript
 * async function setupPipeline(): Promise<void> {
 *   using stack = new DisposableStack();
 *
 *   const db = stack.use(await openDatabase());
 *   const cache = stack.use(await openCache());
 *   const server = stack.use(await startServer(db, cache));
 *
 *   await server.run();
 *   // All three disposed in reverse order: server, cache, db
 * }
 * ```
 */
export class DisposableStack implements Disposable {
  private readonly resources: Disposable[] = [];
  private _disposed = false;

  /**
   * Whether this stack has been disposed.
   */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Adds a resource to the stack and returns it.
   * Resources are disposed in reverse order (LIFO).
   *
   * @param resource - The disposable resource to add
   * @returns The same resource (for chaining)
   */
  use<T extends Disposable>(resource: T): T {
    if (this._disposed) {
      throw new Error("DisposableStack has been disposed");
    }
    this.resources.push(resource);
    return resource;
  }

  /**
   * Adds a cleanup callback to the stack.
   *
   * @param cleanup - Function to call when disposed
   */
  defer(cleanup: () => void): void {
    this.use(createDisposable(cleanup));
  }

  /**
   * Disposes all resources in reverse order.
   */
  [Symbol.dispose](): void {
    if (this._disposed) return;
    this._disposed = true;

    // Dispose in reverse order (LIFO)
    const errors: Error[] = [];
    while (this.resources.length > 0) {
      const resource = this.resources.pop()!;
      try {
        resource[Symbol.dispose]();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    // If any errors occurred, throw an aggregate error
    if (errors.length === 1) {
      throw errors[0];
    } else if (errors.length > 1) {
      throw new AggregateError(errors, "Multiple disposal errors occurred");
    }
  }
}

/**
 * An async stack of disposables that are disposed in reverse order (LIFO).
 * Supports both sync and async disposables.
 *
 * @example
 * ```typescript
 * async function setupPipeline(): Promise<void> {
 *   await using stack = new AsyncDisposableStack();
 *
 *   const db = await stack.use(await openDatabase());
 *   const worker = await stack.use(await startWorker());
 *
 *   await process(db, worker);
 *   // Both disposed in reverse order: worker, db
 * }
 * ```
 */
export class AsyncDisposableStack implements AsyncDisposable {
  private readonly resources: Array<Disposable | AsyncDisposable> = [];
  private _disposed = false;

  /**
   * Whether this stack has been disposed.
   */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Adds a resource to the stack and returns it.
   * Resources are disposed in reverse order (LIFO).
   *
   * @param resource - The disposable or async disposable resource to add
   * @returns The same resource (for chaining)
   */
  use<T extends Disposable | AsyncDisposable>(resource: T): T {
    if (this._disposed) {
      throw new Error("AsyncDisposableStack has been disposed");
    }
    this.resources.push(resource);
    return resource;
  }

  /**
   * Adds an async cleanup callback to the stack.
   *
   * @param cleanup - Async function to call when disposed
   */
  defer(cleanup: () => Promise<void>): void {
    this.use(createAsyncDisposable(cleanup));
  }

  /**
   * Disposes all resources in reverse order.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;

    // Dispose in reverse order (LIFO)
    const errors: Error[] = [];
    while (this.resources.length > 0) {
      const resource = this.resources.pop()!;
      try {
        if (Symbol.asyncDispose in resource) {
          await resource[Symbol.asyncDispose]();
        } else {
          (resource as Disposable)[Symbol.dispose]();
        }
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    // If any errors occurred, throw an aggregate error
    if (errors.length === 1) {
      throw errors[0];
    } else if (errors.length > 1) {
      throw new AggregateError(errors, "Multiple disposal errors occurred");
    }
  }
}

/**
 * Async Utility Functions
 *
 * Provides common async patterns: deferred promises, timeouts, retries,
 * and cancellation support.
 *
 * @module
 */

// =============================================================================
// Deferred Promise
// =============================================================================

/**
 * A Promise with externally accessible resolve/reject methods.
 * Useful for bridging callback-based APIs or coordinating async operations.
 */
export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

// =============================================================================
// Timeout
// =============================================================================

/**
 * Wraps a promise with a timeout.
 * Rejects with a timeout error if the promise doesn't resolve in time.
 *
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds
 * @param message - Custom timeout error message
 */
export async function timeout<T>(
  promise: Promise<T>,
  ms: number,
  message = "Operation timed out"
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

// =============================================================================
// Sleep
// =============================================================================

/**
 * Returns a promise that resolves after the specified duration.
 *
 * @param ms - Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Mutex
// =============================================================================

/**
 * A simple async mutex for serializing access to a shared resource.
 * Uses a FIFO queue so waiters are served in order.
 */
export class Mutex {
  private _locked = false;
  private _waiters: Array<() => void> = [];

  /** Acquires the mutex, waiting if it's currently held. */
  async acquire(): Promise<void> {
    if (!this._locked) {
      this._locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this._waiters.push(resolve);
    });
  }

  /** Releases the mutex, waking the next waiter if any. */
  release(): void {
    if (this._waiters.length > 0) {
      const next = this._waiters.shift()!;
      next();
    } else {
      this._locked = false;
    }
  }

  /** Runs a function while holding the mutex, releasing on completion. */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// =============================================================================
// Retry
// =============================================================================

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of attempts (including initial attempt) */
  maxAttempts: number;
  /** Initial delay between retries in milliseconds */
  initialDelayMs: number;
  /** Maximum delay between retries in milliseconds */
  maxDelayMs: number;
  /** Multiplier for exponential backoff */
  backoffFactor: number;
  /** Optional predicate to determine if error is retryable */
  retryIf?: (error: unknown) => boolean;
  /** Optional callback on each retry */
  onRetry?: (error: unknown, attempt: number) => void;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffFactor: 2,
};

/**
 * Retries a function with exponential backoff.
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration options
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (opts.retryIf && !opts.retryIf(error)) {
        throw error;
      }

      // Don't retry if this was the last attempt
      if (attempt === opts.maxAttempts) {
        throw error;
      }

      // Notify about retry
      opts.onRetry?.(error, attempt);

      // Wait before next attempt
      await sleep(delay);
      delay = Math.min(delay * opts.backoffFactor, opts.maxDelayMs);
    }
  }

  throw lastError;
}

// =============================================================================
// Cancellation
// =============================================================================

/**
 * A token that can be used to cancel async operations.
 * Follows the cancellation token pattern for cooperative cancellation.
 */
export class CancellationToken {
  private _cancelled = false;
  private _reason?: string;
  private listeners: Array<() => void> = [];

  /** Whether the token has been cancelled */
  get cancelled(): boolean {
    return this._cancelled;
  }

  /** The reason for cancellation (if any) */
  get reason(): string | undefined {
    return this._reason;
  }

  /**
   * Cancels the token, notifying all listeners.
   *
   * @param reason - Optional reason for cancellation
   */
  cancel(reason?: string): void {
    if (!this._cancelled) {
      this._cancelled = true;
      this._reason = reason;
      this.listeners.forEach((fn) => fn());
      this.listeners = []; // Clear listeners after notification
    }
  }

  /**
   * Registers a callback to be called when the token is cancelled.
   * If already cancelled, the callback is invoked immediately.
   *
   * @param fn - Callback to invoke on cancellation
   * @returns Unsubscribe function
   */
  onCancel(fn: () => void): () => void {
    if (this._cancelled) {
      fn();
      return () => {};
    }
    this.listeners.push(fn);
    return () => {
      const idx = this.listeners.indexOf(fn);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Throws an error if the token has been cancelled.
   * Use this for cooperative cancellation checks.
   */
  throwIfCancelled(): void {
    if (this._cancelled) {
      throw new Error(this._reason ?? "Operation cancelled");
    }
  }
}

/**
 * A CancellationToken source that owns and can cancel a token.
 */
export class CancellationTokenSource {
  readonly token: CancellationToken;

  constructor() {
    this.token = new CancellationToken();
  }

  /**
   * Cancels the associated token.
   *
   * @param reason - Optional reason for cancellation
   */
  cancel(reason?: string): void {
    this.token.cancel(reason);
  }
}

// =============================================================================
// Throttle & Debounce
// =============================================================================

/**
 * Throttles a function to be called at most once per interval.
 *
 * @param fn - The function to throttle
 * @param ms - Minimum interval between calls in milliseconds
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let pendingCall: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    const elapsed = now - lastCall;

    if (elapsed >= ms) {
      lastCall = now;
      fn(...args);
    } else if (!pendingCall) {
      pendingCall = setTimeout(() => {
        lastCall = Date.now();
        pendingCall = null;
        fn(...args);
      }, ms - elapsed);
    }
  };
}

/**
 * Debounces a function to be called only after a period of inactivity.
 *
 * @param fn - The function to debounce
 * @param ms - Delay in milliseconds after last call
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn(...args);
    }, ms);
  };
}

// =============================================================================
// Concurrency Utilities
// =============================================================================

/**
 * Runs promises in parallel with a concurrency limit.
 *
 * @param items - Items to process
 * @param fn - Async function to apply to each item
 * @param concurrency - Maximum concurrent operations
 */
export async function mapConcurrent<T, U>(
  items: T[],
  fn: (item: T, index: number) => Promise<U>,
  concurrency: number
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await fn(items[index]!, index);
    }
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

/**
 * Runs an async function for each item with a concurrency limit.
 *
 * @param items - Items to process
 * @param fn - Async function to apply to each item
 * @param concurrency - Maximum concurrent operations
 */
export async function forEachConcurrent<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
  concurrency: number
): Promise<void> {
  await mapConcurrent(items, fn, concurrency);
}

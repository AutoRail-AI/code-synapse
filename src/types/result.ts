/**
 * Result Type for Functional Error Handling
 *
 * Provides a type-safe way to handle expected failure cases without exceptions.
 * Inspired by Rust's Result type and functional programming patterns.
 *
 * @module
 */

// =============================================================================
// Result Type Definition
// =============================================================================

/**
 * Result type representing either success (Ok) or failure (Err)
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// =============================================================================
// Constructors
// =============================================================================

/**
 * Creates a successful Result containing a value
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Creates a failed Result containing an error
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a Result is Ok
 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

/**
 * Type guard to check if a Result is Err
 */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

// =============================================================================
// Unwrapping
// =============================================================================

/**
 * Extracts the value from a Result, throwing if it's an error
 *
 * @throws The contained error if Result is Err
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}

/**
 * Extracts the value from a Result, returning a default if it's an error
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

/**
 * Extracts the value from a Result, computing a default if it's an error
 */
export function unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
  return result.ok ? result.value : fn(result.error);
}

/**
 * Extracts the error from a Result, throwing if it's Ok
 *
 * @throws Error if Result is Ok
 */
export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (!result.ok) return result.error;
  throw new Error("Called unwrapErr on an Ok result");
}

// =============================================================================
// Transformations
// =============================================================================

/**
 * Maps the Ok value of a Result using the provided function
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Maps the Err value of a Result using the provided function
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/**
 * Chains Result operations (flatMap/andThen)
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/**
 * Returns the provided Result if this Result is Ok, otherwise returns this Err
 */
export function and<T, U, E>(result: Result<T, E>, other: Result<U, E>): Result<U, E> {
  return result.ok ? other : result;
}

/**
 * Returns the provided Result if this Result is Err, otherwise returns this Ok
 */
export function or<T, E, F>(result: Result<T, E>, other: Result<T, F>): Result<T, F> {
  return result.ok ? result : other;
}

// =============================================================================
// Async Utilities
// =============================================================================

/**
 * Wraps a Promise in a Result, catching any errors
 */
export async function fromPromise<T>(promise: Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await promise);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Wraps a Promise in a Result with a custom error type
 */
export async function fromPromiseWith<T, E>(
  promise: Promise<T>,
  errorMapper: (error: unknown) => E
): Promise<Result<T, E>> {
  try {
    return ok(await promise);
  } catch (error) {
    return err(errorMapper(error));
  }
}

/**
 * Converts a Result containing a Promise to a Promise containing a Result.
 * Note: Promise rejection will propagate as a rejected Promise, not as Result error.
 */
export async function transpose<T, E>(
  result: Result<Promise<T>, E>
): Promise<Result<T, E>> {
  if (!result.ok) return result;
  return ok(await result.value);
}

// =============================================================================
// Collection Utilities
// =============================================================================

/**
 * Collects an array of Results into a Result of array
 * Returns Err with the first error encountered, or Ok with all values
 */
export function collect<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Partitions an array of Results into Ok values and Err values
 */
export function partition<T, E>(results: Result<T, E>[]): { oks: T[]; errs: E[] } {
  const oks: T[] = [];
  const errs: E[] = [];
  for (const result of results) {
    if (result.ok) {
      oks.push(result.value);
    } else {
      errs.push(result.error);
    }
  }
  return { oks, errs };
}

// =============================================================================
// Convenience Methods
// =============================================================================

/**
 * Executes a side effect if the Result is Ok
 */
export function tap<T, E>(result: Result<T, E>, fn: (value: T) => void): Result<T, E> {
  if (result.ok) fn(result.value);
  return result;
}

/**
 * Executes a side effect if the Result is Err
 */
export function tapErr<T, E>(result: Result<T, E>, fn: (error: E) => void): Result<T, E> {
  if (!result.ok) fn(result.error);
  return result;
}

/**
 * Returns true if the Result is Ok and the value matches the predicate
 */
export function matches<T, E>(result: Result<T, E>, predicate: (value: T) => boolean): boolean {
  return result.ok && predicate(result.value);
}

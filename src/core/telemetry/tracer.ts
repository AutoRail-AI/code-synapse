/**
 * Tracer Implementation
 *
 * Lightweight OpenTelemetry-compatible tracer for performance observability.
 * Can be swapped for full OpenTelemetry SDK when needed.
 *
 * @module
 */

import * as crypto from "node:crypto";
import type {
  Span,
  SpanContext,
  SpanAttributes,
  SpanEvent,
  SpanStatus,
  SpanOptions,
  SpanData,
  Tracer,
  TelemetryConfig,
  AttributeValue,
} from "./types.js";
import { SpanStatusCode } from "./types.js";

// =============================================================================
// ID Generation
// =============================================================================

/**
 * Generates a random trace ID (128-bit hex string)
 */
function generateTraceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Generates a random span ID (64-bit hex string)
 */
function generateSpanId(): string {
  return crypto.randomBytes(8).toString("hex");
}

// =============================================================================
// Span Implementation
// =============================================================================

/**
 * Concrete span implementation
 */
class SpanImpl implements Span {
  readonly spanContext: SpanContext;
  readonly name: string;
  private _isEnded = false;
  private _startTime: number;
  private _endTime?: number;
  private _attributes: SpanAttributes = {};
  private _events: SpanEvent[] = [];
  private _status: SpanStatus = { code: SpanStatusCode.UNSET };
  private onEnd?: (span: SpanData) => void;

  constructor(
    name: string,
    context: SpanContext,
    startTime: number,
    onEnd?: (span: SpanData) => void
  ) {
    this.name = name;
    this.spanContext = context;
    this._startTime = startTime;
    this.onEnd = onEnd;
  }

  get isEnded(): boolean {
    return this._isEnded;
  }

  setAttribute(key: string, value: AttributeValue): this {
    if (!this._isEnded) {
      this._attributes[key] = value;
    }
    return this;
  }

  setAttributes(attributes: SpanAttributes): this {
    if (!this._isEnded) {
      Object.assign(this._attributes, attributes);
    }
    return this;
  }

  addEvent(name: string, attributes?: SpanAttributes): this {
    if (!this._isEnded) {
      this._events.push({
        name,
        timestamp: Date.now(),
        attributes,
      });
    }
    return this;
  }

  recordException(error: Error): this {
    if (!this._isEnded) {
      this._events.push({
        name: "exception",
        timestamp: Date.now(),
        attributes: {
          "exception.type": error.name,
          "exception.message": error.message,
          "exception.stacktrace": error.stack ?? "",
        },
      });
      // Set error status if not already set
      if (this._status.code === SpanStatusCode.UNSET) {
        this._status = {
          code: SpanStatusCode.ERROR,
          message: error.message,
        };
      }
    }
    return this;
  }

  setStatus(status: SpanStatus): this {
    if (!this._isEnded) {
      this._status = status;
    }
    return this;
  }

  end(endTime?: number): void {
    if (this._isEnded) return;

    this._isEnded = true;
    this._endTime = endTime ?? Date.now();

    // Notify the tracer that this span has ended
    if (this.onEnd) {
      this.onEnd(this.toSpanData());
    }
  }

  /**
   * Converts span to exportable data format
   */
  toSpanData(): SpanData {
    const endTime = this._endTime ?? Date.now();
    return {
      context: this.spanContext,
      name: this.name,
      startTime: this._startTime,
      endTime,
      duration: endTime - this._startTime,
      attributes: { ...this._attributes },
      events: [...this._events],
      status: { ...this._status },
    };
  }
}

// =============================================================================
// No-Op Span (for disabled telemetry)
// =============================================================================

/**
 * No-op span that does nothing (used when telemetry is disabled)
 */
class NoOpSpan implements Span {
  readonly spanContext: SpanContext = {
    traceId: "0".repeat(32),
    spanId: "0".repeat(16),
  };
  readonly name = "";
  readonly isEnded = true;

  setAttribute(): this {
    return this;
  }
  setAttributes(): this {
    return this;
  }
  addEvent(): this {
    return this;
  }
  recordException(): this {
    return this;
  }
  setStatus(): this {
    return this;
  }
  end(): void {}
}

const NO_OP_SPAN = new NoOpSpan();

// =============================================================================
// Tracer Implementation
// =============================================================================

/**
 * Concrete tracer implementation
 */
class TracerImpl implements Tracer {
  readonly name: string;
  private config: TelemetryConfig;
  private spanBuffer: SpanData[] = [];
  private exportTimer?: ReturnType<typeof setInterval>;
  private currentSpan?: Span;

  constructor(name: string, config: TelemetryConfig) {
    this.name = name;
    this.config = config;

    // Set up periodic export if exporter is configured
    if (config.exporter && config.exportIntervalMs) {
      this.exportTimer = setInterval(() => {
        this.flush().catch(() => {
          // Silently ignore export errors
        });
      }, config.exportIntervalMs);
    }
  }

  startSpan(name: string, options?: SpanOptions): Span {
    if (!this.config.enabled) {
      return NO_OP_SPAN;
    }

    const parentSpan = options?.parent ?? this.currentSpan;
    const traceId = parentSpan?.spanContext.traceId ?? generateTraceId();
    const spanId = generateSpanId();
    const parentSpanId = parentSpan?.spanContext.spanId;

    const context: SpanContext = {
      traceId,
      spanId,
      parentSpanId,
    };

    const startTime = options?.startTime ?? Date.now();
    const span = new SpanImpl(name, context, startTime, (data) => {
      this.onSpanEnd(data);
    });

    if (options?.attributes) {
      span.setAttributes(options.attributes);
    }

    return span;
  }

  startActiveSpan<T>(
    name: string,
    fn: (span: Span) => T | Promise<T>,
    options?: SpanOptions
  ): T | Promise<T> {
    const span = this.startSpan(name, options);
    const previousSpan = this.currentSpan;
    this.currentSpan = span;

    try {
      const result = fn(span);

      // Handle async functions
      if (result instanceof Promise) {
        return result
          .then((value) => {
            if (span.isEnded === false) {
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
            }
            return value;
          })
          .catch((error) => {
            if (span.isEnded === false) {
              span.recordException(
                error instanceof Error ? error : new Error(String(error))
              );
              span.end();
            }
            throw error;
          })
          .finally(() => {
            this.currentSpan = previousSpan;
          }) as Promise<T>;
      }

      // Handle sync functions
      if (span.isEnded === false) {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      }
      this.currentSpan = previousSpan;
      return result;
    } catch (error) {
      if (span.isEnded === false) {
        span.recordException(
          error instanceof Error ? error : new Error(String(error))
        );
        span.end();
      }
      this.currentSpan = previousSpan;
      throw error;
    }
  }

  /**
   * Called when a span ends
   */
  private onSpanEnd(spanData: SpanData): void {
    this.spanBuffer.push(spanData);

    // Export if buffer is full
    const maxBuffer = this.config.maxBufferSize ?? 100;
    if (this.spanBuffer.length >= maxBuffer) {
      this.flush().catch(() => {
        // Silently ignore export errors
      });
    }
  }

  /**
   * Flushes buffered spans to the exporter
   */
  async flush(): Promise<void> {
    if (!this.config.exporter || this.spanBuffer.length === 0) {
      return;
    }

    const spans = this.spanBuffer.splice(0);
    await this.config.exporter.export(spans);
  }

  /**
   * Shuts down the tracer
   */
  async shutdown(): Promise<void> {
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
    }

    await this.flush();

    if (this.config.exporter) {
      await this.config.exporter.shutdown();
    }
  }
}

// =============================================================================
// No-Op Tracer (for disabled telemetry)
// =============================================================================

/**
 * No-op tracer that does nothing (used when telemetry is disabled)
 */
class NoOpTracer implements Tracer {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  startSpan(): Span {
    return NO_OP_SPAN;
  }

  startActiveSpan<T>(
    _name: string,
    fn: (span: Span) => T | Promise<T>
  ): T | Promise<T> {
    return fn(NO_OP_SPAN);
  }
}

// =============================================================================
// Telemetry Manager
// =============================================================================

/**
 * Global telemetry manager
 */
class TelemetryManager {
  private config: TelemetryConfig = {
    enabled: false,
    serviceName: "code-synapse",
    maxBufferSize: 100,
    exportIntervalMs: 5000,
  };
  private tracers = new Map<string, TracerImpl>();
  private initialized = false;

  /**
   * Initializes telemetry with the given configuration.
   */
  init(config: Partial<TelemetryConfig>): void {
    this.config = { ...this.config, ...config };
    this.initialized = true;
  }

  /**
   * Gets or creates a tracer with the given name.
   */
  getTracer(name: string): Tracer {
    if (!this.config.enabled) {
      return new NoOpTracer(name);
    }

    let tracer = this.tracers.get(name);
    if (!tracer) {
      tracer = new TracerImpl(name, this.config);
      this.tracers.set(name, tracer);
    }
    return tracer;
  }

  /**
   * Shuts down all tracers and exporters.
   */
  async shutdown(): Promise<void> {
    const shutdownPromises = Array.from(this.tracers.values()).map((tracer) =>
      tracer.shutdown()
    );
    await Promise.all(shutdownPromises);
    this.tracers.clear();
  }

  /**
   * Whether telemetry is enabled.
   */
  get isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Whether telemetry has been initialized.
   */
  get isInitialized(): boolean {
    return this.initialized;
  }
}

// =============================================================================
// Exports
// =============================================================================

/** Global telemetry manager instance */
export const telemetry = new TelemetryManager();

/**
 * Initializes the telemetry system.
 *
 * @param config - Telemetry configuration
 */
export function initTelemetry(config: Partial<TelemetryConfig>): void {
  telemetry.init(config);
}

/**
 * Gets a tracer for the given scope.
 *
 * @param name - Tracer name (typically module name)
 */
export function getTracer(name: string): Tracer {
  return telemetry.getTracer(name);
}

/**
 * Shuts down the telemetry system.
 */
export async function shutdownTelemetry(): Promise<void> {
  await telemetry.shutdown();
}

// =============================================================================
// Decorator for Automatic Tracing
// =============================================================================

/**
 * Method decorator for automatic tracing.
 * Wraps the method in a span that automatically records duration and errors.
 *
 * @param spanName - Optional custom span name (defaults to ClassName.methodName)
 *
 * @example
 * ```typescript
 * class Indexer {
 *   @traced()
 *   async indexFile(filePath: string): Promise<void> {
 *     // Automatically traced as "Indexer.indexFile"
 *   }
 *
 *   @traced('custom-span-name')
 *   async process(): Promise<void> {
 *     // Traced as "custom-span-name"
 *   }
 * }
 * ```
 */
export function traced(spanName?: string) {
  return function <T extends (...args: unknown[]) => unknown>(
    originalMethod: T,
    context: ClassMethodDecoratorContext
  ): T {
    const methodName = String(context.name);

    function replacement(this: unknown, ...args: unknown[]): unknown {
      const name =
        spanName ??
        `${(this as object).constructor.name}.${methodName}`;

      const tracer = getTracer("code-synapse");
      return tracer.startActiveSpan(name, () => {
        return originalMethod.apply(this, args);
      });
    }

    return replacement as T;
  };
}

/**
 * Creates a child span within the current trace context.
 * Use for manual instrumentation of specific operations.
 *
 * @param name - Span name
 * @param fn - Function to execute within the span
 * @param tracerName - Optional tracer name (defaults to "code-synapse")
 *
 * @example
 * ```typescript
 * const result = await withSpan('parse-file', async (span) => {
 *   span.setAttribute('file', filePath);
 *   const ast = await parseFile(filePath);
 *   span.setAttribute('nodeCount', ast.nodeCount);
 *   return ast;
 * });
 * ```
 */
export function withSpan<T>(
  name: string,
  fn: (span: Span) => T | Promise<T>,
  tracerName = "code-synapse"
): T | Promise<T> {
  const tracer = getTracer(tracerName);
  return tracer.startActiveSpan(name, fn);
}

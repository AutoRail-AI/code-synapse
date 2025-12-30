/**
 * Telemetry Types
 *
 * Core interfaces for the telemetry system. These follow OpenTelemetry patterns
 * but provide a lightweight implementation that can be swapped for full OTel later.
 *
 * @module
 */

// =============================================================================
// Span Status
// =============================================================================

/**
 * Span status codes following OpenTelemetry conventions
 */
export enum SpanStatusCode {
  /** Default status, span completed without errors */
  UNSET = 0,
  /** Span completed successfully */
  OK = 1,
  /** Span completed with an error */
  ERROR = 2,
}

/**
 * Span status with optional message
 */
export interface SpanStatus {
  code: SpanStatusCode;
  message?: string;
}

// =============================================================================
// Span Context
// =============================================================================

/**
 * Unique identifier for a trace (128-bit as hex string)
 */
export type TraceId = string;

/**
 * Unique identifier for a span (64-bit as hex string)
 */
export type SpanId = string;

/**
 * Context identifying a span within a trace
 */
export interface SpanContext {
  /** Trace identifier */
  traceId: TraceId;
  /** Span identifier */
  spanId: SpanId;
  /** Parent span identifier (undefined for root spans) */
  parentSpanId?: SpanId;
}

// =============================================================================
// Span Attributes
// =============================================================================

/**
 * Allowed attribute value types
 */
export type AttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];

/**
 * Map of span attributes
 */
export type SpanAttributes = Record<string, AttributeValue>;

// =============================================================================
// Span Events
// =============================================================================

/**
 * Event recorded during span execution
 */
export interface SpanEvent {
  /** Event name */
  name: string;
  /** Timestamp when event occurred */
  timestamp: number;
  /** Event attributes */
  attributes?: SpanAttributes;
}

// =============================================================================
// Span Interface
// =============================================================================

/**
 * A span represents a single operation within a trace.
 */
export interface Span {
  /** Get the span context */
  readonly spanContext: SpanContext;

  /** Get the span name */
  readonly name: string;

  /** Whether the span has ended */
  readonly isEnded: boolean;

  /**
   * Sets a single attribute on the span.
   *
   * @param key - Attribute key
   * @param value - Attribute value
   */
  setAttribute(key: string, value: AttributeValue): this;

  /**
   * Sets multiple attributes on the span.
   *
   * @param attributes - Map of attributes to set
   */
  setAttributes(attributes: SpanAttributes): this;

  /**
   * Records an event on the span.
   *
   * @param name - Event name
   * @param attributes - Optional event attributes
   */
  addEvent(name: string, attributes?: SpanAttributes): this;

  /**
   * Records an exception on the span.
   *
   * @param error - The error to record
   */
  recordException(error: Error): this;

  /**
   * Sets the span status.
   *
   * @param status - Status to set
   */
  setStatus(status: SpanStatus): this;

  /**
   * Ends the span, recording the end timestamp.
   *
   * @param endTime - Optional explicit end time (defaults to now)
   */
  end(endTime?: number): void;
}

// =============================================================================
// Tracer Interface
// =============================================================================

/**
 * Options for starting a span
 */
export interface SpanOptions {
  /** Attributes to set on the span */
  attributes?: SpanAttributes;
  /** Explicit start time (defaults to now) */
  startTime?: number;
  /** Parent span to link to */
  parent?: Span;
}

/**
 * A tracer creates spans for a specific instrumentation scope.
 */
export interface Tracer {
  /** Tracer name (typically module/library name) */
  readonly name: string;

  /**
   * Creates and starts a new span.
   *
   * @param name - Span name
   * @param options - Span creation options
   */
  startSpan(name: string, options?: SpanOptions): Span;

  /**
   * Creates a span and executes a function within its context.
   * Automatically ends the span when the function completes.
   *
   * @param name - Span name
   * @param fn - Function to execute within the span
   * @param options - Span creation options
   */
  startActiveSpan<T>(
    name: string,
    fn: (span: Span) => T,
    options?: SpanOptions
  ): T;

  /**
   * Creates a span and executes an async function within its context.
   * Automatically ends the span when the promise resolves/rejects.
   *
   * @param name - Span name
   * @param fn - Async function to execute within the span
   * @param options - Span creation options
   */
  startActiveSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options?: SpanOptions
  ): Promise<T>;
}

// =============================================================================
// Trace Exporter Interface
// =============================================================================

/**
 * Completed span data for export
 */
export interface SpanData {
  /** Span context */
  context: SpanContext;
  /** Span name */
  name: string;
  /** Start timestamp (ms since epoch) */
  startTime: number;
  /** End timestamp (ms since epoch) */
  endTime: number;
  /** Duration in milliseconds */
  duration: number;
  /** Span attributes */
  attributes: SpanAttributes;
  /** Span events */
  events: SpanEvent[];
  /** Span status */
  status: SpanStatus;
}

/**
 * Interface for exporting completed spans
 */
export interface SpanExporter {
  /**
   * Exports a batch of spans.
   *
   * @param spans - Spans to export
   */
  export(spans: SpanData[]): Promise<void>;

  /**
   * Shuts down the exporter, flushing any buffered data.
   */
  shutdown(): Promise<void>;
}

// =============================================================================
// Telemetry Configuration
// =============================================================================

/**
 * Telemetry configuration options
 */
export interface TelemetryConfig {
  /** Whether telemetry is enabled */
  enabled: boolean;
  /** Service name for traces */
  serviceName: string;
  /** Span exporter (optional, defaults to no-op) */
  exporter?: SpanExporter;
  /** Maximum spans to buffer before export */
  maxBufferSize?: number;
  /** Export interval in milliseconds */
  exportIntervalMs?: number;
}

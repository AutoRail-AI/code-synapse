/**
 * Telemetry Module
 *
 * Provides performance observability through OpenTelemetry-compatible tracing.
 * Helps identify bottlenecks during indexing and query operations.
 *
 * @example
 * ```typescript
 * import {
 *   initTelemetry,
 *   getTracer,
 *   withSpan,
 *   FileTraceExporter,
 * } from './core/telemetry/index.js';
 *
 * // Initialize with file exporter
 * initTelemetry({
 *   enabled: true,
 *   serviceName: 'code-synapse',
 *   exporter: new FileTraceExporter({
 *     outputDir: '.code-synapse/traces',
 *   }),
 * });
 *
 * // Use tracer directly
 * const tracer = getTracer('indexer');
 * const span = tracer.startSpan('index-file');
 * span.setAttribute('file', '/path/to/file.ts');
 * // ... do work ...
 * span.end();
 *
 * // Or use withSpan helper
 * const result = await withSpan('parse-file', async (span) => {
 *   span.setAttribute('file', filePath);
 *   return await parseFile(filePath);
 * });
 * ```
 *
 * @module
 */

// Re-export types
export * from "./types.js";

// Re-export tracer
export {
  telemetry,
  initTelemetry,
  getTracer,
  shutdownTelemetry,
  traced,
  withSpan,
} from "./tracer.js";

// Re-export exporters
export {
  FileTraceExporter,
  ConsoleTraceExporter,
  MemoryTraceExporter,
  type FileExporterOptions,
} from "./file-exporter.js";

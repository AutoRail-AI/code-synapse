/**
 * File Trace Exporter
 *
 * Exports trace data to local files for debugging and performance analysis.
 * Traces can be viewed in Chrome's chrome://tracing, Jaeger, or Zipkin.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SpanData, SpanExporter } from "./types.js";
import { SpanStatusCode } from "./types.js";

// =============================================================================
// Chrome Trace Format
// =============================================================================

/**
 * Chrome trace event format for chrome://tracing
 * @see https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU
 */
interface ChromeTraceEvent {
  /** Event name */
  name: string;
  /** Category */
  cat: string;
  /** Phase: B=begin, E=end, X=complete */
  ph: "B" | "E" | "X";
  /** Timestamp in microseconds */
  ts: number;
  /** Duration in microseconds (for ph="X") */
  dur?: number;
  /** Process ID */
  pid: number;
  /** Thread ID */
  tid: string;
  /** Arguments/attributes */
  args?: Record<string, unknown>;
}

/**
 * Chrome trace format root object
 */
interface ChromeTraceFormat {
  traceEvents: ChromeTraceEvent[];
  displayTimeUnit: "ms" | "ns";
  metadata?: Record<string, unknown>;
}

// =============================================================================
// File Exporter Implementation
// =============================================================================

/**
 * Configuration for the file exporter
 */
export interface FileExporterOptions {
  /** Directory to write trace files */
  outputDir: string;
  /** Maximum file size in bytes before rotation (default: 10MB) */
  maxFileSizeBytes?: number;
  /** Maximum number of trace files to keep (default: 10) */
  maxFiles?: number;
  /** File name prefix (default: "trace") */
  filePrefix?: string;
  /** Whether to pretty-print JSON (default: false) */
  prettyPrint?: boolean;
}

/**
 * Exports spans to local JSON files in Chrome trace format.
 *
 * @example
 * ```typescript
 * const exporter = new FileTraceExporter({
 *   outputDir: '.code-synapse/traces',
 *   maxFiles: 5,
 * });
 *
 * initTelemetry({
 *   enabled: true,
 *   serviceName: 'code-synapse',
 *   exporter,
 * });
 * ```
 */
export class FileTraceExporter implements SpanExporter {
  private options: Required<FileExporterOptions>;
  private currentFileIndex = 0;
  private currentFileSize = 0;
  private events: ChromeTraceEvent[] = [];
  private isShuttingDown = false;

  constructor(options: FileExporterOptions) {
    this.options = {
      outputDir: options.outputDir,
      maxFileSizeBytes: options.maxFileSizeBytes ?? 10 * 1024 * 1024, // 10MB
      maxFiles: options.maxFiles ?? 10,
      filePrefix: options.filePrefix ?? "trace",
      prettyPrint: options.prettyPrint ?? false,
    };

    // Ensure output directory exists
    this.ensureOutputDir();
  }

  /**
   * Ensures the output directory exists.
   */
  private ensureOutputDir(): void {
    if (!fs.existsSync(this.options.outputDir)) {
      fs.mkdirSync(this.options.outputDir, { recursive: true });
    }
  }

  /**
   * Converts a span to Chrome trace events.
   */
  private spanToEvents(span: SpanData): ChromeTraceEvent[] {
    const baseEvent: Omit<ChromeTraceEvent, "ph" | "ts" | "dur"> = {
      name: span.name,
      cat: "code-synapse",
      pid: process.pid,
      tid: span.context.traceId.substring(0, 8), // Use trace ID as thread
      args: {
        ...span.attributes,
        spanId: span.context.spanId,
        traceId: span.context.traceId,
        parentSpanId: span.context.parentSpanId,
        status: SpanStatusCode[span.status.code],
        statusMessage: span.status.message,
      },
    };

    const events: ChromeTraceEvent[] = [];

    // Use complete event (X) for spans with duration
    events.push({
      ...baseEvent,
      ph: "X",
      ts: span.startTime * 1000, // Convert to microseconds
      dur: span.duration * 1000,
    });

    // Add span events as instant events
    for (const event of span.events) {
      events.push({
        name: event.name,
        cat: "event",
        ph: "X",
        ts: event.timestamp * 1000,
        dur: 0,
        pid: process.pid,
        tid: span.context.traceId.substring(0, 8),
        args: event.attributes,
      });
    }

    return events;
  }

  /**
   * Gets the current trace file path.
   */
  private getCurrentFilePath(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return path.join(
      this.options.outputDir,
      `${this.options.filePrefix}-${timestamp}-${this.currentFileIndex}.json`
    );
  }

  /**
   * Rotates to a new file if current file is too large.
   */
  private async rotateIfNeeded(): Promise<void> {
    if (this.currentFileSize >= this.options.maxFileSizeBytes) {
      await this.writeCurrentFile();
      this.currentFileIndex++;
      this.currentFileSize = 0;
      this.events = [];

      // Clean up old files
      await this.cleanupOldFiles();
    }
  }

  /**
   * Writes the current buffer to a file.
   */
  private async writeCurrentFile(): Promise<void> {
    if (this.events.length === 0) return;

    const traceData: ChromeTraceFormat = {
      traceEvents: this.events,
      displayTimeUnit: "ms",
      metadata: {
        serviceName: "code-synapse",
        exportedAt: new Date().toISOString(),
        spanCount: this.events.length,
      },
    };

    const content = this.options.prettyPrint
      ? JSON.stringify(traceData, null, 2)
      : JSON.stringify(traceData);

    const filePath = this.getCurrentFilePath();
    await fs.promises.writeFile(filePath, content, "utf-8");
  }

  /**
   * Cleans up old trace files beyond maxFiles limit.
   */
  private async cleanupOldFiles(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.options.outputDir);
      const traceFiles = files
        .filter((f) => f.startsWith(this.options.filePrefix) && f.endsWith(".json"))
        .map((f) => ({
          name: f,
          path: path.join(this.options.outputDir, f),
        }));

      // Sort by modification time (oldest first)
      const fileStats = await Promise.all(
        traceFiles.map(async (f) => ({
          ...f,
          mtime: (await fs.promises.stat(f.path)).mtime.getTime(),
        }))
      );
      fileStats.sort((a, b) => a.mtime - b.mtime);

      // Delete oldest files beyond limit
      const filesToDelete = fileStats.slice(
        0,
        Math.max(0, fileStats.length - this.options.maxFiles)
      );
      await Promise.all(filesToDelete.map((f) => fs.promises.unlink(f.path)));
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Exports spans to the trace file.
   */
  async export(spans: SpanData[]): Promise<void> {
    if (this.isShuttingDown) return;

    for (const span of spans) {
      const events = this.spanToEvents(span);
      this.events.push(...events);

      // Estimate size increase
      const eventSize = JSON.stringify(events).length;
      this.currentFileSize += eventSize;

      await this.rotateIfNeeded();
    }
  }

  /**
   * Shuts down the exporter, flushing any buffered data.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    await this.writeCurrentFile();
  }
}

// =============================================================================
// Console Exporter (for debugging)
// =============================================================================

/**
 * Exports spans to the console for debugging.
 */
export class ConsoleTraceExporter implements SpanExporter {
  private showAttributes: boolean;

  constructor(options?: { showAttributes?: boolean }) {
    this.showAttributes = options?.showAttributes ?? true;
  }

  async export(spans: SpanData[]): Promise<void> {
    for (const span of spans) {
      const status = SpanStatusCode[span.status.code];
      const indent = span.context.parentSpanId ? "  " : "";

      console.log(
        `${indent}[TRACE] ${span.name} (${span.duration.toFixed(2)}ms) [${status}]`
      );

      if (this.showAttributes && Object.keys(span.attributes).length > 0) {
        console.log(`${indent}  attrs:`, span.attributes);
      }

      for (const event of span.events) {
        console.log(`${indent}  event: ${event.name}`, event.attributes ?? "");
      }

      if (span.status.message) {
        console.log(`${indent}  message: ${span.status.message}`);
      }
    }
  }

  async shutdown(): Promise<void> {
    // Nothing to clean up
  }
}

// =============================================================================
// Memory Exporter (for testing)
// =============================================================================

/**
 * Exports spans to memory for testing and inspection.
 */
export class MemoryTraceExporter implements SpanExporter {
  private spans: SpanData[] = [];

  async export(spans: SpanData[]): Promise<void> {
    this.spans.push(...spans);
  }

  async shutdown(): Promise<void> {
    // Nothing to clean up
  }

  /**
   * Gets all exported spans.
   */
  getSpans(): SpanData[] {
    return [...this.spans];
  }

  /**
   * Clears all exported spans.
   */
  clear(): void {
    this.spans = [];
  }

  /**
   * Gets spans matching a predicate.
   */
  findSpans(predicate: (span: SpanData) => boolean): SpanData[] {
    return this.spans.filter(predicate);
  }

  /**
   * Gets a span by name.
   */
  findByName(name: string): SpanData | undefined {
    return this.spans.find((s) => s.name === name);
  }
}

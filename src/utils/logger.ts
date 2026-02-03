/**
 * Logger Module
 * Structured logging using pino with file and console output
 */

import pino, { type Logger as PinoLogger, type DestinationStream } from "pino";
import * as fs from "node:fs";
import * as path from "node:path";
import { getConfigDir } from "./index.js";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LoggerOptions {
  level?: LogLevel;
  component?: string;
  enableFileLogging?: boolean;
  logDir?: string;
}

const LOG_DIR_NAME = "logs";

// =============================================================================
// Log Suppression for Interactive Prompts
// =============================================================================

/**
 * Global state for log suppression during interactive prompts.
 * When true, logs are buffered instead of being written immediately.
 */
let loggingSuppressed = false;

/**
 * Buffer to hold suppressed log entries
 */
const suppressedLogBuffer: string[] = [];

/**
 * Pause logging output. Use before showing interactive prompts.
 * Logs will be buffered and written when resumeLogging() is called.
 * 
 * @example
 * ```typescript
 * pauseLogging();
 * const answer = await rl.question("Continue? (Y/n)");
 * resumeLogging();
 * ```
 */
export function pauseLogging(): void {
  loggingSuppressed = true;
}

/**
 * Resume logging output. Call after user responds to interactive prompt.
 * This will NOT flush buffered logs - they are discarded to keep the
 * terminal clean after user input.
 */
export function resumeLogging(): void {
  // Discard buffered logs to keep terminal clean
  suppressedLogBuffer.length = 0;
  loggingSuppressed = false;
}

/**
 * Check if logging is currently suppressed
 */
export function isLoggingSuppressed(): boolean {
  return loggingSuppressed;
}

// =============================================================================
// Log Directory Helpers
// =============================================================================

/**
 * Ensures the log directory exists
 */
function ensureLogDir(logDir: string): void {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Get the default log directory path
 */
function getLogDir(customDir?: string): string {
  if (customDir) return customDir;
  return path.join(getConfigDir(), LOG_DIR_NAME);
}

/**
 * Determine if we're in development mode
 */
function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Get log level from environment or default
 */
function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  const validLevels: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
  if (envLevel && validLevels.includes(envLevel as LogLevel)) {
    return envLevel as LogLevel;
  }
  return isDevelopment() ? "debug" : "info";
}

/**
 * Check if file logging should be enabled
 * Enable via CODE_SYNAPSE_LOG_FILE=true or LOG_TO_FILE=true
 */
function shouldEnableFileLogging(): boolean {
  return (
    process.env.CODE_SYNAPSE_LOG_FILE === "true" ||
    process.env.LOG_TO_FILE === "true"
  );
}

/**
 * Create a destination stream that respects log suppression.
 * Wraps another destination and buffers writes when suppressed.
 */
function createSuppressibleDestination(target: DestinationStream | NodeJS.WritableStream): DestinationStream {
  return {
    write(msg: string): void {
      if (loggingSuppressed) {
        // Buffer the log but don't write it
        suppressedLogBuffer.push(msg);
        return;
      }
      (target as NodeJS.WritableStream).write(msg);
    },
  };
}

/**
 * Create a logger instance for a specific component
 *
 * @param component - The component name (e.g., "parser", "indexer", "mcp")
 * @param options - Optional configuration
 * @returns A configured pino logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger("parser");
 * logger.info("Parsing file", { file: "index.ts" });
 * logger.error({ err }, "Failed to parse file");
 * ```
 */
export function createLogger(
  component: string,
  options: LoggerOptions = {}
): PinoLogger {
  const {
    level = getLogLevel(),
    enableFileLogging = options.enableFileLogging ?? shouldEnableFileLogging(),
    logDir,
  } = options;

  const baseOptions: pino.LoggerOptions = {
    name: component,
    level,
  };

  // If file logging is enabled, create a multi-stream logger (console + file)
  if (enableFileLogging) {
    const dir = getLogDir(logDir);
    ensureLogDir(dir);

    const logFile = path.join(dir, `code-synapse.log`);
    const fileStream = pino.destination({
      dest: logFile,
      sync: false,
    });

    // Wrap streams with suppression check
    const streams = [
      { stream: createSuppressibleDestination(process.stdout), level: level as pino.Level },
      { stream: fileStream, level: level as pino.Level }, // File always gets logs
    ];

    return pino(baseOptions, pino.multistream(streams));
  }

  // In development, use pretty printing if available
  if (isDevelopment()) {
    try {
      // For pino-pretty, we use a custom destination that wraps stdout
      // but respects suppression before the transport processes it
      return pino({
        ...baseOptions,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
            destination: 1, // stdout file descriptor
          },
        },
      });
    } catch {
      // Fall back to standard pino if pino-pretty not available
      return pino(baseOptions, createSuppressibleDestination(process.stdout));
    }
  }

  return pino(baseOptions, createSuppressibleDestination(process.stdout));
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(
  parent: PinoLogger,
  bindings: Record<string, unknown>
): PinoLogger {
  return parent.child(bindings);
}

/**
 * Logger type export for use in type annotations
 */
export type Logger = PinoLogger;

/**
 * Default logger instance for quick access
 */
let defaultLogger: PinoLogger | null = null;

/**
 * Get or create the default logger
 */
export function getDefaultLogger(): PinoLogger {
  if (!defaultLogger) {
    defaultLogger = createLogger("code-synapse");
  }
  return defaultLogger;
}

/**
 * Convenience logging functions using the default logger
 */
export const log = {
  trace: (msg: string, obj?: object) => getDefaultLogger().trace(obj, msg),
  debug: (msg: string, obj?: object) => getDefaultLogger().debug(obj, msg),
  info: (msg: string, obj?: object) => getDefaultLogger().info(obj, msg),
  warn: (msg: string, obj?: object) => getDefaultLogger().warn(obj, msg),
  error: (msg: string, obj?: object) => getDefaultLogger().error(obj, msg),
  fatal: (msg: string, obj?: object) => getDefaultLogger().fatal(obj, msg),
};


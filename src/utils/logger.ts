/**
 * Logger Module
 * Structured logging using pino with file and console output
 */

import pino, { type Logger as PinoLogger } from "pino";
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

    // Use pino.multistream to log to both console and file
    const streams = [
      { stream: process.stdout, level: level as pino.Level },
      { stream: fileStream, level: level as pino.Level },
    ];

    return pino(baseOptions, pino.multistream(streams));
  }

  // In development, use pretty printing if available
  if (isDevelopment()) {
    try {
      // Try to use pino-pretty for development
      return pino({
        ...baseOptions,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      });
    } catch {
      // Fall back to standard pino if pino-pretty not available
      return pino(baseOptions);
    }
  }

  return pino(baseOptions);
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

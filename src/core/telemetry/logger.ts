/**
 * Simple logger wrapper for telemetry
 *
 * Provides a consistent logging interface across modules.
 */

import pino from "pino";

// Create base logger
const baseLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
          },
        }
      : undefined,
});

/**
 * Creates a child logger with the given module name
 */
export function createLogger(moduleName: string): pino.Logger {
  return baseLogger.child({ module: moduleName });
}

/**
 * Default logger instance
 */
export const logger = baseLogger;

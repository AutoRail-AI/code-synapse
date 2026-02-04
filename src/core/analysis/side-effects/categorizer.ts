/**
 * Side-Effect Categorizer Implementation
 *
 * Categorizes API calls and expressions to determine their side-effect type.
 * Uses pattern matching and heuristics to classify detected operations.
 *
 * @module
 */

import type {
  ISideEffectCategorizer,
  SideEffectCategory,
  SideEffectPattern,
  SideEffect,
  DetectionConfidence,
} from "./interfaces.js";

// =============================================================================
// Built-in Side-Effect Patterns
// =============================================================================

/**
 * Default patterns for common side-effect APIs.
 * These patterns are used to detect and categorize side effects.
 */
export const DEFAULT_SIDE_EFFECT_PATTERNS: SideEffectPattern[] = [
  // ==========================================================================
  // File System (io-file)
  // ==========================================================================
  { pattern: "fs.writeFile", category: "io-file", description: "Writes data to a file", confidence: "high", kind: "sink" },
  { pattern: "fs.writeFileSync", category: "io-file", description: "Writes data to a file synchronously", confidence: "high", kind: "sink" },
  { pattern: "fs.readFile", category: "io-file", description: "Reads data from a file", confidence: "high", kind: "source" },
  { pattern: "fs.readFileSync", category: "io-file", description: "Reads data from a file synchronously", confidence: "high", kind: "source" },
  { pattern: "fs.appendFile", category: "io-file", description: "Appends data to a file", confidence: "high", kind: "sink" },
  { pattern: "fs.unlink", category: "io-file", description: "Deletes a file", confidence: "high", kind: "sink" },
  { pattern: "fs.mkdir", category: "io-file", description: "Creates a directory", confidence: "high", kind: "sink" },
  { pattern: "fs.rmdir", category: "io-file", description: "Removes a directory", confidence: "high", kind: "sink" },
  { pattern: "fs.rename", category: "io-file", description: "Renames a file or directory", confidence: "high", kind: "sink" },
  { pattern: "fs.copyFile", category: "io-file", description: "Copies a file", confidence: "high", kind: "sink" },
  { pattern: "fs.chmod", category: "io-file", description: "Changes file permissions", confidence: "high", kind: "sink" },
  { pattern: "fs.chown", category: "io-file", description: "Changes file ownership", confidence: "high", kind: "sink" },
  { pattern: "fs.createWriteStream", category: "io-file", description: "Creates a writable file stream", confidence: "high", kind: "sink" },
  { pattern: "fs.createReadStream", category: "io-file", description: "Creates a readable file stream", confidence: "high", kind: "source" },
  { pattern: "writeJson", category: "io-file", description: "Writes JSON to a file", confidence: "medium", kind: "sink" },
  { pattern: "readJson", category: "io-file", description: "Reads JSON from a file", confidence: "medium", kind: "source" },

  // ==========================================================================
  // Network (io-network)
  // ==========================================================================
  { pattern: "fetch", category: "io-network", description: "Makes an HTTP request", confidence: "high", kind: "both" },
  { pattern: "axios", category: "io-network", description: "Makes an HTTP request via Axios", confidence: "high", kind: "both" },
  { pattern: "axios.get", category: "io-network", description: "Makes an HTTP GET request", confidence: "high", kind: "source" },
  { pattern: "axios.post", category: "io-network", description: "Makes an HTTP POST request", confidence: "high", kind: "sink" },
  { pattern: "axios.put", category: "io-network", description: "Makes an HTTP PUT request", confidence: "high", kind: "sink" },
  { pattern: "axios.delete", category: "io-network", description: "Makes an HTTP DELETE request", confidence: "high", kind: "sink" },
  { pattern: "http.request", category: "io-network", description: "Makes an HTTP request", confidence: "high", kind: "both" },
  { pattern: "https.request", category: "io-network", description: "Makes an HTTPS request", confidence: "high", kind: "both" },
  { pattern: "http.get", category: "io-network", description: "Makes an HTTP GET request", confidence: "high", kind: "source" },
  { pattern: "https.get", category: "io-network", description: "Makes an HTTPS GET request", confidence: "high", kind: "source" },
  { pattern: "WebSocket", category: "io-network", description: "Creates a WebSocket connection", confidence: "high", kind: "both" },
  { pattern: "socket.send", category: "io-network", description: "Sends data over a socket", confidence: "high", kind: "sink" },
  { pattern: "socket.emit", category: "io-network", description: "Emits data over a socket", confidence: "high", kind: "sink" },

  // ==========================================================================
  // Database (io-database)
  // ==========================================================================
  { pattern: ".query", category: "io-database", description: "Executes a database query", confidence: "medium", kind: "both" },
  { pattern: ".execute", category: "io-database", description: "Executes a database statement", confidence: "medium", kind: "both" },
  { pattern: ".save", category: "io-database", description: "Saves entity to database", confidence: "high", kind: "sink" },
  { pattern: ".insert", category: "io-database", description: "Inserts into database", confidence: "high", kind: "sink" },
  { pattern: ".update", category: "io-database", description: "Updates database records", confidence: "high", kind: "sink" },
  { pattern: ".delete", category: "io-database", description: "Deletes from database", confidence: "high", kind: "sink" },
  { pattern: ".remove", category: "io-database", description: "Removes from database", confidence: "medium", kind: "sink" },
  { pattern: ".findOne", category: "io-database", description: "Finds one record in database", confidence: "high", kind: "source" },
  { pattern: ".findMany", category: "io-database", description: "Finds multiple records in database", confidence: "high", kind: "source" },
  { pattern: ".find", category: "io-database", description: "Finds records in database", confidence: "medium", kind: "source" },
  { pattern: ".create", category: "io-database", description: "Creates record in database", confidence: "medium", kind: "sink" },
  { pattern: "prisma.", category: "io-database", description: "Prisma ORM operation", confidence: "high", kind: "both" },
  { pattern: "mongoose.", category: "io-database", description: "Mongoose ORM operation", confidence: "high", kind: "both" },
  { pattern: "sequelize.", category: "io-database", description: "Sequelize ORM operation", confidence: "high", kind: "both" },
  { pattern: "knex", category: "io-database", description: "Knex query builder operation", confidence: "high", kind: "both" },

  // ==========================================================================
  // Console/Logging (io-console)
  // ==========================================================================
  { pattern: "console.log", category: "io-console", description: "Logs to console", confidence: "high", kind: "sink" },
  { pattern: "console.error", category: "io-console", description: "Logs error to console", confidence: "high", kind: "sink" },
  { pattern: "console.warn", category: "io-console", description: "Logs warning to console", confidence: "high", kind: "sink" },
  { pattern: "console.info", category: "io-console", description: "Logs info to console", confidence: "high", kind: "sink" },
  { pattern: "console.debug", category: "io-console", description: "Logs debug to console", confidence: "high", kind: "sink" },
  { pattern: "console.trace", category: "io-console", description: "Logs stack trace to console", confidence: "high", kind: "sink" },
  { pattern: "console.table", category: "io-console", description: "Logs table to console", confidence: "high", kind: "sink" },
  { pattern: "logger.", category: "io-console", description: "Logs via logger", confidence: "medium", kind: "sink" },
  { pattern: "log.", category: "io-console", description: "Logs via logger", confidence: "low", kind: "sink" },
  { pattern: "pino", category: "io-console", description: "Logs via Pino", confidence: "medium", kind: "sink" },
  { pattern: "winston", category: "io-console", description: "Logs via Winston", confidence: "medium", kind: "sink" },

  // ==========================================================================
  // Async Operations (async-spawn)
  // ==========================================================================
  { pattern: "setTimeout", category: "async-spawn", description: "Schedules delayed execution", confidence: "high", kind: "sink" },
  { pattern: "setInterval", category: "async-spawn", description: "Schedules repeated execution", confidence: "high", kind: "sink" },
  { pattern: "setImmediate", category: "async-spawn", description: "Schedules immediate execution", confidence: "high", kind: "sink" },
  { pattern: "process.nextTick", category: "async-spawn", description: "Schedules microtask", confidence: "high", kind: "sink" },
  { pattern: "queueMicrotask", category: "async-spawn", description: "Queues a microtask", confidence: "high", kind: "sink" },
  { pattern: "requestAnimationFrame", category: "async-spawn", description: "Schedules animation frame", confidence: "high", kind: "sink" },
  { pattern: "Worker", category: "async-spawn", description: "Creates a worker thread", confidence: "high", kind: "sink" },
  { pattern: "child_process", category: "async-spawn", description: "Spawns child process", confidence: "high", kind: "sink" },
  { pattern: "spawn", category: "async-spawn", description: "Spawns child process", confidence: "medium", kind: "sink" },
  { pattern: "exec", category: "async-spawn", description: "Executes shell command", confidence: "medium", kind: "sink" },
  { pattern: "fork", category: "async-spawn", description: "Forks child process", confidence: "high", kind: "sink" },

  // ==========================================================================
  // External Services (external-service)
  // ==========================================================================
  { pattern: "sendEmail", category: "external-service", description: "Sends an email", confidence: "high", kind: "sink" },
  { pattern: "sendSMS", category: "external-service", description: "Sends an SMS", confidence: "high", kind: "sink" },
  { pattern: "sendNotification", category: "external-service", description: "Sends a notification", confidence: "high", kind: "sink" },
  { pattern: "stripe.", category: "external-service", description: "Stripe payment API call", confidence: "high", kind: "both" },
  { pattern: "twilio.", category: "external-service", description: "Twilio API call", confidence: "high", kind: "both" },
  { pattern: "aws.", category: "external-service", description: "AWS service call", confidence: "high", kind: "both" },
  { pattern: "s3.", category: "external-service", description: "AWS S3 operation", confidence: "high", kind: "both" },
  { pattern: "sqs.", category: "external-service", description: "AWS SQS operation", confidence: "high", kind: "both" },
  { pattern: "sns.", category: "external-service", description: "AWS SNS operation", confidence: "high", kind: "both" },
  { pattern: "firebase.", category: "external-service", description: "Firebase API call", confidence: "high", kind: "both" },
  { pattern: "analytics.", category: "external-service", description: "Analytics tracking", confidence: "medium", kind: "sink" },
  { pattern: "track", category: "external-service", description: "Event tracking", confidence: "low", kind: "sink" },

  // ==========================================================================
  // DOM Manipulation (dom-manipulation)
  // ==========================================================================
  { pattern: "document.", category: "dom-manipulation", description: "DOM document operation", confidence: "high", kind: "both" },
  { pattern: "window.", category: "dom-manipulation", description: "Window object operation", confidence: "medium", kind: "both" },
  { pattern: ".innerHTML", category: "dom-manipulation", description: "Sets element HTML", confidence: "high", kind: "sink" },
  { pattern: ".innerText", category: "dom-manipulation", description: "Sets element text", confidence: "high", kind: "sink" },
  { pattern: ".textContent", category: "dom-manipulation", description: "Sets element text content", confidence: "high", kind: "sink" },
  { pattern: ".appendChild", category: "dom-manipulation", description: "Appends child element", confidence: "high", kind: "sink" },
  { pattern: ".removeChild", category: "dom-manipulation", description: "Removes child element", confidence: "high", kind: "sink" },
  { pattern: ".setAttribute", category: "dom-manipulation", description: "Sets element attribute", confidence: "high", kind: "sink" },
  { pattern: ".classList.", category: "dom-manipulation", description: "Modifies element classes", confidence: "high", kind: "sink" },
  { pattern: ".style.", category: "dom-manipulation", description: "Modifies element styles", confidence: "high", kind: "sink" },
  { pattern: "localStorage.", category: "dom-manipulation", description: "Local storage operation", confidence: "high", kind: "both" },
  { pattern: "sessionStorage.", category: "dom-manipulation", description: "Session storage operation", confidence: "high", kind: "both" },

  // ==========================================================================
  // Event Emission (event-emission)
  // ==========================================================================
  { pattern: ".emit", category: "event-emission", description: "Emits an event", confidence: "medium", kind: "sink" },
  { pattern: ".dispatch", category: "event-emission", description: "Dispatches an event", confidence: "medium", kind: "sink" },
  { pattern: "dispatchEvent", category: "event-emission", description: "Dispatches DOM event", confidence: "high", kind: "sink" },
  { pattern: ".trigger", category: "event-emission", description: "Triggers an event", confidence: "medium", kind: "sink" },
  { pattern: ".publish", category: "event-emission", description: "Publishes an event", confidence: "medium", kind: "sink" },
  { pattern: ".broadcast", category: "event-emission", description: "Broadcasts an event", confidence: "medium", kind: "sink" },
];

// =============================================================================
// Categorizer Implementation
// =============================================================================

/**
 * Implementation of ISideEffectCategorizer.
 *
 * Uses pattern matching to categorize API calls and expressions.
 */
export class SideEffectCategorizer implements ISideEffectCategorizer {
  private patterns: SideEffectPattern[];
  private patternCache: Map<string, SideEffectPattern | null> = new Map();

  constructor(additionalPatterns: SideEffectPattern[] = []) {
    this.patterns = [...DEFAULT_SIDE_EFFECT_PATTERNS, ...additionalPatterns];
  }

  /**
   * Categorize an API call by matching against known patterns.
   */
  categorize(
    apiCall: string,
    _context?: string
  ): { category: SideEffectCategory; confidence: DetectionConfidence } | null {
    // Check cache first
    const cached = this.patternCache.get(apiCall);
    if (cached !== undefined) {
      return cached ? { category: cached.category, confidence: cached.confidence } : null;
    }

    // Find matching pattern
    const pattern = this.findMatchingPattern(apiCall);
    this.patternCache.set(apiCall, pattern);

    if (pattern) {
      return { category: pattern.category, confidence: pattern.confidence };
    }

    // Try to infer from common patterns
    const inferred = this.inferCategory(apiCall);
    return inferred;
  }

  /**
   * Calculate risk level based on detected side effects.
   */
  calculateRiskLevel(sideEffects: SideEffect[]): "low" | "medium" | "high" {
    if (sideEffects.length === 0) {
      return "low";
    }

    // High risk categories
    const highRiskCategories: SideEffectCategory[] = [
      "io-database",
      "io-file",
      "external-service",
      "mutation-global",
    ];

    // Medium risk categories
    const mediumRiskCategories: SideEffectCategory[] = [
      "io-network",
      "mutation-param",
      "mutation-this",
      "async-spawn",
    ];

    let highRiskCount = 0;
    let mediumRiskCount = 0;
    let unconditionalCount = 0;

    for (const effect of sideEffects) {
      if (highRiskCategories.includes(effect.category)) {
        highRiskCount++;
      } else if (mediumRiskCategories.includes(effect.category)) {
        mediumRiskCount++;
      }

      if (!effect.isConditional) {
        unconditionalCount++;
      }
    }

    // Determine risk level
    if (highRiskCount >= 2 || (highRiskCount >= 1 && unconditionalCount >= 2)) {
      return "high";
    }

    if (highRiskCount >= 1 || mediumRiskCount >= 2 || unconditionalCount >= 3) {
      return "medium";
    }

    return "low";
  }

  /**
   * Determine primary (most significant) categories from side effects.
   */
  getPrimaryCategories(sideEffects: SideEffect[]): SideEffectCategory[] {
    if (sideEffects.length === 0) {
      return [];
    }

    // Priority order for categories
    const categoryPriority: SideEffectCategory[] = [
      "io-database",
      "io-file",
      "io-network",
      "external-service",
      "mutation-global",
      "mutation-this",
      "mutation-param",
      "async-spawn",
      "event-emission",
      "dom-manipulation",
      "io-console",
      "mutation-closure",
      "unknown",
    ];

    // Count occurrences
    const counts = new Map<SideEffectCategory, number>();
    for (const effect of sideEffects) {
      counts.set(effect.category, (counts.get(effect.category) || 0) + 1);
    }

    // Sort by priority and count
    const categories = Array.from(counts.keys()).sort((a, b) => {
      const priorityA = categoryPriority.indexOf(a);
      const priorityB = categoryPriority.indexOf(b);
      const countA = counts.get(a) || 0;
      const countB = counts.get(b) || 0;

      // First by priority, then by count
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return countB - countA;
    });

    // Return top 3 categories
    return categories.slice(0, 3);
  }

  /**
   * Find a matching pattern for an API call.
   */
  private findMatchingPattern(apiCall: string): SideEffectPattern | null {
    const normalized = apiCall.toLowerCase();

    for (const pattern of this.patterns) {
      if (normalized.includes(pattern.pattern.toLowerCase())) {
        return pattern;
      }
    }

    return null;
  }

  /**
   * Try to infer category from common naming patterns.
   */
  private inferCategory(
    apiCall: string
  ): { category: SideEffectCategory; confidence: DetectionConfidence } | null {
    const lower = apiCall.toLowerCase();

    // Mutation patterns
    if (lower.includes("set") && (lower.includes("this.") || lower.includes("self."))) {
      return { category: "mutation-this", confidence: "medium" };
    }

    // Write patterns
    if (lower.includes("write") || lower.includes("save") || lower.includes("store")) {
      return { category: "io-file", confidence: "low" };
    }

    // Send patterns
    if (lower.includes("send") || lower.includes("post") || lower.includes("push")) {
      return { category: "io-network", confidence: "low" };
    }

    // Delete/Remove patterns
    if (lower.includes("delete") || lower.includes("remove") || lower.includes("destroy")) {
      return { category: "io-database", confidence: "low" };
    }

    return null;
  }

  /**
   * Get all registered patterns.
   */
  getAllPatterns(): SideEffectPattern[] {
    return [...this.patterns];
  }

  /**
   * Register a new pattern.
   */
  registerPattern(pattern: SideEffectPattern): void {
    this.patterns.push(pattern);
    this.patternCache.clear(); // Clear cache when patterns change
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new SideEffectCategorizer instance.
 */
export function createSideEffectCategorizer(
  additionalPatterns?: SideEffectPattern[]
): ISideEffectCategorizer {
  return new SideEffectCategorizer(additionalPatterns);
}

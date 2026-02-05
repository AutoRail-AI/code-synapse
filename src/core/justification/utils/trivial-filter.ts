/**
 * Trivial Entity Filter
 *
 * Identifies and filters out trivial code entities that don't need
 * LLM inference for justification. These include:
 * - Simple getters/setters
 * - Constructor boilerplate
 * - Index re-exports
 * - Type-only definitions
 * - Very simple utility functions
 *
 * @module
 */

import { createLogger } from "../../../utils/logger.js";

const logger = createLogger("trivial-filter");

/**
 * Entity information for triviality check
 */
export interface EntityInfo {
  id: string;
  name: string;
  type: "function" | "class" | "interface" | "file" | "method";
  filePath: string;
  codeSnippet?: string;
  lineCount?: number;
  isExported?: boolean;
  signature?: string;
  docComment?: string;
}

/**
 * Result of triviality check
 */
export interface TrivialCheckResult {
  isTrivial: boolean;
  reason?: string;
  defaultJustification?: {
    purposeSummary: string;
    businessValue: string;
    featureContext: string;
    tags: string[];
    confidenceScore: number;
  };
}

// Patterns for trivial function names
// Stricter: must START with these
const GETTER_PATTERN = /^(get|is|has)[A-Z]/;
const SETTER_PATTERN = /^set[A-Z]/;
const SIMPLE_ACCESSOR_NAMES = [
  "toString",
  "valueOf",
  "toJSON",
  "clone",
  "copy",
  "equals",
  "hashCode",
  "compareTo",
];

// Sensitive name patterns - if found, NEVER trivial regardless of size
const SENSITIVE_NAME_PATTERNS = [
  /auth/i,
  /security/i,
  /validate/i,
  /verify/i,
  /credential/i,
  /password/i,
  /secret/i,
  /token/i,
  /permission/i,
  /role/i,
  /check/i, // Often implies validation
  /guard/i,
  /encrypt/i,
  /decrypt/i,
];

// Patterns for trivial file names
const INDEX_FILE_PATTERN = /^index\.(ts|js|tsx|jsx)$/;
const TYPE_FILE_PATTERN = /\.(d\.ts|types\.ts|interface\.ts)$/;
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|js|tsx|jsx)$/;
const CONFIG_FILE_PATTERN = /^(config|constants|env)\.(ts|js)$/;

/**
 * Check if an entity is trivial and doesn't need LLM inference
 */
export function checkTrivialEntity(entity: EntityInfo): TrivialCheckResult {
  // Check by entity type
  switch (entity.type) {
    case "function":
    case "method":
      return checkTrivialFunction(entity);
    case "class":
      return checkTrivialClass(entity);
    case "interface":
      return checkTrivialInterface(entity);
    case "file":
      return checkTrivialFile(entity);
    default:
      return { isTrivial: false };
  }
}

/**
 * Check if a function/method is trivial
 */
function checkTrivialFunction(entity: EntityInfo): TrivialCheckResult {
  const { name, lineCount, signature } = entity;

  // SAFETY CHECK: Never mark sensitive functions as trivial
  for (const pattern of SENSITIVE_NAME_PATTERNS) {
    if (pattern.test(name)) {
      return { isTrivial: false };
    }
  }

  // Simple getter - identified by name pattern
  if (GETTER_PATTERN.test(name)) {
    // STRICTER: Short getters (<=3 lines, was 5)
    if (!lineCount || lineCount <= 3) {
      const propertyName = name.replace(/^(get|is|has)/, "");
      const propertyFormatted = propertyName.charAt(0).toLowerCase() + propertyName.slice(1);

      return {
        isTrivial: true,
        reason: "simple_getter",
        defaultJustification: {
          purposeSummary: `Getter method that returns the ${propertyFormatted} property${signature ? ` (${signature})` : ""}`,
          businessValue: "Provides read access to internal state",
          featureContext: "Data access",
          tags: ["getter", "accessor"],
          confidenceScore: 0.9,
        },
      };
    }
  }

  // Simple setter - identified by name pattern
  if (SETTER_PATTERN.test(name)) {
    // STRICTER: Short setters (<=3 lines, was 5)
    if (!lineCount || lineCount <= 3) {
      const propertyName = name.replace(/^set/, "");
      const propertyFormatted = propertyName.charAt(0).toLowerCase() + propertyName.slice(1);

      return {
        isTrivial: true,
        reason: "simple_setter",
        defaultJustification: {
          purposeSummary: `Setter method that updates the ${propertyFormatted} property${signature ? ` (${signature})` : ""}`,
          businessValue: "Provides write access to internal state",
          featureContext: "Data access",
          tags: ["setter", "mutator"],
          confidenceScore: 0.9,
        },
      };
    }
  }

  // Simple accessor methods by name
  if (SIMPLE_ACCESSOR_NAMES.includes(name)) {
    return {
      isTrivial: true,
      reason: "standard_accessor",
      defaultJustification: {
        purposeSummary: `Standard ${name} implementation${signature ? ` (${signature})` : ""}`,
        businessValue: "Provides standard object behavior",
        featureContext: "Object utilities",
        tags: ["utility", name.toLowerCase()],
        confidenceScore: 0.9,
      },
    };
  }

  // Constructor - typically trivial if short
  if (name === "constructor") {
    // STRICTER: <= 5 lines (was 15)
    if (!lineCount || lineCount <= 5) {
      return {
        isTrivial: true,
        reason: "simple_constructor",
        defaultJustification: {
          purposeSummary: "Constructor that initializes instance properties",
          businessValue: "Sets up object state on instantiation",
          featureContext: "Object initialization",
          tags: ["constructor", "initialization"],
          confidenceScore: 0.85,
        },
      };
    }
  }

  // Generic VERY short functions
  // STRICTER: Only 1-liners (was <= 3)
  if (lineCount && lineCount <= 1) {
    return {
      isTrivial: true,
      reason: "very_short_function",
      defaultJustification: {
        purposeSummary: `Simple helper: ${name}${signature ? ` (${signature})` : ""}`,
        businessValue: "Provides simple utility functionality",
        featureContext: "Utilities",
        tags: ["utility", "helper"],
        confidenceScore: 0.7,
      },
    };
  }

  // Only truly trivial function patterns - these rarely have business logic
  const trivialNamePatterns = [
    /^noop$/, // no-op function
    /^identity$/, // identity function
    /^_.*/, // private/internal helpers starting with underscore
  ];

  for (const pattern of trivialNamePatterns) {
    if (pattern.test(name)) {
      return {
        isTrivial: true,
        reason: "trivial_utility",
        defaultJustification: {
          purposeSummary: `Internal utility: ${name}${signature ? ` (${signature})` : ""}`,
          businessValue: "Provides internal utility functionality",
          featureContext: "Utilities",
          tags: ["utility", "internal"],
          confidenceScore: 0.7,
        },
      };
    }
  }

  return { isTrivial: false };
}

/**
 * Check if a class is trivial
 * Only truly simple classes (empty or minimal) should skip LLM
 */
function checkTrivialClass(entity: EntityInfo): TrivialCheckResult {
  const { name, lineCount } = entity;

  // STRICTER: <= 3 lines (was 5)
  if (lineCount && lineCount <= 3) {
    return {
      isTrivial: true,
      reason: "minimal_class",
      defaultJustification: {
        purposeSummary: `Simple class: ${name}`,
        businessValue: "Provides basic type structure",
        featureContext: "Type definitions",
        tags: ["class", "type"],
        confidenceScore: 0.7,
      },
    };
  }

  // Error classes - generally structural
  if (name.endsWith("Error") || name.endsWith("Exception")) {
    return {
      isTrivial: true,
      reason: "error_class",
      defaultJustification: {
        purposeSummary: `Custom error class for ${name.replace(/Error$|Exception$/, "").toLowerCase()} errors`,
        businessValue: "Provides specific error handling",
        featureContext: "Error handling",
        tags: ["error", "exception"],
        confidenceScore: 0.9,
      },
    };
  }

  // Data classes / DTOs / Models - ONLY if small enough
  // NOTE: Logic retained but stricter line count above handles most cases. 
  // We keep this specific check but verify line count isn't HUGE.
  if (
    name.endsWith("Data") ||
    name.endsWith("DTO") ||
    name.endsWith("Model") ||
    name.endsWith("Entity") ||
    name.endsWith("Record") ||
    name.endsWith("State")
  ) {
    // If it's a DTO but 100 lines long, it might have logic. 
    // Let's rely on standard LLM for larger DTOs.
    // Filter only if <= 10 lines (moderate size data bag)
    if (lineCount && lineCount <= 10) {
      return {
        isTrivial: true,
        reason: "data_class",
        defaultJustification: {
          purposeSummary: `Data container class: ${name}`,
          businessValue: "Provides data structure",
          featureContext: "Data models",
          tags: ["class", "data", "model"],
          confidenceScore: 0.85,
        },
      };
    }
  }

  return { isTrivial: false };
}

/**
 * Check if an interface is trivial
 * Interfaces often define important contracts - only skip truly minimal ones
 */
function checkTrivialInterface(entity: EntityInfo): TrivialCheckResult {
  const { name, lineCount } = entity;

  // STRICTER: <= 3 lines (was 5)
  if (lineCount && lineCount <= 3) {
    return {
      isTrivial: true,
      reason: "minimal_interface",
      defaultJustification: {
        purposeSummary: `Simple interface: ${name}`,
        businessValue: "Provides basic type contract",
        featureContext: "Type definitions",
        tags: ["interface", "type"],
        confidenceScore: 0.7,
      },
    };
  }

  // Props/Options/Config interfaces - always trivial regardless of size
  // These are purely data definitions usually
  if (
    name.endsWith("Props") ||
    name.endsWith("Options") ||
    name.endsWith("Config") ||
    name.endsWith("Settings") ||
    name.endsWith("Params") ||
    name.endsWith("Args") ||
    name.endsWith("Input") ||
    name.endsWith("Output") ||
    name.endsWith("Response") ||
    name.endsWith("Request")
  ) {
    return {
      isTrivial: true,
      reason: "config_interface",
      defaultJustification: {
        purposeSummary: `Configuration/Data interface for ${name.replace(/(Props|Options|Config|Settings|Params|Args|Input|Output|Response|Request)$/, "")}`,
        businessValue: "Defines data/configuration structure",
        featureContext: "Configuration",
        tags: ["interface", "config", "data"],
        confidenceScore: 0.9,
      },
    };
  }

  return { isTrivial: false };
}

/**
 * Check if a file is trivial
 */
function checkTrivialFile(entity: EntityInfo): TrivialCheckResult {
  const fileName = entity.filePath.split("/").pop() || "";

  // Index files (re-exports)
  if (INDEX_FILE_PATTERN.test(fileName)) {
    return {
      isTrivial: true,
      reason: "index_file",
      defaultJustification: {
        purposeSummary: "Module index that re-exports public API",
        businessValue: "Provides clean module interface",
        featureContext: "Module organization",
        tags: ["index", "exports", "module"],
        confidenceScore: 0.95,
      },
    };
  }

  // Type definition files
  if (TYPE_FILE_PATTERN.test(fileName)) {
    return {
      isTrivial: true,
      reason: "type_file",
      defaultJustification: {
        purposeSummary: "Type definitions for the module",
        businessValue: "Provides TypeScript type safety",
        featureContext: "Type definitions",
        tags: ["types", "typescript", "definitions"],
        confidenceScore: 0.9,
      },
    };
  }

  // Test files - ALWAYS trivial/ignored for justification purposes
  if (TEST_FILE_PATTERN.test(fileName)) {
    return {
      isTrivial: true,
      reason: "test_file",
      defaultJustification: {
        purposeSummary: `Test suite for ${fileName.replace(/\.(test|spec)\.(ts|js|tsx|jsx)$/, "")}`,
        businessValue: "Ensures code quality and correctness",
        featureContext: "Testing",
        tags: ["test", "quality"],
        confidenceScore: 0.9,
      },
    };
  }

  // Config files
  if (CONFIG_FILE_PATTERN.test(fileName)) {
    return {
      isTrivial: true,
      reason: "config_file",
      defaultJustification: {
        purposeSummary: "Configuration constants and settings",
        businessValue: "Centralizes configuration management",
        featureContext: "Configuration",
        tags: ["config", "constants"],
        confidenceScore: 0.9,
      },
    };
  }

  return { isTrivial: false };
}

/**
 * Filter a list of entities, separating trivial from non-trivial
 */
export function filterTrivialEntities(entities: EntityInfo[]): {
  trivial: Array<EntityInfo & { result: TrivialCheckResult }>;
  nonTrivial: EntityInfo[];
} {
  const trivial: Array<EntityInfo & { result: TrivialCheckResult }> = [];
  const nonTrivial: EntityInfo[] = [];

  for (const entity of entities) {
    const result = checkTrivialEntity(entity);
    if (result.isTrivial) {
      trivial.push({ ...entity, result });
    } else {
      nonTrivial.push(entity);
    }
  }

  logger.debug(
    {
      total: entities.length,
      trivial: trivial.length,
      nonTrivial: nonTrivial.length,
    },
    "Filtered trivial entities"
  );

  return { trivial, nonTrivial };
}

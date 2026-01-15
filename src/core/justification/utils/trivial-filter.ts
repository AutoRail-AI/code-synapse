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
  const { name, lineCount } = entity;

  // Simple getter - identified by name pattern (code snippet may not be available)
  if (GETTER_PATTERN.test(name)) {
    // Short getters (<=5 lines) are likely just property access
    if (!lineCount || lineCount <= 5) {
      return {
        isTrivial: true,
        reason: "simple_getter",
        defaultJustification: {
          purposeSummary: `Getter method that returns the ${name.replace(/^(get|is|has)/, "").toLowerCase()} property`,
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
    // Short setters (<=5 lines) are likely just property assignment
    if (!lineCount || lineCount <= 5) {
      return {
        isTrivial: true,
        reason: "simple_setter",
        defaultJustification: {
          purposeSummary: `Setter method that updates the ${name.replace(/^set/, "").toLowerCase()} property`,
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
        purposeSummary: `Standard ${name} implementation`,
        businessValue: "Provides standard object behavior",
        featureContext: "Object utilities",
        tags: ["utility", name.toLowerCase()],
        confidenceScore: 0.9,
      },
    };
  }

  // Constructor - typically trivial if short
  if (name === "constructor") {
    if (!lineCount || lineCount <= 15) {
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

  // Short functions (<=10 lines) - likely simple utilities
  if (lineCount && lineCount <= 10) {
    return {
      isTrivial: true,
      reason: "short_function",
      defaultJustification: {
        purposeSummary: `Utility function: ${name}`,
        businessValue: "Provides utility functionality",
        featureContext: "Utilities",
        tags: ["utility", "helper"],
        confidenceScore: 0.8,
      },
    };
  }

  // Common trivial function names
  const trivialNamePatterns = [
    /^log[A-Z]/, // logging functions
    /^debug[A-Z]/, // debug functions
    /^print[A-Z]/, // print functions
    /^throw[A-Z]/, // throw helpers
    /^assert[A-Z]/, // assertions
    /^noop$|^identity$/, // utility functions
    /^create[A-Z]/, // factory functions
    /^make[A-Z]/, // factory functions
    /^build[A-Z]/, // builder functions
    /^format[A-Z]/, // formatting functions
    /^parse[A-Z]/, // parsing functions
    /^serialize[A-Z]/, // serialization
    /^deserialize[A-Z]/, // deserialization
    /^convert[A-Z]/, // conversion functions
    /^transform[A-Z]/, // transformation functions
    /^wrap[A-Z]/, // wrapper functions
    /^unwrap[A-Z]/, // unwrapper functions
    /^extract[A-Z]/, // extraction functions
    /^filter[A-Z]/, // filter functions
    /^map[A-Z]/, // map functions
    /^reduce[A-Z]/, // reduce functions
    /^find[A-Z]/, // find functions
    /^sort[A-Z]/, // sort functions
    /^merge[A-Z]/, // merge functions
    /^split[A-Z]/, // split functions
    /^join[A-Z]/, // join functions
    /^append[A-Z]/, // append functions
    /^prepend[A-Z]/, // prepend functions
    /^remove[A-Z]/, // remove functions
    /^add[A-Z]/, // add functions
    /^update[A-Z]/, // update functions
    /^delete[A-Z]/, // delete functions
    /^clear[A-Z]/, // clear functions
    /^reset[A-Z]/, // reset functions
    /^init[A-Z]/, // init functions
    /^setup[A-Z]/, // setup functions
    /^cleanup[A-Z]/, // cleanup functions
    /^dispose[A-Z]/, // dispose functions
    /^close[A-Z]/, // close functions
    /^open[A-Z]/, // open functions
    /^start[A-Z]/, // start functions
    /^stop[A-Z]/, // stop functions
    /^enable[A-Z]/, // enable functions
    /^disable[A-Z]/, // disable functions
    /^check[A-Z]/, // check functions
    /^test[A-Z]/, // test functions
    /^try[A-Z]/, // try functions
    /^ensure[A-Z]/, // ensure functions
    /^require[A-Z]/, // require functions
    /^normalize[A-Z]/, // normalize functions
    /^sanitize[A-Z]/, // sanitize functions
    /^escape[A-Z]/, // escape functions
    /^unescape[A-Z]/, // unescape functions
    /^encode[A-Z]/, // encode functions
    /^decode[A-Z]/, // decode functions
    /^hash[A-Z]/, // hash functions
    /^compare[A-Z]/, // compare functions
    /^equals[A-Z]/, // equals functions
    /^matches[A-Z]/, // matches functions
  ];

  for (const pattern of trivialNamePatterns) {
    if (pattern.test(name)) {
      return {
        isTrivial: true,
        reason: "trivial_utility",
        defaultJustification: {
          purposeSummary: `Utility function: ${name}`,
          businessValue: "Provides common utility functionality",
          featureContext: "Utilities",
          tags: ["utility", "helper"],
          confidenceScore: 0.85,
        },
      };
    }
  }

  return { isTrivial: false };
}

/**
 * Check if a class is trivial
 */
function checkTrivialClass(entity: EntityInfo): TrivialCheckResult {
  const { name, lineCount } = entity;

  // Small to medium classes (<=50 lines) - most classes are relatively simple
  if (!lineCount || lineCount <= 50) {
    return {
      isTrivial: true,
      reason: "simple_class",
      defaultJustification: {
        purposeSummary: `Class definition for ${name}`,
        businessValue: "Provides type structure and behavior",
        featureContext: "Type definitions",
        tags: ["class", "type"],
        confidenceScore: 0.85,
      },
    };
  }

  // Error classes
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

  // Data classes / DTOs / Models
  if (
    name.endsWith("Data") ||
    name.endsWith("DTO") ||
    name.endsWith("Model") ||
    name.endsWith("Entity") ||
    name.endsWith("Record") ||
    name.endsWith("State")
  ) {
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

  return { isTrivial: false };
}

/**
 * Check if an interface is trivial
 */
function checkTrivialInterface(entity: EntityInfo): TrivialCheckResult {
  const { name, lineCount } = entity;

  // Most interfaces are trivial type definitions - be aggressive
  // Small to medium interfaces (<=30 lines)
  if (!lineCount || lineCount <= 30) {
    return {
      isTrivial: true,
      reason: "simple_interface",
      defaultJustification: {
        purposeSummary: `Type interface defining ${name} structure`,
        businessValue: "Provides type safety and documentation",
        featureContext: "Type definitions",
        tags: ["interface", "type"],
        confidenceScore: 0.9,
      },
    };
  }

  // Props/Options/Config interfaces - always trivial regardless of size
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

  // Test files
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

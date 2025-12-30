/**
 * Error Classes for Code-Synapse
 * Structured error handling with error codes
 */

/**
 * Error codes for categorizing errors
 */
export enum ErrorCode {
  // Initialization errors (1xxx)
  INIT_FAILED = "E1000",
  INIT_ALREADY_EXISTS = "E1001",
  INIT_CONFIG_INVALID = "E1002",
  INIT_PROJECT_NOT_FOUND = "E1003",

  // Parsing errors (2xxx)
  PARSE_FAILED = "E2000",
  PARSE_UNSUPPORTED_LANGUAGE = "E2001",
  PARSE_FILE_NOT_FOUND = "E2002",
  PARSE_SYNTAX_ERROR = "E2003",
  PARSE_TREE_SITTER_ERROR = "E2004",

  // Graph errors (3xxx)
  GRAPH_CONNECTION_FAILED = "E3000",
  GRAPH_QUERY_FAILED = "E3001",
  GRAPH_SCHEMA_ERROR = "E3002",
  GRAPH_TRANSACTION_FAILED = "E3003",
  GRAPH_NODE_NOT_FOUND = "E3004",
  GRAPH_EDGE_NOT_FOUND = "E3005",

  // Vector errors (4xxx)
  VECTOR_CONNECTION_FAILED = "E4000",
  VECTOR_INDEX_FAILED = "E4001",
  VECTOR_SEARCH_FAILED = "E4002",
  VECTOR_EMBEDDING_FAILED = "E4003",

  // MCP errors (5xxx)
  MCP_SERVER_START_FAILED = "E5000",
  MCP_CONNECTION_FAILED = "E5001",
  MCP_INVALID_REQUEST = "E5002",
  MCP_TOOL_NOT_FOUND = "E5003",
  MCP_RESOURCE_NOT_FOUND = "E5004",

  // LLM errors (6xxx)
  LLM_CONNECTION_FAILED = "E6000",
  LLM_INFERENCE_FAILED = "E6001",
  LLM_MODEL_NOT_FOUND = "E6002",
  LLM_TIMEOUT = "E6003",

  // Indexer errors (7xxx)
  INDEXER_FAILED = "E7000",
  INDEXER_FILE_WATCH_ERROR = "E7001",
  INDEXER_HASH_MISMATCH = "E7002",

  // General errors (9xxx)
  UNKNOWN_ERROR = "E9000",
  INVALID_ARGUMENT = "E9001",
  FILE_SYSTEM_ERROR = "E9002",
  CONFIGURATION_ERROR = "E9003",
}

/**
 * Base error class for all Code-Synapse errors
 */
export class CodeSynapseError extends Error {
  public readonly code: ErrorCode;
  public readonly timestamp: Date;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "CodeSynapseError";
    this.code = code;
    this.timestamp = new Date();
    this.context = context;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
    };
  }

  /**
   * Create a formatted error message
   */
  toString(): string {
    return `[${this.code}] ${this.name}: ${this.message}`;
  }
}

/**
 * Initialization errors
 */
export class InitializationError extends CodeSynapseError {
  constructor(message: string, code: ErrorCode = ErrorCode.INIT_FAILED, context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = "InitializationError";
  }
}

/**
 * Parsing errors
 */
export class ParsingError extends CodeSynapseError {
  public readonly filePath?: string;
  public readonly line?: number;
  public readonly column?: number;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.PARSE_FAILED,
    context?: Record<string, unknown> & { filePath?: string; line?: number; column?: number }
  ) {
    super(message, code, context);
    this.name = "ParsingError";
    this.filePath = context?.filePath;
    this.line = context?.line;
    this.column = context?.column;
  }

  toString(): string {
    let location = "";
    if (this.filePath) {
      location = ` at ${this.filePath}`;
      if (this.line !== undefined) {
        location += `:${this.line}`;
        if (this.column !== undefined) {
          location += `:${this.column}`;
        }
      }
    }
    return `[${this.code}] ${this.name}: ${this.message}${location}`;
  }
}

/**
 * Graph database errors
 */
export class GraphError extends CodeSynapseError {
  public readonly query?: string;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.GRAPH_QUERY_FAILED,
    context?: Record<string, unknown> & { query?: string }
  ) {
    super(message, code, context);
    this.name = "GraphError";
    this.query = context?.query;
  }
}

/**
 * Vector database errors
 */
export class VectorError extends CodeSynapseError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.VECTOR_INDEX_FAILED,
    context?: Record<string, unknown>
  ) {
    super(message, code, context);
    this.name = "VectorError";
  }
}

/**
 * MCP protocol errors
 */
export class MCPError extends CodeSynapseError {
  public readonly requestId?: string;
  public readonly method?: string;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.MCP_INVALID_REQUEST,
    context?: Record<string, unknown> & { requestId?: string; method?: string }
  ) {
    super(message, code, context);
    this.name = "MCPError";
    this.requestId = context?.requestId;
    this.method = context?.method;
  }
}

/**
 * LLM inference errors
 */
export class LLMError extends CodeSynapseError {
  public readonly model?: string;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.LLM_INFERENCE_FAILED,
    context?: Record<string, unknown> & { model?: string }
  ) {
    super(message, code, context);
    this.name = "LLMError";
    this.model = context?.model;
  }
}

/**
 * Indexer errors
 */
export class IndexerError extends CodeSynapseError {
  public readonly filePath?: string;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INDEXER_FAILED,
    context?: Record<string, unknown> & { filePath?: string }
  ) {
    super(message, code, context);
    this.name = "IndexerError";
    this.filePath = context?.filePath;
  }
}

/**
 * Check if an error is a CodeSynapseError
 */
export function isCodeSynapseError(error: unknown): error is CodeSynapseError {
  return error instanceof CodeSynapseError;
}

/**
 * Wrap an unknown error in a CodeSynapseError
 */
export function wrapError(
  error: unknown,
  defaultMessage: string = "An unexpected error occurred",
  code: ErrorCode = ErrorCode.UNKNOWN_ERROR
): CodeSynapseError {
  if (isCodeSynapseError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new CodeSynapseError(error.message || defaultMessage, code, {
      originalError: error.name,
      originalStack: error.stack,
    });
  }

  return new CodeSynapseError(
    typeof error === "string" ? error : defaultMessage,
    code
  );
}

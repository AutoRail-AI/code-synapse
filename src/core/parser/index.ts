/**
 * Code Parser Module
 *
 * Tree-sitter based code parsing for the Syntax Layer of the knowledge engine.
 * Parses TypeScript and JavaScript files into Universal Code Entity (UCE) format.
 *
 * @module
 */

// Re-export IParser interface
export type { IParser } from "../interfaces/IParser.js";

// Re-export sub-modules
export * from "./parser-manager.js";
export * from "./ast-transformer.js";
export * from "./typescript-parser.js";
export * from "./call-extractor.js";

// Re-export types
export type {
  SupportedLanguage,
  ParseResult,
  FileChange,
} from "./parser-manager.js";

export type {
  TransformOptions,
} from "./ast-transformer.js";

export type {
  TypeScriptParserOptions,
} from "./typescript-parser.js";

export type {
  FunctionCall,
  FileCallGraph,
} from "./call-extractor.js";

// =============================================================================
// Main Parser Interface (for backwards compatibility)
// =============================================================================

import type { ProjectConfig } from "../../types/index.js";
import type { UCEFile } from "../../types/uce.js";
import { TypeScriptParser } from "./typescript-parser.js";
import { readFileWithEncoding } from "../../utils/fs.js";

/**
 * Legacy Parser interface for backwards compatibility.
 * Consider using TypeScriptParser directly for new code.
 *
 * @example
 * ```typescript
 * const parser = createParser(config);
 * await parser.initialize();
 *
 * // Parse a single file
 * const uce = await parser.parseFile('/path/to/file.ts');
 *
 * await parser.close();
 * ```
 */
export class Parser {
  private config: ProjectConfig;
  private tsParser: TypeScriptParser;

  constructor(config: ProjectConfig) {
    this.config = config;
    this.tsParser = new TypeScriptParser();
  }

  /**
   * Initializes the parser with language grammars.
   */
  async initialize(): Promise<void> {
    await this.tsParser.initialize();
  }

  /**
   * Closes the parser and releases resources.
   */
  async close(): Promise<void> {
    await this.tsParser.close();
  }

  /**
   * Parses a single file into UCE format.
   *
   * @param filePath - Absolute path to the file
   * @returns Parsed file in UCE format
   */
  async parseFile(filePath: string): Promise<UCEFile> {
    const content = await readFileWithEncoding(filePath);
    return this.tsParser.parse(filePath, content);
  }

  /**
   * Parses source code directly.
   *
   * @param code - Source code string
   * @param filePath - Virtual file path for the code
   * @returns Parsed code in UCE format
   */
  async parseCode(code: string, filePath = "<inline>"): Promise<UCEFile> {
    // Detect language from extension or default to typescript
    return this.tsParser.parse(filePath, code);
  }

  /**
   * Checks if the parser supports a file type.
   */
  supports(filePath: string): boolean {
    return this.tsParser.supports(filePath);
  }

  /**
   * Whether the parser is ready.
   */
  get isReady(): boolean {
    return this.tsParser.isReady;
  }

  /**
   * Gets the underlying TypeScript parser.
   */
  getTypeScriptParser(): TypeScriptParser {
    return this.tsParser;
  }
}

/**
 * Creates a Parser instance.
 */
export function createParser(config: ProjectConfig): Parser {
  return new Parser(config);
}

// =============================================================================
// IParser Factory
// =============================================================================

import type { IParser } from "../interfaces/IParser.js";

/**
 * Creates an IParser instance (TypeScriptParser).
 * This is the preferred way to create a parser for new code.
 *
 * @example
 * ```typescript
 * const parser = await createIParser();
 *
 * // Parse file from disk
 * const uce = await parser.parseFile('/path/to/file.ts');
 *
 * // Parse code string
 * const uce2 = await parser.parseCode('function foo() {}', 'typescript');
 *
 * await parser.close();
 * ```
 */
export async function createIParser(): Promise<IParser> {
  const parser = new TypeScriptParser();
  await parser.initialize();
  return parser;
}

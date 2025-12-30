/**
 * IParser - Universal code parser interface
 *
 * Converts source code files into Universal Code Entities (UCE),
 * abstracting over parser implementations (Tree-sitter, Babel, etc).
 *
 * @module
 */

import type { UCEFile } from "../../types/uce.js";

/**
 * Parser interface for converting source code to UCE format.
 *
 * @example
 * ```typescript
 * const parser = await createParser();
 * await parser.initialize();
 *
 * // Parse file from disk
 * const uce = await parser.parseFile('/path/to/file.ts');
 *
 * // Parse code string
 * const uce2 = await parser.parseCode('function foo() {}', 'typescript');
 * ```
 */
export interface IParser {
  /**
   * Parse a file from disk
   * @param filePath - Absolute path to source file
   * @throws FileNotFoundError if file doesn't exist
   * @throws UnsupportedLanguageError if language not supported
   */
  parseFile(filePath: string): Promise<UCEFile>;

  /**
   * Parse source code string
   * @param code - Source code content
   * @param language - Language identifier ("typescript", "javascript", etc)
   */
  parseCode(code: string, language: string): Promise<UCEFile>;

  /**
   * Get list of supported language identifiers
   */
  getSupportedLanguages(): string[];

  /**
   * Initialize the parser (load WASM, etc)
   */
  initialize(): Promise<void>;

  /**
   * Close the parser and release resources
   */
  close(): Promise<void>;

  /**
   * Check if this parser supports a given file extension
   */
  supports(filePath: string): boolean;

  /**
   * Whether the parser is initialized and ready
   */
  readonly isReady: boolean;
}

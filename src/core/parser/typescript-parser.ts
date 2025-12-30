/**
 * TypeScript/JavaScript Parser
 *
 * Implements the IParser and LanguageParser interfaces for TypeScript and JavaScript files.
 * Uses Tree-sitter for parsing and the AST Transformer for UCE conversion.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LanguageParser, UCEFile } from "../../types/uce.js";
import type { IParser } from "../interfaces/IParser.js";
import { ParserManager, type SupportedLanguage } from "./parser-manager.js";
import { ASTTransformer, type TransformOptions } from "./ast-transformer.js";

// =============================================================================
// Types
// =============================================================================

/**
 * TypeScript parser options
 */
export interface TypeScriptParserOptions {
  /** AST transformation options */
  transformOptions?: TransformOptions;
}

// =============================================================================
// TypeScript Parser Class
// =============================================================================

/**
 * Parser for TypeScript and JavaScript files.
 *
 * Implements the LanguageParser interface, outputting UCE format.
 *
 * @example
 * ```typescript
 * const parser = new TypeScriptParser();
 * await parser.initialize();
 *
 * const uceFile = await parser.parse('/path/to/file.ts', content);
 * console.log(uceFile.functions);
 * console.log(uceFile.classes);
 *
 * await parser.close();
 * ```
 */
export class TypeScriptParser implements IParser, LanguageParser {
  readonly language = "typescript";
  readonly extensions: readonly string[] = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

  /**
   * Supported languages for this parser.
   */
  private static readonly SUPPORTED_LANGUAGES = [
    "typescript",
    "javascript",
    "tsx",
    "jsx",
  ];

  private parserManager: ParserManager;
  private transformer: ASTTransformer;
  private initialized = false;

  constructor(options: TypeScriptParserOptions = {}) {
    this.parserManager = new ParserManager();
    this.transformer = new ASTTransformer(options.transformOptions);
  }

  /**
   * Initializes the parser (loads WASM grammars).
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.parserManager.initialize();
    this.initialized = true;
  }

  /**
   * Closes the parser and releases resources.
   */
  async close(): Promise<void> {
    await this.parserManager.close();
    this.initialized = false;
  }

  /**
   * Checks if this parser supports a given file.
   */
  supports(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.extensions.includes(ext);
  }

  /**
   * Parses a file from disk into UCE format.
   * Implements IParser.parseFile()
   */
  async parseFile(filePath: string): Promise<UCEFile> {
    this.ensureInitialized();

    // Read file content
    const content = await fs.readFile(filePath, "utf-8");

    // Use the existing parse method
    return this.parse(filePath, content);
  }

  /**
   * Parses a source file into UCE format.
   */
  async parse(filePath: string, content: string): Promise<UCEFile> {
    this.ensureInitialized();

    // Detect language from extension
    const language = this.parserManager.detectLanguage(filePath);
    if (!language) {
      throw new Error(`Unsupported file type: ${path.extname(filePath)}`);
    }

    // Parse with Tree-sitter
    const parseResult = await this.parserManager.parseCode(content, language);

    // Transform to UCE
    const uceLanguage = this.mapLanguage(language);
    const uceFile = this.transformer.transform(
      parseResult.tree,
      content,
      filePath,
      uceLanguage
    );

    return uceFile;
  }

  /**
   * Gets the list of supported language identifiers.
   * Implements IParser.getSupportedLanguages()
   */
  getSupportedLanguages(): string[] {
    return [...TypeScriptParser.SUPPORTED_LANGUAGES];
  }

  /**
   * Parses code directly without a file path.
   * Implements IParser.parseCode()
   */
  async parseCode(
    code: string,
    language: string = "typescript"
  ): Promise<UCEFile> {
    this.ensureInitialized();

    // Convert string to SupportedLanguage, defaulting to typescript
    const supportedLang = this.toSupportedLanguage(language);

    const parseResult = await this.parserManager.parseCode(code, supportedLang);
    const uceLanguage = this.mapLanguage(supportedLang);

    return this.transformer.transform(
      parseResult.tree,
      code,
      "<inline>",
      uceLanguage
    );
  }

  /**
   * Converts a language string to SupportedLanguage.
   */
  private toSupportedLanguage(language: string): SupportedLanguage {
    const supported: SupportedLanguage[] = ["typescript", "javascript", "tsx", "jsx"];
    const normalized = language.toLowerCase() as SupportedLanguage;
    if (supported.includes(normalized)) {
      return normalized;
    }
    // Default to typescript for unknown languages
    return "typescript";
  }

  /**
   * Gets the underlying parser manager.
   */
  getParserManager(): ParserManager {
    return this.parserManager;
  }

  /**
   * Whether the parser is initialized.
   */
  get isReady(): boolean {
    return this.initialized;
  }

  /**
   * Maps Tree-sitter language to UCE language string.
   */
  private mapLanguage(language: SupportedLanguage): string {
    switch (language) {
      case "typescript":
      case "tsx":
        return "typescript";
      case "javascript":
      case "jsx":
        return "javascript";
      default:
        return language;
    }
  }

  /**
   * Ensures the parser is initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("TypeScriptParser not initialized. Call initialize() first.");
    }
  }
}

// =============================================================================
// JavaScript Parser Class
// =============================================================================

/**
 * Specialized parser for JavaScript files.
 *
 * This is essentially the same as TypeScriptParser but identifies as JavaScript.
 */
export class JavaScriptParser implements LanguageParser {
  readonly language = "javascript";
  readonly extensions: readonly string[] = [".js", ".jsx", ".mjs", ".cjs"];

  private tsParser: TypeScriptParser;

  constructor(options: TypeScriptParserOptions = {}) {
    this.tsParser = new TypeScriptParser(options);
  }

  async initialize(): Promise<void> {
    await this.tsParser.initialize();
  }

  async close(): Promise<void> {
    await this.tsParser.close();
  }

  supports(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.extensions.includes(ext);
  }

  async parse(filePath: string, content: string): Promise<UCEFile> {
    return this.tsParser.parse(filePath, content);
  }

  get isReady(): boolean {
    return this.tsParser.isReady;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a TypeScriptParser instance.
 */
export function createTypeScriptParser(
  options?: TypeScriptParserOptions
): TypeScriptParser {
  return new TypeScriptParser(options);
}

/**
 * Creates a JavaScriptParser instance.
 */
export function createJavaScriptParser(
  options?: TypeScriptParserOptions
): JavaScriptParser {
  return new JavaScriptParser(options);
}

/**
 * Creates and initializes a TypeScriptParser.
 */
export async function createInitializedTypeScriptParser(
  options?: TypeScriptParserOptions
): Promise<TypeScriptParser> {
  const parser = new TypeScriptParser(options);
  await parser.initialize();
  return parser;
}

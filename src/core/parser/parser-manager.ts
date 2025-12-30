/**
 * Parser Manager
 *
 * Manages Tree-sitter parsers for different programming languages.
 * Provides a unified interface for parsing source code into ASTs.
 *
 * @module
 */

import { Parser, Language, type Tree, Edit } from "web-tree-sitter";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AsyncDisposable } from "../../utils/disposable.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Supported language identifiers
 */
export type SupportedLanguage = "typescript" | "javascript" | "tsx" | "jsx";

/**
 * Parse result from Tree-sitter
 */
export interface ParseResult {
  /** The parsed syntax tree */
  tree: Tree;
  /** Source code that was parsed */
  sourceCode: string;
  /** Language that was used */
  language: SupportedLanguage;
  /** Parse time in milliseconds */
  parseTimeMs: number;
  /** Whether there were any parse errors */
  hasErrors: boolean;
}

/**
 * File change for incremental parsing
 */
export interface FileChange {
  /** Start byte offset */
  startIndex: number;
  /** Old end byte offset */
  oldEndIndex: number;
  /** New end byte offset */
  newEndIndex: number;
  /** Start position */
  startPosition: { row: number; column: number };
  /** Old end position */
  oldEndPosition: { row: number; column: number };
  /** New end position */
  newEndPosition: { row: number; column: number };
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Map of file extensions to language identifiers
 */
const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
};

/**
 * Map of language identifiers to grammar module names
 */
const LANGUAGE_GRAMMARS: Record<SupportedLanguage, string> = {
  typescript: "tree-sitter-typescript",
  tsx: "tree-sitter-typescript",
  javascript: "tree-sitter-javascript",
  jsx: "tree-sitter-javascript",
};

// =============================================================================
// Parser Manager Class
// =============================================================================

/**
 * Manages Tree-sitter parsers for multiple languages.
 *
 * @example
 * ```typescript
 * const manager = new ParserManager();
 * await manager.initialize();
 *
 * // Parse a file
 * const result = await manager.parseFile('/path/to/file.ts', content);
 * console.log(result.tree.rootNode.type);
 *
 * // Parse code directly
 * const result2 = await manager.parseCode('const x = 1;', 'typescript');
 *
 * await manager.close();
 * ```
 */
export class ParserManager implements AsyncDisposable {
  private parsers = new Map<SupportedLanguage, Parser>();
  private languages = new Map<SupportedLanguage, Language>();
  private initialized = false;

  /**
   * Initializes Tree-sitter and loads language grammars.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize Tree-sitter WASM
    await Parser.init();

    // Load TypeScript grammar (handles both .ts and .tsx)
    await this.loadLanguage("typescript");
    await this.loadLanguage("tsx");

    // Load JavaScript grammar (handles both .js and .jsx)
    await this.loadLanguage("javascript");
    await this.loadLanguage("jsx");

    this.initialized = true;
  }

  /**
   * Closes all parsers and releases resources.
   */
  async close(): Promise<void> {
    for (const parser of this.parsers.values()) {
      parser.delete();
    }
    this.parsers.clear();
    this.languages.clear();
    this.initialized = false;
  }

  /**
   * Implements AsyncDisposable for use with `await using`.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /**
   * Parses a source file.
   *
   * @param filePath - Absolute path to the file (used for language detection)
   * @param content - File content as string
   * @returns Parse result with tree and metadata
   */
  async parseFile(filePath: string, content: string): Promise<ParseResult> {
    this.ensureInitialized();

    const language = this.detectLanguage(filePath);
    if (!language) {
      throw new Error(`Unsupported file type: ${path.extname(filePath)}`);
    }

    return this.parseCode(content, language);
  }

  /**
   * Parses source code directly.
   *
   * @param code - Source code string
   * @param language - Target language
   * @returns Parse result with tree and metadata
   */
  async parseCode(code: string, language: SupportedLanguage): Promise<ParseResult> {
    this.ensureInitialized();

    const parser = this.getParser(language);
    const startTime = performance.now();

    const tree = parser.parse(code);
    const parseTimeMs = performance.now() - startTime;

    if (!tree) {
      throw new Error(`Failed to parse code for language: ${language}`);
    }

    return {
      tree,
      sourceCode: code,
      language,
      parseTimeMs,
      hasErrors: tree.rootNode.hasError,
    };
  }

  /**
   * Performs incremental parsing on a modified tree.
   *
   * @param oldTree - Previous parse tree
   * @param newCode - Updated source code
   * @param changes - List of edit changes
   * @param language - Target language
   * @returns Updated parse result
   */
  async incrementalParse(
    oldTree: Tree,
    newCode: string,
    changes: FileChange[],
    language: SupportedLanguage
  ): Promise<ParseResult> {
    this.ensureInitialized();

    const parser = this.getParser(language);

    // Apply edits to the old tree
    for (const change of changes) {
      const edit = new Edit({
        startIndex: change.startIndex,
        oldEndIndex: change.oldEndIndex,
        newEndIndex: change.newEndIndex,
        startPosition: change.startPosition,
        oldEndPosition: change.oldEndPosition,
        newEndPosition: change.newEndPosition,
      });
      oldTree.edit(edit);
    }

    const startTime = performance.now();
    const tree = parser.parse(newCode, oldTree);
    const parseTimeMs = performance.now() - startTime;

    if (!tree) {
      throw new Error(`Failed to incrementally parse code for language: ${language}`);
    }

    return {
      tree,
      sourceCode: newCode,
      language,
      parseTimeMs,
      hasErrors: tree.rootNode.hasError,
    };
  }

  /**
   * Gets the parser for a specific language.
   */
  getParser(language: SupportedLanguage): Parser {
    const parser = this.parsers.get(language);
    if (!parser) {
      throw new Error(`Parser not loaded for language: ${language}`);
    }
    return parser;
  }

  /**
   * Detects the language from a file path.
   */
  detectLanguage(filePath: string): SupportedLanguage | null {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_TO_LANGUAGE[ext] ?? null;
  }

  /**
   * Checks if a file is supported.
   */
  isSupported(filePath: string): boolean {
    return this.detectLanguage(filePath) !== null;
  }

  /**
   * Gets all supported file extensions.
   */
  getSupportedExtensions(): string[] {
    return Object.keys(EXTENSION_TO_LANGUAGE);
  }

  /**
   * Gets all supported languages.
   */
  getSupportedLanguages(): SupportedLanguage[] {
    return ["typescript", "javascript", "tsx", "jsx"];
  }

  /**
   * Whether the manager is initialized.
   */
  get isReady(): boolean {
    return this.initialized;
  }

  /**
   * Loads a language grammar.
   */
  private async loadLanguage(language: SupportedLanguage): Promise<void> {
    const grammarModule = LANGUAGE_GRAMMARS[language];

    // Determine the correct WASM path
    const wasmPath = await this.resolveWasmPath(language, grammarModule);

    const grammarLanguage = await Language.load(wasmPath);
    this.languages.set(language, grammarLanguage);

    // Create parser for this language
    const parser = new Parser();
    parser.setLanguage(grammarLanguage);
    this.parsers.set(language, parser);
  }

  /**
   * Resolves the WASM file path for a grammar.
   */
  private async resolveWasmPath(
    language: SupportedLanguage,
    grammarModule: string
  ): Promise<string> {
    // Get the directory of this module
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // The WASM files are in the grammar packages under node_modules
    // For TypeScript, the grammar has typescript.wasm and tsx.wasm
    // For JavaScript, it has javascript.wasm

    let wasmFile: string;
    if (language === "typescript" || language === "tsx") {
      // tree-sitter-typescript has two WASM files with "tree-sitter-" prefix
      wasmFile = language === "tsx" ? "tree-sitter-tsx.wasm" : "tree-sitter-typescript.wasm";
    } else {
      // JavaScript uses tree-sitter-javascript.wasm
      wasmFile = "tree-sitter-javascript.wasm";
    }

    // Navigate from dist/core/parser to node_modules
    const nodeModulesPath = path.resolve(__dirname, "../../../node_modules");
    const wasmPath = path.join(nodeModulesPath, grammarModule, wasmFile);

    return wasmPath;
  }

  /**
   * Ensures the manager is initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("ParserManager not initialized. Call initialize() first.");
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a ParserManager instance.
 */
export function createParserManager(): ParserManager {
  return new ParserManager();
}

/**
 * Singleton parser manager for shared use.
 */
let sharedManager: ParserManager | null = null;

/**
 * Gets a shared ParserManager instance.
 * Use this for application-wide parsing.
 */
export async function getSharedParserManager(): Promise<ParserManager> {
  if (!sharedManager) {
    sharedManager = new ParserManager();
    await sharedManager.initialize();
  }
  return sharedManager;
}

/**
 * Resets the shared parser manager.
 * Useful for testing or when resources should be released.
 */
export async function resetSharedParserManager(): Promise<void> {
  if (sharedManager) {
    await sharedManager.close();
    sharedManager = null;
  }
}

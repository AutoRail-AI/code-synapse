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
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("parser-manager");

// =============================================================================
// Types
// =============================================================================

/**
 * Supported language identifiers
 */
export type SupportedLanguage =
  | "typescript"
  | "javascript"
  | "tsx"
  | "jsx"
  | "go"
  | "rust"
  | "python"
  | "java"
  | "c"
  | "cpp"
  | "csharp"
  | "kotlin"
  | "swift"
  | "dart"
  | "ruby"
  | "php"
  | "bash"
  | "scala"
  | "haskell"
  | "elixir"
  | "lua"
  | "json"
  | "yaml"
  | "toml";

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
  // TypeScript/JavaScript
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  // Go
  ".go": "go",
  // Rust
  ".rs": "rust",
  // Python
  ".py": "python",
  ".pyi": "python",
  ".pyw": "python",
  // Java
  ".java": "java",
  // C
  ".c": "c",
  ".h": "c",
  // C++
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".h++": "cpp",
  ".ipp": "cpp",
  // C#
  ".cs": "csharp",
  // Kotlin
  ".kt": "kotlin",
  ".kts": "kotlin",
  // Swift
  ".swift": "swift",
  // Dart
  ".dart": "dart",
  // Ruby
  ".rb": "ruby",
  ".rake": "ruby",
  ".gemspec": "ruby",
  // PHP
  ".php": "php",
  ".phtml": "php",
  ".php3": "php",
  ".php4": "php",
  ".php5": "php",
  ".phps": "php",
  // Bash
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  // Scala
  ".scala": "scala",
  ".sc": "scala",
  ".sbt": "scala",
  // Haskell
  ".hs": "haskell",
  ".lhs": "haskell",
  // Elixir
  ".ex": "elixir",
  ".exs": "elixir",
  // Lua
  ".lua": "lua",
  // JSON
  ".json": "json",
  ".jsonc": "json",
  ".json5": "json",
  // YAML
  ".yaml": "yaml",
  ".yml": "yaml",
  // TOML
  ".toml": "toml",
};

/**
 * Map of language identifiers to grammar module names
 */
const LANGUAGE_GRAMMARS: Record<SupportedLanguage, string> = {
  typescript: "tree-sitter-typescript",
  tsx: "tree-sitter-typescript",
  javascript: "tree-sitter-javascript",
  jsx: "tree-sitter-javascript",
  go: "tree-sitter-go",
  rust: "tree-sitter-rust",
  python: "tree-sitter-python",
  java: "tree-sitter-java",
  c: "tree-sitter-c",
  cpp: "tree-sitter-cpp",
  csharp: "tree-sitter-c-sharp",
  kotlin: "tree-sitter-kotlin",
  swift: "tree-sitter-swift",
  dart: "tree-sitter-dart",
  ruby: "tree-sitter-ruby",
  php: "tree-sitter-php",
  bash: "tree-sitter-bash",
  scala: "tree-sitter-scala",
  haskell: "tree-sitter-haskell",
  elixir: "tree-sitter-elixir",
  lua: "tree-sitter-lua",
  json: "tree-sitter-json",
  yaml: "@tree-sitter-grammars/tree-sitter-yaml",
  toml: "@tree-sitter-grammars/tree-sitter-toml",
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

    // Load Go grammar
    await this.loadLanguage("go");

    // Load Rust grammar
    await this.loadLanguage("rust");

    // Load Python grammar
    await this.loadLanguage("python");

    // Load Java grammar
    await this.loadLanguage("java");

    // Load C grammar
    await this.loadLanguage("c");

    // Load C++ grammar
    await this.loadLanguage("cpp");

    // Load C# grammar
    await this.loadLanguage("csharp");

    // Load Kotlin grammar
    await this.loadLanguage("kotlin");

    // Load Swift grammar
    await this.loadLanguage("swift");

    // Load Dart grammar
    await this.loadLanguage("dart");

    // Load Ruby grammar
    await this.loadLanguage("ruby");

    // Load PHP grammar
    await this.loadLanguage("php");

    // Load Bash grammar
    await this.loadLanguage("bash");

    // Load Scala grammar
    await this.loadLanguage("scala");

    // Load Haskell grammar
    await this.loadLanguage("haskell");

    // Load Elixir grammar
    await this.loadLanguage("elixir");

    // Load Lua grammar
    await this.loadLanguage("lua");

    // Load JSON grammar
    await this.loadLanguage("json");

    // Load YAML grammar
    await this.loadLanguage("yaml");

    // Load TOML grammar
    await this.loadLanguage("toml");

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
      throw new Error(`Parser not available for language: ${language}. The grammar may not have a pre-built WASM file.`);
    }
    return parser;
  }

  /**
   * Checks if a language parser is available.
   */
  hasParser(language: SupportedLanguage): boolean {
    return this.parsers.has(language);
  }

  /**
   * Detects the language from a file path.
   */
  detectLanguage(filePath: string): SupportedLanguage | null {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_TO_LANGUAGE[ext] ?? null;
  }

  /**
   * Checks if a file is supported (language is known and parser is available).
   */
  isSupported(filePath: string): boolean {
    const language = this.detectLanguage(filePath);
    return language !== null && this.parsers.has(language);
  }

  /**
   * Gets all supported file extensions.
   */
  getSupportedExtensions(): string[] {
    return Object.keys(EXTENSION_TO_LANGUAGE);
  }

  /**
   * Gets all supported languages (may not all have parsers available).
   */
  getSupportedLanguages(): SupportedLanguage[] {
    return ["typescript", "javascript", "tsx", "jsx", "go", "rust", "python", "java", "c", "cpp", "csharp", "kotlin", "swift", "dart", "ruby", "php", "bash", "scala", "haskell", "elixir", "lua", "json", "yaml", "toml"];
  }

  /**
   * Gets languages with available parsers.
   */
  getAvailableLanguages(): SupportedLanguage[] {
    return Array.from(this.parsers.keys());
  }

  /**
   * Whether the manager is initialized.
   */
  get isReady(): boolean {
    return this.initialized;
  }

  /**
   * Loads a language grammar.
   * Returns true if loaded successfully, false if WASM file not available.
   */
  private async loadLanguage(language: SupportedLanguage): Promise<boolean> {
    try {
      const grammarModule = LANGUAGE_GRAMMARS[language];

      // Determine the correct WASM path
      const wasmPath = await this.resolveWasmPath(language, grammarModule);

      const grammarLanguage = await Language.load(wasmPath);
      this.languages.set(language, grammarLanguage);

      // Create parser for this language
      const parser = new Parser();
      parser.setLanguage(grammarLanguage);
      this.parsers.set(language, parser);
      return true;
    } catch (error) {
      // Grammar not available - this is expected for some languages
      // that don't ship with pre-built WASM files or have ABI incompatibilities
      // Log at debug level to avoid cluttering the console output
      logger.debug(
        { language, error: error instanceof Error ? error.message : String(error) },
        "Grammar not available for language"
      );
      return false;
    }
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
    // Each grammar package has a WASM file with "tree-sitter-<language>.wasm" naming

    let wasmFile: string;
    switch (language) {
      case "typescript":
        wasmFile = "tree-sitter-typescript.wasm";
        break;
      case "tsx":
        wasmFile = "tree-sitter-tsx.wasm";
        break;
      case "javascript":
      case "jsx":
        wasmFile = "tree-sitter-javascript.wasm";
        break;
      case "go":
        wasmFile = "tree-sitter-go.wasm";
        break;
      case "rust":
        wasmFile = "tree-sitter-rust.wasm";
        break;
      case "python":
        wasmFile = "tree-sitter-python.wasm";
        break;
      case "java":
        wasmFile = "tree-sitter-java.wasm";
        break;
      case "c":
        wasmFile = "tree-sitter-c.wasm";
        break;
      case "cpp":
        wasmFile = "tree-sitter-cpp.wasm";
        break;
      case "csharp":
        wasmFile = "tree-sitter-c_sharp.wasm";
        break;
      case "kotlin":
        wasmFile = "tree-sitter-kotlin.wasm";
        break;
      case "swift":
        wasmFile = "tree-sitter-swift.wasm";
        break;
      case "dart":
        wasmFile = "tree-sitter-dart.wasm";
        break;
      case "ruby":
        wasmFile = "tree-sitter-ruby.wasm";
        break;
      case "php":
        wasmFile = "tree-sitter-php.wasm";
        break;
      case "bash":
        wasmFile = "tree-sitter-bash.wasm";
        break;
      case "scala":
        wasmFile = "tree-sitter-scala.wasm";
        break;
      case "haskell":
        wasmFile = "tree-sitter-haskell.wasm";
        break;
      case "elixir":
        wasmFile = "tree-sitter-elixir.wasm";
        break;
      case "lua":
        wasmFile = "tree-sitter-lua.wasm";
        break;
      case "json":
        wasmFile = "tree-sitter-json.wasm";
        break;
      case "yaml":
        wasmFile = "tree-sitter-yaml.wasm";
        break;
      case "toml":
        wasmFile = "tree-sitter-toml.wasm";
        break;
      default:
        throw new Error(`Unsupported language: ${language}`);
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

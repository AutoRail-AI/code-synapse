/**
 * TypeScript Program Manager
 *
 * Manages TypeScript Program and TypeChecker for semantic analysis.
 * Loads project configuration and creates the compiler infrastructure.
 *
 * @module
 */

import * as ts from "typescript";
import * as path from "node:path";
import * as fs from "node:fs";
import type { AsyncDisposable } from "../../utils/disposable.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("ts-program");

// =============================================================================
// Types
// =============================================================================

/**
 * Options for TypeScript program creation.
 */
export interface TSProgramOptions {
  /** Project root directory */
  projectRoot: string;
  /** Path to tsconfig.json (optional, will be auto-detected) */
  tsconfigPath?: string;
  /** Additional compiler options to merge */
  compilerOptions?: ts.CompilerOptions;
  /** Whether to skip type checking (faster, but no diagnostics) */
  skipTypeCheck?: boolean;
}

/**
 * Result of loading a TypeScript program.
 */
export interface TSProgramInfo {
  /** The TypeScript program */
  program: ts.Program;
  /** The type checker */
  typeChecker: ts.TypeChecker;
  /** Parsed tsconfig.json path */
  configPath: string;
  /** Compiler options used */
  compilerOptions: ts.CompilerOptions;
  /** All source files in the program */
  sourceFiles: string[];
  /** Any configuration errors */
  configErrors: ts.Diagnostic[];
}

// =============================================================================
// TypeScript Program Manager
// =============================================================================

/**
 * Manages TypeScript program lifecycle and provides access to compiler APIs.
 *
 * @example
 * ```typescript
 * const manager = new TypeScriptProgramManager();
 * await manager.loadProgram({ projectRoot: '/path/to/project' });
 *
 * const typeChecker = manager.getTypeChecker();
 * const sourceFile = manager.getSourceFile('/path/to/file.ts');
 *
 * manager.dispose();
 * ```
 */
export class TypeScriptProgramManager implements AsyncDisposable {
  private program: ts.Program | null = null;
  private typeChecker: ts.TypeChecker | null = null;
  private configPath: string | null = null;
  private compilerOptions: ts.CompilerOptions | null = null;
  private projectRoot: string | null = null;

  /**
   * Loads a TypeScript program from a project directory.
   *
   * @param options - Program loading options
   * @returns Program information
   */
  async loadProgram(options: TSProgramOptions): Promise<TSProgramInfo> {
    const { projectRoot, tsconfigPath, compilerOptions: additionalOptions } = options;

    this.projectRoot = projectRoot;

    // Find tsconfig.json
    const configPath = tsconfigPath ?? this.findTsConfig(projectRoot);
    if (!configPath) {
      throw new Error(`No tsconfig.json found in ${projectRoot}`);
    }

    this.configPath = configPath;
    logger.debug({ configPath }, "Found tsconfig.json");

    // Read and parse tsconfig.json
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      throw new Error(
        `Failed to read tsconfig.json: ${ts.flattenDiagnosticMessageText(
          configFile.error.messageText,
          "\n"
        )}`
      );
    }

    // Parse the configuration
    const configDir = path.dirname(configPath);
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      configDir,
      additionalOptions
    );

    // Collect configuration errors
    const configErrors = parsedConfig.errors.filter(
      (d) => d.category === ts.DiagnosticCategory.Error
    );

    if (configErrors.length > 0) {
      logger.warn(
        {
          errors: configErrors.map((e) =>
            ts.flattenDiagnosticMessageText(e.messageText, "\n")
          ),
        },
        "TypeScript configuration errors"
      );
    }

    this.compilerOptions = parsedConfig.options;

    // Create the program
    logger.debug(
      { fileCount: parsedConfig.fileNames.length },
      "Creating TypeScript program"
    );

    const host = ts.createCompilerHost(parsedConfig.options);
    this.program = ts.createProgram({
      rootNames: parsedConfig.fileNames,
      options: parsedConfig.options,
      host,
    });

    this.typeChecker = this.program.getTypeChecker();

    const sourceFiles = this.program
      .getSourceFiles()
      .filter((sf) => !sf.isDeclarationFile)
      .map((sf) => sf.fileName);

    logger.info(
      { sourceFileCount: sourceFiles.length, configPath },
      "TypeScript program loaded"
    );

    return {
      program: this.program,
      typeChecker: this.typeChecker,
      configPath,
      compilerOptions: parsedConfig.options,
      sourceFiles,
      configErrors,
    };
  }

  /**
   * Gets the TypeScript program.
   */
  getProgram(): ts.Program {
    if (!this.program) {
      throw new Error("Program not loaded. Call loadProgram() first.");
    }
    return this.program;
  }

  /**
   * Gets the TypeChecker for type resolution.
   */
  getTypeChecker(): ts.TypeChecker {
    if (!this.typeChecker) {
      throw new Error("Program not loaded. Call loadProgram() first.");
    }
    return this.typeChecker;
  }

  /**
   * Gets a source file by path.
   *
   * @param filePath - Absolute path to the file
   * @returns Source file or undefined if not in program
   */
  getSourceFile(filePath: string): ts.SourceFile | undefined {
    if (!this.program) {
      throw new Error("Program not loaded. Call loadProgram() first.");
    }
    return this.program.getSourceFile(filePath);
  }

  /**
   * Gets all source files in the program (excluding declaration files).
   */
  getSourceFiles(): ts.SourceFile[] {
    if (!this.program) {
      throw new Error("Program not loaded. Call loadProgram() first.");
    }
    return this.program.getSourceFiles().filter((sf) => !sf.isDeclarationFile);
  }

  /**
   * Gets the compiler options used.
   */
  getCompilerOptions(): ts.CompilerOptions {
    if (!this.compilerOptions) {
      throw new Error("Program not loaded. Call loadProgram() first.");
    }
    return this.compilerOptions;
  }

  /**
   * Gets the project root directory.
   */
  getProjectRoot(): string {
    if (!this.projectRoot) {
      throw new Error("Program not loaded. Call loadProgram() first.");
    }
    return this.projectRoot;
  }

  /**
   * Gets all diagnostics from the program.
   *
   * @param sourceFile - Optional source file to get diagnostics for
   * @returns Array of diagnostics
   */
  getDiagnostics(sourceFile?: ts.SourceFile): readonly ts.Diagnostic[] {
    if (!this.program) {
      throw new Error("Program not loaded. Call loadProgram() first.");
    }

    const syntacticDiagnostics = sourceFile
      ? this.program.getSyntacticDiagnostics(sourceFile)
      : this.program.getSyntacticDiagnostics();

    const semanticDiagnostics = sourceFile
      ? this.program.getSemanticDiagnostics(sourceFile)
      : this.program.getSemanticDiagnostics();

    return [...syntacticDiagnostics, ...semanticDiagnostics];
  }

  /**
   * Resolves a module specifier to its file path.
   *
   * @param moduleSpecifier - The import module specifier
   * @param containingFile - The file containing the import
   * @returns Resolved file path or null
   */
  resolveModulePath(
    moduleSpecifier: string,
    containingFile: string
  ): string | null {
    if (!this.compilerOptions) {
      throw new Error("Program not loaded. Call loadProgram() first.");
    }

    const resolved = ts.resolveModuleName(
      moduleSpecifier,
      containingFile,
      this.compilerOptions,
      ts.sys
    );

    return resolved.resolvedModule?.resolvedFileName ?? null;
  }

  /**
   * Checks if a file is part of the program.
   */
  hasSourceFile(filePath: string): boolean {
    return this.getSourceFile(filePath) !== undefined;
  }

  /**
   * Whether the program is loaded.
   */
  get isLoaded(): boolean {
    return this.program !== null;
  }

  /**
   * Disposes of the program and releases resources.
   */
  dispose(): void {
    this.program = null;
    this.typeChecker = null;
    this.configPath = null;
    this.compilerOptions = null;
    this.projectRoot = null;
    logger.debug("TypeScript program disposed");
  }

  /**
   * Implements AsyncDisposable for use with `await using`.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    this.dispose();
  }

  /**
   * Finds tsconfig.json in the project directory.
   */
  private findTsConfig(projectRoot: string): string | null {
    // Try exact path first
    const exactPath = path.join(projectRoot, "tsconfig.json");
    if (fs.existsSync(exactPath)) {
      return exactPath;
    }

    // Use TypeScript's config finder
    const found = ts.findConfigFile(projectRoot, ts.sys.fileExists);
    return found ?? null;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a TypeScriptProgramManager instance.
 */
export function createTSProgramManager(): TypeScriptProgramManager {
  return new TypeScriptProgramManager();
}

/**
 * Creates and initializes a TypeScriptProgramManager.
 *
 * @param options - Program options
 * @returns Initialized manager
 */
export async function createInitializedTSProgramManager(
  options: TSProgramOptions
): Promise<TypeScriptProgramManager> {
  const manager = new TypeScriptProgramManager();
  await manager.loadProgram(options);
  return manager;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Gets the position (line, column) for a node.
 */
export function getNodePosition(
  node: ts.Node
): { line: number; column: number } {
  const sourceFile = node.getSourceFile();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart()
  );
  return { line: line + 1, column: character };
}

/**
 * Gets the end position for a node.
 */
export function getNodeEndPosition(
  node: ts.Node
): { line: number; column: number } {
  const sourceFile = node.getSourceFile();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getEnd()
  );
  return { line: line + 1, column: character };
}

/**
 * Gets the full range for a node.
 */
export function getNodeRange(node: ts.Node): {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
} {
  const start = getNodePosition(node);
  const end = getNodeEndPosition(node);
  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

/**
 * Formats a TypeScript diagnostic to a string.
 */
export function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(
    diagnostic.messageText,
    "\n"
  );

  if (diagnostic.file && diagnostic.start !== undefined) {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start
    );
    return `${diagnostic.file.fileName}:${line + 1}:${character + 1}: ${message}`;
  }

  return message;
}

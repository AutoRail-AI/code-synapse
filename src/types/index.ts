/**
 * Shared types for Code-Synapse
 */

// =============================================================================
// Project Configuration
// =============================================================================

/**
 * Supported programming languages
 */
export type Language = "typescript" | "javascript" | "python" | "go" | "rust" | "java";

/**
 * Supported frameworks
 */
export type Framework =
  | "nextjs"
  | "react"
  | "express"
  | "nestjs"
  | "fastify"
  | "koa"
  | "vue"
  | "angular"
  | "svelte";

/**
 * Project configuration
 */
export interface ProjectConfig {
  /** Project root directory */
  root: string;
  /** Primary language(s) used in the project */
  languages: Language[];
  /** Detected framework (if any) */
  framework?: Framework;
  /** Glob patterns for source files */
  sourcePatterns: string[];
  /** Glob patterns to exclude */
  ignorePatterns: string[];
  /** Project name (derived from package.json or directory) */
  name: string;
  /** Version from package.json */
  version?: string;
}

// =============================================================================
// File Entities
// =============================================================================

/**
 * File entity representing a source file
 */
export interface FileEntity {
  /** Unique identifier */
  id: string;
  /** Absolute file path */
  path: string;
  /** Path relative to project root */
  relativePath: string;
  /** File extension */
  extension: string;
  /** Content hash for change detection */
  hash: string;
  /** File size in bytes */
  size: number;
  /** Last modification timestamp */
  lastModified: Date;
  /** Detected language */
  language: Language | string;
  /** Detected framework (if applicable) */
  framework?: Framework;
}

// =============================================================================
// Code Entities
// =============================================================================

/**
 * Parameter information
 */
export interface Parameter {
  /** Parameter name */
  name: string;
  /** Parameter type (if available) */
  type?: string;
  /** Default value (if any) */
  defaultValue?: string;
  /** Whether the parameter is optional */
  isOptional: boolean;
  /** Whether this is a rest parameter */
  isRest: boolean;
}

/**
 * Function entity
 */
export interface FunctionEntity {
  /** Unique identifier */
  id: string;
  /** Function name */
  name: string;
  /** ID of the containing file */
  fileId: string;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed) */
  endLine: number;
  /** Starting column */
  startColumn: number;
  /** Ending column */
  endColumn: number;
  /** Full function signature */
  signature: string;
  /** Function parameters */
  parameters: Parameter[];
  /** Return type (if available) */
  returnType?: string;
  /** Whether the function is exported */
  isExported: boolean;
  /** Whether the function is async */
  isAsync: boolean;
  /** Whether the function is a generator */
  isGenerator: boolean;
  /** Cyclomatic complexity */
  complexity: number;
  /** JSDoc or documentation comment */
  docComment?: string;
  /** LLM-inferred business logic description */
  businessLogic?: string;
  /** Raw function body text */
  body?: string;
}

/**
 * Method entity (function within a class)
 */
export interface MethodEntity extends Omit<FunctionEntity, "fileId"> {
  /** ID of the containing class */
  classId: string;
  /** Visibility modifier */
  visibility: "public" | "private" | "protected";
  /** Whether the method is static */
  isStatic: boolean;
  /** Whether the method is abstract */
  isAbstract: boolean;
}

/**
 * Property entity (class or interface property)
 */
export interface PropertyEntity {
  /** Unique identifier */
  id: string;
  /** Property name */
  name: string;
  /** Property type */
  type?: string;
  /** Visibility modifier (for class properties) */
  visibility?: "public" | "private" | "protected";
  /** Whether the property is static */
  isStatic: boolean;
  /** Whether the property is readonly */
  isReadonly: boolean;
  /** Whether the property is optional */
  isOptional: boolean;
  /** Default value */
  defaultValue?: string;
  /** Documentation comment */
  docComment?: string;
}

/**
 * Class entity
 */
export interface ClassEntity {
  /** Unique identifier */
  id: string;
  /** Class name */
  name: string;
  /** ID of the containing file */
  fileId: string;
  /** Starting line number */
  startLine: number;
  /** Ending line number */
  endLine: number;
  /** Whether the class is exported */
  isExported: boolean;
  /** Whether the class is abstract */
  isAbstract: boolean;
  /** Parent class name (if extends) */
  extends?: string;
  /** Implemented interfaces */
  implements: string[];
  /** Class methods */
  methods: MethodEntity[];
  /** Class properties */
  properties: PropertyEntity[];
  /** Documentation comment */
  docComment?: string;
}

/**
 * Interface entity
 */
export interface InterfaceEntity {
  /** Unique identifier */
  id: string;
  /** Interface name */
  name: string;
  /** ID of the containing file */
  fileId: string;
  /** Starting line number */
  startLine: number;
  /** Ending line number */
  endLine: number;
  /** Whether the interface is exported */
  isExported: boolean;
  /** Extended interfaces */
  extends: string[];
  /** Interface properties */
  properties: PropertyEntity[];
  /** Interface methods */
  methods: Omit<MethodEntity, "classId" | "visibility" | "isStatic" | "isAbstract">[];
  /** Documentation comment */
  docComment?: string;
}

/**
 * Type alias entity
 */
export interface TypeAliasEntity {
  /** Unique identifier */
  id: string;
  /** Type alias name */
  name: string;
  /** ID of the containing file */
  fileId: string;
  /** Starting line number */
  startLine: number;
  /** Ending line number */
  endLine: number;
  /** Whether the type is exported */
  isExported: boolean;
  /** Type definition string */
  typeDefinition: string;
  /** Generic type parameters */
  typeParameters?: string[];
  /** Documentation comment */
  docComment?: string;
}

/**
 * Variable entity
 */
export interface VariableEntity {
  /** Unique identifier */
  id: string;
  /** Variable name */
  name: string;
  /** ID of the containing file */
  fileId: string;
  /** Line number */
  line: number;
  /** Column */
  column: number;
  /** Variable type */
  type?: string;
  /** Whether declared with const */
  isConst: boolean;
  /** Whether the variable is exported */
  isExported: boolean;
  /** Scope: global, function, or block */
  scope: "global" | "function" | "block";
  /** Initial value (if simple) */
  initialValue?: string;
}

// =============================================================================
// Import/Export Entities
// =============================================================================

/**
 * Import specifier
 */
export interface ImportSpecifier {
  /** Local name (how it's used in this file) */
  local: string;
  /** Imported name (original name from module) */
  imported: string;
  /** Import type */
  type: "named" | "default" | "namespace";
}

/**
 * Import statement entity
 */
export interface ImportEntity {
  /** Unique identifier */
  id: string;
  /** ID of the importing file */
  fileId: string;
  /** Module specifier (import path) */
  source: string;
  /** Resolved file ID (if internal) */
  resolvedFileId?: string;
  /** Import specifiers */
  specifiers: ImportSpecifier[];
  /** Whether it's a type-only import */
  isTypeOnly: boolean;
  /** Line number */
  line: number;
}

/**
 * Export statement entity
 */
export interface ExportEntity {
  /** Unique identifier */
  id: string;
  /** ID of the exporting file */
  fileId: string;
  /** Exported name */
  name: string;
  /** Local name (if different) */
  localName?: string;
  /** Export type */
  type: "named" | "default" | "namespace" | "re-export";
  /** Re-exported from module (if re-export) */
  source?: string;
  /** Line number */
  line: number;
}

// =============================================================================
// Relationships
// =============================================================================

/**
 * Function call relationship
 */
export interface CallRelationship {
  /** Caller function ID */
  callerId: string;
  /** Callee function ID */
  calleeId: string;
  /** Line number where call occurs */
  line: number;
  /** Whether it's a direct call */
  isDirectCall: boolean;
  /** Whether it's an async call (await) */
  isAwait: boolean;
}

/**
 * Import relationship between files
 */
export interface ImportRelationship {
  /** Importing file ID */
  fromFileId: string;
  /** Imported file ID */
  toFileId: string;
  /** Imported symbols */
  importedSymbols: string[];
  /** Import type */
  importType: "named" | "default" | "namespace" | "side-effect";
}

/**
 * Inheritance relationship
 */
export interface ExtendsRelationship {
  /** Child class/interface ID */
  childId: string;
  /** Parent class/interface ID */
  parentId: string;
  /** Type of relationship */
  type: "extends" | "implements";
}

/**
 * Type usage relationship
 */
export interface UsesTypeRelationship {
  /** Function/variable using the type */
  userId: string;
  /** Type being used (class/interface/type) */
  typeId: string;
  /** Context of usage */
  context: "parameter" | "return" | "variable" | "property" | "generic";
}

// =============================================================================
// Parsing & AST
// =============================================================================

/**
 * Parsed file result
 */
export interface ParsedFile {
  /** File path */
  path: string;
  /** Detected language */
  language: string;
  /** Raw AST (Tree-sitter tree) */
  ast: unknown;
  /** Extracted symbols */
  symbols: Symbol[];
  /** Extracted functions */
  functions: FunctionEntity[];
  /** Extracted classes */
  classes: ClassEntity[];
  /** Extracted interfaces */
  interfaces: InterfaceEntity[];
  /** Extracted imports */
  imports: ImportEntity[];
  /** Extracted exports */
  exports: ExportEntity[];
}

/**
 * Symbol kinds
 */
export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "property"
  | "variable"
  | "import"
  | "export"
  | "type"
  | "interface"
  | "enum"
  | "parameter";

/**
 * Symbol information
 */
export interface Symbol {
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: SymbolKind;
  /** Location in source */
  location: Location;
  /** References to this symbol */
  references: Location[];
}

/**
 * Source location
 */
export interface Location {
  /** File path or ID */
  file: string;
  /** Line number (1-indexed) */
  line: number;
  /** Column number (0-indexed) */
  column: number;
  /** End line (optional) */
  endLine?: number;
  /** End column (optional) */
  endColumn?: number;
}

// =============================================================================
// Graph Types
// =============================================================================

/**
 * Graph node
 */
export interface GraphNode {
  /** Unique identifier */
  id: string;
  /** Node type (File, Function, Class, etc.) */
  type: string;
  /** Node properties */
  properties: Record<string, unknown>;
}

/**
 * Graph edge
 */
export interface GraphEdge {
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Edge type (CALLS, IMPORTS, EXTENDS, etc.) */
  type: string;
  /** Edge properties */
  properties: Record<string, unknown>;
}

// =============================================================================
// Vector/Embedding Types
// =============================================================================

/**
 * Embedding result
 */
export interface EmbeddingResult {
  /** Original text */
  text: string;
  /** Vector embedding */
  vector: number[];
  /** Embedding model used */
  model?: string;
}

/**
 * Vector search result
 */
export interface SearchResult {
  /** Result ID */
  id: string;
  /** Similarity score (0-1) */
  score: number;
  /** Content that was matched */
  content: string;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

// =============================================================================
// Indexing Types
// =============================================================================

/**
 * Indexing statistics
 */
export interface IndexStats {
  /** Number of files indexed */
  fileCount: number;
  /** Number of functions found */
  functionCount: number;
  /** Number of classes found */
  classCount: number;
  /** Number of interfaces found */
  interfaceCount: number;
  /** Number of relationships found */
  relationshipCount: number;
  /** Database size in bytes */
  dbSize: number;
  /** Last indexing timestamp */
  lastIndexed: Date;
  /** Number of functions with inferred business logic */
  inferredCount: number;
  /** Inference progress percentage */
  inferenceProgress: number;
}

/**
 * Indexing result
 */
export interface IndexResult {
  /** Number of files indexed */
  filesIndexed: number;
  /** Number of functions found */
  functionsFound: number;
  /** Number of classes found */
  classesFound: number;
  /** Duration in seconds */
  duration: number;
  /** Any errors encountered */
  errors: Array<{ file: string; error: string }>;
}

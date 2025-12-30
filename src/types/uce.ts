/**
 * Universal Code Entity (UCE) Types
 *
 * Language-agnostic interfaces for parsed code elements.
 * All language parsers output UCE format, and the GraphWriter consumes UCE.
 *
 * This abstraction enables:
 * - Adding new language support without modifying the graph layer
 * - Consistent representation across TypeScript, JavaScript, Python, Go, etc.
 * - Clear contract between parsing and storage layers
 *
 * @module
 */

// =============================================================================
// Location Types
// =============================================================================

/**
 * Source code location with line and column information.
 * All positions are 1-indexed for lines, 0-indexed for columns.
 */
export interface UCELocation {
  /** Absolute file path */
  filePath: string;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed) */
  endLine: number;
  /** Starting column (0-indexed) */
  startColumn: number;
  /** Ending column (0-indexed) */
  endColumn: number;
}

// =============================================================================
// Modifier Types
// =============================================================================

/**
 * Code modifiers that apply across languages.
 */
export type UCEModifier =
  | "public"
  | "private"
  | "protected"
  | "static"
  | "abstract"
  | "readonly"
  | "async"
  | "export"
  | "default"
  | "const"
  | "final"
  | "override"
  | "virtual";

/**
 * Visibility modifiers subset
 */
export type UCEVisibility = "public" | "private" | "protected";

// =============================================================================
// Parameter & Type Types
// =============================================================================

/**
 * Function/method parameter definition.
 */
export interface UCEParameter {
  /** Parameter name */
  name: string;
  /** Type annotation (null if not typed or inferred) */
  type: string | null;
  /** Whether the parameter is optional */
  isOptional: boolean;
  /** Whether this is a rest/variadic parameter */
  isRest: boolean;
  /** Default value as source text (null if no default) */
  defaultValue: string | null;
}

/**
 * Generic type parameter definition (e.g., T in Array<T>).
 */
export interface UCETypeParameter {
  /** Type parameter name (e.g., "T") */
  name: string;
  /** Constraint type (e.g., "extends Foo") */
  constraint: string | null;
  /** Default type */
  default: string | null;
}

// =============================================================================
// Function Entity
// =============================================================================

/**
 * Universal function representation.
 * Covers: functions, arrow functions, function expressions.
 */
export interface UCEFunction {
  /** Discriminant for type narrowing */
  kind: "function";
  /** Function name (empty string for anonymous) */
  name: string;
  /** Function parameters */
  params: UCEParameter[];
  /** Return type annotation (null if not typed) */
  returnType: string | null;
  /** Generic type parameters */
  typeParams: UCETypeParameter[];
  /** Function body as source text */
  body: string;
  /** Source location */
  location: UCELocation;
  /** Applied modifiers */
  modifiers: UCEModifier[];
  /** JSDoc or documentation comment (null if none) */
  docComment: string | null;
  /** Full function signature as source text */
  signature: string;
  /** Cyclomatic complexity score */
  complexity: number;
}

// =============================================================================
// Method Entity
// =============================================================================

/**
 * Universal method representation.
 * Methods are functions that belong to a class or interface.
 */
export interface UCEMethod {
  /** Discriminant for type narrowing */
  kind: "method";
  /** Method name */
  name: string;
  /** Method parameters */
  params: UCEParameter[];
  /** Return type annotation */
  returnType: string | null;
  /** Generic type parameters */
  typeParams: UCETypeParameter[];
  /** Method body as source text (empty for abstract/interface methods) */
  body: string;
  /** Source location */
  location: UCELocation;
  /** Applied modifiers */
  modifiers: UCEModifier[];
  /** JSDoc or documentation comment */
  docComment: string | null;
  /** Full method signature */
  signature: string;
  /** Visibility level */
  visibility: UCEVisibility;
  /** Whether the method is static */
  isStatic: boolean;
  /** Whether the method is abstract */
  isAbstract: boolean;
  /** Whether this is a getter */
  isGetter: boolean;
  /** Whether this is a setter */
  isSetter: boolean;
}

// =============================================================================
// Property Entity
// =============================================================================

/**
 * Universal property representation.
 * Properties belong to classes or interfaces.
 */
export interface UCEProperty {
  /** Discriminant for type narrowing */
  kind: "property";
  /** Property name */
  name: string;
  /** Type annotation */
  type: string | null;
  /** Visibility level */
  visibility: UCEVisibility;
  /** Whether the property is static */
  isStatic: boolean;
  /** Whether the property is readonly */
  isReadonly: boolean;
  /** Whether the property is optional */
  isOptional: boolean;
  /** Default value as source text */
  defaultValue: string | null;
  /** Source location */
  location: UCELocation;
  /** JSDoc or documentation comment */
  docComment: string | null;
}

// =============================================================================
// Class Entity
// =============================================================================

/**
 * Universal class representation.
 */
export interface UCEClass {
  /** Discriminant for type narrowing */
  kind: "class";
  /** Class name */
  name: string;
  /** Generic type parameters */
  typeParams: UCETypeParameter[];
  /** Extended class name (null if none) */
  extends: string | null;
  /** Implemented interface names */
  implements: string[];
  /** Class methods */
  methods: UCEMethod[];
  /** Class properties */
  properties: UCEProperty[];
  /** Constructor (if defined) */
  constructor: UCEMethod | null;
  /** Source location */
  location: UCELocation;
  /** Applied modifiers */
  modifiers: UCEModifier[];
  /** JSDoc or documentation comment */
  docComment: string | null;
  /** Whether the class is abstract */
  isAbstract: boolean;
}

// =============================================================================
// Interface Entity
// =============================================================================

/**
 * Interface property (subset of UCEProperty without class-specific fields)
 */
export interface UCEInterfaceProperty {
  /** Discriminant for type narrowing */
  kind: "property";
  /** Property name */
  name: string;
  /** Type annotation */
  type: string | null;
  /** Whether the property is readonly */
  isReadonly: boolean;
  /** Whether the property is optional */
  isOptional: boolean;
  /** Source location */
  location: UCELocation;
  /** JSDoc or documentation comment */
  docComment: string | null;
}

/**
 * Interface method signature (subset of UCEMethod without implementation details)
 */
export interface UCEInterfaceMethod {
  /** Discriminant for type narrowing */
  kind: "method";
  /** Method name */
  name: string;
  /** Method parameters */
  params: UCEParameter[];
  /** Return type annotation */
  returnType: string | null;
  /** Generic type parameters */
  typeParams: UCETypeParameter[];
  /** Full method signature */
  signature: string;
  /** Whether the method is optional */
  isOptional: boolean;
  /** Source location */
  location: UCELocation;
  /** JSDoc or documentation comment */
  docComment: string | null;
}

/**
 * Universal interface representation.
 */
export interface UCEInterface {
  /** Discriminant for type narrowing */
  kind: "interface";
  /** Interface name */
  name: string;
  /** Generic type parameters */
  typeParams: UCETypeParameter[];
  /** Extended interface names */
  extends: string[];
  /** Interface properties */
  properties: UCEInterfaceProperty[];
  /** Interface method signatures */
  methods: UCEInterfaceMethod[];
  /** Source location */
  location: UCELocation;
  /** Applied modifiers */
  modifiers: UCEModifier[];
  /** JSDoc or documentation comment */
  docComment: string | null;
}

// =============================================================================
// Type Alias Entity
// =============================================================================

/**
 * Universal type alias representation.
 */
export interface UCETypeAlias {
  /** Discriminant for type narrowing */
  kind: "typeAlias";
  /** Type alias name */
  name: string;
  /** Generic type parameters */
  typeParams: UCETypeParameter[];
  /** Type definition as source text */
  typeDefinition: string;
  /** Source location */
  location: UCELocation;
  /** Applied modifiers */
  modifiers: UCEModifier[];
  /** JSDoc or documentation comment */
  docComment: string | null;
}

// =============================================================================
// Import/Export Entities
// =============================================================================

/**
 * Import specifier - individual imported symbol.
 */
export interface UCEImportSpecifier {
  /** Local name (how it's used in this file) */
  local: string;
  /** Imported name (original name from module) */
  imported: string;
  /** Import type */
  type: "named" | "default" | "namespace";
}

/**
 * Universal import statement representation.
 */
export interface UCEImport {
  /** Discriminant for type narrowing */
  kind: "import";
  /** Module specifier (import path) */
  source: string;
  /** Import specifiers */
  specifiers: UCEImportSpecifier[];
  /** Whether it's a type-only import */
  isTypeOnly: boolean;
  /** Whether it's a side-effect only import (no specifiers) */
  isSideEffect: boolean;
  /** Source location */
  location: UCELocation;
}

/**
 * Universal export statement representation.
 */
export interface UCEExport {
  /** Discriminant for type narrowing */
  kind: "export";
  /** Exported name (as seen by importers) */
  name: string;
  /** Local name (if different from exported name) */
  localName: string | null;
  /** Export type */
  type: "named" | "default" | "namespace" | "re-export";
  /** Re-exported from module (for re-exports) */
  source: string | null;
  /** Whether it's a type-only export */
  isTypeOnly: boolean;
  /** Source location */
  location: UCELocation;
}

// =============================================================================
// Variable Entity
// =============================================================================

/**
 * Universal variable/constant representation.
 * Covers: const, let, var declarations at module scope.
 */
export interface UCEVariable {
  /** Discriminant for type narrowing */
  kind: "variable";
  /** Variable name */
  name: string;
  /** Type annotation */
  type: string | null;
  /** Whether declared with const */
  isConst: boolean;
  /** Whether the variable is exported */
  isExported: boolean;
  /** Initial value as source text (null if not initialized) */
  initialValue: string | null;
  /** Source location */
  location: UCELocation;
  /** JSDoc or documentation comment */
  docComment: string | null;
}

// =============================================================================
// Parse Result Types
// =============================================================================

/**
 * Parse error encountered during parsing.
 */
export interface UCEParseError {
  /** Error message */
  message: string;
  /** Error location */
  location: UCELocation;
  /** Error severity */
  severity: "error" | "warning";
  /** Error code (parser-specific) */
  code?: string;
}

/**
 * Complete parsed file result.
 * This is what a language parser returns.
 */
export interface UCEFile {
  /** Absolute file path */
  filePath: string;
  /** Detected language */
  language: string;
  /** File-level functions */
  functions: UCEFunction[];
  /** Class definitions */
  classes: UCEClass[];
  /** Interface definitions */
  interfaces: UCEInterface[];
  /** Type alias definitions */
  typeAliases: UCETypeAlias[];
  /** Module-level variables */
  variables: UCEVariable[];
  /** Import statements */
  imports: UCEImport[];
  /** Export statements */
  exports: UCEExport[];
  /** Parse errors encountered */
  errors: UCEParseError[];
}

// =============================================================================
// Parser Interface
// =============================================================================

/**
 * Interface that all language parsers must implement.
 * Enables polyglot support without modifying the graph layer.
 */
export interface LanguageParser {
  /** Language identifier (e.g., "typescript", "python") */
  readonly language: string;

  /** File extensions this parser handles (e.g., [".ts", ".tsx"]) */
  readonly extensions: readonly string[];

  /**
   * Parse a source file into UCE format.
   *
   * @param filePath - Absolute path to the file
   * @param content - File content as string
   * @returns Parsed file in UCE format
   */
  parse(filePath: string, content: string): Promise<UCEFile>;

  /**
   * Check if this parser supports a given file.
   *
   * @param filePath - File path to check
   * @returns True if this parser can handle the file
   */
  supports(filePath: string): boolean;
}

// =============================================================================
// Union Types
// =============================================================================

/**
 * Any code entity that can be extracted from source code.
 */
export type UCEEntity =
  | UCEFunction
  | UCEClass
  | UCEInterface
  | UCETypeAlias
  | UCEVariable
  | UCEImport
  | UCEExport;

/**
 * Entity kind discriminant values.
 */
export type UCEEntityKind = UCEEntity["kind"];

/**
 * Entity Extraction Types
 *
 * CozoDB-native output structures optimized for batch insertion.
 * Instead of generic graph objects, we output arrays of rows that map
 * directly to CozoDB relations.
 *
 * Key Design Decisions:
 * 1. CozoBatch holds arrays of row tuples (not objects) for efficient :put operations
 * 2. Unresolved references are tracked separately for two-pass resolution
 * 3. Text chunks are extracted for later vector embedding
 *
 * @module
 */

// =============================================================================
// CozoDB Batch Types (Native Row Format)
// =============================================================================

/**
 * Row data for File relation.
 * Order matches schema: id, path, relative_path, extension, hash, size, last_modified, language, framework
 */
export type FileRow = [
  string,      // id
  string,      // path
  string,      // relative_path
  string,      // extension
  string,      // hash
  number,      // size
  number,      // last_modified (timestamp)
  string,      // language
  string | null // framework (nullable)
];

/**
 * Row data for Function relation.
 * Order matches schema: id, name, file_id, start_line, end_line, start_column, end_column,
 *                       signature, return_type, is_exported, is_async, is_generator,
 *                       complexity, parameter_count, doc_comment, business_logic, inference_confidence
 */
export type FunctionRow = [
  string,        // id
  string,        // name
  string,        // file_id
  number,        // start_line
  number,        // end_line
  number,        // start_column
  number,        // end_column
  string,        // signature
  string | null, // return_type (nullable)
  boolean,       // is_exported
  boolean,       // is_async
  boolean,       // is_generator
  number,        // complexity
  number,        // parameter_count
  string | null, // doc_comment (nullable)
  string | null, // business_logic (nullable) - text for embedding
  number | null  // inference_confidence (nullable)
];

/**
 * Row data for Class relation.
 * Order matches schema: id, name, file_id, start_line, end_line, is_abstract, is_exported,
 *                       extends_class, implements_interfaces, doc_comment
 */
export type ClassRow = [
  string,        // id
  string,        // name
  string,        // file_id
  number,        // start_line
  number,        // end_line
  boolean,       // is_abstract
  boolean,       // is_exported
  string | null, // extends_class (nullable)
  string[],      // implements_interfaces
  string | null  // doc_comment (nullable)
];

/**
 * Row data for Interface relation.
 * Order matches schema: id, name, file_id, start_line, end_line, is_exported,
 *                       extends_interfaces, doc_comment, properties
 */
export type InterfaceRow = [
  string,                           // id
  string,                           // name
  string,                           // file_id
  number,                           // start_line
  number,                           // end_line
  boolean,                          // is_exported
  string[],                         // extends_interfaces
  string | null,                    // doc_comment (nullable)
  string | null                     // properties (JSON string, nullable)
];

/**
 * Row data for TypeAlias relation.
 * Order matches schema: id, name, file_id, start_line, end_line, is_exported, type_definition, doc_comment
 */
export type TypeAliasRow = [
  string,        // id
  string,        // name
  string,        // file_id
  number,        // start_line
  number,        // end_line
  boolean,       // is_exported
  string,        // type_definition
  string | null  // doc_comment (nullable)
];

/**
 * Row data for Variable relation.
 * Order matches schema: id, name, file_id, line, column, variable_type, is_const, is_exported, scope
 */
export type VariableRow = [
  string,        // id
  string,        // name
  string,        // file_id
  number,        // line
  number,        // column
  string | null, // variable_type (nullable)
  boolean,       // is_const
  boolean,       // is_exported
  string         // scope
];

/**
 * Row data for GhostNode relation.
 * Order matches schema: id, name, package_name, entity_type, signature, is_external
 */
export type GhostNodeRow = [
  string,        // id
  string,        // name
  string,        // package_name
  string,        // entity_type ('function' | 'class' | 'interface' | 'type')
  string | null, // signature (nullable)
  boolean        // is_external
];

// =============================================================================
// Relationship Row Types
// =============================================================================

/**
 * Row data for CONTAINS relation.
 * Order: from_id, to_id, line_number
 */
export type ContainsRow = [string, string, number];

/**
 * Row data for CALLS relation (populated in Pass 2).
 * Order: from_id, to_id, line_number, is_direct_call, is_async
 */
export type CallsRow = [string, string, number, boolean, boolean];

/**
 * Row data for IMPORTS relation.
 * Order: from_id, to_id, imported_symbols, import_type, is_type_only
 */
export type ImportsRow = [string, string, string[], string, boolean];

/**
 * Row data for EXTENDS relation.
 * Order: from_id, to_id
 */
export type ExtendsRow = [string, string];

/**
 * Row data for IMPLEMENTS relation.
 * Order: from_id, to_id
 */
export type ImplementsRow = [string, string];

/**
 * Row data for EXTENDS_INTERFACE relation.
 * Order: from_id, to_id
 */
export type ExtendsInterfaceRow = [string, string];

/**
 * Row data for HAS_METHOD relation.
 * Order: from_id, to_id, visibility, is_static, is_abstract
 */
export type HasMethodRow = [string, string, string, boolean, boolean];

/**
 * Row data for USES_TYPE relation.
 * Order: from_id, to_id, context, parameter_name
 */
export type UsesTypeRow = [string, string, string, string | null];

/**
 * Row data for REFERENCES_EXTERNAL relation.
 * Order: from_id, to_id, context, line_number
 */
export type ReferencesExternalRow = [string, string, string, number];

// =============================================================================
// CozoBatch - Main Output Structure
// =============================================================================

/**
 * Batch of rows ready for CozoDB insertion.
 * Maps 1:1 to CozoDB relation schemas for efficient :put operations.
 *
 * Usage:
 * ```typescript
 * const batch = await pipeline.extract(uceFile);
 * for (const row of batch.function) {
 *   await db.execute(`?[...] <- [[...]] :put function {...}`);
 * }
 * ```
 */
export interface CozoBatch {
  // Node tables
  file: FileRow[];
  function: FunctionRow[];
  class: ClassRow[];
  interface: InterfaceRow[];
  typeAlias: TypeAliasRow[];
  variable: VariableRow[];
  ghostNode: GhostNodeRow[];

  // Relationship tables
  contains: ContainsRow[];
  calls: CallsRow[];
  imports: ImportsRow[];
  extends: ExtendsRow[];
  implements: ImplementsRow[];
  extendsInterface: ExtendsInterfaceRow[];
  hasMethod: HasMethodRow[];
  usesType: UsesTypeRow[];
  referencesExternal: ReferencesExternalRow[];
}

// =============================================================================
// Unresolved References (For Two-Pass Resolution)
// =============================================================================

/**
 * Unresolved function call - stored during Pass 1, resolved in Pass 2.
 */
export interface UnresolvedCall {
  /** ID of the calling function */
  callerId: string;
  /** Name of the function being called */
  calleeName: string;
  /** Module path if it's an imported call (e.g., './utils') */
  modulePath: string | null;
  /** Line where the call occurs */
  lineNumber: number;
  /** Whether it's a direct call or callback */
  isDirectCall: boolean;
  /** Whether the call is awaited */
  isAsync: boolean;
}

/**
 * Unresolved type reference - for USES_TYPE and EXTENDS relationships.
 */
export interface UnresolvedTypeRef {
  /** ID of the entity using the type */
  sourceId: string;
  /** Name of the referenced type */
  typeName: string;
  /** Context: 'parameter' | 'return' | 'variable' | 'extends' | 'implements' */
  context: string;
  /** Parameter name if context is 'parameter' */
  parameterName: string | null;
}

// =============================================================================
// Embedding Preparation
// =============================================================================

/**
 * Text chunk prepared for vector embedding.
 * Extracted during Pass 1, embedded asynchronously by background worker.
 */
export interface EmbeddingChunk {
  /** Entity ID this embedding belongs to */
  entityId: string;
  /** Entity type (function, class, etc.) */
  entityType: string;
  /** Text content to embed */
  text: string;
  /** Metadata for context */
  metadata: {
    name: string;
    filePath: string;
    signature?: string;
  };
}

// =============================================================================
// Extraction Result
// =============================================================================

/**
 * Extraction error encountered during processing.
 */
export interface ExtractionError {
  /** Entity kind that failed */
  kind: string;
  /** Entity name */
  name: string;
  /** Error message */
  error: string;
  /** Location if available */
  location?: {
    line: number;
    column: number;
  };
}

/**
 * Result of extracting entities from a single file.
 */
export interface ExtractionResult {
  /** Generated file ID */
  fileId: string;
  /** Original file path */
  filePath: string;
  /** Batch of rows ready for CozoDB insertion */
  batch: CozoBatch;
  /** Unresolved calls for Pass 2 linking */
  unresolvedCalls: UnresolvedCall[];
  /** Unresolved type references for Pass 2 linking */
  unresolvedTypes: UnresolvedTypeRef[];
  /** Text chunks for vector embedding */
  embeddingChunks: EmbeddingChunk[];
  /** Extraction errors */
  errors: ExtractionError[];
  /** Statistics */
  stats: ExtractionStats;
}

/**
 * Extraction statistics for a file.
 */
export interface ExtractionStats {
  functions: number;
  classes: number;
  interfaces: number;
  typeAliases: number;
  variables: number;
  imports: number;
  exports: number;
  ghostNodes: number;
}

// =============================================================================
// Symbol Registry (For Pass 2 Resolution)
// =============================================================================

/**
 * Registry of all known symbols across the project.
 * Built during Pass 1, used in Pass 2 for call/type resolution.
 */
export interface SymbolRegistry {
  /** Map of qualified name -> entity ID */
  functions: Map<string, string>;
  /** Map of class name -> entity ID */
  classes: Map<string, string>;
  /** Map of interface name -> entity ID */
  interfaces: Map<string, string>;
  /** Map of type alias name -> entity ID */
  typeAliases: Map<string, string>;
  /** Map of file path -> file ID */
  files: Map<string, string>;
  /** Map of export name -> entity ID (for cross-file resolution) */
  exports: Map<string, { fileId: string; entityId: string; kind: string }>;
}

/**
 * Creates an empty CozoBatch.
 */
export function createEmptyBatch(): CozoBatch {
  return {
    file: [],
    function: [],
    class: [],
    interface: [],
    typeAlias: [],
    variable: [],
    ghostNode: [],
    contains: [],
    calls: [],
    imports: [],
    extends: [],
    implements: [],
    extendsInterface: [],
    hasMethod: [],
    usesType: [],
    referencesExternal: [],
  };
}

/**
 * Creates an empty symbol registry.
 */
export function createEmptyRegistry(): SymbolRegistry {
  return {
    functions: new Map(),
    classes: new Map(),
    interfaces: new Map(),
    typeAliases: new Map(),
    files: new Map(),
    exports: new Map(),
  };
}

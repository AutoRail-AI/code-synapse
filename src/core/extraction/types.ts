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
 * Order: from_id, to_id, line_number, is_direct_call, is_await
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
// Enhanced Entity Semantics Row Types (Phase 1)
// =============================================================================

/**
 * Row data for FunctionParameterSemantics relation.
 * Order matches schema: id, function_id, param_name, param_index, param_type, purpose,
 *                       is_optional, is_rest, is_destructured, default_value,
 *                       validation_rules, used_in_expressions, is_mutated, accessed_at_lines,
 *                       confidence, analyzed_at
 */
export type ParameterSemanticsRow = [
  string,        // id
  string,        // function_id
  string,        // param_name
  number,        // param_index
  string | null, // param_type (nullable)
  string,        // purpose
  boolean,       // is_optional
  boolean,       // is_rest
  boolean,       // is_destructured
  string | null, // default_value (nullable)
  string,        // validation_rules (JSON array)
  string,        // used_in_expressions (JSON array)
  boolean,       // is_mutated
  string,        // accessed_at_lines (JSON array)
  number,        // confidence
  number         // analyzed_at (timestamp)
];

/**
 * Row data for FunctionReturnSemantics relation.
 * Order matches schema: id, function_id, declared_type, inferred_type, return_points,
 *                       possible_values, null_conditions, error_conditions, derived_from,
 *                       transformations, can_return_void, always_throws, confidence, analyzed_at
 */
export type ReturnSemanticsRow = [
  string,        // id
  string,        // function_id
  string | null, // declared_type (nullable)
  string | null, // inferred_type (nullable)
  string,        // return_points (JSON array)
  string,        // possible_values (JSON array)
  string,        // null_conditions (JSON array)
  string,        // error_conditions (JSON array)
  string,        // derived_from (JSON array)
  string,        // transformations (JSON array)
  boolean,       // can_return_void
  boolean,       // always_throws
  number,        // confidence
  number         // analyzed_at (timestamp)
];

/**
 * Row data for ErrorPath relation.
 * Order matches schema: id, function_id, error_type, condition, is_handled,
 *                       handling_strategy, recovery_action, propagates_to,
 *                       source_location, stack_context, confidence, analyzed_at
 */
export type ErrorPathRow = [
  string,        // id
  string,        // function_id
  string,        // error_type
  string | null, // condition (nullable)
  boolean,       // is_handled
  string | null, // handling_strategy (nullable)
  string | null, // recovery_action (nullable)
  string,        // propagates_to (JSON array)
  string,        // source_location (JSON object)
  string,        // stack_context (JSON array)
  number,        // confidence
  number         // analyzed_at (timestamp)
];

/**
 * Row data for FunctionErrorAnalysis relation.
 * Order matches schema: id, function_id, throw_points, try_catch_blocks,
 *                       never_throws, has_top_level_catch, escaping_error_types,
 *                       confidence, analyzed_at
 */
export type ErrorAnalysisRow = [
  string,  // id
  string,  // function_id
  string,  // throw_points (JSON array)
  string,  // try_catch_blocks (JSON array)
  boolean, // never_throws
  boolean, // has_top_level_catch
  string,  // escaping_error_types (JSON array)
  number,  // confidence
  number   // analyzed_at (timestamp)
];

// =============================================================================
// Data Flow Analysis Row Types (Phase 2)
// =============================================================================

/**
 * Row data for DataFlowCache relation.
 * Order matches schema: id, function_id, file_id, file_hash, node_count, edge_count,
 *                       has_side_effects, accesses_external_state, is_pure,
 *                       inputs_affecting_output, flow_summary_json, full_graph_json,
 *                       taint_flows_json, confidence, computed_at, access_count, last_accessed_at
 */
export type DataFlowCacheRow = [
  string,        // id
  string,        // function_id
  string,        // file_id
  string,        // file_hash
  number,        // node_count
  number,        // edge_count
  boolean,       // has_side_effects
  boolean,       // accesses_external_state
  boolean,       // is_pure
  string,        // inputs_affecting_output (JSON array)
  string,        // flow_summary_json (JSON object)
  string,        // full_graph_json (JSON object)
  string | null, // taint_flows_json (JSON array, nullable)
  number,        // confidence
  number,        // computed_at (timestamp)
  number,        // access_count
  number | null  // last_accessed_at (timestamp, nullable)
];

/**
 * Row data for DataFlowNode relation.
 * Order matches schema: id, function_id, kind, name, line, column,
 *                       inferred_type, is_tainted, taint_source
 */
export type DataFlowNodeRow = [
  string,        // id
  string,        // function_id
  string,        // kind
  string,        // name
  number,        // line
  number,        // column
  string | null, // inferred_type (nullable)
  boolean,       // is_tainted
  string | null  // taint_source (nullable)
];

/**
 * Row data for CrossFunctionFlow relation.
 * Order matches schema: id, caller_id, callee_id, call_site_line,
 *                       arguments_json, return_usage_json, propagates_taint,
 *                       tainted_arguments, confidence, analyzed_at
 */
export type CrossFunctionFlowRow = [
  string,        // id
  string,        // caller_id
  string,        // callee_id
  number,        // call_site_line
  string,        // arguments_json (JSON array)
  string | null, // return_usage_json (JSON object, nullable)
  boolean,       // propagates_taint
  string,        // tainted_arguments (JSON array)
  number,        // confidence
  number         // analyzed_at (timestamp)
];

/**
 * Row data for TaintSource relation.
 * Order matches schema: id, function_id, source_category, node_id,
 *                       description, line, is_sanitized, sanitization_point, discovered_at
 */
export type TaintSourceRow = [
  string,        // id
  string,        // function_id
  string,        // source_category
  string,        // node_id
  string,        // description
  number,        // line
  boolean,       // is_sanitized
  string | null, // sanitization_point (nullable)
  number         // discovered_at (timestamp)
];

/**
 * Row data for DATA_FLOWS_TO relation.
 * Order: from_id, to_id, edge_kind, transformation, condition, line_number, propagates_taint
 */
export type DataFlowsToRow = [
  string,        // from_id
  string,        // to_id
  string,        // edge_kind
  string | null, // transformation (nullable)
  string | null, // condition (nullable)
  number,        // line_number
  boolean        // propagates_taint
];

/**
 * Row data for HAS_CROSS_FLOW relation.
 * Order: from_id, to_id, role
 */
export type HasCrossFlowRow = [string, string, string];

/**
 * Row data for TAINT_FLOWS_TO relation.
 * Order: from_id, to_id, path_length, is_sanitized
 */
export type TaintFlowsToRow = [string, string, number, boolean];

// =============================================================================
// Side-Effect Analysis Row Types (Phase 3)
// =============================================================================

/**
 * Row data for SideEffect relation.
 * Order matches schema: id, function_id, file_path, category, description, target,
 *                       api_call, is_conditional, condition, confidence,
 *                       evidence_json, source_line, source_column, analyzed_at
 */
export type SideEffectRow = [
  string,        // id
  string,        // function_id
  string,        // file_path
  string,        // category
  string,        // description
  string | null, // target (nullable)
  string,        // api_call
  boolean,       // is_conditional
  string | null, // condition (nullable)
  string,        // confidence ('high' | 'medium' | 'low')
  string,        // evidence_json (JSON array)
  number,        // source_line
  number,        // source_column
  number         // analyzed_at (timestamp)
];

/**
 * Row data for FunctionSideEffectSummary relation.
 * Order matches schema: function_id, file_path, total_count, is_pure,
 *                       all_conditional, primary_categories_json, risk_level,
 *                       confidence, analyzed_at
 */
export type SideEffectSummaryRow = [
  string,  // function_id
  string,  // file_path
  number,  // total_count
  boolean, // is_pure
  boolean, // all_conditional
  string,  // primary_categories_json (JSON array)
  string,  // risk_level ('low' | 'medium' | 'high')
  number,  // confidence
  number   // analyzed_at (timestamp)
];

/**
 * Row data for HAS_SIDE_EFFECT relation.
 * Order: from_id (function_id), to_id (side_effect_id)
 */
export type HasSideEffectRow = [string, string];

/**
 * Row data for HAS_SIDE_EFFECT_SUMMARY relation.
 * Order: from_id (function_id), to_id (function_id - same as summary primary key)
 */
export type HasSideEffectSummaryRow = [string, string];

// =============================================================================
// Design Pattern Detection Row Types (Phase 4)
// =============================================================================

/**
 * Row data for DesignPattern relation.
 * Order matches schema: id, pattern_type, name, confidence, confidence_level,
 *                       evidence_json, file_paths_json, description, detected_at
 */
export type DesignPatternRow = [
  string,        // id
  string,        // pattern_type
  string,        // name
  number,        // confidence
  string,        // confidence_level ('high' | 'medium' | 'low')
  string,        // evidence_json (JSON array)
  string,        // file_paths_json (JSON array)
  string | null, // description (nullable)
  number         // detected_at (timestamp)
];

/**
 * Row data for PatternParticipant relation.
 * Order matches schema: id, pattern_id, entity_id, role, entity_type, entity_name,
 *                       file_path, evidence_json
 */
export type PatternParticipantRow = [
  string, // id
  string, // pattern_id
  string, // entity_id
  string, // role
  string, // entity_type ('class' | 'function' | 'interface' | 'variable' | 'method')
  string, // entity_name
  string, // file_path
  string  // evidence_json (JSON array)
];

/**
 * Row data for HAS_PATTERN relation.
 * Order: from_id (entity_id), to_id (pattern_id), role
 */
export type HasPatternRow = [string, string, string];

/**
 * Row data for PATTERN_HAS_PARTICIPANT relation.
 * Order: from_id (pattern_id), to_id (participant_id)
 */
export type PatternHasParticipantRow = [string, string];

// =============================================================================
// Entity Embeddings (Hybrid Search Phase 1)
// =============================================================================

/**
 * Row data for entity_embedding relation.
 * Order matches schema: entity_id, file_id, vector, text_hash, model, created_at
 * Used for semantic (vector) search across all embeddable entity types.
 */
export type EntityEmbeddingRow = [
  string, // entity_id
  string, // file_id
  number[], // vector (384-dim for all-MiniLM-L6-v2)
  string, // text_hash (for re-embedding detection)
  string, // model
  number // created_at (timestamp)
];

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

  // Enhanced Entity Semantics tables (Phase 1)
  parameterSemantics: ParameterSemanticsRow[];
  returnSemantics: ReturnSemanticsRow[];
  errorPaths: ErrorPathRow[];
  errorAnalysis: ErrorAnalysisRow[];

  // Data Flow Analysis tables (Phase 2)
  dataFlowCache: DataFlowCacheRow[];
  dataFlowNodes: DataFlowNodeRow[];
  crossFunctionFlows: CrossFunctionFlowRow[];
  taintSources: TaintSourceRow[];
  dataFlowsTo: DataFlowsToRow[];
  hasCrossFlow: HasCrossFlowRow[];
  taintFlowsTo: TaintFlowsToRow[];

  // Side-Effect Analysis tables (Phase 3)
  sideEffects: SideEffectRow[];
  sideEffectSummaries: SideEffectSummaryRow[];
  hasSideEffect: HasSideEffectRow[];
  hasSideEffectSummary: HasSideEffectSummaryRow[];

  // Design Pattern Detection tables (Phase 4)
  designPatterns: DesignPatternRow[];
  patternParticipants: PatternParticipantRow[];
  hasPattern: HasPatternRow[];
  patternHasParticipant: PatternHasParticipantRow[];

  // Entity embeddings for semantic search (Hybrid Search Phase 1)
  entityEmbeddings: EntityEmbeddingRow[];
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
    // Enhanced Entity Semantics (Phase 1)
    parameterSemantics: [],
    returnSemantics: [],
    errorPaths: [],
    errorAnalysis: [],
    // Data Flow Analysis (Phase 2)
    dataFlowCache: [],
    dataFlowNodes: [],
    crossFunctionFlows: [],
    taintSources: [],
    dataFlowsTo: [],
    hasCrossFlow: [],
    taintFlowsTo: [],
    // Side-Effect Analysis (Phase 3)
    sideEffects: [],
    sideEffectSummaries: [],
    hasSideEffect: [],
    hasSideEffectSummary: [],
    // Design Pattern Detection (Phase 4)
    designPatterns: [],
    patternParticipants: [],
    hasPattern: [],
    patternHasParticipant: [],
    // Entity embeddings (Hybrid Search Phase 1)
    entityEmbeddings: [],
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

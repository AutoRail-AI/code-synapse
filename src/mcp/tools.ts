/**
 * MCP Tool Definitions
 *
 * Defines the tools exposed by the MCP server for AI agents to query the knowledge graph.
 *
 * @module
 */

import type { GraphDatabase } from "../core/graph/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("mcp-tools");

// =============================================================================
// Tool Input Types
// =============================================================================

export interface SearchCodeInput {
  /** Search query string */
  query: string;
  /** Maximum number of results (default: 10) */
  limit?: number;
  /** Filter by entity type */
  entityType?: "function" | "class" | "interface" | "variable" | "file";
}

export interface GetFunctionInput {
  /** Function name to find */
  name: string;
  /** Optional file path to narrow search */
  filePath?: string;
}

export interface GetClassInput {
  /** Class name to find */
  name: string;
  /** Optional file path to narrow search */
  filePath?: string;
}

export interface GetFileSymbolsInput {
  /** File path (relative or absolute) */
  filePath: string;
}

export interface GetCallersInput {
  /** Function name or ID */
  functionName: string;
}

export interface GetCalleesInput {
  /** Function name or ID */
  functionName: string;
}

export interface GetDependenciesInput {
  /** File path to get dependencies for */
  filePath: string;
}

// =============================================================================
// Tool Output Types
// =============================================================================

export interface SearchResult {
  id: string;
  name: string;
  type: string;
  filePath?: string;
  line?: number;
  signature?: string;
  docComment?: string;
  // Enrichment fields (optional for backward compat)
  entityType?: string;
  entityId?: string;
  source?: "semantic" | "lexical" | "both";
  justification?: {
    purposeSummary?: string;
    featureContext?: string;
    businessValue?: string;
    confidence?: number;
  } | null;
  patterns?: string[];
  classification?: {
    category?: string;
    subCategory?: string;
  } | null;
}

export interface FunctionDetails {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  returnType?: string;
  isExported: boolean;
  isAsync: boolean;
  docComment?: string;
  complexity?: number;
  callers: Array<{ name: string; filePath: string; line: number }>;
  callees: Array<{ name: string; filePath: string; line: number }>;
  /** Business justification for this function */
  justification?: {
    purposeSummary: string;
    featureArea?: string;
    confidence: number;
  };
}

export interface ClassDetails {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  isAbstract: boolean;
  extendsClass?: string;
  implementsInterfaces: string[];
  docComment?: string;
  methods: Array<{ name: string; signature: string; visibility: string }>;
  /** Business justification for this class */
  justification?: {
    purposeSummary: string;
    featureArea?: string;
    confidence: number;
  };
}

export interface FileSymbols {
  filePath: string;
  functions: Array<{ name: string; line: number; signature: string }>;
  classes: Array<{ name: string; line: number }>;
  interfaces: Array<{ name: string; line: number }>;
  variables: Array<{ name: string; line: number; isConst: boolean }>;
}

export interface FileDependency {
  filePath: string;
  imports: Array<{ from: string; symbols: string[] }>;
  importedBy: Array<{ from: string; symbols: string[] }>;
}

// =============================================================================
// Tool Handlers
// =============================================================================

/**
 * Search for code entities (functions, classes, interfaces, etc.)
 * When hybridSearchService is available (via context), delegates to it for
 * entity-level results with justification, patterns, and enriched snippets.
 * Falls back to CozoDB substring search otherwise.
 */
export async function searchCode(
  store: GraphDatabase,
  input: SearchCodeInput,
  context?: ToolContext
): Promise<SearchResult[]> {
  const { query, limit = 10, entityType } = input;
  logger.debug({ query, limit, entityType }, "Searching code");

  // Hybrid-first: delegate to HybridSearchService when available
  if (context?.hybridSearchService) {
    try {
      const hybridResults = await context.hybridSearchService.searchWithJustification(query, {
        limit,
        enrichWithJustification: true,
        enableSynthesis: false,
      });

      // Map HybridSearchResult[] → SearchResult[] with enrichment
      const mapped: SearchResult[] = hybridResults
        .filter((r) => !entityType || r.entityType === entityType)
        .map((r) => ({
          id: r.entityId || r.filePath,
          name: r.name || r.filePath.split("/").pop() || r.filePath,
          type: r.entityType || "file",
          filePath: r.filePath,
          line: r.lineNumber,
          snippet: r.snippet,
          entityType: r.entityType,
          entityId: r.entityId,
          source: r.source,
          justification: r.justification
            ? {
                purposeSummary: r.justification.purposeSummary,
                featureContext: r.justification.featureContext,
                businessValue: r.justification.businessValue,
                confidence: r.justification.confidence,
              }
            : null,
          patterns: r.patterns,
          classification: null,
        }));

      return mapped.slice(0, limit);
    } catch (err) {
      logger.warn({ err }, "Hybrid search failed, falling back to CozoDB search");
    }
  }

  // Fallback: CozoDB substring search
  return searchCodeFallback(store, input);
}

/**
 * Fallback CozoDB substring search (original implementation).
 */
async function searchCodeFallback(
  store: GraphDatabase,
  input: SearchCodeInput
): Promise<SearchResult[]> {
  const { query, limit = 10, entityType } = input;
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  if (!entityType || entityType === "function") {
    const funcQuery = `
      ?[id, name, file_path, start_line, signature, doc_comment] :=
        *function{id, name, file_id, start_line, signature, doc_comment},
        *file{id: file_id, path: file_path}
      :limit $limit
    `;
    try {
      const funcResult = await store.query<{
        id: string;
        name: string;
        file_path: string;
        start_line: number;
        signature: string;
        doc_comment: string;
      }>(funcQuery, { limit: limit * 10 });
      for (const row of funcResult) {
        if (row.name.toLowerCase().includes(lowerQuery)) {
          results.push({
            id: row.id,
            name: row.name,
            type: "function",
            filePath: row.file_path,
            line: row.start_line,
            signature: row.signature,
            docComment: row.doc_comment,
          });
        }
      }
    } catch (e) {
      logger.debug({ error: e }, "Function search failed");
    }
  }

  if (!entityType || entityType === "class") {
    const classQuery = `
      ?[id, name, file_path, start_line, doc_comment] :=
        *class{id, name, file_id, start_line, doc_comment},
        *file{id: file_id, path: file_path}
      :limit $limit
    `;
    try {
      const classResult = await store.query<{
        id: string;
        name: string;
        file_path: string;
        start_line: number;
        doc_comment: string;
      }>(classQuery, { limit: limit * 10 });
      for (const row of classResult) {
        if (row.name.toLowerCase().includes(lowerQuery)) {
          results.push({
            id: row.id,
            name: row.name,
            type: "class",
            filePath: row.file_path,
            line: row.start_line,
            docComment: row.doc_comment,
          });
        }
      }
    } catch (e) {
      logger.debug({ error: e }, "Class search failed");
    }
  }

  if (!entityType || entityType === "interface") {
    const ifaceQuery = `
      ?[id, name, file_path, start_line, doc_comment] :=
        *interface{id, name, file_id, start_line, doc_comment},
        *file{id: file_id, path: file_path}
      :limit $limit
    `;
    try {
      const ifaceResult = await store.query<{
        id: string;
        name: string;
        file_path: string;
        start_line: number;
        doc_comment: string;
      }>(ifaceQuery, { limit: limit * 10 });
      for (const row of ifaceResult) {
        if (row.name.toLowerCase().includes(lowerQuery)) {
          results.push({
            id: row.id,
            name: row.name,
            type: "interface",
            filePath: row.file_path,
            line: row.start_line,
            docComment: row.doc_comment,
          });
        }
      }
    } catch (e) {
      logger.debug({ error: e }, "Interface search failed");
    }
  }

  if (!entityType || entityType === "variable") {
    const varQuery = `
      ?[id, name, file_path, line] :=
        *variable{id, name, file_id, line},
        *file{id: file_id, path: file_path}
      :limit $limit
    `;
    try {
      const varResult = await store.query<{
        id: string;
        name: string;
        file_path: string;
        line: number;
      }>(varQuery, { limit: limit * 10 });
      for (const row of varResult) {
        if (row.name.toLowerCase().includes(lowerQuery)) {
          results.push({
            id: row.id,
            name: row.name,
            type: "variable",
            filePath: row.file_path,
            line: row.line,
          });
        }
      }
    } catch (e) {
      logger.debug({ error: e }, "Variable search failed");
    }
  }

  if (!entityType || entityType === "file") {
    const fileQuery = `
      ?[id, path] :=
        *file{id, path}
      :limit $limit
    `;
    try {
      const fileResult = await store.query<{
        id: string;
        path: string;
      }>(fileQuery, { limit: limit * 10 });
      for (const row of fileResult) {
        if (row.path.toLowerCase().includes(lowerQuery)) {
          results.push({
            id: row.id,
            name: row.path,
            type: "file",
            filePath: row.path,
          });
        }
      }
    } catch (e) {
      logger.debug({ error: e }, "File search failed");
    }
  }

  return results.slice(0, limit);
}

/**
 * Get detailed information about a function
 */
export async function getFunction(
  store: GraphDatabase,
  input: GetFunctionInput
): Promise<FunctionDetails | null> {
  const { name, filePath } = input;
  logger.debug({ name, filePath }, "Getting function details");

  // Find the function
  let funcQuery: string;
  let params: Record<string, unknown>;

  if (filePath) {
    funcQuery = `
      ?[id, name, file_path, start_line, end_line, signature, return_type, is_exported, is_async, doc_comment, complexity] :=
        *function{id, name, file_id, start_line, end_line, signature, return_type, is_exported, is_async, doc_comment, complexity},
        *file{id: file_id, path: file_path},
        name = $name,
        ends_with(file_path, $filePath)
      :limit 1
    `;
    params = { name, filePath };
  } else {
    funcQuery = `
      ?[id, name, file_path, start_line, end_line, signature, return_type, is_exported, is_async, doc_comment, complexity] :=
        *function{id, name, file_id, start_line, end_line, signature, return_type, is_exported, is_async, doc_comment, complexity},
        *file{id: file_id, path: file_path},
        name = $name
      :limit 1
    `;
    params = { name };
  }

  interface FunctionRow {
    id: string;
    name: string;
    file_path: string;
    start_line: number;
    end_line: number;
    signature: string;
    return_type: string;
    is_exported: boolean;
    is_async: boolean;
    doc_comment: string;
    complexity: number;
  }

  const funcResult = await store.query<FunctionRow>(funcQuery, params);
  if (funcResult.length === 0) {
    return null;
  }

  const func = funcResult[0]!;

  // Get callers
  const callersQuery = `
    ?[caller_name, caller_file, line_number] :=
      *calls{from_id, to_id, line_number},
      *function{id: from_id, name: caller_name, file_id: caller_file_id},
      *function{id: to_id, name: $name},
      *file{id: caller_file_id, path: caller_file}
  `;
  const callersResult = await store.query<{
    caller_name: string;
    caller_file: string;
    line_number: number;
  }>(callersQuery, { name });
  const callers = callersResult.map((r) => ({
    name: r.caller_name,
    filePath: r.caller_file,
    line: r.line_number,
  }));

  // Get callees
  const calleesQuery = `
    ?[callee_name, callee_file, line_number] :=
      *calls{from_id, to_id, line_number},
      *function{id: from_id, name: $name},
      *function{id: to_id, name: callee_name, file_id: callee_file_id},
      *file{id: callee_file_id, path: callee_file}
  `;
  const calleesResult = await store.query<{
    callee_name: string;
    callee_file: string;
    line_number: number;
  }>(calleesQuery, { name });
  const callees = calleesResult.map((r) => ({
    name: r.callee_name,
    filePath: r.callee_file,
    line: r.line_number,
  }));

  // Query justification for this function
  let justification: FunctionDetails["justification"] | undefined;
  try {
    const justQuery = `
      ?[purpose_summary, feature_area, confidence_score] :=
        *justification{entity_id, purpose_summary, feature_area, confidence_score},
        entity_id = $entityId
      :limit 1
    `;
    const justResult = await store.query<{
      purpose_summary: string;
      feature_area: string;
      confidence_score: number;
    }>(justQuery, { entityId: func.id });

    if (justResult.length > 0) {
      const just = justResult[0]!;
      justification = {
        purposeSummary: just.purpose_summary,
        featureArea: just.feature_area || undefined,
        confidence: just.confidence_score,
      };
      logger.debug({ functionId: func.id }, "Found justification for function");
    } else {
      logger.debug({ functionId: func.id }, "No justification found for function");
    }
  } catch (e) {
    logger.warn({ error: e, functionId: func.id }, "Failed to query justification for function");
  }

  return {
    id: func.id,
    name: func.name,
    filePath: func.file_path,
    startLine: func.start_line,
    endLine: func.end_line,
    signature: func.signature,
    returnType: func.return_type,
    isExported: func.is_exported,
    isAsync: func.is_async,
    docComment: func.doc_comment,
    complexity: func.complexity,
    callers,
    callees,
    justification,
  };
}

/**
 * Get detailed information about a class
 */
export async function getClass(
  store: GraphDatabase,
  input: GetClassInput
): Promise<ClassDetails | null> {
  const { name, filePath } = input;
  logger.debug({ name, filePath }, "Getting class details");

  let classQuery: string;
  let params: Record<string, unknown>;

  if (filePath) {
    classQuery = `
      ?[id, name, file_path, start_line, end_line, is_exported, is_abstract, extends_class, implements_interfaces, doc_comment] :=
        *class{id, name, file_id, start_line, end_line, is_exported, is_abstract, extends_class, implements_interfaces, doc_comment},
        *file{id: file_id, path: file_path},
        name = $name,
        ends_with(file_path, $filePath)
      :limit 1
    `;
    params = { name, filePath };
  } else {
    classQuery = `
      ?[id, name, file_path, start_line, end_line, is_exported, is_abstract, extends_class, implements_interfaces, doc_comment] :=
        *class{id, name, file_id, start_line, end_line, is_exported, is_abstract, extends_class, implements_interfaces, doc_comment},
        *file{id: file_id, path: file_path},
        name = $name
      :limit 1
    `;
    params = { name };
  }

  interface ClassRow {
    id: string;
    name: string;
    file_path: string;
    start_line: number;
    end_line: number;
    is_exported: boolean;
    is_abstract: boolean;
    extends_class: string;
    implements_interfaces: string[];
    doc_comment: string;
  }

  const classResult = await store.query<ClassRow>(classQuery, params);
  if (classResult.length === 0) {
    return null;
  }

  const cls = classResult[0]!;

  // Get methods
  const methodsQuery = `
    ?[method_name, signature, visibility] :=
      *has_method{from_id, to_id, visibility},
      *class{id: from_id, name: $name},
      *function{id: to_id, name: method_name, signature}
  `;
  const methodsResult = await store.query<{
    method_name: string;
    signature: string;
    visibility: string;
  }>(methodsQuery, { name });
  const methods = methodsResult.map((r) => ({
    name: r.method_name,
    signature: r.signature,
    visibility: r.visibility,
  }));

  // Query justification for this class
  let justification: ClassDetails["justification"] | undefined;
  try {
    const justQuery = `
      ?[purpose_summary, feature_area, confidence_score] :=
        *justification{entity_id, purpose_summary, feature_area, confidence_score},
        entity_id = $entityId
      :limit 1
    `;
    const justResult = await store.query<{
      purpose_summary: string;
      feature_area: string;
      confidence_score: number;
    }>(justQuery, { entityId: cls.id });

    if (justResult.length > 0) {
      const just = justResult[0]!;
      justification = {
        purposeSummary: just.purpose_summary,
        featureArea: just.feature_area || undefined,
        confidence: just.confidence_score,
      };
      logger.debug({ classId: cls.id }, "Found justification for class");
    } else {
      logger.debug({ classId: cls.id }, "No justification found for class");
    }
  } catch (e) {
    logger.warn({ error: e, classId: cls.id }, "Failed to query justification for class");
  }

  return {
    id: cls.id,
    name: cls.name,
    filePath: cls.file_path,
    startLine: cls.start_line,
    endLine: cls.end_line,
    isExported: cls.is_exported,
    isAbstract: cls.is_abstract,
    extendsClass: cls.extends_class,
    implementsInterfaces: cls.implements_interfaces || [],
    docComment: cls.doc_comment,
    methods,
    justification,
  };
}

/**
 * Get all symbols in a file
 */
export async function getFileSymbols(
  store: GraphDatabase,
  input: GetFileSymbolsInput
): Promise<FileSymbols | null> {
  const { filePath } = input;
  logger.debug({ filePath }, "Getting file symbols");

  // Find the file
  const fileQuery = `
    ?[id, path] :=
      *file{id, path},
      ends_with(path, $filePath)
    :limit 1
  `;
  const fileResult = await store.query<{ id: string; path: string }>(fileQuery, { filePath });
  if (fileResult.length === 0) {
    return null;
  }

  const file = fileResult[0]!;

  // Get functions in file
  const functionsQuery = `
    ?[name, start_line, signature] :=
      *contains{from_id: $fileId, to_id: func_id},
      *function{id: func_id, name, start_line, signature}
  `;
  const functionsResult = await store.query<{
    name: string;
    start_line: number;
    signature: string;
  }>(functionsQuery, { fileId: file.id });
  const functions = functionsResult.map((r) => ({
    name: r.name,
    line: r.start_line,
    signature: r.signature,
  }));

  // Get classes in file
  const classesQuery = `
    ?[name, start_line] :=
      *contains{from_id: $fileId, to_id: class_id},
      *class{id: class_id, name, start_line}
  `;
  const classesResult = await store.query<{ name: string; start_line: number }>(classesQuery, {
    fileId: file.id,
  });
  const classes = classesResult.map((r) => ({
    name: r.name,
    line: r.start_line,
  }));

  // Get interfaces in file
  const interfacesQuery = `
    ?[name, start_line] :=
      *contains{from_id: $fileId, to_id: iface_id},
      *interface{id: iface_id, name, start_line}
  `;
  const interfacesResult = await store.query<{ name: string; start_line: number }>(
    interfacesQuery,
    { fileId: file.id }
  );
  const interfaces = interfacesResult.map((r) => ({
    name: r.name,
    line: r.start_line,
  }));

  // Get variables in file
  const variablesQuery = `
    ?[name, line, is_const] :=
      *contains{from_id: $fileId, to_id: var_id},
      *variable{id: var_id, name, line, is_const}
  `;
  const variablesResult = await store.query<{ name: string; line: number; is_const: boolean }>(
    variablesQuery,
    { fileId: file.id }
  );
  const variables = variablesResult.map((r) => ({
    name: r.name,
    line: r.line,
    isConst: r.is_const,
  }));

  return {
    filePath: file.path,
    functions,
    classes,
    interfaces,
    variables,
  };
}

/**
 * Get all callers of a function
 */
export async function getCallers(
  store: GraphDatabase,
  input: GetCallersInput
): Promise<Array<{ name: string; filePath: string; line: number }>> {
  const { functionName } = input;
  logger.debug({ functionName }, "Getting callers");

  const query = `
    ?[caller_name, caller_file, line_number] :=
      *calls{from_id, to_id, line_number},
      *function{id: from_id, name: caller_name, file_id: caller_file_id},
      *function{id: to_id, name: $functionName},
      *file{id: caller_file_id, path: caller_file}
  `;

  const result = await store.query<{
    caller_name: string;
    caller_file: string;
    line_number: number;
  }>(query, { functionName });
  return result.map((r) => ({
    name: r.caller_name,
    filePath: r.caller_file,
    line: r.line_number,
  }));
}

/**
 * Get all functions called by a function
 */
export async function getCallees(
  store: GraphDatabase,
  input: GetCalleesInput
): Promise<Array<{ name: string; filePath: string; line: number }>> {
  const { functionName } = input;
  logger.debug({ functionName }, "Getting callees");

  const query = `
    ?[callee_name, callee_file, line_number] :=
      *calls{from_id, to_id, line_number},
      *function{id: from_id, name: $functionName},
      *function{id: to_id, name: callee_name, file_id: callee_file_id},
      *file{id: callee_file_id, path: callee_file}
  `;

  const result = await store.query<{
    callee_name: string;
    callee_file: string;
    line_number: number;
  }>(query, { functionName });
  return result.map((r) => ({
    name: r.callee_name,
    filePath: r.callee_file,
    line: r.line_number,
  }));
}

/**
 * Get file dependencies (imports and imported by)
 */
export async function getDependencies(
  store: GraphDatabase,
  input: GetDependenciesInput
): Promise<FileDependency | null> {
  const { filePath } = input;
  logger.debug({ filePath }, "Getting dependencies");

  // Find the file
  const fileQuery = `
    ?[id, path] :=
      *file{id, path},
      ends_with(path, $filePath)
    :limit 1
  `;
  const fileResult = await store.query<{ id: string; path: string }>(fileQuery, { filePath });
  if (fileResult.length === 0) {
    return null;
  }

  const file = fileResult[0]!;

  // Get imports (what this file imports)
  const importsQuery = `
    ?[from_path, imported_symbols] :=
      *imports{from_id: $fileId, to_id, imported_symbols},
      *file{id: to_id, path: from_path}
  `;
  const importsResult = await store.query<{ from_path: string; imported_symbols: string[] }>(
    importsQuery,
    { fileId: file.id }
  );
  const imports = importsResult.map((r) => ({
    from: r.from_path,
    symbols: r.imported_symbols || [],
  }));

  // Get imported by (what files import this file)
  const importedByQuery = `
    ?[from_path, imported_symbols] :=
      *imports{from_id, to_id: $fileId, imported_symbols},
      *file{id: from_id, path: from_path}
  `;
  const importedByResult = await store.query<{ from_path: string; imported_symbols: string[] }>(
    importedByQuery,
    { fileId: file.id }
  );
  const importedBy = importedByResult.map((r) => ({
    from: r.from_path,
    symbols: r.imported_symbols || [],
  }));

  return {
    filePath: file.path,
    imports,
    importedBy,
  };
}

/**
 * Get project statistics
 */
export async function getProjectStats(store: GraphDatabase): Promise<{
  files: number;
  functions: number;
  classes: number;
  interfaces: number;
  variables: number;
}> {
  logger.debug("Getting project stats");

  type CountResult = { "count(id)": number };

  const [filesResult, functionsResult, classesResult, interfacesResult, variablesResult] =
    await Promise.all([
      store.query<CountResult>(`?[count(id)] := *file{id}`),
      store.query<CountResult>(`?[count(id)] := *function{id}`),
      store.query<CountResult>(`?[count(id)] := *class{id}`),
      store.query<CountResult>(`?[count(id)] := *interface{id}`),
      store.query<CountResult>(`?[count(id)] := *variable{id}`),
    ]);

  return {
    files: filesResult[0]?.["count(id)"] ?? 0,
    functions: functionsResult[0]?.["count(id)"] ?? 0,
    classes: classesResult[0]?.["count(id)"] ?? 0,
    interfaces: interfacesResult[0]?.["count(id)"] ?? 0,
    variables: variablesResult[0]?.["count(id)"] ?? 0,
  };
}

// =============================================================================
// Change Notification Tools
// =============================================================================

export interface NotifyFileChangedInput {
  /** File path that was changed */
  filePath: string;
  /** Type of change */
  changeType: "created" | "modified" | "deleted" | "renamed";
  /** Previous file path (for renames) */
  previousPath?: string;
  /** Brief description of what changed */
  changeDescription?: string;
  /** Whether this was AI-generated code */
  aiGenerated?: boolean;
}

export interface NotifyFileChangedResult {
  acknowledged: boolean;
  reindexQueued: boolean;
  message: string;
}

export interface RequestReindexInput {
  /** File paths to reindex */
  filePaths?: string[];
  /** Entity IDs to reindex */
  entityIds?: string[];
  /** Priority level */
  priority?: "low" | "normal" | "high" | "immediate";
  /** Reason for reindex request */
  reason?: string;
}

export interface RequestReindexResult {
  requestId: string;
  queued: number;
  message: string;
}

// =============================================================================
// Prompt Enhancement Tools
// =============================================================================

export interface EnhancePromptInput {
  /** Original user prompt */
  prompt: string;
  /** Target file path (if known) */
  targetFile?: string;
  /** Type of task */
  taskType?: "create" | "modify" | "refactor" | "fix" | "document" | "test";
  /** Include related code context */
  includeContext?: boolean;
  /** Maximum context tokens to include */
  maxContextTokens?: number;
}

export interface EnhancePromptResult {
  /** Enhanced prompt with context */
  enhancedPrompt: string;
  /** Context that was added */
  addedContext: {
    relatedFiles: string[];
    relatedEntities: Array<{ name: string; type: string; filePath: string }>;
    projectPatterns: string[];
    relevantJustifications: string[];
  };
  /** Suggestions for the AI */
  suggestions: string[];
}

export interface CreateGenerationContextInput {
  /** The prompt that was used */
  originalPrompt: string;
  /** Files that were generated/modified */
  affectedFiles: Array<{
    filePath: string;
    changeType: "created" | "modified";
    summary?: string;
  }>;
  /** Session ID for tracking */
  sessionId?: string;
  /** Additional context about the generation */
  generationNotes?: string;
}

export interface CreateGenerationContextResult {
  /** Unique context ID for tracking */
  contextId: string;
  /** Generated justification */
  justification: {
    summary: string;
    businessValue: string;
    impactedAreas: string[];
    tags: string[];
  };
  /** Ledger entry ID */
  ledgerEntryId?: string;
  /** Files queued for reindexing */
  reindexQueued: string[];
}

/**
 * Notify that a file was changed (by AI agent or user)
 */
export async function notifyFileChanged(
  _store: GraphDatabase,
  input: NotifyFileChangedInput,
  context: ToolContext
): Promise<NotifyFileChangedResult> {
  const { filePath, changeType, previousPath, changeDescription, aiGenerated } = input;
  logger.info({ filePath, changeType, aiGenerated }, "File change notification received");

  // Notify the observer
  if (context.observer) {
    if (changeType === "deleted") {
      // For deletions, we just log it
      context.observer.onCodeGenerated(filePath, "", context.sessionId, `Deleted: ${changeDescription || ""}`);
    } else {
      context.observer.onCodeGenerated(
        filePath,
        "", // Content will be read during reindex
        context.sessionId,
        changeDescription || `${changeType}: ${previousPath ? `renamed from ${previousPath}` : ""}`
      );
    }
  }

  // Queue for reindexing
  let reindexQueued = false;
  if (context.adaptiveIndexer && changeType !== "deleted") {
    try {
      await context.adaptiveIndexer.observeChange({
        changeType,
        filePath,
        previousFilePath: previousPath,
        sessionId: context.sessionId,
        source: aiGenerated ? "ai-generated" : "user-edit",
      });
      reindexQueued = true;
    } catch (err) {
      logger.error({ err }, "Failed to queue reindex");
    }
  }

  return {
    acknowledged: true,
    reindexQueued,
    message: `File ${changeType} notification received for ${filePath}`,
  };
}

/**
 * Request reindexing of specific files or entities
 */
export async function requestReindex(
  _store: GraphDatabase,
  input: RequestReindexInput,
  context: ToolContext
): Promise<RequestReindexResult> {
  const { filePaths = [], entityIds = [], priority = "normal", reason } = input;
  logger.info({ filePaths, entityIds, priority }, "Reindex request received");

  const requestId = `reindex_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  let queued = 0;

  if (context.adaptiveIndexer) {
    // Queue file-based reindex requests
    for (const filePath of filePaths) {
      try {
        await context.adaptiveIndexer.observeChange({
          changeType: "modified",
          filePath,
          sessionId: context.sessionId,
          source: "user-edit",
        });
        queued++;
      } catch (err) {
        logger.error({ err, filePath }, "Failed to queue file reindex");
      }
    }

    // Queue entity-based reindex requests
    if (entityIds.length > 0) {
      try {
        await context.adaptiveIndexer.requestReindex(
          entityIds,
          reason ? "user-feedback" : "query-correlation",
          priority === "immediate" ? "immediate" : priority === "high" ? "high" : "normal"
        );
        queued += entityIds.length;
      } catch (err) {
        logger.error({ err }, "Failed to queue entity reindex");
      }
    }
  }

  return {
    requestId,
    queued,
    message: `Queued ${queued} items for reindexing`,
  };
}

/**
 * Enhance a user prompt with relevant codebase context
 */
export async function enhancePrompt(
  store: GraphDatabase,
  input: EnhancePromptInput,
  context: ToolContext
): Promise<EnhancePromptResult> {
  const {
    prompt,
    targetFile,
    taskType = "modify",
    includeContext = true,
    maxContextTokens = 2000,
  } = input;
  logger.info({ promptLength: prompt.length, targetFile, taskType }, "Enhancing prompt");

  const relatedFiles: string[] = [];
  const relatedEntities: Array<{ name: string; type: string; filePath: string }> = [];
  const projectPatterns: string[] = [];
  const relevantJustifications: string[] = [];
  const suggestions: string[] = [];

  // Extract keywords from prompt for search
  const keywords = extractKeywords(prompt);

  if (includeContext) {
    // 1. Find related files based on target file dependencies
    if (targetFile) {
      try {
        const deps = await getDependencies(store, { filePath: targetFile });
        if (deps) {
          relatedFiles.push(...deps.imports.map((i) => i.from).slice(0, 5));
          relatedFiles.push(...deps.importedBy.map((i) => i.from).slice(0, 3));
        }
      } catch {
        // Ignore errors
      }
    }

    // 2. Search for related entities based on keywords
    for (const keyword of keywords.slice(0, 3)) {
      try {
        const results = await searchCode(store, { query: keyword, limit: 5 });
        for (const result of results) {
          if (!relatedEntities.find((e) => e.name === result.name)) {
            relatedEntities.push({
              name: result.name,
              type: result.type,
              filePath: result.filePath || "",
            });
          }
        }
      } catch {
        // Ignore errors
      }
    }

    // 3. Get justifications for related entities if available
    if (context.justificationService && relatedEntities.length > 0) {
      for (const entity of relatedEntities.slice(0, 5)) {
        try {
          // Query justification from database
          const justQuery = `
            ?[purpose_summary] :=
              *justification{entity_id, purpose_summary},
              *function{id: entity_id, name: $name}
            :limit 1
          `;
          const justResult = await store.query<{ purpose_summary: string }>(justQuery, {
            name: entity.name,
          });
          if (justResult.length > 0 && justResult[0]?.purpose_summary) {
            relevantJustifications.push(`${entity.name}: ${justResult[0].purpose_summary}`);
          }
        } catch {
          // Ignore errors
        }
      }
    }

    // 4. Detect project patterns
    try {
      const stats = await getProjectStats(store);
      if (stats.classes > stats.functions * 0.5) {
        projectPatterns.push("Object-oriented style with heavy class usage");
      }
      if (stats.interfaces > 10) {
        projectPatterns.push("Interface-driven design");
      }
    } catch {
      // Ignore errors
    }
  }

  // Generate suggestions based on task type
  switch (taskType) {
    case "create":
      suggestions.push("Consider following existing naming conventions in the codebase");
      suggestions.push("Add appropriate exports if this will be used by other modules");
      break;
    case "modify":
      suggestions.push("Ensure backward compatibility if this is a public API");
      suggestions.push("Update related tests if behavior changes");
      break;
    case "refactor":
      suggestions.push("Preserve existing behavior while improving structure");
      suggestions.push("Consider impact on dependent code");
      break;
    case "fix":
      suggestions.push("Add a test case that reproduces the bug");
      suggestions.push("Check for similar patterns that might have the same issue");
      break;
    case "test":
      suggestions.push("Cover edge cases and error conditions");
      suggestions.push("Follow existing test patterns in the codebase");
      break;
    case "document":
      suggestions.push("Include usage examples");
      suggestions.push("Document parameters and return values");
      break;
  }

  // Build enhanced prompt
  let enhancedPrompt = prompt;

  if (includeContext && (relatedEntities.length > 0 || relevantJustifications.length > 0)) {
    const contextParts: string[] = [];

    if (relatedFiles.length > 0) {
      contextParts.push(`Related files: ${relatedFiles.slice(0, 5).join(", ")}`);
    }

    if (relatedEntities.length > 0) {
      const entityList = relatedEntities
        .slice(0, 5)
        .map((e) => `${e.name} (${e.type})`)
        .join(", ");
      contextParts.push(`Related code: ${entityList}`);
    }

    if (relevantJustifications.length > 0) {
      contextParts.push(`Context:\n${relevantJustifications.slice(0, 3).join("\n")}`);
    }

    if (projectPatterns.length > 0) {
      contextParts.push(`Project style: ${projectPatterns.join("; ")}`);
    }

    // Estimate tokens and truncate if needed
    const contextText = contextParts.join("\n\n");
    const estimatedTokens = Math.ceil(contextText.length / 4);

    if (estimatedTokens <= maxContextTokens) {
      enhancedPrompt = `${prompt}\n\n---\nCodebase Context:\n${contextText}`;
    } else {
      // Truncate to fit
      const truncatedContext = contextText.substring(0, maxContextTokens * 4);
      enhancedPrompt = `${prompt}\n\n---\nCodebase Context:\n${truncatedContext}...`;
    }
  }

  return {
    enhancedPrompt,
    addedContext: {
      relatedFiles,
      relatedEntities,
      projectPatterns,
      relevantJustifications,
    },
    suggestions,
  };
}

/**
 * Create generation context after code generation for ledger and justification
 */
export async function createGenerationContext(
  store: GraphDatabase,
  input: CreateGenerationContextInput,
  context: ToolContext
): Promise<CreateGenerationContextResult> {
  const { originalPrompt, affectedFiles, sessionId, generationNotes } = input;
  logger.info(
    { fileCount: affectedFiles.length, sessionId },
    "Creating generation context"
  );

  const contextId = `gen_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const reindexQueued: string[] = [];

  // Generate justification summary
  const fileSummaries = affectedFiles
    .map((f) => `${f.changeType}: ${f.filePath}${f.summary ? ` - ${f.summary}` : ""}`)
    .join("\n");

  const justification = {
    summary: `Code generation based on: "${originalPrompt.substring(0, 100)}${originalPrompt.length > 100 ? "..." : ""}"`,
    businessValue: `Implements user request: ${originalPrompt.substring(0, 200)}`,
    impactedAreas: affectedFiles.map((f) => f.filePath),
    tags: ["ai-generated", ...extractKeywords(originalPrompt).slice(0, 5)],
  };

  // Log to ledger
  let ledgerEntryId: string | undefined;
  if (context.ledger) {
    try {
      const { createLedgerEntry } = await import("../core/ledger/models/ledger-events.js");
      const entry = createLedgerEntry(
        "index:file:modified",
        "mcp-result-processor",
        justification.summary,
        {
          impactedFiles: affectedFiles.map((f) => f.filePath),
          metadata: {
            originalPrompt,
            generationNotes,
            fileSummaries,
            contextId,
          },
          sessionId: sessionId || context.sessionId,
        }
      );
      await context.ledger.append(entry);
      ledgerEntryId = entry.id;
    } catch (err) {
      logger.error({ err }, "Failed to log to ledger");
    }
  }

  // Queue files for reindexing
  if (context.adaptiveIndexer) {
    for (const file of affectedFiles) {
      try {
        await context.adaptiveIndexer.observeChange({
          changeType: file.changeType,
          filePath: file.filePath,
          sessionId: sessionId || context.sessionId,
          source: "ai-generated",
        });
        reindexQueued.push(file.filePath);
      } catch (err) {
        logger.error({ err, filePath: file.filePath }, "Failed to queue for reindex");
      }
    }
  }

  // Notify observer
  if (context.observer) {
    for (const file of affectedFiles) {
      context.observer.onCodeGenerated(
        file.filePath,
        file.summary || "",
        sessionId || context.sessionId,
        originalPrompt
      );
    }
  }

  return {
    contextId,
    justification,
    ledgerEntryId,
    reindexQueued,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract keywords from a prompt for search
 */
function extractKeywords(text: string): string[] {
  // Remove common words and extract meaningful terms
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "under", "again",
    "further", "then", "once", "here", "there", "when", "where", "why",
    "how", "all", "each", "few", "more", "most", "other", "some", "such",
    "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "just", "and", "but", "if", "or", "because", "until", "while", "this",
    "that", "these", "those", "it", "its", "i", "me", "my", "we", "our",
    "you", "your", "he", "him", "his", "she", "her", "they", "them", "their",
    "what", "which", "who", "whom", "please", "want", "need", "create",
    "make", "add", "update", "change", "modify", "fix", "implement", "write",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));

  // Deduplicate and return top keywords
  return [...new Set(words)].slice(0, 10);
}

// =============================================================================
// Phase 1: Enhanced Entity Semantics Tools
// =============================================================================

/**
 * Input for get_function_semantics tool
 */
export interface GetFunctionSemanticsInput {
  /** Function name to find */
  name: string;
  /** Optional file path to narrow search */
  filePath?: string;
}

/**
 * Output for function semantics
 */
export interface FunctionSemanticsResult {
  functionId: string;
  functionName: string;
  filePath: string;
  /** Parameter analysis */
  parameters: Array<{
    name: string;
    index: number;
    type: string | null;
    purpose: string;
    isOptional: boolean;
    isRest: boolean;
    isDestructured: boolean;
    defaultValue: string | null;
    isMutated: boolean;
    confidence: number;
  }>;
  /** Return value analysis */
  returnSemantics: {
    declaredType: string | null;
    inferredType: string | null;
    canReturnVoid: boolean;
    alwaysThrows: boolean;
    possibleValues: string[];
    nullConditions: string[];
    errorConditions: string[];
    confidence: number;
  } | null;
  /** Error analysis summary */
  errorAnalysis: {
    neverThrows: boolean;
    hasTopLevelCatch: boolean;
    escapingErrorTypes: string[];
    throwPoints: number;
    tryCatchBlocks: number;
    confidence: number;
  } | null;
}

/**
 * Get semantic analysis for a function (Phase 1)
 */
export async function getFunctionSemantics(
  store: GraphDatabase,
  input: GetFunctionSemanticsInput
): Promise<FunctionSemanticsResult | null> {
  const { name, filePath } = input;
  logger.debug({ name, filePath }, "Getting function semantics");

  // Find the function
  let funcQuery = `
    ?[id, name, file_path] :=
      *function{id, name, file_id},
      *file{id: file_id, path: file_path},
      name = $name
  `;
  if (filePath) {
    funcQuery = `
      ?[id, name, file_path] :=
        *function{id, name, file_id},
        *file{id: file_id, path: file_path},
        name = $name,
        contains(file_path, $filePath)
    `;
  }
  funcQuery += " :limit 1";

  try {
    const funcResult = await store.query<{
      id: string;
      name: string;
      file_path: string;
    }>(funcQuery, { name, filePath: filePath || "" });

    if (funcResult.length === 0) {
      return null;
    }

    const func = funcResult[0];
    if (!func) return null;
    const functionId = func.id;

    // Get parameter semantics
    const paramQuery = `
      ?[param_name, param_index, param_type, purpose, is_optional, is_rest,
        is_destructured, default_value, is_mutated, confidence] :=
        *function_parameter_semantics{
          function_id, param_name, param_index, param_type, purpose,
          is_optional, is_rest, is_destructured, default_value, is_mutated, confidence
        },
        function_id = $functionId
      :order param_index
    `;
    const paramResult = await store.query<{
      param_name: string;
      param_index: number;
      param_type: string | null;
      purpose: string;
      is_optional: boolean;
      is_rest: boolean;
      is_destructured: boolean;
      default_value: string | null;
      is_mutated: boolean;
      confidence: number;
    }>(paramQuery, { functionId });

    // Get return semantics
    const returnQuery = `
      ?[declared_type, inferred_type, can_return_void, always_throws,
        possible_values, null_conditions, error_conditions, confidence] :=
        *function_return_semantics{
          function_id, declared_type, inferred_type, can_return_void, always_throws,
          possible_values, null_conditions, error_conditions, confidence
        },
        function_id = $functionId
      :limit 1
    `;
    const returnResult = await store.query<{
      declared_type: string | null;
      inferred_type: string | null;
      can_return_void: boolean;
      always_throws: boolean;
      possible_values: string;
      null_conditions: string;
      error_conditions: string;
      confidence: number;
    }>(returnQuery, { functionId });

    // Get error analysis
    const errorQuery = `
      ?[never_throws, has_top_level_catch, escaping_error_types, throw_points,
        try_catch_blocks, confidence] :=
        *function_error_analysis{
          function_id, never_throws, has_top_level_catch, escaping_error_types,
          throw_points, try_catch_blocks, confidence
        },
        function_id = $functionId
      :limit 1
    `;
    const errorResult = await store.query<{
      never_throws: boolean;
      has_top_level_catch: boolean;
      escaping_error_types: string;
      throw_points: string;
      try_catch_blocks: string;
      confidence: number;
    }>(errorQuery, { functionId });

    // Parse JSON fields and build result
    const parameters = paramResult.map((p) => ({
      name: p.param_name,
      index: p.param_index,
      type: p.param_type,
      purpose: p.purpose,
      isOptional: p.is_optional,
      isRest: p.is_rest,
      isDestructured: p.is_destructured,
      defaultValue: p.default_value,
      isMutated: p.is_mutated,
      confidence: p.confidence,
    }));

    const returnSemantics = returnResult.length > 0 && returnResult[0]
      ? {
          declaredType: returnResult[0].declared_type,
          inferredType: returnResult[0].inferred_type,
          canReturnVoid: returnResult[0].can_return_void,
          alwaysThrows: returnResult[0].always_throws,
          possibleValues: JSON.parse(returnResult[0].possible_values || "[]") as string[],
          nullConditions: JSON.parse(returnResult[0].null_conditions || "[]") as string[],
          errorConditions: JSON.parse(returnResult[0].error_conditions || "[]") as string[],
          confidence: returnResult[0].confidence,
        }
      : null;

    const errorAnalysis = errorResult.length > 0 && errorResult[0]
      ? {
          neverThrows: errorResult[0].never_throws,
          hasTopLevelCatch: errorResult[0].has_top_level_catch,
          escapingErrorTypes: JSON.parse(errorResult[0].escaping_error_types || "[]") as string[],
          throwPoints: (JSON.parse(errorResult[0].throw_points || "[]") as unknown[]).length,
          tryCatchBlocks: (JSON.parse(errorResult[0].try_catch_blocks || "[]") as unknown[]).length,
          confidence: errorResult[0].confidence,
        }
      : null;

    return {
      functionId,
      functionName: func.name,
      filePath: func.file_path,
      parameters,
      returnSemantics,
      errorAnalysis,
    };
  } catch (e) {
    logger.debug({ error: e }, "Function semantics query failed");
    return null;
  }
}

/**
 * Input for get_error_paths tool
 */
export interface GetErrorPathsInput {
  /** Function name to find error paths for */
  functionName: string;
  /** Optional file path to narrow search */
  filePath?: string;
}

/**
 * Output for error paths
 */
export interface ErrorPathsResult {
  functionId: string;
  functionName: string;
  filePath: string;
  errorPaths: Array<{
    id: string;
    errorType: string;
    condition: string | null;
    isHandled: boolean;
    handlingStrategy: string | null;
    recoveryAction: string | null;
    propagatesTo: string[];
    sourceLocation: { line: number; column: number };
    confidence: number;
  }>;
}

/**
 * Get error propagation paths for a function
 */
export async function getErrorPaths(
  store: GraphDatabase,
  input: GetErrorPathsInput
): Promise<ErrorPathsResult | null> {
  const { functionName, filePath } = input;
  logger.debug({ functionName, filePath }, "Getting error paths");

  // Find the function
  let funcQuery = `
    ?[id, name, file_path] :=
      *function{id, name, file_id},
      *file{id: file_id, path: file_path},
      name = $name
  `;
  if (filePath) {
    funcQuery = `
      ?[id, name, file_path] :=
        *function{id, name, file_id},
        *file{id: file_id, path: file_path},
        name = $name,
        contains(file_path, $filePath)
    `;
  }
  funcQuery += " :limit 1";

  try {
    const funcResult = await store.query<{
      id: string;
      name: string;
      file_path: string;
    }>(funcQuery, { name: functionName, filePath: filePath || "" });

    if (funcResult.length === 0) {
      return null;
    }

    const func = funcResult[0];
    if (!func) return null;
    const functionId = func.id;

    // Get error paths
    const pathQuery = `
      ?[id, error_type, condition, is_handled, handling_strategy, recovery_action,
        propagates_to, source_location, confidence] :=
        *error_path{
          id, function_id, error_type, condition, is_handled, handling_strategy,
          recovery_action, propagates_to, source_location, confidence
        },
        function_id = $functionId
    `;
    const pathResult = await store.query<{
      id: string;
      error_type: string;
      condition: string | null;
      is_handled: boolean;
      handling_strategy: string | null;
      recovery_action: string | null;
      propagates_to: string;
      source_location: string;
      confidence: number;
    }>(pathQuery, { functionId });

    const errorPaths = pathResult.map((p) => ({
      id: p.id,
      errorType: p.error_type,
      condition: p.condition,
      isHandled: p.is_handled,
      handlingStrategy: p.handling_strategy,
      recoveryAction: p.recovery_action,
      propagatesTo: JSON.parse(p.propagates_to || "[]") as string[],
      sourceLocation: JSON.parse(p.source_location || '{"line":0,"column":0}') as { line: number; column: number },
      confidence: p.confidence,
    }));

    return {
      functionId,
      functionName: func.name,
      filePath: func.file_path,
      errorPaths,
    };
  } catch (e) {
    logger.debug({ error: e }, "Error paths query failed");
    return null;
  }
}

// =============================================================================
// Phase 2: Data Flow Analysis Tools
// =============================================================================

/**
 * Input for get_data_flow tool
 */
export interface GetDataFlowInput {
  /** Function name to analyze */
  functionName: string;
  /** Optional file path to narrow search */
  filePath?: string;
  /** Whether to include full node/edge graph (default: false for summary only) */
  includeFullGraph?: boolean;
}

/**
 * Output for data flow analysis
 */
export interface DataFlowResult {
  functionId: string;
  functionName: string;
  filePath: string;
  /** Summary of data flow (always included) */
  summary: {
    nodeCount: number;
    edgeCount: number;
    hasSideEffects: boolean;
    accessesExternalState: boolean;
    isPure: boolean;
    inputsAffectingOutput: string[];
    confidence: number;
  };
  /** Full data flow graph (only if includeFullGraph=true) */
  fullGraph?: {
    nodes: Array<{
      id: string;
      kind: string;
      name: string;
      line: number;
      column: number;
      inferredType: string | null;
      isTainted: boolean;
      taintSource: string | null;
    }>;
    edges: Array<{
      from: string;
      to: string;
      kind: string;
      transformation: string | null;
      condition: string | null;
      lineNumber: number;
      propagatesTaint: boolean;
    }>;
  };
  /** Taint flows found */
  taintFlows?: Array<{
    source: string;
    sink: string;
    pathLength: number;
    isSanitized: boolean;
  }>;
  /** Whether this was from cache or computed fresh */
  fromCache: boolean;
}

/**
 * Get data flow analysis for a function (Phase 2)
 * Uses lazy evaluation - returns cached result if available, otherwise returns summary only
 */
export async function getDataFlow(
  store: GraphDatabase,
  input: GetDataFlowInput
): Promise<DataFlowResult | null> {
  const { functionName, filePath, includeFullGraph = false } = input;
  logger.debug({ functionName, filePath, includeFullGraph }, "Getting data flow");

  // Find the function
  let funcQuery = `
    ?[id, name, file_path, file_id] :=
      *function{id, name, file_id},
      *file{id: file_id, path: file_path},
      name = $name
  `;
  if (filePath) {
    funcQuery = `
      ?[id, name, file_path, file_id] :=
        *function{id, name, file_id},
        *file{id: file_id, path: file_path},
        name = $name,
        contains(file_path, $filePath)
    `;
  }
  funcQuery += " :limit 1";

  try {
    const funcResult = await store.query<{
      id: string;
      name: string;
      file_path: string;
      file_id: string;
    }>(funcQuery, { name: functionName, filePath: filePath || "" });

    if (funcResult.length === 0) {
      return null;
    }

    const func = funcResult[0];
    if (!func) return null;
    const functionId = func.id;

    // Check for cached data flow
    const cacheQuery = `
      ?[node_count, edge_count, has_side_effects, accesses_external_state, is_pure,
        inputs_affecting_output, flow_summary_json, full_graph_json, taint_flows_json,
        confidence, access_count] :=
        *data_flow_cache{
          function_id, node_count, edge_count, has_side_effects, accesses_external_state,
          is_pure, inputs_affecting_output, flow_summary_json, full_graph_json,
          taint_flows_json, confidence, access_count
        },
        function_id = $functionId
      :limit 1
    `;
    const cacheResult = await store.query<{
      node_count: number;
      edge_count: number;
      has_side_effects: boolean;
      accesses_external_state: boolean;
      is_pure: boolean;
      inputs_affecting_output: string;
      flow_summary_json: string;
      full_graph_json: string;
      taint_flows_json: string | null;
      confidence: number;
      access_count: number;
    }>(cacheQuery, { functionId });

    if (cacheResult.length > 0 && cacheResult[0]) {
      const cache = cacheResult[0];

      // Update access count (fire and forget)
      store.execute(
        `?[id] := *data_flow_cache{id, function_id}, function_id = $functionId
         :update data_flow_cache {id => access_count: $newCount, last_accessed_at: $now}`,
        { functionId, newCount: cache.access_count + 1, now: Date.now() }
      ).catch((e) => logger.debug({ error: e }, "Failed to update cache access count"));

      const result: DataFlowResult = {
        functionId,
        functionName: func.name,
        filePath: func.file_path,
        summary: {
          nodeCount: cache.node_count,
          edgeCount: cache.edge_count,
          hasSideEffects: cache.has_side_effects,
          accessesExternalState: cache.accesses_external_state,
          isPure: cache.is_pure,
          inputsAffectingOutput: JSON.parse(cache.inputs_affecting_output || "[]") as string[],
          confidence: cache.confidence,
        },
        fromCache: true,
      };

      // Include full graph if requested
      if (includeFullGraph && cache.full_graph_json) {
        const fullGraph = JSON.parse(cache.full_graph_json) as {
          nodes: DataFlowResult["fullGraph"];
          edges: DataFlowResult["fullGraph"];
        };
        result.fullGraph = fullGraph as unknown as DataFlowResult["fullGraph"];
      }

      // Include taint flows if available
      if (cache.taint_flows_json) {
        result.taintFlows = JSON.parse(cache.taint_flows_json) as DataFlowResult["taintFlows"];
      }

      return result;
    }

    // No cache available - return minimal result indicating analysis needed
    // In a full implementation, this would trigger lazy computation
    return {
      functionId,
      functionName: func.name,
      filePath: func.file_path,
      summary: {
        nodeCount: 0,
        edgeCount: 0,
        hasSideEffects: false,
        accessesExternalState: false,
        isPure: true,
        inputsAffectingOutput: [],
        confidence: 0,
      },
      fromCache: false,
    };
  } catch (e) {
    logger.debug({ error: e }, "Data flow query failed");
    return null;
  }
}

// =============================================================================
// Phase 3: Side-Effect Analysis Tools
// =============================================================================

/**
 * Input for get_side_effects tool
 */
export interface GetSideEffectsInput {
  /** Function name to analyze */
  functionName: string;
  /** Optional file path to narrow search */
  filePath?: string;
  /** Optional: only include effects of certain categories */
  categories?: string[];
  /** Optional: minimum confidence level ('high', 'medium', 'low') */
  minConfidence?: string;
}

/**
 * Output for side effect analysis
 */
export interface SideEffectResult {
  functionId: string;
  functionName: string;
  filePath: string;
  /** Summary of side effects */
  summary: {
    totalCount: number;
    isPure: boolean;
    allConditional: boolean;
    primaryCategories: string[];
    riskLevel: string;
    confidence: number;
  };
  /** Individual side effects */
  sideEffects: Array<{
    id: string;
    category: string;
    description: string;
    target: string | null;
    apiCall: string;
    isConditional: boolean;
    condition: string | null;
    confidence: string;
    location: {
      line: number;
      column: number;
    };
  }>;
}

/**
 * Get side effects analysis for a function (Phase 3)
 */
export async function getSideEffects(
  store: GraphDatabase,
  input: GetSideEffectsInput
): Promise<SideEffectResult | null> {
  const { functionName, filePath, categories, minConfidence } = input;
  logger.debug({ functionName, filePath, categories, minConfidence }, "Getting side effects");

  // Find the function
  let funcQuery = `
    ?[id, name, file_path] :=
      *function{id, name, file_id},
      *file{id: file_id, path: file_path},
      name = $name
  `;
  if (filePath) {
    funcQuery = `
      ?[id, name, file_path] :=
        *function{id, name, file_id},
        *file{id: file_id, path: file_path},
        name = $name,
        contains(file_path, $filePath)
    `;
  }
  funcQuery += " :limit 1";

  try {
    const funcResult = await store.query<{
      id: string;
      name: string;
      file_path: string;
    }>(funcQuery, { name: functionName, filePath: filePath || "" });

    if (funcResult.length === 0) {
      return null;
    }

    const func = funcResult[0];
    if (!func) return null;
    const functionId = func.id;

    // Get the summary
    const summaryQuery = `
      ?[total_count, is_pure, all_conditional, primary_categories_json,
        risk_level, confidence] :=
        *function_side_effect_summary{
          function_id, total_count, is_pure, all_conditional,
          primary_categories_json, risk_level, confidence
        },
        function_id = $functionId
      :limit 1
    `;
    const summaryResult = await store.query<{
      total_count: number;
      is_pure: boolean;
      all_conditional: boolean;
      primary_categories_json: string;
      risk_level: string;
      confidence: number;
    }>(summaryQuery, { functionId });

    // Get individual side effects
    let effectsQuery = `
      ?[id, category, description, target, api_call, is_conditional,
        condition, confidence, source_line, source_column] :=
        *side_effect{
          id, function_id, category, description, target, api_call,
          is_conditional, condition, confidence, source_line, source_column
        },
        function_id = $functionId
    `;

    // Add category filter if specified
    if (categories && categories.length > 0) {
      effectsQuery = `
        ?[id, category, description, target, api_call, is_conditional,
          condition, confidence, source_line, source_column] :=
          *side_effect{
            id, function_id, category, description, target, api_call,
            is_conditional, condition, confidence, source_line, source_column
          },
          function_id = $functionId,
          category in $categories
      `;
    }

    const effectsResult = await store.query<{
      id: string;
      category: string;
      description: string;
      target: string | null;
      api_call: string;
      is_conditional: boolean;
      condition: string | null;
      confidence: string;
      source_line: number;
      source_column: number;
    }>(effectsQuery, { functionId, categories: categories || [] });

    // Filter by confidence if specified
    let filteredEffects = effectsResult;
    if (minConfidence) {
      const confidenceOrder = ["high", "medium", "low"];
      const minIndex = confidenceOrder.indexOf(minConfidence);
      if (minIndex >= 0) {
        filteredEffects = effectsResult.filter((e) => {
          const eIndex = confidenceOrder.indexOf(e.confidence);
          return eIndex <= minIndex;
        });
      }
    }

    // Build result
    const summary = summaryResult[0];
    return {
      functionId,
      functionName: func.name,
      filePath: func.file_path,
      summary: summary
        ? {
            totalCount: summary.total_count,
            isPure: summary.is_pure,
            allConditional: summary.all_conditional,
            primaryCategories: JSON.parse(summary.primary_categories_json || "[]") as string[],
            riskLevel: summary.risk_level,
            confidence: summary.confidence,
          }
        : {
            totalCount: filteredEffects.length,
            isPure: filteredEffects.length === 0,
            allConditional: filteredEffects.every((e) => e.is_conditional),
            primaryCategories: [],
            riskLevel: "low",
            confidence: 0,
          },
      sideEffects: filteredEffects.map((e) => ({
        id: e.id,
        category: e.category,
        description: e.description,
        target: e.target,
        apiCall: e.api_call,
        isConditional: e.is_conditional,
        condition: e.condition,
        confidence: e.confidence,
        location: {
          line: e.source_line,
          column: e.source_column,
        },
      })),
    };
  } catch (e) {
    logger.debug({ error: e }, "Side effects query failed");
    return null;
  }
}

// =============================================================================
// Design Pattern Detection Tools (Phase 4)
// =============================================================================

export interface FindPatternsInput {
  /** Pattern type to find (optional - all patterns if not specified) */
  patternType?: "factory" | "singleton" | "observer" | "repository" | "service" | "adapter" | "builder" | "strategy" | "decorator";
  /** Minimum confidence threshold (default: 0.5) */
  minConfidence?: number;
  /** File path to search in (optional - all files if not specified) */
  filePath?: string;
  /** Maximum number of results (default: 20) */
  limit?: number;
}

export interface PatternResult {
  id: string;
  patternType: string;
  name: string;
  confidence: number;
  confidenceLevel: string;
  description: string | null;
  filePaths: string[];
  evidence: string[];
  participants: Array<{
    role: string;
    entityName: string;
    entityType: string;
    filePath: string;
    evidence: string[];
  }>;
}

export interface FindPatternsResult {
  patterns: PatternResult[];
  stats: {
    total: number;
    byType: Record<string, number>;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  };
}

/**
 * Find design patterns in the codebase.
 */
export async function findPatterns(
  store: GraphDatabase,
  input: FindPatternsInput
): Promise<FindPatternsResult> {
  const { patternType, minConfidence = 0.5, filePath, limit = 20 } = input;
  logger.debug({ patternType, minConfidence, filePath }, "Finding design patterns");

  try {
    // Build query
    let patternQuery: string;
    const params: Record<string, unknown> = { minConfidence, limit };

    if (patternType && filePath) {
      patternQuery = `
        ?[id, pattern_type, name, confidence, confidence_level, description,
          file_paths_json, evidence_json] :=
          *design_pattern{id, pattern_type, name, confidence, confidence_level,
            description, file_paths_json, evidence_json},
          pattern_type = $patternType,
          confidence >= $minConfidence
        :limit $limit
      `;
      params.patternType = patternType;
    } else if (patternType) {
      patternQuery = `
        ?[id, pattern_type, name, confidence, confidence_level, description,
          file_paths_json, evidence_json] :=
          *design_pattern{id, pattern_type, name, confidence, confidence_level,
            description, file_paths_json, evidence_json},
          pattern_type = $patternType,
          confidence >= $minConfidence
        :limit $limit
      `;
      params.patternType = patternType;
    } else if (filePath) {
      patternQuery = `
        ?[id, pattern_type, name, confidence, confidence_level, description,
          file_paths_json, evidence_json] :=
          *design_pattern{id, pattern_type, name, confidence, confidence_level,
            description, file_paths_json, evidence_json},
          confidence >= $minConfidence
        :limit $limit
      `;
    } else {
      patternQuery = `
        ?[id, pattern_type, name, confidence, confidence_level, description,
          file_paths_json, evidence_json] :=
          *design_pattern{id, pattern_type, name, confidence, confidence_level,
            description, file_paths_json, evidence_json},
          confidence >= $minConfidence
        :limit $limit
      `;
    }

    const patternResult = await store.query<{
      id: string;
      pattern_type: string;
      name: string;
      confidence: number;
      confidence_level: string;
      description: string | null;
      file_paths_json: string;
      evidence_json: string;
    }>(patternQuery, params);

    // Filter by file path if specified (client-side filtering)
    let filteredPatterns = patternResult;
    if (filePath) {
      filteredPatterns = patternResult.filter((p) => {
        const paths = JSON.parse(p.file_paths_json || "[]") as string[];
        return paths.some((fp) => fp.includes(filePath) || filePath.includes(fp));
      });
    }

    // Get participants for each pattern
    const patterns: PatternResult[] = [];
    const byType: Record<string, number> = {};
    let highConfidence = 0;
    let mediumConfidence = 0;
    let lowConfidence = 0;

    for (const p of filteredPatterns) {
      // Get participants
      const participantQuery = `
        ?[role, entity_name, entity_type, file_path, evidence_json] :=
          *pattern_participant{pattern_id, role, entity_name, entity_type,
            file_path, evidence_json},
          pattern_id = $patternId
      `;
      const participantResult = await store.query<{
        role: string;
        entity_name: string;
        entity_type: string;
        file_path: string;
        evidence_json: string;
      }>(participantQuery, { patternId: p.id });

      patterns.push({
        id: p.id,
        patternType: p.pattern_type,
        name: p.name,
        confidence: p.confidence,
        confidenceLevel: p.confidence_level,
        description: p.description,
        filePaths: JSON.parse(p.file_paths_json || "[]") as string[],
        evidence: JSON.parse(p.evidence_json || "[]") as string[],
        participants: participantResult.map((pp) => ({
          role: pp.role,
          entityName: pp.entity_name,
          entityType: pp.entity_type,
          filePath: pp.file_path,
          evidence: JSON.parse(pp.evidence_json || "[]") as string[],
        })),
      });

      // Stats
      byType[p.pattern_type] = (byType[p.pattern_type] || 0) + 1;
      if (p.confidence_level === "high") highConfidence++;
      else if (p.confidence_level === "medium") mediumConfidence++;
      else lowConfidence++;
    }

    return {
      patterns,
      stats: {
        total: patterns.length,
        byType,
        highConfidence,
        mediumConfidence,
        lowConfidence,
      },
    };
  } catch (e) {
    logger.debug({ error: e }, "Pattern query failed");
    return {
      patterns: [],
      stats: {
        total: 0,
        byType: {},
        highConfidence: 0,
        mediumConfidence: 0,
        lowConfidence: 0,
      },
    };
  }
}

export interface GetPatternInput {
  /** Pattern ID */
  patternId: string;
}

/**
 * Get details of a specific design pattern.
 */
export async function getPattern(
  store: GraphDatabase,
  input: GetPatternInput
): Promise<PatternResult | null> {
  const { patternId } = input;
  logger.debug({ patternId }, "Getting pattern details");

  try {
    const patternQuery = `
      ?[id, pattern_type, name, confidence, confidence_level, description,
        file_paths_json, evidence_json] :=
        *design_pattern{id, pattern_type, name, confidence, confidence_level,
          description, file_paths_json, evidence_json},
        id = $patternId
      :limit 1
    `;

    const patternResult = await store.query<{
      id: string;
      pattern_type: string;
      name: string;
      confidence: number;
      confidence_level: string;
      description: string | null;
      file_paths_json: string;
      evidence_json: string;
    }>(patternQuery, { patternId });

    const p = patternResult[0];
    if (!p) {
      return null;
    }

    // Get participants
    const participantQuery = `
      ?[role, entity_name, entity_type, file_path, evidence_json] :=
        *pattern_participant{pattern_id, role, entity_name, entity_type,
          file_path, evidence_json},
        pattern_id = $patternId
    `;
    const participantResult = await store.query<{
      role: string;
      entity_name: string;
      entity_type: string;
      file_path: string;
      evidence_json: string;
    }>(participantQuery, { patternId });

    return {
      id: p.id,
      patternType: p.pattern_type,
      name: p.name,
      confidence: p.confidence,
      confidenceLevel: p.confidence_level,
      description: p.description,
      filePaths: JSON.parse(p.file_paths_json || "[]") as string[],
      evidence: JSON.parse(p.evidence_json || "[]") as string[],
      participants: participantResult.map((pp) => ({
        role: pp.role,
        entityName: pp.entity_name,
        entityType: pp.entity_type,
        filePath: pp.file_path,
        evidence: JSON.parse(pp.evidence_json || "[]") as string[],
      })),
    };
  } catch (e) {
    logger.debug({ error: e }, "Get pattern failed");
    return null;
  }
}

// =============================================================================
// Phase 6: Semantic Similarity & Related Code Discovery
// =============================================================================

export interface FindSimilarCodeInput {
  /** Entity ID to find similar code for (use this OR text, not both) */
  entityId?: string;
  /** Natural language description to search for (use this OR entityId, not both) */
  text?: string;
  /** Maximum number of results (default: 10) */
  limit?: number;
  /** Minimum similarity threshold 0.0-1.0 (default: 0.5) */
  minSimilarity?: number;
  /** Filter by entity type */
  entityTypes?: Array<"function" | "class" | "interface" | "method">;
  /** Filter by file path pattern (regex) */
  filePathPattern?: string;
}

export interface SimilarCodeResult {
  entityId: string;
  entityType: "function" | "class" | "interface" | "method";
  name: string;
  filePath: string;
  similarity: number;
  signature?: string;
  description?: string;
}

export interface FindSimilarCodeResult {
  results: SimilarCodeResult[];
  query: {
    type: "entity" | "text";
    value: string;
  };
  stats: {
    total: number;
    avgSimilarity: number;
    searchTimeMs: number;
  };
}

/**
 * Find semantically similar code using vector embeddings.
 *
 * Uses local embeddings (HuggingFace transformers) and HNSW vector indices
 * to find code that is functionally similar to the query.
 */
export async function findSimilarCode(
  store: GraphDatabase,
  input: FindSimilarCodeInput,
  embeddingService?: import("../core/embeddings/index.js").IEmbeddingService,
  similarityService?: import("../core/embeddings/index.js").ISimilarityService
): Promise<FindSimilarCodeResult> {
  const { entityId, text, limit = 10, minSimilarity = 0.5, entityTypes, filePathPattern } = input;
  logger.debug({ entityId, text, limit, minSimilarity }, "Finding similar code");

  const startTime = Date.now();

  // Validate input
  if (!entityId && !text) {
    return {
      results: [],
      query: { type: "text", value: "" },
      stats: { total: 0, avgSimilarity: 0, searchTimeMs: 0 },
    };
  }

  // If no similarity service, return empty (embeddings not initialized)
  if (!similarityService) {
    logger.warn("Similarity service not initialized - embeddings may not be enabled");
    return {
      results: [],
      query: { type: entityId ? "entity" : "text", value: entityId || text || "" },
      stats: { total: 0, avgSimilarity: 0, searchTimeMs: Date.now() - startTime },
    };
  }

  try {
    const searchOptions = {
      limit,
      minSimilarity,
      entityTypes,
      filePathPattern,
    };

    let results: import("../core/embeddings/index.js").SimilarEntity[];

    if (entityId) {
      // Search by entity ID
      results = await similarityService.findSimilarByEntityId(entityId, searchOptions);
    } else if (text) {
      // Search by natural language text
      results = await similarityService.findSimilarByText(text, searchOptions);
    } else {
      results = [];
    }

    const searchTimeMs = Date.now() - startTime;
    const avgSimilarity = results.length > 0
      ? results.reduce((sum, r) => sum + r.similarity, 0) / results.length
      : 0;

    return {
      results: results.map(r => ({
        entityId: r.entityId,
        entityType: r.entityType,
        name: r.name,
        filePath: r.filePath,
        similarity: r.similarity,
        signature: r.signature,
        description: r.description,
      })),
      query: {
        type: entityId ? "entity" : "text",
        value: entityId || text || "",
      },
      stats: {
        total: results.length,
        avgSimilarity: Math.round(avgSimilarity * 1000) / 1000,
        searchTimeMs,
      },
    };
  } catch (e) {
    logger.debug({ error: e }, "Find similar code failed");
    return {
      results: [],
      query: { type: entityId ? "entity" : "text", value: entityId || text || "" },
      stats: { total: 0, avgSimilarity: 0, searchTimeMs: Date.now() - startTime },
    };
  }
}

// =============================================================================
// Lazarus Migration Tools — Input Types
// =============================================================================

export interface GetEntitySourceInput {
  entityId?: string;
  name?: string;
  filePath?: string;
  entityType?: "function" | "class" | "interface" | "variable";
  contextLines?: number;
}

export interface GetFeatureMapInput {
  featureContext?: string;
  includeEntities?: boolean;
  limit?: number;
}

export interface GetMigrationContextInput {
  featureContext?: string;
  entityIds?: string[];
  includeSource?: boolean;
  includeDataFlow?: boolean;
  includeSideEffects?: boolean;
}

export interface AnalyzeBlastRadiusInput {
  entityId: string;
  maxDepth?: number;
  direction?: "callers" | "callees" | "both";
}

export interface GetEntityTestsInput {
  entityId?: string;
  name?: string;
  filePath?: string;
}

export interface TagEntityInput {
  entityId: string;
  tags: string[];
  source?: string;
}

export interface GetTaggedEntitiesInput {
  tag: string;
  entityType?: "function" | "class" | "interface" | "variable" | "file";
}

export interface RemoveEntityTagsInput {
  entityId: string;
  tags: string[];
}

export interface ResolveEntityAtLocationInput {
  filePath: string;
  line: number;
}

export interface GetMigrationProgressInput {
  featureContext?: string;
  tags?: string[];
}

export interface GetSliceDependenciesInput {
  features?: string[];
}

// =============================================================================
// Lazarus Migration Tools — Output Types
// =============================================================================

export interface EntitySourceResult {
  entityId: string;
  name: string;
  entityType: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  sourceCode: string;
  lineCount: number;
}

export interface FeatureMapResult {
  features: Array<{
    name: string;
    entityCount: number;
    fileCount: number;
    files: string[];
    breakdown: { functions: number; classes: number; interfaces: number; variables: number };
    entities?: Array<{ id: string; name: string; type: string; filePath: string; purposeSummary: string }>;
  }>;
  totalFeatures: number;
  totalEntities: number;
}

export interface MigrationContextResult {
  entities: Array<{
    id: string;
    name: string;
    type: string;
    filePath: string;
    startLine: number;
    endLine: number;
    signature?: string;
    sourceCode?: string;
    justification?: { purposeSummary: string; businessValue: string; featureContext: string; confidence: number };
    sideEffects?: Array<{ category: string; description: string; target?: string }>;
    dataFlow?: { isPure: boolean; summary: string };
  }>;
  internalDependencies: Array<{ fromId: string; fromName: string; toId: string; toName: string; type: string }>;
  externalDependencies: Array<{ entityId: string; entityName: string; externalName: string; externalFile?: string; type: string }>;
  businessRules: Array<{ entityName: string; rule: string; confidence: number }>;
  patterns: Array<{ patternType: string; name: string; participants: string[] }>;
  stats: { entityCount: number; fileCount: number; internalCallCount: number; externalDepCount: number };
}

export interface BlastRadiusResult {
  root: { id: string; name: string; type: string; filePath: string };
  maxDepth: number;
  direction: string;
  hops: Array<{
    depth: number;
    entities: Array<{ id: string; name: string; type: string; filePath: string; relationship: string; via: string }>;
  }>;
  summary: { totalAffected: number; affectedFiles: string[]; byType: Record<string, number> };
}

export interface EntityTestsResult {
  entityId?: string;
  entityName: string;
  filePath: string;
  testFiles: Array<{
    path: string;
    matchType: "import" | "nameReference" | "pathConvention";
    relevantLines?: Array<{ lineNumber: number; content: string }>;
  }>;
  coverageEstimate: "high" | "medium" | "low" | "none";
}

export interface TagEntityResult {
  entityId: string;
  tags: string[];
  added: number;
  message: string;
}

export interface GetTaggedResult {
  tag: string;
  entities: Array<{ id: string; name: string; type: string; filePath: string; tags: string[]; source?: string }>;
  count: number;
}

export interface RemoveEntityTagsResult {
  entityId: string;
  removed: number;
  message: string;
}

export interface ResolveEntityAtLocationResult {
  entityId: string;
  name: string;
  entityType: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  signature?: string;
  justification?: { purposeSummary: string; featureContext: string; businessValue: string; confidence: number };
}

export interface MigrationProgressResult {
  features: Array<{
    name: string;
    totalEntities: number;
    taggedEntities: number;
    tags: Record<string, number>;
    progressPercent: number;
  }>;
  overall: {
    totalEntities: number;
    taggedEntities: number;
    tags: Record<string, number>;
    progressPercent: number;
  };
}

export interface SliceDependenciesResult {
  features: Array<{
    name: string;
    entityCount: number;
    dependsOn: Array<{ feature: string; connectionCount: number; connections: Array<{ fromName: string; toName: string }> }>;
  }>;
  executionOrder: string[];
  circularDependencies: Array<{ features: string[] }>;
}

// =============================================================================
// Lazarus Migration Tools — Handlers
// =============================================================================

import { readFileWithEncoding } from "../utils/fs.js";
import * as fs from "node:fs";
import * as path from "node:path";
import fg from "fast-glob";

/**
 * Universal entity lookup across function/class/interface/variable tables.
 * Returns the first match found.
 */
async function resolveEntity(
  store: GraphDatabase,
  opts: { entityId?: string; name?: string; filePath?: string; entityType?: string }
): Promise<{ id: string; name: string; type: string; filePath: string; startLine: number; endLine: number; language: string; signature?: string } | null> {
  const tables: Array<{ table: string; kind: string; hasSignature: boolean }> = [
    { table: "function", kind: "function", hasSignature: true },
    { table: "class", kind: "class", hasSignature: false },
    { table: "interface", kind: "interface", hasSignature: false },
  ];

  // If entityType specified, only check that table
  const filtered = opts.entityType
    ? tables.filter((t) => t.kind === opts.entityType)
    : tables;

  for (const { table, kind, hasSignature } of filtered) {
    const sigField = hasSignature ? ", signature" : "";
    let query: string;
    const params: Record<string, unknown> = {};

    if (opts.entityId) {
      query = `
        ?[id, name, file_path, start_line, end_line, language${sigField}] :=
          *${table}{id, name, file_id, start_line, end_line${sigField}},
          *file{id: file_id, path: file_path, language},
          id = $entityId
        :limit 1
      `;
      params.entityId = opts.entityId;
    } else if (opts.name && opts.filePath) {
      query = `
        ?[id, name, file_path, start_line, end_line, language${sigField}] :=
          *${table}{id, name, file_id, start_line, end_line${sigField}},
          *file{id: file_id, path: file_path, language},
          name = $name,
          ends_with(file_path, $filePath)
        :limit 1
      `;
      params.name = opts.name;
      params.filePath = opts.filePath;
    } else if (opts.name) {
      query = `
        ?[id, name, file_path, start_line, end_line, language${sigField}] :=
          *${table}{id, name, file_id, start_line, end_line${sigField}},
          *file{id: file_id, path: file_path, language},
          name = $name
        :limit 1
      `;
      params.name = opts.name;
    } else {
      continue;
    }

    try {
      const result = await store.query<Record<string, unknown>>(query, params);
      if (result.length > 0 && result[0]) {
        const row = result[0];
        return {
          id: row.id as string,
          name: row.name as string,
          type: kind,
          filePath: row.file_path as string,
          startLine: row.start_line as number,
          endLine: row.end_line as number,
          language: row.language as string,
          signature: hasSignature ? (row.signature as string | undefined) : undefined,
        };
      }
    } catch {
      // Try next table
    }
  }

  // Also check variable table (different schema: line/column instead of start_line/end_line)
  if (!opts.entityType || opts.entityType === "variable") {
    let query: string;
    const params: Record<string, unknown> = {};

    if (opts.entityId) {
      query = `
        ?[id, name, file_path, line, language] :=
          *variable{id, name, file_id, line},
          *file{id: file_id, path: file_path, language},
          id = $entityId
        :limit 1
      `;
      params.entityId = opts.entityId;
    } else if (opts.name) {
      query = `
        ?[id, name, file_path, line, language] :=
          *variable{id, name, file_id, line},
          *file{id: file_id, path: file_path, language},
          name = $name
        :limit 1
      `;
      params.name = opts.name;
    } else {
      return null;
    }

    try {
      const result = await store.query<Record<string, unknown>>(query, params);
      if (result.length > 0 && result[0]) {
        const row = result[0];
        return {
          id: row.id as string,
          name: row.name as string,
          type: "variable",
          filePath: row.file_path as string,
          startLine: row.line as number,
          endLine: row.line as number,
          language: row.language as string,
        };
      }
    } catch {
      // Not found
    }
  }

  return null;
}

/**
 * Get the actual source code of a function, class, or interface.
 */
export async function getEntitySource(
  store: GraphDatabase,
  input: GetEntitySourceInput
): Promise<EntitySourceResult | null> {
  const { entityId, name, filePath, entityType, contextLines = 0 } = input;
  logger.debug({ entityId, name, filePath, entityType }, "Getting entity source");

  const entity = await resolveEntity(store, { entityId, name, filePath, entityType });
  if (!entity) return null;

  try {
    const content = await readFileWithEncoding(entity.filePath);
    const lines = content.split("\n");
    const start = Math.max(0, entity.startLine - 1 - contextLines);
    const end = Math.min(lines.length, entity.endLine + contextLines);
    const sourceLines = lines.slice(start, end);
    const sourceCode = sourceLines
      .map((line, i) => `${start + i + 1}: ${line}`)
      .join("\n");

    return {
      entityId: entity.id,
      name: entity.name,
      entityType: entity.type,
      filePath: entity.filePath,
      startLine: entity.startLine,
      endLine: entity.endLine,
      language: entity.language,
      sourceCode,
      lineCount: entity.endLine - entity.startLine + 1,
    };
  } catch (err) {
    logger.debug({ err, filePath: entity.filePath }, "Failed to read source file");
    return null;
  }
}

/**
 * Get a map of all features/business domains in the codebase.
 */
export async function getFeatureMap(
  store: GraphDatabase,
  input: GetFeatureMapInput
): Promise<FeatureMapResult> {
  const { featureContext, includeEntities = false, limit = 50 } = input;
  logger.debug({ featureContext, includeEntities, limit }, "Getting feature map");

  try {
    let query: string;
    const params: Record<string, unknown> = {};

    if (featureContext) {
      query = `
        ?[feature_context, entity_id, entity_type, name, file_path, purpose_summary] :=
          *justification{entity_id, entity_type, name, file_path, feature_context, purpose_summary},
          feature_context != "",
          contains(feature_context, $featureContext)
      `;
      params.featureContext = featureContext;
    } else {
      query = `
        ?[feature_context, entity_id, entity_type, name, file_path, purpose_summary] :=
          *justification{entity_id, entity_type, name, file_path, feature_context, purpose_summary},
          feature_context != ""
      `;
    }

    const rows = await store.query<{
      feature_context: string;
      entity_id: string;
      entity_type: string;
      name: string;
      file_path: string;
      purpose_summary: string;
    }>(query, params);

    // Group by feature_context
    const featureMap = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.feature_context;
      if (!featureMap.has(key)) featureMap.set(key, []);
      featureMap.get(key)!.push(row);
    }

    let totalEntities = 0;
    const features = Array.from(featureMap.entries())
      .slice(0, limit)
      .map(([name, entities]) => {
        const files = [...new Set(entities.map((e) => e.file_path))];
        const breakdown = { functions: 0, classes: 0, interfaces: 0, variables: 0 };
        for (const e of entities) {
          if (e.entity_type === "function") breakdown.functions++;
          else if (e.entity_type === "class") breakdown.classes++;
          else if (e.entity_type === "interface") breakdown.interfaces++;
          else if (e.entity_type === "variable") breakdown.variables++;
        }
        totalEntities += entities.length;

        const result: FeatureMapResult["features"][number] = {
          name,
          entityCount: entities.length,
          fileCount: files.length,
          files,
          breakdown,
        };
        if (includeEntities) {
          result.entities = entities.map((e) => ({
            id: e.entity_id,
            name: e.name,
            type: e.entity_type,
            filePath: e.file_path,
            purposeSummary: e.purpose_summary,
          }));
        }
        return result;
      });

    return { features, totalFeatures: featureMap.size, totalEntities };
  } catch (e) {
    logger.debug({ error: e }, "Feature map query failed");
    return { features: [], totalFeatures: 0, totalEntities: 0 };
  }
}

/**
 * Build a Code Contract for a feature slice — entities, business rules,
 * internal/external dependencies, patterns.
 */
export async function getMigrationContext(
  store: GraphDatabase,
  input: GetMigrationContextInput
): Promise<MigrationContextResult> {
  const {
    featureContext,
    entityIds: explicitIds,
    includeSource = false,
    includeDataFlow = false,
    includeSideEffects = false,
  } = input;
  logger.debug({ featureContext, explicitIds, includeSource }, "Getting migration context");

  // 1. Resolve entity set
  let entityIds: string[] = explicitIds ?? [];

  if (featureContext && entityIds.length === 0) {
    try {
      const rows = await store.query<{ entity_id: string }>(
        `?[entity_id] :=
          *justification{entity_id, feature_context},
          feature_context != "",
          contains(feature_context, $featureContext)`,
        { featureContext }
      );
      entityIds = rows.map((r) => r.entity_id);
    } catch {
      // Continue with empty set
    }
  }

  if (entityIds.length === 0) {
    return {
      entities: [],
      internalDependencies: [],
      externalDependencies: [],
      businessRules: [],
      patterns: [],
      stats: { entityCount: 0, fileCount: 0, internalCallCount: 0, externalDepCount: 0 },
    };
  }

  // 2. Get entity details
  const entities: MigrationContextResult["entities"] = [];
  const entityIdSet = new Set(entityIds);
  const fileSet = new Set<string>();

  for (const eid of entityIds) {
    const entity = await resolveEntity(store, { entityId: eid });
    if (!entity) continue;

    fileSet.add(entity.filePath);

    const entityEntry: MigrationContextResult["entities"][number] = {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      filePath: entity.filePath,
      startLine: entity.startLine,
      endLine: entity.endLine,
      signature: entity.signature,
    };

    // Source code
    if (includeSource) {
      try {
        const content = await readFileWithEncoding(entity.filePath);
        const lines = content.split("\n");
        const start = Math.max(0, entity.startLine - 1);
        const end = Math.min(lines.length, entity.endLine);
        entityEntry.sourceCode = lines.slice(start, end).join("\n");
      } catch {
        // Skip source
      }
    }

    // Justification
    try {
      const justRows = await store.query<{
        purpose_summary: string;
        business_value: string;
        feature_context: string;
        confidence_score: number;
      }>(
        `?[purpose_summary, business_value, feature_context, confidence_score] :=
          *justification{entity_id, purpose_summary, business_value, feature_context, confidence_score},
          entity_id = $eid
        :limit 1`,
        { eid }
      );
      if (justRows.length > 0 && justRows[0]) {
        entityEntry.justification = {
          purposeSummary: justRows[0].purpose_summary,
          businessValue: justRows[0].business_value,
          featureContext: justRows[0].feature_context,
          confidence: justRows[0].confidence_score,
        };
      }
    } catch {
      // Skip justification
    }

    // Side effects
    if (includeSideEffects && entity.type === "function") {
      try {
        const seRows = await store.query<{
          category: string;
          description: string;
          target: string | null;
        }>(
          `?[category, description, target] :=
            *side_effect{function_id, category, description, target},
            function_id = $eid`,
          { eid }
        );
        if (seRows.length > 0) {
          entityEntry.sideEffects = seRows.map((s) => ({
            category: s.category,
            description: s.description,
            target: s.target ?? undefined,
          }));
        }
      } catch {
        // Skip side effects
      }
    }

    // Data flow
    if (includeDataFlow && entity.type === "function") {
      try {
        const dfRows = await store.query<{ is_pure: boolean; flow_summary_json: string }>(
          `?[is_pure, flow_summary_json] :=
            *data_flow_cache{function_id, is_pure, flow_summary_json},
            function_id = $eid
          :limit 1`,
          { eid }
        );
        if (dfRows.length > 0 && dfRows[0]) {
          entityEntry.dataFlow = {
            isPure: dfRows[0].is_pure,
            summary: dfRows[0].flow_summary_json || "{}",
          };
        }
      } catch {
        // Skip data flow
      }
    }

    entities.push(entityEntry);
  }

  // 3. Internal dependencies (calls where both are in entity set)
  const internalDependencies: MigrationContextResult["internalDependencies"] = [];
  const externalDependencies: MigrationContextResult["externalDependencies"] = [];

  try {
    const callRows = await store.query<{
      from_id: string;
      from_name: string;
      to_id: string;
      to_name: string;
    }>(
      `?[from_id, from_name, to_id, to_name] :=
        *calls{from_id, to_id},
        *function{id: from_id, name: from_name},
        *function{id: to_id, name: to_name}`
    );

    for (const row of callRows) {
      if (entityIdSet.has(row.from_id) && entityIdSet.has(row.to_id)) {
        internalDependencies.push({
          fromId: row.from_id,
          fromName: row.from_name,
          toId: row.to_id,
          toName: row.to_name,
          type: "calls",
        });
      } else if (entityIdSet.has(row.from_id) && !entityIdSet.has(row.to_id)) {
        externalDependencies.push({
          entityId: row.from_id,
          entityName: row.from_name,
          externalName: row.to_name,
          type: "calls",
        });
      }
    }
  } catch {
    // Skip calls
  }

  // 4. Ghost node (external) references
  try {
    for (const eid of entityIds) {
      const ghostRows = await store.query<{
        ghost_name: string;
        package_name: string;
      }>(
        `?[ghost_name, package_name] :=
          *references_external{from_id, to_id},
          from_id = $eid,
          *ghost_node{id: to_id, name: ghost_name, package_name}`,
        { eid }
      );
      for (const g of ghostRows) {
        const entityName = entities.find((e) => e.id === eid)?.name ?? eid;
        externalDependencies.push({
          entityId: eid,
          entityName,
          externalName: g.ghost_name,
          externalFile: g.package_name || undefined,
          type: "external_reference",
        });
      }
    }
  } catch {
    // Skip ghost nodes
  }

  // 5. Business rules (from justification.business_value)
  const businessRules: MigrationContextResult["businessRules"] = [];
  for (const e of entities) {
    if (e.justification?.businessValue && e.justification.businessValue.length > 10) {
      businessRules.push({
        entityName: e.name,
        rule: e.justification.businessValue,
        confidence: e.justification.confidence,
      });
    }
  }

  // 6. Design patterns overlapping with entity set
  const patterns: MigrationContextResult["patterns"] = [];
  try {
    const patternRows = await store.query<{
      pattern_type: string;
      name: string;
    }>(
      `?[pattern_type, name] :=
        *design_pattern{id: pattern_id, pattern_type, name},
        *pattern_participant{pattern_id, entity_name},
        entity_name in $entityNames`,
      { entityNames: entities.map((e) => e.name) }
    );
    for (const p of patternRows) {
      if (!patterns.find((pp) => pp.name === p.name)) {
        patterns.push({
          patternType: p.pattern_type,
          name: p.name,
          participants: entities.map((e) => e.name),
        });
      }
    }
  } catch {
    // Skip patterns
  }

  return {
    entities,
    internalDependencies,
    externalDependencies,
    businessRules,
    patterns,
    stats: {
      entityCount: entities.length,
      fileCount: fileSet.size,
      internalCallCount: internalDependencies.length,
      externalDepCount: externalDependencies.length,
    },
  };
}

/**
 * Analyze the transitive impact of changing an entity (multi-hop BFS).
 */
export async function analyzeBlastRadius(
  store: GraphDatabase,
  input: AnalyzeBlastRadiusInput
): Promise<BlastRadiusResult | null> {
  const { entityId, maxDepth = 3, direction = "callers" } = input;
  logger.debug({ entityId, maxDepth, direction }, "Analyzing blast radius");

  const root = await resolveEntity(store, { entityId });
  if (!root) return null;

  const visited = new Set<string>();
  visited.add(root.id);
  let frontier = [root.id];
  const hops: BlastRadiusResult["hops"] = [];
  const allFiles = new Set<string>();
  allFiles.add(root.filePath);
  const byType: Record<string, number> = {};

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (frontier.length === 0) break;

    const hopEntities: BlastRadiusResult["hops"][number]["entities"] = [];
    const nextFrontier: string[] = [];

    for (const fid of frontier) {
      // Query callers, callees, or both
      const queries: Array<{ query: string; relationship: string }> = [];

      if (direction === "callers" || direction === "both") {
        queries.push({
          query: `
            ?[caller_id, caller_name, caller_file] :=
              *calls{from_id: caller_id, to_id},
              to_id = $fid,
              *function{id: caller_id, name: caller_name, file_id},
              *file{id: file_id, path: caller_file}
          `,
          relationship: "calls",
        });
      }

      if (direction === "callees" || direction === "both") {
        queries.push({
          query: `
            ?[caller_id, caller_name, caller_file] :=
              *calls{from_id, to_id: caller_id},
              from_id = $fid,
              *function{id: caller_id, name: caller_name, file_id},
              *file{id: file_id, path: caller_file}
          `,
          relationship: "called_by",
        });
      }

      for (const { query, relationship } of queries) {
        try {
          const rows = await store.query<{
            caller_id: string;
            caller_name: string;
            caller_file: string;
          }>(query, { fid });

          for (const row of rows) {
            if (visited.has(row.caller_id)) continue;
            visited.add(row.caller_id);
            nextFrontier.push(row.caller_id);
            allFiles.add(row.caller_file);
            byType["function"] = (byType["function"] || 0) + 1;

            // Find the via entity name
            const viaEntity = entities_by_id_cache.get(fid);
            hopEntities.push({
              id: row.caller_id,
              name: row.caller_name,
              type: "function",
              filePath: row.caller_file,
              relationship,
              via: viaEntity ?? fid,
            });
          }
        } catch {
          // Skip query errors
        }
      }
    }

    if (hopEntities.length > 0) {
      hops.push({ depth, entities: hopEntities });
    }
    frontier = nextFrontier;
  }

  return {
    root: { id: root.id, name: root.name, type: root.type, filePath: root.filePath },
    maxDepth,
    direction,
    hops,
    summary: {
      totalAffected: visited.size - 1, // exclude root
      affectedFiles: [...allFiles],
      byType,
    },
  };
}

// Cache for blast radius via-entity name lookups
const entities_by_id_cache = new Map<string, string>();

/**
 * Find test files that cover a given entity.
 */
export async function getEntityTests(
  store: GraphDatabase,
  input: GetEntityTestsInput
): Promise<EntityTestsResult | null> {
  const { entityId, name, filePath } = input;
  logger.debug({ entityId, name, filePath }, "Getting entity tests");

  const entity = await resolveEntity(store, { entityId, name, filePath });
  if (!entity) return null;

  const testFiles: EntityTestsResult["testFiles"] = [];
  const entityDir = path.dirname(entity.filePath);
  const entityBaseName = path.basename(entity.filePath).replace(/\.(ts|tsx|js|jsx)$/, "");

  // Build glob patterns for potential test file locations
  const patterns = [
    path.join(entityDir, `**/*.{test,spec}.{ts,tsx,js,jsx}`),
    path.join(entityDir, `__tests__/**/*.{ts,tsx,js,jsx}`),
  ];

  // Also check project root test directories
  // Walk up to find project root (look for package.json)
  let projectRoot = entityDir;
  for (let i = 0; i < 10; i++) {
    const parent = path.dirname(projectRoot);
    if (parent === projectRoot) break;
    if (fs.existsSync(path.join(parent, "package.json"))) {
      projectRoot = parent;
      break;
    }
    projectRoot = parent;
  }

  // Relative path from project root
  const relPath = path.relative(projectRoot, entity.filePath);
  const relDir = path.dirname(relPath);
  patterns.push(
    path.join(projectRoot, "tests", relDir, `**/*.{ts,tsx,js,jsx}`),
    path.join(projectRoot, "test", relDir, `**/*.{ts,tsx,js,jsx}`)
  );

  try {
    const candidates = await fg(patterns, {
      absolute: true,
      ignore: ["**/node_modules/**"],
      suppressErrors: true,
    });

    for (const candidate of candidates) {
      let content: string;
      try {
        content = await readFileWithEncoding(candidate);
      } catch {
        continue;
      }

      const relevantLines: Array<{ lineNumber: number; content: string }> = [];
      const lines = content.split("\n");

      // Check for import of entity's file
      const hasImport = content.includes(entityBaseName) &&
        (content.includes("import") || content.includes("require"));

      // Check for entity name reference
      const hasNameRef = content.includes(entity.name);

      if (hasNameRef) {
        // Collect lines mentioning the entity name
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.includes(entity.name)) {
            relevantLines.push({ lineNumber: i + 1, content: lines[i]!.trim() });
          }
        }
      }

      let matchType: "import" | "nameReference" | "pathConvention";
      if (hasImport && hasNameRef) {
        matchType = "import";
      } else if (hasNameRef) {
        matchType = "nameReference";
      } else if (candidate.includes(entityBaseName)) {
        matchType = "pathConvention";
      } else {
        continue; // No match
      }

      testFiles.push({
        path: candidate,
        matchType,
        relevantLines: relevantLines.length > 0 ? relevantLines.slice(0, 20) : undefined,
      });
    }
  } catch (err) {
    logger.debug({ err }, "Test file glob failed");
  }

  // Score coverage
  let coverageEstimate: EntityTestsResult["coverageEstimate"] = "none";
  if (testFiles.some((t) => t.matchType === "import")) {
    coverageEstimate = "high";
  } else if (testFiles.some((t) => t.matchType === "nameReference")) {
    coverageEstimate = "medium";
  } else if (testFiles.length > 0) {
    coverageEstimate = "low";
  }

  return {
    entityId: entity.id,
    entityName: entity.name,
    filePath: entity.filePath,
    testFiles,
    coverageEstimate,
  };
}

/**
 * Add tags to an entity for migration state tracking.
 */
export async function tagEntity(
  store: GraphDatabase,
  input: TagEntityInput
): Promise<TagEntityResult> {
  const { entityId, tags, source = "user" } = input;
  logger.debug({ entityId, tags, source }, "Tagging entity");

  let added = 0;
  const now = Date.now();

  for (const tag of tags) {
    try {
      await store.execute(
        `?[entity_id, tag, source, created_at] <- [[$entityId, $tag, $source, $now]]
        :put entity_tag { entity_id, tag => source, created_at }`,
        { entityId, tag, source, now }
      );
      added++;
    } catch (err) {
      logger.warn({ err, entityId, tag }, "Failed to add tag");
    }
  }

  return {
    entityId,
    tags,
    added,
    message: `Added ${added} tag(s) to entity ${entityId}`,
  };
}

/**
 * Find all entities with a specific tag.
 */
export async function getTaggedEntities(
  store: GraphDatabase,
  input: GetTaggedEntitiesInput
): Promise<GetTaggedResult> {
  const { tag, entityType } = input;
  logger.debug({ tag, entityType }, "Getting tagged entities");

  try {
    // Get all entity_ids with this tag
    const tagRows = await store.query<{
      entity_id: string;
      tag: string;
      source: string;
    }>(
      `?[entity_id, tag, source] :=
        *entity_tag{entity_id, tag, source},
        tag = $tag`,
      { tag }
    );

    // Resolve each entity to get name, type, filePath
    const entities: GetTaggedResult["entities"] = [];

    for (const row of tagRows) {
      const entity = await resolveEntity(store, { entityId: row.entity_id });
      if (!entity) continue;
      if (entityType && entity.type !== entityType) continue;

      // Get all tags for this entity
      let allTags: string[] = [row.tag];
      try {
        const allTagRows = await store.query<{ tag: string }>(
          `?[tag] := *entity_tag{entity_id, tag}, entity_id = $eid`,
          { eid: row.entity_id }
        );
        allTags = allTagRows.map((t) => t.tag);
      } catch {
        // Use single tag
      }

      entities.push({
        id: row.entity_id,
        name: entity.name,
        type: entity.type,
        filePath: entity.filePath,
        tags: allTags,
        source: row.source,
      });
    }

    return { tag, entities, count: entities.length };
  } catch (e) {
    logger.debug({ error: e }, "Get tagged entities query failed");
    return { tag, entities: [], count: 0 };
  }
}

/**
 * Remove specific tags from an entity.
 */
export async function removeEntityTags(
  store: GraphDatabase,
  input: RemoveEntityTagsInput
): Promise<RemoveEntityTagsResult> {
  const { entityId, tags } = input;
  logger.debug({ entityId, tags }, "Removing entity tags");

  let removed = 0;
  for (const tag of tags) {
    try {
      await store.execute(
        `?[entity_id, tag] <- [[$entityId, $tag]]
        :rm entity_tag { entity_id, tag }`,
        { entityId, tag }
      );
      removed++;
    } catch (err) {
      logger.warn({ err, entityId, tag }, "Failed to remove tag");
    }
  }

  return {
    entityId,
    removed,
    message: `Removed ${removed} tag(s) from entity ${entityId}`,
  };
}

// =============================================================================
// Lazarus Migration Tools — Additional Handlers
// =============================================================================

/**
 * Resolve which entity is at a given file+line location.
 * The healer uses this to go from test error locations to knowledge graph entities.
 */
export async function resolveEntityAtLocation(
  store: GraphDatabase,
  input: ResolveEntityAtLocationInput
): Promise<ResolveEntityAtLocationResult | null> {
  const { filePath, line } = input;
  logger.debug({ filePath, line }, "Resolving entity at location");

  // Query across function/class/interface tables for entities that span the given line
  const tables = ["function", "class", "interface"] as const;
  const typeMap = { function: "function", class: "class", interface: "interface" } as const;

  for (const table of tables) {
    const hasSignature = table === "function" || table === "interface";
    const sigSelect = hasSignature ? ", signature" : "";
    try {
      const result = await store.query<Record<string, unknown>>(
        `?[id, name, file_path, start_line, end_line, language${sigSelect}] :=
          *${table}{id, name, file_id, start_line, end_line${sigSelect}},
          *file{id: file_id, path: file_path, language},
          ends_with(file_path, $filePath),
          start_line <= $line,
          end_line >= $line
        :order -start_line
        :limit 1`,
        { filePath, line }
      );
      if (result.length > 0 && result[0]) {
        const row = result[0];
        const entityId = row.id as string;

        // Fetch justification
        let justification: ResolveEntityAtLocationResult["justification"] = undefined;
        try {
          const justRows = await store.query<Record<string, unknown>>(
            `?[purpose_summary, feature_context, business_value, confidence_score] :=
              *justification{entity_id, purpose_summary, feature_context, business_value, confidence_score},
              entity_id = $entityId
            :limit 1`,
            { entityId }
          );
          if (justRows.length > 0 && justRows[0]) {
            const j = justRows[0];
            justification = {
              purposeSummary: j.purpose_summary as string,
              featureContext: j.feature_context as string,
              businessValue: j.business_value as string,
              confidence: j.confidence_score as number,
            };
          }
        } catch {
          // No justification available
        }

        return {
          entityId,
          name: row.name as string,
          entityType: typeMap[table],
          filePath: row.file_path as string,
          startLine: row.start_line as number,
          endLine: row.end_line as number,
          language: row.language as string,
          signature: hasSignature ? (row.signature as string | undefined) : undefined,
          justification,
        };
      }
    } catch {
      // Try next table
    }
  }

  // Check variable table (uses line instead of start_line/end_line)
  try {
    const result = await store.query<Record<string, unknown>>(
      `?[id, name, file_path, line, language] :=
        *variable{id, name, file_id, line},
        *file{id: file_id, path: file_path, language},
        ends_with(file_path, $filePath),
        line = $line
      :limit 1`,
      { filePath, line }
    );
    if (result.length > 0 && result[0]) {
      const row = result[0];
      return {
        entityId: row.id as string,
        name: row.name as string,
        entityType: "variable",
        filePath: row.file_path as string,
        startLine: row.line as number,
        endLine: row.line as number,
        language: row.language as string,
      };
    }
  } catch {
    // No match
  }

  return null;
}

/**
 * Get migration progress aggregated by feature — tag counts per feature for dashboard display.
 */
export async function getMigrationProgress(
  store: GraphDatabase,
  input: GetMigrationProgressInput
): Promise<MigrationProgressResult> {
  const { featureContext, tags: filterTags } = input;
  logger.debug({ featureContext, filterTags }, "Getting migration progress");

  // Get all entities grouped by feature
  let featureQuery = `
    ?[feature_context, entity_id, entity_type] :=
      *justification{entity_id, entity_type, feature_context},
      feature_context != ""
  `;
  const params: Record<string, unknown> = {};

  if (featureContext) {
    featureQuery = `
      ?[feature_context, entity_id, entity_type] :=
        *justification{entity_id, entity_type, feature_context},
        feature_context != "",
        contains(feature_context, $featureContext)
    `;
    params.featureContext = featureContext;
  }

  const entities = await store.query<Record<string, unknown>>(featureQuery, params);

  // Group entities by feature
  const featureMap = new Map<string, Set<string>>();
  for (const row of entities) {
    const fc = row.feature_context as string;
    const entityId = row.entity_id as string;
    if (!featureMap.has(fc)) featureMap.set(fc, new Set());
    featureMap.get(fc)!.add(entityId);
  }

  // Get all tags
  let tagRows: Record<string, unknown>[];
  try {
    let tagQuery = `?[entity_id, tag] := *entity_tag{entity_id, tag}`;
    if (filterTags && filterTags.length > 0) {
      tagQuery = `?[entity_id, tag] := *entity_tag{entity_id, tag}, is_in(tag, $tags)`;
      params.tags = filterTags;
    }
    tagRows = await store.query<Record<string, unknown>>(tagQuery, params);
  } catch {
    tagRows = [];
  }

  // Build tag lookup: entityId -> tags[]
  const entityTags = new Map<string, string[]>();
  for (const row of tagRows) {
    const eid = row.entity_id as string;
    const tag = row.tag as string;
    if (!entityTags.has(eid)) entityTags.set(eid, []);
    entityTags.get(eid)!.push(tag);
  }

  // Aggregate per feature
  const features: MigrationProgressResult["features"] = [];
  const overallTags: Record<string, number> = {};
  let overallTotal = 0;
  let overallTagged = 0;

  for (const [name, entityIds] of featureMap) {
    const total = entityIds.size;
    let tagged = 0;
    const tagCounts: Record<string, number> = {};

    for (const eid of entityIds) {
      const tags = entityTags.get(eid);
      if (tags && tags.length > 0) {
        tagged++;
        for (const t of tags) {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
          overallTags[t] = (overallTags[t] || 0) + 1;
        }
      }
    }

    overallTotal += total;
    overallTagged += tagged;

    features.push({
      name,
      totalEntities: total,
      taggedEntities: tagged,
      tags: tagCounts,
      progressPercent: total > 0 ? Math.round((tagged / total) * 100) : 0,
    });
  }

  features.sort((a, b) => b.totalEntities - a.totalEntities);

  return {
    features,
    overall: {
      totalEntities: overallTotal,
      taggedEntities: overallTagged,
      tags: overallTags,
      progressPercent: overallTotal > 0 ? Math.round((overallTagged / overallTotal) * 100) : 0,
    },
  };
}

/**
 * Compute inter-feature dependency ordering for migration slice planning.
 * Returns which features depend on which, based on cross-feature entity calls.
 */
export async function getSliceDependencies(
  store: GraphDatabase,
  input: GetSliceDependenciesInput
): Promise<SliceDependenciesResult> {
  const { features: filterFeatures } = input;
  logger.debug({ filterFeatures }, "Computing slice dependencies");

  // Get all entities grouped by feature with their IDs and names
  const entityRows = await store.query<Record<string, unknown>>(
    `?[feature_context, entity_id, name] :=
      *justification{entity_id, name, feature_context},
      feature_context != ""`,
    {}
  );

  // Build entity→feature and feature→entities maps
  const entityFeature = new Map<string, string>();
  const featureEntities = new Map<string, Map<string, string>>();

  for (const row of entityRows) {
    const fc = row.feature_context as string;
    const eid = row.entity_id as string;
    const name = row.name as string;

    if (filterFeatures && filterFeatures.length > 0 && !filterFeatures.some((f) => fc.includes(f))) {
      continue;
    }

    entityFeature.set(eid, fc);
    if (!featureEntities.has(fc)) featureEntities.set(fc, new Map());
    featureEntities.get(fc)!.set(eid, name);
  }

  // Get all calls between entities
  const callRows = await store.query<Record<string, unknown>>(
    `?[from_id, to_id] := *calls{from_id, to_id}`,
    {}
  );

  // Find cross-feature dependencies
  const depMap = new Map<string, Map<string, Array<{ fromName: string; toName: string }>>>();

  for (const row of callRows) {
    const fromId = row.from_id as string;
    const toId = row.to_id as string;
    const fromFeature = entityFeature.get(fromId);
    const toFeature = entityFeature.get(toId);

    if (!fromFeature || !toFeature || fromFeature === toFeature) continue;

    if (!depMap.has(fromFeature)) depMap.set(fromFeature, new Map());
    const featureDeps = depMap.get(fromFeature)!;
    if (!featureDeps.has(toFeature)) featureDeps.set(toFeature, []);

    const fromName = featureEntities.get(fromFeature)?.get(fromId) || fromId;
    const toName = featureEntities.get(toFeature)?.get(toId) || toId;
    featureDeps.get(toFeature)!.push({ fromName, toName });
  }

  // Build features result
  const features: SliceDependenciesResult["features"] = [];
  for (const [name, entities] of featureEntities) {
    const deps = depMap.get(name);
    const dependsOn: SliceDependenciesResult["features"][0]["dependsOn"] = [];
    if (deps) {
      for (const [depFeature, connections] of deps) {
        dependsOn.push({
          feature: depFeature,
          connectionCount: connections.length,
          connections: connections.slice(0, 10), // Limit for readability
        });
      }
      dependsOn.sort((a, b) => b.connectionCount - a.connectionCount);
    }
    features.push({ name, entityCount: entities.size, dependsOn });
  }

  features.sort((a, b) => a.dependsOn.length - b.dependsOn.length);

  // Topological sort for execution order
  const executionOrder: string[] = [];
  const circularDependencies: Array<{ features: string[] }> = [];
  const featureNames = new Set(featureEntities.keys());
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(feature: string, path: string[]): boolean {
    if (visited.has(feature)) return true;
    if (visiting.has(feature)) {
      // Circular dependency detected
      const cycleStart = path.indexOf(feature);
      circularDependencies.push({ features: path.slice(cycleStart).concat(feature) });
      return false;
    }

    visiting.add(feature);
    const deps = depMap.get(feature);
    if (deps) {
      for (const depFeature of deps.keys()) {
        if (featureNames.has(depFeature)) {
          visit(depFeature, [...path, feature]);
        }
      }
    }
    visiting.delete(feature);
    visited.add(feature);
    executionOrder.push(feature);
    return true;
  }

  for (const name of featureNames) {
    if (!visited.has(name)) {
      visit(name, []);
    }
  }

  return {
    features,
    executionOrder,
    circularDependencies,
  };
}

// =============================================================================
// Tool Context (for dependency injection)
// =============================================================================

export interface ToolContext {
  sessionId: string;
  observer?: import("./observer.js").MCPObserverService;
  adaptiveIndexer?: import("../core/adaptive-indexer/interfaces/IAdaptiveIndexer.js").IAdaptiveIndexer;
  justificationService?: import("../core/justification/interfaces/IJustificationService.js").IJustificationService;
  ledger?: import("../core/ledger/interfaces/IChangeLedger.js").IChangeLedger;
  indexer?: import("../core/indexer/index.js").Indexer;
  hybridSearchService?: import("../core/search/index.js").HybridSearchService;
}

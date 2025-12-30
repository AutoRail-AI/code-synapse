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
 */
export async function searchCode(
  store: GraphDatabase,
  input: SearchCodeInput
): Promise<SearchResult[]> {
  const { query, limit = 10, entityType } = input;
  logger.debug({ query, limit, entityType }, "Searching code");

  const results: SearchResult[] = [];

  // Build query based on entity type
  // Note: CozoDB doesn't have a built-in 'contains' function for substring matching
  // We use simple name matching with lowercase comparison
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
      }>(funcQuery, { limit: limit * 10 }); // Fetch more to filter client-side
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

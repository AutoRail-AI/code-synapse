/**
 * MCP Resource Definitions
 *
 * Defines the resources exposed by the MCP server for AI agents to access the knowledge graph.
 * Resources are read-only data exposed via URIs.
 *
 * @module
 */

import type { GraphDatabase } from "../core/graph/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("mcp-resources");

// =============================================================================
// Resource Types
// =============================================================================

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface FileResource {
  path: string;
  hash: string;
  language: string;
  size: number;
  lastIndexed: string;
  symbolCount: number;
}

export interface SymbolResource {
  id: string;
  name: string;
  type: "function" | "class" | "interface" | "variable";
  filePath: string;
  startLine: number;
  endLine?: number;
  signature?: string;
  isExported: boolean;
}

export interface GraphResource {
  nodes: {
    files: number;
    functions: number;
    classes: number;
    interfaces: number;
    variables: number;
  };
  edges: {
    contains: number;
    calls: number;
    imports: number;
    extends: number;
    implements: number;
  };
}

// =============================================================================
// Resource URI Handlers
// =============================================================================

interface FileRow {
  id: string;
  path: string;
  hash: string;
  language: string;
  size: number;
  last_indexed: string;
}

interface SymbolRow {
  id: string;
  name: string;
  file_path: string;
  start_line: number;
  end_line?: number;
  signature?: string;
  is_exported: boolean;
  line?: number;
}

type _CountResult = { "count(id)": number } | { "count(to_id)": number } | { "count(from_id)": number };

/**
 * Get file resource by path
 * URI: file://{path}
 */
export async function getFileResource(
  store: GraphDatabase,
  filePath: string
): Promise<FileResource | null> {
  logger.debug({ filePath }, "Getting file resource");

  const query = `
    ?[id, path, hash, language, size, last_indexed] :=
      *file{id, path, hash, language, size, last_indexed},
      ends_with(path, $filePath)
    :limit 1
  `;

  const result = await store.query<FileRow>(query, { filePath });
  if (result.length === 0) {
    return null;
  }

  const file = result[0]!;

  // Get symbol count for the file
  const symbolQuery = `
    ?[count(to_id)] :=
      *file{id: $fileId},
      *contains{from_id: $fileId, to_id}
  `;
  const symbolResult = await store.query<{ "count(to_id)": number }>(symbolQuery, {
    fileId: file.id,
  });
  const symbolCount = symbolResult[0]?.["count(to_id)"] ?? 0;

  return {
    path: file.path,
    hash: file.hash,
    language: file.language,
    size: file.size,
    lastIndexed: file.last_indexed,
    symbolCount,
  };
}

/**
 * List all file resources
 * URI: file://
 */
export async function listFileResources(
  store: GraphDatabase,
  limit = 100,
  offset = 0
): Promise<{ files: FileResource[]; total: number }> {
  logger.debug({ limit, offset }, "Listing file resources");

  // Get total count
  const countQuery = `?[count(id)] := *file{id}`;
  const countResult = await store.query<{ "count(id)": number }>(countQuery);
  const total = countResult[0]?.["count(id)"] ?? 0;

  // Get files with pagination
  const filesQuery = `
    ?[id, path, hash, language, size, last_indexed] :=
      *file{id, path, hash, language, size, last_indexed}
    :limit $limit
    :offset $offset
  `;

  const filesResult = await store.query<FileRow>(filesQuery, { limit, offset });

  const files: FileResource[] = [];
  for (const row of filesResult) {
    // Get symbol count for each file
    const symbolQuery = `
      ?[count(to_id)] :=
        *contains{from_id: $fileId, to_id}
    `;
    const symbolResult = await store.query<{ "count(to_id)": number }>(symbolQuery, {
      fileId: row.id,
    });
    const symbolCount = symbolResult[0]?.["count(to_id)"] ?? 0;

    files.push({
      path: row.path,
      hash: row.hash,
      language: row.language,
      size: row.size,
      lastIndexed: row.last_indexed,
      symbolCount,
    });
  }

  return { files, total };
}

/**
 * Get symbol resource by ID
 * URI: symbols://{id}
 */
export async function getSymbolResource(
  store: GraphDatabase,
  symbolId: string
): Promise<SymbolResource | null> {
  logger.debug({ symbolId }, "Getting symbol resource");

  // Try function first
  const funcQuery = `
    ?[id, name, file_path, start_line, end_line, signature, is_exported] :=
      *function{id, name, file_id, start_line, end_line, signature, is_exported},
      *file{id: file_id, path: file_path},
      id = $symbolId
    :limit 1
  `;
  const funcResult = await store.query<SymbolRow>(funcQuery, { symbolId });
  if (funcResult.length > 0) {
    const row = funcResult[0]!;
    return {
      id: row.id,
      name: row.name,
      type: "function",
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      signature: row.signature,
      isExported: row.is_exported,
    };
  }

  // Try class
  const classQuery = `
    ?[id, name, file_path, start_line, end_line, is_exported] :=
      *class{id, name, file_id, start_line, end_line, is_exported},
      *file{id: file_id, path: file_path},
      id = $symbolId
    :limit 1
  `;
  const classResult = await store.query<SymbolRow>(classQuery, { symbolId });
  if (classResult.length > 0) {
    const row = classResult[0]!;
    return {
      id: row.id,
      name: row.name,
      type: "class",
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      isExported: row.is_exported,
    };
  }

  // Try interface
  const ifaceQuery = `
    ?[id, name, file_path, start_line, end_line, is_exported] :=
      *interface{id, name, file_id, start_line, end_line, is_exported},
      *file{id: file_id, path: file_path},
      id = $symbolId
    :limit 1
  `;
  const ifaceResult = await store.query<SymbolRow>(ifaceQuery, { symbolId });
  if (ifaceResult.length > 0) {
    const row = ifaceResult[0]!;
    return {
      id: row.id,
      name: row.name,
      type: "interface",
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      isExported: row.is_exported,
    };
  }

  // Try variable
  const varQuery = `
    ?[id, name, file_path, line, is_exported] :=
      *variable{id, name, file_id, line, is_exported},
      *file{id: file_id, path: file_path},
      id = $symbolId
    :limit 1
  `;
  const varResult = await store.query<SymbolRow>(varQuery, { symbolId });
  if (varResult.length > 0) {
    const row = varResult[0]!;
    return {
      id: row.id,
      name: row.name,
      type: "variable",
      filePath: row.file_path,
      startLine: row.line ?? 0,
      isExported: row.is_exported,
    };
  }

  return null;
}

/**
 * List all symbols by type
 * URI: symbols://?type={type}
 */
export async function listSymbolResources(
  store: GraphDatabase,
  type?: "function" | "class" | "interface" | "variable",
  limit = 100,
  offset = 0
): Promise<{ symbols: SymbolResource[]; total: number }> {
  logger.debug({ type, limit, offset }, "Listing symbol resources");

  const symbols: SymbolResource[] = [];
  let total = 0;

  if (!type || type === "function") {
    const countQuery = `?[count(id)] := *function{id}`;
    const countResult = await store.query<{ "count(id)": number }>(countQuery);
    total += countResult[0]?.["count(id)"] ?? 0;

    const funcQuery = `
      ?[id, name, file_path, start_line, end_line, signature, is_exported] :=
        *function{id, name, file_id, start_line, end_line, signature, is_exported},
        *file{id: file_id, path: file_path}
      :limit $limit
      :offset $offset
    `;
    const funcResult = await store.query<SymbolRow>(funcQuery, { limit, offset });
    for (const row of funcResult) {
      symbols.push({
        id: row.id,
        name: row.name,
        type: "function",
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        signature: row.signature,
        isExported: row.is_exported,
      });
    }
  }

  if (!type || type === "class") {
    const countQuery = `?[count(id)] := *class{id}`;
    const countResult = await store.query<{ "count(id)": number }>(countQuery);
    total += countResult[0]?.["count(id)"] ?? 0;

    const classQuery = `
      ?[id, name, file_path, start_line, end_line, is_exported] :=
        *class{id, name, file_id, start_line, end_line, is_exported},
        *file{id: file_id, path: file_path}
      :limit $limit
      :offset $offset
    `;
    const classResult = await store.query<SymbolRow>(classQuery, { limit, offset });
    for (const row of classResult) {
      symbols.push({
        id: row.id,
        name: row.name,
        type: "class",
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        isExported: row.is_exported,
      });
    }
  }

  if (!type || type === "interface") {
    const countQuery = `?[count(id)] := *interface{id}`;
    const countResult = await store.query<{ "count(id)": number }>(countQuery);
    total += countResult[0]?.["count(id)"] ?? 0;

    const ifaceQuery = `
      ?[id, name, file_path, start_line, end_line, is_exported] :=
        *interface{id, name, file_id, start_line, end_line, is_exported},
        *file{id: file_id, path: file_path}
      :limit $limit
      :offset $offset
    `;
    const ifaceResult = await store.query<SymbolRow>(ifaceQuery, { limit, offset });
    for (const row of ifaceResult) {
      symbols.push({
        id: row.id,
        name: row.name,
        type: "interface",
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        isExported: row.is_exported,
      });
    }
  }

  if (!type || type === "variable") {
    const countQuery = `?[count(id)] := *variable{id}`;
    const countResult = await store.query<{ "count(id)": number }>(countQuery);
    total += countResult[0]?.["count(id)"] ?? 0;

    const varQuery = `
      ?[id, name, file_path, line, is_exported] :=
        *variable{id, name, file_id, line, is_exported},
        *file{id: file_id, path: file_path}
      :limit $limit
      :offset $offset
    `;
    const varResult = await store.query<SymbolRow>(varQuery, { limit, offset });
    for (const row of varResult) {
      symbols.push({
        id: row.id,
        name: row.name,
        type: "variable",
        filePath: row.file_path,
        startLine: row.line ?? 0,
        isExported: row.is_exported,
      });
    }
  }

  return { symbols, total };
}

/**
 * Get graph overview resource
 * URI: graph://
 */
export async function getGraphResource(store: GraphDatabase): Promise<GraphResource> {
  logger.debug("Getting graph resource");

  type NodeCount = { "count(id)": number };
  type EdgeCount = { "count(from_id)": number };

  // Get node counts
  const [filesCount, functionsCount, classesCount, interfacesCount, variablesCount] =
    await Promise.all([
      store.query<NodeCount>(`?[count(id)] := *file{id}`),
      store.query<NodeCount>(`?[count(id)] := *function{id}`),
      store.query<NodeCount>(`?[count(id)] := *class{id}`),
      store.query<NodeCount>(`?[count(id)] := *interface{id}`),
      store.query<NodeCount>(`?[count(id)] := *variable{id}`),
    ]);

  // Get edge counts
  const [containsCount, callsCount, importsCount, extendsCount, implementsCount] =
    await Promise.all([
      store.query<EdgeCount>(`?[count(from_id)] := *contains{from_id}`),
      store.query<EdgeCount>(`?[count(from_id)] := *calls{from_id}`),
      store.query<EdgeCount>(`?[count(from_id)] := *imports{from_id}`),
      store.query<EdgeCount>(`?[count(from_id)] := *extends{from_id}`),
      store.query<EdgeCount>(`?[count(from_id)] := *implements{from_id}`),
    ]);

  return {
    nodes: {
      files: filesCount[0]?.["count(id)"] ?? 0,
      functions: functionsCount[0]?.["count(id)"] ?? 0,
      classes: classesCount[0]?.["count(id)"] ?? 0,
      interfaces: interfacesCount[0]?.["count(id)"] ?? 0,
      variables: variablesCount[0]?.["count(id)"] ?? 0,
    },
    edges: {
      contains: containsCount[0]?.["count(from_id)"] ?? 0,
      calls: callsCount[0]?.["count(from_id)"] ?? 0,
      imports: importsCount[0]?.["count(from_id)"] ?? 0,
      extends: extendsCount[0]?.["count(from_id)"] ?? 0,
      implements: implementsCount[0]?.["count(from_id)"] ?? 0,
    },
  };
}

/**
 * Get list of available resource definitions
 */
export function getResourceDefinitions(): ResourceDefinition[] {
  return [
    {
      uri: "file://",
      name: "Files",
      description: "List all indexed files in the project",
      mimeType: "application/json",
    },
    {
      uri: "file://{path}",
      name: "File",
      description: "Get details for a specific file by path",
      mimeType: "application/json",
    },
    {
      uri: "symbols://",
      name: "Symbols",
      description: "List all symbols (functions, classes, interfaces, variables)",
      mimeType: "application/json",
    },
    {
      uri: "symbols://{id}",
      name: "Symbol",
      description: "Get details for a specific symbol by ID",
      mimeType: "application/json",
    },
    {
      uri: "graph://",
      name: "Graph Overview",
      description: "Get graph statistics (node and edge counts)",
      mimeType: "application/json",
    },
  ];
}

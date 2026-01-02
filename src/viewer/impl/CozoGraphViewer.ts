/**
 * CozoGraphViewer - Read-Only Implementation of IGraphViewer
 *
 * This implementation uses IGraphStore.query() ONLY for all operations.
 * It NEVER uses writeBatch(), execute(), or transaction() methods.
 *
 * Design:
 * - Read-only: Cannot modify any data in the graph
 * - Black-box: Does not know internal details of IGraphStore
 * - Replaceable: Can be swapped without affecting core
 *
 * @module
 */

import type { IGraphStore } from "../../core/interfaces/IGraphStore.js";
import type {
  IGraphViewer,
  OverviewStats,
  EntityCounts,
  RelationshipCounts,
  LanguageDistribution,
  FileInfo,
  FunctionInfo,
  ClassInfo,
  InterfaceInfo,
  CallGraphNode,
  ImportGraphNode,
  InheritanceNode,
  SearchResult,
  SimilarityResult,
  ComplexityDistribution,
  ExternalDependency,
  IndexHealth,
  ListOptions,
  EntityType,
} from "../interfaces/IGraphViewer.js";
import type { NLSearchResponse, NLSearchConfig } from "../nl-search/types.js";
import { createNLSearchService, type NaturalLanguageSearchService } from "../nl-search/nl-search-service.js";

// =============================================================================
// CozoGraphViewer Implementation
// =============================================================================

/**
 * CozoGraphViewer - Read-only viewer for indexed code knowledge
 *
 * @example
 * ```typescript
 * const viewer = new CozoGraphViewer(graphStore);
 * await viewer.initialize();
 *
 * const stats = await viewer.getOverviewStats();
 * console.log(`Indexed ${stats.totalFiles} files`);
 *
 * const functions = await viewer.listFunctions({ limit: 20 });
 * ```
 */
export class CozoGraphViewer implements IGraphViewer {
  private store: IGraphStore;
  private _isReady = false;
  private nlSearchService: NaturalLanguageSearchService | null = null;
  private nlSearchConfig?: NLSearchConfig;

  constructor(store: IGraphStore, nlSearchConfig?: NLSearchConfig) {
    this.store = store;
    this.nlSearchConfig = nlSearchConfig;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  get isReady(): boolean {
    return this._isReady && this.store.isReady;
  }

  async initialize(): Promise<void> {
    if (!this.store.isReady) {
      await this.store.initialize();
    }
    this._isReady = true;
  }

  async close(): Promise<void> {
    this._isReady = false;
    // Don't close the store - we don't own it
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  async getOverviewStats(): Promise<OverviewStats> {
    const [entities, relationships, languages, embeddings] = await Promise.all([
      this.getEntityCounts(),
      this.getRelationshipCounts(),
      this.getLanguageDistribution(),
      this.getEmbeddingCount(),
    ]);

    const totalRelationships =
      relationships.contains +
      relationships.calls +
      relationships.imports +
      relationships.extends +
      relationships.implements +
      relationships.hasMethod +
      relationships.usesType +
      relationships.referencesExternal;

    const totalSize = await this.getTotalFileSize();

    return {
      totalFiles: entities.files,
      totalFunctions: entities.functions,
      totalClasses: entities.classes,
      totalInterfaces: entities.interfaces,
      totalTypeAliases: entities.typeAliases,
      totalVariables: entities.variables,
      totalRelationships,
      embeddingCoverage: entities.functions > 0 ? embeddings / entities.functions : 0,
      totalSizeBytes: totalSize,
      languages: languages.map((l) => l.language),
    };
  }

  async getEntityCounts(): Promise<EntityCounts> {
    type CountResult = { "count(id)": number };

    try {
      // Query each entity type separately (matching status command pattern)
      const [files, functions, classes, interfaces, typeAliases, variables, ghostNodes] =
        await Promise.all([
          this.store.query<CountResult>(`?[count(id)] := *file{id}`),
          this.store.query<CountResult>(`?[count(id)] := *function{id}`),
          this.store.query<CountResult>(`?[count(id)] := *class{id}`),
          this.store.query<CountResult>(`?[count(id)] := *interface{id}`),
          this.store.query<CountResult>(`?[count(id)] := *type_alias{id}`),
          this.store.query<CountResult>(`?[count(id)] := *variable{id}`),
          this.store.query<CountResult>(`?[count(id)] := *ghost_node{id}`),
        ]);

      return {
        files: files.rows[0]?.["count(id)"] ?? 0,
        functions: functions.rows[0]?.["count(id)"] ?? 0,
        classes: classes.rows[0]?.["count(id)"] ?? 0,
        interfaces: interfaces.rows[0]?.["count(id)"] ?? 0,
        typeAliases: typeAliases.rows[0]?.["count(id)"] ?? 0,
        variables: variables.rows[0]?.["count(id)"] ?? 0,
        ghostNodes: ghostNodes.rows[0]?.["count(id)"] ?? 0,
      };
    } catch {
      // Return zeros if tables don't exist yet
      return {
        files: 0,
        functions: 0,
        classes: 0,
        interfaces: 0,
        typeAliases: 0,
        variables: 0,
        ghostNodes: 0,
      };
    }
  }

  async getRelationshipCounts(): Promise<RelationshipCounts> {
    type CountResult = { "count(from_id)": number };

    try {
      // Query each relationship type separately (all use from_id)
      const [contains, calls, imports, extendsRel, implementsRel, hasMethod, usesType, refsExternal] =
        await Promise.all([
          this.store.query<CountResult>(`?[count(from_id)] := *contains{from_id}`),
          this.store.query<CountResult>(`?[count(from_id)] := *calls{from_id}`),
          this.store.query<CountResult>(`?[count(from_id)] := *imports{from_id}`),
          this.store.query<CountResult>(`?[count(from_id)] := *extends{from_id}`),
          this.store.query<CountResult>(`?[count(from_id)] := *implements{from_id}`),
          this.store.query<CountResult>(`?[count(from_id)] := *has_method{from_id}`),
          this.store.query<CountResult>(`?[count(from_id)] := *uses_type{from_id}`),
          this.store.query<CountResult>(`?[count(from_id)] := *references_external{from_id}`),
        ]);

      return {
        contains: contains.rows[0]?.["count(from_id)"] ?? 0,
        calls: calls.rows[0]?.["count(from_id)"] ?? 0,
        imports: imports.rows[0]?.["count(from_id)"] ?? 0,
        extends: extendsRel.rows[0]?.["count(from_id)"] ?? 0,
        implements: implementsRel.rows[0]?.["count(from_id)"] ?? 0,
        hasMethod: hasMethod.rows[0]?.["count(from_id)"] ?? 0,
        usesType: usesType.rows[0]?.["count(from_id)"] ?? 0,
        referencesExternal: refsExternal.rows[0]?.["count(from_id)"] ?? 0,
      };
    } catch {
      return {
        contains: 0,
        calls: 0,
        imports: 0,
        extends: 0,
        implements: 0,
        hasMethod: 0,
        usesType: 0,
        referencesExternal: 0,
      };
    }
  }

  async getLanguageDistribution(): Promise<LanguageDistribution[]> {
    // In CozoDB, aggregation functions must be in the HEAD (output), not body
    // This groups by language and counts files per language
    const script = `?[language, count(id)] := *file{id, language} :order -count(id)`;

    try {
      const result = await this.store.query<{
        language: string;
        "count(id)": number;
      }>(script);

      // Calculate totals and percentages in JavaScript
      const totalFiles = result.rows.reduce((sum, row) => sum + row["count(id)"], 0);

      return result.rows.map((row) => ({
        language: row.language,
        fileCount: row["count(id)"],
        totalSize: 0, // Size aggregation computed separately if needed
        percentage: totalFiles > 0 ? (row["count(id)"] * 100.0) / totalFiles : 0,
      }));
    } catch {
      return [];
    }
  }

  private async getEmbeddingCount(): Promise<number> {
    // Aggregation must be in HEAD, not body
    const script = `?[count(function_id)] := *function_embedding{function_id}`;
    try {
      const result = await this.store.query<{ "count(function_id)": number }>(script);
      return result.rows[0]?.["count(function_id)"] ?? 0;
    } catch {
      return 0;
    }
  }

  private async getTotalFileSize(): Promise<number> {
    // CozoDB doesn't have sum(), so fetch all sizes and calculate in JavaScript
    const script = `?[size] := *file{size}`;
    try {
      const result = await this.store.query<{ size: number }>(script);
      return result.rows.reduce((total, row) => total + (row.size ?? 0), 0);
    } catch {
      return 0;
    }
  }

  // ===========================================================================
  // Entity Browsing
  // ===========================================================================

  async listFiles(options?: ListOptions): Promise<FileInfo[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const orderBy = options?.orderBy ?? "relative_path";
    const orderDir = options?.orderDirection === "desc" ? "-" : "";

    // Simple file list query (entity counts require separate aggregation)
    const script = `
      ?[id, path, relative_path, language, framework, size, last_modified] :=
        *file{id, path, relative_path, language, framework, size, last_modified}
      :order ${orderDir}${orderBy}
      :limit ${limit}
      :offset ${offset}
    `;

    try {
      const result = await this.store.query<{
        id: string;
        path: string;
        relative_path: string;
        language: string;
        framework: string | null;
        size: number;
        last_modified: number;
      }>(script);

      return result.rows.map((row) => ({
        id: row.id,
        path: row.path,
        relativePath: row.relative_path,
        language: row.language,
        framework: row.framework ?? undefined,
        size: row.size,
        entityCount: 0, // Simplified - would need separate query
        lastModified: new Date(row.last_modified),
      }));
    } catch {
      return [];
    }
  }

  async getFile(id: string): Promise<FileInfo | null> {
    // Simple file lookup
    const script = `
      ?[id, path, relative_path, language, framework, size, last_modified] :=
        *file{id, path, relative_path, language, framework, size, last_modified},
        id = $id
    `;

    try {
      const result = await this.store.query<{
        id: string;
        path: string;
        relative_path: string;
        language: string;
        framework: string | null;
        size: number;
        last_modified: number;
      }>(script, { id });

      if (result.rows.length === 0) return null;

      const row = result.rows[0]!;
      return {
        id: row.id,
        path: row.path,
        relativePath: row.relative_path,
        language: row.language,
        framework: row.framework ?? undefined,
        size: row.size,
        entityCount: 0, // Simplified
        lastModified: new Date(row.last_modified),
      };
    } catch {
      return null;
    }
  }

  async listFunctions(options?: ListOptions): Promise<FunctionInfo[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const orderBy = options?.orderBy ?? "name";
    const orderDir = options?.orderDirection === "desc" ? "-" : "";

    // Simple function list - call counts would need separate aggregation
    const script = `
      ?[id, name, file_id, file_path, signature, start_line, end_line, complexity, is_exported, is_async, is_generator, doc_comment] :=
        *function{id, name, file_id, signature, start_line, end_line, complexity, is_exported, is_async, is_generator, doc_comment},
        *file{id: file_id, relative_path: file_path}
      :order ${orderDir}${orderBy}
      :limit ${limit}
      :offset ${offset}
    `;

    try {
      const result = await this.store.query<{
        id: string;
        name: string;
        file_id: string;
        file_path: string;
        signature: string;
        start_line: number;
        end_line: number;
        complexity: number;
        is_exported: boolean;
        is_async: boolean;
        is_generator: boolean;
        doc_comment: string | null;
      }>(script);

      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        fileId: row.file_id,
        filePath: row.file_path,
        signature: row.signature,
        startLine: row.start_line,
        endLine: row.end_line,
        complexity: row.complexity,
        isExported: row.is_exported,
        isAsync: row.is_async,
        isGenerator: row.is_generator,
        docComment: row.doc_comment ?? undefined,
        callCount: 0, // Simplified
        hasEmbedding: false, // Simplified
      }));
    } catch {
      return [];
    }
  }

  async getFunction(id: string): Promise<FunctionInfo | null> {
    // Simple function lookup
    const script = `
      ?[id, name, file_id, file_path, signature, start_line, end_line, complexity, is_exported, is_async, is_generator, doc_comment] :=
        *function{id, name, file_id, signature, start_line, end_line, complexity, is_exported, is_async, is_generator, doc_comment},
        id = $id,
        *file{id: file_id, relative_path: file_path}
    `;

    try {
      const result = await this.store.query<{
        id: string;
        name: string;
        file_id: string;
        file_path: string;
        signature: string;
        start_line: number;
        end_line: number;
        complexity: number;
        is_exported: boolean;
        is_async: boolean;
        is_generator: boolean;
        doc_comment: string | null;
      }>(script, { id });

      if (result.rows.length === 0) return null;

      const row = result.rows[0]!;
      return {
        id: row.id,
        name: row.name,
        fileId: row.file_id,
        filePath: row.file_path,
        signature: row.signature,
        startLine: row.start_line,
        endLine: row.end_line,
        complexity: row.complexity,
        isExported: row.is_exported,
        isAsync: row.is_async,
        isGenerator: row.is_generator,
        docComment: row.doc_comment ?? undefined,
        callCount: 0, // Simplified
        hasEmbedding: false, // Simplified
      };
    } catch {
      return null;
    }
  }

  async getFunctionsByFile(fileId: string): Promise<FunctionInfo[]> {
    // Simple query - get functions in a file
    const script = `
      ?[id, name, file_id, file_path, signature, start_line, end_line, complexity, is_exported, is_async, is_generator, doc_comment] :=
        *function{id, name, file_id, signature, start_line, end_line, complexity, is_exported, is_async, is_generator, doc_comment},
        file_id = $fileId,
        *file{id: file_id, relative_path: file_path}
      :order start_line
    `;

    try {
      const result = await this.store.query<{
        id: string;
        name: string;
        file_id: string;
        file_path: string;
        signature: string;
        start_line: number;
        end_line: number;
        complexity: number;
        is_exported: boolean;
        is_async: boolean;
        is_generator: boolean;
        doc_comment: string | null;
      }>(script, { fileId });

      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        fileId: row.file_id,
        filePath: row.file_path,
        signature: row.signature,
        startLine: row.start_line,
        endLine: row.end_line,
        complexity: row.complexity,
        isExported: row.is_exported,
        isAsync: row.is_async,
        isGenerator: row.is_generator,
        docComment: row.doc_comment ?? undefined,
        callCount: 0, // Simplified
        hasEmbedding: false, // Simplified
      }));
    } catch {
      return [];
    }
  }

  async listClasses(options?: ListOptions): Promise<ClassInfo[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const orderBy = options?.orderBy ?? "name";
    const orderDir = options?.orderDirection === "desc" ? "-" : "";

    // Simple class list query
    const script = `
      ?[id, name, file_id, file_path, start_line, end_line, is_exported, is_abstract, extends_class, implements_interfaces, doc_comment] :=
        *class{id, name, file_id, start_line, end_line, is_exported, is_abstract, extends: extends_class, implements: implements_interfaces, doc_comment},
        *file{id: file_id, relative_path: file_path}
      :order ${orderDir}${orderBy}
      :limit ${limit}
      :offset ${offset}
    `;

    try {
      const result = await this.store.query<{
        id: string;
        name: string;
        file_id: string;
        file_path: string;
        start_line: number;
        end_line: number;
        is_exported: boolean;
        is_abstract: boolean;
        extends_class: string | null;
        implements_interfaces: string[];
        doc_comment: string | null;
      }>(script);

      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        fileId: row.file_id,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        isExported: row.is_exported,
        isAbstract: row.is_abstract,
        extendsClass: row.extends_class ?? undefined,
        implementsInterfaces: row.implements_interfaces ?? [],
        methodCount: 0, // Simplified
        docComment: row.doc_comment ?? undefined,
      }));
    } catch {
      return [];
    }
  }

  async getClass(id: string): Promise<ClassInfo | null> {
    // Simple class lookup
    const script = `
      ?[id, name, file_id, file_path, start_line, end_line, is_exported, is_abstract, extends_class, implements_interfaces, doc_comment] :=
        *class{id, name, file_id, start_line, end_line, is_exported, is_abstract, extends: extends_class, implements: implements_interfaces, doc_comment},
        id = $id,
        *file{id: file_id, relative_path: file_path}
    `;

    try {
      const result = await this.store.query<{
        id: string;
        name: string;
        file_id: string;
        file_path: string;
        start_line: number;
        end_line: number;
        is_exported: boolean;
        is_abstract: boolean;
        extends_class: string | null;
        implements_interfaces: string[];
        doc_comment: string | null;
      }>(script, { id });

      if (result.rows.length === 0) return null;

      const row = result.rows[0]!;
      return {
        id: row.id,
        name: row.name,
        fileId: row.file_id,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        isExported: row.is_exported,
        isAbstract: row.is_abstract,
        extendsClass: row.extends_class ?? undefined,
        implementsInterfaces: row.implements_interfaces ?? [],
        methodCount: 0, // Simplified
        docComment: row.doc_comment ?? undefined,
      };
    } catch {
      return null;
    }
  }

  async listInterfaces(options?: ListOptions): Promise<InterfaceInfo[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const orderBy = options?.orderBy ?? "name";
    const orderDir = options?.orderDirection === "desc" ? "-" : "";

    const script = `
      ?[id, name, file_id, file_path, start_line, end_line, is_exported, extends_interfaces, doc_comment, property_count] :=
        *interface{id, name, file_id, start_line, end_line, is_exported, extends_interfaces, doc_comment, properties},
        *file{id: file_id, relative_path: file_path},
        property_count = if(is_null(properties), 0, length(properties))

      :order ${orderDir}${orderBy}
      :limit ${limit}
      :offset ${offset}
    `;

    try {
      const result = await this.store.query<{
        id: string;
        name: string;
        file_id: string;
        file_path: string;
        start_line: number;
        end_line: number;
        is_exported: boolean;
        extends_interfaces: string[];
        doc_comment: string | null;
        property_count: number;
      }>(script);

      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        fileId: row.file_id,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        isExported: row.is_exported,
        extendsInterfaces: row.extends_interfaces ?? [],
        propertyCount: row.property_count,
        docComment: row.doc_comment ?? undefined,
      }));
    } catch {
      return [];
    }
  }

  async getInterface(id: string): Promise<InterfaceInfo | null> {
    const script = `
      ?[id, name, file_id, file_path, start_line, end_line, is_exported, extends_interfaces, doc_comment, property_count] :=
        *interface{id, name, file_id, start_line, end_line, is_exported, extends_interfaces, doc_comment, properties},
        id = $id,
        *file{id: file_id, relative_path: file_path},
        property_count = if(is_null(properties), 0, length(properties))
    `;

    try {
      const result = await this.store.query<{
        id: string;
        name: string;
        file_id: string;
        file_path: string;
        start_line: number;
        end_line: number;
        is_exported: boolean;
        extends_interfaces: string[];
        doc_comment: string | null;
        property_count: number;
      }>(script, { id });

      if (result.rows.length === 0) return null;

      const row = result.rows[0]!;
      return {
        id: row.id,
        name: row.name,
        fileId: row.file_id,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        isExported: row.is_exported,
        extendsInterfaces: row.extends_interfaces ?? [],
        propertyCount: row.property_count,
        docComment: row.doc_comment ?? undefined,
      };
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Relationship Browsing
  // ===========================================================================

  async getCallGraph(functionId: string, _depth: number = 2): Promise<CallGraphNode> {
    // Get the root function
    const rootFn = await this.getFunction(functionId);
    if (!rootFn) {
      return {
        id: functionId,
        name: "Unknown",
        signature: "",
        filePath: "",
        depth: 0,
        callees: [],
        callers: [],
      };
    }

    // Get callees and callers (simplified for now, no recursion)
    const [callees, callers] = await Promise.all([
      this.getCallees(functionId),
      this.getCallers(functionId),
    ]);

    return {
      id: rootFn.id,
      name: rootFn.name,
      signature: rootFn.signature,
      filePath: rootFn.filePath,
      depth: 0,
      callees: callees.map((fn) => ({
        id: fn.id,
        name: fn.name,
        signature: fn.signature,
        filePath: fn.filePath,
        depth: 1,
        callees: [],
        callers: [],
      })),
      callers: callers.map((fn) => ({
        id: fn.id,
        name: fn.name,
        signature: fn.signature,
        filePath: fn.filePath,
        depth: 1,
        callees: [],
        callers: [],
      })),
    };
  }

  async getCallers(functionId: string): Promise<FunctionInfo[]> {
    const script = `
      ?[id, name, file_id, file_path, signature, start_line, end_line, complexity, is_exported, is_async, is_generator] :=
        *calls{from_id: id, to_id},
        to_id = $functionId,
        *function{id, name, file_id, signature, start_line, end_line, complexity, is_exported, is_async, is_generator},
        *file{id: file_id, relative_path: file_path}
    `;

    try {
      const result = await this.store.query<{
        id: string;
        name: string;
        file_id: string;
        file_path: string;
        signature: string;
        start_line: number;
        end_line: number;
        complexity: number;
        is_exported: boolean;
        is_async: boolean;
        is_generator: boolean;
      }>(script, { functionId });

      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        fileId: row.file_id,
        filePath: row.file_path,
        signature: row.signature,
        startLine: row.start_line,
        endLine: row.end_line,
        complexity: row.complexity,
        isExported: row.is_exported,
        isAsync: row.is_async,
        isGenerator: row.is_generator,
        callCount: 0,
        hasEmbedding: false,
      }));
    } catch {
      return [];
    }
  }

  async getCallees(functionId: string): Promise<FunctionInfo[]> {
    const script = `
      ?[id, name, file_id, file_path, signature, start_line, end_line, complexity, is_exported, is_async, is_generator] :=
        *calls{from_id, to_id: id},
        from_id = $functionId,
        *function{id, name, file_id, signature, start_line, end_line, complexity, is_exported, is_async, is_generator},
        *file{id: file_id, relative_path: file_path}
    `;

    try {
      const result = await this.store.query<{
        id: string;
        name: string;
        file_id: string;
        file_path: string;
        signature: string;
        start_line: number;
        end_line: number;
        complexity: number;
        is_exported: boolean;
        is_async: boolean;
        is_generator: boolean;
      }>(script, { functionId });

      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        fileId: row.file_id,
        filePath: row.file_path,
        signature: row.signature,
        startLine: row.start_line,
        endLine: row.end_line,
        complexity: row.complexity,
        isExported: row.is_exported,
        isAsync: row.is_async,
        isGenerator: row.is_generator,
        callCount: 0,
        hasEmbedding: false,
      }));
    } catch {
      return [];
    }
  }

  async getImportGraph(fileId: string, _depth: number = 2): Promise<ImportGraphNode> {
    const rootFile = await this.getFile(fileId);
    if (!rootFile) {
      return {
        id: fileId,
        path: "Unknown",
        relativePath: "Unknown",
        depth: 0,
        imports: [],
        importedBy: [],
      };
    }

    const [imports, importers] = await Promise.all([
      this.getImports(fileId),
      this.getImporters(fileId),
    ]);

    return {
      id: rootFile.id,
      path: rootFile.path,
      relativePath: rootFile.relativePath,
      depth: 0,
      imports: imports.map((f) => ({
        id: f.id,
        path: f.path,
        relativePath: f.relativePath,
        depth: 1,
        imports: [],
        importedBy: [],
      })),
      importedBy: importers.map((f) => ({
        id: f.id,
        path: f.path,
        relativePath: f.relativePath,
        depth: 1,
        imports: [],
        importedBy: [],
      })),
    };
  }

  async getImporters(fileId: string): Promise<FileInfo[]> {
    const script = `
      ?[id, path, relative_path, language, framework, size, last_modified] :=
        *imports{from_id: id, to_id},
        to_id = $fileId,
        *file{id, path, relative_path, language, framework, size, last_modified}
    `;

    try {
      const result = await this.store.query<{
        id: string;
        path: string;
        relative_path: string;
        language: string;
        framework: string | null;
        size: number;
        last_modified: number;
      }>(script, { fileId });

      return result.rows.map((row) => ({
        id: row.id,
        path: row.path,
        relativePath: row.relative_path,
        language: row.language,
        framework: row.framework ?? undefined,
        size: row.size,
        entityCount: 0,
        lastModified: new Date(row.last_modified),
      }));
    } catch {
      return [];
    }
  }

  async getImports(fileId: string): Promise<FileInfo[]> {
    const script = `
      ?[id, path, relative_path, language, framework, size, last_modified] :=
        *imports{from_id, to_id: id},
        from_id = $fileId,
        *file{id, path, relative_path, language, framework, size, last_modified}
    `;

    try {
      const result = await this.store.query<{
        id: string;
        path: string;
        relative_path: string;
        language: string;
        framework: string | null;
        size: number;
        last_modified: number;
      }>(script, { fileId });

      return result.rows.map((row) => ({
        id: row.id,
        path: row.path,
        relativePath: row.relative_path,
        language: row.language,
        framework: row.framework ?? undefined,
        size: row.size,
        entityCount: 0,
        lastModified: new Date(row.last_modified),
      }));
    } catch {
      return [];
    }
  }

  async getInheritanceTree(classId: string): Promise<InheritanceNode> {
    const cls = await this.getClass(classId);
    if (!cls) {
      return {
        id: classId,
        name: "Unknown",
        filePath: "",
        isAbstract: false,
        children: [],
      };
    }

    // Get child classes
    const script = `
      ?[id, name, file_path, is_abstract] :=
        *extends{from_id: id, to_id},
        to_id = $classId,
        *class{id, name, file_id, is_abstract},
        *file{id: file_id, relative_path: file_path}
    `;

    try {
      const result = await this.store.query<{
        id: string;
        name: string;
        file_path: string;
        is_abstract: boolean;
      }>(script, { classId });

      return {
        id: cls.id,
        name: cls.name,
        filePath: cls.filePath,
        isAbstract: cls.isAbstract,
        children: result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          filePath: row.file_path,
          isAbstract: row.is_abstract,
          children: [],
        })),
      };
    } catch {
      return {
        id: cls.id,
        name: cls.name,
        filePath: cls.filePath,
        isAbstract: cls.isAbstract,
        children: [],
      };
    }
  }

  // ===========================================================================
  // Search
  // ===========================================================================

  async searchByName(pattern: string, entityType: EntityType = "all"): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    // Escape special regex characters and build a substring pattern
    const escapedPattern = pattern.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regexPattern = `.*${escapedPattern}.*`;

    if (entityType === "all" || entityType === "function") {
      const script = `
        ?[id, name, file_path, start_line] :=
          *function{id, name, file_id, start_line},
          *file{id: file_id, relative_path: file_path},
          regex_matches(lowercase(name), $pattern)
        :limit 50
      `;
      try {
        const fnResult = await this.store.query<{
          id: string;
          name: string;
          file_path: string;
          start_line: number;
        }>(script, { pattern: regexPattern });

        results.push(
          ...fnResult.rows.map((row) => ({
            entityType: "function" as const,
            id: row.id,
            name: row.name,
            filePath: row.file_path,
            line: row.start_line,
            matchScore: 1.0,
          }))
        );
      } catch {
        // Ignore errors
      }
    }

    if (entityType === "all" || entityType === "class") {
      const script = `
        ?[id, name, file_path, start_line] :=
          *class{id, name, file_id, start_line},
          *file{id: file_id, relative_path: file_path},
          regex_matches(lowercase(name), $pattern)
        :limit 50
      `;
      try {
        const clsResult = await this.store.query<{
          id: string;
          name: string;
          file_path: string;
          start_line: number;
        }>(script, { pattern: regexPattern });

        results.push(
          ...clsResult.rows.map((row) => ({
            entityType: "class" as const,
            id: row.id,
            name: row.name,
            filePath: row.file_path,
            line: row.start_line,
            matchScore: 1.0,
          }))
        );
      } catch {
        // Ignore errors
      }
    }

    if (entityType === "all" || entityType === "interface") {
      const script = `
        ?[id, name, file_path, start_line] :=
          *interface{id, name, file_id, start_line},
          *file{id: file_id, relative_path: file_path},
          regex_matches(lowercase(name), $pattern)
        :limit 50
      `;
      try {
        const ifaceResult = await this.store.query<{
          id: string;
          name: string;
          file_path: string;
          start_line: number;
        }>(script, { pattern: regexPattern });

        results.push(
          ...ifaceResult.rows.map((row) => ({
            entityType: "interface" as const,
            id: row.id,
            name: row.name,
            filePath: row.file_path,
            line: row.start_line,
            matchScore: 1.0,
          }))
        );
      } catch {
        // Ignore errors
      }
    }

    if (entityType === "all" || entityType === "file") {
      const script = `
        ?[id, relative_path] :=
          *file{id, relative_path},
          contains(lowercase(relative_path), $pattern)
        :limit 50
      `;
      try {
        const fileResult = await this.store.query<{
          id: string;
          relative_path: string;
        }>(script, { pattern: regexPattern });

        results.push(
          ...fileResult.rows.map((row) => ({
            entityType: "file" as const,
            id: row.id,
            name: row.relative_path.split("/").pop() || row.relative_path,
            filePath: row.relative_path,
            matchScore: 1.0,
          }))
        );
      } catch {
        // Ignore errors
      }
    }

    return results;
  }

  async searchBySimilarity(embedding: number[], k: number = 10): Promise<SimilarityResult[]> {
    // Use vector search on function embeddings
    try {
      const results = await this.store.vectorSearch(embedding, k);
      return results.map((r) => ({
        id: r.id,
        name: r.name || "Unknown",
        filePath: r.fileId || "",
        signature: "",
        distance: r.distance,
        similarity: 1 / (1 + r.distance),
      }));
    } catch {
      return [];
    }
  }

  async searchNatural(
    query: string,
    options?: {
      entityType?: EntityType;
      limit?: number;
      useEmbeddings?: boolean;
    }
  ): Promise<SearchResult[]> {
    // Delegate to nlSearch and convert to SearchResult[]
    const response = await this.nlSearch(query);
    return response.results.map((r) => ({
      entityType: r.entityType === "relationship" ? "function" : r.entityType,
      id: r.id,
      name: r.name,
      filePath: r.filePath,
      line: r.line,
      matchScore: r.relevanceScore,
      snippet: r.context,
    }));
  }

  /**
   * Natural language search with full response
   *
   * Returns detailed search response including:
   * - Intent classification
   * - Relevance scores
   * - Search suggestions
   *
   * @param query - Natural language query
   * @returns Full NL search response
   *
   * @example
   * ```typescript
   * const response = await viewer.nlSearch("what calls authenticate");
   * console.log(`Intent: ${response.intent.intent}`);
   * console.log(`Found ${response.totalCount} results`);
   * ```
   */
  async nlSearch(query: string): Promise<NLSearchResponse> {
    // Lazily create the NL search service
    if (!this.nlSearchService) {
      this.nlSearchService = createNLSearchService(this.store, this.nlSearchConfig);
    }

    return this.nlSearchService.search(query);
  }

  /**
   * Get available NL search patterns for help
   */
  getNLSearchPatterns(): Array<{ pattern: string; description: string; example: string }> {
    if (!this.nlSearchService) {
      this.nlSearchService = createNLSearchService(this.store, this.nlSearchConfig);
    }
    return this.nlSearchService.getSearchPatterns();
  }

  // ===========================================================================
  // Analysis
  // ===========================================================================

  async getComplexityDistribution(): Promise<ComplexityDistribution> {
    try {
      // Get all function complexities and calculate stats in JavaScript
      // (CozoDB doesn't have sum/mean/max aggregation functions)
      const allComplexities = await this.store.query<{ complexity: number }>(
        `?[complexity] := *function{complexity}`
      );

      if (allComplexities.rows.length === 0) {
        return {
          buckets: [],
          average: 0,
          maximum: 0,
          highComplexityCount: 0,
        };
      }

      const complexities = allComplexities.rows.map((r) => r.complexity);
      const total = complexities.length;

      // Calculate buckets (0-5, 5-10, 10-15, etc.)
      const bucketMap = new Map<number, number>();
      let maxComplexity = 0;
      let sumComplexity = 0;
      let highComplexityCount = 0;

      for (const c of complexities) {
        const bucket = Math.floor(c / 5) * 5;
        bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + 1);
        maxComplexity = Math.max(maxComplexity, c);
        sumComplexity += c;
        if (c > 10) highComplexityCount++;
      }

      // Convert to sorted array
      const buckets = Array.from(bucketMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([min, count]) => ({
          min,
          max: min + 5,
          count,
          percentage: total > 0 ? (count * 100.0) / total : 0,
        }));

      return {
        buckets,
        average: total > 0 ? sumComplexity / total : 0,
        maximum: maxComplexity,
        highComplexityCount,
      };
    } catch {
      return {
        buckets: [],
        average: 0,
        maximum: 0,
        highComplexityCount: 0,
      };
    }
  }

  async getMostCalledFunctions(limit: number = 20): Promise<FunctionInfo[]> {
    const script = `
      call_counts[fn_id, cnt] := *calls{to_id: fn_id}, cnt = count(fn_id)

      ?[id, name, file_id, file_path, signature, start_line, end_line, complexity, is_exported, is_async, is_generator, call_count] :=
        call_counts[id, call_count],
        call_count > 0,
        *function{id, name, file_id, signature, start_line, end_line, complexity, is_exported, is_async, is_generator},
        *file{id: file_id, relative_path: file_path}
      :order -call_count
      :limit $limit
    `;

    try {
      const result = await this.store.query<{
        id: string;
        name: string;
        file_id: string;
        file_path: string;
        signature: string;
        start_line: number;
        end_line: number;
        complexity: number;
        is_exported: boolean;
        is_async: boolean;
        is_generator: boolean;
        call_count: number;
      }>(script, { limit });

      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        fileId: row.file_id,
        filePath: row.file_path,
        signature: row.signature,
        startLine: row.start_line,
        endLine: row.end_line,
        complexity: row.complexity,
        isExported: row.is_exported,
        isAsync: row.is_async,
        isGenerator: row.is_generator,
        callCount: row.call_count,
        hasEmbedding: false,
      }));
    } catch {
      return [];
    }
  }

  async getMostComplexFunctions(limit: number = 20): Promise<FunctionInfo[]> {
    const script = `
      ?[id, name, file_id, file_path, signature, start_line, end_line, complexity, is_exported, is_async, is_generator] :=
        *function{id, name, file_id, signature, start_line, end_line, complexity, is_exported, is_async, is_generator},
        *file{id: file_id, relative_path: file_path}
      :order -complexity
      :limit $limit
    `;

    try {
      const result = await this.store.query<{
        id: string;
        name: string;
        file_id: string;
        file_path: string;
        signature: string;
        start_line: number;
        end_line: number;
        complexity: number;
        is_exported: boolean;
        is_async: boolean;
        is_generator: boolean;
      }>(script, { limit });

      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        fileId: row.file_id,
        filePath: row.file_path,
        signature: row.signature,
        startLine: row.start_line,
        endLine: row.end_line,
        complexity: row.complexity,
        isExported: row.is_exported,
        isAsync: row.is_async,
        isGenerator: row.is_generator,
        callCount: 0,
        hasEmbedding: false,
      }));
    } catch {
      return [];
    }
  }

  async getExternalDependencies(): Promise<ExternalDependency[]> {
    const script = `
      ref_counts[ghost_id, package_name, cnt] :=
        *references_external{ghost_node_id: ghost_id},
        *ghost_node{id: ghost_id, package_name, is_external},
        is_external = true,
        cnt = count(ghost_id)

      ?[package_name, reference_count] :=
        ref_counts[_, package_name, reference_count]
      :order -reference_count
    `;

    try {
      const result = await this.store.query<{
        package_name: string;
        reference_count: number;
      }>(script);

      return result.rows.map((row) => ({
        packageName: row.package_name,
        referenceCount: row.reference_count,
        usedBy: [], // Would need additional query
      }));
    } catch {
      return [];
    }
  }

  // ===========================================================================
  // Health
  // ===========================================================================

  async getIndexHealth(): Promise<IndexHealth> {
    const entities = await this.getEntityCounts();
    const embeddings = await this.getEmbeddingCount();

    const filesIndexed = entities.files;
    const functionsWithEmbeddings = embeddings;
    const functionsTotal = entities.functions;

    const coveragePercentage = filesIndexed > 0 ? 100 : 0;
    const embeddingPercentage =
      functionsTotal > 0 ? Math.round((functionsWithEmbeddings / functionsTotal) * 100) : 0;

    const issues: IndexHealth["issues"] = [];

    if (entities.files === 0) {
      issues.push({
        type: "warning",
        code: "NO_FILES",
        message: "No files have been indexed yet",
        suggestion: "Run 'code-synapse index' to index your codebase",
      });
    }

    if (functionsTotal > 0 && functionsWithEmbeddings === 0) {
      issues.push({
        type: "info",
        code: "NO_EMBEDDINGS",
        message: "No function embeddings have been generated",
        suggestion: "Embeddings enable semantic search capabilities",
      });
    }

    const isHealthy = issues.filter((i) => i.type === "error").length === 0;
    const status = isHealthy ? (issues.length > 0 ? "degraded" : "healthy") : "unhealthy";

    return {
      isHealthy,
      status,
      coverage: {
        filesIndexed,
        filesTotal: filesIndexed, // We don't know total files without scanning
        percentage: coveragePercentage,
      },
      embeddings: {
        functionsWithEmbeddings,
        functionsTotal,
        percentage: embeddingPercentage,
      },
      relationships: {
        resolvedCalls: 0, // Would need additional tracking
        unresolvedCalls: 0,
        percentage: 100,
      },
      issues,
      lastChecked: new Date(),
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new CozoGraphViewer instance
 *
 * @param store - The IGraphStore to use for queries
 * @param nlSearchConfig - Optional configuration for natural language search
 * @returns A new CozoGraphViewer instance
 */
export function createGraphViewer(
  store: IGraphStore,
  nlSearchConfig?: NLSearchConfig
): CozoGraphViewer {
  return new CozoGraphViewer(store, nlSearchConfig);
}

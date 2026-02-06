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
  JustificationStats,
  JustificationInfo,
  FeatureAreaSummary,
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
    const [entities, relationships, languages, embeddings, justificationStats] = await Promise.all([
      this.getEntityCounts(),
      this.getRelationshipCounts(),
      this.getLanguageDistribution(),
      this.getEmbeddingCount(),
      this.getJustificationStats(),
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
      justificationCoverage: justificationStats.coveragePercentage,
      justifiedEntities: justificationStats.justifiedEntities,
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
        *class{id, name, file_id, start_line, end_line, is_exported, is_abstract, extends_class, implements_interfaces, doc_comment},
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
        *class{id, name, file_id, start_line, end_line, is_exported, is_abstract, extends_class, implements_interfaces, doc_comment},
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

    // Simplified query without property_count calculation (which can fail on null properties)
    const script = `
      ?[id, name, file_id, file_path, start_line, end_line, is_exported, extends_interfaces, doc_comment] :=
        *interface{id, name, file_id, start_line, end_line, is_exported, extends_interfaces, doc_comment},
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
        extends_interfaces: string[];
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
        extendsInterfaces: row.extends_interfaces ?? [],
        propertyCount: 0, // Simplified - not calculating
        docComment: row.doc_comment ?? undefined,
      }));
    } catch {
      return [];
    }
  }

  async getInterface(id: string): Promise<InterfaceInfo | null> {
    // Simplified query without property_count calculation
    const script = `
      ?[id, name, file_id, file_path, start_line, end_line, is_exported, extends_interfaces, doc_comment] :=
        *interface{id, name, file_id, start_line, end_line, is_exported, extends_interfaces, doc_comment},
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
        extends_interfaces: string[];
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
        extendsInterfaces: row.extends_interfaces ?? [],
        propertyCount: 0, // Simplified - not calculating
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
    _options?: {
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

  // ===========================================================================
  // Business Justifications
  // ===========================================================================

  async getJustificationStats(): Promise<JustificationStats> {
    type CountRow = Record<string, number>;

    try {
      // Total justifications
      const totalResult = await this.store.query<CountRow>(
        `?[count(id)] := *justification{id}`
      );

      // By confidence level
      const highResult = await this.store.query<CountRow>(
        `?[count(id)] := *justification{id, confidence_score}, confidence_score >= 0.8`
      );

      const mediumResult = await this.store.query<CountRow>(
        `?[count(id)] := *justification{id, confidence_score}, confidence_score >= 0.5, confidence_score < 0.8`
      );

      const lowResult = await this.store.query<CountRow>(
        `?[count(id)] := *justification{id, confidence_score}, confidence_score < 0.5`
      );

      const pendingResult = await this.store.query<CountRow>(
        `?[count(id)] := *justification{id, clarification_pending}, clarification_pending = true`
      );

      const confirmedResult = await this.store.query<CountRow>(
        `?[count(id)] := *justification{id, last_confirmed_by_user}, last_confirmed_by_user != null`
      );

      // Total justifiable entities - query each type separately
      const functionsCount = await this.store.query<CountRow>(
        `?[count(id)] := *function{id}`
      );
      const classesCount = await this.store.query<CountRow>(
        `?[count(id)] := *class{id}`
      );
      const interfacesCount = await this.store.query<CountRow>(
        `?[count(id)] := *interface{id}`
      );
      const filesCount = await this.store.query<CountRow>(
        `?[count(id)] := *file{id}`
      );

      const getCount = (row?: CountRow): number => {
        if (!row) return 0;
        const values = Object.values(row);
        return typeof values[0] === "number" ? values[0] : 0;
      };

      const totalJustifications = getCount(totalResult.rows[0]);
      const totalEntities =
        getCount(functionsCount.rows[0]) +
        getCount(classesCount.rows[0]) +
        getCount(interfacesCount.rows[0]) +
        getCount(filesCount.rows[0]);

      return {
        totalEntities,
        justifiedEntities: totalJustifications,
        highConfidence: getCount(highResult.rows[0]),
        mediumConfidence: getCount(mediumResult.rows[0]),
        lowConfidence: getCount(lowResult.rows[0]),
        pendingClarification: getCount(pendingResult.rows[0]),
        userConfirmed: getCount(confirmedResult.rows[0]),
        coveragePercentage: totalEntities > 0 ? (totalJustifications / totalEntities) * 100 : 0,
      };
    } catch {
      return {
        totalEntities: 0,
        justifiedEntities: 0,
        highConfidence: 0,
        mediumConfidence: 0,
        lowConfidence: 0,
        pendingClarification: 0,
        userConfirmed: 0,
        coveragePercentage: 0,
      };
    }
  }

  async getJustification(entityId: string): Promise<JustificationInfo | null> {
    try {
      const result = await this.store.query<{
        id: string;
        entity_id: string;
        entity_type: string;
        name: string;
        file_path: string;
        purpose_summary: string;
        business_value: string;
        feature_context: string;
        detailed_description: string | null;
        tags: string;
        inferred_from: string;
        confidence_score: number;
        confidence_level: string;
        clarification_pending: boolean;
        created_at: number;
        updated_at: number;
        category: string | null;
        domain: string | null;
        architectural_pattern: string | null;
      }>(
        `?[id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
          feature_context, detailed_description, tags, inferred_from, confidence_score,
          confidence_level, clarification_pending, created_at, updated_at, category, domain, architectural_pattern] :=
          *justification{id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
            feature_context, detailed_description, tags, inferred_from, confidence_score,
            confidence_level, clarification_pending, created_at, updated_at, category, domain, architectural_pattern},
          entity_id = $entityId`,
        { entityId }
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0]!;
      return this.rowToJustificationInfo(row);
    } catch {
      return null;
    }
  }

  async listJustifications(options?: ListOptions): Promise<JustificationInfo[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    // Map camelCase to snake_case for ordering
    const orderByMap: Record<string, string> = {
      name: "name",
      entityType: "entity_type",
      confidenceScore: "confidence_score",
      createdAt: "created_at",
      updatedAt: "updated_at",
    };
    const orderBy = orderByMap[options?.orderBy ?? "name"] ?? "name";
    const orderDir = options?.orderDirection === "desc" ? "-" : "";

    try {
      const result = await this.store.query<{
        id: string;
        entity_id: string;
        entity_type: string;
        name: string;
        file_path: string;
        purpose_summary: string;
        business_value: string;
        feature_context: string;
        detailed_description: string | null;
        tags: string;
        inferred_from: string;
        confidence_score: number;
        confidence_level: string;
        clarification_pending: boolean;
        created_at: number;
        updated_at: number;
        category: string | null;
        domain: string | null;
        architectural_pattern: string | null;
      }>(
        `?[id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
          feature_context, detailed_description, tags, inferred_from, confidence_score,
          confidence_level, clarification_pending, created_at, updated_at, category, domain, architectural_pattern] :=
          *justification{id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
            feature_context, detailed_description, tags, inferred_from, confidence_score,
            confidence_level, clarification_pending, created_at, updated_at, category, domain, architectural_pattern}
        :order ${orderDir}${orderBy}
        :limit ${limit}
        :offset ${offset}`
      );

      return result.rows.map((row) => this.rowToJustificationInfo(row));
    } catch {
      return [];
    }
  }

  async searchJustifications(query: string, limit: number = 50): Promise<JustificationInfo[]> {
    try {
      const result = await this.store.query<{
        id: string;
        entity_id: string;
        entity_type: string;
        name: string;
        file_path: string;
        purpose_summary: string;
        business_value: string;
        feature_context: string;
        detailed_description: string | null;
        tags: string;
        inferred_from: string;
        confidence_score: number;
        confidence_level: string;
        clarification_pending: boolean;
        created_at: number;
        updated_at: number;
        category: string | null;
        domain: string | null;
        architectural_pattern: string | null;
      }>(
        `?[id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
          feature_context, detailed_description, tags, inferred_from, confidence_score,
          confidence_level, clarification_pending, created_at, updated_at, category, domain, architectural_pattern] :=
          *justification{id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
            feature_context, detailed_description, tags, inferred_from, confidence_score,
            confidence_level, clarification_pending, created_at, updated_at, category, domain, architectural_pattern},
          or(
            str_includes(lowercase(purpose_summary), lowercase($query)),
            str_includes(lowercase(business_value), lowercase($query)),
            str_includes(lowercase(feature_context), lowercase($query)),
            str_includes(lowercase(name), lowercase($query))
          )
        :limit $limit`,
        { query, limit }
      );

      return result.rows.map((row) => this.rowToJustificationInfo(row));
    } catch {
      return [];
    }
  }

  async getFeatureAreas(): Promise<FeatureAreaSummary[]> {
    try {
      // Group justifications by feature_context
      const result = await this.store.query<{
        feature_context: string;
        "count(id)": number;
      }>(
        `?[feature_context, count(id)] :=
          *justification{id, feature_context},
          feature_context != ""
        :order -count(id)`
      );

      // For each feature area, calculate average confidence and collect tags
      const features: FeatureAreaSummary[] = [];
      for (const row of result.rows) {
        const featureArea = row.feature_context;
        const entityCount = row["count(id)"] ?? 0;

        // Get average confidence for this feature
        const confidenceResult = await this.store.query<{ confidence_score: number }>(
          `?[confidence_score] := *justification{confidence_score, feature_context}, feature_context = $featureArea`,
          { featureArea }
        );

        const scores = confidenceResult.rows.map((r) => r.confidence_score);
        const avgConfidence = scores.length > 0
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : 0;

        // Get unique tags for this feature
        const tagsResult = await this.store.query<{ tags: string }>(
          `?[tags] := *justification{tags, feature_context}, feature_context = $featureArea`,
          { featureArea }
        );

        const allTags = new Set<string>();
        for (const tagRow of tagsResult.rows) {
          try {
            const parsed = JSON.parse(tagRow.tags);
            if (Array.isArray(parsed)) {
              parsed.forEach((t: string) => allTags.add(t));
            }
          } catch {
            // Ignore invalid JSON
          }
        }

        features.push({
          featureArea,
          entityCount,
          avgConfidence,
          tags: Array.from(allTags).slice(0, 10), // Limit tags
        });
      }

      return features;
    } catch {
      return [];
    }
  }

  // ===========================================================================
  // Hierarchical & Uncertainty Queries (Agent-First)
  // ===========================================================================

  /**
   * Get files ranked by uncertainty (most low-confidence justifications)
   */
  async getUncertaintyHotspots(limit: number = 20): Promise<
    Array<{
      filePath: string;
      lowConfidenceCount: number;
      pendingClarificationCount: number;
      averageConfidence: number;
      totalEntities: number;
    }>
  > {
    try {
      // Get justifications grouped by file, calculating uncertainty metrics
      const result = await this.store.query<{
        file_path: string;
        total_count: number;
        avg_confidence: number;
      }>(
        `?[file_path, total_count, avg_confidence] :=
          *justification{file_path, confidence_score},
          total_count = count(file_path),
          avg_confidence = mean(confidence_score)
        :order avg_confidence
        :limit $limit`,
        { limit }
      );

      // For each file, get additional metrics
      const hotspots = [];
      for (const row of result.rows) {
        const lowConfResult = await this.store.query<{ "count(id)": number }>(
          `?[count(id)] := *justification{id, file_path, confidence_score}, file_path = $filePath, confidence_score < 0.5`,
          { filePath: row.file_path }
        );
        const pendingResult = await this.store.query<{ "count(id)": number }>(
          `?[count(id)] := *justification{id, file_path, clarification_pending}, file_path = $filePath, clarification_pending = true`,
          { filePath: row.file_path }
        );

        hotspots.push({
          filePath: row.file_path,
          lowConfidenceCount: lowConfResult.rows[0]?.["count(id)"] ?? 0,
          pendingClarificationCount: pendingResult.rows[0]?.["count(id)"] ?? 0,
          averageConfidence: row.avg_confidence,
          totalEntities: row.total_count,
        });
      }

      // Sort by low confidence count descending
      return hotspots.sort((a, b) => b.lowConfidenceCount - a.lowConfidenceCount);
    } catch {
      return [];
    }
  }

  /**
   * Get entities with lowest confidence (most uncertain)
   */
  async getLowestConfidenceEntities(limit: number = 50): Promise<JustificationInfo[]> {
    try {
      const result = await this.store.query<{
        id: string;
        entity_id: string;
        entity_type: string;
        name: string;
        file_path: string;
        purpose_summary: string;
        business_value: string;
        feature_context: string;
        detailed_description: string | null;
        tags: string;
        inferred_from: string;
        confidence_score: number;
        confidence_level: string;
        clarification_pending: boolean;
        created_at: number;
        updated_at: number;
        category: string | null;
        domain: string | null;
        architectural_pattern: string | null;
      }>(
        `?[id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
          feature_context, detailed_description, tags, inferred_from, confidence_score,
          confidence_level, clarification_pending, created_at, updated_at, category, domain, architectural_pattern] :=
          *justification{id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
            feature_context, detailed_description, tags, inferred_from, confidence_score,
            confidence_level, clarification_pending, created_at, updated_at, category, domain, architectural_pattern}
        :order confidence_score
        :limit $limit`,
        { limit }
      );

      return result.rows.map((row) => this.rowToJustificationInfo(row));
    } catch {
      return [];
    }
  }

  /**
   * Get features with lowest average confidence
   */
  async getUncertainFeatures(limit: number = 10): Promise<
    Array<{
      featureContext: string;
      averageConfidence: number;
      entityCount: number;
      lowConfidenceCount: number;
    }>
  > {
    try {
      const result = await this.store.query<{
        feature_context: string;
        avg_confidence: number;
        entity_count: number;
      }>(
        `?[feature_context, avg_confidence, entity_count] :=
          *justification{feature_context, confidence_score},
          feature_context != "",
          feature_context != "General",
          avg_confidence = mean(confidence_score),
          entity_count = count(feature_context)
        :order avg_confidence
        :limit $limit`,
        { limit }
      );

      // Get low confidence counts for each feature
      const features = [];
      for (const row of result.rows) {
        const lowConfResult = await this.store.query<{ "count(id)": number }>(
          `?[count(id)] := *justification{id, feature_context, confidence_score}, feature_context = $fc, confidence_score < 0.5`,
          { fc: row.feature_context }
        );

        features.push({
          featureContext: row.feature_context,
          averageConfidence: row.avg_confidence,
          entityCount: row.entity_count,
          lowConfidenceCount: lowConfResult.rows[0]?.["count(id)"] ?? 0,
        });
      }

      return features;
    } catch {
      return [];
    }
  }

  /**
   * Get justifications by feature context
   */
  async getJustificationsByFeature(feature: string, limit: number = 100): Promise<JustificationInfo[]> {
    try {
      const result = await this.store.query<{
        id: string;
        entity_id: string;
        entity_type: string;
        name: string;
        file_path: string;
        purpose_summary: string;
        business_value: string;
        feature_context: string;
        detailed_description: string | null;
        tags: string;
        inferred_from: string;
        confidence_score: number;
        confidence_level: string;
        clarification_pending: boolean;
        created_at: number;
        updated_at: number;
        category: string | null;
        domain: string | null;
        architectural_pattern: string | null;
      }>(
        `?[id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
          feature_context, detailed_description, tags, inferred_from, confidence_score,
          confidence_level, clarification_pending, created_at, updated_at, category, domain, architectural_pattern] :=
          *justification{id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
            feature_context, detailed_description, tags, inferred_from, confidence_score,
            confidence_level, clarification_pending, created_at, updated_at, category, domain, architectural_pattern},
          feature_context = $feature
        :order -confidence_score
        :limit $limit`,
        { feature, limit }
      );

      return result.rows.map((row) => this.rowToJustificationInfo(row));
    } catch {
      return [];
    }
  }

  /**
   * Get file hierarchy with justifications
   */
  async getFileHierarchyJustifications(filePath: string): Promise<{
    file: JustificationInfo | null;
    topLevel: JustificationInfo[];
    nested: Record<string, JustificationInfo[]>;
  }> {
    try {
      const result = await this.store.query<{
        id: string;
        entity_id: string;
        entity_type: string;
        name: string;
        file_path: string;
        purpose_summary: string;
        business_value: string;
        feature_context: string;
        detailed_description: string | null;
        tags: string;
        inferred_from: string;
        confidence_score: number;
        confidence_level: string;
        clarification_pending: boolean;
        parent_justification_id: string | null;
        hierarchy_depth: number;
        created_at: number;
        updated_at: number;
        category: string | null;
        domain: string | null;
        architectural_pattern: string | null;
      }>(
        `?[id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
          feature_context, detailed_description, tags, inferred_from, confidence_score,
          confidence_level, clarification_pending, parent_justification_id, hierarchy_depth,
          created_at, updated_at, category, domain, architectural_pattern] :=
          *justification{id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
            feature_context, detailed_description, tags, inferred_from, confidence_score,
            confidence_level, clarification_pending, parent_justification_id, hierarchy_depth,
            created_at, updated_at, category, domain, architectural_pattern},
          file_path = $filePath
        :order hierarchy_depth, name`,
        { filePath }
      );

      const justifications = result.rows.map((row) => ({
        ...this.rowToJustificationInfo(row),
        parentJustificationId: row.parent_justification_id,
        hierarchyDepth: row.hierarchy_depth,
      }));

      // Find file-level justification
      const file = justifications.find((j) => j.entityType === "file") || null;

      // Find top-level entities (classes, functions at file level)
      const topLevel = justifications.filter(
        (j) =>
          j.entityType !== "file" &&
          ((j as { hierarchyDepth?: number }).hierarchyDepth === 1 || !(j as { parentJustificationId?: string }).parentJustificationId)
      );

      // Group nested entities by parent
      const nested: Record<string, JustificationInfo[]> = {};
      for (const j of justifications) {
        const jWithParent = j as { parentJustificationId?: string; hierarchyDepth?: number };
        if (jWithParent.parentJustificationId && (jWithParent.hierarchyDepth || 0) > 1) {
          const parentId = jWithParent.parentJustificationId;
          if (parentId) {
            if (!nested[parentId]) {
              nested[parentId] = [];
            }
            nested[parentId].push(j);
          }
        }
      }

      return { file, topLevel, nested };
    } catch {
      return { file: null, topLevel: [], nested: {} };
    }
  }

  /**
   * Get children of a justification
   */
  async getJustificationChildren(entityId: string): Promise<JustificationInfo[]> {
    try {
      // First get the justification ID for this entity
      const justResult = await this.store.query<{ id: string }>(
        `?[id] := *justification{id, entity_id}, entity_id = $entityId`,
        { entityId }
      );

      if (justResult.rows.length === 0) {
        return [];
      }

      const justificationId = justResult.rows[0]!.id;

      // Now find children
      const result = await this.store.query<{
        id: string;
        entity_id: string;
        entity_type: string;
        name: string;
        file_path: string;
        purpose_summary: string;
        business_value: string;
        feature_context: string;
        detailed_description: string | null;
        tags: string;
        inferred_from: string;
        confidence_score: number;
        confidence_level: string;
        clarification_pending: boolean;
        created_at: number;
        updated_at: number;
        category: string | null;
        domain: string | null;
        architectural_pattern: string | null;
      }>(
        `?[id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
          feature_context, detailed_description, tags, inferred_from, confidence_score,
          confidence_level, clarification_pending, created_at, updated_at, category, domain, architectural_pattern] :=
          *justification{id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
            feature_context, detailed_description, tags, inferred_from, confidence_score,
            confidence_level, clarification_pending, parent_justification_id, created_at, updated_at, category, domain, architectural_pattern},
          parent_justification_id = $parentId
        :order name`,
        { parentId: justificationId }
      );

      return result.rows.map((row) => this.rowToJustificationInfo(row));
    } catch {
      return [];
    }
  }

  // ===========================================================================
  // Graph Structure (New)
  // ===========================================================================

  async getGraphStructure(options?: {
    centerNodeId?: string;
    depth?: number;
    nodeKinds?: string[];
    edgeKinds?: string[];
    limit?: number;
  }): Promise<{
    nodes: Array<{
      id: string;
      label: string;
      kind: string;
      properties?: Record<string, any>;
    }>;
    edges: Array<{
      source: string;
      target: string;
      kind: string;
      weight?: number;
    }>;
  }> {
    const limit = options?.limit ?? 1000;
    const nodeKinds = options?.nodeKinds ?? ["file", "function", "class", "interface"];
    const edgeKinds = options?.edgeKinds ?? ["calls", "imports", "extends", "implements", "contains"];

    const nodes: Array<{
      id: string;
      label: string;
      kind: string;
      properties?: Record<string, any>;
    }> = [];

    const edges: Array<{
      source: string;
      target: string;
      kind: string;
      weight?: number;
    }> = [];

    try {
      // 1. Fetch Nodes
      const nodePromises: Promise<any>[] = [];

      if (nodeKinds.includes("file")) {
        nodePromises.push(
          this.store.query<{ id: string; relative_path: string }>(
            `?[id, relative_path] := *file{id, relative_path} :limit ${limit}`
          ).then(r => r.rows.map(row => ({
            id: row.id,
            label: row.relative_path,
            kind: "file"
          })))
        );
      }

      if (nodeKinds.includes("function")) {
        nodePromises.push(
          this.store.query<{ id: string; name: string }>(
            `?[id, name] := *function{id, name} :limit ${limit}`
          ).then(r => r.rows.map(row => ({
            id: row.id,
            label: row.name,
            kind: "function"
          })))
        );
      }

      if (nodeKinds.includes("class")) {
        nodePromises.push(
          this.store.query<{ id: string; name: string }>(
            `?[id, name] := *class{id, name} :limit ${limit}`
          ).then(r => r.rows.map(row => ({
            id: row.id,
            label: row.name,
            kind: "class"
          })))
        );
      }

      if (nodeKinds.includes("interface")) {
        nodePromises.push(
          this.store.query<{ id: string; name: string }>(
            `?[id, name] := *interface{id, name} :limit ${limit}`
          ).then(r => r.rows.map(row => ({
            id: row.id,
            label: row.name,
            kind: "interface"
          })))
        );
      }

      const nodeResults = await Promise.all(nodePromises);
      nodeResults.forEach(batch => nodes.push(...batch));


      // 2. Fetch Edges
      const edgePromises: Promise<any>[] = [];

      if (edgeKinds.includes("calls")) {
        edgePromises.push(
          this.store.query<{ from_id: string; to_id: string }>(
            `?[from_id, to_id] := *calls{from_id, to_id} :limit ${limit * 5}`
          ).then(r => r.rows.map(row => ({
            source: row.from_id,
            target: row.to_id,
            kind: "calls"
          })))
        );
      }

      if (edgeKinds.includes("imports")) {
        edgePromises.push(
          this.store.query<{ from_id: string; to_id: string }>(
            `?[from_id, to_id] := *imports{from_id, to_id} :limit ${limit * 5}`
          ).then(r => r.rows.map(row => ({
            source: row.from_id,
            target: row.to_id,
            kind: "imports"
          })))
        );
      }

      if (edgeKinds.includes("extends")) {
        edgePromises.push(
          this.store.query<{ from_id: string; to_id: string }>(
            `?[from_id, to_id] := *extends{from_id, to_id} :limit ${limit * 5}`
          ).then(r => r.rows.map(row => ({
            source: row.from_id,
            target: row.to_id,
            kind: "extends"
          })))
        );
      }

      if (edgeKinds.includes("implements")) {
        edgePromises.push(
          this.store.query<{ from_id: string; to_id: string }>(
            `?[from_id, to_id] := *implements{from_id, to_id} :limit ${limit * 5}`
          ).then(r => r.rows.map(row => ({
            source: row.from_id,
            target: row.to_id,
            kind: "implements"
          })))
        );
      }

      // 'Contains' relationship (file -> function/class)
      if (edgeKinds.includes("contains")) {
        edgePromises.push(
          this.store.query<{ id: string; file_id: string }>(
            `?[id, file_id] := *function{id, file_id} :limit ${limit}`
          ).then(r => r.rows.map(row => ({
            source: row.file_id,
            target: row.id,
            kind: "contains"
          })))
        );
        edgePromises.push(
          this.store.query<{ id: string; file_id: string }>(
            `?[id, file_id] := *class{id, file_id} :limit ${limit}`
          ).then(r => r.rows.map(row => ({
            source: row.file_id,
            target: row.id,
            kind: "contains"
          })))
        );
      }

      const edgeResults = await Promise.all(edgePromises);
      edgeResults.forEach(batch => edges.push(...batch));

      // Filter edges to ensure both source and target exist in nodes
      // (Optimization: Map for O(1) lookup)
      const nodeIds = new Set(nodes.map(n => n.id));
      const validEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

      // 3. Enrich nodes with justification data for Knowledge Explorer
      const nodeIdList = nodes.map(n => n.id);
      const justificationMap = new Map<string, {
        purposeSummary?: string;
        featureContext?: string;
        classification?: string;
        confidence?: number;
        businessValue?: string;
      }>();

      if (nodeIdList.length > 0) {
        try {
          const justResult = await this.store.query<{
            entity_id: string;
            purpose_summary: string;
            feature_context: string;
            category: string;
            business_value: string;
            confidence_score: number;
          }>(
            `?[entity_id, purpose_summary, feature_context, category, business_value, confidence_score] :=
              *justification{entity_id, purpose_summary, feature_context, category, business_value, confidence_score},
              entity_id in $ids`,
            { ids: nodeIdList }
          );

          for (const row of justResult.rows) {
            justificationMap.set(row.entity_id, {
              purposeSummary: row.purpose_summary,
              featureContext: row.feature_context,
              classification: row.category, // category is the classification (domain/infrastructure)
              confidence: row.confidence_score,
              businessValue: row.business_value,
            });
          }
        } catch (justErr) {
          // Justification data is optional; log but continue
          console.warn("Could not enrich nodes with justification data:", justErr);
        }
      }

      // Merge justification data into nodes
      const enrichedNodes = nodes.map(node => {
        const justData = justificationMap.get(node.id);
        return {
          ...node,
          purposeSummary: justData?.purposeSummary,
          featureContext: justData?.featureContext,
          classification: justData?.classification,
          confidence: justData?.confidence,
          businessValue: justData?.businessValue,
        };
      });

      return {
        nodes: enrichedNodes,
        edges: validEdges
      };

    } catch (error) {
      console.error("Failed to get graph structure", error);
      return { nodes: [], edges: [] };
    }
  }

  /**
   * Get ancestors (parent chain) of a justification
   */
  async getJustificationAncestors(entityId: string): Promise<JustificationInfo[]> {
    try {
      // First get the justification for this entity
      const justResult = await this.store.query<{
        id: string;
        parent_justification_id: string | null;
      }>(
        `?[id, parent_justification_id] := *justification{id, entity_id, parent_justification_id}, entity_id = $entityId`,
        { entityId }
      );

      if (justResult.rows.length === 0) {
        return [];
      }

      const ancestors: JustificationInfo[] = [];
      let currentParentId = justResult.rows[0]!.parent_justification_id;

      // Traverse up the tree (max 10 levels to prevent infinite loops)
      for (let depth = 0; depth < 10 && currentParentId; depth++) {
        const result = await this.store.query<{
          id: string;
          entity_id: string;
          entity_type: string;
          name: string;
          file_path: string;
          purpose_summary: string;
          business_value: string;
          feature_context: string;
          detailed_description: string | null;
          tags: string;
          inferred_from: string;
          confidence_score: number;
          confidence_level: string;
          clarification_pending: boolean;
          parent_justification_id: string | null;
          created_at: number;
          updated_at: number;
          category: string | null;
          domain: string | null;
          architectural_pattern: string | null;
        }>(
          `?[id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
          feature_context, detailed_description, tags, inferred_from, confidence_score,
          confidence_level, clarification_pending, parent_justification_id, created_at, updated_at, category, domain, architectural_pattern] :=
          *justification{id, entity_id, entity_type, name, file_path, purpose_summary, business_value,
            feature_context, detailed_description, tags, inferred_from, confidence_score,
            confidence_level, clarification_pending, parent_justification_id, created_at, updated_at, category, domain, architectural_pattern},
          id = $parentId`,
          { parentId: currentParentId }
        );
        if (result.rows.length === 0) {
          break;
        }

        const parent = result.rows[0]!;
        ancestors.push(this.rowToJustificationInfo(parent));
        currentParentId = parent.parent_justification_id;
      }

      return ancestors;
    } catch {
      return [];
    }
  }

  /**
   * Convert database row (snake_case) to JustificationInfo
   */
  private rowToJustificationInfo(row: {
    id: string;
    entity_id: string;
    entity_type: string;
    name: string;
    file_path: string;
    purpose_summary: string;
    business_value: string;
    feature_context: string;
    detailed_description: string | null;
    tags: string;
    inferred_from: string;
    confidence_score: number;
    confidence_level: string;
    clarification_pending: boolean;
    created_at: number;
    updated_at: number;
    category: string | null;
    domain: string | null;
    architectural_pattern: string | null;
  }): JustificationInfo {
    let parsedTags: string[] = [];
    try {
      const parsed = JSON.parse(row.tags);
      if (Array.isArray(parsed)) {
        parsedTags = parsed;
      }
    } catch {
      // Ignore invalid JSON
    }

    return {
      id: row.id,
      entityId: row.entity_id,
      entityType: row.entity_type,
      name: row.name,
      filePath: row.file_path,
      purposeSummary: row.purpose_summary,
      businessValue: row.business_value,
      featureContext: row.feature_context,
      detailedDescription: row.detailed_description ?? "",
      tags: parsedTags,
      inferredFrom: row.inferred_from,
      confidenceScore: row.confidence_score,
      confidenceLevel: row.confidence_level,
      clarificationPending: row.clarification_pending,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      category: (row.category as any) || "unknown",
      domain: row.domain || "",
      architecturalPattern: row.architectural_pattern || "unknown",
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

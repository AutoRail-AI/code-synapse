/**
 * Hybrid Search Service (Hybrid Search Phase 3)
 *
 * Combines semantic (embedding + vector) and lexical (Zoekt) search for
 * business-aware code intelligence. Supports optional scoping by business context.
 *
 * @module
 */

import type { IGraphStore } from "../interfaces/IGraphStore.js";
import type { VectorSearchResult } from "../interfaces/IGraphStore.js";
import type { IEmbeddingService } from "../embeddings/index.js";
import type { ZoektManager, ZoektSearchResult } from "./zoekt-manager.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("hybrid-search");

// =============================================================================
// Types
// =============================================================================

/** Source of a hybrid search hit (semantic vs lexical). */
export type HybridSearchSource = "semantic" | "lexical";

/** Optional justification snippet for enrichment. */
export interface HybridJustificationSnippet {
  purposeSummary?: string;
  featureContext?: string;
  businessValue?: string;
}

/** Single result from hybrid search (semantic or lexical). */
export interface HybridSearchResult {
  source: HybridSearchSource;
  /** Relevance score 0–1 (higher is better). */
  score: number;
  /** File path (relative to repo or absolute). */
  filePath: string;
  /** Entity ID (semantic only). */
  entityId?: string;
  /** Entity/symbol name (semantic only). */
  name?: string;
  /** Matching line or snippet (lexical often; semantic optional). */
  snippet?: string;
  /** Line number (lexical). */
  lineNumber?: number;
  /** Enriched business justification when available. */
  justification?: HybridJustificationSnippet;
}

export interface HybridSearchOptions {
  /** Optional business/feature context to scope results (e.g. "Payments"). */
  businessContext?: string;
  /** Max semantic results (default 20). */
  semanticLimit?: number;
  /** Max lexical results (default 20). */
  lexicalLimit?: number;
  /** Max total merged results (default 30). */
  limit?: number;
  /** Whether to enrich with justification (default true). */
  enrichWithJustification?: boolean;
}

// =============================================================================
// HybridSearchService
// =============================================================================

export class HybridSearchService {
  constructor(
    private readonly graphStore: IGraphStore,
    private readonly embeddingService: IEmbeddingService,
    private readonly zoekt: ZoektManager
  ) {}

  /**
   * Run hybrid search: semantic scope (optional) + semantic search + lexical search,
   * then merge and optionally enrich with justification.
   */
  async searchWithJustification(
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<HybridSearchResult[]> {
    const {
      businessContext,
      semanticLimit = 20,
      lexicalLimit = 20,
      limit = 30,
      enrichWithJustification = true,
    } = options;

    // Step 1: Semantic scope (files related to business context)
    let scopeFiles: string[] | undefined;
    if (businessContext) {
      scopeFiles = await this.getScopeFilesByContext(businessContext);
      logger.debug({ businessContext, scopeFileCount: scopeFiles.length }, "Scoped by business context");
    }

    // Step 2: Semantic search
    const semanticResults = await this.runSemanticSearch(query, semanticLimit);

    // Step 3: Lexical search (optionally scoped)
    const filePattern = scopeFiles?.length
      ? this.buildFilePatternForZoekt(scopeFiles)
      : undefined;
    const lexicalResults = await this.runLexicalSearch(query, { filePattern, maxResults: lexicalLimit });

    // Step 4: Merge and enrich
    return this.mergeAndEnrich(
      semanticResults,
      lexicalResults,
      { limit, enrichWithJustification }
    );
  }

  /**
   * Get file paths that have justifications matching the given feature/business context.
   * Joins justification with function, class, and interface to cover all entity types.
   */
  private async getScopeFilesByContext(context: string): Promise<string[]> {
    try {
      // Cozo: get file_path from justification + any entity type that has file_id
      const result = await this.graphStore.query<{ file_path: string }>(
        `
        ?[file_path] :=
          *justification{entity_id, feature_context},
          feature_context = $context,
          *function{id: entity_id, file_id},
          *file{id: file_id, relative_path},
          file_path = relative_path
        ?[file_path] :=
          *justification{entity_id, feature_context},
          feature_context = $context,
          *class{id: entity_id, file_id},
          *file{id: file_id, relative_path},
          file_path = relative_path
        ?[file_path] :=
          *justification{entity_id, feature_context},
          feature_context = $context,
          *interface{id: entity_id, file_id},
          *file{id: file_id, relative_path},
          file_path = relative_path
        `,
        { context }
      );
      const paths = result.rows.map((r) => r.file_path);
      return [...new Set(paths)];
    } catch (err) {
      logger.warn({ err, context }, "Failed to get scope files by context");
      return [];
    }
  }

  /**
   * Build a Zoekt file pattern from a list of file paths.
   * Zoekt accepts regex; we build an OR of path literals, escaped.
   */
  private buildFilePatternForZoekt(filePaths: string[]): string {
    if (filePaths.length === 0) return "";
    const escaped = filePaths.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return `(${escaped.join("|")})`;
  }

  private async runSemanticSearch(query: string, k: number): Promise<VectorSearchResult[]> {
    try {
      const embeddingResult = await this.embeddingService.embed(query);
      return await this.graphStore.vectorSearch(embeddingResult.vector, k);
    } catch (err) {
      logger.warn({ err, query }, "Semantic search failed");
      return [];
    }
  }

  private async runLexicalSearch(
    query: string,
    opts: { filePattern?: string; maxResults?: number }
  ): Promise<ZoektSearchResult> {
    if (!this.zoekt.isStarted()) {
      return { results: [], error: "Zoekt not running" };
    }
    return this.zoekt.search(query, {
      filePattern: opts.filePattern,
      maxResults: opts.maxResults ?? 20,
    });
  }

  /**
   * Resolve file_id to relative_path for semantic results (batch).
   */
  private async getFilePathsForIds(fileIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (fileIds.length === 0) return map;
    try {
      const quoted = fileIds.map((id) => JSON.stringify(id)).join(", ");
      const result = await this.graphStore.query<{ id: string; relative_path: string }>(
        `?[id, relative_path] := *file{id, relative_path}, id in [${quoted}]`
      );
      for (const r of result.rows) {
        map.set(r.id, r.relative_path);
      }
    } catch (err) {
      logger.warn({ err }, "Failed to resolve file paths");
    }
    return map;
  }

  /**
   * Fetch justification snippets for entity IDs (purpose_summary, feature_context, business_value).
   */
  private async getJustificationSnippets(
    entityIds: string[]
  ): Promise<Map<string, HybridJustificationSnippet>> {
    const out = new Map<string, HybridJustificationSnippet>();
    if (entityIds.length === 0) return out;
    try {
      const quoted = entityIds.map((id) => JSON.stringify(id)).join(", ");
      const result = await this.graphStore.query<{
        entity_id: string;
        purpose_summary: string;
        feature_context: string;
        business_value: string;
      }>(
        `?[entity_id, purpose_summary, feature_context, business_value] :=
          *justification{entity_id, purpose_summary, feature_context, business_value},
          entity_id in [${quoted}]`
      );
      for (const r of result.rows) {
        out.set(r.entity_id, {
          purposeSummary: r.purpose_summary,
          featureContext: r.feature_context,
          businessValue: r.business_value,
        });
      }
    } catch (err) {
      logger.warn({ err }, "Failed to fetch justification snippets");
    }
    return out;
  }

  private async mergeAndEnrich(
    semanticResults: VectorSearchResult[],
    lexicalResult: ZoektSearchResult,
    opts: { limit: number; enrichWithJustification: boolean }
  ): Promise<HybridSearchResult[]> {
    const merged: HybridSearchResult[] = [];
    const fileIds = [...new Set(semanticResults.map((r) => r.fileId).filter(Boolean))] as string[];
    const filePathMap = await this.getFilePathsForIds(fileIds);
    const entityIds = semanticResults.map((r) => r.id);
    const justificationMap = opts.enrichWithJustification
      ? await this.getJustificationSnippets(entityIds)
      : new Map<string, HybridJustificationSnippet>();

    for (const r of semanticResults) {
      const filePath = r.fileId ? filePathMap.get(r.fileId) : undefined;
      if (!filePath) continue;
      const score = 1 / (1 + r.distance);
      merged.push({
        source: "semantic",
        score,
        filePath,
        entityId: r.id,
        name: r.name,
        justification: justificationMap.get(r.id),
      });
    }

    for (const fileMatch of lexicalResult.results ?? []) {
      const filePath = fileMatch.fileName;
      for (const lm of fileMatch.lineMatches ?? []) {
        merged.push({
          source: "lexical",
          score: 1,
          filePath,
          snippet: lm.line.trim(),
          lineNumber: lm.lineNumber,
        });
      }
    }

    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, opts.limit);
  }
}

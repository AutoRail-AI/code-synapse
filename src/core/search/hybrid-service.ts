/**
 * Hybrid Search Service (Hybrid Search Phase 3 + Quality Improvements)
 *
 * Combines semantic (embedding + vector) and lexical (Zoekt) search for
 * business-aware code intelligence. Uses Reciprocal Rank Fusion (RRF) for
 * score normalization, intent-based weighting, heuristic boosting, and
 * optional LLM query expansion.
 *
 * @module
 */

import type { IGraphStore } from "../interfaces/IGraphStore.js";
import type { VectorSearchResult } from "../interfaces/IGraphStore.js";
import type { IEmbeddingService } from "../embeddings/index.js";
import type { ZoektManager, ZoektSearchResult } from "./zoekt-manager.js";
import type { ILLMService } from "../llm/interfaces/ILLMService.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("hybrid-search");

// =============================================================================
// Types
// =============================================================================

/** Source of a hybrid search hit (semantic vs lexical). */
export type HybridSearchSource = "semantic" | "lexical";

/** Query intent classification for tuning RRF weights. */
export type QueryIntent = "definition" | "usage" | "conceptual" | "keyword";

/** Optional justification snippet for enrichment (Phase 4: includes confidence). */
export interface HybridJustificationSnippet {
  purposeSummary?: string;
  featureContext?: string;
  businessValue?: string;
  /** Confidence score 0–1 from justification (Phase 4). */
  confidence?: number;
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
  /** Entity type: function, class, interface, etc. (semantic only). */
  entityType?: string;
  /** Matching line or snippet (lexical often; semantic optional). */
  snippet?: string;
  /** Line number (lexical). */
  lineNumber?: number;
  /** Enriched business justification when available. */
  justification?: HybridJustificationSnippet;
  /** Design patterns this entity participates in (Phase 4). */
  patterns?: string[];
  /** Business importance (e.g. "Revenue Critical") - lifted for easier UI access. */
  businessValue?: string;
  /** Popularity score (incoming call count). */
  popularity?: number;
  /** Top 3 related entities (callers) to show "Used By". */
  relatedCode?: Array<{ name: string; filePath: string; relation: "caller" }>;
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
  /** Whether to generate AI answer synthesis (default false). */
  enableSynthesis?: boolean;
  /** Whether to expand query with LLM synonyms (default false). */
  enableQueryExpansion?: boolean;
}

export interface Citation {
  index: number;
  filePath: string;
  lineNumber?: number;
  snippet?: string;
  justification?: string;
}

export interface AISummary {
  answer: string;
  citations: Citation[];
  modelUsed: string;
  timestamp: string;
}

export interface HybridSearchResponse {
  summary: AISummary | null;
  results: HybridSearchResult[];
  meta?: {
    semanticCount?: number;
    lexicalCount?: number;
    queryType?: "question" | "keyword";
    processingTimeMs?: number;
    intent?: QueryIntent;
  };
}

// =============================================================================
// Internal types for RRF fusion
// =============================================================================

/** RRF k-constants per intent: lower k = more weight on top ranks. */
interface IntentConfig {
  kSemantic: number;
  kLexical: number;
}

/** Intermediate fused result during merge. */
interface FusedResult {
  filePath: string;
  rrfScore: number;
  semanticRank?: number;
  lexicalRank?: number;
  semanticHit?: VectorSearchResult;
  lexicalHit?: { snippet: string; lineNumber: number };
  entityId?: string;
  name?: string;
  entityType?: string;
  justification?: HybridJustificationSnippet;
  patterns?: string[];
  semanticSnippet?: string;
  semanticLineNumber?: number;
  popularity?: number;
  relatedCode?: Array<{ name: string; filePath: string; relation: "caller" }>;
}

// =============================================================================
// Constants
// =============================================================================

/** RRF k-constants tuned per query intent. */
const INTENT_CONFIGS: Record<QueryIntent, IntentConfig> = {
  definition: { kSemantic: 40, kLexical: 80 },
  usage: { kSemantic: 80, kLexical: 40 },
  conceptual: { kSemantic: 50, kLexical: 70 },
  keyword: { kSemantic: 60, kLexical: 60 },
};

/** File extensions used to detect filename-like queries. */
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".rb", ".php", ".kt",
  ".scala", ".swift", ".dart", ".lua", ".ex", ".exs", ".sh",
  ".json", ".yaml", ".yml", ".toml",
]);

// =============================================================================
// HybridSearchService
// =============================================================================

export class HybridSearchService {
  private llmService?: ILLMService;

  constructor(
    private readonly graphStore: IGraphStore,
    private readonly embeddingService: IEmbeddingService,
    private readonly zoekt: ZoektManager,
    llmService?: ILLMService
  ) {
    this.llmService = llmService;
  }

  /**
   * Run hybrid search: semantic scope (optional) + semantic search + lexical search,
   * then merge with RRF fusion and optionally enrich with justification.
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
      enableQueryExpansion = false,
    } = options;

    // Step 0: Classify query intent
    const intent = this.classifyIntent(query);
    logger.debug({ query, intent }, "Query intent classified");

    // Step 1: Semantic scope (files related to business context)
    let scopeFiles: string[] | undefined;
    if (businessContext) {
      scopeFiles = await this.getScopeFilesByContext(businessContext);
      logger.debug({ businessContext, scopeFileCount: scopeFiles.length }, "Scoped by business context");
    }

    // Step 2: Semantic search (with optional query expansion)
    let semanticResults = await this.runSemanticSearch(query, semanticLimit);

    if (enableQueryExpansion && this.llmService) {
      try {
        const synonyms = await this.expandQuery(query);
        if (synonyms.length > 0) {
          const expansionLimit = Math.max(5, Math.floor(semanticLimit / 2));
          const expansionResults = await Promise.all(
            synonyms.map(s => this.runSemanticSearch(s, expansionLimit))
          );
          for (const results of expansionResults) {
            semanticResults = this.mergeSemanticResults(semanticResults, results);
          }
          logger.debug({ synonyms, expandedCount: semanticResults.length }, "Query expansion applied");
        }
      } catch (err) {
        logger.warn({ err }, "Query expansion failed, continuing with primary results");
      }
    }

    logger.debug({ query, semanticResultCount: semanticResults.length }, "Semantic search completed");

    // Step 3: Lexical search (optionally scoped)
    const filePattern = scopeFiles?.length
      ? this.buildFilePatternForZoekt(scopeFiles)
      : undefined;
    const lexicalResults = await this.runLexicalSearch(query, { filePattern, maxResults: lexicalLimit });
    logger.debug({
      query,
      lexicalResultCount: lexicalResults.results?.length ?? 0,
      lexicalError: lexicalResults.error,
    }, "Lexical search completed");

    // Step 4: Merge with RRF fusion and enrich
    return this.mergeAndEnrich(
      semanticResults,
      lexicalResults,
      { limit, enrichWithJustification, intent, query }
    );
  }

  /**
   * Run hybrid search and optionally synthesize an answer using LLM.
   */
  async searchWithSynthesis(
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<HybridSearchResponse> {
    const startTime = Date.now();
    const intent = this.classifyIntent(query);

    // 1. Run hybrid search
    const results = await this.searchWithJustification(query, options);

    // 2. Generate AI summary if enabled and query is a question
    let summary: AISummary | null = null;
    const isQuestionQuery = this.isQuestion(query);

    if (options.enableSynthesis && isQuestionQuery && this.llmService) {
      try {
        summary = await this.synthesizeAnswer(query, results);
      } catch (err) {
        logger.error({ err }, "LLM synthesis failed");
      }
    }

    // Count contributions
    const semanticCount = results.filter(r => r.entityId != null).length;
    const lexicalCount = results.length - semanticCount;

    return {
      summary,
      results,
      meta: {
        queryType: isQuestionQuery ? "question" : "keyword",
        processingTimeMs: Date.now() - startTime,
        intent,
        semanticCount,
        lexicalCount,
      }
    };
  }

  // ===========================================================================
  // Intent Classification
  // ===========================================================================

  /**
   * Classify query intent using regex patterns.
   * Returns one of: definition, usage, conceptual, keyword.
   */
  classifyIntent(query: string): QueryIntent {
    const q = query.trim().toLowerCase();

    // Definition patterns
    if (/\b(where\s+is\s+.+\s+defined|definition\s+of|find\s+definition|show\s+definition|go\s+to\s+definition|declare|declared)\b/.test(q)) {
      return "definition";
    }
    if (/\b(class|interface|type|struct|enum)\s+\w+/.test(q) && !/\b(use|call|import|usage)\b/.test(q)) {
      return "definition";
    }

    // Usage patterns
    if (/\b(who\s+calls|callers?\s+of|usages?\s+of|references?\s+to|where\s+is\s+.+\s+used|where\s+is\s+.+\s+called|imports?\s+of|consumers?\s+of)\b/.test(q)) {
      return "usage";
    }

    // Conceptual patterns
    if (/\b(how\s+does|explain|what\s+does|why\s+does|what\s+is\s+the\s+purpose|architecture|design|overview|understand|describe)\b/.test(q)) {
      return "conceptual";
    }
    if (/\?$/.test(q) && /^(what|how|why|when|where)/.test(q)) {
      return "conceptual";
    }
    // "where is X" without defined/used/called → conceptual (e.g. "Where is the authentication logic?")
    if (/\bwhere\s+is\b/.test(q) && !/\b(defined|used|called)\b/.test(q)) {
      return "conceptual";
    }

    return "keyword";
  }

  // ===========================================================================
  // Query Expansion (opt-in, LLM-based)
  // ===========================================================================

  /**
   * Use LLM to generate synonym/related terms for query expansion.
   * Returns up to 3 terms. Returns empty array on failure.
   */
  private async expandQuery(query: string): Promise<string[]> {
    if (!this.llmService) return [];
    try {
      const result = await this.llmService.infer(
        `Generate exactly 3 technical synonyms or related code identifiers for the search query: "${query}". Output only the 3 terms, comma-separated, nothing else.`,
        { maxTokens: 50, temperature: 0.3 }
      );
      const terms = result.text
        .split(",")
        .map(t => t.trim())
        .filter(t => t.length > 0 && t.length < 80);
      return terms.slice(0, 3);
    } catch (err) {
      logger.warn({ err, query }, "LLM query expansion failed");
      return [];
    }
  }

  /**
   * Merge secondary semantic results into primary, deduplicating by entity ID.
   */
  private mergeSemanticResults(
    primary: VectorSearchResult[],
    secondary: VectorSearchResult[]
  ): VectorSearchResult[] {
    const seen = new Set(primary.map(r => r.id));
    const merged = [...primary];
    for (const r of secondary) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }
    return merged.sort((a, b) => a.distance - b.distance);
  }

  // ===========================================================================
  // Reciprocal Rank Fusion
  // ===========================================================================

  /**
   * Fuse semantic and lexical results using RRF with intent-tuned k constants.
   * Returns a Map keyed by filePath — each file appears at most once.
   */
  private fuseResults(
    semanticResults: VectorSearchResult[],
    lexicalResult: ZoektSearchResult,
    intent: QueryIntent,
    semanticFilePathMap: Map<string, string>
  ): Map<string, FusedResult> {
    const config = INTENT_CONFIGS[intent];
    const fusedMap = new Map<string, FusedResult>();

    // Semantic results: ranked by distance ascending (best first)
    const sortedSemantic = [...semanticResults].sort((a, b) => a.distance - b.distance);
    for (let rank = 0; rank < sortedSemantic.length; rank++) {
      const hit = sortedSemantic[rank]!;
      const filePath = hit.fileId ? semanticFilePathMap.get(hit.fileId) : undefined;
      if (!filePath) continue;

      const rrfScore = 1 / (config.kSemantic + rank);
      const existing = fusedMap.get(filePath);
      if (existing) {
        existing.rrfScore += rrfScore;
        // Keep the best semantic hit (first in sorted order)
        if (existing.semanticRank === undefined || rank < existing.semanticRank) {
          existing.semanticRank = rank;
          existing.semanticHit = hit;
          existing.entityId = hit.id;
          existing.name = hit.name;
        }
      } else {
        fusedMap.set(filePath, {
          filePath,
          rrfScore,
          semanticRank: rank,
          semanticHit: hit,
          entityId: hit.id,
          name: hit.name,
        });
      }
    }

    // Lexical results: flatten to one entry per file (best line match)
    const lexicalByFile = new Map<string, { snippet: string; lineNumber: number; rank: number }>();
    let lexRank = 0;
    for (const fileMatch of lexicalResult.results ?? []) {
      const filePath = fileMatch.fileName;
      if (!lexicalByFile.has(filePath)) {
        const firstLine = fileMatch.lineMatches?.[0];
        if (firstLine) {
          lexicalByFile.set(filePath, {
            snippet: firstLine.line.trim(),
            lineNumber: firstLine.lineNumber,
            rank: lexRank,
          });
        }
        lexRank++;
      }
    }

    for (const [filePath, lexHit] of lexicalByFile) {
      const rrfScore = 1 / (config.kLexical + lexHit.rank);
      const existing = fusedMap.get(filePath);
      if (existing) {
        existing.rrfScore += rrfScore;
        existing.lexicalRank = lexHit.rank;
        existing.lexicalHit = { snippet: lexHit.snippet, lineNumber: lexHit.lineNumber };
      } else {
        fusedMap.set(filePath, {
          filePath,
          rrfScore,
          lexicalRank: lexHit.rank,
          lexicalHit: { snippet: lexHit.snippet, lineNumber: lexHit.lineNumber },
        });
      }
    }

    return fusedMap;
  }

  // ===========================================================================
  // Snippet Selection for Semantic Results
  // ===========================================================================

  /**
   * Fetch code snippets for semantic entity IDs from function, class, and interface relations.
   */
  private async getEntitySnippets(
    entityIds: string[]
  ): Promise<Map<string, { snippet: string; lineNumber: number; entityType: string }>> {
    const out = new Map<string, { snippet: string; lineNumber: number; entityType: string }>();
    if (entityIds.length === 0) return out;
    const quoted = entityIds.map((id) => JSON.stringify(id)).join(", ");

    try {
      // Run three queries in parallel (can't union — different columns)
      const [functions, classes, interfaces] = await Promise.all([
        this.graphStore.query<{
          id: string; signature: string; start_line: number;
        }>(
          `?[id, signature, start_line] := *function{id, signature, start_line}, id in [${quoted}]`
        ).catch(() => ({ rows: [] as { id: string; signature: string; start_line: number }[] })),
        this.graphStore.query<{
          id: string; name: string; start_line: number; extends_class: string;
        }>(
          `?[id, name, start_line, extends_class] := *class{id, name, start_line, extends_class}, id in [${quoted}]`
        ).catch(() => ({ rows: [] as { id: string; name: string; start_line: number; extends_class: string }[] })),
        this.graphStore.query<{
          id: string; name: string; start_line: number;
        }>(
          `?[id, name, start_line] := *interface{id, name, start_line}, id in [${quoted}]`
        ).catch(() => ({ rows: [] as { id: string; name: string; start_line: number }[] })),
      ]);

      for (const r of functions.rows) {
        out.set(r.id, { snippet: r.signature, lineNumber: r.start_line, entityType: "function" });
      }
      for (const r of classes.rows) {
        const snippet = r.extends_class
          ? `class ${r.name} extends ${r.extends_class}`
          : `class ${r.name}`;
        out.set(r.id, { snippet, lineNumber: r.start_line, entityType: "class" });
      }
      for (const r of interfaces.rows) {
        out.set(r.id, { snippet: `interface ${r.name}`, lineNumber: r.start_line, entityType: "interface" });
      }
    } catch (err) {
      logger.warn({ err }, "Failed to fetch entity snippets");
    }
    return out;
  }

  // ===========================================================================
  // Heuristic Boosting
  // ===========================================================================

  /**
   * Detect if the query looks like a filename or path.
   * Returns the detected filename/path fragment, or null.
   */
  private detectFilenameQuery(query: string): string | null {
    const words = query.split(/\s+/);
    for (const word of words) {
      // Check for file extensions
      for (const ext of CODE_EXTENSIONS) {
        if (word.endsWith(ext)) return word;
      }
      // Check for path separators
      if (word.includes("/") || word.includes("\\")) return word;
    }
    return null;
  }

  /**
   * Fetch incoming call counts for entity IDs.
   */
  private async getIncomingCallCounts(
    entityIds: string[]
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (entityIds.length === 0) return out;
    try {
      const quoted = entityIds.map((id) => JSON.stringify(id)).join(", ");
      const result = await this.graphStore.query<{ to_id: string; cnt: number }>(
        `call_counts[to_id, count(from_id)] := *calls{from_id, to_id}, to_id in [${quoted}]
         ?[to_id, cnt] := call_counts[to_id, cnt]`
      );
      for (const r of result.rows) {
        out.set(r.to_id, r.cnt);
      }
    } catch (err) {
      logger.warn({ err }, "Failed to fetch call counts for boosting");
    }
    return out;
  }

  /**
   * Apply heuristic boosts to fused results in-place.
   */
  private async applyBoosts(
    fusedMap: Map<string, FusedResult>,
    query: string,
    entityIds: string[],
    prefetchedCallCounts?: Map<string, number>
  ): Promise<void> {
    const filenameQuery = this.detectFilenameQuery(query);
    const callCounts = prefetchedCallCounts ?? (entityIds.length > 0
      ? await this.getIncomingCallCounts(entityIds)
      : new Map<string, number>());

    for (const fused of fusedMap.values()) {
      // 1. Filename match boost: 1.5x
      if (filenameQuery) {
        const normalizedQuery = filenameQuery.toLowerCase();
        const normalizedPath = fused.filePath.toLowerCase();
        if (normalizedPath.includes(normalizedQuery)) {
          fused.rrfScore *= 1.5;
        }
      }

      // 2. Definition boost: 1.1x for results with a semantic hit
      if (fused.semanticHit) {
        fused.rrfScore *= 1.1;
      }

      // 3. Popularity boost: 1 + 0.1 * log2(1 + callCount)
      if (fused.entityId) {
        const callCount = callCounts.get(fused.entityId) ?? 0;
        if (callCount > 0) {
          fused.rrfScore *= 1 + 0.1 * Math.log2(1 + callCount);
        }
      }
    }
  }

  // ===========================================================================
  // Merge and Enrich (rewritten with RRF)
  // ===========================================================================

  private async mergeAndEnrich(
    semanticResults: VectorSearchResult[],
    lexicalResult: ZoektSearchResult,
    opts: { limit: number; enrichWithJustification: boolean; intent: QueryIntent; query: string }
  ): Promise<HybridSearchResult[]> {
    // 1. Resolve file paths for semantic results
    const fileIds = [...new Set(semanticResults.map((r) => r.fileId).filter(Boolean))] as string[];
    const filePathMap = await this.getFilePathsForIds(fileIds);

    if (semanticResults.length > 0 && filePathMap.size === 0) {
      logger.warn(
        { semanticResultCount: semanticResults.length, fileIdCount: fileIds.length },
        "Semantic results found but no file paths resolved - results will be dropped"
      );
    }

    // 2. RRF fusion
    const fusedMap = this.fuseResults(semanticResults, lexicalResult, opts.intent, filePathMap);

    // 3. Batch enrichment in parallel
    const entityIds = [...new Set(
      [...fusedMap.values()]
        .map(f => f.entityId)
        .filter((id): id is string => id != null)
    )];

    const [justificationMap, patternsMap, entitySnippetMap, relatedCodeMap, callCounts] = opts.enrichWithJustification
      ? await Promise.all([
        this.getJustificationSnippets(entityIds),
        this.getPatternsForEntities(entityIds),
        this.getEntitySnippets(entityIds),
        this.getTopCallers(entityIds),
        this.getIncomingCallCounts(entityIds),
      ])
      : [
        new Map<string, HybridJustificationSnippet>(),
        new Map<string, string[]>(),
        new Map<string, { snippet: string; lineNumber: number; entityType: string }>(),
        new Map<string, Array<{ name: string; filePath: string; relation: "caller" }>>(),
        new Map<string, number>(),
      ];

    // 4. Attach enrichment data to fused results
    for (const fused of fusedMap.values()) {
      if (fused.entityId) {
        fused.justification = justificationMap.get(fused.entityId);
        fused.patterns = patternsMap.get(fused.entityId);
        fused.relatedCode = relatedCodeMap.get(fused.entityId);
        fused.popularity = callCounts.get(fused.entityId); // Popularity from call counts

        const entitySnippet = entitySnippetMap.get(fused.entityId);
        if (entitySnippet) {
          fused.semanticSnippet = entitySnippet.snippet;
          fused.semanticLineNumber = entitySnippet.lineNumber;
          fused.entityType = entitySnippet.entityType;
        }
      }
    }

    // 5. Apply heuristic boosts (using the already fetched callCounts)
    await this.applyBoosts(fusedMap, opts.query, entityIds, callCounts);

    // 6. Normalize scores to 0–1 (divide by max)
    const allFused = [...fusedMap.values()];
    const maxScore = allFused.reduce((max, f) => Math.max(max, f.rrfScore), 0);
    if (maxScore > 0) {
      for (const f of allFused) {
        f.rrfScore = f.rrfScore / maxScore;
      }
    }

    // 7. Sort by RRF score descending, convert, and trim
    allFused.sort((a, b) => b.rrfScore - a.rrfScore);
    return allFused.slice(0, opts.limit).map(f => this.fusedToHybridResult(f));
  }

  /**
   * Convert a FusedResult into the public HybridSearchResult type.
   * Picks the best snippet (lexical preferred over semantic) and determines source.
   */
  private fusedToHybridResult(fused: FusedResult): HybridSearchResult {
    // Determine primary source: whichever engine contributed the higher-ranked hit
    let source: HybridSearchSource;
    if (fused.semanticRank !== undefined && fused.lexicalRank !== undefined) {
      // Both engines contributed — pick the one with the better (lower) rank
      source = fused.semanticRank <= fused.lexicalRank ? "semantic" : "lexical";
    } else if (fused.semanticRank !== undefined) {
      source = "semantic";
    } else {
      source = "lexical";
    }

    // Pick best snippet: lexical (has line context) preferred over semantic
    const snippet = fused.lexicalHit?.snippet ?? fused.semanticSnippet;
    const lineNumber = fused.lexicalHit?.lineNumber ?? fused.semanticLineNumber;

    return {
      source,
      score: fused.rrfScore,
      filePath: fused.filePath,
      entityId: fused.entityId,
      name: fused.name,
      entityType: fused.entityType,
      snippet,
      lineNumber,
      justification: fused.justification,
      patterns: fused.patterns,
      businessValue: fused.justification?.businessValue,
      popularity: fused.popularity,
      relatedCode: fused.relatedCode,
    };
  }

  // ===========================================================================
  // Existing helpers (unchanged)
  // ===========================================================================

  private isQuestion(query: string): boolean {
    const questionPatterns = [
      /^(what|where|why|how|when|who|which|is|are|can|could|would|should|does|do|did)\b/i,
      /\?$/
    ];
    return questionPatterns.some(p => p.test(query.trim()));
  }

  private async synthesizeAnswer(
    query: string,
    results: HybridSearchResult[]
  ): Promise<AISummary> {
    if (!this.llmService) throw new Error("LLM Service not initialized");

    const topResults = results.slice(0, 5);
    const prompt = this.buildSynthesisPrompt(query, topResults);
    const llmResponse = await this.llmService.infer(prompt);

    return {
      answer: llmResponse.text,
      citations: topResults.map((r, i) => ({
        index: i + 1,
        filePath: r.filePath,
        lineNumber: r.lineNumber,
        snippet: r.snippet,
        justification: r.justification?.purposeSummary
      })),
      modelUsed: "Code-Synapse AI",
      timestamp: new Date().toISOString()
    };
  }

  private buildSynthesisPrompt(query: string, results: HybridSearchResult[]): string {
    const codeContext = results.map((r, i) => {
      const businessValue = r.justification?.businessValue || "N/A";
      const featureContext = r.justification?.featureContext || "N/A";
      const confidence =
        r.justification?.confidence != null
          ? `${Math.round((r.justification.confidence ?? 0) * 100)}%`
          : "N/A";
      const patternStr = r.patterns?.length ? r.patterns.join(", ") : "None";
      return `[Citation ${i + 1}] File: ${r.filePath}:${r.lineNumber ?? "N/A"}
Feature Context: ${featureContext}
Business Value: ${businessValue} (Confidence: ${confidence})
Design Patterns: ${patternStr}
Code Snippet:
\`\`\`
${r.snippet || "(No snippet available)"}
\`\`\``;
    }).join("\n\n");

    return `You are a code intelligence assistant. Answer the following question about the codebase using the provided code snippets.

Question: ${query}

Relevant Code:
${codeContext}

Instructions:
1. Provide a concise, direct answer to the question in Markdown format.
2. Reference specific code snippets using [1], [2], etc.
3. Mention the business purpose when relevant.
4. If the code snippets don't fully answer the question, say so.

Answer:`;
  }

  /**
   * Get file paths that have justifications matching the given feature/business context.
   */
  private async getScopeFilesByContext(context: string): Promise<string[]> {
    try {
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
        confidence_score: number;
      }>(
        `?[entity_id, purpose_summary, feature_context, business_value, confidence_score] :=
          *justification{entity_id, purpose_summary, feature_context, business_value, confidence_score},
          entity_id in [${quoted}]`
      );
      for (const r of result.rows) {
        out.set(r.entity_id, {
          purposeSummary: r.purpose_summary,
          featureContext: r.feature_context,
          businessValue: r.business_value,
          confidence: r.confidence_score,
        });
      }
    } catch (err) {
      logger.warn({ err }, "Failed to fetch justification snippets");
    }
    return out;
  }

  private async getPatternsForEntities(
    entityIds: string[]
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (entityIds.length === 0) return out;
    try {
      const quoted = entityIds.map((id) => JSON.stringify(id)).join(", ");
      const result = await this.graphStore.query<{
        from_id: string;
        pattern_type: string;
      }>(
        `?[from_id, pattern_type] :=
          *has_pattern{from_id, to_id: pattern_id},
          *design_pattern{id: pattern_id, pattern_type},
          from_id in [${quoted}]`
      );
      for (const r of result.rows) {
        const existing = out.get(r.from_id) ?? [];
        if (!existing.includes(r.pattern_type)) {
          existing.push(r.pattern_type);
          out.set(r.from_id, existing);
        }
      }
    } catch (err) {
      logger.warn({ err }, "Failed to fetch design patterns");
    }
    return out;
  }
  private async getTopCallers(
    entityIds: string[]
  ): Promise<Map<string, Array<{ name: string; filePath: string; relation: "caller" }>>> {
    const out = new Map<string, Array<{ name: string; filePath: string; relation: "caller" }>>();
    if (entityIds.length === 0) return out;

    try {
      const quoted = entityIds.map((id) => JSON.stringify(id)).join(", ");
      // Get up to 3 callers for each entity
      // We need to join calls -> function/class -> file to get names and paths
      const result = await this.graphStore.query<{
        to_id: string;
        from_name: string;
        from_path: string;
      }>(
        `
        ?[to_id, from_name, from_path] :=
          *calls{from_id, to_id},
          to_id in [${quoted}],
          *function{id: from_id, name: from_name, file_id},
          *file{id: file_id, relative_path: from_path}
        
        :limit 100
        `
      );

      // Group by to_id manually since Datalog limit is global, not per-group
      // In a real optimized system we'd use a window function or per-ID query,
      // but for < 100 items this is fine.
      for (const r of result.rows) {
        const existing = out.get(r.to_id) ?? [];
        if (existing.length < 3) {
          existing.push({ name: r.from_name, filePath: r.from_path, relation: "caller" });
          out.set(r.to_id, existing);
        }
      }
    } catch (err) {
      logger.warn({ err }, "Failed to fetch top callers");
    }
    return out;
  }
}

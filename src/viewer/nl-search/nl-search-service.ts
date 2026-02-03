/**
 * Natural Language Search Service
 *
 * Main service that orchestrates natural language search.
 * Pipeline: Query → Tokenize → Classify → Build Query → Execute → Format
 *
 * @module
 */

import type { IGraphStore } from "../../core/interfaces/IGraphStore.js";
import type { IModelRouter } from "../../core/models/interfaces/IModel.js";
import { IntentClassifier, createIntentClassifier } from "./intent-classifier.js";
import { QueryBuilder, createQueryBuilder, type GeneratedQuery } from "./query-builder.js";
import type {
  NLSearchConfig,
  NLSearchResult,
  NLSearchResponse,
  IntentClassification,
} from "./types.js";
import { DEFAULT_NL_SEARCH_CONFIG } from "./types.js";

// =============================================================================
// Natural Language Search Service
// =============================================================================

export class NaturalLanguageSearchService {
  private store: IGraphStore;
  private classifier: IntentClassifier;
  private queryBuilder: QueryBuilder;
  private config: Required<NLSearchConfig>;
  private modelRouter?: IModelRouter;

  constructor(store: IGraphStore, config?: NLSearchConfig, modelRouter?: IModelRouter) {
    this.store = store;
    this.config = { ...DEFAULT_NL_SEARCH_CONFIG, ...config };
    this.modelRouter = modelRouter;
    this.classifier = createIntentClassifier(modelRouter, this.config.synonyms);
    this.queryBuilder = createQueryBuilder(this.config);
  }

  /**
   * Search using natural language query
   */
  async search(query: string): Promise<NLSearchResponse> {
    const startTime = Date.now();

    // Step 1: Classify intent
    const classification = await this.classifier.classify(query);

    // Step 2: Build queries
    const queries = this.queryBuilder.build(classification);

    // Step 3: Execute queries and collect results
    const results = await this.executeQueries(queries, classification);

    // Step 4: Deduplicate and rank results
    const rankedResults = this.rankResults(results, classification);

    // Step 5: Apply limit
    const finalResults = rankedResults.slice(0, this.config.maxResults);

    return {
      query,
      intent: classification,
      results: finalResults,
      totalCount: rankedResults.length,
      executionTimeMs: Date.now() - startTime,
      suggestion: this.generateSuggestion(classification, finalResults),
    };
  }

  /**
   * Execute generated queries against the graph store
   */
  private async executeQueries(
    queries: GeneratedQuery[],
    classification: IntentClassification
  ): Promise<NLSearchResult[]> {
    const allResults: NLSearchResult[] = [];

    for (const { script, params, description } of queries) {
      try {
        const result = await this.store.query<Record<string, unknown>>(script, params);

        for (const row of result.rows) {
          const searchResult = this.rowToSearchResult(row, classification, description);
          if (searchResult) {
            allResults.push(searchResult);
          }
        }
      } catch (error) {
        // Log error but continue with other queries
        console.error(`Query failed: ${description}`, error);
      }
    }

    return allResults;
  }

  /**
   * Convert query result row to NLSearchResult
   */
  private rowToSearchResult(
    row: Record<string, unknown>,
    classification: IntentClassification,
    _description: string
  ): NLSearchResult | null {
    // Extract common fields
    const id = (row.id || row.caller_id || row.callee_id || row.child_id || row.impl_id || row.method_id || row.importer_id || row.imported_id || row.entity_id) as string | undefined;
    const name = (row.name || row.caller_name || row.callee_name || row.child_name || row.impl_name || row.method_name || row.entity_name || row.relative_path || row.importer_path || row.imported_path) as string | undefined;
    const filePath = (row.file_path || row.caller_file || row.callee_file || row.child_file || row.impl_file || row.relative_path || row.importer_path || row.imported_path) as string | undefined;
    const line = (row.start_line || row.caller_line || row.callee_line) as number | undefined;
    const entityType = (row.entity_type as string) || this.inferEntityType(row, classification);

    if (!id || !name) {
      return null;
    }

    // Calculate relevance score
    const relevanceScore = this.calculateRelevance(row, classification);

    // Build context string
    const context = this.buildContext(row);

    return {
      entityType: entityType as NLSearchResult["entityType"],
      id,
      name,
      filePath: filePath || "",
      line,
      relevanceScore,
      matchType: this.determineMatchType(row, classification),
      context,
    };
  }

  /**
   * Infer entity type from row data
   */
  private inferEntityType(
    row: Record<string, unknown>,
    classification: IntentClassification
  ): string {
    if (row.signature !== undefined) return "function";
    if (row.is_abstract !== undefined || row.extends_class !== undefined) return "class";
    if (row.language !== undefined && row.size !== undefined) return "file";
    if (row.caller_name || row.callee_name) return "function";
    if (row.importer_path || row.imported_path) return "file";

    // Use classification hint
    return classification.entityType || "function";
  }

  /**
   * Calculate relevance score for a result
   */
  private calculateRelevance(
    row: Record<string, unknown>,
    classification: IntentClassification
  ): number {
    let score = 0.5; // Base score

    const name = String(row.name || row.relative_path || "").toLowerCase();
    const keywords = classification.keywords;

    // Exact match bonus
    for (const keyword of keywords) {
      if (name === keyword.toLowerCase()) {
        score += 0.3;
        break;
      }
    }

    // Partial match bonus
    for (const keyword of keywords) {
      if (name.includes(keyword.toLowerCase())) {
        score += 0.1;
      }
    }

    // Target entity match bonus
    if (classification.targetEntity) {
      const target = classification.targetEntity.toLowerCase();
      if (name.includes(target)) {
        score += 0.2;
      }
    }

    // Exported functions get slight bonus
    if (row.is_exported === true) {
      score += 0.05;
    }

    // Complexity ranking bonus (for rank_complexity intent)
    if (classification.intent === "rank_complexity" && typeof row.complexity === "number") {
      score += Math.min(0.3, row.complexity / 50);
    }

    // Call count ranking bonus
    if (classification.intent === "rank_calls" && typeof row.call_count === "number") {
      score += Math.min(0.3, row.call_count / 100);
    }

    return Math.min(1.0, score);
  }

  /**
   * Determine match type
   */
  private determineMatchType(
    row: Record<string, unknown>,
    classification: IntentClassification
  ): "exact" | "partial" | "semantic" {
    const name = String(row.name || row.relative_path || "").toLowerCase();

    // Check for exact match with target
    if (classification.targetEntity) {
      const target = classification.targetEntity.toLowerCase();
      if (name === target || name.endsWith(target)) {
        return "exact";
      }
    }

    // Check for exact match with keywords
    for (const keyword of classification.keywords) {
      if (name === keyword.toLowerCase()) {
        return "exact";
      }
    }

    // Otherwise partial match
    return "partial";
  }

  /**
   * Build context string for result
   */
  private buildContext(row: Record<string, unknown>): string | undefined {
    const parts: string[] = [];

    if (row.signature) {
      parts.push(String(row.signature));
    }
    if (row.extends_class) {
      parts.push(`extends ${row.extends_class}`);
    }
    if (row.complexity !== undefined) {
      parts.push(`complexity: ${row.complexity}`);
    }
    if (row.call_count !== undefined) {
      parts.push(`called ${row.call_count} times`);
    }
    if (row.size !== undefined) {
      parts.push(`${row.size} bytes`);
    }
    if (row.language) {
      parts.push(String(row.language));
    }

    return parts.length > 0 ? parts.join(" | ") : undefined;
  }

  /**
   * Rank and deduplicate results
   */
  private rankResults(
    results: NLSearchResult[],
    _classification: IntentClassification
  ): NLSearchResult[] {
    // Deduplicate by ID
    const seen = new Set<string>();
    const unique = results.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    // Sort by relevance score descending
    return unique.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Generate search refinement suggestion
   */
  private generateSuggestion(
    classification: IntentClassification,
    results: NLSearchResult[]
  ): string | undefined {
    if (results.length === 0) {
      if (classification.keywords.length > 0) {
        return `No results found. Try searching for: "${classification.keywords[0]}" or use broader terms.`;
      }
      return "No results found. Try a more specific query.";
    }

    if (classification.intent === "unknown" && classification.confidence < 0.5) {
      return `Try queries like "what calls X", "functions in path/", or "most complex functions"`;
    }

    if (results.length >= this.config.maxResults) {
      return `Showing top ${this.config.maxResults} results. Refine your query for more specific results.`;
    }

    return undefined;
  }

  /**
   * Get available search patterns for help
   */
  getSearchPatterns(): Array<{ pattern: string; description: string; example: string }> {
    return [
      {
        pattern: "what calls X",
        description: "Find functions that call X",
        example: "what calls authenticate",
      },
      {
        pattern: "what does X call",
        description: "Find functions called by X",
        example: "what does main call",
      },
      {
        pattern: "where is X implemented",
        description: "Find where X is implemented",
        example: "where is login implemented",
      },
      {
        pattern: "functions in path/",
        description: "Find functions in a directory",
        example: "functions in src/core/",
      },
      {
        pattern: "classes that extend X",
        description: "Find subclasses of X",
        example: "classes that extend BaseController",
      },
      {
        pattern: "what implements X",
        description: "Find implementations of interface X",
        example: "what implements IUserService",
      },
      {
        pattern: "methods of X",
        description: "Find methods of class X",
        example: "methods of UserService",
      },
      {
        pattern: "most complex functions",
        description: "Find high complexity functions",
        example: "most complex functions",
      },
      {
        pattern: "most called functions",
        description: "Find frequently called functions",
        example: "most called functions",
      },
      {
        pattern: "largest files",
        description: "Find largest files by size",
        example: "largest files",
      },
      {
        pattern: "external dependencies",
        description: "List external package dependencies",
        example: "external dependencies",
      },
      {
        pattern: "X handler",
        description: "Find handlers for X",
        example: "error handler",
      },
    ];
  }

  /**
   * Close the service and release resources
   */
  async close(): Promise<void> {
    if (this.modelRouter) {
      await this.modelRouter.shutdown();
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a natural language search service
 */
export function createNLSearchService(
  store: IGraphStore,
  config?: NLSearchConfig,
  modelRouter?: IModelRouter
): NaturalLanguageSearchService {
  return new NaturalLanguageSearchService(store, config, modelRouter);
}

/**
 * Create a natural language search service with model router support
 */
export async function createNLSearchServiceWithLLM(
  store: IGraphStore,
  config?: NLSearchConfig
): Promise<NaturalLanguageSearchService> {
  // Use the clean public API from models layer
  const { createConfiguredModelRouter } = await import("../../core/models/index.js");

  // Default to local provider with fastest model for NL search
  const { router } = await createConfiguredModelRouter({
    provider: "local",
  });

  return new NaturalLanguageSearchService(store, config, router);
}

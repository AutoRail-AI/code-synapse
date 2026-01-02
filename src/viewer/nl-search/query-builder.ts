/**
 * Query Builder
 *
 * Generates CozoScript queries based on classified search intent.
 * Follows the patterns defined in docs/plans/natural-language-search.md
 *
 * @module
 */

import type { IntentClassification, NLSearchConfig } from "./types.js";
import { DEFAULT_NL_SEARCH_CONFIG } from "./types.js";

// =============================================================================
// Types
// =============================================================================

export interface GeneratedQuery {
  script: string;
  params: Record<string, unknown>;
  description: string;
}

// =============================================================================
// Query Builder
// =============================================================================

export class QueryBuilder {
  private config: Required<NLSearchConfig>;

  constructor(config?: NLSearchConfig) {
    this.config = { ...DEFAULT_NL_SEARCH_CONFIG, ...config };
  }

  /**
   * Build CozoScript query based on intent classification
   */
  build(classification: IntentClassification): GeneratedQuery[] {
    const { intent, keywords, targetEntity, scope, entityType } = classification;

    switch (intent) {
      case "find_function":
        return this.buildFindFunction(keywords, targetEntity);

      case "find_class":
        return this.buildFindClass(keywords, targetEntity, entityType);

      case "find_file":
        return this.buildFindFile(keywords, targetEntity);

      case "find_location":
        return this.buildFindLocation(keywords, targetEntity);

      case "show_callers":
        return this.buildShowCallers(targetEntity, keywords);

      case "show_callees":
        return this.buildShowCallees(targetEntity, keywords);

      case "show_imports":
        return this.buildShowImports(targetEntity, keywords);

      case "show_importers":
        return this.buildShowImporters(targetEntity, keywords);

      case "show_hierarchy":
        return this.buildShowHierarchy(targetEntity, keywords);

      case "show_methods":
        return this.buildShowMethods(targetEntity, keywords);

      case "explain":
        return this.buildExplain(targetEntity, keywords);

      case "rank_complexity":
        return this.buildRankComplexity(targetEntity);

      case "rank_calls":
        return this.buildRankCalls();

      case "rank_size":
        return this.buildRankSize();

      case "filter_scope":
        return this.buildFilterScope(scope, entityType, keywords);

      case "find_dependencies":
        return this.buildFindDependencies(targetEntity);

      case "semantic_search":
        return this.buildSemanticSearch(keywords);

      case "unknown":
      default:
        // Fallback: search across all entity types
        return this.buildFallbackSearch(keywords);
    }
  }

  // ===========================================================================
  // Query Builders by Intent
  // ===========================================================================

  /**
   * Find functions by name
   */
  private buildFindFunction(keywords: string[], target?: string): GeneratedQuery[] {
    const searchTerms = target ? [target, ...keywords] : keywords;
    if (searchTerms.length === 0) {
      return [this.buildListFunctions()];
    }

    const conditions = this.buildNameConditions(searchTerms, "name");

    return [
      {
        script: `
          ?[id, name, file_path, signature, start_line, complexity, is_exported] :=
            *function{id, name, file_id, signature, start_line, complexity, is_exported},
            *file{id: file_id, relative_path: file_path},
            ${conditions}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find functions matching: ${searchTerms.join(", ")}`,
      },
    ];
  }

  /**
   * Find classes/interfaces by name
   */
  private buildFindClass(
    keywords: string[],
    target?: string,
    entityType?: string
  ): GeneratedQuery[] {
    const searchTerms = target ? [target, ...keywords] : keywords;
    const queries: GeneratedQuery[] = [];

    if (entityType !== "interface") {
      const conditions = searchTerms.length > 0 ? this.buildNameConditions(searchTerms, "name") : "true";
      queries.push({
        script: `
          ?[id, name, file_path, start_line, is_exported, is_abstract, extends_class] :=
            *class{id, name, file_id, start_line, is_exported, is_abstract, extends: extends_class},
            *file{id: file_id, relative_path: file_path},
            ${conditions}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find classes matching: ${searchTerms.join(", ") || "all"}`,
      });
    }

    if (entityType !== "class") {
      const conditions = searchTerms.length > 0 ? this.buildNameConditions(searchTerms, "name") : "true";
      queries.push({
        script: `
          ?[id, name, file_path, start_line, is_exported] :=
            *interface{id, name, file_id, start_line, is_exported},
            *file{id: file_id, relative_path: file_path},
            ${conditions}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find interfaces matching: ${searchTerms.join(", ") || "all"}`,
      });
    }

    return queries;
  }

  /**
   * Find files by name/path
   */
  private buildFindFile(keywords: string[], target?: string): GeneratedQuery[] {
    const searchTerms = target ? [target, ...keywords] : keywords;
    if (searchTerms.length === 0) {
      return [this.buildListFiles()];
    }

    const conditions = this.buildNameConditions(searchTerms, "relative_path");

    return [
      {
        script: `
          ?[id, relative_path, language, size] :=
            *file{id, relative_path, language, size},
            ${conditions}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find files matching: ${searchTerms.join(", ")}`,
      },
    ];
  }

  /**
   * Find where something is implemented (multi-entity search)
   */
  private buildFindLocation(keywords: string[], target?: string): GeneratedQuery[] {
    const searchTerms = target ? [target, ...keywords] : keywords;
    if (searchTerms.length === 0) {
      return [];
    }

    const fnConditions = this.buildNameConditions(searchTerms, "name");
    const fileConditions = this.buildNameConditions(searchTerms, "relative_path");

    return [
      // Search functions
      {
        script: `
          ?[id, name, file_path, signature, start_line, entity_type] :=
            *function{id, name, file_id, signature, start_line},
            *file{id: file_id, relative_path: file_path},
            entity_type = "function",
            ${fnConditions}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find functions where "${target || searchTerms.join(" ")}" is implemented`,
      },
      // Search files/directories
      {
        script: `
          ?[id, relative_path, language, entity_type] :=
            *file{id, relative_path, language},
            entity_type = "file",
            ${fileConditions}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find files matching "${target || searchTerms.join(" ")}"`,
      },
      // Search classes
      {
        script: `
          ?[id, name, file_path, start_line, entity_type] :=
            *class{id, name, file_id, start_line},
            *file{id: file_id, relative_path: file_path},
            entity_type = "class",
            ${fnConditions}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find classes matching "${target || searchTerms.join(" ")}"`,
      },
    ];
  }

  /**
   * Find callers of a function
   */
  private buildShowCallers(target?: string, keywords?: string[]): GeneratedQuery[] {
    const searchTerms = target ? [target] : keywords || [];
    if (searchTerms.length === 0) {
      return [];
    }

    const targetCondition = this.buildNameConditions(searchTerms, "target_name");

    return [
      {
        script: `
          ?[caller_id, caller_name, caller_file, caller_line, target_name] :=
            *function{id: target_id, name: target_name},
            ${targetCondition},
            *calls{to_id: target_id, from_id: caller_id},
            *function{id: caller_id, name: caller_name, file_id, start_line: caller_line},
            *file{id: file_id, relative_path: caller_file}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find callers of "${target || searchTerms.join(" ")}"`,
      },
    ];
  }

  /**
   * Find functions called by a function
   */
  private buildShowCallees(target?: string, keywords?: string[]): GeneratedQuery[] {
    const searchTerms = target ? [target] : keywords || [];
    if (searchTerms.length === 0) {
      return [];
    }

    const sourceCondition = this.buildNameConditions(searchTerms, "source_name");

    return [
      {
        script: `
          ?[callee_id, callee_name, callee_file, callee_line, source_name] :=
            *function{id: source_id, name: source_name},
            ${sourceCondition},
            *calls{from_id: source_id, to_id: callee_id},
            *function{id: callee_id, name: callee_name, file_id, start_line: callee_line},
            *file{id: file_id, relative_path: callee_file}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find functions called by "${target || searchTerms.join(" ")}"`,
      },
    ];
  }

  /**
   * Find files imported by a file
   */
  private buildShowImports(target?: string, keywords?: string[]): GeneratedQuery[] {
    const searchTerms = target ? [target] : keywords || [];
    if (searchTerms.length === 0) {
      return [];
    }

    const sourceCondition = this.buildNameConditions(searchTerms, "source_path");

    return [
      {
        script: `
          ?[imported_id, imported_path, source_path] :=
            *file{id: source_id, relative_path: source_path},
            ${sourceCondition},
            *imports{from_id: source_id, to_id: imported_id},
            *file{id: imported_id, relative_path: imported_path}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find imports of "${target || searchTerms.join(" ")}"`,
      },
    ];
  }

  /**
   * Find files that import a file
   */
  private buildShowImporters(target?: string, keywords?: string[]): GeneratedQuery[] {
    const searchTerms = target ? [target] : keywords || [];
    if (searchTerms.length === 0) {
      return [];
    }

    const targetCondition = this.buildNameConditions(searchTerms, "target_path");

    return [
      {
        script: `
          ?[importer_id, importer_path, target_path] :=
            *file{id: target_id, relative_path: target_path},
            ${targetCondition},
            *imports{to_id: target_id, from_id: importer_id},
            *file{id: importer_id, relative_path: importer_path}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find files that import "${target || searchTerms.join(" ")}"`,
      },
    ];
  }

  /**
   * Find class hierarchy (extends/implements)
   */
  private buildShowHierarchy(target?: string, keywords?: string[]): GeneratedQuery[] {
    const searchTerms = target ? [target] : keywords || [];
    if (searchTerms.length === 0) {
      return [];
    }

    const targetCondition = this.buildNameConditions(searchTerms, "parent_name");

    return [
      // Classes that extend
      {
        script: `
          ?[child_id, child_name, child_file, parent_name] :=
            *class{id: parent_id, name: parent_name},
            ${targetCondition},
            *extends{to_id: parent_id, from_id: child_id},
            *class{id: child_id, name: child_name, file_id},
            *file{id: file_id, relative_path: child_file}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find classes extending "${target || searchTerms.join(" ")}"`,
      },
      // Classes that implement
      {
        script: `
          ?[impl_id, impl_name, impl_file, interface_name] :=
            *interface{id: interface_id, name: interface_name},
            ${targetCondition.replace("parent_name", "interface_name")},
            *implements{to_id: interface_id, from_id: impl_id},
            *class{id: impl_id, name: impl_name, file_id},
            *file{id: file_id, relative_path: impl_file}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find classes implementing "${target || searchTerms.join(" ")}"`,
      },
    ];
  }

  /**
   * Find methods of a class
   */
  private buildShowMethods(target?: string, keywords?: string[]): GeneratedQuery[] {
    const searchTerms = target ? [target] : keywords || [];
    if (searchTerms.length === 0) {
      return [];
    }

    const classCondition = this.buildNameConditions(searchTerms, "class_name");

    return [
      {
        script: `
          ?[method_id, method_name, method_signature, class_name, file_path] :=
            *class{id: class_id, name: class_name, file_id},
            ${classCondition},
            *has_method{from_id: class_id, to_id: method_id},
            *function{id: method_id, name: method_name, signature: method_signature},
            *file{id: file_id, relative_path: file_path}
          :limit ${this.config.maxResults}
        `,
        params: this.buildSearchParams(searchTerms),
        description: `Find methods of "${target || searchTerms.join(" ")}"`,
      },
    ];
  }

  /**
   * Explain how something works (entry points + callees)
   */
  private buildExplain(target?: string, keywords?: string[]): GeneratedQuery[] {
    // Combine location search with callees
    const locationQueries = this.buildFindLocation(keywords || [], target);
    const calleeQueries = target ? this.buildShowCallees(target, keywords) : [];

    return [...locationQueries, ...calleeQueries];
  }

  /**
   * Rank functions by complexity
   */
  private buildRankComplexity(threshold?: string): GeneratedQuery[] {
    const minComplexity = threshold ? parseInt(threshold, 10) : 0;

    return [
      {
        script: `
          ?[id, name, file_path, complexity, start_line] :=
            *function{id, name, file_id, complexity, start_line},
            *file{id: file_id, relative_path: file_path},
            complexity > $minComplexity
          :order -complexity
          :limit ${this.config.maxResults}
        `,
        params: { minComplexity },
        description: `Find functions with complexity > ${minComplexity}, sorted by complexity`,
      },
    ];
  }

  /**
   * Rank functions by call count
   * CozoDB aggregations must be in HEAD: call_counts[to_id, count(from_id)] := ...
   */
  private buildRankCalls(): GeneratedQuery[] {
    return [
      {
        script: `
          call_counts[to_id, count(from_id)] := *calls{from_id, to_id}

          ?[id, name, file_path, call_count] :=
            call_counts[id, call_count],
            *function{id, name, file_id},
            *file{id: file_id, relative_path: file_path}
          :order -call_count
          :limit ${this.config.maxResults}
        `,
        params: {},
        description: "Find most frequently called functions",
      },
    ];
  }

  /**
   * Rank files by size
   */
  private buildRankSize(): GeneratedQuery[] {
    return [
      {
        script: `
          ?[id, relative_path, language, size] :=
            *file{id, relative_path, language, size}
          :order -size
          :limit ${this.config.maxResults}
        `,
        params: {},
        description: "Find largest files by size",
      },
    ];
  }

  /**
   * Filter by scope (path prefix)
   */
  private buildFilterScope(
    scope?: string,
    entityType?: string,
    keywords?: string[]
  ): GeneratedQuery[] {
    const path = scope || (keywords && keywords[0]) || "";
    const queries: GeneratedQuery[] = [];

    if (!entityType || entityType === "function" || entityType === "all") {
      queries.push({
        script: `
          ?[id, name, file_path, signature, start_line] :=
            *function{id, name, file_id, signature, start_line},
            *file{id: file_id, relative_path: file_path},
            starts_with(file_path, $path)
          :limit ${this.config.maxResults}
        `,
        params: { path },
        description: `Find functions in "${path}"`,
      });
    }

    if (!entityType || entityType === "class" || entityType === "all") {
      queries.push({
        script: `
          ?[id, name, file_path, start_line] :=
            *class{id, name, file_id, start_line},
            *file{id: file_id, relative_path: file_path},
            starts_with(file_path, $path)
          :limit ${this.config.maxResults}
        `,
        params: { path },
        description: `Find classes in "${path}"`,
      });
    }

    return queries;
  }

  /**
   * Find external dependencies
   * Schema: references_external{from_id, to_id => context, line_number}
   * Schema: ghost_node{id => name, package_name, entity_type, signature, is_external}
   */
  private buildFindDependencies(target?: string): GeneratedQuery[] {
    if (target) {
      const escaped = this.escapeRegex(target.toLowerCase());
      return [
        {
          script: `
            ?[entity_id, entity_name, ghost_id, package_name] :=
              *ghost_node{id: ghost_id, package_name, is_external},
              is_external = true,
              regex_matches(lowercase(package_name), $target),
              *references_external{from_id: entity_id, to_id: ghost_id},
              *function{id: entity_id, name: entity_name}
            :limit ${this.config.maxResults}
          `,
          params: { target: `.*${escaped}.*` },
          description: `Find code using "${target}"`,
        },
      ];
    }

    return [
      {
        script: `
          dep_counts[pkg, count(from_id)] :=
            *ghost_node{id: ghost_id, package_name: pkg, is_external},
            is_external = true,
            *references_external{from_id, to_id: ghost_id}

          ?[package_name, ref_count] :=
            dep_counts[package_name, ref_count]
          :order -ref_count
          :limit ${this.config.maxResults}
        `,
        params: {},
        description: "List external dependencies by usage",
      },
    ];
  }

  /**
   * Semantic search (placeholder - requires embeddings)
   */
  private buildSemanticSearch(keywords: string[]): GeneratedQuery[] {
    // For now, fall back to keyword search
    // When embeddings are implemented, this will use vector search
    return this.buildFindLocation(keywords);
  }

  /**
   * Fallback search across all entity types
   */
  private buildFallbackSearch(keywords: string[]): GeneratedQuery[] {
    if (keywords.length === 0) {
      return [this.buildListFunctions()];
    }

    return this.buildFindLocation(keywords);
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Build list functions query
   */
  private buildListFunctions(): GeneratedQuery {
    return {
      script: `
        ?[id, name, file_path, signature, start_line, complexity] :=
          *function{id, name, file_id, signature, start_line, complexity},
          *file{id: file_id, relative_path: file_path}
        :limit ${this.config.maxResults}
      `,
      params: {},
      description: "List all functions",
    };
  }

  /**
   * Build list files query
   */
  private buildListFiles(): GeneratedQuery {
    return {
      script: `
        ?[id, relative_path, language, size] :=
          *file{id, relative_path, language, size}
        :limit ${this.config.maxResults}
      `,
      params: {},
      description: "List all files",
    };
  }

  /**
   * Build OR conditions for name matching using CozoDB's regex_matches
   * Uses pattern: .*term.* for case-insensitive substring matching
   */
  private buildNameConditions(terms: string[], field: string): string {
    if (terms.length === 0) return "true";
    if (terms.length === 1) {
      // CozoDB uses regex_matches(string, pattern) for pattern matching
      return `regex_matches(lowercase(${field}), $term0)`;
    }

    // For multiple terms, use OR with regex patterns
    const conditions = terms.map((_, i) => `regex_matches(lowercase(${field}), $term${i})`);
    return `or(${conditions.join(", ")})`;
  }

  /**
   * Build params object for search terms
   * Creates regex patterns for case-insensitive substring matching
   */
  private buildSearchParams(terms: string[]): Record<string, string> {
    const params: Record<string, string> = {};
    terms.forEach((term, i) => {
      // Escape special regex characters and create substring pattern
      const escaped = this.escapeRegex(term.toLowerCase());
      params[`term${i}`] = `.*${escaped}.*`;
    });
    return params;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a query builder
 */
export function createQueryBuilder(config?: NLSearchConfig): QueryBuilder {
  return new QueryBuilder(config);
}

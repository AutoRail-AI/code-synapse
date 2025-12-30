/**
 * Type-Safe CozoScript Query Builder
 *
 * Provides a fluent API for building CozoScript queries with compile-time
 * type safety. Prevents runtime errors from typos in relation/field names.
 *
 * @module
 */

import type { NodeName, RelationshipName } from "./schema-definitions.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Field mapping for snake_case conversion (compile-time utility)
 * Prefixed with underscore as it's reserved for future type-level operations
 */
type _SnakeCase<S extends string> = S extends `${infer T}${infer U}`
  ? `${T extends Capitalize<T> ? "_" : ""}${Lowercase<T>}${_SnakeCase<U>}`
  : S;

/**
 * Query condition
 */
export interface QueryCondition {
  field: string;
  operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "starts_with" | "ends_with";
  value: unknown;
  paramName?: string;
}

/**
 * Vector search options
 */
export interface VectorSearchOptions {
  field: string;
  embedding: number[];
  limit: number;
  minDistance?: number;
}

/**
 * Query builder result
 */
export interface BuiltQuery {
  script: string;
  params: Record<string, unknown>;
}

// =============================================================================
// Reusable Datalog Rules
// =============================================================================

/**
 * Pre-defined Datalog rules for common graph traversals
 */
export const CozoRules = {
  /**
   * Recursive call chain traversal
   * Finds all functions reachable from a starting function
   */
  RECURSIVE_CALLS: `
    calls_recursive[from_id, to_id] := *calls{from_id, to_id}
    calls_recursive[from_id, to_id] := calls_recursive[from_id, mid], *calls{from_id: mid, to_id}
  `,

  /**
   * Recursive import chain traversal
   * Finds all files imported transitively
   */
  RECURSIVE_IMPORTS: `
    imports_recursive[from_id, to_id, depth] := *imports{from_id, to_id}, depth = 1
    imports_recursive[from_id, to_id, depth] := imports_recursive[from_id, mid, d], d < 10, *imports{from_id: mid, to_id}, depth = d + 1
  `,

  /**
   * Find all callers of a function (reverse call graph)
   */
  CALLERS_OF: `
    callers[caller_id] := *calls{from_id: caller_id, to_id: $target_id}
    callers[caller_id] := callers[mid], *calls{from_id: caller_id, to_id: mid}
  `,

  /**
   * Find class hierarchy (extends chain)
   */
  CLASS_HIERARCHY: `
    inherits[child_id, parent_id, depth] := *extends{from_id: child_id, to_id: parent_id}, depth = 1
    inherits[child_id, ancestor_id, depth] := inherits[child_id, mid, d], d < 10, *extends{from_id: mid, to_id: ancestor_id}, depth = d + 1
  `,
} as const;

// =============================================================================
// Query Builder Class
// =============================================================================

/**
 * Fluent query builder for CozoScript
 *
 * @example
 * ```typescript
 * const query = new CozoQueryBuilder()
 *   .from('function')
 *   .where('name', '=', 'authenticate')
 *   .select(['id', 'name', 'signature'])
 *   .orderBy('start_line')
 *   .limit(10)
 *   .build();
 *
 * const results = await db.query(query.script, query.params);
 * ```
 */
export class CozoQueryBuilder {
  private relation: string = "";
  private selectedFields: string[] = [];
  private conditions: QueryCondition[] = [];
  private joins: Array<{ relation: string; on: string }> = [];
  private orderByField?: string;
  private orderDirection: "asc" | "desc" = "asc";
  private limitCount?: number;
  private offsetCount?: number;
  private customRules: string[] = [];
  private vectorSearch?: VectorSearchOptions;
  private paramCounter = 0;
  private params: Record<string, unknown> = {};

  /**
   * Sets the primary relation to query from
   */
  from(relation: NodeName | RelationshipName | string): this {
    this.relation = relation.toLowerCase();
    return this;
  }

  /**
   * Adds fields to select
   */
  select(fields: string[]): this {
    this.selectedFields = fields.map((f) => this.toSnakeCase(f));
    return this;
  }

  /**
   * Adds a WHERE condition
   */
  where(field: string, operator: QueryCondition["operator"], value: unknown): this {
    const paramName = `p${++this.paramCounter}`;
    this.params[paramName] = value;
    this.conditions.push({
      field: this.toSnakeCase(field),
      operator,
      value,
      paramName,
    });
    return this;
  }

  /**
   * Adds a join to another relation
   */
  join(relation: string, onField: string): this {
    this.joins.push({
      relation: relation.toLowerCase(),
      on: this.toSnakeCase(onField),
    });
    return this;
  }

  /**
   * Adds ORDER BY clause
   */
  orderBy(field: string, direction: "asc" | "desc" = "asc"): this {
    this.orderByField = this.toSnakeCase(field);
    this.orderDirection = direction;
    return this;
  }

  /**
   * Adds LIMIT clause
   */
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  /**
   * Adds OFFSET clause
   */
  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }

  /**
   * Adds a custom Datalog rule
   */
  withRule(rule: string): this {
    this.customRules.push(rule);
    return this;
  }

  /**
   * Adds vector similarity search
   */
  withVectorSearch(options: VectorSearchOptions): this {
    this.vectorSearch = options;
    return this;
  }

  /**
   * Builds the CozoScript query
   */
  build(): BuiltQuery {
    const parts: string[] = [];

    // Add custom rules
    if (this.customRules.length > 0) {
      parts.push(...this.customRules);
    }

    // Build the main query
    const queryParts: string[] = [];

    // Select clause
    const selectFields =
      this.selectedFields.length > 0 ? this.selectedFields.join(", ") : "*";
    queryParts.push(`?[${selectFields}]`);

    // From clause with relation binding
    const relationBinding = this.buildRelationBinding();
    queryParts.push(`:= ${relationBinding}`);

    // Add conditions
    for (const cond of this.conditions) {
      queryParts.push(`, ${this.buildCondition(cond)}`);
    }

    // Add joins
    for (const join of this.joins) {
      queryParts.push(`, *${join.relation}{${join.on}}`);
    }

    // Add vector search if specified
    if (this.vectorSearch) {
      const vecParamName = `vec_${++this.paramCounter}`;
      this.params[vecParamName] = this.vectorSearch.embedding;
      queryParts.push(
        `, v_knn(${this.vectorSearch.field}, $${vecParamName}, ${this.vectorSearch.limit}, _dist)`
      );
      if (this.vectorSearch.minDistance !== undefined) {
        queryParts.push(`, _dist < ${this.vectorSearch.minDistance}`);
      }
    }

    parts.push(queryParts.join("\n       "));

    // Add order by
    if (this.orderByField) {
      const direction = this.orderDirection === "desc" ? "-" : "";
      parts.push(`:order ${direction}${this.orderByField}`);
    }

    // Add limit
    if (this.limitCount !== undefined) {
      parts.push(`:limit ${this.limitCount}`);
    }

    // Add offset
    if (this.offsetCount !== undefined) {
      parts.push(`:offset ${this.offsetCount}`);
    }

    return {
      script: parts.join("\n"),
      params: this.params,
    };
  }

  /**
   * Builds the relation binding part
   */
  private buildRelationBinding(): string {
    if (this.selectedFields.length > 0) {
      const fieldBindings = this.selectedFields.map((f) => f).join(", ");
      return `*${this.relation}{${fieldBindings}}`;
    }
    return `*${this.relation}{}`;
  }

  /**
   * Builds a condition expression
   */
  private buildCondition(cond: QueryCondition): string {
    const { field, operator, paramName } = cond;

    switch (operator) {
      case "=":
        return `${field} = $${paramName}`;
      case "!=":
        return `${field} != $${paramName}`;
      case ">":
        return `${field} > $${paramName}`;
      case "<":
        return `${field} < $${paramName}`;
      case ">=":
        return `${field} >= $${paramName}`;
      case "<=":
        return `${field} <= $${paramName}`;
      case "contains":
        return `contains(${field}, $${paramName})`;
      case "starts_with":
        return `starts_with(${field}, $${paramName})`;
      case "ends_with":
        return `ends_with(${field}, $${paramName})`;
      default:
        return `${field} = $${paramName}`;
    }
  }

  /**
   * Converts camelCase to snake_case
   */
  private toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }
}

// =============================================================================
// Specialized Query Builders
// =============================================================================

/**
 * Builds a vector similarity search query
 */
export function buildVectorSearch(
  relation: string,
  embeddingField: string,
  embedding: number[],
  limit: number = 10,
  selectFields: string[] = ["id"]
): BuiltQuery {
  const fieldsStr = selectFields.join(", ");
  const script = `
    ?[${fieldsStr}, distance] :=
        *${relation}{${selectFields.map((f) => f).join(", ")}, ${embeddingField}: vec},
        v_knn(vec, $query_embedding, ${limit}, distance)
    :order distance
  `;
  return {
    script,
    params: { query_embedding: embedding },
  };
}

/**
 * Builds a recursive call chain query
 */
export function buildCallChain(startFunctionId: string): BuiltQuery {
  const script = `
    ${CozoRules.RECURSIVE_CALLS}
    ?[to_id, name, file_id] :=
        calls_recursive[$start_id, to_id],
        *function{id: to_id, name, file_id}
  `;
  return {
    script,
    params: { start_id: startFunctionId },
  };
}

/**
 * Builds a recursive import chain query
 */
export function buildImportChain(startFileId: string, maxDepth: number = 10): BuiltQuery {
  const script = `
    imports_chain[to_id, depth] := *imports{from_id, to_id}, from_id = $start_id, depth = 1
    imports_chain[to_id, depth] := imports_chain[mid, d], d < $max_depth, *imports{from_id: mid, to_id}, depth = d + 1
    ?[id, path, relative_path, depth] :=
        imports_chain[id, depth],
        *file{id, path, relative_path}
    :order depth
  `;
  return {
    script,
    params: { start_id: startFileId, max_depth: maxDepth },
  };
}

/**
 * Builds a query to find all callers of a function
 */
export function buildCallerSearch(targetFunctionId: string): BuiltQuery {
  const script = `
    callers[caller_id] := *calls{from_id: caller_id, to_id}, to_id = $target_id
    callers[caller_id] := callers[mid], *calls{from_id: caller_id, to_id: mid}
    ?[id, name, file_id, signature] :=
        callers[id],
        *function{id, name, file_id, signature}
  `;
  return {
    script,
    params: { target_id: targetFunctionId },
  };
}

/**
 * Builds a hybrid search query (vector + keyword)
 */
export function buildHybridSearch(
  embedding: number[],
  keywordPattern: string,
  vectorLimit: number = 20,
  finalLimit: number = 10
): BuiltQuery {
  const script = `
    # Vector search results
    vec_results[id, vec_score] :=
        *function{id, logic_embedding: vec, name},
        v_knn(vec, $embedding, ${vectorLimit}, vec_score)

    # Keyword search results
    kw_results[id] :=
        *function{id, name},
        contains(name, $pattern)

    # Combine results - boost items in both
    combined[id, score] := vec_results[id, vec_score], kw_results[id], score = vec_score * 0.5
    combined[id, score] := vec_results[id, score], not kw_results[id]
    combined[id, score] := kw_results[id], not vec_results[id, _], score = 0.9

    ?[id, name, file_id, signature, score] :=
        combined[id, score],
        *function{id, name, file_id, signature}
    :order score
    :limit ${finalLimit}
  `;
  return {
    script,
    params: { embedding, pattern: keywordPattern },
  };
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a new query builder instance
 */
export function query(): CozoQueryBuilder {
  return new CozoQueryBuilder();
}

/**
 * Creates a query builder starting from a specific relation
 */
export function from(relation: NodeName | RelationshipName | string): CozoQueryBuilder {
  return new CozoQueryBuilder().from(relation);
}

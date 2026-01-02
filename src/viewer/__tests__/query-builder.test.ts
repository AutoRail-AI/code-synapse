/**
 * Query Builder Tests
 *
 * Tests for CozoScript query generation based on search intents.
 *
 * @module
 */

import { describe, it, expect, beforeAll } from "vitest";
import { QueryBuilder, createQueryBuilder, type GeneratedQuery } from "../nl-search/query-builder.js";
import type { IntentClassification } from "../nl-search/types.js";

describe("Query Builder", () => {
  let builder: QueryBuilder;

  beforeAll(() => {
    builder = createQueryBuilder({ maxResults: 50 });
  });

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  function createClassification(
    intent: IntentClassification["intent"],
    options: Partial<IntentClassification> = {}
  ): IntentClassification {
    return {
      intent,
      confidence: 0.9,
      keywords: [],
      ...options,
    };
  }

  function expectValidQuery(query: GeneratedQuery): void {
    expect(query.script).toBeDefined();
    expect(query.script.length).toBeGreaterThan(0);
    expect(query.params).toBeDefined();
    expect(query.description).toBeDefined();
  }

  // ===========================================================================
  // Find Function Tests
  // ===========================================================================
  describe("find_function intent", () => {
    it("should build query for finding functions by name", () => {
      const classification = createClassification("find_function", {
        keywords: ["authenticate"],
        targetEntity: "authenticate",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expectValidQuery(queries[0]!);

      const query = queries[0]!;
      expect(query.script).toContain("*function");
      expect(query.script).toContain("*file");
      expect(query.script).toContain(":limit");
      expect(query.description).toContain("authenticate");
    });

    it("should handle empty keywords by listing functions", () => {
      const classification = createClassification("find_function", {
        keywords: [],
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expectValidQuery(queries[0]!);
      expect(queries[0]!.description).toContain("List all functions");
    });

    it("should include function fields in query", () => {
      const classification = createClassification("find_function", {
        keywords: ["main"],
        targetEntity: "main",
      });

      const queries = builder.build(classification);
      const script = queries[0]!.script;

      expect(script).toContain("name");
      expect(script).toContain("file_path");
      expect(script).toContain("signature");
      expect(script).toContain("start_line");
      expect(script).toContain("complexity");
    });
  });

  // ===========================================================================
  // Find Class Tests
  // ===========================================================================
  describe("find_class intent", () => {
    it("should build queries for classes and interfaces", () => {
      const classification = createClassification("find_class", {
        keywords: ["UserService"],
        targetEntity: "UserService",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(2); // One for classes, one for interfaces
      queries.forEach(expectValidQuery);

      const classQuery = queries.find((q) => q.script.includes("*class{"));
      const interfaceQuery = queries.find((q) => q.script.includes("*interface{"));

      expect(classQuery).toBeDefined();
      expect(interfaceQuery).toBeDefined();
    });

    it("should only query classes when entityType is class", () => {
      const classification = createClassification("find_class", {
        keywords: ["UserService"],
        entityType: "class",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.script).toContain("*class{");
      expect(queries[0]!.script).not.toContain("*interface{");
    });

    it("should only query interfaces when entityType is interface", () => {
      const classification = createClassification("find_class", {
        keywords: ["IParser"],
        entityType: "interface",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.script).toContain("*interface{");
      expect(queries[0]!.script).not.toContain("*class{");
    });
  });

  // ===========================================================================
  // Find File Tests
  // ===========================================================================
  describe("find_file intent", () => {
    it("should build query for finding files", () => {
      const classification = createClassification("find_file", {
        keywords: ["index.ts"],
        targetEntity: "index.ts",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expectValidQuery(queries[0]!);

      const query = queries[0]!;
      expect(query.script).toContain("*file{");
      expect(query.script).toContain("relative_path");
      expect(query.script).toContain("language");
      expect(query.script).toContain("size");
    });

    it("should handle empty keywords by listing files", () => {
      const classification = createClassification("find_file", {
        keywords: [],
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.description).toContain("List all files");
    });
  });

  // ===========================================================================
  // Find Location Tests
  // ===========================================================================
  describe("find_location intent", () => {
    it("should build multi-entity search queries", () => {
      const classification = createClassification("find_location", {
        keywords: ["createParser"],
        targetEntity: "createParser",
      });

      const queries = builder.build(classification);
      expect(queries.length).toBeGreaterThan(1);
      queries.forEach(expectValidQuery);

      // Should search functions, files, and classes
      const hasFunction = queries.some((q) => q.script.includes("*function"));
      const hasFile = queries.some((q) => q.script.includes("*file{"));
      const hasClass = queries.some((q) => q.script.includes("*class{"));

      expect(hasFunction).toBe(true);
      expect(hasFile).toBe(true);
      expect(hasClass).toBe(true);
    });

    it("should return empty for no keywords", () => {
      const classification = createClassification("find_location", {
        keywords: [],
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Show Callers Tests
  // ===========================================================================
  describe("show_callers intent", () => {
    it("should build caller query", () => {
      const classification = createClassification("show_callers", {
        keywords: ["authenticate"],
        targetEntity: "authenticate",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expectValidQuery(queries[0]!);

      const query = queries[0]!;
      expect(query.script).toContain("*calls{");
      expect(query.script).toContain("to_id: target_id");
      expect(query.script).toContain("caller_name");
      expect(query.description).toContain("callers");
    });

    it("should return empty for no target", () => {
      const classification = createClassification("show_callers", {
        keywords: [],
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Show Callees Tests
  // ===========================================================================
  describe("show_callees intent", () => {
    it("should build callee query", () => {
      const classification = createClassification("show_callees", {
        keywords: ["main"],
        targetEntity: "main",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expectValidQuery(queries[0]!);

      const query = queries[0]!;
      expect(query.script).toContain("*calls{");
      expect(query.script).toContain("from_id: source_id");
      expect(query.script).toContain("callee_name");
      expect(query.description).toContain("called by");
    });
  });

  // ===========================================================================
  // Show Imports Tests
  // ===========================================================================
  describe("show_imports intent", () => {
    it("should build imports query", () => {
      const classification = createClassification("show_imports", {
        keywords: ["index.ts"],
        targetEntity: "index.ts",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expectValidQuery(queries[0]!);

      const query = queries[0]!;
      expect(query.script).toContain("*imports{");
      expect(query.script).toContain("from_id: source_id");
      expect(query.description).toContain("imports");
    });
  });

  // ===========================================================================
  // Show Importers Tests
  // ===========================================================================
  describe("show_importers intent", () => {
    it("should build importers query", () => {
      const classification = createClassification("show_importers", {
        keywords: ["UserService"],
        targetEntity: "UserService",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expectValidQuery(queries[0]!);

      const query = queries[0]!;
      expect(query.script).toContain("*imports{");
      expect(query.script).toContain("to_id: target_id");
      expect(query.description).toContain("import");
    });
  });

  // ===========================================================================
  // Show Hierarchy Tests
  // ===========================================================================
  describe("show_hierarchy intent", () => {
    it("should build hierarchy queries for extends and implements", () => {
      const classification = createClassification("show_hierarchy", {
        keywords: ["BaseService"],
        targetEntity: "BaseService",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(2); // extends and implements
      queries.forEach(expectValidQuery);

      const extendsQuery = queries.find((q) => q.script.includes("*extends{"));
      const implementsQuery = queries.find((q) => q.script.includes("*implements{"));

      expect(extendsQuery).toBeDefined();
      expect(implementsQuery).toBeDefined();
    });
  });

  // ===========================================================================
  // Show Methods Tests
  // ===========================================================================
  describe("show_methods intent", () => {
    it("should build methods query", () => {
      const classification = createClassification("show_methods", {
        keywords: ["UserService"],
        targetEntity: "UserService",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expectValidQuery(queries[0]!);

      const query = queries[0]!;
      expect(query.script).toContain("*has_method{");
      expect(query.script).toContain("method_name");
      expect(query.script).toContain("method_signature");
      expect(query.description).toContain("methods");
    });
  });

  // ===========================================================================
  // Rank Complexity Tests
  // ===========================================================================
  describe("rank_complexity intent", () => {
    it("should build complexity ranking query", () => {
      const classification = createClassification("rank_complexity", {
        keywords: ["most", "complex"],
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expectValidQuery(queries[0]!);

      const query = queries[0]!;
      expect(query.script).toContain("*function");
      expect(query.script).toContain("complexity");
      expect(query.script).toContain(":order -complexity");
      expect(query.description).toContain("complexity");
    });

    it("should use threshold when provided", () => {
      const classification = createClassification("rank_complexity", {
        keywords: ["complex"],
        targetEntity: "10",
      });

      const queries = builder.build(classification);
      const query = queries[0]!;
      expect(query.params.minComplexity).toBe(10);
    });
  });

  // ===========================================================================
  // Rank Calls Tests
  // ===========================================================================
  describe("rank_calls intent", () => {
    it("should build call ranking query with aggregation", () => {
      const classification = createClassification("rank_calls", {
        keywords: ["most", "called"],
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expectValidQuery(queries[0]!);

      const query = queries[0]!;
      // CozoDB aggregation pattern: name[field, count(x)] := ...
      expect(query.script).toContain("call_counts");
      expect(query.script).toContain("count(");
      expect(query.script).toContain(":order -call_count");
      expect(query.description).toContain("called");
    });
  });

  // ===========================================================================
  // Rank Size Tests
  // ===========================================================================
  describe("rank_size intent", () => {
    it("should build size ranking query", () => {
      const classification = createClassification("rank_size", {
        keywords: ["largest", "files"],
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expectValidQuery(queries[0]!);

      const query = queries[0]!;
      expect(query.script).toContain("*file{");
      expect(query.script).toContain("size");
      expect(query.script).toContain(":order -size");
      expect(query.description).toContain("largest");
    });
  });

  // ===========================================================================
  // Filter Scope Tests
  // ===========================================================================
  describe("filter_scope intent", () => {
    it("should build scope-filtered queries", () => {
      const classification = createClassification("filter_scope", {
        keywords: ["src/cli"],
        scope: "src/cli",
      });

      const queries = builder.build(classification);
      expect(queries.length).toBeGreaterThan(0);
      queries.forEach(expectValidQuery);

      const query = queries[0]!;
      expect(query.script).toContain("starts_with");
      expect(query.params.path).toBe("src/cli");
    });

    it("should filter by entity type", () => {
      const classification = createClassification("filter_scope", {
        keywords: ["src/cli"],
        scope: "src/cli",
        entityType: "function",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.script).toContain("*function");
    });
  });

  // ===========================================================================
  // Find Dependencies Tests
  // ===========================================================================
  describe("find_dependencies intent", () => {
    it("should build dependencies query without target", () => {
      const classification = createClassification("find_dependencies", {
        keywords: ["external", "dependencies"],
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expectValidQuery(queries[0]!);

      const query = queries[0]!;
      expect(query.script).toContain("*ghost_node");
      expect(query.script).toContain("is_external");
      expect(query.script).toContain("count(");
      expect(query.description).toContain("dependencies");
    });

    it("should filter by package when target provided", () => {
      const classification = createClassification("find_dependencies", {
        keywords: ["lodash"],
        targetEntity: "lodash",
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);

      const query = queries[0]!;
      expect(query.script).toContain("regex_matches");
      expect(query.params.target).toContain("lodash");
    });
  });

  // ===========================================================================
  // Unknown/Fallback Tests
  // ===========================================================================
  describe("unknown intent", () => {
    it("should fallback to location search for unknown intent", () => {
      const classification = createClassification("unknown", {
        keywords: ["something"],
      });

      const queries = builder.build(classification);
      expect(queries.length).toBeGreaterThan(0);
      queries.forEach(expectValidQuery);
    });

    it("should list functions when no keywords", () => {
      const classification = createClassification("unknown", {
        keywords: [],
      });

      const queries = builder.build(classification);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.description).toContain("List all functions");
    });
  });

  // ===========================================================================
  // Parameter Building Tests
  // ===========================================================================
  describe("Parameter Building", () => {
    it("should escape special regex characters", () => {
      const classification = createClassification("find_function", {
        keywords: ["test.function"],
        targetEntity: "test.function",
      });

      const queries = builder.build(classification);
      // The dot should be escaped in the regex parameter
      expect(queries[0]!.params.term0).toContain("\\.");
    });

    it("should build case-insensitive patterns", () => {
      const classification = createClassification("find_function", {
        keywords: ["MyFunction"],
        targetEntity: "MyFunction",
      });

      const queries = builder.build(classification);
      const query = queries[0]!;
      // Should use lowercase() in the query
      expect(query.script).toContain("lowercase(");
      // Parameter should be lowercase
      expect(query.params.term0).toContain("myfunction");
    });

    it("should build OR conditions for multiple terms", () => {
      const classification = createClassification("find_function", {
        keywords: ["auth", "login", "signin"],
      });

      const queries = builder.build(classification);
      const query = queries[0]!;
      // Should have multiple term parameters
      expect(query.params.term0).toBeDefined();
      expect(query.params.term1).toBeDefined();
      expect(query.params.term2).toBeDefined();
      // Should use or() for multiple conditions
      expect(query.script).toContain("or(");
    });
  });

  // ===========================================================================
  // Limit Tests
  // ===========================================================================
  describe("Result Limits", () => {
    it("should respect maxResults configuration", () => {
      const customBuilder = createQueryBuilder({ maxResults: 100 });
      const classification = createClassification("find_function", {
        keywords: ["test"],
      });

      const queries = customBuilder.build(classification);
      expect(queries[0]!.script).toContain(":limit 100");
    });

    it("should use default maxResults", () => {
      const classification = createClassification("find_function", {
        keywords: ["test"],
      });

      const queries = builder.build(classification);
      expect(queries[0]!.script).toContain(":limit 50");
    });
  });
});

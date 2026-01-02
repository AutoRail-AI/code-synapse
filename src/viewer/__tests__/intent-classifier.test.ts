/**
 * Intent Classifier Tests
 *
 * Tests for the natural language query intent classification system.
 *
 * @module
 */

import { describe, it, expect, beforeAll } from "vitest";
import { IntentClassifier, createIntentClassifier } from "../nl-search/intent-classifier.js";
import { STOPWORDS, INTENT_PATTERNS } from "../nl-search/types.js";

describe("Intent Classifier", () => {
  let classifier: IntentClassifier;

  beforeAll(() => {
    classifier = createIntentClassifier();
  });

  // ===========================================================================
  // Tokenization Tests
  // ===========================================================================
  describe("Tokenization", () => {
    it("should tokenize simple queries", () => {
      const tokens = classifier.tokenize("find function authenticate");
      expect(tokens.original).toBe("find function authenticate");
      expect(tokens.normalized).toBe("find function authenticate");
      expect(tokens.keywords).toContain("find");
      expect(tokens.keywords).toContain("function");
      expect(tokens.keywords).toContain("authenticate");
    });

    it("should filter stopwords", () => {
      const tokens = classifier.tokenize("where is the main function");
      expect(tokens.keywords).not.toContain("the");
      expect(tokens.keywords).not.toContain("is");
      expect(tokens.keywords).toContain("where");
      expect(tokens.keywords).toContain("main");
      expect(tokens.keywords).toContain("function");
    });

    it("should normalize to lowercase", () => {
      const tokens = classifier.tokenize("FIND UserService CLASS");
      expect(tokens.normalized).toBe("find userservice class");
      expect(tokens.keywords).toContain("find");
      expect(tokens.keywords).toContain("userservice");
      expect(tokens.keywords).toContain("class");
    });

    it("should handle punctuation", () => {
      const tokens = classifier.tokenize("what calls authenticate()?");
      expect(tokens.keywords).toContain("what");
      expect(tokens.keywords).toContain("calls");
      expect(tokens.keywords).toContain("authenticate");
    });

    it("should expand synonyms", () => {
      const classifier = createIntentClassifier(undefined, {
        auth: ["authentication", "login"],
      });
      const tokens = classifier.tokenize("find auth functions");
      // Should have both original and synonyms
      expect(tokens.keywords).toContain("auth");
      expect(tokens.keywords).toContain("authentication");
      expect(tokens.keywords).toContain("login");
    });

    it("should handle empty query", () => {
      const tokens = classifier.tokenize("");
      expect(tokens.original).toBe("");
      expect(tokens.keywords).toHaveLength(0);
    });

    it("should handle query with only stopwords", () => {
      const tokens = classifier.tokenize("the a an is are");
      expect(tokens.keywords).toHaveLength(0);
      expect(tokens.stopwords.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Pattern Matching Tests
  // ===========================================================================
  describe("Pattern Matching", () => {
    it('should classify "what calls X" as show_callers', async () => {
      const result = await classifier.classify("what calls authenticate");
      expect(result.intent).toBe("show_callers");
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      expect(result.targetEntity).toBe("authenticate");
    });

    it('should classify "callers of X" as show_callers', async () => {
      const result = await classifier.classify("callers of createParser");
      expect(result.intent).toBe("show_callers");
      expect(result.targetEntity).toBe("createParser");
    });

    it('should classify "what does X call" as show_callees', async () => {
      const result = await classifier.classify("what does main call");
      expect(result.intent).toBe("show_callees");
      expect(result.targetEntity).toBe("main");
    });

    it('should classify "where is X" as find_location', async () => {
      const result = await classifier.classify("where is createParser");
      expect(result.intent).toBe("find_location");
      expect(result.targetEntity).toBe("createParser");
    });

    it('should classify "find X" as find_location', async () => {
      const result = await classifier.classify("find UserService");
      expect(result.intent).toBe("find_location");
      expect(result.targetEntity).toBe("UserService");
    });

    it('should classify "most complex" as rank_complexity', async () => {
      const result = await classifier.classify("most complex functions");
      expect(result.intent).toBe("rank_complexity");
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should classify "largest files" as rank_size', async () => {
      const result = await classifier.classify("largest files");
      expect(result.intent).toBe("rank_size");
    });

    it('should classify "most called" as rank_calls', async () => {
      const result = await classifier.classify("most called functions");
      expect(result.intent).toBe("rank_calls");
    });

    it('should classify "functions in src/cli" as filter_scope', async () => {
      const result = await classifier.classify("functions in src/cli");
      expect(result.intent).toBe("filter_scope");
      expect(result.targetEntity).toBe("src/cli");
    });

    it('should classify "external dependencies" as find_dependencies', async () => {
      const result = await classifier.classify("external dependencies");
      expect(result.intent).toBe("find_dependencies");
    });

    it('should classify "what imports X" as show_importers', async () => {
      const result = await classifier.classify("what imports UserService");
      expect(result.intent).toBe("show_importers");
      expect(result.targetEntity).toBe("UserService");
    });

    it('should classify "what does X import" as show_imports', async () => {
      const result = await classifier.classify("what does index.ts import");
      expect(result.intent).toBe("show_imports");
      expect(result.targetEntity).toBe("index.ts");
    });

    it('should classify "classes that extend X" as show_hierarchy', async () => {
      const result = await classifier.classify("classes that extend Error");
      expect(result.intent).toBe("show_hierarchy");
      expect(result.targetEntity).toBe("Error");
    });

    it('should classify "what implements X" as show_hierarchy', async () => {
      const result = await classifier.classify("what implements IParser");
      expect(result.intent).toBe("show_hierarchy");
      expect(result.targetEntity).toBe("IParser");
    });

    it('should classify "methods of X" as show_methods', async () => {
      const result = await classifier.classify("methods of UserService");
      expect(result.intent).toBe("show_methods");
      expect(result.targetEntity).toBe("UserService");
    });

    it('should classify "how does X work" as explain', async () => {
      const result = await classifier.classify("how does authentication work");
      expect(result.intent).toBe("explain");
      expect(result.targetEntity).toBe("authentication");
    });

    it('should classify "function X" as find_function', async () => {
      const result = await classifier.classify("function createParser");
      expect(result.intent).toBe("find_function");
      expect(result.targetEntity).toBe("createParser");
    });

    it('should classify "class X" as find_class', async () => {
      const result = await classifier.classify("class UserService");
      expect(result.intent).toBe("find_class");
      expect(result.targetEntity).toBe("UserService");
    });

    it('should classify "interface X" as find_class', async () => {
      const result = await classifier.classify("interface IParser");
      expect(result.intent).toBe("find_class");
      expect(result.targetEntity).toBe("IParser");
    });
  });

  // ===========================================================================
  // Heuristic Classification Tests
  // ===========================================================================
  describe("Heuristic Classification", () => {
    it("should fallback to heuristics for ambiguous queries", async () => {
      const result = await classifier.classify("complex code analysis");
      // Should still classify based on keywords
      expect(result.intent).toBeDefined();
      expect(result.keywords.length).toBeGreaterThan(0);
    });

    it('should classify queries with "calls" keyword', async () => {
      const result = await classifier.classify("show callers");
      expect(result.intent).toBe("show_callers");
    });

    it('should classify queries with "imports" keyword', async () => {
      const result = await classifier.classify("imports analysis");
      expect(result.intent).toBe("show_imports");
    });

    it('should classify queries with "extends" keyword', async () => {
      const result = await classifier.classify("extends BaseClass");
      expect(result.intent).toBe("show_hierarchy");
    });

    it("should return lower confidence for heuristic matches", async () => {
      const result = await classifier.classify("some random query about code");
      expect(result.confidence).toBeLessThan(0.8);
    });

    it("should handle entity type keywords", async () => {
      const funcResult = await classifier.classify("all functions");
      expect(funcResult.entityType).toBe("function");

      const classResult = await classifier.classify("all classes");
      expect(classResult.entityType).toBe("class");

      const interfaceResult = await classifier.classify("all interfaces");
      expect(interfaceResult.entityType).toBe("interface");

      const fileResult = await classifier.classify("all files");
      expect(fileResult.entityType).toBe("file");
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================
  describe("Edge Cases", () => {
    it("should handle very long queries", async () => {
      const longQuery =
        "find all the functions that are related to authentication and also check if they call any database functions";
      const result = await classifier.classify(longQuery);
      expect(result.intent).toBeDefined();
      expect(result.keywords.length).toBeGreaterThan(0);
    });

    it("should handle special characters", async () => {
      const result = await classifier.classify("find @decorator function");
      expect(result.intent).toBe("find_location");
    });

    it("should handle numbers in queries", async () => {
      const result = await classifier.classify("complexity over 10");
      expect(result.intent).toBe("rank_complexity");
      expect(result.targetEntity).toBe("10");
    });

    it("should handle camelCase identifiers", async () => {
      const result = await classifier.classify("where is getUserById");
      expect(result.intent).toBe("find_location");
      expect(result.targetEntity).toBe("getUserById");
    });

    it("should handle file paths in queries", async () => {
      const result = await classifier.classify("functions in src/core/parser/");
      expect(result.intent).toBe("filter_scope");
      expect(result.targetEntity).toContain("src/core/parser");
    });
  });

  // ===========================================================================
  // Confidence Scoring Tests
  // ===========================================================================
  describe("Confidence Scoring", () => {
    it("should return high confidence for exact pattern matches", async () => {
      const result = await classifier.classify("what calls authenticate");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("should return medium confidence for heuristic matches", async () => {
      const result = await classifier.classify("authentication functions");
      // Heuristic match should have lower confidence
      expect(result.confidence).toBeLessThan(0.9);
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it("should return low confidence for unknown queries", async () => {
      const result = await classifier.classify("xyz abc 123");
      expect(result.confidence).toBeLessThan(0.6);
    });
  });
});

// ===========================================================================
// STOPWORDS Tests
// ===========================================================================
describe("STOPWORDS", () => {
  it("should contain common articles", () => {
    expect(STOPWORDS.has("a")).toBe(true);
    expect(STOPWORDS.has("an")).toBe(true);
    expect(STOPWORDS.has("the")).toBe(true);
  });

  it("should contain common prepositions", () => {
    expect(STOPWORDS.has("in")).toBe(true);
    expect(STOPWORDS.has("of")).toBe(true);
    expect(STOPWORDS.has("to")).toBe(true);
    expect(STOPWORDS.has("from")).toBe(true);
  });

  it("should contain common verbs", () => {
    expect(STOPWORDS.has("is")).toBe(true);
    expect(STOPWORDS.has("are")).toBe(true);
    expect(STOPWORDS.has("was")).toBe(true);
  });

  it("should not contain important keywords", () => {
    expect(STOPWORDS.has("function")).toBe(false);
    expect(STOPWORDS.has("class")).toBe(false);
    expect(STOPWORDS.has("where")).toBe(false);
    expect(STOPWORDS.has("calls")).toBe(false);
    expect(STOPWORDS.has("find")).toBe(false);
  });
});

// ===========================================================================
// INTENT_PATTERNS Tests
// ===========================================================================
describe("INTENT_PATTERNS", () => {
  it("should have patterns for all major intents", () => {
    const intents = INTENT_PATTERNS.map((p) => p.intent);
    expect(intents).toContain("show_callers");
    expect(intents).toContain("show_callees");
    expect(intents).toContain("show_imports");
    expect(intents).toContain("show_importers");
    expect(intents).toContain("show_hierarchy");
    expect(intents).toContain("find_location");
    expect(intents).toContain("rank_complexity");
    expect(intents).toContain("rank_calls");
    expect(intents).toContain("rank_size");
    expect(intents).toContain("filter_scope");
    expect(intents).toContain("find_dependencies");
  });

  it("should extract targets from patterns", () => {
    const callerPattern = INTENT_PATTERNS.find(
      (p) => p.intent === "show_callers" && p.pattern.source.includes("what\\s+calls")
    );
    expect(callerPattern).toBeDefined();
    expect(callerPattern?.extractTarget).toBeDefined();

    const match = "what calls authenticate".match(callerPattern!.pattern);
    expect(match).not.toBeNull();
    expect(callerPattern!.extractTarget?.(match!)).toBe("authenticate");
  });
});

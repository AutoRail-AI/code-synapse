/**
 * Project Memory Tests
 *
 * Tests for the persistent developer memory system including:
 * - Memory rule models and schemas
 * - Storage operations
 * - Learning from corrections and failures
 * - Semantic retrieval
 * - Confidence decay
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ProjectMemoryRuleSchema,
  MemoryRuleScopeSchema,
  MemoryRuleCategorySchema,
  TriggerTypeSchema,
  MemoryRuleRefSchema,
  createMemoryRule,
  createMemoryRuleRef,
  type ProjectMemoryRule,
  type MemoryRuleScope,
  type MemoryRuleCategory,
  type TriggerType,
  type MemoryQuery,
  type SemanticMemoryQuery,
} from "../models/memory-models.js";
import type {
  IMemoryStorage,
  IMemoryLearner,
  IMemoryRetriever,
  IProjectMemory,
  ProjectMemoryConfig,
} from "../interfaces/IProjectMemory.js";

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe("ProjectMemoryRule Schema", () => {
  it("should validate a complete memory rule", () => {
    const validRule: ProjectMemoryRule = {
      id: "rule-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: "file",
      category: "convention",
      triggerType: "file-pattern",
      triggerPattern: "*.test.ts",
      ruleText: "Always use describe/it pattern for tests",
      source: "user-correction",
      confidence: 0.8,
      validationCount: 5,
      violationCount: 1,
      examples: [],
      isActive: true,
    };

    const result = ProjectMemoryRuleSchema.safeParse(validRule);
    expect(result.success).toBe(true);
  });

  it("should validate rule with all optional fields", () => {
    const fullRule: ProjectMemoryRule = {
      id: "rule-2",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: "module",
      scopeTarget: "src/auth",
      category: "architecture",
      triggerType: "entity-type",
      triggerPattern: "class:*Service",
      triggerDescription: "Applies to service classes",
      ruleText: "Services should be stateless",
      ruleExplanation: "Stateless services are easier to test",
      examples: [
        {
          bad: "class AuthService { private cache = {} }",
          good: "class AuthService { constructor(private cache: Cache) {} }",
          explanation: "Inject dependencies instead of storing state",
        },
      ],
      source: "explicit-instruction",
      sourceEventId: "event-123",
      sourceSessionId: "session-456",
      confidence: 0.95,
      validationCount: 10,
      violationCount: 0,
      lastValidatedAt: new Date().toISOString(),
      lastViolatedAt: undefined,
      embedding: [0.1, 0.2, 0.3],
      isActive: true,
      deprecatedAt: undefined,
      deprecatedReason: undefined,
    };

    const result = ProjectMemoryRuleSchema.safeParse(fullRule);
    expect(result.success).toBe(true);
  });

  it("should reject rule with invalid scope", () => {
    const invalidRule = {
      id: "rule-3",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: "invalid-scope",
      category: "convention",
      triggerType: "file-pattern",
      triggerPattern: "*.ts",
      ruleText: "Test rule",
      source: "user-correction",
      confidence: 0.5,
      validationCount: 0,
      violationCount: 0,
      examples: [],
      isActive: true,
    };

    const result = ProjectMemoryRuleSchema.safeParse(invalidRule);
    expect(result.success).toBe(false);
  });
});

describe("MemoryRuleScope Schema", () => {
  it("should validate all scope values", () => {
    const scopes: MemoryRuleScope[] = ["project", "module", "vertical", "horizontal", "file", "entity"];

    for (const scope of scopes) {
      const result = MemoryRuleScopeSchema.safeParse(scope);
      expect(result.success).toBe(true);
    }
  });
});

describe("MemoryRuleCategory Schema", () => {
  it("should validate all category values", () => {
    const categories: MemoryRuleCategory[] = [
      "convention",
      "architecture",
      "anti-pattern",
      "preference",
      "dependency",
      "testing",
      "security",
      "performance",
    ];

    for (const category of categories) {
      const result = MemoryRuleCategorySchema.safeParse(category);
      expect(result.success).toBe(true);
    }
  });
});

describe("TriggerType Schema", () => {
  it("should validate all trigger types", () => {
    const triggerTypes: TriggerType[] = [
      "file-pattern",
      "entity-type",
      "code-pattern",
      "import-pattern",
      "name-pattern",
      "context-keyword",
    ];

    for (const type of triggerTypes) {
      const result = TriggerTypeSchema.safeParse(type);
      expect(result.success).toBe(true);
    }
  });
});

describe("MemoryRuleRef Schema", () => {
  it("should validate a memory rule reference", () => {
    const ref = createMemoryRuleRef("rule-1", "validated", { confidenceDelta: 0.1 });
    const result = MemoryRuleRefSchema.safeParse(ref);
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createMemoryRule Factory", () => {
  it("should create a valid memory rule with defaults", () => {
    const rule = createMemoryRule(
      "project",
      "convention",
      "file-pattern",
      "*.ts",
      "Use TypeScript strict mode",
      "explicit-instruction"
    );

    expect(rule.id).toBeDefined();
    expect(rule.scope).toBe("project");
    expect(rule.category).toBe("convention");
    expect(rule.triggerType).toBe("file-pattern");
    expect(rule.triggerPattern).toBe("*.ts");
    expect(rule.ruleText).toBe("Use TypeScript strict mode");
    expect(rule.source).toBe("explicit-instruction");
    expect(rule.confidence).toBe(0.5);
    expect(rule.isActive).toBe(true);
    expect(rule.validationCount).toBe(0);
    expect(rule.violationCount).toBe(0);
  });

  it("should create rule with custom options", () => {
    const rule = createMemoryRule(
      "file",
      "anti-pattern",
      "code-pattern",
      "any",
      "Avoid using any type",
      "build-failure",
      {
        scopeTarget: "src/utils",
        ruleExplanation: "Type safety is important",
        confidence: 0.7,
        sourceSessionId: "session-123",
      }
    );

    expect(rule.scopeTarget).toBe("src/utils");
    expect(rule.ruleExplanation).toBe("Type safety is important");
    expect(rule.confidence).toBe(0.7);
    expect(rule.sourceSessionId).toBe("session-123");
  });
});

describe("createMemoryRuleRef Factory", () => {
  it("should create a valid rule reference", () => {
    const ref = createMemoryRuleRef("rule-123", "validated", {
      confidenceDelta: 0.1,
      details: "Rule was applied correctly"
    });

    expect(ref.ruleId).toBe("rule-123");
    expect(ref.action).toBe("validated");
    expect(ref.confidenceDelta).toBe(0.1);
    expect(ref.details).toBe("Rule was applied correctly");
  });
});

// =============================================================================
// Interface Tests
// =============================================================================

describe("IMemoryStorage Interface", () => {
  let mockStorage: IMemoryStorage;
  const sampleRule = createMemoryRule(
    "project",
    "convention",
    "file-pattern",
    "*.ts",
    "Test rule",
    "explicit-instruction"
  );

  beforeEach(() => {
    mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      storeBatch: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(sampleRule),
      query: vi.fn().mockResolvedValue([sampleRule]),
      searchSemantic: vi.fn().mockResolvedValue([sampleRule]),
      getByTrigger: vi.fn().mockResolvedValue([sampleRule]),
      delete: vi.fn().mockResolvedValue(true),
      getStats: vi.fn().mockResolvedValue({
        totalRules: 10,
        activeRules: 8,
        byScope: { project: 3, file: 5 },
        byCategory: { convention: 6, architecture: 4 },
        bySource: { "user-correction": 4, "explicit-instruction": 6 },
        averageConfidence: 0.75,
        highConfidenceRules: 5,
        recentlyValidated: 3,
        recentlyViolated: 1,
      }),
      applyDecay: vi.fn().mockResolvedValue(5),
    };
  });

  it("should implement store method", async () => {
    await mockStorage.store(sampleRule);
    expect(mockStorage.store).toHaveBeenCalledWith(sampleRule);
  });

  it("should implement getById method", async () => {
    const result = await mockStorage.getById("test-id");
    expect(result).toEqual(sampleRule);
  });

  it("should implement query method", async () => {
    const query: MemoryQuery = { scope: "project", isActive: true };
    const results = await mockStorage.query(query);
    expect(results).toHaveLength(1);
  });

  it("should implement searchSemantic method", async () => {
    const embedding = [0.1, 0.2, 0.3];
    const results = await mockStorage.searchSemantic(embedding, 10, 0.7);
    expect(results).toHaveLength(1);
  });

  it("should implement getStats method", async () => {
    const stats = await mockStorage.getStats();
    expect(stats.totalRules).toBe(10);
    expect(stats.activeRules).toBe(8);
  });
});

describe("IMemoryLearner Interface", () => {
  let mockLearner: IMemoryLearner;
  const sampleRule = createMemoryRule(
    "file",
    "convention",
    "file-pattern",
    "*.ts",
    "Test rule",
    "user-correction"
  );

  beforeEach(() => {
    mockLearner = {
      learnFromCorrection: vi.fn().mockResolvedValue(sampleRule),
      learnFromBuildFailure: vi.fn().mockResolvedValue(sampleRule),
      learnFromRefactor: vi.fn().mockResolvedValue(sampleRule),
      learnFromInstruction: vi.fn().mockResolvedValue(sampleRule),
      inferPatterns: vi.fn().mockResolvedValue([sampleRule]),
    };
  });

  it("should implement learnFromCorrection method", async () => {
    const result = await mockLearner.learnFromCorrection(
      "const x: any = 1",
      "const x: number = 1",
      "src/utils.ts",
      "session-123"
    );
    expect(result).toEqual(sampleRule);
    expect(mockLearner.learnFromCorrection).toHaveBeenCalled();
  });

  it("should implement learnFromBuildFailure method", async () => {
    const result = await mockLearner.learnFromBuildFailure(
      "Type 'string' is not assignable to type 'number'",
      "TS2322",
      "src/utils.ts",
      "session-123"
    );
    expect(result).toEqual(sampleRule);
  });

  it("should implement learnFromInstruction method", async () => {
    const result = await mockLearner.learnFromInstruction(
      "Always use strict equality",
      "project",
      "convention",
      "session-123"
    );
    expect(result).toEqual(sampleRule);
  });

  it("should implement inferPatterns method", async () => {
    const results = await mockLearner.inferPatterns(3);
    expect(results).toHaveLength(1);
  });
});

describe("IMemoryRetriever Interface", () => {
  let mockRetriever: IMemoryRetriever;
  const sampleRule = createMemoryRule(
    "file",
    "convention",
    "file-pattern",
    "*.ts",
    "Test rule",
    "user-correction"
  );

  beforeEach(() => {
    mockRetriever = {
      getRelevantMemories: vi.fn().mockResolvedValue([sampleRule]),
      getMemoriesForFile: vi.fn().mockResolvedValue([sampleRule]),
      getMemoriesForEntityType: vi.fn().mockResolvedValue([sampleRule]),
      getConventions: vi.fn().mockResolvedValue([sampleRule]),
      getAntiPatterns: vi.fn().mockResolvedValue([sampleRule]),
      formatForPrompt: vi.fn().mockReturnValue("## Rules\n- Test rule"),
    };
  });

  it("should implement getRelevantMemories method", async () => {
    const query: SemanticMemoryQuery = {
      context: "authentication",
      filePath: "src/auth.ts",
      limit: 5,
    };
    const results = await mockRetriever.getRelevantMemories(query);
    expect(results).toHaveLength(1);
  });

  it("should implement getMemoriesForFile method", async () => {
    const results = await mockRetriever.getMemoriesForFile("src/auth.ts");
    expect(results).toHaveLength(1);
  });

  it("should implement getConventions method", async () => {
    const results = await mockRetriever.getConventions("project");
    expect(results).toHaveLength(1);
  });

  it("should implement formatForPrompt method", () => {
    const formatted = mockRetriever.formatForPrompt([sampleRule], 1000);
    expect(formatted).toContain("Rules");
  });
});

describe("IProjectMemory Interface", () => {
  let mockMemory: IProjectMemory;
  const sampleRule = createMemoryRule(
    "file",
    "convention",
    "file-pattern",
    "*.ts",
    "Test rule",
    "user-correction"
  );

  beforeEach(() => {
    mockMemory = {
      initialize: vi.fn().mockResolvedValue(undefined),
      isReady: true,
      createRule: vi.fn().mockResolvedValue(sampleRule),
      getRule: vi.fn().mockResolvedValue(sampleRule),
      updateRule: vi.fn().mockResolvedValue(sampleRule),
      deprecateRule: vi.fn().mockResolvedValue(true),
      deleteRule: vi.fn().mockResolvedValue(true),
      listRules: vi.fn().mockResolvedValue([sampleRule]),
      learnFromCorrection: vi.fn().mockResolvedValue(sampleRule),
      learnFromBuildFailure: vi.fn().mockResolvedValue(sampleRule),
      learnFromInstruction: vi.fn().mockResolvedValue(sampleRule),
      getRelevantMemories: vi.fn().mockResolvedValue([sampleRule]),
      getMemoriesForFile: vi.fn().mockResolvedValue([sampleRule]),
      formatForPrompt: vi.fn().mockReturnValue("## Rules"),
      validateRule: vi.fn().mockResolvedValue(undefined),
      recordViolation: vi.fn().mockResolvedValue(undefined),
      applyConfidenceDecay: vi.fn().mockResolvedValue(5),
      getStats: vi.fn().mockResolvedValue({
        totalRules: 10,
        activeRules: 8,
        byScope: {},
        byCategory: {},
        bySource: {},
        averageConfidence: 0.75,
        highConfidenceRules: 5,
        recentlyValidated: 3,
        recentlyViolated: 1,
      }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("should implement createRule method", async () => {
    const result = await mockMemory.createRule(
      "project",
      "convention",
      "file-pattern",
      "*.ts",
      "Use strict mode",
      "explicit-instruction"
    );
    expect(result).toEqual(sampleRule);
  });

  it("should implement getRule method", async () => {
    const result = await mockMemory.getRule("rule-1");
    expect(result).toEqual(sampleRule);
  });

  it("should implement validateRule method", async () => {
    await mockMemory.validateRule("rule-1", "session-123");
    expect(mockMemory.validateRule).toHaveBeenCalledWith("rule-1", "session-123");
  });

  it("should implement recordViolation method", async () => {
    await mockMemory.recordViolation("rule-1", "Violation details", "session-123");
    expect(mockMemory.recordViolation).toHaveBeenCalledWith("rule-1", "Violation details", "session-123");
  });

  it("should implement applyConfidenceDecay method", async () => {
    const updated = await mockMemory.applyConfidenceDecay({ decayFactor: 0.95, minConfidence: 0.2 });
    expect(updated).toBe(5);
  });

  it("should implement getStats method", async () => {
    const stats = await mockMemory.getStats();
    expect(stats.totalRules).toBe(10);
    expect(stats.averageConfidence).toBe(0.75);
  });
});

// =============================================================================
// Query Structure Tests
// =============================================================================

describe("MemoryQuery Structure", () => {
  it("should support all query fields", () => {
    const query: MemoryQuery = {
      scope: "file",
      scopeTarget: "src/utils",
      category: "convention",
      triggerType: "file-pattern",
      minConfidence: 0.5,
      isActive: true,
      limit: 20,
      offset: 0,
    };

    expect(query.scope).toBe("file");
    expect(query.minConfidence).toBe(0.5);
    expect(query.limit).toBe(20);
  });
});

describe("SemanticMemoryQuery Structure", () => {
  it("should support semantic query fields", () => {
    const query: SemanticMemoryQuery = {
      context: "authentication flow",
      filePath: "src/auth/login.ts",
      entityType: "function",
      limit: 10,
      minSimilarity: 0.7,
    };

    expect(query.context).toBe("authentication flow");
    expect(query.filePath).toBe("src/auth/login.ts");
    expect(query.minSimilarity).toBe(0.7);
  });
});

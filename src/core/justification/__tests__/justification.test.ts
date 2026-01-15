/**
 * Justification Layer Tests
 *
 * Tests for the Business Justification Layer including:
 * - Data models and factory functions
 * - LLM prompts and response parsing
 * - Context propagation
 * - Storage operations
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createEntityJustification,
  scoreToConfidenceLevel,
  createClarificationQuestion,
  type EntityJustification,
  type JustificationContext,
} from "../models/justification.js";
import {
  parseJustificationResponse,
  createDefaultResponse,
  generateJustificationPrompt,
  JUSTIFICATION_SYSTEM_PROMPT,
} from "../prompts/justification-prompts.js";
import { createClarificationEngine } from "../clarification/clarification-engine.js";
import type { JustificationStorage } from "../storage/justification-storage.js";

// =============================================================================
// Data Model Tests
// =============================================================================

describe("EntityJustification Model", () => {
  describe("createEntityJustification", () => {
    it("should create justification with required fields", () => {
      const justification = createEntityJustification({
        id: "just-1",
        entityId: "func-1",
        entityType: "function",
        name: "handleUserLogin",
        filePath: "src/auth/login.ts",
      });

      expect(justification.id).toBe("just-1");
      expect(justification.entityId).toBe("func-1");
      expect(justification.entityType).toBe("function");
      expect(justification.name).toBe("handleUserLogin");
      expect(justification.filePath).toBe("src/auth/login.ts");
    });

    it("should set default values for optional fields", () => {
      const justification = createEntityJustification({
        id: "just-1",
        entityId: "func-1",
        entityType: "function",
        name: "test",
        filePath: "test.ts",
      });

      expect(justification.purposeSummary).toBe("");
      expect(justification.businessValue).toBe("");
      expect(justification.featureContext).toBe("");
      expect(justification.tags).toEqual([]);
      expect(justification.inferredFrom).toBe("llm_inferred");
      expect(justification.confidenceScore).toBe(0);
      expect(justification.confidenceLevel).toBe("uncertain");
      expect(justification.clarificationPending).toBe(false);
      expect(justification.pendingQuestions).toEqual([]);
      expect(justification.version).toBe(1);
    });

    it("should allow overriding default values", () => {
      const justification = createEntityJustification({
        id: "just-1",
        entityId: "func-1",
        entityType: "function",
        name: "test",
        filePath: "test.ts",
        purposeSummary: "Handles user authentication",
        businessValue: "Core security feature",
        confidenceScore: 0.85,
        confidenceLevel: "high",
      });

      expect(justification.purposeSummary).toBe("Handles user authentication");
      expect(justification.businessValue).toBe("Core security feature");
      expect(justification.confidenceScore).toBe(0.85);
      expect(justification.confidenceLevel).toBe("high");
    });
  });

  describe("scoreToConfidenceLevel", () => {
    it("should return high for scores >= 0.8", () => {
      expect(scoreToConfidenceLevel(0.8)).toBe("high");
      expect(scoreToConfidenceLevel(0.9)).toBe("high");
      expect(scoreToConfidenceLevel(1.0)).toBe("high");
    });

    it("should return medium for scores >= 0.5 and < 0.8", () => {
      expect(scoreToConfidenceLevel(0.5)).toBe("medium");
      expect(scoreToConfidenceLevel(0.6)).toBe("medium");
      expect(scoreToConfidenceLevel(0.79)).toBe("medium");
    });

    it("should return low for scores >= 0.3 and < 0.5", () => {
      expect(scoreToConfidenceLevel(0.3)).toBe("low");
      expect(scoreToConfidenceLevel(0.4)).toBe("low");
      expect(scoreToConfidenceLevel(0.49)).toBe("low");
    });

    it("should return uncertain for scores < 0.3", () => {
      expect(scoreToConfidenceLevel(0)).toBe("uncertain");
      expect(scoreToConfidenceLevel(0.1)).toBe("uncertain");
      expect(scoreToConfidenceLevel(0.29)).toBe("uncertain");
    });
  });

  describe("createClarificationQuestion", () => {
    it("should create question with required fields", () => {
      const question = createClarificationQuestion({
        id: "q-1",
        question: "What is the purpose?",
        entityId: "func-1",
        category: "purpose",
      });

      expect(question.id).toBe("q-1");
      expect(question.question).toBe("What is the purpose?");
      expect(question.entityId).toBe("func-1");
      expect(question.category).toBe("purpose");
      expect(question.answered).toBe(false);
    });

    it("should set default priority", () => {
      const question = createClarificationQuestion({
        id: "q-1",
        question: "What is the purpose?",
        entityId: "func-1",
        category: "purpose",
      });

      expect(question.priority).toBe(50);
    });
  });
});

// =============================================================================
// Prompt Tests
// =============================================================================

describe("Justification Prompts", () => {
  describe("parseJustificationResponse", () => {
    it("should parse valid JSON response", () => {
      const response = `{
        "purposeSummary": "Handles user login",
        "businessValue": "Core authentication",
        "featureContext": "Authentication",
        "detailedDescription": "Validates credentials and creates session",
        "tags": ["auth", "security"],
        "confidenceScore": 0.85,
        "reasoning": "Function name and parameters indicate login handling",
        "needsClarification": false,
        "clarificationQuestions": []
      }`;

      const parsed = parseJustificationResponse(response);

      expect(parsed).not.toBeNull();
      expect(parsed!.purposeSummary).toBe("Handles user login");
      expect(parsed!.businessValue).toBe("Core authentication");
      expect(parsed!.featureContext).toBe("Authentication");
      expect(parsed!.confidenceScore).toBe(0.85);
      expect(parsed!.tags).toEqual(["auth", "security"]);
      expect(parsed!.needsClarification).toBe(false);
    });

    it("should extract JSON from text with surrounding content", () => {
      const response = `Here is my analysis:
        {
          "purposeSummary": "Test function",
          "businessValue": "Testing",
          "featureContext": "Tests",
          "detailedDescription": "",
          "tags": [],
          "confidenceScore": 0.5,
          "reasoning": "Test",
          "needsClarification": false,
          "clarificationQuestions": []
        }
        Let me know if you need more details.`;

      const parsed = parseJustificationResponse(response);

      expect(parsed).not.toBeNull();
      expect(parsed!.purposeSummary).toBe("Test function");
    });

    it("should return null for invalid JSON", () => {
      const response = "This is not JSON";
      const parsed = parseJustificationResponse(response);
      expect(parsed).toBeNull();
    });

    it("should return null for missing required fields", () => {
      const response = `{
        "businessValue": "Testing"
      }`;

      const parsed = parseJustificationResponse(response);
      expect(parsed).toBeNull();
    });

    it("should clamp confidence score to 0-1 range", () => {
      const response = `{
        "purposeSummary": "Test",
        "confidenceScore": 1.5,
        "businessValue": "",
        "featureContext": "",
        "detailedDescription": "",
        "tags": [],
        "reasoning": "",
        "needsClarification": false,
        "clarificationQuestions": []
      }`;

      const parsed = parseJustificationResponse(response);
      expect(parsed!.confidenceScore).toBe(1);
    });
  });

  describe("createDefaultResponse", () => {
    it("should create default response from entity", () => {
      const entity = {
        id: "func-1",
        type: "function" as const,
        name: "handleUserLogin",
        filePath: "src/auth/login.ts",
        startLine: 10,
        endLine: 50,
        codeSnippet: "function handleUserLogin() {}",
        isExported: true,
      };

      const response = createDefaultResponse(entity);

      expect(response.purposeSummary).toContain("handleUserLogin");
      expect(response.confidenceScore).toBe(0.1);
      expect(response.needsClarification).toBe(true);
      expect(response.clarificationQuestions.length).toBeGreaterThan(0);
    });

    it("should infer feature from auth path", () => {
      const entity = {
        id: "func-1",
        type: "function" as const,
        name: "test",
        filePath: "src/auth/login.ts",
        startLine: 1,
        endLine: 10,
        codeSnippet: "",
        isExported: false,
      };

      const response = createDefaultResponse(entity);
      expect(response.featureContext).toBe("Authentication");
    });

    it("should infer tags from handler naming", () => {
      const entity = {
        id: "func-1",
        type: "function" as const,
        name: "handleRequest",
        filePath: "src/handlers.ts",
        startLine: 1,
        endLine: 10,
        codeSnippet: "",
        isExported: false,
      };

      const response = createDefaultResponse(entity);
      expect(response.tags).toContain("handler");
    });
  });

  describe("generateJustificationPrompt", () => {
    it("should include entity details in prompt", () => {
      const entity = {
        id: "func-1",
        type: "function" as const,
        name: "processPayment",
        filePath: "src/payments/processor.ts",
        startLine: 10,
        endLine: 50,
        signature: "async function processPayment(amount: number): Promise<Receipt>",
        codeSnippet: "async function processPayment(amount: number) { ... }",
        isExported: true,
        isAsync: true,
      };

      const context: JustificationContext = {
        entity,
        siblings: [],
        children: [],
        dependencies: [],
        callers: [],
        callees: [],
        projectContext: {
          projectName: "TestProject",
          knownFeatures: [],
        },
      };

      const prompt = generateJustificationPrompt(entity, context);

      expect(prompt).toContain("processPayment");
      expect(prompt).toContain("src/payments/processor.ts");
      expect(prompt).toContain("**Async**: Yes");
      expect(prompt).toContain("**Exported**: Yes");
    });

    it("should include parent context if available", () => {
      const entity = {
        id: "method-1",
        type: "method" as const,
        name: "validate",
        filePath: "src/validators.ts",
        startLine: 10,
        endLine: 20,
        codeSnippet: "validate() {}",
        isExported: false,
      };

      const context: JustificationContext = {
        entity,
        parentContext: {
          id: "class-1",
          type: "class",
          name: "UserValidator",
          justification: createEntityJustification({
            id: "just-class-1",
            entityId: "class-1",
            entityType: "class",
            name: "UserValidator",
            filePath: "src/validators.ts",
            purposeSummary: "Validates user input",
            businessValue: "Data integrity",
          }),
        },
        siblings: [],
        children: [],
        dependencies: [],
        callers: [],
        callees: [],
        projectContext: {
          projectName: "TestProject",
          knownFeatures: [],
        },
      };

      const prompt = generateJustificationPrompt(entity, context);

      expect(prompt).toContain("Parent Context");
      expect(prompt).toContain("UserValidator");
      expect(prompt).toContain("Validates user input");
    });
  });

  describe("JUSTIFICATION_SYSTEM_PROMPT", () => {
    it("should define key concepts", () => {
      expect(JUSTIFICATION_SYSTEM_PROMPT).toContain("purposeSummary");
      expect(JUSTIFICATION_SYSTEM_PROMPT).toContain("businessValue");
      expect(JUSTIFICATION_SYSTEM_PROMPT).toContain("featureContext");
      expect(JUSTIFICATION_SYSTEM_PROMPT).toContain("confidenceScore");
    });

    it("should specify JSON output format", () => {
      expect(JUSTIFICATION_SYSTEM_PROMPT).toContain("JSON");
      expect(JUSTIFICATION_SYSTEM_PROMPT).toContain("purposeSummary");
      expect(JUSTIFICATION_SYSTEM_PROMPT).toContain("businessValue");
      expect(JUSTIFICATION_SYSTEM_PROMPT).toContain("confidenceScore");
    });
  });
});

// =============================================================================
// Clarification Engine Tests
// =============================================================================

describe("ClarificationEngine", () => {
  // Mock storage type that exposes both the JustificationStorage interface
  // and the vitest mock functions for testing
  type MockedJustificationStorage = {
    [K in keyof JustificationStorage]: ReturnType<typeof vi.fn>;
  };

  const createMockStorage = (): MockedJustificationStorage => ({
    getByEntityId: vi.fn(),
    getById: vi.fn(),
    getByEntityIds: vi.fn(),
    getByFilePath: vi.fn(),
    getPendingClarifications: vi.fn(),
    getEntitiesNeedingClarification: vi.fn(),
    storeJustification: vi.fn(),
    storeJustifications: vi.fn(),
    storeClarificationQuestion: vi.fn(),
    answerClarificationQuestion: vi.fn(),
    getStats: vi.fn(),
    searchByText: vi.fn(),
    deleteByEntityId: vi.fn(),
    deleteByFilePath: vi.fn(),
    clearAll: vi.fn(),
    updateProjectContext: vi.fn(),
    // New hierarchical and uncertainty methods
    getChildren: vi.fn(),
    getAncestors: vi.fn(),
    getFileHierarchyJustifications: vi.fn(),
    getByFeature: vi.fn(),
    getByConfidenceRange: vi.fn(),
    getUncertaintyHotspots: vi.fn(),
    getLowestConfidenceEntities: vi.fn(),
    getUncertainFeatures: vi.fn(),
    getRecentlyUpdatedUncertain: vi.fn(),
  });

  let mockStorage: MockedJustificationStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = createMockStorage();
  });

  describe("generateQuestionsForJustification", () => {
    it("should not generate questions for high confidence justifications", () => {
      const engine = createClarificationEngine(mockStorage as unknown as JustificationStorage);

      const justification = createEntityJustification({
        id: "just-1",
        entityId: "func-1",
        entityType: "function",
        name: "test",
        filePath: "test.ts",
        purposeSummary: "Test function",
        businessValue: "Testing",
        confidenceScore: 0.9,
        confidenceLevel: "high",
      });

      const questions = engine.generateQuestionsForJustification(justification);
      expect(questions).toHaveLength(0);
    });

    it("should generate questions for low confidence justifications", () => {
      const engine = createClarificationEngine(mockStorage as unknown as JustificationStorage);

      const justification = createEntityJustification({
        id: "just-1",
        entityId: "func-1",
        entityType: "function",
        name: "processData",
        filePath: "src/processor.ts",
        confidenceScore: 0.2,
        confidenceLevel: "uncertain",
      });

      const questions = engine.generateQuestionsForJustification(justification);
      expect(questions.length).toBeGreaterThan(0);
    });

    it("should generate purpose question for empty purposeSummary", () => {
      const engine = createClarificationEngine(mockStorage as unknown as JustificationStorage);

      const justification = createEntityJustification({
        id: "just-1",
        entityId: "func-1",
        entityType: "function",
        name: "handleRequest",
        filePath: "src/handlers.ts",
        purposeSummary: "",
        confidenceScore: 0.3,
        confidenceLevel: "low",
      });

      const questions = engine.generateQuestionsForJustification(justification);
      const purposeQuestion = questions.find((q) => q.category === "purpose");

      expect(purposeQuestion).toBeDefined();
      expect(purposeQuestion!.question).toContain("handleRequest");
    });

    it("should prioritize questions correctly", () => {
      const engine = createClarificationEngine(mockStorage as unknown as JustificationStorage);

      // File-level entity (higher priority = lower number)
      const fileJustification = createEntityJustification({
        id: "just-file",
        entityId: "file-1",
        entityType: "file",
        name: "auth.ts",
        filePath: "src/auth.ts",
        confidenceScore: 0.2,
        hierarchyDepth: 0,
      });

      // Method-level entity (lower priority = higher number)
      const methodJustification = createEntityJustification({
        id: "just-method",
        entityId: "method-1",
        entityType: "method",
        name: "validate",
        filePath: "src/auth.ts",
        confidenceScore: 0.2,
        hierarchyDepth: 2,
      });

      const fileQuestions = engine.generateQuestionsForJustification(fileJustification);
      const methodQuestions = engine.generateQuestionsForJustification(methodJustification);

      // File questions should have lower priority numbers (asked first)
      expect(fileQuestions[0]!.priority).toBeLessThan(methodQuestions[0]!.priority);
    });

    it("should generate suggestions based on naming patterns", () => {
      const engine = createClarificationEngine(mockStorage as unknown as JustificationStorage);

      const justification = createEntityJustification({
        id: "just-1",
        entityId: "func-1",
        entityType: "function",
        name: "handleUserLogin",
        filePath: "src/auth.ts",
        confidenceScore: 0.3,
      });

      const questions = engine.generateQuestionsForJustification(justification);
      const purposeQuestion = questions.find((q) => q.category === "purpose");

      expect(purposeQuestion?.suggestedAnswers).toBeDefined();
      expect(purposeQuestion!.suggestedAnswers!.length).toBeGreaterThan(0);
    });
  });

  describe("getNextBatch", () => {
    it("should return empty batch when no entities need clarification", async () => {
      mockStorage.getEntitiesNeedingClarification.mockResolvedValue([]);

      const engine = createClarificationEngine(mockStorage as unknown as JustificationStorage);
      const batch = await engine.getNextBatch();

      expect(batch.questions).toHaveLength(0);
      expect(batch.totalPendingEntities).toBe(0);
    });

    it("should return questions sorted by priority", async () => {
      const entities = [
        createEntityJustification({
          id: "just-1",
          entityId: "file-1",
          entityType: "file",
          name: "auth.ts",
          filePath: "src/auth.ts",
          confidenceScore: 0.2,
          hierarchyDepth: 0,
        }),
        createEntityJustification({
          id: "just-2",
          entityId: "func-1",
          entityType: "function",
          name: "test",
          filePath: "src/test.ts",
          confidenceScore: 0.2,
          hierarchyDepth: 1,
        }),
      ];

      mockStorage.getEntitiesNeedingClarification.mockResolvedValue(entities);

      const engine = createClarificationEngine(mockStorage as unknown as JustificationStorage);
      const batch = await engine.getNextBatch();

      // Questions should be sorted by priority (file first)
      if (batch.questions.length >= 2) {
        expect(batch.questions[0]!.priority).toBeLessThanOrEqual(
          batch.questions[1]!.priority
        );
      }
    });
  });

  describe("applyAnswers", () => {
    it("should update justification with user answer", async () => {
      const justification = createEntityJustification({
        id: "just-1",
        entityId: "func-1",
        entityType: "function",
        name: "test",
        filePath: "test.ts",
        confidenceScore: 0.3,
      });

      mockStorage.getById.mockResolvedValue(justification);
      mockStorage.storeJustification.mockResolvedValue(undefined);
      mockStorage.answerClarificationQuestion.mockResolvedValue(undefined);

      const engine = createClarificationEngine(mockStorage as unknown as JustificationStorage);
      const answers = new Map([["just-1-purpose", "Handles user authentication"]]);

      await engine.applyAnswers(answers);

      expect(mockStorage.storeJustification).toHaveBeenCalled();

      const storedJustification = mockStorage.storeJustification.mock.calls[0]?.[0] as EntityJustification;
      expect(storedJustification).toBeDefined();
      expect(storedJustification.purposeSummary).toBe("Handles user authentication");
      expect(storedJustification.inferredFrom).toBe("user_provided");
      expect(storedJustification.confidenceScore).toBeGreaterThan(0.3);
    });
  });

  describe("skipEntity", () => {
    it("should mark entity as uncertain when skipped", async () => {
      const justification = createEntityJustification({
        id: "just-1",
        entityId: "func-1",
        entityType: "function",
        name: "test",
        filePath: "test.ts",
        confidenceScore: 0.3,
        clarificationPending: true,
      });

      mockStorage.getByEntityId.mockResolvedValue(justification);
      mockStorage.storeJustification.mockResolvedValue(undefined);

      const engine = createClarificationEngine(mockStorage as unknown as JustificationStorage);
      await engine.skipEntity("func-1");

      expect(mockStorage.storeJustification).toHaveBeenCalled();

      const storedJustification = mockStorage.storeJustification.mock.calls[0]?.[0] as EntityJustification;
      expect(storedJustification).toBeDefined();
      expect(storedJustification.clarificationPending).toBe(false);
      expect(storedJustification.confidenceScore).toBe(0.1);
      expect(storedJustification.confidenceLevel).toBe("uncertain");
    });
  });
});

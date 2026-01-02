/**
 * Clarification Engine
 *
 * Manages the workflow for asking users clarification questions about
 * code justifications. Prioritizes questions top-down (file → class → method)
 * to maximize context propagation efficiency.
 *
 * @module
 */

import type {
  EntityJustification,
  ClarificationQuestion,
  ClarificationBatch,
  QuestionCategory,
  JustifiableEntityType,
} from "../models/justification.js";
import { createClarificationQuestion, scoreToConfidenceLevel } from "../models/justification.js";
import type { JustificationStorage } from "../storage/justification-storage.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for clarification engine
 */
export interface ClarificationEngineConfig {
  /** Minimum confidence below which to generate questions */
  clarificationThreshold: number;
  /** Maximum questions per batch */
  maxQuestionsPerBatch: number;
  /** Maximum questions per entity */
  maxQuestionsPerEntity: number;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: ClarificationEngineConfig = {
  clarificationThreshold: 0.5,
  maxQuestionsPerBatch: 10,
  maxQuestionsPerEntity: 3,
};

/**
 * Entity type hierarchy depth (lower = higher priority)
 */
const ENTITY_TYPE_PRIORITY: Record<JustifiableEntityType, number> = {
  file: 0,
  module: 0,
  class: 1,
  interface: 1,
  type_alias: 1,
  function: 2,
  method: 3,
  variable: 3,
};

// =============================================================================
// Clarification Engine Class
// =============================================================================

/**
 * Manages clarification questions and user feedback workflow.
 *
 * Strategy:
 * 1. Process entities top-down (file → class → method)
 * 2. Generate minimal, high-value questions
 * 3. Apply answers and propagate context to children
 */
export class ClarificationEngine {
  private config: ClarificationEngineConfig;

  constructor(
    private storage: JustificationStorage,
    config: Partial<ClarificationEngineConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // Question Generation
  // ===========================================================================

  /**
   * Generate clarification questions for a low-confidence justification
   */
  generateQuestionsForJustification(
    justification: EntityJustification
  ): ClarificationQuestion[] {
    const questions: ClarificationQuestion[] = [];

    // Don't generate questions for high confidence
    if (justification.confidenceScore >= this.config.clarificationThreshold) {
      return questions;
    }

    const basePriority = this.calculateBasePriority(justification);

    // Question 1: Purpose (always ask if unclear)
    if (!justification.purposeSummary || justification.purposeSummary === "Unknown") {
      questions.push(
        createClarificationQuestion({
          id: `${justification.id}-purpose`,
          question: this.generatePurposeQuestion(justification),
          entityId: justification.entityId,
          category: "purpose",
          priority: basePriority,
          context: this.generateQuestionContext(justification),
          suggestedAnswers: this.generatePurposeSuggestions(justification),
        })
      );
    }

    // Question 2: Business value (ask if purpose is known but value isn't)
    if (
      questions.length < this.config.maxQuestionsPerEntity &&
      (!justification.businessValue || justification.businessValue.includes("Unknown"))
    ) {
      questions.push(
        createClarificationQuestion({
          id: `${justification.id}-business`,
          question: this.generateBusinessValueQuestion(justification),
          entityId: justification.entityId,
          category: "business_value",
          priority: basePriority + 1,
          context: this.generateQuestionContext(justification),
          suggestedAnswers: this.generateBusinessValueSuggestions(justification),
        })
      );
    }

    // Question 3: Feature context (ask if not determined)
    if (
      questions.length < this.config.maxQuestionsPerEntity &&
      (!justification.featureContext ||
        justification.featureContext === "General" ||
        justification.featureContext === "Unknown")
    ) {
      questions.push(
        createClarificationQuestion({
          id: `${justification.id}-feature`,
          question: this.generateFeatureContextQuestion(justification),
          entityId: justification.entityId,
          category: "feature_context",
          priority: basePriority + 2,
          context: this.generateQuestionContext(justification),
          suggestedAnswers: this.generateFeatureSuggestions(justification),
        })
      );
    }

    return questions.slice(0, this.config.maxQuestionsPerEntity);
  }

  /**
   * Calculate base priority based on entity type and hierarchy depth
   * Lower number = higher priority (asked first)
   */
  private calculateBasePriority(justification: EntityJustification): number {
    const typePriority = ENTITY_TYPE_PRIORITY[justification.entityType] || 2;
    const depthFactor = justification.hierarchyDepth * 10;
    const confidenceFactor = Math.floor((1 - justification.confidenceScore) * 10);

    return typePriority * 100 + depthFactor + confidenceFactor;
  }

  /**
   * Generate purpose question based on entity type
   */
  private generatePurposeQuestion(justification: EntityJustification): string {
    const { entityType, name, filePath } = justification;

    switch (entityType) {
      case "file":
      case "module":
        return `What is the main purpose of the file "${name}"?`;
      case "class":
        return `What does the class "${name}" represent or manage?`;
      case "interface":
        return `What contract or capability does the interface "${name}" define?`;
      case "function":
        return `What does the function "${name}" accomplish?`;
      case "method":
        return `What is the responsibility of the method "${name}"?`;
      default:
        return `What is the purpose of "${name}" in ${filePath}?`;
    }
  }

  /**
   * Generate business value question
   */
  private generateBusinessValueQuestion(justification: EntityJustification): string {
    const { entityType, name } = justification;

    switch (entityType) {
      case "file":
      case "module":
        return `Why does the "${name}" module exist? What problem does it solve?`;
      case "class":
        return `Why was the "${name}" class created? What user need does it address?`;
      case "function":
      case "method":
        return `Why is "${name}" needed? What would break without it?`;
      default:
        return `What is the business reason for "${name}" to exist?`;
    }
  }

  /**
   * Generate feature context question
   */
  private generateFeatureContextQuestion(justification: EntityJustification): string {
    const { name } = justification;
    return `Which feature, domain, or product area does "${name}" belong to?`;
  }

  /**
   * Generate context for the question
   */
  private generateQuestionContext(justification: EntityJustification): string {
    const parts: string[] = [];

    parts.push(`Location: ${justification.filePath}`);

    if (justification.purposeSummary && justification.purposeSummary !== "Unknown") {
      parts.push(`Current understanding: ${justification.purposeSummary}`);
    }

    if (justification.confidenceScore < 0.3) {
      parts.push("The automated analysis was uncertain about this code.");
    } else if (justification.confidenceScore < 0.5) {
      parts.push("The automated analysis needs confirmation.");
    }

    return parts.join("\n");
  }

  /**
   * Generate suggested answers for purpose question
   */
  private generatePurposeSuggestions(justification: EntityJustification): string[] {
    const suggestions: string[] = [];
    const { entityType, name } = justification;

    // Generate suggestions based on naming patterns
    if (/Handler$/.test(name)) {
      suggestions.push(`Handles ${name.replace(/Handler$/, "")} operations`);
    }
    if (/Service$/.test(name)) {
      suggestions.push(`Provides ${name.replace(/Service$/, "")} functionality`);
    }
    if (/Manager$/.test(name)) {
      suggestions.push(`Manages ${name.replace(/Manager$/, "")} lifecycle`);
    }
    if (/Controller$/.test(name)) {
      suggestions.push(`Controls ${name.replace(/Controller$/, "")} flow`);
    }
    if (/Factory$/.test(name)) {
      suggestions.push(`Creates ${name.replace(/Factory$/, "")} instances`);
    }
    if (/^create/.test(name)) {
      suggestions.push(`Creates and initializes ${name.replace(/^create/, "")}`);
    }
    if (/^get/.test(name)) {
      suggestions.push(`Retrieves ${name.replace(/^get/, "")}`);
    }
    if (/^validate/.test(name)) {
      suggestions.push(`Validates ${name.replace(/^validate/, "")}`);
    }
    if (/^parse/.test(name)) {
      suggestions.push(`Parses ${name.replace(/^parse/, "")}`);
    }

    // Add generic suggestions if none matched
    if (suggestions.length === 0) {
      if (entityType === "class") {
        suggestions.push("Data structure", "Service class", "Utility class");
      } else if (entityType === "function" || entityType === "method") {
        suggestions.push("Data transformation", "API call", "Validation", "Initialization");
      }
    }

    return suggestions.slice(0, 4);
  }

  /**
   * Generate suggested answers for business value question
   */
  private generateBusinessValueSuggestions(_justification: EntityJustification): string[] {
    return [
      "Core business logic",
      "Infrastructure/plumbing",
      "User-facing feature",
      "Developer tooling",
      "Testing utility",
    ];
  }

  /**
   * Generate suggested answers for feature context question
   */
  private generateFeatureSuggestions(justification: EntityJustification): string[] {
    // Extract potential features from file path
    const suggestions = new Set<string>();
    const pathParts = justification.filePath.split("/");

    for (const part of pathParts) {
      if (["src", "lib", "app", "dist", "build", "node_modules"].includes(part)) continue;

      // Convert directory names to feature names
      const feature = part
        .replace(/[-_]/g, " ")
        .replace(/\.(ts|js|tsx|jsx)$/, "")
        .replace(/^[a-z]/, (c) => c.toUpperCase());

      if (feature.length > 2) {
        suggestions.add(feature);
      }
    }

    // Add common feature categories
    suggestions.add("Core functionality");
    suggestions.add("User interface");
    suggestions.add("Data management");
    suggestions.add("External integration");

    return Array.from(suggestions).slice(0, 5);
  }

  // ===========================================================================
  // Batch Management
  // ===========================================================================

  /**
   * Get the next batch of clarification questions
   */
  async getNextBatch(): Promise<ClarificationBatch> {
    // Get entities needing clarification
    const entities = await this.storage.getEntitiesNeedingClarification();

    // Generate questions for each entity
    const allQuestions: ClarificationQuestion[] = [];

    for (const entity of entities) {
      const questions = this.generateQuestionsForJustification(entity);
      allQuestions.push(...questions);

      if (allQuestions.length >= this.config.maxQuestionsPerBatch * 2) {
        break; // Limit processing
      }
    }

    // Sort by priority (lower = ask first)
    allQuestions.sort((a, b) => a.priority - b.priority);

    // Take top questions for this batch
    const batchQuestions = allQuestions.slice(0, this.config.maxQuestionsPerBatch);

    // Calculate estimated time (30 seconds per question)
    const estimatedTime = Math.ceil((batchQuestions.length * 30) / 60);

    return {
      id: `batch-${Date.now()}`,
      questions: batchQuestions,
      totalPendingEntities: entities.length,
      estimatedTime,
      createdAt: Date.now(),
    };
  }

  /**
   * Apply user answers to clarification questions
   */
  async applyAnswers(answers: Map<string, string>): Promise<void> {
    for (const [questionId, answer] of answers) {
      // Parse the question ID to get justification ID and category
      const parts = questionId.split("-");
      const category = parts.pop() as QuestionCategory;
      const justificationId = parts.join("-");

      // Get the justification
      const justification = await this.storage.getById(justificationId);
      if (!justification) continue;

      // Update the justification based on answer category
      const updatedJustification = this.applyAnswerToJustification(
        justification,
        category,
        answer
      );

      // Store updated justification
      await this.storage.storeJustification(updatedJustification);

      // Mark question as answered
      await this.storage.answerClarificationQuestion(questionId, answer);
    }
  }

  /**
   * Apply a single answer to a justification
   */
  private applyAnswerToJustification(
    justification: EntityJustification,
    category: QuestionCategory,
    answer: string
  ): EntityJustification {
    const updated = { ...justification };

    switch (category) {
      case "purpose":
        updated.purposeSummary = answer;
        break;
      case "business_value":
        updated.businessValue = answer;
        break;
      case "feature_context":
        updated.featureContext = answer;
        break;
      case "naming":
      case "relationship":
      case "ownership":
        // Add to detailed description
        updated.detailedDescription = `${updated.detailedDescription}\n${category}: ${answer}`.trim();
        break;
    }

    // Boost confidence after user input
    updated.confidenceScore = Math.min(1, updated.confidenceScore + 0.3);
    updated.confidenceLevel = scoreToConfidenceLevel(updated.confidenceScore);
    updated.inferredFrom = "user_provided";
    updated.lastConfirmedByUser = Date.now();
    updated.updatedAt = Date.now();
    updated.version += 1;

    // Check if still needs clarification
    updated.clarificationPending =
      !updated.purposeSummary ||
      !updated.businessValue ||
      updated.confidenceScore < this.config.clarificationThreshold;

    return updated;
  }

  /**
   * Skip clarification for an entity (mark as uncertain)
   */
  async skipEntity(entityId: string): Promise<void> {
    const justification = await this.storage.getByEntityId(entityId);
    if (!justification) return;

    const updated: EntityJustification = {
      ...justification,
      clarificationPending: false,
      confidenceScore: 0.1,
      confidenceLevel: "uncertain",
      reasoning: `${justification.reasoning}\nUser skipped clarification.`,
      updatedAt: Date.now(),
      version: justification.version + 1,
    };

    await this.storage.storeJustification(updated);
  }

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  /**
   * Mark all pending questions for an entity as answered
   */
  async completeEntityClarification(entityId: string): Promise<void> {
    const justification = await this.storage.getByEntityId(entityId);
    if (!justification) return;

    const updated: EntityJustification = {
      ...justification,
      clarificationPending: false,
      pendingQuestions: [],
      lastConfirmedByUser: Date.now(),
      updatedAt: Date.now(),
      version: justification.version + 1,
    };

    await this.storage.storeJustification(updated);
  }

  /**
   * Get summary of pending clarifications
   */
  async getClarificationSummary(): Promise<{
    totalPending: number;
    byEntityType: Record<string, number>;
    byConfidenceLevel: Record<string, number>;
  }> {
    const entities = await this.storage.getEntitiesNeedingClarification();

    const byEntityType: Record<string, number> = {};
    const byConfidenceLevel: Record<string, number> = {};

    for (const entity of entities) {
      byEntityType[entity.entityType] = (byEntityType[entity.entityType] || 0) + 1;
      byConfidenceLevel[entity.confidenceLevel] =
        (byConfidenceLevel[entity.confidenceLevel] || 0) + 1;
    }

    return {
      totalPending: entities.length,
      byEntityType,
      byConfidenceLevel,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a clarification engine instance
 */
export function createClarificationEngine(
  storage: JustificationStorage,
  config?: Partial<ClarificationEngineConfig>
): ClarificationEngine {
  return new ClarificationEngine(storage, config);
}

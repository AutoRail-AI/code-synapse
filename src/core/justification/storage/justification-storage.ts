/**
 * Justification Storage Module
 *
 * CozoDB operations for storing and retrieving business justifications.
 * Handles atomic writes, queries, and relationship management.
 *
 * @module
 */

import type { IGraphStore } from "../../interfaces/IGraphStore.js";
import type {
  EntityJustification,
  ClarificationQuestion,
  JustificationStats,
  ConfidenceLevel,
} from "../models/justification.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Row format for Justification table in CozoDB
 */
export interface JustificationRow {
  id: string;
  entityId: string;
  entityType: string;
  name: string;
  filePath: string;
  purposeSummary: string;
  businessValue: string;
  featureContext: string;
  detailedDescription: string | null;
  tags: string; // JSON string array
  inferredFrom: string;
  confidenceScore: number;
  confidenceLevel: string;
  reasoning: string | null;
  evidenceSources: string; // JSON string array
  parentJustificationId: string | null;
  hierarchyDepth: number;
  clarificationPending: boolean;
  pendingQuestions: string; // JSON string array of ClarificationQuestion
  lastConfirmedByUser: number | null;
  confirmedByUserId: string | null;
  createdAt: number;
  updatedAt: number;
  version: number;
}

/**
 * Row format for ClarificationQuestion table
 */
export interface ClarificationQuestionRow {
  id: string;
  justificationId: string;
  entityId: string;
  question: string;
  context: string | null;
  priority: number;
  category: string;
  suggestedAnswers: string; // JSON string array
  answered: boolean;
  answer: string | null;
  answeredAt: number | null;
  createdAt: number;
}

/**
 * Row format for ProjectContext table
 */
export interface ProjectContextRow {
  id: string;
  projectName: string;
  projectDescription: string | null;
  domain: string | null;
  framework: string | null;
  knownFeatures: string; // JSON string array
  businessGoals: string; // JSON string array
  updatedAt: number;
}

// =============================================================================
// Justification Storage Class
// =============================================================================

/**
 * Handles all CozoDB operations for the justification layer.
 */
export class JustificationStorage {
  constructor(private graphStore: IGraphStore) {}

  // ===========================================================================
  // Write Operations
  // ===========================================================================

  /**
   * Store a justification (insert or update)
   */
  async storeJustification(justification: EntityJustification): Promise<void> {
    const row = this.toRow(justification);

    const query = `
      ?[id, entityId, entityType, name, filePath, purposeSummary, businessValue,
        featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
        confidenceLevel, reasoning, evidenceSources, parentJustificationId,
        hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
        confirmedByUserId, createdAt, updatedAt, version] <- [[
          $id, $entityId, $entityType, $name, $filePath, $purposeSummary, $businessValue,
          $featureContext, $detailedDescription, $tags, $inferredFrom, $confidenceScore,
          $confidenceLevel, $reasoning, $evidenceSources, $parentJustificationId,
          $hierarchyDepth, $clarificationPending, $pendingQuestions, $lastConfirmedByUser,
          $confirmedByUserId, $createdAt, $updatedAt, $version
        ]]
      :put Justification {
        id, entityId, entityType, name, filePath, purposeSummary, businessValue,
        featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
        confidenceLevel, reasoning, evidenceSources, parentJustificationId,
        hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
        confirmedByUserId, createdAt, updatedAt, version
      }
    `;

    await this.graphStore.execute(query, row as unknown as Record<string, unknown>);

    // Create HAS_JUSTIFICATION relationship
    await this.createJustificationRelationship(justification.entityId, justification.id);
  }

  /**
   * Store multiple justifications in a batch
   */
  async storeJustifications(justifications: EntityJustification[]): Promise<void> {
    if (justifications.length === 0) return;

    await this.graphStore.transaction(async (tx) => {
      for (const justification of justifications) {
        const row = this.toRow(justification);

        const query = `
          ?[id, entityId, entityType, name, filePath, purposeSummary, businessValue,
            featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
            confidenceLevel, reasoning, evidenceSources, parentJustificationId,
            hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
            confirmedByUserId, createdAt, updatedAt, version] <- [[
              $id, $entityId, $entityType, $name, $filePath, $purposeSummary, $businessValue,
              $featureContext, $detailedDescription, $tags, $inferredFrom, $confidenceScore,
              $confidenceLevel, $reasoning, $evidenceSources, $parentJustificationId,
              $hierarchyDepth, $clarificationPending, $pendingQuestions, $lastConfirmedByUser,
              $confirmedByUserId, $createdAt, $updatedAt, $version
            ]]
          :put Justification {
            id, entityId, entityType, name, filePath, purposeSummary, businessValue,
            featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
            confidenceLevel, reasoning, evidenceSources, parentJustificationId,
            hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
            confirmedByUserId, createdAt, updatedAt, version
          }
        `;

        await tx.execute(query, row as unknown as Record<string, unknown>);
      }
    });

    // Create relationships outside transaction
    for (const justification of justifications) {
      await this.createJustificationRelationship(justification.entityId, justification.id);
    }
  }

  /**
   * Create HAS_JUSTIFICATION relationship
   */
  private async createJustificationRelationship(
    entityId: string,
    justificationId: string
  ): Promise<void> {
    // Try each entity type - CozoDB will only succeed for the correct type
    const entityTypes = ["File", "Function", "Class", "Interface", "TypeAlias", "Variable", "Module"];

    for (const _entityType of entityTypes) {
      try {
        const query = `
          ?[from_id, to_id] <- [[$entityId, $justificationId]]
          :put HAS_JUSTIFICATION { from_id, to_id }
        `;
        await this.graphStore.execute(query, { entityId, justificationId });
        return; // Success - entity exists in this table
      } catch {
        // Entity not in this table, try next
      }
    }
  }

  /**
   * Store a clarification question
   */
  async storeClarificationQuestion(question: ClarificationQuestion): Promise<void> {
    const query = `
      ?[id, justificationId, entityId, question, context, priority, category,
        suggestedAnswers, answered, answer, answeredAt, createdAt] <- [[
          $id, $justificationId, $entityId, $question, $context, $priority, $category,
          $suggestedAnswers, $answered, $answer, $answeredAt, $createdAt
        ]]
      :put ClarificationQuestion {
        id, justificationId, entityId, question, context, priority, category,
        suggestedAnswers, answered, answer, answeredAt, createdAt
      }
    `;

    await this.graphStore.execute(query, {
      id: question.id,
      justificationId: question.entityId, // Will be linked to justification
      entityId: question.entityId,
      question: question.question,
      context: question.context || null,
      priority: question.priority,
      category: question.category,
      suggestedAnswers: JSON.stringify(question.suggestedAnswers || []),
      answered: question.answered,
      answer: question.answer || null,
      answeredAt: question.answeredAt || null,
      createdAt: Date.now(),
    });
  }

  /**
   * Update project context
   */
  async updateProjectContext(context: {
    projectName: string;
    projectDescription?: string;
    domain?: string;
    framework?: string;
    knownFeatures?: string[];
    businessGoals?: string[];
  }): Promise<void> {
    const query = `
      ?[id, projectName, projectDescription, domain, framework, knownFeatures,
        businessGoals, updatedAt] <- [[
          "project-context", $projectName, $projectDescription, $domain, $framework,
          $knownFeatures, $businessGoals, $updatedAt
        ]]
      :put ProjectContext {
        id, projectName, projectDescription, domain, framework, knownFeatures,
        businessGoals, updatedAt
      }
    `;

    await this.graphStore.execute(query, {
      projectName: context.projectName,
      projectDescription: context.projectDescription || null,
      domain: context.domain || null,
      framework: context.framework || null,
      knownFeatures: JSON.stringify(context.knownFeatures || []),
      businessGoals: JSON.stringify(context.businessGoals || []),
      updatedAt: Date.now(),
    });
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /**
   * Get justification by entity ID
   */
  async getByEntityId(entityId: string): Promise<EntityJustification | null> {
    const result = await this.graphStore.query<JustificationRow>(
      `?[id, entityId, entityType, name, filePath, purposeSummary, businessValue,
        featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
        confidenceLevel, reasoning, evidenceSources, parentJustificationId,
        hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
        confirmedByUserId, createdAt, updatedAt, version] :=
        *Justification{id, entityId, entityType, name, filePath, purposeSummary, businessValue,
          featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
          confidenceLevel, reasoning, evidenceSources, parentJustificationId,
          hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
          confirmedByUserId, createdAt, updatedAt, version},
        entityId = $entityId`,
      { entityId }
    );

    const row = result.rows[0];
    if (!row) return null;
    return this.fromRow(row);
  }

  /**
   * Get justification by justification ID
   */
  async getById(id: string): Promise<EntityJustification | null> {
    const result = await this.graphStore.query<JustificationRow>(
      `?[id, entityId, entityType, name, filePath, purposeSummary, businessValue,
        featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
        confidenceLevel, reasoning, evidenceSources, parentJustificationId,
        hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
        confirmedByUserId, createdAt, updatedAt, version] :=
        *Justification{id, entityId, entityType, name, filePath, purposeSummary, businessValue,
          featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
          confidenceLevel, reasoning, evidenceSources, parentJustificationId,
          hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
          confirmedByUserId, createdAt, updatedAt, version},
        id = $id`,
      { id }
    );

    const row = result.rows[0];
    if (!row) return null;
    return this.fromRow(row);
  }

  /**
   * Get multiple justifications by entity IDs
   */
  async getByEntityIds(entityIds: string[]): Promise<Map<string, EntityJustification>> {
    const result = new Map<string, EntityJustification>();
    if (entityIds.length === 0) return result;

    // Query in batches of 100
    const batchSize = 100;
    for (let i = 0; i < entityIds.length; i += batchSize) {
      const batch = entityIds.slice(i, i + batchSize);
      const idList = batch.map((id) => `"${id}"`).join(", ");

      const queryResult = await this.graphStore.query<JustificationRow>(
        `?[id, entityId, entityType, name, filePath, purposeSummary, businessValue,
          featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
          confidenceLevel, reasoning, evidenceSources, parentJustificationId,
          hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
          confirmedByUserId, createdAt, updatedAt, version] :=
          *Justification{id, entityId, entityType, name, filePath, purposeSummary, businessValue,
            featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
            confidenceLevel, reasoning, evidenceSources, parentJustificationId,
            hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
            confirmedByUserId, createdAt, updatedAt, version},
          entityId in [${idList}]`
      );

      for (const row of queryResult.rows) {
        result.set(row.entityId, this.fromRow(row));
      }
    }

    return result;
  }

  /**
   * Get all justifications for a file
   */
  async getByFilePath(filePath: string): Promise<EntityJustification[]> {
    const result = await this.graphStore.query<JustificationRow>(
      `?[id, entityId, entityType, name, filePath, purposeSummary, businessValue,
        featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
        confidenceLevel, reasoning, evidenceSources, parentJustificationId,
        hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
        confirmedByUserId, createdAt, updatedAt, version] :=
        *Justification{id, entityId, entityType, name, filePath, purposeSummary, businessValue,
          featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
          confidenceLevel, reasoning, evidenceSources, parentJustificationId,
          hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
          confirmedByUserId, createdAt, updatedAt, version},
        filePath = $filePath`,
      { filePath }
    );

    return result.rows.map((row) => this.fromRow(row));
  }

  /**
   * Get pending clarification questions (sorted by priority)
   */
  async getPendingClarifications(limit: number = 100): Promise<ClarificationQuestion[]> {
    const result = await this.graphStore.query<ClarificationQuestionRow>(
      `?[id, justificationId, entityId, question, context, priority, category,
        suggestedAnswers, answered, answer, answeredAt, createdAt] :=
        *ClarificationQuestion{id, justificationId, entityId, question, context, priority,
          category, suggestedAnswers, answered, answer, answeredAt, createdAt},
        answered = false
      :order priority
      :limit $limit`,
      { limit }
    );

    return result.rows.map((row) => this.questionFromRow(row));
  }

  /**
   * Get entities needing clarification (low confidence or pending)
   */
  async getEntitiesNeedingClarification(): Promise<EntityJustification[]> {
    const result = await this.graphStore.query<JustificationRow>(
      `?[id, entityId, entityType, name, filePath, purposeSummary, businessValue,
        featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
        confidenceLevel, reasoning, evidenceSources, parentJustificationId,
        hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
        confirmedByUserId, createdAt, updatedAt, version] :=
        *Justification{id, entityId, entityType, name, filePath, purposeSummary, businessValue,
          featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
          confidenceLevel, reasoning, evidenceSources, parentJustificationId,
          hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
          confirmedByUserId, createdAt, updatedAt, version},
        or(clarificationPending = true, confidenceScore < 0.5)
      :order hierarchyDepth, -confidenceScore`
    );

    return result.rows.map((row) => this.fromRow(row));
  }

  /**
   * Get justification statistics
   */
  async getStats(): Promise<JustificationStats> {
    // Total entities with justifications
    const totalResult = await this.graphStore.query<{ count: number }>(
      `?[count(id)] := *Justification{id}`
    );

    // By confidence level - CozoDB returns column names with aggregation syntax
    type CountRow = Record<string, number>;

    const highResult = await this.graphStore.query<CountRow>(
      `?[count(id)] := *Justification{id, confidenceScore}, confidenceScore >= 0.8`
    );

    const mediumResult = await this.graphStore.query<CountRow>(
      `?[count(id)] := *Justification{id, confidenceScore}, confidenceScore >= 0.5, confidenceScore < 0.8`
    );

    const lowResult = await this.graphStore.query<CountRow>(
      `?[count(id)] := *Justification{id, confidenceScore}, confidenceScore >= 0.3, confidenceScore < 0.5`
    );

    const pendingResult = await this.graphStore.query<CountRow>(
      `?[count(id)] := *Justification{id, clarificationPending}, clarificationPending = true`
    );

    const confirmedResult = await this.graphStore.query<CountRow>(
      `?[count(id)] := *Justification{id, lastConfirmedByUser}, lastConfirmedByUser != null`
    );

    // Total justifiable entities (approximate)
    const entityCountResult = await this.graphStore.query<CountRow>(
      `
      functions[count(id)] := *Function{id}
      classes[count(id)] := *Class{id}
      interfaces[count(id)] := *Interface{id}
      files[count(id)] := *File{id}
      ?[sum(c)] := functions[c]; classes[c]; interfaces[c]; files[c]
      `
    );

    // Helper to extract first numeric value from row
    const getCount = (row?: CountRow): number => {
      if (!row) return 0;
      const values = Object.values(row);
      return typeof values[0] === "number" ? values[0] : 0;
    };

    const totalJustifications = getCount(totalResult.rows[0]);
    const totalEntities = getCount(entityCountResult.rows[0]);

    return {
      totalEntities: totalEntities,
      justifiedEntities: totalJustifications,
      highConfidence: getCount(highResult.rows[0]),
      mediumConfidence: getCount(mediumResult.rows[0]),
      lowConfidence: getCount(lowResult.rows[0]),
      pendingClarification: getCount(pendingResult.rows[0]),
      userConfirmed: getCount(confirmedResult.rows[0]),
      coveragePercentage:
        totalEntities > 0 ? (totalJustifications / totalEntities) * 100 : 0,
    };
  }

  /**
   * Search justifications by text
   */
  async searchByText(query: string, limit: number = 50): Promise<EntityJustification[]> {
    // Use full-text search on purposeSummary and businessValue
    const result = await this.graphStore.query<JustificationRow>(
      `?[id, entityId, entityType, name, filePath, purposeSummary, businessValue,
        featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
        confidenceLevel, reasoning, evidenceSources, parentJustificationId,
        hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
        confirmedByUserId, createdAt, updatedAt, version] :=
        *Justification{id, entityId, entityType, name, filePath, purposeSummary, businessValue,
          featureContext, detailedDescription, tags, inferredFrom, confidenceScore,
          confidenceLevel, reasoning, evidenceSources, parentJustificationId,
          hierarchyDepth, clarificationPending, pendingQuestions, lastConfirmedByUser,
          confirmedByUserId, createdAt, updatedAt, version},
        or(
          str_includes(purposeSummary, $query),
          str_includes(businessValue, $query),
          str_includes(featureContext, $query)
        )
      :limit $limit`,
      { query, limit }
    );

    return result.rows.map((row) => this.fromRow(row));
  }

  // ===========================================================================
  // Delete Operations
  // ===========================================================================

  /**
   * Delete justification by entity ID
   */
  async deleteByEntityId(entityId: string): Promise<void> {
    // First get the justification ID
    const justification = await this.getByEntityId(entityId);
    if (!justification) return;

    // Delete associated clarification questions
    await this.graphStore.execute(
      `?[id] := *ClarificationQuestion{id, entityId}, entityId = $entityId
       :rm ClarificationQuestion { id }`,
      { entityId }
    );

    // Delete the justification
    await this.graphStore.execute(
      `?[id] := *Justification{id, entityId}, entityId = $entityId
       :rm Justification { id }`,
      { entityId }
    );
  }

  /**
   * Delete all justifications for a file
   */
  async deleteByFilePath(filePath: string): Promise<void> {
    // Get all entity IDs in this file
    const justifications = await this.getByFilePath(filePath);

    for (const j of justifications) {
      await this.deleteByEntityId(j.entityId);
    }
  }

  /**
   * Clear all justifications
   */
  async clearAll(): Promise<void> {
    await this.graphStore.execute(`?[id] := *ClarificationQuestion{id} :rm ClarificationQuestion { id }`);
    await this.graphStore.execute(`?[id] := *Justification{id} :rm Justification { id }`);
    await this.graphStore.execute(`?[id] := *ProjectContext{id} :rm ProjectContext { id }`);
  }

  /**
   * Mark clarification question as answered
   */
  async answerClarificationQuestion(questionId: string, answer: string): Promise<void> {
    await this.graphStore.execute(
      `?[id, answered, answer, answeredAt] <- [[$id, true, $answer, $answeredAt]]
       :update ClarificationQuestion { id => answered, answer, answeredAt }`,
      { id: questionId, answer, answeredAt: Date.now() }
    );
  }

  // ===========================================================================
  // Row Conversion
  // ===========================================================================

  /**
   * Convert EntityJustification to database row
   */
  private toRow(j: EntityJustification): JustificationRow {
    return {
      id: j.id,
      entityId: j.entityId,
      entityType: j.entityType,
      name: j.name,
      filePath: j.filePath,
      purposeSummary: j.purposeSummary,
      businessValue: j.businessValue,
      featureContext: j.featureContext,
      detailedDescription: j.detailedDescription || null,
      tags: JSON.stringify(j.tags),
      inferredFrom: j.inferredFrom,
      confidenceScore: j.confidenceScore,
      confidenceLevel: j.confidenceLevel,
      reasoning: j.reasoning || null,
      evidenceSources: JSON.stringify(j.evidenceSources),
      parentJustificationId: j.parentJustificationId,
      hierarchyDepth: j.hierarchyDepth,
      clarificationPending: j.clarificationPending,
      pendingQuestions: JSON.stringify(j.pendingQuestions),
      lastConfirmedByUser: j.lastConfirmedByUser,
      confirmedByUserId: j.confirmedByUserId,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      version: j.version,
    };
  }

  /**
   * Convert database row to EntityJustification
   */
  private fromRow(row: JustificationRow): EntityJustification {
    return {
      id: row.id,
      entityId: row.entityId,
      entityType: row.entityType as EntityJustification["entityType"],
      name: row.name,
      filePath: row.filePath,
      purposeSummary: row.purposeSummary,
      businessValue: row.businessValue,
      featureContext: row.featureContext,
      detailedDescription: row.detailedDescription || "",
      tags: this.parseJsonArray(row.tags),
      inferredFrom: row.inferredFrom as EntityJustification["inferredFrom"],
      confidenceScore: row.confidenceScore,
      confidenceLevel: row.confidenceLevel as ConfidenceLevel,
      reasoning: row.reasoning || "",
      evidenceSources: this.parseJsonArray(row.evidenceSources),
      parentJustificationId: row.parentJustificationId,
      hierarchyDepth: row.hierarchyDepth,
      clarificationPending: row.clarificationPending,
      pendingQuestions: this.parseJsonArray(row.pendingQuestions),
      lastConfirmedByUser: row.lastConfirmedByUser,
      confirmedByUserId: row.confirmedByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    };
  }

  /**
   * Convert database row to ClarificationQuestion
   */
  private questionFromRow(row: ClarificationQuestionRow): ClarificationQuestion {
    return {
      id: row.id,
      entityId: row.entityId,
      question: row.question,
      context: row.context || "",
      priority: row.priority,
      category: row.category as ClarificationQuestion["category"],
      suggestedAnswers: this.parseJsonArray(row.suggestedAnswers),
      answered: row.answered,
      answer: row.answer || undefined,
      answeredAt: row.answeredAt || undefined,
    };
  }

  /**
   * Safely parse JSON array from string
   */
  private parseJsonArray<T>(json: string): T[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a justification storage instance
 */
export function createJustificationStorage(graphStore: IGraphStore): JustificationStorage {
  return new JustificationStorage(graphStore);
}

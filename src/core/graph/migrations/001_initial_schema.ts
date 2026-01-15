/**
 * Initial Schema
 *
 * Creates all graph schema relations in one place:
 * - V1-V12: Base tables (from schema generator)
 * - V13: Justification tables (snake_case)
 * - V14: Classification tables (PascalCase)
 * - V15: Ledger & Adaptive Indexing tables (PascalCase)
 *
 * @module
 */

import type { Migration } from "../migration-runner.js";
import type { GraphDatabase, Transaction } from "../database.js";
import { generateExecutableCozoScript, getRelationName } from "../schema-generator.js";
import { SCHEMA } from "../schema-definitions.js";

/**
 * Initial schema - creates all stored relations.
 */
export const migration: Migration = {
  version: 1,
  name: "initial_schema",
  description: "Creates all graph schema relations",

  async up(db: GraphDatabase, tx: Transaction): Promise<void> {
    // =========================================================================
    // V1-V12: Base Schema (from schema generator)
    // =========================================================================
    const statements = generateExecutableCozoScript();
    for (const statement of statements) {
      if (statement.startsWith("#") || !statement.trim()) continue;
      await db.execute(statement, undefined, tx);
    }

    // =========================================================================
    // V13: Justification Layer (snake_case to match storage code)
    // =========================================================================

    await db.execute(`
      :create justification {
        id: String
        =>
        entity_id: String,
        entity_type: String,
        name: String,
        file_path: String,
        purpose_summary: String,
        business_value: String,
        feature_context: String,
        detailed_description: String?,
        tags: Json,
        inferred_from: String,
        confidence_score: Float,
        confidence_level: String,
        reasoning: String?,
        evidence_sources: Json,
        parent_justification_id: String?,
        hierarchy_depth: Int,
        clarification_pending: Bool,
        pending_questions: Json,
        last_confirmed_by_user: Int?,
        confirmed_by_user_id: String?,
        created_at: Int,
        updated_at: Int,
        version: Int
      }
    `, undefined, tx);

    await db.execute(`
      :create clarification_question {
        id: String
        =>
        justification_id: String,
        entity_id: String,
        question: String,
        context: String?,
        priority: Int,
        category: String,
        suggested_answers: Json,
        answered: Bool,
        answer: String?,
        answered_at: Int?,
        created_at: Int
      }
    `, undefined, tx);

    await db.execute(`
      :create project_context {
        id: String
        =>
        project_name: String,
        project_description: String?,
        domain: String?,
        framework: String?,
        known_features: Json,
        business_goals: Json,
        updated_at: Int
      }
    `, undefined, tx);

    await db.execute(`
      :create has_justification {
        from_id: String,
        to_id: String
      }
    `, undefined, tx);

    await db.execute(`
      :create justification_hierarchy {
        from_id: String,
        to_id: String
        =>
        relationship_type: String
      }
    `, undefined, tx);

    await db.execute(`
      :create has_clarification {
        from_id: String,
        to_id: String
      }
    `, undefined, tx);

    // =========================================================================
    // V14: Classification Layer (PascalCase to match storage code)
    // =========================================================================

    await db.execute(`
      :create EntityClassification {
        id: String
        =>
        entity_id: String,
        entity_type: String,
        entity_name: String,
        file_path: String,
        category: String,
        domain_metadata: Json?,
        infrastructure_metadata: Json?,
        confidence: Float,
        classification_method: String,
        reasoning: String,
        indicators: Json,
        related_entities: Json,
        depends_on: Json,
        used_by: Json,
        classified_at: Int,
        classified_by: String,
        last_updated: Int?,
        version: Int
      }
    `, undefined, tx);

    await db.execute(`
      :create HasClassification {
        from_id: String,
        to_id: String
      }
    `, undefined, tx);

    await db.execute(`
      :create ClassificationDependsOn {
        from_id: String,
        to_id: String
        =>
        dependency_type: String
      }
    `, undefined, tx);

    // =========================================================================
    // V15: Change Ledger & Adaptive Indexing (PascalCase to match storage code)
    // =========================================================================

    await db.execute(`
      :create LedgerEntry {
        id: String
        =>
        timestamp: Int,
        sequence: Int,
        event_type: String,
        source: String,
        impacted_files: Json,
        impacted_entities: Json,
        domains_involved: Json,
        infrastructure_involved: Json,
        classification_changes: Json,
        index_graph_diff_summary: Json?,
        confidence_adjustments: Json,
        user_interaction: Json?,
        mcp_context: Json?,
        metadata: Json,
        summary: String,
        details: String?,
        error_code: String?,
        error_message: String?,
        stack_trace: String?,
        correlation_id: String?,
        parent_event_id: String?,
        session_id: String?
      }
    `, undefined, tx);

    await db.execute(`
      :create AdaptiveSession {
        id: String
        =>
        started_at: Int,
        last_activity_at: Int,
        ended_at: Int?,
        query_count: Int,
        change_count: Int,
        correlation_count: Int,
        active_files: Json,
        active_entities: Json,
        active_domains: Json,
        triggered_reindex_count: Int,
        entities_reindexed: Int
      }
    `, undefined, tx);

    await db.execute(`
      :create ObservedQuery {
        id: String
        =>
        timestamp: Int,
        session_id: String,
        tool_name: String,
        query: String,
        parameters: Json,
        result_count: Int,
        returned_entity_ids: Json,
        returned_files: Json,
        response_time_ms: Int,
        cache_hit: Bool,
        inferred_intent: String?,
        intent_confidence: Float?,
        related_domains: Json
      }
    `, undefined, tx);

    await db.execute(`
      :create ObservedChange {
        id: String
        =>
        timestamp: Int,
        session_id: String?,
        change_type: String,
        file_path: String,
        previous_file_path: String?,
        entities_added: Json,
        entities_modified: Json,
        entities_deleted: Json,
        lines_added: Int,
        lines_deleted: Int,
        significance_score: Float,
        source: String,
        ai_generated_by: String?,
        triggered_by_query_id: String?,
        related_query_ids: Json
      }
    `, undefined, tx);

    await db.execute(`
      :create SemanticCorrelation {
        id: String
        =>
        timestamp: Int,
        query_id: String,
        change_ids: Json,
        correlation_type: String,
        correlation_strength: Float,
        confidence: Float,
        shared_concepts: Json,
        shared_entities: Json,
        shared_files: Json,
        suggested_reindexing: Json,
        priority_boost: Float
      }
    `, undefined, tx);

    await db.execute(`
      :create AdaptiveReindexRequest {
        id: String
        =>
        timestamp: Int,
        session_id: String?,
        entity_ids: Json,
        file_paths: Json,
        reason: String,
        trigger_event_id: String?,
        priority: String,
        priority_score: Float,
        reindex_scope: String,
        status: String,
        completed_at: Int?,
        error: String?
      }
    `, undefined, tx);

    await db.execute(`
      :create IndexingPriority {
        entity_id: String
        =>
        file_path: String,
        priority_score: Float,
        factors: Json,
        last_indexed: Int?,
        last_queried: Int?,
        last_modified: Int?,
        query_count: Int,
        modification_count: Int,
        correlation_count: Int
      }
    `, undefined, tx);

    // Adaptive indexing relationships
    await db.execute(`
      :create QueryReturned {
        from_id: String,
        to_id: String
        =>
        rank: Int
      }
    `, undefined, tx);

    await db.execute(`
      :create ChangeAffected {
        from_id: String,
        to_id: String
        =>
        change_type: String
      }
    `, undefined, tx);

    await db.execute(`
      :create CorrelationQuery {
        from_id: String,
        to_id: String
      }
    `, undefined, tx);

    await db.execute(`
      :create CorrelationChange {
        from_id: String,
        to_id: String
      }
    `, undefined, tx);

    await db.execute(`
      :create SessionQuery {
        from_id: String,
        to_id: String
      }
    `, undefined, tx);

    await db.execute(`
      :create SessionChange {
        from_id: String,
        to_id: String
      }
    `, undefined, tx);
  },

  async down(db: GraphDatabase, tx: Transaction): Promise<void> {
    // V15 relationships
    const v15Rels = ["SessionChange", "SessionQuery", "CorrelationChange", "CorrelationQuery", "ChangeAffected", "QueryReturned"];
    for (const rel of v15Rels) {
      try { await db.execute(`::remove ${rel}`, undefined, tx); } catch { /* ignore */ }
    }

    // V15 tables
    const v15Tables = ["IndexingPriority", "AdaptiveReindexRequest", "SemanticCorrelation", "ObservedChange", "ObservedQuery", "AdaptiveSession", "LedgerEntry"];
    for (const table of v15Tables) {
      try { await db.execute(`::remove ${table}`, undefined, tx); } catch { /* ignore */ }
    }

    // V14 tables
    const v14Tables = ["ClassificationDependsOn", "HasClassification", "EntityClassification"];
    for (const table of v14Tables) {
      try { await db.execute(`::remove ${table}`, undefined, tx); } catch { /* ignore */ }
    }

    // V13 tables
    const v13Tables = ["has_clarification", "justification_hierarchy", "has_justification", "project_context", "clarification_question", "justification"];
    for (const table of v13Tables) {
      try { await db.execute(`::remove ${table}`, undefined, tx); } catch { /* ignore */ }
    }

    // V1-V12: Base schema
    const relTables = Object.keys(SCHEMA.relationships);
    for (const relName of relTables) {
      try {
        const relationName = getRelationName(relName);
        await db.execute(`::remove ${relationName}`, undefined, tx);
      } catch { /* ignore */ }
    }

    const nodeTables = Object.keys(SCHEMA.nodes);
    for (const nodeName of nodeTables) {
      if (nodeName === "_SchemaVersion") continue;
      try {
        const relationName = getRelationName(nodeName);
        await db.execute(`::remove ${relationName}`, undefined, tx);
      } catch { /* ignore */ }
    }
  },
};

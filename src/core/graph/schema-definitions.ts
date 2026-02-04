/**
 * Graph Database Schema Definitions
 *
 * Single source of truth for the knowledge graph schema.
 * This file defines all node types, relationship types, and their properties.
 *
 * The schema is used to:
 * 1. Generate CozoScript DDL statements for CozoDB
 * 2. Generate TypeScript interfaces for type safety
 * 3. Validate data before insertion
 *
 * @module
 */

// =============================================================================
// Schema Version
// =============================================================================

/**
 * Current schema version. Increment when making breaking changes.
 * Used by the migration system to track schema evolution.
 */
export const SCHEMA_VERSION = 9;

// =============================================================================
// Property Type Definitions
// =============================================================================

/**
 * Supported property types in the graph database.
 * Maps to CozoDB data types.
 */
export type PropertyType =
  | "STRING"
  | "INT32"
  | "INT64"
  | "FLOAT"
  | "DOUBLE"
  | "BOOLEAN"
  | "TIMESTAMP"
  | "STRING[]"
  | "JSON"
  | "VECTOR_384"   // 384-dimensional vector (all-MiniLM-L6-v2)
  | "VECTOR_768";  // 768-dimensional vector (all-mpnet-base-v2)

/**
 * Property definition with type and constraints.
 */
export interface PropertyDefinition {
  /** The data type of the property */
  type: PropertyType;
  /** Whether this property is the primary key */
  primary?: boolean;
  /** Whether to create an index on this property */
  index?: boolean;
  /** Whether this property can be null */
  nullable?: boolean;
  /** Whether to create a full-text search index */
  fulltext?: boolean;
  /** Whether to create HNSW vector index */
  vectorIndex?: boolean;
  /** Default value for the property */
  default?: string | number | boolean;
}

/**
 * Node table definition.
 */
export interface NodeDefinition {
  [propertyName: string]: PropertyDefinition;
}

/**
 * Relationship table definition.
 */
export interface RelationshipDefinition {
  /** Source node type(s) */
  from: string[];
  /** Target node type(s) */
  to: string[];
  /** Relationship properties */
  properties: {
    [propertyName: string]: PropertyDefinition;
  };
}

// =============================================================================
// Schema Definition
// =============================================================================

/**
 * Complete graph schema definition.
 * This is the single source of truth for all database structures.
 */
export const SCHEMA = {
  nodes: {
    /**
     * File node - represents a source file in the project
     */
    File: {
      id: { type: "STRING", primary: true },
      path: { type: "STRING" },
      relativePath: { type: "STRING", index: true },
      extension: { type: "STRING" },
      hash: { type: "STRING" },
      size: { type: "INT64" },
      lastModified: { type: "TIMESTAMP" },
      language: { type: "STRING" },
      framework: { type: "STRING", nullable: true },
    },

    /**
     * Function node - represents a function or method
     * Includes embedding field for vector similarity search via CozoDB HNSW
     */
    Function: {
      id: { type: "STRING", primary: true },
      name: { type: "STRING", index: true },
      fileId: { type: "STRING" },
      startLine: { type: "INT32" },
      endLine: { type: "INT32" },
      startColumn: { type: "INT32" },
      endColumn: { type: "INT32" },
      signature: { type: "STRING", fulltext: true },
      returnType: { type: "STRING", nullable: true },
      isExported: { type: "BOOLEAN" },
      isAsync: { type: "BOOLEAN" },
      isGenerator: { type: "BOOLEAN" },
      complexity: { type: "INT32" },
      parameterCount: { type: "INT32" },
      docComment: { type: "STRING", nullable: true },
      businessLogic: { type: "STRING", nullable: true, fulltext: true },
      inferenceConfidence: { type: "FLOAT", nullable: true },
      // Note: Embeddings stored in separate FunctionEmbedding relation
      // because CozoDB vector fields cannot be nullable
    },

    /**
     * FunctionEmbedding node - stores vector embeddings for functions
     * Separate from Function because CozoDB vector fields cannot be null
     */
    FunctionEmbedding: {
      functionId: { type: "STRING", primary: true },
      embedding: { type: "VECTOR_384", vectorIndex: true },
    },

    /**
     * Class node - represents a class definition
     */
    Class: {
      id: { type: "STRING", primary: true },
      name: { type: "STRING", index: true },
      fileId: { type: "STRING" },
      startLine: { type: "INT32" },
      endLine: { type: "INT32" },
      isAbstract: { type: "BOOLEAN" },
      isExported: { type: "BOOLEAN" },
      extendsClass: { type: "STRING", nullable: true },
      implementsInterfaces: { type: "STRING[]" },
      docComment: { type: "STRING", nullable: true },
    },

    /**
     * Interface node - represents an interface definition
     * Stores properties as native JSON
     */
    Interface: {
      id: { type: "STRING", primary: true },
      name: { type: "STRING", index: true },
      fileId: { type: "STRING" },
      startLine: { type: "INT32" },
      endLine: { type: "INT32" },
      isExported: { type: "BOOLEAN" },
      extendsInterfaces: { type: "STRING[]" },
      docComment: { type: "STRING", nullable: true },
      // Native JSON storage for interface properties
      properties: { type: "JSON", nullable: true },
    },

    /**
     * TypeAlias node - represents a type alias definition
     */
    TypeAlias: {
      id: { type: "STRING", primary: true },
      name: { type: "STRING", index: true },
      fileId: { type: "STRING" },
      startLine: { type: "INT32" },
      endLine: { type: "INT32" },
      isExported: { type: "BOOLEAN" },
      typeDefinition: { type: "STRING" },
      docComment: { type: "STRING", nullable: true },
    },

    /**
     * Variable node - represents a module-level variable or constant
     */
    Variable: {
      id: { type: "STRING", primary: true },
      name: { type: "STRING", index: true },
      fileId: { type: "STRING" },
      line: { type: "INT32" },
      column: { type: "INT32" },
      variableType: { type: "STRING", nullable: true },
      isConst: { type: "BOOLEAN" },
      isExported: { type: "BOOLEAN" },
      scope: { type: "STRING" },
    },

    /**
     * GhostNode - represents external dependencies (from node_modules)
     * Lightweight node without full implementation details
     */
    GhostNode: {
      id: { type: "STRING", primary: true },
      name: { type: "STRING", index: true },
      packageName: { type: "STRING", index: true },
      entityType: { type: "STRING" }, // 'function' | 'class' | 'interface' | 'type'
      signature: { type: "STRING", nullable: true },
      isExternal: { type: "BOOLEAN" },
    },

    /**
     * Module node - represents a logical module (detected via clustering)
     * Used for GraphRAG hierarchical summarization
     */
    Module: {
      id: { type: "STRING", primary: true },
      name: { type: "STRING", index: true },
      directory: { type: "STRING" },
      summary: { type: "STRING", nullable: true, fulltext: true },
      fileCount: { type: "INT32" },
      functionCount: { type: "INT32" },
    },

    /**
     * Internal schema version tracking node
     */
    _SchemaVersion: {
      id: { type: "STRING", primary: true },
      version: { type: "INT32" },
      appliedAt: { type: "TIMESTAMP" },
      description: { type: "STRING", nullable: true },
    },

    /**
     * Justification node - stores business justification for code entities
     * Part of the Business Justification Layer (V13)
     */
    Justification: {
      id: { type: "STRING", primary: true },
      entityId: { type: "STRING", index: true },
      entityType: { type: "STRING" }, // 'file' | 'function' | 'class' | 'interface' | 'module'
      name: { type: "STRING", index: true },
      filePath: { type: "STRING" },
      purposeSummary: { type: "STRING", fulltext: true },
      businessValue: { type: "STRING", fulltext: true },
      featureContext: { type: "STRING", index: true },
      detailedDescription: { type: "STRING", nullable: true },
      tags: { type: "JSON" }, // string[]
      inferredFrom: { type: "STRING" }, // 'llm_inferred' | 'user_provided' | 'propagated_down' | 'propagated_up' | 'code_comment'
      confidenceScore: { type: "FLOAT" },
      confidenceLevel: { type: "STRING" }, // 'high' | 'medium' | 'low' | 'uncertain'
      reasoning: { type: "STRING", nullable: true },
      evidenceSources: { type: "JSON" }, // string[]
      parentJustificationId: { type: "STRING", nullable: true },
      hierarchyDepth: { type: "INT32" },
      clarificationPending: { type: "BOOLEAN", index: true },
      pendingQuestions: { type: "JSON" }, // ClarificationQuestion[]
      lastConfirmedByUser: { type: "TIMESTAMP", nullable: true },
      confirmedByUserId: { type: "STRING", nullable: true },
      createdAt: { type: "TIMESTAMP" },
      updatedAt: { type: "TIMESTAMP" },
      version: { type: "INT32" },
    },

    /**
     * ClarificationQuestion node - stores pending questions for user
     * Part of the Business Justification Layer (V13)
     */
    ClarificationQuestion: {
      id: { type: "STRING", primary: true },
      justificationId: { type: "STRING", index: true },
      entityId: { type: "STRING", index: true },
      question: { type: "STRING" },
      context: { type: "STRING", nullable: true },
      priority: { type: "INT32", index: true },
      category: { type: "STRING" }, // 'purpose' | 'business_value' | 'feature_context' | 'naming' | 'relationship' | 'ownership'
      suggestedAnswers: { type: "JSON" }, // string[]
      answered: { type: "BOOLEAN", index: true },
      answer: { type: "STRING", nullable: true },
      answeredAt: { type: "TIMESTAMP", nullable: true },
      createdAt: { type: "TIMESTAMP" },
    },

    /**
     * ProjectContext node - stores project-level context for justification
     * Singleton per project
     */
    ProjectContext: {
      id: { type: "STRING", primary: true },
      projectName: { type: "STRING" },
      projectDescription: { type: "STRING", nullable: true },
      domain: { type: "STRING", nullable: true },
      framework: { type: "STRING", nullable: true },
      knownFeatures: { type: "JSON" }, // string[]
      businessGoals: { type: "JSON" }, // string[]
      updatedAt: { type: "TIMESTAMP" },
    },

    // =========================================================================
    // Classification Layer (V14) - Domain vs Infrastructure
    // =========================================================================

    /**
     * EntityClassification - stores domain/infrastructure classification
     */
    EntityClassification: {
      id: { type: "STRING", primary: true },
      entityId: { type: "STRING", index: true },
      entityType: { type: "STRING" }, // 'function' | 'class' | 'interface' | 'type' | 'variable' | 'module' | 'file'
      entityName: { type: "STRING", index: true },
      filePath: { type: "STRING", index: true },
      category: { type: "STRING", index: true }, // 'domain' | 'infrastructure' | 'unknown'
      // Domain metadata (JSON for flexibility)
      domainMetadata: { type: "JSON", nullable: true },
      // Infrastructure metadata (JSON for flexibility)
      infrastructureMetadata: { type: "JSON", nullable: true },
      confidence: { type: "FLOAT" },
      classificationMethod: { type: "STRING" }, // 'llm' | 'pattern' | 'dependency' | 'heuristic' | 'user'
      reasoning: { type: "STRING", fulltext: true },
      indicators: { type: "JSON" }, // string[]
      relatedEntities: { type: "JSON" }, // string[]
      dependsOn: { type: "JSON" }, // string[]
      usedBy: { type: "JSON" }, // string[]
      classifiedAt: { type: "TIMESTAMP" },
      classifiedBy: { type: "STRING" },
      lastUpdated: { type: "TIMESTAMP", nullable: true },
      version: { type: "INT32" },
    },

    // =========================================================================
    // Change Ledger (V14) - Observability Layer
    // =========================================================================

    /**
     * LedgerEntry - append-only log of system events
     */
    LedgerEntry: {
      id: { type: "STRING", primary: true },
      timestamp: { type: "TIMESTAMP", index: true },
      sequence: { type: "INT64", index: true },
      eventType: { type: "STRING", index: true },
      source: { type: "STRING", index: true },
      impactedFiles: { type: "JSON" }, // string[]
      impactedEntities: { type: "JSON" }, // string[]
      domainsInvolved: { type: "JSON" }, // string[]
      infrastructureInvolved: { type: "JSON" }, // string[]
      classificationChanges: { type: "JSON" }, // ClassificationChange[]
      indexGraphDiffSummary: { type: "JSON", nullable: true },
      confidenceAdjustments: { type: "JSON" }, // ConfidenceAdjustment[]
      userInteraction: { type: "JSON", nullable: true },
      mcpContext: { type: "JSON", nullable: true },
      metadata: { type: "JSON" },
      summary: { type: "STRING", fulltext: true },
      details: { type: "STRING", nullable: true },
      errorCode: { type: "STRING", nullable: true },
      errorMessage: { type: "STRING", nullable: true },
      stackTrace: { type: "STRING", nullable: true },
      correlationId: { type: "STRING", nullable: true, index: true },
      parentEventId: { type: "STRING", nullable: true },
      sessionId: { type: "STRING", nullable: true, index: true },
    },

    /**
     * CompactedLedgerEntry - consolidated summary of coding session
     */
    CompactedLedgerEntry: {
      id: { type: "STRING", primary: true },
      sessionId: { type: "STRING", index: true },
      timestampStart: { type: "TIMESTAMP", index: true },
      timestampEnd: { type: "TIMESTAMP", index: true },
      source: { type: "STRING", index: true },
      intentSummary: { type: "STRING", fulltext: true },
      intentCategory: { type: "STRING", index: true },
      userPrompts: { type: "JSON" }, // string[]
      mcpQueries: { type: "JSON" }, // MCPQueryTrace[]
      totalMcpQueries: { type: "INT32" },
      uniqueToolsUsed: { type: "JSON" }, // string[]
      codeAccessed: { type: "JSON" }, // CodeAccessSummary
      codeChanges: { type: "JSON" }, // CodeChangesSummary
      semanticImpact: { type: "JSON" }, // SemanticImpact
      indexUpdates: { type: "JSON" }, // IndexUpdatesSummary
      memoryUpdates: { type: "JSON" }, // MemoryUpdate[]
      memoryRulesApplied: { type: "JSON" }, // string[]
      rawEventIds: { type: "JSON" }, // string[]
      rawEventCount: { type: "INT32" },
      confidenceScore: { type: "FLOAT" },
      completeness: { type: "FLOAT" },
      correlatedSessions: { type: "JSON" }, // string[]
      gitCommitSha: { type: "STRING", nullable: true },
      gitBranch: { type: "STRING", nullable: true },
      contentHash: { type: "STRING", nullable: true },
    },

    // =========================================================================
    // Adaptive Indexing (V14) - MCP-Driven Intelligence
    // =========================================================================

    /**
     * AdaptiveSession - tracks coding sessions
     */
    AdaptiveSession: {
      id: { type: "STRING", primary: true },
      startedAt: { type: "TIMESTAMP" },
      lastActivityAt: { type: "TIMESTAMP" },
      endedAt: { type: "TIMESTAMP", nullable: true },
      queryCount: { type: "INT32" },
      changeCount: { type: "INT32" },
      correlationCount: { type: "INT32" },
      activeFiles: { type: "JSON" }, // string[]
      activeEntities: { type: "JSON" }, // string[]
      activeDomains: { type: "JSON" }, // string[]
      triggeredReindexCount: { type: "INT32" },
      entitiesReindexed: { type: "INT32" },
    },

    /**
     * ObservedQuery - tracks MCP queries
     */
    ObservedQuery: {
      id: { type: "STRING", primary: true },
      timestamp: { type: "TIMESTAMP", index: true },
      sessionId: { type: "STRING", index: true },
      toolName: { type: "STRING", index: true },
      query: { type: "STRING", fulltext: true },
      parameters: { type: "JSON" },
      resultCount: { type: "INT32" },
      returnedEntityIds: { type: "JSON" }, // string[]
      returnedFiles: { type: "JSON" }, // string[]
      responseTimeMs: { type: "INT32" },
      cacheHit: { type: "BOOLEAN" },
      inferredIntent: { type: "STRING", nullable: true },
      intentConfidence: { type: "FLOAT", nullable: true },
      relatedDomains: { type: "JSON" }, // string[]
    },

    /**
     * ObservedChange - tracks code changes
     */
    ObservedChange: {
      id: { type: "STRING", primary: true },
      timestamp: { type: "TIMESTAMP", index: true },
      sessionId: { type: "STRING", nullable: true, index: true },
      changeType: { type: "STRING" }, // 'created' | 'modified' | 'deleted' | 'renamed' | 'moved'
      filePath: { type: "STRING", index: true },
      previousFilePath: { type: "STRING", nullable: true },
      entitiesAdded: { type: "JSON" }, // string[]
      entitiesModified: { type: "JSON" }, // string[]
      entitiesDeleted: { type: "JSON" }, // string[]
      linesAdded: { type: "INT32" },
      linesDeleted: { type: "INT32" },
      significanceScore: { type: "FLOAT" },
      source: { type: "STRING" }, // 'filesystem' | 'ai-generated' | 'user-edit' | 'refactor'
      aiGeneratedBy: { type: "STRING", nullable: true },
      triggeredByQueryId: { type: "STRING", nullable: true },
      relatedQueryIds: { type: "JSON" }, // string[]
    },

    /**
     * SemanticCorrelation - links queries to resulting changes
     */
    SemanticCorrelation: {
      id: { type: "STRING", primary: true },
      timestamp: { type: "TIMESTAMP", index: true },
      queryId: { type: "STRING", index: true },
      changeIds: { type: "JSON" }, // string[]
      correlationType: { type: "STRING" }, // 'query-then-edit' | 'query-then-create' | etc.
      correlationStrength: { type: "FLOAT" },
      confidence: { type: "FLOAT" },
      sharedConcepts: { type: "JSON" }, // string[]
      sharedEntities: { type: "JSON" }, // string[]
      sharedFiles: { type: "JSON" }, // string[]
      suggestedReindexing: { type: "JSON" }, // string[]
      priorityBoost: { type: "FLOAT" },
    },

    /**
     * AdaptiveReindexRequest - pending reindex requests
     */
    AdaptiveReindexRequest: {
      id: { type: "STRING", primary: true },
      timestamp: { type: "TIMESTAMP", index: true },
      sessionId: { type: "STRING", nullable: true, index: true },
      entityIds: { type: "JSON" }, // string[]
      filePaths: { type: "JSON" }, // string[]
      reason: { type: "STRING" }, // 'query-correlation' | 'change-cascade' | etc.
      triggerEventId: { type: "STRING", nullable: true },
      priority: { type: "STRING" }, // 'immediate' | 'high' | 'normal' | 'low'
      priorityScore: { type: "FLOAT" },
      reindexScope: { type: "STRING" }, // 'entity-only' | 'file' | 'related' | 'cascade'
      status: { type: "STRING", index: true }, // 'pending' | 'processing' | 'completed' | 'failed'
      completedAt: { type: "TIMESTAMP", nullable: true },
      error: { type: "STRING", nullable: true },
    },

    /**
     * IndexingPriority - entity priority queue for adaptive indexing
     */
    IndexingPriority: {
      entityId: { type: "STRING", primary: true },
      filePath: { type: "STRING", index: true },
      priorityScore: { type: "FLOAT", index: true },
      factors: { type: "JSON" }, // PriorityFactor[]
      lastIndexed: { type: "TIMESTAMP", nullable: true },
      lastQueried: { type: "TIMESTAMP", nullable: true },
      lastModified: { type: "TIMESTAMP", nullable: true },
      queryCount: { type: "INT32" },
      modificationCount: { type: "INT32" },
      correlationCount: { type: "INT32" },
    },

    // =========================================================================
    // Enhanced Entity Semantics (Phase 1 - Improvement Plan)
    // =========================================================================

    /**
     * FunctionParameterSemantics - enhanced parameter analysis
     * Part of Phase 1: Enhanced Entity Semantics
     */
    FunctionParameterSemantics: {
      id: { type: "STRING", primary: true },
      functionId: { type: "STRING", index: true },
      paramName: { type: "STRING", index: true },
      paramIndex: { type: "INT32" },
      paramType: { type: "STRING", nullable: true },
      purpose: { type: "STRING" }, // 'input' | 'output' | 'config' | 'callback' | 'context' | 'unknown'
      isOptional: { type: "BOOLEAN" },
      isRest: { type: "BOOLEAN" },
      isDestructured: { type: "BOOLEAN" },
      defaultValue: { type: "STRING", nullable: true },
      validationRules: { type: "JSON" }, // string[]
      usedInExpressions: { type: "JSON" }, // ParameterUsage[]
      isMutated: { type: "BOOLEAN" },
      accessedAtLines: { type: "JSON" }, // number[]
      confidence: { type: "FLOAT" },
      analyzedAt: { type: "TIMESTAMP" },
    },

    /**
     * FunctionReturnSemantics - enhanced return value analysis
     * Part of Phase 1: Enhanced Entity Semantics
     */
    FunctionReturnSemantics: {
      id: { type: "STRING", primary: true },
      functionId: { type: "STRING", index: true },
      declaredType: { type: "STRING", nullable: true },
      inferredType: { type: "STRING", nullable: true },
      returnPoints: { type: "JSON" }, // ReturnPoint[]
      possibleValues: { type: "JSON" }, // string[]
      nullConditions: { type: "JSON" }, // string[]
      errorConditions: { type: "JSON" }, // string[]
      derivedFrom: { type: "JSON" }, // string[]
      transformations: { type: "JSON" }, // string[]
      canReturnVoid: { type: "BOOLEAN" },
      alwaysThrows: { type: "BOOLEAN" },
      confidence: { type: "FLOAT" },
      analyzedAt: { type: "TIMESTAMP" },
    },

    /**
     * ErrorPath - error handling and propagation paths
     * Part of Phase 1: Enhanced Entity Semantics
     */
    ErrorPath: {
      id: { type: "STRING", primary: true },
      functionId: { type: "STRING", index: true },
      errorType: { type: "STRING", index: true },
      condition: { type: "STRING", nullable: true },
      isHandled: { type: "BOOLEAN" },
      handlingStrategy: { type: "STRING", nullable: true }, // 'throw' | 'catch-rethrow' | 'catch-handle' | etc.
      recoveryAction: { type: "STRING", nullable: true },
      propagatesTo: { type: "JSON" }, // string[]
      sourceLocation: { type: "JSON" }, // { line, column }
      stackContext: { type: "JSON" }, // string[]
      confidence: { type: "FLOAT" },
      analyzedAt: { type: "TIMESTAMP" },
    },

    /**
     * FunctionErrorAnalysis - summary of error handling for a function
     * Part of Phase 1: Enhanced Entity Semantics
     */
    FunctionErrorAnalysis: {
      id: { type: "STRING", primary: true },
      functionId: { type: "STRING", index: true },
      throwPoints: { type: "JSON" }, // ThrowPoint[]
      tryCatchBlocks: { type: "JSON" }, // TryCatchBlock[]
      neverThrows: { type: "BOOLEAN" },
      hasTopLevelCatch: { type: "BOOLEAN" },
      escapingErrorTypes: { type: "JSON" }, // string[]
      confidence: { type: "FLOAT" },
      analyzedAt: { type: "TIMESTAMP" },
    },

    // =========================================================================
    // Data Flow Analysis (Phase 2 - Improvement Plan)
    // =========================================================================

    /**
     * DataFlowCache - cached data flow analysis for a function
     * Part of Phase 2: Data Flow Analysis (Lazy Evaluation Strategy)
     *
     * Stores both a compressed summary and the full graph for on-demand retrieval.
     */
    DataFlowCache: {
      id: { type: "STRING", primary: true },
      functionId: { type: "STRING", index: true },
      fileId: { type: "STRING", index: true },
      fileHash: { type: "STRING" }, // For staleness detection
      // Summary for quick lookups
      nodeCount: { type: "INT32" },
      edgeCount: { type: "INT32" },
      hasSideEffects: { type: "BOOLEAN" },
      accessesExternalState: { type: "BOOLEAN" },
      isPure: { type: "BOOLEAN" },
      inputsAffectingOutput: { type: "JSON" }, // string[] - parameter names
      // Full analysis data (JSON for flexibility)
      flowSummaryJson: { type: "JSON" }, // FunctionDataFlowSummary
      fullGraphJson: { type: "JSON" }, // FunctionDataFlow (full nodes/edges)
      // Taint analysis results
      taintFlowsJson: { type: "JSON", nullable: true }, // TaintFlow[]
      // Metadata
      confidence: { type: "FLOAT" },
      computedAt: { type: "TIMESTAMP" },
      accessCount: { type: "INT32" }, // For cache eviction policy
      lastAccessedAt: { type: "TIMESTAMP", nullable: true },
    },

    /**
     * DataFlowNode - individual node in a data flow graph
     * Part of Phase 2: Data Flow Analysis
     *
     * Note: Only populated when full materialization is needed for cross-function analysis.
     * For intra-function analysis, nodes are stored in DataFlowCache.fullGraphJson.
     */
    DataFlowNode: {
      id: { type: "STRING", primary: true },
      functionId: { type: "STRING", index: true },
      kind: { type: "STRING", index: true }, // 'parameter' | 'variable' | 'return' | 'call_result' | etc.
      name: { type: "STRING", index: true },
      line: { type: "INT32" },
      column: { type: "INT32" },
      inferredType: { type: "STRING", nullable: true },
      isTainted: { type: "BOOLEAN" },
      taintSource: { type: "STRING", nullable: true }, // 'user_input' | 'network' | etc.
    },

    /**
     * CrossFunctionFlow - data flow across function boundaries
     * Part of Phase 2: Data Flow Analysis
     *
     * Tracks how data flows from one function to another through calls.
     */
    CrossFunctionFlow: {
      id: { type: "STRING", primary: true },
      callerId: { type: "STRING", index: true },
      calleeId: { type: "STRING", index: true },
      callSiteLine: { type: "INT32" },
      // Argument mapping
      argumentsJson: { type: "JSON" }, // ArgumentFlow[]
      // Return usage
      returnUsageJson: { type: "JSON", nullable: true }, // ReturnUsage
      // Taint propagation
      propagatesTaint: { type: "BOOLEAN" },
      taintedArguments: { type: "JSON" }, // number[] - indices of tainted args
      // Metadata
      confidence: { type: "FLOAT" },
      analyzedAt: { type: "TIMESTAMP" },
    },

    /**
     * TaintSource - tracks external data sources that introduce taint
     * Part of Phase 2: Data Flow Analysis (Taint Tracking)
     */
    TaintSource: {
      id: { type: "STRING", primary: true },
      functionId: { type: "STRING", index: true },
      sourceCategory: { type: "STRING", index: true }, // 'user_input' | 'network' | 'filesystem' | etc.
      nodeId: { type: "STRING" }, // DataFlowNode where taint originates
      description: { type: "STRING" },
      line: { type: "INT32" },
      isSanitized: { type: "BOOLEAN" },
      sanitizationPoint: { type: "STRING", nullable: true }, // Node ID where sanitized
      discoveredAt: { type: "TIMESTAMP" },
    },

    // =========================================================================
    // Side-Effect Analysis (Phase 3 - Improvement Plan)
    // =========================================================================

    /**
     * SideEffect - individual side effect detected in a function
     * Part of Phase 3: Side-Effect Analysis
     */
    SideEffect: {
      id: { type: "STRING", primary: true },
      functionId: { type: "STRING", index: true },
      filePath: { type: "STRING", index: true },
      category: { type: "STRING", index: true }, // 'io-file' | 'io-network' | 'io-database' | etc.
      description: { type: "STRING" },
      target: { type: "STRING", nullable: true }, // What is affected (e.g., "this.state", "database")
      apiCall: { type: "STRING" }, // The API/method call causing the side effect
      isConditional: { type: "BOOLEAN" },
      condition: { type: "STRING", nullable: true }, // The condition under which this occurs
      confidence: { type: "STRING" }, // 'high' | 'medium' | 'low'
      evidenceJson: { type: "JSON" }, // string[] - evidence for detection
      sourceLine: { type: "INT32" },
      sourceColumn: { type: "INT32" },
      analyzedAt: { type: "TIMESTAMP" },
    },

    /**
     * FunctionSideEffectSummary - summary of side effects for a function
     * Part of Phase 3: Side-Effect Analysis
     */
    FunctionSideEffectSummary: {
      functionId: { type: "STRING", primary: true },
      filePath: { type: "STRING", index: true },
      totalCount: { type: "INT32" },
      isPure: { type: "BOOLEAN", index: true },
      allConditional: { type: "BOOLEAN" },
      primaryCategoriesJson: { type: "JSON" }, // string[] - most significant categories
      riskLevel: { type: "STRING", index: true }, // 'low' | 'medium' | 'high'
      confidence: { type: "FLOAT" },
      analyzedAt: { type: "TIMESTAMP" },
    },

    // =========================================================================
    // Design Pattern Detection (Phase 4 - Improvement Plan)
    // =========================================================================

    /**
     * DesignPattern - detected design pattern instance
     * Part of Phase 4: Design Pattern Detection
     */
    DesignPattern: {
      id: { type: "STRING", primary: true },
      patternType: { type: "STRING", index: true }, // 'factory' | 'singleton' | 'observer' | etc.
      name: { type: "STRING", index: true },
      confidence: { type: "FLOAT" },
      confidenceLevel: { type: "STRING" }, // 'high' | 'medium' | 'low'
      evidenceJson: { type: "JSON" }, // string[] - evidence for detection
      filePathsJson: { type: "JSON" }, // string[] - files where pattern is located
      description: { type: "STRING", nullable: true },
      detectedAt: { type: "TIMESTAMP" },
    },

    /**
     * PatternParticipant - entity participating in a design pattern
     * Part of Phase 4: Design Pattern Detection
     */
    PatternParticipant: {
      id: { type: "STRING", primary: true },
      patternId: { type: "STRING", index: true },
      entityId: { type: "STRING", index: true },
      role: { type: "STRING", index: true }, // 'factory' | 'product' | 'singleton' | etc.
      entityType: { type: "STRING" }, // 'class' | 'function' | 'interface' | 'variable' | 'method'
      entityName: { type: "STRING", index: true },
      filePath: { type: "STRING", index: true },
      evidenceJson: { type: "JSON" }, // string[] - why this entity has this role
    },
  },

  relationships: {
    /**
     * CONTAINS - File contains code entities
     */
    CONTAINS: {
      from: ["File"],
      to: ["Function", "Class", "Interface", "TypeAlias", "Variable"],
      properties: {
        lineNumber: { type: "INT32" },
      },
    },

    /**
     * CALLS - Function calls another function
     */
    CALLS: {
      from: ["Function"],
      to: ["Function"],
      properties: {
        lineNumber: { type: "INT32" },
        isDirectCall: { type: "BOOLEAN" },
        isAsync: { type: "BOOLEAN" },
      },
    },

    /**
     * IMPORTS - File imports from another file
     */
    IMPORTS: {
      from: ["File"],
      to: ["File"],
      properties: {
        importedSymbols: { type: "STRING[]" },
        importType: { type: "STRING" }, // 'named' | 'default' | 'namespace' | 'side-effect'
        isTypeOnly: { type: "BOOLEAN" },
      },
    },

    /**
     * EXTENDS - Class extends another class
     */
    EXTENDS: {
      from: ["Class"],
      to: ["Class"],
      properties: {},
    },

    /**
     * IMPLEMENTS - Class implements an interface
     */
    IMPLEMENTS: {
      from: ["Class"],
      to: ["Interface"],
      properties: {},
    },

    /**
     * EXTENDS_INTERFACE - Interface extends another interface
     */
    EXTENDS_INTERFACE: {
      from: ["Interface"],
      to: ["Interface"],
      properties: {},
    },

    /**
     * HAS_METHOD - Class or Interface has a method
     */
    HAS_METHOD: {
      from: ["Class", "Interface"],
      to: ["Function"],
      properties: {
        visibility: { type: "STRING" }, // 'public' | 'private' | 'protected'
        isStatic: { type: "BOOLEAN" },
        isAbstract: { type: "BOOLEAN" },
      },
    },

    /**
     * USES_TYPE - Function uses a type (parameter, return, variable)
     */
    USES_TYPE: {
      from: ["Function"],
      to: ["Class", "Interface", "TypeAlias"],
      properties: {
        context: { type: "STRING" }, // 'parameter' | 'return' | 'variable' | 'generic'
        parameterName: { type: "STRING", nullable: true },
      },
    },

    /**
     * REFERENCES_EXTERNAL - Internal entity references external dependency
     */
    REFERENCES_EXTERNAL: {
      from: ["Function", "Class", "Interface"],
      to: ["GhostNode"],
      properties: {
        context: { type: "STRING" }, // 'import' | 'extends' | 'implements' | 'call'
        lineNumber: { type: "INT32" },
      },
    },

    /**
     * BELONGS_TO_MODULE - Entity belongs to a detected module
     */
    BELONGS_TO_MODULE: {
      from: ["File"],
      to: ["Module"],
      properties: {},
    },

    /**
     * DEPENDS_ON - Module depends on another module
     */
    DEPENDS_ON: {
      from: ["Module"],
      to: ["Module"],
      properties: {
        strength: { type: "INT32" }, // Number of imports between modules
      },
    },

    /**
     * HAS_JUSTIFICATION - Entity has a business justification
     * Part of the Business Justification Layer (V13)
     */
    HAS_JUSTIFICATION: {
      from: ["File", "Function", "Class", "Interface", "TypeAlias", "Variable", "Module"],
      to: ["Justification"],
      properties: {},
    },

    /**
     * JUSTIFICATION_HIERARCHY - Parent-child relationship between justifications
     * Used for context propagation up/down the tree
     */
    JUSTIFICATION_HIERARCHY: {
      from: ["Justification"],
      to: ["Justification"],
      properties: {
        relationshipType: { type: "STRING" }, // 'parent_of' | 'child_of'
      },
    },

    /**
     * HAS_CLARIFICATION - Justification has pending clarification question
     */
    HAS_CLARIFICATION: {
      from: ["Justification"],
      to: ["ClarificationQuestion"],
      properties: {},
    },

    // =========================================================================
    // Classification Relationships (V14)
    // =========================================================================

    /**
     * HAS_CLASSIFICATION - Entity has a domain/infrastructure classification
     */
    HAS_CLASSIFICATION: {
      from: ["File", "Function", "Class", "Interface", "TypeAlias", "Variable", "Module"],
      to: ["EntityClassification"],
      properties: {},
    },

    /**
     * CLASSIFICATION_DEPENDS_ON - Classification depends on another entity
     */
    CLASSIFICATION_DEPENDS_ON: {
      from: ["EntityClassification"],
      to: ["EntityClassification"],
      properties: {
        dependencyType: { type: "STRING" }, // 'imports' | 'calls' | 'extends' | 'uses'
      },
    },

    // =========================================================================
    // Adaptive Indexing Relationships (V14)
    // =========================================================================

    /**
     * QUERY_RETURNED - Query returned an entity
     */
    QUERY_RETURNED: {
      from: ["ObservedQuery"],
      to: ["Function", "Class", "Interface", "File"],
      properties: {
        rank: { type: "INT32" },
      },
    },

    /**
     * CHANGE_AFFECTED - Change affected an entity
     */
    CHANGE_AFFECTED: {
      from: ["ObservedChange"],
      to: ["Function", "Class", "Interface", "File"],
      properties: {
        changeType: { type: "STRING" }, // 'added' | 'modified' | 'deleted'
      },
    },

    /**
     * CORRELATION_QUERY - Correlation links to query
     */
    CORRELATION_QUERY: {
      from: ["SemanticCorrelation"],
      to: ["ObservedQuery"],
      properties: {},
    },

    /**
     * CORRELATION_CHANGE - Correlation links to change
     */
    CORRELATION_CHANGE: {
      from: ["SemanticCorrelation"],
      to: ["ObservedChange"],
      properties: {},
    },

    /**
     * SESSION_QUERY - Session contains query
     */
    SESSION_QUERY: {
      from: ["AdaptiveSession"],
      to: ["ObservedQuery"],
      properties: {},
    },

    /**
     * SESSION_CHANGE - Session contains change
     */
    SESSION_CHANGE: {
      from: ["AdaptiveSession"],
      to: ["ObservedChange"],
      properties: {},
    },

    // =========================================================================
    // Enhanced Entity Semantics Relationships (Phase 1)
    // =========================================================================

    /**
     * HAS_PARAMETER_SEMANTICS - Function has parameter semantic analysis
     */
    HAS_PARAMETER_SEMANTICS: {
      from: ["Function"],
      to: ["FunctionParameterSemantics"],
      properties: {},
    },

    /**
     * HAS_RETURN_SEMANTICS - Function has return value semantic analysis
     */
    HAS_RETURN_SEMANTICS: {
      from: ["Function"],
      to: ["FunctionReturnSemantics"],
      properties: {},
    },

    /**
     * HAS_ERROR_ANALYSIS - Function has error analysis
     */
    HAS_ERROR_ANALYSIS: {
      from: ["Function"],
      to: ["FunctionErrorAnalysis"],
      properties: {},
    },

    /**
     * HAS_ERROR_PATH - Function has specific error path
     */
    HAS_ERROR_PATH: {
      from: ["Function"],
      to: ["ErrorPath"],
      properties: {},
    },

    /**
     * ERROR_PROPAGATES_TO - Error path propagates to another function
     */
    ERROR_PROPAGATES_TO: {
      from: ["ErrorPath"],
      to: ["Function"],
      properties: {
        propagationType: { type: "STRING" }, // 'direct' | 'caught-rethrown' | 'wrapped'
      },
    },

    // =========================================================================
    // Data Flow Analysis Relationships (Phase 2)
    // =========================================================================

    /**
     * HAS_DATA_FLOW_CACHE - Function has cached data flow analysis
     */
    HAS_DATA_FLOW_CACHE: {
      from: ["Function"],
      to: ["DataFlowCache"],
      properties: {},
    },

    /**
     * DATA_FLOWS_TO - Data flow edge between nodes
     * Only materialized for cross-function analysis
     */
    DATA_FLOWS_TO: {
      from: ["DataFlowNode"],
      to: ["DataFlowNode"],
      properties: {
        edgeKind: { type: "STRING" }, // 'assign' | 'transform' | 'read' | 'write' | etc.
        transformation: { type: "STRING", nullable: true },
        condition: { type: "STRING", nullable: true },
        lineNumber: { type: "INT32" },
        propagatesTaint: { type: "BOOLEAN" },
      },
    },

    /**
     * HAS_CROSS_FLOW - Function has cross-function data flow
     */
    HAS_CROSS_FLOW: {
      from: ["Function"],
      to: ["CrossFunctionFlow"],
      properties: {
        role: { type: "STRING" }, // 'caller' | 'callee'
      },
    },

    /**
     * HAS_TAINT_SOURCE - Function has a taint source
     */
    HAS_TAINT_SOURCE: {
      from: ["Function"],
      to: ["TaintSource"],
      properties: {},
    },

    /**
     * TAINT_FLOWS_TO - Taint propagation path
     */
    TAINT_FLOWS_TO: {
      from: ["TaintSource"],
      to: ["DataFlowNode"],
      properties: {
        pathLength: { type: "INT32" },
        isSanitized: { type: "BOOLEAN" },
      },
    },

    // =========================================================================
    // Side-Effect Analysis Relationships (Phase 3)
    // =========================================================================

    /**
     * HAS_SIDE_EFFECT - Function has a detected side effect
     */
    HAS_SIDE_EFFECT: {
      from: ["Function"],
      to: ["SideEffect"],
      properties: {},
    },

    /**
     * HAS_SIDE_EFFECT_SUMMARY - Function has a side effect summary
     */
    HAS_SIDE_EFFECT_SUMMARY: {
      from: ["Function"],
      to: ["FunctionSideEffectSummary"],
      properties: {},
    },

    // =========================================================================
    // Design Pattern Detection Relationships (Phase 4)
    // =========================================================================

    /**
     * HAS_PATTERN - Entity participates in a design pattern
     */
    HAS_PATTERN: {
      from: ["Class", "Function", "Interface"],
      to: ["DesignPattern"],
      properties: {
        role: { type: "STRING" }, // Role this entity plays in the pattern
      },
    },

    /**
     * PATTERN_HAS_PARTICIPANT - Design pattern has participating entity
     */
    PATTERN_HAS_PARTICIPANT: {
      from: ["DesignPattern"],
      to: ["PatternParticipant"],
      properties: {},
    },

    /**
     * PARTICIPANT_ENTITY - Pattern participant references an entity
     */
    PARTICIPANT_ENTITY: {
      from: ["PatternParticipant"],
      to: ["Class", "Function", "Interface", "Variable"],
      properties: {},
    },
  },
} as const;

// =============================================================================
// Type Exports
// =============================================================================

/**
 * Type representing the complete schema
 */
export type Schema = typeof SCHEMA;

/**
 * Type representing all node names
 */
export type NodeName = keyof typeof SCHEMA.nodes;

/**
 * Type representing all relationship names
 */
export type RelationshipName = keyof typeof SCHEMA.relationships;

/**
 * Get the property names for a node type
 */
export type NodeProperties<N extends NodeName> = keyof (typeof SCHEMA.nodes)[N];

/**
 * Get the property names for a relationship type
 */
export type RelationshipProperties<R extends RelationshipName> =
  keyof (typeof SCHEMA.relationships)[R]["properties"];

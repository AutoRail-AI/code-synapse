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
export const SCHEMA_VERSION = 4;

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

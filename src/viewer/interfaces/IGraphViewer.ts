/**
 * IGraphViewer - Read-Only Interface for Observing Indexed Data
 *
 * This interface provides ONLY read operations for viewing what has been indexed.
 * It CANNOT modify the graph in any way. Implementation wraps IGraphStore.query().
 *
 * Design Principles:
 * - Black-box boundary: Core implementation details are hidden
 * - Read-only: No write operations are exposed or possible
 * - Replaceable: Any implementation can be swapped without affecting core
 *
 * @module
 */

// =============================================================================
// Data Types
// =============================================================================

/**
 * Overview statistics for the entire index
 */
export interface OverviewStats {
  /** Total number of indexed files */
  totalFiles: number;
  /** Total number of indexed functions */
  totalFunctions: number;
  /** Total number of indexed classes */
  totalClasses: number;
  /** Total number of indexed interfaces */
  totalInterfaces: number;
  /** Total number of indexed type aliases */
  totalTypeAliases: number;
  /** Total number of indexed variables */
  totalVariables: number;
  /** Total number of relationships */
  totalRelationships: number;
  /** Percentage of functions with embeddings (0-1) */
  embeddingCoverage: number;
  /** Total size of all indexed files in bytes */
  totalSizeBytes: number;
  /** Languages detected in the codebase */
  languages: string[];
  /** Business justification coverage percentage (0-100) */
  justificationCoverage: number;
  /** Number of entities with justifications */
  justifiedEntities: number;
}

/**
 * Counts of each entity type
 */
export interface EntityCounts {
  files: number;
  functions: number;
  classes: number;
  interfaces: number;
  typeAliases: number;
  variables: number;
  ghostNodes: number;
}

/**
 * Counts of each relationship type
 */
export interface RelationshipCounts {
  contains: number;
  calls: number;
  imports: number;
  extends: number;
  implements: number;
  hasMethod: number;
  usesType: number;
  referencesExternal: number;
}

/**
 * Language distribution in the codebase
 */
export interface LanguageDistribution {
  language: string;
  fileCount: number;
  totalSize: number;
  percentage: number;
}

/**
 * File information for browsing
 */
export interface FileInfo {
  id: string;
  path: string;
  relativePath: string;
  language: string;
  framework?: string;
  size: number;
  entityCount: number;
  lastModified: Date;
}

/**
 * Function information for browsing
 */
export interface FunctionInfo {
  id: string;
  name: string;
  fileId: string;
  filePath: string;
  signature: string;
  startLine: number;
  endLine: number;
  complexity: number;
  isExported: boolean;
  isAsync: boolean;
  isGenerator: boolean;
  docComment?: string;
  callCount: number;
  hasEmbedding: boolean;
}

/**
 * Class information for browsing
 */
export interface ClassInfo {
  id: string;
  name: string;
  fileId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  isAbstract: boolean;
  extendsClass?: string;
  implementsInterfaces: string[];
  methodCount: number;
  docComment?: string;
}

/**
 * Interface information for browsing
 */
export interface InterfaceInfo {
  id: string;
  name: string;
  fileId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  extendsInterfaces: string[];
  propertyCount: number;
  docComment?: string;
}

/**
 * Call graph node for visualization
 */
export interface CallGraphNode {
  id: string;
  name: string;
  signature: string;
  filePath: string;
  depth: number;
  callees: CallGraphNode[];
  callers: CallGraphNode[];
}

/**
 * Import graph node for visualization
 */
export interface ImportGraphNode {
  id: string;
  path: string;
  relativePath: string;
  depth: number;
  imports: ImportGraphNode[];
  importedBy: ImportGraphNode[];
}

/**
 * Inheritance tree node for visualization
 */
export interface InheritanceNode {
  id: string;
  name: string;
  filePath: string;
  isAbstract: boolean;
  children: InheritanceNode[];
  parent?: InheritanceNode;
}

/**
 * Search result
 */
export interface SearchResult {
  entityType: "file" | "function" | "class" | "interface" | "variable";
  id: string;
  name: string;
  filePath: string;
  line?: number;
  matchScore: number;
  snippet?: string;
}

/**
 * Similarity search result
 */
export interface SimilarityResult {
  id: string;
  name: string;
  filePath: string;
  signature: string;
  distance: number;
  similarity: number; // 1 - normalized distance
}

/**
 * Complexity distribution bucket
 */
export interface ComplexityBucket {
  /** Lower bound of the bucket (inclusive) */
  min: number;
  /** Upper bound of the bucket (exclusive) */
  max: number;
  /** Number of functions in this bucket */
  count: number;
  /** Percentage of total functions */
  percentage: number;
}

/**
 * Complexity distribution analysis
 */
export interface ComplexityDistribution {
  /** Buckets of complexity ranges */
  buckets: ComplexityBucket[];
  /** Average complexity across all functions */
  average: number;
  /** Maximum complexity found */
  maximum: number;
  /** Number of high-complexity functions (>10) */
  highComplexityCount: number;
}

/**
 * External dependency information
 */
export interface ExternalDependency {
  packageName: string;
  referenceCount: number;
  usedBy: Array<{
    entityType: "function" | "class" | "interface";
    entityName: string;
    filePath: string;
  }>;
}

/**
 * Health issue in the index
 */
export interface HealthIssue {
  type: "warning" | "error" | "info";
  code: string;
  message: string;
  affectedEntities?: string[];
  suggestion?: string;
}

/**
 * Index health status
 */
export interface IndexHealth {
  isHealthy: boolean;
  status: "healthy" | "degraded" | "unhealthy";
  coverage: {
    filesIndexed: number;
    filesTotal: number;
    percentage: number;
  };
  embeddings: {
    functionsWithEmbeddings: number;
    functionsTotal: number;
    percentage: number;
  };
  relationships: {
    resolvedCalls: number;
    unresolvedCalls: number;
    percentage: number;
  };
  issues: HealthIssue[];
  lastChecked: Date;
}

// =============================================================================
// Justification Types
// =============================================================================

/**
 * Business justification statistics
 */
export interface JustificationStats {
  /** Total entities that can be justified */
  totalEntities: number;
  /** Number of entities with justifications */
  justifiedEntities: number;
  /** High confidence (>= 0.8) justifications */
  highConfidence: number;
  /** Medium confidence (0.5-0.8) justifications */
  mediumConfidence: number;
  /** Low confidence (< 0.5) justifications */
  lowConfidence: number;
  /** Entities pending user clarification */
  pendingClarification: number;
  /** User-confirmed justifications */
  userConfirmed: number;
  /** Overall coverage percentage */
  coveragePercentage: number;
}

/**
 * Business justification for a code entity
 */
export interface JustificationInfo {
  /** Justification ID */
  id: string;
  /** Entity this justifies */
  entityId: string;
  /** Entity type (function, class, etc.) */
  entityType: string;
  /** Entity name */
  name: string;
  /** File path */
  filePath: string;
  /** One-line purpose summary */
  purposeSummary: string;
  /** Business value explanation */
  businessValue: string;
  /** Feature/domain context */
  featureContext: string;
  /** Detailed description */
  detailedDescription: string;
  /** Categorization tags */
  tags: string[];
  /** How this was inferred */
  inferredFrom: string;
  /** Confidence score (0-1) */
  confidenceScore: number;
  /** Confidence level (high/medium/low/uncertain) */
  confidenceLevel: string;
  /** Whether clarification is needed */
  clarificationPending: boolean;
  /** When created */
  createdAt: Date;
  /** When last updated */
  updatedAt: Date;
  /** Classification category (unified) */
  category?: "domain" | "infrastructure" | "test" | "config" | "unknown";
  /** Domain/Layer name */
  domain?: string;
  /** Architectural pattern detected */
  architecturalPattern?: string;
}

/**
 * Feature area grouping of justifications
 */
export interface FeatureAreaSummary {
  /** Feature area name */
  featureArea: string;
  /** Number of entities in this feature */
  entityCount: number;
  /** Average confidence for this feature */
  avgConfidence: number;
  /** Tags used in this feature */
  tags: string[];
}

/**
 * Options for listing entities
 */
export interface ListOptions {
  /** Maximum number of results */
  limit?: number;
  /** Number of results to skip */
  offset?: number;
  /** Field to order by */
  orderBy?: string;
  /** Order direction */
  orderDirection?: "asc" | "desc";
  /** Filter criteria */
  filter?: Record<string, unknown>;
}

/**
 * Entity type for filtering
 */
export type EntityType = "file" | "function" | "class" | "interface" | "variable" | "all";

// =============================================================================
// Main Interface
// =============================================================================

/**
 * IGraphViewer - Read-only interface for observing indexed data
 *
 * This interface is designed to be a black-box boundary between the viewer
 * layer and the core graph storage. It only exposes read operations.
 *
 * @example
 * ```typescript
 * // Create viewer from existing graph store
 * const viewer = createGraphViewer(graphStore);
 *
 * // Get overview statistics
 * const stats = await viewer.getOverviewStats();
 * console.log(`Indexed ${stats.totalFiles} files with ${stats.totalFunctions} functions`);
 *
 * // Browse functions
 * const functions = await viewer.listFunctions({ limit: 20, orderBy: 'complexity' });
 *
 * // Search
 * const results = await viewer.searchByName('authenticate', 'function');
 *
 * // Visualize call graph
 * const callGraph = await viewer.getCallGraph('auth::login', 2);
 * ```
 */
export interface IGraphViewer {
  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get overview statistics for the entire index
   */
  getOverviewStats(): Promise<OverviewStats>;

  /**
   * Get counts of each entity type
   */
  getEntityCounts(): Promise<EntityCounts>;

  /**
   * Get counts of each relationship type
   */
  getRelationshipCounts(): Promise<RelationshipCounts>;

  /**
   * Get language distribution in the codebase
   */
  getLanguageDistribution(): Promise<LanguageDistribution[]>;

  // ===========================================================================
  // Entity Browsing
  // ===========================================================================

  /**
   * List indexed files
   */
  listFiles(options?: ListOptions): Promise<FileInfo[]>;

  /**
   * Get a specific file by ID
   */
  getFile(id: string): Promise<FileInfo | null>;

  /**
   * List indexed functions
   */
  listFunctions(options?: ListOptions): Promise<FunctionInfo[]>;

  /**
   * Get a specific function by ID
   */
  getFunction(id: string): Promise<FunctionInfo | null>;

  /**
   * List functions in a specific file
   */
  getFunctionsByFile(fileId: string): Promise<FunctionInfo[]>;

  /**
   * List indexed classes
   */
  listClasses(options?: ListOptions): Promise<ClassInfo[]>;

  /**
   * Get a specific class by ID
   */
  getClass(id: string): Promise<ClassInfo | null>;

  /**
   * List indexed interfaces
   */
  listInterfaces(options?: ListOptions): Promise<InterfaceInfo[]>;

  /**
   * Get a specific interface by ID
   */
  getInterface(id: string): Promise<InterfaceInfo | null>;

  // ===========================================================================
  // Relationship Browsing
  // ===========================================================================

  /**
   * Get the call graph for a function
   * @param functionId - Function ID to start from
   * @param depth - Maximum depth to traverse (default: 2)
   */
  getCallGraph(functionId: string, depth?: number): Promise<CallGraphNode>;

  /**
   * Get functions that call a specific function
   * @param functionId - Target function ID
   */
  getCallers(functionId: string): Promise<FunctionInfo[]>;

  /**
   * Get functions called by a specific function
   * @param functionId - Source function ID
   */
  getCallees(functionId: string): Promise<FunctionInfo[]>;

  /**
   * Get the import graph for a file
   * @param fileId - File ID to start from
   * @param depth - Maximum depth to traverse (default: 2)
   */
  getImportGraph(fileId: string, depth?: number): Promise<ImportGraphNode>;

  /**
   * Get files that import a specific file
   * @param fileId - Target file ID
   */
  getImporters(fileId: string): Promise<FileInfo[]>;

  /**
   * Get files imported by a specific file
   * @param fileId - Source file ID
   */
  getImports(fileId: string): Promise<FileInfo[]>;

  /**
   * Get the inheritance tree for a class
   * @param classId - Class ID to start from
   */
  getInheritanceTree(classId: string): Promise<InheritanceNode>;

  // ===========================================================================
  // Search
  // ===========================================================================

  /**
   * Search entities by name pattern
   * @param pattern - Search pattern (supports partial matching)
   * @param entityType - Type of entity to search (default: 'all')
   */
  searchByName(pattern: string, entityType?: EntityType): Promise<SearchResult[]>;

  /**
   * Search functions by semantic similarity
   * @param embedding - Query vector (384 dimensions for all-MiniLM-L6-v2)
   * @param k - Number of results (default: 10)
   */
  searchBySimilarity(embedding: number[], k?: number): Promise<SimilarityResult[]>;

  /**
   * Natural language search (combines keyword and semantic search)
   * @param query - Natural language query
   * @param options - Search options
   */
  searchNatural(
    query: string,
    options?: {
      entityType?: EntityType;
      limit?: number;
      useEmbeddings?: boolean;
    }
  ): Promise<SearchResult[]>;

  // ===========================================================================
  // Analysis
  // ===========================================================================

  /**
   * Get complexity distribution across functions
   */
  getComplexityDistribution(): Promise<ComplexityDistribution>;

  /**
   * Get the most called functions
   * @param limit - Maximum results (default: 20)
   */
  getMostCalledFunctions(limit?: number): Promise<FunctionInfo[]>;

  /**
   * Get functions with highest complexity
   * @param limit - Maximum results (default: 20)
   */
  getMostComplexFunctions(limit?: number): Promise<FunctionInfo[]>;

  /**
   * Get external dependencies and their usage
   */
  getExternalDependencies(): Promise<ExternalDependency[]>;

  // ===========================================================================
  // Graph Structure (New)
  // ===========================================================================

  /**
   * Get the raw graph structure (nodes and edges)
   * Designed for efficient bulk retrieval for visualization
   */
  getGraphStructure(options?: {
    centerNodeId?: string;
    depth?: number;
    nodeKinds?: string[];
    edgeKinds?: string[];
    limit?: number;
  }): Promise<{
    nodes: Array<{
      id: string;
      label: string;
      kind: string;
      properties?: Record<string, any>;
    }>;
    edges: Array<{
      source: string;
      target: string;
      kind: string;
      weight?: number;
    }>;
  }>;

  // ===========================================================================
  // Health
  // ===========================================================================

  /**
   * Get the health status of the index
   */
  getIndexHealth(): Promise<IndexHealth>;

  // ===========================================================================
  // Business Justifications
  // ===========================================================================

  /**
   * Get business justification statistics
   */
  getJustificationStats(): Promise<JustificationStats>;

  /**
   * Get justification for a specific entity
   * @param entityId - The entity ID
   */
  getJustification(entityId: string): Promise<JustificationInfo | null>;

  /**
   * List all justifications with pagination
   * @param options - List options
   */
  listJustifications(options?: ListOptions): Promise<JustificationInfo[]>;

  /**
   * Search justifications by text (purpose, business value, feature)
   * @param query - Search text
   * @param limit - Maximum results
   */
  searchJustifications(query: string, limit?: number): Promise<JustificationInfo[]>;

  /**
   * Get feature area summary (grouping of justifications by feature)
   */
  getFeatureAreas(): Promise<FeatureAreaSummary[]>;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Whether the viewer is initialized and ready
   */
  readonly isReady: boolean;

  /**
   * Initialize the viewer (connects to underlying store)
   */
  initialize(): Promise<void>;

  /**
   * Close the viewer (releases resources)
   */
  close(): Promise<void>;
}

// =============================================================================
// Factory Types
// =============================================================================

/**
 * Configuration for creating a graph viewer
 */
export interface GraphViewerConfig {
  /** Path to the graph database */
  databasePath: string;
  /** Whether to validate read-only constraints (default: true) */
  strictReadOnly?: boolean;
}

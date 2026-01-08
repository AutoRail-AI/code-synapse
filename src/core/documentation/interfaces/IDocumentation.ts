/**
 * Documentation Graph Interfaces
 *
 * Interfaces for linking infrastructure code to official documentation,
 * SDK references, and version-specific resources.
 */

import type {
  DocumentationReference,
  EntityDocumentationLink,
  EntityDocumentation,
  DocumentationStats,
  DocumentationType,
  DocumentationSource,
} from "../models/documentation-models.js";

// =============================================================================
// Documentation Storage Interface
// =============================================================================

/**
 * Storage interface for documentation references and links
 */
export interface IDocumentationStorage {
  // -------------------------------------------------------------------------
  // Documentation References
  // -------------------------------------------------------------------------

  /**
   * Store a documentation reference
   */
  storeReference(reference: DocumentationReference): Promise<void>;

  /**
   * Store multiple documentation references
   */
  storeReferences(references: DocumentationReference[]): Promise<void>;

  /**
   * Get a documentation reference by ID
   */
  getReference(id: string): Promise<DocumentationReference | null>;

  /**
   * Get all documentation references for a package
   */
  getReferencesByPackage(packageName: string): Promise<DocumentationReference[]>;

  /**
   * Get documentation references by type
   */
  getReferencesByType(type: DocumentationType): Promise<DocumentationReference[]>;

  /**
   * Search documentation references
   */
  searchReferences(query: string, limit?: number): Promise<DocumentationReference[]>;

  /**
   * Delete a documentation reference
   */
  deleteReference(id: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Entity-Documentation Links
  // -------------------------------------------------------------------------

  /**
   * Create a link between an entity and documentation
   */
  createLink(link: EntityDocumentationLink): Promise<void>;

  /**
   * Create multiple links
   */
  createLinks(links: EntityDocumentationLink[]): Promise<void>;

  /**
   * Get all documentation links for an entity
   */
  getLinksForEntity(entityId: string): Promise<EntityDocumentationLink[]>;

  /**
   * Get all entity links for a documentation reference
   */
  getLinksForDocumentation(documentationId: string): Promise<EntityDocumentationLink[]>;

  /**
   * Delete a link
   */
  deleteLink(id: string): Promise<void>;

  /**
   * Delete all links for an entity
   */
  deleteLinksForEntity(entityId: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  /**
   * Get documentation statistics
   */
  getStats(): Promise<DocumentationStats>;
}

// =============================================================================
// Documentation Service Interface
// =============================================================================

/**
 * Service for managing documentation references and entity links
 */
export interface IDocumentationService {
  /**
   * Initialize the service
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the service
   */
  shutdown(): Promise<void>;

  // -------------------------------------------------------------------------
  // Auto-Discovery
  // -------------------------------------------------------------------------

  /**
   * Scan an entity and auto-discover documentation links
   * Analyzes imports, types used, and API calls
   */
  discoverDocumentation(entityId: string): Promise<EntityDocumentation>;

  /**
   * Scan all entities in a file for documentation
   */
  discoverDocumentationForFile(filePath: string): Promise<EntityDocumentation[]>;

  /**
   * Scan entire project for documentation links
   */
  discoverAllDocumentation(): Promise<{
    entitiesProcessed: number;
    linksCreated: number;
    referencesCreated: number;
  }>;

  // -------------------------------------------------------------------------
  // Package Documentation
  // -------------------------------------------------------------------------

  /**
   * Get or fetch documentation for a package
   * Uses known registry first, then infers from npm/pypi
   */
  getPackageDocumentation(packageName: string, version?: string): Promise<DocumentationReference[]>;

  /**
   * Fetch documentation URLs from npm registry
   */
  fetchFromNpm(packageName: string): Promise<DocumentationReference[]>;

  /**
   * Register a custom documentation reference
   */
  registerDocumentation(
    packageName: string,
    type: DocumentationType,
    url: string,
    title: string,
    description?: string
  ): Promise<DocumentationReference>;

  // -------------------------------------------------------------------------
  // Entity Queries
  // -------------------------------------------------------------------------

  /**
   * Get all documentation for an entity
   */
  getDocumentationForEntity(entityId: string): Promise<EntityDocumentation>;

  /**
   * Get entities that use a specific package
   */
  getEntitiesUsingPackage(packageName: string): Promise<
    Array<{
      entityId: string;
      entityName: string;
      entityType: string;
      filePath: string;
      usageType: "import" | "type" | "api-call";
    }>
  >;

  /**
   * Find entities without documentation
   */
  getEntitiesWithoutDocumentation(
    limit?: number
  ): Promise<Array<{ entityId: string; entityName: string; entityType: string; filePath: string }>>;

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  /**
   * Get documentation coverage statistics
   */
  getStats(): Promise<DocumentationStats>;

  /**
   * Get documentation coverage for a file
   */
  getFileDocumentationCoverage(filePath: string): Promise<{
    totalEntities: number;
    entitiesWithDocs: number;
    coveragePercent: number;
    packages: string[];
  }>;
}

// =============================================================================
// Documentation Enricher Interface
// =============================================================================

/**
 * Enriches documentation references with additional data
 */
export interface IDocumentationEnricher {
  /**
   * Enrich a reference with metadata from npm
   */
  enrichFromNpm(reference: DocumentationReference): Promise<DocumentationReference>;

  /**
   * Verify that a documentation URL is still valid
   */
  verifyUrl(url: string): Promise<{
    valid: boolean;
    statusCode?: number;
    redirectUrl?: string;
  }>;

  /**
   * Extract documentation URLs from a package's README
   */
  extractUrlsFromReadme(packageName: string): Promise<
    Array<{
      url: string;
      context: string;
      type: DocumentationType;
    }>
  >;
}

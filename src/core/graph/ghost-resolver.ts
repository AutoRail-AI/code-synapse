/**
 * Ghost Node Resolver
 *
 * Creates lightweight "Ghost" nodes for external dependencies from node_modules.
 * These nodes capture type signatures without storing full implementation details,
 * allowing the knowledge graph to understand external dependencies.
 *
 * @module
 */

import type { GraphDatabase, Transaction } from "./database.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Entity type for ghost nodes
 */
export type GhostEntityType = "function" | "class" | "interface" | "type" | "variable";

/**
 * Ghost node representing an external dependency
 */
export interface GhostEntity {
  /** Unique identifier for the ghost node */
  id: string;
  /** Name of the external symbol */
  name: string;
  /** Package name (e.g., "react", "@types/node") */
  packageName: string;
  /** Type of entity */
  entityType: GhostEntityType;
  /** Type signature (for functions/classes) */
  signature?: string;
  /** Always true for ghost nodes */
  isExternal: true;
}

/**
 * Reference from internal code to external dependency
 */
export interface ExternalReference {
  /** ID of the internal entity making the reference */
  fromId: string;
  /** ID of the ghost node being referenced */
  toId: string;
  /** Context of the reference */
  context: "import" | "extends" | "implements" | "call" | "type";
  /** Line number where reference occurs */
  lineNumber: number;
}

/**
 * Options for ghost resolution
 */
export interface GhostResolverOptions {
  /** Whether to resolve type definitions from @types packages */
  resolveTypes?: boolean;
  /** Cache resolved signatures */
  useCache?: boolean;
  /** Maximum number of cached entries */
  maxCacheSize?: number;
}

// =============================================================================
// Ghost Node Resolver Class
// =============================================================================

/**
 * Resolves external dependencies and creates ghost nodes.
 *
 * Ghost nodes are lightweight representations of external symbols that allow
 * the knowledge graph to track dependencies without indexing all of node_modules.
 *
 * @example
 * ```typescript
 * const resolver = new GhostResolver(db);
 *
 * // When encountering an external import
 * const ghost = await resolver.resolveExternalSymbol(
 *   '@types/react',
 *   'Component',
 *   'class'
 * );
 *
 * // Create reference from internal class to external
 * await resolver.createReference({
 *   fromId: 'class:MyComponent',
 *   toId: ghost.id,
 *   context: 'extends',
 *   lineNumber: 5
 * });
 * ```
 */
export class GhostResolver {
  private db: GraphDatabase;
  private cache: Map<string, GhostEntity>;
  private options: Required<GhostResolverOptions>;

  constructor(db: GraphDatabase, options: GhostResolverOptions = {}) {
    this.db = db;
    this.cache = new Map();
    this.options = {
      resolveTypes: options.resolveTypes ?? true,
      useCache: options.useCache ?? true,
      maxCacheSize: options.maxCacheSize ?? 10000,
    };
  }

  // ===========================================================================
  // Ghost Node Operations
  // ===========================================================================

  /**
   * Resolves an external symbol and creates a ghost node if needed.
   *
   * @param packageName - The package containing the symbol
   * @param symbolName - Name of the exported symbol
   * @param entityType - Type of the entity
   * @param signature - Optional type signature
   */
  async resolveExternalSymbol(
    packageName: string,
    symbolName: string,
    entityType: GhostEntityType,
    signature?: string,
    tx?: Transaction
  ): Promise<GhostEntity> {
    const id = this.generateGhostId(packageName, symbolName);

    // Check cache first
    if (this.options.useCache && this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    // Check if already exists in database
    const existing = await this.getGhostNode(id);
    if (existing) {
      if (this.options.useCache) {
        this.addToCache(id, existing);
      }
      return existing;
    }

    // Create new ghost node
    const ghost: GhostEntity = {
      id,
      name: symbolName,
      packageName,
      entityType,
      signature,
      isExternal: true,
    };

    await this.createGhostNode(ghost, tx);

    if (this.options.useCache) {
      this.addToCache(id, ghost);
    }

    return ghost;
  }

  /**
   * Creates a ghost node in the database.
   */
  async createGhostNode(ghost: GhostEntity, tx?: Transaction): Promise<void> {
    const script = `
      ?[id, name, package_name, entity_type, signature, is_external] <- [[
        $id, $name, $packageName, $entityType, $signature, $isExternal
      ]]
      :put ghostnode {id => name, package_name, entity_type, signature, is_external}
    `;

    await this.db.execute(
      script,
      {
        id: ghost.id,
        name: ghost.name,
        packageName: ghost.packageName,
        entityType: ghost.entityType,
        signature: ghost.signature ?? null,
        isExternal: ghost.isExternal,
      },
      tx
    );
  }

  /**
   * Gets a ghost node by ID.
   */
  async getGhostNode(id: string): Promise<GhostEntity | null> {
    const results = await this.db.query<{
      id: string;
      name: string;
      package_name: string;
      entity_type: GhostEntityType;
      signature: string | null;
      is_external: boolean;
    }>(
      `?[id, name, package_name, entity_type, signature, is_external] :=
        *ghostnode{id, name, package_name, entity_type, signature, is_external},
        id = $id`,
      { id }
    );

    if (results.length === 0) return null;

    const r = results[0]!;
    return {
      id: r.id,
      name: r.name,
      packageName: r.package_name,
      entityType: r.entity_type,
      signature: r.signature ?? undefined,
      isExternal: true,
    };
  }

  /**
   * Gets all ghost nodes for a package.
   */
  async getGhostNodesByPackage(packageName: string): Promise<GhostEntity[]> {
    const results = await this.db.query<{
      id: string;
      name: string;
      package_name: string;
      entity_type: GhostEntityType;
      signature: string | null;
    }>(
      `?[id, name, package_name, entity_type, signature] :=
        *ghostnode{id, name, package_name, entity_type, signature},
        package_name = $packageName`,
      { packageName }
    );

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      packageName: r.package_name,
      entityType: r.entity_type,
      signature: r.signature ?? undefined,
      isExternal: true as const,
    }));
  }

  // ===========================================================================
  // Reference Operations
  // ===========================================================================

  /**
   * Creates a reference from an internal entity to an external dependency.
   */
  async createReference(ref: ExternalReference, tx?: Transaction): Promise<void> {
    const script = `
      ?[from_id, to_id, context, line_number] <- [[
        $fromId, $toId, $context, $lineNumber
      ]]
      :put references_external {from_id, to_id => context, line_number}
    `;

    await this.db.execute(
      script,
      {
        fromId: ref.fromId,
        toId: ref.toId,
        context: ref.context,
        lineNumber: ref.lineNumber,
      },
      tx
    );
  }

  /**
   * Gets all external references from an internal entity.
   */
  async getExternalReferences(fromId: string): Promise<Array<ExternalReference & { ghost: GhostEntity }>> {
    const results = await this.db.query<{
      from_id: string;
      to_id: string;
      context: ExternalReference["context"];
      line_number: number;
      name: string;
      package_name: string;
      entity_type: GhostEntityType;
      signature: string | null;
    }>(
      `?[from_id, to_id, context, line_number, name, package_name, entity_type, signature] :=
        *references_external{from_id, to_id, context, line_number},
        from_id = $fromId,
        *ghostnode{id: to_id, name, package_name, entity_type, signature}`,
      { fromId }
    );

    return results.map((r) => ({
      fromId: r.from_id,
      toId: r.to_id,
      context: r.context,
      lineNumber: r.line_number,
      ghost: {
        id: r.to_id,
        name: r.name,
        packageName: r.package_name,
        entityType: r.entity_type,
        signature: r.signature ?? undefined,
        isExternal: true as const,
      },
    }));
  }

  /**
   * Gets all internal entities that reference a specific external dependency.
   */
  async getReferencesToExternal(ghostId: string): Promise<ExternalReference[]> {
    const results = await this.db.query<{
      from_id: string;
      to_id: string;
      context: ExternalReference["context"];
      line_number: number;
    }>(
      `?[from_id, to_id, context, line_number] :=
        *references_external{from_id, to_id, context, line_number},
        to_id = $ghostId`,
      { ghostId }
    );

    return results.map((r) => ({
      fromId: r.from_id,
      toId: r.to_id,
      context: r.context,
      lineNumber: r.line_number,
    }));
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Checks if a path is external (inside node_modules).
   */
  isExternalPath(filePath: string): boolean {
    return filePath.includes("node_modules");
  }

  /**
   * Extracts package name from a node_modules path.
   */
  extractPackageName(modulePath: string): string {
    const nodeModulesIndex = modulePath.lastIndexOf("node_modules");
    if (nodeModulesIndex === -1) return modulePath;

    const afterNodeModules = modulePath.slice(nodeModulesIndex + "node_modules/".length);
    const parts = afterNodeModules.split("/");

    // Handle scoped packages (@org/package)
    if (parts[0]?.startsWith("@") && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }

    return parts[0] ?? modulePath;
  }

  /**
   * Generates a unique ID for a ghost node.
   */
  private generateGhostId(packageName: string, symbolName: string): string {
    return `ghost:${packageName}:${symbolName}`;
  }

  /**
   * Adds an entry to the cache with size management.
   */
  private addToCache(id: string, ghost: GhostEntity): void {
    // Evict oldest entries if cache is full
    if (this.cache.size >= this.options.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(id, ghost);
  }

  /**
   * Clears the ghost node cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Gets cache statistics.
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.options.maxCacheSize,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a GhostResolver instance.
 */
export function createGhostResolver(
  db: GraphDatabase,
  options?: GhostResolverOptions
): GhostResolver {
  return new GhostResolver(db, options);
}

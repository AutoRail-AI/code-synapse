/**
 * Context Propagator
 *
 * Handles propagation of business justifications through the entity hierarchy.
 * Implements both top-down (parent to children) and bottom-up (children to parent)
 * context propagation.
 *
 * @module
 */

import type {
  EntityJustification,
  JustifiableEntityType,
  JustificationContext,
  EntityForJustification,
  ParentContext,
  ChildContext,
  SiblingContext,
  CallerContext,
  CalleeContext,
  DependencyContext,
  ProjectContext,
} from "../models/justification.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Entity hierarchy node for traversal
 */
export interface HierarchyNode {
  entityId: string;
  entityType: JustifiableEntityType;
  name: string;
  filePath: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
}

/**
 * Graph store interface (minimal subset needed)
 */
export interface IGraphStoreForPropagation {
  query<T>(query: string, params?: Record<string, unknown>): Promise<{ rows: T[] }>;
}

// =============================================================================
// Context Propagator Class
// =============================================================================

/**
 * Propagates justification context through the entity hierarchy.
 *
 * Strategy:
 * 1. Build hierarchy tree (file → class → method)
 * 2. Process bottom-up for initial inference
 * 3. Propagate top-down to enrich children with parent context
 * 4. Re-aggregate bottom-up with enriched context
 */
export class ContextPropagator {
  // Performance optimization: Cache file hierarchies to avoid repeated rebuilds
  private hierarchyCache: Map<string, HierarchyNode[]> = new Map();

  // Cache file paths to avoid repeated lookups
  private filePathCache: Map<string, string> = new Map();

  // Cache project context (rarely changes)
  private projectContextCache: ProjectContext | null = null;

  constructor(private graphStore: IGraphStoreForPropagation) {}

  /**
   * Clear all caches (useful for testing or after major index updates)
   */
  clearCaches(): void {
    this.hierarchyCache.clear();
    this.filePathCache.clear();
    this.projectContextCache = null;
  }

  /**
   * Clear hierarchy cache for specific file (for incremental updates)
   */
  invalidateFileHierarchy(filePath: string): void {
    this.hierarchyCache.delete(filePath);
  }

  // ===========================================================================
  // Hierarchy Building
  // ===========================================================================

  /**
   * Build the entity hierarchy for a file (with caching)
   */
  async buildFileHierarchy(filePath: string): Promise<HierarchyNode[]> {
    // Check cache first
    const cached = this.hierarchyCache.get(filePath);
    if (cached) {
      return cached;
    }

    const nodes = await this._buildFileHierarchyUncached(filePath);

    // Cache the result
    this.hierarchyCache.set(filePath, nodes);

    return nodes;
  }

  /**
   * Internal method to build hierarchy without cache
   */
  private async _buildFileHierarchyUncached(filePath: string): Promise<HierarchyNode[]> {
    const nodes: HierarchyNode[] = [];

    // Get file node
    const fileResult = await this.graphStore.query<{
      id: string;
      relativePath: string;
    }>(
      `?[id, relative_path] := *file{id, relative_path}, relative_path = $path`,
      { path: filePath }
    );

    if (fileResult.rows.length === 0) {
      return nodes;
    }

    const fileRow = fileResult.rows[0];
    if (!fileRow) return nodes;
    const fileId = fileRow.id;

    // File is root (depth 0)
    nodes.push({
      entityId: fileId,
      entityType: "file",
      name: filePath.split("/").pop() || filePath,
      filePath,
      parentId: null,
      childIds: [],
      depth: 0,
    });

    // Get classes in file (depth 1)
    const classResult = await this.graphStore.query<{
      id: string;
      name: string;
    }>(
      `?[id, name] := *class{id, name, file_id}, file_id = $fileId`,
      { fileId }
    );

    for (const cls of classResult.rows) {
      nodes.push({
        entityId: cls.id,
        entityType: "class",
        name: cls.name,
        filePath,
        parentId: fileId,
        childIds: [],
        depth: 1,
      });
      const fileNode = nodes[0];
      if (fileNode) fileNode.childIds.push(cls.id);

      // Get methods of class (depth 2)
      const methodResult = await this.graphStore.query<{
        functionId: string;
        name: string;
      }>(
        `?[functionId, name] := *has_method{from_id: $classId, to_id: functionId}, *function{id: functionId, name}`,
        { classId: cls.id }
      );

      const classNode = nodes.find((n) => n.entityId === cls.id);
      for (const method of methodResult.rows) {
        nodes.push({
          entityId: method.functionId,
          entityType: "method",
          name: method.name,
          filePath,
          parentId: cls.id,
          childIds: [],
          depth: 2,
        });
        classNode?.childIds.push(method.functionId);
      }
    }

    // Get interfaces in file (depth 1)
    const interfaceResult = await this.graphStore.query<{
      id: string;
      name: string;
    }>(
      `?[id, name] := *interface{id, name, file_id}, file_id = $fileId`,
      { fileId }
    );

    for (const iface of interfaceResult.rows) {
      nodes.push({
        entityId: iface.id,
        entityType: "interface",
        name: iface.name,
        filePath,
        parentId: fileId,
        childIds: [],
        depth: 1,
      });
      const rootNode = nodes[0];
      if (rootNode) rootNode.childIds.push(iface.id);
    }

    // Get standalone functions in file (depth 1)
    const functionResult = await this.graphStore.query<{
      id: string;
      name: string;
    }>(
      `?[id, name] :=
        *function{id, name, file_id},
        file_id = $fileId,
        not *has_method{to_id: id}`,
      { fileId }
    );

    for (const fn of functionResult.rows) {
      nodes.push({
        entityId: fn.id,
        entityType: "function",
        name: fn.name,
        filePath,
        parentId: fileId,
        childIds: [],
        depth: 1,
      });
      const rootNode2 = nodes[0];
      if (rootNode2) rootNode2.childIds.push(fn.id);
    }

    return nodes;
  }

  /**
   * Get traversal order for bottom-up processing
   * (deepest nodes first)
   */
  getBottomUpOrder(nodes: HierarchyNode[]): HierarchyNode[] {
    return [...nodes].sort((a, b) => b.depth - a.depth);
  }

  /**
   * Get traversal order for top-down processing
   * (root nodes first)
   */
  getTopDownOrder(nodes: HierarchyNode[]): HierarchyNode[] {
    return [...nodes].sort((a, b) => a.depth - b.depth);
  }

  // ===========================================================================
  // Context Building
  // ===========================================================================

  /**
   * Build full justification context for an entity
   */
  async buildContext(
    entityId: string,
    entityType: JustifiableEntityType,
    existingJustifications: Map<string, EntityJustification>
  ): Promise<JustificationContext> {
    const entity = await this.getEntityDetails(entityId, entityType);
    const parentContext = await this.getParentContext(entityId, entityType, existingJustifications);
    const siblings = await this.getSiblingContext(entityId, entityType, existingJustifications);
    const children = await this.getChildContext(entityId, entityType, existingJustifications);
    const dependencies = await this.getDependencyContext(entityId, entityType);
    const { callers, callees } = await this.getCallContext(entityId, entityType, existingJustifications);
    const projectContext = await this.getProjectContext();

    return {
      entity,
      parentContext,
      siblings,
      children,
      dependencies,
      callers,
      callees,
      projectContext,
    };
  }

  /**
   * Get entity details for justification
   */
  private async getEntityDetails(
    entityId: string,
    entityType: JustifiableEntityType
  ): Promise<EntityForJustification> {
    switch (entityType) {
      case "function":
      case "method": {
        const result = await this.graphStore.query<{
          id: string;
          name: string;
          file_id: string;
          start_line: number;
          end_line: number;
          signature: string;
          is_exported: boolean;
          is_async: boolean;
          doc_comment: string | null;
        }>(
          `?[id, name, file_id, start_line, end_line, signature, is_exported, is_async, doc_comment] :=
            *function{id, name, file_id, start_line, end_line, signature, is_exported, is_async, doc_comment},
            id = $entityId`,
          { entityId }
        );

        if (result.rows.length === 0) {
          throw new Error(`Function not found: ${entityId}`);
        }

        const fn = result.rows[0]!;
        const filePath = await this.getFilePath(fn.file_id);

        return {
          id: fn.id,
          type: entityType,
          name: fn.name,
          filePath,
          startLine: fn.start_line,
          endLine: fn.end_line,
          signature: fn.signature,
          codeSnippet: fn.signature, // Would need file read for full snippet
          docComment: fn.doc_comment || undefined,
          isExported: fn.is_exported,
          isAsync: fn.is_async,
        };
      }

      case "class": {
        const result = await this.graphStore.query<{
          id: string;
          name: string;
          file_id: string;
          start_line: number;
          end_line: number;
          is_exported: boolean;
          doc_comment: string | null;
        }>(
          `?[id, name, file_id, start_line, end_line, is_exported, doc_comment] :=
            *class{id, name, file_id, start_line, end_line, is_exported, doc_comment},
            id = $entityId`,
          { entityId }
        );

        if (result.rows.length === 0) {
          throw new Error(`Class not found: ${entityId}`);
        }

        const cls = result.rows[0]!;
        const filePath = await this.getFilePath(cls.file_id);

        return {
          id: cls.id,
          type: "class",
          name: cls.name,
          filePath,
          startLine: cls.start_line,
          endLine: cls.end_line,
          codeSnippet: `class ${cls.name}`,
          docComment: cls.doc_comment || undefined,
          isExported: cls.is_exported,
        };
      }

      case "interface": {
        const result = await this.graphStore.query<{
          id: string;
          name: string;
          file_id: string;
          start_line: number;
          end_line: number;
          is_exported: boolean;
          doc_comment: string | null;
        }>(
          `?[id, name, file_id, start_line, end_line, is_exported, doc_comment] :=
            *interface{id, name, file_id, start_line, end_line, is_exported, doc_comment},
            id = $entityId`,
          { entityId }
        );

        if (result.rows.length === 0) {
          throw new Error(`Interface not found: ${entityId}`);
        }

        const iface = result.rows[0]!;
        const filePath = await this.getFilePath(iface.file_id);

        return {
          id: iface.id,
          type: "interface",
          name: iface.name,
          filePath,
          startLine: iface.start_line,
          endLine: iface.end_line,
          codeSnippet: `interface ${iface.name}`,
          docComment: iface.doc_comment || undefined,
          isExported: iface.is_exported,
        };
      }

      case "file": {
        const result = await this.graphStore.query<{
          id: string;
          relative_path: string;
        }>(
          `?[id, relative_path] := *file{id, relative_path}, id = $entityId`,
          { entityId }
        );

        if (result.rows.length === 0) {
          throw new Error(`File not found: ${entityId}`);
        }

        const file = result.rows[0]!;

        return {
          id: file.id,
          type: "file",
          name: file.relative_path.split("/").pop() || file.relative_path,
          filePath: file.relative_path,
          startLine: 1,
          endLine: 1,
          codeSnippet: "",
          isExported: true,
        };
      }

      default:
        throw new Error(`Unsupported entity type: ${entityType}`);
    }
  }

  /**
   * Get file path from file ID (with caching)
   */
  private async getFilePath(fileId: string): Promise<string> {
    // Check cache first
    const cached = this.filePathCache.get(fileId);
    if (cached !== undefined) {
      return cached;
    }

    const result = await this.graphStore.query<{ relative_path: string }>(
      `?[relative_path] := *file{id, relative_path}, id = $fileId`,
      { fileId }
    );
    const filePath = result.rows[0]?.relative_path || "";

    // Cache the result
    this.filePathCache.set(fileId, filePath);

    return filePath;
  }

  /**
   * Get parent context
   */
  private async getParentContext(
    entityId: string,
    entityType: JustifiableEntityType,
    existingJustifications: Map<string, EntityJustification>
  ): Promise<ParentContext | undefined> {
    // Functions/methods might have class parent
    if (entityType === "function" || entityType === "method") {
      const result = await this.graphStore.query<{
        class_id: string;
        class_name: string;
      }>(
        `?[class_id, class_name] :=
          *has_method{from_id: class_id, to_id: $entityId},
          *class{id: class_id, name: class_name}`,
        { entityId }
      );

      if (result.rows.length > 0) {
        const parent = result.rows[0]!;
        return {
          id: parent.class_id,
          type: "class",
          name: parent.class_name,
          justification: existingJustifications.get(parent.class_id),
        };
      }
    }

    // Classes/interfaces/functions have file parent
    if (["class", "interface", "function"].includes(entityType)) {
      const tableMap: Record<string, string> = {
        class: "class",
        interface: "interface",
        function: "function",
      };
      const table = tableMap[entityType];

      const result = await this.graphStore.query<{
        file_id: string;
        file_path: string;
      }>(
        `?[file_id, file_path] :=
          *${table}{id: $entityId, file_id},
          *file{id: file_id, relative_path: file_path}`,
        { entityId }
      );

      if (result.rows.length > 0) {
        const parent = result.rows[0]!;
        return {
          id: parent.file_id,
          type: "file",
          name: parent.file_path.split("/").pop() || parent.file_path,
          justification: existingJustifications.get(parent.file_id),
        };
      }
    }

    return undefined;
  }

  /**
   * Get sibling context
   */
  private async getSiblingContext(
    entityId: string,
    entityType: JustifiableEntityType,
    existingJustifications: Map<string, EntityJustification>
  ): Promise<SiblingContext[]> {
    const siblings: SiblingContext[] = [];

    // Get siblings in same file
    if (entityType === "function" || entityType === "class" || entityType === "interface") {
      const tableMap: Record<string, string> = {
        function: "function",
        class: "class",
        interface: "interface",
      };
      const table = tableMap[entityType];

      const result = await this.graphStore.query<{
        id: string;
        name: string;
        file_id: string;
      }>(
        `?[id, name, file_id] :=
          *${table}{id: $entityId, file_id: my_file_id},
          *${table}{id, name, file_id},
          file_id = my_file_id,
          id != $entityId`,
        { entityId }
      );

      for (const row of result.rows.slice(0, 10)) {
        const justification = existingJustifications.get(row.id);
        siblings.push({
          id: row.id,
          type: entityType,
          name: row.name,
          purposeSummary: justification?.purposeSummary,
        });
      }
    }

    return siblings;
  }

  /**
   * Get child context
   */
  private async getChildContext(
    entityId: string,
    entityType: JustifiableEntityType,
    existingJustifications: Map<string, EntityJustification>
  ): Promise<ChildContext[]> {
    const children: ChildContext[] = [];

    if (entityType === "class") {
      // Get methods
      const result = await this.graphStore.query<{
        function_id: string;
        name: string;
      }>(
        `?[function_id, name] :=
          *has_method{from_id: $entityId, to_id: function_id},
          *function{id: function_id, name}`,
        { entityId }
      );

      for (const row of result.rows) {
        const justification = existingJustifications.get(row.function_id);
        children.push({
          id: row.function_id,
          type: "method",
          name: row.name,
          purposeSummary: justification?.purposeSummary,
          businessValue: justification?.businessValue,
        });
      }
    }

    if (entityType === "file") {
      // Get functions
      const fnResult = await this.graphStore.query<{
        id: string;
        name: string;
      }>(
        `?[id, name] :=
          *function{id, name, file_id},
          file_id = $entityId`,
        { entityId }
      );

      for (const row of fnResult.rows) {
        const justification = existingJustifications.get(row.id);
        children.push({
          id: row.id,
          type: "function",
          name: row.name,
          purposeSummary: justification?.purposeSummary,
          businessValue: justification?.businessValue,
        });
      }

      // Get classes
      const classResult = await this.graphStore.query<{
        id: string;
        name: string;
      }>(
        `?[id, name] :=
          *class{id, name, file_id},
          file_id = $entityId`,
        { entityId }
      );

      for (const row of classResult.rows) {
        const justification = existingJustifications.get(row.id);
        children.push({
          id: row.id,
          type: "class",
          name: row.name,
          purposeSummary: justification?.purposeSummary,
          businessValue: justification?.businessValue,
        });
      }
    }

    return children;
  }

  /**
   * Get dependency context
   */
  private async getDependencyContext(
    entityId: string,
    entityType: JustifiableEntityType
  ): Promise<DependencyContext[]> {
    const dependencies: DependencyContext[] = [];

    // Get file imports
    if (entityType === "file") {
      const result = await this.graphStore.query<{
        to_path: string;
        imported_symbols: string[];
      }>(
        `?[to_path, imported_symbols] :=
          *imports{from_id: $entityId, to_id: to_id, imported_symbols},
          *file{id: to_id, relative_path: to_path}`,
        { entityId }
      );

      for (const row of result.rows) {
        dependencies.push({
          modulePath: row.to_path,
          importedNames: row.imported_symbols || [],
          isExternal: row.to_path.includes("node_modules"),
        });
      }
    }

    return dependencies;
  }

  /**
   * Get call context (callers and callees)
   */
  private async getCallContext(
    entityId: string,
    entityType: JustifiableEntityType,
    existingJustifications: Map<string, EntityJustification>
  ): Promise<{ callers: CallerContext[]; callees: CalleeContext[] }> {
    const callers: CallerContext[] = [];
    const callees: CalleeContext[] = [];

    if (entityType === "function" || entityType === "method") {
      // Get callers
      const callerResult = await this.graphStore.query<{
        caller_id: string;
        caller_name: string;
        file_path: string;
      }>(
        `?[caller_id, caller_name, file_path] :=
          *calls{from_id: caller_id, to_id: $entityId},
          *function{id: caller_id, name: caller_name, file_id},
          *file{id: file_id, relative_path: file_path}`,
        { entityId }
      );

      for (const row of callerResult.rows.slice(0, 10)) {
        const justification = existingJustifications.get(row.caller_id);
        callers.push({
          functionName: row.caller_name,
          filePath: row.file_path,
          purposeSummary: justification?.purposeSummary,
        });
      }

      // Get callees
      const calleeResult = await this.graphStore.query<{
        callee_id: string;
        callee_name: string;
        file_path: string;
      }>(
        `?[callee_id, callee_name, file_path] :=
          *calls{from_id: $entityId, to_id: callee_id},
          *function{id: callee_id, name: callee_name, file_id},
          *file{id: file_id, relative_path: file_path}`,
        { entityId }
      );

      for (const row of calleeResult.rows.slice(0, 10)) {
        const justification = existingJustifications.get(row.callee_id);
        callees.push({
          functionName: row.callee_name,
          filePath: row.file_path,
          purposeSummary: justification?.purposeSummary,
        });
      }
    }

    return { callers, callees };
  }

  /**
   * Get project context (with caching - rarely changes)
   */
  private async getProjectContext(): Promise<ProjectContext> {
    // Check cache first
    if (this.projectContextCache) {
      return this.projectContextCache;
    }

    // Try to get stored project context
    const result = await this.graphStore.query<{
      project_name: string;
      project_description: string | null;
      domain: string | null;
      framework: string | null;
      known_features: string[];
    }>(
      `?[project_name, project_description, domain, framework, known_features] :=
        *project_context{project_name, project_description, domain, framework, known_features}`
    );

    let context: ProjectContext;
    if (result.rows.length > 0) {
      const ctx = result.rows[0]!;
      context = {
        projectName: ctx.project_name,
        projectDescription: ctx.project_description || undefined,
        domain: ctx.domain || undefined,
        framework: ctx.framework || undefined,
        knownFeatures: ctx.known_features || [],
      };
    } else {
      // Default context
      context = {
        projectName: "Unknown Project",
        knownFeatures: [],
      };
    }

    // Cache the result
    this.projectContextCache = context;

    return context;
  }

  // ===========================================================================
  // Context Propagation
  // ===========================================================================

  /**
   * Propagate parent context down to children
   */
  propagateDown(
    parentJustification: EntityJustification,
    childJustification: EntityJustification
  ): EntityJustification {
    // Inherit feature context if not set
    if (!childJustification.featureContext && parentJustification.featureContext) {
      childJustification.featureContext = parentJustification.featureContext;
    }

    // Add parent to evidence sources
    if (!childJustification.evidenceSources.includes(parentJustification.id)) {
      childJustification.evidenceSources.push(parentJustification.id);
    }

    // Boost confidence if parent has high confidence
    if (parentJustification.confidenceScore > 0.7) {
      childJustification.confidenceScore = Math.min(
        1,
        childJustification.confidenceScore + 0.1
      );
    }

    // Update metadata
    childJustification.parentJustificationId = parentJustification.id;
    childJustification.updatedAt = Date.now();

    return childJustification;
  }

  /**
   * Aggregate child justifications into parent summary
   */
  aggregateUp(
    parentJustification: EntityJustification,
    childJustifications: EntityJustification[]
  ): EntityJustification {
    if (childJustifications.length === 0) {
      return parentJustification;
    }

    // Aggregate feature contexts
    const featureContexts = new Set<string>();
    for (const child of childJustifications) {
      if (child.featureContext) {
        featureContexts.add(child.featureContext);
      }
    }

    if (featureContexts.size === 1) {
      parentJustification.featureContext = [...featureContexts][0] || "";
    } else if (featureContexts.size > 1) {
      parentJustification.featureContext = [...featureContexts].join(", ");
    }

    // Aggregate tags
    const allTags = new Set<string>();
    for (const child of childJustifications) {
      for (const tag of child.tags) {
        allTags.add(tag);
      }
    }
    parentJustification.tags = [...allTags];

    // Average confidence
    const avgConfidence =
      childJustifications.reduce((sum, c) => sum + c.confidenceScore, 0) /
      childJustifications.length;
    parentJustification.confidenceScore = Math.max(
      parentJustification.confidenceScore,
      avgConfidence
    );

    // Add children to evidence sources
    for (const child of childJustifications) {
      if (!parentJustification.evidenceSources.includes(child.id)) {
        parentJustification.evidenceSources.push(child.id);
      }
    }

    parentJustification.updatedAt = Date.now();

    return parentJustification;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a context propagator instance
 */
export function createContextPropagator(
  graphStore: IGraphStoreForPropagation
): ContextPropagator {
  return new ContextPropagator(graphStore);
}

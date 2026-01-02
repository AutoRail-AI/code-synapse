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
  constructor(private graphStore: IGraphStoreForPropagation) {}

  // ===========================================================================
  // Hierarchy Building
  // ===========================================================================

  /**
   * Build the entity hierarchy for a file
   */
  async buildFileHierarchy(filePath: string): Promise<HierarchyNode[]> {
    const nodes: HierarchyNode[] = [];

    // Get file node
    const fileResult = await this.graphStore.query<{
      id: string;
      relativePath: string;
    }>(
      `?[id, relativePath] := *File{id, relativePath}, relativePath = $path`,
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
      `?[id, name] := *Class{id, name, fileId}, fileId = $fileId`,
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
        `?[functionId, name] := *HAS_METHOD{from_id: $classId, to_id: functionId}, *Function{id: functionId, name}`,
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
      `?[id, name] := *Interface{id, name, fileId}, fileId = $fileId`,
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
        *Function{id, name, fileId},
        fileId = $fileId,
        not *HAS_METHOD{to_id: id}`,
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
          fileId: string;
          startLine: number;
          endLine: number;
          signature: string;
          isExported: boolean;
          isAsync: boolean;
          docComment: string | null;
        }>(
          `?[id, name, fileId, startLine, endLine, signature, isExported, isAsync, docComment] :=
            *Function{id, name, fileId, startLine, endLine, signature, isExported, isAsync, docComment},
            id = $entityId`,
          { entityId }
        );

        if (result.rows.length === 0) {
          throw new Error(`Function not found: ${entityId}`);
        }

        const fn = result.rows[0]!;
        const filePath = await this.getFilePath(fn.fileId);

        return {
          id: fn.id,
          type: entityType,
          name: fn.name,
          filePath,
          startLine: fn.startLine,
          endLine: fn.endLine,
          signature: fn.signature,
          codeSnippet: fn.signature, // Would need file read for full snippet
          docComment: fn.docComment || undefined,
          isExported: fn.isExported,
          isAsync: fn.isAsync,
        };
      }

      case "class": {
        const result = await this.graphStore.query<{
          id: string;
          name: string;
          fileId: string;
          startLine: number;
          endLine: number;
          isExported: boolean;
          docComment: string | null;
        }>(
          `?[id, name, fileId, startLine, endLine, isExported, docComment] :=
            *Class{id, name, fileId, startLine, endLine, isExported, docComment},
            id = $entityId`,
          { entityId }
        );

        if (result.rows.length === 0) {
          throw new Error(`Class not found: ${entityId}`);
        }

        const cls = result.rows[0]!;
        const filePath = await this.getFilePath(cls.fileId);

        return {
          id: cls.id,
          type: "class",
          name: cls.name,
          filePath,
          startLine: cls.startLine,
          endLine: cls.endLine,
          codeSnippet: `class ${cls.name}`,
          docComment: cls.docComment || undefined,
          isExported: cls.isExported,
        };
      }

      case "interface": {
        const result = await this.graphStore.query<{
          id: string;
          name: string;
          fileId: string;
          startLine: number;
          endLine: number;
          isExported: boolean;
          docComment: string | null;
        }>(
          `?[id, name, fileId, startLine, endLine, isExported, docComment] :=
            *Interface{id, name, fileId, startLine, endLine, isExported, docComment},
            id = $entityId`,
          { entityId }
        );

        if (result.rows.length === 0) {
          throw new Error(`Interface not found: ${entityId}`);
        }

        const iface = result.rows[0]!;
        const filePath = await this.getFilePath(iface.fileId);

        return {
          id: iface.id,
          type: "interface",
          name: iface.name,
          filePath,
          startLine: iface.startLine,
          endLine: iface.endLine,
          codeSnippet: `interface ${iface.name}`,
          docComment: iface.docComment || undefined,
          isExported: iface.isExported,
        };
      }

      case "file": {
        const result = await this.graphStore.query<{
          id: string;
          relativePath: string;
        }>(
          `?[id, relativePath] := *File{id, relativePath}, id = $entityId`,
          { entityId }
        );

        if (result.rows.length === 0) {
          throw new Error(`File not found: ${entityId}`);
        }

        const file = result.rows[0]!;

        return {
          id: file.id,
          type: "file",
          name: file.relativePath.split("/").pop() || file.relativePath,
          filePath: file.relativePath,
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
   * Get file path from file ID
   */
  private async getFilePath(fileId: string): Promise<string> {
    const result = await this.graphStore.query<{ relativePath: string }>(
      `?[relativePath] := *File{id, relativePath}, id = $fileId`,
      { fileId }
    );
    return result.rows[0]?.relativePath || "";
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
        classId: string;
        className: string;
      }>(
        `?[classId, className] :=
          *HAS_METHOD{from_id: classId, to_id: $entityId},
          *Class{id: classId, name: className}`,
        { entityId }
      );

      if (result.rows.length > 0) {
        const parent = result.rows[0]!;
        return {
          id: parent.classId,
          type: "class",
          name: parent.className,
          justification: existingJustifications.get(parent.classId),
        };
      }
    }

    // Classes/interfaces/functions have file parent
    if (["class", "interface", "function"].includes(entityType)) {
      const tableMap: Record<string, string> = {
        class: "Class",
        interface: "Interface",
        function: "Function",
      };
      const table = tableMap[entityType];

      const result = await this.graphStore.query<{
        fileId: string;
        filePath: string;
      }>(
        `?[fileId, filePath] :=
          *${table}{id: $entityId, fileId},
          *File{id: fileId, relativePath: filePath}`,
        { entityId }
      );

      if (result.rows.length > 0) {
        const parent = result.rows[0]!;
        return {
          id: parent.fileId,
          type: "file",
          name: parent.filePath.split("/").pop() || parent.filePath,
          justification: existingJustifications.get(parent.fileId),
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
        function: "Function",
        class: "Class",
        interface: "Interface",
      };
      const table = tableMap[entityType];

      const result = await this.graphStore.query<{
        id: string;
        name: string;
        fileId: string;
      }>(
        `?[id, name, fileId] :=
          *${table}{id: $entityId, fileId: myFileId},
          *${table}{id, name, fileId},
          fileId = myFileId,
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
        functionId: string;
        name: string;
      }>(
        `?[functionId, name] :=
          *HAS_METHOD{from_id: $entityId, to_id: functionId},
          *Function{id: functionId, name}`,
        { entityId }
      );

      for (const row of result.rows) {
        const justification = existingJustifications.get(row.functionId);
        children.push({
          id: row.functionId,
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
          *Function{id, name, fileId},
          fileId = $entityId`,
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
          *Class{id, name, fileId},
          fileId = $entityId`,
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
        toPath: string;
        importedSymbols: string[];
      }>(
        `?[toPath, importedSymbols] :=
          *IMPORTS{from_id: $entityId, to_id: toId, importedSymbols},
          *File{id: toId, relativePath: toPath}`,
        { entityId }
      );

      for (const row of result.rows) {
        dependencies.push({
          modulePath: row.toPath,
          importedNames: row.importedSymbols || [],
          isExternal: row.toPath.includes("node_modules"),
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
        callerId: string;
        callerName: string;
        filePath: string;
      }>(
        `?[callerId, callerName, filePath] :=
          *CALLS{from_id: callerId, to_id: $entityId},
          *Function{id: callerId, name: callerName, fileId},
          *File{id: fileId, relativePath: filePath}`,
        { entityId }
      );

      for (const row of callerResult.rows.slice(0, 10)) {
        const justification = existingJustifications.get(row.callerId);
        callers.push({
          functionName: row.callerName,
          filePath: row.filePath,
          purposeSummary: justification?.purposeSummary,
        });
      }

      // Get callees
      const calleeResult = await this.graphStore.query<{
        calleeId: string;
        calleeName: string;
        filePath: string;
      }>(
        `?[calleeId, calleeName, filePath] :=
          *CALLS{from_id: $entityId, to_id: calleeId},
          *Function{id: calleeId, name: calleeName, fileId},
          *File{id: fileId, relativePath: filePath}`,
        { entityId }
      );

      for (const row of calleeResult.rows.slice(0, 10)) {
        const justification = existingJustifications.get(row.calleeId);
        callees.push({
          functionName: row.calleeName,
          filePath: row.filePath,
          purposeSummary: justification?.purposeSummary,
        });
      }
    }

    return { callers, callees };
  }

  /**
   * Get project context
   */
  private async getProjectContext(): Promise<ProjectContext> {
    // Try to get stored project context
    const result = await this.graphStore.query<{
      projectName: string;
      projectDescription: string | null;
      domain: string | null;
      framework: string | null;
      knownFeatures: string[];
    }>(
      `?[projectName, projectDescription, domain, framework, knownFeatures] :=
        *ProjectContext{projectName, projectDescription, domain, framework, knownFeatures}`
    );

    if (result.rows.length > 0) {
      const ctx = result.rows[0]!;
      return {
        projectName: ctx.projectName,
        projectDescription: ctx.projectDescription || undefined,
        domain: ctx.domain || undefined,
        framework: ctx.framework || undefined,
        knownFeatures: ctx.knownFeatures || [],
      };
    }

    // Default context
    return {
      projectName: "Unknown Project",
      knownFeatures: [],
    };
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

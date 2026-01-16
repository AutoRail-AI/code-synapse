/**
 * Dependency Graph Builder for Hierarchical Justification
 *
 * Builds a dependency graph from the knowledge graph relationships
 * and computes processing order using topological sort.
 *
 * Processing order ensures leaf nodes (foundation code) are justified
 * before code that depends on them, enabling context propagation.
 *
 * @module
 */

import { createLogger } from "../../../utils/logger.js";
import type { IGraphStore } from "../../interfaces/IGraphStore.js";

const logger = createLogger("dependency-graph");

// =============================================================================
// Types
// =============================================================================

/**
 * Entity types that can be in the dependency graph
 */
export type DependencyEntityType = "function" | "class" | "interface" | "file";

/**
 * A node in the dependency graph
 */
export interface DependencyNode {
  entityId: string;
  entityType: DependencyEntityType;
  /** Entities this node depends on (outgoing edges) */
  dependsOn: Set<string>;
  /** Entities that depend on this node (incoming edges) */
  dependedBy: Set<string>;
}

/**
 * The complete dependency graph
 */
export type DependencyGraph = Map<string, DependencyNode>;

/**
 * A processing level containing entities at the same depth
 */
export interface ProcessingLevel {
  /** Level number (0 = leaves, higher = depends on more) */
  level: number;
  /** Entity IDs at this level */
  entityIds: string[];
  /** True if this level represents a strongly connected component (cycle) */
  isCycle: boolean;
  /** For cycles, the size of the SCC */
  cycleSize?: number;
}

/**
 * Complete processing order for justification
 */
export interface ProcessingOrder {
  /** Ordered levels from leaves to roots */
  levels: ProcessingLevel[];
  /** Total number of entities */
  totalEntities: number;
  /** Number of cycles detected */
  cycleCount: number;
  /** Entities involved in cycles */
  entitiesInCycles: number;
}

/**
 * Statistics about the dependency graph
 */
export interface DependencyGraphStats {
  totalNodes: number;
  totalEdges: number;
  functions: number;
  classes: number;
  interfaces: number;
  files: number;
  leafNodes: number;
  rootNodes: number;
  maxDepth: number;
}

// =============================================================================
// Graph Building
// =============================================================================

/**
 * Build a dependency graph from the knowledge graph
 *
 * Queries all relevant relationships:
 * - CALLS: function → function
 * - IMPORTS: file → file
 * - EXTENDS: class → class
 * - IMPLEMENTS: class → interface
 * - EXTENDS_INTERFACE: interface → interface
 */
export async function buildDependencyGraph(
  graphStore: IGraphStore
): Promise<DependencyGraph> {
  const graph: DependencyGraph = new Map();

  logger.debug("Building dependency graph from knowledge graph");

  // Helper to ensure node exists
  const ensureNode = (id: string, type: DependencyEntityType): DependencyNode => {
    let node = graph.get(id);
    if (!node) {
      node = {
        entityId: id,
        entityType: type,
        dependsOn: new Set(),
        dependedBy: new Set(),
      };
      graph.set(id, node);
    }
    return node;
  };

  // Helper to add edge (from depends on to)
  const addEdge = (
    fromId: string,
    fromType: DependencyEntityType,
    toId: string,
    toType: DependencyEntityType
  ) => {
    const fromNode = ensureNode(fromId, fromType);
    const toNode = ensureNode(toId, toType);
    fromNode.dependsOn.add(toId);
    toNode.dependedBy.add(fromId);
  };

  // 1. Get all entities first (to ensure we have all nodes even without edges)
  const [functions, classes, interfaces, files] = await Promise.all([
    graphStore.query<{ id: string }>(`?[id] := *function{id}`),
    graphStore.query<{ id: string }>(`?[id] := *class{id}`),
    graphStore.query<{ id: string }>(`?[id] := *interface{id}`),
    graphStore.query<{ id: string }>(`?[id] := *file{id}`),
  ]);

  // Initialize all nodes
  for (const row of functions.rows) {
    ensureNode(row.id, "function");
  }
  for (const row of classes.rows) {
    ensureNode(row.id, "class");
  }
  for (const row of interfaces.rows) {
    ensureNode(row.id, "interface");
  }
  for (const row of files.rows) {
    ensureNode(row.id, "file");
  }

  logger.debug(
    {
      functions: functions.rows.length,
      classes: classes.rows.length,
      interfaces: interfaces.rows.length,
      files: files.rows.length,
    },
    "Initialized nodes"
  );

  // 2. Query all relationships in parallel
  const [calls, imports, extends_, implements_, extendsInterface] = await Promise.all([
    // Function calls function
    graphStore.query<{ from_id: string; to_id: string }>(
      `?[from_id, to_id] := *calls{from_id, to_id}`
    ),
    // File imports file
    graphStore.query<{ from_id: string; to_id: string }>(
      `?[from_id, to_id] := *imports{from_id, to_id}`
    ),
    // Class extends class
    graphStore.query<{ from_id: string; to_id: string }>(
      `?[from_id, to_id] := *extends{from_id, to_id}`
    ),
    // Class implements interface
    graphStore.query<{ from_id: string; to_id: string }>(
      `?[from_id, to_id] := *implements{from_id, to_id}`
    ),
    // Interface extends interface
    graphStore.query<{ from_id: string; to_id: string }>(
      `?[from_id, to_id] := *extends_interface{from_id, to_id}`
    ),
  ]);

  // 3. Add edges for each relationship type
  let edgeCount = 0;

  // CALLS: function depends on function it calls
  for (const row of calls.rows) {
    // Only add edge if both nodes exist in our graph (skip external calls)
    if (graph.has(row.from_id) && graph.has(row.to_id)) {
      addEdge(row.from_id, "function", row.to_id, "function");
      edgeCount++;
    }
  }

  // IMPORTS: file depends on file it imports
  for (const row of imports.rows) {
    if (graph.has(row.from_id) && graph.has(row.to_id)) {
      addEdge(row.from_id, "file", row.to_id, "file");
      edgeCount++;
    }
  }

  // EXTENDS: class depends on class it extends
  for (const row of extends_.rows) {
    if (graph.has(row.from_id) && graph.has(row.to_id)) {
      addEdge(row.from_id, "class", row.to_id, "class");
      edgeCount++;
    }
  }

  // IMPLEMENTS: class depends on interface it implements
  for (const row of implements_.rows) {
    if (graph.has(row.from_id) && graph.has(row.to_id)) {
      addEdge(row.from_id, "class", row.to_id, "interface");
      edgeCount++;
    }
  }

  // EXTENDS_INTERFACE: interface depends on interface it extends
  for (const row of extendsInterface.rows) {
    if (graph.has(row.from_id) && graph.has(row.to_id)) {
      addEdge(row.from_id, "interface", row.to_id, "interface");
      edgeCount++;
    }
  }

  logger.info(
    {
      totalNodes: graph.size,
      totalEdges: edgeCount,
      calls: calls.rows.length,
      imports: imports.rows.length,
      extends: extends_.rows.length,
      implements: implements_.rows.length,
      extendsInterface: extendsInterface.rows.length,
    },
    "Dependency graph built"
  );

  return graph;
}

/**
 * Get statistics about a dependency graph
 */
export function getGraphStats(graph: DependencyGraph): DependencyGraphStats {
  let totalEdges = 0;
  let functions = 0;
  let classes = 0;
  let interfaces = 0;
  let files = 0;
  let leafNodes = 0;
  let rootNodes = 0;

  for (const node of graph.values()) {
    totalEdges += node.dependsOn.size;

    switch (node.entityType) {
      case "function":
        functions++;
        break;
      case "class":
        classes++;
        break;
      case "interface":
        interfaces++;
        break;
      case "file":
        files++;
        break;
    }

    // Leaf = no outgoing dependencies
    if (node.dependsOn.size === 0) {
      leafNodes++;
    }

    // Root = no incoming dependencies (nothing depends on it)
    if (node.dependedBy.size === 0) {
      rootNodes++;
    }
  }

  return {
    totalNodes: graph.size,
    totalEdges,
    functions,
    classes,
    interfaces,
    files,
    leafNodes,
    rootNodes,
    maxDepth: 0, // Will be computed during topological sort
  };
}

// =============================================================================
// Topological Sort with Cycle Handling
// =============================================================================

/**
 * Compute processing order using Kahn's algorithm with SCC handling
 *
 * Returns levels where:
 * - Level 0 = leaf nodes (no outgoing dependencies)
 * - Level N = nodes that depend only on levels < N
 *
 * Cycles are detected and grouped into their own levels as SCCs
 */
export function computeProcessingOrder(graph: DependencyGraph): ProcessingOrder {
  logger.debug({ nodeCount: graph.size }, "Computing processing order");

  // Create working copies of in-degrees (number of dependencies)
  const inDegree = new Map<string, number>();
  const remaining = new Set<string>();

  for (const [id, node] of graph) {
    inDegree.set(id, node.dependsOn.size);
    remaining.add(id);
  }

  const levels: ProcessingLevel[] = [];
  let level = 0;
  let cycleCount = 0;
  let entitiesInCycles = 0;

  // Process until all nodes are assigned to levels
  while (remaining.size > 0) {
    // Find all nodes with in-degree 0 (no remaining dependencies)
    const currentLevel: string[] = [];

    for (const id of remaining) {
      if (inDegree.get(id) === 0) {
        currentLevel.push(id);
      }
    }

    if (currentLevel.length > 0) {
      // Normal level - nodes with no remaining dependencies
      levels.push({
        level,
        entityIds: currentLevel,
        isCycle: false,
      });

      // Remove these nodes and update in-degrees of dependents
      for (const id of currentLevel) {
        remaining.delete(id);
        const node = graph.get(id);
        if (node) {
          // Decrease in-degree of all nodes that depend on this one
          for (const dependentId of node.dependedBy) {
            if (remaining.has(dependentId)) {
              const currentDegree = inDegree.get(dependentId) || 0;
              inDegree.set(dependentId, currentDegree - 1);
            }
          }
        }
      }

      level++;
    } else {
      // No nodes with in-degree 0 - we have a cycle
      // Find strongly connected components in remaining nodes
      const sccs = findSCCs(graph, remaining);

      if (sccs.length === 0) {
        // Shouldn't happen, but break to avoid infinite loop
        logger.error({ remaining: remaining.size }, "No SCCs found but nodes remain");
        break;
      }

      // Process each SCC as a separate level
      for (const scc of sccs) {
        cycleCount++;
        entitiesInCycles += scc.length;

        levels.push({
          level,
          entityIds: scc,
          isCycle: true,
          cycleSize: scc.length,
        });

        // Remove SCC nodes from remaining
        for (const id of scc) {
          remaining.delete(id);
          const node = graph.get(id);
          if (node) {
            for (const dependentId of node.dependedBy) {
              if (remaining.has(dependentId)) {
                const currentDegree = inDegree.get(dependentId) || 0;
                inDegree.set(dependentId, currentDegree - 1);
              }
            }
          }
        }

        level++;
      }
    }
  }

  const result: ProcessingOrder = {
    levels,
    totalEntities: graph.size,
    cycleCount,
    entitiesInCycles,
  };

  logger.info(
    {
      totalLevels: levels.length,
      totalEntities: result.totalEntities,
      cycleCount,
      entitiesInCycles,
      levelSizes: levels.map((l) => l.entityIds.length),
    },
    "Processing order computed"
  );

  return result;
}

/**
 * Find Strongly Connected Components using Tarjan's algorithm
 *
 * An SCC is a maximal set of nodes where every node can reach every other node.
 * These represent cycles in the dependency graph.
 */
function findSCCs(graph: DependencyGraph, nodeSet: Set<string>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let currentIndex = 0;

  function strongConnect(nodeId: string) {
    index.set(nodeId, currentIndex);
    lowlink.set(nodeId, currentIndex);
    currentIndex++;
    stack.push(nodeId);
    onStack.add(nodeId);

    const node = graph.get(nodeId);
    if (node) {
      // Consider only edges to nodes in the remaining set
      for (const depId of node.dependsOn) {
        if (!nodeSet.has(depId)) continue;

        if (!index.has(depId)) {
          // Successor not yet visited
          strongConnect(depId);
          lowlink.set(nodeId, Math.min(lowlink.get(nodeId)!, lowlink.get(depId)!));
        } else if (onStack.has(depId)) {
          // Successor is on stack, part of current SCC
          lowlink.set(nodeId, Math.min(lowlink.get(nodeId)!, index.get(depId)!));
        }
      }
    }

    // If nodeId is a root node, pop the SCC
    if (lowlink.get(nodeId) === index.get(nodeId)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== nodeId);

      // Only include SCCs with more than one node (actual cycles)
      // or single nodes that have self-loops
      if (scc.length > 1) {
        sccs.push(scc);
      } else if (scc.length === 1) {
        const singleNode = graph.get(scc[0]!);
        if (singleNode && singleNode.dependsOn.has(scc[0]!)) {
          // Self-loop
          sccs.push(scc);
        }
      }
    }
  }

  // Run algorithm on all nodes in the set
  for (const nodeId of nodeSet) {
    if (!index.has(nodeId)) {
      strongConnect(nodeId);
    }
  }

  return sccs;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get all entity IDs in processing order (flattened)
 */
export function getOrderedEntityIds(order: ProcessingOrder): string[] {
  const result: string[] = [];
  for (const level of order.levels) {
    result.push(...level.entityIds);
  }
  return result;
}

/**
 * Get leaf nodes (entities with no dependencies)
 */
export function getLeafNodes(graph: DependencyGraph): string[] {
  const leaves: string[] = [];
  for (const [id, node] of graph) {
    if (node.dependsOn.size === 0) {
      leaves.push(id);
    }
  }
  return leaves;
}

/**
 * Get root nodes (entities nothing depends on)
 */
export function getRootNodes(graph: DependencyGraph): string[] {
  const roots: string[] = [];
  for (const [id, node] of graph) {
    if (node.dependedBy.size === 0) {
      roots.push(id);
    }
  }
  return roots;
}

/**
 * Get the dependency depth of a specific entity
 */
export function getEntityDepth(
  entityId: string,
  order: ProcessingOrder
): number | undefined {
  for (const level of order.levels) {
    if (level.entityIds.includes(entityId)) {
      return level.level;
    }
  }
  return undefined;
}

/**
 * Check if an entity is part of a cycle
 */
export function isInCycle(entityId: string, order: ProcessingOrder): boolean {
  for (const level of order.levels) {
    if (level.isCycle && level.entityIds.includes(entityId)) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Build dependency graph and compute processing order in one call
 */
export async function buildProcessingOrder(
  graphStore: IGraphStore
): Promise<{ graph: DependencyGraph; order: ProcessingOrder }> {
  const graph = await buildDependencyGraph(graphStore);
  const order = computeProcessingOrder(graph);
  return { graph, order };
}

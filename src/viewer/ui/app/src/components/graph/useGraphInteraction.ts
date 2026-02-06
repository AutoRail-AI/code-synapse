/**
 * Custom hook for graph interaction handling
 * Manages mouse events, panning, zooming, and node/edge detection
 */

import { useState, useCallback, useMemo } from 'react';
import type { NodePosition, NodeGroup, ContextMenuState } from './types';

interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

interface UseGraphInteractionProps {
  nodePositions: Map<string, NodePosition>;
  nodeGroups: Map<string, NodeGroup>;
  edges: GraphEdge[];
  zoom: number;
  pan: { x: number; y: number };
  shouldShowNodes: boolean;
  focusedNode: string | null;
  focusDepth: number;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

interface UseGraphInteractionResult {
  // Hover state
  hoveredNode: string | null;
  setHoveredNode: (node: string | null) => void;
  hoveredEdge: { source: string; target: string; type: string } | null;
  setHoveredEdge: (edge: { source: string; target: string; type: string } | null) => void;
  hoveredGroup: string | null;
  setHoveredGroup: (group: string | null) => void;

  // Context menu
  contextMenu: ContextMenuState;
  setContextMenu: (state: ContextMenuState) => void;

  // Path tracing
  highlightedPaths: Set<string>;
  setHighlightedPaths: (paths: Set<string>) => void;
  pathTraceTarget: string | null;
  setPathTraceTarget: (target: string | null) => void;

  // Expanded groups
  expandedGroups: Set<string>;
  toggleGroupExpansion: (groupId: string) => void;

  // Panning
  isPanning: boolean;
  lastPanPoint: { x: number; y: number };
  startPanning: (x: number, y: number) => void;
  stopPanning: () => void;
  updatePan: (x: number, y: number) => { x: number; y: number };

  // Computed values
  nodesInFocusRange: Set<string> | null;

  // Utilities
  findUsagePaths: (startNodeId: string) => Set<string>;
  handleMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleContextMenu: (e: React.MouseEvent<HTMLCanvasElement>) => void;
}

export function useGraphInteraction({
  nodePositions,
  nodeGroups,
  edges,
  zoom,
  pan,
  shouldShowNodes,
  focusedNode,
  focusDepth,
  canvasRef,
}: UseGraphInteractionProps): UseGraphInteractionResult {
  // Hover state
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<{ source: string; target: string; type: string } | null>(null);
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    nodeId: null,
  });

  // Path tracing
  const [highlightedPaths, setHighlightedPaths] = useState<Set<string>>(new Set());
  const [pathTraceTarget, setPathTraceTarget] = useState<string | null>(null);

  // Expanded groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Panning
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 });

  // Find all nodes within N hops of focused node
  const nodesInFocusRange = useMemo(() => {
    if (!focusedNode) return null;

    const visited = new Set<string>();
    const queue: { id: string; depth: number }[] = [{ id: focusedNode, depth: 0 }];
    visited.add(focusedNode);

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= focusDepth) continue;
      edges.forEach((edge) => {
        if (edge.source === id && !visited.has(edge.target)) {
          visited.add(edge.target);
          queue.push({ id: edge.target, depth: depth + 1 });
        }
        if (edge.target === id && !visited.has(edge.source)) {
          visited.add(edge.source);
          queue.push({ id: edge.source, depth: depth + 1 });
        }
      });
    }
    return visited;
  }, [focusedNode, focusDepth, edges]);

  // Find all paths connected to a node
  const findUsagePaths = useCallback((startNodeId: string): Set<string> => {
    const pathEdges = new Set<string>();
    const visited = new Set<string>();
    const queue = [startNodeId];
    visited.add(startNodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      edges.forEach((edge) => {
        if (edge.source === current || edge.target === current) {
          pathEdges.add(`${edge.source}-${edge.target}`);
          const neighbor = edge.source === current ? edge.target : edge.source;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      });
    }
    return pathEdges;
  }, [edges]);

  // Toggle group expansion
  const toggleGroupExpansion = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // Panning controls
  const startPanning = useCallback((x: number, y: number) => {
    setIsPanning(true);
    setLastPanPoint({ x, y });
  }, []);

  const stopPanning = useCallback(() => {
    setIsPanning(false);
  }, []);

  const updatePan = useCallback((x: number, y: number): { x: number; y: number } => {
    const delta = {
      x: x - lastPanPoint.x,
      y: y - lastPanPoint.y,
    };
    setLastPanPoint({ x, y });
    return delta;
  }, [lastPanPoint]);

  // Handle mouse move for hit detection
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - pan.x) / zoom;
      const y = (e.clientY - rect.top - pan.y) / zoom;

      // Check groups first
      let foundGroup: string | null = null;
      for (const [groupId, group] of nodeGroups) {
        const dx = group.x - x;
        const dy = group.y - y;
        if (Math.sqrt(dx * dx + dy * dy) < group.radius + 15) {
          foundGroup = groupId;
          break;
        }
      }
      setHoveredGroup(foundGroup);

      // Check nodes
      let foundNode: string | null = null;
      if (shouldShowNodes) {
        for (const [id, pos] of nodePositions) {
          const dx = pos.x - x;
          const dy = pos.y - y;
          if (Math.sqrt(dx * dx + dy * dy) < 12) {
            foundNode = id;
            break;
          }
        }
      }
      setHoveredNode(foundNode);

      // Check edges
      if (!foundNode && shouldShowNodes) {
        let foundEdge: { source: string; target: string; type: string } | null = null;
        for (const edge of edges) {
          const from = nodePositions.get(edge.source);
          const to = nodePositions.get(edge.target);
          if (!from || !to) continue;
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const lengthSq = dx * dx + dy * dy;
          if (lengthSq === 0) continue;
          const t = Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / lengthSq));
          const projX = from.x + t * dx;
          const projY = from.y + t * dy;
          const distance = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);
          if (distance < 8) {
            foundEdge = edge;
            break;
          }
        }
        setHoveredEdge(foundEdge);
      } else {
        setHoveredEdge(null);
      }
    },
    [nodePositions, nodeGroups, edges, zoom, pan, shouldShowNodes, canvasRef]
  );

  // Handle context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (hoveredNode) {
        setContextMenu({ visible: true, x: e.clientX, y: e.clientY, nodeId: hoveredNode });
      }
    },
    [hoveredNode]
  );

  return {
    hoveredNode,
    setHoveredNode,
    hoveredEdge,
    setHoveredEdge,
    hoveredGroup,
    setHoveredGroup,
    contextMenu,
    setContextMenu,
    highlightedPaths,
    setHighlightedPaths,
    pathTraceTarget,
    setPathTraceTarget,
    expandedGroups,
    toggleGroupExpansion,
    isPanning,
    lastPanPoint,
    startPanning,
    stopPanning,
    updatePan,
    nodesInFocusRange,
    findUsagePaths,
    handleMouseMove,
    handleContextMenu,
  };
}

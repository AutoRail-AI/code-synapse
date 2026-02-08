/**
 * Knowledge Graph Visualization - Main Component
 *
 * Uses react-force-graph-2d for optimal performance and layout:
 * - Hierarchical DAG mode for Structure view (Directory -> File -> Entity tree)
 * - Clustered aggregation for Business view (by feature context)
 * - Layered view for Infrastructure view (Domain vs Infrastructure)
 * - Force-directed for Pattern view with confidence-based sizing
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ForceGraph2D, { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import {
  GitBranch,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Filter,
  Search,
  Download,
  X,
  Brain,
  AlertTriangle,
  Layers,
  FileCode,
  Folder,
  Box,
  Database,
  Settings2,
} from 'lucide-react';
import { useGraphStore, useUIStore } from '../../store';
import {
  getGraphData,
  getFileTree,
  getClassifications,
  FileTree,
} from '../../api/client';

// Local imports
import type { LensType, DetailLevel, GraphNode as InspectorGraphNode } from './types';
import { FilterButton, LensButton, DetailLevelIndicator } from './components';
import { Inspector } from './Inspector';

// =============================================================================
// Types
// =============================================================================

interface HierarchyNode extends NodeObject {
  id: string;
  label: string;
  kind: string;
  type: 'directory' | 'file' | 'entity';
  level: number;
  confidence?: number;
  classification?: string;
  featureContext?: string;
  purposeSummary?: string;
  filePath?: string;
  entityCount?: number;
  val?: number;
  color?: string;
  isCluster?: boolean;
  clusterNodes?: string[];
  collapsed?: boolean;
  parentId?: string;
}

interface HierarchyLink extends LinkObject {
  source: string | HierarchyNode;
  target: string | HierarchyNode;
  type: string;
  count?: number;
}

interface GraphApiNode {
  id: string;
  label: string;
  kind: string;
  confidence?: number;
  classification?: string;
  featureContext?: string;
  purposeSummary?: string;
  filePath?: string;
}

interface GraphApiEdge {
  source: string;
  target: string;
  kind: string;  // API returns 'kind' not 'type'
}

// =============================================================================
// Data Transformation: Build Hierarchical Graph from File Tree + Entities
// =============================================================================

function buildHierarchicalData(
  fileTree: FileTree[],
  entities: GraphApiNode[],
  edges: GraphApiEdge[],
  classifications: Map<string, string>
): { nodes: HierarchyNode[]; links: HierarchyLink[] } {
  const hierarchyNodes: HierarchyNode[] = [];
  const hierarchyLinks: HierarchyLink[] = [];
  const processedIds = new Set<string>();
  const entityByFile = new Map<string, GraphApiNode[]>();

  // Group entities by file path
  entities.forEach(entity => {
    if (entity.filePath) {
      const existing = entityByFile.get(entity.filePath) || [];
      existing.push(entity);
      entityByFile.set(entity.filePath, existing);
    }
  });

  // Helper to add node if not exists
  const addNode = (node: HierarchyNode) => {
    if (!processedIds.has(node.id)) {
      hierarchyNodes.push(node);
      processedIds.add(node.id);
    }
  };

  // Recursively process file tree
  const processTree = (items: FileTree[], parentId: string | null, level: number) => {
    items.forEach(item => {
      const nodeId = item.type === 'directory' ? `dir://${item.path}` : `file://${item.path}`;

      addNode({
        id: nodeId,
        label: item.name,
        kind: item.type,
        type: item.type === 'directory' ? 'directory' : 'file',
        level,
        entityCount: item.entityCount,
        filePath: item.path,
        parentId: parentId || undefined,
        val: item.type === 'directory' ? 15 : 10,
      });

      // Link parent -> child
      if (parentId) {
        hierarchyLinks.push({
          source: parentId,
          target: nodeId,
          type: 'contains',
        });
      }

      // Process children (directories)
      if (item.children && item.children.length > 0) {
        processTree(item.children, nodeId, level + 1);
      }

      // Add entities for files
      if (item.type === 'file') {
        const fileEntities = entityByFile.get(item.path) || [];
        fileEntities.forEach(entity => {
          const classification = classifications.get(entity.id) || entity.classification;

          addNode({
            id: entity.id,
            label: entity.label,
            kind: entity.kind,
            type: 'entity',
            level: level + 1,
            confidence: entity.confidence,
            classification,
            featureContext: entity.featureContext,
            purposeSummary: entity.purposeSummary,
            filePath: entity.filePath,
            parentId: nodeId,
            val: 5,
          });

          // Link file -> entity
          hierarchyLinks.push({
            source: nodeId,
            target: entity.id,
            type: 'contains',
          });
        });
      }
    });
  };

  // Process the file tree
  processTree(fileTree, null, 0);

  // Add actual code relationships (calls, imports, extends, implements)
  edges.forEach(edge => {
    if (processedIds.has(edge.source) && processedIds.has(edge.target)) {
      if (edge.kind !== 'contains') {
        hierarchyLinks.push({
          source: edge.source,
          target: edge.target,
          type: edge.kind,
        });
      }
    }
  });

  return { nodes: hierarchyNodes, links: hierarchyLinks };
}

// Build business-focused clusters
function buildBusinessClusters(
  entities: GraphApiNode[],
  edges: GraphApiEdge[]
): { nodes: HierarchyNode[]; links: HierarchyLink[] } {
  const clusters = new Map<string, HierarchyNode>();
  const nodeToCluster = new Map<string, string>();
  const hierarchyNodes: HierarchyNode[] = [];
  const hierarchyLinks: HierarchyLink[] = [];

  // Group by feature context
  entities.forEach(entity => {
    const groupKey = entity.featureContext || 'Uncategorized';
    const clusterId = `cluster://${groupKey}`;

    if (!clusters.has(clusterId)) {
      clusters.set(clusterId, {
        id: clusterId,
        label: groupKey,
        kind: 'cluster',
        type: 'directory',
        level: 0,
        isCluster: true,
        clusterNodes: [],
        val: 20,
        featureContext: groupKey,
      });
    }

    const cluster = clusters.get(clusterId)!;
    cluster.clusterNodes!.push(entity.id);
    nodeToCluster.set(entity.id, clusterId);

    // Add entity node
    hierarchyNodes.push({
      id: entity.id,
      label: entity.label,
      kind: entity.kind,
      type: 'entity',
      level: 1,
      confidence: entity.confidence,
      classification: entity.classification,
      featureContext: entity.featureContext,
      parentId: clusterId,
      val: 6,
    });

    // Link cluster -> entity
    hierarchyLinks.push({
      source: clusterId,
      target: entity.id,
      type: 'contains',
    });
  });

  // Add cluster nodes
  clusters.forEach(cluster => {
    cluster.val = 10 + (cluster.clusterNodes?.length || 0) * 0.5;
    hierarchyNodes.unshift(cluster);
  });

  // Add cross-cluster edges
  edges.forEach(edge => {
    const sourceCluster = nodeToCluster.get(edge.source);
    const targetCluster = nodeToCluster.get(edge.target);

    if (sourceCluster && targetCluster && sourceCluster !== targetCluster) {
      hierarchyLinks.push({
        source: edge.source,
        target: edge.target,
        type: edge.kind,
      });
    }
  });

  return { nodes: hierarchyNodes, links: hierarchyLinks };
}

// Build infrastructure layers
function buildInfraLayers(
  entities: GraphApiNode[],
  edges: GraphApiEdge[],
  classifications: Map<string, string>
): { nodes: HierarchyNode[]; links: HierarchyLink[] } {
  const layers = new Map<string, HierarchyNode>();
  const hierarchyNodes: HierarchyNode[] = [];
  const hierarchyLinks: HierarchyLink[] = [];

  // Create layer nodes
  ['domain', 'infrastructure', 'unknown'].forEach((layer) => {
    const layerId = `layer://${layer}`;
    layers.set(layer, {
      id: layerId,
      label: layer.charAt(0).toUpperCase() + layer.slice(1),
      kind: 'layer',
      type: 'directory',
      level: 0,
      isCluster: true,
      clusterNodes: [],
      val: 25,
      classification: layer,
    });
  });

  // Assign entities to layers
  entities.forEach(entity => {
    const classification = classifications.get(entity.id) || entity.classification || 'unknown';
    const layer = layers.get(classification) || layers.get('unknown')!;
    const layerId = layer.id;

    layer.clusterNodes!.push(entity.id);

    hierarchyNodes.push({
      id: entity.id,
      label: entity.label,
      kind: entity.kind,
      type: 'entity',
      level: 1,
      confidence: entity.confidence,
      classification,
      featureContext: entity.featureContext,
      parentId: layerId,
      val: 5,
    });

    hierarchyLinks.push({
      source: layerId,
      target: entity.id,
      type: 'contains',
    });
  });

  // Add layer nodes
  layers.forEach(layer => {
    if (layer.clusterNodes && layer.clusterNodes.length > 0) {
      hierarchyNodes.unshift(layer);
    }
  });

  // Add actual edges
  const entityIds = new Set(entities.map(e => e.id));
  edges.forEach(edge => {
    if (entityIds.has(edge.source) && entityIds.has(edge.target) && edge.kind !== 'contains') {
      hierarchyLinks.push({
        source: edge.source,
        target: edge.target,
        type: edge.kind,
      });
    }
  });

  return { nodes: hierarchyNodes, links: hierarchyLinks };
}

// =============================================================================
// Node Drawing Functions
// =============================================================================

function getNodeColor(node: HierarchyNode, activeLens: LensType): string {
  if (node.type === 'directory') return '#475569'; // Slate-600
  if (node.type === 'file') return '#eab308'; // Yellow-500

  if (activeLens === 'pattern') {
    const confidence = node.confidence ?? 0.5;
    if (confidence >= 0.8) return '#10b981'; // Emerald-500
    if (confidence >= 0.5) return '#f59e0b'; // Amber-500
    return '#ef4444'; // Red-500
  }

  if (activeLens === 'infra') {
    if (node.classification === 'domain') return '#3b82f6'; // Blue-500
    if (node.classification === 'infrastructure') return '#64748b'; // Slate-500
    return '#475569'; // Slate-600
  }

  // Neon Palette based on Kind
  if (node.kind === 'function') return '#3b82f6'; // Blue-500
  if (node.kind === 'class') return '#a855f7'; // Purple-500
  if (node.kind === 'interface') return '#06b6d4'; // Cyan-500
  if (node.kind === 'variable') return '#94a3b8'; // Slate-400
  return '#64748b'; // Slate-500
}

function getNodeSize(node: HierarchyNode, activeLens: LensType): number {
  // Hub sizing: larger if have higher degree (stored in val)
  if (node.val && node.val > 6) return node.val;

  // Hub sizing: larger if it has more connections or children
  const baseSize = (() => {
    if (node.type === 'directory') return 14;
    if (node.type === 'file') return 10;
    if (node.isCluster) return Math.max(12, 8 + (node.clusterNodes?.length || 0) * 0.4);

    // Entity sizing based on importance/confidence
    let size = 6;
    if (activeLens === 'pattern') {
      size = 5 + (node.confidence ?? 0.5) * 5;
    }
    return size;
  })();

  return baseSize;
}

function renderNode(
  node: HierarchyNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  activeLens: LensType,
  isHovered: boolean,
  isFocused: boolean,
  isSearchResult: boolean,
  neighbors: Set<string> | null
) {
  // LOD: Hide small details at low zoom
  if (globalScale < 0.5 && node.level > 1 && !isHovered && !isFocused && !isSearchResult) {
    return; // Skip rendering small nodes at high altitude
  }

  // Focus Mode: Fade out non-neighbors
  const isNeighbor = neighbors ? neighbors.has(node.id) : true;
  const isHighlighted = isHovered || isFocused || isSearchResult;
  const opacity = (isHighlighted || (neighbors && isNeighbor)) ? 1 : (neighbors ? 0.1 : 1);

  if (opacity < 0.2 && !node.isCluster && node.type !== 'directory') return; // Skip drawing very faint nodes

  const x = node.x!;
  const y = node.y!;
  const baseRadius = getNodeSize(node, activeLens);
  // Scale up highlighted nodes
  const radius = isHighlighted ? baseRadius * 1.5 : baseRadius;
  const color = getNodeColor(node, activeLens);

  ctx.globalAlpha = opacity;

  // Glow effect for focused/hovered nodes
  if (isHighlighted) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 10, 0, Math.PI * 2);
    ctx.fillStyle = isSearchResult ? 'rgba(251, 191, 36, 0.2)' : `${color}40`; // 25% opacity
    ctx.fill();

    // Outer ring
    ctx.beginPath();
    ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
    ctx.strokeStyle = isSearchResult ? '#fbbf24' : color;
    ctx.lineWidth = 2 / globalScale;
    ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = isHighlighted ? 2 / globalScale : 0;

  // Draw shape based on type
  if (node.type === 'directory') {
    // Folder - Rounded Rect
    const w = radius * 2.2;
    const h = radius * 1.6;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 4);
    ctx.fillStyle = 'rgba(30, 41, 59, 0.9)'; // Slate-800
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / globalScale;
    ctx.stroke();

    // Tab
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2 - h * 0.15, w * 0.4, h * 0.2, 2);
    ctx.fill();
  } else if (node.type === 'file') {
    // File - Doc shape
    const w = radius * 1.8;
    const h = radius * 2.2;
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.rect(x - w / 2, y - h / 2, w, h);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / globalScale;
    ctx.stroke();
    // Color header
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, y - h / 2, w, h * 0.2);
  } else if (node.isCluster) {
    // Cluster - Dashed Circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `${color}20`;
    ctx.fill();
    ctx.setLineDash([6 / globalScale, 4 / globalScale]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / globalScale;
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (node.kind === 'class') {
    // Hexagon
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      ctx.lineTo(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
    }
    ctx.closePath();
    ctx.fill();
    if (isHighlighted) ctx.stroke();
  } else if (node.kind === 'interface') {
    // Diamond
    ctx.beginPath();
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x + radius, y);
    ctx.lineTo(x, y + radius);
    ctx.lineTo(x - radius, y);
    ctx.closePath();
    ctx.fill();
    if (isHighlighted) ctx.stroke();
  } else {
    // Circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (isHighlighted) ctx.stroke();
  }

  // Confidence Indicator (Ring)
  if (node.confidence !== undefined && activeLens === 'pattern' && node.type === 'entity') {
    ctx.beginPath();
    ctx.arc(x, y, radius + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * node.confidence);
    ctx.strokeStyle = node.confidence > 0.8 ? '#10b981' : (node.confidence > 0.5 ? '#f59e0b' : '#ef4444');
    ctx.lineWidth = 2.5 / globalScale;
    ctx.stroke();
  }

  ctx.globalAlpha = 1; // Reset opacity

  // Labels - LOD Aware
  const isComponent = node.type === 'directory' || node.type === 'file' || node.isCluster;
  // Show labels if: component OR highlighted OR zoomed in enough
  let showLabel = isHighlighted || isSearchResult;

  if (!showLabel) {
    if (globalScale < 0.8) showLabel = !!isComponent; // High altitude: only components
    else if (globalScale < 1.5) showLabel = isComponent || node.level <= 1; // Mid: components + top level entities
    else showLabel = true; // Low: show all
  }

  if (showLabel) {
    const fontSize = Math.max(10, 14 / globalScale);
    ctx.font = `${isComponent || isHighlighted ? '600 ' : '400 '}${fontSize}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const label = node.isCluster
      ? `${node.label} (${node.clusterNodes?.length || 0})`
      : node.label;

    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;
    const padding = 6 / globalScale;
    const bgHeight = fontSize + padding * 1.5;
    const bgY = y + radius + 6;

    // Label pill background
    ctx.fillStyle = isHighlighted ? 'rgba(139, 92, 246, 0.9)' : 'rgba(2, 6, 23, 0.8)'; // Violet highlight or dark slate

    // Fade out label background for non-highlighted items at distance
    if (!isHighlighted) ctx.globalAlpha = 0.8;

    ctx.roundRect(x - textWidth / 2 - padding, bgY, textWidth + padding * 2, bgHeight, 4);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Label Text
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(label, x, bgY + padding / 2);
  }
}

// =============================================================================
// Main Component
// =============================================================================

export function GraphView() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<ForceGraphMethods<any, any>>(null!);
  const containerRef = useRef<HTMLDivElement>(null);
  const { nodes, edges, setGraphData, focusedNode, setFocusedNode, activeLens, setActiveLens } =
    useGraphStore();
  const { setSelectedEntity } = useUIStore();

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 800,
    height: typeof window !== 'undefined' ? window.innerHeight - 200 : 600
  });
  const [hoverNode, setHoverNode] = useState<HierarchyNode | null>(null);
  const [filterKinds, setFilterKinds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [showInspector, setShowInspector] = useState(true);
  const [hasInitialZoom, setHasInitialZoom] = useState(false);
  const [fileTree, setFileTree] = useState<FileTree[]>([]);
  const [classifications, setClassifications] = useState<Map<string, string>>(new Map());
  const [showContainmentEdges, setShowContainmentEdges] = useState(false);

  // Zoom tracking
  const [currentZoom, setCurrentZoom] = useState(1);
  const detailLevel: DetailLevel = useMemo(() => {
    if (currentZoom < 0.5) return 'groups-only';
    if (currentZoom < 1) return 'groups-with-labels';
    if (currentZoom < 2) return 'sparse-nodes';
    return 'full-detail';
  }, [currentZoom]);

  // ==========================================================================
  // Data Loading
  // ==========================================================================

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setHasInitialZoom(false);

      try {
        // Load all data in parallel
        const [graphResult, treeResult, classResult] = await Promise.all([
          getGraphData({ depth: 3 }),
          getFileTree().catch(() => [] as FileTree[]),
          getClassifications({ limit: 1000 }).catch(() => []),
        ]);

        // Build classification map
        const classMap = new Map<string, string>();
        classResult.forEach(c => classMap.set(c.entityId, c.category));
        setClassifications(classMap);

        // Store raw data
        setFileTree(treeResult);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setGraphData(graphResult.nodes as any, graphResult.edges);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load graph data');
        setLoading(false);
      }
    };

    loadData();
  }, [setGraphData]);

  // ==========================================================================
  // Graph Data Processing based on Active Lens
  // ==========================================================================

  // Result of data processing
  const graphData = useMemo(() => {
    if (nodes.length === 0) return { nodes: [], links: [] };

    // Apply kind filters
    const filteredNodes = filterKinds.length > 0
      ? nodes.filter(n => filterKinds.includes(n.kind))
      : nodes;

    const typedNodes = filteredNodes as GraphApiNode[];
    const typedEdges = edges as GraphApiEdge[];

    let result = { nodes: [] as HierarchyNode[], links: [] as HierarchyLink[] };

    if (activeLens === 'structure' && fileTree.length > 0) {
      result = buildHierarchicalData(fileTree, typedNodes, typedEdges, classifications);
    } else if (activeLens === 'business') {
      result = buildBusinessClusters(typedNodes, typedEdges);
    } else if (activeLens === 'infra') {
      result = buildInfraLayers(typedNodes, typedEdges, classifications);
    } else {
      // Pattern view
      const patternNodes: HierarchyNode[] = filteredNodes.map(n => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        type: 'entity' as const,
        level: 0,
        confidence: (n as GraphApiNode).confidence,
        classification: (n as GraphApiNode).classification,
        featureContext: (n as GraphApiNode).featureContext,
        val: 4 + ((n as GraphApiNode).confidence ?? 0.5) * 6,
      }));

      const nodeIds = new Set(patternNodes.map(n => n.id));
      const patternLinks: HierarchyLink[] = edges
        .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
        .map(e => ({ source: e.source, target: e.target, type: e.kind }));

      result = { nodes: patternNodes, links: patternLinks };
    }

    // Calculate degrees for sizing
    const degreeMap = new Map<string, number>();
    result.links.forEach(link => {
      const s = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const t = typeof link.target === 'object' ? (link.target as any).id : link.target;
      degreeMap.set(s, (degreeMap.get(s) || 0) + 1);
      degreeMap.set(t, (degreeMap.get(t) || 0) + 1);
    });

    // Enrich nodes with degree info (stored in 'val' or custom property if type allows, reusing 'val' for simplicity)
    result.nodes.forEach(node => {
      const degree = degreeMap.get(node.id) || 0;
      // Boost size based on degree, capped
      if (!node.val) node.val = 5;
      node.val += Math.min(degree, 20) * 0.5;
    });

    return result;
  }, [nodes, edges, activeLens, filterKinds, fileTree, classifications]);

  // ==========================================================================
  // Layout Configuration
  // ==========================================================================

  // ==========================================================================
  // Layout Configuration
  // ==========================================================================

  const dagMode = useMemo(() => {
    if (activeLens === 'structure') return 'td' as const; // Top-down tree
    if (activeLens === 'infra') return 'lr' as const; // Left-right layers
    if (activeLens === 'business') return 'radialout' as const; // Radial clusters
    return undefined; // Force-directed for pattern
  }, [activeLens]);

  // Configure forces based on lens
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    const charge = fg.d3Force('charge');
    const link = fg.d3Force('link');

    // Enhanced physics for better spacing
    if (activeLens === 'structure') {
      charge?.strength(-500); // Stronger repulsion for tree
      link?.distance(100);
    } else if (activeLens === 'business') {
      charge?.strength(-400);
      link?.distance(150);
    } else if (activeLens === 'infra') {
      charge?.strength(-450);
      link?.distance(120);
    } else {
      // Pattern/Default view - maximum spacing
      charge?.strength(-600);
      link?.distance(120);
    }

    // Add collision detection with larger radius for better spacing
    fg.d3Force('collide', null);
    import('d3-force').then(d3 => {
      fg.d3Force('collide', d3.forceCollide().radius((node) => {
        const size = getNodeSize(node as HierarchyNode, activeLens);
        // Add significant padding to prevent overlap
        return size * 3;
      }).strength(0.9));

      // Add center force to keep graph centered but allow drift
      fg.d3Force('center', d3.forceCenter(dimensions.width / 2, dimensions.height / 2).strength(0.1));
    });

    fg.d3ReheatSimulation();
  }, [activeLens, graphData, dimensions]);

  // ==========================================================================
  // Effects
  // ==========================================================================

  // Initial zoom to fit with more padding
  useEffect(() => {
    if (!loading && graphData.nodes.length > 0 && !hasInitialZoom) {
      const timer = setTimeout(() => {
        fgRef.current?.zoomToFit(500, 120);
        setHasInitialZoom(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [loading, graphData.nodes.length, hasInitialZoom]);

  // Reset zoom when lens changes
  useEffect(() => {
    if (hasInitialZoom) {
      setTimeout(() => {
        fgRef.current?.zoomToFit(500, 100);
      }, 300);
    }
  }, [activeLens, hasInitialZoom]);

  const handleZoom = useCallback((zoom: { k: number }) => {
    setCurrentZoom(zoom.k);
  }, []);

  // Focus Mode: Calculate neighbors
  const neighbors = useMemo(() => {
    if (!hoverNode && !focusedNode) return null;
    const targetId = hoverNode?.id || focusedNode;
    if (!targetId) return null;

    const neighborSet = new Set<string>();
    neighborSet.add(targetId);

    // Find all connected nodes
    graphData.links.forEach(link => {
      // Handle both object (after d3 processes) and string/number types
      const s = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const t = typeof link.target === 'object' ? (link.target as any).id : link.target;

      if (s === targetId) neighborSet.add(t);
      if (t === targetId) neighborSet.add(s);
    });

    return neighborSet;
  }, [hoverNode, focusedNode, graphData.links]);

  // Container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateDimensions = () => {
      const width = container.clientWidth || container.offsetWidth;
      const height = container.clientHeight || container.offsetHeight;
      if (width > 0 && height > 0) {
        setDimensions({ width, height });
      }
    };

    updateDimensions();
    const timers = [
      setTimeout(updateDimensions, 50),
      setTimeout(updateDimensions, 200),
      setTimeout(updateDimensions, 500),
    ];

    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(container);
    window.addEventListener('resize', updateDimensions);

    return () => {
      timers.forEach(clearTimeout);
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateDimensions);
    };
  }, []);

  // Search functionality
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const query = searchQuery.toLowerCase();
    const results = graphData.nodes
      .filter(n => n.label.toLowerCase().includes(query))
      .map(n => n.id);
    setSearchResults(results);
  }, [searchQuery, graphData.nodes]);

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  const handleNodeClick = useCallback((node: HierarchyNode) => {
    if (node.type === 'directory' || node.isCluster) {
      // Zoom into cluster/directory
      fgRef.current?.centerAt(node.x, node.y, 500);
      fgRef.current?.zoom(2.5, 500);
      return;
    }

    if (node.type === 'file') {
      // Center on file
      fgRef.current?.centerAt(node.x, node.y, 500);
      fgRef.current?.zoom(3, 500);
      return;
    }

    setFocusedNode(node.id);
    setSelectedEntity({
      id: node.id,
      name: node.label,
      kind: node.kind as 'function' | 'class' | 'interface' | 'file' | 'variable',
      filePath: node.filePath || '',
      startLine: 0,
      endLine: 0,
    });

    fgRef.current?.centerAt(node.x, node.y, 500);
  }, [setFocusedNode, setSelectedEntity]);

  const handleNodeHover = useCallback((node: HierarchyNode | null) => {
    setHoverNode(node);
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? 'pointer' : 'grab';
    }
  }, []);

  const handleFocusNode = useCallback((nodeId: string) => {
    const node = graphData.nodes.find(n => n.id === nodeId);
    if (node) {
      handleNodeClick(node);
    }
    setSearchQuery('');
    setSearchResults([]);
  }, [graphData.nodes, handleNodeClick]);

  const handleExport = useCallback(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'knowledge-graph.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  const toggleKindFilter = (kind: string) => {
    setFilterKinds(prev =>
      prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind]
    );
  };

  // ==========================================================================
  // Render
  // ==========================================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <RefreshCw className="w-6 h-6 animate-spin mr-2" />
        Loading graph data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        <AlertTriangle className="w-6 h-6 mr-2" />
        Error: {error}
      </div>
    );
  }

  const focusedNodeData = focusedNode ? nodes.find(n => n.id === focusedNode) : null;
  // Transform edges from API format (kind) to internal format (type)
  const outgoingEdges = focusedNode
    ? edges.filter(e => e.source === focusedNode).map(e => ({ source: e.source, target: e.target, type: e.kind }))
    : [];
  const incomingEdges = focusedNode
    ? edges.filter(e => e.target === focusedNode).map(e => ({ source: e.source, target: e.target, type: e.kind }))
    : [];

  return (
    <div className="h-full flex">
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b border-slate-700 p-4 bg-slate-800/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GitBranch className="w-5 h-5 text-blue-400" />
              <h1 className="text-xl font-semibold text-white">Knowledge Graph</h1>
              <span className="text-sm text-slate-500">
                {graphData.nodes.length} nodes, {graphData.links.length} edges
              </span>
            </div>

            {/* Lens Switcher */}
            <div className="flex items-center gap-1 bg-slate-700 rounded-lg p-1">
              <LensButton
                active={activeLens === 'structure'}
                onClick={() => setActiveLens('structure')}
                label="Components"
                lens="structure"
                icon={<FileCode className="w-3 h-3" />}
              />
              <LensButton
                active={activeLens === 'business'}
                onClick={() => setActiveLens('business')}
                label="Features"
                lens="business"
                icon={<Box className="w-3 h-3" />}
              />
              <LensButton
                active={activeLens === 'infra'}
                onClick={() => setActiveLens('infra')}
                label="Layers"
                lens="infra"
                icon={<Database className="w-3 h-3" />}
              />
              <LensButton
                active={activeLens === 'pattern'}
                onClick={() => setActiveLens('pattern')}
                label="Confidence"
                lens="pattern"
                icon={<Layers className="w-3 h-3" />}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4 mt-4">
            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search nodes..."
                className="w-full pl-9 pr-8 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setSearchResults([]); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              )}
              {searchResults.length > 0 && searchQuery && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50">
                  {searchResults.slice(0, 10).map((nodeId) => {
                    const node = graphData.nodes.find(n => n.id === nodeId);
                    if (!node) return null;
                    return (
                      <button
                        key={nodeId}
                        onClick={() => handleFocusNode(nodeId)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-700 flex items-center gap-2"
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getNodeColor(node, activeLens) }} />
                        <span className="text-slate-200">{node.label}</span>
                        <span className="text-slate-500 text-xs ml-auto">{node.kind}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 bg-slate-700 rounded-lg p-1">
              <button onClick={() => fgRef.current?.zoom(currentZoom / 1.5, 300)} className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white" title="Zoom Out">
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="px-2 text-sm text-slate-400 min-w-12 text-center">{Math.round(currentZoom * 100)}%</span>
              <button onClick={() => fgRef.current?.zoom(currentZoom * 1.5, 300)} className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white" title="Zoom In">
                <ZoomIn className="w-4 h-4" />
              </button>
              <button onClick={() => fgRef.current?.zoomToFit(400, 80)} className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white" title="Fit to Screen">
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <FilterButton active={filterKinds.includes('function')} onClick={() => toggleKindFilter('function')} color="blue" label="Functions" />
              <FilterButton active={filterKinds.includes('class')} onClick={() => toggleKindFilter('class')} color="purple" label="Classes" />
              <FilterButton active={filterKinds.includes('interface')} onClick={() => toggleKindFilter('interface')} color="cyan" label="Interfaces" />
            </div>

            {/* Show containment edges toggle */}
            <button
              onClick={() => setShowContainmentEdges(!showContainmentEdges)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${showContainmentEdges ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}
              title="Toggle hierarchy edges"
            >
              <Settings2 className="w-3 h-3" />
              Hierarchy
            </button>

            {/* Focus Mode toggle */}
            <button
              onClick={() => {
                if (focusedNode) setFocusedNode(null); // Clear focus if active
                // There isn't an explicit "mode" state, but clearing focus resets it. 
                // The user requested a "Mode" to isolate subgraphs. 
                // Current implementation isolates on click. A button might be redundant 
                // unless it acts as a "Reset Focus" or "Help" tip. 
                // Let's add a "Reset View" or clear selection here if focus is active.
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${focusedNode ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}
              disabled={!focusedNode}
              title="Clear focus"
            >
              <Maximize2 className="w-3 h-3" />
              Reset Focus
            </button>

            <div className="flex-1" />

            <DetailLevelIndicator detailLevel={detailLevel} />

            <button onClick={handleExport} className="btn btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" />Export
            </button>
            <button onClick={() => setShowInspector(!showInspector)} className={`btn ${showInspector ? 'btn-primary' : 'btn-secondary'} flex items-center gap-2`}>
              <Brain className="w-4 h-4" />Inspector
            </button>
          </div>
        </div>

        {/* Graph Canvas */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden bg-slate-900" style={{ minHeight: '400px' }}>
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}

            // Layout
            dagMode={dagMode}
            dagLevelDistance={activeLens === 'structure' ? 100 : activeLens === 'infra' ? 120 : 80}
            dagNodeFilter={(node: HierarchyNode) => node.type === 'directory' || node.type === 'file' || node.type === 'entity'}
            d3VelocityDecay={0.4}

            // Appearance
            backgroundColor="#0f172a"
            nodeRelSize={6}
            nodeVal={(node: HierarchyNode) => node.val || 5}

            // Links
            // Links
            linkColor={(link: HierarchyLink) => {
              const type = typeof link.type === 'string' ? link.type : 'unknown';

              // Dimming logic for focus mode
              if (neighbors) {
                const s = typeof link.source === 'object' ? (link.source as any).id : link.source;
                const t = typeof link.target === 'object' ? (link.target as any).id : link.target;
                if (!neighbors.has(s) || !neighbors.has(t)) return '#1e293b'; // Dimmed deeply
              }

              // Hide containment edges at low zoom
              if (currentZoom < 0.8 && type === 'contains') return 'transparent';

              if (type === 'contains') return showContainmentEdges ? 'rgba(255, 255, 255, 0.1)' : 'transparent';
              if (type === 'calls') return '#3b82f680';
              if (type === 'imports') return '#10b98180';
              if (type === 'extends') return '#f59e0b80';
              if (type === 'implements') return '#8b5cf680';
              return '#47556980';
            }}
            linkWidth={(link: HierarchyLink) => {
              const type = typeof link.type === 'string' ? link.type : 'unknown';

              // Hide containment edges at low zoom
              if (currentZoom < 0.8 && type === 'contains') return 0;

              // Dimming logic for focus mode
              if (neighbors) {
                const s = typeof link.source === 'object' ? (link.source as any).id : link.source;
                const t = typeof link.target === 'object' ? (link.target as any).id : link.target;
                if (!neighbors.has(s) || !neighbors.has(t)) return 0.5;
              }

              if (link.type === 'contains') return showContainmentEdges ? 0.5 : 0;
              if (link.count) return Math.min(1 + Math.log2(link.count), 5);
              return 1.5;
            }}
            linkDirectionalArrowLength={(link: HierarchyLink) => link.type === 'contains' ? 0 : 4}
            linkDirectionalArrowRelPos={0.9}
            linkCurvature={0.1}
            linkLineDash={(link: HierarchyLink) => link.type === 'contains' ? [2, 2] : []}

            // Custom rendering
            nodeCanvasObject={(node, ctx, globalScale) => {
              renderNode(
                node as HierarchyNode,
                ctx,
                globalScale,
                activeLens,
                node === hoverNode,
                node.id === focusedNode,
                searchResults.includes(node.id),
                neighbors
              );
            }}
            nodePointerAreaPaint={(node: HierarchyNode, color, ctx) => {
              const radius = getNodeSize(node, activeLens) * 2;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);
              ctx.fill();
            }}

            // Interactions
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
            onZoom={handleZoom}
            enableNodeDrag={true}
            enablePanInteraction={true}
            enableZoomInteraction={true}

            // Performance - more iterations for better layout convergence
            warmupTicks={150}
            cooldownTicks={300}
            cooldownTime={8000}
            minZoom={0.1}
            maxZoom={10}
          />

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-slate-800/95 border border-slate-700 rounded-lg p-3 text-xs">
            <div className="text-slate-500 font-medium mb-2">
              {activeLens === 'structure' && 'Component Hierarchy'}
              {activeLens === 'business' && 'Feature Clusters'}
              {activeLens === 'infra' && 'Architecture Layers'}
              {activeLens === 'pattern' && 'Confidence Levels'}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {activeLens === 'structure' && (
                <>
                  <div className="flex items-center gap-2">
                    <Folder className="w-3 h-3 text-slate-400" />
                    <span className="text-slate-400">Directory</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FileCode className="w-3 h-3 text-blue-400" />
                    <span className="text-slate-400">File</span>
                  </div>
                </>
              )}
              {activeLens === 'infra' && (
                <>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-slate-400">Domain</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="text-slate-400">Infrastructure</span>
                  </div>
                </>
              )}
              {activeLens === 'pattern' && (
                <>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-slate-400">High Confidence</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="text-slate-400">Medium</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-slate-400">Low Confidence</span>
                  </div>
                </>
              )}
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                <span className="text-slate-400">Function</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-purple-500" />
                <span className="text-slate-400">Class</span>
              </div>
            </div>
            <div className="text-slate-500 font-medium mt-3 mb-2">Edge Types</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-blue-500" />
                <span className="text-slate-400">Calls</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-emerald-500" />
                <span className="text-slate-400">Imports</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-amber-500" />
                <span className="text-slate-400">Extends</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-purple-500" />
                <span className="text-slate-400">Implements</span>
              </div>
            </div>
          </div>

          {/* Lens hint */}
          {activeLens === 'structure' && (
            <div className="absolute top-4 left-4 bg-blue-500/20 text-blue-400 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2">
              <FileCode className="w-4 h-4" />
              Directory → File → Entity hierarchy
            </div>
          )}
          {activeLens === 'business' && (
            <div className="absolute top-4 left-4 bg-purple-500/20 text-purple-400 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2">
              <Box className="w-4 h-4" />
              Grouped by feature context
            </div>
          )}
          {activeLens === 'infra' && (
            <div className="absolute top-4 left-4 bg-amber-500/20 text-amber-400 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2">
              <Database className="w-4 h-4" />
              Domain vs Infrastructure layers
            </div>
          )}
        </div>
      </div>

      {/* Inspector Panel */}
      {showInspector && focusedNodeData && (
        <Inspector
          node={focusedNodeData as InspectorGraphNode}
          nodes={nodes as InspectorGraphNode[]}
          outgoingEdges={outgoingEdges}
          incomingEdges={incomingEdges}
          onClose={() => {
            setFocusedNode(null);
          }}
          onFocusConnected={() => {
            if (focusedNodeData) {
              fgRef.current?.centerAt(
                graphData.nodes.find(n => n.id === focusedNode)?.x,
                graphData.nodes.find(n => n.id === focusedNode)?.y,
                500
              );
              fgRef.current?.zoom(2, 500);
            }
          }}
          onTracePaths={() => {
            // Highlight connected nodes
            const connected = new Set<string>();
            edges.forEach(e => {
              if (e.source === focusedNode) connected.add(e.target);
              if (e.target === focusedNode) connected.add(e.source);
            });
          }}
        />
      )}
    </div>
  );
}

export default GraphView;

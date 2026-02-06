import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  GitBranch,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Filter,
  Target,
  Search,
  Download,
  Focus,
  X,
  Layers,
  Box,
  Hash,
  Database,
  Globe,
  AlertTriangle,
  ArrowRight,
  Brain,
  Activity,
  FileCode,
  ChevronRight,
} from 'lucide-react';
import { useGraphStore, useUIStore } from '../../store';
import { getGraphData } from '../../api/client';

// =============================================================================
// Type Definitions
// =============================================================================

interface NodePosition {
  x: number;
  y: number;
  vx?: number; // velocity for physics
  vy?: number;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string | null;
}

type NodeShape = 'circle' | 'hexagon' | 'cylinder' | 'diamond' | 'square';
type EdgeStyle = 'solid' | 'dashed' | 'animated' | 'zigzag';

// =============================================================================
// Shape Drawing Utilities
// =============================================================================

function drawHexagon(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const px = x + radius * Math.cos(angle);
    const py = y + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawCylinder(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  const height = radius * 1.4;
  const ellipseHeight = radius * 0.4;

  // Bottom ellipse
  ctx.beginPath();
  ctx.ellipse(x, y + height / 2, radius, ellipseHeight, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.beginPath();
  ctx.rect(x - radius, y - height / 2 + ellipseHeight / 2, radius * 2, height - ellipseHeight);
  ctx.fill();

  // Top ellipse (with stroke for 3D effect)
  ctx.beginPath();
  ctx.ellipse(x, y - height / 2 + ellipseHeight / 2, radius, ellipseHeight, 0, 0, Math.PI * 2);
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius, y);
  ctx.closePath();
}

function drawSquare(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  const size = radius * 1.5;
  ctx.beginPath();
  ctx.rect(x - size / 2, y - size / 2, size, size);
}

// Draw dashed edge
function drawDashedEdge(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
) {
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Draw animated edge (dots moving along line)
function drawAnimatedEdge(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  time: number
) {
  // Draw base line
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Draw moving dots
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.sqrt(dx * dx + dy * dy);
  const dotCount = Math.floor(length / 30);

  for (let i = 0; i < dotCount; i++) {
    const t = ((time / 1000 + i / dotCount) % 1);
    const dotX = fromX + dx * t;
    const dotY = fromY + dy * t;

    ctx.beginPath();
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Draw zigzag edge (for violations)
function drawZigzagEdge(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.sqrt(dx * dx + dy * dy);
  const segments = Math.floor(length / 10);
  const amplitude = 5;

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const baseX = fromX + dx * t;
    const baseY = fromY + dy * t;

    // Perpendicular offset for zigzag
    const perpX = -dy / length * amplitude * (i % 2 === 0 ? 1 : -1);
    const perpY = dx / length * amplitude * (i % 2 === 0 ? 1 : -1);

    ctx.lineTo(baseX + perpX, baseY + perpY);
  }

  ctx.stroke();
}

// =============================================================================
// Main Component
// =============================================================================

export function GraphView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const { nodes, edges, setGraphData, focusedNode, setFocusedNode, activeLens, setActiveLens } =
    useGraphStore();
  const { setSelectedEntity } = useUIStore();

  // Core state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [nodePositions, setNodePositions] = useState<Map<string, NodePosition>>(new Map());
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<{ source: string; target: string; type: string } | null>(null);
  const [filterKinds, setFilterKinds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [focusMode, setFocusMode] = useState(false);
  const [focusDepth, setFocusDepth] = useState(2);

  // New state for enhanced features
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, nodeId: null });
  const [pathTraceTarget, setPathTraceTarget] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  const [animationTime, setAnimationTime] = useState(0);
  const [useForceLayout, setUseForceLayout] = useState(false);
  const [highlightedPaths, setHighlightedPaths] = useState<Set<string>>(new Set());

  // LOD (Level of Detail) based on zoom
  const lodLevel = useMemo(() => {
    if (zoom < 0.5) return 'domain'; // Show only domain bubbles
    if (zoom < 1) return 'cluster';  // Show feature clusters
    return 'detail';                 // Show all entities
  }, [zoom]);

  // Determine node shape based on classification and kind
  const getNodeShape = useCallback((node: typeof nodes[0]): NodeShape => {
    if (node.classification === 'domain') return 'hexagon';
    if (node.classification === 'infrastructure') return 'cylinder';
    if (node.kind === 'interface') return 'diamond';
    if (node.kind === 'file') return 'square';
    return 'circle';
  }, []);

  // Determine edge style based on type
  const getEdgeStyle = useCallback((edge: typeof edges[0]): EdgeStyle => {
    if (edge.type === 'justifies' || edge.type === 'relates_to') return 'dashed';
    if (edge.type === 'data_flow' || edge.type === 'passes_pii') return 'animated';
    if (edge.type === 'violates') return 'zigzag';
    return 'solid';
  }, []);

  // Get node color based on lens and properties
  const getNodeColor = useCallback((node: typeof nodes[0]): string => {
    if (activeLens === 'pattern') {
      // Pattern compliance heat map
      const confidence = node.confidence ?? 0.5;
      if (confidence >= 0.8) return '#10b981'; // Green - compliant
      if (confidence >= 0.5) return '#f59e0b'; // Yellow - warning
      return '#ef4444'; // Red - non-compliant / alien code
    }

    if (activeLens === 'infra') {
      // Infrastructure lens colors
      if (node.classification === 'domain') return '#3b82f6';
      if (node.classification === 'infrastructure') return '#f59e0b';
      return '#6b7280';
    }

    // Default structure/business lens
    if (node.kind === 'function') return '#3b82f6';
    if (node.kind === 'class') return '#a855f7';
    if (node.kind === 'interface') return '#06b6d4';
    if (node.kind === 'file') return '#10b981';
    return '#6b7280';
  }, [activeLens]);

  // Load graph data
  useEffect(() => {
    setLoading(true);
    getGraphData({ depth: 2 })
      .then((data) => {
        setGraphData(data.nodes as any, data.edges);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [setGraphData]);

  // Animation loop for animated edges
  useEffect(() => {
    const animate = () => {
      setAnimationTime(Date.now());
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, []);

  // Search functionality
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const query = searchQuery.toLowerCase();
    const results = nodes
      .filter((n) => n.label.toLowerCase().includes(query))
      .map((n) => n.id);
    setSearchResults(results);
  }, [searchQuery, nodes]);

  // Get nodes within N hops of focused node (for focus mode)
  const nodesInFocusRange = useMemo(() => {
    if (!focusMode || !focusedNode) return null;

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
  }, [focusMode, focusedNode, focusDepth, edges]);

  // Find all paths from a node (for "Show Usage Paths")
  const findUsagePaths = useCallback((startNodeId: string): Set<string> => {
    const pathNodes = new Set<string>();
    const pathEdges = new Set<string>();

    // BFS to find all connected nodes
    const visited = new Set<string>();
    const queue = [startNodeId];
    visited.add(startNodeId);
    pathNodes.add(startNodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Find all edges connected to this node
      edges.forEach((edge) => {
        if (edge.source === current || edge.target === current) {
          const edgeKey = `${edge.source}-${edge.target}`;
          pathEdges.add(edgeKey);

          const neighbor = edge.source === current ? edge.target : edge.source;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            pathNodes.add(neighbor);
            queue.push(neighbor);
          }
        }
      });
    }

    return pathEdges;
  }, [edges]);

  // Zoom to fit all visible nodes
  const handleZoomToFit = useCallback(() => {
    if (nodePositions.size === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const visibleNodeIds = focusMode && nodesInFocusRange
      ? nodesInFocusRange
      : new Set(
        filterKinds.length > 0
          ? nodes.filter((n) => filterKinds.includes(n.kind)).map((n) => n.id)
          : nodes.map((n) => n.id)
      );

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [id, pos] of nodePositions) {
      if (!visibleNodeIds.has(id)) continue;
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    }

    if (minX === Infinity) return;

    const padding = 50;
    const graphWidth = maxX - minX + padding * 2;
    const graphHeight = maxY - minY + padding * 2;

    const scaleX = canvas.width / graphWidth;
    const scaleY = canvas.height / graphHeight;
    const newZoom = Math.min(scaleX, scaleY, 2);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setZoom(newZoom);
    setPan({
      x: canvas.width / 2 - centerX * newZoom,
      y: canvas.height / 2 - centerY * newZoom,
    });
  }, [nodePositions, nodes, filterKinds, focusMode, nodesInFocusRange]);

  // Export canvas as PNG
  const handleExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = 'knowledge-graph.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  // Focus on a specific node from search
  const handleFocusNode = useCallback((nodeId: string) => {
    setFocusedNode(nodeId);
    setSearchQuery('');
    setSearchResults([]);

    const pos = nodePositions.get(nodeId);
    if (pos && canvasRef.current) {
      const canvas = canvasRef.current;
      setPan({
        x: canvas.width / 2 - pos.x * zoom,
        y: canvas.height / 2 - pos.y * zoom,
      });
    }
  }, [nodePositions, zoom, setFocusedNode]);

  // Force-directed layout simulation
  const runForceSimulation = useCallback(() => {
    if (nodes.length === 0) return new Map<string, NodePosition>();

    const positions = new Map<string, NodePosition>();
    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 600;

    // Initialize random positions
    nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      const radius = Math.min(width, height) * 0.3;
      positions.set(node.id, {
        x: width / 2 + radius * Math.cos(angle) + (Math.random() - 0.5) * 50,
        y: height / 2 + radius * Math.sin(angle) + (Math.random() - 0.5) * 50,
        vx: 0,
        vy: 0,
      });
    });

    // Run simulation iterations
    const iterations = 100;
    const repulsion = 5000;
    const attraction = 0.01;
    const damping = 0.9;
    const centerForce = 0.01;

    for (let iter = 0; iter < iterations; iter++) {
      // Repulsion between all nodes
      nodes.forEach((nodeA) => {
        const posA = positions.get(nodeA.id)!;
        nodes.forEach((nodeB) => {
          if (nodeA.id === nodeB.id) return;
          const posB = positions.get(nodeB.id)!;

          const dx = posA.x - posB.x;
          const dy = posA.y - posB.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;

          const force = repulsion / (dist * dist);
          posA.vx! += (dx / dist) * force;
          posA.vy! += (dy / dist) * force;
        });
      });

      // Attraction along edges
      edges.forEach((edge) => {
        const posA = positions.get(edge.source);
        const posB = positions.get(edge.target);
        if (!posA || !posB) return;

        const dx = posB.x - posA.x;
        const dy = posB.y - posA.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const force = dist * attraction;
        posA.vx! += dx * force;
        posA.vy! += dy * force;
        posB.vx! -= dx * force;
        posB.vy! -= dy * force;
      });

      // Center gravity
      nodes.forEach((node) => {
        const pos = positions.get(node.id)!;
        pos.vx! += (width / 2 - pos.x) * centerForce;
        pos.vy! += (height / 2 - pos.y) * centerForce;
      });

      // Apply velocities with damping
      nodes.forEach((node) => {
        const pos = positions.get(node.id)!;
        pos.x += pos.vx! * damping;
        pos.y += pos.vy! * damping;
        pos.vx! *= damping;
        pos.vy! *= damping;

        // Keep within bounds
        pos.x = Math.max(50, Math.min(width - 50, pos.x));
        pos.y = Math.max(50, Math.min(height - 50, pos.y));
      });
    }

    return positions;
  }, [nodes, edges]);

  // Calculate node positions based on active lens
  useEffect(() => {
    if (nodes.length === 0) return;

    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 600;
    let positions: Map<string, NodePosition>;

    if (useForceLayout) {
      positions = runForceSimulation();
    } else if (activeLens === 'business') {
      // Business Lens: Cluster by featureContext
      positions = new Map();
      const featureGroups = new Map<string, typeof nodes>();
      nodes.forEach((node) => {
        const feature = node.featureContext || 'Unknown';
        if (!featureGroups.has(feature)) featureGroups.set(feature, []);
        featureGroups.get(feature)!.push(node);
      });

      const featureList = Array.from(featureGroups.keys());
      const cols = Math.ceil(Math.sqrt(featureList.length));
      const cellWidth = width / cols;
      const cellHeight = height / Math.ceil(featureList.length / cols);

      featureList.forEach((feature, fIdx) => {
        const col = fIdx % cols;
        const row = Math.floor(fIdx / cols);
        const cx = cellWidth * col + cellWidth / 2;
        const cy = cellHeight * row + cellHeight / 2 + 60;
        const nodesInGroup = featureGroups.get(feature)!;
        const groupRadius = Math.min(cellWidth, cellHeight) * 0.3;

        nodesInGroup.forEach((node, i) => {
          const angle = (2 * Math.PI * i) / nodesInGroup.length;
          positions.set(node.id, {
            x: cx + groupRadius * Math.cos(angle),
            y: cy + groupRadius * Math.sin(angle),
          });
        });
      });
    } else if (activeLens === 'infra') {
      // Infrastructure Lens: Separate domain vs infrastructure
      positions = new Map();
      const domainNodes = nodes.filter(n => n.classification === 'domain');
      const infraNodes = nodes.filter(n => n.classification === 'infrastructure');
      const otherNodes = nodes.filter(n => !n.classification);

      // Domain nodes on left, infra on right, others in middle
      const layoutGroup = (group: typeof nodes, centerX: number, centerY: number, maxRadius: number) => {
        group.forEach((node, i) => {
          const angle = (2 * Math.PI * i) / group.length;
          const radius = Math.min(maxRadius, 50 + group.length * 5);
          positions.set(node.id, {
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle),
          });
        });
      };

      layoutGroup(domainNodes, width * 0.25, height / 2, 150);
      layoutGroup(infraNodes, width * 0.75, height / 2, 150);
      layoutGroup(otherNodes, width * 0.5, height / 2, 100);
    } else if (activeLens === 'pattern') {
      // Pattern Lens: Group by confidence/compliance
      positions = new Map();
      const highConf = nodes.filter(n => (n.confidence ?? 0) >= 0.8);
      const medConf = nodes.filter(n => (n.confidence ?? 0) >= 0.5 && (n.confidence ?? 0) < 0.8);
      const lowConf = nodes.filter(n => (n.confidence ?? 0) < 0.5);

      // Concentric rings: high confidence in center, low on outside
      const layoutRing = (group: typeof nodes, radius: number, startAngle: number = 0) => {
        group.forEach((node, i) => {
          const angle = startAngle + (2 * Math.PI * i) / group.length;
          positions.set(node.id, {
            x: width / 2 + radius * Math.cos(angle),
            y: height / 2 + radius * Math.sin(angle),
          });
        });
      };

      layoutRing(highConf, 80);
      layoutRing(medConf, 180);
      layoutRing(lowConf, 280);
    } else {
      // Structure Lens (default): Simple circular layout
      positions = new Map();
      const radius = Math.min(width, height) * 0.35;
      const centerX = width / 2;
      const centerY = height / 2;

      nodes.forEach((node, i) => {
        const angle = (2 * Math.PI * i) / nodes.length;
        positions.set(node.id, {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        });
      });
    }

    setNodePositions(positions);
  }, [nodes, edges, activeLens, useForceLayout, runForceSimulation]);

  // Draw graph on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // Apply zoom and pan
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Filter nodes by kind
    let visibleNodes =
      filterKinds.length > 0
        ? nodes.filter((n) => filterKinds.includes(n.kind))
        : nodes;

    // Apply focus mode filter
    if (focusMode && nodesInFocusRange) {
      visibleNodes = visibleNodes.filter((n) => nodesInFocusRange.has(n.id));
    }

    // LOD filtering - at low zoom, show only domain bubbles
    if (lodLevel === 'domain' && activeLens !== 'structure') {
      // Group nodes by feature and show only group representatives
      const featureReps = new Map<string, typeof nodes[0]>();
      visibleNodes.forEach(node => {
        const feature = node.featureContext || 'Unknown';
        if (!featureReps.has(feature)) {
          featureReps.set(feature, node);
        }
      });
      // In domain LOD, show feature labels instead of individual nodes
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      featureReps.forEach((node, feature) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return;

        // Draw domain bubble
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 40, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
        ctx.fill();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw feature name
        ctx.fillStyle = '#ffffff';
        ctx.fillText(feature.slice(0, 15), pos.x, pos.y + 5);
      });
      ctx.restore();
      return;
    }

    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

    // Draw edges first (behind nodes)
    edges.forEach((edge) => {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return;

      const from = nodePositions.get(edge.source);
      const to = nodePositions.get(edge.target);
      if (!from || !to) return;

      const isHoveredEdge = hoveredEdge?.source === edge.source && hoveredEdge?.target === edge.target;
      const isHighlighted = highlightedPaths.has(`${edge.source}-${edge.target}`);
      const edgeStyle = getEdgeStyle(edge);

      // Edge color based on type
      let edgeColor = '#475569';
      if (edge.type === 'calls') edgeColor = '#3b82f6';
      else if (edge.type === 'imports') edgeColor = '#10b981';
      else if (edge.type === 'extends') edgeColor = '#f59e0b';
      else if (edge.type === 'implements') edgeColor = '#8b5cf6';
      else if (edge.type === 'violates') edgeColor = '#ef4444';
      else if (edge.type === 'data_flow') edgeColor = '#06b6d4';

      ctx.strokeStyle = isHoveredEdge || isHighlighted ? '#ffffff' : edgeColor;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = isHoveredEdge || isHighlighted ? 3 : 1.5;

      // Dim edges not in highlighted paths
      if (highlightedPaths.size > 0 && !isHighlighted) {
        ctx.globalAlpha = 0.2;
      }

      // Draw edge based on style
      if (edgeStyle === 'dashed') {
        drawDashedEdge(ctx, from.x, from.y, to.x, to.y);
      } else if (edgeStyle === 'animated') {
        drawAnimatedEdge(ctx, from.x, from.y, to.x, to.y, animationTime);
      } else if (edgeStyle === 'zigzag') {
        drawZigzagEdge(ctx, from.x, from.y, to.x, to.y);
      } else {
        // Solid edge
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // Draw arrow head
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const arrowLength = 8;
      const arrowX = to.x - 12 * Math.cos(angle);
      const arrowY = to.y - 12 * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(
        arrowX - arrowLength * Math.cos(angle - Math.PI / 6),
        arrowY - arrowLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(
        arrowX - arrowLength * Math.cos(angle + Math.PI / 6),
        arrowY - arrowLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.stroke();

      // Draw edge type label on hover
      if (isHoveredEdge) {
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(midX - 30, midY - 10, 60, 20);
        ctx.strokeStyle = '#475569';
        ctx.strokeRect(midX - 30, midY - 10, 60, 20);
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(edge.type, midX, midY);
      }
    });

    // Draw nodes
    visibleNodes.forEach((node) => {
      const pos = nodePositions.get(node.id);
      if (!pos) return;

      const isHovered = hoveredNode === node.id;
      const isFocused = focusedNode === node.id;
      const isSearchResult = searchResults.includes(node.id);
      const isPathTraced = pathTraceTarget === node.id;
      const baseRadius = 10;
      const radius = isHovered || isFocused || isSearchResult ? baseRadius * 1.3 : baseRadius;

      // Dim nodes not in highlighted paths
      if (highlightedPaths.size > 0) {
        const nodeInPath = edges.some(e =>
          (highlightedPaths.has(`${e.source}-${e.target}`) || highlightedPaths.has(`${e.target}-${e.source}`)) &&
          (e.source === node.id || e.target === node.id)
        );
        if (!nodeInPath && node.id !== pathTraceTarget) {
          ctx.globalAlpha = 0.2;
        }
      }

      const color = getNodeColor(node);
      const shape = getNodeShape(node);

      // Draw search result highlight ring
      if (isSearchResult) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Draw path trace highlight
      if (isPathTraced) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 10, 0, Math.PI * 2);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Draw node shape
      ctx.fillStyle = color;
      ctx.strokeStyle = isHovered || isFocused ? '#ffffff' : 'transparent';
      ctx.lineWidth = 2;

      switch (shape) {
        case 'hexagon':
          drawHexagon(ctx, pos.x, pos.y, radius);
          ctx.fill();
          if (isHovered || isFocused) ctx.stroke();
          break;
        case 'cylinder':
          drawCylinder(ctx, pos.x, pos.y, radius);
          ctx.fill();
          if (isHovered || isFocused) ctx.stroke();
          break;
        case 'diamond':
          drawDiamond(ctx, pos.x, pos.y, radius);
          ctx.fill();
          if (isHovered || isFocused) ctx.stroke();
          break;
        case 'square':
          drawSquare(ctx, pos.x, pos.y, radius);
          ctx.fill();
          if (isHovered || isFocused) ctx.stroke();
          break;
        default:
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
          ctx.fill();
          if (isHovered || isFocused) ctx.stroke();
      }

      // Draw Classification Halo
      if (node.classification && activeLens !== 'infra') {
        ctx.beginPath();
        const haloRadius = radius + 5;
        ctx.arc(pos.x, pos.y, haloRadius, 0, Math.PI * 2);
        ctx.strokeStyle = node.classification === 'domain' ? '#10b981' : '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Confidence Ring
      if (node.confidence !== undefined && activeLens !== 'pattern') {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * node.confidence);
        ctx.strokeStyle = `rgba(255, 255, 255, 0.6)`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // Draw label for hovered/focused/search result nodes
      if (isHovered || isFocused || isSearchResult) {
        ctx.font = 'bold 12px sans-serif';
        const labelWidth = ctx.measureText(node.label).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.fillRect(pos.x - labelWidth / 2 - 6, pos.y - radius - 26, labelWidth + 12, 20);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.strokeRect(pos.x - labelWidth / 2 - 6, pos.y - radius - 26, labelWidth + 12, 20);

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.label, pos.x, pos.y - radius - 16);
      }
    });

    // Draw feature group labels in business lens at cluster level
    if (activeLens === 'business' && lodLevel === 'cluster') {
      const featureGroups = new Map<string, { x: number; y: number; count: number }>();
      visibleNodes.forEach(node => {
        const feature = node.featureContext || 'Unknown';
        const pos = nodePositions.get(node.id);
        if (!pos) return;

        if (!featureGroups.has(feature)) {
          featureGroups.set(feature, { x: 0, y: 0, count: 0 });
        }
        const group = featureGroups.get(feature)!;
        group.x += pos.x;
        group.y += pos.y;
        group.count++;
      });

      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      featureGroups.forEach((group, feature) => {
        const cx = group.x / group.count;
        const cy = group.y / group.count - 60;

        // Draw label background
        const labelWidth = ctx.measureText(feature).width;
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.fillRect(cx - labelWidth / 2 - 8, cy - 10, labelWidth + 16, 24);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - labelWidth / 2 - 8, cy - 10, labelWidth + 16, 24);

        ctx.fillStyle = '#60a5fa';
        ctx.fillText(feature, cx, cy + 3);
      });
    }

    ctx.restore();
  }, [nodes, edges, nodePositions, zoom, pan, hoveredNode, hoveredEdge, focusedNode, filterKinds, focusMode, nodesInFocusRange, searchResults, activeLens, lodLevel, getNodeColor, getNodeShape, getEdgeStyle, animationTime, highlightedPaths, pathTraceTarget]);

  // Handle canvas resize
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resizeObserver = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Handle mouse interactions
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - pan.x) / zoom;
      const y = (e.clientY - rect.top - pan.y) / zoom;

      // Find node under cursor
      let foundNode: string | null = null;
      for (const [id, pos] of nodePositions) {
        const dx = pos.x - x;
        const dy = pos.y - y;
        if (Math.sqrt(dx * dx + dy * dy) < 15) {
          foundNode = id;
          break;
        }
      }
      setHoveredNode(foundNode);

      // Find edge under cursor (if no node is hovered)
      if (!foundNode) {
        let foundEdge: { source: string; target: string; type: string } | null = null;
        const threshold = 8;

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
          const distance = Math.sqrt((x - projX) * (x - projX) + (y - projY) * (y - projY));

          if (distance < threshold) {
            foundEdge = edge;
            break;
          }
        }
        setHoveredEdge(foundEdge);
      } else {
        setHoveredEdge(null);
      }
    },
    [nodePositions, edges, zoom, pan]
  );

  // Handle left click
  const handleCanvasClick = useCallback(() => {
    // Close context menu if open
    if (contextMenu.visible) {
      setContextMenu({ visible: false, x: 0, y: 0, nodeId: null });
      return;
    }

    if (hoveredNode) {
      setFocusedNode(hoveredNode);
      const node = nodes.find((n) => n.id === hoveredNode);
      if (node) {
        setSelectedEntity({
          id: node.id,
          name: node.label,
          kind: node.kind as 'function' | 'class' | 'interface' | 'variable' | 'file',
          filePath: '',
          startLine: 0,
          endLine: 0,
        });
      }
    }
  }, [hoveredNode, nodes, setFocusedNode, setSelectedEntity, contextMenu.visible]);

  // Handle right click (context menu)
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (hoveredNode) {
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        nodeId: hoveredNode,
      });
    }
  }, [hoveredNode]);

  // Handle "Show Usage Paths" from context menu
  const handleShowUsagePaths = useCallback(() => {
    if (contextMenu.nodeId) {
      const paths = findUsagePaths(contextMenu.nodeId);
      setHighlightedPaths(paths);
      setPathTraceTarget(contextMenu.nodeId);
    }
    setContextMenu({ visible: false, x: 0, y: 0, nodeId: null });
  }, [contextMenu.nodeId, findUsagePaths]);

  // Clear path highlighting
  const handleClearPaths = useCallback(() => {
    setHighlightedPaths(new Set());
    setPathTraceTarget(null);
  }, []);

  // Zoom handlers
  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.2, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z / 1.2, 0.3));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    handleClearPaths();
  };

  const toggleKindFilter = (kind: string) => {
    setFilterKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]
    );
  };

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.3, Math.min(3, z * delta)));
  }, []);

  // Panning
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0 && !hoveredNode) { // Left click on empty space
      setIsPanning(true);
      setLastPanPoint({ x: e.clientX, y: e.clientY });
    }
  }, [hoveredNode]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleMouseMoveForPan = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      const dx = e.clientX - lastPanPoint.x;
      const dy = e.clientY - lastPanPoint.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastPanPoint({ x: e.clientX, y: e.clientY });
    }
    handleCanvasMouseMove(e);
  }, [isPanning, lastPanPoint, handleCanvasMouseMove]);

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

  const focusedNodeData = focusedNode ? nodes.find((n) => n.id === focusedNode) : null;
  const outgoingEdges = focusedNode ? edges.filter((e) => e.source === focusedNode) : [];
  const incomingEdges = focusedNode ? edges.filter((e) => e.target === focusedNode) : [];

  return (
    <div className="h-full flex">
      {/* Main Graph Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b border-slate-700 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GitBranch className="w-5 h-5 text-blue-400" />
              <h1 className="text-xl font-semibold text-white">Knowledge Graph</h1>
              <span className="text-sm text-slate-500">
                {nodes.length} nodes, {edges.length} edges
              </span>
              {highlightedPaths.size > 0 && (
                <button
                  onClick={handleClearPaths}
                  className="ml-2 px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30"
                >
                  Clear Path Trace
                </button>
              )}
            </div>

            {/* Lenses Toolbar */}
            <div className="flex items-center gap-1 bg-slate-700 rounded-lg p-1">
              <LensButton
                active={activeLens === 'structure'}
                onClick={() => setActiveLens('structure')}
                label="Structure"
                icon={<Layers className="w-3.5 h-3.5" />}
              />
              <LensButton
                active={activeLens === 'business'}
                onClick={() => setActiveLens('business')}
                label="Business"
                icon={<Box className="w-3.5 h-3.5" />}
              />
              <LensButton
                active={activeLens === 'infra'}
                onClick={() => setActiveLens('infra')}
                label="Infra"
                icon={<Database className="w-3.5 h-3.5" />}
              />
              <LensButton
                active={activeLens === 'pattern'}
                onClick={() => setActiveLens('pattern')}
                label="Patterns"
                icon={<Hash className="w-3.5 h-3.5" />}
              />
            </div>
          </div>

          {/* Controls Row 1 */}
          <div className="flex items-center gap-4 mt-4">
            {/* Search box */}
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
                <button
                  onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              {searchResults.length > 0 && searchQuery && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50">
                  {searchResults.slice(0, 10).map((nodeId) => {
                    const node = nodes.find((n) => n.id === nodeId);
                    if (!node) return null;
                    return (
                      <button
                        key={nodeId}
                        onClick={() => handleFocusNode(nodeId)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-700 flex items-center gap-2"
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: getNodeColor(node) }}
                        />
                        <span className="text-slate-200">{node.label}</span>
                        <span className="text-slate-500 text-xs ml-auto">{node.kind}</span>
                      </button>
                    );
                  })}
                  {searchResults.length > 10 && (
                    <div className="px-3 py-2 text-xs text-slate-500">
                      +{searchResults.length - 10} more results
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Zoom controls */}
            <div className="flex items-center gap-1 bg-slate-700 rounded-lg p-1">
              <button onClick={handleZoomOut} className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white" title="Zoom Out">
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="px-2 text-sm text-slate-400 min-w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={handleZoomIn} className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white" title="Zoom In">
                <ZoomIn className="w-4 h-4" />
              </button>
              <button onClick={handleReset} className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white" title="Reset View">
                <Maximize2 className="w-4 h-4" />
              </button>
              <button onClick={handleZoomToFit} className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white" title="Zoom to Fit">
                <Target className="w-4 h-4" />
              </button>
            </div>

            {/* Focus mode toggle */}
            <div className="flex items-center gap-2 bg-slate-700 rounded-lg p-1">
              <button
                onClick={() => setFocusMode(!focusMode)}
                className={`p-1.5 rounded flex items-center gap-1.5 text-sm ${focusMode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-600 hover:text-white'}`}
                title={focusMode ? 'Disable Focus Mode' : 'Enable Focus Mode'}
                disabled={!focusedNode}
              >
                <Focus className="w-4 h-4" />
                <span className="text-xs">Focus</span>
              </button>
              {focusMode && (
                <select
                  value={focusDepth}
                  onChange={(e) => setFocusDepth(Number(e.target.value))}
                  className="bg-slate-600 border-none rounded px-2 py-1 text-xs text-slate-200"
                >
                  <option value="1">1 hop</option>
                  <option value="2">2 hops</option>
                  <option value="3">3 hops</option>
                  <option value="4">4 hops</option>
                </select>
              )}
            </div>

            {/* Force layout toggle */}
            <button
              onClick={() => setUseForceLayout(!useForceLayout)}
              className={`px-3 py-1.5 rounded text-xs font-medium ${useForceLayout ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
              title="Toggle Force-Directed Layout"
            >
              Physics
            </button>
          </div>

          {/* Controls Row 2 */}
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <FilterButton active={filterKinds.includes('function')} onClick={() => toggleKindFilter('function')} color="blue" label="Functions" />
              <FilterButton active={filterKinds.includes('class')} onClick={() => toggleKindFilter('class')} color="purple" label="Classes" />
              <FilterButton active={filterKinds.includes('interface')} onClick={() => toggleKindFilter('interface')} color="cyan" label="Interfaces" />
              <FilterButton active={filterKinds.includes('file')} onClick={() => toggleKindFilter('file')} color="green" label="Files" />
            </div>

            <div className="flex-1" />

            <button onClick={handleExport} className="btn btn-secondary flex items-center gap-2" title="Export as PNG">
              <Download className="w-4 h-4" />
              Export
            </button>
            <button
              onClick={() => setShowInspector(!showInspector)}
              className={`btn ${showInspector ? 'btn-primary' : 'btn-secondary'} flex items-center gap-2`}
            >
              <Brain className="w-4 h-4" />
              Inspector
            </button>
            <button onClick={() => window.location.reload()} className="btn btn-secondary flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Graph Canvas */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden">
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMoveForPan}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={handleCanvasClick}
            onContextMenu={handleCanvasContextMenu}
            onWheel={handleWheel}
            className="w-full h-full"
            style={{ cursor: isPanning ? 'grabbing' : hoveredNode ? 'pointer' : 'grab' }}
          />

          {/* Context Menu */}
          {contextMenu.visible && (
            <div
              className="absolute bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 z-50"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                onClick={handleShowUsagePaths}
                className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
              >
                <ArrowRight className="w-4 h-4" />
                Show Usage Paths
              </button>
              <button
                onClick={() => {
                  if (contextMenu.nodeId) handleFocusNode(contextMenu.nodeId);
                  setContextMenu({ visible: false, x: 0, y: 0, nodeId: null });
                }}
                className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
              >
                <Target className="w-4 h-4" />
                Focus on Node
              </button>
              <button
                onClick={() => {
                  setFocusedNode(contextMenu.nodeId);
                  setFocusMode(true);
                  setContextMenu({ visible: false, x: 0, y: 0, nodeId: null });
                }}
                className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
              >
                <Focus className="w-4 h-4" />
                Show Connected ({focusDepth} hops)
              </button>
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-slate-800/95 border border-slate-700 rounded-lg p-3 text-xs">
            <div className="text-slate-500 font-medium mb-2">Node Shapes</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <LegendItem shape="hexagon" color="#3b82f6" label="Domain" />
              <LegendItem shape="cylinder" color="#f59e0b" label="Infrastructure" />
              <LegendItem shape="circle" color="#a855f7" label="Code Entity" />
              <LegendItem shape="diamond" color="#06b6d4" label="Interface" />
            </div>
            <div className="text-slate-500 font-medium mt-3 mb-2">Edge Types</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <LegendItem isEdge edgeStyle="solid" color="#3b82f6" label="Calls" />
              <LegendItem isEdge edgeStyle="solid" color="#10b981" label="Imports" />
              <LegendItem isEdge edgeStyle="dashed" color="#8b5cf6" label="Semantic" />
              <LegendItem isEdge edgeStyle="zigzag" color="#ef4444" label="Violation" />
            </div>
          </div>

          {/* LOD indicator */}
          {lodLevel !== 'detail' && (
            <div className="absolute top-4 left-4 bg-blue-500/20 text-blue-400 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2">
              <Globe className="w-4 h-4" />
              {lodLevel === 'domain' ? 'Domain View (zoom in for details)' : 'Cluster View'}
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar Inspector Panel */}
      {showInspector && focusedNodeData && (
        <div className="w-80 border-l border-slate-700 bg-slate-900 flex flex-col overflow-hidden">
          {/* Inspector Header */}
          <div className="p-4 border-b border-slate-700 bg-slate-800/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                <Brain className="w-4 h-4 text-purple-400" />
                Entity Inspector
              </div>
              <button
                onClick={() => { setFocusedNode(null); setFocusMode(false); }}
                className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-start gap-3">
              <div className={`p-2.5 rounded-lg ${
                focusedNodeData.kind === 'function' ? 'bg-blue-500/20 text-blue-400' :
                focusedNodeData.kind === 'class' ? 'bg-purple-500/20 text-purple-400' :
                focusedNodeData.kind === 'interface' ? 'bg-cyan-500/20 text-cyan-400' :
                'bg-slate-500/20 text-slate-400'
              }`}>
                {focusedNodeData.kind === 'function' ? <Box className="w-5 h-5" /> :
                 focusedNodeData.kind === 'class' ? <Layers className="w-5 h-5" /> :
                 focusedNodeData.kind === 'interface' ? <Hash className="w-5 h-5" /> :
                 <FileCode className="w-5 h-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white truncate" title={focusedNodeData.label}>
                  {focusedNodeData.label}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                    focusedNodeData.kind === 'function' ? 'bg-blue-500/20 text-blue-400' :
                    focusedNodeData.kind === 'class' ? 'bg-purple-500/20 text-purple-400' :
                    focusedNodeData.kind === 'interface' ? 'bg-cyan-500/20 text-cyan-400' :
                    'bg-slate-500/20 text-slate-400'
                  }`}>
                    {focusedNodeData.kind}
                  </span>
                  {focusedNodeData.classification && (
                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                      focusedNodeData.classification === 'domain' ? 'bg-emerald-500/20 text-emerald-400' :
                      'bg-amber-500/20 text-amber-400'
                    }`}>
                      {focusedNodeData.classification}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Inspector Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {/* Metrics */}
            <div className="grid grid-cols-2 gap-2">
              <MetricCard
                label="Confidence"
                value={`${Math.round((focusedNodeData.confidence ?? 0) * 100)}%`}
                icon={<Activity className="w-4 h-4 text-green-400" />}
                color={(focusedNodeData.confidence ?? 0) >= 0.8 ? 'text-green-400' : 'text-yellow-400'}
              />
              <MetricCard
                label="Connections"
                value={`${outgoingEdges.length + incomingEdges.length}`}
                icon={<GitBranch className="w-4 h-4 text-blue-400" />}
                color="text-blue-400"
              />
            </div>

            {/* Business Justification */}
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
              <div className="text-xs text-slate-500 font-medium uppercase mb-2 flex items-center gap-1">
                <Brain className="w-3 h-3" />
                Business Context
              </div>

              {focusedNodeData.purposeSummary ? (
                <p className="text-sm text-slate-300 leading-relaxed mb-3">
                  {focusedNodeData.purposeSummary}
                </p>
              ) : (
                <p className="text-sm text-slate-500 italic mb-3">
                  No business justification available.
                </p>
              )}

              {focusedNodeData.businessValue && (
                <div className="mb-2">
                  <div className="text-xs text-slate-500 mb-0.5">Business Value</div>
                  <p className="text-sm text-slate-400">{focusedNodeData.businessValue}</p>
                </div>
              )}

              {focusedNodeData.featureContext && (
                <div className="inline-block px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">
                  {focusedNodeData.featureContext}
                </div>
              )}
            </div>

            {/* Connections */}
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
              <div className="text-xs text-slate-500 font-medium uppercase mb-2 flex items-center gap-1">
                <ArrowRight className="w-3 h-3" />
                Relationships
              </div>

              {outgoingEdges.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs text-green-400 mb-1 flex items-center gap-1">
                    <ChevronRight className="w-3 h-3" /> Outgoing ({outgoingEdges.length})
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {outgoingEdges.slice(0, 5).map((edge, i) => {
                      const target = nodes.find(n => n.id === edge.target);
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="text-slate-500">{edge.type}</span>
                          <span className="text-slate-300 truncate">{target?.label || 'Unknown'}</span>
                        </div>
                      );
                    })}
                    {outgoingEdges.length > 5 && (
                      <div className="text-xs text-slate-500">+{outgoingEdges.length - 5} more</div>
                    )}
                  </div>
                </div>
              )}

              {incomingEdges.length > 0 && (
                <div>
                  <div className="text-xs text-blue-400 mb-1 flex items-center gap-1">
                    <ChevronRight className="w-3 h-3 rotate-180" /> Incoming ({incomingEdges.length})
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {incomingEdges.slice(0, 5).map((edge, i) => {
                      const source = nodes.find(n => n.id === edge.source);
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="text-slate-300 truncate">{source?.label || 'Unknown'}</span>
                          <span className="text-slate-500">{edge.type}</span>
                        </div>
                      );
                    })}
                    {incomingEdges.length > 5 && (
                      <div className="text-xs text-slate-500">+{incomingEdges.length - 5} more</div>
                    )}
                  </div>
                </div>
              )}

              {outgoingEdges.length === 0 && incomingEdges.length === 0 && (
                <p className="text-sm text-slate-500 italic">No connections</p>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <button
                onClick={() => {
                  setFocusMode(true);
                }}
                className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-200 flex items-center justify-center gap-2"
              >
                <Focus className="w-4 h-4" />
                Focus on Connected Nodes
              </button>
              <button
                onClick={() => {
                  const paths = findUsagePaths(focusedNodeData.id);
                  setHighlightedPaths(paths);
                  setPathTraceTarget(focusedNodeData.id);
                }}
                className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-200 flex items-center justify-center gap-2"
              >
                <ArrowRight className="w-4 h-4" />
                Trace All Paths
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

function FilterButton({ active, onClick, color, label }: { active: boolean; onClick: () => void; color: string; label: string }) {
  const colorClasses =
    color === 'blue' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
    color === 'purple' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
    color === 'cyan' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' :
    color === 'green' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
    'bg-slate-500/20 text-slate-400 border-slate-500/30';

  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 text-xs rounded border transition-colors ${active ? colorClasses : 'bg-slate-700 text-slate-400 border-slate-600 hover:border-slate-500'}`}
    >
      {label}
    </button>
  );
}

function LensButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded font-medium transition-colors flex items-center gap-1.5 ${active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-600 hover:text-white'}`}
    >
      {icon}
      {label}
    </button>
  );
}

function LegendItem({ shape, color, label, isEdge, edgeStyle }: { shape?: string; color: string; label: string; isEdge?: boolean; edgeStyle?: string }) {
  return (
    <div className="flex items-center gap-2">
      {isEdge ? (
        <div className="w-5 flex items-center justify-center">
          {edgeStyle === 'dashed' ? (
            <div className="w-4 h-0 border-t-2 border-dashed" style={{ borderColor: color }} />
          ) : edgeStyle === 'zigzag' ? (
            <svg width="16" height="8" viewBox="0 0 16 8">
              <path d="M0,4 L4,0 L8,8 L12,0 L16,4" fill="none" stroke={color} strokeWidth="1.5" />
            </svg>
          ) : (
            <div className="w-4 h-0.5" style={{ backgroundColor: color }} />
          )}
        </div>
      ) : shape === 'hexagon' ? (
        <svg width="12" height="12" viewBox="0 0 12 12">
          <polygon points="6,0 11,3 11,9 6,12 1,9 1,3" fill={color} />
        </svg>
      ) : shape === 'cylinder' ? (
        <svg width="12" height="14" viewBox="0 0 12 14">
          <ellipse cx="6" cy="3" rx="5" ry="2" fill={color} />
          <rect x="1" y="3" width="10" height="8" fill={color} />
          <ellipse cx="6" cy="11" rx="5" ry="2" fill={color} />
        </svg>
      ) : shape === 'diamond' ? (
        <svg width="12" height="12" viewBox="0 0 12 12">
          <polygon points="6,0 12,6 6,12 0,6" fill={color} />
        </svg>
      ) : (
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
      )}
      <span className="text-slate-400">{label}</span>
    </div>
  );
}

function MetricCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-slate-800/50 p-2.5 rounded-lg border border-slate-700/50">
      <div className="flex items-center gap-1.5 text-slate-500 mb-1">
        {icon}
        <span className="text-[10px] uppercase font-medium">{label}</span>
      </div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

export default GraphView;

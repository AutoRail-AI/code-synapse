/**
 * Knowledge Graph Visualization - Main Component
 *
 * Provides a "Google Maps for Engineering" experience with:
 * - Semantic zoom (LOD) - groups at far zoom, details up close
 * - Multiple lenses (Structure, Business, Infra, Patterns)
 * - Cluster-based force layout
 * - Edge bundling between groups
 * - Interactive exploration with focus mode and path tracing
 */

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
  Brain,
  AlertTriangle,
} from 'lucide-react';
import { useGraphStore, useUIStore } from '../../store';
import { getGraphData } from '../../api/client';

// Local imports
import type { NodePosition, NodeShape, DetailLevel } from './types';
import { labelsOverlap } from './utils';
import { drawHexagon, drawCylinder, drawDiamond, drawSquare, drawBundledEdge } from './drawing';
import {
  FilterButton,
  LensButton,
  GraphLegend,
  DetailLevelIndicator,
  ZoomHint,
  HoveredGroupInfo,
  ContextMenu,
} from './components';
import { Inspector } from './Inspector';
import { useGraphLayout } from './useGraphLayout';
import { useGraphInteraction } from './useGraphInteraction';

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
  const [filterKinds, setFilterKinds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [focusMode, setFocusMode] = useState(false);
  const [focusDepth, setFocusDepth] = useState(2);
  const [showInspector, setShowInspector] = useState(true);

  // Determine detail level based on zoom
  const detailLevel: DetailLevel = useMemo(() => {
    if (zoom < 0.5) return 'groups-only';
    if (zoom < 0.8) return 'groups-with-labels';
    if (zoom < 1.2) return 'sparse-nodes';
    return 'full-detail';
  }, [zoom]);

  const shouldShowNodes = useMemo(() => {
    if (activeLens === 'business' && detailLevel !== 'full-detail') return false;
    if (detailLevel === 'groups-only') return false;
    return true;
  }, [activeLens, detailLevel]);

  // Use layout hook
  const { nodeGroups, bundledEdges, calculatePositions } = useGraphLayout({
    nodes,
    edges,
    activeLens,
    containerRef,
  });

  // Use interaction hook
  const interaction = useGraphInteraction({
    nodePositions,
    nodeGroups,
    edges,
    zoom,
    pan,
    shouldShowNodes,
    focusedNode,
    focusDepth,
    canvasRef,
  });

  // Helper functions for node rendering
  const getNodeShape = useCallback((node: typeof nodes[0]): NodeShape => {
    if (node.classification === 'domain') return 'hexagon';
    if (node.classification === 'infrastructure') return 'cylinder';
    if (node.kind === 'interface') return 'diamond';
    if (node.kind === 'file') return 'square';
    return 'circle';
  }, []);

  const getNodeColor = useCallback((node: typeof nodes[0]): string => {
    if (activeLens === 'pattern') {
      const confidence = node.confidence ?? 0.5;
      if (confidence >= 0.8) return '#10b981';
      if (confidence >= 0.5) return '#f59e0b';
      return '#ef4444';
    }
    if (activeLens === 'infra') {
      if (node.classification === 'domain') return '#3b82f6';
      if (node.classification === 'infrastructure') return '#f59e0b';
      return '#6b7280';
    }
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

  // Animation loop
  useEffect(() => {
    const animate = () => {
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
    const results = nodes.filter((n) => n.label.toLowerCase().includes(query)).map((n) => n.id);
    setSearchResults(results);
  }, [searchQuery, nodes]);

  // Calculate positions when lens changes
  useEffect(() => {
    if (nodes.length === 0) return;
    const positions = calculatePositions();
    setNodePositions(positions);
  }, [nodes, activeLens, calculatePositions]);

  // Canvas resize
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

  // Main draw function
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    let visibleNodes = filterKinds.length > 0 ? nodes.filter((n) => filterKinds.includes(n.kind)) : nodes;

    if (focusMode && interaction.nodesInFocusRange) {
      visibleNodes = visibleNodes.filter((n) => interaction.nodesInFocusRange!.has(n.id));
    }

    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

    // Draw group bubbles
    if (activeLens === 'business' || activeLens === 'structure' || !shouldShowNodes) {
      const drawnLabels: Array<{ x: number; y: number; w: number }> = [];

      nodeGroups.forEach((group) => {
        const hasVisibleNodes = group.nodes.some((id) => visibleNodeIds.has(id));
        if (!hasVisibleNodes) return;

        const isHovered = interaction.hoveredGroup === group.id;
        const isExpanded = interaction.expandedGroups.has(group.id);

        ctx.beginPath();
        ctx.arc(group.x, group.y, group.radius + 10, 0, Math.PI * 2);
        ctx.fillStyle = isHovered ? `${group.color}30` : `${group.color}15`;
        ctx.fill();
        ctx.strokeStyle = isHovered ? group.color : `${group.color}80`;
        ctx.lineWidth = isHovered ? 3 : 2;
        ctx.setLineDash(isExpanded ? [] : [8, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        const labelText = `${group.name} (${group.nodeCount})`;
        ctx.font = 'bold 14px sans-serif';
        const labelWidth = ctx.measureText(labelText).width;
        const labelX = group.x - labelWidth / 2;
        const labelY = group.y - group.radius - 25;

        const overlaps = drawnLabels.some((l) => labelsOverlap(labelX, labelY, labelWidth, l.x, l.y, l.w));

        if (!overlaps || isHovered) {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.fillRect(labelX - 6, labelY - 12, labelWidth + 12, 20);
          ctx.strokeStyle = group.color;
          ctx.lineWidth = 1;
          ctx.strokeRect(labelX - 6, labelY - 12, labelWidth + 12, 20);
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.fillText(labelText, labelX, labelY);
          drawnLabels.push({ x: labelX, y: labelY, w: labelWidth });
        }
      });
    }

    // Draw bundled edges
    if (!shouldShowNodes || detailLevel !== 'full-detail') {
      bundledEdges.forEach((bundle) => {
        const sourceGroup = nodeGroups.get(bundle.sourceGroup);
        const targetGroup = nodeGroups.get(bundle.targetGroup);
        if (!sourceGroup || !targetGroup) return;

        const color = bundle.types.has('calls')
          ? '#3b82f6'
          : bundle.types.has('imports')
            ? '#10b981'
            : bundle.types.has('extends')
              ? '#f59e0b'
              : '#6b7280';

        drawBundledEdge(ctx, sourceGroup.x, sourceGroup.y, targetGroup.x, targetGroup.y, bundle.count, color);
      });
    }

    // Draw individual edges
    if (shouldShowNodes && detailLevel === 'full-detail') {
      edges.forEach((edge) => {
        if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return;

        const from = nodePositions.get(edge.source);
        const to = nodePositions.get(edge.target);
        if (!from || !to) return;

        const isHovered = interaction.hoveredEdge?.source === edge.source && interaction.hoveredEdge?.target === edge.target;
        const isHighlighted = interaction.highlightedPaths.has(`${edge.source}-${edge.target}`);

        let edgeColor = '#475569';
        if (edge.type === 'calls') edgeColor = '#3b82f6';
        else if (edge.type === 'imports') edgeColor = '#10b981';
        else if (edge.type === 'extends') edgeColor = '#f59e0b';
        else if (edge.type === 'implements') edgeColor = '#8b5cf6';

        ctx.strokeStyle = isHovered || isHighlighted ? '#ffffff' : edgeColor;
        ctx.lineWidth = isHovered || isHighlighted ? 2 : 1;

        if (interaction.highlightedPaths.size > 0 && !isHighlighted) {
          ctx.globalAlpha = 0.15;
        }

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();

        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const arrowLen = 6;
        const arrowX = to.x - 10 * Math.cos(angle);
        const arrowY = to.y - 10 * Math.sin(angle);
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX - arrowLen * Math.cos(angle - 0.4), arrowY - arrowLen * Math.sin(angle - 0.4));
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX - arrowLen * Math.cos(angle + 0.4), arrowY - arrowLen * Math.sin(angle + 0.4));
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    }

    // Draw individual nodes
    if (shouldShowNodes) {
      const drawnNodeLabels: Array<{ x: number; y: number; w: number }> = [];

      visibleNodes.forEach((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return;

        const isHovered = interaction.hoveredNode === node.id;
        const isFocused = focusedNode === node.id;
        const isSearchResult = searchResults.includes(node.id);
        const isPathTraced = interaction.pathTraceTarget === node.id;
        const baseRadius = 8;
        const radius = isHovered || isFocused || isSearchResult ? baseRadius * 1.4 : baseRadius;

        if (interaction.highlightedPaths.size > 0) {
          const nodeInPath = edges.some(
            (e) => interaction.highlightedPaths.has(`${e.source}-${e.target}`) && (e.source === node.id || e.target === node.id)
          );
          if (!nodeInPath && node.id !== interaction.pathTraceTarget) {
            ctx.globalAlpha = 0.15;
          }
        }

        const color = getNodeColor(node);
        const shape = getNodeShape(node);

        if (isSearchResult) {
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius + 6, 0, Math.PI * 2);
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (isPathTraced) {
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius + 8, 0, Math.PI * 2);
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.fillStyle = color;
        ctx.strokeStyle = isHovered || isFocused ? '#ffffff' : 'transparent';
        ctx.lineWidth = 2;

        switch (shape) {
          case 'hexagon':
            drawHexagon(ctx, pos.x, pos.y, radius);
            break;
          case 'cylinder':
            drawCylinder(ctx, pos.x, pos.y, radius);
            break;
          case 'diamond':
            drawDiamond(ctx, pos.x, pos.y, radius);
            break;
          case 'square':
            drawSquare(ctx, pos.x, pos.y, radius);
            break;
          default:
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        }
        ctx.fill();
        if (isHovered || isFocused) ctx.stroke();

        if (node.confidence !== undefined && activeLens !== 'pattern') {
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * node.confidence);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        ctx.globalAlpha = 1;

        if (isHovered || isFocused || isSearchResult) {
          ctx.font = 'bold 11px sans-serif';
          const labelWidth = ctx.measureText(node.label).width;
          const labelX = pos.x - labelWidth / 2;
          const labelY = pos.y - radius - 18;

          const overlaps = drawnNodeLabels.some((l) => labelsOverlap(labelX, labelY, labelWidth, l.x, l.y, l.w));

          if (!overlaps || isFocused) {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
            ctx.fillRect(labelX - 4, labelY - 10, labelWidth + 8, 16);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            ctx.strokeRect(labelX - 4, labelY - 10, labelWidth + 8, 16);
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.fillText(node.label, labelX, labelY);
            drawnNodeLabels.push({ x: labelX, y: labelY, w: labelWidth });
          }
        }
      });
    }

    ctx.restore();
  }, [
    nodes, edges, nodePositions, nodeGroups, bundledEdges, zoom, pan, interaction.hoveredNode,
    interaction.hoveredEdge, interaction.hoveredGroup, focusedNode, filterKinds, focusMode,
    interaction.nodesInFocusRange, searchResults, activeLens, shouldShowNodes, detailLevel,
    getNodeColor, getNodeShape, interaction.highlightedPaths, interaction.pathTraceTarget,
    interaction.expandedGroups,
  ]);

  // Event handlers
  const handleZoomToFit = useCallback(() => {
    if (nodePositions.size === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [, pos] of nodePositions) {
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    }
    if (minX === Infinity) return;

    const padding = 80;
    const graphWidth = maxX - minX + padding * 2;
    const graphHeight = maxY - minY + padding * 2;
    const scaleX = canvas.width / graphWidth;
    const scaleY = canvas.height / graphHeight;
    const newZoom = Math.min(scaleX, scaleY, 2);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setZoom(newZoom);
    setPan({ x: canvas.width / 2 - centerX * newZoom, y: canvas.height / 2 - centerY * newZoom });
  }, [nodePositions]);

  const handleExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'knowledge-graph.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  const handleFocusNode = useCallback((nodeId: string) => {
    setFocusedNode(nodeId);
    setSearchQuery('');
    setSearchResults([]);
    const pos = nodePositions.get(nodeId);
    if (pos && canvasRef.current) {
      setPan({ x: canvasRef.current.width / 2 - pos.x * zoom, y: canvasRef.current.height / 2 - pos.y * zoom });
    }
  }, [nodePositions, zoom, setFocusedNode]);

  const handleClearPaths = useCallback(() => {
    interaction.setHighlightedPaths(new Set());
    interaction.setPathTraceTarget(null);
  }, [interaction]);

  const handleCanvasClick = useCallback(() => {
    if (interaction.contextMenu.visible) {
      interaction.setContextMenu({ visible: false, x: 0, y: 0, nodeId: null });
      return;
    }

    if (interaction.hoveredNode) {
      setFocusedNode(interaction.hoveredNode);
      const node = nodes.find((n) => n.id === interaction.hoveredNode);
      if (node) {
        setSelectedEntity({ id: node.id, name: node.label, kind: node.kind as any, filePath: '', startLine: 0, endLine: 0 });
      }
    } else if (interaction.hoveredGroup) {
      interaction.toggleGroupExpansion(interaction.hoveredGroup);
    }
  }, [interaction, nodes, setFocusedNode, setSelectedEntity]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.3, Math.min(3, z * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0 && !interaction.hoveredNode && !interaction.hoveredGroup) {
      interaction.startPanning(e.clientX, e.clientY);
    }
  }, [interaction]);

  const handleMouseMoveForPan = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (interaction.isPanning) {
      const delta = interaction.updatePan(e.clientX, e.clientY);
      setPan((prev) => ({ x: prev.x + delta.x, y: prev.y + delta.y }));
    }
    interaction.handleMouseMove(e);
  }, [interaction]);

  const toggleKindFilter = (kind: string) => {
    setFilterKinds((prev) => prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]);
  };

  // Render
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
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b border-slate-700 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GitBranch className="w-5 h-5 text-blue-400" />
              <h1 className="text-xl font-semibold text-white">Knowledge Graph</h1>
              <span className="text-sm text-slate-500">{nodes.length} nodes, {edges.length} edges, {nodeGroups.size} groups</span>
              {interaction.highlightedPaths.size > 0 && (
                <button onClick={handleClearPaths} className="ml-2 px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30">
                  Clear Path Trace
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 bg-slate-700 rounded-lg p-1">
              <LensButton active={activeLens === 'structure'} onClick={() => setActiveLens('structure')} label="Structure" lens="structure" />
              <LensButton active={activeLens === 'business'} onClick={() => setActiveLens('business')} label="Business" lens="business" />
              <LensButton active={activeLens === 'infra'} onClick={() => setActiveLens('infra')} label="Infra" lens="infra" />
              <LensButton active={activeLens === 'pattern'} onClick={() => setActiveLens('pattern')} label="Patterns" lens="pattern" />
            </div>
          </div>

          {/* Controls Row 1 */}
          <div className="flex items-center gap-4 mt-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search nodes..." className="w-full pl-9 pr-8 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500" />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setSearchResults([]); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              )}
              {searchResults.length > 0 && searchQuery && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50">
                  {searchResults.slice(0, 10).map((nodeId) => {
                    const node = nodes.find((n) => n.id === nodeId);
                    if (!node) return null;
                    return (
                      <button key={nodeId} onClick={() => handleFocusNode(nodeId)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-700 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getNodeColor(node) }} />
                        <span className="text-slate-200">{node.label}</span>
                        <span className="text-slate-500 text-xs ml-auto">{node.kind}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 bg-slate-700 rounded-lg p-1">
              <button onClick={() => setZoom((z) => Math.max(z / 1.25, 0.3))} className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white" title="Zoom Out"><ZoomOut className="w-4 h-4" /></button>
              <span className="px-2 text-sm text-slate-400 min-w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(z * 1.25, 3))} className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white" title="Zoom In"><ZoomIn className="w-4 h-4" /></button>
              <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); handleClearPaths(); }} className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white" title="Reset"><Maximize2 className="w-4 h-4" /></button>
              <button onClick={handleZoomToFit} className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white" title="Fit"><Target className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center gap-2 bg-slate-700 rounded-lg p-1">
              <button onClick={() => setFocusMode(!focusMode)} className={`p-1.5 rounded flex items-center gap-1.5 text-sm ${focusMode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-600'}`} disabled={!focusedNode}>
                <Focus className="w-4 h-4" /><span className="text-xs">Focus</span>
              </button>
              {focusMode && (
                <select value={focusDepth} onChange={(e) => setFocusDepth(Number(e.target.value))} className="bg-slate-600 rounded px-2 py-1 text-xs text-slate-200">
                  <option value="1">1 hop</option><option value="2">2 hops</option><option value="3">3 hops</option>
                </select>
              )}
            </div>
            <DetailLevelIndicator detailLevel={detailLevel} />
          </div>

          {/* Controls Row 2 */}
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <FilterButton active={filterKinds.includes('function')} onClick={() => toggleKindFilter('function')} color="blue" label="Functions" />
              <FilterButton active={filterKinds.includes('class')} onClick={() => toggleKindFilter('class')} color="purple" label="Classes" />
              <FilterButton active={filterKinds.includes('interface')} onClick={() => toggleKindFilter('interface')} color="cyan" label="Interfaces" />
            </div>
            <div className="flex-1" />
            <button onClick={handleExport} className="btn btn-secondary flex items-center gap-2"><Download className="w-4 h-4" />Export</button>
            <button onClick={() => setShowInspector(!showInspector)} className={`btn ${showInspector ? 'btn-primary' : 'btn-secondary'} flex items-center gap-2`}><Brain className="w-4 h-4" />Inspector</button>
            <button onClick={() => window.location.reload()} className="btn btn-secondary flex items-center gap-2"><RefreshCw className="w-4 h-4" />Refresh</button>
          </div>
        </div>

        {/* Canvas */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden">
          <canvas ref={canvasRef} onMouseMove={handleMouseMoveForPan} onMouseDown={handleMouseDown} onMouseUp={interaction.stopPanning} onMouseLeave={interaction.stopPanning} onClick={handleCanvasClick} onContextMenu={interaction.handleContextMenu} onWheel={handleWheel} className="w-full h-full" style={{ cursor: interaction.isPanning ? 'grabbing' : interaction.hoveredNode || interaction.hoveredGroup ? 'pointer' : 'grab' }} />
          {interaction.contextMenu.visible && (
            <ContextMenu x={interaction.contextMenu.x} y={interaction.contextMenu.y}
              onShowUsagePaths={() => { if (interaction.contextMenu.nodeId) { interaction.setHighlightedPaths(interaction.findUsagePaths(interaction.contextMenu.nodeId)); interaction.setPathTraceTarget(interaction.contextMenu.nodeId); } interaction.setContextMenu({ visible: false, x: 0, y: 0, nodeId: null }); }}
              onFocusNode={() => { if (interaction.contextMenu.nodeId) handleFocusNode(interaction.contextMenu.nodeId); interaction.setContextMenu({ visible: false, x: 0, y: 0, nodeId: null }); }}
              onShowConnected={() => { setFocusedNode(interaction.contextMenu.nodeId); setFocusMode(true); interaction.setContextMenu({ visible: false, x: 0, y: 0, nodeId: null }); }}
            />
          )}
          <GraphLegend />
          <ZoomHint show={detailLevel !== 'full-detail'} />
          {interaction.hoveredGroup && !interaction.hoveredNode && <HoveredGroupInfo groupId={interaction.hoveredGroup} nodeCount={nodeGroups.get(interaction.hoveredGroup)?.nodeCount || 0} />}
        </div>
      </div>

      {showInspector && focusedNodeData && (
        <Inspector node={focusedNodeData as any} nodes={nodes as any} outgoingEdges={outgoingEdges} incomingEdges={incomingEdges}
          onClose={() => { setFocusedNode(null); setFocusMode(false); }}
          onFocusConnected={() => setFocusMode(true)}
          onTracePaths={() => { interaction.setHighlightedPaths(interaction.findUsagePaths(focusedNodeData.id)); interaction.setPathTraceTarget(focusedNodeData.id); }}
        />
      )}
    </div>
  );
}

export default GraphView;

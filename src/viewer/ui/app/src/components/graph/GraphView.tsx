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
} from 'lucide-react';
import { useGraphStore, useUIStore } from '../../store';
import { getGraphData } from '../../api/client';

// Simple canvas-based graph visualization
// (In production, this would use Cytoscape.js)
export function GraphView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { nodes, edges, setGraphData, focusedNode, setFocusedNode, layout, setLayout } =
    useGraphStore();
  const { setSelectedEntity } = useUIStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(
    new Map()
  );
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<{ source: string; target: string; type: string } | null>(null);
  const [filterKinds, setFilterKinds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [focusMode, setFocusMode] = useState(false);
  const [focusDepth, setFocusDepth] = useState(2);

  // Load graph data
  useEffect(() => {
    setLoading(true);
    getGraphData({ depth: 2 })
      .then((data) => {
        // Type casting needed because API returns string but store expects specific union
        setGraphData(data.nodes as any, data.edges);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [setGraphData]);

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

      // Find all connected nodes (both directions)
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

  // Zoom to fit all visible nodes
  const handleZoomToFit = useCallback(() => {
    if (nodePositions.size === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get visible nodes based on current filters
    const visibleNodeIds = focusMode && nodesInFocusRange
      ? nodesInFocusRange
      : new Set(
        filterKinds.length > 0
          ? nodes.filter((n) => filterKinds.includes(n.kind)).map((n) => n.id)
          : nodes.map((n) => n.id)
      );

    // Calculate bounding box
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
    const newZoom = Math.min(scaleX, scaleY, 2); // Cap at 2x zoom

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

    // Center view on the node
    const pos = nodePositions.get(nodeId);
    if (pos && canvasRef.current) {
      const canvas = canvasRef.current;
      setPan({
        x: canvas.width / 2 - pos.x * zoom,
        y: canvas.height / 2 - pos.y * zoom,
      });
    }
  }, [nodePositions, zoom, setFocusedNode]);

  // Calculate tree/hierarchy layout
  const calculateTreeLayout = useCallback(() => {
    if (nodes.length === 0) return new Map();

    const positions = new Map<string, { x: number; y: number }>();
    const width = containerRef.current?.clientWidth || 800;
    // height unused


    // Build adjacency list and in-degree map
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    nodes.forEach(n => {
      adj.set(n.id, []);
      inDegree.set(n.id, 0);
    });

    edges.forEach(e => {
      // Directed: Source -> Target (e.g. Function calls Function)
      // For layout, we want dependencies to go down or up?
      // Usually "File contains Function" -> File is parent.
      // "Function A calls Function B" -> A flows to B?
      // Let's assume standard directed edges flow "down"
      if (adj.has(e.source)) {
        adj.get(e.source)?.push(e.target);
        inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
      }
    });

    // Identify roots (in-degree 0)
    let roots = nodes.filter(n => (inDegree.get(n.id) || 0) === 0);

    // If no roots (cycle), pick the node with max out-degree as pseudo-root
    if (roots.length === 0 && nodes.length > 0) {
      // Simple fallback: pick first node
      roots = [nodes[0]];
    }

    // BFS to assign levels
    const levels = new Map<string, number>();
    const queue: { id: string, level: number }[] = roots.map(r => ({ id: r.id, level: 0 }));
    const visited = new Set<string>();

    roots.forEach(r => visited.add(r.id));

    let maxLevel = 0;

    while (queue.length > 0) {
      const { id, level } = queue.shift()!;
      levels.set(id, level);
      maxLevel = Math.max(maxLevel, level);

      const neighbors = adj.get(id) || [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ id: next, level: level + 1 });
        }
      }
    }

    // Handle disconnected components / unvisited nodes
    nodes.forEach(n => {
      if (!visited.has(n.id)) {
        levels.set(n.id, 0); // Put orphaned nodes at top
      }
    });

    // Group by level
    const levelNodes = new Map<number, string[]>();
    levels.forEach((lvl, id) => {
      if (!levelNodes.has(lvl)) levelNodes.set(lvl, []);
      levelNodes.get(lvl)?.push(id);
    });

    // Assign positions
    // Y is determined by level
    // X is determined by index in level
    const verticalSpacing = 100;
    const horizontalSpacing = 80;

    levelNodes.forEach((ids, lvl) => {
      const levelWidth = ids.length * horizontalSpacing;
      const startX = (width - levelWidth) / 2;

      ids.forEach((id, idx) => {
        positions.set(id, {
          x: startX + idx * horizontalSpacing + horizontalSpacing / 2,
          y: 60 + lvl * verticalSpacing // Start with some top padding
        });
      });
    });

    return positions;
  }, [nodes, edges]);

  // Calculate node positions
  useEffect(() => {
    if (nodes.length === 0) return;

    if (layout === 'hierarchy') {
      const positions = calculateTreeLayout();
      setNodePositions(positions);
      return;
    }

    const positions = new Map<string, { x: number; y: number }>();
    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 600;

    // Simple circular layout as fallback
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

    setNodePositions(positions);
  }, [nodes, layout, calculateTreeLayout]);

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

    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

    // Draw edges
    edges.forEach((edge) => {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return;

      const from = nodePositions.get(edge.source);
      const to = nodePositions.get(edge.target);
      if (!from || !to) return;

      const isHoveredEdge = hoveredEdge?.source === edge.source && hoveredEdge?.target === edge.target;

      // Edge color based on type
      let edgeColor = '#475569';
      if (edge.type === 'calls') edgeColor = '#3b82f6';
      else if (edge.type === 'imports') edgeColor = '#10b981';
      else if (edge.type === 'extends') edgeColor = '#f59e0b';
      else if (edge.type === 'implements') edgeColor = '#8b5cf6';

      ctx.strokeStyle = isHoveredEdge ? '#ffffff' : edgeColor;
      ctx.lineWidth = isHoveredEdge ? 2 : 1;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();

      // Draw arrow head
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const arrowLength = 8;
      const arrowX = to.x - 12 * Math.cos(angle); // Offset from node center
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
        ctx.fillRect(midX - 25, midY - 10, 50, 20);
        ctx.strokeStyle = '#475569';
        ctx.strokeRect(midX - 25, midY - 10, 50, 20);
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
      const radius = isHovered || isFocused || isSearchResult ? 12 : 8;

      // Node color based on kind
      const color =
        node.kind === 'function'
          ? '#3b82f6'
          : node.kind === 'class'
            ? '#a855f7'
            : node.kind === 'interface'
              ? '#06b6d4'
              : '#6b7280';

      // Draw search result highlight ring
      if (isSearchResult) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Draw node circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Draw Justification/Classification Overlay
      // Classification Halo
      if (node.classification) {
        ctx.beginPath();
        const haloRadius = radius + 4;
        ctx.arc(pos.x, pos.y, haloRadius, 0, Math.PI * 2);
        ctx.strokeStyle = node.classification === 'domain' ? '#10b981' : '#f59e0b'; // Green for domain, Amber for infra
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 4]); // Dotted for classification
        ctx.stroke();
        ctx.setLineDash([]); // Reset
      }

      // Confidence Ring (Inner or Outer?)
      if (node.confidence !== undefined) {
        const conf = node.confidence;
        ctx.beginPath();
        // Outer ring
        ctx.arc(pos.x, pos.y, radius + 2, 0, Math.PI * 2 * conf); // partial arc indicating confidence
        ctx.strokeStyle = `rgba(255, 255, 255, 0.7)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (isHovered || isFocused || isSearchResult) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Draw label for hovered/focused/search result nodes
      if (isHovered || isFocused || isSearchResult) {
        // Draw label background for better visibility
        ctx.font = '12px sans-serif';
        const labelWidth = ctx.measureText(node.label).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(pos.x - labelWidth / 2 - 4, pos.y - radius - 22, labelWidth + 8, 16);

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, pos.x, pos.y - radius - 10);
      }
    });

    ctx.restore();
  }, [nodes, edges, nodePositions, zoom, pan, hoveredNode, hoveredEdge, focusedNode, filterKinds, focusMode, nodesInFocusRange, searchResults]);

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
        if (Math.sqrt(dx * dx + dy * dy) < 12) {
          foundNode = id;
          break;
        }
      }
      setHoveredNode(foundNode);

      // Find edge under cursor (if no node is hovered)
      if (!foundNode) {
        let foundEdge: { source: string; target: string; type: string } | null = null;
        const threshold = 8; // Distance threshold for edge hover

        for (const edge of edges) {
          const from = nodePositions.get(edge.source);
          const to = nodePositions.get(edge.target);
          if (!from || !to) continue;

          // Calculate distance from point to line segment
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

  const handleCanvasClick = useCallback(() => {
    if (hoveredNode) {
      setFocusedNode(hoveredNode);
      const node = nodes.find((n) => n.id === hoveredNode);
      if (node) {
        // Create a partial entity for selection
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
  }, [hoveredNode, nodes, setFocusedNode, setSelectedEntity]);

  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.2, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z / 1.2, 0.3));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const toggleKindFilter = (kind: string) => {
    setFilterKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        Loading graph data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitBranch className="w-5 h-5 text-blue-400" />
            <h1 className="text-xl font-semibold text-white">Knowledge Graph</h1>
            <span className="text-sm text-slate-500">
              {nodes.length} nodes, {edges.length} edges
            </span>
          </div>

          {/* Layout selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Layout:</span>
            <select
              value={layout}
              onChange={(e) => setLayout(e.target.value as 'force' | 'hierarchy' | 'radial')}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200"
            >
              <option value="force">Force-Directed</option>
              <option value="hierarchy">Hierarchy (Tree)</option>
              <option value="radial">Radial</option>
            </select>
          </div>
        </div>

        {/* Controls Row 1: Search and Zoom */}
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
            {/* Search results dropdown */}
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
                        style={{
                          backgroundColor:
                            node.kind === 'function' ? '#3b82f6' :
                              node.kind === 'class' ? '#a855f7' :
                                node.kind === 'interface' ? '#06b6d4' : '#6b7280'
                        }}
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
            <button
              onClick={handleZoomOut}
              className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="px-2 text-sm text-slate-400 min-w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={handleReset}
              className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white"
              title="Reset View"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleZoomToFit}
              className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white"
              title="Zoom to Fit"
            >
              <Target className="w-4 h-4" />
            </button>
          </div>

          {/* Focus mode toggle */}
          <div className="flex items-center gap-2 bg-slate-700 rounded-lg p-1">
            <button
              onClick={() => setFocusMode(!focusMode)}
              className={`p-1.5 rounded flex items-center gap-1.5 text-sm ${focusMode
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:bg-slate-600 hover:text-white'
                }`}
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
                title="Depth of connections to show"
              >
                <option value="1">1 hop</option>
                <option value="2">2 hops</option>
                <option value="3">3 hops</option>
                <option value="4">4 hops</option>
              </select>
            )}
          </div>
        </div>

        {/* Controls Row 2: Filters and Actions */}
        <div className="flex items-center gap-4 mt-3">
          {/* Kind filters */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <FilterButton
              active={filterKinds.includes('function')}
              onClick={() => toggleKindFilter('function')}
              color="blue"
              label="Functions"
            />
            <FilterButton
              active={filterKinds.includes('class')}
              onClick={() => toggleKindFilter('class')}
              color="purple"
              label="Classes"
            />
            <FilterButton
              active={filterKinds.includes('interface')}
              onClick={() => toggleKindFilter('interface')}
              color="cyan"
              label="Interfaces"
            />
          </div>

          <div className="flex-1" />

          {/* Export */}
          <button
            onClick={handleExport}
            className="btn btn-secondary flex items-center gap-2"
            title="Export as PNG"
          >
            <Download className="w-4 h-4" />
            Export
          </button>

          {/* Refresh */}
          <button
            onClick={() => window.location.reload()}
            className="btn btn-secondary flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Graph Canvas */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseMove={handleCanvasMouseMove}
          onClick={handleCanvasClick}
          className="w-full h-full cursor-crosshair"
          style={{ cursor: hoveredNode ? 'pointer' : 'crosshair' }}
        />

        {/* Legend */}


        {/* Focused node info */}
        {focusedNode && (
          <div className="absolute bottom-4 left-4 bg-slate-800 border border-slate-700 rounded-lg p-4 shadow-lg max-w-sm">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-blue-400" />
              <span className="font-medium text-white">
                {nodes.find((n) => n.id === focusedNode)?.label}
              </span>
              <span className="text-xs text-slate-500 px-1.5 py-0.5 bg-slate-700 rounded">
                {nodes.find((n) => n.id === focusedNode)?.kind}
              </span>
            </div>
            <div className="text-sm text-slate-400 space-y-1">
              <div>
                Connected to{' '}
                {edges.filter((e) => e.source === focusedNode || e.target === focusedNode).length}{' '}
                nodes
              </div>
              {/* Show connection breakdown */}
              <div className="flex flex-wrap gap-2 mt-2">
                {(() => {
                  const outgoing = edges.filter((e) => e.source === focusedNode);
                  const incoming = edges.filter((e) => e.target === focusedNode);
                  return (
                    <>
                      {outgoing.length > 0 && (
                        <span className="text-xs px-1.5 py-0.5 bg-slate-700 rounded text-green-400">
                          {outgoing.length} outgoing
                        </span>
                      )}
                      {incoming.length > 0 && (
                        <span className="text-xs px-1.5 py-0.5 bg-slate-700 rounded text-blue-400">
                          {incoming.length} incoming
                        </span>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => { setFocusedNode(null); setFocusMode(false); }}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Clear selection
              </button>
              {!focusMode && (
                <button
                  onClick={() => setFocusMode(true)}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Focus mode
                </button>
              )}
            </div>
          </div>
        )}

        {/* Hovered edge info */}
        {hoveredEdge && !hoveredNode && (
          <div className="absolute top-20 left-4 bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-lg">
            <div className="text-xs text-slate-500 mb-1">Edge</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-200">{nodes.find((n) => n.id === hoveredEdge.source)?.label || 'Unknown'}</span>
              <span className="text-slate-500">→</span>
              <span
                className="px-1.5 py-0.5 rounded text-xs font-medium"
                style={{
                  backgroundColor:
                    hoveredEdge.type === 'calls' ? 'rgba(59, 130, 246, 0.2)' :
                      hoveredEdge.type === 'imports' ? 'rgba(16, 185, 129, 0.2)' :
                        hoveredEdge.type === 'extends' ? 'rgba(245, 158, 11, 0.2)' :
                          'rgba(107, 114, 128, 0.2)',
                  color:
                    hoveredEdge.type === 'calls' ? '#3b82f6' :
                      hoveredEdge.type === 'imports' ? '#10b981' :
                        hoveredEdge.type === 'extends' ? '#f59e0b' :
                          '#6b7280'
                }}
              >
                {hoveredEdge.type}
              </span>
              <span className="text-slate-500">→</span>
              <span className="text-slate-200">{nodes.find((n) => n.id === hoveredEdge.target)?.label || 'Unknown'}</span>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 right-4 bg-slate-800/90 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-slate-500 mb-2">Nodes</div>
          <div className="flex flex-col gap-1.5">
            <LegendItem color="#3b82f6" label="Function" />
            <LegendItem color="#a855f7" label="Class" />
            <LegendItem color="#06b6d4" label="Interface" />
            <LegendItem color="#6b7280" label="Other" />
          </div>
          <div className="text-xs text-slate-500 mb-2 mt-3">Edges</div>
          <div className="flex flex-col gap-1.5">
            <LegendItem color="#3b82f6" label="Calls" isEdge />
            <LegendItem color="#10b981" label="Imports" isEdge />
            <LegendItem color="#f59e0b" label="Extends" isEdge />
            <LegendItem color="#8b5cf6" label="Implements" isEdge />
          </div>
          <div className="text-xs text-slate-500 mb-2 mt-3">Classification</div>
          <div className="flex flex-col gap-1.5">
            <LegendItem color="#10b981" label="Domain" isDashed />
            <LegendItem color="#f59e0b" label="Infrastructure" isDashed />
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  color,
  label,
}: {
  active: boolean;
  onClick: () => void;
  color: string;
  label: string;
}) {
  const colorClasses =
    color === 'blue'
      ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
      : color === 'purple'
        ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
        : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';

  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 text-xs rounded border transition-colors ${active
        ? colorClasses
        : 'bg-slate-700 text-slate-400 border-slate-600 hover:border-slate-500'
        }`}
    >
      {label}
    </button>
  );
}

function LegendItem({
  color,
  label,
  isEdge,
  isDashed,
}: {
  color: string;
  label: string;
  isEdge?: boolean;
  isDashed?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {isEdge ? (
        <div className="w-4 h-0.5" style={{ backgroundColor: color }} />
      ) : isDashed ? (
        <div
          className="w-3 h-3 rounded-full border-2"
          style={{ borderColor: color, borderStyle: 'dashed' }}
        />
      ) : (
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
      )}
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}

export default GraphView;

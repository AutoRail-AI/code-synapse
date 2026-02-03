import { useState, useEffect, useRef, useCallback } from 'react';
import {
  GitBranch,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Filter,
  Target,
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
  const [filterKinds, setFilterKinds] = useState<string[]>([]);

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

    // Filter nodes
    const visibleNodes =
      filterKinds.length > 0
        ? nodes.filter((n) => filterKinds.includes(n.kind))
        : nodes;
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

    // Draw edges
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    edges.forEach((edge) => {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return;

      const from = nodePositions.get(edge.source);
      const to = nodePositions.get(edge.target);
      if (!from || !to) return;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    });

    // Draw nodes
    visibleNodes.forEach((node) => {
      const pos = nodePositions.get(node.id);
      if (!pos) return;

      const isHovered = hoveredNode === node.id;
      const isFocused = focusedNode === node.id;
      const radius = isHovered || isFocused ? 12 : 8;

      // Node color based on kind
      const color =
        node.kind === 'function'
          ? '#3b82f6'
          : node.kind === 'class'
            ? '#a855f7'
            : node.kind === 'interface'
              ? '#06b6d4'
              : '#6b7280';

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

      if (isHovered || isFocused) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Draw label for hovered/focused nodes
      if (isHovered || isFocused) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, pos.x, pos.y - radius - 8);
      }
    });

    ctx.restore();
  }, [nodes, edges, nodePositions, zoom, pan, hoveredNode, focusedNode, filterKinds]);

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
      let found: string | null = null;
      for (const [id, pos] of nodePositions) {
        const dx = pos.x - x;
        const dy = pos.y - y;
        if (Math.sqrt(dx * dx + dy * dy) < 12) {
          found = id;
          break;
        }
      }
      setHoveredNode(found);
    },
    [nodePositions, zoom, pan]
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

        {/* Controls */}
        <div className="flex items-center gap-4 mt-4">
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
          </div>

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

        {/* Focused node info */}
        {focusedNode && (
          <div className="absolute bottom-4 left-4 bg-slate-800 border border-slate-700 rounded-lg p-4 shadow-lg max-w-sm">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-blue-400" />
              <span className="font-medium text-white">
                {nodes.find((n) => n.id === focusedNode)?.label}
              </span>
            </div>
            <div className="text-sm text-slate-400">
              Connected to{' '}
              {edges.filter((e) => e.source === focusedNode || e.target === focusedNode).length}{' '}
              nodes
            </div>
            <button
              onClick={() => setFocusedNode(null)}
              className="mt-2 text-xs text-slate-500 hover:text-slate-300"
            >
              Clear selection
            </button>
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 right-4 bg-slate-800/90 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-slate-500 mb-2">Legend</div>
          <div className="flex flex-col gap-1.5">
            <LegendItem color="#3b82f6" label="Function" />
            <LegendItem color="#a855f7" label="Class" />
            <LegendItem color="#06b6d4" label="Interface" />
            <LegendItem color="#6b7280" label="Other" />
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

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}

export default GraphView;

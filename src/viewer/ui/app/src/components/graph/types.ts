/**
 * Type definitions for the Knowledge Graph visualization
 */

export interface NodePosition {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string | null;
}

export interface NodeGroup {
  id: string;
  name: string;
  nodes: string[];
  x: number;
  y: number;
  radius: number;
  color: string;
  nodeCount: number;
}

export interface BundledEdge {
  sourceGroup: string;
  targetGroup: string;
  count: number;
  types: Set<string>;
}

export type NodeShape = 'circle' | 'hexagon' | 'cylinder' | 'diamond' | 'square';

export type LensType = 'structure' | 'business' | 'infra' | 'pattern';

export type DetailLevel = 'groups-only' | 'groups-with-labels' | 'sparse-nodes' | 'full-detail';

export interface GraphNode {
  id: string;
  label: string;
  kind: string;
  confidence?: number;
  classification?: string;
  featureContext?: string;
  purposeSummary?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

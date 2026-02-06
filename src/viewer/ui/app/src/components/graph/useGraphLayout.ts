/**
 * Custom hook for graph layout calculations
 * Handles force-directed simulation and various lens-based layouts
 */

import { useMemo, useCallback } from 'react';
import type { NodePosition, NodeGroup, BundledEdge, LensType } from './types';
import { getNodeDirectory, getFeatureGroup } from './utils';

interface GraphNode {
  id: string;
  label: string;
  kind: string;
  confidence?: number;
  classification?: string;
  featureContext?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

interface UseGraphLayoutProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  activeLens: LensType;
  containerRef: React.RefObject<HTMLDivElement>;
}

interface UseGraphLayoutResult {
  nodeGroups: Map<string, NodeGroup>;
  bundledEdges: Map<string, BundledEdge>;
  getGroupColor: (groupId: string) => string;
  calculatePositions: () => Map<string, NodePosition>;
}

export function useGraphLayout({
  nodes,
  edges,
  activeLens,
  containerRef,
}: UseGraphLayoutProps): UseGraphLayoutResult {
  // Generate consistent color from group name
  const getGroupColor = useCallback((groupId: string): string => {
    if (activeLens === 'pattern') {
      if (groupId === 'high-confidence') return '#10b981';
      if (groupId === 'medium-confidence') return '#f59e0b';
      return '#ef4444';
    }
    if (activeLens === 'infra') {
      if (groupId === 'domain') return '#3b82f6';
      if (groupId === 'infrastructure') return '#f59e0b';
      return '#6b7280';
    }
    let hash = 0;
    for (let i = 0; i < groupId.length; i++) {
      hash = groupId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
    return colors[Math.abs(hash) % colors.length];
  }, [activeLens]);

  // Compute node groups for clustering
  const nodeGroups = useMemo(() => {
    const groups = new Map<string, NodeGroup>();

    nodes.forEach(node => {
      let groupKey: string;

      if (activeLens === 'business') {
        groupKey = getFeatureGroup(node);
      } else if (activeLens === 'infra') {
        groupKey = node.classification || 'unclassified';
      } else if (activeLens === 'pattern') {
        const conf = node.confidence ?? 0.5;
        groupKey = conf >= 0.8 ? 'high-confidence' : conf >= 0.5 ? 'medium-confidence' : 'low-confidence';
      } else {
        groupKey = getNodeDirectory(node.label);
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          id: groupKey,
          name: groupKey,
          nodes: [],
          x: 0,
          y: 0,
          radius: 0,
          color: '#3b82f6',
          nodeCount: 0,
        });
      }
      groups.get(groupKey)!.nodes.push(node.id);
      groups.get(groupKey)!.nodeCount++;
    });

    return groups;
  }, [nodes, activeLens]);

  // Compute bundled edges between groups
  const bundledEdges = useMemo(() => {
    const bundles = new Map<string, BundledEdge>();
    const nodeToGroup = new Map<string, string>();

    nodeGroups.forEach((group, groupId) => {
      group.nodes.forEach(nodeId => nodeToGroup.set(nodeId, groupId));
    });

    edges.forEach(edge => {
      const sourceGroup = nodeToGroup.get(edge.source);
      const targetGroup = nodeToGroup.get(edge.target);

      if (sourceGroup && targetGroup && sourceGroup !== targetGroup) {
        const key = `${sourceGroup}->${targetGroup}`;
        if (!bundles.has(key)) {
          bundles.set(key, { sourceGroup, targetGroup, count: 0, types: new Set() });
        }
        const bundle = bundles.get(key)!;
        bundle.count++;
        bundle.types.add(edge.type);
      }
    });

    return bundles;
  }, [edges, nodeGroups]);

  // Run clustered force-directed simulation
  const runClusteredForceSimulation = useCallback(() => {
    if (nodes.length === 0) return new Map<string, NodePosition>();

    const positions = new Map<string, NodePosition>();
    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 600;
    const centerX = width / 2;
    const centerY = height / 2;

    const groupArray = Array.from(nodeGroups.values());
    const groupPositions = new Map<string, { x: number; y: number }>();

    // Initial group positions in a circle
    groupArray.forEach((group, i) => {
      const angle = (2 * Math.PI * i) / groupArray.length;
      const radius = Math.min(width, height) * 0.3;
      groupPositions.set(group.id, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    });

    // Run force simulation on groups
    const iterations = 50;
    for (let iter = 0; iter < iterations; iter++) {
      // Repulsion between groups
      groupArray.forEach((groupA) => {
        const posA = groupPositions.get(groupA.id)!;
        groupArray.forEach((groupB) => {
          if (groupA.id === groupB.id) return;
          const posB = groupPositions.get(groupB.id)!;
          const dx = posA.x - posB.x;
          const dy = posA.y - posB.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = 100 + (groupA.nodeCount + groupB.nodeCount) * 2;
          if (dist < minDist) {
            const force = ((minDist - dist) / dist) * 0.5;
            posA.x += dx * force;
            posA.y += dy * force;
          }
        });
      });

      // Attraction along bundled edges
      bundledEdges.forEach((bundle) => {
        const posA = groupPositions.get(bundle.sourceGroup);
        const posB = groupPositions.get(bundle.targetGroup);
        if (!posA || !posB) return;
        const dx = posB.x - posA.x;
        const dy = posB.y - posA.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idealDist = 200;
        if (dist > idealDist) {
          const force = ((dist - idealDist) / dist) * 0.1 * Math.log2(bundle.count + 1);
          posA.x += dx * force;
          posA.y += dy * force;
          posB.x -= dx * force;
          posB.y -= dy * force;
        }
      });

      // Center gravity
      groupArray.forEach((group) => {
        const pos = groupPositions.get(group.id)!;
        pos.x += (centerX - pos.x) * 0.02;
        pos.y += (centerY - pos.y) * 0.02;
        pos.x = Math.max(100, Math.min(width - 100, pos.x));
        pos.y = Math.max(100, Math.min(height - 100, pos.y));
      });
    }

    // Update group positions
    groupArray.forEach((group) => {
      const pos = groupPositions.get(group.id)!;
      group.x = pos.x;
      group.y = pos.y;
      const minRadius = 40;
      const nodeSpacing = 15;
      const circumference = group.nodeCount * nodeSpacing;
      group.radius = Math.max(minRadius, circumference / (2 * Math.PI));
      group.color = getGroupColor(group.id);
    });

    // Position nodes within their groups
    nodeGroups.forEach((group) => {
      const groupNodes = group.nodes;
      if (groupNodes.length === 1) {
        positions.set(groupNodes[0], { x: group.x, y: group.y });
      } else {
        groupNodes.forEach((nodeId, i) => {
          const angle = (2 * Math.PI * i) / groupNodes.length;
          const nodeRadius = Math.max(20, group.radius - 20);
          positions.set(nodeId, {
            x: group.x + nodeRadius * Math.cos(angle),
            y: group.y + nodeRadius * Math.sin(angle),
          });
        });
      }
    });

    return positions;
  }, [nodes, nodeGroups, bundledEdges, getGroupColor, containerRef]);

  // Calculate positions based on active lens
  const calculatePositions = useCallback((): Map<string, NodePosition> => {
    if (nodes.length === 0) return new Map();

    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 600;

    if (activeLens === 'business' || activeLens === 'structure') {
      return runClusteredForceSimulation();
    }

    if (activeLens === 'infra') {
      const positions = new Map<string, NodePosition>();
      const groupArray = Array.from(nodeGroups.values());
      const columns: { [key: string]: number } = {
        domain: width * 0.2,
        unclassified: width * 0.5,
        infrastructure: width * 0.8,
      };

      groupArray.forEach((group) => {
        const colX = columns[group.id] || width * 0.5;
        group.x = colX;
        group.y = height / 2;
        const nodeSpacing = 15;
        const circumference = group.nodeCount * nodeSpacing;
        group.radius = Math.max(50, Math.min(150, circumference / (2 * Math.PI)));
        group.color = getGroupColor(group.id);

        group.nodes.forEach((nodeId, i) => {
          const angle = (2 * Math.PI * i) / group.nodes.length;
          const r = Math.max(20, group.radius - 20);
          positions.set(nodeId, {
            x: group.x + r * Math.cos(angle),
            y: group.y + r * Math.sin(angle),
          });
        });
      });

      return positions;
    }

    if (activeLens === 'pattern') {
      const positions = new Map<string, NodePosition>();
      const groupArray = Array.from(nodeGroups.values());
      const centerX = width / 2;
      const centerY = height / 2;
      const ringOrder = ['high-confidence', 'medium-confidence', 'low-confidence'];
      let currentRadius = 0;

      ringOrder.forEach((ringId) => {
        const group = groupArray.find((g) => g.id === ringId);
        if (!group || group.nodes.length === 0) return;

        const nodeSpacing = 20;
        const circumference = group.nodes.length * nodeSpacing;
        const ringRadius = Math.max(60, circumference / (2 * Math.PI));

        currentRadius += ringRadius + 40;
        group.x = centerX;
        group.y = centerY;
        group.radius = ringRadius;
        group.color = getGroupColor(ringId);

        group.nodes.forEach((nodeId, i) => {
          const angle = (2 * Math.PI * i) / group.nodes.length - Math.PI / 2;
          positions.set(nodeId, {
            x: centerX + currentRadius * Math.cos(angle),
            y: centerY + currentRadius * Math.sin(angle),
          });
        });
      });

      return positions;
    }

    return runClusteredForceSimulation();
  }, [nodes, activeLens, runClusteredForceSimulation, nodeGroups, getGroupColor, containerRef]);

  return {
    nodeGroups,
    bundledEdges,
    getGroupColor,
    calculatePositions,
  };
}

/**
 * Reusable UI components for the Knowledge Graph visualization
 */

import React from 'react';
import {
  Layers,
  Box,
  Hash,
  Database,
} from 'lucide-react';
import type { LensType } from './types';

// =============================================================================
// Filter Button
// =============================================================================

interface FilterButtonProps {
  active: boolean;
  onClick: () => void;
  color: 'blue' | 'purple' | 'cyan';
  label: string;
}

export function FilterButton({ active, onClick, color, label }: FilterButtonProps) {
  const colorClasses = {
    blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    cyan: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  };

  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 text-xs rounded border transition-colors ${
        active
          ? colorClasses[color]
          : 'bg-slate-700 text-slate-400 border-slate-600 hover:border-slate-500'
      }`}
    >
      {label}
    </button>
  );
}

// =============================================================================
// Lens Button
// =============================================================================

interface LensButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  lens: LensType;
}

const lensIcons: Record<LensType, React.ReactNode> = {
  structure: <Layers className="w-3.5 h-3.5" />,
  business: <Box className="w-3.5 h-3.5" />,
  infra: <Database className="w-3.5 h-3.5" />,
  pattern: <Hash className="w-3.5 h-3.5" />,
};

export function LensButton({ active, onClick, label, lens }: LensButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded font-medium transition-colors flex items-center gap-1.5 ${
        active
          ? 'bg-blue-600 text-white'
          : 'text-slate-400 hover:bg-slate-600 hover:text-white'
      }`}
    >
      {lensIcons[lens]}
      {label}
    </button>
  );
}

// =============================================================================
// Legend Item
// =============================================================================

interface LegendItemProps {
  shape?: 'circle' | 'hexagon' | 'diamond';
  color: string;
  label: string;
}

export function LegendItem({ shape = 'circle', color, label }: LegendItemProps) {
  return (
    <div className="flex items-center gap-2">
      {shape === 'hexagon' ? (
        <svg width="12" height="12" viewBox="0 0 12 12">
          <polygon points="6,0 11,3 11,9 6,12 1,9 1,3" fill={color} />
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

// =============================================================================
// Metric Card
// =============================================================================

interface MetricCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}

export function MetricCard({ label, value, icon, color }: MetricCardProps) {
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

// =============================================================================
// Graph Legend
// =============================================================================

export function GraphLegend() {
  return (
    <div className="absolute bottom-4 left-4 bg-slate-800/95 border border-slate-700 rounded-lg p-3 text-xs">
      <div className="text-slate-500 font-medium mb-2">Groups</div>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-4 h-4 rounded-full border-2 border-dashed border-blue-500 bg-blue-500/20" />
        <span className="text-slate-400">Collapsed cluster</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-4 h-4 rounded-full border-2 border-blue-500 bg-blue-500/20" />
        <span className="text-slate-400">Expanded cluster</span>
      </div>
      <div className="text-slate-500 font-medium mb-2">Nodes</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <LegendItem shape="circle" color="#3b82f6" label="Function" />
        <LegendItem shape="circle" color="#a855f7" label="Class" />
        <LegendItem shape="diamond" color="#06b6d4" label="Interface" />
        <LegendItem shape="hexagon" color="#10b981" label="Domain" />
      </div>
    </div>
  );
}

// =============================================================================
// Detail Level Indicator
// =============================================================================

interface DetailLevelIndicatorProps {
  detailLevel: 'groups-only' | 'groups-with-labels' | 'sparse-nodes' | 'full-detail';
}

export function DetailLevelIndicator({ detailLevel }: DetailLevelIndicatorProps) {
  const labels = {
    'groups-only': 'Groups only',
    'groups-with-labels': 'Groups + Labels',
    'sparse-nodes': 'Sparse nodes',
    'full-detail': 'Full detail',
  };

  return (
    <div className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">
      {labels[detailLevel]}
    </div>
  );
}

// =============================================================================
// Zoom Hint
// =============================================================================

interface ZoomHintProps {
  show: boolean;
}

export function ZoomHint({ show }: ZoomHintProps) {
  if (!show) return null;

  return (
    <div className="absolute top-4 left-4 bg-blue-500/20 text-blue-400 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2">
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      Zoom in for more detail
    </div>
  );
}

// =============================================================================
// Hovered Group Info
// =============================================================================

interface HoveredGroupInfoProps {
  groupId: string;
  nodeCount: number;
}

export function HoveredGroupInfo({ groupId, nodeCount }: HoveredGroupInfoProps) {
  return (
    <div className="absolute top-4 right-4 bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm max-w-xs">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="font-medium text-white">{groupId}</span>
      </div>
      <div className="text-slate-400">{nodeCount} entities</div>
      <div className="text-xs text-slate-500 mt-2">Click to expand/collapse</div>
    </div>
  );
}

// =============================================================================
// Context Menu
// =============================================================================

interface ContextMenuProps {
  x: number;
  y: number;
  onShowUsagePaths: () => void;
  onFocusNode: () => void;
  onShowConnected: () => void;
}

export function ContextMenu({ x, y, onShowUsagePaths, onFocusNode, onShowConnected }: ContextMenuProps) {
  return (
    <div
      className="absolute bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 z-50"
      style={{ left: x, top: y }}
    >
      <button
        onClick={onShowUsagePaths}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
        Show Usage Paths
      </button>
      <button
        onClick={onFocusNode}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
        Focus on Node
      </button>
      <button
        onClick={onShowConnected}
        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        Show Connected
      </button>
    </div>
  );
}

/**
 * Inspector Panel component for viewing detailed information about a selected node
 */

import {
  X,
  Layers,
  Box,
  Hash,
  Brain,
  Activity,
  GitBranch,
  ArrowRight,
  ChevronRight,
  Focus,
} from 'lucide-react';
import { MetricCard } from './components';
import type { GraphNode, GraphEdge } from './types';

interface InspectorProps {
  node: GraphNode;
  nodes: GraphNode[];
  outgoingEdges: GraphEdge[];
  incomingEdges: GraphEdge[];
  onClose: () => void;
  onFocusConnected: () => void;
  onTracePaths: () => void;
}

export function Inspector({
  node,
  nodes,
  outgoingEdges,
  incomingEdges,
  onClose,
  onFocusConnected,
  onTracePaths,
}: InspectorProps) {
  const getKindIcon = (kind: string) => {
    switch (kind) {
      case 'function':
        return <Box className="w-5 h-5" />;
      case 'class':
        return <Layers className="w-5 h-5" />;
      default:
        return <Hash className="w-5 h-5" />;
    }
  };

  const getKindColorClass = (kind: string) => {
    switch (kind) {
      case 'function':
        return 'bg-blue-500/20 text-blue-400';
      case 'class':
        return 'bg-purple-500/20 text-purple-400';
      default:
        return 'bg-cyan-500/20 text-cyan-400';
    }
  };

  const getClassificationColorClass = (classification: string) => {
    return classification === 'domain'
      ? 'bg-emerald-500/20 text-emerald-400'
      : 'bg-amber-500/20 text-amber-400';
  };

  return (
    <div className="w-80 border-l border-slate-700 bg-slate-900 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 bg-slate-800/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wider font-semibold">
            <Brain className="w-4 h-4 text-purple-400" />
            Entity Inspector
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-start gap-3">
          <div className={`p-2.5 rounded-lg ${getKindColorClass(node.kind)}`}>
            {getKindIcon(node.kind)}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white truncate">{node.label}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${getKindColorClass(
                  node.kind
                )}`}
              >
                {node.kind}
              </span>
              {node.classification && (
                <span
                  className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${getClassificationColorClass(
                    node.classification
                  )}`}
                >
                  {node.classification}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {/* Metrics */}
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            label="Confidence"
            value={`${Math.round((node.confidence ?? 0) * 100)}%`}
            icon={<Activity className="w-4 h-4 text-green-400" />}
            color={(node.confidence ?? 0) >= 0.8 ? 'text-green-400' : 'text-yellow-400'}
          />
          <MetricCard
            label="Connections"
            value={`${outgoingEdges.length + incomingEdges.length}`}
            icon={<GitBranch className="w-4 h-4 text-blue-400" />}
            color="text-blue-400"
          />
        </div>

        {/* Business Context */}
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
          <div className="text-xs text-slate-500 font-medium uppercase mb-2 flex items-center gap-1">
            <Brain className="w-3 h-3" />
            Business Context
          </div>
          {node.purposeSummary ? (
            <p className="text-sm text-slate-300 leading-relaxed mb-3">
              {node.purposeSummary}
            </p>
          ) : (
            <p className="text-sm text-slate-500 italic mb-3">
              No justification available.
            </p>
          )}
          {node.featureContext && (
            <div className="inline-block px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">
              {node.featureContext}
            </div>
          )}
        </div>

        {/* Relationships */}
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
          <div className="text-xs text-slate-500 font-medium uppercase mb-2 flex items-center gap-1">
            <ArrowRight className="w-3 h-3" />
            Relationships
          </div>

          {/* Outgoing */}
          {outgoingEdges.length > 0 && (
            <div className="mb-3">
              <div className="text-xs text-green-400 mb-1 flex items-center gap-1">
                <ChevronRight className="w-3 h-3" />
                Outgoing ({outgoingEdges.length})
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {outgoingEdges.slice(0, 5).map((edge, i) => {
                  const target = nodes.find((n) => n.id === edge.target);
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">{edge.type}</span>
                      <span className="text-slate-300 truncate">{target?.label}</span>
                    </div>
                  );
                })}
                {outgoingEdges.length > 5 && (
                  <div className="text-xs text-slate-500">
                    +{outgoingEdges.length - 5} more
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Incoming */}
          {incomingEdges.length > 0 && (
            <div>
              <div className="text-xs text-blue-400 mb-1 flex items-center gap-1">
                <ChevronRight className="w-3 h-3 rotate-180" />
                Incoming ({incomingEdges.length})
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {incomingEdges.slice(0, 5).map((edge, i) => {
                  const source = nodes.find((n) => n.id === edge.source);
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="text-slate-300 truncate">{source?.label}</span>
                      <span className="text-slate-500">{edge.type}</span>
                    </div>
                  );
                })}
                {incomingEdges.length > 5 && (
                  <div className="text-xs text-slate-500">
                    +{incomingEdges.length - 5} more
                  </div>
                )}
              </div>
            </div>
          )}

          {outgoingEdges.length === 0 && incomingEdges.length === 0 && (
            <p className="text-sm text-slate-500 italic">No relationships found.</p>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <button
            onClick={onFocusConnected}
            className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-200 flex items-center justify-center gap-2"
          >
            <Focus className="w-4 h-4" />
            Focus Connected
          </button>
          <button
            onClick={onTracePaths}
            className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-200 flex items-center justify-center gap-2"
          >
            <ArrowRight className="w-4 h-4" />
            Trace Paths
          </button>
        </div>
      </div>
    </div>
  );
}

export default Inspector;

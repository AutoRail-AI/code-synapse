import { useState, useEffect } from 'react';
import {
    Network,
    Share2,
    Lightbulb,
    Box,
    Layers,
    Hash,
    FileCode
} from 'lucide-react';
import { EntitySummary, getDependencyGraph, GraphData } from '../../api/client';

interface ContextPanelProps {
    path: string | null;
    entities: EntitySummary[];
}

type Tab = 'ast' | 'deps' | 'knowledge' | 'stats';

export function ContextPanel({ path, entities }: ContextPanelProps) {
    const isFolder = path ? !path.split('/').pop()?.includes('.') : false;
    const [activeTab, setActiveTab] = useState<Tab>(isFolder ? 'stats' : 'ast');

    // Switch to stats tab if folder is selected
    useEffect(() => {
        if (isFolder) {
            setActiveTab('stats');
        } else if (activeTab === 'stats') {
            setActiveTab('ast');
        }
    }, [isFolder]);

    const [dependencyData, setDependencyData] = useState<GraphData | null>(null);
    const [loadingDeps, setLoadingDeps] = useState(false);

    // Load dependencies when tab is active and file changes
    useEffect(() => {
        if (activeTab === 'deps' && path && !isFolder) {
            setLoadingDeps(true);
            getDependencyGraph(path)
                .then(setDependencyData)
                .catch(console.error)
                .finally(() => setLoadingDeps(false));
        }
    }, [activeTab, path, isFolder]);

    if (!path) {
        return (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm p-4 text-center">
                Select a file to view context
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-slate-900 border-l border-slate-700">
            {/* Tabs */}
            <div className="flex border-b border-slate-700">
                {!isFolder && (
                    <>
                        <TabButton
                            active={activeTab === 'ast'}
                            onClick={() => setActiveTab('ast')}
                            icon={<Network className="w-4 h-4" />}
                            label="Structure"
                        />
                        <TabButton
                            active={activeTab === 'deps'}
                            onClick={() => setActiveTab('deps')}
                            icon={<Share2 className="w-4 h-4" />}
                            label="Deps"
                        />
                        <TabButton
                            active={activeTab === 'knowledge'}
                            onClick={() => setActiveTab('knowledge')}
                            icon={<Lightbulb className="w-4 h-4" />}
                            label="Insights"
                        />
                    </>
                )}
                {isFolder && (
                    <TabButton
                        active={activeTab === 'stats'}
                        onClick={() => setActiveTab('stats')}
                        icon={<Layers className="w-4 h-4" />}
                        label="Overview"
                    />
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto custom-scrollbar p-0">
                {activeTab === 'ast' && <StructureView entities={entities} />}
                {activeTab === 'deps' && <DependenciesView data={dependencyData} loading={loadingDeps} />}
                {activeTab === 'knowledge' && <InsightsView entities={entities} />}
                {activeTab === 'stats' && <StatsView entities={entities} />}
            </div>
        </div>
    );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-medium border-b-2 transition-colors ${active
                ? 'border-blue-500 text-blue-400 bg-slate-800/50'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
        >
            {icon}
            {label}
        </button>
    );
}

// --- Views ---

function StructureView({ entities }: { entities: EntitySummary[] }) {
    // Simple hierarchical view based on containment (mocked by sort order for now)
    // Real implementation would build a tree from startLine/endLine

    const sorted = [...entities].sort((a, b) => a.startLine - b.startLine);

    if (entities.length === 0) {
        return <div className="p-4 text-slate-500 text-sm">No entities found in this file.</div>;
    }

    return (
        <div className="p-2">
            {sorted.map(entity => (
                <div key={entity.id} className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-800 rounded group cursor-pointer">
                    <EntityIcon kind={entity.kind} />
                    <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-300 truncate">{entity.name}</div>
                        <div className="text-xs text-slate-500 flex justify-between">
                            <span>Line {entity.startLine}</span>
                            {entity.classification && (
                                <span className={`px-1.5 rounded-full text-[10px] ${entity.classification === 'domain' ? 'bg-blue-900/50 text-blue-300' : 'bg-slate-700 text-slate-300'
                                    }`}>
                                    {entity.classification}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function DependenciesView({ data, loading }: { data: GraphData | null; loading: boolean }) {
    if (loading) return <div className="p-4 text-slate-500 text-sm">Loading dependencies...</div>;
    if (!data || data.nodes.length === 0) {
        return (
            <div className="p-4 text-slate-500 text-sm">
                <p>No dependencies found.</p>
                <p className="mt-2 text-xs">Dependencies are extracted from import statements during indexing.</p>
            </div>
        );
    }

    // Separate nodes by direction
    const outgoing = data.nodes.filter(n => n.direction === 'outgoing');
    const incoming = data.nodes.filter(n => n.direction === 'incoming');

    return (
        <div className="p-2 space-y-4">
            {/* Outgoing (files this file imports) */}
            {outgoing.length > 0 && (
                <div>
                    <div className="text-xs font-semibold text-slate-500 mb-2 uppercase px-2 flex items-center gap-2">
                        <span className="text-blue-400">→</span> Imports ({outgoing.length})
                    </div>
                    {outgoing.map(node => (
                        <div key={node.id} className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-800 rounded">
                            <EntityIcon kind={node.kind} />
                            <span className="text-sm text-slate-300 truncate" title={node.label}>{node.label}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Incoming (files that import this file) */}
            {incoming.length > 0 && (
                <div>
                    <div className="text-xs font-semibold text-slate-500 mb-2 uppercase px-2 flex items-center gap-2">
                        <span className="text-green-400">←</span> Imported By ({incoming.length})
                    </div>
                    {incoming.map(node => (
                        <div key={node.id} className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-800 rounded">
                            <EntityIcon kind={node.kind} />
                            <span className="text-sm text-slate-300 truncate" title={node.label}>{node.label}</span>
                        </div>
                    ))}
                </div>
            )}

            {outgoing.length === 0 && incoming.length === 0 && (
                <div className="text-slate-500 text-sm px-2">
                    No import relationships found for this file.
                </div>
            )}
        </div>
    );
}

function InsightsView({ entities }: { entities: EntitySummary[] }) {
    const withJustification = entities.filter(e => e.justification || e.businessValue || e.classification);

    if (withJustification.length === 0) {
        return (
            <div className="p-4 text-slate-500 text-sm">
                <p>No AI insights generated for this file yet.</p>
                <p className="mt-2 text-xs">Run <code className="bg-slate-800 px-1 rounded">code-synapse justify</code> to generate insights.</p>
            </div>
        );
    }

    return (
        <div className="p-2 space-y-3">
            {withJustification.map(entity => (
                <div key={entity.id} className="bg-slate-800/50 p-3 rounded border border-slate-700/50">
                    {/* Header with entity info */}
                    <div className="flex items-center gap-2 mb-2">
                        <EntityIcon kind={entity.kind} />
                        <span className="font-medium text-slate-200 text-sm flex-1 truncate">{entity.name}</span>
                        {entity.classification && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                entity.classification === 'domain'
                                    ? 'bg-indigo-900/50 text-indigo-300 border border-indigo-700/50'
                                    : 'bg-slate-700 text-slate-300 border border-slate-600'
                            }`}>
                                {entity.classification}
                            </span>
                        )}
                    </div>

                    {/* Purpose Summary */}
                    {entity.justification && (
                        <div className="mb-2">
                            <div className="text-[10px] uppercase text-slate-500 font-medium mb-1">Purpose</div>
                            <p className="text-xs text-slate-300 leading-relaxed">
                                {entity.justification}
                            </p>
                        </div>
                    )}

                    {/* Business Value */}
                    {entity.businessValue && (
                        <div className="mb-2">
                            <div className="text-[10px] uppercase text-slate-500 font-medium mb-1">Business Value</div>
                            <p className="text-xs text-slate-400 leading-relaxed">
                                {entity.businessValue}
                            </p>
                        </div>
                    )}

                    {/* Feature Context */}
                    {entity.featureContext && (
                        <div className="mb-2">
                            <div className="text-[10px] uppercase text-slate-500 font-medium mb-1">Feature Context</div>
                            <p className="text-xs text-slate-400 leading-relaxed">
                                {entity.featureContext}
                            </p>
                        </div>
                    )}

                    {/* Tags */}
                    {entity.tags && entity.tags.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1">
                            {entity.tags.map((tag, i) => (
                                <span key={i} className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Sub-category and Confidence */}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {entity.subCategory && (
                            <div className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                                {entity.subCategory}
                            </div>
                        )}
                        <div className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            (entity.confidence || 0) >= 0.8
                                ? 'text-green-400 bg-green-900/30 border-green-700/50'
                                : (entity.confidence || 0) >= 0.5
                                    ? 'text-yellow-400 bg-yellow-900/30 border-yellow-700/50'
                                    : 'text-slate-500 bg-slate-800 border-slate-700'
                        }`}>
                            {Math.round((entity.confidence || 0) * 100)}% confidence
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function StatsView({ entities }: { entities: EntitySummary[] }) {
    const byKind = entities.reduce((acc, e) => {
        acc[e.kind] = (acc[e.kind] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const byClass = entities.reduce((acc, e) => {
        const key = e.classification || 'Unclassified';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    return (
        <div className="p-4 space-y-6">
            <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Folder Stats</h3>
                <div className="bg-slate-800 rounded p-3 border border-slate-700">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-sm text-slate-300">Total Entities</span>
                        <span className="text-lg font-bold text-white">{entities.length}</span>
                    </div>
                </div>
            </div>

            <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">By Type</h3>
                <div className="space-y-2">
                    {Object.entries(byKind).map(([kind, count]) => (
                        <div key={kind} className="flex items-center justify-between text-sm">
                            <span className="text-slate-400 capitalize flex items-center gap-2">
                                <EntityIcon kind={kind} />
                                {kind}
                            </span>
                            <span className="text-slate-200">{count}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Distribution</h3>
                <div className="space-y-2">
                    {Object.entries(byClass).map(([cls, count]) => (
                        <div key={cls} className="flex items-center justify-between text-sm">
                            <span className={`px-2 py-0.5 rounded text-xs ${cls === 'domain' ? 'bg-indigo-900/50 text-indigo-300' : 'text-slate-400'
                                }`}>
                                {cls}
                            </span>
                            <span className="text-slate-200">{count}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function EntityIcon({ kind }: { kind: string }) {
    const props = { className: 'w-4 h-4 flex-shrink-0' };
    switch (kind) {
        case 'function': return <Box {...props} className="w-4 h-4 text-blue-400" />;
        case 'class': return <Layers {...props} className="w-4 h-4 text-purple-400" />;
        case 'interface': return <Hash {...props} className="w-4 h-4 text-cyan-400" />;
        default: return <FileCode {...props} className="w-4 h-4 text-gray-400" />;
    }
}

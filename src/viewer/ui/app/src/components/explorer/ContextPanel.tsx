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
    filePath: string | null;
    entities: EntitySummary[];
}

type Tab = 'ast' | 'deps' | 'knowledge';

export function ContextPanel({ filePath, entities }: ContextPanelProps) {
    const [activeTab, setActiveTab] = useState<Tab>('ast');
    const [dependencyData, setDependencyData] = useState<GraphData | null>(null);
    const [loadingDeps, setLoadingDeps] = useState(false);

    // Load dependencies when tab is active and file changes
    useEffect(() => {
        if (activeTab === 'deps' && filePath) {
            setLoadingDeps(true);
            getDependencyGraph(filePath)
                .then(setDependencyData)
                .catch(console.error)
                .finally(() => setLoadingDeps(false));
        }
    }, [activeTab, filePath]);

    if (!filePath) {
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
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto custom-scrollbar p-0">
                {activeTab === 'ast' && <StructureView entities={entities} />}
                {activeTab === 'deps' && <DependenciesView data={dependencyData} loading={loadingDeps} />}
                {activeTab === 'knowledge' && <InsightsView entities={entities} />}
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
    if (!data || data.nodes.length === 0) return <div className="p-4 text-slate-500 text-sm">No dependencies found.</div>;

    return (
        <div className="p-2">
            <div className="text-xs font-semibold text-slate-500 mb-2 uppercase px-2">Outgoing References</div>
            {data.nodes.map(node => (
                <div key={node.id} className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-800 rounded">
                    <EntityIcon kind={node.kind} />
                    <span className="text-sm text-slate-300 truncate">{node.label}</span>
                </div>
            ))}
        </div>
    );
}

function InsightsView({ entities }: { entities: EntitySummary[] }) {
    const withJustification = entities.filter(e => e.justification);

    if (withJustification.length === 0) {
        return <div className="p-4 text-slate-500 text-sm">No AI insights generated for this file yet.</div>;
    }

    return (
        <div className="p-2 space-y-3">
            {withJustification.map(entity => (
                <div key={entity.id} className="bg-slate-800/50 p-3 rounded border border-slate-700/50">
                    <div className="flex items-center gap-2 mb-2">
                        <EntityIcon kind={entity.kind} />
                        <span className="font-medium text-slate-200 text-sm">{entity.name}</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                        {entity.justification}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                        <div className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                            Confidence: {Math.round((entity.confidence || 0) * 100)}%
                        </div>
                    </div>
                </div>
            ))}
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

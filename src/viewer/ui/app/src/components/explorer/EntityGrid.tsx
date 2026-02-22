import { useState, useMemo } from 'react';
import {
    ChevronDown,
    ChevronRight,
    Box,
    Layers,
    Hash,
    FileCode,
    FileText
} from 'lucide-react';
import { EntitySummary } from '../../api/client';

interface KnowledgeGridProps {
    entities: EntitySummary[];
    onSelect: (entity: EntitySummary) => void;
    selectedId: string | undefined;
}

type GroupMode = 'none' | 'file' | 'kind' | 'classification';

export function EntityGrid({ entities, onSelect, selectedId }: KnowledgeGridProps) {
    const [groupMode, setGroupMode] = useState<GroupMode>('none');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    // Toggle group expansion
    const toggleGroup = (groupKey: string) => {
        const newExpanded = new Set(expandedGroups);
        if (newExpanded.has(groupKey)) {
            newExpanded.delete(groupKey);
        } else {
            newExpanded.add(groupKey);
        }
        setExpandedGroups(newExpanded);
    };

    // Grouping logic
    const groupedData = useMemo(() => {
        if (groupMode === 'none') return null;

        const groups: Record<string, EntitySummary[]> = {};
        entities.forEach(entity => {
            let key = 'Other';
            if (groupMode === 'file') key = entity.filePath;
            else if (groupMode === 'kind') key = entity.kind;
            else if (groupMode === 'classification') key = entity.classification || 'Unclassified';

            if (!groups[key]) groups[key] = [];
            groups[key].push(entity);
        });

        return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
    }, [entities, groupMode]);

    return (
        <div className="flex flex-col h-full bg-slate-900">
            {/* Grid Toolbar */}
            <div className="flex items-center gap-4 p-2 border-b border-slate-700 bg-slate-800/50">
                <div className="text-sm text-slate-400">Group by:</div>
                <div className="flex gap-2">
                    <GroupButton active={groupMode === 'none'} onClick={() => setGroupMode('none')} label="None" />
                    <GroupButton active={groupMode === 'file'} onClick={() => setGroupMode('file')} label="File" />
                    <GroupButton active={groupMode === 'kind'} onClick={() => setGroupMode('kind')} label="Kind" />
                    <GroupButton active={groupMode === 'classification'} onClick={() => setGroupMode('classification')} label="Classification" />
                </div>
                <div className="ml-auto text-xs text-slate-500">
                    {entities.length} entities
                </div>
            </div>

            {/* Grid Content */}
            <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-800 sticky top-0 z-10">
                        <tr>
                            <th className="p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Name</th>
                            <th className="p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Kind</th>
                            <th className="p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Location</th>
                            <th className="p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Confidence</th>
                            <th className="p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Classification</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                        {groupMode === 'none' ? (
                            entities.map(entity => (
                                <EntityRow
                                    key={entity.id}
                                    entity={entity}
                                    isSelected={selectedId === entity.id}
                                    onClick={() => onSelect(entity)}
                                />
                            ))
                        ) : (
                            groupedData?.map(([groupName, groupEntities]) => (
                                <div key={groupName} className="contents">
                                    {/* Group Header */}
                                    <tr
                                        className="bg-slate-800/80 hover:bg-slate-700 cursor-pointer"
                                        onClick={() => toggleGroup(groupName)}
                                    >
                                        <td colSpan={5} className="p-2">
                                            <div className="flex items-center gap-2 font-medium text-slate-200">
                                                {expandedGroups.has(groupName) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                                {groupMode === 'file' && <FileText className="w-4 h-4 text-slate-400" />}
                                                {groupName}
                                                <span className="text-xs font-normal text-slate-500 bg-slate-900 px-1.5 rounded-full">
                                                    {groupEntities.length}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                    {/* Group Items */}
                                    {expandedGroups.has(groupName) && groupEntities.map(entity => (
                                        <EntityRow
                                            key={entity.id}
                                            entity={entity}
                                            isSelected={selectedId === entity.id}
                                            onClick={() => onSelect(entity)}
                                            indented
                                        />
                                    ))}
                                </div>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function GroupButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${active
                ? 'bg-rail-purple text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
        >
            {label}
        </button>
    );
}

function EntityRow({ entity, isSelected, onClick, indented }: { entity: EntitySummary; isSelected: boolean; onClick: () => void; indented?: boolean }) {
    // Build tooltip content
    const tooltipParts: string[] = [];
    if (entity.justification) tooltipParts.push(`Purpose: ${entity.justification}`);
    if (entity.businessValue) tooltipParts.push(`Business Value: ${entity.businessValue}`);
    if (entity.featureContext) tooltipParts.push(`Feature: ${entity.featureContext}`);
    if (entity.subCategory) tooltipParts.push(`Category: ${entity.subCategory}`);
    if (entity.tags?.length) tooltipParts.push(`Tags: ${entity.tags.join(', ')}`);
    const tooltipText = tooltipParts.join('\n\n') || 'No insights available';

    return (
        <tr
            onClick={onClick}
            title={tooltipText}
            className={`cursor-pointer transition-colors ${isSelected
                ? 'bg-electric-cyan/10 border-l-2 border-electric-cyan'
                : 'hover:bg-slate-800/50 border-l-2 border-transparent'
                }`}
        >
            <td className={`p-3 ${indented ? 'pl-8' : ''}`}>
                <div className="flex items-center gap-2">
                    <EntityIcon kind={entity.kind} />
                    <div className="flex flex-col min-w-0">
                        <span className={`text-sm ${isSelected ? 'text-electric-cyan' : 'text-slate-300'}`}>
                            {entity.name}
                        </span>
                        {entity.justification && (
                            <span className="text-[10px] text-slate-500 truncate max-w-[200px]">
                                {entity.justification}
                            </span>
                        )}
                    </div>
                </div>
            </td>
            <td className="p-3">
                <code className="text-xs bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 border border-slate-700">
                    {entity.kind}
                </code>
            </td>
            <td className="p-3 text-xs text-slate-500 font-mono truncate max-w-[200px]" title={entity.filePath}>
                {entity.filePath.split('/').pop()}:{entity.startLine}
            </td>
            <td className="p-3">
                <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                            className={`h-full ${(entity.confidence || 0) > 0.8 ? 'bg-green-500' :
                                (entity.confidence || 0) > 0.5 ? 'bg-yellow-500' : 'bg-red-500'
                                }`}
                            style={{ width: `${(entity.confidence || 0) * 100}%` }}
                        />
                    </div>
                    <span className="text-xs text-slate-400">{Math.round((entity.confidence || 0) * 100)}%</span>
                </div>
            </td>
            <td className="p-3">
                <div className="flex items-center gap-1.5">
                    {entity.classification && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${entity.classification === 'domain'
                            ? 'bg-rail-purple/20 text-quantum-violet border border-rail-purple/30'
                            : 'bg-slate-700 text-slate-300'
                            }`}>
                            {entity.classification}
                        </span>
                    )}
                    {entity.subCategory && (
                        <span className="text-[10px] text-slate-500">
                            {entity.subCategory}
                        </span>
                    )}
                </div>
            </td>
        </tr>
    );
}

function EntityIcon({ kind }: { kind: string }) {
    const props = { className: 'w-4 h-4 flex-shrink-0' };
    switch (kind) {
        case 'function': return <Box {...props} className="w-4 h-4 text-electric-cyan" />;
        case 'class': return <Layers {...props} className="w-4 h-4 text-rail-purple" />;
        case 'interface': return <Hash {...props} className="w-4 h-4 text-electric-cyan" />;
        default: return <FileCode {...props} className="w-4 h-4 text-slate-400" />;
    }
}

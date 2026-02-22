import {
    X,
    Brain,
    Activity,
    Zap,
    Share2,
    Box,
    Layers,
    Hash,
    FileCode,
    Code
} from 'lucide-react';
import type { EntitySummary } from '../../api/client';

export function EntityInsightsPanel({
    entity,
    onClose,
}: {
    entity: EntitySummary;
    onClose: () => void;
}) {
    // Mock metrics for demonstration (to be replaced with real API data)
    const complexityScore = useMockComplexity(entity);
    const impactScore = useMockImpact(entity);
    const refCount = useMockRefCount(entity);

    return (
        <div className="w-96 flex-shrink-0 bg-slate-900 border-l border-slate-700 overflow-auto custom-scrollbar flex flex-col h-full">
            {/* Header */}
            <div className="p-4 border-b border-slate-700 bg-slate-800/50">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-slate-400 text-sm uppercase tracking-wider font-semibold">
                        <Brain className="w-4 h-4 text-rail-purple" />
                        Entity Insights
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex items-start gap-4">
                    <div
                        className={`p-3 rounded-xl shadow-lg ${entity.kind === 'function'
                                ? 'bg-electric-cyan/20 text-electric-cyan ring-1 ring-electric-cyan/30'
                                : entity.kind === 'class'
                                    ? 'bg-rail-purple/20 text-quantum-violet ring-1 ring-rail-purple/30'
                                    : entity.kind === 'interface'
                                        ? 'bg-electric-cyan/15 text-electric-cyan ring-1 ring-electric-cyan/30'
                                        : 'bg-slate-500/20 text-slate-400 ring-1 ring-slate-500/30'
                            }`}
                    >
                        <EntityIcon kind={entity.kind} size="lg" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-white truncate" title={entity.name}>
                            {entity.name || '(anonymous)'}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                            <KindBadge kind={entity.kind} />
                            {entity.classification && (
                                <ClassificationBadge classification={entity.classification} />
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-4 space-y-6">
                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 gap-3">
                    <MetricCard
                        label="Complexity"
                        value={complexityScore.label}
                        icon={<Activity className="w-4 h-4 text-warning" />}
                        color={complexityScore.color}
                        score={complexityScore.value} // 0-100
                    />
                    <MetricCard
                        label="Impact"
                        value={impactScore.label}
                        icon={<Zap className="w-4 h-4 text-warning" />}
                        color={impactScore.color}
                        score={impactScore.value}
                    />
                    <MetricCard
                        label="References"
                        value={`${refCount} Refs`}
                        icon={<Share2 className="w-4 h-4 text-electric-cyan" />}
                        color="text-slate-300"
                    />
                    <MetricCard
                        label="Confidence"
                        value={`${Math.round((entity.confidence || 0) * 100)}%`}
                        icon={<Brain className="w-4 h-4 text-success" />}
                        color={
                            (entity.confidence || 0) > 0.8 ? 'text-success' : 'text-warning'
                        }
                        score={(entity.confidence || 0) * 100}
                    />
                </div>

                {/* Business Context Section */}
                <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50 space-y-4">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-2">
                        <Brain className="w-3 h-3" />
                        Business Context
                    </h4>

                    {/* Purpose Summary */}
                    <div>
                        <div className="text-xs text-slate-500 mb-1">Purpose</div>
                        <p className="text-sm text-slate-300 leading-relaxed">
                            {entity.justification || (
                                <span className="text-slate-600 italic">
                                    No purpose summary extracted. Run <code className="bg-slate-900 px-1 rounded text-[10px]">code-synapse justify</code> to analyze.
                                </span>
                            )}
                        </p>
                    </div>

                    {/* Business Value */}
                    {entity.businessValue && (
                        <div>
                            <div className="text-xs text-slate-500 mb-1">Business Value</div>
                            <p className="text-sm text-slate-400 leading-relaxed">
                                {entity.businessValue}
                            </p>
                        </div>
                    )}

                    {/* Feature Context */}
                    {entity.featureContext && (
                        <div>
                            <div className="text-xs text-slate-500 mb-1">Feature</div>
                            <div className="text-sm text-electric-cyan bg-electric-cyan/10 px-2 py-1 rounded inline-block">
                                {entity.featureContext}
                            </div>
                        </div>
                    )}

                    {/* Sub-category */}
                    {entity.subCategory && (
                        <div>
                            <div className="text-xs text-slate-500 mb-1">Category</div>
                            <div className="text-sm text-slate-300">
                                {entity.classification && <span className="text-slate-500">{entity.classification} / </span>}
                                {entity.subCategory}
                            </div>
                        </div>
                    )}

                    {/* Detailed Description */}
                    {entity.detailedDescription && (
                        <div>
                            <div className="text-xs text-slate-500 mb-1">Details</div>
                            <p className="text-sm text-slate-400 leading-relaxed">
                                {entity.detailedDescription}
                            </p>
                        </div>
                    )}

                    {/* Tags */}
                    {entity.tags && entity.tags.length > 0 && (
                        <div>
                            <div className="text-xs text-slate-500 mb-1">Tags</div>
                            <div className="flex flex-wrap gap-1.5">
                                {entity.tags.map((tag, i) => (
                                    <span key={i} className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Location Info */}
                <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase mb-3 flex items-center gap-2">
                        <FileCode className="w-3 h-3" />
                        Location
                    </h4>
                    <div className="space-y-2">
                        <div>
                            <div className="text-xs text-slate-500 mb-0.5">File</div>
                            <div
                                className="text-sm text-electric-cyan hover:text-electric-cyan/80 cursor-pointer truncate font-mono bg-slate-900/50 px-2 py-1 rounded"
                                title={entity.filePath}
                            >
                                {entity.filePath}
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div>
                                <div className="text-xs text-slate-500 mb-0.5">Start Line</div>
                                <div className="text-sm text-slate-300 font-mono">
                                    {entity.startLine}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-slate-500 mb-0.5">End Line</div>
                                <div className="text-sm text-slate-300 font-mono">
                                    {entity.endLine}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-slate-500 mb-0.5">Size</div>
                                <div className="text-sm text-slate-300 font-mono">
                                    {entity.endLine - entity.startLine} lines
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- Helper Components ---

function MetricCard({
    label,
    value,
    icon,
    color,
    score,
}: {
    label: string;
    value: string;
    icon: React.ReactNode;
    color: string;
    score?: number; // 0-100 for progress bar
}) {
    return (
        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50 hover:bg-slate-800 transition-colors">
            <div className="flex items-center gap-2 mb-2 text-slate-500">
                {icon}
                <span className="text-xs font-medium uppercase">{label}</span>
            </div>
            <div className={`text-lg font-bold ${color}`}>{value}</div>
            {score !== undefined && (
                <div className="h-1.5 w-full bg-slate-700 rounded-full mt-2 overflow-hidden">
                    <div
                        className={`h-full rounded-full ${color.replace('text-', 'bg-')}`} // Hacky but works for standard tw colors
                        style={{ width: `${score}%` }}
                    />
                </div>
            )}
        </div>
    );
}

function EntityIcon({
    kind,
    size = 'sm',
}: {
    kind: string;
    size?: 'sm' | 'lg';
}) {
    const sizeClass = size === 'lg' ? 'w-6 h-6' : 'w-4 h-4';
    const colorClass = 'currentColor'; // Color handled by container

    switch (kind) {
        case 'function':
            return <Box className={`${sizeClass} ${colorClass}`} />;
        case 'class':
            return <Layers className={`${sizeClass} ${colorClass}`} />;
        case 'interface':
            return <Hash className={`${sizeClass} ${colorClass}`} />;
        default:
            return <Code className={`${sizeClass} ${colorClass}`} />;
    }
}

function KindBadge({ kind }: { kind: string }) {
    const classes =
        kind === 'function'
            ? 'text-electric-cyan bg-electric-cyan/10 border-electric-cyan/20'
            : kind === 'class'
                ? 'text-quantum-violet bg-rail-purple/10 border-rail-purple/20'
                : kind === 'interface'
                    ? 'text-electric-cyan bg-electric-cyan/10 border-electric-cyan/20'
                    : 'text-slate-400 bg-slate-400/10 border-slate-400/20';

    return (
        <span
            className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${classes}`}
        >
            {kind}
        </span>
    );
}

function ClassificationBadge({ classification }: { classification: string }) {
    const classes =
        classification === 'domain'
            ? 'text-quantum-violet bg-rail-purple/10 border-rail-purple/20'
            : 'text-electric-cyan bg-electric-cyan/10 border-electric-cyan/20';

    return (
        <span
            className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${classes}`}
        >
            {classification}
        </span>
    );
}

// --- Mock Data Hooks ---
// Since the API doesn't return these yet, we mock them deterministically
function useMockComplexity(entity: EntitySummary) {
    // Deterministic "random" based on name length
    const hash = entity.name.length + entity.startLine;
    const score = hash % 100;

    if (score > 80) return { label: 'High', value: score, color: 'text-error' };
    if (score > 50) return { label: 'Medium', value: score, color: 'text-warning' };
    return { label: 'Low', value: score, color: 'text-success' };
}

function useMockImpact(entity: EntitySummary) {
    const hash = (entity.endLine - entity.startLine);
    const score = Math.min(hash, 100);

    if (score > 70) return { label: 'Extensive', value: score, color: 'text-error' };
    if (score > 30) return { label: 'Moderate', value: score, color: 'text-electric-cyan' };
    return { label: 'Local', value: score, color: 'text-slate-400' };
}

function useMockRefCount(entity: EntitySummary) {
    return (entity.name.length * 3) % 20;
}

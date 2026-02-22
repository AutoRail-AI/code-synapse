import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  Clock,
  FileCode,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Search,
  Zap,
  GitBranch,
  Brain,
  Users,
  Server,
  BarChart3,
  Timer,
  Layers,
  Sparkles,
  Code2,
  Database,
  MessageSquare,
  TrendingUp,
  Radio,
} from 'lucide-react';
import {
  getLedgerEntries,
  getLedgerStats,
  getLedgerAggregations,
  type LedgerEntry,
  type LedgerStats,
  type LedgerAggregation,
} from '../../api/client';
import { useLedgerStream } from '../../hooks/useLedgerStream';

// =============================================================================
// Constants
// =============================================================================

type EventCategory = 'all' | 'mcp' | 'index' | 'classify' | 'justify' | 'adaptive' | 'graph' | 'user' | 'system';

const EVENT_CATEGORIES: { id: EventCategory; label: string; prefix: string; icon: React.ReactNode; color: string; bgColor: string }[] = [
  { id: 'all', label: 'All Events', prefix: '', icon: <Activity className="w-3.5 h-3.5" />, color: 'text-slate-400', bgColor: 'bg-slate-500/10' },
  { id: 'mcp', label: 'MCP Queries', prefix: 'mcp:', icon: <Zap className="w-3.5 h-3.5" />, color: 'text-electric-cyan', bgColor: 'bg-electric-cyan/10' },
  { id: 'index', label: 'Indexing', prefix: 'index:', icon: <FileCode className="w-3.5 h-3.5" />, color: 'text-electric-cyan', bgColor: 'bg-electric-cyan/10' },
  { id: 'classify', label: 'Classification', prefix: 'classify:', icon: <Layers className="w-3.5 h-3.5" />, color: 'text-electric-cyan', bgColor: 'bg-electric-cyan/10' },
  { id: 'justify', label: 'Justification', prefix: 'justify:', icon: <Brain className="w-3.5 h-3.5" />, color: 'text-quantum-violet', bgColor: 'bg-rail-purple/10' },
  { id: 'adaptive', label: 'Adaptive', prefix: 'adaptive:', icon: <TrendingUp className="w-3.5 h-3.5" />, color: 'text-warning', bgColor: 'bg-warning/10' },
  { id: 'graph', label: 'Graph Writes', prefix: 'graph:', icon: <GitBranch className="w-3.5 h-3.5" />, color: 'text-rail-purple', bgColor: 'bg-rail-purple/10' },
  { id: 'user', label: 'User Actions', prefix: 'user:', icon: <Users className="w-3.5 h-3.5" />, color: 'text-success', bgColor: 'bg-success/10' },
  { id: 'system', label: 'System', prefix: 'system:', icon: <Server className="w-3.5 h-3.5" />, color: 'text-warning', bgColor: 'bg-warning/10' },
];

// =============================================================================
// Main ObservabilityView
// =============================================================================

export function ObservabilityView() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [stats, setStats] = useState<LedgerStats | null>(null);
  const [aggregations, setAggregations] = useState<LedgerAggregation | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<EventCategory>('all');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [searchText, setSearchText] = useState('');
  const { entries: streamEntries, connected: sseConnected } = useLedgerStream();

  // Merge SSE entries into polled entries (deduplicate by id)
  const mergedEntries = useMemo(() => {
    if (streamEntries.length === 0) return entries;
    const seenIds = new Set(entries.map(e => e.id));
    const newEntries = streamEntries.filter(e => !seenIds.has(e.id));
    return [...newEntries, ...entries];
  }, [entries, streamEntries]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: 200 };
      if (category !== 'all') {
        const cat = EVENT_CATEGORIES.find(c => c.id === category);
        if (cat?.prefix) {
          params.eventTypes = getEventTypesForCategory(category);
        }
      }
      const [entriesData, statsData, aggData] = await Promise.all([
        getLedgerEntries(params as Parameters<typeof getLedgerEntries>[0]),
        getLedgerStats().catch(() => null),
        getLedgerAggregations().catch(() => null),
      ]);
      setEntries(entriesData);
      setStats(statsData);
      setAggregations(aggData);
    } catch (err) {
      console.error('Failed to load ledger data:', err);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  // Filter entries by category and search text
  const filteredEntries = useMemo(() => {
    let result = mergedEntries;

    // Filter by category (client-side to ensure it works even if API doesn't filter)
    if (category !== 'all') {
      const cat = EVENT_CATEGORIES.find(c => c.id === category);
      if (cat?.prefix) {
        result = result.filter(e => e.eventType.startsWith(cat.prefix));
      }
    }

    // Filter by search text
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter(e =>
        e.eventType.toLowerCase().includes(lower) ||
        (e.summary ?? '').toLowerCase().includes(lower) ||
        (e.mcpContext?.toolName ?? '').toLowerCase().includes(lower) ||
        (e.mcpContext?.query ?? '').toLowerCase().includes(lower)
      );
    }

    return result;
  }, [mergedEntries, category, searchText]);


  // Category counts from current entries
  const categoryCounts = useMemo(() => {
    return mergedEntries.reduce((acc, entry) => {
      for (const cat of EVENT_CATEGORIES) {
        if (cat.id === 'all') continue;
        if (entry.eventType.startsWith(cat.prefix)) {
          acc[cat.id] = (acc[cat.id] || 0) + 1;
        }
      }
      return acc;
    }, {} as Record<string, number>);
  }, [mergedEntries]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950">
      {/* Hero Stats Banner */}
      <HeroStatsBanner stats={stats} aggregations={aggregations} entries={mergedEntries} autoRefresh={autoRefresh} sseConnected={sseConnected} />

      {/* Toolbar */}
      <div className="border-b border-slate-700/30 px-6 py-4 bg-slate-900/50 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                <div className="relative p-2.5 bg-primary/10 border border-primary/20 rounded-xl">
                  <Activity className="w-5 h-5 text-primary" />
                </div>
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">Activity Timeline</h1>
                <p className="text-xs text-slate-500">Real-time system observability</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search events..."
                className="bg-slate-800/60 border border-slate-700/50 rounded-xl text-sm pl-10 pr-4 py-2 w-64 text-slate-300 placeholder-slate-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
              />
            </div>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all ${
                autoRefresh
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'bg-slate-800/60 text-slate-400 border border-slate-700/50 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse' : ''}`} />
              {autoRefresh ? 'Live' : 'Paused'}
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-2 text-sm text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 rounded-xl px-3 py-2 transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex gap-2 flex-wrap">
          {EVENT_CATEGORIES.map((cat) => {
            const count = cat.id === 'all' ? mergedEntries.length : (categoryCounts[cat.id] || 0);
            const isActive = category === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                  isActive
                    ? `${cat.bgColor} ${cat.color} border border-current/30 shadow-lg shadow-current/10`
                    : 'text-slate-400 hover:bg-slate-800/60 border border-transparent hover:border-slate-700/50'
                }`}
              >
                {cat.icon}
                <span>{cat.label}</span>
                {count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-current/20' : 'bg-slate-700/60'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Event Timeline */}
        <div className="flex-1 overflow-auto custom-scrollbar">
          {loading && mergedEntries.length === 0 ? (
            <LoadingState />
          ) : filteredEntries.length === 0 ? (
            <EmptyState />
          ) : (
            <TimelineContent
              entries={filteredEntries}
              expandedEntry={expandedEntry}
              onToggle={(id) => setExpandedEntry(expandedEntry === id ? null : id)}
            />
          )}
        </div>

        {/* Insights Sidebar */}
        <InsightsSidebar aggregations={aggregations} entries={mergedEntries} />
      </div>
    </div>
  );
}

// =============================================================================
// Hero Stats Banner - The "Wow" Factor
// =============================================================================

function HeroStatsBanner({
  stats,
  aggregations,
  entries,
  autoRefresh,
  sseConnected,
}: {
  stats: LedgerStats | null;
  aggregations: LedgerAggregation | null;
  entries: LedgerEntry[];
  autoRefresh: boolean;
  sseConnected?: boolean;
}) {
  const mcpCount = entries.filter(e => e.eventType.startsWith('mcp:')).length;
  const indexCount = entries.filter(e => e.eventType.startsWith('index:')).length;
  const justifyCount = entries.filter(e => e.eventType.startsWith('justify:')).length;
  const errorCount = aggregations?.errorCount ?? entries.filter(e => e.eventType.includes('error')).length;
  const avgResponseMs = aggregations?.averageResponseTimeMs ?? 0;
  const entitiesTracked = new Set(entries.flatMap(e => e.impactedEntities ?? [])).size;

  return (
    <div className="relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 bg-gradient-to-r from-rail-purple/5 via-quantum-violet/5 to-electric-cyan/5" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />

      {/* Live pulse indicator */}
      {(autoRefresh || sseConnected) && (
        <div className="absolute top-4 right-6 flex items-center gap-3">
          {sseConnected && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-xs text-green-400 font-medium">Live</span>
            </div>
          )}
          {autoRefresh && !sseConnected && (
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-xs text-green-400 font-medium">POLLING</span>
            </div>
          )}
        </div>
      )}

      <div className="relative grid grid-cols-7 gap-4 p-6">
        <HeroStatCard
          icon={<BarChart3 className="w-5 h-5" />}
          label="Total Events"
          value={stats?.entryCount ?? entries.length}
          color="primary"
          subtitle="Captured"
        />
        <HeroStatCard
          icon={<Zap className="w-5 h-5" />}
          label="MCP Queries"
          value={mcpCount}
          color="cyan"
          subtitle="AI interactions"
        />
        <HeroStatCard
          icon={<FileCode className="w-5 h-5" />}
          label="Index Events"
          value={indexCount}
          color="cyan"
          subtitle="File changes"
        />
        <HeroStatCard
          icon={<Brain className="w-5 h-5" />}
          label="Justifications"
          value={justifyCount}
          color="purple"
          subtitle="Business logic"
        />
        <HeroStatCard
          icon={<Code2 className="w-5 h-5" />}
          label="Entities"
          value={entitiesTracked}
          color="cyan"
          subtitle="Tracked"
        />
        <HeroStatCard
          icon={<Timer className="w-5 h-5" />}
          label="Avg Response"
          value={avgResponseMs > 0 ? `${Math.round(avgResponseMs)}ms` : '-'}
          color="amber"
          subtitle="Performance"
        />
        <HeroStatCard
          icon={<AlertCircle className="w-5 h-5" />}
          label="Errors"
          value={errorCount}
          color={errorCount > 0 ? 'red' : 'slate'}
          subtitle={errorCount > 0 ? 'Needs attention' : 'All clear'}
        />
      </div>
    </div>
  );
}

function HeroStatCard({
  icon,
  label,
  value,
  color,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
  subtitle: string;
}) {
  const colorClasses: Record<string, { text: string; bg: string; glow: string }> = {
    primary: { text: 'text-rail-purple', bg: 'bg-rail-purple/10', glow: 'shadow-rail-purple/20' },
    cyan: { text: 'text-electric-cyan', bg: 'bg-electric-cyan/10', glow: 'shadow-electric-cyan/20' },
    purple: { text: 'text-quantum-violet', bg: 'bg-rail-purple/10', glow: 'shadow-rail-purple/20' },
    amber: { text: 'text-warning', bg: 'bg-warning/10', glow: '' },
    red: { text: 'text-error', bg: 'bg-error/10', glow: '' },
    slate: { text: 'text-slate-400', bg: 'bg-slate-500/10', glow: '' },
  };

  const c = colorClasses[color] || colorClasses.slate;

  return (
    <div className={`relative group`}>
      <div className={`absolute inset-0 ${c.bg} rounded-2xl blur-xl opacity-50 group-hover:opacity-100 transition-opacity`} />
      <div className={`relative bg-slate-800/40 backdrop-blur-sm border border-slate-700/30 rounded-2xl p-4 hover:border-slate-600/50 transition-all ${c.glow} hover:shadow-lg`}>
        <div className={`${c.text} ${c.bg} w-10 h-10 rounded-xl flex items-center justify-center mb-3`}>
          {icon}
        </div>
        <div className="text-2xl font-bold text-white mb-0.5">{value}</div>
        <div className="text-xs text-slate-400 font-medium">{label}</div>
        <div className="text-[10px] text-slate-500 mt-0.5">{subtitle}</div>
      </div>
    </div>
  );
}

// =============================================================================
// Timeline Content
// =============================================================================

function TimelineContent({
  entries,
  expandedEntry,
  onToggle,
}: {
  entries: LedgerEntry[];
  expandedEntry: string | null;
  onToggle: (id: string) => void;
}) {
  // Group by relative time
  const now = new Date();
  const groups = useMemo(() => {
    const result: { label: string; entries: LedgerEntry[] }[] = [];
    const today: LedgerEntry[] = [];
    const yesterday: LedgerEntry[] = [];
    const thisWeek: LedgerEntry[] = [];
    const older: LedgerEntry[] = [];

    for (const entry of entries) {
      const date = new Date(entry.timestamp);
      const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays === 0) today.push(entry);
      else if (diffDays === 1) yesterday.push(entry);
      else if (diffDays < 7) thisWeek.push(entry);
      else older.push(entry);
    }

    if (today.length) result.push({ label: 'Today', entries: today });
    if (yesterday.length) result.push({ label: 'Yesterday', entries: yesterday });
    if (thisWeek.length) result.push({ label: 'This Week', entries: thisWeek });
    if (older.length) result.push({ label: 'Older', entries: older });

    return result;
  }, [entries]);

  return (
    <div className="p-6 space-y-8 max-w-4xl">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="flex items-center gap-3 mb-4 sticky top-0 bg-slate-900/95 backdrop-blur-sm py-2 z-10">
            <Clock className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-white">{group.label}</span>
            <div className="h-px flex-1 bg-gradient-to-r from-slate-700/50 to-transparent" />
            <span className="text-xs text-slate-500 bg-slate-800/60 px-2 py-0.5 rounded-full">
              {group.entries.length} events
            </span>
          </div>

          {/* Timeline with connecting line */}
          <div className="relative ml-2">
            {/* Vertical line */}
            <div className="absolute left-[11px] top-0 bottom-0 w-px bg-gradient-to-b from-slate-700/50 via-slate-700/30 to-transparent" />

            <div className="space-y-3">
              {group.entries.map((entry) => (
                <TimelineEventCard
                  key={entry.id}
                  entry={entry}
                  expanded={expandedEntry === entry.id}
                  onToggle={() => onToggle(entry.id)}
                />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Timeline Event Card - Rich but Simple
// =============================================================================

function TimelineEventCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: LedgerEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const cat = getCategoryForEvent(entry.eventType);
  const hasError = !!entry.errorMessage || entry.eventType.includes('error');
  const hasMcpContext = !!entry.mcpContext?.toolName;
  const hasImpact = (entry.impactedFiles?.length ?? 0) > 0 || (entry.impactedEntities?.length ?? 0) > 0;

  return (
    <div className="relative pl-8 group">
      {/* Timeline dot */}
      <div className={`absolute left-0 top-3 w-6 h-6 rounded-full flex items-center justify-center ${
        hasError ? 'bg-red-500/20' : cat.bgColor
      } border-2 border-slate-900 z-10 transition-transform group-hover:scale-110`}>
        {hasError ? (
          <AlertCircle className="w-3 h-3 text-red-400" />
        ) : (
          <div className={cat.color}>{cat.icon}</div>
        )}
      </div>

      <div className={`rounded-xl border overflow-hidden transition-all duration-200 ${
        hasError
          ? 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10'
          : expanded
            ? 'bg-slate-800/60 border-slate-600/50'
            : 'bg-slate-800/30 border-slate-700/30 hover:bg-slate-800/50 hover:border-slate-600/40'
      }`}>
        <button
          onClick={onToggle}
          className="w-full flex items-start gap-3 p-4 text-left"
        >
          <div className="flex-1 min-w-0">
            {/* Event type and badges */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-sm font-medium ${cat.color}`}>
                {formatEventType(entry.eventType)}
              </span>

              {hasMcpContext && (
                <span className="inline-flex items-center gap-1 text-xs text-electric-cyan/80 bg-electric-cyan/10 px-2 py-0.5 rounded-lg">
                  <Zap className="w-3 h-3" />
                  {entry.mcpContext!.toolName}
                </span>
              )}

              {hasImpact && (
                <span className="inline-flex items-center gap-1 text-xs text-electric-cyan/80 bg-electric-cyan/10 px-2 py-0.5 rounded-lg">
                  <GitBranch className="w-3 h-3" />
                  {(entry.impactedEntities?.length ?? 0) + (entry.impactedFiles?.length ?? 0)} affected
                </span>
              )}

              {entry.mcpContext?.responseTimeMs != null && entry.mcpContext.responseTimeMs > 0 && (
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg ${
                  entry.mcpContext.responseTimeMs > 1000
                    ? 'text-amber-400/80 bg-amber-500/10'
                    : 'text-slate-400/80 bg-slate-700/50'
                }`}>
                  <Timer className="w-3 h-3" />
                  {entry.mcpContext.responseTimeMs}ms
                </span>
              )}
            </div>

            {/* Summary */}
            {entry.summary && (
              <p className="text-sm text-slate-400 line-clamp-2">{entry.summary}</p>
            )}

            {/* MCP Query preview */}
            {entry.mcpContext?.query && !expanded && (
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                <MessageSquare className="w-3 h-3" />
                <span className="truncate italic">"{entry.mcpContext.query}"</span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-xs text-slate-500 font-mono">{time}</span>
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500" />
            )}
          </div>
        </button>

        {/* Expanded Details */}
        {expanded && (
          <div className="px-4 pb-4 border-t border-slate-700/30 animate-in slide-in-from-top-2 duration-200">
            <div className="pt-4 space-y-4">
              {/* Identity */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <InfoField label="Event ID" value={entry.id} mono />
                <InfoField label="Timestamp" value={new Date(entry.timestamp).toISOString()} mono />
                {entry.sessionId && <InfoField label="Session" value={entry.sessionId} mono />}
                {entry.source && <InfoField label="Source" value={formatSource(entry.source)} />}
              </div>

              {/* MCP Context - Rich Display */}
              {entry.mcpContext && (
                <div className="p-4 bg-gradient-to-r from-electric-cyan/5 to-rail-purple/5 border border-electric-cyan/10 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4 text-electric-cyan" />
                    <span className="text-xs font-semibold text-electric-cyan uppercase tracking-wider">AI Interaction</span>
                  </div>
                  <div className="space-y-3">
                    {entry.mcpContext.query && (
                      <div className="p-3 bg-slate-900/50 rounded-lg">
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Query</div>
                        <div className="text-sm text-slate-200 italic">"{entry.mcpContext.query}"</div>
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-3">
                      {entry.mcpContext.toolName && (
                        <div className="p-2 bg-slate-900/30 rounded-lg text-center">
                          <div className="text-lg font-semibold text-white">{entry.mcpContext.toolName}</div>
                          <div className="text-[10px] text-slate-500">Tool</div>
                        </div>
                      )}
                      {entry.mcpContext.resultCount != null && (
                        <div className="p-2 bg-slate-900/30 rounded-lg text-center">
                          <div className="text-lg font-semibold text-electric-cyan">{entry.mcpContext.resultCount}</div>
                          <div className="text-[10px] text-slate-500">Results</div>
                        </div>
                      )}
                      {entry.mcpContext.responseTimeMs != null && (
                        <div className="p-2 bg-slate-900/30 rounded-lg text-center">
                          <div className={`text-lg font-semibold ${entry.mcpContext.responseTimeMs > 1000 ? 'text-amber-400' : 'text-slate-300'}`}>
                            {entry.mcpContext.responseTimeMs}ms
                          </div>
                          <div className="text-[10px] text-slate-500">Duration</div>
                        </div>
                      )}
                    </div>
                    {entry.mcpContext.parameters && Object.keys(entry.mcpContext.parameters).length > 0 && (
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Parameters</div>
                        <pre className="text-[11px] text-slate-400 bg-slate-900/60 p-3 rounded-lg overflow-auto max-h-24 font-mono">
                          {JSON.stringify(entry.mcpContext.parameters, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Impacted Items */}
              {hasImpact && (
                <div className="space-y-2">
                  {entry.impactedFiles && entry.impactedFiles.length > 0 && (
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Impacted Files</div>
                      <div className="flex flex-wrap gap-1.5">
                        {entry.impactedFiles.slice(0, 8).map((f, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-[11px] font-mono text-electric-cyan/80 bg-electric-cyan/10 px-2 py-1 rounded-lg">
                            <FileCode className="w-3 h-3" />
                            {f.split('/').pop()}
                          </span>
                        ))}
                        {entry.impactedFiles.length > 8 && (
                          <span className="text-[11px] text-slate-500 px-2 py-1">
                            +{entry.impactedFiles.length - 8} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {entry.impactedEntities && entry.impactedEntities.length > 0 && (
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Impacted Entities</div>
                      <div className="flex flex-wrap gap-1.5">
                        {entry.impactedEntities.slice(0, 6).map((e, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-[11px] font-mono text-electric-cyan/80 bg-electric-cyan/10 px-2 py-1 rounded-lg">
                            <Code2 className="w-3 h-3" />
                            {e.split(':').pop()}
                          </span>
                        ))}
                        {entry.impactedEntities.length > 6 && (
                          <span className="text-[11px] text-slate-500 px-2 py-1">
                            +{entry.impactedEntities.length - 6} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Error Display */}
              {entry.errorMessage && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span className="text-xs font-medium text-red-400">Error</span>
                  </div>
                  <p className="text-sm text-red-300">{entry.errorMessage}</p>
                  {entry.errorCode && (
                    <div className="text-[10px] text-red-500/80 mt-1 font-mono">{entry.errorCode}</div>
                  )}
                </div>
              )}

              {/* Metadata */}
              {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Additional Data</div>
                  <pre className="text-[11px] text-slate-400 bg-slate-900/60 p-3 rounded-lg overflow-auto max-h-32 font-mono">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">{label}</div>
      <div className={`text-slate-300 ${mono ? 'font-mono text-[11px] truncate' : 'text-xs'}`}>{value}</div>
    </div>
  );
}

// =============================================================================
// Insights Sidebar
// =============================================================================

function InsightsSidebar({
  aggregations,
  entries,
}: {
  aggregations: LedgerAggregation | null;
  entries: LedgerEntry[];
}) {
  // Tool usage from MCP entries
  const toolUsage = useMemo(() => {
    return entries
      .filter(e => e.mcpContext?.toolName)
      .reduce((acc, e) => {
        const tool = e.mcpContext!.toolName!;
        acc[tool] = (acc[tool] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
  }, [entries]);

  const topFiles = aggregations?.topImpactedFiles ?? [];
  const recentQueries = entries
    .filter(e => e.mcpContext?.query)
    .slice(0, 5);

  return (
    <div className="w-80 border-l border-slate-700/30 bg-slate-900/30 flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700/30 bg-slate-800/20">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-white">Intelligence</span>
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">Patterns & insights from activity</p>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar p-5 space-y-6">
        {/* Top Tools */}
        {Object.keys(toolUsage).length > 0 && (
          <InsightSection title="Most Used Tools" icon={<Zap className="w-3.5 h-3.5" />}>
            <div className="space-y-2">
              {Object.entries(toolUsage)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([tool, count]) => (
                  <div key={tool} className="group">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-300 font-medium">{tool}</span>
                      <span className="text-[10px] text-slate-500">{count} calls</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-electric-cyan to-rail-purple rounded-full transition-all"
                        style={{ width: `${Math.min((count / entries.length) * 100 * 3, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </InsightSection>
        )}

        {/* Recent AI Queries */}
        {recentQueries.length > 0 && (
          <InsightSection title="Recent Queries" icon={<MessageSquare className="w-3.5 h-3.5" />}>
            <div className="space-y-2">
              {recentQueries.map((entry) => (
                <div key={entry.id} className="p-2.5 bg-slate-800/40 rounded-lg hover:bg-slate-800/60 transition-colors">
                  <div className="text-xs text-slate-300 line-clamp-2 italic">
                    "{entry.mcpContext!.query}"
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-electric-cyan/80">{entry.mcpContext!.toolName}</span>
                    <span className="text-[10px] text-slate-600">•</span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </InsightSection>
        )}

        {/* Hot Files */}
        {topFiles.length > 0 && (
          <InsightSection title="Most Active Files" icon={<FileCode className="w-3.5 h-3.5" />}>
            <div className="space-y-1.5">
              {topFiles.slice(0, 6).map((f) => (
                <div key={f.file} className="flex items-center justify-between py-1.5 px-2 hover:bg-slate-800/40 rounded-lg transition-colors">
                  <span className="text-[11px] text-slate-400 truncate font-mono flex-1 mr-2">
                    {f.file.split('/').pop()}
                  </span>
                  <span className="text-[10px] text-electric-cyan/80 bg-electric-cyan/10 px-1.5 py-0.5 rounded">
                    {f.count}
                  </span>
                </div>
              ))}
            </div>
          </InsightSection>
        )}

        {/* Quick Stats */}
        <InsightSection title="Session Stats" icon={<BarChart3 className="w-3.5 h-3.5" />}>
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Sessions" value={new Set(entries.map(e => e.sessionId).filter(Boolean)).size} />
            <MiniStat label="Sources" value={new Set(entries.map(e => e.source)).size} />
            <MiniStat label="Files Hit" value={new Set(entries.flatMap(e => e.impactedFiles ?? [])).size} />
            <MiniStat label="Entities" value={new Set(entries.flatMap(e => e.impactedEntities ?? [])).size} />
          </div>
        </InsightSection>
      </div>
    </div>
  );
}

function InsightSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
        <span className="text-primary/80">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-2.5 bg-slate-800/40 rounded-lg text-center">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}

// =============================================================================
// States
// =============================================================================

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-slate-700 rounded-full" />
          <div className="absolute top-0 w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <span className="text-sm text-slate-400">Loading activity...</span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full" />
        <div className="relative p-6 bg-slate-800/50 border border-slate-700/30 rounded-2xl">
          <Database className="w-12 h-12 text-slate-500" />
        </div>
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">No Activity Yet</h3>
      <p className="text-sm text-slate-400 max-w-md">
        Events will appear here as AI agents interact with the knowledge graph via MCP.
        Start a search or let an agent query the codebase.
      </p>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function getEventTypesForCategory(category: EventCategory): string {
  const prefixMap: Record<string, string[]> = {
    mcp: ['mcp:query:received', 'mcp:query:completed', 'mcp:tool:called', 'mcp:resource:accessed'],
    index: ['index:scan:started', 'index:scan:completed', 'index:file:added', 'index:file:modified', 'index:file:deleted', 'index:entity:extracted', 'index:batch:completed'],
    classify: ['classify:started', 'classify:completed', 'classify:domain:detected', 'classify:infrastructure:detected', 'classify:updated', 'classify:confirmed'],
    justify: ['justify:started', 'justify:completed', 'justify:clarification:requested', 'justify:clarification:received'],
    adaptive: ['adaptive:query:observed', 'adaptive:result:observed', 'adaptive:change:detected', 'adaptive:reindex:triggered', 'adaptive:semantic:correlation'],
    graph: ['graph:write:started', 'graph:write:completed', 'graph:node:created', 'graph:node:updated', 'graph:node:deleted', 'graph:edge:created', 'graph:edge:deleted'],
    user: ['user:feedback:received', 'user:confirmation:received', 'user:correction:received'],
    system: ['system:startup', 'system:shutdown', 'system:error', 'system:warning'],
  };
  return (prefixMap[category] ?? []).join(',');
}

function formatEventType(eventType: string): string {
  const parts = eventType.split(':');
  if (parts.length <= 1) return eventType;
  return parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function formatSource(source: string): string {
  return source.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getCategoryForEvent(eventType: string): { color: string; bgColor: string; icon: React.ReactNode } {
  for (const cat of EVENT_CATEGORIES) {
    if (cat.id !== 'all' && eventType.startsWith(cat.prefix)) {
      return { color: cat.color, bgColor: cat.bgColor, icon: cat.icon };
    }
  }
  return { color: 'text-slate-400', bgColor: 'bg-slate-500/10', icon: <Activity className="w-3 h-3" /> };
}

export default ObservabilityView;

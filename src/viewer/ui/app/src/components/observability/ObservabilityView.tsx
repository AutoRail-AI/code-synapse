import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Clock,
  Database,
  FileCode,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Info,
  Trash,
  Plus,
  Search,
  Zap,
  GitBranch,
  Brain,
  Users,
  Server,
  BarChart3,
  TrendingUp,
  Timer,
  Layers,
  Eye,
} from 'lucide-react';
import {
  getLedgerEntries,
  getLedgerStats,
  getLedgerAggregations,
  type LedgerEntry,
  type LedgerStats,
  type LedgerAggregation,
} from '../../api/client';

// =============================================================================
// Constants
// =============================================================================

type EventCategory = 'all' | 'mcp' | 'index' | 'classify' | 'justify' | 'adaptive' | 'graph' | 'user' | 'system';

const EVENT_CATEGORIES: { id: EventCategory; label: string; prefix: string; color: string }[] = [
  { id: 'all', label: 'All', prefix: '', color: 'text-slate-400' },
  { id: 'mcp', label: 'MCP', prefix: 'mcp:', color: 'text-blue-400' },
  { id: 'index', label: 'Index', prefix: 'index:', color: 'text-emerald-400' },
  { id: 'classify', label: 'Classify', prefix: 'classify:', color: 'text-cyan-400' },
  { id: 'justify', label: 'Justify', prefix: 'justify:', color: 'text-purple-400' },
  { id: 'adaptive', label: 'Adaptive', prefix: 'adaptive:', color: 'text-amber-400' },
  { id: 'graph', label: 'Graph', prefix: 'graph:', color: 'text-rose-400' },
  { id: 'user', label: 'User', prefix: 'user:', color: 'text-green-400' },
  { id: 'system', label: 'System', prefix: 'system:', color: 'text-orange-400' },
];

const SOURCE_COLORS: Record<string, string> = {
  'mcp-query': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'mcp-result-processor': 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  'filesystem': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'classification-engine': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'justification-engine': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'adaptive-indexer': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'graph-writer': 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  'user-interface': 'bg-green-500/20 text-green-400 border-green-500/30',
  'system': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

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

  // Filter entries by search text
  const filteredEntries = searchText
    ? entries.filter(e =>
      e.eventType.toLowerCase().includes(searchText.toLowerCase()) ||
      (e.summary ?? '').toLowerCase().includes(searchText.toLowerCase()) ||
      (e.mcpContext?.toolName ?? '').toLowerCase().includes(searchText.toLowerCase()) ||
      (e.mcpContext?.query ?? '').toLowerCase().includes(searchText.toLowerCase())
    )
    : entries;

  // Group by date
  const groupedEntries = filteredEntries.reduce((acc, entry) => {
    const date = new Date(entry.timestamp).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(entry);
    return acc;
  }, {} as Record<string, LedgerEntry[]>);

  // Category counts from current entries
  const categoryCounts = entries.reduce((acc, entry) => {
    for (const cat of EVENT_CATEGORIES) {
      if (cat.id === 'all') continue;
      if (entry.eventType.startsWith(cat.prefix)) {
        acc[cat.id] = (acc[cat.id] || 0) + 1;
      }
    }
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Stats Banner */}
      <StatsBanner stats={stats} aggregations={aggregations} entries={entries} />

      {/* Toolbar */}
      <div className="border-b border-slate-700/50 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold text-white">Change Ledger</h1>
            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
              {filteredEntries.length} events
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Filter events..."
                className="bg-slate-800/80 border border-slate-700/50 rounded-lg text-xs pl-8 pr-3 py-1.5 w-48 text-slate-300 placeholder-slate-500 focus:outline-none focus:border-primary/50"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-slate-600 w-3 h-3"
              />
              Live
            </label>
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700/50 rounded-lg px-2.5 py-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Category filters */}
        <div className="flex gap-1.5 flex-wrap">
          {EVENT_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all ${
                category === cat.id
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent'
              }`}
            >
              <EventCategoryIcon category={cat.id} size={12} />
              {cat.label}
              {cat.id !== 'all' && categoryCounts[cat.id] ? (
                <span className="text-[10px] bg-slate-700/80 px-1.5 py-0.5 rounded-full ml-0.5">
                  {categoryCounts[cat.id]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Event Timeline */}
        <div className="flex-1 overflow-auto custom-scrollbar p-4">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500">
              <div className="flex flex-col items-center gap-3">
                <RefreshCw className="w-8 h-8 animate-spin opacity-50" />
                <span className="text-sm">Loading events...</span>
              </div>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <Database className="w-12 h-12 mb-4 opacity-30" />
              <p className="text-sm font-medium">No events recorded</p>
              <p className="text-xs mt-1 text-slate-600">
                Events will appear here as AI agents interact via MCP
              </p>
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl">
              {Object.entries(groupedEntries).map(([date, dateEntries]) => (
                <div key={date}>
                  <div className="flex items-center gap-2 mb-3 sticky top-0 bg-slate-900/90 backdrop-blur-sm py-1 z-10">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-xs font-medium text-slate-400">{date}</span>
                    <div className="h-px flex-1 bg-slate-800" />
                    <span className="text-[10px] text-slate-600">
                      {dateEntries.length} events
                    </span>
                  </div>
                  <div className="space-y-1.5 ml-2 border-l border-slate-800 pl-4">
                    {dateEntries.map((entry) => (
                      <EventCard
                        key={entry.id}
                        entry={entry}
                        expanded={expandedEntry === entry.id}
                        onToggle={() =>
                          setExpandedEntry(expandedEntry === entry.id ? null : entry.id)
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Aggregation Sidebar */}
        <AggregationSidebar aggregations={aggregations} entries={entries} />
      </div>
    </div>
  );
}

// =============================================================================
// Stats Banner
// =============================================================================

function StatsBanner({
  stats,
  aggregations,
  entries,
}: {
  stats: LedgerStats | null;
  aggregations: LedgerAggregation | null;
  entries: LedgerEntry[];
}) {
  const mcpCount = entries.filter(e => e.eventType.startsWith('mcp:')).length;
  const errorCount = aggregations?.errorCount ?? entries.filter(e => e.eventType.includes('error')).length;
  const avgResponseMs = aggregations?.averageResponseTimeMs ?? 0;

  return (
    <div className="grid grid-cols-4 gap-3 p-4 border-b border-slate-700/50">
      <StatCard
        icon={<BarChart3 className="w-4 h-4" />}
        label="Total Events"
        value={stats?.entryCount ?? entries.length}
        color="text-primary"
      />
      <StatCard
        icon={<Zap className="w-4 h-4" />}
        label="MCP Calls"
        value={mcpCount}
        color="text-blue-400"
      />
      <StatCard
        icon={<Timer className="w-4 h-4" />}
        label="Avg Response"
        value={avgResponseMs > 0 ? `${Math.round(avgResponseMs)}ms` : '-'}
        color="text-emerald-400"
      />
      <StatCard
        icon={<AlertCircle className="w-4 h-4" />}
        label="Errors"
        value={errorCount}
        color={errorCount > 0 ? 'text-red-400' : 'text-slate-500'}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-3 flex items-center gap-3">
      <div className={`${color} opacity-80`}>{icon}</div>
      <div>
        <div className="text-lg font-semibold text-white">{value}</div>
        <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      </div>
    </div>
  );
}

// =============================================================================
// Event Card
// =============================================================================

function EventCard({
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
  const categoryColor = getCategoryColor(entry.eventType);
  const sourceClasses = SOURCE_COLORS[entry.source ?? ''] ?? 'bg-slate-700/50 text-slate-400 border-slate-600/50';
  const hasError = !!entry.errorMessage || entry.eventType.includes('error');
  const responseMs = entry.mcpContext?.responseTimeMs;

  return (
    <div className={`rounded-lg border overflow-hidden transition-all ${
      hasError
        ? 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10'
        : expanded
          ? 'bg-slate-800/80 border-slate-700/60'
          : 'bg-slate-800/40 border-slate-700/30 hover:bg-slate-800/60'
    }`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        )}
        <EventTypeIcon eventType={entry.eventType} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${categoryColor}`}>
              {formatEventType(entry.eventType)}
            </span>
            {entry.mcpContext?.toolName && (
              <span className="text-xs text-slate-400 font-mono bg-slate-700/50 px-1.5 py-0.5 rounded">
                {entry.mcpContext.toolName}
              </span>
            )}
          </div>
          {entry.summary && (
            <div className="text-xs text-slate-500 truncate mt-0.5">{entry.summary}</div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {responseMs != null && responseMs > 0 && (
            <span className={`text-[10px] font-mono ${
              responseMs > 1000 ? 'text-amber-400' : 'text-slate-500'
            }`}>
              {responseMs}ms
            </span>
          )}
          {entry.source && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${sourceClasses}`}>
              {formatSource(entry.source)}
            </span>
          )}
          <span className="text-[10px] text-slate-600 font-mono w-16 text-right">{time}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-slate-700/30">
          <div className="pt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-slate-500 mb-1">Event ID</div>
              <div className="text-slate-300 font-mono text-[11px] truncate">{entry.id}</div>
            </div>
            <div>
              <div className="text-slate-500 mb-1">Timestamp</div>
              <div className="text-slate-300 font-mono text-[11px]">
                {new Date(entry.timestamp).toISOString()}
              </div>
            </div>
            {entry.sessionId && (
              <div>
                <div className="text-slate-500 mb-1">Session</div>
                <div className="text-slate-300 font-mono text-[11px] truncate">{entry.sessionId}</div>
              </div>
            )}
            {entry.source && (
              <div>
                <div className="text-slate-500 mb-1">Source</div>
                <div className="text-slate-300">{entry.source}</div>
              </div>
            )}
          </div>

          {/* MCP Context */}
          {entry.mcpContext && (
            <div className="mt-3 p-2.5 bg-blue-500/5 border border-blue-500/10 rounded-lg">
              <div className="text-[10px] text-blue-400 font-medium uppercase tracking-wider mb-2">
                MCP Context
              </div>
              <div className="space-y-1.5 text-xs">
                {entry.mcpContext.toolName && (
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-20 flex-shrink-0">Tool:</span>
                    <span className="text-slate-300 font-mono">{entry.mcpContext.toolName}</span>
                  </div>
                )}
                {entry.mcpContext.query && (
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-20 flex-shrink-0">Query:</span>
                    <span className="text-slate-300">{entry.mcpContext.query}</span>
                  </div>
                )}
                {entry.mcpContext.resultCount != null && (
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-20 flex-shrink-0">Results:</span>
                    <span className="text-slate-300">{entry.mcpContext.resultCount}</span>
                  </div>
                )}
                {entry.mcpContext.responseTimeMs != null && (
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-20 flex-shrink-0">Duration:</span>
                    <span className="text-slate-300">{entry.mcpContext.responseTimeMs}ms</span>
                  </div>
                )}
                {entry.mcpContext.parameters && Object.keys(entry.mcpContext.parameters).length > 0 && (
                  <div>
                    <div className="text-slate-500 mb-1">Parameters:</div>
                    <pre className="text-[11px] text-slate-400 bg-slate-900/60 p-2 rounded overflow-auto max-h-24 font-mono">
                      {JSON.stringify(entry.mcpContext.parameters, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Impacted files/entities */}
          {entry.impactedFiles && entry.impactedFiles.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-slate-500 mb-1">Impacted Files</div>
              <div className="flex flex-wrap gap-1">
                {entry.impactedFiles.map((f, i) => (
                  <span key={i} className="text-[11px] font-mono text-emerald-400/80 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                    {f.split('/').pop()}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Error info */}
          {entry.errorMessage && (
            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded">
              <div className="text-xs text-red-400">{entry.errorMessage}</div>
              {entry.errorCode && (
                <div className="text-[10px] text-red-500 mt-1 font-mono">{entry.errorCode}</div>
              )}
            </div>
          )}

          {/* Raw metadata */}
          {entry.metadata && Object.keys(entry.metadata).length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-slate-500 mb-1">Metadata</div>
              <pre className="text-[11px] text-slate-400 bg-slate-900/60 p-2 rounded overflow-auto max-h-32 font-mono">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Aggregation Sidebar
// =============================================================================

function AggregationSidebar({
  aggregations,
  entries,
}: {
  aggregations: LedgerAggregation | null;
  entries: LedgerEntry[];
}) {
  // Compute source distribution from entries if aggregations not available
  const sourceDistribution = aggregations?.bySource ??
    entries.reduce((acc, e) => {
      const src = e.source ?? 'unknown';
      acc[src] = (acc[src] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const eventTypeDistribution = aggregations?.byEventType ??
    entries.reduce((acc, e) => {
      acc[e.eventType] = (acc[e.eventType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const topFiles = aggregations?.topImpactedFiles ?? [];

  // Tool usage from MCP entries
  const toolUsage = entries
    .filter(e => e.mcpContext?.toolName)
    .reduce((acc, e) => {
      const tool = e.mcpContext!.toolName!;
      acc[tool] = (acc[tool] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  return (
    <div className="w-72 border-l border-slate-700/50 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Insights</span>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar p-4 space-y-5">
        {/* Tool Usage */}
        {Object.keys(toolUsage).length > 0 && (
          <InsightSection title="MCP Tool Usage" icon={<Zap className="w-3 h-3" />}>
            {Object.entries(toolUsage)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 10)
              .map(([tool, count]) => (
                <BarItem key={tool} label={tool} count={count} total={entries.length} color="bg-blue-500" />
              ))}
          </InsightSection>
        )}

        {/* Source Distribution */}
        {Object.keys(sourceDistribution).length > 0 && (
          <InsightSection title="By Source" icon={<Layers className="w-3 h-3" />}>
            {Object.entries(sourceDistribution)
              .sort(([, a], [, b]) => b - a)
              .map(([source, count]) => (
                <BarItem key={source} label={formatSource(source)} count={count} total={entries.length} color="bg-primary" />
              ))}
          </InsightSection>
        )}

        {/* Event Type Distribution */}
        {Object.keys(eventTypeDistribution).length > 0 && (
          <InsightSection title="By Event Type" icon={<BarChart3 className="w-3 h-3" />}>
            {Object.entries(eventTypeDistribution)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 12)
              .map(([type, count]) => (
                <BarItem key={type} label={formatEventType(type)} count={count} total={entries.length} color="bg-emerald-500" />
              ))}
          </InsightSection>
        )}

        {/* Top Impacted Files */}
        {topFiles.length > 0 && (
          <InsightSection title="Hot Files" icon={<FileCode className="w-3 h-3" />}>
            {topFiles.slice(0, 8).map((f) => (
              <div key={f.file} className="flex items-center justify-between text-xs py-0.5">
                <span className="text-slate-400 truncate font-mono text-[11px] flex-1 mr-2">
                  {f.file.split('/').pop()}
                </span>
                <span className="text-slate-500 flex-shrink-0">{f.count}</span>
              </div>
            ))}
          </InsightSection>
        )}

        {/* Recent Activity */}
        <InsightSection title="Latest" icon={<Eye className="w-3 h-3" />}>
          {entries.slice(0, 5).map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 py-1">
              <EventTypeIcon eventType={entry.eventType} size={10} />
              <span className="text-[11px] text-slate-400 truncate flex-1">
                {entry.mcpContext?.toolName ?? formatEventType(entry.eventType)}
              </span>
              <span className="text-[10px] text-slate-600 flex-shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString('en-US', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          ))}
        </InsightSection>
      </div>
    </div>
  );
}

// =============================================================================
// Shared Components
// =============================================================================

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
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
        {icon}
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function BarItem({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="group">
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-slate-400 truncate text-[11px]">{label}</span>
        <span className="text-slate-500 text-[10px] ml-2 flex-shrink-0">{count}</span>
      </div>
      <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} opacity-60 transition-all duration-300`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
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
  // mcp:tool:called -> Tool Called
  const parts = eventType.split(':');
  if (parts.length <= 1) return eventType;
  return parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function formatSource(source: string): string {
  return source.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getCategoryColor(eventType: string): string {
  if (eventType.startsWith('mcp:')) return 'text-blue-400';
  if (eventType.startsWith('index:')) return 'text-emerald-400';
  if (eventType.startsWith('classify:')) return 'text-cyan-400';
  if (eventType.startsWith('justify:')) return 'text-purple-400';
  if (eventType.startsWith('adaptive:')) return 'text-amber-400';
  if (eventType.startsWith('graph:')) return 'text-rose-400';
  if (eventType.startsWith('user:')) return 'text-green-400';
  if (eventType.startsWith('system:')) return 'text-orange-400';
  return 'text-slate-300';
}

function EventCategoryIcon({ category, size = 14 }: { category: EventCategory; size?: number }) {
  const s = { width: size, height: size };
  switch (category) {
    case 'mcp': return <Zap style={s} />;
    case 'index': return <FileCode style={s} />;
    case 'classify': return <Layers style={s} />;
    case 'justify': return <Brain style={s} />;
    case 'adaptive': return <TrendingUp style={s} />;
    case 'graph': return <GitBranch style={s} />;
    case 'user': return <Users style={s} />;
    case 'system': return <Server style={s} />;
    default: return <Activity style={s} />;
  }
}

function EventTypeIcon({ eventType, size = 14 }: { eventType: string; size?: number }) {
  const s = { width: size, height: size };
  const color = getCategoryColor(eventType);

  if (eventType.includes('error') || eventType.includes('warning'))
    return <AlertCircle style={s} className={color} />;
  if (eventType.includes('completed') || eventType.includes('success'))
    return <CheckCircle style={s} className={color} />;
  if (eventType.includes('started'))
    return <Activity style={s} className={color} />;
  if (eventType.includes('created') || eventType.includes('added'))
    return <Plus style={s} className={color} />;
  if (eventType.includes('deleted'))
    return <Trash style={s} className={color} />;
  if (eventType.includes('tool:called'))
    return <Zap style={s} className={color} />;
  if (eventType.includes('query'))
    return <Search style={s} className={color} />;
  if (eventType.includes('resource'))
    return <Database style={s} className={color} />;
  if (eventType.includes('feedback') || eventType.includes('correction'))
    return <Users style={s} className={color} />;

  return <Info style={s} className={color} />;
}

export default ObservabilityView;

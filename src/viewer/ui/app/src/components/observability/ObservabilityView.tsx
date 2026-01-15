import { useState, useEffect } from 'react';
import {
  Activity,
  Clock,
  Database,
  FileCode,
  RefreshCw,
  Filter,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Info,
  Edit,
  Trash,
  Plus,
} from 'lucide-react';
import { getLedgerEntries, type LedgerEntry } from '../../api/client';

type EventFilter = 'all' | 'index' | 'justify' | 'classify' | 'query';

export function ObservabilityView() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<EventFilter>('all');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadEntries = () => {
    setLoading(true);
    const params: { eventType?: string; limit: number } = { limit: 100 };
    if (filter !== 'all') {
      params.eventType = filter;
    }
    getLedgerEntries(params)
      .then(setEntries)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEntries();
  }, [filter]);

  // Auto-refresh every 5 seconds if enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadEntries, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, filter]);

  // Group entries by date
  const groupedEntries = entries.reduce(
    (acc, entry) => {
      const date = new Date(entry.timestamp).toLocaleDateString();
      if (!acc[date]) acc[date] = [];
      acc[date].push(entry);
      return acc;
    },
    {} as Record<string, LedgerEntry[]>
  );

  // Event type stats
  const eventStats = entries.reduce(
    (acc, entry) => {
      acc[entry.eventType] = (acc[entry.eventType] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="h-full flex">
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-slate-700 p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-blue-400" />
              <h1 className="text-xl font-semibold text-white">Observability</h1>
              <span className="text-sm text-slate-500">
                {entries.length} events
              </span>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded border-slate-600"
                />
                Auto-refresh
              </label>
              <button
                onClick={loadEntries}
                disabled={loading}
                className="btn btn-secondary flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <FilterButton
              active={filter === 'all'}
              onClick={() => setFilter('all')}
              label="All"
              count={entries.length}
            />
            <FilterButton
              active={filter === 'index'}
              onClick={() => setFilter('index')}
              label="Index"
              count={eventStats['index'] || 0}
            />
            <FilterButton
              active={filter === 'justify'}
              onClick={() => setFilter('justify')}
              label="Justify"
              count={eventStats['justify'] || 0}
            />
            <FilterButton
              active={filter === 'classify'}
              onClick={() => setFilter('classify')}
              label="Classify"
              count={eventStats['classify'] || 0}
            />
            <FilterButton
              active={filter === 'query'}
              onClick={() => setFilter('query')}
              label="Query"
              count={eventStats['query'] || 0}
            />
          </div>
        </div>

        {/* Event Timeline */}
        <div className="flex-1 overflow-auto custom-scrollbar p-4">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500">
              Loading events...
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <Database className="w-12 h-12 mb-4 opacity-50" />
              <p>No events recorded yet</p>
              <p className="text-sm mt-1">Events will appear here as you use Code-Synapse</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedEntries).map(([date, dateEntries]) => (
                <div key={date}>
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-medium text-slate-400">{date}</span>
                    <span className="text-xs text-slate-600">
                      ({dateEntries.length} events)
                    </span>
                  </div>
                  <div className="space-y-2 ml-6 border-l-2 border-slate-700 pl-4">
                    {dateEntries.map((entry) => (
                      <EventCard
                        key={entry.id}
                        entry={entry}
                        expanded={expandedEntry === entry.id}
                        onToggle={() =>
                          setExpandedEntry(
                            expandedEntry === entry.id ? null : entry.id
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stats Sidebar */}
      <div className="w-72 border-l border-slate-700 flex flex-col">
        <div className="panel-header">Event Statistics</div>
        <div className="flex-1 overflow-auto custom-scrollbar p-4 space-y-6">
          {/* Event Type Distribution */}
          <div>
            <h4 className="text-xs font-medium text-slate-500 uppercase mb-3">
              By Event Type
            </h4>
            {Object.entries(eventStats).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(eventStats)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <EventTypeIcon type={type} />
                        <span className="text-sm text-slate-300 capitalize">{type}</span>
                      </div>
                      <span className="text-sm text-slate-500">{count}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No events yet</p>
            )}
          </div>

          {/* Recent Activity */}
          <div>
            <h4 className="text-xs font-medium text-slate-500 uppercase mb-3">
              Recent Activity
            </h4>
            <div className="space-y-2">
              {entries.slice(0, 5).map((entry) => (
                <div
                  key={entry.id}
                  className="text-sm text-slate-400 truncate"
                  title={entry.eventType}
                >
                  <span className="text-slate-500">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>{' '}
                  - {entry.eventType}
                </div>
              ))}
            </div>
          </div>

          {/* System Info */}
          <div>
            <h4 className="text-xs font-medium text-slate-500 uppercase mb-3">
              System Info
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Events (total)</span>
                <span className="text-slate-300">{entries.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Oldest Event</span>
                <span className="text-slate-300">
                  {entries.length > 0
                    ? new Date(
                        entries[entries.length - 1].timestamp
                      ).toLocaleDateString()
                    : '-'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-slate-700 text-white'
          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      }`}
    >
      {label}
      <span
        className={`text-xs px-1.5 py-0.5 rounded ${
          active ? 'bg-slate-600' : 'bg-slate-700'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function EventCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: LedgerEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const time = new Date(entry.timestamp).toLocaleTimeString();

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 hover:bg-slate-700/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-500" />
        )}
        <EventTypeIcon type={entry.eventType} />
        <div className="flex-1 text-left">
          <div className="text-sm text-slate-200 capitalize">{entry.eventType}</div>
          {entry.entityId && (
            <div className="text-xs text-slate-500 truncate">{entry.entityId}</div>
          )}
        </div>
        <span className="text-xs text-slate-500">{time}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-slate-700">
          <div className="pt-3 space-y-2">
            <div className="text-xs text-slate-500">Event ID</div>
            <div className="text-sm text-slate-300 font-mono">{entry.id}</div>

            {entry.entityId && (
              <>
                <div className="text-xs text-slate-500 mt-2">Entity ID</div>
                <div className="text-sm text-slate-300 font-mono">{entry.entityId}</div>
              </>
            )}

            <div className="text-xs text-slate-500 mt-2">Details</div>
            <pre className="text-xs text-slate-400 bg-slate-900 p-2 rounded overflow-auto max-h-40">
              {JSON.stringify(entry.details, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function EventTypeIcon({ type }: { type: string }) {
  const baseClass = 'w-4 h-4';

  switch (type) {
    case 'index':
      return <FileCode className={`${baseClass} text-blue-400`} />;
    case 'justify':
      return <Info className={`${baseClass} text-purple-400`} />;
    case 'classify':
      return <Filter className={`${baseClass} text-cyan-400`} />;
    case 'query':
      return <Database className={`${baseClass} text-green-400`} />;
    case 'create':
      return <Plus className={`${baseClass} text-green-400`} />;
    case 'update':
      return <Edit className={`${baseClass} text-yellow-400`} />;
    case 'delete':
      return <Trash className={`${baseClass} text-red-400`} />;
    case 'error':
      return <AlertCircle className={`${baseClass} text-red-400`} />;
    case 'success':
      return <CheckCircle className={`${baseClass} text-green-400`} />;
    default:
      return <Activity className={`${baseClass} text-slate-400`} />;
  }
}

export default ObservabilityView;

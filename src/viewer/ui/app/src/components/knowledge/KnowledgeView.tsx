import { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Filter,
  SortAsc,
  SortDesc,
  Box,
  Layers,
  Hash,
  Code,
  FileCode,
  ChevronDown,
  X,
  Brain,
} from 'lucide-react';
import { useKnowledgeStore, useUIStore } from '../../store';
import {
  getFunctions,
  getClasses,
  getInterfaces,
} from '../../api/client';
import type { EntitySummary } from '../../api/client';

export function KnowledgeView() {
  const { selectedEntity, setSelectedEntity } = useUIStore();
  const {
    entities,
    setEntities,
    filters,
    setFilters,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
  } = useKnowledgeStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'functions' | 'classes' | 'interfaces'>('all');

  // Load all entities on mount
  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      getFunctions({ limit: 500 }),
      getClasses({ limit: 500 }),
      getInterfaces({ limit: 500 }),
    ])
      .then(([functions, classes, interfaces]) => {
        setEntities([...functions, ...classes, ...interfaces]);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load entities:', err);
        setError(err instanceof Error ? err.message : 'Failed to load knowledge data. Is the API server running?');
        setLoading(false);
      });
  }, [setEntities]);

  // Filter and sort entities
  const filteredEntities = useMemo(() => {
    let result = [...entities];

    // Filter by tab
    if (activeTab !== 'all') {
      const kindMap: Record<string, string> = {
        functions: 'function',
        classes: 'class',
        interfaces: 'interface',
      };
      result = result.filter((e) => e.kind === kindMap[activeTab]);
    }

    // Filter by kind
    if (filters.kind.length > 0) {
      result = result.filter((e) => filters.kind.includes(e.kind));
    }

    // Filter by classification
    if (filters.classification.length > 0) {
      result = result.filter(
        (e) => e.classification && filters.classification.includes(e.classification)
      );
    }

    // Filter by search
    if (filters.search) {
      const search = filters.search.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(search) ||
          e.filePath.toLowerCase().includes(search)
      );
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'kind':
          cmp = a.kind.localeCompare(b.kind);
          break;
        case 'confidence':
          cmp = (a.confidence || 0) - (b.confidence || 0);
          break;
        case 'file':
          cmp = a.filePath.localeCompare(b.filePath);
          break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [entities, activeTab, filters, sortBy, sortOrder]);

  // Count by kind
  const counts = useMemo(() => {
    return {
      all: entities.length,
      functions: entities.filter((e) => e.kind === 'function').length,
      classes: entities.filter((e) => e.kind === 'class').length,
      interfaces: entities.filter((e) => e.kind === 'interface').length,
    };
  }, [entities]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        Loading entities...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4 p-8">
        <div className="text-red-400 text-lg font-medium">Failed to load knowledge</div>
        <div className="text-slate-500 text-center max-w-md">{error}</div>
        <div className="text-sm text-slate-600 mt-4">
          Make sure:
          <ul className="list-disc list-inside mt-2 text-left">
            <li>The API server is running (<code className="text-cyan-400">code-synapse viewer</code>)</li>
            <li>You have indexed your project (<code className="text-cyan-400">code-synapse index</code>)</li>
          </ul>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="btn btn-primary mt-4"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Main content */}
      <div className={`flex-1 flex flex-col ${selectedEntity ? 'border-r border-slate-700' : ''}`}>
        {/* Header */}
        <div className="border-b border-slate-700 p-4">
          <h1 className="text-xl font-semibold text-white mb-4">Knowledge Base</h1>

          {/* Tabs */}
          <div className="flex gap-2 mb-4">
          <TabButton
            active={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
            icon={<Code className="w-4 h-4" />}
            label="All"
            count={counts.all}
          />
          <TabButton
            active={activeTab === 'functions'}
            onClick={() => setActiveTab('functions')}
            icon={<Box className="w-4 h-4" />}
            label="Functions"
            count={counts.functions}
          />
          <TabButton
            active={activeTab === 'classes'}
            onClick={() => setActiveTab('classes')}
            icon={<Layers className="w-4 h-4" />}
            label="Classes"
            count={counts.classes}
          />
          <TabButton
            active={activeTab === 'interfaces'}
            onClick={() => setActiveTab('interfaces')}
            icon={<Hash className="w-4 h-4" />}
            label="Interfaces"
            count={counts.interfaces}
          />
        </div>

        {/* Search and Filters */}
        <div className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search entities..."
              value={filters.search}
              onChange={(e) => setFilters({ search: e.target.value })}
              className="input pl-10"
            />
          </div>

          <FilterDropdown
            label="Classification"
            options={['domain', 'infrastructure']}
            selected={filters.classification}
            onChange={(classification) => setFilters({ classification })}
          />

          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="btn btn-secondary flex items-center gap-2"
          >
            {sortOrder === 'asc' ? (
              <SortAsc className="w-4 h-4" />
            ) : (
              <SortDesc className="w-4 h-4" />
            )}
            Sort
          </button>
        </div>
      </div>

      {/* Entity List */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full">
          <thead className="bg-slate-800 sticky top-0">
            <tr className="text-left text-sm text-slate-400">
              <th
                className="px-4 py-3 font-medium cursor-pointer hover:text-white"
                onClick={() => setSortBy('name')}
              >
                Name {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th
                className="px-4 py-3 font-medium cursor-pointer hover:text-white"
                onClick={() => setSortBy('kind')}
              >
                Kind {sortBy === 'kind' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th
                className="px-4 py-3 font-medium cursor-pointer hover:text-white"
                onClick={() => setSortBy('file')}
              >
                File {sortBy === 'file' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th
                className="px-4 py-3 font-medium cursor-pointer hover:text-white"
                onClick={() => setSortBy('confidence')}
              >
                Confidence{' '}
                {sortBy === 'confidence' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th className="px-4 py-3 font-medium">Classification</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntities.map((entity) => (
              <tr
                key={entity.id}
                className="border-b border-slate-700/50 hover:bg-slate-800/50 cursor-pointer"
                onClick={() => setSelectedEntity(entity)}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <EntityIcon kind={entity.kind} />
                    <span className="text-slate-200">{entity.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <KindBadge kind={entity.kind} />
                </td>
                <td className="px-4 py-3 text-sm text-slate-400 max-w-xs truncate">
                  {entity.filePath}
                </td>
                <td className="px-4 py-3">
                  {entity.confidence !== undefined && (
                    <ConfidenceBadge confidence={entity.confidence} />
                  )}
                </td>
                <td className="px-4 py-3">
                  {entity.classification && (
                    <ClassificationBadge classification={entity.classification} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredEntities.length === 0 && entities.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-slate-500 gap-2">
            <Code className="w-12 h-12 text-slate-600" />
            <div className="text-lg font-medium">No knowledge extracted yet</div>
            <div className="text-sm text-slate-600 text-center max-w-md">
              Run <code className="text-cyan-400 bg-slate-800 px-1 rounded">code-synapse index</code> to extract knowledge from your codebase.
            </div>
          </div>
        )}
        {filteredEntities.length === 0 && entities.length > 0 && (
          <div className="flex items-center justify-center h-32 text-slate-500">
            No entities found matching your filters
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-700 px-4 py-2 text-sm text-slate-500">
        Showing {filteredEntities.length} of {entities.length} entities
      </div>
    </div>

      {/* Detail Panel */}
      {selectedEntity && (
        <EntityDetailPanel entity={selectedEntity} onClose={() => setSelectedEntity(null)} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-slate-700 text-white'
          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      }`}
    >
      {icon}
      {label}
      <span className="text-xs bg-slate-600 px-1.5 py-0.5 rounded">
        {count}
      </span>
    </button>
  );
}

function FilterDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="btn btn-secondary flex items-center gap-2"
      >
        <Filter className="w-4 h-4" />
        {label}
        {selected.length > 0 && (
          <span className="text-xs bg-blue-500 px-1.5 py-0.5 rounded">
            {selected.length}
          </span>
        )}
        <ChevronDown className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-10 min-w-40">
          {options.map((option) => (
            <label
              key={option}
              className="flex items-center gap-2 px-3 py-2 hover:bg-slate-700 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange([...selected, option]);
                  } else {
                    onChange(selected.filter((s) => s !== option));
                  }
                }}
                className="rounded border-slate-600"
              />
              <span className="text-sm text-slate-300 capitalize">{option}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function EntityIcon({ kind }: { kind: string }) {
  const props = { className: 'w-4 h-4' };
  switch (kind) {
    case 'function':
      return <Box {...props} className="w-4 h-4 text-blue-400" />;
    case 'class':
      return <Layers {...props} className="w-4 h-4 text-purple-400" />;
    case 'interface':
      return <Hash {...props} className="w-4 h-4 text-cyan-400" />;
    default:
      return <FileCode {...props} className="w-4 h-4 text-gray-400" />;
  }
}

function KindBadge({ kind }: { kind: string }) {
  const classes =
    kind === 'function'
      ? 'badge-function'
      : kind === 'class'
        ? 'badge-class'
        : kind === 'interface'
          ? 'badge-interface'
          : 'badge-variable';

  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${classes}`}>
      {kind}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level =
    confidence >= 0.8
      ? 'high'
      : confidence >= 0.6
        ? 'medium'
        : confidence >= 0.4
          ? 'low'
          : 'uncertain';

  const classes =
    level === 'high'
      ? 'bg-green-500/20 text-green-400'
      : level === 'medium'
        ? 'bg-yellow-500/20 text-yellow-400'
        : level === 'low'
          ? 'bg-orange-500/20 text-orange-400'
          : 'bg-red-500/20 text-red-400';

  return (
    <span className={`text-xs px-2 py-0.5 rounded ${classes}`}>
      {Math.round(confidence * 100)}%
    </span>
  );
}

function ClassificationBadge({ classification }: { classification: string }) {
  const classes =
    classification === 'domain' ? 'badge-domain' : 'badge-infrastructure';

  return (
    <span className={`text-xs px-2 py-0.5 rounded ${classes}`}>
      {classification}
    </span>
  );
}

function EntityDetailPanel({
  entity,
  onClose,
}: {
  entity: EntitySummary;
  onClose: () => void;
}) {
  return (
    <div className="w-80 flex-shrink-0 bg-slate-800/50 overflow-auto custom-scrollbar">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Entity Details</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Entity Info */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`p-2 rounded ${
              entity.kind === 'function'
                ? 'bg-blue-500/20'
                : entity.kind === 'class'
                  ? 'bg-purple-500/20'
                  : entity.kind === 'interface'
                    ? 'bg-cyan-500/20'
                    : 'bg-gray-500/20'
            }`}
          >
            <EntityIcon kind={entity.kind} />
          </div>
          <div>
            <h4 className="font-medium text-white">{entity.name || '(anonymous)'}</h4>
            <KindBadge kind={entity.kind} />
          </div>
        </div>

        {/* Location */}
        <div className="mb-4">
          <h5 className="text-xs font-medium text-slate-500 uppercase mb-1">Location</h5>
          <div className="text-sm text-slate-300 truncate">{entity.filePath}</div>
          <div className="text-xs text-slate-500">
            Lines {entity.startLine} - {entity.endLine}
          </div>
        </div>

        {/* Confidence */}
        {entity.confidence !== undefined && (
          <div className="mb-4">
            <h5 className="text-xs font-medium text-slate-500 uppercase mb-1">Confidence</h5>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    entity.confidence >= 0.8
                      ? 'bg-green-500'
                      : entity.confidence >= 0.6
                        ? 'bg-yellow-500'
                        : entity.confidence >= 0.4
                          ? 'bg-orange-500'
                          : 'bg-red-500'
                  }`}
                  style={{ width: `${entity.confidence * 100}%` }}
                />
              </div>
              <span className="text-sm text-slate-400">
                {Math.round(entity.confidence * 100)}%
              </span>
            </div>
          </div>
        )}

        {/* Justification */}
        <div className="mb-4">
          <h5 className="text-xs font-medium text-slate-500 uppercase mb-1 flex items-center gap-1">
            <Brain className="w-3 h-3" />
            Business Justification
          </h5>
          <p className="text-sm text-slate-300 bg-slate-700/50 rounded p-2">
            {entity.justification || <span className="text-slate-500 italic">No justification available</span>}
          </p>
        </div>

        {/* Classification */}
        {entity.classification && (
          <div className="mb-4">
            <h5 className="text-xs font-medium text-slate-500 uppercase mb-1">Classification</h5>
            <ClassificationBadge classification={entity.classification} />
            {entity.subCategory && (
              <span className="ml-2 text-xs text-slate-500">{entity.subCategory}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default KnowledgeView;

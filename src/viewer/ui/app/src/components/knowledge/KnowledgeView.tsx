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
  ChevronDown
} from 'lucide-react';
import { useKnowledgeStore, useUIStore } from '../../store';
import { EntityInsightsPanel } from '../common/EntityInsightsPanel';
import { KnowledgeGrid } from './KnowledgeGrid';
import {
  getFunctions,
  getClasses,
  getInterfaces,
} from '../../api/client';

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
            <TabButton active={activeTab === 'all'} onClick={() => setActiveTab('all')} icon={<Code className="w-4 h-4" />} label="All" count={counts.all} />
            <TabButton active={activeTab === 'functions'} onClick={() => setActiveTab('functions')} icon={<Box className="w-4 h-4" />} label="Functions" count={counts.functions} />
            <TabButton active={activeTab === 'classes'} onClick={() => setActiveTab('classes')} icon={<Layers className="w-4 h-4" />} label="Classes" count={counts.classes} />
            <TabButton active={activeTab === 'interfaces'} onClick={() => setActiveTab('interfaces')} icon={<Hash className="w-4 h-4" />} label="Interfaces" count={counts.interfaces} />
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

            <SortDropdown
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSortChange={setSortBy}
              onOrderChange={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            />
          </div>
        </div>

        {/* Entity List via KnowledgeGrid */}
        <div className="flex-1 overflow-hidden">
          <KnowledgeGrid
            entities={filteredEntities}
            onSelect={setSelectedEntity}
            selectedId={selectedEntity?.id}
          />
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 px-4 py-2 text-sm text-slate-500">
          Showing {filteredEntities.length} of {entities.length} entities
        </div>
      </div>

      {/* Detail Panel */}
      {selectedEntity && (
        <EntityInsightsPanel entity={selectedEntity} onClose={() => setSelectedEntity(null)} />
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
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${active
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

function SortDropdown({
  sortBy,
  sortOrder,
  onSortChange,
  onOrderChange
}: {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSortChange: (sort: any) => void;
  onOrderChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const options = [
    { id: 'name', label: 'Name' },
    { id: 'kind', label: 'Kind' },
    { id: 'confidence', label: 'Confidence' },
    { id: 'file', label: 'File location' },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="btn btn-secondary flex items-center gap-2"
      >
        {sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
        Sort by: <span className="text-slate-200">{options.find(o => o.id === sortBy)?.label}</span>
        <ChevronDown className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-10 min-w-40 py-1">
          <div className="px-3 py-2 border-b border-slate-700 mb-1">
            <button onClick={onOrderChange} className="text-xs text-blue-400 hover:text-blue-300 w-full text-left flex items-center gap-1">
              Change Order ({sortOrder.toUpperCase()})
            </button>
          </div>
          {options.map(opt => (
            <button
              key={opt.id}
              onClick={() => {
                onSortChange(opt.id);
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-700 ${sortBy === opt.id ? 'text-blue-400 bg-slate-700/30' : 'text-slate-300'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default KnowledgeView;

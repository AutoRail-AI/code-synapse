import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  FolderTree,
  GitBranch,
  LayoutDashboard,
  Settings,
  Activity,
  RefreshCw,
  Shield,
  Layers,
  Box,
  FileCode,
  Hash,
} from 'lucide-react';
import { useUIStore } from '../../store';
import { searchNatural, triggerReindex, triggerJustify, triggerClassify } from '../../api/client';
import type { SearchResult } from '../../api/client';

interface PaletteItem {
  id: string;
  label: string;
  category: 'navigation' | 'action' | 'entity';
  icon: React.ReactNode;
  description?: string;
  shortcut?: string;
  onSelect: () => void;
}

// Fuzzy match scoring
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Exact prefix gets highest score
  if (t.startsWith(q)) return 100 + q.length;

  // Word-start match
  const words = t.split(/[\s\-_./]/);
  const wordStarts = words.map((w) => w.charAt(0)).join('');
  if (wordStarts.toLowerCase().includes(q)) return 80;

  // Consecutive character match
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let lastIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutive = ti === lastIndex + 1 ? consecutive + 1 : 1;
      score += consecutive * 2;

      // Bonus for word boundary match
      if (ti === 0 || /[\s\-_./]/.test(t[ti - 1]!)) {
        score += 5;
      }
      lastIndex = ti;
    }
  }

  return qi === q.length ? score : 0;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { setActiveSection } = useUIStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entityResults, setEntityResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const navigateTo = useCallback(
    (path: string, section: string) => {
      setActiveSection(section);
      navigate(path);
      onClose();
    },
    [navigate, setActiveSection, onClose]
  );

  const navigationItems: PaletteItem[] = useMemo(
    () => [
      {
        id: 'nav-dashboard',
        label: 'Dashboard',
        category: 'navigation',
        icon: <LayoutDashboard className="w-4 h-4" />,
        description: 'Overview & stats',
        shortcut: '\u2318 1',
        onSelect: () => navigateTo('/dashboard', 'dashboard'),
      },
      {
        id: 'nav-explorer',
        label: 'Explorer',
        category: 'navigation',
        icon: <FolderTree className="w-4 h-4" />,
        description: 'Browse files & entities',
        shortcut: '\u2318 2',
        onSelect: () => navigateTo('/explorer', 'explorer'),
      },
      {
        id: 'nav-graph',
        label: 'Graph',
        category: 'navigation',
        icon: <GitBranch className="w-4 h-4" />,
        description: 'Knowledge graph',
        shortcut: '\u2318 3',
        onSelect: () => navigateTo('/graph', 'graph'),
      },
      {
        id: 'nav-search',
        label: 'Search',
        category: 'navigation',
        icon: <Search className="w-4 h-4" />,
        description: 'Semantic & natural language',
        shortcut: '\u2318 4',
        onSelect: () => navigateTo('/search', 'search'),
      },
      {
        id: 'nav-operations',
        label: 'Operations',
        category: 'navigation',
        icon: <Settings className="w-4 h-4" />,
        description: 'Indexing & config',
        shortcut: '\u2318 5',
        onSelect: () => navigateTo('/operations', 'operations'),
      },
      {
        id: 'nav-observability',
        label: 'Ledger',
        category: 'navigation',
        icon: <Activity className="w-4 h-4" />,
        description: 'Change ledger & metrics',
        shortcut: '\u2318 6',
        onSelect: () => navigateTo('/observability', 'observability'),
      },
    ],
    [navigateTo]
  );

  const actionItems: PaletteItem[] = useMemo(
    () => [
      {
        id: 'action-reindex',
        label: 'Trigger Re-index',
        category: 'action',
        icon: <RefreshCw className="w-4 h-4" />,
        description: 'Scan and rebuild knowledge graph',
        onSelect: () => {
          triggerReindex().catch(console.error);
          onClose();
        },
      },
      {
        id: 'action-justify',
        label: 'Run Justification',
        category: 'action',
        icon: <Shield className="w-4 h-4" />,
        description: 'Generate business justifications',
        onSelect: () => {
          triggerJustify().catch(console.error);
          onClose();
        },
      },
      {
        id: 'action-classify',
        label: 'Run Classification',
        category: 'action',
        icon: <Layers className="w-4 h-4" />,
        description: 'Classify domain/infrastructure',
        onSelect: () => {
          triggerClassify().catch(console.error);
          onClose();
        },
      },
    ],
    [onClose]
  );

  // Entity search items from API
  const entityItems: PaletteItem[] = useMemo(
    () =>
      entityResults.map((r) => {
        const kindIcon =
          r.entity.kind === 'function' ? (
            <Box className="w-4 h-4" />
          ) : r.entity.kind === 'class' ? (
            <Layers className="w-4 h-4" />
          ) : r.entity.kind === 'file' ? (
            <FileCode className="w-4 h-4" />
          ) : (
            <Hash className="w-4 h-4" />
          );
        return {
          id: `entity-${r.entity.id}`,
          label: r.entity.name,
          category: 'entity' as const,
          icon: kindIcon,
          description: `${r.entity.kind} in ${r.entity.filePath.split('/').pop()}`,
          onSelect: () => {
            navigate(`/explorer?file=${encodeURIComponent(r.entity.filePath)}`);
            setActiveSection('explorer');
            onClose();
          },
        };
      }),
    [entityResults, navigate, setActiveSection, onClose]
  );

  // Filter & sort all items
  const filteredItems = useMemo(() => {
    if (!query.trim()) {
      return [...navigationItems, ...actionItems];
    }

    const all = [...navigationItems, ...actionItems, ...entityItems];
    return all
      .map((item) => ({ item, score: fuzzyScore(query, item.label) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  }, [query, navigationItems, actionItems, entityItems]);

  // Debounced entity search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setEntityResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await searchNatural(query.trim());
        setEntityResults(results.slice(0, 5));
      } catch {
        setEntityResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems.length]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filteredItems[selectedIndex]) {
        e.preventDefault();
        filteredItems[selectedIndex]!.onSelect();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, filteredItems, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Group items by category
  const grouped = useMemo(() => {
    const groups: { category: string; label: string; items: PaletteItem[] }[] = [];
    const nav = filteredItems.filter((i) => i.category === 'navigation');
    const act = filteredItems.filter((i) => i.category === 'action');
    const ent = filteredItems.filter((i) => i.category === 'entity');
    if (nav.length) groups.push({ category: 'navigation', label: 'Navigation', items: nav });
    if (act.length) groups.push({ category: 'action', label: 'Actions', items: act });
    if (ent.length) groups.push({ category: 'entity', label: 'Entities', items: ent });
    return groups;
  }, [filteredItems]);

  // Compute flat index for each item in groups
  let flatIdx = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-xl glass-panel rounded-xl shadow-2xl border border-slate-700/30">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <Search className="w-5 h-5 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, views, or entities..."
            className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 outline-none text-lg"
            autoFocus
          />
          {searchLoading && (
            <div className="w-4 h-4 border-2 border-electric-cyan/30 border-t-electric-cyan rounded-full animate-spin" />
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="py-2 max-h-80 overflow-y-auto custom-scrollbar">
          {grouped.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">
              No results found
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.category}>
                <div className="px-3 py-1 text-xs font-medium text-slate-500 uppercase">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const idx = flatIdx++;
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      onClick={item.onSelect}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors ${
                        isSelected
                          ? 'bg-rail-purple/15 text-white'
                          : 'text-slate-300 hover:bg-slate-700/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={isSelected ? 'text-electric-cyan' : 'text-slate-500'}>
                          {item.icon}
                        </span>
                        <div className="text-left">
                          <div>{item.label}</div>
                          {item.description && (
                            <div className="text-[11px] text-slate-500">{item.description}</div>
                          )}
                        </div>
                      </div>
                      {item.shortcut && (
                        <kbd className="text-xs text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded font-mono">
                          {item.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 text-[11px] text-slate-600">
          <div className="flex items-center gap-3">
            <span><kbd className="px-1 py-0.5 bg-slate-700/50 rounded font-mono">&uarr;&darr;</kbd> navigate</span>
            <span><kbd className="px-1 py-0.5 bg-slate-700/50 rounded font-mono">&crarr;</kbd> select</span>
            <span><kbd className="px-1 py-0.5 bg-slate-700/50 rounded font-mono">esc</kbd> close</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;

import { useState, useCallback } from 'react';
import {
  Search,
  Sparkles,
  Code,
  History,
  ArrowRight,
  Box,
  Layers,
  Hash,
  FileCode,
  Loader2,
} from 'lucide-react';
import { useSearchStore, useUIStore, type SearchResult } from '../../store';
import {
  searchNatural,
  searchSemantic,
  searchExact,
} from '../../api/client';

export function SearchView() {
  const { setSelectedEntity } = useUIStore();
  const {
    query,
    setQuery,
    searchType,
    setSearchType,
    results,
    setResults,
    searchHistory,
    addToHistory,
  } = useSearchStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    addToHistory(query);

    try {
      let searchResults: SearchResult[];
      switch (searchType) {
        case 'natural':
          searchResults = await searchNatural(query);
          break;
        case 'semantic':
          searchResults = await searchSemantic(query);
          break;
        case 'exact':
          searchResults = await searchExact(query);
          break;
      }
      setResults(searchResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, searchType, addToHistory, setResults]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-700 p-6">
        <h1 className="text-xl font-semibold text-white mb-6">Search</h1>

        {/* Search Type Tabs */}
        <div className="flex gap-2 mb-4">
          <SearchTypeTab
            active={searchType === 'natural'}
            onClick={() => setSearchType('natural')}
            icon={<Sparkles className="w-4 h-4" />}
            label="Natural Language"
            description="Ask questions about your code"
          />
          <SearchTypeTab
            active={searchType === 'semantic'}
            onClick={() => setSearchType('semantic')}
            icon={<Search className="w-4 h-4" />}
            label="Semantic"
            description="Find similar code by meaning"
          />
          <SearchTypeTab
            active={searchType === 'exact'}
            onClick={() => setSearchType('exact')}
            icon={<Code className="w-4 h-4" />}
            label="Exact Match"
            description="Find by name or pattern"
          />
        </div>

        {/* Search Input */}
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                searchType === 'natural'
                  ? 'Ask a question... e.g., "What functions handle user authentication?"'
                  : searchType === 'semantic'
                    ? 'Describe what you\'re looking for... e.g., "error handling for API calls"'
                    : 'Enter a name or pattern... e.g., "handleSubmit" or "use*"'
              }
              className="w-full pl-12 pr-4 py-3 bg-slate-800 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
              autoFocus
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={!query.trim() || loading}
            className="btn btn-primary px-6 flex items-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <ArrowRight className="w-5 h-5" />
            )}
            Search
          </button>
        </div>

        {/* Quick examples */}
        {searchType === 'natural' && !query && (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-sm text-slate-500">Try:</span>
            {[
              'What are the main entry points?',
              'How is data validated?',
              'Show me error handling code',
              'What tests exist for the API?',
            ].map((example) => (
              <button
                key={example}
                onClick={() => {
                  setQuery(example);
                  handleSearch();
                }}
                className="text-sm px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded-full text-slate-300"
              >
                {example}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {error && (
          <div className="p-4 bg-red-500/10 border-b border-red-500/20">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {results.length > 0 ? (
          <div className="p-4">
            <div className="text-sm text-slate-500 mb-4">
              Found {results.length} results
            </div>
            <div className="space-y-3">
              {results.map((result, idx) => (
                <SearchResultCard
                  key={`${result.entity.id}-${idx}`}
                  result={result}
                  onClick={() => setSelectedEntity(result.entity)}
                />
              ))}
            </div>
          </div>
        ) : query && !loading ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <Search className="w-12 h-12 mb-4 opacity-50" />
            <p>No results found for "{query}"</p>
            <p className="text-sm mt-1">Try a different search term or search type</p>
          </div>
        ) : (
          <div className="p-4">
            {/* Search History */}
            {searchHistory.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-3">
                  <History className="w-4 h-4" />
                  Recent Searches
                </div>
                <div className="space-y-1">
                  {searchHistory.slice(0, 5).map((historyQuery, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setQuery(historyQuery);
                        handleSearch();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-800 rounded text-slate-400 text-sm"
                    >
                      {historyQuery}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SearchTypeTab({
  active,
  onClick,
  icon,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 p-3 rounded-lg border transition-colors ${
        active
          ? 'bg-slate-700 border-blue-500 text-white'
          : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="font-medium">{label}</span>
      </div>
      <div className="text-xs text-slate-500">{description}</div>
    </button>
  );
}

function SearchResultCard({
  result,
  onClick,
}: {
  result: SearchResult;
  onClick: () => void;
}) {
  const { entity, score, highlights } = result;

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <EntityIcon kind={entity.kind} />
          <div>
            <div className="font-medium text-white">{entity.name}</div>
            <div className="text-sm text-slate-500">{entity.filePath}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-2 py-0.5 rounded border ${
              entity.kind === 'function'
                ? 'badge-function'
                : entity.kind === 'class'
                  ? 'badge-class'
                  : entity.kind === 'interface'
                    ? 'badge-interface'
                    : 'badge-variable'
            }`}
          >
            {entity.kind}
          </span>
          <span className="text-xs text-slate-500">
            {Math.round(score * 100)}% match
          </span>
        </div>
      </div>

      {highlights && highlights.length > 0 && (
        <div className="mt-2 text-sm text-slate-400 line-clamp-2">
          {highlights[0]}
        </div>
      )}

      {entity.justification && (
        <div className="mt-2 text-sm text-slate-400 bg-slate-700/50 rounded p-2">
          {entity.justification}
        </div>
      )}
    </button>
  );
}

function EntityIcon({ kind }: { kind: string }) {
  const className = 'w-5 h-5';
  switch (kind) {
    case 'function':
      return <Box className={`${className} text-blue-400`} />;
    case 'class':
      return <Layers className={`${className} text-purple-400`} />;
    case 'interface':
      return <Hash className={`${className} text-cyan-400`} />;
    default:
      return <FileCode className={`${className} text-gray-400`} />;
  }
}

export default SearchView;

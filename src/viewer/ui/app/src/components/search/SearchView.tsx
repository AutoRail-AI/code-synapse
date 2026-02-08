import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  Search,
  ArrowUp,
  ArrowRight,
  Brain,
  Loader2,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { useSearchStore, useUIStore, type ChatTurn } from "../../store";
import {
  searchHybrid,
  type HybridSearchResult,
} from "../../api/client";
import { JustificationCard } from "./JustificationCard";
import { SmartSummary } from "./SmartSummary";
import { EntityDetailPanel } from "./EntityDetailPanel";

// =============================================================================
// Helpers
// =============================================================================

function getDirectory(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) || "/" : "/";
}

function groupByFeatureContext(
  results: HybridSearchResult[]
): Array<{ key: string; label: string; results: HybridSearchResult[] }> {
  const groups = new Map<string, HybridSearchResult[]>();

  for (const r of results) {
    const featureContext =
      r.justification?.featureContext?.trim() || null;
    const key = featureContext ?? `dir:${getDirectory(r.filePath)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  return Array.from(groups.entries()).map(([key, results]) => {
    const first = results[0]!;
    const fc = first.justification?.featureContext?.trim();
    const label = fc || getDirectory(first.filePath) || "(root)";
    return { key, label, results };
  });
}

// =============================================================================
// Welcome Screen (empty state)
// =============================================================================

function WelcomeScreen({ onSelectQuery }: { onSelectQuery: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
          <Sparkles className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Code Insight</h1>
        <p className="text-slate-400 max-w-md">
          Ask questions about your codebase. Hybrid search combines keywords with semantic understanding.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl">
        {[
          "Where is the user authentication logic?",
          "Explain the data processing pipeline",
          "Find error handling patterns",
          "Show database schema definitions",
        ].map((example) => (
          <button
            key={example}
            onClick={() => onSelectQuery(example)}
            className="text-left px-4 py-3 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/30 hover:border-primary/40 rounded-xl text-sm text-slate-400 hover:text-slate-200 transition-all group"
          >
            <div className="flex items-center justify-between gap-2">
              <span>{example}</span>
              <ArrowRight className="w-4 h-4 flex-shrink-0 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-primary" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// User Message Bubble
// =============================================================================

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-6">
      <div className="max-w-[85%] bg-primary/15 border border-primary/25 rounded-2xl rounded-br-sm px-4 py-3">
        <p className="text-sm text-slate-100">{text}</p>
      </div>
    </div>
  );
}

// =============================================================================
// Assistant Message (AI response with summary + results)
// =============================================================================

const INITIAL_VISIBLE = 3;

function AssistantMessage({
  turn,
  turnIndex,
  isLatest,
  onFileClick,
  onEntityClick,
}: {
  turn: ChatTurn;
  turnIndex: number;
  isLatest: boolean;
  onFileClick: (path: string) => void;
  onEntityClick: (r: HybridSearchResult) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const visibleResults = showAll
    ? turn.results
    : turn.results.slice(0, INITIAL_VISIBLE);

  const grouped = useMemo(
    () => (visibleResults.length > 0 ? groupByFeatureContext(visibleResults) : []),
    [visibleResults]
  );

  // Loading state
  if (turn.isLoading) {
    return (
      <div className="mb-6 flex items-center gap-3 py-4">
        <div className="flex space-x-1">
          <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
        <span className="text-sm text-slate-500">Analyzing codebase...</span>
      </div>
    );
  }

  // Error state
  if (turn.error) {
    return (
      <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
        <p className="text-red-400 text-sm">{turn.error}</p>
      </div>
    );
  }

  // Empty results
  if (!turn.summary?.answer && turn.results.length === 0) {
    return (
      <div className="mb-6 py-3 text-sm text-slate-500">
        No results found. Try rephrasing your query or enabling Deep Search for LLM synthesis.
      </div>
    );
  }

  return (
    <div className="mb-6 space-y-4">
      {/* Smart Summary */}
      {turn.summary?.answer && (
        <div className="bg-slate-800/40 border border-slate-700/40 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3 text-primary text-xs font-medium uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Insight</span>
          </div>
          <SmartSummary
            answer={turn.summary.answer}
            citations={turn.summary.citations}
            modelUsed={turn.summary.modelUsed}
            typewriter={isLatest}
            resultIdPrefix={String(turnIndex)}
          />
        </div>
      )}

      {/* Results */}
      {turn.results.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs text-slate-500 px-1">
            Found {turn.results.length} relevant items
          </div>
          {grouped.map(({ key, label, results: groupResults }) => (
            <div key={key} className="space-y-2">
              <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5 px-1">
                <Brain className="w-3 h-3" />
                {label}
              </div>
              <div className="space-y-2">
                {groupResults.map((r, idx) => {
                  const globalIdx = turn.results.indexOf(r);
                  return (
                    <JustificationCard
                      key={`${r.filePath}-${r.lineNumber ?? 0}-${idx}`}
                      result={{
                        filePath: r.filePath,
                        lineNumber: r.lineNumber,
                        snippet: r.snippet,
                        name: r.name,
                        entityId: r.entityId,
                        entityType: r.entityType,
                        source: r.source,
                        score: r.score,
                        justification: r.justification,
                        patterns: r.patterns,
                        businessValue: r.justification?.businessValue,
                        popularity: r.popularity,
                        relatedCode: r.relatedCode,
                      }}
                      index={globalIdx}
                      idPrefix={String(turnIndex)}
                      onClick={() => r.entityId ? onEntityClick(r) : onFileClick(r.filePath)}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {!showAll && turn.results.length > INITIAL_VISIBLE && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs text-primary hover:text-primary/80 transition-colors px-1 py-1"
            >
              Show all {turn.results.length} results
            </button>
          )}
          {showAll && turn.results.length > INITIAL_VISIBLE && (
            <button
              onClick={() => setShowAll(false)}
              className="text-xs text-slate-500 hover:text-slate-400 transition-colors px-1 py-1"
            >
              Show fewer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main SearchView (Chat Layout)
// =============================================================================

export function SearchView() {
  const { setSelectedFile } = useUIStore();
  const {
    query,
    setQuery,
    setSearchType,
    enableDeepSearch,
    setEnableDeepSearch,
    chatHistory,
    addChatTurn,
    updateLastTurn,
    clearChat,
    setSelectedSearchEntity,
  } = useSearchStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Force hybrid mode
  useEffect(() => {
    setSearchType("hybrid");
  }, [setSearchType]);

  const [loading, setLoading] = useState(false);

  // Auto-scroll to bottom when chat updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const handleSearch = useCallback(
    async (overrideQuery?: string) => {
      const q = (overrideQuery ?? query).trim();
      if (!q || loading) return;

      const turnId = `turn-${Date.now()}`;
      addChatTurn({
        id: turnId,
        query: q,
        results: [],
        summary: null,
        timestamp: Date.now(),
        isLoading: true,
      });

      setQuery("");
      setLoading(true);
      setTimeout(() => inputRef.current?.focus(), 0);

      try {
        const response = await searchHybrid(q, {
          enableSynthesis: enableDeepSearch,
          limit: 30,
        });
        updateLastTurn({
          results: response.results,
          summary: response.summary ?? null,
          isLoading: false,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Search failed";
        updateLastTurn({
          isLoading: false,
          error: msg,
        });
      } finally {
        setLoading(false);
      }
    },
    [query, loading, enableDeepSearch, addChatTurn, updateLastTurn, setQuery]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-900/50">
      {/* Entity Detail Panel */}
      <EntityDetailPanel />

      {/* Messages Area */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {chatHistory.length === 0 ? (
            <WelcomeScreen onSelectQuery={(q) => handleSearch(q)} />
          ) : (
            <>
              {/* New Chat button */}
              <div className="flex justify-center mb-6">
                <button
                  onClick={clearChat}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/30 rounded-lg px-3 py-1.5 transition-all"
                >
                  <RotateCcw className="w-3 h-3" />
                  New Chat
                </button>
              </div>

              {/* Chat turns */}
              {chatHistory.map((turn, i) => (
                <div key={turn.id}>
                  <UserMessage text={turn.query} />
                  <AssistantMessage
                    turn={turn}
                    turnIndex={i}
                    isLatest={i === chatHistory.length - 1}
                    onFileClick={(path) => setSelectedFile(path)}
                    onEntityClick={(r) =>
                      setSelectedSearchEntity({
                        entityId: r.entityId!,
                        entityName: r.name || r.filePath.split("/").pop() || r.filePath,
                        filePath: r.filePath,
                      })
                    }
                  />
                </div>
              ))}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Bar (Bottom) */}
      <div className="border-t border-slate-800 bg-slate-900/80 backdrop-blur-lg">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="relative group">
            <div className="absolute inset-0 bg-primary/10 blur-xl rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
            <div className="relative flex items-center bg-slate-800/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30">
              <Search className="ml-4 w-5 h-5 text-slate-500 group-focus-within:text-primary transition-colors" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your codebase..."
                className="w-full bg-transparent border-none text-sm px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-0"
                autoFocus
              />
              <div className="pr-2 flex items-center gap-1.5">
                <button
                  onClick={() => setEnableDeepSearch(!enableDeepSearch)}
                  className={`p-1.5 rounded-lg transition-all ${
                    enableDeepSearch
                      ? "bg-primary/20 text-primary hover:bg-primary/30"
                      : "text-slate-500 hover:bg-slate-700/50 hover:text-slate-300"
                  }`}
                  title={
                    enableDeepSearch
                      ? "Deep Search Enabled (LLM Synthesis)"
                      : "Enable Deep Search"
                  }
                >
                  <Brain className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleSearch()}
                  disabled={!query.trim() || loading}
                  className="p-1.5 bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white transition-all"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowUp className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

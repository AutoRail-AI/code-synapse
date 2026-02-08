/**
 * EntityDetailPanel - Slide-over panel for entity details.
 *
 * Shows code signature, justification, classification, and relationships
 * when a search result is clicked.
 *
 * @module
 */

import { useEffect, useState, useRef, useCallback } from "react";
import {
  X,
  FileCode,
  Shield,
  Tag,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { useSearchStore } from "../../store";
import { getEntityFullDetail, type EntityFullDetail } from "../../api/client";

function getEntityTypeBadge(kind: string | undefined): { label: string; classes: string } {
  switch (kind) {
    case "function":
      return { label: "function", classes: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
    case "class":
      return { label: "class", classes: "bg-purple-500/20 text-purple-400 border-purple-500/30" };
    case "interface":
      return { label: "interface", classes: "bg-green-500/20 text-green-400 border-green-500/30" };
    case "variable":
      return { label: "variable", classes: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
    default:
      return { label: kind ?? "entity", classes: "bg-slate-500/20 text-slate-400 border-slate-500/30" };
  }
}

export function EntityDetailPanel() {
  const { selectedSearchEntity, setSelectedSearchEntity } = useSearchStore();
  const [detail, setDetail] = useState<EntityFullDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setSelectedSearchEntity(null), [setSelectedSearchEntity]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [close]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        close();
      }
    };
    if (selectedSearchEntity) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [selectedSearchEntity, close]);

  // Fetch detail when entity changes
  useEffect(() => {
    if (!selectedSearchEntity) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEntityFullDetail(selectedSearchEntity.entityId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load entity details");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedSearchEntity]);

  if (!selectedSearchEntity) return null;

  const entity = detail?.entity;
  const justification = detail?.justification;
  const classification = detail?.classification;
  const typeBadge = entity ? getEntityTypeBadge(entity.kind) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative w-full max-w-lg bg-slate-900 border-l border-slate-700 shadow-2xl overflow-y-auto animate-slide-in-right"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {typeBadge && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded border ${typeBadge.classes}`}>
                    {typeBadge.label}
                  </span>
                )}
                <h2 className="text-lg font-semibold text-white truncate">
                  {selectedSearchEntity.entityName}
                </h2>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
                <FileCode className="w-3 h-3" />
                <span className="truncate">
                  {selectedSearchEntity.filePath}
                  {entity?.startLine != null ? `:${entity.startLine}` : ""}
                </span>
              </div>
            </div>
            <button
              onClick={close}
              className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <span className="ml-2 text-sm text-slate-400">Loading details...</span>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && entity && (
            <>
              {/* Code Signature */}
              {(entity.signature || entity.docstring) && (
                <section>
                  <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                    Signature
                  </h3>
                  <pre className="text-xs text-slate-300 bg-slate-800/60 rounded-lg p-3 overflow-x-auto font-mono whitespace-pre-wrap border border-slate-700/50">
                    <code>{entity.signature || entity.docstring}</code>
                  </pre>
                </section>
              )}

              {/* Parameters */}
              {entity.parameters && entity.parameters.length > 0 && (
                <section>
                  <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                    Parameters
                  </h3>
                  <div className="space-y-1">
                    {entity.parameters.map((p) => (
                      <div key={p.name} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-blue-400">{p.name}</span>
                        {p.type && (
                          <span className="font-mono text-slate-500">: {p.type}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {entity.returnType && (
                    <div className="mt-1 text-sm">
                      <span className="text-slate-500">returns</span>{" "}
                      <span className="font-mono text-green-400">{entity.returnType}</span>
                    </div>
                  )}
                </section>
              )}

              {/* Justification */}
              {justification && (
                <section>
                  <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                    Business Justification
                  </h3>
                  <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg p-3 space-y-2">
                    {justification.purposeSummary && (
                      <p className="text-sm text-slate-200">{justification.purposeSummary}</p>
                    )}
                    {justification.businessValue && (
                      <div className="text-xs text-slate-400">
                        <span className="text-slate-500">Business Value:</span> {justification.businessValue}
                      </div>
                    )}
                    {justification.featureContext && (
                      <div className="text-xs text-slate-400">
                        <span className="text-slate-500">Feature:</span> {justification.featureContext}
                      </div>
                    )}
                    {justification.confidence != null && (
                      <div className="flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-green-400" />
                        <span className="text-xs text-slate-400">
                          Confidence: {Math.round(justification.confidence * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Classification */}
              {classification && (
                <section>
                  <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                    Classification
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {classification.category && (
                      <span className={`text-xs font-medium px-2 py-1 rounded border ${
                        classification.category === "domain"
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : "bg-sky-500/15 text-sky-400 border-sky-500/30"
                      }`}>
                        {classification.category}
                      </span>
                    )}
                    {classification.subCategory && (
                      <span className="text-xs px-2 py-1 rounded bg-slate-700/60 text-slate-300 border border-slate-600">
                        {classification.subCategory}
                      </span>
                    )}
                  </div>
                </section>
              )}

              {/* Relationships */}
              {entity.relationships && entity.relationships.length > 0 && (
                <section>
                  <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                    Relationships
                  </h3>
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {entity.relationships.map((rel, idx) => (
                      <div
                        key={`${rel.type}-${rel.target}-${idx}`}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Tag className="w-3 h-3 text-slate-500 flex-shrink-0" />
                        <span className="text-slate-500">{rel.type}</span>
                        <ArrowRight className="w-3 h-3 text-slate-600" />
                        <span className="font-mono text-slate-300 truncate">{rel.target}</span>
                        <span className="text-xs text-slate-600">({rel.targetKind})</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

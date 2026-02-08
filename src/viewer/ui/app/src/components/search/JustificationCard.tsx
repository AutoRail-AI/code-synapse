/**
 * JustificationCard - Phase 5 Insight View
 *
 * Displays a single search result with confidence badge and design patterns.
 * Uses glassmorphism for high-confidence items and pulse animation when > 90%.
 *
 * @module
 */

import { Shield, Flame, GitGraph, ArrowRight } from "lucide-react";

export interface JustificationCardResult {
  filePath: string;
  lineNumber?: number;
  snippet?: string;
  name?: string;
  entityId?: string;
  entityType?: string;
  source?: "semantic" | "lexical";
  score?: number;
  justification?: {
    purposeSummary?: string;
    featureContext?: string;
    businessValue?: string;
    confidence?: number;
  };
  patterns?: string[];
  businessValue?: string;
  popularity?: number;
  relatedCode?: Array<{ name: string; filePath: string; relation: "caller" }>;
}

interface JustificationCardProps {
  result: JustificationCardResult;
  index: number;
  onClick?: () => void;
  /** ID prefix for scroll targeting (to disambiguate across chat turns). */
  idPrefix?: string;
}

function getConfidenceLevel(confidence: number | undefined): "high" | "medium" | "low" | "none" {
  if (confidence == null) return "none";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

function getConfidenceColor(level: "high" | "medium" | "low" | "none"): string {
  switch (level) {
    case "high":
      return "text-green-400";
    case "medium":
      return "text-yellow-400";
    case "low":
      return "text-orange-400";
    default:
      return "text-slate-500";
  }
}

function getConfidenceBgColor(level: "high" | "medium" | "low" | "none"): string {
  switch (level) {
    case "high":
      return "bg-green-500";
    case "medium":
      return "bg-yellow-500";
    case "low":
      return "bg-orange-500";
    default:
      return "bg-slate-500";
  }
}

function getEntityTypeBadge(entityType: string | undefined): { label: string; classes: string } | null {
  switch (entityType) {
    case "function":
      return { label: "fn", classes: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
    case "class":
      return { label: "class", classes: "bg-purple-500/20 text-purple-400 border-purple-500/30" };
    case "interface":
      return { label: "iface", classes: "bg-green-500/20 text-green-400 border-green-500/30" };
    default:
      return null;
  }
}

export function JustificationCard({ result, index, onClick, idPrefix }: JustificationCardProps) {
  const confidence = result.justification?.confidence;
  const level = getConfidenceLevel(confidence);
  const confidencePct =
    confidence != null ? Math.round(confidence * 100) : null;
  const isHighConfidence = level === "high";
  const shouldPulse = confidence != null && confidence > 0.9;
  const typeBadge = getEntityTypeBadge(result.entityType);

  const baseCardClasses =
    "w-full text-left p-4 rounded-lg border transition-colors";
  const glassClasses = isHighConfidence
    ? "bg-white/10 backdrop-blur-md border-white/20 hover:bg-white/15"
    : "bg-slate-800 border-slate-700 hover:bg-slate-700";

  const prefix = idPrefix ? `${idPrefix}-` : "";

  return (
    <div
      id={`search-result-${prefix}${index}`}
      className="scroll-mt-4"
    >
      <button
        onClick={onClick}
        className={`${baseCardClasses} ${glassClasses}`}
      >
        {/* Header: entity name with type badge */}
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded bg-slate-700 text-xs font-mono text-slate-300">
              [{index + 1}]
            </span>
            {typeBadge && (
              <span className={`flex-shrink-0 text-xs font-medium px-1.5 py-0.5 rounded border ${typeBadge.classes}`}>
                {typeBadge.label}
              </span>
            )}
            <span className="text-sm font-medium text-white truncate">
              {result.name || result.filePath.split("/").pop() || result.filePath}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Business Value Badge (Gold/Purple) */}
            {result.businessValue && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                {result.businessValue}
              </span>
            )}

            {/* Popularity (Flame) */}
            {result.popularity !== undefined && result.popularity > 0 && (
              <div
                className="flex items-center gap-1 text-rose-400"
                title={`Referenced by ${result.popularity} other files`}
              >
                <Flame className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">{result.popularity}</span>
              </div>
            )}

            {/* Confidence badge */}
            {confidencePct != null && (
              <div
                className={`flex items-center gap-1.5 ${getConfidenceColor(level)}`}
                title={`Confidence: ${confidencePct}%`}
              >
                <Shield className="w-4 h-4" />
                <span className="text-xs font-medium">{confidencePct}%</span>
              </div>
            )}
          </div>
        </div>

        {/* File path as subtitle */}
        <div className="font-mono text-xs text-slate-500 mb-1.5 pl-8 truncate">
          {result.filePath}
          {result.lineNumber != null ? `:${result.lineNumber}` : ""}
        </div>

        {/* Purpose summary */}
        {result.justification?.purposeSummary && (
          <div className="text-sm text-slate-400 mb-1.5 pl-8">
            {result.justification.purposeSummary}
          </div>
        )}

        {/* Confidence bar with optional pulse */}
        {confidencePct != null && (
          <div className="mb-2">
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${getConfidenceBgColor(level)} transition-all duration-300 ${shouldPulse ? "animate-pulse" : ""
                  }`}
                style={{ width: `${confidencePct}%` }}
              />
            </div>
          </div>
        )}

        {/* Design patterns */}
        {result.patterns && result.patterns.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {result.patterns.map((p) => (
              <span
                key={p}
                className="text-xs px-2 py-0.5 rounded bg-slate-700/80 text-slate-300 border border-slate-600"
              >
                [{p}]
              </span>
            ))}
          </div>
        )}

        {/* Code snippet */}
        {result.snippet && (
          <pre className="text-xs text-slate-400 bg-slate-900/60 rounded p-2 overflow-x-auto font-mono whitespace-pre-wrap border border-slate-700/50 mb-2">
            <code>{result.snippet}</code>
          </pre>
        )}

        {/* Related Code (Used By) */}
        {result.relatedCode && result.relatedCode.length > 0 && (
          <div className="pt-2 border-t border-slate-700/50 mt-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
              <GitGraph className="w-3 h-3" />
              <span>Used by:</span>
            </div>
            <div className="flex flex-col gap-1">
              {result.relatedCode.map((caller, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-primary transition-colors truncate"
                  title={`${caller.name} in ${caller.filePath}`}
                >
                  <ArrowRight className="w-3 h-3 text-slate-600" />
                  <span className="font-mono text-slate-300">{caller.name}</span>
                  <span className="text-slate-600 truncate">in {caller.filePath.split("/").pop()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </button>
    </div>
  );
}

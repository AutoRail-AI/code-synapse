/**
 * API Client
 *
 * Exports the Code-Synapse API client and types.
 */

export { CodeSynapseClient, createClient } from "./client.js";
export type {
  ApiClientConfig,
  OverviewStats,
  FunctionInfo,
  ClassificationStats,
  Classification,
  JustificationStats,
  Justification,
  LedgerStats,
  LedgerEntry,
  LedgerAggregations,
  AdaptiveStats,
  HotColdEntity,
  MemoryRule,
  ComplexityDistribution,
} from "./client.js";

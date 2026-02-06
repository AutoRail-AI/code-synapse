/**
 * Search module - Zoekt lexical (Phase 2) + Hybrid search (Phase 3)
 */

export {
  ZoektManager,
  ZOEKT_REINDEX_DEBOUNCE_MS,
  type ZoektManagerOptions,
  type ZoektSearchOptions,
  type ZoektSearchResult,
  type ZoektFileMatch,
} from "./zoekt-manager.js";

export {
  HybridSearchService,
  type HybridSearchResult,
  type HybridSearchOptions,
  type HybridSearchSource,
  type HybridJustificationSnippet,
} from "./hybrid-service.js";

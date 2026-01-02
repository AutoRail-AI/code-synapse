/**
 * Natural Language Search Module
 *
 * Enables natural language queries for searching indexed code.
 *
 * @module
 */

// Types
export type {
  SearchIntent,
  IntentClassification,
  QueryTokens,
  QueryPattern,
  NLSearchResult,
  NLSearchResponse,
  NLSearchConfig,
} from "./types.js";

export { DEFAULT_NL_SEARCH_CONFIG, STOPWORDS, INTENT_PATTERNS } from "./types.js";

// Intent Classifier
export { IntentClassifier, createIntentClassifier } from "./intent-classifier.js";

// Query Builder
export { QueryBuilder, createQueryBuilder, type GeneratedQuery } from "./query-builder.js";

// Main Service
export {
  NaturalLanguageSearchService,
  createNLSearchService,
  createNLSearchServiceWithLLM,
} from "./nl-search-service.js";

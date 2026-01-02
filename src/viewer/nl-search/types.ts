/**
 * Natural Language Search Types
 *
 * Types for the natural language search system.
 *
 * @module
 */

// =============================================================================
// Search Intent Types
// =============================================================================

/**
 * Classification of user query intent
 */
export type SearchIntent =
  | "find_function" // "function authenticate", "the main function"
  | "find_class" // "class UserService"
  | "find_file" // "find utils file"
  | "find_location" // "where is X implemented"
  | "show_callers" // "what calls X"
  | "show_callees" // "what does X call"
  | "show_imports" // "what does X import"
  | "show_importers" // "files that import X"
  | "show_hierarchy" // "classes that extend X", "what implements X"
  | "show_methods" // "methods of X"
  | "explain" // "how does X work"
  | "rank_complexity" // "most complex functions"
  | "rank_calls" // "most called functions"
  | "rank_size" // "largest files"
  | "filter_scope" // "functions in src/core/"
  | "find_dependencies" // "external dependencies", "what uses lodash"
  | "semantic_search" // "functions like authentication"
  | "unknown"; // Fallback

/**
 * Result of intent classification
 */
export interface IntentClassification {
  intent: SearchIntent;
  confidence: number;
  keywords: string[];
  targetEntity?: string; // e.g., "authenticate" in "what calls authenticate"
  scope?: string; // e.g., "src/core/" in "functions in src/core/"
  entityType?: "function" | "class" | "interface" | "file" | "all";
}

// =============================================================================
// Query Processing Types
// =============================================================================

/**
 * Extracted tokens from user query
 */
export interface QueryTokens {
  original: string;
  normalized: string;
  keywords: string[];
  stopwords: string[];
  patterns: QueryPattern[];
}

/**
 * Recognized pattern in query
 */
export interface QueryPattern {
  type: "verb_noun" | "question" | "location" | "comparison" | "ranking";
  value: string;
  position: number;
}

// =============================================================================
// Search Result Types
// =============================================================================

/**
 * Natural language search result
 */
export interface NLSearchResult {
  entityType: "function" | "class" | "interface" | "file" | "relationship";
  id: string;
  name: string;
  filePath: string;
  line?: number;
  relevanceScore: number;
  matchType: "exact" | "partial" | "semantic";
  context?: string; // Additional context like signature, extends, etc.
}

/**
 * Search response with metadata
 */
export interface NLSearchResponse {
  query: string;
  intent: IntentClassification;
  results: NLSearchResult[];
  totalCount: number;
  executionTimeMs: number;
  suggestion?: string; // "Did you mean..." or refinement suggestion
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for natural language search
 */
export interface NLSearchConfig {
  maxResults?: number;
  minRelevanceScore?: number;
  enableSemanticSearch?: boolean;
  llmModelPreset?: "fastest" | "minimal" | "balanced" | "quality" | "maximum";
  synonyms?: Record<string, string[]>;
}

/**
 * Default configuration
 */
export const DEFAULT_NL_SEARCH_CONFIG: Required<NLSearchConfig> = {
  maxResults: 50,
  minRelevanceScore: 0.3,
  enableSemanticSearch: false, // Disabled until embeddings are implemented
  llmModelPreset: "fastest", // Use fastest model for quick responses
  synonyms: {
    auth: ["authentication", "authenticate", "login", "signin", "credential"],
    db: ["database", "sql", "query", "connection"],
    api: ["endpoint", "route", "handler", "controller"],
    config: ["configuration", "settings", "options", "preferences"],
    util: ["utility", "helper", "utils", "helpers"],
    err: ["error", "exception", "failure", "catch"],
    req: ["request", "http", "fetch", "call"],
    res: ["response", "reply", "result", "output"],
  },
};

// =============================================================================
// Stopwords
// =============================================================================

/**
 * Common stopwords to filter from queries
 */
export const STOPWORDS = new Set([
  // Articles
  "a",
  "an",
  "the",
  // Prepositions
  "in",
  "of",
  "for",
  "to",
  "from",
  "with",
  "by",
  "at",
  "on",
  // Conjunctions
  "and",
  "or",
  "but",
  // Common verbs (context-dependent)
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "can",
  // Pronouns
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "it",
  "its",
  "they",
  "them",
  "their",
  // Other common words
  "this",
  "that",
  "these",
  "those",
  "there",
  "here",
  "all",
  "any",
  "some",
  "no",
  "not",
  "only",
  "just",
  "also",
  "very",
  "too",
]);

// =============================================================================
// Intent Patterns
// =============================================================================

/**
 * Patterns for intent classification
 */
export const INTENT_PATTERNS: Array<{
  pattern: RegExp;
  intent: SearchIntent;
  extractTarget?: (match: RegExpMatchArray) => string | undefined;
}> = [
  // Caller/Callee patterns
  {
    pattern: /what\s+calls?\s+(.+)/i,
    intent: "show_callers",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /who\s+calls?\s+(.+)/i,
    intent: "show_callers",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /callers?\s+of\s+(.+)/i,
    intent: "show_callers",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /what\s+does\s+(.+)\s+call/i,
    intent: "show_callees",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /(.+)\s+calls?\s+what/i,
    intent: "show_callees",
    extractTarget: (m) => m[1]?.trim(),
  },

  // Import patterns
  {
    pattern: /files?\s+that\s+imports?\s+(.+)/i,
    intent: "show_importers",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /what\s+imports?\s+(.+)/i,
    intent: "show_importers",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /what\s+does\s+(.+)\s+import/i,
    intent: "show_imports",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /imports?\s+of\s+(.+)/i,
    intent: "show_imports",
    extractTarget: (m) => m[1]?.trim(),
  },

  // Hierarchy patterns
  {
    pattern: /class(?:es)?\s+that\s+extends?\s+(.+)/i,
    intent: "show_hierarchy",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /what\s+extends?\s+(.+)/i,
    intent: "show_hierarchy",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /what\s+implements?\s+(.+)/i,
    intent: "show_hierarchy",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /implementations?\s+of\s+(.+)/i,
    intent: "show_hierarchy",
    extractTarget: (m) => m[1]?.trim(),
  },

  // Methods pattern
  {
    pattern: /methods?\s+of\s+(.+)/i,
    intent: "show_methods",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /(.+)\s+methods?/i,
    intent: "show_methods",
    extractTarget: (m) => m[1]?.trim(),
  },

  // Location patterns
  {
    pattern: /where\s+is\s+(.+)\s+implemented/i,
    intent: "find_location",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /where\s+is\s+(.+)/i,
    intent: "find_location",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /find\s+(.+)/i,
    intent: "find_location",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /locate\s+(.+)/i,
    intent: "find_location",
    extractTarget: (m) => m[1]?.trim(),
  },

  // Explain patterns
  {
    pattern: /how\s+does\s+(.+)\s+work/i,
    intent: "explain",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /explain\s+(.+)/i,
    intent: "explain",
    extractTarget: (m) => m[1]?.trim(),
  },

  // Ranking patterns
  {
    pattern: /most\s+complex/i,
    intent: "rank_complexity",
  },
  {
    pattern: /highest?\s+complexity/i,
    intent: "rank_complexity",
  },
  {
    pattern: /complexity\s+over\s+(\d+)/i,
    intent: "rank_complexity",
    extractTarget: (m) => m[1],
  },
  {
    pattern: /most\s+called/i,
    intent: "rank_calls",
  },
  {
    pattern: /frequently\s+called/i,
    intent: "rank_calls",
  },
  {
    pattern: /largest\s+files?/i,
    intent: "rank_size",
  },
  {
    pattern: /biggest\s+files?/i,
    intent: "rank_size",
  },

  // Scope patterns
  {
    pattern: /functions?\s+in\s+(.+)/i,
    intent: "filter_scope",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /class(?:es)?\s+in\s+(.+)/i,
    intent: "filter_scope",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /exported\s+from\s+(.+)/i,
    intent: "filter_scope",
    extractTarget: (m) => m[1]?.trim(),
  },

  // Dependency patterns
  {
    pattern: /external\s+dependenc/i,
    intent: "find_dependencies",
  },
  {
    pattern: /what\s+uses?\s+(.+)/i,
    intent: "find_dependencies",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /dependenc(?:y|ies)\s+of\s+(.+)/i,
    intent: "find_dependencies",
    extractTarget: (m) => m[1]?.trim(),
  },

  // Semantic patterns
  {
    pattern: /functions?\s+like\s+(.+)/i,
    intent: "semantic_search",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /similar\s+to\s+(.+)/i,
    intent: "semantic_search",
    extractTarget: (m) => m[1]?.trim(),
  },

  // Entity type patterns
  {
    pattern: /^function\s+(.+)/i,
    intent: "find_function",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /^class\s+(.+)/i,
    intent: "find_class",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /^interface\s+(.+)/i,
    intent: "find_class",
    extractTarget: (m) => m[1]?.trim(),
  },
  {
    pattern: /^file\s+(.+)/i,
    intent: "find_file",
    extractTarget: (m) => m[1]?.trim(),
  },
];

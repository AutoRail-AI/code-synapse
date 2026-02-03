/**
 * Intent Classifier
 *
 * Classifies user queries into search intents using pattern matching
 * and optionally LLM for complex queries.
 *
 * @module
 */

import type { IModelRouter } from "../../core/models/interfaces/IModel.js";
import {
  type SearchIntent,
  type IntentClassification,
  type QueryTokens,
  STOPWORDS,
  INTENT_PATTERNS,
  DEFAULT_NL_SEARCH_CONFIG,
} from "./types.js";

// =============================================================================
// Intent Classifier
// =============================================================================

export class IntentClassifier {
  private modelRouter?: IModelRouter;
  private synonyms: Record<string, string[]>;

  constructor(modelRouter?: IModelRouter, synonyms?: Record<string, string[]>) {
    this.modelRouter = modelRouter;
    this.synonyms = synonyms ?? DEFAULT_NL_SEARCH_CONFIG.synonyms;
  }

  /**
   * Classify user query intent
   */
  async classify(query: string): Promise<IntentClassification> {
    // Step 1: Tokenize the query
    const tokens = this.tokenize(query);

    // Step 2: Try pattern matching first (fast path)
    const patternMatch = this.matchPatterns(query);
    if (patternMatch && patternMatch.confidence >= 0.8) {
      return {
        ...patternMatch,
        keywords: tokens.keywords,
      };
    }

    // Step 3: Try model-based classification for complex queries (if available)
    if (this.modelRouter) {
      try {
        const modelClassification = await this.classifyWithModel(query, tokens);
        if (modelClassification.confidence >= 0.6) {
          return modelClassification;
        }
      } catch {
        // Fall through to heuristic classification
      }
    }

    // Step 4: Fallback to heuristic classification
    return this.classifyHeuristic(tokens, patternMatch);
  }

  /**
   * Tokenize query into keywords
   */
  tokenize(query: string): QueryTokens {
    const normalized = query.toLowerCase().trim();
    const words = normalized.split(/\s+/);

    const keywords: string[] = [];
    const stopwords: string[] = [];

    for (const word of words) {
      // Remove punctuation
      const clean = word.replace(/[^\w]/g, "");
      if (!clean) continue;

      if (STOPWORDS.has(clean)) {
        stopwords.push(clean);
      } else {
        keywords.push(clean);
        // Add synonyms as additional keywords
        const syns = this.findSynonyms(clean);
        for (const syn of syns) {
          if (!keywords.includes(syn)) {
            keywords.push(syn);
          }
        }
      }
    }

    return {
      original: query,
      normalized,
      keywords,
      stopwords,
      patterns: [], // Patterns detected during classification
    };
  }

  /**
   * Find synonyms for a word
   */
  private findSynonyms(word: string): string[] {
    const result: string[] = [];

    for (const [key, synonyms] of Object.entries(this.synonyms)) {
      if (key === word || synonyms.includes(word)) {
        result.push(key, ...synonyms);
      }
    }

    return result.filter((s) => s !== word);
  }

  /**
   * Match query against known patterns
   */
  private matchPatterns(query: string): IntentClassification | null {
    for (const { pattern, intent, extractTarget } of INTENT_PATTERNS) {
      const match = query.match(pattern);
      if (match) {
        const target = extractTarget ? extractTarget(match) : undefined;
        return {
          intent,
          confidence: 0.9, // High confidence for pattern match
          keywords: [],
          targetEntity: target,
          entityType: this.inferEntityType(intent, target),
        };
      }
    }
    return null;
  }

  /**
   * Classify using model router
   */
  private async classifyWithModel(
    query: string,
    tokens: QueryTokens
  ): Promise<IntentClassification> {
    if (!this.modelRouter) {
      throw new Error("Model router not available");
    }

    const prompt = `Analyze this code search query and classify the user's intent.

Query: "${query}"
Extracted keywords: ${tokens.keywords.join(", ")}

Classify into ONE of these intents:
- find_function: Looking for a specific function
- find_class: Looking for a class or interface
- find_file: Looking for a file
- find_location: Finding where something is implemented
- show_callers: Finding what calls a function
- show_callees: Finding what a function calls
- show_imports: Finding file imports
- show_importers: Finding files that import something
- show_hierarchy: Finding class inheritance
- show_methods: Finding class methods
- explain: Understanding how something works
- rank_complexity: Finding complex code
- rank_calls: Finding frequently called functions
- rank_size: Finding large files
- filter_scope: Searching within a path
- find_dependencies: Finding external dependencies
- semantic_search: Conceptual/semantic search
- unknown: Cannot determine

Respond with JSON only:
{
  "intent": "<intent>",
  "confidence": <0.0-1.0>,
  "target": "<extracted target entity or null>",
  "entityType": "<function|class|interface|file|all>"
}`;

    const response = await this.modelRouter.execute({
      prompt,
      parameters: {
        maxTokens: 150,
        temperature: 0.1,
      },
      schema: {
        type: "object",
        properties: {
          intent: { type: "string" },
          confidence: { type: "number" },
          target: { type: "string" },
          entityType: { type: "string" },
        },
        required: ["intent", "confidence"],
      },
    });

    const parsed = response.parsed as {
      intent: string;
      confidence: number;
      target?: string;
      entityType?: string;
    };

    return {
      intent: this.validateIntent(parsed.intent),
      confidence: Math.min(1.0, Math.max(0.0, parsed.confidence)),
      keywords: tokens.keywords,
      targetEntity: parsed.target || undefined,
      entityType: this.validateEntityType(parsed.entityType),
    };
  }

  /**
   * Heuristic classification based on keywords
   */
  private classifyHeuristic(
    tokens: QueryTokens,
    patternMatch: IntentClassification | null
  ): IntentClassification {
    // If we had a partial pattern match, use it
    if (patternMatch) {
      return {
        ...patternMatch,
        keywords: tokens.keywords,
        confidence: patternMatch.confidence * 0.8, // Reduce confidence
      };
    }

    // Analyze keywords for heuristic classification
    const kw = new Set(tokens.keywords);

    // Check for relationship keywords
    if (kw.has("calls") || kw.has("call") || kw.has("callers")) {
      return {
        intent: "show_callers",
        confidence: 0.6,
        keywords: tokens.keywords,
      };
    }

    if (kw.has("imports") || kw.has("import")) {
      return {
        intent: "show_imports",
        confidence: 0.6,
        keywords: tokens.keywords,
      };
    }

    if (kw.has("extends") || kw.has("implements") || kw.has("inherits")) {
      return {
        intent: "show_hierarchy",
        confidence: 0.6,
        keywords: tokens.keywords,
      };
    }

    // Check for ranking keywords
    if (kw.has("most") || kw.has("top") || kw.has("largest") || kw.has("biggest")) {
      if (kw.has("complex") || kw.has("complexity")) {
        return {
          intent: "rank_complexity",
          confidence: 0.7,
          keywords: tokens.keywords,
        };
      }
      if (kw.has("called") || kw.has("used")) {
        return {
          intent: "rank_calls",
          confidence: 0.7,
          keywords: tokens.keywords,
        };
      }
      if (kw.has("file") || kw.has("files") || kw.has("size")) {
        return {
          intent: "rank_size",
          confidence: 0.7,
          keywords: tokens.keywords,
        };
      }
    }

    // Check for entity types
    if (kw.has("function") || kw.has("functions") || kw.has("method") || kw.has("methods")) {
      return {
        intent: "find_function",
        confidence: 0.5,
        keywords: tokens.keywords,
        entityType: "function",
      };
    }

    if (kw.has("class") || kw.has("classes")) {
      return {
        intent: "find_class",
        confidence: 0.5,
        keywords: tokens.keywords,
        entityType: "class",
      };
    }

    if (kw.has("interface") || kw.has("interfaces")) {
      return {
        intent: "find_class",
        confidence: 0.5,
        keywords: tokens.keywords,
        entityType: "interface",
      };
    }

    if (kw.has("file") || kw.has("files")) {
      return {
        intent: "find_file",
        confidence: 0.5,
        keywords: tokens.keywords,
        entityType: "file",
      };
    }

    // Default: treat as location search
    return {
      intent: tokens.keywords.length > 0 ? "find_location" : "unknown",
      confidence: 0.4,
      keywords: tokens.keywords,
      entityType: "all",
    };
  }

  /**
   * Infer entity type from intent
   */
  private inferEntityType(
    intent: SearchIntent,
    _target?: string
  ): "function" | "class" | "interface" | "file" | "all" {
    switch (intent) {
      case "find_function":
      case "show_callers":
      case "show_callees":
      case "rank_complexity":
      case "rank_calls":
        return "function";
      case "find_class":
      case "show_hierarchy":
      case "show_methods":
        return "class";
      case "find_file":
      case "show_imports":
      case "show_importers":
      case "rank_size":
        return "file";
      default:
        return "all";
    }
  }

  /**
   * Validate intent string
   */
  private validateIntent(intent: string): SearchIntent {
    const validIntents: SearchIntent[] = [
      "find_function",
      "find_class",
      "find_file",
      "find_location",
      "show_callers",
      "show_callees",
      "show_imports",
      "show_importers",
      "show_hierarchy",
      "show_methods",
      "explain",
      "rank_complexity",
      "rank_calls",
      "rank_size",
      "filter_scope",
      "find_dependencies",
      "semantic_search",
      "unknown",
    ];

    return validIntents.includes(intent as SearchIntent)
      ? (intent as SearchIntent)
      : "unknown";
  }

  /**
   * Validate entity type string
   */
  private validateEntityType(
    entityType?: string
  ): "function" | "class" | "interface" | "file" | "all" | undefined {
    const valid = ["function", "class", "interface", "file", "all"];
    return entityType && valid.includes(entityType)
      ? (entityType as "function" | "class" | "interface" | "file" | "all")
      : undefined;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an intent classifier
 */
export function createIntentClassifier(
  modelRouter?: IModelRouter,
  synonyms?: Record<string, string[]>
): IntentClassifier {
  return new IntentClassifier(modelRouter, synonyms);
}

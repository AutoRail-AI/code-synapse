/**
 * MCP Server implementation
 *
 * Implements the Model Context Protocol server for AI agent communication.
 * Exposes tools and resources for querying the knowledge graph.
 *
 * @module
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as http from "node:http";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import * as path from "node:path";
import type { ProjectConfig } from "../types/index.js";
import { createIndexer, type Indexer } from "../core/index.js";
import { createStorageAdapter, type GraphDatabase } from "../core/graph/index.js";
import { createLogger } from "../utils/logger.js";
import { getConfigPath, readJson } from "../utils/index.js";
import {
  createConfiguredModelRouter,
  getDefaultModelId,
  type IModelRouter,
} from "../core/models/index.js";
import {
  createRouterLLMService,
  type ILLMService,
} from "../core/llm/index.js";
import {
  createLLMJustificationService,
  type IJustificationService,
} from "../core/justification/index.js";
import {
  createChangeLedger,
  createLedgerStorage,
  type IChangeLedger,
} from "../core/ledger/index.js";
import {
  searchCode,
  getFunction,
  getClass,
  getFileSymbols,
  getCallers,
  getCallees,
  getDependencies,
  getProjectStats,
  notifyFileChanged,
  requestReindex,
  enhancePrompt,
  createGenerationContext,
  getFunctionSemantics,
  getErrorPaths,
  getDataFlow,
  getSideEffects,
  findPatterns,
  getPattern,
  findSimilarCode,
  getEntitySource,
  getFeatureMap,
  getMigrationContext,
  analyzeBlastRadius,
  getEntityTests,
  tagEntity,
  getTaggedEntities,
  removeEntityTags,
  resolveEntityAtLocation,
  getMigrationProgress,
  getSliceDependencies,
  type GetEntitySourceInput,
  type ToolContext,
} from "./tools.js";
import {
  createMCPObserver,
  type MCPObserverService,
} from "./observer.js";
import type { IAdaptiveIndexer } from "../core/adaptive-indexer/interfaces/IAdaptiveIndexer.js";
import { createFileWatcher, type FileWatcher } from "../core/indexer/watcher.js";
import {
  getFileResource,
  listFileResources,
  getSymbolResource,
  listSymbolResources,
  getGraphResource,
  getResourceDefinitions,
} from "./resources.js";
import {
  vibeStart,
  vibeChange,
  vibeComplete,
  vibeStatus,
  VIBE_TOOL_DEFINITIONS,
} from "./vibe-coding.js";
import {
  createEmbeddingService,
  createSimilarityService,
  type IEmbeddingService,
  type ISimilarityService,
} from "../core/embeddings/index.js";
import type { IGraphStore } from "../core/interfaces/IGraphStore.js";
import {
  ZoektManager,
  ZOEKT_REINDEX_DEBOUNCE_MS,
  HybridSearchService,
} from "../core/search/index.js";

const logger = createLogger("mcp-server");

export interface ServerOptions {
  port: number;
  config: ProjectConfig;
  dataDir: string;
  /** Use HTTP transport instead of stdio */
  useHttp?: boolean;
  /** Optional existing graph store to use (avoids creating a new one) */
  existingStore?: import("../core/graph/index.js").IGraphStore;
  /** Phase 6: Optional pre-created services (avoids port conflicts when viewer + MCP run together) */
  existingEmbeddingService?: IEmbeddingService | null;
  existingZoektManager?: ZoektManager | null;
}

let indexer: Indexer | null = null;
let server: Server | null = null;
let fileWatcher: FileWatcher | null = null;
let observer: MCPObserverService | null = null;
let modelRouter: IModelRouter | null = null;
let justificationService: IJustificationService | null = null;
let changeLedger: IChangeLedger | null = null;
let embeddingService: IEmbeddingService | null = null;
let similarityService: ISimilarityService | null = null;
let zoektManager: ZoektManager | null = null;
let zoektReindexTimer: ReturnType<typeof setTimeout> | null = null;
let hybridSearchService: HybridSearchService | null = null;
let llmService: ILLMService | null = null;
let httpServer: http.Server | null = null;
let httpTransport: StreamableHTTPServerTransport | null = null;

/**
 * Extended config that includes LLM settings
 */
interface CodeSynapseConfig extends ProjectConfig {
  llmModel?: string;
  skipLlm?: boolean;
  modelProvider?: "local" | "openai" | "anthropic" | "google";
  apiKeys?: {
    anthropic?: string;
    openai?: string;
    google?: string;
  };
}

/**
 * Tool definitions for MCP
 * Exported for testing purposes.
 */
export const TOOL_DEFINITIONS = [
  {
    name: "search_code",
    description:
      "Search for code entities (functions, classes, interfaces, variables, files) by name or pattern. Returns enriched results with entity type, business justification, design patterns, and classification when available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query string",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
        },
        entityType: {
          type: "string",
          enum: ["function", "class", "interface", "variable", "file"],
          description: "Filter by entity type",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_function",
    description:
      "Get detailed information about a function including its callers, callees, signature, and documentation",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Function name to find",
        },
        filePath: {
          type: "string",
          description: "Optional file path to narrow search",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_class",
    description:
      "Get detailed information about a class including its methods, inheritance, and documentation",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Class name to find",
        },
        filePath: {
          type: "string",
          description: "Optional file path to narrow search",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_file_symbols",
    description: "Get all symbols (functions, classes, interfaces, variables) defined in a file",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "File path (relative or absolute)",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "get_callers",
    description: "Get all functions that call a specific function",
    inputSchema: {
      type: "object" as const,
      properties: {
        functionName: {
          type: "string",
          description: "Function name to find callers for",
        },
      },
      required: ["functionName"],
    },
  },
  {
    name: "get_callees",
    description: "Get all functions called by a specific function",
    inputSchema: {
      type: "object" as const,
      properties: {
        functionName: {
          type: "string",
          description: "Function name to find callees for",
        },
      },
      required: ["functionName"],
    },
  },
  {
    name: "get_dependencies",
    description: "Get file dependencies (imports and imported by)",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "File path to get dependencies for",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "get_project_stats",
    description: "Get project statistics (counts of files, functions, classes, interfaces, variables)",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "notify_file_changed",
    description: "Notify the knowledge graph about a file change (created, modified, deleted, renamed). Use this after code generation to trigger incremental re-indexing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Path to the changed file",
        },
        changeType: {
          type: "string",
          enum: ["created", "modified", "deleted", "renamed"],
          description: "Type of change",
        },
        previousPath: {
          type: "string",
          description: "Previous path (for renamed files)",
        },
        changeDescription: {
          type: "string",
          description: "Optional description of what changed",
        },
        aiGenerated: {
          type: "boolean",
          description: "Whether this change was AI-generated (default: true)",
        },
      },
      required: ["filePath", "changeType"],
    },
  },
  {
    name: "request_reindex",
    description: "Request re-indexing of specific files or patterns. Use this to ensure the knowledge graph is up-to-date after bulk changes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File paths or glob patterns to re-index",
        },
        reason: {
          type: "string",
          description: "Reason for re-indexing request",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "immediate"],
          description: "Priority level (default: normal)",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "enhance_prompt",
    description: "Enhance a user prompt with relevant codebase context before code generation. Returns enriched prompt with architectural context, related code, and conventions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "The user's original prompt",
        },
        targetFile: {
          type: "string",
          description: "Target file path if known",
        },
        taskType: {
          type: "string",
          enum: ["create", "modify", "refactor", "fix", "document", "test"],
          description: "Type of task being performed",
        },
        includeContext: {
          type: "boolean",
          description: "Include related code context (default: true)",
        },
        maxContextTokens: {
          type: "number",
          description: "Maximum tokens for context (default: 2000)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "create_generation_context",
    description: "Create justification and context after code generation. Records the generation in the change ledger and triggers business justification for new/modified code.",
    inputSchema: {
      type: "object" as const,
      properties: {
        originalPrompt: {
          type: "string",
          description: "The original prompt used for generation",
        },
        affectedFiles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filePath: { type: "string" },
              changeType: { type: "string", enum: ["created", "modified"] },
              summary: { type: "string" },
            },
            required: ["filePath", "changeType"],
          },
          description: "List of files affected by the generation",
        },
        sessionId: {
          type: "string",
          description: "Session ID for tracking related generations",
        },
        generationNotes: {
          type: "string",
          description: "Additional notes about the generation",
        },
      },
      required: ["originalPrompt", "affectedFiles"],
    },
  },
  // Phase 1: Enhanced Entity Semantics
  {
    name: "get_function_semantics",
    description:
      "Get detailed semantic analysis for a function including parameter purposes, return value analysis, and error handling patterns. Phase 1 analysis provides deep insight into function behavior.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Function name to analyze",
        },
        filePath: {
          type: "string",
          description: "Optional file path to narrow search",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_error_paths",
    description:
      "Get error propagation paths for a function. Shows how errors flow through the code, what's handled vs propagated, and recovery strategies.",
    inputSchema: {
      type: "object" as const,
      properties: {
        functionName: {
          type: "string",
          description: "Function name to find error paths for",
        },
        filePath: {
          type: "string",
          description: "Optional file path to narrow search",
        },
      },
      required: ["functionName"],
    },
  },
  // Phase 2: Data Flow Analysis
  {
    name: "get_data_flow",
    description:
      "Get data flow analysis for a function. Shows how data moves through the function, side effects, purity analysis, and taint tracking. Uses lazy evaluation with caching.",
    inputSchema: {
      type: "object" as const,
      properties: {
        functionName: {
          type: "string",
          description: "Function name to analyze",
        },
        filePath: {
          type: "string",
          description: "Optional file path to narrow search",
        },
        includeFullGraph: {
          type: "boolean",
          description: "Include full node/edge graph (default: false for summary only)",
        },
      },
      required: ["functionName"],
    },
  },
  // Phase 3: Side-Effect Analysis
  {
    name: "get_side_effects",
    description:
      "Get side effects analysis for a function. Shows I/O operations, mutations, async operations, and external service calls with confidence levels.",
    inputSchema: {
      type: "object" as const,
      properties: {
        functionName: {
          type: "string",
          description: "Function name to analyze",
        },
        filePath: {
          type: "string",
          description: "Optional file path to narrow search",
        },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "Filter by side effect categories (e.g., 'io-file', 'io-network', 'mutation-this')",
        },
        minConfidence: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "Minimum confidence level (default: all)",
        },
      },
      required: ["functionName"],
    },
  },
  // Phase 4: Design Pattern Detection
  {
    name: "find_patterns",
    description:
      "Find design patterns in the codebase (Factory, Singleton, Observer, Repository, Service, Builder, Strategy, Decorator). Returns patterns with participants and confidence scores.",
    inputSchema: {
      type: "object" as const,
      properties: {
        patternType: {
          type: "string",
          enum: ["factory", "singleton", "observer", "repository", "service", "adapter", "builder", "strategy", "decorator"],
          description: "Filter by pattern type (optional - all patterns if not specified)",
        },
        minConfidence: {
          type: "number",
          description: "Minimum confidence threshold 0.0-1.0 (default: 0.5)",
        },
        filePath: {
          type: "string",
          description: "Optional file path to narrow search",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_pattern",
    description:
      "Get details of a specific design pattern by ID. Returns full participant information and evidence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        patternId: {
          type: "string",
          description: "Pattern ID to retrieve",
        },
      },
      required: ["patternId"],
    },
  },
  // Phase 2: Zoekt lexical search (Hybrid Search)
  {
    name: "search_code_exact",
    description:
      "Exact or regex code search using Zoekt with entity resolution. Use for finding exact symbols, strings, or patterns in source files. Supports regex. Returns file paths and matching lines, with entity ID, name, and type attached when a known entity contains the matching line.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (literal or regex)",
        },
        filePattern: {
          type: "string",
          description: "Optional file glob pattern to restrict search",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
        },
      },
      required: ["query"],
    },
  },
  // Phase 3+4: Hybrid search (semantic + lexical) with optional LLM synthesis
  {
    name: "hybrid_search",
    description:
      "Combined semantic and lexical code search with entity-level enrichment. Returns results with business justification, design patterns, entity types, and intent classification metadata. Use for complex queries where you want both conceptual matches (embeddings) and exact/text matches (Zoekt). Optionally scope by business context. Set enableSynthesis=true to get an AI-generated answer summary. Always returns a meta block with intent, source counts, and timing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (natural language or exact phrase)",
        },
        businessContext: {
          type: "string",
          description: "Optional feature/domain to scope results (e.g. 'Payments', 'Auth')",
        },
        limit: {
          type: "number",
          description: "Maximum total results (default: 30)",
        },
        enableSynthesis: {
          type: "boolean",
          description: "If true, generate AI answer summary from top results (Phase 4). Uses local/cloud LLM based on config.",
        },
      },
      required: ["query"],
    },
  },
  // Phase 6: Semantic Similarity & Related Code Discovery
  {
    name: "find_similar_code",
    description:
      "Find semantically similar code using vector embeddings. Search by entity ID or natural language description. Returns similar functions, classes, interfaces ranked by similarity score.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityId: {
          type: "string",
          description: "Entity ID to find similar code for (use this OR text, not both)",
        },
        text: {
          type: "string",
          description: "Natural language description to search for (use this OR entityId, not both)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
        },
        minSimilarity: {
          type: "number",
          description: "Minimum similarity threshold 0.0-1.0 (default: 0.5)",
        },
        entityTypes: {
          type: "array",
          items: { type: "string", enum: ["function", "class", "interface", "method"] },
          description: "Filter by entity type",
        },
        filePathPattern: {
          type: "string",
          description: "Filter by file path pattern (regex)",
        },
      },
      required: [],
    },
  },
  // Lazarus Migration Tools
  {
    name: "get_entity_source",
    description:
      "Get the actual source code of a function, class, or interface. Returns the full source with line numbers. Essential for understanding implementation details during code migration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityId: { type: "string", description: "Entity ID from the knowledge graph" },
        name: { type: "string", description: "Entity name (if no entityId)" },
        filePath: { type: "string", description: "File path to narrow search" },
        entityType: { type: "string", enum: ["function", "class", "interface", "variable"], description: "Filter by entity type" },
        contextLines: { type: "number", description: "Extra lines above/below entity (default 0)" },
      },
      required: [],
    },
  },
  {
    name: "get_feature_map",
    description:
      "Get a map of all features/business domains in the codebase, grouped by feature context from justifications. Shows which entities belong to each feature, useful for planning migration slices.",
    inputSchema: {
      type: "object" as const,
      properties: {
        featureContext: { type: "string", description: "Filter to a specific feature name (substring match)" },
        includeEntities: { type: "boolean", description: "Include entity list per feature (default false)" },
        limit: { type: "number", description: "Max features to return (default 50)" },
      },
      required: [],
    },
  },
  {
    name: "get_migration_context",
    description:
      "Build a Code Contract for a feature slice: all entities, their business rules, internal dependencies, external dependencies, side effects, and data flow. The complete context needed to migrate a feature.",
    inputSchema: {
      type: "object" as const,
      properties: {
        featureContext: { type: "string", description: "Feature name to resolve entities by (from justification)" },
        entityIds: { type: "array", items: { type: "string" }, description: "Explicit list of entity IDs (alternative to featureContext)" },
        includeSource: { type: "boolean", description: "Include source code for each entity (default false)" },
        includeDataFlow: { type: "boolean", description: "Include data flow summaries (default false)" },
        includeSideEffects: { type: "boolean", description: "Include side effects (default false)" },
      },
      required: [],
    },
  },
  {
    name: "analyze_blast_radius",
    description:
      "Analyze the transitive impact of changing an entity. Traces callers/callees up to N hops deep via BFS to show everything that would be affected by a change.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityId: { type: "string", description: "Entity ID to analyze impact for" },
        maxDepth: { type: "number", description: "Maximum traversal depth (default 3)" },
        direction: { type: "string", enum: ["callers", "callees", "both"], description: "Traversal direction (default 'callers')" },
      },
      required: ["entityId"],
    },
  },
  {
    name: "get_entity_tests",
    description:
      "Find test files that cover a given entity by checking imports, name references, and path conventions. Returns matched test files with relevant lines and a coverage estimate.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityId: { type: "string", description: "Entity ID from the knowledge graph" },
        name: { type: "string", description: "Entity name (if no entityId)" },
        filePath: { type: "string", description: "File path to narrow search" },
      },
      required: [],
    },
  },
  {
    name: "tag_entity",
    description:
      "Add migration tags to an entity (e.g. 'legacy', 'migrating', 'migrated', 'deprecated'). Tags persist in the knowledge graph for tracking migration state.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityId: { type: "string", description: "Entity ID to tag" },
        tags: { type: "array", items: { type: "string" }, description: "Tags to add" },
        source: { type: "string", description: "Who/what added the tag (default 'user')" },
      },
      required: ["entityId", "tags"],
    },
  },
  {
    name: "get_tagged_entities",
    description:
      "Find all entities with a specific tag. Useful for tracking migration progress (e.g. find all entities tagged 'legacy' or 'migrated').",
    inputSchema: {
      type: "object" as const,
      properties: {
        tag: { type: "string", description: "Tag to search for" },
        entityType: { type: "string", enum: ["function", "class", "interface", "variable", "file"], description: "Filter by entity type" },
      },
      required: ["tag"],
    },
  },
  {
    name: "remove_entity_tags",
    description:
      "Remove specific tags from an entity.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entityId: { type: "string", description: "Entity ID to remove tags from" },
        tags: { type: "array", items: { type: "string" }, description: "Tags to remove" },
      },
      required: ["entityId", "tags"],
    },
  },
  {
    name: "resolve_entity_at_location",
    description:
      "Resolve which code entity (function, class, interface, variable) exists at a specific file path and line number. Essential for the self-healing diagnosis engine to go from test error locations to knowledge graph entities.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "File path (relative or absolute)" },
        line: { type: "number", description: "Line number to resolve" },
      },
      required: ["filePath", "line"],
    },
  },
  {
    name: "get_migration_progress",
    description:
      "Get migration progress aggregated by feature. Shows tag counts (legacy, migrating, migrated, etc.) per feature and overall, with progress percentages. Powers the Glass Brain Dashboard confidence display.",
    inputSchema: {
      type: "object" as const,
      properties: {
        featureContext: { type: "string", description: "Filter to a specific feature (substring match)" },
        tags: { type: "array", items: { type: "string" }, description: "Filter to specific tags (default: all tags)" },
      },
      required: [],
    },
  },
  {
    name: "get_slice_dependencies",
    description:
      "Compute inter-feature dependency ordering for migration slice planning. Analyzes cross-feature function calls to determine which features depend on which, and returns a topological execution order with circular dependency detection.",
    inputSchema: {
      type: "object" as const,
      properties: {
        features: { type: "array", items: { type: "string" }, description: "Filter to specific features (substring match). Omit for all features." },
      },
      required: [],
    },
  },
  // Vibe coding tools
  ...VIBE_TOOL_DEFINITIONS,
];

/**
 * Options for creating the MCP server with full service integration
 */
export interface McpServerOptions {
  graphStore: GraphDatabase;
  observer?: MCPObserverService;
  adaptiveIndexer?: IAdaptiveIndexer;
  ledger?: IChangeLedger;
  justificationService?: IJustificationService;
  indexer?: Indexer;
  embeddingService?: IEmbeddingService;
  similarityService?: ISimilarityService;
  zoektManager?: ZoektManager | null;
  hybridSearchService?: HybridSearchService | null;
}

/**
 * Create and configure the MCP server
 * Exported for testing purposes.
 */
export function createMcpServer(
  graphStoreOrOptions: GraphDatabase | McpServerOptions
): Server {
  // Handle both old signature (just graphStore) and new signature (options object)
  const options: McpServerOptions =
    "graphStore" in graphStoreOrOptions
      ? graphStoreOrOptions
      : { graphStore: graphStoreOrOptions };

  const {
    graphStore,
    observer,
    adaptiveIndexer,
    ledger,
    justificationService,
    indexer: indexerRef,
    embeddingService: embeddingSvc,
    similarityService: similaritySvc,
    zoektManager: zoektMgr,
    hybridSearchService: hybridSearchSvc,
  } = options;

  // Create tool context for dependency injection
  const toolContext: ToolContext = {
    sessionId: `mcp-${Date.now()}`,
    observer,
    adaptiveIndexer,
    justificationService,
    ledger,
    indexer: indexerRef,
    hybridSearchService: hybridSearchSvc ?? undefined,
  };
  const mcpServer = new Server(
    {
      name: "code-synapse",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // List tools handler
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug("Listing tools");
    return {
      tools: TOOL_DEFINITIONS,
    };
  });

  // Call tool handler
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.debug({ name, args }, "Calling tool");

    try {
      switch (name) {
        case "search_code": {
          const result = await searchCode(
            graphStore,
            {
              query: args?.query as string,
              limit: args?.limit as number | undefined,
              entityType: args?.entityType as
                | "function"
                | "class"
                | "interface"
                | "variable"
                | "file"
                | undefined,
            },
            toolContext
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_function": {
          const result = await getFunction(graphStore, {
            name: args?.name as string,
            filePath: args?.filePath as string | undefined,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "Function not found" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_class": {
          const result = await getClass(graphStore, {
            name: args?.name as string,
            filePath: args?.filePath as string | undefined,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "Class not found" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_file_symbols": {
          const result = await getFileSymbols(graphStore, {
            filePath: args?.filePath as string,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "File not found" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_callers": {
          const result = await getCallers(graphStore, {
            functionName: args?.functionName as string,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_callees": {
          const result = await getCallees(graphStore, {
            functionName: args?.functionName as string,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_dependencies": {
          const result = await getDependencies(graphStore, {
            filePath: args?.filePath as string,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "File not found" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_project_stats": {
          const result = await getProjectStats(graphStore);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "notify_file_changed": {
          // Track this tool call with observer
          const startTime = Date.now();
          const argsObj = (args ?? {}) as Record<string, unknown>;
          observer?.onToolCall("notify_file_changed", argsObj, toolContext.sessionId);

          const result = await notifyFileChanged(
            graphStore,
            {
              filePath: args?.filePath as string,
              changeType: args?.changeType as
                | "created"
                | "modified"
                | "deleted"
                | "renamed",
              previousPath: args?.previousPath as string | undefined,
              changeDescription: args?.changeDescription as string | undefined,
              aiGenerated: args?.aiGenerated as boolean | undefined,
            },
            toolContext
          );

          observer?.onToolResult(
            "notify_file_changed",
            argsObj,
            result,
            toolContext.sessionId,
            Date.now() - startTime
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "request_reindex": {
          const startTime = Date.now();
          const argsObj = (args ?? {}) as Record<string, unknown>;
          observer?.onToolCall("request_reindex", argsObj, toolContext.sessionId);

          const result = await requestReindex(
            graphStore,
            {
              filePaths: args?.paths as string[],
              reason: args?.reason as string | undefined,
              priority: args?.priority as
                | "low"
                | "normal"
                | "high"
                | "immediate"
                | undefined,
            },
            toolContext
          );

          observer?.onToolResult(
            "request_reindex",
            argsObj,
            result,
            toolContext.sessionId,
            Date.now() - startTime
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "enhance_prompt": {
          const startTime = Date.now();
          const argsObj = (args ?? {}) as Record<string, unknown>;
          observer?.onToolCall("enhance_prompt", argsObj, toolContext.sessionId);

          const result = await enhancePrompt(
            graphStore,
            {
              prompt: args?.prompt as string,
              targetFile: args?.targetFile as string | undefined,
              taskType: args?.taskType as
                | "create"
                | "modify"
                | "refactor"
                | "fix"
                | "document"
                | "test"
                | undefined,
              includeContext: args?.includeContext as boolean | undefined,
              maxContextTokens: args?.maxContextTokens as number | undefined,
            },
            toolContext
          );

          observer?.onToolResult(
            "enhance_prompt",
            argsObj,
            result,
            toolContext.sessionId,
            Date.now() - startTime
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "create_generation_context": {
          const startTime = Date.now();
          const argsObj = (args ?? {}) as Record<string, unknown>;
          observer?.onToolCall("create_generation_context", argsObj, toolContext.sessionId);

          const result = await createGenerationContext(
            graphStore,
            {
              originalPrompt: args?.originalPrompt as string,
              affectedFiles: args?.affectedFiles as Array<{
                filePath: string;
                changeType: "created" | "modified";
                summary?: string;
              }>,
              sessionId: args?.sessionId as string | undefined,
              generationNotes: args?.generationNotes as string | undefined,
            },
            toolContext
          );

          observer?.onToolResult(
            "create_generation_context",
            argsObj,
            result,
            toolContext.sessionId,
            Date.now() - startTime
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        // Phase 1: Enhanced Entity Semantics tools
        case "get_function_semantics": {
          const result = await getFunctionSemantics(graphStore, {
            name: args?.name as string,
            filePath: args?.filePath as string | undefined,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "Function not found or no semantic analysis available" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_error_paths": {
          const result = await getErrorPaths(graphStore, {
            functionName: args?.functionName as string,
            filePath: args?.filePath as string | undefined,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "Function not found or no error analysis available" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        // Phase 2: Data Flow Analysis tools
        case "get_data_flow": {
          const result = await getDataFlow(graphStore, {
            functionName: args?.functionName as string,
            filePath: args?.filePath as string | undefined,
            includeFullGraph: args?.includeFullGraph as boolean | undefined,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "Function not found" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        // Phase 3: Side-Effect Analysis tools
        case "get_side_effects": {
          const result = await getSideEffects(graphStore, {
            functionName: args?.functionName as string,
            filePath: args?.filePath as string | undefined,
            categories: args?.categories as string[] | undefined,
            minConfidence: args?.minConfidence as string | undefined,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "Function not found or no side effects analysis available" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        // Phase 4: Design Pattern Detection tools
        case "find_patterns": {
          const result = await findPatterns(graphStore, {
            patternType: args?.patternType as "factory" | "singleton" | "observer" | "repository" | "service" | "adapter" | "builder" | "strategy" | "decorator" | undefined,
            minConfidence: args?.minConfidence as number | undefined,
            filePath: args?.filePath as string | undefined,
            limit: args?.limit as number | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_pattern": {
          const result = await getPattern(graphStore, {
            patternId: args?.patternId as string,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "Pattern not found" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        // Phase 2: Zoekt lexical search with entity resolution
        case "search_code_exact": {
          const zoekt = zoektMgr ?? zoektManager;
          if (!zoekt?.isStarted()) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  results: [],
                  error: "Zoekt not available. Run scripts/setup-zoekt.sh and ensure the server started with Zoekt.",
                }, null, 2),
              }],
            };
          }
          const zoektResult = await zoekt.search(
            (args?.query as string) ?? "",
            {
              filePattern: args?.filePattern as string | undefined,
              maxResults: (args?.limit as number) ?? 20,
            }
          );

          // Post-process: resolve entities at matching file+line locations
          try {
            for (const fileMatch of zoektResult.results) {
              const filePath = fileMatch.fileName;
              for (const lineMatch of fileMatch.lineMatches) {
                const lineNum = lineMatch.lineNumber;
                // Find entity containing this line
                try {
                  const entityResult = await graphStore.query<{
                    entity_id: string;
                    name: string;
                    kind: string;
                  }>(
                    `?[entity_id, name, kind] :=
                      *function{id: entity_id, name, file_id, start_line, end_line},
                      *file{id: file_id, path: file_path},
                      ends_with(file_path, $filePath),
                      start_line <= $lineNum, end_line >= $lineNum,
                      kind = "function"
                    ?[entity_id, name, kind] :=
                      *class{id: entity_id, name, file_id, start_line, end_line},
                      *file{id: file_id, path: file_path},
                      ends_with(file_path, $filePath),
                      start_line <= $lineNum, end_line >= $lineNum,
                      kind = "class"
                    ?[entity_id, name, kind] :=
                      *interface{id: entity_id, name, file_id, start_line, end_line},
                      *file{id: file_id, path: file_path},
                      ends_with(file_path, $filePath),
                      start_line <= $lineNum, end_line >= $lineNum,
                      kind = "interface"
                    :limit 1`,
                    { filePath, lineNum }
                  );
                  if (entityResult.length > 0 && entityResult[0]) {
                    const entity = entityResult[0];
                    // Attach entity info to the line match
                    (lineMatch as Record<string, unknown>).entityId = entity.entity_id;
                    (lineMatch as Record<string, unknown>).entityName = entity.name;
                    (lineMatch as Record<string, unknown>).entityType = entity.kind;
                  }
                } catch {
                  // Entity resolution is best-effort — skip on error
                }
              }
            }
          } catch {
            // Entity resolution is best-effort — return raw results if batch fails
          }

          return {
            content: [{ type: "text", text: JSON.stringify(zoektResult, null, 2) }],
          };
        }

        // Phase 3+4: Hybrid search (semantic + lexical) with optional synthesis
        case "hybrid_search": {
          const hybrid = hybridSearchSvc ?? hybridSearchService;
          if (!hybrid) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  results: [],
                  error: "Hybrid search unavailable. Ensure embeddings and Zoekt are initialized (run scripts/setup-zoekt.sh for Zoekt).",
                }, null, 2),
              }],
            };
          }
          const enableSynthesis = args?.enableSynthesis === true;
          const query = (args?.query as string) ?? "";
          const options = {
            businessContext: args?.businessContext as string | undefined,
            limit: (args?.limit as number) ?? 30,
            enrichWithJustification: true,
            enableSynthesis,
          };

          // Always use searchWithSynthesis — it returns meta block in all cases
          // and only generates AI summary when enableSynthesis=true + query is a question
          const response = await hybrid.searchWithSynthesis(query, options);

          return {
            content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
          };
        }

        // Phase 6: Semantic Similarity & Related Code Discovery
        case "find_similar_code": {
          const result = await findSimilarCode(
            graphStore,
            {
              entityId: args?.entityId as string | undefined,
              text: args?.text as string | undefined,
              limit: args?.limit as number | undefined,
              minSimilarity: args?.minSimilarity as number | undefined,
              entityTypes: args?.entityTypes as Array<"function" | "class" | "interface" | "method"> | undefined,
              filePathPattern: args?.filePathPattern as string | undefined,
            },
            embeddingSvc,
            similaritySvc
          );

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        // Lazarus Migration Tools
        case "get_entity_source": {
          const result = await getEntitySource(graphStore, {
            entityId: args?.entityId as string | undefined,
            name: args?.name as string | undefined,
            filePath: args?.filePath as string | undefined,
            entityType: args?.entityType as GetEntitySourceInput["entityType"],
            contextLines: args?.contextLines as number | undefined,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "Entity not found" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_feature_map": {
          const result = await getFeatureMap(graphStore, {
            featureContext: args?.featureContext as string | undefined,
            includeEntities: args?.includeEntities as boolean | undefined,
            limit: args?.limit as number | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_migration_context": {
          const result = await getMigrationContext(graphStore, {
            featureContext: args?.featureContext as string | undefined,
            entityIds: args?.entityIds as string[] | undefined,
            includeSource: args?.includeSource as boolean | undefined,
            includeDataFlow: args?.includeDataFlow as boolean | undefined,
            includeSideEffects: args?.includeSideEffects as boolean | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "analyze_blast_radius": {
          const result = await analyzeBlastRadius(graphStore, {
            entityId: args?.entityId as string,
            maxDepth: args?.maxDepth as number | undefined,
            direction: args?.direction as "callers" | "callees" | "both" | undefined,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "Entity not found" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_entity_tests": {
          const result = await getEntityTests(graphStore, {
            entityId: args?.entityId as string | undefined,
            name: args?.name as string | undefined,
            filePath: args?.filePath as string | undefined,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "Entity not found" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "tag_entity": {
          const startTime = Date.now();
          const argsObj = (args ?? {}) as Record<string, unknown>;
          observer?.onToolCall("tag_entity", argsObj, toolContext.sessionId);

          const result = await tagEntity(graphStore, {
            entityId: args?.entityId as string,
            tags: args?.tags as string[],
            source: args?.source as string | undefined,
          });

          observer?.onToolResult(
            "tag_entity",
            argsObj,
            result,
            toolContext.sessionId,
            Date.now() - startTime
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_tagged_entities": {
          const result = await getTaggedEntities(graphStore, {
            tag: args?.tag as string,
            entityType: args?.entityType as "function" | "class" | "interface" | "variable" | "file" | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "remove_entity_tags": {
          const startTime = Date.now();
          const argsObj = (args ?? {}) as Record<string, unknown>;
          observer?.onToolCall("remove_entity_tags", argsObj, toolContext.sessionId);

          const result = await removeEntityTags(graphStore, {
            entityId: args?.entityId as string,
            tags: args?.tags as string[],
          });

          observer?.onToolResult(
            "remove_entity_tags",
            argsObj,
            result,
            toolContext.sessionId,
            Date.now() - startTime
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "resolve_entity_at_location": {
          const result = await resolveEntityAtLocation(graphStore, {
            filePath: args?.filePath as string,
            line: args?.line as number,
          });
          if (!result) {
            return {
              content: [{ type: "text", text: "No entity found at the specified location" }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_migration_progress": {
          const result = await getMigrationProgress(graphStore, {
            featureContext: args?.featureContext as string | undefined,
            tags: args?.tags as string[] | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_slice_dependencies": {
          const result = await getSliceDependencies(graphStore, {
            features: args?.features as string[] | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        // Vibe coding tools
        case "vibe_start": {
          const startTime = Date.now();
          const argsObj = (args ?? {}) as Record<string, unknown>;
          observer?.onToolCall("vibe_start", argsObj, toolContext.sessionId);

          const result = await vibeStart(
            graphStore as unknown as import("../core/interfaces/IGraphStore.js").IGraphStore,
            toolContext.justificationService ?? null,
            toolContext.ledger ?? null,
            {
              intent: args?.intent as string,
              targetFiles: args?.targetFiles as string[] | undefined,
              relatedConcepts: args?.relatedConcepts as string[] | undefined,
              maxContextItems: args?.maxContextItems as number | undefined,
            }
          );

          observer?.onToolResult(
            "vibe_start",
            argsObj,
            result,
            toolContext.sessionId,
            Date.now() - startTime
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "vibe_change": {
          const startTime = Date.now();
          const argsObj = (args ?? {}) as Record<string, unknown>;
          observer?.onToolCall("vibe_change", argsObj, toolContext.sessionId);

          const result = await vibeChange(
            graphStore as unknown as import("../core/interfaces/IGraphStore.js").IGraphStore,
            toolContext.justificationService ?? null,
            toolContext.ledger ?? null,
            toolContext.indexer ?? null,
            {
              sessionId: args?.sessionId as string | undefined,
              filePath: args?.filePath as string,
              changeType: args?.changeType as "created" | "modified" | "deleted" | "renamed",
              description: args?.description as string,
              previousPath: args?.previousPath as string | undefined,
            }
          );

          observer?.onToolResult(
            "vibe_change",
            argsObj,
            result,
            toolContext.sessionId,
            Date.now() - startTime
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "vibe_complete": {
          const startTime = Date.now();
          const argsObj = (args ?? {}) as Record<string, unknown>;
          observer?.onToolCall("vibe_complete", argsObj, toolContext.sessionId);

          const result = await vibeComplete(
            toolContext.ledger ?? null,
            {
              sessionId: args?.sessionId as string,
              summary: args?.summary as string | undefined,
            }
          );

          observer?.onToolResult(
            "vibe_complete",
            argsObj,
            result,
            toolContext.sessionId,
            Date.now() - startTime
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "vibe_status": {
          const startTime = Date.now();
          const argsObj = (args ?? {}) as Record<string, unknown>;
          observer?.onToolCall("vibe_status", argsObj, toolContext.sessionId);

          const result = await vibeStatus({
            sessionId: args?.sessionId as string,
          });

          observer?.onToolResult(
            "vibe_status",
            argsObj,
            result,
            toolContext.sessionId,
            Date.now() - startTime
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      logger.error({ error, name }, "Tool call failed");
      throw new McpError(
        ErrorCode.InternalError,
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  });

  // List resources handler
  mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
    logger.debug("Listing resources");
    const definitions = getResourceDefinitions();
    return {
      resources: definitions.map((def) => ({
        uri: def.uri,
        name: def.name,
        description: def.description,
        mimeType: def.mimeType,
      })),
    };
  });

  // Read resource handler
  mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    logger.debug({ uri }, "Reading resource");

    try {
      // Parse URI to determine resource type
      if (uri === "graph://") {
        const result = await getGraphResource(graphStore);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      if (uri === "file://" || uri.startsWith("file://")) {
        const path = uri.replace("file://", "");
        if (!path) {
          // List all files
          const result = await listFileResources(graphStore);
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } else {
          // Get specific file
          const result = await getFileResource(graphStore, path);
          if (!result) {
            throw new McpError(ErrorCode.InvalidRequest, `File not found: ${path}`);
          }
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }
      }

      if (uri === "symbols://" || uri.startsWith("symbols://")) {
        const idOrQuery = uri.replace("symbols://", "");
        if (!idOrQuery) {
          // List all symbols
          const result = await listSymbolResources(graphStore);
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } else if (idOrQuery.startsWith("?")) {
          // Query symbols by type
          const params = new URLSearchParams(idOrQuery);
          const type = params.get("type") as
            | "function"
            | "class"
            | "interface"
            | "variable"
            | undefined;
          const result = await listSymbolResources(graphStore, type);
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } else {
          // Get specific symbol by ID
          const result = await getSymbolResource(graphStore, idOrQuery);
          if (!result) {
            throw new McpError(ErrorCode.InvalidRequest, `Symbol not found: ${idOrQuery}`);
          }
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }
      }

      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource URI: ${uri}`);
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      logger.error({ error, uri }, "Resource read failed");
      throw new McpError(
        ErrorCode.InternalError,
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  });

  return mcpServer;
}

/**
 * Start the MCP server
 */
export async function startServer(options: ServerOptions): Promise<void> {
  const { config, dataDir, existingStore, existingEmbeddingService, existingZoektManager } = options;

  logger.info({ dataDir }, "Starting MCP server");

  // Initialize the indexer, optionally with an existing store to share connections
  indexer = createIndexer({
    config,
    dataDir,
    existingStore,
  });

  await indexer.initialize();

  // Get the graph database from the indexer
  const graphStore = indexer.getGraphDatabase();

  // Initialize the MCP observer for tracking queries and changes
  observer = createMCPObserver();
  logger.debug("MCP observer initialized");

  // Load extended config to get LLM settings
  const configPath = getConfigPath(config.root);
  const extendedConfig = readJson<CodeSynapseConfig>(configPath);
  const skipLlm = extendedConfig?.skipLlm ?? false;
  const modelProvider = extendedConfig?.modelProvider ?? "local";
  const modelId = extendedConfig?.llmModel ?? getDefaultModelId(modelProvider);

  // Get API key from config if available
  const apiKey = extendedConfig?.apiKeys?.[modelProvider as keyof typeof extendedConfig.apiKeys];

  // Initialize Model Router if enabled
  if (!skipLlm) {
    try {
      logger.info({ modelId, provider: modelProvider }, "Initializing model router");

      // Use clean public API - handles API key injection and provider setup
      const result = await createConfiguredModelRouter({
        provider: modelProvider,
        apiKey,
        modelId,
      });

      modelRouter = result.router;

      logger.info({ modelId: result.modelId, provider: result.provider }, "Model router initialized");

      // Phase 4: LLM Service for Hybrid Search synthesis (works for local + API)
      llmService = createRouterLLMService(modelRouter, {
        modelId: result.modelId,
      });
      await llmService.initialize();
      logger.debug("Router LLM service initialized for hybrid search synthesis");
    } catch (err) {
      logger.warn(
        { error: err, modelId },
        "Failed to initialize model router - justifications will use code analysis only"
      );
    }
  } else {
    logger.info("LLM service disabled by configuration");
  }

  // Initialize justification service
  // This works with or without LLM - falls back to code analysis
  justificationService = createLLMJustificationService(
    graphStore as unknown as import("../core/interfaces/IGraphStore.js").IGraphStore,
    modelRouter ?? undefined
  );
  await justificationService.initialize();
  logger.info("Justification service initialized");

  // Set justification service on indexer for incremental justification
  indexer.setJustificationService(justificationService);
  logger.debug("Justification service attached to indexer");

  // Initialize change ledger (non-fatal - system works without it)
  try {
    const ledgerAdapter = createStorageAdapter(graphStore);
    const ledgerStorage = createLedgerStorage(ledgerAdapter);
    changeLedger = createChangeLedger(ledgerStorage, {
      memoryCacheSize: 10000,
      persistToDisk: true,
      maxBatchSize: 100,
      flushIntervalMs: 5000,
      retentionDays: 30,
      enableSubscriptions: true,
    });
    await changeLedger.initialize();
    logger.info("Change ledger initialized");
  } catch (ledgerError) {
    logger.warn(
      { error: ledgerError },
      "Failed to initialize change ledger - system will operate without history tracking"
    );
    changeLedger = null;
  }

  // Initialize embedding and similarity services (non-fatal - semantic search optional)
  if (existingEmbeddingService) {
    embeddingService = existingEmbeddingService;
    similarityService = createSimilarityService(
      graphStore as unknown as import("../core/interfaces/IGraphStore.js").IGraphStore,
      embeddingService
    );
    await similarityService.initialize();
    logger.info("Embedding/similarity services reused (shared with viewer)");
  } else {
    try {
      embeddingService = createEmbeddingService();
      await embeddingService.initialize();
      logger.info({ modelId: embeddingService.getModelId() }, "Embedding service initialized");

      similarityService = createSimilarityService(
        graphStore as unknown as import("../core/interfaces/IGraphStore.js").IGraphStore,
        embeddingService
      );
      await similarityService.initialize();
      logger.info("Similarity service initialized");
    } catch (embeddingError) {
      logger.warn(
        { error: embeddingError },
        "Failed to initialize embedding services - semantic similarity search unavailable"
      );
      embeddingService = null;
      similarityService = null;
    }
  }

  // Initialize Zoekt for lexical search (Phase 2, non-fatal)
  if (existingZoektManager && existingZoektManager.isStarted()) {
    zoektManager = existingZoektManager;
    logger.info("Zoekt reused (shared with viewer)");
    // Trigger reindex in background (in case not done yet)
    zoektManager.reindex().catch((err) => {
      logger.warn({ err }, "Zoekt reindex failed");
    });
  } else {
    try {
      const zoekt = new ZoektManager({
        repoRoot: config.root,
        dataDir,
        port: 6070,
        binDir: path.join(config.root, "bin"),
      });
      await zoekt.start();
      zoektManager = zoekt;
      logger.info({ port: zoekt.getPort() }, "Zoekt webserver started for lexical search");

      // Trigger initial reindex in background (non-blocking)
      zoektManager.reindex().catch((err) => {
        logger.warn({ err }, "Initial Zoekt reindex failed");
      });
    } catch (zoektError) {
      const zoektMsg = zoektError instanceof Error ? zoektError.message : String(zoektError);
      logger.debug(
        { reason: zoektMsg },
        "Zoekt not available - lexical/regex code search disabled (optional: run scripts/setup-zoekt.sh)"
      );
      zoektManager = null;
    }
  }

  // Phase 3: Hybrid search (requires embeddings + Zoekt)
  if (embeddingService && zoektManager) {
    try {
      hybridSearchService = new HybridSearchService(
        graphStore as unknown as IGraphStore,
        embeddingService,
        zoektManager,
        llmService ?? undefined
      );
      logger.debug("Hybrid search service initialized");
    } catch (err) {
      logger.warn({ err }, "Hybrid search service failed to initialize");
      hybridSearchService = null;
    }
  } else {
    hybridSearchService = null;
  }

  // Create MCP server with full service integration
  server = createMcpServer({
    graphStore,
    observer,
    adaptiveIndexer: undefined, // TODO: Wire up adaptive indexer
    ledger: changeLedger ?? undefined,
    justificationService,
    indexer,
    embeddingService: embeddingService ?? undefined,
    similarityService: similarityService ?? undefined,
    zoektManager: zoektManager ?? undefined,
    hybridSearchService: hybridSearchService ?? undefined,
  });

  // Start file watcher for automatic incremental indexing
  const project = indexer.getProject();
  if (project) {
    fileWatcher = createFileWatcher({
      project,
      debounceMs: 500,
      onBatch: async (batch) => {
        logger.info(
          {
            filesToUpdate: batch.filesToUpdate.length,
            filesToRemove: batch.filesToRemove.length,
          },
          "File changes detected"
        );

        // Log events for debugging
        for (const event of batch.events) {
          logger.debug(
            { type: event.type, file: event.filePath },
            "File change event"
          );
        }

        // Index updated files
        for (const filePath of batch.filesToUpdate) {
          try {
            await indexer?.indexFile(filePath);
            logger.debug({ filePath }, "Indexed file");
          } catch (fileError) {
            logger.warn({ filePath, error: fileError }, "Failed to index file");
          }
        }

        // Remove deleted files (when Indexer supports it)
        for (const filePath of batch.filesToRemove) {
          try {
            await indexer?.removeFile(filePath);
            logger.debug({ filePath }, "Removed file from index");
          } catch (fileError) {
            logger.warn({ filePath, error: fileError }, "Failed to remove file");
          }
        }

        // Debounced Zoekt reindex (Phase 2)
        if (zoektManager?.isStarted()) {
          if (zoektReindexTimer) clearTimeout(zoektReindexTimer);
          zoektReindexTimer = setTimeout(() => {
            zoektReindexTimer = null;
            zoektManager?.reindex().catch((err) => {
              logger.warn({ err }, "Zoekt reindex failed");
            });
          }, ZOEKT_REINDEX_DEBOUNCE_MS);
        }
      },
      onError: (error) => {
        logger.error({ error }, "File watcher error");
      },
      onReady: () => {
        logger.info("File watcher ready and watching for changes");
      },
    });

    await fileWatcher.start();
    logger.info("File watcher started for incremental indexing");
  }

  // Choose transport based on options
  if (options.useHttp) {
    // HTTP transport - create HTTP server with Streamable HTTP transport
    const port = options.port;

    // Create the transport (stateless mode for simplicity)
    httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    // Connect the MCP server to the transport
    await server.connect(httpTransport);

    // Create HTTP server to handle requests
    httpServer = http.createServer(async (req, res) => {
      // Add CORS headers for browser access
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");

      // Handle preflight requests
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      // Only handle /mcp endpoint
      if (url.pathname === "/mcp") {
        try {
          await httpTransport!.handleRequest(req, res);
        } catch (err) {
          logger.error({ err }, "Error handling MCP request");
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
      } else if (url.pathname === "/health") {
        // Health check endpoint
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", transport: "http" }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found. Use /mcp for MCP requests or /health for health check." }));
      }
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      httpServer!.once("error", reject);
      httpServer!.listen(port, "127.0.0.1", () => {
        httpServer!.removeListener("error", reject);
        resolve();
      });
    });

    logger.info({ port, endpoint: `/mcp` }, "MCP server started with HTTP transport");
  } else {
    // Stdio transport (default) - for AI agent integration
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info("MCP server started and connected via stdio");
  }
}

/**
 * Stop the MCP server
 */
export async function stopServer(): Promise<void> {
  logger.info("Stopping MCP server");

  if (zoektReindexTimer) {
    clearTimeout(zoektReindexTimer);
    zoektReindexTimer = null;
  }
  if (zoektManager) {
    zoektManager.stop();
    zoektManager = null;
    logger.debug("Zoekt webserver stopped");
  }
  hybridSearchService = null;

  // Stop file watcher first
  if (fileWatcher) {
    await fileWatcher.stop();
    fileWatcher = null;
    logger.debug("File watcher stopped");
  }

  // Clean up observer
  if (observer) {
    observer = null;
    logger.debug("MCP observer cleaned up");
  }

  // Shutdown change ledger (flushes pending entries)
  if (changeLedger) {
    await changeLedger.shutdown();
    changeLedger = null;
    logger.debug("Change ledger shut down");
  }

  // Close justification service
  if (justificationService) {
    await justificationService.close();
    justificationService = null;
    logger.debug("Justification service closed");
  }

  // Note: Model router doesn't need explicit cleanup
  // but clear the reference
  modelRouter = null;

  // Clear embedding and similarity services (no explicit cleanup needed)
  embeddingService = null;
  similarityService = null;

  // Close HTTP transport and server if running
  if (httpTransport) {
    await httpTransport.close();
    httpTransport = null;
    logger.debug("HTTP transport closed");
  }

  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close(() => resolve());
    });
    httpServer = null;
    logger.debug("HTTP server stopped");
  }

  if (server) {
    await server.close();
    server = null;
  }

  if (indexer) {
    await indexer.close();
    indexer = null;
  }

  logger.info("MCP server stopped");
}

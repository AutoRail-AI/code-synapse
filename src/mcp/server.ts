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
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { ProjectConfig } from "../types/index.js";
import { createIndexer, type Indexer } from "../core/index.js";
import type { GraphDatabase } from "../core/graph/index.js";
import { createLogger } from "../utils/logger.js";
import { getConfigPath, readJson } from "../utils/index.js";
import {
  createInitializedLLMService,
  createInitializedAPILLMService,
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

const logger = createLogger("mcp-server");

export interface ServerOptions {
  port: number;
  config: ProjectConfig;
  dataDir: string;
  /** Optional existing graph store to use (avoids creating a new one) */
  existingStore?: import("../core/graph/index.js").IGraphStore;
}

let indexer: Indexer | null = null;
let server: Server | null = null;
let fileWatcher: FileWatcher | null = null;
let observer: MCPObserverService | null = null;
let llmService: ILLMService | null = null;
let justificationService: IJustificationService | null = null;
let changeLedger: IChangeLedger | null = null;

/**
 * Extended config that includes LLM settings
 */
interface CodeSynapseConfig extends ProjectConfig {
  llmModel?: string;
  skipLlm?: boolean;
  modelProvider?: "local" | "openai" | "anthropic" | "google";
}

/**
 * Tool definitions for MCP
 * Exported for testing purposes.
 */
export const TOOL_DEFINITIONS = [
  {
    name: "search_code",
    description:
      "Search for code entities (functions, classes, interfaces, variables, files) by name or pattern",
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
  } = options;

  // Create tool context for dependency injection
  const toolContext: ToolContext = {
    sessionId: `mcp-${Date.now()}`,
    observer,
    adaptiveIndexer,
    justificationService,
    ledger,
    indexer: indexerRef,
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
          const result = await searchCode(graphStore, {
            query: args?.query as string,
            limit: args?.limit as number | undefined,
            entityType: args?.entityType as
              | "function"
              | "class"
              | "interface"
              | "variable"
              | "file"
              | undefined,
          });
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
  const { config, dataDir, existingStore } = options;

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
  const modelId = extendedConfig?.llmModel ?? "qwen2.5-coder-3b";

  // Initialize LLM service if enabled
  if (!skipLlm) {
    try {
      if (modelProvider === "local") {
        logger.info({ modelId }, "Initializing Local LLM service");
        llmService = await createInitializedLLMService({
          modelId,
          store: graphStore as unknown as import("../core/graph/index.js").IGraphStore
        });
      } else if (["openai", "anthropic", "google"].includes(modelProvider)) {
        logger.info({ modelId, provider: modelProvider }, "Initializing API LLM service");
        llmService = await createInitializedAPILLMService({
          provider: modelProvider as "openai" | "anthropic" | "google",
          modelId,
        });
      } else {
        logger.warn({ modelProvider }, "Unknown model provider - skipping LLM initialization");
      }

      if (llmService) {
        logger.info({ modelId, provider: modelProvider }, "LLM service initialized");
      }
    } catch (llmError) {
      logger.warn(
        { error: llmError, modelId },
        "Failed to initialize LLM service - justifications will use code analysis only"
      );
    }
  } else {
    logger.info("LLM service disabled by configuration");
  }

  // Initialize justification service
  // This works with or without LLM - falls back to code analysis
  justificationService = createLLMJustificationService(
    graphStore as unknown as import("../core/interfaces/IGraphStore.js").IGraphStore,
    llmService ?? undefined
  );
  await justificationService.initialize();
  logger.info("Justification service initialized");

  // Set justification service on indexer for incremental justification
  indexer.setJustificationService(justificationService);
  logger.debug("Justification service attached to indexer");

  // Initialize change ledger (non-fatal - system works without it)
  try {
    const ledgerStorage = createLedgerStorage(graphStore);
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

  // Create MCP server with full service integration
  server = createMcpServer({
    graphStore,
    observer,
    adaptiveIndexer: undefined, // TODO: Wire up adaptive indexer
    ledger: changeLedger ?? undefined,
    justificationService,
    indexer,
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

  // Use stdio transport for MCP communication
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("MCP server started and connected via stdio");
}

/**
 * Stop the MCP server
 */
export async function stopServer(): Promise<void> {
  logger.info("Stopping MCP server");

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

  // Note: LLM service doesn't need explicit cleanup
  // but clear the reference
  llmService = null;

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

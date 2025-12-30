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
import {
  searchCode,
  getFunction,
  getClass,
  getFileSymbols,
  getCallers,
  getCallees,
  getDependencies,
  getProjectStats,
} from "./tools.js";
import {
  getFileResource,
  listFileResources,
  getSymbolResource,
  listSymbolResources,
  getGraphResource,
  getResourceDefinitions,
} from "./resources.js";

const logger = createLogger("mcp-server");

export interface ServerOptions {
  port: number;
  config: ProjectConfig;
  dataDir: string;
}

let indexer: Indexer | null = null;
let server: Server | null = null;

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
];

/**
 * Create and configure the MCP server
 * Exported for testing purposes.
 */
export function createMcpServer(graphStore: GraphDatabase): Server {
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
  const { config, dataDir } = options;

  logger.info({ dataDir }, "Starting MCP server");

  // Initialize the indexer
  indexer = createIndexer({
    config,
    dataDir,
  });

  await indexer.initialize();

  // Get the graph database from the indexer
  const graphStore = indexer.getGraphDatabase();

  // Create MCP server
  server = createMcpServer(graphStore);

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

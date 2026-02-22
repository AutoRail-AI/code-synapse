/**
 * MCP Tool REST Routes
 *
 * Exposes MCP tool functions as REST API endpoints so that dashboards and
 * non-agent consumers can access the same functionality via HTTP.
 *
 * @module
 */

import * as http from "node:http";
import type { GraphDatabase } from "../../core/graph/index.js";
import type { IGraphStore } from "../../core/interfaces/IGraphStore.js";
import type { IJustificationService } from "../../core/justification/interfaces/IJustificationService.js";
import type { IChangeLedger } from "../../core/ledger/interfaces/IChangeLedger.js";
import type { IAdaptiveIndexer } from "../../core/adaptive-indexer/interfaces/IAdaptiveIndexer.js";
import type { HybridSearchService } from "../../core/search/hybrid-service.js";
import type { Indexer } from "../../core/indexer/index.js";

import {
  getFunctionSemantics,
  getErrorPaths,
  getDataFlow,
  getSideEffects,
  findPatterns,
  getPattern,
  notifyFileChanged,
  enhancePrompt,
  createGenerationContext,
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
} from "../../mcp/tools.js";

import {
  vibeStart,
  vibeChange,
  vibeComplete,
  vibeStatus,
} from "../../mcp/vibe-coding.js";

// =============================================================================
// Types
// =============================================================================

interface RouteParams {
  path: string;
  query: URLSearchParams;
  pathParams: Record<string, string>;
}

type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: RouteParams,
) => Promise<void>;

export interface McpToolRouteDeps {
  graphDatabase: GraphDatabase;
  graphStore?: IGraphStore;
  justificationService?: IJustificationService;
  ledger?: IChangeLedger;
  adaptiveIndexer?: IAdaptiveIndexer;
  hybridSearchService?: HybridSearchService | null;
  indexer?: Indexer;
  addRoute: (method: string, pattern: string, handler: RouteHandler) => void;
  sendJSON: (res: http.ServerResponse, data: unknown, status?: number) => void;
  sendError: (res: http.ServerResponse, status: number, message: string, error?: unknown) => void;
  parseBody: (req: http.IncomingMessage) => Promise<unknown>;
}

// =============================================================================
// Route Registration
// =============================================================================

export function registerMcpToolRoutes(deps: McpToolRouteDeps): void {
  const {
    graphDatabase,
    graphStore,
    justificationService,
    ledger,
    adaptiveIndexer,
    hybridSearchService,
    indexer,
    addRoute,
    sendJSON,
    sendError,
    parseBody,
  } = deps;

  // Build a ToolContext for tools that need it
  const toolContext = {
    sessionId: "rest-api",
    justificationService: justificationService ?? undefined,
    ledger: ledger ?? undefined,
    adaptiveIndexer: adaptiveIndexer ?? undefined,
    hybridSearchService: hybridSearchService ?? undefined,
    indexer: indexer ?? undefined,
  };

  // ===========================================================================
  // Semantic Analysis (4)
  // ===========================================================================

  addRoute("GET", "/api/semantics/functions", async (_req, res, params) => {
    try {
      const name = params.query.get("name");
      if (!name) {
        sendError(res, 400, "Missing required query parameter: name");
        return;
      }
      const result = await getFunctionSemantics(graphDatabase, {
        name,
        filePath: params.query.get("filePath") ?? undefined,
      });
      if (!result) {
        sendError(res, 404, "Function not found");
        return;
      }
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get function semantics", error);
    }
  });

  addRoute("GET", "/api/semantics/error-paths", async (_req, res, params) => {
    try {
      const functionName = params.query.get("functionName");
      if (!functionName) {
        sendError(res, 400, "Missing required query parameter: functionName");
        return;
      }
      const result = await getErrorPaths(graphDatabase, {
        functionName,
        filePath: params.query.get("filePath") ?? undefined,
      });
      if (!result) {
        sendError(res, 404, "Function not found");
        return;
      }
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get error paths", error);
    }
  });

  addRoute("GET", "/api/semantics/data-flow", async (_req, res, params) => {
    try {
      const functionName = params.query.get("functionName");
      if (!functionName) {
        sendError(res, 400, "Missing required query parameter: functionName");
        return;
      }
      const result = await getDataFlow(graphDatabase, {
        functionName,
        filePath: params.query.get("filePath") ?? undefined,
        includeFullGraph: params.query.get("includeFullGraph") === "true",
      });
      if (!result) {
        sendError(res, 404, "Function not found");
        return;
      }
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get data flow", error);
    }
  });

  addRoute("GET", "/api/semantics/side-effects", async (_req, res, params) => {
    try {
      const functionName = params.query.get("functionName");
      if (!functionName) {
        sendError(res, 400, "Missing required query parameter: functionName");
        return;
      }
      const categories = params.query.get("categories");
      const result = await getSideEffects(graphDatabase, {
        functionName,
        filePath: params.query.get("filePath") ?? undefined,
        categories: categories ? categories.split(",") : undefined,
        minConfidence: params.query.get("minConfidence") ?? undefined,
      });
      if (!result) {
        sendError(res, 404, "Function not found");
        return;
      }
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get side effects", error);
    }
  });

  // ===========================================================================
  // Design Patterns (2)
  // ===========================================================================

  addRoute("GET", "/api/patterns", async (_req, res, params) => {
    try {
      const patternType = params.query.get("patternType") as
        | "factory" | "singleton" | "observer" | "repository" | "service"
        | "adapter" | "builder" | "strategy" | "decorator"
        | undefined;
      const result = await findPatterns(graphDatabase, {
        patternType: patternType ?? undefined,
        minConfidence: parseFloat(params.query.get("minConfidence") || "0.5"),
        filePath: params.query.get("filePath") ?? undefined,
        limit: parseInt(params.query.get("limit") || "20", 10),
      });
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to find patterns", error);
    }
  });

  addRoute("GET", "/api/patterns/:id", async (_req, res, params) => {
    try {
      const result = await getPattern(graphDatabase, {
        patternId: params.pathParams.id!,
      });
      if (!result) {
        sendError(res, 404, "Pattern not found");
        return;
      }
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get pattern", error);
    }
  });

  // ===========================================================================
  // Operations (3)
  // ===========================================================================

  addRoute("POST", "/api/operations/file-changed", async (req, res, _params) => {
    try {
      const body = (await parseBody(req)) as Record<string, unknown>;
      const filePath = body.filePath as string | undefined;
      const changeType = body.changeType as string | undefined;
      if (!filePath || !changeType) {
        sendError(res, 400, "Missing required body fields: filePath, changeType");
        return;
      }
      const result = await notifyFileChanged(
        graphDatabase,
        {
          filePath,
          changeType: changeType as "created" | "modified" | "deleted" | "renamed",
          previousPath: body.previousPath as string | undefined,
          changeDescription: body.changeDescription as string | undefined,
          aiGenerated: body.aiGenerated as boolean | undefined,
        },
        toolContext,
      );
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to notify file change", error);
    }
  });

  addRoute("POST", "/api/operations/enhance-prompt", async (req, res, _params) => {
    try {
      const body = (await parseBody(req)) as Record<string, unknown>;
      const prompt = body.prompt as string | undefined;
      if (!prompt) {
        sendError(res, 400, "Missing required body field: prompt");
        return;
      }
      const result = await enhancePrompt(
        graphDatabase,
        {
          prompt,
          targetFile: body.targetFile as string | undefined,
          taskType: body.taskType as "create" | "modify" | "refactor" | "fix" | "document" | "test" | undefined,
          includeContext: body.includeContext as boolean | undefined,
          maxContextTokens: body.maxContextTokens as number | undefined,
        },
        toolContext,
      );
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to enhance prompt", error);
    }
  });

  addRoute("POST", "/api/operations/generation-context", async (req, res, _params) => {
    try {
      const body = (await parseBody(req)) as Record<string, unknown>;
      const originalPrompt = body.originalPrompt as string | undefined;
      const affectedFiles = body.affectedFiles as Array<{
        filePath: string;
        changeType: "created" | "modified";
        summary?: string;
      }> | undefined;
      if (!originalPrompt || !affectedFiles) {
        sendError(res, 400, "Missing required body fields: originalPrompt, affectedFiles");
        return;
      }
      const result = await createGenerationContext(
        graphDatabase,
        {
          originalPrompt,
          affectedFiles,
          sessionId: body.sessionId as string | undefined,
          generationNotes: body.generationNotes as string | undefined,
        },
        toolContext,
      );
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to create generation context", error);
    }
  });

  // ===========================================================================
  // Lazarus Migration (10)
  // ===========================================================================

  addRoute("GET", "/api/entities/:id/source", async (_req, res, params) => {
    try {
      const result = await getEntitySource(graphDatabase, {
        entityId: params.pathParams.id!,
        contextLines: parseInt(params.query.get("contextLines") || "0", 10),
      });
      if (!result) {
        sendError(res, 404, "Entity not found");
        return;
      }
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get entity source", error);
    }
  });

  addRoute("GET", "/api/features", async (_req, res, params) => {
    try {
      const result = await getFeatureMap(graphDatabase, {
        featureContext: params.query.get("featureContext") ?? undefined,
        includeEntities: params.query.get("includeEntities") === "true",
        limit: parseInt(params.query.get("limit") || "50", 10),
      });
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get feature map", error);
    }
  });

  addRoute("POST", "/api/features/migration-context", async (req, res, _params) => {
    try {
      const body = (await parseBody(req)) as Record<string, unknown>;
      const result = await getMigrationContext(graphDatabase, {
        featureContext: body.featureContext as string | undefined,
        entityIds: body.entityIds as string[] | undefined,
        includeSource: body.includeSource as boolean | undefined,
        includeDataFlow: body.includeDataFlow as boolean | undefined,
        includeSideEffects: body.includeSideEffects as boolean | undefined,
      });
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get migration context", error);
    }
  });

  addRoute("GET", "/api/entities/:id/blast-radius", async (_req, res, params) => {
    try {
      const result = await analyzeBlastRadius(graphDatabase, {
        entityId: params.pathParams.id!,
        maxDepth: parseInt(params.query.get("maxDepth") || "3", 10),
        direction: (params.query.get("direction") as "callers" | "callees" | "both") ?? "callers",
      });
      if (!result) {
        sendError(res, 404, "Entity not found");
        return;
      }
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to analyze blast radius", error);
    }
  });

  addRoute("GET", "/api/entities/:id/tests", async (_req, res, params) => {
    try {
      const result = await getEntityTests(graphDatabase, {
        entityId: params.pathParams.id!,
      });
      if (!result) {
        sendError(res, 404, "Entity not found");
        return;
      }
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get entity tests", error);
    }
  });

  addRoute("GET", "/api/resolve", async (_req, res, params) => {
    try {
      const filePath = params.query.get("filePath");
      const line = params.query.get("line");
      if (!filePath || !line) {
        sendError(res, 400, "Missing required query parameters: filePath, line");
        return;
      }
      const result = await resolveEntityAtLocation(graphDatabase, {
        filePath,
        line: parseInt(line, 10),
      });
      if (!result) {
        sendError(res, 404, "No entity found at location");
        return;
      }
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to resolve entity at location", error);
    }
  });

  addRoute("GET", "/api/migration/progress", async (_req, res, params) => {
    try {
      const tags = params.query.get("tags");
      const result = await getMigrationProgress(graphDatabase, {
        featureContext: params.query.get("featureContext") ?? undefined,
        tags: tags ? tags.split(",") : undefined,
      });
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get migration progress", error);
    }
  });

  addRoute("GET", "/api/migration/slice-dependencies", async (_req, res, params) => {
    try {
      const features = params.query.get("features");
      const result = await getSliceDependencies(graphDatabase, {
        features: features ? features.split(",") : undefined,
      });
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get slice dependencies", error);
    }
  });

  // ===========================================================================
  // Entity Tagging (3)
  // ===========================================================================

  addRoute("POST", "/api/entities/:id/tags", async (req, res, params) => {
    try {
      const body = (await parseBody(req)) as Record<string, unknown>;
      const tags = body.tags as string[] | undefined;
      if (!tags || !Array.isArray(tags)) {
        sendError(res, 400, "Missing required body field: tags (array)");
        return;
      }
      const result = await tagEntity(graphDatabase, {
        entityId: params.pathParams.id!,
        tags,
        source: body.source as string | undefined,
      });
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to tag entity", error);
    }
  });

  addRoute("GET", "/api/tags/:tag/entities", async (_req, res, params) => {
    try {
      const result = await getTaggedEntities(graphDatabase, {
        tag: params.pathParams.tag!,
        entityType: params.query.get("entityType") as
          | "function" | "class" | "interface" | "variable" | "file"
          | undefined,
      });
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get tagged entities", error);
    }
  });

  addRoute("DELETE", "/api/entities/:id/tags", async (req, res, params) => {
    try {
      const body = (await parseBody(req)) as Record<string, unknown>;
      const tags = body.tags as string[] | undefined;
      if (!tags || !Array.isArray(tags)) {
        sendError(res, 400, "Missing required body field: tags (array)");
        return;
      }
      const result = await removeEntityTags(graphDatabase, {
        entityId: params.pathParams.id!,
        tags,
      });
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to remove entity tags", error);
    }
  });

  // ===========================================================================
  // Vibe Coding Sessions (4)
  // ===========================================================================

  if (graphStore) {
    addRoute("POST", "/api/sessions/start", async (req, res, _params) => {
      try {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const intent = body.intent as string | undefined;
        if (!intent) {
          sendError(res, 400, "Missing required body field: intent");
          return;
        }
        const result = await vibeStart(
          graphStore,
          justificationService ?? null,
          ledger ?? null,
          {
            intent,
            targetFiles: body.targetFiles as string[] | undefined,
            relatedConcepts: body.relatedConcepts as string[] | undefined,
            maxContextItems: body.maxContextItems as number | undefined,
          },
        );
        sendJSON(res, result);
      } catch (error) {
        sendError(res, 500, "Failed to start vibe session", error);
      }
    });

    addRoute("POST", "/api/sessions/:sessionId/changes", async (req, res, params) => {
      try {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const filePath = body.filePath as string | undefined;
        const changeType = body.changeType as string | undefined;
        const description = body.description as string | undefined;
        if (!filePath || !changeType || !description) {
          sendError(res, 400, "Missing required body fields: filePath, changeType, description");
          return;
        }
        const indexerAdapter = indexer
          ? { indexFile: (path: string) => indexer.indexFile(path) }
          : null;
        const result = await vibeChange(
          graphStore,
          justificationService ?? null,
          ledger ?? null,
          indexerAdapter,
          {
            sessionId: params.pathParams.sessionId,
            filePath,
            changeType: changeType as "created" | "modified" | "deleted" | "renamed",
            description,
            previousPath: body.previousPath as string | undefined,
          },
        );
        sendJSON(res, result);
      } catch (error) {
        sendError(res, 500, "Failed to record vibe change", error);
      }
    });

    addRoute("POST", "/api/sessions/:sessionId/complete", async (req, res, params) => {
      try {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const result = await vibeComplete(ledger ?? null, {
          sessionId: params.pathParams.sessionId!,
          summary: body.summary as string | undefined,
        });
        sendJSON(res, result);
      } catch (error) {
        sendError(res, 500, "Failed to complete vibe session", error);
      }
    });
  }

  addRoute("GET", "/api/sessions/:sessionId", async (_req, res, params) => {
    try {
      const result = await vibeStatus({
        sessionId: params.pathParams.sessionId!,
      });
      if (!result.session) {
        sendError(res, 404, "Session not found");
        return;
      }
      sendJSON(res, result);
    } catch (error) {
      sendError(res, 500, "Failed to get vibe session status", error);
    }
  });
}

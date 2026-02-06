/**
 * Viewer HTTP Server
 *
 * Minimal HTTP server for the Index Viewer UI.
 * Uses Node's built-in http module - no external dependencies.
 *
 * @module
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../../utils/logger.js";
import type { IGraphViewer } from "../interfaces/IGraphViewer.js";

const logger = createLogger("viewer-server");
import type { CozoGraphViewer } from "../impl/CozoGraphViewer.js";
import type { IChangeLedger, LedgerQuery } from "../../core/ledger/interfaces/IChangeLedger.js";
import type { IAdaptiveIndexer } from "../../core/adaptive-indexer/interfaces/IAdaptiveIndexer.js";
import type { IProjectMemory } from "../../core/memory/interfaces/IProjectMemory.js";
import type { MemoryQuery } from "../../core/memory/models/memory-models.js";
import type { ILedgerCompaction } from "../../core/ledger/interfaces/ILedgerCompaction.js";
import type { CompactedEntryQuery } from "../../core/ledger/models/compacted-entry.js";
import type { IReconciliationWorker } from "../../core/reconciliation/interfaces/IReconciliation.js";

import type { LedgerEventType, EventSource } from "../../core/ledger/models/ledger-events.js";
import type { MemoryRuleScope, MemoryRuleCategory } from "../../core/memory/models/memory-models.js";

// =============================================================================
// Types
// =============================================================================

interface ServerConfig {
  port: number;
  host?: string;
}

interface ViewerServerOptions {
  changeLedger?: IChangeLedger;
  adaptiveIndexer?: IAdaptiveIndexer;
  projectMemory?: IProjectMemory;
  ledgerCompaction?: ILedgerCompaction;
  reconciliationWorker?: IReconciliationWorker;
}

interface RouteHandler {
  (req: http.IncomingMessage, res: http.ServerResponse, params: RouteParams): Promise<void>;
}

interface RouteParams {
  path: string;
  query: URLSearchParams;
  pathParams: Record<string, string>;
}

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

// =============================================================================
// MIME Types
// =============================================================================

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// =============================================================================
// ViewerServer Class
// =============================================================================

export class ViewerServer {
  private viewer: IGraphViewer;
  private server: http.Server | null = null;
  private routes: Route[] = [];
  private staticDir: string;
  private changeLedger?: IChangeLedger;
  private adaptiveIndexer?: IAdaptiveIndexer;
  private projectMemory?: IProjectMemory;
  private ledgerCompaction?: ILedgerCompaction;
  private reconciliationWorker?: IReconciliationWorker;

  constructor(viewer: IGraphViewer, options?: ViewerServerOptions) {
    this.viewer = viewer;
    this.changeLedger = options?.changeLedger;
    this.adaptiveIndexer = options?.adaptiveIndexer;
    this.projectMemory = options?.projectMemory;
    this.ledgerCompaction = options?.ledgerCompaction;
    this.reconciliationWorker = options?.reconciliationWorker;

    // Get the directory where static files are located
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    this.staticDir = path.join(__dirname, "public");

    this.setupRoutes();
  }

  // ===========================================================================
  // Route Setup
  // ===========================================================================

  private setupRoutes(): void {
    // Statistics
    this.addRoute("GET", "/api/stats/overview", this.handleStatsOverview.bind(this));
    this.addRoute("GET", "/api/stats/entities", this.handleStatsEntities.bind(this));
    this.addRoute("GET", "/api/stats/relationships", this.handleStatsRelationships.bind(this));
    this.addRoute("GET", "/api/stats/languages", this.handleStatsLanguages.bind(this));
    this.addRoute("GET", "/api/stats/complexity", this.handleStatsComplexity.bind(this));

    // Files
    this.addRoute("GET", "/api/files", this.handleListFiles.bind(this));
    this.addRoute("GET", "/api/files/tree", this.handleFileTree.bind(this));
    this.addRoute("GET", "/api/files/content", this.handleFileContent.bind(this));
    this.addRoute("GET", "/api/files/entities", this.handleFileEntities.bind(this));
    this.addRoute("GET", "/api/files/:id", this.handleGetFile.bind(this));
    this.addRoute("GET", "/api/files/:id/imports", this.handleGetFileImports.bind(this));
    this.addRoute("GET", "/api/files/:id/importers", this.handleGetFileImporters.bind(this));

    // Generic Entities
    this.addRoute("GET", "/api/entities/:id", this.handleGetEntity.bind(this));
    this.addRoute("GET", "/api/entities/:id/relationships", this.handleGetEntityRelationships.bind(this));

    // Functions
    this.addRoute("GET", "/api/functions", this.handleListFunctions.bind(this));
    this.addRoute("GET", "/api/functions/most-called", this.handleMostCalledFunctions.bind(this));
    this.addRoute("GET", "/api/functions/most-complex", this.handleMostComplexFunctions.bind(this));
    this.addRoute("GET", "/api/functions/:id", this.handleGetFunction.bind(this));
    this.addRoute("GET", "/api/functions/:id/callers", this.handleGetFunctionCallers.bind(this));
    this.addRoute("GET", "/api/functions/:id/callees", this.handleGetFunctionCallees.bind(this));

    // Classes
    this.addRoute("GET", "/api/classes", this.handleListClasses.bind(this));
    this.addRoute("GET", "/api/classes/:id", this.handleGetClass.bind(this));
    this.addRoute("GET", "/api/classes/:id/hierarchy", this.handleGetClassHierarchy.bind(this));

    // Interfaces
    this.addRoute("GET", "/api/interfaces", this.handleListInterfaces.bind(this));
    this.addRoute("GET", "/api/interfaces/:id", this.handleGetInterface.bind(this));

    // Search
    this.addRoute("GET", "/api/search", this.handleSearch.bind(this));
    this.addRoute("GET", "/api/search/natural", this.handleNLSearch.bind(this));
    this.addRoute("GET", "/api/search/semantic", this.handleSemanticSearch.bind(this));
    this.addRoute("GET", "/api/search/exact", this.handleSearch.bind(this));
    this.addRoute("GET", "/api/nl-search", this.handleNLSearch.bind(this));
    this.addRoute("GET", "/api/nl-search/patterns", this.handleNLSearchPatterns.bind(this));

    // Graph Visualization
    this.addRoute("GET", "/api/graph", this.handleGraphData.bind(this));
    this.addRoute("GET", "/api/graph/calls", this.handleCallGraph.bind(this));
    this.addRoute("GET", "/api/graph/dependencies", this.handleDependencyGraph.bind(this));

    // Justifications (Business Context)
    this.addRoute("GET", "/api/stats/justifications", this.handleStatsJustifications.bind(this));
    this.addRoute("GET", "/api/justifications/stats", this.handleStatsJustifications.bind(this));
    this.addRoute("GET", "/api/justifications", this.handleListJustifications.bind(this));
    this.addRoute("GET", "/api/justifications/features", this.handleGetFeatureAreas.bind(this));
    this.addRoute("GET", "/api/justifications/search", this.handleSearchJustifications.bind(this));

    // New hierarchical and uncertainty endpoints
    this.addRoute("GET", "/api/justifications/uncertainty-hotspots", this.handleUncertaintyHotspots.bind(this));
    this.addRoute("GET", "/api/justifications/low-confidence", this.handleLowConfidenceEntities.bind(this));
    this.addRoute("GET", "/api/justifications/uncertain-features", this.handleUncertainFeatures.bind(this));
    this.addRoute("GET", "/api/justifications/features/:feature", this.handleGetJustificationsByFeature.bind(this));
    this.addRoute("GET", "/api/justifications/file-hierarchy/:filePath", this.handleFileHierarchyJustifications.bind(this));
    this.addRoute("GET", "/api/justifications/:entityId/children", this.handleGetJustificationChildren.bind(this));
    this.addRoute("GET", "/api/justifications/:entityId/ancestors", this.handleGetJustificationAncestors.bind(this));
    this.addRoute("GET", "/api/justifications/:entityId", this.handleGetJustification.bind(this));

    // Classification (Unified Justification now handles this)
    this.addRoute("GET", "/api/classifications/stats", this.handleClassificationStats.bind(this));
    this.addRoute("GET", "/api/classifications", this.handleListClassifications.bind(this));
    this.addRoute("GET", "/api/classifications/search", this.handleSearchClassifications.bind(this));
    // Deprecated specialized routes redirected or removed in future
    // this.addRoute("GET", "/api/classifications/domain/:area", this.handleClassificationsByDomain.bind(this));
    // this.addRoute("GET", "/api/classifications/infrastructure/:layer", this.handleClassificationsByInfrastructure.bind(this));
    this.addRoute("GET", "/api/classifications/:entityId", this.handleGetClassification.bind(this));

    // Change Ledger (Observability)
    this.addRoute("GET", "/api/ledger/stats", this.handleLedgerStats.bind(this));
    this.addRoute("GET", "/api/ledger", this.handleQueryLedger.bind(this));
    this.addRoute("GET", "/api/ledger/recent", this.handleRecentLedgerEntries.bind(this));
    this.addRoute("GET", "/api/ledger/timeline", this.handleLedgerTimeline.bind(this));
    this.addRoute("GET", "/api/ledger/aggregations", this.handleLedgerAggregations.bind(this));
    this.addRoute("GET", "/api/ledger/entity/:entityId", this.handleLedgerForEntity.bind(this));
    this.addRoute("GET", "/api/ledger/:id", this.handleGetLedgerEntry.bind(this));

    // Adaptive Indexer
    this.addRoute("GET", "/api/adaptive/stats", this.handleAdaptiveStats.bind(this));
    this.addRoute("GET", "/api/adaptive/hot", this.handleHotEntities.bind(this));
    this.addRoute("GET", "/api/adaptive/cold", this.handleColdEntities.bind(this));
    this.addRoute("GET", "/api/adaptive/priority", this.handlePriorityQueue.bind(this));
    this.addRoute("GET", "/api/adaptive/sessions", this.handleListSessions.bind(this));
    this.addRoute("GET", "/api/adaptive/sessions/:id", this.handleGetSession.bind(this));
    this.addRoute("GET", "/api/adaptive/queries/recent", this.handleRecentQueries.bind(this));
    this.addRoute("GET", "/api/adaptive/changes/recent", this.handleRecentChanges.bind(this));

    // Project Memory (Developer Memory System)
    this.addRoute("GET", "/api/memory/stats", this.handleMemoryStats.bind(this));
    this.addRoute("GET", "/api/memory/rules", this.handleListMemoryRules.bind(this));
    this.addRoute("GET", "/api/memory/rules/:id", this.handleGetMemoryRule.bind(this));
    this.addRoute("GET", "/api/memory/relevant", this.handleGetRelevantMemories.bind(this));
    this.addRoute("GET", "/api/memory/file/:filePath", this.handleGetMemoriesForFile.bind(this));

    // Ledger Compaction (Semantic Summaries)
    this.addRoute("GET", "/api/compaction/stats", this.handleCompactionStats.bind(this));
    this.addRoute("GET", "/api/compaction/entries", this.handleListCompactedEntries.bind(this));
    this.addRoute("GET", "/api/compaction/entries/:id", this.handleGetCompactedEntry.bind(this));
    this.addRoute("GET", "/api/compaction/timeline", this.handleCompactionTimeline.bind(this));
    this.addRoute("GET", "/api/compaction/session/:sessionId", this.handleCompactedEntryForSession.bind(this));

    // Reconciliation (Git Sync)
    this.addRoute("GET", "/api/reconciliation/status", this.handleReconciliationStatus.bind(this));
    this.addRoute("GET", "/api/reconciliation/gaps", this.handleDetectGaps.bind(this));
    this.addRoute("GET", "/api/reconciliation/validation", this.handleValidateLedgerIntegrity.bind(this));

    // Operations (POST endpoints for triggering actions)
    this.addRoute("POST", "/api/operations/reindex", this.handleOperationReindex.bind(this));
    this.addRoute("POST", "/api/operations/justify", this.handleOperationJustify.bind(this));

    // Health
    this.addRoute("GET", "/api/health", this.handleHealth.bind(this));
  }

  private addRoute(method: string, pattern: string, handler: RouteHandler): void {
    // Convert path pattern to regex
    const paramNames: string[] = [];
    const regexPattern = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });

    this.routes.push({
      method,
      pattern: new RegExp(`^${regexPattern}$`),
      paramNames,
      handler,
    });
  }

  // ===========================================================================
  // Request Handling
  // ===========================================================================

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method || "GET";

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Try API routes first
    for (const route of this.routes) {
      if (route.method !== method) continue;

      const match = pathname.match(route.pattern);
      if (match) {
        const pathParams: Record<string, string> = {};
        route.paramNames.forEach((name, index) => {
          pathParams[name] = decodeURIComponent(match[index + 1]!);
        });

        try {
          await route.handler(req, res, {
            path: pathname,
            query: url.searchParams,
            pathParams,
          });
        } catch (error) {
          this.sendError(res, 500, "Internal Server Error", error);
        }
        return;
      }
    }

    // Serve static files
    if (method === "GET") {
      await this.serveStatic(req, res, pathname);
      return;
    }

    this.sendError(res, 404, "Not Found");
  }

  private async serveStatic(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    // Default to index.html
    let filePath = pathname === "/" ? "/index.html" : pathname;

    // Security: prevent directory traversal
    filePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
    const fullPath = path.join(this.staticDir, filePath);

    // Check if file exists
    try {
      const stats = await fs.promises.stat(fullPath);
      if (!stats.isFile()) {
        // Try index.html for SPA routing
        const indexPath = path.join(this.staticDir, "index.html");
        await this.sendFile(res, indexPath);
        return;
      }
      await this.sendFile(res, fullPath);
    } catch {
      // Try index.html for SPA routing
      const indexPath = path.join(this.staticDir, "index.html");
      try {
        await this.sendFile(res, indexPath);
      } catch {
        this.sendError(res, 404, "Not Found");
      }
    }
  }

  private async sendFile(res: http.ServerResponse, filePath: string): Promise<void> {
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    const content = await fs.promises.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  }

  private sendJSON(res: http.ServerResponse, data: unknown, status: number = 200): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private sendError(
    res: http.ServerResponse,
    status: number,
    message: string,
    error?: unknown
  ): void {
    console.error(`[Viewer] Error ${status}: ${message}`, error);
    this.sendJSON(res, { error: message }, status);
  }

  // ===========================================================================
  // API Handlers - Statistics
  // ===========================================================================

  private async handleStatsOverview(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    const stats = await this.viewer.getOverviewStats();
    this.sendJSON(res, stats);
  }

  private async handleStatsEntities(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    const counts = await this.viewer.getEntityCounts();
    this.sendJSON(res, counts);
  }

  private async handleStatsRelationships(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    const counts = await this.viewer.getRelationshipCounts();
    this.sendJSON(res, counts);
  }

  private async handleStatsLanguages(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    const distribution = await this.viewer.getLanguageDistribution();
    this.sendJSON(res, distribution);
  }

  private async handleStatsComplexity(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    const distribution = await this.viewer.getComplexityDistribution();
    this.sendJSON(res, distribution);
  }

  // ===========================================================================
  // API Handlers - Files
  // ===========================================================================

  private async handleListFiles(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const limit = parseInt(params.query.get("limit") || "100", 10);
    const offset = parseInt(params.query.get("offset") || "0", 10);
    const orderBy = params.query.get("orderBy") || "relative_path";
    const orderDirection = params.query.get("orderDirection") as "asc" | "desc" || "asc";

    const files = await this.viewer.listFiles({ limit, offset, orderBy, orderDirection });
    this.sendJSON(res, files);
  }

  private async handleGetFile(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.pathParams.id!;
    const file = await this.viewer.getFile(id);

    if (!file) {
      this.sendError(res, 404, "File not found");
      return;
    }

    // Also get functions in this file
    const functions = await this.viewer.getFunctionsByFile(id);

    this.sendJSON(res, { ...file, functions });
  }

  private async handleGetFileImports(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.pathParams.id!;
    const imports = await this.viewer.getImports(id);
    this.sendJSON(res, imports);
  }

  private async handleGetFileImporters(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.pathParams.id!;
    const importers = await this.viewer.getImporters(id);
    this.sendJSON(res, importers);
  }

  private async handleFileTree(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    try {
      // Get all files and build a tree structure
      const files = await this.viewer.listFiles({ limit: 10000 });

      interface TreeNode {
        name: string;
        path: string;
        type: 'file' | 'directory';
        children?: TreeNode[];
        entityCount?: number;
      }

      const root: TreeNode[] = [];
      const pathMap = new Map<string, TreeNode>();

      for (const file of files) {
        const parts = file.relativePath.split('/');
        let currentPath = '';
        let currentLevel = root;

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]!;
          currentPath = currentPath ? `${currentPath}/${part}` : part;

          if (i === parts.length - 1) {
            // This is the file
            currentLevel.push({
              name: part,
              path: file.relativePath,
              type: 'file',
              entityCount: file.entityCount,
            });
          } else {
            // This is a directory
            let dir = pathMap.get(currentPath);
            if (!dir) {
              dir = {
                name: part,
                path: currentPath,
                type: 'directory',
                children: [],
              };
              pathMap.set(currentPath, dir);
              currentLevel.push(dir);
            }
            currentLevel = dir.children!;
          }
        }
      }

      this.sendJSON(res, root);
    } catch (error) {
      this.sendError(res, 500, "Failed to build file tree", error);
    }
  }

  private async handleFileContent(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const filePath = params.query.get("path");
    if (!filePath) {
      this.sendError(res, 400, "Missing 'path' query parameter");
      return;
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(content);
    } catch (error) {
      this.sendError(res, 404, "File not found or not readable", error);
    }
  }

  private async handleFileEntities(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const filePath = params.query.get("path");
    if (!filePath) {
      this.sendError(res, 400, "Missing 'path' query parameter");
      return;
    }

    try {
      // Get all files to find the one with matching path
      const files = await this.viewer.listFiles({ limit: 10000 });
      const file = files.find(f => f.relativePath === filePath || f.path === filePath);

      if (!file) {
        this.sendJSON(res, []);
        return;
      }

      // Get functions, classes, interfaces for this file
      const functions = await this.viewer.getFunctionsByFile(file.id);
      const classes = await this.viewer.listClasses({ limit: 1000 });
      const interfaces = await this.viewer.listInterfaces({ limit: 1000 });

      // Build base entities and enhance with justification data
      const rawEntities = [
        ...functions.map(f => ({
          id: f.id,
          name: f.name,
          kind: 'function' as const,
          filePath: f.filePath,
          startLine: f.startLine,
          endLine: f.endLine,
        })),
        ...classes.filter(c => c.filePath === file.path).map(c => ({
          id: c.id,
          name: c.name,
          kind: 'class' as const,
          filePath: c.filePath,
          startLine: c.startLine,
          endLine: c.endLine,
        })),
        ...interfaces.filter(i => i.filePath === file.path).map(i => ({
          id: i.id,
          name: i.name,
          kind: 'interface' as const,
          filePath: i.filePath,
          startLine: i.startLine,
          endLine: i.endLine,
        })),
      ];

      // Enhance with justification data
      const entities = await Promise.all(
        rawEntities.map(async (entity) => {
          const justification = await this.viewer.getJustification(entity.id).catch((err) => {
            logger.debug({ error: err, entityId: entity.id }, "Failed to get justification for entity");
            return null;
          });
          return {
            ...entity,
            confidence: justification?.confidenceScore,
            justification: justification?.purposeSummary,
            classification: justification?.category,
            subCategory: justification?.category === 'domain'
              ? justification?.domain
              : justification?.architecturalPattern,
            // Additional justification fields for rich display
            businessValue: justification?.businessValue,
            featureContext: justification?.featureContext,
            detailedDescription: justification?.detailedDescription,
            tags: justification?.tags,
          };
        })
      );

      this.sendJSON(res, entities);
    } catch (error) {
      this.sendError(res, 500, "Failed to get file entities", error);
    }
  }

  // ===========================================================================
  // API Handlers - Generic Entities
  // ===========================================================================

  private async handleGetEntity(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.pathParams.id!;

    // Try to find the entity in different collections
    const fn = await this.viewer.getFunction(id);
    if (fn) {
      const callers = await this.viewer.getCallers(id);
      const callees = await this.viewer.getCallees(id);
      this.sendJSON(res, {
        ...fn,
        kind: 'function',
        relationships: [
          ...callers.map(c => ({ type: 'called_by', target: c.name, targetKind: 'function' })),
          ...callees.map(c => ({ type: 'calls', target: c.name, targetKind: 'function' })),
        ],
      });
      return;
    }

    const cls = await this.viewer.getClass(id);
    if (cls) {
      this.sendJSON(res, { ...cls, kind: 'class', relationships: [] });
      return;
    }

    const iface = await this.viewer.getInterface(id);
    if (iface) {
      this.sendJSON(res, { ...iface, kind: 'interface', relationships: [] });
      return;
    }

    const file = await this.viewer.getFile(id);
    if (file) {
      this.sendJSON(res, { ...file, kind: 'file', relationships: [] });
      return;
    }

    this.sendError(res, 404, "Entity not found");
  }

  private async handleGetEntityRelationships(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.pathParams.id!;

    // Try to find relationships based on entity type
    const fn = await this.viewer.getFunction(id);
    if (fn) {
      const callers = await this.viewer.getCallers(id);
      const callees = await this.viewer.getCallees(id);
      this.sendJSON(res, [
        ...callers.map(c => ({ type: 'called_by', target: { id: c.id, name: c.name, kind: 'function', filePath: c.filePath } })),
        ...callees.map(c => ({ type: 'calls', target: { id: c.id, name: c.name, kind: 'function', filePath: c.filePath } })),
      ]);
      return;
    }

    const file = await this.viewer.getFile(id);
    if (file) {
      const imports = await this.viewer.getImports(id);
      const importers = await this.viewer.getImporters(id);
      this.sendJSON(res, [
        ...imports.map(i => ({ type: 'imports', target: { id: i.id, name: i.relativePath, kind: 'file', filePath: i.path } })),
        ...importers.map(i => ({ type: 'imported_by', target: { id: i.id, name: i.relativePath, kind: 'file', filePath: i.path } })),
      ]);
      return;
    }

    this.sendJSON(res, []);
  }

  // ===========================================================================
  // API Handlers - Functions
  // ===========================================================================

  private async handleListFunctions(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const limit = parseInt(params.query.get("limit") || "100", 10);
    const offset = parseInt(params.query.get("offset") || "0", 10);
    const orderBy = params.query.get("orderBy") || "name";
    const orderDirection = params.query.get("orderDirection") as "asc" | "desc" || "asc";

    const functions = await this.viewer.listFunctions({ limit, offset, orderBy, orderDirection });

    // Enhance with justification data
    const enhanced = await Promise.all(
      functions.map(async (fn) => {
        const justification = await this.viewer.getJustification(fn.id).catch((err) => {
          logger.debug({ error: err, functionId: fn.id }, "Failed to get justification for function");
          return null;
        });

        return {
          ...fn,
          kind: 'function' as const,
          confidence: justification?.confidenceScore,
          justification: justification?.purposeSummary,
          classification: justification?.category,
          subCategory: justification?.category === 'domain'
            ? justification?.domain
            : justification?.architecturalPattern, // Fallback infrastructure distinction
        };
      })
    );

    this.sendJSON(res, enhanced);
  }

  private async handleMostCalledFunctions(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const limit = parseInt(params.query.get("limit") || "20", 10);
    const functions = await this.viewer.getMostCalledFunctions(limit);
    this.sendJSON(res, functions);
  }

  private async handleMostComplexFunctions(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const limit = parseInt(params.query.get("limit") || "20", 10);
    const functions = await this.viewer.getMostComplexFunctions(limit);
    this.sendJSON(res, functions);
  }

  private async handleGetFunction(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.pathParams.id!;
    const fn = await this.viewer.getFunction(id);

    if (!fn) {
      this.sendError(res, 404, "Function not found");
      return;
    }

    this.sendJSON(res, fn);
  }

  private async handleGetFunctionCallers(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.pathParams.id!;
    const callers = await this.viewer.getCallers(id);
    this.sendJSON(res, callers);
  }

  private async handleGetFunctionCallees(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.pathParams.id!;
    const callees = await this.viewer.getCallees(id);
    this.sendJSON(res, callees);
  }

  // ===========================================================================
  // API Handlers - Classes
  // ===========================================================================

  private async handleListClasses(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const limit = parseInt(params.query.get("limit") || "100", 10);
    const offset = parseInt(params.query.get("offset") || "0", 10);
    const orderBy = params.query.get("orderBy") || "name";
    const orderDirection = params.query.get("orderDirection") as "asc" | "desc" || "asc";

    const classes = await this.viewer.listClasses({ limit, offset, orderBy, orderDirection });

    // Enhance with justification data
    const enhanced = await Promise.all(
      classes.map(async (cls) => {
        const justification = await this.viewer.getJustification(cls.id).catch((err) => {
          logger.debug({ error: err, classId: cls.id }, "Failed to get justification for class");
          return null;
        });

        return {
          ...cls,
          kind: 'class' as const,
          confidence: justification?.confidenceScore,
          justification: justification?.purposeSummary,
          classification: justification?.category,
          subCategory: justification?.category === 'domain'
            ? justification?.domain
            : justification?.architecturalPattern, // Fallback infrastructure distinction
        };
      })
    );

    this.sendJSON(res, enhanced);
  }

  private async handleGetClass(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.pathParams.id!;
    const cls = await this.viewer.getClass(id);

    if (!cls) {
      this.sendError(res, 404, "Class not found");
      return;
    }

    this.sendJSON(res, cls);
  }

  private async handleGetClassHierarchy(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.pathParams.id!;
    const hierarchy = await this.viewer.getInheritanceTree(id);
    this.sendJSON(res, hierarchy);
  }

  // ===========================================================================
  // API Handlers - Interfaces
  // ===========================================================================

  private async handleListInterfaces(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const limit = parseInt(params.query.get("limit") || "100", 10);
    const offset = parseInt(params.query.get("offset") || "0", 10);
    const orderBy = params.query.get("orderBy") || "name";
    const orderDirection = params.query.get("orderDirection") as "asc" | "desc" || "asc";

    const interfaces = await this.viewer.listInterfaces({ limit, offset, orderBy, orderDirection });

    // Enhance with justification data
    const enhanced = await Promise.all(
      interfaces.map(async (iface) => {
        const justification = await this.viewer.getJustification(iface.id).catch((err) => {
          logger.debug({ error: err, interfaceId: iface.id }, "Failed to get justification for interface");
          return null;
        });

        return {
          ...iface,
          kind: 'interface' as const,
          confidence: justification?.confidenceScore,
          justification: justification?.purposeSummary,
          classification: justification?.category,
          subCategory: justification?.category === 'domain'
            ? justification?.domain
            : justification?.architecturalPattern, // Fallback infrastructure distinction
        };
      })
    );

    this.sendJSON(res, enhanced);
  }

  private async handleGetInterface(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.pathParams.id!;
    const iface = await this.viewer.getInterface(id);

    if (!iface) {
      this.sendError(res, 404, "Interface not found");
      return;
    }

    this.sendJSON(res, iface);
  }

  // ===========================================================================
  // API Handlers - Search
  // ===========================================================================

  private async handleSearch(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const query = params.query.get("q") || "";
    const type = (params.query.get("type") || "all") as
      | "all"
      | "function"
      | "class"
      | "interface"
      | "file";

    if (!query) {
      this.sendJSON(res, []);
      return;
    }

    const results = await this.viewer.searchByName(query, type);
    this.sendJSON(res, results);
  }

  private async handleNLSearch(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const query = params.query.get("q") || "";

    if (!query) {
      this.sendJSON(res, {
        query: "",
        intent: { intent: "unknown", confidence: 0, keywords: [] },
        results: [],
        totalCount: 0,
        executionTimeMs: 0,
      });
      return;
    }

    // Cast to CozoGraphViewer to access nlSearch method
    const cozoViewer = this.viewer as CozoGraphViewer;
    if (typeof cozoViewer.nlSearch !== "function") {
      this.sendError(res, 501, "Natural language search not available");
      return;
    }

    const response = await cozoViewer.nlSearch(query);
    this.sendJSON(res, response);
  }

  private async handleNLSearchPatterns(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    // Cast to CozoGraphViewer to access getNLSearchPatterns method
    const cozoViewer = this.viewer as CozoGraphViewer;
    if (typeof cozoViewer.getNLSearchPatterns !== "function") {
      this.sendError(res, 501, "Natural language search not available");
      return;
    }

    const patterns = cozoViewer.getNLSearchPatterns();
    this.sendJSON(res, patterns);
  }

  private async handleSemanticSearch(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const query = params.query.get("q") || "";
    const limit = parseInt(params.query.get("limit") || "10", 10);

    if (!query) {
      this.sendJSON(res, []);
      return;
    }

    // Use NL search which includes semantic capabilities
    const cozoViewer = this.viewer as CozoGraphViewer;
    if (typeof cozoViewer.nlSearch !== "function") {
      this.sendError(res, 501, "Semantic search not available");
      return;
    }

    const response = await cozoViewer.nlSearch(query);
    const results = response.results.slice(0, limit).map(r => ({
      entity: {
        id: r.id,
        name: r.name,
        kind: r.entityType,
        filePath: r.filePath,
        startLine: r.line || 0,
        endLine: r.line || 0,
      },
      score: r.relevanceScore,
      highlights: r.context ? [r.context] : [],
    }));

    this.sendJSON(res, results);
  }

  // ===========================================================================
  // API Handlers - Graph Visualization
  // ===========================================================================

  private async handleGraphData(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const center = params.query.get("center") || undefined;
    const depth = parseInt(params.query.get("depth") || "2", 10);
    const kinds = params.query.get("kinds")?.split(",").filter(k => k.length > 0) || undefined;
    const limit = parseInt(params.query.get("limit") || "1000", 10);

    try {
      const graphData = await this.viewer.getGraphStructure({
        centerNodeId: center,
        depth,
        nodeKinds: kinds,
        edgeKinds: ["calls", "imports", "extends", "implements", "contains"],
        limit
      });

      this.sendJSON(res, graphData);
    } catch (error) {
      this.sendError(res, 500, "Failed to generate graph data", error);
    }
  }

  private async handleCallGraph(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.query.get("id");
    const depth = parseInt(params.query.get("depth") || "2", 10);

    if (!id) {
      this.sendError(res, 400, "Missing 'id' query parameter");
      return;
    }

    try {
      const callGraph = await this.viewer.getCallGraph(id, depth);

      // Convert call graph to nodes and edges format
      const nodes: Array<{ id: string; label: string; kind: string }> = [];
      const edges: Array<{ source: string; target: string; type: string }> = [];
      const visited = new Set<string>();

      const traverse = (node: typeof callGraph) => {
        if (visited.has(node.id)) return;
        visited.add(node.id);

        nodes.push({ id: node.id, label: node.name, kind: "function" });

        for (const callee of node.callees) {
          edges.push({ source: node.id, target: callee.id, type: "calls" });
          traverse(callee);
        }
      };

      traverse(callGraph);

      this.sendJSON(res, { nodes, edges });
    } catch (error) {
      this.sendError(res, 500, "Failed to generate call graph", error);
    }
  }

  private async handleDependencyGraph(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const id = params.query.get("id");

    if (!id) {
      this.sendError(res, 400, "Missing 'id' query parameter");
      return;
    }

    try {
      // The id parameter could be a file path or a file ID
      // First, try to resolve it to a file ID if it looks like a path
      let fileId = id;

      if (id.includes('/') || id.includes('.')) {
        // Looks like a path, try to find the file
        const files = await this.viewer.listFiles({ limit: 10000 });
        const file = files.find(f => f.relativePath === id || f.path === id);
        if (file) {
          fileId = file.id;
        } else {
          // File not found, return empty result
          this.sendJSON(res, { nodes: [], edges: [] });
          return;
        }
      }

      const importGraph = await this.viewer.getImportGraph(fileId, 2);

      // Convert import graph to nodes and edges format
      const nodes: Array<{ id: string; label: string; kind: string; direction?: string }> = [];
      const edges: Array<{ source: string; target: string; type: string }> = [];
      const visited = new Set<string>();

      // Add root node
      nodes.push({
        id: importGraph.id,
        label: importGraph.relativePath,
        kind: "file",
        direction: "root"
      });
      visited.add(importGraph.id);

      // Add imports (files this file imports)
      for (const imp of importGraph.imports) {
        if (!visited.has(imp.id)) {
          visited.add(imp.id);
          nodes.push({
            id: imp.id,
            label: imp.relativePath,
            kind: "file",
            direction: "outgoing"
          });
        }
        edges.push({ source: importGraph.id, target: imp.id, type: "imports" });
      }

      // Add importers (files that import this file)
      for (const importer of importGraph.importedBy) {
        if (!visited.has(importer.id)) {
          visited.add(importer.id);
          nodes.push({
            id: importer.id,
            label: importer.relativePath,
            kind: "file",
            direction: "incoming"
          });
        }
        edges.push({ source: importer.id, target: importGraph.id, type: "imports" });
      }

      this.sendJSON(res, { nodes, edges });
    } catch (error) {
      this.sendError(res, 500, "Failed to generate dependency graph", error);
    }
  }

  // ===========================================================================
  // API Handlers - Health
  // ===========================================================================

  private async handleHealth(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    const health = await this.viewer.getIndexHealth();

    // Transform to UI expected format
    this.sendJSON(res, {
      status: health.status,
      components: {
        database: { status: health.isHealthy ? 'healthy' : 'unhealthy' },
        indexer: {
          status: health.coverage.percentage > 90 ? 'healthy' : health.coverage.percentage > 50 ? 'degraded' : 'unhealthy',
          message: `${health.coverage.filesIndexed}/${health.coverage.filesTotal} files indexed`,
        },
        embeddings: {
          status: health.embeddings.percentage > 90 ? 'healthy' : health.embeddings.percentage > 50 ? 'degraded' : 'unhealthy',
          message: `${health.embeddings.functionsWithEmbeddings}/${health.embeddings.functionsTotal} functions embedded`,
        },
        relationships: {
          status: health.relationships.percentage > 80 ? 'healthy' : health.relationships.percentage > 50 ? 'degraded' : 'unhealthy',
          message: `${health.relationships.resolvedCalls} calls resolved, ${health.relationships.unresolvedCalls} unresolved`,
        },
      },
    });
  }

  // ===========================================================================
  // API Handlers - Justifications (Business Context)
  // ===========================================================================

  private async handleStatsJustifications(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    const stats = await this.viewer.getJustificationStats();

    // Transform to UI expected format
    this.sendJSON(res, {
      total: stats.justifiedEntities,
      byConfidence: {
        high: stats.highConfidence,
        medium: stats.mediumConfidence,
        low: stats.lowConfidence,
      },
      bySource: {
        inferred: stats.justifiedEntities - stats.userConfirmed,
        manual: stats.userConfirmed,
        pending: stats.pendingClarification,
      },
      coverage: stats.coveragePercentage / 100,
    });
  }

  private async handleListJustifications(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const limit = parseInt(params.query.get("limit") || "100", 10);
    const offset = parseInt(params.query.get("offset") || "0", 10);
    const orderBy = params.query.get("orderBy") || "name";
    const orderDirection = params.query.get("orderDirection") as "asc" | "desc" || "asc";

    const justifications = await this.viewer.listJustifications({
      limit,
      offset,
      orderBy,
      orderDirection,
    });
    this.sendJSON(res, justifications);
  }

  private async handleGetJustification(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const entityId = params.pathParams.entityId!;
    const justification = await this.viewer.getJustification(entityId);

    if (!justification) {
      this.sendJSON(res, null);
      return;
    }

    this.sendJSON(res, justification);
  }

  private async handleSearchJustifications(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const query = params.query.get("q") || "";
    const limit = parseInt(params.query.get("limit") || "50", 10);

    if (!query) {
      this.sendJSON(res, []);
      return;
    }

    const results = await this.viewer.searchJustifications(query, limit);
    this.sendJSON(res, results);
  }

  private async handleGetFeatureAreas(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    const features = await this.viewer.getFeatureAreas();
    this.sendJSON(res, features);
  }

  // ===========================================================================
  // API Handlers - Justifications (Hierarchical & Uncertainty)
  // ===========================================================================

  private async handleUncertaintyHotspots(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const limit = parseInt(params.query.get("limit") || "20", 10);

    const cozoViewer = this.viewer as CozoGraphViewer;
    if (typeof cozoViewer.getUncertaintyHotspots !== "function") {
      this.sendError(res, 501, "Uncertainty hotspots not available");
      return;
    }

    try {
      const hotspots = await cozoViewer.getUncertaintyHotspots(limit);
      this.sendJSON(res, hotspots);
    } catch (error) {
      this.sendError(res, 500, "Failed to get uncertainty hotspots", error);
    }
  }

  private async handleLowConfidenceEntities(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const limit = parseInt(params.query.get("limit") || "50", 10);

    const cozoViewer = this.viewer as CozoGraphViewer;
    if (typeof cozoViewer.getLowestConfidenceEntities !== "function") {
      this.sendError(res, 501, "Low confidence entity query not available");
      return;
    }

    try {
      const entities = await cozoViewer.getLowestConfidenceEntities(limit);
      this.sendJSON(res, entities);
    } catch (error) {
      this.sendError(res, 500, "Failed to get low confidence entities", error);
    }
  }

  private async handleUncertainFeatures(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const limit = parseInt(params.query.get("limit") || "10", 10);

    const cozoViewer = this.viewer as CozoGraphViewer;
    if (typeof cozoViewer.getUncertainFeatures !== "function") {
      this.sendError(res, 501, "Uncertain features query not available");
      return;
    }

    try {
      const features = await cozoViewer.getUncertainFeatures(limit);
      this.sendJSON(res, features);
    } catch (error) {
      this.sendError(res, 500, "Failed to get uncertain features", error);
    }
  }

  private async handleGetJustificationsByFeature(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const feature = decodeURIComponent(params.pathParams.feature!);
    const limit = parseInt(params.query.get("limit") || "100", 10);

    const cozoViewer = this.viewer as CozoGraphViewer;
    if (typeof cozoViewer.getJustificationsByFeature !== "function") {
      this.sendError(res, 501, "Feature-based justification query not available");
      return;
    }

    try {
      const justifications = await cozoViewer.getJustificationsByFeature(feature, limit);
      this.sendJSON(res, justifications);
    } catch (error) {
      this.sendError(res, 500, "Failed to get justifications by feature", error);
    }
  }

  private async handleFileHierarchyJustifications(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const filePath = decodeURIComponent(params.pathParams.filePath!);

    const cozoViewer = this.viewer as CozoGraphViewer;
    if (typeof cozoViewer.getFileHierarchyJustifications !== "function") {
      this.sendError(res, 501, "File hierarchy justification query not available");
      return;
    }

    try {
      const hierarchy = await cozoViewer.getFileHierarchyJustifications(filePath);
      this.sendJSON(res, hierarchy);
    } catch (error) {
      this.sendError(res, 500, "Failed to get file hierarchy justifications", error);
    }
  }

  private async handleGetJustificationChildren(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const entityId = params.pathParams.entityId!;

    const cozoViewer = this.viewer as CozoGraphViewer;
    if (typeof cozoViewer.getJustificationChildren !== "function") {
      this.sendError(res, 501, "Justification children query not available");
      return;
    }

    try {
      const children = await cozoViewer.getJustificationChildren(entityId);
      this.sendJSON(res, children);
    } catch (error) {
      this.sendError(res, 500, "Failed to get justification children", error);
    }
  }

  private async handleGetJustificationAncestors(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const entityId = params.pathParams.entityId!;

    const cozoViewer = this.viewer as CozoGraphViewer;
    if (typeof cozoViewer.getJustificationAncestors !== "function") {
      this.sendError(res, 501, "Justification ancestors query not available");
      return;
    }

    try {
      const ancestors = await cozoViewer.getJustificationAncestors(entityId);
      this.sendJSON(res, ancestors);
    } catch (error) {
      this.sendError(res, 500, "Failed to get justification ancestors", error);
    }
  }

  // ===========================================================================
  // API Handlers - Classification (Unified via Justification)
  // ===========================================================================

  private async handleClassificationStats(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    try {
      // Get all justifications to count by category
      const justifications = await this.viewer.listJustifications({ limit: 10000 });
      const stats = await this.viewer.getJustificationStats();

      // Count by category
      const byCategory: Record<string, number> = {
        domain: 0,
        infrastructure: 0,
        unknown: 0,
      };

      const bySubCategory: Record<string, number> = {};

      for (const j of justifications) {
        const category = j.category || "unknown";
        byCategory[category] = (byCategory[category] || 0) + 1;

        // Count subcategories (domain areas or architectural patterns)
        const subCategory = j.category === "domain" ? j.domain : j.architecturalPattern;
        if (subCategory) {
          bySubCategory[subCategory] = (bySubCategory[subCategory] || 0) + 1;
        }
      }

      // Add unclassified entities
      byCategory.unknown = stats.totalEntities - justifications.length;

      this.sendJSON(res, {
        total: justifications.length,
        byCategory,
        bySubCategory,
      });
    } catch (error) {
      this.sendError(res, 500, "Failed to get classification stats", error);
    }
  }

  private async handleListClassifications(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const limit = parseInt(params.query.get("limit") || "100", 10);
    const offset = parseInt(params.query.get("offset") || "0", 10);

    try {
      const justifications = await this.viewer.listJustifications({ limit, offset });

      // Map to old classification format
      const mapped = justifications.map(j => ({
        entityId: j.entityId,
        category: j.category || "unknown",
        primaryLabel: j.category === 'domain' ? j.domain : j.architecturalPattern,
        confidence: j.confidenceScore,
        metadata: {
          area: j.domain,
          layer: j.architecturalPattern
        },
        classifiedAt: j.updatedAt,
        modelId: "unified-analysis"
      }));

      this.sendJSON(res, mapped);
    } catch (error) {
      this.sendError(res, 500, "Failed to list classifications", error);
    }
  }

  private async handleSearchClassifications(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const query = params.query.get("q") || "";
    const limit = parseInt(params.query.get("limit") || "50", 10);

    if (!query) {
      this.sendJSON(res, []);
      return;
    }

    try {
      const results = await this.viewer.searchJustifications(query, limit);

      const mapped = results.map(j => ({
        entityId: j.entityId,
        category: j.category || "unknown",
        primaryLabel: j.category === 'domain' ? j.domain : j.architecturalPattern,
        confidence: j.confidenceScore,
        metadata: {
          area: j.domain,
          layer: j.architecturalPattern
        },
        classifiedAt: j.updatedAt,
        modelId: "unified-analysis"
      }));

      this.sendJSON(res, mapped);
    } catch (error) {
      this.sendError(res, 500, "Failed to search classifications", error);
    }
  }

  // Deprecated handlers removed (stubs for safety)
  private async handleClassificationsByDomain(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    this.sendJSON(res, []);
  }

  private async handleClassificationsByInfrastructure(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    this.sendJSON(res, []);
  }

  private async handleGetClassification(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    const entityId = params.pathParams.entityId!;

    try {
      const j = await this.viewer.getJustification(entityId);
      if (!j) {
        this.sendJSON(res, null);
        return;
      }

      this.sendJSON(res, {
        entityId: j.entityId,
        category: j.category || "unknown",
        primaryLabel: j.category === 'domain' ? j.domain : j.architecturalPattern,
        confidence: j.confidenceScore,
        metadata: {
          area: j.domain,
          layer: j.architecturalPattern
        },
        classifiedAt: j.updatedAt,
        modelId: "unified-analysis"
      });
    } catch (error) {
      this.sendError(res, 500, "Failed to get classification", error);
    }
  }

  // ===========================================================================
  // API Handlers - Change Ledger (Observability)
  // ===========================================================================

  private async handleLedgerStats(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    if (!this.changeLedger) {
      this.sendJSON(res, { error: "Change ledger not available" }, 503);
      return;
    }

    try {
      const [entryCount, oldest, newest] = await Promise.all([
        this.changeLedger.getEntryCount(),
        this.changeLedger.getOldestTimestamp(),
        this.changeLedger.getNewestTimestamp(),
      ]);

      this.sendJSON(res, {
        entryCount,
        oldestTimestamp: oldest,
        newestTimestamp: newest,
        currentSequence: this.changeLedger.getCurrentSequence(),
      });
    } catch (error) {
      this.sendError(res, 500, "Failed to get ledger stats", error);
    }
  }

  private async handleQueryLedger(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.changeLedger) {
      this.sendJSON(res, { error: "Change ledger not available" }, 503);
      return;
    }

    const limit = parseInt(params.query.get("limit") || "100", 10);
    const offset = parseInt(params.query.get("offset") || "0", 10);
    const eventTypes = params.query.get("eventTypes")?.split(",") as LedgerEventType[] | undefined;
    const sources = params.query.get("sources")?.split(",") as EventSource[] | undefined;
    const startTime = params.query.get("startTime") || undefined;
    const endTime = params.query.get("endTime") || undefined;

    const query: LedgerQuery = {
      limit,
      offset,
      eventTypes,
      sources,
      startTime,
      endTime,
    };

    try {
      const entries = await this.changeLedger.query(query);
      this.sendJSON(res, entries);
    } catch (error) {
      this.sendError(res, 500, "Failed to query ledger", error);
    }
  }

  private async handleRecentLedgerEntries(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.changeLedger) {
      this.sendJSON(res, { error: "Change ledger not available" }, 503);
      return;
    }

    const limit = parseInt(params.query.get("limit") || "50", 10);

    try {
      const entries = await this.changeLedger.getRecent(limit);
      this.sendJSON(res, entries);
    } catch (error) {
      this.sendError(res, 500, "Failed to get recent ledger entries", error);
    }
  }

  private async handleLedgerTimeline(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.changeLedger) {
      this.sendJSON(res, { error: "Change ledger not available" }, 503);
      return;
    }

    const limit = parseInt(params.query.get("limit") || "100", 10);
    const offset = parseInt(params.query.get("offset") || "0", 10);
    const startTime = params.query.get("startTime") || undefined;
    const endTime = params.query.get("endTime") || undefined;

    try {
      const timeline = await this.changeLedger.getTimeline({
        limit,
        offset,
        startTime,
        endTime,
      });
      this.sendJSON(res, timeline);
    } catch (error) {
      this.sendError(res, 500, "Failed to get ledger timeline", error);
    }
  }

  private async handleLedgerAggregations(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.changeLedger) {
      this.sendJSON(res, { error: "Change ledger not available" }, 503);
      return;
    }

    const startTime = params.query.get("startTime") || undefined;
    const endTime = params.query.get("endTime") || undefined;

    try {
      const aggregations = await this.changeLedger.getAggregations({
        startTime,
        endTime,
      });
      this.sendJSON(res, aggregations);
    } catch (error) {
      this.sendError(res, 500, "Failed to get ledger aggregations", error);
    }
  }

  private async handleLedgerForEntity(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.changeLedger) {
      this.sendJSON(res, { error: "Change ledger not available" }, 503);
      return;
    }

    const entityId = params.pathParams.entityId!;
    const limit = parseInt(params.query.get("limit") || "50", 10);

    try {
      const entries = await this.changeLedger.getForEntity(entityId, limit);
      this.sendJSON(res, entries);
    } catch (error) {
      this.sendError(res, 500, "Failed to get ledger entries for entity", error);
    }
  }

  private async handleGetLedgerEntry(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.changeLedger) {
      this.sendJSON(res, { error: "Change ledger not available" }, 503);
      return;
    }

    const id = params.pathParams.id!;

    try {
      const entry = await this.changeLedger.getEntry(id);
      if (!entry) {
        this.sendError(res, 404, "Ledger entry not found");
        return;
      }
      this.sendJSON(res, entry);
    } catch (error) {
      this.sendError(res, 500, "Failed to get ledger entry", error);
    }
  }

  // ===========================================================================
  // API Handlers - Adaptive Indexer
  // ===========================================================================

  private async handleAdaptiveStats(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    if (!this.adaptiveIndexer) {
      this.sendJSON(res, { error: "Adaptive indexer not available" }, 503);
      return;
    }

    try {
      const stats = await this.adaptiveIndexer.getStats();
      this.sendJSON(res, {
        ...stats,
        isPaused: this.adaptiveIndexer.isPaused(),
        config: this.adaptiveIndexer.getConfig(),
      });
    } catch (error) {
      this.sendError(res, 500, "Failed to get adaptive indexer stats", error);
    }
  }

  private async handleHotEntities(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.adaptiveIndexer) {
      this.sendJSON(res, { error: "Adaptive indexer not available" }, 503);
      return;
    }

    const limit = parseInt(params.query.get("limit") || "20", 10);

    try {
      const hotEntities = await this.adaptiveIndexer.getHotEntities(limit);
      this.sendJSON(res, hotEntities);
    } catch (error) {
      this.sendError(res, 500, "Failed to get hot entities", error);
    }
  }

  private async handleColdEntities(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.adaptiveIndexer) {
      this.sendJSON(res, { error: "Adaptive indexer not available" }, 503);
      return;
    }

    const limit = parseInt(params.query.get("limit") || "20", 10);

    try {
      const coldEntities = await this.adaptiveIndexer.getColdEntities(limit);
      this.sendJSON(res, coldEntities);
    } catch (error) {
      this.sendError(res, 500, "Failed to get cold entities", error);
    }
  }

  private async handlePriorityQueue(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.adaptiveIndexer) {
      this.sendJSON(res, { error: "Adaptive indexer not available" }, 503);
      return;
    }

    const limit = parseInt(params.query.get("limit") || "50", 10);

    try {
      const queue = await this.adaptiveIndexer.getPriorityQueue(limit);
      this.sendJSON(res, queue);
    } catch (error) {
      this.sendError(res, 500, "Failed to get priority queue", error);
    }
  }

  private async handleListSessions(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.adaptiveIndexer) {
      this.sendJSON(res, { error: "Adaptive indexer not available" }, 503);
      return;
    }

    const limit = parseInt(params.query.get("limit") || "20", 10);

    try {
      const sessions = await this.adaptiveIndexer.listSessions(limit);
      this.sendJSON(res, sessions);
    } catch (error) {
      this.sendError(res, 500, "Failed to list sessions", error);
    }
  }

  private async handleGetSession(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.adaptiveIndexer) {
      this.sendJSON(res, { error: "Adaptive indexer not available" }, 503);
      return;
    }

    const id = params.pathParams.id!;

    try {
      const session = await this.adaptiveIndexer.getSession(id);
      if (!session) {
        this.sendError(res, 404, "Session not found");
        return;
      }

      // Get associated queries and changes for the session
      const [queries, changes] = await Promise.all([
        this.adaptiveIndexer.getQueriesForSession(id),
        this.adaptiveIndexer.getChangesForSession(id),
      ]);

      this.sendJSON(res, {
        ...session,
        queries,
        changes,
      });
    } catch (error) {
      this.sendError(res, 500, "Failed to get session", error);
    }
  }

  private async handleRecentQueries(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.adaptiveIndexer) {
      this.sendJSON(res, { error: "Adaptive indexer not available" }, 503);
      return;
    }

    const limit = parseInt(params.query.get("limit") || "50", 10);

    try {
      const queries = await this.adaptiveIndexer.getRecentQueries(limit);
      this.sendJSON(res, queries);
    } catch (error) {
      this.sendError(res, 500, "Failed to get recent queries", error);
    }
  }

  private async handleRecentChanges(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.adaptiveIndexer) {
      this.sendJSON(res, { error: "Adaptive indexer not available" }, 503);
      return;
    }

    const limit = parseInt(params.query.get("limit") || "50", 10);

    try {
      const changes = await this.adaptiveIndexer.getRecentChanges(limit);
      this.sendJSON(res, changes);
    } catch (error) {
      this.sendError(res, 500, "Failed to get recent changes", error);
    }
  }

  // ===========================================================================
  // API Handlers - Project Memory
  // ===========================================================================

  private async handleMemoryStats(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    if (!this.projectMemory) {
      this.sendJSON(res, { error: "Project memory not available" }, 503);
      return;
    }

    try {
      const stats = await this.projectMemory.getStats();
      this.sendJSON(res, stats);
    } catch (error) {
      this.sendError(res, 500, "Failed to get memory stats", error);
    }
  }

  private async handleListMemoryRules(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.projectMemory) {
      this.sendJSON(res, { error: "Project memory not available" }, 503);
      return;
    }

    const limit = parseInt(params.query.get("limit") || "100", 10);
    const offset = parseInt(params.query.get("offset") || "0", 10);
    const scope = params.query.get("scope") as MemoryRuleScope | undefined;
    const category = params.query.get("category") as MemoryRuleCategory | undefined;
    const isActive = params.query.get("isActive") === "true" ? true : params.query.get("isActive") === "false" ? false : undefined;
    const minConfidence = params.query.get("minConfidence") ? parseFloat(params.query.get("minConfidence")!) : undefined;

    const query: MemoryQuery = { limit, offset, scope, category, isActive, minConfidence };

    try {
      const rules = await this.projectMemory.listRules(query);
      this.sendJSON(res, rules);
    } catch (error) {
      this.sendError(res, 500, "Failed to list memory rules", error);
    }
  }

  private async handleGetMemoryRule(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.projectMemory) {
      this.sendJSON(res, { error: "Project memory not available" }, 503);
      return;
    }

    const id = params.pathParams.id!;

    try {
      const rule = await this.projectMemory.getRule(id);
      if (!rule) {
        this.sendError(res, 404, "Memory rule not found");
        return;
      }
      this.sendJSON(res, rule);
    } catch (error) {
      this.sendError(res, 500, "Failed to get memory rule", error);
    }
  }

  private async handleGetRelevantMemories(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.projectMemory) {
      this.sendJSON(res, { error: "Project memory not available" }, 503);
      return;
    }

    const context = params.query.get("context") || "";
    const filePath = params.query.get("filePath") || undefined;
    const entityType = params.query.get("entityType") || undefined;
    const limit = parseInt(params.query.get("limit") || "10", 10);

    try {
      const rules = await this.projectMemory.getRelevantMemories({
        context,
        filePath,
        entityType,
        limit,
      });
      this.sendJSON(res, {
        rules,
        formatted: this.projectMemory.formatForPrompt(rules),
      });
    } catch (error) {
      this.sendError(res, 500, "Failed to get relevant memories", error);
    }
  }

  private async handleGetMemoriesForFile(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.projectMemory) {
      this.sendJSON(res, { error: "Project memory not available" }, 503);
      return;
    }

    const filePath = decodeURIComponent(params.pathParams.filePath!);

    try {
      const rules = await this.projectMemory.getMemoriesForFile(filePath);
      this.sendJSON(res, rules);
    } catch (error) {
      this.sendError(res, 500, "Failed to get memories for file", error);
    }
  }

  // ===========================================================================
  // API Handlers - Ledger Compaction
  // ===========================================================================

  private async handleCompactionStats(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    if (!this.ledgerCompaction) {
      this.sendJSON(res, { error: "Ledger compaction not available" }, 503);
      return;
    }

    try {
      const stats = await this.ledgerCompaction.getStats();
      this.sendJSON(res, stats);
    } catch (error) {
      this.sendError(res, 500, "Failed to get compaction stats", error);
    }
  }

  private async handleListCompactedEntries(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.ledgerCompaction) {
      this.sendJSON(res, { error: "Ledger compaction not available" }, 503);
      return;
    }

    const limit = parseInt(params.query.get("limit") || "50", 10);
    const offset = parseInt(params.query.get("offset") || "0", 10);
    const source = params.query.get("source") as CompactedEntryQuery["source"] | undefined;
    const intentCategory = params.query.get("intentCategory") as CompactedEntryQuery["intentCategory"] | undefined;
    const startTime = params.query.get("startTime") || undefined;
    const endTime = params.query.get("endTime") || undefined;

    const query: CompactedEntryQuery = { limit, offset, source, intentCategory, startTime, endTime };

    try {
      const entries = await this.ledgerCompaction.query(query);
      this.sendJSON(res, entries);
    } catch (error) {
      this.sendError(res, 500, "Failed to list compacted entries", error);
    }
  }

  private async handleGetCompactedEntry(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.ledgerCompaction) {
      this.sendJSON(res, { error: "Ledger compaction not available" }, 503);
      return;
    }

    const id = params.pathParams.id!;

    try {
      const entry = await this.ledgerCompaction.getEntry(id);
      if (!entry) {
        this.sendError(res, 404, "Compacted entry not found");
        return;
      }
      this.sendJSON(res, entry);
    } catch (error) {
      this.sendError(res, 500, "Failed to get compacted entry", error);
    }
  }

  private async handleCompactionTimeline(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.ledgerCompaction) {
      this.sendJSON(res, { error: "Ledger compaction not available" }, 503);
      return;
    }

    const limit = parseInt(params.query.get("limit") || "50", 10);
    const startTime = params.query.get("startTime") || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const endTime = params.query.get("endTime") || new Date().toISOString();

    try {
      const entries = await this.ledgerCompaction.getTimeline(startTime, endTime, limit);
      this.sendJSON(res, entries);
    } catch (error) {
      this.sendError(res, 500, "Failed to get compaction timeline", error);
    }
  }

  private async handleCompactedEntryForSession(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    params: RouteParams
  ): Promise<void> {
    if (!this.ledgerCompaction) {
      this.sendJSON(res, { error: "Ledger compaction not available" }, 503);
      return;
    }

    const sessionId = params.pathParams.sessionId!;

    try {
      const entry = await this.ledgerCompaction.getEntryForSession(sessionId);
      if (!entry) {
        this.sendJSON(res, null);
        return;
      }
      this.sendJSON(res, entry);
    } catch (error) {
      this.sendError(res, 500, "Failed to get compacted entry for session", error);
    }
  }

  // ===========================================================================
  // API Handlers - Reconciliation
  // ===========================================================================

  private async handleReconciliationStatus(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    if (!this.reconciliationWorker) {
      this.sendJSON(res, { error: "Reconciliation worker not available" }, 503);
      return;
    }

    try {
      const [needsReconciliation, lastSyncedCommit, config] = await Promise.all([
        this.reconciliationWorker.needsReconciliation(),
        this.reconciliationWorker.getLastSyncedCommit(),
        Promise.resolve(this.reconciliationWorker.getConfig()),
      ]);

      this.sendJSON(res, {
        isReady: this.reconciliationWorker.isReady,
        needsReconciliation,
        lastSyncedCommit,
        config: {
          repoPath: config.repoPath,
          defaultBranch: config.defaultBranch,
          autoReconcileOnStartup: config.autoReconcileOnStartup,
        },
      });
    } catch (error) {
      this.sendError(res, 500, "Failed to get reconciliation status", error);
    }
  }

  private async handleDetectGaps(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    if (!this.reconciliationWorker) {
      this.sendJSON(res, { error: "Reconciliation worker not available" }, 503);
      return;
    }

    try {
      const gaps = await this.reconciliationWorker.detectGaps();
      this.sendJSON(res, gaps);
    } catch (error) {
      this.sendError(res, 500, "Failed to detect gaps", error);
    }
  }

  private async handleValidateLedgerIntegrity(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    if (!this.reconciliationWorker) {
      this.sendJSON(res, { error: "Reconciliation worker not available" }, 503);
      return;
    }

    try {
      const validation = await this.reconciliationWorker.validateLedgerIntegrity();
      this.sendJSON(res, validation);
    } catch (error) {
      this.sendError(res, 500, "Failed to validate ledger integrity", error);
    }
  }

  // ===========================================================================
  // API Handlers - Operations
  // ===========================================================================

  private async handleOperationReindex(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    try {
      // Parse body
      const body = await this.parseBody(req);
      const { path } = body as { path?: string };

      // For now, return a message that reindexing is handled externally
      this.sendJSON(res, {
        status: "accepted",
        message: path
          ? `Reindex requested for path: ${path}. Use CLI 'code-synapse index' to reindex.`
          : "Full reindex requested. Use CLI 'code-synapse index' to reindex.",
      });
    } catch (error) {
      this.sendError(res, 500, "Failed to trigger reindex", error);
    }
  }

  private async handleOperationJustify(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    try {
      const body = await this.parseBody(req);
      const { entityId, force } = body as { entityId?: string; force?: boolean };

      // For now, return a message that justification is handled externally
      this.sendJSON(res, {
        status: "accepted",
        message: entityId
          ? `Justification requested for entity: ${entityId}. Use CLI 'code-synapse justify' to run justification.`
          : "Full justification requested. Use CLI 'code-synapse justify' to run justification.",
      });
    } catch (error) {
      this.sendError(res, 500, "Failed to trigger justification", error);
    }
  }

  private async handleOperationClassify(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    // Deprecated
    try {
      this.sendJSON(res, {
        status: "deprecated",
        message: "Explicit classification is deprecated. Use 'justify' instead."
      });
    } catch (error) {
      this.sendError(res, 500, "Error", error);
    }
  }

  private parseBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
      req.on('error', reject);
    });
  }

  // ===========================================================================
  // Server Lifecycle
  // ===========================================================================

  async start(config: ServerConfig): Promise<void> {
    const { port, host = "127.0.0.1" } = config;

    // Ensure viewer is initialized
    if (!this.viewer.isReady) {
      await this.viewer.initialize();
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((error) => {
          console.error("[Viewer] Request error:", error);
          this.sendError(res, 500, "Internal Server Error");
        });
      });

      this.server.on("error", reject);

      this.server.listen(port, host, () => {
        console.log(`[Viewer] Server started at http://${host}:${port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log("[Viewer] Server stopped");
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create and start a viewer server
 *
 * @param viewer - The IGraphViewer instance
 * @param port - Port to listen on (default: 3100)
 * @param host - Host to bind to (default: 127.0.0.1)
 * @param options - Optional services for extended functionality
 */
export async function startViewerServer(
  viewer: IGraphViewer,
  port: number = 3100,
  host: string = "127.0.0.1",
  options?: ViewerServerOptions
): Promise<ViewerServer> {
  const server = new ViewerServer(viewer, options);
  await server.start({ port, host });
  return server;
}

/**
 * Options for starting viewer server with extended services
 */
export type { ViewerServerOptions };

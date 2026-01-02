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
import type { IGraphViewer } from "../interfaces/IGraphViewer.js";
import type { CozoGraphViewer } from "../impl/CozoGraphViewer.js";

// =============================================================================
// Types
// =============================================================================

interface ServerConfig {
  port: number;
  host?: string;
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

  constructor(viewer: IGraphViewer) {
    this.viewer = viewer;

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
    this.addRoute("GET", "/api/files/:id", this.handleGetFile.bind(this));
    this.addRoute("GET", "/api/files/:id/imports", this.handleGetFileImports.bind(this));
    this.addRoute("GET", "/api/files/:id/importers", this.handleGetFileImporters.bind(this));

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
    this.addRoute("GET", "/api/nl-search", this.handleNLSearch.bind(this));
    this.addRoute("GET", "/api/nl-search/patterns", this.handleNLSearchPatterns.bind(this));

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
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
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
    this.sendJSON(res, functions);
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
    this.sendJSON(res, classes);
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
    this.sendJSON(res, interfaces);
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

  // ===========================================================================
  // API Handlers - Health
  // ===========================================================================

  private async handleHealth(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    _params: RouteParams
  ): Promise<void> {
    const health = await this.viewer.getIndexHealth();
    this.sendJSON(res, health);
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
 */
export async function startViewerServer(
  viewer: IGraphViewer,
  port: number = 3100,
  host: string = "127.0.0.1"
): Promise<ViewerServer> {
  const server = new ViewerServer(viewer);
  await server.start({ port, host });
  return server;
}

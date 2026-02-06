/**
 * Zoekt Process Manager (Hybrid Search Phase 2)
 *
 * Manages the Zoekt webserver subprocess for lexical/regex code search.
 * Supports configurable port, health check, and optional crash recovery.
 *
 * @module
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("zoekt-manager");

// =============================================================================
// Types
// =============================================================================

export interface ZoektManagerOptions {
  /** Repository (or project) root to index */
  repoRoot: string;
  /** Data directory for Zoekt index and binaries */
  dataDir: string;
  /** Port for zoekt-webserver (default 6070) */
  port?: number;
  /** Directory containing zoekt-webserver and zoekt-git-index binaries (default: dataDir/bin) */
  binDir?: string;
}

export interface ZoektSearchOptions {
  /** File glob/regex pattern to restrict search */
  filePattern?: string;
  /** Maximum number of results (default 20) */
  maxResults?: number;
}

/** Single file match from Zoekt search */
export interface ZoektFileMatch {
  fileName: string;
  repository: string;
  branches?: string[];
  lineMatches: Array<{
    lineNumber: number;
    line: string;
    matchRanges?: Array<{ start: number; end: number }>;
  }>;
}

/** Result of a Zoekt search */
export interface ZoektSearchResult {
  results: ZoektFileMatch[];
  stats?: {
    durationMs?: number;
    fileCount?: number;
    matchCount?: number;
  };
  error?: string;
}

// Zoekt webserver search response (format=json): Result has FileMatches with LineMatches
interface ZoektSearchResponse {
  Result?: {
    FileMatches?: Array<{
      FileName: string;
      Repository: string;
      Branches?: string[];
      LineMatches?: Array<{
        LineNumber: number;
        Line: string;
        Matches?: Array<{ Start: number; End: number }>;
      }>;
    }>;
    Stats?: {
      Duration?: number;
      FileCount?: number;
      MatchCount?: number;
    };
  };
}

// =============================================================================
// ZoektManager
// =============================================================================

const DEFAULT_PORT = 6070;
const HEALTH_TIMEOUT_MS = 5000;
const REINDEX_DEBOUNCE_MS = 30_000;

export class ZoektManager {
  private webserver: ChildProcess | null = null;
  private readonly indexDir: string;
  private readonly port: number;
  private readonly binDir: string;
  private readonly repoRoot: string;
  private started = false;

  constructor(options: ZoektManagerOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.port = options.port ?? DEFAULT_PORT;
    this.binDir = options.binDir ?? path.join(options.dataDir, "bin");
    this.indexDir = path.join(options.dataDir, "zoekt-index");
  }

  /**
   * Start the Zoekt webserver. Ensures index dir exists and port is free.
   */
  async start(): Promise<void> {
    if (this.started && this.webserver) {
      return;
    }

    if (!(await this.isPortFree(this.port))) {
      throw new Error(`Port ${this.port} is already in use. Zoekt webserver cannot start.`);
    }

    fs.mkdirSync(this.indexDir, { recursive: true });

    const webserverBin = this.getBinaryPath("zoekt-webserver");
    if (!webserverBin) {
      throw new Error(
        "zoekt-webserver binary not found. Run scripts/setup-zoekt.sh or set ZOEKT_BIN_DIR."
      );
    }

    this.webserver = spawn(webserverBin, ["-listen", `:${this.port}`, "-index", this.indexDir], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: this.repoRoot,
    });

    this.webserver.stdout?.on("data", (data: Buffer) => {
      logger.debug({ data: data.toString().trim() }, "Zoekt stdout");
    });
    this.webserver.stderr?.on("data", (data: Buffer) => {
      logger.debug({ data: data.toString().trim() }, "Zoekt stderr");
    });
    this.webserver.on("exit", (code, signal) => {
      if (this.started && code !== 0 && code !== null) {
        logger.warn({ code, signal }, "Zoekt webserver exited unexpectedly");
      }
      this.webserver = null;
    });

    try {
      await this.waitForReady(HEALTH_TIMEOUT_MS);
      this.started = true;
      logger.info({ port: this.port, indexDir: this.indexDir }, "Zoekt webserver started");
    } catch (e) {
      this.stop();
      throw e;
    }
  }

  /**
   * Stop the Zoekt webserver.
   */
  stop(): void {
    this.started = false;
    if (this.webserver) {
      this.webserver.kill("SIGTERM");
      this.webserver = null;
      logger.debug({ port: this.port }, "Zoekt webserver stopped");
    }
  }

  /**
   * Health check with exponential backoff. Tries GET / or /healthz.
   */
  private async waitForReady(timeoutMs: number = HEALTH_TIMEOUT_MS): Promise<void> {
    const start = Date.now();
    let delay = 100;
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/healthz`);
        if (res.ok) return;
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 500);
    }
    throw new Error("Zoekt webserver failed to become ready within timeout");
  }

  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close();
        resolve(true);
      });
      server.listen(port, "127.0.0.1");
    });
  }

  /**
   * Resolve binary path: binDir/name, or PATH.
   */
  private getBinaryPath(name: string): string | null {
    const inBin = path.join(this.binDir, name);
    if (fs.existsSync(inBin)) {
      try {
        fs.accessSync(inBin, fs.constants.X_OK);
        return inBin;
      } catch {
        return null;
      }
    }
    // Fallback to PATH (e.g. from go install without GOBIN)
    const fromPath = process.env.PATH?.split(path.delimiter).find((p) => {
      const full = path.join(p.trim(), name);
      try {
        return fs.existsSync(full) && fs.accessSync(full, fs.constants.X_OK) === undefined;
      } catch {
        return false;
      }
    });
    return fromPath ? path.join(fromPath, name) : null;
  }

  /**
   * Reindex the repository. Runs zoekt-git-index (or zoekt-index) if available.
   * Safe to call when binary is missing (no-op).
   */
  async reindex(): Promise<void> {
    const gitIndexBin = this.getBinaryPath("zoekt-git-index");
    if (!gitIndexBin) {
      logger.debug("zoekt-git-index not found; skip reindex (run scripts/setup-zoekt.sh)");
      return;
    }
    const gitDir = path.join(this.repoRoot, ".git");
    if (!fs.existsSync(gitDir)) {
      logger.debug({ repoRoot: this.repoRoot }, "Not a git repo; skip Zoekt reindex");
      return;
    }
    return new Promise((resolve, reject) => {
      const child = spawn(
        gitIndexBin,
        ["-index", this.indexDir, this.repoRoot],
        { stdio: ["ignore", "pipe", "pipe"], cwd: this.repoRoot }
      );
      let stderr = "";
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("exit", (code) => {
        if (code === 0) {
          logger.info({ repoRoot: this.repoRoot }, "Zoekt reindex completed");
          resolve();
        } else {
          logger.warn({ code, stderr: stderr.slice(0, 500) }, "Zoekt reindex failed");
          resolve(); // non-fatal
        }
      });
      child.on("error", (err) => {
        logger.warn({ err }, "Zoekt reindex spawn error");
        resolve();
      });
    });
  }

  /**
   * Search using Zoekt. GET /search?q=...&format=json&num=...
   * Returns empty results if webserver is not running or request fails.
   */
  async search(query: string, opts: ZoektSearchOptions = {}): Promise<ZoektSearchResult> {
    const maxResults = opts.maxResults ?? 20;
    if (!this.webserver || !this.started) {
      return { results: [], error: "Zoekt webserver not running" };
    }

    try {
      const url = new URL(`http://127.0.0.1:${this.port}/search`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("num", String(maxResults));
      if (opts.filePattern) {
        url.searchParams.set("f", opts.filePattern);
      }

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        return { results: [], error: `Zoekt returned ${res.status}` };
      }

      const data = (await res.json()) as ZoektSearchResponse;
      const result = data.Result;
      if (!result?.FileMatches) {
        return { results: [], stats: {} };
      }

      const results: ZoektFileMatch[] = result.FileMatches.map((f) => ({
        fileName: f.FileName,
        repository: f.Repository,
        branches: f.Branches,
        lineMatches: (f.LineMatches ?? []).map((m) => ({
          lineNumber: m.LineNumber,
          line: m.Line,
          matchRanges: m.Matches?.map((r) => ({ start: r.Start, end: r.End })),
        })),
      }));

      const stats = result.Stats
        ? {
            durationMs: result.Stats.Duration,
            fileCount: result.Stats.FileCount,
            matchCount: result.Stats.MatchCount,
          }
        : undefined;

      return { results, stats };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, query }, "Zoekt search failed");
      return { results: [], error: msg };
    }
  }

  getPort(): number {
    return this.port;
  }

  isStarted(): boolean {
    return this.started && this.webserver !== null;
  }
}

/** Debounce interval for reindex (ms). */
export const ZOEKT_REINDEX_DEBOUNCE_MS = REINDEX_DEBOUNCE_MS;

/**
 * Parser Worker
 *
 * Specialized worker pool for parallel file parsing with:
 * - AST caching
 * - Language-aware batching
 * - Incremental parsing support
 */

import type { IWorkerTask, IWorkerResult } from "../interfaces/IOptimization.js";
import { InProcessWorkerPool, type WorkerPoolConfig } from "./WorkerPool.js";
import { LRUCache } from "../cache/LRUCache.js";
import type { UCEEntity } from "../../../types/index.js";

// =============================================================================
// Parser Task Types
// =============================================================================

export interface ParserTaskInput {
  filePath: string;
  content: string;
  language: string;
  previousHash?: string;
}

export interface ParserTaskOutput {
  filePath: string;
  ast: unknown;
  entities: UCEEntity[];
  parseTimeMs: number;
  fromCache: boolean;
}

// =============================================================================
// Parser Worker Pool
// =============================================================================

export interface ParserWorkerConfig extends Partial<WorkerPoolConfig> {
  astCacheSize?: number;
  astCacheTtlMs?: number;
  enableIncrementalParsing?: boolean;
}

export class ParserWorkerPool {
  private pool: InProcessWorkerPool<ParserTaskInput, ParserTaskOutput>;
  private astCache: LRUCache<string, { ast: unknown; hash: string }>;
  private config: Required<ParserWorkerConfig>;
  private parser: unknown; // Will be injected

  constructor(
    parserFactory: () => Promise<unknown>,
    config: ParserWorkerConfig = {}
  ) {
    this.config = {
      minWorkers: config.minWorkers ?? 2,
      maxWorkers: config.maxWorkers ?? 8,
      taskTimeoutMs: config.taskTimeoutMs ?? 30000,
      maxQueueSize: config.maxQueueSize ?? 500,
      idleTimeoutMs: config.idleTimeoutMs ?? 60000,
      astCacheSize: config.astCacheSize ?? 500,
      astCacheTtlMs: config.astCacheTtlMs ?? 600000, // 10 minutes
      enableIncrementalParsing: config.enableIncrementalParsing ?? true,
    };

    this.astCache = new LRUCache({
      maxSize: this.config.astCacheSize,
      defaultTtlMs: this.config.astCacheTtlMs,
    });

    // Create pool with parsing executor
    this.pool = new InProcessWorkerPool(
      async (input: ParserTaskInput) => this.parseFile(input),
      {
        minWorkers: this.config.minWorkers,
        maxWorkers: this.config.maxWorkers,
        taskTimeoutMs: this.config.taskTimeoutMs,
        maxQueueSize: this.config.maxQueueSize,
        idleTimeoutMs: this.config.idleTimeoutMs,
      }
    );

    // Initialize parser
    parserFactory().then((p) => {
      this.parser = p;
    });
  }

  async initialize(): Promise<void> {
    await this.pool.initialize();
  }

  async parseFiles(
    files: Array<{ path: string; content: string; language: string; hash?: string }>
  ): Promise<ParserTaskOutput[]> {
    const tasks: IWorkerTask<ParserTaskInput, ParserTaskOutput>[] = files.map(
      (file, index) => ({
        id: `parse-${index}-${file.path}`,
        type: "parse",
        input: {
          filePath: file.path,
          content: file.content,
          language: file.language,
          previousHash: file.hash,
        },
        priority: this.getFilePriority(file.path),
      })
    );

    const results = await this.pool.submitBatch(tasks);
    return results
      .filter((r): r is IWorkerResult<ParserTaskOutput> & { output: ParserTaskOutput } =>
        r.success && r.output !== undefined
      )
      .map((r) => r.output);
  }

  async parseFile(input: ParserTaskInput): Promise<ParserTaskOutput> {
    const startTime = Date.now();
    const contentHash = this.hashContent(input.content);

    // Check AST cache
    const cached = this.astCache.get(input.filePath);
    if (cached && cached.hash === contentHash) {
      return {
        filePath: input.filePath,
        ast: cached.ast,
        entities: [],
        parseTimeMs: Date.now() - startTime,
        fromCache: true,
      };
    }

    // Parse the file
    const ast = await this.doParse(input.content, input.language);
    const entities = await this.extractEntities(ast, input.filePath, input.language);

    // Cache the AST
    this.astCache.set(input.filePath, { ast, hash: contentHash });

    return {
      filePath: input.filePath,
      ast,
      entities,
      parseTimeMs: Date.now() - startTime,
      fromCache: false,
    };
  }

  getStats() {
    return {
      pool: this.pool.stats(),
      cache: this.astCache.stats(),
    };
  }

  async shutdown(): Promise<void> {
    await this.pool.shutdown();
    this.astCache.clear();
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private async doParse(content: string, _language: string): Promise<unknown> {
    // This would use the actual parser
    // For now, return a placeholder
    if (!this.parser) {
      throw new Error("Parser not initialized");
    }
    return { type: "ast", content: content.substring(0, 100) };
  }

  private async extractEntities(
    _ast: unknown,
    _filePath: string,
    _language: string
  ): Promise<UCEEntity[]> {
    // This would use the actual extractor
    // For now, return empty array
    return [];
  }

  private hashContent(content: string): string {
    // Simple hash for content comparison
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private getFilePriority(filePath: string): number {
    // Prioritize certain file types
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return 10;
    if (filePath.endsWith(".js") || filePath.endsWith(".jsx")) return 8;
    if (filePath.includes("/src/")) return 5;
    if (filePath.includes("/test/") || filePath.includes("/__tests__/")) return 3;
    return 1;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createParserWorkerPool(
  parserFactory: () => Promise<unknown>,
  config?: ParserWorkerConfig
): ParserWorkerPool {
  return new ParserWorkerPool(parserFactory, config);
}

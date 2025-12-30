/**
 * Indexer - Orchestrates the knowledge graph indexing
 * Coordinates parser, graph, vector, and LLM services
 */

import type { ProjectConfig } from "../../types/index.js";
import { createParser, type Parser } from "../parser/index.js";
import { createGraphStore, type GraphStore } from "../graph/index.js";
import { createVectorStore, type VectorStore } from "../vector/index.js";
import { createEmbeddingService, type EmbeddingService } from "../embeddings/index.js";

export interface IndexerOptions {
  config: ProjectConfig;
  dataDir: string;
}

export class Indexer {
  private options: IndexerOptions;
  private parser: Parser;
  private graphStore: GraphStore;
  private vectorStore: VectorStore;
  private embeddingService: EmbeddingService;

  constructor(options: IndexerOptions) {
    this.options = options;
    this.parser = createParser(options.config);
    this.graphStore = createGraphStore(`${options.dataDir}/graph`);
    this.vectorStore = createVectorStore(`${options.dataDir}/vectors`);
    this.embeddingService = createEmbeddingService();
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.parser.initialize(),
      this.graphStore.initialize(),
      this.vectorStore.initialize(),
      this.embeddingService.initialize(),
    ]);
  }

  async close(): Promise<void> {
    await Promise.all([
      this.graphStore.close(),
      this.vectorStore.close(),
    ]);
  }

  async indexProject(): Promise<void> {
    // TODO: Full project indexing
    throw new Error("Not implemented");
  }

  async indexFile(_filePath: string): Promise<void> {
    // TODO: Index single file (for incremental updates)
    throw new Error("Not implemented");
  }

  async removeFile(_filePath: string): Promise<void> {
    // TODO: Remove file from index
    throw new Error("Not implemented");
  }
}

export function createIndexer(options: IndexerOptions): Indexer {
  return new Indexer(options);
}

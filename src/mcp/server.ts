/**
 * MCP Server implementation
 * Handles communication with AI agents via Model Context Protocol
 */

import type { ProjectConfig } from "../types/index.js";
import { createIndexer, type Indexer } from "../core/index.js";

export interface ServerOptions {
  port: number;
  config: ProjectConfig;
  dataDir: string;
}

let indexer: Indexer | null = null;

export async function startServer(options: ServerOptions): Promise<void> {
  const { port, config, dataDir } = options;

  // Initialize the indexer
  indexer = createIndexer({
    config,
    dataDir,
  });

  await indexer.initialize();

  // TODO: Implement MCP server using @modelcontextprotocol/sdk
  // The server will expose tools for:
  // - Querying the knowledge graph
  // - Semantic search
  // - Getting symbol references
  // - Understanding code dependencies

  console.log(`MCP Server listening on port ${port}`);

  // Keep the process running
  await new Promise(() => {});
}

export async function stopServer(): Promise<void> {
  if (indexer) {
    await indexer.close();
    indexer = null;
  }
}

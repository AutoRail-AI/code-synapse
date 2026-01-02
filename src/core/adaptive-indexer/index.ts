/**
 * Adaptive Indexer Module
 *
 * MCP-driven adaptive indexing that observes queries and changes,
 * correlates them semantically, and triggers intelligent re-indexing.
 *
 * @module
 */

// Models
export * from "./models/indexing-context.js";

// Interfaces
export * from "./interfaces/IAdaptiveIndexer.js";

// Implementation
export { MCPAdaptiveIndexer, createAdaptiveIndexer } from "./impl/MCPAdaptiveIndexer.js";

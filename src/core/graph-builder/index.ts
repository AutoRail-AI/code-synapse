/**
 * Graph Builder Module
 *
 * Provides atomic writes and incremental updates for the knowledge graph.
 *
 * @module
 */

// GraphWriter - atomic entity writes
export {
  GraphWriter,
  createGraphWriter,
  type WriteResult,
  type GraphWriterOptions,
} from "./graph-writer.js";

// IncrementalUpdater - smart file updates
export {
  IncrementalUpdater,
  createIncrementalUpdater,
  type GraphFileChange,
  type ChangeDetectionResult,
  type IncrementalUpdateResult,
  type GraphFileInfo,
  type IncrementalUpdaterOptions,
  type UpdateProgress,
} from "./incremental-updater.js";

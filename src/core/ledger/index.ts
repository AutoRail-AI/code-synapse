/**
 * Change Ledger Module
 *
 * Append-only log of all system events for observability,
 * debugging, and time-travel analysis.
 *
 * @module
 */

// Models
export * from "./models/ledger-events.js";
export * from "./models/compacted-entry.js";

// Interfaces
export * from "./interfaces/IChangeLedger.js";
export * from "./interfaces/ILedgerCompaction.js";

// Implementation
export {
  CozoChangeLedger,
  CozoLedgerStorage,
  createChangeLedger,
  createLedgerStorage,
} from "./impl/CozoChangeLedger.js";

export {
  LedgerCompactionService,
  CozoCompactionStorage,
  SimpleIntentAnalyzer,
  createLedgerCompaction,
  createCompactionStorage,
  createIntentAnalyzer,
} from "./impl/LedgerCompactionService.js";

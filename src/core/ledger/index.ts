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

// Interfaces
export * from "./interfaces/IChangeLedger.js";

// Implementation
export {
  CozoChangeLedger,
  CozoLedgerStorage,
  createChangeLedger,
  createLedgerStorage,
} from "./impl/CozoChangeLedger.js";

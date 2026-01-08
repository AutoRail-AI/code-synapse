/**
 * Reconciliation Module
 *
 * Reconciles missed changes when the system was offline, crashed,
 * or not yet deployed. Uses git history to detect and fill gaps.
 */

// Interfaces
export * from "./interfaces/IReconciliation.js";

// Implementation
export * from "./impl/ReconciliationWorker.js";

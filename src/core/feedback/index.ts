/**
 * Self-Optimizing Feedback Loop Module
 *
 * Observes model performance and automatically adjusts routing scores
 * to improve overall system quality, cost, and latency.
 *
 * Features:
 * - Automatic outcome recording
 * - Model statistics aggregation
 * - Performance-based score adjustments
 * - Automatic model disabling for consistently failing models
 * - Configurable thresholds and decay rates
 *
 * @module
 */

// Interfaces
export * from "./interfaces/IFeedback.js";

// Implementation
export * from "./impl/FeedbackLoop.js";

/**
 * Classification Module
 *
 * Business layer classification for code entities:
 * - Domain: Product/Feature/Business logic
 * - Infrastructure: Platform/Cross-cutting concerns
 *
 * @module
 */

// Models
export * from "./models/classification.js";

// Interfaces
export * from "./interfaces/IClassificationEngine.js";

// Storage
export { CozoClassificationStorage, createClassificationStorage } from "./storage/classification-storage.js";

// Implementation
export { LLMClassificationEngine, createClassificationEngine } from "./impl/LLMClassificationEngine.js";

/**
 * Horizontal Documentation Graph Module
 *
 * Links infrastructure code to official documentation, SDK references,
 * and version-specific resources.
 *
 * Features:
 * - Auto-discovery of documentation from imports
 * - Known documentation registry for common packages
 * - NPM metadata fetching for unknown packages
 * - Entity-documentation linking
 * - Documentation coverage statistics
 *
 * @module
 */

// Models
export * from "./models/documentation-models.js";

// Interfaces
export * from "./interfaces/IDocumentation.js";

// Storage
export * from "./storage/CozoDocumentationStorage.js";

// Implementation
export * from "./impl/DocumentationService.js";

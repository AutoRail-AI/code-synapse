/**
 * Runtime Validation Schemas
 *
 * Zod schemas for validating configuration and data at runtime.
 * Provides type-safe validation with automatic TypeScript type inference.
 *
 * @module
 */

import { z } from "zod";

// =============================================================================
// Language & Framework Schemas
// =============================================================================

/**
 * Supported programming languages
 */
export const LanguageSchema = z.enum([
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
  "ruby",
  "php",
  "csharp",
  "cpp",
  "c",
]);

export type Language = z.infer<typeof LanguageSchema>;

/**
 * Supported frameworks
 */
export const FrameworkSchema = z.enum([
  "nextjs",
  "react",
  "vue",
  "angular",
  "svelte",
  "express",
  "nestjs",
  "fastify",
  "koa",
  "django",
  "flask",
  "fastapi",
  "spring",
  "rails",
]);

export type Framework = z.infer<typeof FrameworkSchema>;

// =============================================================================
// Project Configuration Schema
// =============================================================================

/**
 * Project configuration schema
 */
export const ProjectConfigSchema = z.object({
  /** Project root directory (absolute path) */
  root: z.string().min(1),

  /** Primary language(s) used in the project */
  languages: z.array(z.string()).min(1),

  /** Detected framework (optional) */
  framework: z.string().optional(),

  /** Glob patterns for source files */
  sourcePatterns: z.array(z.string()).default(["**/*.{ts,tsx,js,jsx}"]),

  /** Glob patterns to exclude */
  ignorePatterns: z.array(z.string()).default([
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
  ]),

  /** Project name */
  name: z.string().min(1),

  /** Version from package.json */
  version: z.string().optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// =============================================================================
// File Entity Schema
// =============================================================================

/**
 * File entity schema for validation
 */
export const FileEntitySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  relativePath: z.string().min(1),
  extension: z.string(),
  hash: z.string().length(32), // MD5 hash
  size: z.number().int().nonnegative(),
  lastModified: z.date(),
  language: z.string(),
  framework: z.string().optional(),
});

export type FileEntity = z.infer<typeof FileEntitySchema>;

// =============================================================================
// Code Location Schema
// =============================================================================

/**
 * Source code location schema
 */
export const LocationSchema = z.object({
  filePath: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  startColumn: z.number().int().nonnegative(),
  endColumn: z.number().int().nonnegative(),
}).refine(
  (data) => data.endLine >= data.startLine,
  { message: "endLine must be >= startLine" }
);

export type Location = z.infer<typeof LocationSchema>;

// =============================================================================
// Function Entity Schema
// =============================================================================

/**
 * Parameter schema
 */
export const ParameterSchema = z.object({
  name: z.string().min(1),
  type: z.string().nullable(),
  isOptional: z.boolean(),
  isRest: z.boolean(),
  defaultValue: z.string().nullable(),
});

export type Parameter = z.infer<typeof ParameterSchema>;

/**
 * Function entity schema
 */
export const FunctionEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  fileId: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  startColumn: z.number().int().nonnegative(),
  endColumn: z.number().int().nonnegative(),
  signature: z.string(),
  parameters: z.array(ParameterSchema),
  returnType: z.string().nullable(),
  isExported: z.boolean(),
  isAsync: z.boolean(),
  isGenerator: z.boolean(),
  complexity: z.number().int().nonnegative(),
  docComment: z.string().nullable(),
  businessLogic: z.string().nullable(),
  body: z.string().optional(),
});

export type FunctionEntity = z.infer<typeof FunctionEntitySchema>;

// =============================================================================
// Class Entity Schema
// =============================================================================

/**
 * Class entity schema
 */
export const ClassEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  fileId: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  isExported: z.boolean(),
  isAbstract: z.boolean(),
  extends: z.string().nullable(),
  implements: z.array(z.string()),
  docComment: z.string().nullable(),
});

export type ClassEntity = z.infer<typeof ClassEntitySchema>;

// =============================================================================
// Interface Entity Schema
// =============================================================================

/**
 * Interface entity schema
 */
export const InterfaceEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  fileId: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  isExported: z.boolean(),
  extends: z.array(z.string()),
  docComment: z.string().nullable(),
});

export type InterfaceEntity = z.infer<typeof InterfaceEntitySchema>;

// =============================================================================
// Import/Export Schemas
// =============================================================================

/**
 * Import specifier schema
 */
export const ImportSpecifierSchema = z.object({
  local: z.string().min(1),
  imported: z.string().min(1),
  type: z.enum(["named", "default", "namespace"]),
});

/**
 * Import entity schema
 */
export const ImportEntitySchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
  source: z.string().min(1),
  resolvedFileId: z.string().nullable(),
  specifiers: z.array(ImportSpecifierSchema),
  isTypeOnly: z.boolean(),
  line: z.number().int().positive(),
});

export type ImportEntity = z.infer<typeof ImportEntitySchema>;

/**
 * Export entity schema
 */
export const ExportEntitySchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
  name: z.string().min(1),
  localName: z.string().nullable(),
  type: z.enum(["named", "default", "namespace", "re-export"]),
  source: z.string().nullable(),
  line: z.number().int().positive(),
});

export type ExportEntity = z.infer<typeof ExportEntitySchema>;

// =============================================================================
// Indexing Configuration Schema
// =============================================================================

/**
 * Indexing options schema
 */
export const IndexingOptionsSchema = z.object({
  /** Whether to run LLM inference for business logic */
  inferBusinessLogic: z.boolean().default(true),

  /** Maximum files to process in parallel */
  concurrency: z.number().int().positive().default(4),

  /** Whether to watch for file changes */
  watch: z.boolean().default(false),

  /** File size limit in bytes (skip larger files) */
  maxFileSize: z.number().int().positive().default(1024 * 1024), // 1MB

  /** Maximum complexity score before skipping function analysis */
  maxComplexity: z.number().int().positive().default(100),
});

export type IndexingOptions = z.infer<typeof IndexingOptionsSchema>;

// =============================================================================
// MCP Configuration Schema
// =============================================================================

/**
 * MCP server configuration schema
 */
export const MCPConfigSchema = z.object({
  /** Port to listen on */
  port: z.number().int().min(1024).max(65535).default(3100),

  /** Host to bind to */
  host: z.string().default("localhost"),

  /** Enable debug logging */
  debug: z.boolean().default(false),

  /** Request timeout in milliseconds */
  timeout: z.number().int().positive().default(30000),
});

export type MCPConfig = z.infer<typeof MCPConfigSchema>;

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Validation result type
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

/**
 * Validate data against a schema (throws on failure)
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validated and typed data
 * @throws {z.ZodError} If validation fails
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

/**
 * Safely validate data against a schema (returns result object)
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validation result with either data or error
 */
export function safeValidate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Create a partial schema from an existing schema
 * All fields become optional
 */
export function partial<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>
): z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }> {
  return schema.partial();
}

/**
 * Format Zod errors into readable messages
 */
export function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Validate and return default values for missing optional fields
 */
export function validateWithDefaults<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): T {
  return schema.parse(data);
}

/**
 * Developer Memory System Models
 *
 * Persistent memory for project conventions, rules, and learned patterns.
 * Enables AI to remember past corrections and avoid repeating mistakes.
 */

import { z } from "zod";

// =============================================================================
// Memory Rule Scopes
// =============================================================================

export const MemoryRuleScopeSchema = z.enum([
  "project", // Applies to entire project
  "module", // Applies to specific module/directory
  "vertical", // Applies to business domain
  "horizontal", // Applies to infrastructure layer
  "file", // Applies to specific file patterns
  "entity", // Applies to specific entity types
]);

export type MemoryRuleScope = z.infer<typeof MemoryRuleScopeSchema>;

// =============================================================================
// Memory Rule Categories
// =============================================================================

export const MemoryRuleCategorySchema = z.enum([
  "convention", // Naming, formatting, structure conventions
  "architecture", // Architectural patterns and boundaries
  "anti-pattern", // Things to avoid
  "preference", // User preferences
  "dependency", // Library/framework usage rules
  "testing", // Testing patterns and requirements
  "security", // Security constraints
  "performance", // Performance guidelines
]);

export type MemoryRuleCategory = z.infer<typeof MemoryRuleCategorySchema>;

// =============================================================================
// Memory Rule Trigger Types
// =============================================================================

export const TriggerTypeSchema = z.enum([
  "file-pattern", // Glob pattern for files
  "entity-type", // Function, class, etc.
  "code-pattern", // Regex pattern in code
  "import-pattern", // Import/dependency pattern
  "name-pattern", // Naming pattern
  "context-keyword", // Keywords in prompt/context
]);

export type TriggerType = z.infer<typeof TriggerTypeSchema>;

// =============================================================================
// Memory Rule Schema
// =============================================================================

export const ProjectMemoryRuleSchema = z.object({
  // Identity
  id: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  // Scope and targeting
  scope: MemoryRuleScopeSchema,
  scopeTarget: z.string().optional(), // Module path, domain name, etc.
  category: MemoryRuleCategorySchema,

  // Trigger conditions
  triggerType: TriggerTypeSchema,
  triggerPattern: z.string(), // Pattern to match
  triggerDescription: z.string().optional(),

  // Rule content
  ruleText: z.string(), // Human-readable rule
  ruleExplanation: z.string().optional(), // Why this rule exists
  examples: z
    .array(
      z.object({
        bad: z.string(),
        good: z.string(),
        explanation: z.string().optional(),
      })
    )
    .default([]),

  // Learning metadata
  source: z.enum([
    "user-correction", // User corrected AI output
    "build-failure", // Build/lint error after generation
    "manual-refactor", // User manually refactored AI code
    "explicit-instruction", // User explicitly stated rule
    "inferred-pattern", // System inferred from behavior
  ]),
  sourceEventId: z.string().optional(), // Link to ledger event
  sourceSessionId: z.string().optional(),

  // Confidence and validation
  confidence: z.number().min(0).max(1), // 0-1 confidence score
  validationCount: z.number().default(0), // Times rule was validated
  violationCount: z.number().default(0), // Times rule was violated
  lastValidatedAt: z.string().datetime().optional(),
  lastViolatedAt: z.string().datetime().optional(),

  // Embedding for semantic search
  embedding: z.array(z.number()).optional(),

  // Status
  isActive: z.boolean().default(true),
  deprecatedAt: z.string().datetime().optional(),
  deprecatedReason: z.string().optional(),
});

export type ProjectMemoryRule = z.infer<typeof ProjectMemoryRuleSchema>;

// =============================================================================
// Memory Rule Reference (for ledger)
// =============================================================================

export const MemoryRuleRefSchema = z.object({
  ruleId: z.string(),
  action: z.enum(["created", "updated", "validated", "violated", "deprecated"]),
  confidenceDelta: z.number().optional(),
  details: z.string().optional(),
});

export type MemoryRuleRef = z.infer<typeof MemoryRuleRefSchema>;

// =============================================================================
// Memory Query Types
// =============================================================================

export interface MemoryQuery {
  scope?: MemoryRuleScope;
  scopeTarget?: string;
  category?: MemoryRuleCategory;
  triggerType?: TriggerType;
  minConfidence?: number;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

export interface SemanticMemoryQuery {
  context: string; // Code context or prompt
  filePath?: string;
  entityType?: string;
  limit?: number;
  minSimilarity?: number;
}

// =============================================================================
// Memory Statistics
// =============================================================================

export interface MemoryStats {
  totalRules: number;
  activeRules: number;
  byScope: Record<MemoryRuleScope, number>;
  byCategory: Record<MemoryRuleCategory, number>;
  bySource: Record<string, number>;
  averageConfidence: number;
  highConfidenceRules: number; // confidence > 0.8
  recentlyValidated: number; // validated in last 7 days
  recentlyViolated: number; // violated in last 7 days
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createMemoryRule(
  scope: MemoryRuleScope,
  category: MemoryRuleCategory,
  triggerType: TriggerType,
  triggerPattern: string,
  ruleText: string,
  source: ProjectMemoryRule["source"],
  options?: Partial<
    Omit<
      ProjectMemoryRule,
      "id" | "createdAt" | "updatedAt" | "scope" | "category" | "triggerType" | "triggerPattern" | "ruleText" | "source"
    >
  >
): ProjectMemoryRule {
  const now = new Date().toISOString();
  return {
    id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    createdAt: now,
    updatedAt: now,
    scope,
    category,
    triggerType,
    triggerPattern,
    ruleText,
    source,
    confidence: options?.confidence ?? 0.5,
    validationCount: options?.validationCount ?? 0,
    violationCount: options?.violationCount ?? 0,
    examples: options?.examples ?? [],
    isActive: options?.isActive ?? true,
    scopeTarget: options?.scopeTarget,
    triggerDescription: options?.triggerDescription,
    ruleExplanation: options?.ruleExplanation,
    sourceEventId: options?.sourceEventId,
    sourceSessionId: options?.sourceSessionId,
    lastValidatedAt: options?.lastValidatedAt,
    lastViolatedAt: options?.lastViolatedAt,
    embedding: options?.embedding,
    deprecatedAt: options?.deprecatedAt,
    deprecatedReason: options?.deprecatedReason,
  };
}

export function createMemoryRuleRef(
  ruleId: string,
  action: MemoryRuleRef["action"],
  options?: { confidenceDelta?: number; details?: string }
): MemoryRuleRef {
  return {
    ruleId,
    action,
    confidenceDelta: options?.confidenceDelta,
    details: options?.details,
  };
}

/**
 * LLM Prompts for Business Justification Inference
 *
 * Structured prompts for inferring purpose, business value, and
 * feature context from code entities.
 *
 * @module
 */

import type {
  JustificationContext,
  EntityForJustification,
  LLMJustificationResponse,
} from "../models/justification.js";
import { createLogger } from "../../../utils/logger.js";

const logger = createLogger("justification-prompts");

// =============================================================================
// GBNF Grammar for Structured Output
// =============================================================================

/**
 * GBNF grammar that forces LLM to output valid JSON matching LLMJustificationResponse
 */
export const JUSTIFICATION_GRAMMAR = `
root ::= "{" ws justification-object ws "}"

justification-object ::= purpose-summary "," ws business-value "," ws feature-context "," ws detailed-description "," ws tags "," ws confidence-score "," ws reasoning "," ws needs-clarification "," ws clarification-questions

purpose-summary ::= "\\"purposeSummary\\"" ws ":" ws string
business-value ::= "\\"businessValue\\"" ws ":" ws string
feature-context ::= "\\"featureContext\\"" ws ":" ws string
detailed-description ::= "\\"detailedDescription\\"" ws ":" ws string
tags ::= "\\"tags\\"" ws ":" ws string-array
confidence-score ::= "\\"confidenceScore\\"" ws ":" ws number
reasoning ::= "\\"reasoning\\"" ws ":" ws string
needs-clarification ::= "\\"needsClarification\\"" ws ":" ws boolean
clarification-questions ::= "\\"clarificationQuestions\\"" ws ":" ws string-array

string-array ::= "[" ws (string ("," ws string)*)? ws "]"
string ::= "\\"" ([^"\\\\] | "\\\\" .)* "\\""
number ::= [0-9]+ ("." [0-9]+)?
boolean ::= "true" | "false"
ws ::= [ \\t\\n]*
`;

// =============================================================================
// System Prompts
// =============================================================================

/**
 * Base system prompt for justification inference
 *
 * SEMANTIC CONSTRAINTS (strictly enforced):
 * - purposeSummary: WHAT the code does (one sentence, imperative form)
 * - businessValue: WHY this exists from product/business perspective
 * - featureContext: Domain noun (e.g., "Authentication", "Payment Processing")
 * - tags: Domain-specific categorization keywords
 * - confidenceScore: Must auto-generate clarification questions when < 0.5
 */
export const JUSTIFICATION_SYSTEM_PROMPT = `You are a senior software architect analyzing code to extract MEANINGFUL business knowledge.

## YOUR GOAL
Create justifications that help developers and AI agents understand:
- WHY this code exists (the problem it solves)
- WHAT business capability it enables
- HOW it fits into the larger system

## CRITICAL RULES - READ CAREFULLY

### DO NOT generate generic descriptions like:
- "Type interface defining X structure" ❌
- "Function named X" ❌
- "Utility function: X" ❌
- "Class definition for X" ❌
- "Provides utility functionality" ❌

### DO generate specific, meaningful descriptions like:
- "Stores cached query results with TTL-based expiration to reduce database load" ✓
- "Validates incoming webhook payloads before processing payment events" ✓
- "Defines the contract for dependency injection of storage implementations" ✓
- "Orchestrates the multi-step user registration flow including email verification" ✓

## FIELD REQUIREMENTS

1. **purposeSummary** (REQUIRED - one meaningful sentence)
   - Describe the SPECIFIC problem this code solves
   - Use action verbs: "Validates", "Orchestrates", "Transforms", "Caches", "Routes"
   - Include WHAT it operates on and WHY

   GOOD EXAMPLES:
   - "Caches expensive graph traversal results to avoid repeated database queries"
   - "Validates MCP tool parameters against schema before execution"
   - "Transforms raw AST nodes into normalized entity representations for storage"

   BAD EXAMPLES (NEVER USE):
   - "Interface for cache entries" (too vague)
   - "Handles caching" (what caching? why?)
   - "Type definition" (meaningless)

2. **businessValue** (REQUIRED)
   - Explain the BUSINESS IMPACT if this code didn't exist
   - What user problem does it solve? What system capability does it enable?

   GOOD: "Reduces API response latency by 90% for repeated queries, improving user experience"
   BAD: "Provides caching functionality" (doesn't explain impact)

3. **featureContext** (REQUIRED - specific domain noun)
   - The subsystem or feature this belongs to
   - Be specific: "Query Result Caching", "Webhook Processing", "Entity Extraction"
   - NOT generic: "Utilities", "Helpers", "Core"

4. **tags** (2-5 domain-specific keywords)
   - Related concepts: ["cache", "performance", "query-optimization", "ttl-expiration"]
   - NOT syntax: ["interface", "function", "exported"]

5. **confidenceScore** (0.0-1.0)
   - Be honest about uncertainty. Low confidence is OK - it triggers clarification.

6. **reasoning** (REQUIRED)
   - Explain HOW you determined the purpose
   - What clues did you use? (naming, parameters, dependencies, file location)

## OUTPUT FORMAT (JSON)
{
  "purposeSummary": "Specific action + what it operates on + why",
  "businessValue": "Impact on users/system if this didn't exist",
  "featureContext": "Specific subsystem name",
  "detailedDescription": "Additional context about implementation",
  "tags": ["domain-keyword1", "domain-keyword2"],
  "confidenceScore": 0.0-1.0,
  "reasoning": "Evidence: naming patterns, parameters, dependencies, file context",
  "needsClarification": true/false,
  "clarificationQuestions": ["Specific question about unclear aspects"]
}`;

// =============================================================================
// Entity-Specific Prompts
// =============================================================================

/**
 * Generate prompt for a function entity
 */
export function generateFunctionPrompt(
  entity: EntityForJustification,
  context: JustificationContext
): string {
  const parts: string[] = [];

  parts.push("# Function Analysis Request\n");

  // Entity information
  parts.push("## Function Details");
  parts.push(`- **Name**: \`${entity.name}\``);
  parts.push(`- **File**: \`${entity.filePath}\``);
  parts.push(`- **Lines**: ${entity.startLine}-${entity.endLine}`);
  if (entity.signature) {
    parts.push(`- **Signature**: \`${entity.signature}\``);
  }
  parts.push(`- **Exported**: ${entity.isExported ? "Yes" : "No"}`);
  if (entity.isAsync) {
    parts.push(`- **Async**: Yes`);
  }
  parts.push("");

  // Code snippet
  parts.push("## Code");
  parts.push("```");
  parts.push(entity.codeSnippet);
  parts.push("```");
  parts.push("");

  // Doc comment if present
  if (entity.docComment) {
    parts.push("## Documentation");
    parts.push(entity.docComment);
    parts.push("");
  }

  // Parent context
  if (context.parentContext?.justification) {
    parts.push("## Parent Context");
    parts.push(
      `This function is part of **${context.parentContext.name}** (${context.parentContext.type}):`
    );
    parts.push(`- Purpose: ${context.parentContext.justification.purposeSummary}`);
    parts.push(`- Business Value: ${context.parentContext.justification.businessValue}`);
    parts.push("");
  }

  // Callers
  if (context.callers.length > 0) {
    parts.push("## Called By");
    for (const caller of context.callers.slice(0, 5)) {
      const purpose = caller.purposeSummary ? ` - ${caller.purposeSummary}` : "";
      parts.push(`- \`${caller.functionName}\` in \`${caller.filePath}\`${purpose}`);
    }
    parts.push("");
  }

  // Callees (dependencies) - these may already have justifications from hierarchical processing
  if (context.callees.length > 0) {
    const justifiedCallees = context.callees.filter(c => c.purposeSummary);
    const unjustifiedCallees = context.callees.filter(c => !c.purposeSummary);

    if (justifiedCallees.length > 0) {
      parts.push("## Dependencies (Already Justified)");
      parts.push("*Use these justifications to understand what this function builds upon:*");
      for (const callee of justifiedCallees.slice(0, 5)) {
        parts.push(`- \`${callee.functionName}\`: ${callee.purposeSummary}`);
      }
      parts.push("");
    }

    if (unjustifiedCallees.length > 0) {
      parts.push("## Other Calls");
      for (const callee of unjustifiedCallees.slice(0, 3)) {
        parts.push(`- \`${callee.functionName}\` in \`${callee.filePath}\``);
      }
      parts.push("");
    }
  }

  // Siblings
  if (context.siblings.length > 0) {
    parts.push("## Sibling Functions");
    for (const sibling of context.siblings.slice(0, 5)) {
      const purpose = sibling.purposeSummary ? ` - ${sibling.purposeSummary}` : "";
      parts.push(`- \`${sibling.name}\`${purpose}`);
    }
    parts.push("");
  }

  // Project context
  if (context.projectContext.projectDescription) {
    parts.push("## Project Context");
    parts.push(`**Project**: ${context.projectContext.projectName}`);
    parts.push(`**Description**: ${context.projectContext.projectDescription}`);
    if (context.projectContext.domain) {
      parts.push(`**Domain**: ${context.projectContext.domain}`);
    }
    if (context.projectContext.knownFeatures.length > 0) {
      parts.push(`**Known Features**: ${context.projectContext.knownFeatures.join(", ")}`);
    }
    parts.push("");
  }

  parts.push("## Your Task");
  parts.push("Analyze this function and determine:");
  parts.push("1. What is the PURPOSE of this function?");
  parts.push("2. What BUSINESS VALUE does it provide?");
  parts.push("3. What FEATURE or domain does it belong to?");
  parts.push("");
  parts.push("Output your analysis as JSON.");

  return parts.join("\n");
}

/**
 * Generate prompt for a class entity
 */
export function generateClassPrompt(
  entity: EntityForJustification,
  context: JustificationContext
): string {
  const parts: string[] = [];

  parts.push("# Class Analysis Request\n");

  // Entity information
  parts.push("## Class Details");
  parts.push(`- **Name**: \`${entity.name}\``);
  parts.push(`- **File**: \`${entity.filePath}\``);
  parts.push(`- **Lines**: ${entity.startLine}-${entity.endLine}`);
  parts.push(`- **Exported**: ${entity.isExported ? "Yes" : "No"}`);
  parts.push("");

  // Code snippet
  parts.push("## Code");
  parts.push("```");
  parts.push(entity.codeSnippet);
  parts.push("```");
  parts.push("");

  // Doc comment if present
  if (entity.docComment) {
    parts.push("## Documentation");
    parts.push(entity.docComment);
    parts.push("");
  }

  // Methods
  if (context.children.length > 0) {
    parts.push("## Methods");
    for (const child of context.children) {
      const purpose = child.purposeSummary ? ` - ${child.purposeSummary}` : "";
      parts.push(`- \`${child.name}\`${purpose}`);
    }
    parts.push("");
  }

  // Dependencies
  if (context.dependencies.length > 0) {
    parts.push("## Dependencies");
    for (const dep of context.dependencies.slice(0, 10)) {
      const external = dep.isExternal ? " (external)" : "";
      parts.push(`- \`${dep.modulePath}\`${external}: ${dep.importedNames.join(", ")}`);
    }
    parts.push("");
  }

  // Project context
  if (context.projectContext.projectDescription) {
    parts.push("## Project Context");
    parts.push(`**Project**: ${context.projectContext.projectName}`);
    parts.push(`**Description**: ${context.projectContext.projectDescription}`);
    parts.push("");
  }

  parts.push("## Your Task");
  parts.push("Analyze this class and determine:");
  parts.push("1. What is the PURPOSE of this class?");
  parts.push("2. What BUSINESS VALUE does it provide?");
  parts.push("3. What FEATURE or domain does it belong to?");
  parts.push("");
  parts.push("Output your analysis as JSON.");

  return parts.join("\n");
}

/**
 * Generate prompt for a file/module entity
 */
export function generateFilePrompt(
  entity: EntityForJustification,
  context: JustificationContext
): string {
  const parts: string[] = [];

  parts.push("# File/Module Analysis Request\n");

  // Entity information
  parts.push("## File Details");
  parts.push(`- **Path**: \`${entity.filePath}\``);
  parts.push(`- **Name**: \`${entity.name}\``);
  parts.push("");

  // Children (functions, classes in file)
  if (context.children.length > 0) {
    parts.push("## Contents");
    for (const child of context.children) {
      const purpose = child.purposeSummary
        ? ` - ${child.purposeSummary}`
        : child.businessValue
          ? ` - ${child.businessValue}`
          : "";
      parts.push(`- **${child.type}** \`${child.name}\`${purpose}`);
    }
    parts.push("");
  }

  // Dependencies
  if (context.dependencies.length > 0) {
    parts.push("## Imports");
    for (const dep of context.dependencies.slice(0, 10)) {
      const external = dep.isExternal ? " (external)" : "";
      parts.push(`- \`${dep.modulePath}\`${external}`);
    }
    parts.push("");
  }

  // Project context
  if (context.projectContext.projectDescription) {
    parts.push("## Project Context");
    parts.push(`**Project**: ${context.projectContext.projectName}`);
    parts.push(`**Description**: ${context.projectContext.projectDescription}`);
    parts.push("");
  }

  parts.push("## Your Task");
  parts.push("Analyze this file/module and determine:");
  parts.push("1. What is the PURPOSE of this module?");
  parts.push("2. What BUSINESS VALUE does it provide?");
  parts.push("3. What FEATURE or domain does it belong to?");
  parts.push("");
  parts.push("Output your analysis as JSON.");

  return parts.join("\n");
}

/**
 * Generate prompt for an interface entity
 */
export function generateInterfacePrompt(
  entity: EntityForJustification,
  context: JustificationContext
): string {
  const parts: string[] = [];

  parts.push("# Interface Analysis Request\n");

  // Entity information
  parts.push("## Interface Details");
  parts.push(`- **Name**: \`${entity.name}\``);
  parts.push(`- **File**: \`${entity.filePath}\``);
  parts.push(`- **Lines**: ${entity.startLine}-${entity.endLine}`);
  parts.push(`- **Exported**: ${entity.isExported ? "Yes" : "No"}`);
  parts.push("");

  // Code snippet
  parts.push("## Code");
  parts.push("```");
  parts.push(entity.codeSnippet);
  parts.push("```");
  parts.push("");

  // Doc comment if present
  if (entity.docComment) {
    parts.push("## Documentation");
    parts.push(entity.docComment);
    parts.push("");
  }

  // Project context
  if (context.projectContext.projectDescription) {
    parts.push("## Project Context");
    parts.push(`**Project**: ${context.projectContext.projectName}`);
    parts.push(`**Description**: ${context.projectContext.projectDescription}`);
    parts.push("");
  }

  parts.push("## Your Task");
  parts.push("Analyze this interface and determine:");
  parts.push("1. What CONTRACT does this interface define?");
  parts.push("2. What BUSINESS VALUE does it provide?");
  parts.push("3. What FEATURE or domain does it belong to?");
  parts.push("");
  parts.push("Output your analysis as JSON.");

  return parts.join("\n");
}

// =============================================================================
// Prompt Selection
// =============================================================================

/**
 * Generate the appropriate prompt based on entity type
 */
export function generateJustificationPrompt(
  entity: EntityForJustification,
  context: JustificationContext
): string {
  switch (entity.type) {
    case "function":
    case "method":
      return generateFunctionPrompt(entity, context);
    case "class":
      return generateClassPrompt(entity, context);
    case "file":
    case "module":
      return generateFilePrompt(entity, context);
    case "interface":
      return generateInterfacePrompt(entity, context);
    default:
      return generateFunctionPrompt(entity, context);
  }
}

// =============================================================================
// Context Propagation Prompts
// =============================================================================

/**
 * Prompt for aggregating child justifications into parent summary
 */
export function generateAggregationPrompt(
  parentEntity: EntityForJustification,
  childJustifications: Array<{ name: string; purposeSummary: string; businessValue: string }>
): string {
  const parts: string[] = [];

  parts.push("# Aggregation Request\n");
  parts.push(`Summarize the business purpose of **${parentEntity.name}** based on its contents.\n`);

  parts.push("## Contents");
  for (const child of childJustifications) {
    parts.push(`- **${child.name}**: ${child.purposeSummary}`);
    parts.push(`  - Business Value: ${child.businessValue}`);
  }
  parts.push("");

  parts.push("## Your Task");
  parts.push("Create a unified summary that:");
  parts.push("1. Captures the overall PURPOSE of this module/class");
  parts.push("2. Identifies the common BUSINESS VALUE");
  parts.push("3. Determines the overarching FEATURE context");
  parts.push("");
  parts.push("Output your analysis as JSON.");

  return parts.join("\n");
}

/**
 * Prompt for generating clarification questions
 */
export function generateClarificationPrompt(
  entity: EntityForJustification,
  currentJustification: {
    purposeSummary: string;
    businessValue: string;
    confidenceScore: number;
  }
): string {
  const parts: string[] = [];

  parts.push("# Clarification Request\n");
  parts.push(
    `The justification for **${entity.name}** has low confidence (${currentJustification.confidenceScore.toFixed(2)}).\n`
  );

  parts.push("## Current Understanding");
  parts.push(`- Purpose: ${currentJustification.purposeSummary || "Unknown"}`);
  parts.push(`- Business Value: ${currentJustification.businessValue || "Unknown"}`);
  parts.push("");

  parts.push("## Code");
  parts.push("```");
  parts.push(entity.codeSnippet);
  parts.push("```");
  parts.push("");

  parts.push("## Your Task");
  parts.push("Generate 1-3 specific questions that would help clarify:");
  parts.push("1. The PURPOSE of this code");
  parts.push("2. Its BUSINESS VALUE");
  parts.push("3. The FEATURE context it belongs to");
  parts.push("");
  parts.push("Questions should be:");
  parts.push("- Specific and actionable");
  parts.push("- Easy for a developer to answer");
  parts.push("- Prioritized from most to least important");
  parts.push("");
  parts.push(
    'Output as JSON with "clarificationQuestions" array and set "needsClarification" to true.'
  );

  return parts.join("\n");
}

// =============================================================================
// Response Parsing
// =============================================================================

/**
 * Parse LLM response into structured justification
 */
export function parseJustificationResponse(
  response: string | unknown
): LLMJustificationResponse | null {
  try {
    let parsed: any;
    if (typeof response !== "string" && response !== null && typeof response === "object") {
      parsed = response;
    } else if (typeof response === "string") {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      return null;
    }

    // Validate required fields
    if (!parsed.purposeSummary || typeof parsed.confidenceScore !== "number") {
      return null;
    }

    return {
      purposeSummary: parsed.purposeSummary || "",
      businessValue: parsed.businessValue || "",
      featureContext: parsed.featureContext || "",
      detailedDescription: parsed.detailedDescription || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      confidenceScore: Math.max(0, Math.min(1, parsed.confidenceScore)),
      reasoning: parsed.reasoning || "",
      needsClarification: Boolean(parsed.needsClarification),
      clarificationQuestions: Array.isArray(parsed.clarificationQuestions)
        ? parsed.clarificationQuestions
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Create a default response when LLM fails
 */
export function createDefaultResponse(
  entity: EntityForJustification
): LLMJustificationResponse {
  return {
    purposeSummary: `${entity.type} named ${entity.name}`,
    businessValue: "Unknown - requires user clarification",
    featureContext: inferFeatureFromPath(entity.filePath),
    detailedDescription: "",
    tags: inferTagsFromName(entity.name),
    confidenceScore: 0.1,
    reasoning: "LLM inference failed, using defaults",
    needsClarification: true,
    clarificationQuestions: [`What is the purpose of ${entity.name}?`],
  };
}

/**
 * Infer feature context from file path
 */
function inferFeatureFromPath(filePath: string): string {
  const parts = filePath.split("/");

  // Common patterns
  const featurePatterns = [
    { pattern: /auth/i, feature: "Authentication" },
    { pattern: /user/i, feature: "User Management" },
    { pattern: /payment/i, feature: "Payments" },
    { pattern: /api/i, feature: "API" },
    { pattern: /cli/i, feature: "CLI" },
    { pattern: /core/i, feature: "Core" },
    { pattern: /utils?/i, feature: "Utilities" },
    { pattern: /test/i, feature: "Testing" },
    { pattern: /config/i, feature: "Configuration" },
  ];

  for (const part of parts) {
    for (const { pattern, feature } of featurePatterns) {
      if (pattern.test(part)) {
        return feature;
      }
    }
  }

  return "General";
}

/**
 * Infer tags from entity name
 */
function inferTagsFromName(name: string): string[] {
  const tags: string[] = [];

  // Common prefixes/suffixes
  if (/^handle|Handler$/i.test(name)) tags.push("handler");
  if (/^create|Creator$/i.test(name)) tags.push("factory");
  if (/^validate|Validator$/i.test(name)) tags.push("validation");
  if (/^parse|Parser$/i.test(name)) tags.push("parsing");
  if (/^format|Formatter$/i.test(name)) tags.push("formatting");
  if (/^fetch|get|load/i.test(name)) tags.push("data-fetching");
  if (/^save|store|persist/i.test(name)) tags.push("data-persistence");
  if (/^render|display/i.test(name)) tags.push("ui");
  if (/^test|spec|mock/i.test(name)) tags.push("testing");

  return tags;
}

// =============================================================================
// Batch Processing Prompts
// =============================================================================

/**
 * Batch entity for prompt generation
 */
export interface BatchEntityInput {
  id: string;
  name: string;
  type: string;
  filePath: string;
  codeSnippet: string;
  signature?: string;
  docComment?: string;
  isExported?: boolean;
}

/**
 * Batch response for a single entity
 */
export interface BatchEntityResponse {
  id: string;
  purposeSummary: string;
  businessValue: string;
  featureContext: string;
  tags: string[];
  confidenceScore: number;
}

/**
 * System prompt optimized for batch processing
 *
 * Enforces the same strict semantic constraints as single-entity prompts
 */
export const BATCH_JUSTIFICATION_SYSTEM_PROMPT = `You are a senior software architect extracting MEANINGFUL business knowledge from code.

## CRITICAL: Avoid Generic Descriptions

NEVER output generic phrases like:
- "Type interface defining X structure" ❌
- "Function named X" ❌
- "Utility function: X" ❌
- "Class definition for X" ❌
- "Provides functionality" ❌

ALWAYS describe the SPECIFIC business purpose:
- "Stores cached MCP query results with configurable TTL to reduce database load" ✓
- "Validates webhook signatures to ensure payment events are authentic" ✓
- "Coordinates parallel file parsing across worker threads for faster indexing" ✓

## FIELD REQUIREMENTS

1. **purposeSummary** - SPECIFIC action + what + why
   GOOD: "Extracts function call relationships from AST to build the dependency graph"
   BAD: "Handles extraction" (too vague)

2. **businessValue** - Impact if this didn't exist
   GOOD: "Enables 'find all callers' feature that developers use to understand code impact"
   BAD: "Useful for extraction" (meaningless)

3. **featureContext** - Specific subsystem name
   GOOD: "Dependency Graph Builder", "Cache Management", "AST Parsing"
   BAD: "Utilities", "Core", "Helpers" (too generic)

4. **tags** - Domain concepts (NOT syntax)
   GOOD: ["dependency-tracking", "call-graph", "static-analysis"]
   BAD: ["function", "async", "exported"]

5. **confidenceScore** - Be honest about uncertainty

## OUTPUT FORMAT
{
  "justifications": [
    {
      "id": "entity_id_from_input",
      "purposeSummary": "Specific action on specific data for specific reason",
      "businessValue": "What breaks or degrades without this",
      "featureContext": "Specific subsystem name",
      "tags": ["domain-concept1", "domain-concept2"],
      "confidenceScore": 0.0-1.0
    }
  ]
}`;

/**
 * Generate a batch prompt for multiple entities
 */
export function generateBatchPrompt(entities: BatchEntityInput[]): string {
  const parts: string[] = [];

  parts.push("# Batch Analysis Request\n");
  parts.push(`Analyze these ${entities.length} code entities and provide justifications for each.\n`);

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]!;
    parts.push(`## Entity ${i + 1} (ID: ${entity.id})`);
    parts.push(`- **Name**: \`${entity.name}\``);
    parts.push(`- **Type**: ${entity.type}`);
    parts.push(`- **File**: \`${entity.filePath}\``);
    if (entity.signature) {
      parts.push(`- **Signature**: \`${entity.signature}\``);
    }
    if (entity.docComment) {
      parts.push(`- **Doc**: ${entity.docComment.split("\n")[0]}`);
    }
    parts.push("```");
    // Truncate code to first 10 lines for batch processing
    const lines = entity.codeSnippet.split("\n");
    parts.push(lines.slice(0, 10).join("\n"));
    if (lines.length > 10) {
      parts.push(`... (${lines.length - 10} more lines)`);
    }
    parts.push("```");
    parts.push("");
  }

  parts.push("## Your Task");
  parts.push(`Analyze all ${entities.length} entities above and output a JSON array with justifications.`);
  parts.push("Each object in the array must have the 'id' field matching the entity ID shown above.");

  return parts.join("\n");
}

/**
 * JSON schema for batch response
 */
export const BATCH_JUSTIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    justifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          purposeSummary: { type: "string" },
          businessValue: { type: "string" },
          featureContext: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          confidenceScore: { type: "number" },
        },
        required: ["id", "purposeSummary", "businessValue", "confidenceScore"],
      },
    },
  },
  required: ["justifications"],
};

/**
 * Parse batch LLM response into structured justifications
 * Handles both camelCase and snake_case property names from different LLM providers
 */
export function parseBatchResponse(
  response: string | unknown
): Map<string, BatchEntityResponse> {
  const results = new Map<string, BatchEntityResponse>();

  try {
    let parsed: any;
    // Handle SDK structured output object (which is not an array)
    if (typeof response === "object" && response !== null && !Array.isArray(response)) {
      parsed = response;
    } else if (Array.isArray(response)) {
      parsed = response;
    } else if (typeof response === "string") {
      let jsonText = response;

      // Extract JSON from text
      const markdownMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (markdownMatch && markdownMatch[1]) {
        jsonText = markdownMatch[1].trim();
      }

      try {
        parsed = JSON.parse(jsonText);
      } catch (parseError) {
        // Fallback for truncated JSON
        const fixed = fixTruncatedJsonArray(jsonText);
        if (fixed) {
          parsed = JSON.parse(fixed);
        } else {
          try {
            // Try finding just the array or object
            const firstBrace = jsonText.indexOf("{");
            const lastBrace = jsonText.lastIndexOf("}");
            if (firstBrace >= 0 && lastBrace > firstBrace) {
              parsed = JSON.parse(jsonText.substring(firstBrace, lastBrace + 1));
            } else {
              throw parseError;
            }
          } catch {
            throw parseError;
          }
        }
      }
    }

    // Unwrap justifications if wrapped in object
    const items = Array.isArray(parsed) ? parsed : (parsed?.justifications || []);

    if (!Array.isArray(items)) {
      logger.debug({ parsedType: typeof parsed }, "Parsed batch response is not an array or wrapped array");
      return results;
    }

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;

      const purposeSummary = obj.purposeSummary || obj.purpose_summary;
      const businessValue = obj.businessValue || obj.business_value;
      const featureContext = obj.featureContext || obj.feature_context;
      const confidenceScore = obj.confidenceScore ?? obj.confidence_score;

      if (!obj.id || !purposeSummary) continue;

      results.set(String(obj.id), {
        id: String(obj.id),
        purposeSummary: String(purposeSummary || ""),
        businessValue: String(businessValue || ""),
        featureContext: String(featureContext || ""),
        tags: Array.isArray(obj.tags) ? (obj.tags as string[]) : [],
        confidenceScore: Math.max(0, Math.min(1, Number(confidenceScore) || 0.5)),
      });
    }
  } catch (error) {
    logger.debug({ error: String(error) }, "Failed to parse batch response");
  }

  return results;
}

/**
 * Attempt to fix a truncated JSON array by finding the last complete object
 */
function fixTruncatedJsonArray(jsonStr: string): string | null {
  // Find the last complete object by looking for the pattern },\n  { or }]
  // Work backwards from the end to find a valid closing point

  // First, try to find the last complete object ending with }
  let lastValidEnd = -1;
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      braceCount++;
    } else if (char === "}") {
      braceCount--;
      if (braceCount === 0) {
        // Found end of a complete object at array level
        lastValidEnd = i;
      }
    }
  }

  if (lastValidEnd > 0) {
    // Truncate at the last valid object and close the array
    const truncated = jsonStr.slice(0, lastValidEnd + 1);
    // Check if it needs the closing bracket
    const trimmed = truncated.trim();
    if (trimmed.endsWith("}")) {
      return trimmed + "]";
    }
  }

  return null;
}

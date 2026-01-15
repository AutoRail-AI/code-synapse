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
export const JUSTIFICATION_SYSTEM_PROMPT = `You are a senior software architect analyzing code to extract structured business knowledge.

Your task is to create HIGH-FIDELITY justifications that encode INTENT, not just syntax.

## STRICT FIELD SEMANTICS

1. **purposeSummary** (REQUIRED - one sentence max)
   - Describes WHAT this code does in imperative form
   - Example: "Validates user credentials against the authentication database"
   - NOT: "This is a function that validates..." (no "this is" phrases)
   - NOT: "Handles authentication" (too vague)

2. **businessValue** (REQUIRED)
   - Answers WHY this code exists from a product perspective
   - Example: "Enables secure user authentication, preventing unauthorized access"
   - NOT: "Useful for authentication" (doesn't explain business impact)

3. **featureContext** (REQUIRED)
   - A domain NOUN representing the feature area
   - Examples: "Authentication", "Payment Processing", "User Management", "API Gateway"
   - NOT: "handles authentication" (use nouns, not verb phrases)

4. **tags** (REQUIRED - 2-5 domain-specific tags)
   - Domain keywords for categorization
   - Examples: ["authentication", "security", "validation", "user-credential"]
   - NOT: ["function", "async", "exported"] (no syntax-level tags)

5. **confidenceScore** (REQUIRED - 0.0 to 1.0)
   - High (≥0.8): Clear purpose from code/docs/naming
   - Medium (0.5-0.79): Reasonable inference but some ambiguity
   - Low (0.3-0.49): Guessing based on patterns
   - Uncertain (<0.3): Cannot determine purpose
   - IMPORTANT: If confidence < 0.5, you MUST set needsClarification=true and provide questions

6. **reasoning** (REQUIRED)
   - Chain of evidence: what signals led to your conclusions
   - Example: "Function name 'validateCredentials' + parameter 'password' + calls to 'hashPassword' indicates authentication validation"

## QUALITY REQUIREMENTS

- Every justification must be ACTIONABLE for both humans and AI agents
- Focus on BUSINESS INTENT, not implementation details
- If you cannot determine purpose with confidence ≥0.5, request clarification
- Do not hallucinate business value - admit uncertainty

Output Format:
You MUST output valid JSON matching this exact structure:
{
  "purposeSummary": "One sentence describing what this does (imperative form)",
  "businessValue": "Why this exists from business/product perspective",
  "featureContext": "Feature/Domain noun",
  "detailedDescription": "Detailed explanation if needed",
  "tags": ["domain-tag1", "domain-tag2"],
  "confidenceScore": 0.0-1.0,
  "reasoning": "Evidence chain: naming + context + patterns",
  "needsClarification": true/false,
  "clarificationQuestions": ["Specific question 1?", "Specific question 2?"]
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

  // Callees
  if (context.callees.length > 0) {
    parts.push("## Calls");
    for (const callee of context.callees.slice(0, 5)) {
      const purpose = callee.purposeSummary ? ` - ${callee.purposeSummary}` : "";
      parts.push(`- \`${callee.functionName}\` in \`${callee.filePath}\`${purpose}`);
    }
    parts.push("");
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
  response: string
): LLMJustificationResponse | null {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

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
export const BATCH_JUSTIFICATION_SYSTEM_PROMPT = `You are a senior software architect extracting structured business knowledge from code.

Analyze MULTIPLE code entities and output a JSON array with high-fidelity justifications.

## STRICT FIELD SEMANTICS

1. **purposeSummary** (one sentence, imperative form)
   - WHAT this code does
   - Example: "Validates user credentials against the database"
   - NOT: "This function validates..." or "Handles validation"

2. **businessValue** (required)
   - WHY this exists from product/business perspective
   - Example: "Enables secure authentication, preventing unauthorized access"

3. **featureContext** (domain NOUN)
   - The feature area this belongs to
   - Examples: "Authentication", "Payment Processing", "User Management"
   - NOT verb phrases like "handles auth"

4. **tags** (2-5 domain-specific keywords)
   - Examples: ["authentication", "security", "validation"]
   - NOT syntax tags: ["function", "async", "exported"]

5. **confidenceScore** (0.0-1.0)
   - ≥0.8: Clear from code/docs/naming
   - 0.5-0.79: Reasonable but some ambiguity
   - <0.5: Uncertain, needs clarification

## QUALITY REQUIREMENTS

- Focus on BUSINESS INTENT, not implementation
- Be concise but precise
- Admit uncertainty with low confidence scores

Output Format:
You MUST output valid JSON array:
[
  {
    "id": "entity_id_from_input",
    "purposeSummary": "One sentence, imperative form",
    "businessValue": "Why this exists for the product",
    "featureContext": "Domain noun",
    "tags": ["domain-tag1", "domain-tag2"],
    "confidenceScore": 0.0-1.0
  }
]`;

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
};

/**
 * Parse batch LLM response into structured justifications
 * Handles both camelCase and snake_case property names from different LLM providers
 */
export function parseBatchResponse(
  response: string
): Map<string, BatchEntityResponse> {
  const results = new Map<string, BatchEntityResponse>();

  try {
    // Try to extract JSON content - handle multiple formats:
    // 1. Raw JSON array
    // 2. JSON wrapped in markdown code blocks (```json ... ```)
    // 3. JSON with text before/after
    let jsonText = response;

    // Check if response is wrapped in markdown code blocks
    const markdownMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (markdownMatch && markdownMatch[1]) {
      // Extract content from within markdown blocks
      jsonText = markdownMatch[1].trim();
      logger.debug("Extracted JSON from markdown code blocks");
    }

    // Try to extract JSON array from the text
    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // If still no match, try the original response (in case markdown extraction went wrong)
      const fallbackMatch = response.match(/\[[\s\S]*\]/);
      if (!fallbackMatch) {
        logger.debug(
          { responseLength: response.length, preview: response.slice(0, 200) },
          "No JSON array found in batch response"
        );
        return results;
      }
      jsonText = fallbackMatch[0];
    } else {
      jsonText = jsonMatch[0];
    }

    // Try to parse, and if it fails due to truncation, try to fix it
    let parsed: unknown[];
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseError) {
      // JSON might be truncated - try to fix by finding last complete object
      logger.debug("JSON parse failed, attempting to fix truncated response");
      const fixedJson = fixTruncatedJsonArray(jsonText);
      if (fixedJson) {
        parsed = JSON.parse(fixedJson);
        logger.debug({ fixedItemCount: parsed.length }, "Successfully fixed truncated JSON");
      } else {
        throw parseError;
      }
    }

    if (!Array.isArray(parsed)) {
      logger.debug({ parsedType: typeof parsed }, "Parsed response is not an array");
      return results;
    }

    logger.debug({ itemCount: parsed.length }, "Parsing batch response items");

    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;

      // Handle both camelCase and snake_case property names
      const purposeSummary = obj.purposeSummary || obj.purpose_summary;
      const businessValue = obj.businessValue || obj.business_value;
      const featureContext = obj.featureContext || obj.feature_context;
      const confidenceScore = obj.confidenceScore ?? obj.confidence_score;

      if (!obj.id || !purposeSummary) {
        logger.debug(
          { itemId: obj.id, hasPurposeSummary: !!purposeSummary, itemKeys: Object.keys(obj) },
          "Skipping item with missing required fields"
        );
        continue;
      }

      results.set(String(obj.id), {
        id: String(obj.id),
        purposeSummary: String(purposeSummary || ""),
        businessValue: String(businessValue || ""),
        featureContext: String(featureContext || ""),
        tags: Array.isArray(obj.tags) ? (obj.tags as string[]) : [],
        confidenceScore: Math.max(0, Math.min(1, Number(confidenceScore) || 0.5)),
      });
    }

    logger.debug({ resultCount: results.size }, "Batch response parsing complete");
  } catch (error) {
    logger.debug(
      { error: String(error), preview: response.slice(0, 200) },
      "Failed to parse batch response JSON"
    );
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

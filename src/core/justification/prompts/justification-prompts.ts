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
  JustifiableEntityType,
} from "../models/justification.js";

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
 */
export const JUSTIFICATION_SYSTEM_PROMPT = `You are a senior software architect analyzing code to understand its business purpose and value.

Your task is to infer WHY code exists, not just WHAT it does.

For each code entity, you must determine:
1. PURPOSE: What does this code accomplish?
2. BUSINESS VALUE: Why does this exist from a product/business perspective?
3. FEATURE CONTEXT: Which feature or domain does this belong to?
4. CONFIDENCE: How certain are you about your analysis?

Guidelines:
- Focus on the "why" rather than the "how"
- Consider naming conventions as strong signals
- Use surrounding context (callers, callees, imports) to understand purpose
- If the code's purpose is unclear, indicate low confidence
- Generate clarification questions for uncertain cases
- Tags should be domain-specific (e.g., "authentication", "payment", "user-management")

Output Format:
You MUST output valid JSON matching this exact structure:
{
  "purposeSummary": "One sentence describing what this does",
  "businessValue": "Why this exists from business/product perspective",
  "featureContext": "The feature/domain this belongs to",
  "detailedDescription": "Detailed explanation of the code's role",
  "tags": ["tag1", "tag2"],
  "confidenceScore": 0.0-1.0,
  "reasoning": "Your reasoning chain",
  "needsClarification": true/false,
  "clarificationQuestions": ["Question 1?", "Question 2?"]
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

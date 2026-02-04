/**
 * Side-Effect Detector Implementation
 *
 * Analyzes functions to detect and categorize side effects by:
 * - Walking the AST to find call expressions and assignments
 * - Using pattern matching to identify known side-effect APIs
 * - Tracking mutations to parameters, this, globals, and closures
 * - Detecting conditional contexts for side effects
 *
 * Following the decoupling philosophy:
 * - Implements ISideEffectAnalyzer interface
 * - Uses ISideEffectCategorizer for classification
 * - No vendor-specific code
 *
 * @module
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import type {
  ISideEffectAnalyzer,
  ISideEffectCategorizer,
  SideEffect,
  SideEffectCategory,
  SideEffectPattern,
  SideEffectSummary,
  SideEffectAnalysisResult,
  SideEffectAnalysisOptions,
  DetectionConfidence,
} from "./interfaces.js";
import { createSideEffectCategorizer, DEFAULT_SIDE_EFFECT_PATTERNS } from "./categorizer.js";
import * as crypto from "node:crypto";

// =============================================================================
// Constants
// =============================================================================

/**
 * Node types that represent function calls.
 */
const CALL_NODE_TYPES = new Set([
  "call_expression",
  "new_expression",
]);

/**
 * Node types that represent assignments.
 */
const ASSIGNMENT_NODE_TYPES = new Set([
  "assignment_expression",
  "augmented_assignment_expression",
  "update_expression",
]);

/**
 * Node types for conditional contexts.
 */
const CONDITIONAL_NODE_TYPES = new Set([
  "if_statement",
  "ternary_expression",
  "conditional_expression",
  "switch_case",
  "catch_clause",
]);

/**
 * Node types for function declarations.
 */
const FUNCTION_NODE_TYPES = new Set([
  "function_declaration",
  "function_expression",
  "arrow_function",
  "method_definition",
]);

/**
 * Global variable names that indicate global state mutation.
 */
const GLOBAL_NAMES = new Set([
  "window",
  "global",
  "globalThis",
  "process",
  "module",
  "exports",
  "require",
  "__dirname",
  "__filename",
]);

// =============================================================================
// Side-Effect Analyzer Implementation
// =============================================================================

/**
 * Implementation of ISideEffectAnalyzer.
 *
 * Detects and categorizes side effects in functions by:
 * - Finding API calls that match known patterns
 * - Detecting mutations to parameters, this, globals, closures
 * - Tracking conditional contexts
 */
export class SideEffectAnalyzer implements ISideEffectAnalyzer {
  private categorizer: ISideEffectCategorizer;
  private patterns: SideEffectPattern[];

  constructor(categorizer?: ISideEffectCategorizer) {
    this.categorizer = categorizer ?? createSideEffectCategorizer();
    this.patterns = [...DEFAULT_SIDE_EFFECT_PATTERNS];
  }

  /**
   * Analyze a function for side effects.
   */
  analyze(
    functionNode: SyntaxNode,
    functionBody: string,
    functionId: string,
    filePath: string,
    options?: SideEffectAnalysisOptions
  ): SideEffectAnalysisResult {
    const sideEffects: SideEffect[] = [];
    const parameterNames = this.extractParameterNames(functionNode);

    // Track conditional context as we traverse
    const conditionalStack: string[] = [];

    // Track closure variables (variables from outer scope)
    const closureVariables = new Set<string>();
    const localVariables = new Set<string>();

    // Get the function body node
    const bodyNode = functionNode.childForFieldName("body");
    if (bodyNode) {
      this.traverseForSideEffects(
        bodyNode,
        functionId,
        filePath,
        functionBody,
        sideEffects,
        conditionalStack,
        parameterNames,
        closureVariables,
        localVariables,
        options
      );
    }

    // Filter by options
    const filteredEffects = this.filterSideEffects(sideEffects, options);

    // Build summary
    const summary = this.buildSummary(filteredEffects);

    // Calculate overall confidence
    const confidence = this.calculateOverallConfidence(filteredEffects);

    return {
      functionId,
      filePath,
      sideEffects: filteredEffects,
      summary,
      confidence,
      analyzedAt: Date.now(),
    };
  }

  /**
   * Check if a specific API call is known to have side effects.
   */
  getKnownPattern(apiCall: string): SideEffectPattern | null {
    const normalized = apiCall.toLowerCase();
    for (const pattern of this.patterns) {
      if (normalized.includes(pattern.pattern.toLowerCase())) {
        return pattern;
      }
    }
    return null;
  }

  /**
   * Get all registered side-effect patterns.
   */
  getAllPatterns(): SideEffectPattern[] {
    return [...this.patterns];
  }

  /**
   * Register a custom side-effect pattern.
   */
  registerPattern(pattern: SideEffectPattern): void {
    this.patterns.push(pattern);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Extract parameter names from function node.
   */
  private extractParameterNames(functionNode: SyntaxNode): Set<string> {
    const names = new Set<string>();
    const params = functionNode.childForFieldName("parameters");

    if (params) {
      this.walkNode(params, (node) => {
        if (node.type === "identifier") {
          names.add(node.text);
        }
        // Handle destructuring patterns
        if (node.type === "shorthand_property_identifier" ||
            node.type === "shorthand_property_identifier_pattern") {
          names.add(node.text);
        }
        return true;
      });
    }

    return names;
  }

  /**
   * Traverse AST to detect side effects.
   */
  private traverseForSideEffects(
    node: SyntaxNode,
    functionId: string,
    filePath: string,
    sourceCode: string,
    sideEffects: SideEffect[],
    conditionalStack: string[],
    parameterNames: Set<string>,
    closureVariables: Set<string>,
    localVariables: Set<string>,
    options?: SideEffectAnalysisOptions
  ): void {
    // Track entering conditional context
    const condition = this.extractCondition(node, conditionalStack);
    const enteredConditional = condition !== null;
    if (enteredConditional && condition) {
      conditionalStack.push(condition);
    }

    // Track local variable declarations
    if (node.type === "variable_declarator") {
      const name = node.childForFieldName("name");
      if (name) {
        localVariables.add(name.text);
      }
    }

    // Skip nested function definitions (analyze separately)
    if (FUNCTION_NODE_TYPES.has(node.type) && node !== node.tree.rootNode) {
      // Capture closure variable references
      this.collectClosureReferences(node, localVariables, closureVariables);
      // Don't descend into nested functions unless option is set
      if (!options?.analyzeNestedCalls) {
        if (enteredConditional) {
          conditionalStack.pop();
        }
        return;
      }
    }

    // Detect call expressions
    if (CALL_NODE_TYPES.has(node.type)) {
      const effect = this.analyzeCallExpression(
        node,
        functionId,
        filePath,
        sourceCode,
        conditionalStack
      );
      if (effect) {
        sideEffects.push(effect);
      }
    }

    // Detect assignment expressions (mutations)
    if (ASSIGNMENT_NODE_TYPES.has(node.type)) {
      const effect = this.analyzeAssignment(
        node,
        functionId,
        filePath,
        conditionalStack,
        parameterNames,
        closureVariables,
        localVariables
      );
      if (effect) {
        sideEffects.push(effect);
      }
    }

    // Detect member expression assignments (e.g., this.x = y, obj.prop = z)
    if (node.type === "member_expression" && this.isAssignmentTarget(node)) {
      const effect = this.analyzeMemberMutation(
        node,
        functionId,
        filePath,
        conditionalStack,
        parameterNames,
        closureVariables
      );
      if (effect) {
        sideEffects.push(effect);
      }
    }

    // Recurse into children
    for (const child of node.children) {
      this.traverseForSideEffects(
        child,
        functionId,
        filePath,
        sourceCode,
        sideEffects,
        conditionalStack,
        parameterNames,
        closureVariables,
        localVariables,
        options
      );
    }

    // Track leaving conditional context
    if (enteredConditional) {
      conditionalStack.pop();
    }
  }

  /**
   * Analyze a call expression for side effects.
   */
  private analyzeCallExpression(
    node: SyntaxNode,
    functionId: string,
    filePath: string,
    _sourceCode: string,
    conditionalStack: string[]
  ): SideEffect | null {
    const callee = node.childForFieldName("function") ?? node.children[0];
    if (!callee) return null;

    const apiCall = callee.text;

    // Try to categorize the call
    const categorization = this.categorizer.categorize(apiCall);
    if (!categorization) {
      // Check if it's a method call that could be a side effect
      if (this.isPotentialSideEffectCall(callee)) {
        return this.createUnknownSideEffect(
          node,
          functionId,
          filePath,
          apiCall,
          conditionalStack
        );
      }
      return null;
    }

    return this.createSideEffect(
      node,
      functionId,
      filePath,
      categorization.category,
      apiCall,
      conditionalStack,
      categorization.confidence,
      this.getPatternDescription(apiCall) ?? `Calls ${apiCall}`
    );
  }

  /**
   * Analyze an assignment for side effects.
   */
  private analyzeAssignment(
    node: SyntaxNode,
    functionId: string,
    filePath: string,
    conditionalStack: string[],
    parameterNames: Set<string>,
    closureVariables: Set<string>,
    localVariables: Set<string>
  ): SideEffect | null {
    const left = node.childForFieldName("left") ?? node.children[0];
    if (!left) return null;

    const target = left.text;

    // Check for different mutation types
    if (target.startsWith("this.") || target.startsWith("self.")) {
      return this.createSideEffect(
        node,
        functionId,
        filePath,
        "mutation-this",
        `${target} = ...`,
        conditionalStack,
        "high",
        `Mutates object state via ${target}`
      );
    }

    // Check for global mutation
    const rootIdentifier = this.getRootIdentifier(left);
    if (rootIdentifier && GLOBAL_NAMES.has(rootIdentifier)) {
      return this.createSideEffect(
        node,
        functionId,
        filePath,
        "mutation-global",
        `${target} = ...`,
        conditionalStack,
        "high",
        `Mutates global state: ${rootIdentifier}`
      );
    }

    // Check for parameter mutation
    if (rootIdentifier && parameterNames.has(rootIdentifier)) {
      // Only if it's modifying a property (obj.prop = x) or the param directly
      if (left.type === "member_expression" || left.type === "subscript_expression") {
        return this.createSideEffect(
          node,
          functionId,
          filePath,
          "mutation-param",
          `${target} = ...`,
          conditionalStack,
          "high",
          `Mutates input parameter: ${rootIdentifier}`
        );
      }
    }

    // Check for closure mutation
    if (rootIdentifier &&
        closureVariables.has(rootIdentifier) &&
        !localVariables.has(rootIdentifier)) {
      return this.createSideEffect(
        node,
        functionId,
        filePath,
        "mutation-closure",
        `${target} = ...`,
        conditionalStack,
        "medium",
        `Mutates closure variable: ${rootIdentifier}`
      );
    }

    return null;
  }

  /**
   * Analyze a member expression mutation (e.g., this.x = y).
   */
  private analyzeMemberMutation(
    node: SyntaxNode,
    functionId: string,
    filePath: string,
    conditionalStack: string[],
    parameterNames: Set<string>,
    closureVariables: Set<string>
  ): SideEffect | null {
    const object = node.childForFieldName("object");
    if (!object) return null;

    const target = node.text;

    // this.* mutations
    if (object.text === "this" || object.text === "self") {
      return this.createSideEffect(
        node,
        functionId,
        filePath,
        "mutation-this",
        target,
        conditionalStack,
        "high",
        `Mutates object state via ${target}`
      );
    }

    // Global mutations
    if (GLOBAL_NAMES.has(object.text)) {
      return this.createSideEffect(
        node,
        functionId,
        filePath,
        "mutation-global",
        target,
        conditionalStack,
        "high",
        `Mutates global state: ${object.text}`
      );
    }

    // Parameter mutations
    const rootId = this.getRootIdentifier(object);
    if (rootId && parameterNames.has(rootId)) {
      return this.createSideEffect(
        node,
        functionId,
        filePath,
        "mutation-param",
        target,
        conditionalStack,
        "high",
        `Mutates input parameter: ${rootId}`
      );
    }

    // Closure mutations
    if (rootId && closureVariables.has(rootId)) {
      return this.createSideEffect(
        node,
        functionId,
        filePath,
        "mutation-closure",
        target,
        conditionalStack,
        "medium",
        `Mutates closure variable: ${rootId}`
      );
    }

    return null;
  }

  /**
   * Check if a node is the target of an assignment.
   */
  private isAssignmentTarget(node: SyntaxNode): boolean {
    const parent = node.parent;
    if (!parent) return false;

    if (ASSIGNMENT_NODE_TYPES.has(parent.type)) {
      const left = parent.childForFieldName("left") ?? parent.children[0];
      return left === node;
    }

    // Check for update expressions (++, --)
    if (parent.type === "update_expression") {
      return true;
    }

    return false;
  }

  /**
   * Get the root identifier from a member expression chain.
   */
  private getRootIdentifier(node: SyntaxNode): string | null {
    if (node.type === "identifier") {
      return node.text;
    }

    if (node.type === "member_expression" || node.type === "subscript_expression") {
      const object = node.childForFieldName("object");
      if (object) {
        return this.getRootIdentifier(object);
      }
    }

    return null;
  }

  /**
   * Check if a callee could potentially have side effects.
   */
  private isPotentialSideEffectCall(callee: SyntaxNode): boolean {
    const text = callee.text.toLowerCase();

    // Common side-effect method name patterns
    const sideEffectPatterns = [
      "write", "save", "store", "persist", "send", "post", "put", "delete",
      "update", "insert", "remove", "create", "destroy", "emit", "dispatch",
      "publish", "trigger", "notify", "log", "print", "set", "add", "push",
      "pop", "shift", "unshift", "splice", "clear", "reset", "init", "load",
    ];

    for (const pattern of sideEffectPatterns) {
      if (text.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract condition text for conditional contexts.
   */
  private extractCondition(node: SyntaxNode, _stack: string[]): string | null {
    if (!CONDITIONAL_NODE_TYPES.has(node.type)) {
      return null;
    }

    const condition = node.childForFieldName("condition");
    if (condition) {
      return this.truncate(condition.text, 100);
    }

    if (node.type === "catch_clause") {
      return "catch";
    }

    if (node.type === "switch_case") {
      const value = node.childForFieldName("value");
      return value ? `case ${value.text}` : "default";
    }

    return "conditional";
  }

  /**
   * Collect variables from outer scope that a function references.
   */
  private collectClosureReferences(
    functionNode: SyntaxNode,
    outerLocals: Set<string>,
    closureVars: Set<string>
  ): void {
    // Get parameters of the nested function
    const innerParams = this.extractParameterNames(functionNode);
    const innerLocals = new Set<string>();

    this.walkNode(functionNode, (node) => {
      // Track inner local variables
      if (node.type === "variable_declarator") {
        const name = node.childForFieldName("name");
        if (name) {
          innerLocals.add(name.text);
        }
      }

      // Check identifiers
      if (node.type === "identifier") {
        const name = node.text;
        // If it's not a parameter or local, but exists in outer scope
        if (!innerParams.has(name) &&
            !innerLocals.has(name) &&
            outerLocals.has(name)) {
          closureVars.add(name);
        }
      }

      return true;
    });
  }

  /**
   * Create a SideEffect instance.
   */
  private createSideEffect(
    node: SyntaxNode,
    functionId: string,
    _filePath: string,
    category: SideEffectCategory,
    apiCall: string,
    conditionalStack: string[],
    confidence: DetectionConfidence,
    description: string
  ): SideEffect {
    const isConditional = conditionalStack.length > 0;
    const condition = isConditional
      ? conditionalStack[conditionalStack.length - 1] ?? null
      : null;

    return {
      id: this.generateId(),
      functionId,
      category,
      description,
      target: this.extractTarget(apiCall, category),
      isConditional,
      condition,
      apiCall: this.truncate(apiCall, 200),
      location: {
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
      },
      confidence,
      evidence: this.buildEvidence(node, category, apiCall),
    };
  }

  /**
   * Create an unknown side effect for potential side-effect calls.
   */
  private createUnknownSideEffect(
    node: SyntaxNode,
    functionId: string,
    filePath: string,
    apiCall: string,
    conditionalStack: string[]
  ): SideEffect {
    return this.createSideEffect(
      node,
      functionId,
      filePath,
      "unknown",
      apiCall,
      conditionalStack,
      "low",
      `Potential side effect: ${this.truncate(apiCall, 50)}`
    );
  }

  /**
   * Extract target from API call.
   */
  private extractTarget(apiCall: string, category: SideEffectCategory): string | null {
    // Try to extract meaningful target
    if (category.startsWith("mutation-")) {
      // For mutations, the target is usually before the assignment
      const match = apiCall.match(/^([a-zA-Z_$][\w$.]*)/);
      return match ? match[1] ?? null : null;
    }

    if (category === "io-file") {
      return "filesystem";
    }

    if (category === "io-network") {
      return "network";
    }

    if (category === "io-database") {
      return "database";
    }

    if (category === "io-console") {
      return "console";
    }

    return null;
  }

  /**
   * Build evidence array for a side effect.
   */
  private buildEvidence(
    node: SyntaxNode,
    category: SideEffectCategory,
    apiCall: string
  ): string[] {
    const evidence: string[] = [];

    // Add pattern match evidence
    const pattern = this.getKnownPattern(apiCall);
    if (pattern) {
      evidence.push(`Matched known pattern: ${pattern.pattern}`);
    }

    // Add category-specific evidence
    switch (category) {
      case "io-file":
        evidence.push("File system operation detected");
        break;
      case "io-network":
        evidence.push("Network I/O operation detected");
        break;
      case "io-database":
        evidence.push("Database operation detected");
        break;
      case "io-console":
        evidence.push("Console/logging operation detected");
        break;
      case "mutation-this":
        evidence.push("Modifies object instance state");
        break;
      case "mutation-global":
        evidence.push("Modifies global/module-level state");
        break;
      case "mutation-param":
        evidence.push("Modifies function input parameter");
        break;
      case "mutation-closure":
        evidence.push("Modifies variable from enclosing scope");
        break;
      case "async-spawn":
        evidence.push("Spawns asynchronous operation");
        break;
      case "external-service":
        evidence.push("Calls external service/API");
        break;
      case "dom-manipulation":
        evidence.push("Modifies DOM structure");
        break;
      case "event-emission":
        evidence.push("Emits event to listeners");
        break;
    }

    // Add AST context evidence
    evidence.push(`At node type: ${node.type}`);

    return evidence;
  }

  /**
   * Get description from a pattern match.
   */
  private getPatternDescription(apiCall: string): string | null {
    const pattern = this.getKnownPattern(apiCall);
    return pattern?.description ?? null;
  }

  /**
   * Filter side effects by options.
   */
  private filterSideEffects(
    sideEffects: SideEffect[],
    options?: SideEffectAnalysisOptions
  ): SideEffect[] {
    let filtered = sideEffects;

    // Filter by categories to skip
    if (options?.skipCategories?.length) {
      filtered = filtered.filter(
        (e) => !options.skipCategories!.includes(e.category)
      );
    }

    // Filter by minimum confidence
    if (options?.minConfidence) {
      const confidenceOrder: DetectionConfidence[] = ["high", "medium", "low"];
      const minIndex = confidenceOrder.indexOf(options.minConfidence);
      filtered = filtered.filter((e) => {
        const eIndex = confidenceOrder.indexOf(e.confidence);
        return eIndex <= minIndex;
      });
    }

    // Deduplicate by location
    const seen = new Set<string>();
    filtered = filtered.filter((e) => {
      const key = `${e.location.line}:${e.location.column}:${e.category}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return filtered;
  }

  /**
   * Build summary from detected side effects.
   */
  private buildSummary(sideEffects: SideEffect[]): SideEffectSummary {
    // Initialize counts by category
    const allCategories: SideEffectCategory[] = [
      "io-file", "io-network", "io-database", "io-console",
      "mutation-param", "mutation-global", "mutation-this", "mutation-closure",
      "async-spawn", "external-service", "dom-manipulation", "event-emission",
      "unknown",
    ];

    const byCategory = {} as Record<SideEffectCategory, number>;
    for (const cat of allCategories) {
      byCategory[cat] = 0;
    }

    // Count by category
    for (const effect of sideEffects) {
      byCategory[effect.category]++;
    }

    // Check if all conditional
    const allConditional = sideEffects.length > 0 &&
      sideEffects.every((e) => e.isConditional);

    // Get primary categories
    const primaryCategories = this.categorizer.getPrimaryCategories(sideEffects);

    // Calculate risk level
    const riskLevel = this.categorizer.calculateRiskLevel(sideEffects);

    return {
      totalCount: sideEffects.length,
      byCategory,
      isPure: sideEffects.length === 0,
      allConditional,
      primaryCategories,
      riskLevel,
    };
  }

  /**
   * Calculate overall confidence for the analysis.
   */
  private calculateOverallConfidence(sideEffects: SideEffect[]): number {
    if (sideEffects.length === 0) {
      return 0.7; // Reasonable confidence that function is pure
    }

    // Average confidence of detected effects
    const confidenceValues: Record<DetectionConfidence, number> = {
      high: 0.9,
      medium: 0.7,
      low: 0.5,
    };

    let total = 0;
    for (const effect of sideEffects) {
      total += confidenceValues[effect.confidence];
    }

    return total / sideEffects.length;
  }

  /**
   * Walk the AST tree.
   */
  private walkNode(node: SyntaxNode, visitor: (node: SyntaxNode) => boolean): void {
    if (!visitor(node)) return;
    for (const child of node.children) {
      this.walkNode(child, visitor);
    }
  }

  /**
   * Truncate a string to a max length.
   */
  private truncate(text: string, maxLength: number): string {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= maxLength) return clean;
    return clean.slice(0, maxLength - 3) + "...";
  }

  /**
   * Generate a unique ID.
   */
  private generateId(): string {
    return crypto.randomUUID();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new SideEffectAnalyzer instance.
 */
export function createSideEffectAnalyzer(
  categorizer?: ISideEffectCategorizer
): ISideEffectAnalyzer {
  return new SideEffectAnalyzer(categorizer);
}

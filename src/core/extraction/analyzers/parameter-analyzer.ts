/**
 * Parameter Semantic Analyzer
 *
 * Analyzes function parameters to extract semantic information:
 * - Purpose classification (input, config, callback, etc.)
 * - Usage patterns within function body
 * - Validation rules
 * - Mutation detection
 *
 * @module
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import type {
  IParameterAnalyzer,
  ParameterSemantics,
  ParameterAnalysisResult,
  ParameterPurpose,
  ParameterUsage,
} from "../../analysis/interfaces.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Naming patterns that indicate parameter purpose.
 */
const PURPOSE_PATTERNS: Record<ParameterPurpose, RegExp[]> = {
  config: [
    /^(config|options|opts|settings|preferences|params|args)$/i,
    /Config$/,
    /Options$/,
    /Settings$/,
  ],
  callback: [
    /^(callback|cb|handler|listener|onSuccess|onError|onComplete|fn|func)$/i,
    /^on[A-Z]/,
    /Callback$/,
    /Handler$/,
  ],
  context: [
    /^(ctx|context|req|request|res|response|session|this)$/i,
    /Context$/,
  ],
  input: [
    /^(data|input|value|item|element|record|entity|payload)$/i,
  ],
  output: [
    /^(out|output|result|ref)$/i,
  ],
  unknown: [],
};

/**
 * Validation-related keywords.
 */
const VALIDATION_KEYWORDS = [
  "throw",
  "assert",
  "validate",
  "check",
  "ensure",
  "require",
  "isNull",
  "isUndefined",
  "isEmpty",
  "!==",
  "===",
  "typeof",
];

// =============================================================================
// Parameter Analyzer Implementation
// =============================================================================

/**
 * Analyzes function parameters for semantic information.
 *
 * @example
 * ```typescript
 * const analyzer = new ParameterAnalyzer();
 * const result = analyzer.analyze(functionNode, functionBody, "fn-123");
 * console.log(result.parameters);
 * ```
 */
export class ParameterAnalyzer implements IParameterAnalyzer {
  /**
   * Analyze parameters of a function.
   */
  analyze(
    functionNode: SyntaxNode,
    functionBody: string,
    functionId: string
  ): ParameterAnalysisResult {
    const parameters: ParameterSemantics[] = [];

    // Extract parameter nodes
    const paramsNode = functionNode.childForFieldName("parameters");
    if (!paramsNode) {
      return {
        functionId,
        parameters: [],
        confidence: 1.0,
        analyzedAt: Date.now(),
      };
    }

    // Get the function body node for usage analysis
    const bodyNode = functionNode.childForFieldName("body");

    // Process each parameter
    let paramIndex = 0;
    for (const child of paramsNode.children) {
      if (this.isParameterNode(child)) {
        const semantics = this.analyzeParameter(child, bodyNode, paramIndex, functionBody);
        parameters.push(semantics);
        paramIndex++;
      }
    }

    // Calculate confidence based on how much we could determine
    const confidence = this.calculateConfidence(parameters);

    return {
      functionId,
      parameters,
      confidence,
      analyzedAt: Date.now(),
    };
  }

  /**
   * Analyze a single parameter.
   */
  private analyzeParameter(
    paramNode: SyntaxNode,
    bodyNode: SyntaxNode | null,
    index: number,
    sourceCode: string
  ): ParameterSemantics {
    const name = this.extractParameterName(paramNode);
    const type = this.extractParameterType(paramNode);
    const isOptional = this.isOptionalParameter(paramNode);
    const defaultValue = this.extractDefaultValue(paramNode);
    const isRest = this.isRestParameter(paramNode);
    const isDestructured = this.isDestructuredParameter(paramNode);

    // Infer purpose from name and type
    const purpose = this.inferPurpose(name, type);

    // Analyze usage if we have a body
    let usedInExpressions: ParameterUsage[] = [];
    let isMutated = false;
    let accessedAtLines: number[] = [];
    let validationRules: string[] = [];

    if (bodyNode) {
      const usageInfo = this.analyzeUsage(name, bodyNode, sourceCode);
      usedInExpressions = usageInfo.usages;
      isMutated = usageInfo.isMutated;
      accessedAtLines = usageInfo.accessedLines;
      validationRules = this.extractValidationRules(name, bodyNode, sourceCode);
    }

    return {
      name,
      index,
      type,
      purpose,
      isOptional,
      defaultValue,
      isRest,
      isDestructured,
      validationRules,
      usedInExpressions,
      isMutated,
      accessedAtLines,
    };
  }

  /**
   * Extract parameter name from node.
   */
  private extractParameterName(paramNode: SyntaxNode): string {
    // Handle different parameter patterns
    if (paramNode.type === "identifier") {
      return paramNode.text;
    }

    if (paramNode.type === "required_parameter" || paramNode.type === "optional_parameter") {
      const nameNode = paramNode.childForFieldName("pattern");
      return nameNode?.text ?? paramNode.text;
    }

    if (paramNode.type === "rest_pattern" || paramNode.type === "rest_parameter") {
      // Get the identifier after ...
      for (const child of paramNode.children) {
        if (child.type === "identifier") {
          return child.text;
        }
      }
    }

    if (paramNode.type === "assignment_pattern") {
      const left = paramNode.childForFieldName("left");
      return left?.text ?? paramNode.text;
    }

    if (paramNode.type === "object_pattern" || paramNode.type === "array_pattern") {
      // Destructured parameter - return the full pattern
      return paramNode.text;
    }

    return paramNode.text;
  }

  /**
   * Extract parameter type annotation.
   */
  private extractParameterType(paramNode: SyntaxNode): string | null {
    // Look for type annotation
    const typeNode = paramNode.childForFieldName("type");
    if (typeNode) {
      return typeNode.text;
    }

    // For TypeScript required_parameter or optional_parameter
    for (const child of paramNode.children) {
      if (child.type === "type_annotation") {
        // Get the type inside the annotation (skip the colon)
        const typeChild = child.children.find(c => c.type !== ":");
        return typeChild?.text ?? null;
      }
    }

    return null;
  }

  /**
   * Check if parameter is optional.
   */
  private isOptionalParameter(paramNode: SyntaxNode): boolean {
    // TypeScript optional parameter
    if (paramNode.type === "optional_parameter") {
      return true;
    }

    // Has default value
    if (paramNode.type === "assignment_pattern") {
      return true;
    }

    // Check for ? in the node text
    if (paramNode.text.includes("?:") || paramNode.text.includes("? :")) {
      return true;
    }

    return false;
  }

  /**
   * Extract default value expression.
   */
  private extractDefaultValue(paramNode: SyntaxNode): string | null {
    if (paramNode.type === "assignment_pattern") {
      const right = paramNode.childForFieldName("right");
      return right?.text ?? null;
    }

    // For TypeScript required_parameter with initializer
    const valueNode = paramNode.childForFieldName("value");
    return valueNode?.text ?? null;
  }

  /**
   * Check if parameter is a rest parameter.
   */
  private isRestParameter(paramNode: SyntaxNode): boolean {
    return paramNode.type === "rest_pattern" ||
           paramNode.type === "rest_parameter" ||
           paramNode.text.startsWith("...");
  }

  /**
   * Check if parameter is destructured.
   */
  private isDestructuredParameter(paramNode: SyntaxNode): boolean {
    return paramNode.type === "object_pattern" ||
           paramNode.type === "array_pattern" ||
           paramNode.text.startsWith("{") ||
           paramNode.text.startsWith("[");
  }

  /**
   * Infer parameter purpose from name and type.
   */
  private inferPurpose(name: string, type: string | null): ParameterPurpose {
    // Check type-based patterns first
    if (type) {
      const lowerType = type.toLowerCase();
      if (lowerType.includes("function") || lowerType.includes("=>")) {
        return "callback";
      }
      if (lowerType.includes("config") || lowerType.includes("options")) {
        return "config";
      }
      if (lowerType.includes("context") || lowerType.includes("request")) {
        return "context";
      }
    }

    // Check name-based patterns
    for (const [purpose, patterns] of Object.entries(PURPOSE_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(name)) {
          return purpose as ParameterPurpose;
        }
      }
    }

    // Default to input for most parameters
    return "input";
  }

  /**
   * Analyze how a parameter is used in the function body.
   */
  private analyzeUsage(
    paramName: string,
    bodyNode: SyntaxNode,
    _sourceCode: string
  ): { usages: ParameterUsage[]; isMutated: boolean; accessedLines: number[] } {
    const usages: ParameterUsage[] = [];
    const accessedLines: number[] = [];
    let isMutated = false;

    this.walkNode(bodyNode, (node) => {
      if (node.type === "identifier" && node.text === paramName) {
        const line = node.startPosition.row + 1;
        if (!accessedLines.includes(line)) {
          accessedLines.push(line);
        }

        const usage = this.classifyUsage(node);
        if (usage) {
          usages.push(usage);
          if (usage.kind === "write") {
            isMutated = true;
          }
        }
      }
      return true;
    });

    return { usages, isMutated, accessedLines };
  }

  /**
   * Classify how an identifier is used.
   */
  private classifyUsage(node: SyntaxNode): ParameterUsage | null {
    const parent = node.parent;
    if (!parent) return null;

    const line = node.startPosition.row + 1;
    const baseUsage = {
      line,
      expression: this.truncate(parent.text, 50),
    };

    // Assignment target
    if (parent.type === "assignment_expression") {
      const left = parent.childForFieldName("left");
      if (left && this.nodeContains(left, node)) {
        return { ...baseUsage, kind: "write", context: "assigned to" };
      }
      return { ...baseUsage, kind: "read", context: "read in assignment" };
    }

    // Update expression (++, --)
    if (parent.type === "update_expression") {
      return { ...baseUsage, kind: "write", context: "incremented/decremented" };
    }

    // Function call argument
    if (parent.type === "arguments") {
      const grandparent = parent.parent;
      if (grandparent?.type === "call_expression") {
        const funcName = grandparent.childForFieldName("function")?.text ?? "function";
        return { ...baseUsage, kind: "passed", context: `passed to ${this.truncate(funcName, 30)}` };
      }
    }

    // Member expression (property access)
    if (parent.type === "member_expression") {
      const object = parent.childForFieldName("object");
      if (object && this.nodeContains(object, node)) {
        const property = parent.childForFieldName("property");
        return { ...baseUsage, kind: "property-access", context: `accessing .${property?.text ?? "?"}` };
      }
    }

    // Spread expression
    if (parent.type === "spread_element") {
      return { ...baseUsage, kind: "spread", context: "spread" };
    }

    // Call expression (calling the parameter as a function)
    if (parent.type === "call_expression") {
      const func = parent.childForFieldName("function");
      if (func && this.nodeContains(func, node)) {
        return { ...baseUsage, kind: "call", context: "called as function" };
      }
    }

    // Default: read
    return { ...baseUsage, kind: "read", context: "read" };
  }

  /**
   * Extract validation rules applied to a parameter.
   */
  private extractValidationRules(
    paramName: string,
    bodyNode: SyntaxNode,
    _sourceCode: string
  ): string[] {
    const rules: string[] = [];

    this.walkNode(bodyNode, (node) => {
      // Look for if statements that check the parameter
      if (node.type === "if_statement") {
        const condition = node.childForFieldName("condition");
        if (condition && condition.text.includes(paramName)) {
          const rule = this.inferValidationRule(condition.text, paramName);
          if (rule && !rules.includes(rule)) {
            rules.push(rule);
          }
        }
      }

      // Look for throw statements related to parameter
      if (node.type === "throw_statement") {
        const parentIf = this.findParentOfType(node, "if_statement");
        if (parentIf) {
          const condition = parentIf.childForFieldName("condition");
          if (condition && condition.text.includes(paramName)) {
            const rule = this.inferValidationRule(condition.text, paramName);
            if (rule && !rules.includes(rule)) {
              rules.push(rule);
            }
          }
        }
      }

      return true;
    });

    return rules;
  }

  /**
   * Infer a validation rule from a condition.
   */
  private inferValidationRule(condition: string, paramName: string): string | null {
    const lowerCondition = condition.toLowerCase();

    // Null/undefined checks
    if (lowerCondition.includes("null") || lowerCondition.includes("undefined")) {
      if (condition.includes("!") || condition.includes("!==") || condition.includes("!=")) {
        return "non-null";
      }
    }

    // Type checks
    if (lowerCondition.includes("typeof")) {
      if (lowerCondition.includes("string")) return "must be string";
      if (lowerCondition.includes("number")) return "must be number";
      if (lowerCondition.includes("boolean")) return "must be boolean";
      if (lowerCondition.includes("function")) return "must be function";
      if (lowerCondition.includes("object")) return "must be object";
    }

    // Array checks
    if (lowerCondition.includes("isarray") || lowerCondition.includes("array.isarray")) {
      return "must be array";
    }

    // Length checks
    if (lowerCondition.includes(".length")) {
      if (condition.includes("> 0") || condition.includes(">0")) return "non-empty";
      if (condition.includes("=== 0") || condition.includes("==0")) return "must be empty";
    }

    // Numeric comparisons
    if (condition.includes("> 0") && !lowerCondition.includes("length")) {
      return "positive";
    }
    if (condition.includes("< 0")) {
      return "negative";
    }
    if (condition.includes(">= 0")) {
      return "non-negative";
    }

    return null;
  }

  /**
   * Check if a node is a parameter node.
   */
  private isParameterNode(node: SyntaxNode): boolean {
    return [
      "identifier",
      "required_parameter",
      "optional_parameter",
      "rest_pattern",
      "rest_parameter",
      "assignment_pattern",
      "object_pattern",
      "array_pattern",
    ].includes(node.type) && node.type !== "(" && node.type !== ")" && node.type !== ",";
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
   * Check if a node contains another node.
   */
  private nodeContains(parent: SyntaxNode, child: SyntaxNode): boolean {
    if (parent === child) return true;
    for (const c of parent.children) {
      if (this.nodeContains(c, child)) return true;
    }
    return false;
  }

  /**
   * Find parent of a specific type.
   */
  private findParentOfType(node: SyntaxNode, type: string): SyntaxNode | null {
    let current = node.parent;
    while (current) {
      if (current.type === type) return current;
      current = current.parent;
    }
    return null;
  }

  /**
   * Truncate a string to a max length.
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + "...";
  }

  /**
   * Calculate confidence based on analysis quality.
   */
  private calculateConfidence(parameters: ParameterSemantics[]): number {
    if (parameters.length === 0) return 1.0;

    let totalScore = 0;
    for (const param of parameters) {
      let paramScore = 0.5; // Base score

      // Type information increases confidence
      if (param.type) paramScore += 0.2;

      // Usage information increases confidence
      if (param.usedInExpressions.length > 0) paramScore += 0.2;

      // Purpose not unknown increases confidence
      if (param.purpose !== "unknown") paramScore += 0.1;

      totalScore += Math.min(paramScore, 1.0);
    }

    return totalScore / parameters.length;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a ParameterAnalyzer instance.
 */
export function createParameterAnalyzer(): IParameterAnalyzer {
  return new ParameterAnalyzer();
}

/**
 * Return Value Semantic Analyzer
 *
 * Analyzes function return values to extract semantic information:
 * - All return points and their conditions
 * - Possible values for union types
 * - Data sources contributing to returns
 * - Transformations applied before returning
 *
 * @module
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import type {
  IReturnAnalyzer,
  ReturnSemantics,
  ReturnAnalysisResult,
  ReturnPoint,
} from "../../analysis/interfaces.js";

// =============================================================================
// Return Analyzer Implementation
// =============================================================================

/**
 * Analyzes function return values for semantic information.
 *
 * @example
 * ```typescript
 * const analyzer = new ReturnAnalyzer();
 * const result = analyzer.analyze(functionNode, functionBody, "fn-123");
 * console.log(result.returnSemantics);
 * ```
 */
export class ReturnAnalyzer implements IReturnAnalyzer {
  /**
   * Analyze return values of a function.
   */
  analyze(
    functionNode: SyntaxNode,
    functionBody: string,
    functionId: string
  ): ReturnAnalysisResult {
    // Extract declared return type
    const declaredType = this.extractDeclaredReturnType(functionNode);

    // Get the function body node
    const bodyNode = functionNode.childForFieldName("body");

    // Extract all return points
    const returnPoints: ReturnPoint[] = [];
    const possibleValues: string[] = [];
    const nullConditions: string[] = [];
    const errorConditions: string[] = [];
    const derivedFrom: string[] = [];
    const transformations: string[] = [];

    if (bodyNode) {
      this.extractReturnPoints(bodyNode, returnPoints, functionBody);

      // Analyze each return point
      for (const point of returnPoints) {
        // Collect possible values
        if (point.expression && !possibleValues.includes(point.expression)) {
          if (point.valueType === "literal" || point.valueType === "variable") {
            possibleValues.push(point.expression);
          }
        }

        // Check for null/undefined returns
        if (this.isNullishReturn(point)) {
          const condition = point.condition ?? "unconditional";
          if (!nullConditions.includes(condition)) {
            nullConditions.push(condition);
          }
        }

        // Track data sources
        const sources = this.identifyDataSources(point, functionBody);
        for (const source of sources) {
          if (!derivedFrom.includes(source)) {
            derivedFrom.push(source);
          }
        }

        // Track transformations
        const transforms = this.identifyTransformations(point);
        for (const t of transforms) {
          if (!transformations.includes(t)) {
            transformations.push(t);
          }
        }
      }

      // Extract error conditions (throws instead of returns)
      this.extractErrorConditions(bodyNode, errorConditions);
    }

    // Determine if function can return void
    const canReturnVoid = this.canReturnVoid(returnPoints, bodyNode);

    // Check if function always throws
    const alwaysThrows = this.checkAlwaysThrows(bodyNode, returnPoints);

    // Infer return type from return points
    const inferredType = this.inferReturnType(returnPoints, declaredType);

    const returnSemantics: ReturnSemantics = {
      declaredType,
      inferredType,
      returnPoints,
      possibleValues,
      nullConditions,
      errorConditions,
      derivedFrom,
      transformations,
      canReturnVoid,
      alwaysThrows,
    };

    return {
      functionId,
      returnSemantics,
      confidence: this.calculateConfidence(returnSemantics),
      analyzedAt: Date.now(),
    };
  }

  /**
   * Extract declared return type from function signature.
   */
  private extractDeclaredReturnType(functionNode: SyntaxNode): string | null {
    // Look for return type annotation
    const returnType = functionNode.childForFieldName("return_type");
    if (returnType) {
      return returnType.text;
    }

    // Look for type_annotation child
    for (const child of functionNode.children) {
      if (child.type === "type_annotation") {
        // Skip the colon
        const typeChild = child.children.find(c => c.type !== ":");
        return typeChild?.text ?? null;
      }
    }

    return null;
  }

  /**
   * Extract all return points from the function body.
   */
  private extractReturnPoints(
    bodyNode: SyntaxNode,
    returnPoints: ReturnPoint[],
    _sourceCode: string
  ): void {
    // Track conditional context
    const conditionalStack: string[] = [];

    const processNode = (node: SyntaxNode): void => {
      // Track entering conditional contexts
      if (node.type === "if_statement") {
        const condition = node.childForFieldName("condition");
        if (condition) {
          conditionalStack.push(condition.text);
        }
      }

      // Process return statements
      if (node.type === "return_statement") {
        const returnPoint = this.analyzeReturnStatement(node, conditionalStack);
        returnPoints.push(returnPoint);
      }

      // Process children
      for (const child of node.children) {
        processNode(child);
      }

      // Track leaving conditional contexts
      if (node.type === "if_statement") {
        conditionalStack.pop();
      }
    };

    processNode(bodyNode);

    // Check for implicit return (arrow function expression body)
    if (bodyNode.type !== "statement_block" && returnPoints.length === 0) {
      // Arrow function with expression body
      returnPoints.push({
        line: bodyNode.startPosition.row + 1,
        column: bodyNode.startPosition.column,
        expression: this.truncate(bodyNode.text, 100),
        valueType: this.classifyValueType(bodyNode),
        isConditional: false,
        condition: null,
        isEarlyReturn: false,
      });
    }
  }

  /**
   * Analyze a single return statement.
   */
  private analyzeReturnStatement(
    node: SyntaxNode,
    conditionalStack: string[]
  ): ReturnPoint {
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    // Get the return expression
    let expression: string | null = null;
    let valueType: ReturnPoint["valueType"] = "void";

    // Find the expression being returned
    for (const child of node.children) {
      if (child.type !== "return") {
        expression = this.truncate(child.text, 100);
        valueType = this.classifyValueType(child);
        break;
      }
    }

    // Determine if this is conditional
    const isConditional = conditionalStack.length > 0;
    const condition = isConditional ? conditionalStack[conditionalStack.length - 1] ?? null : null;

    // Check if this is an early return (return in middle of function)
    const isEarlyReturn = this.isEarlyReturn(node);

    return {
      line,
      column,
      expression,
      valueType,
      isConditional,
      condition,
      isEarlyReturn,
    };
  }

  /**
   * Classify the type of value being returned.
   */
  private classifyValueType(node: SyntaxNode): ReturnPoint["valueType"] {
    switch (node.type) {
      case "string":
      case "number":
      case "true":
      case "false":
      case "null":
      case "undefined":
      case "template_string":
        return "literal";

      case "identifier":
        return "variable";

      case "call_expression":
      case "new_expression":
        return "call";

      default:
        return "expression";
    }
  }

  /**
   * Check if a return point returns null/undefined.
   */
  private isNullishReturn(point: ReturnPoint): boolean {
    if (!point.expression) return true; // void return
    const expr = point.expression.toLowerCase();
    return expr === "null" ||
           expr === "undefined" ||
           expr.includes("null") ||
           expr.includes("undefined");
  }

  /**
   * Identify data sources that contribute to the return value.
   */
  private identifyDataSources(point: ReturnPoint, _sourceCode: string): string[] {
    const sources: string[] = [];
    if (!point.expression) return sources;

    // Look for parameter references
    const paramPattern = /\b([a-z][a-zA-Z0-9]*)\b/g;
    let match;
    while ((match = paramPattern.exec(point.expression)) !== null) {
      const name = match[1];
      // Filter out keywords and common methods
      if (!this.isKeywordOrBuiltin(name ?? "")) {
        if (name && !sources.includes(name)) {
          sources.push(name);
        }
      }
    }

    return sources;
  }

  /**
   * Identify transformations applied before returning.
   */
  private identifyTransformations(point: ReturnPoint): string[] {
    const transforms: string[] = [];
    if (!point.expression) return transforms;

    const expr = point.expression;

    // Check for common transformations
    if (expr.includes(".map(")) transforms.push("map");
    if (expr.includes(".filter(")) transforms.push("filter");
    if (expr.includes(".reduce(")) transforms.push("reduce");
    if (expr.includes(".sort(")) transforms.push("sort");
    if (expr.includes(".slice(")) transforms.push("slice");
    if (expr.includes(".concat(")) transforms.push("concat");
    if (expr.includes("JSON.parse")) transforms.push("JSON.parse");
    if (expr.includes("JSON.stringify")) transforms.push("JSON.stringify");
    if (expr.includes("toString(")) transforms.push("toString");
    if (expr.includes("parseInt(")) transforms.push("parseInt");
    if (expr.includes("parseFloat(")) transforms.push("parseFloat");
    if (expr.includes("Object.keys")) transforms.push("Object.keys");
    if (expr.includes("Object.values")) transforms.push("Object.values");
    if (expr.includes("Object.entries")) transforms.push("Object.entries");
    if (expr.includes("Array.from")) transforms.push("Array.from");
    if (expr.includes("...")) transforms.push("spread");
    if (expr.includes("await ")) transforms.push("await");
    if (expr.includes("new ")) transforms.push("construct");

    return transforms;
  }

  /**
   * Extract conditions that lead to throwing instead of returning.
   */
  private extractErrorConditions(bodyNode: SyntaxNode, conditions: string[]): void {
    this.walkNode(bodyNode, (node) => {
      if (node.type === "throw_statement") {
        // Find the enclosing if statement
        const parent = this.findParentOfType(node, "if_statement");
        if (parent) {
          const condition = parent.childForFieldName("condition");
          if (condition && !conditions.includes(condition.text)) {
            conditions.push(condition.text);
          }
        } else {
          if (!conditions.includes("unconditional")) {
            conditions.push("unconditional");
          }
        }
      }
      return true;
    });
  }

  /**
   * Check if function can return void/undefined.
   */
  private canReturnVoid(returnPoints: ReturnPoint[], bodyNode: SyntaxNode | null): boolean {
    // No returns means void
    if (returnPoints.length === 0) return true;

    // Check for void returns
    for (const point of returnPoints) {
      if (!point.expression || point.expression === "undefined") {
        return true;
      }
    }

    // Check if there's a code path without return
    if (bodyNode) {
      return this.hasPathWithoutReturn(bodyNode);
    }

    return false;
  }

  /**
   * Check if there's a code path that doesn't return.
   */
  private hasPathWithoutReturn(bodyNode: SyntaxNode): boolean {
    // Simple heuristic: if the last statement is not a return or throw, it can return void
    if (bodyNode.type === "statement_block") {
      const statements = bodyNode.children.filter(c =>
        c.type !== "{" && c.type !== "}"
      );
      if (statements.length === 0) return true;

      const lastStatement = statements[statements.length - 1];
      if (lastStatement) {
        return lastStatement.type !== "return_statement" &&
               lastStatement.type !== "throw_statement";
      }
    }
    return false;
  }

  /**
   * Check if function always throws and never returns.
   */
  private checkAlwaysThrows(bodyNode: SyntaxNode | null, returnPoints: ReturnPoint[]): boolean {
    if (!bodyNode) return false;
    if (returnPoints.length > 0) return false;

    // Check if there's at least one throw
    let hasThrow = false;
    this.walkNode(bodyNode, (node) => {
      if (node.type === "throw_statement") {
        hasThrow = true;
        return false;
      }
      return true;
    });

    return hasThrow;
  }

  /**
   * Check if a return is an early return.
   */
  private isEarlyReturn(returnNode: SyntaxNode): boolean {
    // If return is inside an if statement, it's potentially early
    const parent = returnNode.parent;
    if (!parent) return false;

    // Check if there are siblings after this return
    const siblings = parent.children;
    const returnIndex = siblings.indexOf(returnNode);

    // If there are non-trivial siblings after, it's early return
    for (let i = returnIndex + 1; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling && sibling.type !== "}" && sibling.type !== "") {
        return true;
      }
    }

    // If inside an if block that's not the last statement in function, it's early
    const ifParent = this.findParentOfType(returnNode, "if_statement");
    return ifParent !== null;
  }

  /**
   * Infer return type from return points.
   */
  private inferReturnType(
    returnPoints: ReturnPoint[],
    declaredType: string | null
  ): string | null {
    if (declaredType) return declaredType;
    if (returnPoints.length === 0) return "void";

    // Collect types from return points
    const types = new Set<string>();

    for (const point of returnPoints) {
      if (!point.expression) {
        types.add("void");
      } else if (point.expression === "null") {
        types.add("null");
      } else if (point.expression === "undefined") {
        types.add("undefined");
      } else if (point.expression === "true" || point.expression === "false") {
        types.add("boolean");
      } else if (/^["'`]/.test(point.expression)) {
        types.add("string");
      } else if (/^\d/.test(point.expression)) {
        types.add("number");
      } else if (point.expression.startsWith("[")) {
        types.add("array");
      } else if (point.expression.startsWith("{")) {
        types.add("object");
      } else if (point.valueType === "call") {
        types.add("unknown"); // Can't infer from call
      } else {
        types.add("unknown");
      }
    }

    if (types.size === 1) {
      const [type] = types;
      return type ?? null;
    }

    // Multiple types - create union
    const typeArray = Array.from(types).filter(t => t !== "unknown");
    if (typeArray.length === 0) return null;
    if (typeArray.length === 1) return typeArray[0] ?? null;
    return typeArray.join(" | ");
  }

  /**
   * Check if a name is a keyword or builtin.
   */
  private isKeywordOrBuiltin(name: string): boolean {
    const keywords = new Set([
      "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
      "return", "throw", "try", "catch", "finally", "new", "delete", "typeof",
      "void", "null", "undefined", "true", "false", "this", "super", "class",
      "function", "const", "let", "var", "import", "export", "default", "from",
      "async", "await", "yield", "in", "of", "instanceof",
      "Array", "Object", "String", "Number", "Boolean", "Date", "Math", "JSON",
      "console", "Promise", "Error", "Map", "Set", "WeakMap", "WeakSet",
    ]);
    return keywords.has(name);
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
    // Remove newlines and extra whitespace
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= maxLength) return clean;
    return clean.slice(0, maxLength - 3) + "...";
  }

  /**
   * Calculate confidence based on analysis quality.
   */
  private calculateConfidence(semantics: ReturnSemantics): number {
    let score = 0.5; // Base score

    // Declared type increases confidence
    if (semantics.declaredType) score += 0.2;

    // Return points found increases confidence
    if (semantics.returnPoints.length > 0) score += 0.1;

    // Data sources identified increases confidence
    if (semantics.derivedFrom.length > 0) score += 0.1;

    // Known possible values increases confidence
    if (semantics.possibleValues.length > 0) score += 0.1;

    return Math.min(score, 1.0);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a ReturnAnalyzer instance.
 */
export function createReturnAnalyzer(): IReturnAnalyzer {
  return new ReturnAnalyzer();
}

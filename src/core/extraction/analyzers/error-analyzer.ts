/**
 * Error Path Analyzer
 *
 * Analyzes error handling patterns in functions:
 * - Throw statements and their conditions
 * - Try/catch block structure
 * - Error propagation paths
 * - Handling strategies
 *
 * @module
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import type {
  IErrorAnalyzer,
  ErrorAnalysisResult,
  ErrorPath,
  ThrowPoint,
  TryCatchBlock,
  ErrorHandlingStrategy,
} from "../../analysis/interfaces.js";

// =============================================================================
// Error Analyzer Implementation
// =============================================================================

/**
 * Analyzes error handling patterns in functions.
 *
 * @example
 * ```typescript
 * const analyzer = new ErrorAnalyzer();
 * const result = analyzer.analyze(functionNode, functionBody, "fn-123");
 * console.log(result.errorPaths);
 * ```
 */
export class ErrorAnalyzer implements IErrorAnalyzer {
  private errorPathCounter = 0;

  /**
   * Analyze error handling in a function.
   */
  analyze(
    functionNode: SyntaxNode,
    _functionBody: string,
    functionId: string
  ): ErrorAnalysisResult {
    // Get the function body node
    const bodyNode = functionNode.childForFieldName("body");

    const throwPoints: ThrowPoint[] = [];
    const tryCatchBlocks: TryCatchBlock[] = [];
    const errorPaths: ErrorPath[] = [];
    const escapingErrorTypes: string[] = [];

    if (bodyNode) {
      // Extract try/catch blocks
      this.extractTryCatchBlocks(bodyNode, tryCatchBlocks);

      // Extract throw points
      this.extractThrowPoints(bodyNode, throwPoints, tryCatchBlocks);

      // Build error paths
      this.buildErrorPaths(throwPoints, tryCatchBlocks, functionId, errorPaths);

      // Determine escaping error types
      this.determineEscapingTypes(throwPoints, tryCatchBlocks, escapingErrorTypes);
    }

    // Check if function never throws
    const neverThrows = throwPoints.length === 0 && !this.hasUnhandledCallsToThrowingFunctions(bodyNode);

    // Check for top-level catch
    const hasTopLevelCatch = this.hasTopLevelCatch(tryCatchBlocks, bodyNode);

    return {
      functionId,
      throwPoints,
      tryCatchBlocks,
      errorPaths,
      neverThrows,
      hasTopLevelCatch,
      escapingErrorTypes,
      confidence: this.calculateConfidence(throwPoints, tryCatchBlocks),
      analyzedAt: Date.now(),
    };
  }

  /**
   * Extract all try/catch blocks from the function body.
   */
  private extractTryCatchBlocks(bodyNode: SyntaxNode, blocks: TryCatchBlock[]): void {
    this.walkNode(bodyNode, (node) => {
      if (node.type === "try_statement") {
        const block = this.analyzeTryCatch(node);
        if (block) {
          blocks.push(block);
        }
      }
      return true; // Continue walking to find nested try/catch
    });
  }

  /**
   * Analyze a single try/catch statement.
   */
  private analyzeTryCatch(node: SyntaxNode): TryCatchBlock | null {
    // Find try block
    const tryBlock = node.childForFieldName("body");
    if (!tryBlock) return null;

    const tryStartLine = tryBlock.startPosition.row + 1;
    const tryEndLine = tryBlock.endPosition.row + 1;

    // Find catch clause
    let catchVariable: string | null = null;
    let catchType: string | null = null;
    let catchStartLine = 0;
    let catchEndLine = 0;
    let handlingStrategy: ErrorHandlingStrategy = "propagate";

    const catchClause = node.childForFieldName("handler");
    if (catchClause) {
      catchStartLine = catchClause.startPosition.row + 1;
      catchEndLine = catchClause.endPosition.row + 1;

      // Get catch parameter
      const parameter = catchClause.childForFieldName("parameter");
      if (parameter) {
        catchVariable = parameter.text;
        // Check for type annotation
        const typeAnnotation = parameter.childForFieldName("type");
        if (typeAnnotation) {
          catchType = typeAnnotation.text;
        }
      }

      // Determine handling strategy
      handlingStrategy = this.determineHandlingStrategy(catchClause);
    }

    // Find finally block
    let hasFinally = false;
    let finallyStartLine: number | null = null;
    let finallyEndLine: number | null = null;

    const finallyClause = node.childForFieldName("finalizer");
    if (finallyClause) {
      hasFinally = true;
      finallyStartLine = finallyClause.startPosition.row + 1;
      finallyEndLine = finallyClause.endPosition.row + 1;
    }

    return {
      tryStartLine,
      tryEndLine,
      catchVariable,
      catchType,
      handlingStrategy,
      catchStartLine,
      catchEndLine,
      hasFinally,
      finallyStartLine,
      finallyEndLine,
    };
  }

  /**
   * Determine how a catch block handles errors.
   */
  private determineHandlingStrategy(catchClause: SyntaxNode): ErrorHandlingStrategy {
    const catchBody = catchClause.childForFieldName("body");
    if (!catchBody) return "catch-ignore";

    let hasThrow = false;
    let hasConsoleOrLog = false;
    let hasReturn = false;
    let isEmpty = true;

    this.walkNode(catchBody, (node) => {
      // Check for throw (rethrow)
      if (node.type === "throw_statement") {
        hasThrow = true;
      }
      // Check for console.log/error or logging
      if (node.type === "call_expression") {
        const text = node.text.toLowerCase();
        if (text.includes("console.") || text.includes("log") || text.includes("logger")) {
          hasConsoleOrLog = true;
        }
      }
      // Check for return
      if (node.type === "return_statement") {
        hasReturn = true;
      }
      // Check if there's actual code
      if (node.type !== "{" && node.type !== "}" && node.text.trim() !== "") {
        isEmpty = false;
      }
      return true;
    });

    if (isEmpty) return "catch-ignore";
    if (hasThrow) return "catch-rethrow";
    if (hasReturn) return "catch-return";
    if (hasConsoleOrLog) return "catch-log";
    return "catch-handle";
  }

  /**
   * Extract all throw points from the function body.
   */
  private extractThrowPoints(
    bodyNode: SyntaxNode,
    throwPoints: ThrowPoint[],
    tryCatchBlocks: TryCatchBlock[]
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

      // Process throw statements
      if (node.type === "throw_statement") {
        const throwPoint = this.analyzeThrowStatement(node, conditionalStack, tryCatchBlocks);
        throwPoints.push(throwPoint);
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
  }

  /**
   * Analyze a single throw statement.
   */
  private analyzeThrowStatement(
    node: SyntaxNode,
    conditionalStack: string[],
    tryCatchBlocks: TryCatchBlock[]
  ): ThrowPoint {
    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;

    // Get the thrown expression
    let errorType = "Error";
    let errorMessage: string | null = null;
    let expression = "";

    // Find the expression being thrown
    for (const child of node.children) {
      if (child.type !== "throw") {
        expression = child.text;

        // Analyze the thrown value
        if (child.type === "new_expression") {
          // new Error("message")
          const constructor = child.childForFieldName("constructor");
          errorType = constructor?.text ?? "Error";

          // Get message if it's a string literal
          const args = child.childForFieldName("arguments");
          if (args) {
            const firstArg = args.children.find(c => c.type !== "(" && c.type !== ")" && c.type !== ",");
            if (firstArg && (firstArg.type === "string" || firstArg.type === "template_string")) {
              errorMessage = this.cleanString(firstArg.text);
            }
          }
        } else if (child.type === "identifier") {
          // throw existingError
          errorType = "unknown";
        } else if (child.type === "call_expression") {
          // throw createError()
          const func = child.childForFieldName("function");
          errorType = func?.text ?? "unknown";
        }
        break;
      }
    }

    // Determine condition
    const condition = conditionalStack.length > 0
      ? conditionalStack[conditionalStack.length - 1] ?? null
      : null;

    // Check if inside try block
    const isInsideTry = this.isInsideTryBlock(line, tryCatchBlocks);

    return {
      line,
      column,
      errorType,
      errorMessage,
      condition,
      isInsideTry,
      expression: this.truncate(expression, 100),
    };
  }

  /**
   * Check if a line is inside a try block.
   */
  private isInsideTryBlock(line: number, blocks: TryCatchBlock[]): boolean {
    for (const block of blocks) {
      if (line >= block.tryStartLine && line <= block.tryEndLine) {
        return true;
      }
    }
    return false;
  }

  /**
   * Build error paths from throw points and try/catch blocks.
   */
  private buildErrorPaths(
    throwPoints: ThrowPoint[],
    tryCatchBlocks: TryCatchBlock[],
    functionId: string,
    errorPaths: ErrorPath[]
  ): void {
    for (const throwPoint of throwPoints) {
      // Find enclosing try/catch if any
      const enclosingCatch = this.findEnclosingCatch(throwPoint.line, tryCatchBlocks);

      const errorPath: ErrorPath = {
        id: `error-${functionId}-${this.errorPathCounter++}`,
        functionId,
        errorType: throwPoint.errorType,
        condition: throwPoint.condition,
        isHandled: enclosingCatch !== null,
        handlingStrategy: enclosingCatch?.handlingStrategy ?? null,
        recoveryAction: enclosingCatch ? this.describeRecovery(enclosingCatch) : null,
        propagatesTo: [], // Will be resolved in cross-function analysis
        sourceLocation: {
          line: throwPoint.line,
          column: throwPoint.column,
        },
        stackContext: this.buildStackContext(throwPoint.line, tryCatchBlocks),
      };

      errorPaths.push(errorPath);
    }
  }

  /**
   * Find the enclosing catch block for a given line.
   */
  private findEnclosingCatch(line: number, blocks: TryCatchBlock[]): TryCatchBlock | null {
    for (const block of blocks) {
      if (line >= block.tryStartLine && line <= block.tryEndLine && block.catchStartLine > 0) {
        return block;
      }
    }
    return null;
  }

  /**
   * Describe the recovery action for a catch block.
   */
  private describeRecovery(block: TryCatchBlock): string {
    switch (block.handlingStrategy) {
      case "catch-rethrow":
        return "rethrows error";
      case "catch-return":
        return "returns error value";
      case "catch-log":
        return "logs and continues";
      case "catch-handle":
        return "handles error";
      case "catch-ignore":
        return "ignores error";
      default:
        return "unknown";
    }
  }

  /**
   * Build stack context for error path.
   */
  private buildStackContext(line: number, blocks: TryCatchBlock[]): string[] {
    const context: string[] = [];

    for (const block of blocks) {
      if (line >= block.tryStartLine && line <= block.tryEndLine) {
        context.push(`try block (lines ${block.tryStartLine}-${block.tryEndLine})`);
      }
    }

    return context;
  }

  /**
   * Determine which error types can escape this function.
   */
  private determineEscapingTypes(
    throwPoints: ThrowPoint[],
    tryCatchBlocks: TryCatchBlock[],
    escapingTypes: string[]
  ): void {
    for (const throwPoint of throwPoints) {
      if (!throwPoint.isInsideTry) {
        // Throw outside try block - escapes
        if (!escapingTypes.includes(throwPoint.errorType)) {
          escapingTypes.push(throwPoint.errorType);
        }
      } else {
        // Check if the enclosing catch rethrows
        const enclosingCatch = this.findEnclosingCatch(throwPoint.line, tryCatchBlocks);
        if (enclosingCatch?.handlingStrategy === "catch-rethrow") {
          if (!escapingTypes.includes(throwPoint.errorType)) {
            escapingTypes.push(throwPoint.errorType);
          }
        }
      }
    }
  }

  /**
   * Check if there are unhandled calls to potentially throwing functions.
   * This is a simple heuristic - true analysis would require call graph.
   */
  private hasUnhandledCallsToThrowingFunctions(bodyNode: SyntaxNode | null): boolean {
    if (!bodyNode) return false;

    // Look for common throwing patterns outside try/catch
    let hasThrowingCalls = false;
    let isInsideTry = false;
    let tryDepth = 0;

    this.walkNode(bodyNode, (node) => {
      if (node.type === "try_statement") {
        tryDepth++;
        isInsideTry = true;
      }

      if (isInsideTry && node.parent?.type === "try_statement" && node === node.parent.childForFieldName("body")) {
        // We're entering the try block body
      }

      if (node.type === "call_expression" && !isInsideTry) {
        const text = node.text;
        // Common throwing patterns
        if (text.includes("JSON.parse") ||
            text.includes("require(") ||
            text.includes("assert") ||
            text.includes("validate")) {
          hasThrowingCalls = true;
        }
      }

      // When leaving try statement
      if (node.type === "try_statement") {
        tryDepth--;
        if (tryDepth === 0) isInsideTry = false;
      }

      return true;
    });

    return hasThrowingCalls;
  }

  /**
   * Check if there's a top-level catch that catches all errors.
   */
  private hasTopLevelCatch(blocks: TryCatchBlock[], bodyNode: SyntaxNode | null): boolean {
    if (!bodyNode || blocks.length === 0) return false;

    // Check if any try/catch wraps the entire function body
    const bodyStart = bodyNode.startPosition.row + 1;
    const bodyEnd = bodyNode.endPosition.row + 1;

    for (const block of blocks) {
      // Allow for some flexibility (try might start after opening brace)
      if (block.tryStartLine <= bodyStart + 1 && block.tryEndLine >= bodyEnd - 1) {
        return true;
      }
    }

    return false;
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
   * Clean string literal (remove quotes).
   */
  private cleanString(text: string): string {
    return text.replace(/^["'`]|["'`]$/g, "");
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
   * Calculate confidence based on analysis quality.
   */
  private calculateConfidence(throwPoints: ThrowPoint[], tryCatchBlocks: TryCatchBlock[]): number {
    let score = 0.7; // Base score for error analysis

    // More throw points found = higher confidence
    if (throwPoints.length > 0) score += 0.1;

    // Try/catch blocks analyzed = higher confidence
    if (tryCatchBlocks.length > 0) score += 0.1;

    // Error types identified = higher confidence
    const knownTypes = throwPoints.filter(t => t.errorType !== "unknown").length;
    if (knownTypes > 0) score += 0.1;

    return Math.min(score, 1.0);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates an ErrorAnalyzer instance.
 */
export function createErrorAnalyzer(): IErrorAnalyzer {
  return new ErrorAnalyzer();
}

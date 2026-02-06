/**
 * Call Extractor
 *
 * Extracts function call relationships from parsed code.
 * Identifies which functions call which other functions.
 *
 * @module
 */

import type { Tree, Node } from "web-tree-sitter";
import type { UCEFile, UCEClass, UCEMethod, UCELocation } from "../../types/uce.js";

// =============================================================================
// Types
// =============================================================================

type SyntaxNode = Node;

/**
 * Represents a function call in the code.
 */
export interface FunctionCall {
  /** ID of the calling function (or file if top-level) */
  callerId: string;
  /** Name of the calling function */
  callerName: string;
  /** Name of the called function */
  calleeName: string;
  /** Line number where the call occurs */
  lineNumber: number;
  /** Column where the call occurs */
  column: number;
  /** Whether this is a direct function call (vs method call) */
  isDirectCall: boolean;
  /** Whether the call is awaited */
  isAwait: boolean;
  /** Whether this is a constructor call (new X()) */
  isConstructorCall: boolean;
  /** Object the method is called on (for method calls) */
  receiver: string | null;
  /** Arguments passed (as source text) */
  arguments: string[];
}

/**
 * Call graph for a file.
 */
export interface FileCallGraph {
  /** File path */
  filePath: string;
  /** All function calls in the file */
  calls: FunctionCall[];
  /** Map of function name to functions it calls */
  callsFrom: Map<string, string[]>;
  /** Map of function name to functions that call it */
  callsTo: Map<string, string[]>;
}

// =============================================================================
// Call Extractor Class
// =============================================================================

/**
 * Extracts function call relationships from Tree-sitter parse trees.
 *
 * @example
 * ```typescript
 * const extractor = new CallExtractor();
 *
 * // Extract from a parse tree
 * const callGraph = extractor.extractFromTree(tree, sourceCode, filePath);
 * console.log(callGraph.calls);
 *
 * // Or extract from UCE file and tree
 * const calls = extractor.extractFromUCE(uceFile, tree, sourceCode);
 * ```
 */
export class CallExtractor {
  private sourceCode: string = "";
  private filePath: string = "";

  /**
   * Extracts a complete call graph from a parse tree.
   */
  extractFromTree(
    tree: Tree,
    sourceCode: string,
    filePath: string
  ): FileCallGraph {
    this.sourceCode = sourceCode;
    this.filePath = filePath;

    const calls = this.extractCalls(tree.rootNode, null, "<module>");

    // Build call maps
    const callsFrom = new Map<string, string[]>();
    const callsTo = new Map<string, string[]>();

    for (const call of calls) {
      // Add to callsFrom
      const fromList = callsFrom.get(call.callerName) ?? [];
      if (!fromList.includes(call.calleeName)) {
        fromList.push(call.calleeName);
      }
      callsFrom.set(call.callerName, fromList);

      // Add to callsTo
      const toList = callsTo.get(call.calleeName) ?? [];
      if (!toList.includes(call.callerName)) {
        toList.push(call.callerName);
      }
      callsTo.set(call.calleeName, toList);
    }

    return {
      filePath,
      calls,
      callsFrom,
      callsTo,
    };
  }

  /**
   * Extracts calls from a UCE file with its original parse tree.
   * This provides richer context by knowing which UCE functions contain which calls.
   */
  extractFromUCE(
    uceFile: UCEFile,
    tree: Tree,
    sourceCode: string
  ): FunctionCall[] {
    this.sourceCode = sourceCode;
    this.filePath = uceFile.filePath;

    const allCalls: FunctionCall[] = [];

    // Extract calls from top-level functions
    for (const fn of uceFile.functions) {
      const fnNode = this.findNodeAtLocation(tree.rootNode, fn.location);
      if (fnNode) {
        const bodyNode = fnNode.childForFieldName("body");
        if (bodyNode) {
          const calls = this.extractCallsFromNode(bodyNode, fn.name);
          allCalls.push(...calls);
        }
      }
    }

    // Extract calls from class methods
    for (const cls of uceFile.classes) {
      // Constructor
      if (cls.constructor) {
        const calls = this.extractCallsForMethod(tree.rootNode, cls, cls.constructor);
        allCalls.push(...calls);
      }

      // Methods
      for (const method of cls.methods) {
        const calls = this.extractCallsForMethod(tree.rootNode, cls, method);
        allCalls.push(...calls);
      }
    }

    // Module-level calls (outside any function)
    const topLevelCalls = this.extractTopLevelCalls(tree.rootNode, uceFile);
    allCalls.push(...topLevelCalls);

    return allCalls;
  }

  /**
   * Extracts calls for a class method.
   */
  private extractCallsForMethod(
    rootNode: SyntaxNode,
    cls: UCEClass,
    method: UCEMethod
  ): FunctionCall[] {
    const methodNode = this.findNodeAtLocation(rootNode, method.location);
    if (!methodNode) return [];

    const bodyNode = methodNode.childForFieldName("body");
    if (!bodyNode) return [];

    const callerName = `${cls.name}.${method.name}`;
    return this.extractCallsFromNode(bodyNode, callerName);
  }

  /**
   * Extracts all calls from a syntax node.
   */
  private extractCalls(
    node: SyntaxNode,
    containingFunction: SyntaxNode | null,
    callerName: string
  ): FunctionCall[] {
    const calls: FunctionCall[] = [];

    this.walkNode(node, (child) => {
      // Track when entering a function
      if (this.isFunctionNode(child)) {
        // Avoid infinite recursion: if we're visiting the node we started with (which is a function),
        // we should proceed to walk its children instead of recurring on itself.
        if (child.id === node.id) {
          return true;
        }

        const fnName = this.getFunctionName(child) || "<anonymous>";
        calls.push(...this.extractCalls(child, child, fnName));
        return false; // Don't recurse, we handled it
      }

      // Extract call expressions
      if (child.type === "call_expression") {
        const call = this.parseCallExpression(child, callerName);
        if (call) {
          calls.push(call);
        }
      }

      // Extract new expressions (constructor calls)
      if (child.type === "new_expression") {
        const call = this.parseNewExpression(child, callerName);
        if (call) {
          calls.push(call);
        }
      }

      return true; // Continue walking
    });

    return calls;
  }

  /**
   * Extracts calls from a specific node (like a function body).
   */
  private extractCallsFromNode(node: SyntaxNode, callerName: string): FunctionCall[] {
    const calls: FunctionCall[] = [];

    this.walkNode(node, (child) => {
      // Don't descend into nested functions
      if (this.isFunctionNode(child)) {
        return false;
      }

      if (child.type === "call_expression") {
        const call = this.parseCallExpression(child, callerName);
        if (call) {
          calls.push(call);
        }
      }

      if (child.type === "new_expression") {
        const call = this.parseNewExpression(child, callerName);
        if (call) {
          calls.push(call);
        }
      }

      return true;
    });

    return calls;
  }

  /**
   * Extracts top-level calls (calls not inside any function).
   */
  private extractTopLevelCalls(rootNode: SyntaxNode, uceFile: UCEFile): FunctionCall[] {
    const calls: FunctionCall[] = [];

    // Collect ranges of all functions and classes to exclude
    const excludeRanges: Array<{ start: number; end: number }> = [];

    for (const fn of uceFile.functions) {
      excludeRanges.push({
        start: fn.location.startLine,
        end: fn.location.endLine,
      });
    }

    for (const cls of uceFile.classes) {
      excludeRanges.push({
        start: cls.location.startLine,
        end: cls.location.endLine,
      });
    }

    this.walkNode(rootNode, (child) => {
      // Skip functions and classes
      if (this.isFunctionNode(child) || child.type === "class_declaration") {
        return false;
      }

      // Check if this call is inside an excluded range
      const lineNum = child.startPosition.row + 1;
      const isInsideExcluded = excludeRanges.some(
        (r) => lineNum >= r.start && lineNum <= r.end
      );

      if (isInsideExcluded) {
        return true; // Skip but continue
      }

      if (child.type === "call_expression") {
        const call = this.parseCallExpression(child, "<module>");
        if (call) {
          calls.push(call);
        }
      }

      if (child.type === "new_expression") {
        const call = this.parseNewExpression(child, "<module>");
        if (call) {
          calls.push(call);
        }
      }

      return true;
    });

    return calls;
  }

  /**
   * Parses a call expression node.
   */
  private parseCallExpression(node: SyntaxNode, callerName: string): FunctionCall | null {
    const functionNode = node.childForFieldName("function");
    if (!functionNode) return null;

    let calleeName: string;
    let isDirectCall = true;
    let receiver: string | null = null;
    let isAwait = false;

    // Check if awaited
    const parent = node.parent;
    if (parent?.type === "await_expression") {
      isAwait = true;
    }

    // Handle different call patterns
    if (functionNode.type === "identifier") {
      // Direct function call: foo()
      calleeName = functionNode.text;
    } else if (functionNode.type === "member_expression") {
      // Method call: obj.method() or this.method()
      const objectNode = functionNode.childForFieldName("object");
      const propertyNode = functionNode.childForFieldName("property");

      receiver = objectNode?.text ?? null;
      calleeName = propertyNode?.text ?? functionNode.text;
      isDirectCall = false;

      // For this.method(), the callee is just the method name
      if (receiver === "this") {
        calleeName = propertyNode?.text ?? calleeName;
      }
    } else {
      // Complex expression like (getFunc())()
      calleeName = functionNode.text;
      isDirectCall = false;
    }

    // Extract arguments
    const argsNode = node.childForFieldName("arguments");
    const args = this.parseArguments(argsNode);

    return {
      callerId: `${this.filePath}:${callerName}`,
      callerName,
      calleeName,
      lineNumber: node.startPosition.row + 1,
      column: node.startPosition.column,
      isDirectCall,
      isAwait,
      isConstructorCall: false,
      receiver,
      arguments: args,
    };
  }

  /**
   * Parses a new expression (constructor call).
   */
  private parseNewExpression(node: SyntaxNode, callerName: string): FunctionCall | null {
    const constructorNode = node.childForFieldName("constructor");
    if (!constructorNode) return null;

    let calleeName: string;
    let receiver: string | null = null;

    if (constructorNode.type === "identifier") {
      calleeName = constructorNode.text;
    } else if (constructorNode.type === "member_expression") {
      const propertyNode = constructorNode.childForFieldName("property");
      const objectNode = constructorNode.childForFieldName("object");
      calleeName = propertyNode?.text ?? constructorNode.text;
      receiver = objectNode?.text ?? null;
    } else {
      calleeName = constructorNode.text;
    }

    const argsNode = node.childForFieldName("arguments");
    const args = this.parseArguments(argsNode);

    // Check if awaited
    const parent = node.parent;
    const isAwait = parent?.type === "await_expression";

    return {
      callerId: `${this.filePath}:${callerName}`,
      callerName,
      calleeName,
      lineNumber: node.startPosition.row + 1,
      column: node.startPosition.column,
      isDirectCall: true,
      isAwait,
      isConstructorCall: true,
      receiver,
      arguments: args,
    };
  }

  /**
   * Parses arguments from an arguments node.
   */
  private parseArguments(argsNode: SyntaxNode | null): string[] {
    if (!argsNode) return [];

    const args: string[] = [];
    for (const child of argsNode.children) {
      // Skip parentheses and commas
      if (child.type !== "(" && child.type !== ")" && child.type !== ",") {
        args.push(child.text);
      }
    }
    return args;
  }

  /**
   * Walks the syntax tree, calling the visitor for each node.
   * Uses iterative approach to avoid stack overflow on deep ASTs.
   */
  private walkNode(node: SyntaxNode, visitor: (node: SyntaxNode) => boolean): void {
    const stack: SyntaxNode[] = [node];

    while (stack.length > 0) {
      const current = stack.pop()!;

      // If visitor returns false, don't process children
      if (!visitor(current)) {
        continue;
      }

      // Add children in reverse order so they're processed in original order
      for (let i = current.children.length - 1; i >= 0; i--) {
        const child = current.children[i];
        if (child) {
          stack.push(child);
        }
      }
    }
  }

  /**
   * Checks if a node is a function definition.
   */
  private isFunctionNode(node: SyntaxNode): boolean {
    return [
      "function_declaration",
      "function_expression",
      "arrow_function",
      "method_definition",
      "generator_function_declaration",
    ].includes(node.type);
  }

  /**
   * Gets the name of a function node.
   */
  private getFunctionName(node: SyntaxNode): string | null {
    const nameNode = node.childForFieldName("name");
    return nameNode?.text ?? null;
  }

  /**
   * Finds a node at a specific location.
   */
  private findNodeAtLocation(rootNode: SyntaxNode, location: UCELocation): SyntaxNode | null {
    const targetLine = location.startLine - 1; // Convert to 0-indexed
    const targetCol = location.startColumn;

    let result: SyntaxNode | null = null;

    this.walkNode(rootNode, (node) => {
      if (
        node.startPosition.row === targetLine &&
        node.startPosition.column === targetCol
      ) {
        result = node;
        return false;
      }
      return true;
    });

    return result;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a CallExtractor instance.
 */
export function createCallExtractor(): CallExtractor {
  return new CallExtractor();
}

/**
 * Extracts function calls from a parse tree.
 * Convenience function for one-off extraction.
 */
export function extractCalls(
  tree: Tree,
  sourceCode: string,
  filePath: string
): FileCallGraph {
  const extractor = new CallExtractor();
  return extractor.extractFromTree(tree, sourceCode, filePath);
}

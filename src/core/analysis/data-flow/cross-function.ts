/**
 * Cross-Function Data Flow Analyzer
 *
 * Analyzes data flow across function boundaries, tracking how data
 * flows from caller to callee and back through return values.
 *
 * Key capabilities:
 * - Argument to parameter mapping
 * - Return value usage tracking
 * - Taint propagation across calls
 * - Call graph data flow traversal
 *
 * @module
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import type {
  ICrossFunctionAnalyzer,
  FunctionDataFlow,
  CrossFunctionFlow,
  ArgumentFlow,
  ReturnUsage,
} from "./interfaces.js";

// =============================================================================
// Implementation
// =============================================================================

/**
 * Analyzes data flow across function boundaries.
 */
export class CrossFunctionAnalyzer implements ICrossFunctionAnalyzer {
  /**
   * Analyze data flow between two functions at a call site.
   */
  analyzeCall(
    callerFlow: FunctionDataFlow,
    calleeFlow: FunctionDataFlow,
    callSiteNode: SyntaxNode
  ): CrossFunctionFlow {
    const arguments_ = this.extractArgumentFlows(
      callSiteNode,
      callerFlow,
      calleeFlow
    );
    const returnUsage = this.extractReturnUsage(callSiteNode, callerFlow);
    const propagatesTaint = this.checkTaintPropagation(arguments_, calleeFlow);

    return {
      callerId: callerFlow.functionId,
      calleeId: calleeFlow.functionId,
      callSite: callSiteNode.startPosition.row + 1,
      arguments: arguments_,
      returnUsage,
      propagatesTaint,
    };
  }

  /**
   * Build a complete data flow graph across multiple functions.
   */
  buildCrossFlowGraph(
    functionFlows: Map<string, FunctionDataFlow>,
    callGraph: Map<string, string[]>
  ): CrossFunctionFlow[] {
    const crossFlows: CrossFunctionFlow[] = [];

    for (const [callerId, calleeIds] of callGraph) {
      const callerFlow = functionFlows.get(callerId);
      if (!callerFlow) continue;

      for (const calleeId of calleeIds) {
        const calleeFlow = functionFlows.get(calleeId);
        if (!calleeFlow) continue;

        // Create a simplified cross-function flow without AST
        const flow = this.createSimplifiedFlow(callerFlow, calleeFlow);
        crossFlows.push(flow);
      }
    }

    return crossFlows;
  }

  /**
   * Trace data flow from a source function to all reachable functions.
   */
  traceDataFlow(
    sourceId: string,
    parameterName: string,
    functionFlows: Map<string, FunctionDataFlow>,
    crossFlows: CrossFunctionFlow[]
  ): string[] {
    const reachable: string[] = [];
    const visited = new Set<string>();
    const queue: Array<{ functionId: string; trackedParam: string }> = [
      { functionId: sourceId, trackedParam: parameterName },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(`${current.functionId}:${current.trackedParam}`)) continue;
      visited.add(`${current.functionId}:${current.trackedParam}`);

      const flow = functionFlows.get(current.functionId);
      if (!flow) continue;

      // Find all cross-function flows from this function
      const outgoingFlows = crossFlows.filter(
        (cf) => cf.callerId === current.functionId
      );

      for (const cf of outgoingFlows) {
        // Check if the tracked parameter flows to any argument
        const argFlow = cf.arguments.find(
          (a) => this.parameterFlowsToArgument(flow, current.trackedParam, a)
        );

        if (argFlow) {
          reachable.push(cf.calleeId);
          // Continue tracing with the parameter name in the callee
          queue.push({
            functionId: cf.calleeId,
            trackedParam: argFlow.parameterName,
          });
        }
      }
    }

    return [...new Set(reachable)];
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private extractArgumentFlows(
    callSiteNode: SyntaxNode,
    callerFlow: FunctionDataFlow,
    calleeFlow: FunctionDataFlow
  ): ArgumentFlow[] {
    const argumentFlows: ArgumentFlow[] = [];
    const argsNode = callSiteNode.childForFieldName("arguments");

    if (!argsNode) return argumentFlows;

    // Get parameter names from callee entry points
    const calleeParams = calleeFlow.entryPoints.map((ep) => {
      const node = calleeFlow.nodes.find((n) => n.id === ep);
      return node?.name || "";
    });

    let paramIndex = 0;
    for (const arg of argsNode.children) {
      // Skip punctuation
      if (arg.type === "," || arg.type === "(" || arg.type === ")") continue;

      const paramName = calleeParams[paramIndex] || `arg${paramIndex}`;

      // Find source node in caller
      let sourceNodeId = "";
      let isTainted = false;

      if (arg.type === "identifier") {
        const varName = arg.text;
        const sourceNode = callerFlow.nodes.find(
          (n) => n.name === varName && (n.kind === "variable" || n.kind === "parameter")
        );
        if (sourceNode) {
          sourceNodeId = sourceNode.id;
          isTainted = sourceNode.isTainted;
        }
      } else if (arg.type === "call_expression") {
        // Result of another call
        const callNode = callerFlow.nodes.find(
          (n) =>
            n.kind === "call_result" &&
            n.location.line === arg.startPosition.row + 1
        );
        if (callNode) {
          sourceNodeId = callNode.id;
          isTainted = callNode.isTainted;
        }
      }

      argumentFlows.push({
        parameterIndex: paramIndex,
        parameterName: paramName,
        sourceNodeId,
        isTainted,
      });

      paramIndex++;
    }

    return argumentFlows;
  }

  private extractReturnUsage(
    callSiteNode: SyntaxNode,
    callerFlow: FunctionDataFlow
  ): ReturnUsage | null {
    // Check parent to see how return value is used
    const parent = callSiteNode.parent;
    if (!parent) return null;

    if (parent.type === "variable_declarator") {
      // Assigned to a variable
      const nameNode = parent.childForFieldName("name");
      if (nameNode) {
        const targetNode = callerFlow.nodes.find(
          (n) => n.name === nameNode.text && n.kind === "variable"
        );
        return {
          usageKind: "assigned",
          targetNodeId: targetNode?.id || null,
          assignedTo: nameNode.text,
        };
      }
    } else if (parent.type === "return_statement") {
      // Returned directly
      const returnNode = callerFlow.nodes.find(
        (n) =>
          n.kind === "return" &&
          n.location.line === parent.startPosition.row + 1
      );
      return {
        usageKind: "returned",
        targetNodeId: returnNode?.id || null,
        assignedTo: null,
      };
    } else if (parent.type === "arguments") {
      // Passed to another function
      return {
        usageKind: "passed",
        targetNodeId: null,
        assignedTo: null,
      };
    } else if (
      parent.type === "if_statement" ||
      parent.type === "conditional_expression"
    ) {
      // Used in a condition
      return {
        usageKind: "conditional",
        targetNodeId: null,
        assignedTo: null,
      };
    } else if (parent.type === "expression_statement") {
      // Call result ignored
      return {
        usageKind: "ignored",
        targetNodeId: null,
        assignedTo: null,
      };
    }

    return null;
  }

  private checkTaintPropagation(
    arguments_: ArgumentFlow[],
    calleeFlow: FunctionDataFlow
  ): boolean {
    // Check if any tainted argument flows to a return point
    for (const arg of arguments_) {
      if (!arg.isTainted) continue;

      // Find the parameter node in callee
      const paramNode = calleeFlow.nodes.find(
        (n) => n.kind === "parameter" && n.name === arg.parameterName
      );
      if (!paramNode) continue;

      // Check if this parameter affects any exit point
      for (const exitId of calleeFlow.exitPoints) {
        if (this.pathExists(paramNode.id, exitId, calleeFlow.edges)) {
          return true;
        }
      }
    }

    return false;
  }

  private createSimplifiedFlow(
    callerFlow: FunctionDataFlow,
    calleeFlow: FunctionDataFlow
  ): CrossFunctionFlow {
    // Create argument flows based on entry/exit points
    const arguments_: ArgumentFlow[] = [];
    const callerExits = callerFlow.nodes.filter((n) =>
      callerFlow.exitPoints.includes(n.id)
    );
    const calleeParams = calleeFlow.nodes.filter((n) =>
      calleeFlow.entryPoints.includes(n.id)
    );

    for (let i = 0; i < calleeParams.length; i++) {
      const param = calleeParams[i];
      if (param) {
        arguments_.push({
          parameterIndex: i,
          parameterName: param.name,
          sourceNodeId: "", // Unknown without call site AST
          isTainted: false,
        });
      }
    }

    // Check for taint propagation
    const propagatesTaint = callerFlow.nodes.some(
      (n) => n.isTainted && calleeFlow.nodes.some((cn) => cn.isTainted)
    );

    return {
      callerId: callerFlow.functionId,
      calleeId: calleeFlow.functionId,
      callSite: 0, // Unknown without call site AST
      arguments: arguments_,
      returnUsage: null,
      propagatesTaint,
    };
  }

  private parameterFlowsToArgument(
    flow: FunctionDataFlow,
    paramName: string,
    argFlow: ArgumentFlow
  ): boolean {
    // Find the parameter node
    const paramNode = flow.nodes.find(
      (n) => n.kind === "parameter" && n.name === paramName
    );
    if (!paramNode) return false;

    // Check if there's a path from param to the argument source
    if (argFlow.sourceNodeId) {
      return (
        paramNode.id === argFlow.sourceNodeId ||
        this.pathExists(paramNode.id, argFlow.sourceNodeId, flow.edges)
      );
    }

    return false;
  }

  private pathExists(
    fromId: string,
    toId: string,
    edges: FunctionDataFlow["edges"]
  ): boolean {
    const visited = new Set<string>();
    const queue = [fromId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === toId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const edge of edges) {
        if (edge.from === current && !visited.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }

    return false;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a cross-function data flow analyzer instance.
 */
export function createCrossFunctionAnalyzer(): ICrossFunctionAnalyzer {
  return new CrossFunctionAnalyzer();
}

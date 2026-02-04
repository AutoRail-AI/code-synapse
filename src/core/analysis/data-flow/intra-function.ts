/**
 * Intra-Function Data Flow Analyzer
 *
 * Analyzes data flow within a single function, tracking how values
 * flow from parameters through variables to return statements.
 *
 * Key capabilities:
 * - Parameter to return tracing
 * - Variable assignment tracking
 * - Taint source detection
 * - Side-effect identification
 * - Pure function detection
 *
 * @module
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import type {
  IDataFlowAnalyzer,
  DataFlowNode,
  DataFlowEdge,
  DataFlowNodeKind,
  DataFlowEdgeKind,
  FunctionDataFlow,
  FunctionDataFlowSummary,
  TaintFlow,
  TaintSource,
  DataFlowAnalysisOptions,
} from "./interfaces.js";
import { DEFAULT_DATA_FLOW_OPTIONS } from "./interfaces.js";

// =============================================================================
// Helper Types
// =============================================================================

interface VariableInfo {
  name: string;
  nodeId: string;
  definedAt: { line: number; column: number };
  isMutated: boolean;
  assignments: number[];
  reads: number[];
}

interface ExternalAccessInfo {
  name: string;
  accessType: "read" | "write" | "call";
  line: number;
  category: TaintSource;
}

// =============================================================================
// Constants
// =============================================================================

/** Patterns that indicate taint sources */
const TAINT_PATTERNS: Record<TaintSource, RegExp[]> = {
  user_input: [
    /\breq\.(body|params|query|headers)/,
    /\bprocess\.argv/,
    /\breadline/,
    /\bprompt\(/,
    /\.value\s*$/,  // form input values
    /\bgetElementBy/,
    /\bquerySelector/,
  ],
  network: [
    /\bfetch\(/,
    /\baxios\./,
    /\bhttp\./,
    /\bhttps\./,
    /\bWebSocket/,
    /\.get\(|\.post\(|\.put\(|\.delete\(/,
    /\bXMLHttpRequest/,
  ],
  filesystem: [
    /\bfs\./,
    /\breadFile/i,
    /\breaddir/i,
    /\bwriteFile/i,
    /\bcreateReadStream/,
    /\bcreateWriteStream/,
    /\bpath\./,
  ],
  database: [
    /\bquery\(/,
    /\bexecute\(/,
    /\bfindOne\(/,
    /\bfindMany\(/,
    /\bfind\(/,
    /\bsave\(/,
    /\binsert\(/,
    /\bupdate\(/,
    /\bdelete\(/,
    /\bprisma\./,
    /\bmongoose\./,
    /\bsequelize\./,
  ],
  environment: [
    /\bprocess\.env/,
    /\bDeno\.env/,
    /\bimport\.meta\.env/,
  ],
  time: [
    /\bDate\.now\(/,
    /\bnew Date\(/,
    /\bperformance\.now\(/,
  ],
  random: [
    /\bMath\.random\(/,
    /\bcrypto\.randomBytes/,
    /\bcrypto\.getRandomValues/,
    /\buuid\(/,
  ],
  external_api: [
    /\bsdk\./i,
    /\bclient\./,
    /\bapi\./i,
  ],
  unknown: [],
};

/** Patterns that indicate side effects */
const SIDE_EFFECT_PATTERNS = [
  /\bconsole\./,
  /\blogger\./,
  /\bfs\.write/,
  /\bfs\.append/,
  /\bfs\.mkdir/,
  /\bfs\.rm/,
  /\bfs\.unlink/,
  /\.emit\(/,
  /\.dispatch\(/,
  /\.send\(/,
  /\.post\(/,
  /\.put\(/,
  /\.delete\(/,
  /\.save\(/,
  /\.insert\(/,
  /\.update\(/,
  /\bsetState\(/,
  /\bthis\.\w+\s*=/,
];

/** Patterns that indicate external state access */
const EXTERNAL_STATE_PATTERNS = [
  /\bglobal\./,
  /\bwindow\./,
  /\bdocument\./,
  /\bprocess\./,
  /\bmodule\./,
  /\bexports\./,
];

// =============================================================================
// Implementation
// =============================================================================

/**
 * Analyzes data flow within a single function.
 */
export class DataFlowAnalyzer implements IDataFlowAnalyzer {
  private options: DataFlowAnalysisOptions;
  private nodeIdCounter = 0;

  constructor(options: Partial<DataFlowAnalysisOptions> = {}) {
    this.options = { ...DEFAULT_DATA_FLOW_OPTIONS, ...options };
  }

  /**
   * Analyze data flow within a single function.
   */
  analyzeFunction(
    functionNode: SyntaxNode,
    functionBody: string,
    functionId: string
  ): FunctionDataFlow {
    this.nodeIdCounter = 0;
    const nodes: DataFlowNode[] = [];
    const edges: DataFlowEdge[] = [];
    const entryPoints: string[] = [];
    const exitPoints: string[] = [];
    const mutatedVariables: string[] = [];
    const externalDependencies: string[] = [];
    const variables = new Map<string, VariableInfo>();

    // Extract parameters as entry points
    const parameters = this.extractParameters(functionNode);
    for (const param of parameters) {
      const node = this.createNode(
        functionId,
        "parameter",
        param.name,
        param.line,
        param.column,
        param.type
      );
      nodes.push(node);
      entryPoints.push(node.id);
      variables.set(param.name, {
        name: param.name,
        nodeId: node.id,
        definedAt: { line: param.line, column: param.column },
        isMutated: false,
        assignments: [param.line],
        reads: [],
      });
    }

    // Analyze function body for data flow
    const bodyNode = this.findFunctionBody(functionNode);
    if (bodyNode) {
      this.analyzeNode(
        bodyNode,
        functionBody,
        functionId,
        nodes,
        edges,
        variables,
        exitPoints,
        mutatedVariables,
        externalDependencies
      );
    }

    // Detect taint in nodes
    if (this.options.trackTaint) {
      this.detectTaint(nodes, functionBody);
    }

    // Calculate confidence based on analysis completeness
    const confidence = this.calculateConfidence(nodes, edges, functionBody);

    return {
      functionId,
      nodes,
      edges,
      entryPoints,
      exitPoints,
      mutatedVariables: [...new Set(mutatedVariables)],
      externalDependencies: [...new Set(externalDependencies)],
      confidence,
      analyzedAt: Date.now(),
    };
  }

  /**
   * Get a summary of a function's data flow.
   */
  summarize(dataFlow: FunctionDataFlow): FunctionDataFlowSummary {
    const hasSideEffects = this.detectSideEffects(dataFlow);
    const accessesExternalState = this.detectExternalStateAccess(dataFlow);
    const inputsAffectingOutput = this.traceInputsToOutput(dataFlow);

    // A function is pure if it has no side effects, doesn't access external state,
    // and its output depends only on its inputs
    const isPure =
      !hasSideEffects &&
      !accessesExternalState &&
      dataFlow.mutatedVariables.length === 0 &&
      dataFlow.externalDependencies.length === 0;

    return {
      functionId: dataFlow.functionId,
      nodeCount: dataFlow.nodes.length,
      edgeCount: dataFlow.edges.length,
      hasSideEffects,
      accessesExternalState,
      isPure,
      inputsAffectingOutput,
    };
  }

  /**
   * Detect taint flows within a function.
   */
  detectTaintFlows(dataFlow: FunctionDataFlow): TaintFlow[] {
    const taintFlows: TaintFlow[] = [];
    const taintedNodes = dataFlow.nodes.filter((n) => n.isTainted);

    for (const source of taintedNodes) {
      // Trace forward from tainted node to find sinks
      const visited = new Set<string>();
      const path: string[] = [source.id];
      const sinks = this.traceTaintForward(
        source.id,
        dataFlow.edges,
        visited,
        path
      );

      for (const sink of sinks) {
        const sinkNode = dataFlow.nodes.find((n) => n.id === sink.nodeId);
        if (sinkNode) {
          taintFlows.push({
            source: (source.taintSource as TaintSource) || "unknown",
            originNodeId: source.id,
            path: sink.path,
            sinkNodeId: sink.nodeId,
            isSanitized: false,
            sanitizationPoint: null,
          });
        }
      }
    }

    return taintFlows;
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private createNode(
    functionId: string,
    kind: DataFlowNodeKind,
    name: string,
    line: number,
    column: number,
    type: string | null = null,
    isTainted = false,
    taintSource: TaintSource | null = null
  ): DataFlowNode {
    return {
      id: `df-${functionId}-${this.nodeIdCounter++}`,
      kind,
      name,
      location: { line, column },
      type,
      isTainted,
      taintSource,
    };
  }

  private extractParameters(
    functionNode: SyntaxNode
  ): Array<{ name: string; type: string | null; line: number; column: number }> {
    const params: Array<{
      name: string;
      type: string | null;
      line: number;
      column: number;
    }> = [];

    // Find parameters node
    const paramsNode =
      functionNode.childForFieldName("parameters") ||
      functionNode.children.find(
        (c) =>
          c.type === "formal_parameters" || c.type === "parameters"
      );

    if (!paramsNode) return params;

    // Extract each parameter
    for (const child of paramsNode.children) {
      if (
        child.type === "required_parameter" ||
        child.type === "optional_parameter" ||
        child.type === "rest_parameter" ||
        child.type === "identifier" ||
        child.type === "pattern"
      ) {
        const nameNode =
          child.childForFieldName("pattern") ||
          child.childForFieldName("name") ||
          child;

        if (nameNode && nameNode.type === "identifier") {
          const typeNode = child.childForFieldName("type");
          params.push({
            name: nameNode.text,
            type: typeNode?.text || null,
            line: nameNode.startPosition.row + 1,
            column: nameNode.startPosition.column,
          });
        }
      }
    }

    return params;
  }

  private findFunctionBody(functionNode: SyntaxNode): SyntaxNode | null {
    return (
      functionNode.childForFieldName("body") ||
      functionNode.children.find(
        (c) =>
          c.type === "statement_block" ||
          c.type === "expression" ||
          c.type === "block"
      ) ||
      null
    );
  }

  private analyzeNode(
    node: SyntaxNode,
    functionBody: string,
    functionId: string,
    nodes: DataFlowNode[],
    edges: DataFlowEdge[],
    variables: Map<string, VariableInfo>,
    exitPoints: string[],
    mutatedVariables: string[],
    externalDependencies: string[]
  ): void {
    switch (node.type) {
      case "variable_declaration":
      case "lexical_declaration":
        this.analyzeVariableDeclaration(
          node,
          functionId,
          nodes,
          edges,
          variables
        );
        break;

      case "assignment_expression":
        this.analyzeAssignment(
          node,
          functionId,
          nodes,
          edges,
          variables,
          mutatedVariables
        );
        break;

      case "return_statement":
        this.analyzeReturn(
          node,
          functionId,
          nodes,
          edges,
          variables,
          exitPoints
        );
        break;

      case "call_expression":
        this.analyzeCallExpression(
          node,
          functionId,
          nodes,
          edges,
          variables,
          externalDependencies
        );
        break;

      case "member_expression":
        if (this.isExternalAccess(node)) {
          externalDependencies.push(node.text);
        }
        break;
    }

    // Recursively analyze children
    for (const child of node.children) {
      this.analyzeNode(
        child,
        functionBody,
        functionId,
        nodes,
        edges,
        variables,
        exitPoints,
        mutatedVariables,
        externalDependencies
      );
    }
  }

  private analyzeVariableDeclaration(
    node: SyntaxNode,
    functionId: string,
    nodes: DataFlowNode[],
    edges: DataFlowEdge[],
    variables: Map<string, VariableInfo>
  ): void {
    for (const declarator of node.children) {
      if (declarator.type === "variable_declarator") {
        const nameNode = declarator.childForFieldName("name");
        const valueNode = declarator.childForFieldName("value");
        const typeNode = declarator.childForFieldName("type");

        if (nameNode && nameNode.type === "identifier") {
          const varNode = this.createNode(
            functionId,
            "variable",
            nameNode.text,
            nameNode.startPosition.row + 1,
            nameNode.startPosition.column,
            typeNode?.text || null
          );
          nodes.push(varNode);

          variables.set(nameNode.text, {
            name: nameNode.text,
            nodeId: varNode.id,
            definedAt: {
              line: nameNode.startPosition.row + 1,
              column: nameNode.startPosition.column,
            },
            isMutated: false,
            assignments: [nameNode.startPosition.row + 1],
            reads: [],
          });

          // Create edge from value to variable if value exists
          if (valueNode) {
            this.createEdgeFromExpression(
              valueNode,
              varNode.id,
              functionId,
              nodes,
              edges,
              variables
            );
          }
        }
      }
    }
  }

  private analyzeAssignment(
    node: SyntaxNode,
    functionId: string,
    nodes: DataFlowNode[],
    edges: DataFlowEdge[],
    variables: Map<string, VariableInfo>,
    mutatedVariables: string[]
  ): void {
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");

    if (left && left.type === "identifier" && right) {
      const varName = left.text;
      const varInfo = variables.get(varName);

      if (varInfo) {
        // Variable is being reassigned
        varInfo.isMutated = true;
        varInfo.assignments.push(left.startPosition.row + 1);
        mutatedVariables.push(varName);

        // Create edge from right side to variable
        this.createEdgeFromExpression(
          right,
          varInfo.nodeId,
          functionId,
          nodes,
          edges,
          variables
        );
      }
    }
  }

  private analyzeReturn(
    node: SyntaxNode,
    functionId: string,
    nodes: DataFlowNode[],
    edges: DataFlowEdge[],
    variables: Map<string, VariableInfo>,
    exitPoints: string[]
  ): void {
    const returnNode = this.createNode(
      functionId,
      "return",
      "return",
      node.startPosition.row + 1,
      node.startPosition.column
    );
    nodes.push(returnNode);
    exitPoints.push(returnNode.id);

    // Find the expression being returned
    const expression = node.children.find(
      (c) => c.type !== "return" && c.type !== ";"
    );
    if (expression) {
      this.createEdgeFromExpression(
        expression,
        returnNode.id,
        functionId,
        nodes,
        edges,
        variables
      );
    }
  }

  private analyzeCallExpression(
    node: SyntaxNode,
    functionId: string,
    nodes: DataFlowNode[],
    edges: DataFlowEdge[],
    variables: Map<string, VariableInfo>,
    externalDependencies: string[]
  ): void {
    const functionName = node.childForFieldName("function");
    if (functionName) {
      // Track call result as a node
      const callNode = this.createNode(
        functionId,
        "call_result",
        functionName.text,
        node.startPosition.row + 1,
        node.startPosition.column
      );
      nodes.push(callNode);

      // Check for external dependencies
      if (this.isExternalCall(node)) {
        externalDependencies.push(functionName.text);
      }

      // Create edges from arguments to call
      const args = node.childForFieldName("arguments");
      if (args) {
        for (const arg of args.children) {
          if (arg.type === "identifier") {
            const varInfo = variables.get(arg.text);
            if (varInfo) {
              edges.push({
                from: varInfo.nodeId,
                to: callNode.id,
                kind: "parameter",
                transformation: null,
                condition: null,
                lineNumber: arg.startPosition.row + 1,
                propagatesTaint: true,
              });
            }
          }
        }
      }
    }
  }

  private createEdgeFromExpression(
    expression: SyntaxNode,
    targetNodeId: string,
    functionId: string,
    nodes: DataFlowNode[],
    edges: DataFlowEdge[],
    variables: Map<string, VariableInfo>
  ): void {
    if (expression.type === "identifier") {
      // Direct reference to another variable
      const varInfo = variables.get(expression.text);
      if (varInfo) {
        varInfo.reads.push(expression.startPosition.row + 1);
        edges.push({
          from: varInfo.nodeId,
          to: targetNodeId,
          kind: "assign",
          transformation: null,
          condition: null,
          lineNumber: expression.startPosition.row + 1,
          propagatesTaint: true,
        });
      }
    } else if (expression.type === "call_expression") {
      // Call expression - create a call_result node
      const callNode = this.createNode(
        functionId,
        "call_result",
        expression.childForFieldName("function")?.text || "call",
        expression.startPosition.row + 1,
        expression.startPosition.column
      );
      nodes.push(callNode);
      edges.push({
        from: callNode.id,
        to: targetNodeId,
        kind: "transform",
        transformation: callNode.name,
        condition: null,
        lineNumber: expression.startPosition.row + 1,
        propagatesTaint: true,
      });
    } else if (
      expression.type === "binary_expression" ||
      expression.type === "template_string"
    ) {
      // Composite expression - trace through
      for (const child of expression.children) {
        if (child.type === "identifier") {
          const varInfo = variables.get(child.text);
          if (varInfo) {
            varInfo.reads.push(child.startPosition.row + 1);
            edges.push({
              from: varInfo.nodeId,
              to: targetNodeId,
              kind: "transform",
              transformation: expression.type,
              condition: null,
              lineNumber: child.startPosition.row + 1,
              propagatesTaint: true,
            });
          }
        }
      }
    } else if (
      expression.type === "string" ||
      expression.type === "number" ||
      expression.type === "true" ||
      expression.type === "false" ||
      expression.type === "null"
    ) {
      // Literal value
      if (this.options.includeLiterals) {
        const litNode = this.createNode(
          functionId,
          "literal",
          expression.text,
          expression.startPosition.row + 1,
          expression.startPosition.column
        );
        nodes.push(litNode);
        edges.push({
          from: litNode.id,
          to: targetNodeId,
          kind: "assign",
          transformation: null,
          condition: null,
          lineNumber: expression.startPosition.row + 1,
          propagatesTaint: false,
        });
      }
    }
  }

  private isExternalCall(node: SyntaxNode): boolean {
    const funcNode = node.childForFieldName("function");
    if (!funcNode) return false;
    const text = funcNode.text;
    return SIDE_EFFECT_PATTERNS.some((p) => p.test(text));
  }

  private isExternalAccess(node: SyntaxNode): boolean {
    return EXTERNAL_STATE_PATTERNS.some((p) => p.test(node.text));
  }

  private detectTaint(nodes: DataFlowNode[], functionBody: string): void {
    for (const node of nodes) {
      for (const [source, patterns] of Object.entries(TAINT_PATTERNS)) {
        if (source === "unknown") continue;
        for (const pattern of patterns) {
          if (pattern.test(node.name) || pattern.test(functionBody)) {
            // Check if this specific node is related to the taint
            if (
              pattern.test(node.name) ||
              (node.kind === "call_result" && pattern.test(node.name))
            ) {
              node.isTainted = true;
              node.taintSource = source as TaintSource;
              break;
            }
          }
        }
        if (node.isTainted) break;
      }
    }
  }

  private detectSideEffects(dataFlow: FunctionDataFlow): boolean {
    // Check if any node represents a side effect
    for (const node of dataFlow.nodes) {
      if (SIDE_EFFECT_PATTERNS.some((p) => p.test(node.name))) {
        return true;
      }
    }
    return dataFlow.mutatedVariables.length > 0;
  }

  private detectExternalStateAccess(dataFlow: FunctionDataFlow): boolean {
    return dataFlow.externalDependencies.some((dep) =>
      EXTERNAL_STATE_PATTERNS.some((p) => p.test(dep))
    );
  }

  private traceInputsToOutput(dataFlow: FunctionDataFlow): string[] {
    const inputsAffectingOutput: string[] = [];

    // For each exit point, trace back to find which entry points affect it
    for (const exitId of dataFlow.exitPoints) {
      const visited = new Set<string>();
      const affecting = this.traceBackward(
        exitId,
        dataFlow.edges,
        dataFlow.entryPoints,
        visited
      );
      inputsAffectingOutput.push(...affecting);
    }

    // Map IDs back to parameter names
    const paramNames = inputsAffectingOutput.map((id) => {
      const node = dataFlow.nodes.find((n) => n.id === id);
      return node?.name || id;
    });

    return [...new Set(paramNames)];
  }

  private traceBackward(
    nodeId: string,
    edges: DataFlowEdge[],
    entryPoints: string[],
    visited: Set<string>
  ): string[] {
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);

    if (entryPoints.includes(nodeId)) {
      return [nodeId];
    }

    const result: string[] = [];
    for (const edge of edges) {
      if (edge.to === nodeId) {
        result.push(...this.traceBackward(edge.from, edges, entryPoints, visited));
      }
    }

    return result;
  }

  private traceTaintForward(
    nodeId: string,
    edges: DataFlowEdge[],
    visited: Set<string>,
    path: string[]
  ): Array<{ nodeId: string; path: string[] }> {
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);

    const sinks: Array<{ nodeId: string; path: string[] }> = [];

    // Find edges from this node
    const outEdges = edges.filter((e) => e.from === nodeId && e.propagatesTaint);

    if (outEdges.length === 0) {
      // This is a sink
      sinks.push({ nodeId, path: [...path] });
    } else {
      for (const edge of outEdges) {
        const newPath = [...path, edge.to];
        sinks.push(
          ...this.traceTaintForward(edge.to, edges, visited, newPath)
        );
      }
    }

    return sinks;
  }

  private calculateConfidence(
    nodes: DataFlowNode[],
    edges: DataFlowEdge[],
    functionBody: string
  ): number {
    // Base confidence
    let confidence = 0.5;

    // Increase confidence if we found nodes
    if (nodes.length > 0) {
      confidence += 0.2;
    }

    // Increase confidence if we found edges
    if (edges.length > 0) {
      confidence += 0.2;
    }

    // Decrease confidence for very complex functions
    const lineCount = functionBody.split("\n").length;
    if (lineCount > 50) {
      confidence -= 0.1;
    }

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, confidence));
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a data flow analyzer instance.
 */
export function createDataFlowAnalyzer(
  options?: Partial<DataFlowAnalysisOptions>
): IDataFlowAnalyzer {
  return new DataFlowAnalyzer(options);
}

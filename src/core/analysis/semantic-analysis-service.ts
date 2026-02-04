/**
 * Semantic Analysis Service
 *
 * Bridges UCE entities with Phase 1-3 analyzers by:
 * 1. Re-parsing function bodies to get AST nodes
 * 2. Running parameter, return, and error analyzers (Phase 1)
 * 3. Running side-effect analysis (Phase 3)
 * 4. Converting results to database rows
 *
 * This service enables semantic analysis integration without
 * requiring changes to the UCE format or extraction pipeline.
 *
 * @module
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import type { IParser } from "../interfaces/IParser.js";
import type { UCEFunction, UCEClass, UCEMethod } from "../../types/uce.js";
import type {
  ParameterSemanticsRow,
  ReturnSemanticsRow,
  ErrorPathRow,
  ErrorAnalysisRow,
  SideEffectRow,
  SideEffectSummaryRow,
  HasSideEffectRow,
  HasSideEffectSummaryRow,
} from "../extraction/types.js";
import { generateEntityId } from "../extraction/id-generator.js";
import { ParameterAnalyzer } from "../extraction/analyzers/parameter-analyzer.js";
import { ReturnAnalyzer } from "../extraction/analyzers/return-analyzer.js";
import { ErrorAnalyzer } from "../extraction/analyzers/error-analyzer.js";
import { SideEffectAnalyzer, createSideEffectCategorizer } from "./side-effects/index.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("semantic-analysis-service");

// =============================================================================
// Types
// =============================================================================

/**
 * Result of semantic analysis for a function.
 */
export interface FunctionSemanticAnalysisResult {
  functionId: string;
  parameterSemantics: ParameterSemanticsRow[];
  returnSemantics: ReturnSemanticsRow | null;
  errorPaths: ErrorPathRow[];
  errorAnalysis: ErrorAnalysisRow | null;
  // Phase 3: Side-Effect Analysis
  sideEffects: SideEffectRow[];
  sideEffectSummary: SideEffectSummaryRow | null;
  hasSideEffect: HasSideEffectRow[];
  hasSideEffectSummary: HasSideEffectSummaryRow | null;
}

/**
 * Batch result of semantic analysis for a file.
 */
export interface FileSemanticAnalysisResult {
  fileId: string;
  functions: FunctionSemanticAnalysisResult[];
  stats: {
    functionsAnalyzed: number;
    parametersAnalyzed: number;
    returnPointsFound: number;
    errorPathsFound: number;
    sideEffectsFound: number;
    pureFunctionsFound: number;
    analysisTimeMs: number;
  };
}

/**
 * Options for semantic analysis.
 */
export interface SemanticAnalysisOptions {
  /** Whether to analyze parameters */
  analyzeParameters?: boolean;
  /** Whether to analyze return values */
  analyzeReturns?: boolean;
  /** Whether to analyze error paths */
  analyzeErrors?: boolean;
  /** Whether to analyze side effects (Phase 3) */
  analyzeSideEffects?: boolean;
  /** Timeout per function in milliseconds */
  timeoutPerFunction?: number;
}

const DEFAULT_OPTIONS: Required<SemanticAnalysisOptions> = {
  analyzeParameters: true,
  analyzeReturns: true,
  analyzeErrors: true,
  analyzeSideEffects: true,
  timeoutPerFunction: 5000,
};

// =============================================================================
// Semantic Analysis Service
// =============================================================================

/**
 * Service that performs Phase 1-3 semantic analysis on UCE entities.
 */
export class SemanticAnalysisService {
  private parameterAnalyzer: ParameterAnalyzer;
  private returnAnalyzer: ReturnAnalyzer;
  private errorAnalyzer: ErrorAnalyzer;
  private sideEffectAnalyzer: SideEffectAnalyzer;
  private options: Required<SemanticAnalysisOptions>;

  constructor(options: SemanticAnalysisOptions = {}) {
    this.parameterAnalyzer = new ParameterAnalyzer();
    this.returnAnalyzer = new ReturnAnalyzer();
    this.errorAnalyzer = new ErrorAnalyzer();
    this.sideEffectAnalyzer = new SideEffectAnalyzer(createSideEffectCategorizer());
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Analyze all functions in a file.
   *
   * @param functions - UCE functions to analyze
   * @param classes - UCE classes (for method analysis)
   * @param fileId - File entity ID
   * @param language - Language for parsing
   * @param parser - Parser with AST access
   */
  async analyzeFile(
    functions: UCEFunction[],
    classes: UCEClass[],
    fileId: string,
    filePath: string,
    language: string,
    parser: IParser
  ): Promise<FileSemanticAnalysisResult> {
    const startTime = Date.now();
    const results: FunctionSemanticAnalysisResult[] = [];
    let parametersAnalyzed = 0;
    let returnPointsFound = 0;
    let errorPathsFound = 0;
    let sideEffectsFound = 0;
    let pureFunctionsFound = 0;

    // Check if parser supports function body parsing
    if (!parser.parseFunctionBody) {
      logger.warn("Parser does not support parseFunctionBody - skipping semantic analysis");
      return {
        fileId,
        functions: [],
        stats: {
          functionsAnalyzed: 0,
          parametersAnalyzed: 0,
          returnPointsFound: 0,
          errorPathsFound: 0,
          sideEffectsFound: 0,
          pureFunctionsFound: 0,
          analysisTimeMs: Date.now() - startTime,
        },
      };
    }

    // Analyze standalone functions
    for (const fn of functions) {
      try {
        const functionId = generateEntityId(fileId, "function", fn.name, fn.signature, "");
        const result = await this.analyzeFunction(fn, functionId, filePath, language, parser);
        if (result) {
          results.push(result);
          parametersAnalyzed += result.parameterSemantics.length;
          returnPointsFound += result.returnSemantics ? 1 : 0;
          errorPathsFound += result.errorPaths.length;
          sideEffectsFound += result.sideEffects.length;
          if (result.sideEffectSummary && result.sideEffectSummary[3] === true) {
            pureFunctionsFound++;
          }
        }
      } catch (error) {
        logger.warn({ function: fn.name, error }, "Failed to analyze function");
      }
    }

    // Analyze class methods
    for (const cls of classes) {
      const classId = generateEntityId(fileId, "class", cls.name, "", "");

      for (const method of cls.methods) {
        try {
          const methodId = generateEntityId(classId, "method", method.name, method.signature, "");
          const result = await this.analyzeMethod(method, methodId, filePath, language, parser);
          if (result) {
            results.push(result);
            parametersAnalyzed += result.parameterSemantics.length;
            returnPointsFound += result.returnSemantics ? 1 : 0;
            errorPathsFound += result.errorPaths.length;
            sideEffectsFound += result.sideEffects.length;
            if (result.sideEffectSummary && result.sideEffectSummary[3] === true) {
              pureFunctionsFound++;
            }
          }
        } catch (error) {
          logger.warn({ class: cls.name, method: method.name, error }, "Failed to analyze method");
        }
      }
    }

    return {
      fileId,
      functions: results,
      stats: {
        functionsAnalyzed: results.length,
        parametersAnalyzed,
        returnPointsFound,
        errorPathsFound,
        sideEffectsFound,
        pureFunctionsFound,
        analysisTimeMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Analyze a single function.
   */
  async analyzeFunction(
    fn: UCEFunction,
    functionId: string,
    filePath: string,
    language: string,
    parser: IParser
  ): Promise<FunctionSemanticAnalysisResult | null> {
    if (!fn.body || !parser.parseFunctionBody) {
      return null;
    }

    // Parse function body to get AST
    const bodyNode = await parser.parseFunctionBody(fn.body, language);
    if (!bodyNode) {
      return null;
    }

    return this.runAnalyzers(bodyNode, fn.body, functionId, filePath);
  }

  /**
   * Analyze a class method.
   */
  async analyzeMethod(
    method: UCEMethod,
    methodId: string,
    filePath: string,
    language: string,
    parser: IParser
  ): Promise<FunctionSemanticAnalysisResult | null> {
    if (!method.body || !parser.parseFunctionBody) {
      return null;
    }

    // Parse method body to get AST
    const bodyNode = await parser.parseFunctionBody(method.body, language);
    if (!bodyNode) {
      return null;
    }

    return this.runAnalyzers(bodyNode, method.body, methodId, filePath);
  }

  /**
   * Run all analyzers on a function/method body.
   */
  private runAnalyzers(
    bodyNode: SyntaxNode,
    body: string,
    functionId: string,
    filePath: string
  ): FunctionSemanticAnalysisResult {
    const parameterSemantics: ParameterSemanticsRow[] = [];
    let returnSemantics: ReturnSemanticsRow | null = null;
    const errorPaths: ErrorPathRow[] = [];
    let errorAnalysis: ErrorAnalysisRow | null = null;
    const sideEffects: SideEffectRow[] = [];
    let sideEffectSummary: SideEffectSummaryRow | null = null;
    const hasSideEffect: HasSideEffectRow[] = [];
    let hasSideEffectSummary: HasSideEffectSummaryRow | null = null;

    // Parameter analysis
    if (this.options.analyzeParameters) {
      try {
        const paramResult = this.parameterAnalyzer.analyze(bodyNode, body, functionId);
        for (const param of paramResult.parameters) {
          const id = generateEntityId(functionId, "param-semantics", param.name, "", param.index.toString());
          parameterSemantics.push([
            id,
            functionId,
            param.name,
            param.index,
            param.type,
            param.purpose,
            param.isOptional,
            param.isRest,
            param.isDestructured,
            param.defaultValue,
            JSON.stringify(param.validationRules),
            JSON.stringify(param.usedInExpressions),
            param.isMutated,
            JSON.stringify(param.accessedAtLines),
            paramResult.confidence,
            paramResult.analyzedAt,
          ]);
        }
      } catch (error) {
        logger.debug({ functionId, error }, "Parameter analysis failed");
      }
    }

    // Return analysis
    if (this.options.analyzeReturns) {
      try {
        const returnResult = this.returnAnalyzer.analyze(bodyNode, body, functionId);
        const id = generateEntityId(functionId, "return-semantics", "return", "", "");
        const rs = returnResult.returnSemantics;
        returnSemantics = [
          id,
          functionId,
          rs.declaredType,
          rs.inferredType,
          JSON.stringify(rs.returnPoints),
          JSON.stringify(rs.possibleValues),
          JSON.stringify(rs.nullConditions),
          JSON.stringify(rs.errorConditions),
          JSON.stringify(rs.derivedFrom),
          JSON.stringify(rs.transformations),
          rs.canReturnVoid,
          rs.alwaysThrows,
          returnResult.confidence,
          returnResult.analyzedAt,
        ];
      } catch (error) {
        logger.debug({ functionId, error }, "Return analysis failed");
      }
    }

    // Error analysis
    if (this.options.analyzeErrors) {
      try {
        const errorResult = this.errorAnalyzer.analyze(bodyNode, body, functionId);

        // Error paths
        for (const path of errorResult.errorPaths) {
          errorPaths.push([
            path.id,
            path.functionId,
            path.errorType,
            path.condition,
            path.isHandled,
            path.handlingStrategy,
            path.recoveryAction,
            JSON.stringify(path.propagatesTo),
            JSON.stringify(path.sourceLocation),
            JSON.stringify(path.stackContext),
            errorResult.confidence,
            errorResult.analyzedAt,
          ]);
        }

        // Error analysis summary
        const analysisId = generateEntityId(functionId, "error-analysis", "summary", "", "");
        errorAnalysis = [
          analysisId,
          functionId,
          JSON.stringify(errorResult.throwPoints),
          JSON.stringify(errorResult.tryCatchBlocks),
          errorResult.neverThrows,
          errorResult.hasTopLevelCatch,
          JSON.stringify(errorResult.escapingErrorTypes),
          errorResult.confidence,
          errorResult.analyzedAt,
        ];
      } catch (error) {
        logger.debug({ functionId, error }, "Error analysis failed");
      }
    }

    // Side-effect analysis (Phase 3)
    if (this.options.analyzeSideEffects) {
      try {
        const seResult = this.sideEffectAnalyzer.analyze(bodyNode, body, functionId, filePath);

        // Convert side effects to rows
        for (const effect of seResult.sideEffects) {
          sideEffects.push([
            effect.id,
            effect.functionId,
            filePath,
            effect.category,
            effect.description,
            effect.target,
            effect.apiCall,
            effect.isConditional,
            effect.condition,
            effect.confidence,
            JSON.stringify(effect.evidence),
            effect.location.line,
            effect.location.column,
            seResult.analyzedAt,
          ]);

          // Add relationship
          hasSideEffect.push([functionId, effect.id]);
        }

        // Create summary row
        const summary = seResult.summary;
        sideEffectSummary = [
          functionId,
          filePath,
          summary.totalCount,
          summary.isPure,
          summary.allConditional,
          JSON.stringify(summary.primaryCategories),
          summary.riskLevel,
          seResult.confidence,
          seResult.analyzedAt,
        ];

        // Add summary relationship
        hasSideEffectSummary = [functionId, functionId];
      } catch (error) {
        logger.debug({ functionId, error }, "Side-effect analysis failed");
      }
    }

    return {
      functionId,
      parameterSemantics,
      returnSemantics,
      errorPaths,
      errorAnalysis,
      sideEffects,
      sideEffectSummary,
      hasSideEffect,
      hasSideEffectSummary,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a semantic analysis service instance.
 */
export function createSemanticAnalysisService(
  options?: SemanticAnalysisOptions
): SemanticAnalysisService {
  return new SemanticAnalysisService(options);
}

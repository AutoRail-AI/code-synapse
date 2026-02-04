/**
 * Analysis Context Builder
 *
 * Builds enhanced analysis context for justification by querying
 * Phase 1-4 analysis results from the graph store.
 *
 * @module
 */

import type { IGraphStore } from "../../interfaces/IGraphStore.js";
import type {
  EnhancedAnalysisContext,
  SideEffectContext,
  ErrorBehaviorContext,
  DataFlowContext,
  PatternContext,
} from "../models/justification.js";
import { createLogger } from "../../../utils/logger.js";

const logger = createLogger("analysis-context-builder");

/**
 * Options for analysis context building.
 */
export interface AnalysisContextOptions {
  /** Whether to include side-effect analysis */
  includeSideEffects?: boolean;
  /** Whether to include error behavior analysis */
  includeErrorBehavior?: boolean;
  /** Whether to include data flow analysis */
  includeDataFlow?: boolean;
  /** Whether to include pattern detection */
  includePatterns?: boolean;
}

const DEFAULT_OPTIONS: Required<AnalysisContextOptions> = {
  includeSideEffects: true,
  includeErrorBehavior: true,
  includeDataFlow: true,
  includePatterns: true,
};

/**
 * Builds enhanced analysis context from Phase 1-4 results.
 */
export class AnalysisContextBuilder {
  private store: IGraphStore;
  private options: Required<AnalysisContextOptions>;

  constructor(store: IGraphStore, options?: AnalysisContextOptions) {
    this.store = store;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Build enhanced analysis context for an entity.
   *
   * @param entityId - The entity ID (function, method, class)
   * @param entityType - The entity type
   * @returns Enhanced analysis context or undefined if no analysis data
   */
  async buildContext(
    entityId: string,
    entityType: string
  ): Promise<EnhancedAnalysisContext | undefined> {
    const context: EnhancedAnalysisContext = {};

    // Only functions/methods have Phase 1-3 analysis
    if (entityType === "function" || entityType === "method") {
      const [sideEffects, errorBehavior, dataFlow] = await Promise.all([
        this.options.includeSideEffects
          ? this.getSideEffectContext(entityId)
          : Promise.resolve(undefined),
        this.options.includeErrorBehavior
          ? this.getErrorBehaviorContext(entityId)
          : Promise.resolve(undefined),
        this.options.includeDataFlow
          ? this.getDataFlowContext(entityId)
          : Promise.resolve(undefined),
      ]);

      if (sideEffects) context.sideEffects = sideEffects;
      if (errorBehavior) context.errorBehavior = errorBehavior;
      if (dataFlow) context.dataFlow = dataFlow;
    }

    // All entity types can participate in patterns
    if (this.options.includePatterns) {
      const patterns = await this.getPatternContext(entityId);
      if (patterns && patterns.patterns.length > 0) {
        context.patterns = patterns;
      }
    }

    // Return undefined if no analysis data found
    if (Object.keys(context).length === 0) {
      return undefined;
    }

    return context;
  }

  /**
   * Get side-effect context for a function/method.
   */
  private async getSideEffectContext(
    functionId: string
  ): Promise<SideEffectContext | undefined> {
    try {
      // Query side-effect summary
      const summaryQuery = `
        ?[total_count, is_pure, all_conditional, primary_categories_json, risk_level] :=
          *function_side_effect_summary{
            function_id: $functionId,
            total_count,
            is_pure,
            all_conditional,
            primary_categories_json,
            risk_level
          }
      `;

      const summaryResult = await this.store.query(summaryQuery, {
        functionId,
      });

      if (summaryResult.rows.length === 0) {
        return undefined;
      }

      const [totalCount, isPure, _allConditional, categoriesJson, riskLevel] =
        summaryResult.rows[0] as unknown as [number, boolean, boolean, string, string];

      // Query individual side effects for descriptions
      const effectsQuery = `
        ?[description, category] :=
          *side_effect{
            function_id: $functionId,
            description,
            category
          }
        :limit 5
      `;

      const effectsResult = await this.store.query(effectsQuery, {
        functionId,
      });

      const descriptions = effectsResult.rows.map(
        (row) => row[0] as string
      );
      const categories = JSON.parse(categoriesJson) as string[];

      return {
        totalCount,
        isPure,
        categories,
        descriptions,
        riskLevel: riskLevel as "low" | "medium" | "high",
      };
    } catch (error) {
      logger.debug({ functionId, error }, "Failed to get side-effect context");
      return undefined;
    }
  }

  /**
   * Get error behavior context for a function/method.
   */
  private async getErrorBehaviorContext(
    functionId: string
  ): Promise<ErrorBehaviorContext | undefined> {
    try {
      // Query error analysis
      const analysisQuery = `
        ?[throw_points, never_throws, has_top_level_catch, escaping_error_types] :=
          *function_error_analysis{
            function_id: $functionId,
            throw_points,
            never_throws,
            has_top_level_catch,
            escaping_error_types
          }
      `;

      const analysisResult = await this.store.query(analysisQuery, {
        functionId,
      });

      if (analysisResult.rows.length === 0) {
        return undefined;
      }

      const [throwPointsJson, neverThrows, hasTopLevelCatch, escapingTypesJson] =
        analysisResult.rows[0] as unknown as [string, boolean, boolean, string];

      const throwPoints = JSON.parse(throwPointsJson) as Array<{
        errorType: string;
      }>;
      const escapingErrorTypes = JSON.parse(escapingTypesJson) as string[];
      const canThrow = !neverThrows;
      const errorTypes = [...new Set(throwPoints.map((tp) => tp.errorType))];
      const allHandled = hasTopLevelCatch || escapingErrorTypes.length === 0;

      // Build summary
      let summary: string;
      if (neverThrows) {
        summary = "Does not throw any errors";
      } else if (allHandled) {
        summary = `Throws ${errorTypes.join(", ")} but handles all errors internally`;
      } else {
        summary = `May throw ${escapingErrorTypes.join(", ")} that propagate to callers`;
      }

      return {
        canThrow,
        errorTypes,
        allHandled,
        escapingErrorTypes,
        summary,
      };
    } catch (error) {
      logger.debug({ functionId, error }, "Failed to get error behavior context");
      return undefined;
    }
  }

  /**
   * Get data flow context for a function/method.
   */
  private async getDataFlowContext(
    functionId: string
  ): Promise<DataFlowContext | undefined> {
    try {
      // Query data flow cache
      const cacheQuery = `
        ?[is_pure, has_side_effects, accesses_external_state, inputs_affecting_output] :=
          *data_flow_cache{
            function_id: $functionId,
            is_pure,
            has_side_effects,
            accesses_external_state,
            inputs_affecting_output
          }
      `;

      const cacheResult = await this.store.query(cacheQuery, {
        functionId,
      });

      if (cacheResult.rows.length === 0) {
        return undefined;
      }

      const [isPure, _hasSideEffects, accessesExternalState, inputsJson] =
        cacheResult.rows[0] as unknown as [boolean, boolean, boolean, string];

      const inputsAffectingOutput = JSON.parse(inputsJson) as string[];

      // Build summary
      let summary: string;
      if (isPure) {
        summary = "Pure function with deterministic output based on inputs";
      } else if (accessesExternalState) {
        summary = `Accesses external state; output affected by: ${inputsAffectingOutput.join(", ") || "external data"}`;
      } else {
        summary = `Output depends on: ${inputsAffectingOutput.join(", ") || "internal computation"}`;
      }

      return {
        isAnalyzed: true,
        isPure,
        inputsAffectingOutput,
        accessesExternalState,
        summary,
      };
    } catch (error) {
      logger.debug({ functionId, error }, "Failed to get data flow context");
      return undefined;
    }
  }

  /**
   * Get pattern context for any entity.
   */
  private async getPatternContext(
    entityId: string
  ): Promise<PatternContext | undefined> {
    try {
      // Query patterns this entity participates in
      const patternsQuery = `
        ?[pattern_type, role, name, confidence_level] :=
          *has_pattern{from_id: $entityId, to_id: pattern_id, role},
          *design_pattern{id: pattern_id, pattern_type, name, confidence_level}
      `;

      const patternsResult = await this.store.query(patternsQuery, {
        entityId,
      });

      if (patternsResult.rows.length === 0) {
        return undefined;
      }

      const patterns = patternsResult.rows.map((row) => ({
        patternType: row[0] as string,
        role: row[1] as string,
        patternName: row[2] as string,
        confidenceLevel: row[3] as "high" | "medium" | "low",
      }));

      return { patterns };
    } catch (error) {
      logger.debug({ entityId, error }, "Failed to get pattern context");
      return undefined;
    }
  }
}

/**
 * Create an analysis context builder.
 */
export function createAnalysisContextBuilder(
  store: IGraphStore,
  options?: AnalysisContextOptions
): AnalysisContextBuilder {
  return new AnalysisContextBuilder(store, options);
}

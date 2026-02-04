/**
 * Pattern Analysis Service
 *
 * Orchestrates design pattern detection across the codebase.
 * Uses registered detectors to find patterns in classes, functions, and interfaces.
 *
 * @module
 */

import type {
  IPatternAnalysisService,
  IPatternDetector,
  PatternAnalysisContext,
  PatternAnalysisResult,
  PatternDetectionOptions,
  DesignPatternType,
  DetectedPattern,
  ClassInfo,
  FunctionInfo,
  InterfaceInfo,
  DEFAULT_PATTERN_OPTIONS,
} from "./interfaces.js";
import { createAllDetectors } from "./detectors/index.js";
import { createLogger } from "../../../utils/logger.js";

const logger = createLogger("pattern-analysis-service");

/**
 * Service that performs design pattern analysis.
 */
export class PatternAnalysisService implements IPatternAnalysisService {
  private detectors: Map<DesignPatternType, IPatternDetector> = new Map();
  private defaultOptions: PatternDetectionOptions;

  constructor(options?: PatternDetectionOptions) {
    this.defaultOptions = {
      minConfidence: 0.5,
      patternTypes: [
        "factory",
        "singleton",
        "observer",
        "repository",
        "service",
        "adapter",
        "builder",
        "strategy",
        "decorator",
      ],
      crossFileAnalysis: true,
      maxDepth: 3,
      ...options,
    };

    // Register default detectors
    for (const detector of createAllDetectors()) {
      this.registerDetector(detector);
    }
  }

  /**
   * Register a pattern detector.
   */
  registerDetector(detector: IPatternDetector): void {
    this.detectors.set(detector.patternType, detector);
    logger.debug({ patternType: detector.patternType }, "Registered pattern detector");
  }

  /**
   * Get all registered detectors.
   */
  getDetectors(): IPatternDetector[] {
    return Array.from(this.detectors.values());
  }

  /**
   * Get detector for a specific pattern type.
   */
  getDetector(patternType: DesignPatternType): IPatternDetector | undefined {
    return this.detectors.get(patternType);
  }

  /**
   * Analyze a context for all supported design patterns.
   */
  analyze(
    context: PatternAnalysisContext,
    options?: PatternDetectionOptions
  ): PatternAnalysisResult {
    const startTime = Date.now();
    const mergedOptions = { ...this.defaultOptions, ...options };
    const allPatterns: DetectedPattern[] = [];

    // Run each detector
    for (const detector of this.detectors.values()) {
      // Skip if pattern type not enabled
      if (
        mergedOptions.patternTypes &&
        !mergedOptions.patternTypes.includes(detector.patternType)
      ) {
        continue;
      }

      try {
        const patterns = detector.detect(context, mergedOptions);
        allPatterns.push(...patterns);
        logger.debug(
          {
            patternType: detector.patternType,
            patternsFound: patterns.length,
          },
          "Detector completed"
        );
      } catch (error) {
        logger.warn(
          { patternType: detector.patternType, error },
          "Detector failed"
        );
      }
    }

    // Deduplicate patterns (same participants might be detected by multiple detectors)
    const dedupedPatterns = this.deduplicatePatterns(allPatterns);

    // Build statistics
    const stats = this.buildStats(dedupedPatterns, context, startTime);

    // Calculate overall confidence
    const confidence =
      dedupedPatterns.length > 0
        ? dedupedPatterns.reduce((sum, p) => sum + p.confidence, 0) /
          dedupedPatterns.length
        : 0;

    return {
      patterns: dedupedPatterns,
      stats,
      confidence,
      analyzedAt: Date.now(),
    };
  }

  /**
   * Analyze a single file for design patterns.
   */
  analyzeFile(
    classes: ClassInfo[],
    functions: FunctionInfo[],
    interfaces: InterfaceInfo[],
    filePath: string,
    options?: PatternDetectionOptions
  ): PatternAnalysisResult {
    const context: PatternAnalysisContext = {
      classes,
      functions,
      interfaces,
      filePath,
    };

    return this.analyze(context, options);
  }

  /**
   * Deduplicate patterns based on participants.
   */
  private deduplicatePatterns(patterns: DetectedPattern[]): DetectedPattern[] {
    const seen = new Map<string, DetectedPattern>();

    for (const pattern of patterns) {
      // Create key from pattern type + sorted participant IDs
      const participantIds = pattern.participants
        .map((p) => p.entityId)
        .sort()
        .join(",");
      const key = `${pattern.patternType}:${participantIds}`;

      const existing = seen.get(key);
      if (!existing || pattern.confidence > existing.confidence) {
        seen.set(key, pattern);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Build analysis statistics.
   */
  private buildStats(
    patterns: DetectedPattern[],
    context: PatternAnalysisContext,
    startTime: number
  ): PatternAnalysisResult["stats"] {
    const patternsByType: Record<DesignPatternType, number> = {
      factory: 0,
      singleton: 0,
      observer: 0,
      repository: 0,
      service: 0,
      adapter: 0,
      builder: 0,
      strategy: 0,
      decorator: 0,
      facade: 0,
      proxy: 0,
      composite: 0,
      unknown: 0,
    };

    let highConfidence = 0;
    let mediumConfidence = 0;
    let lowConfidence = 0;

    for (const pattern of patterns) {
      patternsByType[pattern.patternType]++;

      if (pattern.confidenceLevel === "high") {
        highConfidence++;
      } else if (pattern.confidenceLevel === "medium") {
        mediumConfidence++;
      } else {
        lowConfidence++;
      }
    }

    return {
      totalPatterns: patterns.length,
      patternsByType,
      highConfidenceCount: highConfidence,
      mediumConfidenceCount: mediumConfidence,
      lowConfidenceCount: lowConfidence,
      entitiesAnalyzed:
        context.classes.length +
        context.functions.length +
        context.interfaces.length,
      analysisTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Create a pattern analysis service.
 */
export function createPatternAnalysisService(
  options?: PatternDetectionOptions
): PatternAnalysisService {
  return new PatternAnalysisService(options);
}

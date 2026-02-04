/**
 * Base Pattern Detector
 *
 * Provides common functionality for all pattern detectors.
 *
 * @module
 */

import type {
  IPatternDetector,
  DesignPatternType,
  PatternHeuristic,
  DetectedPattern,
  PatternParticipant,
  PatternAnalysisContext,
  PatternDetectionOptions,
  PatternConfidence,
} from "../interfaces.js";

// Simple ID generator (fallback if uuid not available)
function generateId(): string {
  return `pattern-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Base class for pattern detectors.
 * Provides common utility methods for pattern detection.
 */
export abstract class BasePatternDetector implements IPatternDetector {
  abstract readonly patternType: DesignPatternType;

  /**
   * Detect patterns in the given context.
   * Must be implemented by subclasses.
   */
  abstract detect(
    context: PatternAnalysisContext,
    options?: PatternDetectionOptions
  ): DetectedPattern[];

  /**
   * Get heuristics used by this detector.
   * Must be implemented by subclasses.
   */
  abstract getHeuristics(): PatternHeuristic[];

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Generate a unique pattern ID.
   */
  protected generatePatternId(): string {
    return generateId();
  }

  /**
   * Convert a numeric confidence score to a confidence level.
   */
  protected getConfidenceLevel(confidence: number): PatternConfidence {
    if (confidence >= 0.8) return "high";
    if (confidence >= 0.5) return "medium";
    return "low";
  }

  /**
   * Create a detected pattern instance.
   */
  protected createPattern(params: {
    name: string;
    confidence: number;
    participants: PatternParticipant[];
    evidence: string[];
    filePaths: string[];
    description?: string;
  }): DetectedPattern {
    return {
      id: this.generatePatternId(),
      patternType: this.patternType,
      name: params.name,
      confidence: params.confidence,
      confidenceLevel: this.getConfidenceLevel(params.confidence),
      participants: params.participants,
      evidence: params.evidence,
      filePaths: [...new Set(params.filePaths)], // Dedupe
      description: params.description,
      detectedAt: Date.now(),
    };
  }

  /**
   * Check if a method name matches common patterns.
   */
  protected matchesMethodPattern(
    methodName: string,
    patterns: string[]
  ): boolean {
    const lowerName = methodName.toLowerCase();
    return patterns.some(
      (pattern) =>
        lowerName === pattern.toLowerCase() ||
        lowerName.startsWith(pattern.toLowerCase()) ||
        lowerName.endsWith(pattern.toLowerCase())
    );
  }

  /**
   * Check if a class has a method matching the given patterns.
   */
  protected hasMethodMatching(
    cls: { methods: Array<{ name: string }> },
    patterns: string[]
  ): boolean {
    return cls.methods.some((m) => this.matchesMethodPattern(m.name, patterns));
  }

  /**
   * Check if a string contains common keywords.
   */
  protected containsKeywords(text: string, keywords: string[]): boolean {
    const lowerText = text.toLowerCase();
    return keywords.some((kw) => lowerText.includes(kw.toLowerCase()));
  }

  /**
   * Calculate weighted confidence from multiple signals.
   */
  protected calculateWeightedConfidence(
    signals: Array<{ weight: number; matched: boolean }>
  ): number {
    const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
    const matchedWeight = signals
      .filter((s) => s.matched)
      .reduce((sum, s) => sum + s.weight, 0);
    return totalWeight > 0 ? matchedWeight / totalWeight : 0;
  }

  /**
   * Check if options allow this pattern type.
   */
  protected isPatternTypeEnabled(options?: PatternDetectionOptions): boolean {
    if (!options?.patternTypes) return true;
    return options.patternTypes.includes(this.patternType);
  }

  /**
   * Check if confidence meets minimum threshold.
   */
  protected meetsConfidenceThreshold(
    confidence: number,
    options?: PatternDetectionOptions
  ): boolean {
    const minConfidence = options?.minConfidence ?? 0.5;
    return confidence >= minConfidence;
  }
}

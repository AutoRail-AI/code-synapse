/**
 * Singleton Pattern Detector
 *
 * Detects Singleton design pattern instances:
 * - Private constructor with static getInstance method
 * - Module-level instance with lazy initialization
 * - Class with static instance property
 *
 * Heuristics:
 * - Private/protected constructor
 * - Static getInstance, instance, or similar method
 * - Static property holding the instance
 * - Module exports single instance
 *
 * @module
 */

import { BasePatternDetector } from "./base-detector.js";
import type {
  DesignPatternType,
  PatternHeuristic,
  DetectedPattern,
  PatternParticipant,
  PatternAnalysisContext,
  PatternDetectionOptions,
  ClassInfo,
} from "../interfaces.js";

// Singleton method/property name patterns
const SINGLETON_METHOD_PATTERNS = [
  "getInstance",
  "instance",
  "getinstance",
  "get_instance",
  "shared",
  "sharedInstance",
  "default",
];

const SINGLETON_PROPERTY_PATTERNS = [
  "instance",
  "_instance",
  "__instance",
  "singleton",
  "_singleton",
];

/**
 * Detector for Singleton design pattern.
 */
export class SingletonDetector extends BasePatternDetector {
  readonly patternType: DesignPatternType = "singleton";

  getHeuristics(): PatternHeuristic[] {
    return [
      {
        name: "private-constructor",
        patternType: "singleton",
        weight: 0.35,
        description: "Class has private or protected constructor",
      },
      {
        name: "static-get-instance",
        patternType: "singleton",
        weight: 0.35,
        description: "Class has static getInstance or similar method",
      },
      {
        name: "static-instance-property",
        patternType: "singleton",
        weight: 0.2,
        description: "Class has static instance property",
      },
      {
        name: "lazy-initialization",
        patternType: "singleton",
        weight: 0.1,
        description: "Instance created on first access",
      },
    ];
  }

  detect(
    context: PatternAnalysisContext,
    options?: PatternDetectionOptions
  ): DetectedPattern[] {
    if (!this.isPatternTypeEnabled(options)) {
      return [];
    }

    const patterns: DetectedPattern[] = [];

    for (const cls of context.classes) {
      const pattern = this.detectSingleton(cls, context);
      if (pattern && this.meetsConfidenceThreshold(pattern.confidence, options)) {
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  private detectSingleton(
    cls: ClassInfo,
    context: PatternAnalysisContext
  ): DetectedPattern | null {
    const evidence: string[] = [];
    const signals: Array<{ weight: number; matched: boolean }> = [];

    // Check for private constructor
    const hasPrivateConstructor = cls.hasPrivateConstructor;
    signals.push({ weight: 0.35, matched: hasPrivateConstructor });
    if (hasPrivateConstructor) {
      evidence.push("Has private or protected constructor");
    }

    // Check for static getInstance method
    const getInstanceMethods = cls.methods.filter(
      (m) =>
        m.isStatic &&
        SINGLETON_METHOD_PATTERNS.some(
          (p) => m.name.toLowerCase() === p.toLowerCase()
        )
    );
    const hasGetInstance = getInstanceMethods.length > 0;
    signals.push({ weight: 0.35, matched: hasGetInstance });
    if (hasGetInstance) {
      evidence.push(
        `Has static getInstance method: ${getInstanceMethods.map((m) => m.name).join(", ")}`
      );
    }

    // Check for static instance property
    const instanceProperties = cls.properties.filter(
      (p) =>
        p.isStatic &&
        SINGLETON_PROPERTY_PATTERNS.some(
          (pat) => p.name.toLowerCase() === pat.toLowerCase()
        )
    );
    const hasInstanceProperty = instanceProperties.length > 0;
    signals.push({ weight: 0.2, matched: hasInstanceProperty });
    if (hasInstanceProperty) {
      evidence.push(
        `Has static instance property: ${instanceProperties.map((p) => p.name).join(", ")}`
      );
    }

    // Check for lazy initialization pattern in getInstance
    const hasLazyInit = getInstanceMethods.some(
      (m) =>
        m.body &&
        (m.body.includes("if (!") ||
          m.body.includes("if(!") ||
          m.body.includes("??") ||
          m.body.includes("||"))
    );
    signals.push({ weight: 0.1, matched: hasLazyInit });
    if (hasLazyInit) {
      evidence.push("Uses lazy initialization pattern");
    }

    const confidence = this.calculateWeightedConfidence(signals);

    // Singleton needs at least getInstance or private constructor + instance property
    if (confidence < 0.4) {
      return null;
    }

    const participants: PatternParticipant[] = [
      {
        role: "singleton",
        entityId: cls.id,
        entityType: "class",
        entityName: cls.name,
        filePath: cls.filePath,
        evidence: ["Singleton class with controlled instantiation"],
      },
    ];

    // If there's an instance holder property, note it
    const firstInstanceProp = instanceProperties[0];
    if (hasInstanceProperty && firstInstanceProp) {
      participants.push({
        role: "instance_holder",
        entityId: cls.id,
        entityType: "class",
        entityName: `${cls.name}.${firstInstanceProp.name}`,
        filePath: cls.filePath,
        evidence: ["Static property holding the singleton instance"],
      });
    }

    return this.createPattern({
      name: `${cls.name}Singleton`,
      confidence,
      participants,
      evidence,
      filePaths: [cls.filePath],
      description: `Singleton class "${cls.name}" ensures only one instance exists`,
    });
  }
}

/**
 * Create a singleton pattern detector.
 */
export function createSingletonDetector(): SingletonDetector {
  return new SingletonDetector();
}

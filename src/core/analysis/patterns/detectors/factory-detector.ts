/**
 * Factory Pattern Detector
 *
 * Detects Factory design pattern instances:
 * - Functions that create and return new object instances
 * - Factory methods that return different types based on input
 * - Abstract factories that create families of objects
 *
 * Heuristics:
 * - Function/method name contains "create", "make", "build", "factory"
 * - Returns a new instance (new keyword in body)
 * - Returns different types based on conditions
 * - Named with "Factory" suffix
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
  FunctionInfo,
} from "../interfaces.js";

// Factory naming patterns
const FACTORY_NAME_PATTERNS = [
  "create",
  "make",
  "build",
  "factory",
  "new",
  "generate",
  "produce",
  "construct",
];

const FACTORY_CLASS_SUFFIXES = ["Factory", "Builder", "Creator", "Producer"];

/**
 * Detector for Factory design pattern.
 */
export class FactoryDetector extends BasePatternDetector {
  readonly patternType: DesignPatternType = "factory";

  getHeuristics(): PatternHeuristic[] {
    return [
      {
        name: "factory-method-name",
        patternType: "factory",
        weight: 0.3,
        description: "Method/function name suggests factory (create, make, build)",
      },
      {
        name: "factory-class-name",
        patternType: "factory",
        weight: 0.2,
        description: "Class name ends with Factory, Builder, Creator",
      },
      {
        name: "returns-new-instance",
        patternType: "factory",
        weight: 0.3,
        description: "Method returns a new object instance",
      },
      {
        name: "polymorphic-creation",
        patternType: "factory",
        weight: 0.2,
        description: "Creates different types based on input",
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

    // Check classes for factory patterns
    for (const cls of context.classes) {
      const pattern = this.detectClassFactory(cls, context);
      if (pattern && this.meetsConfidenceThreshold(pattern.confidence, options)) {
        patterns.push(pattern);
      }
    }

    // Check standalone functions for factory patterns
    for (const fn of context.functions) {
      const pattern = this.detectFunctionFactory(fn, context);
      if (pattern && this.meetsConfidenceThreshold(pattern.confidence, options)) {
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  private detectClassFactory(
    cls: ClassInfo,
    context: PatternAnalysisContext
  ): DetectedPattern | null {
    const evidence: string[] = [];
    const signals: Array<{ weight: number; matched: boolean }> = [];

    // Check class name
    const hasFactoryName = FACTORY_CLASS_SUFFIXES.some((suffix) =>
      cls.name.endsWith(suffix)
    );
    signals.push({ weight: 0.2, matched: hasFactoryName });
    if (hasFactoryName) {
      evidence.push(`Class name "${cls.name}" suggests factory pattern`);
    }

    // Check for factory methods
    const factoryMethods = cls.methods.filter((m) =>
      this.matchesMethodPattern(m.name, FACTORY_NAME_PATTERNS)
    );
    const hasFactoryMethods = factoryMethods.length > 0;
    signals.push({ weight: 0.3, matched: hasFactoryMethods });
    if (hasFactoryMethods) {
      evidence.push(
        `Contains factory methods: ${factoryMethods.map((m) => m.name).join(", ")}`
      );
    }

    // Check if methods return new instances
    const methodsWithNew = cls.methods.filter(
      (m) => m.body && (m.body.includes("new ") || m.body.includes("new\n"))
    );
    const hasNewInstances = methodsWithNew.length > 0;
    signals.push({ weight: 0.3, matched: hasNewInstances });
    if (hasNewInstances) {
      evidence.push(
        `Methods create new instances: ${methodsWithNew.map((m) => m.name).join(", ")}`
      );
    }

    // Check for polymorphic creation (switch/if statements with new)
    const hasPolymorphicCreation = cls.methods.some(
      (m) =>
        m.body &&
        (m.body.includes("switch") || m.body.includes("if (")) &&
        m.body.includes("new ")
    );
    signals.push({ weight: 0.2, matched: hasPolymorphicCreation });
    if (hasPolymorphicCreation) {
      evidence.push("Contains conditional object creation (polymorphic factory)");
    }

    const confidence = this.calculateWeightedConfidence(signals);

    if (confidence < 0.3) {
      return null;
    }

    // Build participants
    const participants: PatternParticipant[] = [
      {
        role: "factory",
        entityId: cls.id,
        entityType: "class",
        entityName: cls.name,
        filePath: cls.filePath,
        evidence: [`Factory class with ${factoryMethods.length} factory methods`],
      },
    ];

    // Try to identify products
    const products = this.findProducts(cls, context);
    participants.push(...products);

    return this.createPattern({
      name: cls.name,
      confidence,
      participants,
      evidence,
      filePaths: [cls.filePath, ...products.map((p) => p.filePath)],
      description: `Factory class "${cls.name}" creates objects through factory methods`,
    });
  }

  private detectFunctionFactory(
    fn: FunctionInfo,
    context: PatternAnalysisContext
  ): DetectedPattern | null {
    const evidence: string[] = [];
    const signals: Array<{ weight: number; matched: boolean }> = [];

    // Check function name
    const hasFactoryName = this.matchesMethodPattern(fn.name, FACTORY_NAME_PATTERNS);
    signals.push({ weight: 0.3, matched: hasFactoryName });
    if (hasFactoryName) {
      evidence.push(`Function name "${fn.name}" suggests factory pattern`);
    }

    // Check if function creates new instances
    const hasNew = fn.body ? (fn.body.includes("new ") || fn.body.includes("new\n")) : false;
    signals.push({ weight: 0.4, matched: hasNew });
    if (hasNew) {
      evidence.push("Function creates new instances using 'new' keyword");
    }

    // Check for object literal return
    const returnsObject = fn.body
      ? (fn.body.includes("return {") ||
         fn.body.includes("return({") ||
         fn.body.includes("return\n{"))
      : false;
    signals.push({ weight: 0.2, matched: returnsObject });
    if (returnsObject) {
      evidence.push("Function returns object literal");
    }

    // Check if exported (factory functions are usually exported)
    signals.push({ weight: 0.1, matched: fn.isExported });
    if (fn.isExported) {
      evidence.push("Function is exported for external use");
    }

    const confidence = this.calculateWeightedConfidence(signals);

    if (confidence < 0.4) {
      return null;
    }

    const participants: PatternParticipant[] = [
      {
        role: "factory",
        entityId: fn.id,
        entityType: "function",
        entityName: fn.name,
        filePath: fn.filePath,
        evidence: ["Factory function that creates object instances"],
      },
    ];

    return this.createPattern({
      name: fn.name,
      confidence,
      participants,
      evidence,
      filePaths: [fn.filePath],
      description: `Factory function "${fn.name}" creates and returns object instances`,
    });
  }

  private findProducts(
    factory: ClassInfo,
    context: PatternAnalysisContext
  ): PatternParticipant[] {
    const products: PatternParticipant[] = [];

    // Look for classes that might be products
    // Heuristics: same directory, similar naming, referenced in factory methods
    for (const cls of context.classes) {
      if (cls.id === factory.id) continue;

      // Check if factory methods reference this class
      const isReferenced = factory.methods.some(
        (m) => m.body && m.body.includes(cls.name)
      );

      if (isReferenced) {
        products.push({
          role: "product",
          entityId: cls.id,
          entityType: "class",
          entityName: cls.name,
          filePath: cls.filePath,
          evidence: [`Referenced in factory methods of ${factory.name}`],
        });
      }
    }

    return products;
  }
}

/**
 * Create a factory pattern detector.
 */
export function createFactoryDetector(): FactoryDetector {
  return new FactoryDetector();
}

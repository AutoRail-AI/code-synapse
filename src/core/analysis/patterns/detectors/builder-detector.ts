/**
 * Builder Pattern Detector
 *
 * Detects Builder design pattern instances:
 * - Fluent interface with method chaining
 * - Step-by-step object construction
 * - Final build() method returning the product
 *
 * Heuristics:
 * - Class name ends with "Builder"
 * - Methods return 'this' for chaining
 * - Has build() or create() method
 * - Sets properties through methods
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

// Builder class patterns
const BUILDER_CLASS_PATTERNS = ["Builder", "Creator", "Assembler"];

// Builder method patterns
const BUILD_METHOD_PATTERNS = ["build", "create", "make", "construct", "get", "toObject"];

const SETTER_PATTERNS = ["with", "set", "add", "using", "having"];

/**
 * Detector for Builder design pattern.
 */
export class BuilderDetector extends BasePatternDetector {
  readonly patternType: DesignPatternType = "builder";

  getHeuristics(): PatternHeuristic[] {
    return [
      {
        name: "builder-naming",
        patternType: "builder",
        weight: 0.25,
        description: "Class name ends with Builder",
      },
      {
        name: "method-chaining",
        patternType: "builder",
        weight: 0.3,
        description: "Methods return 'this' for chaining",
      },
      {
        name: "build-method",
        patternType: "builder",
        weight: 0.3,
        description: "Has build() or create() method",
      },
      {
        name: "setter-methods",
        patternType: "builder",
        weight: 0.15,
        description: "Has fluent setter methods (with*, set*)",
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
      const pattern = this.detectBuilder(cls, context);
      if (pattern && this.meetsConfidenceThreshold(pattern.confidence, options)) {
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  private detectBuilder(
    cls: ClassInfo,
    context: PatternAnalysisContext
  ): DetectedPattern | null {
    const evidence: string[] = [];
    const signals: Array<{ weight: number; matched: boolean }> = [];

    // Check class name
    const hasBuilderName = BUILDER_CLASS_PATTERNS.some((pattern) =>
      cls.name.endsWith(pattern)
    );
    signals.push({ weight: 0.25, matched: hasBuilderName });
    if (hasBuilderName) {
      evidence.push(`Class name "${cls.name}" suggests builder pattern`);
    }

    // Check for method chaining (methods returning this or same type)
    const chainingMethods = cls.methods.filter(
      (m) =>
        m.returnType &&
        (m.returnType === "this" ||
          m.returnType === cls.name ||
          m.returnType.includes(cls.name))
    );
    const hasChainingMethods = chainingMethods.length >= 2;
    signals.push({ weight: 0.3, matched: hasChainingMethods });
    if (hasChainingMethods) {
      evidence.push(
        `${chainingMethods.length} methods support chaining: ${chainingMethods.slice(0, 3).map((m) => m.name).join(", ")}`
      );
    }

    // Check for build method
    const buildMethods = cls.methods.filter((m) =>
      BUILD_METHOD_PATTERNS.some(
        (p) => m.name.toLowerCase() === p || m.name.toLowerCase().startsWith(p)
      )
    );
    const hasBuildMethod = buildMethods.length > 0;
    signals.push({ weight: 0.3, matched: hasBuildMethod });
    if (hasBuildMethod) {
      evidence.push(`Has build method: ${buildMethods.map((m) => m.name).join(", ")}`);
    }

    // Check for fluent setter methods
    const setterMethods = cls.methods.filter((m) =>
      SETTER_PATTERNS.some((p) => m.name.toLowerCase().startsWith(p))
    );
    const hasSetterMethods = setterMethods.length >= 2;
    signals.push({ weight: 0.15, matched: hasSetterMethods });
    if (hasSetterMethods) {
      evidence.push(
        `Has fluent setters: ${setterMethods.slice(0, 3).map((m) => m.name).join(", ")}`
      );
    }

    const confidence = this.calculateWeightedConfidence(signals);

    if (confidence < 0.4) {
      return null;
    }

    // Infer product type
    const productType = this.inferProductType(cls, buildMethods);

    const participants: PatternParticipant[] = [
      {
        role: "builder",
        entityId: cls.id,
        entityType: "class",
        entityName: cls.name,
        filePath: cls.filePath,
        evidence: ["Builder class with fluent interface"],
      },
    ];

    // Find product class
    if (productType) {
      const productClass = context.classes.find((c) => c.name === productType);
      if (productClass) {
        participants.push({
          role: "built_product",
          entityId: productClass.id,
          entityType: "class",
          entityName: productClass.name,
          filePath: productClass.filePath,
          evidence: ["Product built by builder"],
        });
      }
    }

    return this.createPattern({
      name: cls.name,
      confidence,
      participants,
      evidence,
      filePaths: [cls.filePath],
      description: `Builder pattern "${cls.name}" constructs ${productType || "objects"} step-by-step`,
    });
  }

  private inferProductType(
    cls: ClassInfo,
    buildMethods: Array<{ returnType?: string }>
  ): string | null {
    // From build method return type
    for (const method of buildMethods) {
      if (method.returnType && method.returnType !== "this" && method.returnType !== cls.name) {
        // Clean up generic types
        const clean = method.returnType.replace(/<.*>/, "").replace("Promise<", "").replace(">", "");
        if (clean && clean !== "void" && clean !== "any") {
          return clean;
        }
      }
    }

    // From class name
    for (const pattern of BUILDER_CLASS_PATTERNS) {
      if (cls.name.endsWith(pattern)) {
        const product = cls.name.slice(0, -pattern.length);
        if (product.length > 0) {
          return product;
        }
      }
    }

    return null;
  }
}

/**
 * Create a builder pattern detector.
 */
export function createBuilderDetector(): BuilderDetector {
  return new BuilderDetector();
}

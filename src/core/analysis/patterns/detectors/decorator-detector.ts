/**
 * Decorator Pattern Detector
 *
 * Detects Decorator design pattern instances:
 * - Wrapper classes that extend functionality
 * - Same interface, delegates to wrapped object
 * - Adds behavior before/after delegation
 *
 * Heuristics:
 * - Implements same interface as wrapped component
 * - Has constructor parameter of same type
 * - Methods delegate to wrapped object
 * - Name contains "Decorator", "Wrapper"
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

// Decorator naming patterns
const DECORATOR_CLASS_PATTERNS = [
  "Decorator",
  "Wrapper",
  "Enhancer",
  "Enricher",
  "Delegating",
];

/**
 * Detector for Decorator design pattern.
 */
export class DecoratorDetector extends BasePatternDetector {
  readonly patternType: DesignPatternType = "decorator";

  getHeuristics(): PatternHeuristic[] {
    return [
      {
        name: "decorator-naming",
        patternType: "decorator",
        weight: 0.25,
        description: "Class name suggests decorator (Wrapper, Decorator)",
      },
      {
        name: "wraps-same-type",
        patternType: "decorator",
        weight: 0.35,
        description: "Constructor accepts component of same interface",
      },
      {
        name: "implements-same-interface",
        patternType: "decorator",
        weight: 0.25,
        description: "Implements same interface as wrapped component",
      },
      {
        name: "delegates-methods",
        patternType: "decorator",
        weight: 0.15,
        description: "Methods delegate to wrapped component",
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
      const pattern = this.detectDecorator(cls, context);
      if (pattern && this.meetsConfidenceThreshold(pattern.confidence, options)) {
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  private detectDecorator(
    cls: ClassInfo,
    context: PatternAnalysisContext
  ): DetectedPattern | null {
    const evidence: string[] = [];
    const signals: Array<{ weight: number; matched: boolean }> = [];

    // Check class name
    const hasDecoratorName = DECORATOR_CLASS_PATTERNS.some(
      (pattern) =>
        cls.name.includes(pattern) || cls.name.endsWith(pattern)
    );
    signals.push({ weight: 0.25, matched: hasDecoratorName });
    if (hasDecoratorName) {
      evidence.push(`Class name "${cls.name}" suggests decorator pattern`);
    }

    // Check if wraps same type (constructor param matches implemented interface)
    const wrappedInfo = this.findWrappedComponent(cls, context);
    const wrapsSameType = wrappedInfo !== null;
    signals.push({ weight: 0.35, matched: wrapsSameType });
    if (wrapsSameType) {
      evidence.push(
        `Wraps component of same type via constructor parameter "${wrappedInfo.paramName}"`
      );
    }

    // Check if implements interface
    const hasInterface = cls.implementsInterfaces.length > 0;
    signals.push({ weight: 0.25, matched: hasInterface && wrapsSameType });
    if (hasInterface) {
      evidence.push(`Implements interface(s): ${cls.implementsInterfaces.join(", ")}`);
    }

    // Check for delegation in methods
    const delegatesMethods = this.checkMethodDelegation(cls, wrappedInfo?.paramName);
    signals.push({ weight: 0.15, matched: delegatesMethods });
    if (delegatesMethods) {
      evidence.push("Methods delegate to wrapped component");
    }

    const confidence = this.calculateWeightedConfidence(signals);

    if (confidence < 0.4) {
      return null;
    }

    const participants: PatternParticipant[] = [
      {
        role: "decorator",
        entityId: cls.id,
        entityType: "class",
        entityName: cls.name,
        filePath: cls.filePath,
        evidence: ["Decorator class that wraps and extends component"],
      },
    ];

    // Find component interface
    if (cls.implementsInterfaces.length > 0) {
      const componentInterface = context.interfaces.find(
        (i) => cls.implementsInterfaces.includes(i.name)
      );
      if (componentInterface) {
        participants.push({
          role: "component",
          entityId: componentInterface.id,
          entityType: "interface",
          entityName: componentInterface.name,
          filePath: componentInterface.filePath,
          evidence: ["Component interface shared by decorator and decorated"],
        });
      }
    }

    // Find wrapped component class
    if (wrappedInfo?.wrappedClass) {
      participants.push({
        role: "decorated_component",
        entityId: wrappedInfo.wrappedClass.id,
        entityType: "class",
        entityName: wrappedInfo.wrappedClass.name,
        filePath: wrappedInfo.wrappedClass.filePath,
        evidence: ["Concrete component being decorated"],
      });
    }

    return this.createPattern({
      name: cls.name,
      confidence,
      participants,
      evidence,
      filePaths: [cls.filePath],
      description: `Decorator pattern "${cls.name}" wraps and extends component behavior`,
    });
  }

  private findWrappedComponent(
    cls: ClassInfo,
    context: PatternAnalysisContext
  ): { paramName: string; wrappedClass?: ClassInfo } | null {
    // Look for constructor parameter that matches implemented interface
    for (const param of cls.constructorParams) {
      if (!param.type) continue;

      // Check if param type matches any implemented interface
      const matchesInterface = cls.implementsInterfaces.some(
        (iface) => param.type?.includes(iface)
      );

      if (matchesInterface) {
        // Try to find a concrete class for this type
        const wrappedClass = context.classes.find(
          (c) =>
            c.name === param.type ||
            c.implementsInterfaces.some((i) => param.type?.includes(i))
        );

        return {
          paramName: param.name,
          wrappedClass: wrappedClass || undefined,
        };
      }

      // Check if param type is same as class's parent or sibling
      if (cls.extendsClass && param.type.includes(cls.extendsClass)) {
        return { paramName: param.name };
      }
    }

    // Also check properties
    for (const prop of cls.properties) {
      if (!prop.type) continue;

      const matchesInterface = cls.implementsInterfaces.some(
        (iface) => prop.type?.includes(iface)
      );

      if (matchesInterface) {
        return { paramName: prop.name };
      }
    }

    return null;
  }

  private checkMethodDelegation(
    cls: ClassInfo,
    wrappedParamName?: string
  ): boolean {
    if (!wrappedParamName) return false;

    // Check if methods call the wrapped component
    return cls.methods.some(
      (m) =>
        m.body &&
        (m.body.includes(`this.${wrappedParamName}.`) ||
          m.body.includes(`${wrappedParamName}.`))
    );
  }
}

/**
 * Create a decorator pattern detector.
 */
export function createDecoratorDetector(): DecoratorDetector {
  return new DecoratorDetector();
}

/**
 * Strategy Pattern Detector
 *
 * Detects Strategy design pattern instances:
 * - Interface with single algorithm method
 * - Multiple concrete implementations
 * - Context class that uses strategy
 *
 * Heuristics:
 * - Interface with 1-2 methods
 * - Multiple classes implementing same interface
 * - Class holding strategy reference and delegating
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
  InterfaceInfo,
  ClassInfo,
} from "../interfaces.js";

// Strategy naming patterns
const STRATEGY_INTERFACE_PATTERNS = [
  "Strategy",
  "Policy",
  "Algorithm",
  "Handler",
  "Behavior",
];

const STRATEGY_METHOD_PATTERNS = [
  "execute",
  "handle",
  "process",
  "apply",
  "run",
  "perform",
  "calculate",
  "compute",
];

/**
 * Detector for Strategy design pattern.
 */
export class StrategyDetector extends BasePatternDetector {
  readonly patternType: DesignPatternType = "strategy";

  getHeuristics(): PatternHeuristic[] {
    return [
      {
        name: "strategy-interface",
        patternType: "strategy",
        weight: 0.3,
        description: "Interface defines strategy contract",
      },
      {
        name: "multiple-implementations",
        patternType: "strategy",
        weight: 0.35,
        description: "Multiple classes implement the strategy",
      },
      {
        name: "context-delegation",
        patternType: "strategy",
        weight: 0.25,
        description: "Context class delegates to strategy",
      },
      {
        name: "single-method-interface",
        patternType: "strategy",
        weight: 0.1,
        description: "Interface has focused method(s)",
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

    // Find strategy interfaces and their implementations
    for (const iface of context.interfaces) {
      const pattern = this.detectStrategy(iface, context);
      if (pattern && this.meetsConfidenceThreshold(pattern.confidence, options)) {
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  private detectStrategy(
    iface: InterfaceInfo,
    context: PatternAnalysisContext
  ): DetectedPattern | null {
    const evidence: string[] = [];
    const signals: Array<{ weight: number; matched: boolean }> = [];

    // Check interface name
    const hasStrategyName = STRATEGY_INTERFACE_PATTERNS.some(
      (pattern) =>
        iface.name.includes(pattern) || iface.name.endsWith(pattern)
    );
    signals.push({ weight: 0.15, matched: hasStrategyName });
    if (hasStrategyName) {
      evidence.push(`Interface name "${iface.name}" suggests strategy pattern`);
    }

    // Check for focused interface (1-3 methods)
    const isFocused = iface.methods.length >= 1 && iface.methods.length <= 3;
    signals.push({ weight: 0.1, matched: isFocused });
    if (isFocused) {
      evidence.push(`Focused interface with ${iface.methods.length} method(s)`);
    }

    // Check for strategy method naming
    const hasStrategyMethod = iface.methods.some((m) =>
      STRATEGY_METHOD_PATTERNS.some(
        (p) => m.name.toLowerCase().includes(p) || m.name.toLowerCase() === p
      )
    );
    if (hasStrategyMethod) {
      evidence.push("Has strategy method (execute, handle, process, etc.)");
    }

    // Find implementations
    const implementations = this.findImplementations(iface, context);
    const hasMultipleImpls = implementations.length >= 2;
    signals.push({ weight: 0.35, matched: hasMultipleImpls });
    if (hasMultipleImpls) {
      evidence.push(
        `${implementations.length} implementations: ${implementations.map((c) => c.name).join(", ")}`
      );
    }

    // Strategy interface indicator
    const isStrategyInterface = hasStrategyName || (isFocused && hasStrategyMethod);
    signals.push({ weight: 0.3, matched: isStrategyInterface });

    // Find context class
    const contextClass = this.findContextClass(iface, context);
    const hasContext = contextClass !== null;
    signals.push({ weight: 0.25, matched: hasContext });
    if (hasContext) {
      evidence.push(`Context class "${contextClass.name}" uses this strategy`);
    }

    const confidence = this.calculateWeightedConfidence(signals);

    // Need at least multiple implementations or context + interface indicators
    if (confidence < 0.4) {
      return null;
    }

    const participants: PatternParticipant[] = [
      {
        role: "strategy_interface",
        entityId: iface.id,
        entityType: "interface",
        entityName: iface.name,
        filePath: iface.filePath,
        evidence: ["Strategy interface defining algorithm contract"],
      },
    ];

    // Add implementations
    for (const impl of implementations) {
      participants.push({
        role: "concrete_strategy",
        entityId: impl.id,
        entityType: "class",
        entityName: impl.name,
        filePath: impl.filePath,
        evidence: [`Implements ${iface.name} strategy`],
      });
    }

    // Add context
    if (contextClass) {
      participants.push({
        role: "context",
        entityId: contextClass.id,
        entityType: "class",
        entityName: contextClass.name,
        filePath: contextClass.filePath,
        evidence: ["Context that uses strategy"],
      });
    }

    const filePaths = [
      iface.filePath,
      ...implementations.map((i) => i.filePath),
      ...(contextClass ? [contextClass.filePath] : []),
    ];

    return this.createPattern({
      name: `${iface.name}Strategy`,
      confidence,
      participants,
      evidence,
      filePaths,
      description: `Strategy pattern with "${iface.name}" and ${implementations.length} concrete implementations`,
    });
  }

  private findImplementations(
    iface: InterfaceInfo,
    context: PatternAnalysisContext
  ): ClassInfo[] {
    return context.classes.filter((cls) =>
      cls.implementsInterfaces.some(
        (i) => i === iface.name || i.includes(iface.name)
      )
    );
  }

  private findContextClass(
    iface: InterfaceInfo,
    context: PatternAnalysisContext
  ): ClassInfo | null {
    // Look for class that:
    // 1. Has property typed as the interface
    // 2. Has method that calls strategy method

    for (const cls of context.classes) {
      // Check if class has property of interface type
      const hasStrategyProperty = cls.properties.some(
        (p) => p.type && (p.type === iface.name || p.type.includes(iface.name))
      );

      // Check if class has constructor parameter of interface type
      const hasStrategyParam = cls.constructorParams.some(
        (p) => p.type && (p.type === iface.name || p.type.includes(iface.name))
      );

      if (hasStrategyProperty || hasStrategyParam) {
        return cls;
      }
    }

    return null;
  }
}

/**
 * Create a strategy pattern detector.
 */
export function createStrategyDetector(): StrategyDetector {
  return new StrategyDetector();
}

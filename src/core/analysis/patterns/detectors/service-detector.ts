/**
 * Service Pattern Detector
 *
 * Detects Service design pattern instances:
 * - Stateless business logic classes
 * - Dependency injection pattern
 * - Business operation encapsulation
 *
 * Heuristics:
 * - Class name ends with "Service"
 * - Constructor accepts dependencies
 * - Methods perform business operations
 * - Stateless (no mutable instance properties)
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

// Service class patterns
const SERVICE_CLASS_PATTERNS = [
  "Service",
  "Manager",
  "Handler",
  "Controller",
  "Processor",
  "Provider",
  "Helper",
  "Util",
];

// Common dependency types
const DEPENDENCY_TYPE_PATTERNS = [
  "Repository",
  "Store",
  "Client",
  "Api",
  "Gateway",
  "Adapter",
  "Provider",
  "Service",
  "Logger",
  "Config",
];

/**
 * Detector for Service design pattern.
 */
export class ServiceDetector extends BasePatternDetector {
  readonly patternType: DesignPatternType = "service";

  getHeuristics(): PatternHeuristic[] {
    return [
      {
        name: "service-naming",
        patternType: "service",
        weight: 0.3,
        description: "Class name ends with Service, Manager, Handler",
      },
      {
        name: "dependency-injection",
        patternType: "service",
        weight: 0.3,
        description: "Constructor accepts dependencies",
      },
      {
        name: "business-methods",
        patternType: "service",
        weight: 0.25,
        description: "Has public methods performing business operations",
      },
      {
        name: "stateless",
        patternType: "service",
        weight: 0.15,
        description: "Appears stateless (no mutable state)",
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
      const pattern = this.detectService(cls, context);
      if (pattern && this.meetsConfidenceThreshold(pattern.confidence, options)) {
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  private detectService(
    cls: ClassInfo,
    context: PatternAnalysisContext
  ): DetectedPattern | null {
    const evidence: string[] = [];
    const signals: Array<{ weight: number; matched: boolean }> = [];

    // Check class name
    const hasServiceName = SERVICE_CLASS_PATTERNS.some((pattern) =>
      cls.name.endsWith(pattern)
    );
    signals.push({ weight: 0.3, matched: hasServiceName });
    if (hasServiceName) {
      evidence.push(`Class name "${cls.name}" suggests service pattern`);
    }

    // Check for dependency injection (constructor parameters)
    const injectedDeps = this.findInjectedDependencies(cls);
    const hasDI = injectedDeps.length > 0;
    signals.push({ weight: 0.3, matched: hasDI });
    if (hasDI) {
      evidence.push(
        `Constructor injects dependencies: ${injectedDeps.map((d) => d.name).join(", ")}`
      );
    }

    // Check for business methods
    const businessMethods = cls.methods.filter(
      (m) => m.isPublic && !m.isStatic && !this.isLifecycleMethod(m.name)
    );
    const hasBusinessMethods = businessMethods.length >= 2;
    signals.push({ weight: 0.25, matched: hasBusinessMethods });
    if (hasBusinessMethods) {
      evidence.push(
        `Has ${businessMethods.length} public business methods`
      );
    }

    // Check for statelessness
    const mutableProperties = cls.properties.filter(
      (p) => !p.isPrivate && !p.isStatic && p.type !== "readonly"
    );
    const appearsStateless = mutableProperties.length === 0;
    signals.push({ weight: 0.15, matched: appearsStateless });
    if (appearsStateless) {
      evidence.push("Appears stateless (no public mutable properties)");
    }

    const confidence = this.calculateWeightedConfidence(signals);

    if (confidence < 0.4) {
      return null;
    }

    const participants: PatternParticipant[] = [
      {
        role: "service",
        entityId: cls.id,
        entityType: "class",
        entityName: cls.name,
        filePath: cls.filePath,
        evidence: ["Service class encapsulating business logic"],
      },
    ];

    // Add dependencies as participants
    for (const dep of injectedDeps) {
      const depClass = context.classes.find((c) => c.name === dep.type);
      participants.push({
        role: "dependency",
        entityId: depClass?.id || `dep-${dep.name}`,
        entityType: depClass ? "class" : "interface",
        entityName: dep.type || dep.name,
        filePath: depClass?.filePath || cls.filePath,
        evidence: [`Injected via constructor as "${dep.name}"`],
      });
    }

    return this.createPattern({
      name: cls.name,
      confidence,
      participants,
      evidence,
      filePaths: [cls.filePath],
      description: `Service pattern "${cls.name}" encapsulates business logic with ${injectedDeps.length} injected dependencies`,
    });
  }

  private findInjectedDependencies(
    cls: ClassInfo
  ): Array<{ name: string; type?: string }> {
    const deps: Array<{ name: string; type?: string }> = [];

    for (const param of cls.constructorParams) {
      // Check if param type looks like a dependency
      if (param.type) {
        const isDependency = DEPENDENCY_TYPE_PATTERNS.some(
          (pattern) =>
            param.type?.includes(pattern) ||
            param.name.toLowerCase().includes(pattern.toLowerCase())
        );
        if (isDependency) {
          deps.push({ name: param.name, type: param.type });
        }
      }

      // Check naming conventions
      const isNamedLikeDep =
        param.name.endsWith("Service") ||
        param.name.endsWith("Repository") ||
        param.name.endsWith("Client") ||
        param.name.endsWith("Api") ||
        param.name.endsWith("Gateway");

      if (isNamedLikeDep && !deps.some((d) => d.name === param.name)) {
        deps.push({ name: param.name, type: param.type });
      }
    }

    return deps;
  }

  private isLifecycleMethod(name: string): boolean {
    const lifecycle = [
      "constructor",
      "ngOnInit",
      "ngOnDestroy",
      "componentDidMount",
      "componentWillUnmount",
      "mounted",
      "unmounted",
      "init",
      "destroy",
      "dispose",
    ];
    return lifecycle.includes(name) || lifecycle.includes(name.toLowerCase());
  }
}

/**
 * Create a service pattern detector.
 */
export function createServiceDetector(): ServiceDetector {
  return new ServiceDetector();
}

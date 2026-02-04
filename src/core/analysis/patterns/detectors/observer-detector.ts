/**
 * Observer Pattern Detector
 *
 * Detects Observer/Pub-Sub design pattern instances:
 * - Event emitter classes
 * - Classes with subscribe/unsubscribe methods
 * - Observable implementations
 * - Callback registration patterns
 *
 * Heuristics:
 * - Has subscribe/unsubscribe or on/off methods
 * - Has emit/notify/dispatch methods
 * - Stores callbacks/listeners in a collection
 * - Event-based naming (EventEmitter, Observable, Subject)
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

// Observer method patterns
const SUBSCRIBE_PATTERNS = [
  "subscribe",
  "on",
  "addListener",
  "addEventListener",
  "addObserver",
  "register",
  "attach",
  "watch",
];

const UNSUBSCRIBE_PATTERNS = [
  "unsubscribe",
  "off",
  "removeListener",
  "removeEventListener",
  "removeObserver",
  "unregister",
  "detach",
  "unwatch",
];

const EMIT_PATTERNS = [
  "emit",
  "notify",
  "dispatch",
  "trigger",
  "fire",
  "publish",
  "broadcast",
  "notifyObservers",
];

const OBSERVER_CLASS_PATTERNS = [
  "EventEmitter",
  "Observable",
  "Subject",
  "Publisher",
  "Emitter",
  "Broadcaster",
  "EventBus",
];

/**
 * Detector for Observer/Pub-Sub design pattern.
 */
export class ObserverDetector extends BasePatternDetector {
  readonly patternType: DesignPatternType = "observer";

  getHeuristics(): PatternHeuristic[] {
    return [
      {
        name: "has-subscribe-method",
        patternType: "observer",
        weight: 0.3,
        description: "Class has subscribe/on/addListener method",
      },
      {
        name: "has-unsubscribe-method",
        patternType: "observer",
        weight: 0.2,
        description: "Class has unsubscribe/off/removeListener method",
      },
      {
        name: "has-emit-method",
        patternType: "observer",
        weight: 0.3,
        description: "Class has emit/notify/dispatch method",
      },
      {
        name: "observer-naming",
        patternType: "observer",
        weight: 0.2,
        description: "Class name suggests observer pattern",
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
      const pattern = this.detectObserver(cls, context);
      if (pattern && this.meetsConfidenceThreshold(pattern.confidence, options)) {
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  private detectObserver(
    cls: ClassInfo,
    context: PatternAnalysisContext
  ): DetectedPattern | null {
    const evidence: string[] = [];
    const signals: Array<{ weight: number; matched: boolean }> = [];

    // Check for subscribe methods
    const subscribeMethods = cls.methods.filter((m) =>
      this.matchesMethodPattern(m.name, SUBSCRIBE_PATTERNS)
    );
    const hasSubscribe = subscribeMethods.length > 0;
    signals.push({ weight: 0.3, matched: hasSubscribe });
    if (hasSubscribe) {
      evidence.push(
        `Has subscribe methods: ${subscribeMethods.map((m) => m.name).join(", ")}`
      );
    }

    // Check for unsubscribe methods
    const unsubscribeMethods = cls.methods.filter((m) =>
      this.matchesMethodPattern(m.name, UNSUBSCRIBE_PATTERNS)
    );
    const hasUnsubscribe = unsubscribeMethods.length > 0;
    signals.push({ weight: 0.2, matched: hasUnsubscribe });
    if (hasUnsubscribe) {
      evidence.push(
        `Has unsubscribe methods: ${unsubscribeMethods.map((m) => m.name).join(", ")}`
      );
    }

    // Check for emit methods
    const emitMethods = cls.methods.filter((m) =>
      this.matchesMethodPattern(m.name, EMIT_PATTERNS)
    );
    const hasEmit = emitMethods.length > 0;
    signals.push({ weight: 0.3, matched: hasEmit });
    if (hasEmit) {
      evidence.push(
        `Has emit methods: ${emitMethods.map((m) => m.name).join(", ")}`
      );
    }

    // Check class name
    const hasObserverName = OBSERVER_CLASS_PATTERNS.some(
      (pattern) =>
        cls.name.includes(pattern) || cls.name.toLowerCase().includes(pattern.toLowerCase())
    );
    signals.push({ weight: 0.2, matched: hasObserverName });
    if (hasObserverName) {
      evidence.push(`Class name "${cls.name}" suggests observer pattern`);
    }

    // Check for listener storage (arrays or maps)
    const hasListenerStorage = cls.properties.some(
      (p) =>
        p.name.toLowerCase().includes("listener") ||
        p.name.toLowerCase().includes("observer") ||
        p.name.toLowerCase().includes("subscriber") ||
        p.name.toLowerCase().includes("handler") ||
        (p.type && (p.type.includes("[]") || p.type.includes("Map") || p.type.includes("Set")))
    );
    if (hasListenerStorage) {
      evidence.push("Has listener/observer storage property");
    }

    const confidence = this.calculateWeightedConfidence(signals);

    // Need at least subscribe or emit functionality
    if (confidence < 0.3) {
      return null;
    }

    const participants: PatternParticipant[] = [
      {
        role: "subject",
        entityId: cls.id,
        entityType: "class",
        entityName: cls.name,
        filePath: cls.filePath,
        evidence: ["Observable subject that notifies observers"],
      },
    ];

    // If this extends EventEmitter or similar, note it
    if (cls.extendsClass && OBSERVER_CLASS_PATTERNS.some(p =>
      cls.extendsClass?.includes(p)
    )) {
      participants.push({
        role: "event_emitter",
        entityId: cls.id,
        entityType: "class",
        entityName: cls.extendsClass,
        filePath: cls.filePath,
        evidence: [`Extends ${cls.extendsClass}`],
      });
    }

    return this.createPattern({
      name: `${cls.name}Observer`,
      confidence,
      participants,
      evidence,
      filePaths: [cls.filePath],
      description: `Observer/Event pattern in "${cls.name}" - allows subscribing to and emitting events`,
    });
  }
}

/**
 * Create an observer pattern detector.
 */
export function createObserverDetector(): ObserverDetector {
  return new ObserverDetector();
}

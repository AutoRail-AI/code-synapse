/**
 * Pattern Detectors Module
 *
 * Exports all design pattern detectors.
 *
 * @module
 */

// Base
export { BasePatternDetector } from "./base-detector.js";

// Individual Detectors
export { FactoryDetector, createFactoryDetector } from "./factory-detector.js";
export { SingletonDetector, createSingletonDetector } from "./singleton-detector.js";
export { ObserverDetector, createObserverDetector } from "./observer-detector.js";
export { RepositoryDetector, createRepositoryDetector } from "./repository-detector.js";
export { ServiceDetector, createServiceDetector } from "./service-detector.js";
export { BuilderDetector, createBuilderDetector } from "./builder-detector.js";
export { StrategyDetector, createStrategyDetector } from "./strategy-detector.js";
export { DecoratorDetector, createDecoratorDetector } from "./decorator-detector.js";

// Convenience function to get all default detectors
import { createFactoryDetector } from "./factory-detector.js";
import { createSingletonDetector } from "./singleton-detector.js";
import { createObserverDetector } from "./observer-detector.js";
import { createRepositoryDetector } from "./repository-detector.js";
import { createServiceDetector } from "./service-detector.js";
import { createBuilderDetector } from "./builder-detector.js";
import { createStrategyDetector } from "./strategy-detector.js";
import { createDecoratorDetector } from "./decorator-detector.js";
import type { IPatternDetector } from "../interfaces.js";

/**
 * Create all default pattern detectors.
 */
export function createAllDetectors(): IPatternDetector[] {
  return [
    createFactoryDetector(),
    createSingletonDetector(),
    createObserverDetector(),
    createRepositoryDetector(),
    createServiceDetector(),
    createBuilderDetector(),
    createStrategyDetector(),
    createDecoratorDetector(),
  ];
}

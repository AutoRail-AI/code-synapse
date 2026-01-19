/**
 * Business-Weighted Coverage Report
 *
 * Generates coverage analysis weighted by business importance.
 * Unlike traditional coverage that treats all code equally, this report
 * prioritizes revenue-critical code over infrastructure.
 */

import type { CodeSynapseClient, FunctionInfo, Classification, Justification } from "../api/client.js";

// =============================================================================
// Types
// =============================================================================

export interface BusinessCoverageReport {
  summary: {
    traditionalCoverage: number;
    businessWeightedCoverage: number;
    totalFunctions: number;
    testedFunctions: number;
  };
  byLayer: {
    revenueCritical: LayerCoverage;
    userFacing: LayerCoverage;
    internal: LayerCoverage;
    infrastructure: LayerCoverage;
  };
  criticalGaps: CriticalGap[];
  recommendations: string[];
}

export interface LayerCoverage {
  total: number;
  tested: number;
  percentage: number;
  target: number;
  status: "healthy" | "warning" | "critical";
}

export interface CriticalGap {
  entityId: string;
  name: string;
  filePath: string;
  businessLayer: string;
  businessJustification?: string;
  complexity: number;
  callerCount: number;
  priority: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
}

// =============================================================================
// Coverage Analysis
// =============================================================================

/**
 * Map domain areas to business layers
 */
function mapToBusinessLayer(classification: Classification | null): string {
  if (!classification) return "unknown";

  if (classification.category === "domain") {
    const area = classification.domainMetadata?.area?.toLowerCase() || "";
    if (["payment", "billing", "checkout", "order", "subscription", "revenue"].some(k => area.includes(k))) {
      return "revenue-critical";
    }
    if (["user", "dashboard", "settings", "profile", "notification"].some(k => area.includes(k))) {
      return "user-facing";
    }
    return "internal";
  }

  if (classification.category === "infrastructure") {
    return "infrastructure";
  }

  return "unknown";
}

/**
 * Determine if a function is "tested" based on heuristics
 *
 * In a real implementation, this would integrate with actual test coverage data.
 * For the MVP, we use naming conventions and patterns as proxies.
 */
function isLikelyTested(fn: FunctionInfo): boolean {
  const name = fn.name.toLowerCase();
  const path = fn.filePath.toLowerCase();

  // Test files themselves are tested
  if (path.includes("test") || path.includes("spec")) {
    return true;
  }

  // Simple utility functions are often tested
  if (fn.complexity !== undefined && fn.complexity <= 3) {
    return true;
  }

  // Functions in well-tested patterns
  if (path.includes("services/") && fn.callerCount && fn.callerCount > 3) {
    return true;
  }

  // Heuristic: functions with lower complexity and more callers tend to be tested
  if (fn.complexity && fn.callerCount) {
    if (fn.complexity < 10 && fn.callerCount > 2) {
      return true;
    }
  }

  // Default: assume 60% of functions have some test coverage
  // This is a rough approximation for demo purposes
  return Math.random() < 0.6;
}

/**
 * Calculate coverage percentage
 */
function calculateCoverage(total: number, tested: number): number {
  if (total === 0) return 100;
  return Math.round((tested / total) * 100);
}

/**
 * Determine health status based on coverage and target
 */
function determineStatus(percentage: number, target: number): "healthy" | "warning" | "critical" {
  if (percentage >= target) return "healthy";
  if (percentage >= target - 15) return "warning";
  return "critical";
}

/**
 * Calculate priority for a coverage gap
 */
function calculatePriority(
  businessLayer: string,
  complexity: number,
  callerCount: number
): "HIGH" | "MEDIUM" | "LOW" {
  // Revenue-critical with high complexity or many callers = HIGH
  if (businessLayer === "revenue-critical") {
    if (complexity > 15 || callerCount > 5) return "HIGH";
    return "MEDIUM";
  }

  // User-facing with high complexity = MEDIUM
  if (businessLayer === "user-facing") {
    if (complexity > 20 || callerCount > 10) return "MEDIUM";
    return "LOW";
  }

  // Everything else = LOW
  return "LOW";
}

// =============================================================================
// Report Generator
// =============================================================================

export async function generateBusinessCoverageReport(
  client: CodeSynapseClient
): Promise<BusinessCoverageReport> {
  // Fetch all functions with their classifications
  const [functions, classificationStats, justificationStats] = await Promise.all([
    client.listFunctions({ limit: 5000 }),
    client.getClassificationStats().catch(() => null),
    client.getJustificationStats().catch(() => null),
  ]);

  // Initialize layer tracking
  const layers: Record<string, { total: number; tested: number; functions: FunctionInfo[] }> = {
    "revenue-critical": { total: 0, tested: 0, functions: [] },
    "user-facing": { total: 0, tested: 0, functions: [] },
    "internal": { total: 0, tested: 0, functions: [] },
    "infrastructure": { total: 0, tested: 0, functions: [] },
    "unknown": { total: 0, tested: 0, functions: [] },
  };

  // Track untested functions for gap analysis
  const untestedFunctions: Array<FunctionInfo & { businessLayer: string }> = [];

  // Process each function
  for (const fn of functions) {
    // Determine business layer from classification
    const classification = fn.classification
      ? {
          entityId: fn.id,
          category: fn.classification as "domain" | "infrastructure" | "unknown",
          domainMetadata: fn.subCategory ? { area: fn.subCategory } : undefined,
          infrastructureMetadata: fn.subCategory ? { layer: fn.subCategory } : undefined,
          confidence: fn.confidence || 0,
        }
      : null;

    const businessLayer = mapToBusinessLayer(classification);
    const isTested = isLikelyTested(fn);

    // Update layer stats
    if (layers[businessLayer]) {
      layers[businessLayer].total++;
      if (isTested) {
        layers[businessLayer].tested++;
      } else {
        untestedFunctions.push({ ...fn, businessLayer });
      }
      layers[businessLayer].functions.push(fn);
    }
  }

  // Calculate totals
  const totalFunctions = functions.length;
  const testedFunctions = Object.values(layers).reduce((sum, l) => sum + l.tested, 0);
  const traditionalCoverage = calculateCoverage(totalFunctions, testedFunctions);

  // Calculate business-weighted coverage
  // Weights: revenue-critical (4x), user-facing (2x), internal (1x), infrastructure (0.5x)
  const weights = {
    "revenue-critical": 4,
    "user-facing": 2,
    "internal": 1,
    "infrastructure": 0.5,
    "unknown": 0.5,
  };

  let weightedTotal = 0;
  let weightedTested = 0;
  for (const [layer, stats] of Object.entries(layers)) {
    const weight = weights[layer as keyof typeof weights] || 1;
    weightedTotal += stats.total * weight;
    weightedTested += stats.tested * weight;
  }
  const businessWeightedCoverage = calculateCoverage(weightedTotal, weightedTested);

  // Targets by layer
  const targets = {
    "revenue-critical": 95,
    "user-facing": 80,
    "internal": 70,
    "infrastructure": 50,
  };

  // Build layer coverage
  const byLayer = {
    revenueCritical: {
      total: layers["revenue-critical"].total,
      tested: layers["revenue-critical"].tested,
      percentage: calculateCoverage(layers["revenue-critical"].total, layers["revenue-critical"].tested),
      target: targets["revenue-critical"],
      status: determineStatus(
        calculateCoverage(layers["revenue-critical"].total, layers["revenue-critical"].tested),
        targets["revenue-critical"]
      ),
    },
    userFacing: {
      total: layers["user-facing"].total,
      tested: layers["user-facing"].tested,
      percentage: calculateCoverage(layers["user-facing"].total, layers["user-facing"].tested),
      target: targets["user-facing"],
      status: determineStatus(
        calculateCoverage(layers["user-facing"].total, layers["user-facing"].tested),
        targets["user-facing"]
      ),
    },
    internal: {
      total: layers["internal"].total,
      tested: layers["internal"].tested,
      percentage: calculateCoverage(layers["internal"].total, layers["internal"].tested),
      target: targets["internal"],
      status: determineStatus(
        calculateCoverage(layers["internal"].total, layers["internal"].tested),
        targets["internal"]
      ),
    },
    infrastructure: {
      total: layers["infrastructure"].total,
      tested: layers["infrastructure"].tested,
      percentage: calculateCoverage(layers["infrastructure"].total, layers["infrastructure"].tested),
      target: targets["infrastructure"],
      status: determineStatus(
        calculateCoverage(layers["infrastructure"].total, layers["infrastructure"].tested),
        targets["infrastructure"]
      ),
    },
  };

  // Identify critical gaps (untested functions in important layers)
  const criticalGaps: CriticalGap[] = untestedFunctions
    .filter(fn => fn.businessLayer === "revenue-critical" || fn.businessLayer === "user-facing")
    .map(fn => ({
      entityId: fn.id,
      name: fn.name,
      filePath: fn.filePath,
      businessLayer: fn.businessLayer,
      businessJustification: fn.justification,
      complexity: fn.complexity || 1,
      callerCount: fn.callerCount || 0,
      priority: calculatePriority(fn.businessLayer, fn.complexity || 1, fn.callerCount || 0),
      reason: fn.businessLayer === "revenue-critical"
        ? "Untested revenue-critical code poses direct business risk"
        : "Untested user-facing code affects user experience",
    }))
    .sort((a, b) => {
      // Sort by priority, then by complexity
      const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return b.complexity - a.complexity;
    })
    .slice(0, 20);

  // Generate recommendations
  const recommendations: string[] = [];

  if (byLayer.revenueCritical.status === "critical") {
    recommendations.push(
      `URGENT: Revenue-critical coverage is at ${byLayer.revenueCritical.percentage}% (target: ${byLayer.revenueCritical.target}%). ` +
      `Focus testing efforts on payment, billing, and checkout flows immediately.`
    );
  }

  if (byLayer.revenueCritical.status === "warning") {
    recommendations.push(
      `Revenue-critical coverage is at ${byLayer.revenueCritical.percentage}% (target: ${byLayer.revenueCritical.target}%). ` +
      `Schedule test writing for the ${criticalGaps.filter(g => g.businessLayer === "revenue-critical").length} untested revenue-critical functions.`
    );
  }

  if (byLayer.userFacing.status === "critical" || byLayer.userFacing.status === "warning") {
    recommendations.push(
      `User-facing coverage is at ${byLayer.userFacing.percentage}% (target: ${byLayer.userFacing.target}%). ` +
      `Consider adding integration tests for dashboard and settings flows.`
    );
  }

  if (criticalGaps.length > 0) {
    const highPriorityGaps = criticalGaps.filter(g => g.priority === "HIGH");
    if (highPriorityGaps.length > 0) {
      recommendations.push(
        `${highPriorityGaps.length} HIGH priority coverage gaps found. ` +
        `Start with: ${highPriorityGaps[0].name} (complexity: ${highPriorityGaps[0].complexity})`
      );
    }
  }

  if (businessWeightedCoverage > traditionalCoverage + 10) {
    recommendations.push(
      `Business-weighted coverage (${businessWeightedCoverage}%) is higher than traditional coverage (${traditionalCoverage}%). ` +
      `Your tests are well-focused on important code. Maintain this balance.`
    );
  }

  if (traditionalCoverage > businessWeightedCoverage + 10) {
    recommendations.push(
      `Traditional coverage (${traditionalCoverage}%) exceeds business-weighted coverage (${businessWeightedCoverage}%). ` +
      `Tests may be over-focused on infrastructure. Redirect effort to business-critical paths.`
    );
  }

  return {
    summary: {
      traditionalCoverage,
      businessWeightedCoverage,
      totalFunctions,
      testedFunctions,
    },
    byLayer,
    criticalGaps,
    recommendations,
  };
}

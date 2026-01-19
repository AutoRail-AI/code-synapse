/**
 * Risk Scoring Report
 *
 * Calculates risk scores for code changes based on business impact,
 * historical incidents, and code complexity.
 */

import type { CodeSynapseClient, FunctionInfo, LedgerEntry } from "../api/client.js";

// =============================================================================
// Types
// =============================================================================

export interface RiskReport {
  summary: {
    averageRisk: number;
    highRiskCount: number;
    mediumRiskCount: number;
    lowRiskCount: number;
    totalEntities: number;
  };
  highRiskEntities: RiskEntity[];
  riskFactors: RiskFactorSummary;
  recommendations: string[];
}

export interface RiskEntity {
  entityId: string;
  name: string;
  filePath: string;
  riskScore: number;
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
  factors: {
    businessClassification: number;
    complexity: number;
    callerCount: number;
    recentChanges: number;
    lowConfidence: number;
  };
  breakdown: string;
}

export interface RiskFactorSummary {
  businessCritical: {
    count: number;
    averageComplexity: number;
  };
  highComplexity: {
    count: number;
    threshold: number;
  };
  highChurn: {
    count: number;
    threshold: number;
  };
  lowConfidence: {
    count: number;
    threshold: number;
  };
}

// =============================================================================
// Risk Calculation
// =============================================================================

/**
 * Calculate business layer weight
 */
function getBusinessWeight(classification: string | undefined): number {
  switch (classification?.toLowerCase()) {
    case "domain":
      return 2.0; // Domain code is more critical
    case "infrastructure":
      return 0.5; // Infrastructure is less risky
    default:
      return 1.0;
  }
}

/**
 * Calculate complexity risk factor (0-1)
 */
function getComplexityFactor(complexity: number | undefined): number {
  if (!complexity) return 0.3;
  if (complexity <= 5) return 0.1;
  if (complexity <= 10) return 0.3;
  if (complexity <= 20) return 0.5;
  if (complexity <= 30) return 0.7;
  return 1.0;
}

/**
 * Calculate caller count risk factor (0-1)
 * More callers = more potential impact
 */
function getCallerFactor(callerCount: number | undefined): number {
  if (!callerCount) return 0.1;
  if (callerCount <= 2) return 0.1;
  if (callerCount <= 5) return 0.3;
  if (callerCount <= 10) return 0.5;
  if (callerCount <= 20) return 0.7;
  return 1.0;
}

/**
 * Calculate confidence risk factor (0-1)
 * Lower confidence = higher risk (we don't understand the code well)
 */
function getConfidenceFactor(confidence: number | undefined): number {
  if (confidence === undefined) return 0.5;
  if (confidence >= 0.9) return 0.1;
  if (confidence >= 0.7) return 0.3;
  if (confidence >= 0.5) return 0.5;
  return 0.8;
}

/**
 * Calculate recent changes factor (0-1)
 * More recent changes = higher risk (code in flux)
 */
function getChurnFactor(changeCount: number): number {
  if (changeCount <= 1) return 0.1;
  if (changeCount <= 3) return 0.3;
  if (changeCount <= 5) return 0.5;
  if (changeCount <= 10) return 0.7;
  return 1.0;
}

/**
 * Calculate overall risk score (0-100)
 */
function calculateRiskScore(factors: RiskEntity["factors"]): number {
  // Weighted combination of factors
  const weights = {
    businessClassification: 0.30,
    complexity: 0.25,
    callerCount: 0.20,
    recentChanges: 0.15,
    lowConfidence: 0.10,
  };

  const score =
    factors.businessClassification * weights.businessClassification +
    factors.complexity * weights.complexity +
    factors.callerCount * weights.callerCount +
    factors.recentChanges * weights.recentChanges +
    factors.lowConfidence * weights.lowConfidence;

  return Math.round(score * 100);
}

/**
 * Determine risk level from score
 */
function getRiskLevel(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

/**
 * Generate human-readable breakdown
 */
function generateBreakdown(factors: RiskEntity["factors"]): string {
  const parts: string[] = [];

  if (factors.businessClassification > 0.7) {
    parts.push("business-critical code");
  }
  if (factors.complexity > 0.6) {
    parts.push("high complexity");
  }
  if (factors.callerCount > 0.5) {
    parts.push("many callers");
  }
  if (factors.recentChanges > 0.5) {
    parts.push("frequent changes");
  }
  if (factors.lowConfidence > 0.5) {
    parts.push("low confidence");
  }

  if (parts.length === 0) {
    return "Low risk across all factors";
  }

  return `Risk factors: ${parts.join(", ")}`;
}

// =============================================================================
// Report Generator
// =============================================================================

export async function generateRiskReport(
  client: CodeSynapseClient
): Promise<RiskReport> {
  // Fetch data
  const [functions, ledgerStats, recentEntries] = await Promise.all([
    client.listFunctions({ limit: 5000 }),
    client.getLedgerStats().catch(() => null),
    client.getRecentLedgerEntries(500).catch(() => []),
  ]);

  // Count changes per entity from ledger
  const changeCountByEntity = new Map<string, number>();
  for (const entry of recentEntries) {
    for (const entityId of entry.entityIds || []) {
      changeCountByEntity.set(entityId, (changeCountByEntity.get(entityId) || 0) + 1);
    }
  }

  // Calculate risk for each function
  const riskEntities: RiskEntity[] = functions.map(fn => {
    const changeCount = changeCountByEntity.get(fn.id) || 0;

    const factors = {
      businessClassification: fn.classification === "domain" ? 0.8 : 0.3,
      complexity: getComplexityFactor(fn.complexity),
      callerCount: getCallerFactor(fn.callerCount),
      recentChanges: getChurnFactor(changeCount),
      lowConfidence: getConfidenceFactor(fn.confidence),
    };

    const riskScore = calculateRiskScore(factors);

    return {
      entityId: fn.id,
      name: fn.name,
      filePath: fn.filePath,
      riskScore,
      riskLevel: getRiskLevel(riskScore),
      factors,
      breakdown: generateBreakdown(factors),
    };
  });

  // Sort by risk score
  riskEntities.sort((a, b) => b.riskScore - a.riskScore);

  // Calculate summary stats
  const highRisk = riskEntities.filter(e => e.riskLevel === "HIGH");
  const mediumRisk = riskEntities.filter(e => e.riskLevel === "MEDIUM");
  const lowRisk = riskEntities.filter(e => e.riskLevel === "LOW");

  const averageRisk = riskEntities.length > 0
    ? Math.round(riskEntities.reduce((sum, e) => sum + e.riskScore, 0) / riskEntities.length)
    : 0;

  // Calculate risk factor summary
  const highComplexityThreshold = 20;
  const highChurnThreshold = 5;
  const lowConfidenceThreshold = 0.5;

  const businessCriticalEntities = riskEntities.filter(e => e.factors.businessClassification > 0.7);
  const highComplexityEntities = functions.filter(f => (f.complexity || 0) > highComplexityThreshold);
  const highChurnEntities = Array.from(changeCountByEntity.entries())
    .filter(([_, count]) => count > highChurnThreshold);
  const lowConfidenceEntities = functions.filter(f => (f.confidence || 1) < lowConfidenceThreshold);

  const riskFactors: RiskFactorSummary = {
    businessCritical: {
      count: businessCriticalEntities.length,
      averageComplexity: businessCriticalEntities.length > 0
        ? Math.round(
            businessCriticalEntities.reduce((sum, e) => {
              const fn = functions.find(f => f.id === e.entityId);
              return sum + (fn?.complexity || 0);
            }, 0) / businessCriticalEntities.length
          )
        : 0,
    },
    highComplexity: {
      count: highComplexityEntities.length,
      threshold: highComplexityThreshold,
    },
    highChurn: {
      count: highChurnEntities.length,
      threshold: highChurnThreshold,
    },
    lowConfidence: {
      count: lowConfidenceEntities.length,
      threshold: lowConfidenceThreshold,
    },
  };

  // Generate recommendations
  const recommendations: string[] = [];

  if (highRisk.length > 0) {
    recommendations.push(
      `${highRisk.length} entities have HIGH risk scores. ` +
      `Top risk: ${highRisk[0].name} (score: ${highRisk[0].riskScore}). ` +
      `Consider additional review and testing for these entities.`
    );
  }

  if (riskFactors.businessCritical.count > 0 && riskFactors.businessCritical.averageComplexity > 15) {
    recommendations.push(
      `Business-critical code has average complexity of ${riskFactors.businessCritical.averageComplexity}. ` +
      `Consider refactoring to reduce complexity and risk.`
    );
  }

  if (riskFactors.highChurn.count > 10) {
    recommendations.push(
      `${riskFactors.highChurn.count} entities have high change frequency (>${riskFactors.highChurn.threshold} changes). ` +
      `This indicates areas that may benefit from design improvements.`
    );
  }

  if (riskFactors.lowConfidence.count > functions.length * 0.2) {
    recommendations.push(
      `${riskFactors.lowConfidence.count} entities (${Math.round(riskFactors.lowConfidence.count / functions.length * 100)}%) have low confidence scores. ` +
      `Run 'code-synapse justify -i' to clarify business context.`
    );
  }

  if (averageRisk < 30) {
    recommendations.push(
      `Average risk score is ${averageRisk} (LOW). ` +
      `Your codebase has a healthy risk profile. Maintain current practices.`
    );
  }

  return {
    summary: {
      averageRisk,
      highRiskCount: highRisk.length,
      mediumRiskCount: mediumRisk.length,
      lowRiskCount: lowRisk.length,
      totalEntities: riskEntities.length,
    },
    highRiskEntities: highRisk.slice(0, 20),
    riskFactors,
    recommendations,
  };
}

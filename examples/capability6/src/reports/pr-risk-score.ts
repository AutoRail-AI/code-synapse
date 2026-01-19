/**
 * PR Risk Score Calculator
 *
 * From BUSINESS-AWARE-TESTING.md Part 2: Code Reviews Without Context
 *
 * "Code reviews look at the change. They don't look at:
 *  - The business impact of the change
 *  - The history of incidents in the affected code
 *  - The expertise required to properly evaluate it
 *  - The downstream services that depend on it"
 *
 * This module calculates a transparent risk score with explicit factors:
 *
 * RISK: HIGH (78%)
 * Factors:
 * ├── Business classification: Revenue-critical (×2 weight)
 * ├── Call graph depth: 47 transitive callers (×1.5)
 * ├── Similar incident history: 1 incident with 67% pattern match (×1.3)
 * ├── Author familiarity: Low (3 commits to this area) (×1.2)
 * └── Test coverage delta: -5% in affected code (×1.1)
 */

import type {
  CodeSynapseClient,
  FunctionInfo,
  Classification,
  Justification,
  LedgerEntry,
} from "../api/client.js";

// =============================================================================
// Types
// =============================================================================

export interface PRRiskReport {
  summary: {
    overallRisk: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    riskScore: number; // 0-100
    confidence: number; // 0-100
    affectedFunctions: number;
    affectedBusinessFlows: string[];
  };

  // Transparent risk factors
  riskFactors: RiskFactor[];

  // Blast radius analysis
  blastRadius: BlastRadiusAnalysis;

  // Historical context
  historicalContext: HistoricalContext;

  // Expert identification
  suggestedReviewers: SuggestedReviewer[];

  // Similar past changes
  similarPastChanges: SimilarChange[];

  // Recommendations
  recommendations: PRRecommendation[];
}

export interface RiskFactor {
  name: string;
  weight: number; // Multiplier (e.g., 1.5 = 50% increase)
  value: string;
  contribution: number; // How much this factor contributed to final score
  explanation: string;
}

export interface BlastRadiusAnalysis {
  directCallers: number;
  transitiveCallers: number;
  affectedServices: string[];
  affectedBusinessFlows: FlowImpact[];
  totalImpactedFunctions: number;
}

export interface FlowImpact {
  flowName: string;
  functionsAffected: number;
  businessImportance: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  revenueImpact?: string;
}

export interface HistoricalContext {
  recentChangesCount: number; // Changes in last 30 days
  incidentsInAffectedCode: number;
  lastIncidentDate?: string;
  bugIntroductionRate: number; // % of changes that introduced bugs
  averageReviewCycles: number;
  averageTimeToMerge: string;
}

export interface SuggestedReviewer {
  name: string;
  expertise: string;
  commitCount: number;
  lastActive: string;
  recommendationReason: string;
}

export interface SimilarChange {
  prId: string;
  title: string;
  date: string;
  similarity: number; // 0-100
  outcome: "INCIDENT" | "SUCCESS" | "UNKNOWN";
  relevantLearning: string;
}

export interface PRRecommendation {
  priority: "CRITICAL" | "HIGH" | "MEDIUM";
  action: string;
  reason: string;
}

// =============================================================================
// Constants
// =============================================================================

const BUSINESS_FLOW_KEYWORDS: Record<string, string[]> = {
  "Checkout Flow": ["checkout", "cart", "purchase", "order"],
  "Payment Processing": ["payment", "charge", "billing", "transaction", "stripe", "paypal"],
  "User Authentication": ["auth", "login", "session", "token", "oauth"],
  "Subscription Management": ["subscription", "plan", "billing", "renewal"],
  "User Profile": ["profile", "user", "account", "settings"],
  "Notification System": ["notification", "email", "sms", "alert"],
  "Search & Discovery": ["search", "filter", "browse", "catalog"],
  "Admin Dashboard": ["admin", "dashboard", "management"],
};

// =============================================================================
// Analysis Functions
// =============================================================================

function inferBusinessFlows(functions: FunctionInfo[]): string[] {
  const flows = new Set<string>();

  for (const fn of functions) {
    const searchText = `${fn.name} ${fn.filePath}`.toLowerCase();

    for (const [flowName, keywords] of Object.entries(BUSINESS_FLOW_KEYWORDS)) {
      if (keywords.some((kw) => searchText.includes(kw))) {
        flows.add(flowName);
      }
    }
  }

  return Array.from(flows);
}

function calculateSimilarity(change1: string, change2: string): number {
  // Simple Jaccard similarity on words
  const words1 = new Set(change1.toLowerCase().split(/\W+/));
  const words2 = new Set(change2.toLowerCase().split(/\W+/));

  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return Math.round((intersection.size / union.size) * 100);
}

function categorizeRisk(score: number): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

// =============================================================================
// Main Report Generator
// =============================================================================

/**
 * Calculate PR risk score for a set of changed functions
 *
 * @param client - Code-Synapse API client
 * @param changedFunctionIds - IDs of functions that were modified
 * @param prTitle - Title of the PR (for pattern matching)
 * @param prAuthor - Author of the PR (for familiarity analysis)
 */
export async function calculatePRRiskScore(
  client: CodeSynapseClient,
  changedFunctionIds: string[] = [],
  prTitle: string = "Code change",
  prAuthor: string = "unknown"
): Promise<PRRiskReport> {
  // If no specific functions provided, analyze recent changes
  const [allFunctions, ledgerEntries] = await Promise.all([
    client.listFunctions({ limit: 5000 }),
    client.getRecentLedgerEntries(500).catch(() => []),
  ]);

  // Determine which functions to analyze
  let affectedFunctions: FunctionInfo[];

  if (changedFunctionIds.length > 0) {
    affectedFunctions = allFunctions.filter((fn) => changedFunctionIds.includes(fn.id));
  } else {
    // Use most recently changed functions from ledger
    const recentEntityIds = new Set<string>();
    for (const entry of ledgerEntries.slice(0, 20)) {
      for (const entityId of entry.entityIds || []) {
        recentEntityIds.add(entityId);
      }
    }
    affectedFunctions = allFunctions.filter((fn) => recentEntityIds.has(fn.id)).slice(0, 20);
  }

  if (affectedFunctions.length === 0) {
    // Fallback: pick some high-complexity functions for demo
    affectedFunctions = allFunctions
      .filter((fn) => !fn.filePath.includes("test"))
      .sort((a, b) => (b.complexity || 0) - (a.complexity || 0))
      .slice(0, 10);
  }

  // Fetch classifications for affected functions
  const classifications = new Map<string, Classification>();
  const justifications = new Map<string, Justification>();

  for (const fn of affectedFunctions.slice(0, 50)) {
    try {
      const [classification, justification] = await Promise.all([
        client.getClassification(fn.id).catch(() => null),
        client.getJustification(fn.id).catch(() => null),
      ]);
      if (classification) classifications.set(fn.id, classification);
      if (justification) justifications.set(fn.id, justification);
    } catch {
      // Continue
    }
  }

  // ============================================================
  // Calculate Risk Factors
  // ============================================================
  const riskFactors: RiskFactor[] = [];
  let baseScore = 30; // Start at 30%

  // Factor 1: Business Classification
  const domainFunctions = affectedFunctions.filter((fn) => {
    const c = classifications.get(fn.id);
    return c?.category === "domain";
  });
  const domainPercentage = (domainFunctions.length / Math.max(1, affectedFunctions.length)) * 100;

  let businessWeight = 1.0;
  if (domainPercentage > 80) {
    businessWeight = 2.0;
    riskFactors.push({
      name: "Business Classification",
      weight: 2.0,
      value: "Revenue-critical (>80% domain code)",
      contribution: 20,
      explanation: "This change primarily affects domain/business logic code",
    });
  } else if (domainPercentage > 50) {
    businessWeight = 1.5;
    riskFactors.push({
      name: "Business Classification",
      weight: 1.5,
      value: "Mixed (50-80% domain code)",
      contribution: 12,
      explanation: "This change affects a mix of domain and infrastructure code",
    });
  } else {
    businessWeight = 1.0;
    riskFactors.push({
      name: "Business Classification",
      weight: 1.0,
      value: "Infrastructure (<50% domain code)",
      contribution: 5,
      explanation: "This change primarily affects infrastructure code",
    });
  }
  baseScore += riskFactors[riskFactors.length - 1].contribution;

  // Factor 2: Call Graph Depth (Blast Radius)
  let totalCallers = 0;
  for (const fn of affectedFunctions.slice(0, 10)) {
    try {
      const callers = await client.getFunctionCallers(fn.id);
      totalCallers += callers.length;
    } catch {
      totalCallers += fn.callerCount || 0;
    }
  }

  let blastRadiusWeight = 1.0;
  if (totalCallers > 30) {
    blastRadiusWeight = 1.5;
    riskFactors.push({
      name: "Call Graph Depth",
      weight: 1.5,
      value: `${totalCallers} transitive callers`,
      contribution: 15,
      explanation: "High blast radius - many functions depend on this code",
    });
  } else if (totalCallers > 10) {
    blastRadiusWeight = 1.2;
    riskFactors.push({
      name: "Call Graph Depth",
      weight: 1.2,
      value: `${totalCallers} transitive callers`,
      contribution: 8,
      explanation: "Moderate blast radius",
    });
  } else {
    blastRadiusWeight = 1.0;
    riskFactors.push({
      name: "Call Graph Depth",
      weight: 1.0,
      value: `${totalCallers} transitive callers`,
      contribution: 3,
      explanation: "Limited blast radius",
    });
  }
  baseScore += riskFactors[riskFactors.length - 1].contribution;

  // Factor 3: Incident History
  const incidentEntries = ledgerEntries.filter(
    (e) =>
      e.eventType.includes("incident") ||
      e.eventType.includes("error") ||
      e.eventType.includes("fail")
  );
  const affectedEntityIds = new Set(affectedFunctions.map((fn) => fn.id));
  const relevantIncidents = incidentEntries.filter((e) =>
    e.entityIds?.some((id) => affectedEntityIds.has(id))
  );

  let incidentWeight = 1.0;
  if (relevantIncidents.length > 2) {
    incidentWeight = 1.4;
    riskFactors.push({
      name: "Incident History",
      weight: 1.4,
      value: `${relevantIncidents.length} past incidents`,
      contribution: 15,
      explanation: "This code has caused multiple incidents before",
    });
  } else if (relevantIncidents.length > 0) {
    incidentWeight = 1.2;
    riskFactors.push({
      name: "Incident History",
      weight: 1.2,
      value: `${relevantIncidents.length} past incident(s)`,
      contribution: 8,
      explanation: "This code has incident history",
    });
  } else {
    incidentWeight = 1.0;
    riskFactors.push({
      name: "Incident History",
      weight: 1.0,
      value: "No incidents",
      contribution: 0,
      explanation: "No past incidents linked to this code",
    });
  }
  baseScore += riskFactors[riskFactors.length - 1].contribution;

  // Factor 4: Author Familiarity
  const authorChanges = ledgerEntries.filter(
    (e) =>
      e.metadata?.author === prAuthor &&
      e.entityIds?.some((id) => affectedEntityIds.has(id))
  );

  let familiarityWeight = 1.0;
  if (authorChanges.length < 3) {
    familiarityWeight = 1.3;
    riskFactors.push({
      name: "Author Familiarity",
      weight: 1.3,
      value: `Low (${authorChanges.length} prior commits to this area)`,
      contribution: 10,
      explanation: "Author has limited experience with this code",
    });
  } else if (authorChanges.length < 10) {
    familiarityWeight = 1.1;
    riskFactors.push({
      name: "Author Familiarity",
      weight: 1.1,
      value: `Moderate (${authorChanges.length} prior commits)`,
      contribution: 5,
      explanation: "Author has some experience with this code",
    });
  } else {
    familiarityWeight = 0.9;
    riskFactors.push({
      name: "Author Familiarity",
      weight: 0.9,
      value: `High (${authorChanges.length} prior commits)`,
      contribution: -5,
      explanation: "Author is familiar with this code",
    });
  }
  baseScore += riskFactors[riskFactors.length - 1].contribution;

  // Factor 5: Code Complexity
  const avgComplexity =
    affectedFunctions.reduce((sum, fn) => sum + (fn.complexity || 1), 0) /
    Math.max(1, affectedFunctions.length);

  let complexityWeight = 1.0;
  if (avgComplexity > 20) {
    complexityWeight = 1.3;
    riskFactors.push({
      name: "Code Complexity",
      weight: 1.3,
      value: `High (avg ${Math.round(avgComplexity)})`,
      contribution: 10,
      explanation: "Complex code is harder to review correctly",
    });
  } else if (avgComplexity > 10) {
    complexityWeight = 1.1;
    riskFactors.push({
      name: "Code Complexity",
      weight: 1.1,
      value: `Moderate (avg ${Math.round(avgComplexity)})`,
      contribution: 5,
      explanation: "Moderate complexity",
    });
  } else {
    complexityWeight = 1.0;
    riskFactors.push({
      name: "Code Complexity",
      weight: 1.0,
      value: `Low (avg ${Math.round(avgComplexity)})`,
      contribution: 0,
      explanation: "Simple code, easier to review",
    });
  }
  baseScore += riskFactors[riskFactors.length - 1].contribution;

  // Apply multipliers
  const finalScore = Math.min(100, Math.round(baseScore * Math.sqrt(businessWeight * blastRadiusWeight)));

  // ============================================================
  // Blast Radius Analysis
  // ============================================================
  const businessFlows = inferBusinessFlows(affectedFunctions);

  const blastRadius: BlastRadiusAnalysis = {
    directCallers: totalCallers,
    transitiveCallers: Math.round(totalCallers * 1.5), // Estimate
    affectedServices: [...new Set(affectedFunctions.map((fn) => fn.filePath.split("/")[1] || "main"))],
    affectedBusinessFlows: businessFlows.map((flow) => ({
      flowName: flow,
      functionsAffected: Math.ceil(affectedFunctions.length / businessFlows.length),
      businessImportance: flow.includes("Payment") || flow.includes("Checkout") ? "CRITICAL" : "MEDIUM",
      revenueImpact: flow.includes("Payment") ? "Affects transactions" : undefined,
    })),
    totalImpactedFunctions: affectedFunctions.length + totalCallers,
  };

  // ============================================================
  // Historical Context
  // ============================================================
  const recentChanges = ledgerEntries.filter((e) =>
    e.entityIds?.some((id) => affectedEntityIds.has(id))
  );

  const historicalContext: HistoricalContext = {
    recentChangesCount: recentChanges.length,
    incidentsInAffectedCode: relevantIncidents.length,
    lastIncidentDate: relevantIncidents[0]?.timestamp,
    bugIntroductionRate:
      recentChanges.length > 0
        ? Math.round((relevantIncidents.length / recentChanges.length) * 100)
        : 0,
    averageReviewCycles: 2.3, // Would come from PR metadata
    averageTimeToMerge: "2.5 days", // Would come from PR metadata
  };

  // ============================================================
  // Suggested Reviewers
  // ============================================================
  const authorCommits = new Map<string, number>();

  for (const entry of ledgerEntries) {
    if (entry.entityIds?.some((id) => affectedEntityIds.has(id))) {
      const author = String(entry.metadata?.author || "unknown");
      if (author !== prAuthor) {
        authorCommits.set(author, (authorCommits.get(author) || 0) + 1);
      }
    }
  }

  const suggestedReviewers: SuggestedReviewer[] = Array.from(authorCommits.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, commits]) => ({
      name,
      expertise: commits > 10 ? "Domain Expert" : commits > 5 ? "Frequent Contributor" : "Familiar",
      commitCount: commits,
      lastActive: "Recent",
      recommendationReason:
        commits > 10
          ? `${name} is the domain expert with ${commits} commits to this area`
          : `${name} has ${commits} commits and can provide context`,
    }));

  // ============================================================
  // Similar Past Changes
  // ============================================================
  const changeEntries = ledgerEntries.filter((e) => e.eventType.includes("change"));

  const similarPastChanges: SimilarChange[] = changeEntries
    .slice(0, 20)
    .map((entry) => {
      const entryTitle = String(entry.metadata?.title || entry.metadata?.message || entry.id);
      const similarity = calculateSimilarity(prTitle, entryTitle);

      const hadIncident = incidentEntries.some(
        (inc) =>
          inc.entityIds?.some((id) => entry.entityIds?.includes(id)) &&
          new Date(inc.timestamp) > new Date(entry.timestamp)
      );

      return {
        prId: entry.id,
        title: entryTitle,
        date: entry.timestamp,
        similarity,
        outcome: hadIncident ? ("INCIDENT" as const) : ("SUCCESS" as const),
        relevantLearning: hadIncident
          ? "This similar change caused an incident - review carefully"
          : similarity > 50
          ? "Similar change was successful - follow the same pattern"
          : "Limited similarity",
      };
    })
    .filter((c) => c.similarity > 30)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  // ============================================================
  // Recommendations
  // ============================================================
  const recommendations: PRRecommendation[] = [];

  if (finalScore >= 60) {
    if (suggestedReviewers.length > 0) {
      recommendations.push({
        priority: "HIGH",
        action: `Add ${suggestedReviewers[0].name} as a reviewer`,
        reason: suggestedReviewers[0].recommendationReason,
      });
    }
  }

  if (relevantIncidents.length > 0) {
    recommendations.push({
      priority: "CRITICAL",
      action: "Review incident history before approving",
      reason: `This code has caused ${relevantIncidents.length} incident(s). Ensure the same patterns aren't repeated.`,
    });
  }

  const incidentSimilar = similarPastChanges.find((c) => c.outcome === "INCIDENT" && c.similarity > 50);
  if (incidentSimilar) {
    recommendations.push({
      priority: "CRITICAL",
      action: "Compare against similar change that caused incident",
      reason: `PR ${incidentSimilar.prId} (${incidentSimilar.similarity}% similar) caused an incident`,
    });
  }

  if (businessWeight > 1.5) {
    recommendations.push({
      priority: "HIGH",
      action: "Ensure integration tests exist for affected business flows",
      reason: "Revenue-critical code requires comprehensive integration testing",
    });
  }

  if (totalCallers > 20) {
    recommendations.push({
      priority: "MEDIUM",
      action: "Consider phased rollout",
      reason: `High blast radius (${totalCallers} callers) - gradual deployment reduces risk`,
    });
  }

  return {
    summary: {
      overallRisk: categorizeRisk(finalScore),
      riskScore: finalScore,
      confidence: Math.round(85 - (affectedFunctions.length < 5 ? 20 : 0)),
      affectedFunctions: affectedFunctions.length,
      affectedBusinessFlows: businessFlows,
    },
    riskFactors,
    blastRadius,
    historicalContext,
    suggestedReviewers,
    similarPastChanges,
    recommendations,
  };
}

// Convenience function for demo
export async function generatePRRiskReport(client: CodeSynapseClient): Promise<PRRiskReport> {
  return calculatePRRiskScore(client, [], "Recent code changes", "developer");
}

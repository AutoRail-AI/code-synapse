/**
 * Bus Factor Analysis
 *
 * Calculates the bus factor for each module/area of the codebase.
 * Bus factor = how many people would need to leave before knowledge is lost.
 */

import type { CodeSynapseClient, FunctionInfo, LedgerEntry } from "../api/client.js";

// =============================================================================
// Types
// =============================================================================

export interface BusFactorReport {
  summary: {
    averageBusFactor: number;
    criticalRiskCount: number;
    moderateRiskCount: number;
    healthyCount: number;
    totalModules: number;
  };
  criticalRiskModules: ModuleBusFactor[];
  moderateRiskModules: ModuleBusFactor[];
  expertsByModule: ModuleExperts[];
  recommendations: string[];
}

export interface ModuleBusFactor {
  modulePath: string;
  busFactor: number;
  riskLevel: "CRITICAL" | "MODERATE" | "HEALTHY";
  primaryContributor: string;
  totalCommits: number;
  contributorCount: number;
  businessLayer: string;
  topFunctions: string[];
}

export interface ModuleExperts {
  modulePath: string;
  experts: Expert[];
  knowledgeDistribution: number; // 0-1, how evenly distributed knowledge is
}

export interface Expert {
  author: string;
  commitCount: number;
  percentage: number;
  lastActive: string;
  focus?: string;
}

// =============================================================================
// Analysis
// =============================================================================

/**
 * Extract module path from file path
 */
function getModulePath(filePath: string): string {
  const parts = filePath.split("/");

  // Try to find meaningful module boundaries
  const srcIndex = parts.findIndex(p => p === "src" || p === "lib" || p === "app");
  if (srcIndex >= 0 && parts.length > srcIndex + 1) {
    // Return src/module or src/module/submodule
    const moduleParts = parts.slice(srcIndex, Math.min(srcIndex + 3, parts.length - 1));
    return moduleParts.join("/");
  }

  // Fallback: use first two directories
  if (parts.length >= 2) {
    return parts.slice(0, 2).join("/");
  }

  return parts[0] || "root";
}

/**
 * Calculate bus factor from contributor distribution
 */
function calculateBusFactor(contributors: Map<string, number>): number {
  if (contributors.size === 0) return 0;

  const totalCommits = Array.from(contributors.values()).reduce((a, b) => a + b, 0);
  if (totalCommits === 0) return 0;

  // Sort contributors by commit count
  const sorted = Array.from(contributors.entries())
    .sort((a, b) => b[1] - a[1]);

  // Count how many contributors it takes to reach 80% of knowledge
  let cumulativeKnowledge = 0;
  let busFactor = 0;

  for (const [_, commits] of sorted) {
    cumulativeKnowledge += commits / totalCommits;
    busFactor++;
    if (cumulativeKnowledge >= 0.8) break;
  }

  return busFactor;
}

/**
 * Calculate knowledge distribution (Gini-like coefficient)
 * 0 = all knowledge with one person, 1 = evenly distributed
 */
function calculateKnowledgeDistribution(contributors: Map<string, number>): number {
  if (contributors.size <= 1) return 0;

  const values = Array.from(contributors.values()).sort((a, b) => a - b);
  const n = values.length;
  const total = values.reduce((a, b) => a + b, 0);

  if (total === 0) return 0;

  // Calculate Gini coefficient
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (2 * (i + 1) - n - 1) * values[i];
  }

  const gini = sum / (n * total);

  // Invert so 1 = evenly distributed
  return Math.round((1 - gini) * 100) / 100;
}

/**
 * Determine risk level from bus factor
 */
function getRiskLevel(busFactor: number): "CRITICAL" | "MODERATE" | "HEALTHY" {
  if (busFactor <= 1) return "CRITICAL";
  if (busFactor <= 2) return "MODERATE";
  return "HEALTHY";
}

// =============================================================================
// Report Generator
// =============================================================================

export async function generateBusFactorReport(
  client: CodeSynapseClient
): Promise<BusFactorReport> {
  // Fetch data
  const [functions, recentEntries, aggregations] = await Promise.all([
    client.listFunctions({ limit: 5000 }),
    client.getRecentLedgerEntries(1000).catch(() => []),
    client.getLedgerAggregations().catch(() => null),
  ]);

  // Group functions by module
  const functionsByModule = new Map<string, FunctionInfo[]>();
  for (const fn of functions) {
    const module = getModulePath(fn.filePath);
    if (!functionsByModule.has(module)) {
      functionsByModule.set(module, []);
    }
    functionsByModule.get(module)!.push(fn);
  }

  // Extract author from ledger entries and build contributor maps
  const contributorsByModule = new Map<string, Map<string, number>>();
  const lastActiveByAuthor = new Map<string, string>();

  for (const entry of recentEntries) {
    // Extract author from metadata or source
    const author = (entry.metadata?.author as string) || entry.source || "unknown";

    // Track last active
    if (!lastActiveByAuthor.has(author) || entry.timestamp > lastActiveByAuthor.get(author)!) {
      lastActiveByAuthor.set(author, entry.timestamp);
    }

    // Map entities to modules
    for (const entityId of entry.entityIds || []) {
      const fn = functions.find(f => f.id === entityId);
      if (!fn) continue;

      const module = getModulePath(fn.filePath);

      if (!contributorsByModule.has(module)) {
        contributorsByModule.set(module, new Map());
      }

      const moduleContributors = contributorsByModule.get(module)!;
      moduleContributors.set(author, (moduleContributors.get(author) || 0) + 1);
    }
  }

  // Calculate bus factor for each module
  const moduleBusFactors: ModuleBusFactor[] = [];

  for (const [module, moduleFunctions] of functionsByModule) {
    const contributors = contributorsByModule.get(module) || new Map();
    const busFactor = calculateBusFactor(contributors);

    // Get primary contributor
    let primaryContributor = "unknown";
    let maxCommits = 0;
    for (const [author, commits] of contributors) {
      if (commits > maxCommits) {
        maxCommits = commits;
        primaryContributor = author;
      }
    }

    // Determine business layer (use most common classification in module)
    const classificationCounts: Record<string, number> = {};
    for (const fn of moduleFunctions) {
      const cls = fn.classification || "unknown";
      classificationCounts[cls] = (classificationCounts[cls] || 0) + 1;
    }

    const businessLayer = Object.entries(classificationCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";

    moduleBusFactors.push({
      modulePath: module,
      busFactor,
      riskLevel: getRiskLevel(busFactor),
      primaryContributor,
      totalCommits: Array.from(contributors.values()).reduce((a, b) => a + b, 0),
      contributorCount: contributors.size,
      businessLayer,
      topFunctions: moduleFunctions.slice(0, 5).map(f => f.name),
    });
  }

  // Sort by bus factor (lowest first = most critical)
  moduleBusFactors.sort((a, b) => a.busFactor - b.busFactor);

  // Categorize modules
  const criticalRisk = moduleBusFactors.filter(m => m.riskLevel === "CRITICAL");
  const moderateRisk = moduleBusFactors.filter(m => m.riskLevel === "MODERATE");
  const healthy = moduleBusFactors.filter(m => m.riskLevel === "HEALTHY");

  // Build experts by module
  const expertsByModule: ModuleExperts[] = [];

  for (const [module, contributors] of contributorsByModule) {
    const totalCommits = Array.from(contributors.values()).reduce((a, b) => a + b, 0);

    const experts: Expert[] = Array.from(contributors.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([author, commits]) => ({
        author,
        commitCount: commits,
        percentage: Math.round((commits / totalCommits) * 100),
        lastActive: lastActiveByAuthor.get(author) || "unknown",
      }));

    expertsByModule.push({
      modulePath: module,
      experts,
      knowledgeDistribution: calculateKnowledgeDistribution(contributors),
    });
  }

  // Calculate summary
  const avgBusFactor = moduleBusFactors.length > 0
    ? Math.round(moduleBusFactors.reduce((sum, m) => sum + m.busFactor, 0) / moduleBusFactors.length * 10) / 10
    : 0;

  // Generate recommendations
  const recommendations: string[] = [];

  if (criticalRisk.length > 0) {
    const domainCritical = criticalRisk.filter(m => m.businessLayer === "domain");
    if (domainCritical.length > 0) {
      recommendations.push(
        `URGENT: ${domainCritical.length} domain-critical modules have bus factor of 1. ` +
        `If ${domainCritical[0].primaryContributor} leaves, ${domainCritical[0].modulePath} expertise walks out. ` +
        `Schedule knowledge transfer sessions.`
      );
    }

    recommendations.push(
      `${criticalRisk.length} modules have CRITICAL bus factor (=1). ` +
      `Each has a single point of failure for knowledge. ` +
      `Prioritize pairing and documentation.`
    );
  }

  if (moderateRisk.length > 0) {
    recommendations.push(
      `${moderateRisk.length} modules have MODERATE bus factor (=2). ` +
      `Consider cross-training to improve resilience.`
    );
  }

  // Find modules where one person has >80% of commits
  const dominatedModules = expertsByModule.filter(m =>
    m.experts.length > 0 && m.experts[0].percentage > 80
  );

  if (dominatedModules.length > 0) {
    recommendations.push(
      `${dominatedModules.length} modules have >80% of commits from one person. ` +
      `Knowledge is highly concentrated. ` +
      `Top: ${dominatedModules[0].modulePath} (${dominatedModules[0].experts[0].percentage}% by ${dominatedModules[0].experts[0].author})`
    );
  }

  if (avgBusFactor >= 3) {
    recommendations.push(
      `Average bus factor is ${avgBusFactor} (HEALTHY). ` +
      `Knowledge is reasonably distributed across the team.`
    );
  }

  return {
    summary: {
      averageBusFactor: avgBusFactor,
      criticalRiskCount: criticalRisk.length,
      moderateRiskCount: moderateRisk.length,
      healthyCount: healthy.length,
      totalModules: moduleBusFactors.length,
    },
    criticalRiskModules: criticalRisk.slice(0, 15),
    moderateRiskModules: moderateRisk.slice(0, 10),
    expertsByModule: expertsByModule.slice(0, 20),
    recommendations,
  };
}

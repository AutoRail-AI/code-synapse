/**
 * Day 0 Insights Report
 *
 * From BUSINESS-AWARE-TESTING.md Part 9: Getting Started
 *
 * "Before any configuration, run these commands and get immediate insights"
 *
 * This module provides instant value without any configuration:
 * - God Classes (High complexity, many responsibilities)
 * - Modification Hotspots (High churn + high complexity)
 * - Bus Factor Risks (Single contributor knowledge silos)
 * - Potential Issues (flags for review)
 *
 * These insights are available immediately after indexing - no business
 * classification or justification required.
 */

import type {
  CodeSynapseClient,
  FunctionInfo,
  LedgerEntry,
} from "../api/client.js";

// =============================================================================
// Types
// =============================================================================

export interface Day0InsightsReport {
  summary: {
    filesIndexed: number;
    functionsAnalyzed: number;
    potentialIssuesFlagged: number;
    analysisTimestamp: string;
  };

  // God Classes: High complexity entities that do too much
  godClasses: GodClass[];

  // Modification Hotspots: High churn + high complexity = danger
  modificationHotspots: ModificationHotspot[];

  // Bus Factor Risks: Single contributor knowledge silos
  busFactorRisks: BusFactorRisk[];

  // Complexity Distribution
  complexityDistribution: ComplexityBucket[];

  // Quick Wins: Easy improvements with high impact
  quickWins: QuickWin[];

  // Codebase Health Score (0-100)
  healthScore: number;
  healthFactors: HealthFactor[];
}

export interface GodClass {
  name: string;
  filePath: string;
  complexity: number;
  methodCount: number;
  lineCount: number;
  responsibilities: string[]; // Inferred from method names
  recommendation: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
}

export interface ModificationHotspot {
  name: string;
  filePath: string;
  complexity: number;
  changeCount: number; // In last 30 days
  lastChanged: string;
  changeFrequency: string; // "daily", "weekly", etc.
  riskAssessment: string;
  recommendation: string;
}

export interface BusFactorRisk {
  modulePath: string;
  primaryContributor: string;
  contributorCommits: number;
  totalCommits: number;
  otherContributors: { name: string; commits: number }[];
  busFactor: number;
  riskLevel: "CRITICAL" | "HIGH" | "MODERATE";
  recommendation: string;
}

export interface ComplexityBucket {
  range: string; // e.g., "1-5", "6-10", "11-20", "21+"
  count: number;
  percentage: number;
  examples: string[];
}

export interface QuickWin {
  type: "SPLIT_FUNCTION" | "EXTRACT_CLASS" | "ADD_TESTS" | "REDUCE_PARAMS";
  target: string;
  filePath: string;
  currentState: string;
  improvement: string;
  effort: "LOW" | "MEDIUM";
  impact: "HIGH" | "MEDIUM";
}

export interface HealthFactor {
  name: string;
  score: number; // 0-100
  status: "GOOD" | "WARNING" | "CRITICAL";
  description: string;
}

// =============================================================================
// Analysis Functions
// =============================================================================

function inferResponsibilities(fn: FunctionInfo): string[] {
  const responsibilities: string[] = [];
  const name = fn.name.toLowerCase();

  // Infer from common patterns
  if (name.includes("get") || name.includes("fetch") || name.includes("load")) {
    responsibilities.push("Data Retrieval");
  }
  if (name.includes("set") || name.includes("update") || name.includes("save")) {
    responsibilities.push("Data Mutation");
  }
  if (name.includes("validate") || name.includes("check") || name.includes("verify")) {
    responsibilities.push("Validation");
  }
  if (name.includes("render") || name.includes("display") || name.includes("show")) {
    responsibilities.push("Presentation");
  }
  if (name.includes("handle") || name.includes("process") || name.includes("execute")) {
    responsibilities.push("Business Logic");
  }
  if (name.includes("log") || name.includes("track") || name.includes("record")) {
    responsibilities.push("Logging/Tracking");
  }
  if (name.includes("send") || name.includes("notify") || name.includes("emit")) {
    responsibilities.push("Communication");
  }
  if (name.includes("parse") || name.includes("transform") || name.includes("convert")) {
    responsibilities.push("Data Transformation");
  }

  return responsibilities.length > 0 ? responsibilities : ["General Purpose"];
}

function categorizeChangeFrequency(changeCount: number, daysPeriod: number = 30): string {
  const changesPerWeek = (changeCount / daysPeriod) * 7;

  if (changesPerWeek >= 7) return "Daily or more";
  if (changesPerWeek >= 3) return "Several times per week";
  if (changesPerWeek >= 1) return "Weekly";
  if (changesPerWeek >= 0.5) return "Bi-weekly";
  return "Monthly or less";
}

function determineGodClassSeverity(complexity: number, methodCount: number): "CRITICAL" | "HIGH" | "MEDIUM" {
  const score = (complexity / 30) + (methodCount / 15);
  if (score > 2) return "CRITICAL";
  if (score > 1.3) return "HIGH";
  return "MEDIUM";
}

// =============================================================================
// Main Report Generator
// =============================================================================

export async function generateDay0InsightsReport(
  client: CodeSynapseClient
): Promise<Day0InsightsReport> {
  // Fetch data
  const [allFunctions, ledgerEntries, stats] = await Promise.all([
    client.listFunctions({ limit: 10000 }),
    client.getRecentLedgerEntries(500).catch(() => []),
    client.getOverviewStats().catch(() => ({
      totalFiles: 0,
      totalFunctions: 0,
      totalClasses: 0,
    })),
  ]);

  // Filter out test functions
  const productionFunctions = allFunctions.filter(
    (fn: FunctionInfo) =>
      !fn.filePath.includes("__tests__") &&
      !fn.filePath.includes(".test.") &&
      !fn.filePath.includes(".spec.") &&
      !fn.filePath.includes("/test/")
  );

  // Count changes per file/entity
  const changesByPath = new Map<string, { count: number; authors: Map<string, number>; lastChange: string }>();

  for (const entry of ledgerEntries) {
    for (const entityId of entry.entityIds || []) {
      // Extract file path from entityId (heuristic)
      const pathMatch = entityId.match(/^(.+?):/);
      const path = pathMatch ? pathMatch[1] : entityId;

      if (!changesByPath.has(path)) {
        changesByPath.set(path, { count: 0, authors: new Map(), lastChange: entry.timestamp });
      }
      const pathData = changesByPath.get(path)!;
      pathData.count++;

      const author = String(entry.metadata?.author || entry.metadata?.user || "unknown");
      pathData.authors.set(author, (pathData.authors.get(author) || 0) + 1);

      if (new Date(entry.timestamp) > new Date(pathData.lastChange)) {
        pathData.lastChange = entry.timestamp;
      }
    }
  }

  // ============================================================
  // 1. Find God Classes (High complexity, many methods)
  // ============================================================
  const godClasses: GodClass[] = [];

  // Group functions by file to estimate class/module complexity
  const functionsByFile = new Map<string, FunctionInfo[]>();
  for (const fn of productionFunctions) {
    if (!functionsByFile.has(fn.filePath)) {
      functionsByFile.set(fn.filePath, []);
    }
    functionsByFile.get(fn.filePath)!.push(fn);
  }

  for (const [filePath, functions] of functionsByFile) {
    const totalComplexity = functions.reduce((sum, fn) => sum + (fn.complexity || 1), 0);
    const totalLines = functions.reduce((sum, fn) => sum + ((fn.endLine - fn.startLine) || 10), 0);

    // Identify high-complexity files (potential god classes)
    if (totalComplexity > 25 && functions.length > 8) {
      const responsibilities = new Set<string>();
      for (const fn of functions) {
        for (const r of inferResponsibilities(fn)) {
          responsibilities.add(r);
        }
      }

      const severity = determineGodClassSeverity(totalComplexity, functions.length);

      godClasses.push({
        name: filePath.split("/").pop() || filePath,
        filePath,
        complexity: totalComplexity,
        methodCount: functions.length,
        lineCount: totalLines,
        responsibilities: Array.from(responsibilities),
        recommendation:
          responsibilities.size > 3
            ? `This module has ${responsibilities.size} different responsibilities. Consider splitting into focused modules: ${Array.from(responsibilities).slice(0, 3).join(", ")}`
            : `High complexity (${totalComplexity}) suggests this module could benefit from refactoring`,
        severity,
      });
    }
  }

  godClasses.sort((a, b) => b.complexity - a.complexity);

  // ============================================================
  // 2. Find Modification Hotspots (High churn + high complexity)
  // ============================================================
  const modificationHotspots: ModificationHotspot[] = [];

  for (const [filePath, changeData] of changesByPath) {
    const fileFunctions = functionsByFile.get(filePath) || [];
    const totalComplexity = fileFunctions.reduce((sum, fn) => sum + (fn.complexity || 1), 0);

    // Hotspot = high changes AND high complexity
    if (changeData.count >= 5 && totalComplexity >= 15) {
      const frequency = categorizeChangeFrequency(changeData.count);

      modificationHotspots.push({
        name: filePath.split("/").pop() || filePath,
        filePath,
        complexity: totalComplexity,
        changeCount: changeData.count,
        lastChanged: changeData.lastChange,
        changeFrequency: frequency,
        riskAssessment:
          totalComplexity > 30 && changeData.count > 10
            ? "CRITICAL: Very high complexity with frequent changes - high risk of introducing bugs"
            : totalComplexity > 20 || changeData.count > 15
            ? "HIGH: Significant complexity or churn - requires careful review"
            : "MODERATE: Notable activity - monitor for issues",
        recommendation: `${changeData.count} changes with complexity ${totalComplexity}. Consider: ${
          totalComplexity > 30 ? "breaking into smaller modules, " : ""
        }${changeData.count > 10 ? "stabilizing the interface, " : ""}adding more tests for edge cases.`,
      });
    }
  }

  modificationHotspots.sort((a, b) => b.changeCount * b.complexity - a.changeCount * a.complexity);

  // ============================================================
  // 3. Bus Factor Risks (Single contributor)
  // ============================================================
  const busFactorRisks: BusFactorRisk[] = [];

  // Group by directory (module)
  const moduleChanges = new Map<string, { authors: Map<string, number>; totalCommits: number }>();

  for (const [filePath, changeData] of changesByPath) {
    const modulePath = filePath.split("/").slice(0, -1).join("/");
    if (!modulePath) continue;

    if (!moduleChanges.has(modulePath)) {
      moduleChanges.set(modulePath, { authors: new Map(), totalCommits: 0 });
    }
    const moduleData = moduleChanges.get(modulePath)!;
    moduleData.totalCommits += changeData.count;

    for (const [author, commits] of changeData.authors) {
      moduleData.authors.set(author, (moduleData.authors.get(author) || 0) + commits);
    }
  }

  for (const [modulePath, moduleData] of moduleChanges) {
    if (moduleData.totalCommits < 3) continue; // Not enough data

    const sortedAuthors = Array.from(moduleData.authors.entries()).sort((a, b) => b[1] - a[1]);

    if (sortedAuthors.length === 0) continue;

    const primaryContributor = sortedAuthors[0][0];
    const primaryCommits = sortedAuthors[0][1];
    const primaryPercentage = (primaryCommits / moduleData.totalCommits) * 100;

    // Calculate bus factor
    let busFactor = 0;
    let cumulativeCommits = 0;
    for (const [, commits] of sortedAuthors) {
      cumulativeCommits += commits;
      busFactor++;
      if (cumulativeCommits / moduleData.totalCommits >= 0.8) break; // 80% threshold
    }

    // Only flag if single person dominates (>70%)
    if (primaryPercentage >= 70 && moduleData.totalCommits >= 5) {
      const riskLevel: "CRITICAL" | "HIGH" | "MODERATE" =
        busFactor === 1 && primaryPercentage >= 90
          ? "CRITICAL"
          : busFactor === 1
          ? "HIGH"
          : "MODERATE";

      busFactorRisks.push({
        modulePath,
        primaryContributor,
        contributorCommits: primaryCommits,
        totalCommits: moduleData.totalCommits,
        otherContributors: sortedAuthors.slice(1, 4).map(([name, commits]) => ({ name, commits })),
        busFactor,
        riskLevel,
        recommendation:
          riskLevel === "CRITICAL"
            ? `Only ${primaryContributor} has touched this module. Knowledge transfer urgently needed.`
            : `${primaryContributor} owns ${Math.round(primaryPercentage)}% of changes. Consider pair programming or documentation.`,
      });
    }
  }

  busFactorRisks.sort((a, b) => {
    const order = { CRITICAL: 0, HIGH: 1, MODERATE: 2 };
    return order[a.riskLevel] - order[b.riskLevel];
  });

  // ============================================================
  // 4. Complexity Distribution
  // ============================================================
  const complexityBuckets = [
    { min: 1, max: 5, range: "1-5 (Simple)", count: 0, examples: [] as string[] },
    { min: 6, max: 10, range: "6-10 (Moderate)", count: 0, examples: [] as string[] },
    { min: 11, max: 20, range: "11-20 (Complex)", count: 0, examples: [] as string[] },
    { min: 21, max: 50, range: "21-50 (Very Complex)", count: 0, examples: [] as string[] },
    { min: 51, max: Infinity, range: "51+ (Critical)", count: 0, examples: [] as string[] },
  ];

  for (const fn of productionFunctions) {
    const complexity = fn.complexity || 1;
    for (const bucket of complexityBuckets) {
      if (complexity >= bucket.min && complexity <= bucket.max) {
        bucket.count++;
        if (bucket.examples.length < 3) {
          bucket.examples.push(fn.name);
        }
        break;
      }
    }
  }

  const totalFunctions = productionFunctions.length;
  const complexityDistribution: ComplexityBucket[] = complexityBuckets.map((b) => ({
    range: b.range,
    count: b.count,
    percentage: totalFunctions > 0 ? Math.round((b.count / totalFunctions) * 100) : 0,
    examples: b.examples,
  }));

  // ============================================================
  // 5. Quick Wins
  // ============================================================
  const quickWins: QuickWin[] = [];

  // Note: Parameter count detection would require deeper analysis
  // For now, focus on complexity-based quick wins

  // Find high-complexity functions that could be split
  for (const fn of productionFunctions) {
    if ((fn.complexity || 0) > 20 && (fn.complexity || 0) < 40) {
      quickWins.push({
        type: "SPLIT_FUNCTION",
        target: fn.name,
        filePath: fn.filePath,
        currentState: `Complexity: ${fn.complexity}`,
        improvement: "Extract helper functions to reduce complexity",
        effort: "MEDIUM",
        impact: "HIGH",
      });
    }
  }

  quickWins.sort((a, b) => {
    const impactOrder = { HIGH: 0, MEDIUM: 1 };
    const effortOrder = { LOW: 0, MEDIUM: 1 };
    return impactOrder[a.impact] - impactOrder[b.impact] || effortOrder[a.effort] - effortOrder[b.effort];
  });

  // ============================================================
  // 6. Calculate Health Score
  // ============================================================
  const healthFactors: HealthFactor[] = [];

  // Factor 1: Complexity distribution (more simple functions = better)
  const simplePercentage = complexityDistribution[0].percentage + complexityDistribution[1].percentage;
  const complexityScore = Math.min(100, Math.round(simplePercentage * 1.2));
  healthFactors.push({
    name: "Complexity Distribution",
    score: complexityScore,
    status: complexityScore >= 70 ? "GOOD" : complexityScore >= 40 ? "WARNING" : "CRITICAL",
    description: `${simplePercentage}% of functions are simple to moderate complexity`,
  });

  // Factor 2: God classes (fewer = better)
  const godClassScore = Math.max(0, 100 - godClasses.length * 15);
  healthFactors.push({
    name: "God Classes",
    score: godClassScore,
    status: godClassScore >= 70 ? "GOOD" : godClassScore >= 40 ? "WARNING" : "CRITICAL",
    description: `${godClasses.length} potential god classes detected`,
  });

  // Factor 3: Bus factor (higher = better)
  const criticalBusFactors = busFactorRisks.filter((r) => r.riskLevel === "CRITICAL").length;
  const busFactorScore = Math.max(0, 100 - criticalBusFactors * 20);
  healthFactors.push({
    name: "Knowledge Distribution",
    score: busFactorScore,
    status: busFactorScore >= 70 ? "GOOD" : busFactorScore >= 40 ? "WARNING" : "CRITICAL",
    description: `${criticalBusFactors} modules with critical bus factor (single owner)`,
  });

  // Factor 4: Hotspots (fewer = better)
  const criticalHotspots = modificationHotspots.filter((h) => h.riskAssessment.startsWith("CRITICAL")).length;
  const hotspotScore = Math.max(0, 100 - criticalHotspots * 20);
  healthFactors.push({
    name: "Modification Stability",
    score: hotspotScore,
    status: hotspotScore >= 70 ? "GOOD" : hotspotScore >= 40 ? "WARNING" : "CRITICAL",
    description: `${criticalHotspots} critical modification hotspots`,
  });

  // Overall health score
  const healthScore = Math.round(
    healthFactors.reduce((sum, f) => sum + f.score, 0) / healthFactors.length
  );

  const potentialIssues = godClasses.length + busFactorRisks.filter((r) => r.riskLevel === "CRITICAL").length + criticalHotspots;

  return {
    summary: {
      filesIndexed: stats.totalFiles || functionsByFile.size,
      functionsAnalyzed: productionFunctions.length,
      potentialIssuesFlagged: potentialIssues,
      analysisTimestamp: new Date().toISOString(),
    },
    godClasses: godClasses.slice(0, 15),
    modificationHotspots: modificationHotspots.slice(0, 15),
    busFactorRisks: busFactorRisks.slice(0, 15),
    complexityDistribution,
    quickWins: quickWins.slice(0, 10),
    healthScore,
    healthFactors,
  };
}

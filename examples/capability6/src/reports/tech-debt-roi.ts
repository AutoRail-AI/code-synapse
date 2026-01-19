/**
 * Tech Debt ROI Calculator
 *
 * Calculates the ROI of refactoring tech debt based on:
 * - Modification friction (complexity × churn × PR friction)
 * - Business classification
 * - Historical incident correlation
 */

import type { CodeSynapseClient, FunctionInfo, LedgerEntry } from "../api/client.js";

// =============================================================================
// Types
// =============================================================================

export interface TechDebtReport {
  summary: {
    totalDebtScore: number;
    averageFriction: number;
    highFrictionCount: number;
    estimatedMonthlyHours: number;
  };
  topRefactoringOpportunities: RefactoringOpportunity[];
  debtByCategory: DebtCategory[];
  modificationFriction: ModificationFrictionEntry[];
  recommendations: string[];
}

export interface RefactoringOpportunity {
  entityId: string;
  name: string;
  filePath: string;
  debtScore: number;
  estimatedEffort: number; // story points
  estimatedBenefit: string;
  roi: number;
  confidence: number;
  factors: {
    complexity: number;
    churn: number;
    businessImportance: number;
    callerCount: number;
  };
}

export interface DebtCategory {
  category: string;
  count: number;
  totalDebtScore: number;
  averageComplexity: number;
  topEntities: Array<{ name: string; score: number }>;
}

export interface ModificationFrictionEntry {
  entityId: string;
  name: string;
  filePath: string;
  friction: number;
  frictionMultiple: number; // compared to average
  complexity: number;
  churnRate: number;
  businessLayer: string;
}

// =============================================================================
// Calculations
// =============================================================================

/**
 * Calculate modification friction score
 *
 * Friction = Complexity × Churn × Business Weight
 */
function calculateFriction(
  complexity: number,
  churnRate: number,
  businessWeight: number
): number {
  return complexity * Math.max(1, churnRate) * businessWeight;
}

/**
 * Get business weight for an entity
 */
function getBusinessWeight(classification: string | undefined): number {
  switch (classification?.toLowerCase()) {
    case "domain":
      return 1.5;
    case "infrastructure":
      return 0.5;
    default:
      return 1.0;
  }
}

/**
 * Estimate refactoring effort in story points
 */
function estimateEffort(complexity: number, callerCount: number): number {
  // Base effort from complexity
  let effort = 1;
  if (complexity > 30) effort = 5;
  else if (complexity > 20) effort = 3;
  else if (complexity > 10) effort = 2;

  // Add effort for high caller count (more testing needed)
  if (callerCount > 20) effort += 2;
  else if (callerCount > 10) effort += 1;

  return effort;
}

/**
 * Estimate monthly time cost of tech debt
 */
function estimateMonthlyHours(friction: number, churnRate: number): number {
  // High friction entities cost more time to modify
  // Formula: base time × friction factor × change frequency
  const baseDeveloperHoursPerChange = 0.5; // half hour per change
  const frictionMultiplier = Math.log2(friction + 1) / 3;
  return baseDeveloperHoursPerChange * frictionMultiplier * churnRate;
}

/**
 * Calculate ROI of refactoring
 */
function calculateROI(
  estimatedEffort: number,
  monthlyHoursSaved: number,
  paybackMonths: number = 6
): number {
  // Story point = ~4 hours of work
  const refactoringCost = estimatedEffort * 4;
  const totalSavings = monthlyHoursSaved * paybackMonths;

  if (refactoringCost === 0) return 0;
  return Math.round((totalSavings / refactoringCost) * 10) / 10;
}

/**
 * Calculate debt score for an entity
 */
function calculateDebtScore(
  complexity: number,
  churnRate: number,
  businessWeight: number,
  callerCount: number
): number {
  // Debt score combines multiple factors
  const complexityScore = Math.min(complexity / 30, 1) * 40;
  const churnScore = Math.min(churnRate / 10, 1) * 30;
  const impactScore = Math.min(callerCount / 20, 1) * businessWeight * 30;

  return Math.round(complexityScore + churnScore + impactScore);
}

// =============================================================================
// Report Generator
// =============================================================================

export async function generateTechDebtReport(
  client: CodeSynapseClient
): Promise<TechDebtReport> {
  // Fetch data
  const [functions, mostComplex, recentEntries] = await Promise.all([
    client.listFunctions({ limit: 5000 }),
    client.getMostComplexFunctions(50),
    client.getRecentLedgerEntries(500).catch(() => []),
  ]);

  // Calculate change rates (churn) per entity
  const changeCountByEntity = new Map<string, number>();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  for (const entry of recentEntries) {
    const entryTime = new Date(entry.timestamp).getTime();
    if (entryTime >= thirtyDaysAgo) {
      for (const entityId of entry.entityIds || []) {
        changeCountByEntity.set(entityId, (changeCountByEntity.get(entityId) || 0) + 1);
      }
    }
  }

  // Calculate friction for all functions
  const frictionEntries: ModificationFrictionEntry[] = functions.map(fn => {
    const complexity = fn.complexity || 1;
    const churnRate = changeCountByEntity.get(fn.id) || 0;
    const businessWeight = getBusinessWeight(fn.classification);
    const friction = calculateFriction(complexity, churnRate, businessWeight);

    return {
      entityId: fn.id,
      name: fn.name,
      filePath: fn.filePath,
      friction,
      frictionMultiple: 0, // calculated below
      complexity,
      churnRate,
      businessLayer: fn.classification === "domain" ? "domain" : fn.classification === "infrastructure" ? "infrastructure" : "unknown",
    };
  });

  // Calculate average friction and multiples
  const avgFriction = frictionEntries.length > 0
    ? frictionEntries.reduce((sum, e) => sum + e.friction, 0) / frictionEntries.length
    : 1;

  for (const entry of frictionEntries) {
    entry.frictionMultiple = Math.round((entry.friction / avgFriction) * 10) / 10;
  }

  // Sort by friction
  frictionEntries.sort((a, b) => b.friction - a.friction);

  // Identify high friction entries
  const highFrictionEntries = frictionEntries.filter(e => e.frictionMultiple >= 2);

  // Calculate refactoring opportunities
  const opportunities: RefactoringOpportunity[] = highFrictionEntries
    .slice(0, 20)
    .map(entry => {
      const fn = functions.find(f => f.id === entry.entityId);
      const callerCount = fn?.callerCount || 0;
      const effort = estimateEffort(entry.complexity, callerCount);
      const monthlyHours = estimateMonthlyHours(entry.friction, entry.churnRate);
      const roi = calculateROI(effort, monthlyHours);

      return {
        entityId: entry.entityId,
        name: entry.name,
        filePath: entry.filePath,
        debtScore: calculateDebtScore(
          entry.complexity,
          entry.churnRate,
          entry.frictionMultiple,
          callerCount
        ),
        estimatedEffort: effort,
        estimatedBenefit: monthlyHours > 0
          ? `~${Math.round(monthlyHours * 10) / 10} hours/month saved`
          : "Reduced maintenance overhead",
        roi,
        confidence: fn?.confidence || 0.7,
        factors: {
          complexity: entry.complexity,
          churn: entry.churnRate,
          businessImportance: entry.businessLayer === "domain" ? 1.5 : entry.businessLayer === "infrastructure" ? 0.5 : 1.0,
          callerCount,
        },
      };
    })
    .sort((a, b) => b.roi - a.roi);

  // Group by category (complexity buckets)
  const categories: DebtCategory[] = [
    {
      category: "High Complexity (>30)",
      count: 0,
      totalDebtScore: 0,
      averageComplexity: 0,
      topEntities: [],
    },
    {
      category: "Moderate Complexity (15-30)",
      count: 0,
      totalDebtScore: 0,
      averageComplexity: 0,
      topEntities: [],
    },
    {
      category: "High Churn (>5 changes/month)",
      count: 0,
      totalDebtScore: 0,
      averageComplexity: 0,
      topEntities: [],
    },
    {
      category: "Business Critical + Complex",
      count: 0,
      totalDebtScore: 0,
      averageComplexity: 0,
      topEntities: [],
    },
  ];

  // Populate categories
  for (const entry of frictionEntries) {
    if (entry.complexity > 30) {
      categories[0].count++;
      categories[0].totalDebtScore += calculateDebtScore(entry.complexity, entry.churnRate, entry.frictionMultiple, 0);
      categories[0].averageComplexity += entry.complexity;
      if (categories[0].topEntities.length < 5) {
        categories[0].topEntities.push({ name: entry.name, score: entry.friction });
      }
    }

    if (entry.complexity >= 15 && entry.complexity <= 30) {
      categories[1].count++;
      categories[1].totalDebtScore += calculateDebtScore(entry.complexity, entry.churnRate, entry.frictionMultiple, 0);
      categories[1].averageComplexity += entry.complexity;
      if (categories[1].topEntities.length < 5) {
        categories[1].topEntities.push({ name: entry.name, score: entry.friction });
      }
    }

    if (entry.churnRate > 5) {
      categories[2].count++;
      categories[2].totalDebtScore += calculateDebtScore(entry.complexity, entry.churnRate, entry.frictionMultiple, 0);
      categories[2].averageComplexity += entry.complexity;
      if (categories[2].topEntities.length < 5) {
        categories[2].topEntities.push({ name: entry.name, score: entry.friction });
      }
    }

    if (entry.businessLayer === "domain" && entry.complexity > 15) {
      categories[3].count++;
      categories[3].totalDebtScore += calculateDebtScore(entry.complexity, entry.churnRate, entry.frictionMultiple, 0);
      categories[3].averageComplexity += entry.complexity;
      if (categories[3].topEntities.length < 5) {
        categories[3].topEntities.push({ name: entry.name, score: entry.friction });
      }
    }
  }

  // Finalize category averages
  for (const cat of categories) {
    if (cat.count > 0) {
      cat.averageComplexity = Math.round(cat.averageComplexity / cat.count);
    }
  }

  // Calculate summary
  const totalDebtScore = frictionEntries.reduce(
    (sum, e) => sum + calculateDebtScore(e.complexity, e.churnRate, e.frictionMultiple, 0),
    0
  );

  const estimatedMonthlyHours = highFrictionEntries.reduce(
    (sum, e) => sum + estimateMonthlyHours(e.friction, e.churnRate),
    0
  );

  // Generate recommendations
  const recommendations: string[] = [];

  if (opportunities.length > 0 && opportunities[0].roi > 2) {
    recommendations.push(
      `Top refactoring opportunity: ${opportunities[0].name} with ${opportunities[0].roi}x ROI. ` +
      `Estimated effort: ${opportunities[0].estimatedEffort} story points. ` +
      `${opportunities[0].estimatedBenefit}`
    );
  }

  if (categories[3].count > 5) {
    recommendations.push(
      `${categories[3].count} business-critical functions have complexity >15. ` +
      `Prioritize refactoring these to reduce revenue risk.`
    );
  }

  if (categories[2].count > 10) {
    recommendations.push(
      `${categories[2].count} entities have high churn (>5 changes/month). ` +
      `Consider design improvements to stabilize these areas.`
    );
  }

  if (highFrictionEntries.length > functions.length * 0.1) {
    recommendations.push(
      `${Math.round(highFrictionEntries.length / functions.length * 100)}% of codebase has 2x+ average friction. ` +
      `Schedule dedicated refactoring sprints to reduce maintenance burden.`
    );
  }

  if (estimatedMonthlyHours > 20) {
    recommendations.push(
      `High-friction code is costing ~${Math.round(estimatedMonthlyHours)} hours/month. ` +
      `That's ${Math.round(estimatedMonthlyHours / 160 * 100)}% of a developer's time.`
    );
  }

  return {
    summary: {
      totalDebtScore: Math.round(totalDebtScore),
      averageFriction: Math.round(avgFriction * 10) / 10,
      highFrictionCount: highFrictionEntries.length,
      estimatedMonthlyHours: Math.round(estimatedMonthlyHours * 10) / 10,
    },
    topRefactoringOpportunities: opportunities,
    debtByCategory: categories,
    modificationFriction: frictionEntries.slice(0, 30),
    recommendations,
  };
}

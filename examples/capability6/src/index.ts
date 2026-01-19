#!/usr/bin/env node
/**
 * Business-Aware Testing MVP
 *
 * A CLI tool that demonstrates business-aware testing capabilities
 * using Code-Synapse's REST API endpoints.
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { createClient } from "./api/client.js";
import { generateBusinessCoverageReport, type BusinessCoverageReport } from "./reports/business-coverage.js";
import { generateRiskReport, type RiskReport } from "./reports/risk-scoring.js";
import { generateTechDebtReport, type TechDebtReport } from "./reports/tech-debt-roi.js";
import { generateBusFactorReport, type BusFactorReport } from "./reports/bus-factor.js";
import { generateTestQualityReport, type TestQualityReport } from "./reports/test-quality.js";
import { generateTestIntelligenceReport, type TestIntelligenceReport } from "./reports/test-intelligence.js";
import { generateDay0InsightsReport, type Day0InsightsReport } from "./reports/day0-insights.js";
import { generatePRRiskReport, type PRRiskReport } from "./reports/pr-risk-score.js";
import { generateFunctionContextReport, type FunctionContextReport } from "./reports/function-context.js";

// Helper function to create a visual progress bar
function createBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  const filledChar = percentage >= 70 ? "█" : percentage >= 40 ? "▓" : "░";
  return `[${filledChar.repeat(filled)}${"░".repeat(empty)}]`;
}

// =============================================================================
// CLI Setup
// =============================================================================

const program = new Command();

program
  .name("bat")
  .description("Business-Aware Testing MVP - Demonstrates business-weighted testing analysis")
  .version("0.1.0")
  .option("-u, --url <url>", "Code-Synapse API URL", "http://localhost:3100")
  .option("--json", "Output as JSON instead of formatted text");

// =============================================================================
// Output Formatters
// =============================================================================

function formatBusinessCoverageReport(report: BusinessCoverageReport): void {
  console.log("\n" + chalk.bold.blue("═══════════════════════════════════════════════════════════════"));
  console.log(chalk.bold.blue("  BUSINESS-WEIGHTED COVERAGE REPORT"));
  console.log(chalk.bold.blue("═══════════════════════════════════════════════════════════════\n"));

  // Summary
  console.log(chalk.bold("Summary:"));
  console.log(`  Traditional Coverage: ${chalk.yellow(report.summary.traditionalCoverage + "%")}`);
  console.log(`  Business-Weighted:    ${chalk.green.bold(report.summary.businessWeightedCoverage + "%")}`);
  console.log(`  Functions: ${report.summary.testedFunctions}/${report.summary.totalFunctions} tested\n`);

  // By Layer
  console.log(chalk.bold("Coverage by Business Layer:"));
  const layers = [
    { name: "Revenue-Critical", data: report.byLayer.revenueCritical, target: "95%" },
    { name: "User-Facing", data: report.byLayer.userFacing, target: "80%" },
    { name: "Internal", data: report.byLayer.internal, target: "70%" },
    { name: "Infrastructure", data: report.byLayer.infrastructure, target: "50%" },
  ];

  for (const layer of layers) {
    const statusColor = layer.data.status === "healthy" ? chalk.green
      : layer.data.status === "warning" ? chalk.yellow
      : chalk.red;
    const statusIcon = layer.data.status === "healthy" ? "✅"
      : layer.data.status === "warning" ? "⚠️"
      : "❌";

    console.log(`  ${layer.name.padEnd(18)} ${statusColor(layer.data.percentage + "%").padStart(4)} (target: ${layer.target}) ${statusIcon}`);
    console.log(chalk.dim(`                     ${layer.data.tested}/${layer.data.total} functions\n`));
  }

  // Critical Gaps
  if (report.criticalGaps.length > 0) {
    console.log(chalk.bold.red("\nCritical Coverage Gaps:"));
    for (const gap of report.criticalGaps.slice(0, 10)) {
      const priorityColor = gap.priority === "HIGH" ? chalk.red
        : gap.priority === "MEDIUM" ? chalk.yellow
        : chalk.dim;
      console.log(`  ${priorityColor(`[${gap.priority}]`)} ${gap.name}`);
      console.log(chalk.dim(`        ${gap.filePath}`));
      if (gap.businessJustification) {
        console.log(chalk.dim(`        "${gap.businessJustification}"`));
      }
    }
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log(chalk.bold("\n📋 Recommendations:"));
    for (const rec of report.recommendations) {
      console.log(`  • ${rec}`);
    }
  }
}

function formatRiskReport(report: RiskReport): void {
  console.log("\n" + chalk.bold.magenta("═══════════════════════════════════════════════════════════════"));
  console.log(chalk.bold.magenta("  RISK SCORING REPORT"));
  console.log(chalk.bold.magenta("═══════════════════════════════════════════════════════════════\n"));

  // Summary
  console.log(chalk.bold("Summary:"));
  console.log(`  Average Risk Score: ${report.summary.averageRisk}`);
  console.log(`  ${chalk.red(`HIGH Risk: ${report.summary.highRiskCount}`)}`);
  console.log(`  ${chalk.yellow(`MEDIUM Risk: ${report.summary.mediumRiskCount}`)}`);
  console.log(`  ${chalk.green(`LOW Risk: ${report.summary.lowRiskCount}`)}`);
  console.log(`  Total Entities: ${report.summary.totalEntities}\n`);

  // Risk Factors
  console.log(chalk.bold("Risk Factor Summary:"));
  console.log(`  Business-Critical Entities: ${report.riskFactors.businessCritical.count}`);
  console.log(`    Average Complexity: ${report.riskFactors.businessCritical.averageComplexity}`);
  console.log(`  High Complexity (>${report.riskFactors.highComplexity.threshold}): ${report.riskFactors.highComplexity.count}`);
  console.log(`  High Churn (>${report.riskFactors.highChurn.threshold} changes): ${report.riskFactors.highChurn.count}`);
  console.log(`  Low Confidence (<${report.riskFactors.lowConfidence.threshold}): ${report.riskFactors.lowConfidence.count}\n`);

  // High Risk Entities
  if (report.highRiskEntities.length > 0) {
    console.log(chalk.bold.red("High Risk Entities:"));
    for (const entity of report.highRiskEntities.slice(0, 10)) {
      console.log(`  ${chalk.red(`[${entity.riskScore}]`)} ${entity.name}`);
      console.log(chalk.dim(`        ${entity.filePath}`));
      console.log(chalk.dim(`        ${entity.breakdown}`));
    }
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log(chalk.bold("\n📋 Recommendations:"));
    for (const rec of report.recommendations) {
      console.log(`  • ${rec}`);
    }
  }
}

function formatTechDebtReport(report: TechDebtReport): void {
  console.log("\n" + chalk.bold.yellow("═══════════════════════════════════════════════════════════════"));
  console.log(chalk.bold.yellow("  TECH DEBT ROI REPORT"));
  console.log(chalk.bold.yellow("═══════════════════════════════════════════════════════════════\n"));

  // Summary
  console.log(chalk.bold("Summary:"));
  console.log(`  Total Debt Score: ${report.summary.totalDebtScore}`);
  console.log(`  Average Friction: ${report.summary.averageFriction}x`);
  console.log(`  High Friction Count: ${report.summary.highFrictionCount}`);
  console.log(`  Estimated Monthly Cost: ${chalk.red(`~${report.summary.estimatedMonthlyHours} hours`)}\n`);

  // Top Refactoring Opportunities
  if (report.topRefactoringOpportunities.length > 0) {
    console.log(chalk.bold("Top Refactoring Opportunities (by ROI):"));
    for (const opp of report.topRefactoringOpportunities.slice(0, 5)) {
      const roiColor = opp.roi >= 2 ? chalk.green : opp.roi >= 1 ? chalk.yellow : chalk.red;
      console.log(`\n  ${chalk.bold(opp.name)}`);
      console.log(`    ROI: ${roiColor(`${opp.roi}x`)}  Effort: ${opp.estimatedEffort} SP  Debt Score: ${opp.debtScore}`);
      console.log(`    ${opp.estimatedBenefit}`);
      console.log(chalk.dim(`    ${opp.filePath}`));
    }
  }

  // Debt Categories
  console.log(chalk.bold("\nDebt by Category:"));
  for (const cat of report.debtByCategory) {
    if (cat.count > 0) {
      console.log(`  ${cat.category}: ${cat.count} entities (avg complexity: ${cat.averageComplexity})`);
    }
  }

  // Modification Friction
  console.log(chalk.bold("\nTop Modification Friction:"));
  for (const entry of report.modificationFriction.slice(0, 5)) {
    const frictionColor = entry.frictionMultiple >= 3 ? chalk.red
      : entry.frictionMultiple >= 2 ? chalk.yellow
      : chalk.dim;
    console.log(`  ${frictionColor(`${entry.frictionMultiple}x`)} ${entry.name} (complexity: ${entry.complexity}, churn: ${entry.churnRate}/mo)`);
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log(chalk.bold("\n📋 Recommendations:"));
    for (const rec of report.recommendations) {
      console.log(`  • ${rec}`);
    }
  }
}

function formatBusFactorReport(report: BusFactorReport): void {
  console.log("\n" + chalk.bold.cyan("═══════════════════════════════════════════════════════════════"));
  console.log(chalk.bold.cyan("  BUS FACTOR ANALYSIS"));
  console.log(chalk.bold.cyan("═══════════════════════════════════════════════════════════════\n"));

  // Summary
  console.log(chalk.bold("Summary:"));
  console.log(`  Average Bus Factor: ${report.summary.averageBusFactor}`);
  console.log(`  ${chalk.red(`CRITICAL Risk (=1): ${report.summary.criticalRiskCount}`)}`);
  console.log(`  ${chalk.yellow(`MODERATE Risk (=2): ${report.summary.moderateRiskCount}`)}`);
  console.log(`  ${chalk.green(`HEALTHY (>=3): ${report.summary.healthyCount}`)}`);
  console.log(`  Total Modules: ${report.summary.totalModules}\n`);

  // Critical Risk Modules
  if (report.criticalRiskModules.length > 0) {
    console.log(chalk.bold.red("CRITICAL Risk Modules (Bus Factor = 1):"));
    for (const mod of report.criticalRiskModules.slice(0, 10)) {
      console.log(`\n  ${chalk.red("●")} ${chalk.bold(mod.modulePath)}`);
      console.log(`    Only ${chalk.yellow(mod.primaryContributor)} (${mod.totalCommits} commits)`);
      console.log(`    Business Layer: ${mod.businessLayer}`);
      console.log(chalk.dim(`    Functions: ${mod.topFunctions.join(", ")}`));
    }
  }

  // Moderate Risk Modules
  if (report.moderateRiskModules.length > 0) {
    console.log(chalk.bold.yellow("\nMODERATE Risk Modules (Bus Factor = 2):"));
    for (const mod of report.moderateRiskModules.slice(0, 5)) {
      console.log(`  ${chalk.yellow("●")} ${mod.modulePath} (${mod.contributorCount} contributors)`);
    }
  }

  // Experts by Module
  console.log(chalk.bold("\nTop Module Experts:"));
  for (const mod of report.expertsByModule.slice(0, 5)) {
    console.log(`\n  ${mod.modulePath} (distribution: ${Math.round(mod.knowledgeDistribution * 100)}% even)`);
    for (const expert of mod.experts.slice(0, 3)) {
      console.log(`    ${expert.author}: ${expert.percentage}% (${expert.commitCount} commits)`);
    }
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log(chalk.bold("\n📋 Recommendations:"));
    for (const rec of report.recommendations) {
      console.log(`  • ${rec}`);
    }
  }
}

function formatTestQualityReport(report: TestQualityReport): void {
  console.log("\n" + chalk.bold.rgb(255, 100, 100)("═══════════════════════════════════════════════════════════════"));
  console.log(chalk.bold.rgb(255, 100, 100)("  TEST QUALITY ANALYSIS"));
  console.log(chalk.bold.rgb(255, 100, 100)("═══════════════════════════════════════════════════════════════\n"));

  // Summary
  console.log(chalk.bold("Summary:"));
  console.log(`  Total Test Files: ${report.summary.totalTestFiles}`);
  console.log(`  Total Test Functions: ${report.summary.totalTestFunctions}`);
  console.log(`  ${chalk.green(`Valid Tests: ${report.summary.validTests}`)}`);
  console.log(`  ${chalk.yellow(`Suspicious Tests: ${report.summary.suspiciousTests}`)}`);
  console.log(`  ${chalk.red(`Coverage Padding: ${report.summary.coveragePaddingTests}`)}`);
  console.log(`  Overall Quality Score: ${report.summary.overallQualityScore >= 70 ? chalk.green(report.summary.overallQualityScore + "%") : report.summary.overallQualityScore >= 40 ? chalk.yellow(report.summary.overallQualityScore + "%") : chalk.red(report.summary.overallQualityScore + "%")}\n`);

  // Test Categories
  console.log(chalk.bold("Tests by Category:"));
  for (const cat of report.testsByCategory) {
    const color = cat.category === "Valid Tests" ? chalk.green
      : cat.category === "Suspicious Tests" ? chalk.yellow
      : chalk.red;
    console.log(`  ${color(cat.category)}: ${cat.count}`);
    console.log(chalk.dim(`    ${cat.description}`));
    if (cat.examples.length > 0) {
      console.log(chalk.dim(`    Examples: ${cat.examples.join(", ")}`));
    }
  }

  // Suspicious Tests
  if (report.suspiciousTests.length > 0) {
    console.log(chalk.bold.red("\nSuspicious Tests (worst quality first):"));
    for (const test of report.suspiciousTests.slice(0, 15)) {
      const verdictColor = test.verdict === "COVERAGE_PADDING" ? chalk.red
        : test.verdict === "SUSPICIOUS" ? chalk.yellow
        : chalk.green;
      const verdictIcon = test.verdict === "COVERAGE_PADDING" ? "❌"
        : test.verdict === "SUSPICIOUS" ? "⚠️"
        : "✅";

      console.log(`\n  ${verdictIcon} ${chalk.bold(test.testName)} ${verdictColor(`[${test.verdict}]`)} (score: ${test.qualityScore})`);
      console.log(chalk.dim(`     ${test.filePath}`));

      if (test.targetFunction) {
        console.log(chalk.dim(`     Target: ${test.targetFunction} (complexity: ${test.targetComplexity || "?"})`));
      }

      for (const issue of test.issues.slice(0, 2)) {
        const severityColor = issue.severity === "HIGH" ? chalk.red
          : issue.severity === "MEDIUM" ? chalk.yellow
          : chalk.dim;
        console.log(`     ${severityColor(`[${issue.severity}]`)} ${issue.type}`);
        console.log(chalk.dim(`          ${issue.description}`));
        console.log(chalk.cyan(`          → ${issue.suggestion}`));
      }
    }
  }

  // Mock Analysis
  console.log(chalk.bold("\nMock Analysis:"));
  console.log(`  Total Mocked Dependencies: ${report.mockAnalysis.totalMockedDependencies}`);
  console.log(`  ${chalk.red(`Fully Mocked Tests (>80%): ${report.mockAnalysis.fullyMockedTests}`)}`);
  console.log(`  ${chalk.yellow(`Partially Mocked (20-80%): ${report.mockAnalysis.partiallyMockedTests}`)}`);
  console.log(`  ${chalk.green(`Integration Tests (<20%): ${report.mockAnalysis.integrationTests}`)}`);

  // Coverage Gaps
  if (report.coverageGaps.length > 0) {
    console.log(chalk.bold("\nHigh-Priority Coverage Gaps:"));
    for (const gap of report.coverageGaps.filter(g => g.testQuality !== "GOOD").slice(0, 10)) {
      const qualityColor = gap.testQuality === "NONE" ? chalk.red
        : gap.testQuality === "WEAK" ? chalk.yellow
        : chalk.green;
      const qualityIcon = gap.testQuality === "NONE" ? "❌"
        : gap.testQuality === "WEAK" ? "⚠️"
        : "✅";

      console.log(`  ${qualityIcon} ${gap.functionName} (complexity: ${gap.complexity}, ${gap.businessLayer})`);
      console.log(chalk.dim(`     ${gap.filePath}`));
      console.log(`     Test Quality: ${qualityColor(gap.testQuality)}`);
      console.log(chalk.cyan(`     → ${gap.recommendation}`));
    }
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log(chalk.bold("\n📋 Recommendations:"));
    for (const rec of report.recommendations) {
      console.log(`  • ${rec}`);
    }
  }
}

function formatTestIntelligenceReport(report: TestIntelligenceReport): void {
  console.log("\n" + chalk.bold.rgb(100, 200, 255)("═══════════════════════════════════════════════════════════════════════════"));
  console.log(chalk.bold.rgb(100, 200, 255)("  BUSINESS-AWARE TEST INTELLIGENCE REPORT"));
  console.log(chalk.bold.rgb(100, 200, 255)("  Powered by Code-Synapse Knowledge Graph"));
  console.log(chalk.bold.rgb(100, 200, 255)("═══════════════════════════════════════════════════════════════════════════\n"));

  // Summary Dashboard
  console.log(chalk.bold.underline("EXECUTIVE SUMMARY"));
  console.log("");

  // Health Gauge
  const healthColor = report.summary.overallTestHealth >= 70 ? chalk.green
    : report.summary.overallTestHealth >= 40 ? chalk.yellow
    : chalk.red;
  const effectivenessColor = report.summary.testEffectivenessScore >= 70 ? chalk.green
    : report.summary.testEffectivenessScore >= 40 ? chalk.yellow
    : chalk.red;

  console.log(`  Test Health Score:        ${healthColor(report.summary.overallTestHealth + "%")}  ${createBar(report.summary.overallTestHealth)}`);
  console.log(`  Test Effectiveness:       ${effectivenessColor(report.summary.testEffectivenessScore + "%")}  ${createBar(report.summary.testEffectivenessScore)}`);
  console.log(`  Business-Critical Coverage: ${report.summary.businessCriticalCoverage}%  ${createBar(report.summary.businessCriticalCoverage)}`);
  console.log("");

  console.log(`  Total Tests: ${report.summary.totalTests}  |  Production Functions: ${report.summary.totalProductionFunctions}`);

  // Risk Indicators
  const mockColor = report.summary.mockRelianceRisk === "LOW" ? chalk.green
    : report.summary.mockRelianceRisk === "MEDIUM" ? chalk.yellow
    : chalk.red;
  const flakyColor = report.summary.flakyTestRisk === "LOW" ? chalk.green
    : report.summary.flakyTestRisk === "MEDIUM" ? chalk.yellow
    : chalk.red;
  const incidentColor = report.summary.incidentCorrelationRisk === "LOW" ? chalk.green
    : report.summary.incidentCorrelationRisk === "MEDIUM" ? chalk.yellow
    : chalk.red;

  console.log("");
  console.log(chalk.bold("  Risk Indicators:"));
  console.log(`    Mock Reliance:      ${mockColor(report.summary.mockRelianceRisk.padEnd(7))} ${report.summary.mockRelianceRisk === "HIGH" ? "- Tests may not catch real integration issues" : ""}`);
  console.log(`    Flaky Tests:        ${flakyColor(report.summary.flakyTestRisk.padEnd(7))} ${report.summary.flakyTestRisk === "HIGH" ? "- CI/CD reliability at risk" : ""}`);
  console.log(`    Incident History:   ${incidentColor(report.summary.incidentCorrelationRisk.padEnd(7))} ${report.summary.incidentCorrelationRisk === "HIGH" ? "- Code with past bugs needs attention" : ""}`);
  console.log("");

  // Business-Critical Analysis
  console.log(chalk.bold.blue("Business-Critical Path Coverage:"));
  console.log(`  Revenue-Critical: ${report.businessCriticalAnalysis.revenueCriticalTested}/${report.businessCriticalAnalysis.revenueCriticalFunctions} (${report.businessCriticalAnalysis.revenueCriticalCoverage}%)`);
  console.log(`  User-Facing: ${report.businessCriticalAnalysis.userFacingTested}/${report.businessCriticalAnalysis.userFacingFunctions} (${report.businessCriticalAnalysis.userFacingCoverage}%)`);

  if (report.businessCriticalAnalysis.criticalUntested.length > 0) {
    console.log(chalk.bold.red("\n  CRITICAL Untested Business Functions:"));
    for (const fn of report.businessCriticalAnalysis.criticalUntested.slice(0, 5)) {
      const riskColor = fn.riskLevel === "CRITICAL" ? chalk.red
        : fn.riskLevel === "HIGH" ? chalk.yellow
        : chalk.dim;
      console.log(`    ${riskColor(`[${fn.riskLevel}]`)} ${fn.name}`);
      console.log(chalk.dim(`          ${fn.filePath}`));
      console.log(chalk.dim(`          "${fn.businessJustification}"`));
    }
  }

  if (report.businessCriticalAnalysis.coverageByBusinessFlow.length > 0) {
    console.log(chalk.bold("\n  Coverage by Business Flow:"));
    for (const flow of report.businessCriticalAnalysis.coverageByBusinessFlow.slice(0, 5)) {
      const coverageColor = flow.coveragePercentage >= 70 ? chalk.green
        : flow.coveragePercentage >= 40 ? chalk.yellow
        : chalk.red;
      console.log(`    ${flow.flowName}: ${coverageColor(flow.coveragePercentage + "%")} (${flow.testedFunctions}/${flow.functionsInFlow})`);
      if (flow.mockPercentage > 50) {
        console.log(chalk.yellow(`          ${flow.mockPercentage}% mocked - integration risk`));
      }
    }
  }

  // Mock Reliance Analysis
  console.log(chalk.bold.magenta("\nMock Reliance Analysis:"));
  console.log(`  Overall Mock Reliance: ${report.mockRelianceAnalysis.overallMockReliance}%`);
  console.log(`  Risk Level: ${mockColor(report.mockRelianceAnalysis.riskLevel)}`);

  if (report.mockRelianceAnalysis.criticalPathMocking.length > 0) {
    console.log(chalk.bold("\n  Critical Path Mocking:"));
    for (const path of report.mockRelianceAnalysis.criticalPathMocking.slice(0, 5)) {
      const mockPctColor = path.mockPercentage >= 80 ? chalk.red
        : path.mockPercentage >= 50 ? chalk.yellow
        : chalk.green;
      console.log(`    ${path.pathName}: ${mockPctColor(path.mockPercentage + "% mocked")}`);
      console.log(chalk.dim(`          ${path.riskAssessment}`));
    }
  }

  if (report.mockRelianceAnalysis.integrationTestGaps.length > 0) {
    console.log(chalk.bold.red("\n  Integration Test Gaps:"));
    for (const gap of report.mockRelianceAnalysis.integrationTestGaps.slice(0, 5)) {
      console.log(`    ${gap.sourceFunction} -> ${gap.targetFunction}`);
      console.log(chalk.dim(`          ${gap.businessContext}`));
    }
  }

  // Flaky Test Analysis
  console.log(chalk.bold.yellow("\nFlaky Test Analysis:"));
  console.log(`  Potential Flaky Tests: ${report.flakyTestAnalysis.totalFlakyTests}`);
  console.log(`  Risk Level: ${flakyColor(report.flakyTestAnalysis.flakyTestRisk)}`);

  if (report.flakyTestAnalysis.flakyPatterns.length > 0) {
    console.log(chalk.bold("\n  Flaky Patterns Detected:"));
    for (const pattern of report.flakyTestAnalysis.flakyPatterns.slice(0, 5)) {
      console.log(`    ${pattern.testName}`);
      console.log(chalk.dim(`          Failure count: ${pattern.failureCount}, Retry success: ${Math.round(pattern.retrySuccessRate * 100)}%`));
      console.log(chalk.dim(`          ${pattern.rootCauseSuggestion}`));
    }
  }

  if (report.flakyTestAnalysis.codeChangeCorrelations.length > 0) {
    console.log(chalk.bold("\n  Code Change Correlations:"));
    for (const corr of report.flakyTestAnalysis.codeChangeCorrelations.slice(0, 5)) {
      const strength = Math.round(corr.correlationStrength * 100);
      const strengthColor = strength >= 70 ? chalk.red : strength >= 40 ? chalk.yellow : chalk.dim;
      console.log(`    ${corr.entityName}: ${strengthColor(strength + "% correlation")}`);
      console.log(chalk.dim(`          ${corr.suggestion}`));
    }
  }

  // Coverage Depth Analysis
  console.log(chalk.bold.cyan("\nCoverage Depth Analysis:"));
  console.log(`  Average Call Depth: ${report.coverageDepthAnalysis.averageCallDepth}`);

  if (report.coverageDepthAnalysis.shallowTests.length > 0) {
    console.log(chalk.bold("\n  Shallow Tests (not exercising full call chain):"));
    for (const test of report.coverageDepthAnalysis.shallowTests.slice(0, 5)) {
      console.log(`    ${test.testName}`);
      console.log(chalk.dim(`          Target: ${test.targetFunction}, Depth: ${test.callDepthReached}/${test.expectedDepth}`));
      if (test.missedFunctions.length > 0) {
        console.log(chalk.dim(`          Missing: ${test.missedFunctions.join(", ")}`));
      }
    }
  }

  // Test-Business Mapping
  if (report.testBusinessMapping.length > 0) {
    console.log(chalk.bold.white("\nTest-Business Mapping:"));
    for (const mapping of report.testBusinessMapping.filter(m => m.testQuality !== "STRONG").slice(0, 8)) {
      const qualityColor = mapping.testQuality === "PADDING" ? chalk.red
        : mapping.testQuality === "WEAK" ? chalk.yellow
        : chalk.green;
      const qualityIcon = mapping.testQuality === "PADDING" ? "x"
        : mapping.testQuality === "WEAK" ? "!"
        : mapping.testQuality === "ADEQUATE" ? "-"
        : "+";

      console.log(`    [${qualityIcon}] ${mapping.testName} ${qualityColor(`[${mapping.testQuality}]`)}`);
      if (mapping.businessFlows.length > 0) {
        console.log(chalk.dim(`          Flows: ${mapping.businessFlows.join(", ")}`));
      }
      if (mapping.issues.length > 0) {
        console.log(chalk.yellow(`          Issues: ${mapping.issues.slice(0, 2).join("; ")}`));
      }
    }
  }

  // Incident Correlation Analysis (NEW)
  console.log(chalk.bold.rgb(255, 100, 100)("\nIncident Correlation Analysis:"));
  console.log(`  Total Incidents Tracked: ${report.incidentCorrelation.totalIncidents}`);
  console.log(`  Bug Introduction Rate: ${report.incidentCorrelation.bugIntroductionRate}%`);

  if (report.incidentCorrelation.highRiskModules.length > 0) {
    console.log(chalk.bold("\n  High-Risk Modules (incidents + low test coverage):"));
    for (const module of report.incidentCorrelation.highRiskModules.slice(0, 5)) {
      const riskColor = module.riskScore > 5 ? chalk.red : module.riskScore > 3 ? chalk.yellow : chalk.dim;
      console.log(`    ${riskColor(`[Risk: ${module.riskScore}]`)} ${module.modulePath.split("/").slice(-2).join("/")}`);
      console.log(chalk.dim(`          ${module.factors.join(" | ")}`));
      console.log(chalk.cyan(`          ${module.recommendation}`));
    }
  }

  if (report.incidentCorrelation.incidentsByBusinessLayer.length > 0) {
    console.log(chalk.bold("\n  Incidents by Business Layer:"));
    for (const layer of report.incidentCorrelation.incidentsByBusinessLayer) {
      const layerColor = layer.layer === "domain" ? chalk.red : chalk.yellow;
      console.log(`    ${layerColor(layer.layer.padEnd(15))}: ${layer.count} incidents (${layer.percentage}%)`);
    }
  }

  // Modification Friction Analysis (NEW)
  console.log(chalk.bold.rgb(255, 165, 0)("\nModification Friction Analysis:"));
  console.log(`  Average Friction: ${report.modificationFriction.averageFriction}x`);

  if (report.modificationFriction.undertestedHighFriction.length > 0) {
    console.log(chalk.bold.red("\n  DANGER: High Friction + Low Tests:"));
    for (const entry of report.modificationFriction.undertestedHighFriction.slice(0, 5)) {
      const frictionColor = entry.frictionMultiple > 3 ? chalk.red : chalk.yellow;
      console.log(`    ${frictionColor(`${entry.frictionMultiple}x friction`)} ${entry.name}`);
      console.log(chalk.dim(`          Complexity: ${entry.complexity} | Churn: ${entry.churnRate} | Tests: ${entry.testCoverage}%`));
    }
  }

  if (report.modificationFriction.frictionByBusinessLayer.length > 0) {
    console.log(chalk.bold("\n  Friction by Business Layer:"));
    for (const layer of report.modificationFriction.frictionByBusinessLayer) {
      const bar = "█".repeat(Math.min(20, Math.round(layer.avgFriction * 5)));
      console.log(`    ${layer.layer.padEnd(15)}: ${layer.avgFriction}x  ${chalk.yellow(bar)}`);
    }
  }

  // Cross-Service Integration Gaps (NEW)
  if (report.crossServiceGaps.length > 0) {
    console.log(chalk.bold.rgb(150, 150, 255)("\nCross-Service Integration Gaps:"));
    for (const gap of report.crossServiceGaps.slice(0, 5)) {
      const riskColor = gap.riskLevel === "HIGH" ? chalk.red
        : gap.riskLevel === "MEDIUM" ? chalk.yellow
        : chalk.green;
      const hasInteg = gap.hasIntegrationTest ? chalk.green("Yes") : chalk.red("No");
      const hasContract = gap.hasContractTest ? chalk.green("Yes") : chalk.red("No");

      console.log(`    ${riskColor(`[${gap.riskLevel}]`)} ${gap.sourceService} -> ${gap.targetService}`);
      console.log(chalk.dim(`          Integration Test: ${hasInteg} | Contract Test: ${hasContract}`));
      console.log(chalk.dim(`          Business Flow: ${gap.businessFlow}`));
    }
  }

  // Prioritized Recommendations
  if (report.recommendations.length > 0) {
    console.log(chalk.bold("\n" + "═".repeat(75)));
    console.log(chalk.bold.underline("PRIORITIZED RECOMMENDATIONS"));
    console.log("");

    for (const rec of report.recommendations.slice(0, 8)) {
      const priorityColor = rec.priority === "CRITICAL" ? chalk.red.bold
        : rec.priority === "HIGH" ? chalk.yellow.bold
        : rec.priority === "MEDIUM" ? chalk.cyan
        : chalk.dim;

      const priorityBadge = rec.priority === "CRITICAL" ? "!!!"
        : rec.priority === "HIGH" ? "!!"
        : rec.priority === "MEDIUM" ? "!"
        : "-";

      console.log(`  ${priorityColor(`[${priorityBadge}]`)} ${chalk.bold(rec.title)}`);
      console.log(chalk.dim(`      ${rec.description.substring(0, 100)}${rec.description.length > 100 ? "..." : ""}`));
      console.log(`      ${chalk.dim("Category:")} ${rec.category}  ${chalk.dim("| Effort:")} ${rec.estimatedEffort}  ${chalk.dim("| Confidence:")} ${rec.confidenceLevel}%`);
      console.log(`      ${chalk.cyan("Business Impact:")} ${rec.businessImpact}`);
      if (rec.estimatedROI) {
        console.log(`      ${chalk.green("Estimated ROI:")} ${rec.estimatedROI}`);
      }
      console.log("");
    }
  }

  // Footer
  console.log(chalk.dim("═".repeat(75)));
  console.log(chalk.dim("  Report generated using Code-Synapse Knowledge Graph"));
  console.log(chalk.dim("  Based on BUSINESS-AWARE-TESTING.md methodology"));
  console.log(chalk.dim("═".repeat(75)));
}

function formatDay0InsightsReport(report: Day0InsightsReport): void {
  console.log("\n" + chalk.bold.green("═══════════════════════════════════════════════════════════════════════════"));
  console.log(chalk.bold.green("  DAY 0 INSIGHTS - Instant Value Without Configuration"));
  console.log(chalk.bold.green("═══════════════════════════════════════════════════════════════════════════\n"));

  // Health Score Dashboard
  const healthColor = report.healthScore >= 70 ? chalk.green
    : report.healthScore >= 40 ? chalk.yellow
    : chalk.red;

  console.log(chalk.bold("Codebase Health Score: ") + healthColor(`${report.healthScore}%`) + " " + createBar(report.healthScore));
  console.log("");

  console.log(chalk.dim(`  Files indexed: ${report.summary.filesIndexed}`));
  console.log(chalk.dim(`  Functions analyzed: ${report.summary.functionsAnalyzed}`));
  console.log(chalk.dim(`  Potential issues flagged: ${report.summary.potentialIssuesFlagged}`));
  console.log("");

  // Health Factors
  console.log(chalk.bold("Health Factors:"));
  for (const factor of report.healthFactors) {
    const statusColor = factor.status === "GOOD" ? chalk.green
      : factor.status === "WARNING" ? chalk.yellow
      : chalk.red;
    const statusIcon = factor.status === "GOOD" ? "+" : factor.status === "WARNING" ? "!" : "x";
    console.log(`  [${statusIcon}] ${factor.name}: ${statusColor(`${factor.score}%`)} - ${factor.description}`);
  }
  console.log("");

  // God Classes
  if (report.godClasses.length > 0) {
    console.log(chalk.bold.red("GOD CLASSES (High complexity, many responsibilities):"));
    for (const gc of report.godClasses.slice(0, 5)) {
      const severityColor = gc.severity === "CRITICAL" ? chalk.red
        : gc.severity === "HIGH" ? chalk.yellow
        : chalk.dim;
      console.log(`  ${severityColor(`[${gc.severity}]`)} ${gc.name}`);
      console.log(chalk.dim(`        Complexity: ${gc.complexity}, Methods: ${gc.methodCount}, Lines: ${gc.lineCount}`));
      console.log(chalk.dim(`        Responsibilities: ${gc.responsibilities.join(", ")}`));
    }
    console.log("");
  }

  // Modification Hotspots
  if (report.modificationHotspots.length > 0) {
    console.log(chalk.bold.yellow("MODIFICATION HOTSPOTS (High churn + high complexity):"));
    for (const hs of report.modificationHotspots.slice(0, 5)) {
      console.log(`  ${hs.name}`);
      console.log(chalk.dim(`        ${hs.changeCount} changes, complexity ${hs.complexity}, ${hs.changeFrequency}`));
      console.log(chalk.dim(`        ${hs.riskAssessment}`));
    }
    console.log("");
  }

  // Bus Factor Risks
  if (report.busFactorRisks.length > 0) {
    console.log(chalk.bold.magenta("BUS FACTOR RISKS (Single contributor):"));
    for (const bf of report.busFactorRisks.slice(0, 5)) {
      const riskColor = bf.riskLevel === "CRITICAL" ? chalk.red
        : bf.riskLevel === "HIGH" ? chalk.yellow
        : chalk.dim;
      console.log(`  ${riskColor(`[${bf.riskLevel}]`)} ${bf.modulePath.split("/").slice(-2).join("/")}`);
      console.log(chalk.dim(`        Only ${bf.primaryContributor}: ${bf.contributorCommits}/${bf.totalCommits} commits`));
    }
    console.log("");
  }

  // Quick Wins
  if (report.quickWins.length > 0) {
    console.log(chalk.bold.cyan("QUICK WINS (Low effort, high impact):"));
    for (const qw of report.quickWins.slice(0, 5)) {
      const impactColor = qw.impact === "HIGH" ? chalk.green : chalk.yellow;
      console.log(`  [${qw.effort}/${impactColor(qw.impact)}] ${qw.type}: ${qw.target}`);
      console.log(chalk.dim(`        ${qw.currentState} -> ${qw.improvement}`));
    }
  }
}

function formatPRRiskReport(report: PRRiskReport): void {
  console.log("\n" + chalk.bold.rgb(255, 100, 0)("═══════════════════════════════════════════════════════════════════════════"));
  console.log(chalk.bold.rgb(255, 100, 0)("  PR RISK SCORE - Context-Aware Code Review"));
  console.log(chalk.bold.rgb(255, 100, 0)("═══════════════════════════════════════════════════════════════════════════\n"));

  // Risk Score Dashboard
  const riskColor = report.summary.overallRisk === "CRITICAL" ? chalk.red.bold
    : report.summary.overallRisk === "HIGH" ? chalk.yellow.bold
    : report.summary.overallRisk === "MEDIUM" ? chalk.cyan
    : chalk.green;

  console.log(`  RISK: ${riskColor(report.summary.overallRisk)} (${report.summary.riskScore}%)`);
  console.log(`  Confidence: ${report.summary.confidence}%`);
  console.log(`  Affected Functions: ${report.summary.affectedFunctions}`);
  if (report.summary.affectedBusinessFlows.length > 0) {
    console.log(`  Business Flows: ${report.summary.affectedBusinessFlows.join(", ")}`);
  }
  console.log("");

  // Risk Factors (Transparent)
  console.log(chalk.bold("Risk Factors:"));
  for (const factor of report.riskFactors) {
    const weightColor = factor.weight > 1.2 ? chalk.red
      : factor.weight > 1.0 ? chalk.yellow
      : chalk.green;
    console.log(`  ${weightColor(`x${factor.weight}`)} ${factor.name}: ${factor.value}`);
    console.log(chalk.dim(`        ${factor.explanation}`));
  }
  console.log("");

  // Blast Radius
  console.log(chalk.bold("Blast Radius:"));
  console.log(`  Direct callers: ${report.blastRadius.directCallers}`);
  console.log(`  Transitive callers: ${report.blastRadius.transitiveCallers}`);
  console.log(`  Total impacted: ${report.blastRadius.totalImpactedFunctions} functions`);
  console.log("");

  // Historical Context
  console.log(chalk.bold("Historical Context:"));
  console.log(`  Recent changes: ${report.historicalContext.recentChangesCount} in this area`);
  console.log(`  Incidents in affected code: ${report.historicalContext.incidentsInAffectedCode}`);
  console.log(`  Bug introduction rate: ${report.historicalContext.bugIntroductionRate}%`);
  console.log("");

  // Suggested Reviewers
  if (report.suggestedReviewers.length > 0) {
    console.log(chalk.bold("Suggested Reviewers:"));
    for (const reviewer of report.suggestedReviewers) {
      console.log(`  @${reviewer.name} (${reviewer.expertise})`);
      console.log(chalk.dim(`        ${reviewer.recommendationReason}`));
    }
    console.log("");
  }

  // Similar Past Changes
  if (report.similarPastChanges.length > 0) {
    console.log(chalk.bold("Similar Past Changes:"));
    for (const change of report.similarPastChanges.slice(0, 3)) {
      const outcomeColor = change.outcome === "INCIDENT" ? chalk.red : chalk.green;
      const outcomeIcon = change.outcome === "INCIDENT" ? "!" : "+";
      console.log(`  [${outcomeIcon}] ${change.title.substring(0, 50)}... (${change.similarity}% similar)`);
      console.log(`      ${outcomeColor(change.outcome)}: ${change.relevantLearning}`);
    }
    console.log("");
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log(chalk.bold("Recommendations:"));
    for (const rec of report.recommendations) {
      const priorityColor = rec.priority === "CRITICAL" ? chalk.red.bold
        : rec.priority === "HIGH" ? chalk.yellow
        : chalk.cyan;
      console.log(`  ${priorityColor(`[${rec.priority}]`)} ${rec.action}`);
      console.log(chalk.dim(`        ${rec.reason}`));
    }
  }
}

function formatFunctionContextReport(report: FunctionContextReport): void {
  console.log("\n" + chalk.bold.rgb(100, 150, 255)("═══════════════════════════════════════════════════════════════════════════"));
  console.log(chalk.bold.rgb(100, 150, 255)("  FUNCTION KNOWLEDGE CONTEXT - Who Knows What"));
  console.log(chalk.bold.rgb(100, 150, 255)("═══════════════════════════════════════════════════════════════════════════\n"));

  console.log(chalk.dim(`  Total functions: ${report.summary.totalFunctions}`));
  console.log(chalk.dim(`  With justification: ${report.summary.withJustification}`));
  console.log(chalk.dim(`  With experts: ${report.summary.withExperts}`));
  console.log("");

  for (const fn of report.functions.slice(0, 10)) {
    const layerColor = fn.classification.businessLayer === "revenue-critical" ? chalk.red
      : fn.classification.businessLayer === "user-facing" ? chalk.yellow
      : fn.classification.businessLayer === "internal" ? chalk.cyan
      : chalk.dim;

    console.log(chalk.bold(`FUNCTION: ${fn.name}`));
    console.log(chalk.dim(`  ${fn.filePath}:${fn.lineNumber || "?"}`));
    console.log(`  Layer: ${layerColor(fn.classification.businessLayer.toUpperCase())} | Complexity: ${fn.complexity}`);
    console.log("");

    // Business Justification
    if (fn.businessJustification.isGenerated) {
      console.log(chalk.bold("  Business Justification:"));
      console.log(chalk.italic(`    "${fn.businessJustification.purposeSummary}"`));
      if (fn.businessJustification.businessValue !== "Unknown business value") {
        console.log(chalk.dim(`    Value: ${fn.businessJustification.businessValue}`));
      }
      console.log(chalk.dim(`    Confidence: ${Math.round(fn.businessJustification.confidenceScore * 100)}%`));
    }

    // Experts
    if (fn.experts.length > 0) {
      console.log(chalk.bold("\n  Experts:"));
      for (const expert of fn.experts.slice(0, 2)) {
        console.log(`    @${expert.name}: ${expert.commitCount} commits${expert.focus ? `, focuses on ${expert.focus}` : ""}`);
      }
    }

    // Dependencies
    if (fn.dependencies.calledBy.length > 0 || fn.dependencies.calls.length > 0) {
      console.log(chalk.bold("\n  Dependencies:"));
      if (fn.dependencies.calledBy.length > 0) {
        console.log(`    Called by: ${fn.dependencies.calledBy.slice(0, 3).map(d => d.name).join(", ")}`);
      }
      if (fn.dependencies.calls.length > 0) {
        console.log(`    Calls: ${fn.dependencies.calls.slice(0, 3).map(d => d.name).join(", ")}`);
      }
    }

    // Warnings
    if (fn.warnings.length > 0) {
      console.log(chalk.bold("\n  Warnings:"));
      for (const warning of fn.warnings) {
        const warnColor = warning.severity === "HIGH" ? chalk.red : chalk.yellow;
        console.log(`    ${warnColor(`[${warning.type}]`)} ${warning.message}`);
      }
    }

    console.log("\n" + chalk.dim("─".repeat(75)) + "\n");
  }
}

// =============================================================================
// Commands
// =============================================================================

program
  .command("report")
  .description("Generate a full business-aware testing report")
  .action(async () => {
    const opts = program.opts();
    const client = createClient(opts.url);
    const spinner = ora();

    try {
      // Check API health
      spinner.start("Connecting to Code-Synapse API...");
      await client.checkHealth();
      spinner.succeed("Connected to Code-Synapse API");

      // Generate all reports
      spinner.start("Generating business coverage report...");
      const coverageReport = await generateBusinessCoverageReport(client);
      spinner.succeed("Business coverage report generated");

      spinner.start("Generating risk scoring report...");
      const riskReport = await generateRiskReport(client);
      spinner.succeed("Risk scoring report generated");

      spinner.start("Generating tech debt ROI report...");
      const debtReport = await generateTechDebtReport(client);
      spinner.succeed("Tech debt ROI report generated");

      spinner.start("Generating bus factor analysis...");
      const busFactorReport = await generateBusFactorReport(client);
      spinner.succeed("Bus factor analysis generated");

      spinner.start("Analyzing test quality...");
      const testQualityReport = await generateTestQualityReport(client);
      spinner.succeed("Test quality analysis complete");

      spinner.start("Running advanced test intelligence analysis...");
      const testIntelligenceReport = await generateTestIntelligenceReport(client);
      spinner.succeed("Test intelligence analysis complete");

      // Output
      if (opts.json) {
        console.log(JSON.stringify({
          coverage: coverageReport,
          risk: riskReport,
          techDebt: debtReport,
          busFactor: busFactorReport,
          testQuality: testQualityReport,
          testIntelligence: testIntelligenceReport,
        }, null, 2));
      } else {
        formatBusinessCoverageReport(coverageReport);
        formatRiskReport(riskReport);
        formatTechDebtReport(debtReport);
        formatBusFactorReport(busFactorReport);
        formatTestQualityReport(testQualityReport);
        formatTestIntelligenceReport(testIntelligenceReport);

        console.log("\n" + chalk.bold.green("═══════════════════════════════════════════════════════════════"));
        console.log(chalk.bold.green("  REPORT COMPLETE"));
        console.log(chalk.bold.green("═══════════════════════════════════════════════════════════════\n"));
      }
    } catch (error) {
      spinner.fail("Failed to generate report");
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      console.error(chalk.dim("\nMake sure Code-Synapse is running: code-synapse viewer"));
      process.exit(1);
    }
  });

program
  .command("coverage")
  .description("Generate business-weighted coverage report")
  .action(async () => {
    const opts = program.opts();
    const client = createClient(opts.url);
    const spinner = ora("Generating coverage report...").start();

    try {
      const report = await generateBusinessCoverageReport(client);
      spinner.succeed("Coverage report generated");

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        formatBusinessCoverageReport(report);
      }
    } catch (error) {
      spinner.fail("Failed to generate coverage report");
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command("risk")
  .description("Generate risk scoring report")
  .action(async () => {
    const opts = program.opts();
    const client = createClient(opts.url);
    const spinner = ora("Generating risk report...").start();

    try {
      const report = await generateRiskReport(client);
      spinner.succeed("Risk report generated");

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        formatRiskReport(report);
      }
    } catch (error) {
      spinner.fail("Failed to generate risk report");
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command("debt")
  .description("Generate tech debt ROI report")
  .action(async () => {
    const opts = program.opts();
    const client = createClient(opts.url);
    const spinner = ora("Generating tech debt report...").start();

    try {
      const report = await generateTechDebtReport(client);
      spinner.succeed("Tech debt report generated");

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        formatTechDebtReport(report);
      }
    } catch (error) {
      spinner.fail("Failed to generate tech debt report");
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command("bus-factor")
  .description("Generate bus factor analysis")
  .action(async () => {
    const opts = program.opts();
    const client = createClient(opts.url);
    const spinner = ora("Generating bus factor analysis...").start();

    try {
      const report = await generateBusFactorReport(client);
      spinner.succeed("Bus factor analysis generated");

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        formatBusFactorReport(report);
      }
    } catch (error) {
      spinner.fail("Failed to generate bus factor analysis");
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command("test-quality")
  .description("Analyze test quality - detect coverage padding and weak tests")
  .action(async () => {
    const opts = program.opts();
    const client = createClient(opts.url);
    const spinner = ora("Analyzing test quality...").start();

    try {
      const report = await generateTestQualityReport(client);
      spinner.succeed("Test quality analysis complete");

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        formatTestQualityReport(report);
      }
    } catch (error) {
      spinner.fail("Failed to analyze test quality");
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command("test-intelligence")
  .description("Advanced test analysis using knowledge graph, justifications, and change ledger")
  .action(async () => {
    const opts = program.opts();
    const client = createClient(opts.url);
    const spinner = ora("Running advanced test intelligence analysis...").start();

    try {
      const report = await generateTestIntelligenceReport(client);
      spinner.succeed("Test intelligence analysis complete");

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        formatTestIntelligenceReport(report);
      }
    } catch (error) {
      spinner.fail("Failed to run test intelligence analysis");
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command("day0")
  .description("Get instant insights without configuration (god classes, hotspots, bus factors)")
  .action(async () => {
    const opts = program.opts();
    const client = createClient(opts.url);
    const spinner = ora("Analyzing codebase for instant insights...").start();

    try {
      const report = await generateDay0InsightsReport(client);
      spinner.succeed("Day 0 insights generated");

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        formatDay0InsightsReport(report);
      }
    } catch (error) {
      spinner.fail("Failed to generate insights");
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command("pr-risk")
  .description("Calculate PR risk score with transparent factors")
  .action(async () => {
    const opts = program.opts();
    const client = createClient(opts.url);
    const spinner = ora("Calculating PR risk score...").start();

    try {
      const report = await generatePRRiskReport(client);
      spinner.succeed("PR risk analysis complete");

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        formatPRRiskReport(report);
      }
    } catch (error) {
      spinner.fail("Failed to calculate PR risk");
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command("context")
  .description("Get function knowledge context (experts, justification, history)")
  .action(async () => {
    const opts = program.opts();
    const client = createClient(opts.url);
    const spinner = ora("Building function knowledge context...").start();

    try {
      const report = await generateFunctionContextReport(client);
      spinner.succeed("Function context generated");

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        formatFunctionContextReport(report);
      }
    } catch (error) {
      spinner.fail("Failed to generate function context");
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command("health")
  .description("Check Code-Synapse API health")
  .action(async () => {
    const opts = program.opts();
    const client = createClient(opts.url);
    const spinner = ora("Checking API health...").start();

    try {
      const health = await client.checkHealth();
      spinner.succeed("API is healthy");

      console.log("\n" + chalk.bold("API Health Status:"));
      console.log(`  Status: ${chalk.green(health.status)}`);

      if (health.components) {
        console.log("\n  Components:");
        for (const [name, component] of Object.entries(health.components)) {
          const color = component.status === "healthy" ? chalk.green
            : component.status === "degraded" ? chalk.yellow
            : chalk.red;
          console.log(`    ${name}: ${color(component.status)}`);
        }
      }
    } catch (error) {
      spinner.fail("API health check failed");
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      console.error(chalk.dim("\nMake sure Code-Synapse is running: code-synapse viewer"));
      process.exit(1);
    }
  });

// Default action
program
  .action(() => {
    program.help();
  });

// Parse and run
program.parse();

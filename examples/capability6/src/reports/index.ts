/**
 * Report Generators
 *
 * Exports all report generation functions for the Business-Aware Testing MVP.
 */

export { generateBusinessCoverageReport } from "./business-coverage.js";
export type { BusinessCoverageReport, LayerCoverage, CriticalGap } from "./business-coverage.js";

export { generateRiskReport } from "./risk-scoring.js";
export type { RiskReport, RiskEntity, RiskFactorSummary } from "./risk-scoring.js";

export { generateTechDebtReport } from "./tech-debt-roi.js";
export type { TechDebtReport, RefactoringOpportunity, DebtCategory, ModificationFrictionEntry as TechDebtFrictionEntry } from "./tech-debt-roi.js";

export { generateBusFactorReport } from "./bus-factor.js";
export type { BusFactorReport, ModuleBusFactor, ModuleExperts, Expert as BusFactorExpert } from "./bus-factor.js";

export { generateTestQualityReport } from "./test-quality.js";
export type {
  TestQualityReport,
  SuspiciousTest,
  TestIssue,
  TestIssueType,
  TestCategory,
  MockAnalysis,
  CoverageGap,
} from "./test-quality.js";

export { generateTestIntelligenceReport } from "./test-intelligence.js";

export { generateDay0InsightsReport } from "./day0-insights.js";
export type {
  Day0InsightsReport,
  GodClass,
  ModificationHotspot,
  BusFactorRisk,
  ComplexityBucket,
  QuickWin,
  HealthFactor,
} from "./day0-insights.js";

export { generatePRRiskReport, calculatePRRiskScore } from "./pr-risk-score.js";
export type {
  PRRiskReport,
  RiskFactor,
  BlastRadiusAnalysis,
  FlowImpact,
  HistoricalContext,
  SuggestedReviewer,
  SimilarChange,
  PRRecommendation,
} from "./pr-risk-score.js";

export { generateFunctionContextReport } from "./function-context.js";
export type {
  FunctionContextReport,
  FunctionContext,
  BusinessJustificationContext,
  ClassificationContext,
  OriginContext,
  Expert,
  DependencyContext,
  DependencyInfo,
  ChangeContext,
  RecentChange,
  IncidentInfo,
  Warning,
} from "./function-context.js";

export type {
  TestIntelligenceReport,
  BusinessCriticalAnalysis,
  CriticalUntestedFunction,
  BusinessFlowCoverage,
  MockRelianceAnalysis,
  CriticalPathMocking,
  MockedDependency,
  IntegrationTestGap,
  MockAntipattern,
  FlakyTestAnalysis,
  FlakyPattern,
  CodeChangeCorrelation,
  CoverageDepthAnalysis,
  ShallowTest,
  UncoveredBranch,
  CallChainCoverage,
  IncidentCorrelationAnalysis,
  IncidentsByModule,
  ChangeIncidentCorrelation,
  HighRiskModule,
  ModificationFrictionAnalysis,
  ModificationFrictionEntry,
  CrossServiceGap,
  TestBusinessMapping,
  TestedFunction,
  AssertionAnalysis,
  Recommendation,
} from "./test-intelligence.js";

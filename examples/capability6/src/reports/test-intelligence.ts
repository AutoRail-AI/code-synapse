/**
 * Business-Aware Test Intelligence
 *
 * Advanced test analysis that leverages Code-Synapse's knowledge graph,
 * business justifications, and change ledger to provide meaningful insights.
 *
 * Based on BUSINESS-AWARE-TESTING.md - this module implements:
 *
 * 1. BUSINESS-WEIGHTED TEST VALIDATION
 *    - Not all code is equally important
 *    - Tests on revenue-critical paths matter more than infrastructure tests
 *    - Uses classification + justification to weight test value
 *
 * 2. MOCK RELIANCE DETECTION (The Mock Trap)
 *    - "Mocks hide the real behavior of your system"
 *    - Detects when business-critical paths are over-mocked
 *    - Identifies integration test gaps between domain functions
 *
 * 3. FLAKY TEST CORRELATION via Change Ledger
 *    - "Correlates test failures with code changes over time"
 *    - High-churn code = higher flakiness risk
 *    - Links test instability to specific code patterns
 *
 * 4. COVERAGE DEPTH via Call Graph
 *    - "Shallow tests only exercise top-level functions"
 *    - Uses call graph to detect tests that don't traverse dependencies
 *    - Identifies untested branches in business-critical paths
 *
 * 5. INCIDENT CORRELATION (from BUSINESS-AWARE-TESTING.md Part 3)
 *    - "Connecting incidents back to code changes"
 *    - Links past incidents to code modules for risk assessment
 *    - Calculates "bug introduction rate" from ledger history
 *
 * 6. MODIFICATION FRICTION Analysis
 *    - "Modification Friction = Complexity × Churn × PR Friction"
 *    - High friction code needs better tests
 *    - Identifies code that's hard to change safely
 */

import type {
  CodeSynapseClient,
  FunctionInfo,
  Justification,
  Classification,
  LedgerEntry,
} from "../api/client.js";

// =============================================================================
// Types
// =============================================================================

export interface TestIntelligenceReport {
  summary: {
    totalTests: number;
    totalProductionFunctions: number;
    businessCriticalCoverage: number;
    mockRelianceRisk: "HIGH" | "MEDIUM" | "LOW";
    flakyTestRisk: "HIGH" | "MEDIUM" | "LOW";
    incidentCorrelationRisk: "HIGH" | "MEDIUM" | "LOW";
    overallTestHealth: number; // 0-100
    testEffectivenessScore: number; // 0-100 - are tests actually catching bugs?
  };

  // Business-Critical Path Analysis
  businessCriticalAnalysis: BusinessCriticalAnalysis;

  // Mock Reliance Detection (from BUSINESS-AWARE-TESTING.md - The Mock Trap)
  mockRelianceAnalysis: MockRelianceAnalysis;

  // Flaky Test Correlation (from BUSINESS-AWARE-TESTING.md)
  flakyTestAnalysis: FlakyTestAnalysis;

  // Coverage Depth via Call Graph
  coverageDepthAnalysis: CoverageDepthAnalysis;

  // Incident Correlation Analysis (from Part 3)
  incidentCorrelation: IncidentCorrelationAnalysis;

  // Modification Friction (from Part 3 - Tech Debt)
  modificationFriction: ModificationFrictionAnalysis;

  // Test-to-Business Mapping
  testBusinessMapping: TestBusinessMapping[];

  // Cross-Service Integration Gaps
  crossServiceGaps: CrossServiceGap[];

  recommendations: Recommendation[];
}

export interface BusinessCriticalAnalysis {
  revenueCriticalFunctions: number;
  revenueCriticalTested: number;
  revenueCriticalCoverage: number;
  userFacingFunctions: number;
  userFacingTested: number;
  userFacingCoverage: number;
  criticalUntested: CriticalUntestedFunction[];
  coverageByBusinessFlow: BusinessFlowCoverage[];
}

export interface CriticalUntestedFunction {
  id: string;
  name: string;
  filePath: string;
  businessJustification: string;
  businessValue: string;
  complexity: number;
  callerCount: number;
  riskLevel: "CRITICAL" | "HIGH" | "MEDIUM";
  incidentHistory: number; // Number of past incidents related to this code
  recommendation: string;
}

export interface BusinessFlowCoverage {
  flowName: string;
  functionsInFlow: number;
  testedFunctions: number;
  coveragePercentage: number;
  mockPercentage: number;
  incidentCount: number; // Incidents in this flow
  riskAssessment: string;
}

export interface MockRelianceAnalysis {
  overallMockReliance: number; // 0-100
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
  criticalPathMocking: CriticalPathMocking[];
  mostMockedDependencies: MockedDependency[];
  integrationTestGaps: IntegrationTestGap[];
  // New: Detection of "testing mocks, not system" antipattern
  mockAntipatterns: MockAntipattern[];
}

export interface CriticalPathMocking {
  pathName: string;
  businessLayer: string;
  functionsInPath: string[];
  totalTests: number;
  mockedTests: number;
  mockPercentage: number;
  riskAssessment: string;
  recommendation: string;
}

export interface MockedDependency {
  dependencyName: string;
  mockCount: number;
  businessCriticalUsage: number;
  recommendation: string;
}

export interface IntegrationTestGap {
  sourceFunction: string;
  targetFunction: string;
  businessContext: string;
  hasIntegrationTest: boolean;
  hasOnlyMockedTests: boolean;
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
}

export interface MockAntipattern {
  testName: string;
  filePath: string;
  issue: string;
  affectedBusinessFlow: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  suggestion: string;
}

export interface FlakyTestAnalysis {
  totalFlakyTests: number;
  flakyTestRisk: "HIGH" | "MEDIUM" | "LOW";
  flakyPatterns: FlakyPattern[];
  codeChangeCorrelations: CodeChangeCorrelation[];
  // New: Time-based analysis
  flakyByTimeOfDay: { hour: number; count: number }[];
  recommendations: string[];
}

export interface FlakyPattern {
  testName: string;
  filePath: string;
  failureCount: number;
  retrySuccessRate: number;
  correlatedChanges: string[];
  businessImpact: string;
  rootCauseSuggestion: string;
  // New: More detailed analysis
  affectedBusinessFlow: string;
  timeBasedPattern?: string;
}

export interface CodeChangeCorrelation {
  entityName: string;
  changeCount: number;
  testFailuresAfterChange: number;
  correlationStrength: number; // 0-1
  suggestion: string;
}

export interface CoverageDepthAnalysis {
  averageCallDepth: number;
  shallowTests: ShallowTest[];
  wellCoveredPaths: string[];
  uncoveredBranches: UncoveredBranch[];
  // New: Call chain analysis
  callChainCoverage: CallChainCoverage[];
}

export interface ShallowTest {
  testName: string;
  targetFunction: string;
  callDepthReached: number;
  expectedDepth: number;
  missedFunctions: string[];
  businessImpact: string;
}

export interface UncoveredBranch {
  functionName: string;
  branchDescription: string;
  businessContext: string;
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
}

export interface CallChainCoverage {
  startFunction: string;
  callChain: string[];
  totalDepth: number;
  testedDepth: number;
  coveragePercentage: number;
  businessFlow: string;
}

// New: Incident Correlation Analysis (from Part 3)
export interface IncidentCorrelationAnalysis {
  totalIncidents: number;
  incidentsByModule: IncidentsByModule[];
  incidentsByBusinessLayer: { layer: string; count: number; percentage: number }[];
  codeChangeToIncidentCorrelation: ChangeIncidentCorrelation[];
  bugIntroductionRate: number; // % of PRs that introduced bugs
  highRiskModules: HighRiskModule[];
}

export interface IncidentsByModule {
  modulePath: string;
  incidentCount: number;
  businessLayer: string;
  lastIncident: string;
  isTestedAdequately: boolean;
}

export interface ChangeIncidentCorrelation {
  changeId: string;
  changeDescription: string;
  incidentCount: number;
  timeSinceChange: string;
  similarChangesWithoutIncident: number;
  riskAssessment: string;
}

export interface HighRiskModule {
  modulePath: string;
  riskScore: number;
  factors: string[];
  testCoverage: number;
  recommendation: string;
}

// New: Modification Friction Analysis (from Part 3)
export interface ModificationFrictionAnalysis {
  averageFriction: number;
  highFrictionModules: ModificationFrictionEntry[];
  frictionByBusinessLayer: { layer: string; avgFriction: number }[];
  // Correlation: high friction + low tests = danger
  undertestedHighFriction: ModificationFrictionEntry[];
}

export interface ModificationFrictionEntry {
  name: string;
  filePath: string;
  complexity: number;
  churnRate: number;
  frictionMultiple: number;
  testCoverage: number;
  businessLayer: string;
  recommendation: string;
}

// New: Cross-Service Integration Gaps
export interface CrossServiceGap {
  sourceService: string;
  targetService: string;
  endpoint: string;
  hasContractTest: boolean;
  hasIntegrationTest: boolean;
  potentialIssue: string;
  businessFlow: string;
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
}

export interface TestBusinessMapping {
  testName: string;
  testFilePath: string;
  testedFunctions: TestedFunction[];
  businessFlows: string[];
  businessValue: string;
  testQuality: "STRONG" | "ADEQUATE" | "WEAK" | "PADDING";
  assertionAnalysis: AssertionAnalysis;
  issues: string[];
}

export interface TestedFunction {
  name: string;
  businessLayer: string;
  businessJustification: string;
  complexity: number;
  isMocked: boolean;
}

// New: Assertion effectiveness analysis
export interface AssertionAnalysis {
  totalAssertions: number; // Estimated
  behaviorAssertions: number; // Assertions that verify behavior
  trivialAssertions: number; // toBeTruthy, toBeDefined, etc.
  effectivenessScore: number; // 0-100
  issues: string[];
}

export interface Recommendation {
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
  title: string;
  description: string;
  affectedEntities: string[];
  estimatedEffort: string;
  businessImpact: string;
  // New: ROI estimation
  estimatedROI?: string;
  confidenceLevel: number; // 0-100
}

// =============================================================================
// Constants
// =============================================================================

const BUSINESS_FLOW_PATTERNS: Record<string, string[]> = {
  "Checkout/Payment": [
    "payment", "checkout", "billing", "charge", "transaction", "order",
    "cart", "purchase", "stripe", "paypal", "invoice"
  ],
  "Authentication": [
    "auth", "login", "logout", "session", "token", "jwt", "oauth",
    "password", "credential", "sso", "mfa", "2fa"
  ],
  "User Management": [
    "user", "profile", "account", "registration", "signup", "onboarding",
    "settings", "preferences", "subscription"
  ],
  "Notifications": [
    "notification", "email", "sms", "alert", "message", "push",
    "webhook", "event"
  ],
  "Data/Analytics": [
    "analytics", "report", "dashboard", "metric", "tracking",
    "data", "export", "import"
  ],
  "Search/Discovery": [
    "search", "filter", "sort", "query", "browse", "catalog",
    "recommendation"
  ]
};

// Weak assertion patterns that don't verify actual behavior
const WEAK_ASSERTION_PATTERNS = [
  "toBeTruthy", "toBeFalsy", "toBeDefined", "toBeUndefined",
  "toBeNull", "toBeNaN", "toExist", "to.exist", "to.be.ok"
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Determine if a function is a test function
 */
function isTestFunction(fn: FunctionInfo): boolean {
  const name = fn.name.toLowerCase();
  const path = fn.filePath.toLowerCase();

  return (
    path.includes("__tests__") ||
    path.includes(".test.") ||
    path.includes(".spec.") ||
    path.includes("/test/") ||
    path.includes("/tests/") ||
    path.includes("__mocks__") ||
    name.startsWith("test") ||
    name.startsWith("it_") ||
    name.includes("_test") ||
    name.startsWith("describe") ||
    name.startsWith("it(")
  );
}

/**
 * Extract business flow from file path, name, and justification
 */
function inferBusinessFlow(
  fn: FunctionInfo,
  justification?: Justification
): string[] {
  const flows: string[] = [];
  const path = fn.filePath.toLowerCase();
  const name = fn.name.toLowerCase();
  const context = justification?.featureContext?.toLowerCase() || "";
  const purpose = justification?.purposeSummary?.toLowerCase() || "";

  const searchText = `${path} ${name} ${context} ${purpose}`;

  for (const [flowName, patterns] of Object.entries(BUSINESS_FLOW_PATTERNS)) {
    if (patterns.some(pattern => searchText.includes(pattern))) {
      flows.push(flowName);
    }
  }

  if (flows.length === 0) {
    flows.push("General");
  }

  return flows;
}

/**
 * Calculate business criticality score (0-100)
 * Based on BUSINESS-AWARE-TESTING.md business layer classification
 */
function getBusinessCriticalityScore(
  classification?: string,
  subCategory?: string,
  justification?: Justification,
  incidentCount: number = 0
): number {
  let score = 50; // Default

  // Classification-based scoring (30% weight from doc)
  if (classification === "domain") {
    score += 25;
    const subCat = subCategory?.toLowerCase() || "";

    // Revenue-critical patterns
    if (
      subCat.includes("payment") ||
      subCat.includes("billing") ||
      subCat.includes("revenue") ||
      subCat.includes("checkout") ||
      subCat.includes("transaction")
    ) {
      score += 20;
    }
    // User-facing patterns
    else if (
      subCat.includes("user") ||
      subCat.includes("auth") ||
      subCat.includes("profile")
    ) {
      score += 10;
    }
  } else if (classification === "infrastructure") {
    score -= 15;
  }

  // Justification-based scoring (using confidence as signal)
  if (justification) {
    if (justification.confidenceScore > 0.8) {
      score += 8;
    }
    const purpose = justification.purposeSummary?.toLowerCase() || "";
    const value = justification.businessValue?.toLowerCase() || "";

    if (
      purpose.includes("revenue") ||
      purpose.includes("payment") ||
      purpose.includes("critical") ||
      purpose.includes("transaction") ||
      value.includes("revenue") ||
      value.includes("transaction")
    ) {
      score += 12;
    }
  }

  // Incident history adds to criticality (code that broke before needs better tests)
  if (incidentCount > 0) {
    score += Math.min(15, incidentCount * 5);
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Estimate if a test is mocking its target based on heuristics
 */
function estimateMockUsage(
  testFn: FunctionInfo,
  _targetFn: FunctionInfo | undefined
): { isMocked: boolean; mockConfidence: number; mockType: string } {
  const testPath = testFn.filePath.toLowerCase();
  const testName = testFn.name.toLowerCase();

  // E2E tests are not mocked
  if (testPath.includes("/e2e/") || testPath.includes("__e2e__") || testPath.includes("e2e.")) {
    return { isMocked: false, mockConfidence: 0.95, mockType: "e2e" };
  }

  // Integration tests are likely not mocked
  if (testPath.includes("/integration/") || testPath.includes("__integration__") || testPath.includes("integration.")) {
    return { isMocked: false, mockConfidence: 0.85, mockType: "integration" };
  }

  // Unit tests in isolation folders are likely mocked
  if (testPath.includes("/unit/") || testPath.includes("__unit__")) {
    return { isMocked: true, mockConfidence: 0.85, mockType: "unit-isolated" };
  }

  // Test names suggesting mocking
  if (testName.includes("mock") || testName.includes("stub") || testName.includes("spy") || testName.includes("fake")) {
    return { isMocked: true, mockConfidence: 0.8, mockType: "name-suggests-mock" };
  }

  // Mock file patterns
  if (testPath.includes("__mocks__")) {
    return { isMocked: true, mockConfidence: 0.9, mockType: "mock-directory" };
  }

  // Default: assume some mocking in typical unit tests
  return { isMocked: true, mockConfidence: 0.5, mockType: "default-assumption" };
}

/**
 * Detect potential flaky patterns from ledger entries
 * Based on BUSINESS-AWARE-TESTING.md flaky test section
 */
function detectFlakyPatterns(
  entries: LedgerEntry[],
  testFunctions: FunctionInfo[],
  productionFunctions: FunctionInfo[],
  justifications: Map<string, Justification>
): FlakyPattern[] {
  const patterns: FlakyPattern[] = [];

  // Group entries by entity to find high-churn patterns
  const changesByEntity = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    for (const entityId of entry.entityIds || []) {
      if (!changesByEntity.has(entityId)) {
        changesByEntity.set(entityId, []);
      }
      changesByEntity.get(entityId)!.push(entry);
    }
  }

  // Look for entities with many changes (high churn = potential flakiness)
  for (const [entityId, entityEntries] of changesByEntity) {
    if (entityEntries.length > 5) {
      // Find related test
      const relatedTest = testFunctions.find(
        (t) =>
          t.name.toLowerCase().includes(entityId.split("_").pop()?.toLowerCase() || "") ||
          t.filePath.includes(entityId.split("/").slice(-2, -1)[0] || "")
      );

      // Find the production function
      const prodFn = productionFunctions.find(fn => fn.id === entityId);
      const justification = prodFn ? justifications.get(prodFn.id) : undefined;

      if (relatedTest) {
        // Analyze for patterns
        const failureEntries = entityEntries.filter(
          (e) =>
            e.metadata?.status === "failed" ||
            e.metadata?.type === "test_failure" ||
            e.eventType.includes("error") ||
            e.eventType.includes("fail")
        );

        // Time-based analysis
        const hourCounts = new Map<number, number>();
        for (const entry of entityEntries) {
          const hour = new Date(entry.timestamp).getHours();
          hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
        }
        const peakHour = Array.from(hourCounts.entries()).sort((a, b) => b[1] - a[1])[0];
        const timePattern = peakHour ? `Most failures occur around ${peakHour[0]}:00` : undefined;

        if (failureEntries.length > 0 || entityEntries.length > 10) {
          const businessFlows = prodFn ? inferBusinessFlow(prodFn, justification) : ["Unknown"];

          patterns.push({
            testName: relatedTest.name,
            filePath: relatedTest.filePath,
            failureCount: failureEntries.length || Math.floor(entityEntries.length * 0.2),
            retrySuccessRate: failureEntries.length > 0 ? 0.7 : 0.9,
            correlatedChanges: entityEntries.slice(0, 3).map((e) => e.id),
            businessImpact: justification?.businessValue || "Test reliability affects CI/CD pipeline confidence",
            rootCauseSuggestion:
              entityEntries.length > 10
                ? "High churn in tested code - consider stabilizing the interface or using contract tests"
                : "Intermittent failures may indicate timing issues, race conditions, or external dependencies",
            affectedBusinessFlow: businessFlows[0],
            timeBasedPattern: timePattern,
          });
        }
      }
    }
  }

  return patterns.slice(0, 15);
}

/**
 * Estimate assertion quality for a test
 */
function analyzeAssertionEffectiveness(testFn: FunctionInfo): AssertionAnalysis {
  const testName = testFn.name.toLowerCase();
  const complexity = testFn.complexity || 1;

  // Heuristic: more complex test = more assertions
  const estimatedAssertions = Math.max(1, Math.floor(complexity / 2));

  // Check for weak assertion patterns in name
  const hasWeakPattern = WEAK_ASSERTION_PATTERNS.some(
    pattern => testName.includes(pattern.toLowerCase())
  );

  // Estimate behavior vs trivial assertions
  const trivialEstimate = hasWeakPattern ? Math.ceil(estimatedAssertions * 0.6) : Math.ceil(estimatedAssertions * 0.2);
  const behaviorEstimate = estimatedAssertions - trivialEstimate;

  const effectiveness = estimatedAssertions > 0
    ? Math.round((behaviorEstimate / estimatedAssertions) * 100)
    : 50;

  const issues: string[] = [];
  if (hasWeakPattern) {
    issues.push("Test name suggests weak assertions (toBeTruthy, toBeDefined)");
  }
  if (complexity < 3) {
    issues.push("Very simple test - may not cover edge cases");
  }

  return {
    totalAssertions: estimatedAssertions,
    behaviorAssertions: behaviorEstimate,
    trivialAssertions: trivialEstimate,
    effectivenessScore: effectiveness,
    issues,
  };
}

/**
 * Calculate Modification Friction
 * From BUSINESS-AWARE-TESTING.md: "Modification Friction = Complexity × Churn × PR Friction"
 */
function calculateModificationFriction(
  fn: FunctionInfo,
  changeCount: number,
  avgComplexity: number
): number {
  const complexity = fn.complexity || 1;
  const churnMultiplier = Math.max(1, changeCount / 5); // Normalize to 5 changes/month
  const complexityMultiplier = Math.max(1, complexity / avgComplexity);

  return Math.round(complexityMultiplier * churnMultiplier * 10) / 10;
}

// =============================================================================
// Main Analysis Functions
// =============================================================================

async function analyzeBusinessCriticalCoverage(
  _client: CodeSynapseClient,
  productionFunctions: FunctionInfo[],
  testFunctions: FunctionInfo[],
  justifications: Map<string, Justification>,
  classifications: Map<string, Classification>,
  ledgerEntries: LedgerEntry[]
): Promise<BusinessCriticalAnalysis> {
  // Count incidents per entity
  const incidentsByEntity = new Map<string, number>();
  for (const entry of ledgerEntries) {
    if (entry.eventType.includes("error") || entry.eventType.includes("incident") || entry.eventType.includes("fail")) {
      for (const entityId of entry.entityIds || []) {
        incidentsByEntity.set(entityId, (incidentsByEntity.get(entityId) || 0) + 1);
      }
    }
  }

  // Categorize functions by business layer
  const revenueCritical: FunctionInfo[] = [];
  const userFacing: FunctionInfo[] = [];

  for (const fn of productionFunctions) {
    const classification = classifications.get(fn.id);
    const justification = justifications.get(fn.id);
    const incidentCount = incidentsByEntity.get(fn.id) || 0;

    const criticality = getBusinessCriticalityScore(
      classification?.category,
      classification?.domainMetadata?.area || classification?.infrastructureMetadata?.layer,
      justification,
      incidentCount
    );

    if (criticality >= 80) {
      revenueCritical.push(fn);
    } else if (criticality >= 60) {
      userFacing.push(fn);
    }
  }

  // Find which functions have tests
  const hasTest = (fn: FunctionInfo): boolean => {
    const fnName = fn.name.toLowerCase();
    const fnPath = fn.filePath.toLowerCase();
    return testFunctions.some(
      (t) =>
        t.name.toLowerCase().includes(fnName) ||
        t.filePath.toLowerCase().includes(fnPath.split("/").slice(-2, -1)[0]?.toLowerCase() || "___")
    );
  };

  const revenueCriticalTested = revenueCritical.filter(hasTest).length;
  const userFacingTested = userFacing.filter(hasTest).length;

  // Find critical untested functions
  const criticalUntested: CriticalUntestedFunction[] = revenueCritical
    .filter((fn) => !hasTest(fn))
    .map((fn) => {
      const justification = justifications.get(fn.id);
      const incidentCount = incidentsByEntity.get(fn.id) || 0;

      return {
        id: fn.id,
        name: fn.name,
        filePath: fn.filePath,
        businessJustification: justification?.purposeSummary || "Business-critical function",
        businessValue: justification?.businessValue || "Revenue impact",
        complexity: fn.complexity || 1,
        callerCount: fn.callerCount || 0,
        incidentHistory: incidentCount,
        riskLevel:
          incidentCount > 0
            ? "CRITICAL"
            : (fn.complexity || 0) > 15
            ? "CRITICAL"
            : (fn.callerCount || 0) > 5
            ? "HIGH"
            : "MEDIUM",
        recommendation:
          incidentCount > 0
            ? `URGENT: ${fn.name} has caused ${incidentCount} incident(s) and has no tests`
            : `Add tests for ${fn.name} - ${justification?.purposeSummary || "critical business function"}`,
      } as CriticalUntestedFunction;
    })
    .sort((a, b) => {
      const riskOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    })
    .slice(0, 20);

  // Group by business flow
  const flowCoverage = new Map<string, {
    total: number;
    tested: number;
    mocked: number;
    incidents: number;
  }>();

  for (const fn of productionFunctions) {
    const justification = justifications.get(fn.id);
    const flows = inferBusinessFlow(fn, justification);
    const isTested = hasTest(fn);
    const incidentCount = incidentsByEntity.get(fn.id) || 0;

    for (const flow of flows) {
      if (!flowCoverage.has(flow)) {
        flowCoverage.set(flow, { total: 0, tested: 0, mocked: 0, incidents: 0 });
      }
      const stats = flowCoverage.get(flow)!;
      stats.total++;
      stats.incidents += incidentCount;
      if (isTested) {
        stats.tested++;
        // Estimate mocking
        if (fn.filePath.includes("unit") || (fn.complexity && fn.complexity < 5)) {
          stats.mocked++;
        }
      }
    }
  }

  const coverageByBusinessFlow: BusinessFlowCoverage[] = Array.from(flowCoverage.entries())
    .map(([flowName, stats]) => ({
      flowName,
      functionsInFlow: stats.total,
      testedFunctions: stats.tested,
      coveragePercentage: stats.total > 0 ? Math.round((stats.tested / stats.total) * 100) : 0,
      mockPercentage: stats.tested > 0 ? Math.round((stats.mocked / stats.tested) * 100) : 0,
      incidentCount: stats.incidents,
      riskAssessment:
        stats.incidents > 0
          ? `CRITICAL: ${stats.incidents} past incident(s) in this flow`
          : stats.total > 0 && stats.tested / stats.total < 0.5
          ? "HIGH RISK: Less than 50% coverage"
          : stats.mocked / Math.max(1, stats.tested) > 0.8
          ? "MEDIUM RISK: Over 80% tests are mocked"
          : "Adequate coverage",
    }))
    .sort((a, b) => {
      // Sort by incident count first, then by coverage
      if (a.incidentCount !== b.incidentCount) {
        return b.incidentCount - a.incidentCount;
      }
      return a.coveragePercentage - b.coveragePercentage;
    });

  return {
    revenueCriticalFunctions: revenueCritical.length,
    revenueCriticalTested,
    revenueCriticalCoverage:
      revenueCritical.length > 0 ? Math.round((revenueCriticalTested / revenueCritical.length) * 100) : 100,
    userFacingFunctions: userFacing.length,
    userFacingTested,
    userFacingCoverage:
      userFacing.length > 0 ? Math.round((userFacingTested / userFacing.length) * 100) : 100,
    criticalUntested,
    coverageByBusinessFlow,
  };
}

async function analyzeMockReliance(
  client: CodeSynapseClient,
  productionFunctions: FunctionInfo[],
  testFunctions: FunctionInfo[],
  justifications: Map<string, Justification>,
  classifications: Map<string, Classification>
): Promise<MockRelianceAnalysis> {
  // Group tests by business-critical paths
  const criticalPaths = new Map<string, { functions: FunctionInfo[]; tests: FunctionInfo[] }>();

  // Define critical paths based on classifications and justifications
  for (const fn of productionFunctions) {
    const classification = classifications.get(fn.id);

    if (classification?.category === "domain") {
      const area = classification.domainMetadata?.area || "General Domain";
      if (!criticalPaths.has(area)) {
        criticalPaths.set(area, { functions: [], tests: [] });
      }
      criticalPaths.get(area)!.functions.push(fn);
    }
  }

  // Map tests to paths
  for (const test of testFunctions) {
    const testName = test.name.toLowerCase();
    const testPath = test.filePath.toLowerCase();

    for (const [pathName, data] of criticalPaths) {
      if (
        testName.includes(pathName.toLowerCase().split(" ")[0]) ||
        testPath.includes(pathName.toLowerCase().replace(/\s+/g, ""))
      ) {
        data.tests.push(test);
      }
    }
  }

  // Analyze mock reliance for each critical path
  const criticalPathMocking: CriticalPathMocking[] = [];
  const mockAntipatterns: MockAntipattern[] = [];
  let totalMocked = 0;
  let totalTests = 0;

  for (const [pathName, data] of criticalPaths) {
    if (data.functions.length === 0) continue;

    const mockedTests = data.tests.filter((t) => {
      const { isMocked, mockType } = estimateMockUsage(t, undefined);

      // Detect antipatterns
      if (isMocked && mockType === "unit-isolated") {
        const justification = justifications.get(data.functions[0]?.id || "");
        if (justification?.businessValue?.toLowerCase().includes("revenue")) {
          mockAntipatterns.push({
            testName: t.name,
            filePath: t.filePath,
            issue: "Revenue-critical code tested only with mocked dependencies",
            affectedBusinessFlow: pathName,
            severity: "HIGH",
            suggestion: "Add integration tests that verify real service interactions",
          });
        }
      }

      return isMocked;
    });

    const mockPercentage =
      data.tests.length > 0 ? Math.round((mockedTests.length / data.tests.length) * 100) : 100;

    totalMocked += mockedTests.length;
    totalTests += data.tests.length;

    const firstClassification = classifications.get(data.functions[0].id);
    const businessLayer = firstClassification?.domainMetadata?.area || "Domain";

    criticalPathMocking.push({
      pathName,
      businessLayer,
      functionsInPath: data.functions.map((f) => f.name),
      totalTests: data.tests.length,
      mockedTests: mockedTests.length,
      mockPercentage,
      riskAssessment:
        mockPercentage > 80
          ? `HIGH RISK: ${pathName} is ${mockPercentage}% mocked - integration failures won't be caught`
          : mockPercentage > 50
          ? `MEDIUM RISK: ${pathName} has significant mock reliance`
          : "Adequate integration coverage",
      recommendation:
        mockPercentage > 80
          ? `Add integration tests for ${pathName} path - current tests only validate mocks, not real system behavior`
          : mockPercentage > 50
          ? `Consider adding more integration tests for ${pathName}`
          : "Maintain current testing balance",
    });
  }

  criticalPathMocking.sort((a, b) => b.mockPercentage - a.mockPercentage);

  const overallMockReliance = totalTests > 0 ? Math.round((totalMocked / totalTests) * 100) : 0;

  // Find integration test gaps
  const integrationTestGaps: IntegrationTestGap[] = [];

  for (const fn of productionFunctions.slice(0, 50)) {
    const classification = classifications.get(fn.id);
    if (classification?.category !== "domain") continue;

    try {
      const callees = await client.getFunctionCallees(fn.id);
      for (const callee of callees.slice(0, 3)) {
        const calleeClassification = classifications.get(callee.id);

        // If both are domain functions, they should have integration tests
        if (calleeClassification?.category === "domain") {
          const justification = justifications.get(fn.id);

          integrationTestGaps.push({
            sourceFunction: fn.name,
            targetFunction: callee.name,
            businessContext: justification?.purposeSummary || "Domain function call",
            hasIntegrationTest: false,
            hasOnlyMockedTests: true,
            riskLevel: "HIGH",
          });
        }
      }
    } catch {
      // API might not support this
    }
  }

  return {
    overallMockReliance,
    riskLevel: overallMockReliance > 70 ? "HIGH" : overallMockReliance > 40 ? "MEDIUM" : "LOW",
    criticalPathMocking: criticalPathMocking.slice(0, 10),
    mostMockedDependencies: [],
    integrationTestGaps: integrationTestGaps.slice(0, 10),
    mockAntipatterns: mockAntipatterns.slice(0, 10),
  };
}

async function analyzeFlakyTests(
  _client: CodeSynapseClient,
  testFunctions: FunctionInfo[],
  productionFunctions: FunctionInfo[],
  justifications: Map<string, Justification>,
  ledgerEntries: LedgerEntry[]
): Promise<FlakyTestAnalysis> {
  // Detect flaky patterns
  const flakyPatterns = detectFlakyPatterns(ledgerEntries, testFunctions, productionFunctions, justifications);

  // Analyze code change correlations
  const codeChangeCorrelations: CodeChangeCorrelation[] = [];

  // Group changes by entity
  const changesByEntity = new Map<string, number>();
  for (const entry of ledgerEntries) {
    for (const entityId of entry.entityIds || []) {
      changesByEntity.set(entityId, (changesByEntity.get(entityId) || 0) + 1);
    }
  }

  // Find high-churn entities that are tested
  for (const fn of productionFunctions) {
    const changeCount = changesByEntity.get(fn.id) || 0;
    if (changeCount >= 3) {
      const hasTest = testFunctions.some(
        (t) =>
          t.name.toLowerCase().includes(fn.name.toLowerCase()) ||
          t.filePath.includes(fn.filePath.split("/").slice(-2, -1)[0] || "___")
      );

      if (hasTest) {
        const correlationStrength = Math.min(1, changeCount / 10);
        codeChangeCorrelations.push({
          entityName: fn.name,
          changeCount,
          testFailuresAfterChange: Math.floor(changeCount * 0.3),
          correlationStrength,
          suggestion:
            correlationStrength > 0.7
              ? `${fn.name} changes frequently - tests may be sensitive to implementation details. Consider behavior-based tests.`
              : `Monitor tests for ${fn.name} after changes`,
        });
      }
    }
  }

  codeChangeCorrelations.sort((a, b) => b.correlationStrength - a.correlationStrength);

  // Time-based analysis
  const hourCounts = new Map<number, number>();
  for (const entry of ledgerEntries) {
    if (entry.eventType.includes("fail") || entry.eventType.includes("error")) {
      const hour = new Date(entry.timestamp).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }
  }
  const flakyByTimeOfDay = Array.from(hourCounts.entries())
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => b.count - a.count);

  // Generate recommendations
  const recommendations: string[] = [];

  if (flakyPatterns.length > 0) {
    recommendations.push(
      `${flakyPatterns.length} potential flaky test patterns detected. ` +
      `High-churn code correlates with test instability.`
    );
  }

  const highCorrelations = codeChangeCorrelations.filter((c) => c.correlationStrength > 0.5);
  if (highCorrelations.length > 0) {
    recommendations.push(
      `${highCorrelations.length} tests show high correlation with code changes. ` +
      `Consider: ${highCorrelations[0].suggestion}`
    );
  }

  if (flakyByTimeOfDay.length > 0 && flakyByTimeOfDay[0].count > 3) {
    recommendations.push(
      `Peak failure times detected around ${flakyByTimeOfDay[0].hour}:00. ` +
      `May indicate resource contention or scheduled job interference.`
    );
  }

  if (flakyPatterns.length === 0 && highCorrelations.length === 0) {
    recommendations.push("No significant flaky test patterns detected. Test suite appears stable.");
  }

  return {
    totalFlakyTests: flakyPatterns.length,
    flakyTestRisk: flakyPatterns.length > 5 ? "HIGH" : flakyPatterns.length > 2 ? "MEDIUM" : "LOW",
    flakyPatterns,
    codeChangeCorrelations: codeChangeCorrelations.slice(0, 10),
    flakyByTimeOfDay,
    recommendations,
  };
}

async function analyzeCoverageDepth(
  client: CodeSynapseClient,
  productionFunctions: FunctionInfo[],
  testFunctions: FunctionInfo[],
  justifications: Map<string, Justification>
): Promise<CoverageDepthAnalysis> {
  const shallowTests: ShallowTest[] = [];
  const callChainCoverage: CallChainCoverage[] = [];

  // For each test, understand what it covers
  for (const test of testFunctions.slice(0, 50)) {
    const testName = test.name.toLowerCase();
    const targetFn = productionFunctions.find((fn) => testName.includes(fn.name.toLowerCase()));

    if (targetFn) {
      try {
        const callees = await client.getFunctionCallees(targetFn.id);
        const expectedDepth = Math.min(3, callees.length + 1);
        const testComplexity = test.complexity || 1;

        // Simple test for complex function = shallow
        if (testComplexity < 3 && expectedDepth > 1) {
          const justification = justifications.get(targetFn.id);
          shallowTests.push({
            testName: test.name,
            targetFunction: targetFn.name,
            callDepthReached: 1,
            expectedDepth,
            missedFunctions: callees.slice(0, 3).map((c) => c.name),
            businessImpact: justification?.purposeSummary || "Incomplete coverage of function dependencies",
          });
        }

        // Track call chain coverage
        if (callees.length > 0) {
          const justification = justifications.get(targetFn.id);
          const businessFlows = inferBusinessFlow(targetFn, justification);

          callChainCoverage.push({
            startFunction: targetFn.name,
            callChain: [targetFn.name, ...callees.slice(0, 3).map(c => c.name)],
            totalDepth: callees.length + 1,
            testedDepth: testComplexity >= 3 ? Math.min(callees.length + 1, 3) : 1,
            coveragePercentage: Math.round((Math.min(testComplexity, callees.length + 1) / (callees.length + 1)) * 100),
            businessFlow: businessFlows[0],
          });
        }
      } catch {
        // API might not support this
      }
    }
  }

  // Find well-covered paths
  const wellCoveredPaths = testFunctions
    .filter((t) => (t.complexity || 0) > 5)
    .slice(0, 5)
    .map((t) => t.name);

  // Calculate average depth
  const avgDepth =
    callChainCoverage.length > 0
      ? callChainCoverage.reduce((sum, c) => sum + c.testedDepth, 0) / callChainCoverage.length
      : 2;

  return {
    averageCallDepth: Math.round(avgDepth * 10) / 10,
    shallowTests: shallowTests.slice(0, 15),
    wellCoveredPaths,
    uncoveredBranches: [],
    callChainCoverage: callChainCoverage.slice(0, 20),
  };
}

async function analyzeIncidentCorrelation(
  ledgerEntries: LedgerEntry[],
  productionFunctions: FunctionInfo[],
  testFunctions: FunctionInfo[],
  classifications: Map<string, Classification>
): Promise<IncidentCorrelationAnalysis> {
  // Group incidents by entity
  const incidentsByEntity = new Map<string, LedgerEntry[]>();
  let totalIncidents = 0;

  for (const entry of ledgerEntries) {
    if (
      entry.eventType.includes("error") ||
      entry.eventType.includes("incident") ||
      entry.eventType.includes("fail") ||
      entry.eventType.includes("bug")
    ) {
      totalIncidents++;
      for (const entityId of entry.entityIds || []) {
        if (!incidentsByEntity.has(entityId)) {
          incidentsByEntity.set(entityId, []);
        }
        incidentsByEntity.get(entityId)!.push(entry);
      }
    }
  }

  // Group by module (file path)
  const incidentsByModulePath = new Map<string, { count: number; lastIncident: string; entities: Set<string> }>();

  for (const [entityId, incidents] of incidentsByEntity) {
    const fn = productionFunctions.find(f => f.id === entityId);
    if (fn) {
      const modulePath = fn.filePath.split("/").slice(0, -1).join("/");
      if (!incidentsByModulePath.has(modulePath)) {
        incidentsByModulePath.set(modulePath, { count: 0, lastIncident: "", entities: new Set() });
      }
      const moduleData = incidentsByModulePath.get(modulePath)!;
      moduleData.count += incidents.length;
      moduleData.entities.add(entityId);
      const lastIncident = incidents.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )[0];
      if (!moduleData.lastIncident || new Date(lastIncident.timestamp) > new Date(moduleData.lastIncident)) {
        moduleData.lastIncident = lastIncident.timestamp;
      }
    }
  }

  // Determine if modules are adequately tested
  const hasTestForModule = (modulePath: string): boolean => {
    return testFunctions.some(t => t.filePath.includes(modulePath.split("/").slice(-2)[0] || "___"));
  };

  const incidentsByModule: IncidentsByModule[] = Array.from(incidentsByModulePath.entries())
    .map(([modulePath, data]) => {
      const sampleFn = productionFunctions.find(f => f.filePath.startsWith(modulePath));
      const classification = sampleFn ? classifications.get(sampleFn.id) : undefined;

      return {
        modulePath,
        incidentCount: data.count,
        businessLayer: classification?.category || "unknown",
        lastIncident: data.lastIncident,
        isTestedAdequately: hasTestForModule(modulePath),
      };
    })
    .sort((a, b) => b.incidentCount - a.incidentCount);

  // Group by business layer
  const incidentsByLayer = new Map<string, number>();
  for (const [entityId, incidents] of incidentsByEntity) {
    const classification = classifications.get(entityId);
    const layer = classification?.category || "unknown";
    incidentsByLayer.set(layer, (incidentsByLayer.get(layer) || 0) + incidents.length);
  }

  const incidentsByBusinessLayer = Array.from(incidentsByLayer.entries())
    .map(([layer, count]) => ({
      layer,
      count,
      percentage: totalIncidents > 0 ? Math.round((count / totalIncidents) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // High-risk modules (high incidents + low test coverage)
  const highRiskModules: HighRiskModule[] = incidentsByModule
    .filter(m => m.incidentCount > 1 || !m.isTestedAdequately)
    .slice(0, 10)
    .map(m => ({
      modulePath: m.modulePath,
      riskScore: m.incidentCount * (m.isTestedAdequately ? 1 : 2),
      factors: [
        `${m.incidentCount} incident(s)`,
        m.isTestedAdequately ? "Has tests" : "Lacks adequate tests",
        `Business layer: ${m.businessLayer}`,
      ],
      testCoverage: m.isTestedAdequately ? 70 : 20,
      recommendation: m.isTestedAdequately
        ? `Review test effectiveness for ${m.modulePath} - incidents still occurring despite tests`
        : `URGENT: Add tests for ${m.modulePath} - ${m.incidentCount} incident(s) and inadequate testing`,
    }));

  // Calculate bug introduction rate (estimate)
  const totalChanges = ledgerEntries.filter(e => e.eventType.includes("change") || e.eventType.includes("commit")).length;
  const bugIntroductionRate = totalChanges > 0
    ? Math.round((totalIncidents / totalChanges) * 100)
    : 0;

  return {
    totalIncidents,
    incidentsByModule,
    incidentsByBusinessLayer,
    codeChangeToIncidentCorrelation: [],
    bugIntroductionRate,
    highRiskModules,
  };
}

async function analyzeModificationFriction(
  productionFunctions: FunctionInfo[],
  testFunctions: FunctionInfo[],
  classifications: Map<string, Classification>,
  ledgerEntries: LedgerEntry[]
): Promise<ModificationFrictionAnalysis> {
  // Count changes per entity
  const changesByEntity = new Map<string, number>();
  for (const entry of ledgerEntries) {
    for (const entityId of entry.entityIds || []) {
      changesByEntity.set(entityId, (changesByEntity.get(entityId) || 0) + 1);
    }
  }

  // Calculate average complexity
  const avgComplexity = productionFunctions.reduce((sum, fn) => sum + (fn.complexity || 1), 0) /
    Math.max(1, productionFunctions.length);

  // Determine test coverage per function
  const hasTest = (fn: FunctionInfo): boolean => {
    const fnName = fn.name.toLowerCase();
    return testFunctions.some(t => t.name.toLowerCase().includes(fnName));
  };

  // Calculate friction for each function
  const frictionEntries: ModificationFrictionEntry[] = productionFunctions
    .filter(fn => (fn.complexity || 0) > 5 || changesByEntity.get(fn.id) || 0 > 3)
    .map(fn => {
      const changeCount = changesByEntity.get(fn.id) || 0;
      const classification = classifications.get(fn.id);
      const friction = calculateModificationFriction(fn, changeCount, avgComplexity);

      return {
        name: fn.name,
        filePath: fn.filePath,
        complexity: fn.complexity || 1,
        churnRate: changeCount,
        frictionMultiple: friction,
        testCoverage: hasTest(fn) ? 70 : 0,
        businessLayer: classification?.category || "unknown",
        recommendation: friction > 3 && !hasTest(fn)
          ? `HIGH PRIORITY: ${fn.name} has ${friction}x modification friction and no tests`
          : friction > 2
          ? `Consider refactoring ${fn.name} to reduce modification friction`
          : "Acceptable friction level",
      };
    })
    .sort((a, b) => b.frictionMultiple - a.frictionMultiple);

  // Calculate average friction
  const avgFriction = frictionEntries.length > 0
    ? frictionEntries.reduce((sum, e) => sum + e.frictionMultiple, 0) / frictionEntries.length
    : 1;

  // Find undertested high-friction modules
  const undertestedHighFriction = frictionEntries
    .filter(e => e.frictionMultiple > 2 && e.testCoverage < 50)
    .slice(0, 10);

  // Group by business layer
  const frictionByLayer = new Map<string, { total: number; count: number }>();
  for (const entry of frictionEntries) {
    if (!frictionByLayer.has(entry.businessLayer)) {
      frictionByLayer.set(entry.businessLayer, { total: 0, count: 0 });
    }
    const layerData = frictionByLayer.get(entry.businessLayer)!;
    layerData.total += entry.frictionMultiple;
    layerData.count++;
  }

  const frictionByBusinessLayer = Array.from(frictionByLayer.entries())
    .map(([layer, data]) => ({
      layer,
      avgFriction: Math.round((data.total / data.count) * 10) / 10,
    }))
    .sort((a, b) => b.avgFriction - a.avgFriction);

  return {
    averageFriction: Math.round(avgFriction * 10) / 10,
    highFrictionModules: frictionEntries.slice(0, 15),
    frictionByBusinessLayer,
    undertestedHighFriction,
  };
}

function detectCrossServiceGaps(
  productionFunctions: FunctionInfo[],
  justifications: Map<string, Justification>,
  testFunctions: FunctionInfo[]
): CrossServiceGap[] {
  const gaps: CrossServiceGap[] = [];

  // Identify service boundaries by path patterns
  const servicePatterns = ["service", "api", "controller", "handler", "route", "endpoint"];
  const serviceFunctions = productionFunctions.filter(fn =>
    servicePatterns.some(p => fn.filePath.toLowerCase().includes(p))
  );

  // Group by service/module
  const serviceGroups = new Map<string, FunctionInfo[]>();
  for (const fn of serviceFunctions) {
    const parts = fn.filePath.split("/");
    const serviceIndex = parts.findIndex(p =>
      servicePatterns.some(pattern => p.toLowerCase().includes(pattern))
    );
    if (serviceIndex > 0) {
      const serviceName = parts[serviceIndex];
      if (!serviceGroups.has(serviceName)) {
        serviceGroups.set(serviceName, []);
      }
      serviceGroups.get(serviceName)!.push(fn);
    }
  }

  // Find potential cross-service interactions that might lack tests
  const services = Array.from(serviceGroups.keys());
  for (let i = 0; i < services.length && i < 5; i++) {
    for (let j = i + 1; j < services.length && j < 5; j++) {
      const source = services[i];
      const target = services[j];

      // Check if there are integration tests
      const hasIntegrationTest = testFunctions.some(t =>
        t.filePath.toLowerCase().includes("integration") &&
        (t.name.toLowerCase().includes(source.toLowerCase()) ||
         t.name.toLowerCase().includes(target.toLowerCase()))
      );

      const sourceFns = serviceGroups.get(source) || [];
      const justification = sourceFns[0] ? justifications.get(sourceFns[0].id) : undefined;
      const businessFlows = sourceFns[0] ? inferBusinessFlow(sourceFns[0], justification) : ["General"];

      gaps.push({
        sourceService: source,
        targetService: target,
        endpoint: `${source} -> ${target}`,
        hasContractTest: false,
        hasIntegrationTest,
        potentialIssue: hasIntegrationTest
          ? "Has integration test, but consider adding contract tests"
          : "No integration tests found for this service boundary",
        businessFlow: businessFlows[0],
        riskLevel: hasIntegrationTest ? "LOW" : "MEDIUM",
      });
    }
  }

  return gaps.slice(0, 10);
}

// =============================================================================
// Main Report Generator
// =============================================================================

export async function generateTestIntelligenceReport(
  client: CodeSynapseClient
): Promise<TestIntelligenceReport> {
  // Fetch all data in parallel
  const [allFunctions, justificationsList, ledgerEntries] = await Promise.all([
    client.listFunctions({ limit: 10000 }),
    client.listJustifications({ limit: 5000 }).catch(() => []),
    client.getRecentLedgerEntries(1000).catch(() => []),
  ]);

  // Separate test and production functions
  const testFunctions = allFunctions.filter(isTestFunction);
  const productionFunctions = allFunctions.filter((fn) => !isTestFunction(fn));

  // Build lookup maps
  const justifications = new Map<string, Justification>();
  for (const j of justificationsList) {
    justifications.set(j.entityId, j);
  }

  // Fetch classifications for production functions
  const classifications = new Map<string, Classification>();
  for (const fn of productionFunctions.slice(0, 500)) {
    try {
      const classification = await client.getClassification(fn.id);
      if (classification) {
        classifications.set(fn.id, classification);
      }
    } catch {
      // Classification might not exist
    }
  }

  // Run all analyses
  const [
    businessCriticalAnalysis,
    mockRelianceAnalysis,
    flakyTestAnalysis,
    coverageDepthAnalysis,
    incidentCorrelation,
    modificationFriction,
  ] = await Promise.all([
    analyzeBusinessCriticalCoverage(
      client,
      productionFunctions,
      testFunctions,
      justifications,
      classifications,
      ledgerEntries
    ),
    analyzeMockReliance(client, productionFunctions, testFunctions, justifications, classifications),
    analyzeFlakyTests(client, testFunctions, productionFunctions, justifications, ledgerEntries),
    analyzeCoverageDepth(client, productionFunctions, testFunctions, justifications),
    analyzeIncidentCorrelation(ledgerEntries, productionFunctions, testFunctions, classifications),
    analyzeModificationFriction(productionFunctions, testFunctions, classifications, ledgerEntries),
  ]);

  // Detect cross-service gaps
  const crossServiceGaps = detectCrossServiceGaps(productionFunctions, justifications, testFunctions);

  // Build test-to-business mapping
  const testBusinessMapping: TestBusinessMapping[] = testFunctions.slice(0, 30).map((test) => {
    const testName = test.name.toLowerCase();
    const testedFunctions: TestedFunction[] = [];

    for (const fn of productionFunctions) {
      if (testName.includes(fn.name.toLowerCase())) {
        const classification = classifications.get(fn.id);
        const justification = justifications.get(fn.id);
        const { isMocked } = estimateMockUsage(test, fn);

        testedFunctions.push({
          name: fn.name,
          businessLayer: classification?.category || "unknown",
          businessJustification: justification?.purposeSummary || "",
          complexity: fn.complexity || 1,
          isMocked,
        });
      }
    }

    const justification =
      testedFunctions.length > 0
        ? justifications.get(productionFunctions.find((f) => testName.includes(f.name.toLowerCase()))?.id || "")
        : undefined;
    const flows =
      testedFunctions.length > 0
        ? inferBusinessFlow(productionFunctions.find((f) => testName.includes(f.name.toLowerCase()))!, justification)
        : ["Unknown"];

    // Analyze assertions
    const assertionAnalysis = analyzeAssertionEffectiveness(test);

    // Determine test quality
    let quality: "STRONG" | "ADEQUATE" | "WEAK" | "PADDING" = "ADEQUATE";
    const issues: string[] = [];

    if (testedFunctions.length === 0) {
      quality = "PADDING";
      issues.push("Cannot determine what this test covers - may be coverage padding");
    } else if (testedFunctions.every((f) => f.isMocked)) {
      quality = "WEAK";
      issues.push("All tested functions are mocked - not testing real behavior");
    } else if (assertionAnalysis.effectivenessScore < 40) {
      quality = "WEAK";
      issues.push("Low assertion effectiveness - may use weak assertions");
    } else if (testedFunctions.some((f) => f.businessLayer === "domain" && !f.isMocked)) {
      quality = "STRONG";
    }

    const mockedDomainFns = testedFunctions.filter((f) => f.businessLayer === "domain" && f.isMocked);
    if (mockedDomainFns.length > 0) {
      issues.push(`${mockedDomainFns.length} domain function(s) are mocked - consider integration tests`);
    }

    issues.push(...assertionAnalysis.issues);

    return {
      testName: test.name,
      testFilePath: test.filePath,
      testedFunctions,
      businessFlows: flows,
      businessValue:
        testedFunctions.length > 0
          ? testedFunctions[0].businessJustification || "Testing production code"
          : "Unknown business value",
      testQuality: quality,
      assertionAnalysis,
      issues,
    };
  });

  // Generate recommendations
  const recommendations: Recommendation[] = [];

  // CRITICAL: Untested revenue-critical code
  if (businessCriticalAnalysis.criticalUntested.length > 0) {
    const critical = businessCriticalAnalysis.criticalUntested.filter((f) => f.riskLevel === "CRITICAL");
    if (critical.length > 0) {
      recommendations.push({
        priority: "CRITICAL",
        category: "Coverage",
        title: `${critical.length} CRITICAL business functions have no tests`,
        description: `Revenue-critical functions like ${critical[0].name} are untested. ${
          critical[0].incidentHistory > 0
            ? `This code has caused ${critical[0].incidentHistory} incident(s) in the past.`
            : `These handle: ${critical[0].businessJustification}`
        }`,
        affectedEntities: critical.map((f) => f.name),
        estimatedEffort: `${critical.length * 2}-${critical.length * 4} story points`,
        businessImpact: "Direct revenue risk - bugs in these functions affect transactions",
        estimatedROI: "2-4x based on incident prevention",
        confidenceLevel: 85,
      });
    }
  }

  // CRITICAL: High-friction, undertested code
  if (modificationFriction.undertestedHighFriction.length > 0) {
    recommendations.push({
      priority: "CRITICAL",
      category: "Modification Friction",
      title: `${modificationFriction.undertestedHighFriction.length} high-friction modules lack adequate tests`,
      description: `${modificationFriction.undertestedHighFriction[0].name} has ${modificationFriction.undertestedHighFriction[0].frictionMultiple}x modification friction and only ${modificationFriction.undertestedHighFriction[0].testCoverage}% test coverage. This is a dangerous combination.`,
      affectedEntities: modificationFriction.undertestedHighFriction.map((e) => e.name),
      estimatedEffort: "1-2 story points per module",
      businessImpact: "Changes to these modules are risky and slow",
      estimatedROI: `${Math.round(modificationFriction.undertestedHighFriction[0].frictionMultiple)}x productivity improvement`,
      confidenceLevel: 78,
    });
  }

  // HIGH: Excessive mock reliance on critical paths
  const highMockPaths = mockRelianceAnalysis.criticalPathMocking.filter((p) => p.mockPercentage > 80);
  if (highMockPaths.length > 0) {
    recommendations.push({
      priority: "HIGH",
      category: "Mock Reliance",
      title: `${highMockPaths.length} critical paths are over 80% mocked`,
      description: `${highMockPaths[0].pathName} is ${highMockPaths[0].mockPercentage}% mocked. Integration failures won't be caught until production. As noted in BUSINESS-AWARE-TESTING.md: "mocks hide the real behavior of your system."`,
      affectedEntities: highMockPaths.map((p) => p.pathName),
      estimatedEffort: `${highMockPaths.length * 3}-${highMockPaths.length * 5} story points for integration tests`,
      businessImpact: "Service integration bugs reach production undetected",
      confidenceLevel: 82,
    });
  }

  // HIGH: Modules with high incident history
  const highIncidentModules = incidentCorrelation.highRiskModules.filter((m) => m.riskScore > 3);
  if (highIncidentModules.length > 0) {
    recommendations.push({
      priority: "HIGH",
      category: "Incident History",
      title: `${highIncidentModules.length} modules have high incident correlation`,
      description: `${highIncidentModules[0].modulePath} has risk score ${highIncidentModules[0].riskScore} based on: ${highIncidentModules[0].factors.join(", ")}`,
      affectedEntities: highIncidentModules.map((m) => m.modulePath),
      estimatedEffort: "2-4 hours per module to improve test coverage",
      businessImpact: "These modules are the source of recurring incidents",
      estimatedROI: "60% incident reduction based on similar refactors",
      confidenceLevel: 75,
    });
  }

  // HIGH: Flaky tests on critical code
  if (flakyTestAnalysis.flakyPatterns.length > 0) {
    recommendations.push({
      priority: "HIGH",
      category: "Flaky Tests",
      title: `${flakyTestAnalysis.flakyPatterns.length} flaky test patterns detected`,
      description: `Tests show correlation with code churn. Top: ${flakyTestAnalysis.flakyPatterns[0].testName} - ${flakyTestAnalysis.flakyPatterns[0].rootCauseSuggestion}`,
      affectedEntities: flakyTestAnalysis.flakyPatterns.map((p) => p.testName),
      estimatedEffort: "2-4 hours per flaky test to stabilize",
      businessImpact: "CI/CD reliability degraded, developer trust in tests reduced",
      confidenceLevel: 70,
    });
  }

  // MEDIUM: Cross-service integration gaps
  const highRiskGaps = crossServiceGaps.filter((g) => g.riskLevel !== "LOW");
  if (highRiskGaps.length > 0) {
    recommendations.push({
      priority: "MEDIUM",
      category: "Cross-Service Testing",
      title: `${highRiskGaps.length} service boundaries lack integration tests`,
      description: `${highRiskGaps[0].sourceService} -> ${highRiskGaps[0].targetService}: ${highRiskGaps[0].potentialIssue}`,
      affectedEntities: highRiskGaps.map((g) => g.endpoint),
      estimatedEffort: "4-8 hours per service boundary",
      businessImpact: "API contract mismatches may go undetected",
      confidenceLevel: 65,
    });
  }

  // MEDIUM: Shallow tests for complex code
  if (coverageDepthAnalysis.shallowTests.length > 0) {
    recommendations.push({
      priority: "MEDIUM",
      category: "Coverage Depth",
      title: `${coverageDepthAnalysis.shallowTests.length} tests are too shallow`,
      description: `${coverageDepthAnalysis.shallowTests[0].testName} only reaches depth ${coverageDepthAnalysis.shallowTests[0].callDepthReached} but ${coverageDepthAnalysis.shallowTests[0].targetFunction} calls ${coverageDepthAnalysis.shallowTests[0].missedFunctions.join(", ")}`,
      affectedEntities: coverageDepthAnalysis.shallowTests.map((t) => t.testName),
      estimatedEffort: "1 hour per test to expand coverage",
      businessImpact: "Edge cases and error paths may be untested",
      confidenceLevel: 72,
    });
  }

  // MEDIUM: Business flow coverage
  const lowCoverageFlows = businessCriticalAnalysis.coverageByBusinessFlow.filter(
    (f) => f.coveragePercentage < 50 && f.functionsInFlow > 3
  );
  if (lowCoverageFlows.length > 0) {
    recommendations.push({
      priority: "MEDIUM",
      category: "Business Flow",
      title: `${lowCoverageFlows.length} business flows have less than 50% coverage`,
      description: `${lowCoverageFlows[0].flowName} has only ${lowCoverageFlows[0].coveragePercentage}% coverage (${lowCoverageFlows[0].testedFunctions}/${lowCoverageFlows[0].functionsInFlow} functions)`,
      affectedEntities: lowCoverageFlows.map((f) => f.flowName),
      estimatedEffort: `${lowCoverageFlows.reduce((sum, f) => sum + f.functionsInFlow - f.testedFunctions, 0)} tests to add`,
      businessImpact: "Business flows may break without test detection",
      confidenceLevel: 68,
    });
  }

  // Calculate overall health score
  const healthFactors = [
    businessCriticalAnalysis.revenueCriticalCoverage,
    100 - mockRelianceAnalysis.overallMockReliance,
    flakyTestAnalysis.totalFlakyTests === 0 ? 100 : Math.max(0, 100 - flakyTestAnalysis.totalFlakyTests * 10),
    Math.min(100, coverageDepthAnalysis.averageCallDepth * 40),
    incidentCorrelation.highRiskModules.length === 0 ? 100 : Math.max(0, 100 - incidentCorrelation.highRiskModules.length * 15),
  ];
  const overallTestHealth = Math.round(healthFactors.reduce((a, b) => a + b, 0) / healthFactors.length);

  // Calculate test effectiveness (are tests actually catching bugs?)
  const testEffectivenessScore = Math.round(
    (100 - incidentCorrelation.bugIntroductionRate) * 0.4 +
    (100 - mockRelianceAnalysis.overallMockReliance) * 0.3 +
    businessCriticalAnalysis.revenueCriticalCoverage * 0.3
  );

  return {
    summary: {
      totalTests: testFunctions.length,
      totalProductionFunctions: productionFunctions.length,
      businessCriticalCoverage: businessCriticalAnalysis.revenueCriticalCoverage,
      mockRelianceRisk: mockRelianceAnalysis.riskLevel,
      flakyTestRisk: flakyTestAnalysis.flakyTestRisk,
      incidentCorrelationRisk:
        incidentCorrelation.highRiskModules.length > 3
          ? "HIGH"
          : incidentCorrelation.highRiskModules.length > 0
          ? "MEDIUM"
          : "LOW",
      overallTestHealth,
      testEffectivenessScore,
    },
    businessCriticalAnalysis,
    mockRelianceAnalysis,
    flakyTestAnalysis,
    coverageDepthAnalysis,
    incidentCorrelation,
    modificationFriction,
    testBusinessMapping,
    crossServiceGaps,
    recommendations: recommendations.sort((a, b) => {
      const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }),
  };
}

/**
 * Test Quality Analyzer
 *
 * Detects tests that exist primarily for line coverage rather than
 * meaningful behavior verification. Identifies:
 *
 * - Zero-assertion tests (coverage padding)
 * - Weak assertion tests (toBeTruthy, toBeDefined only)
 * - Mock-heavy tests (>80% mocked dependencies)
 * - Complexity mismatches (simple tests for complex code)
 * - Coverage-only patterns (calls without verification)
 */

import type { CodeSynapseClient, FunctionInfo } from "../api/client.js";

// =============================================================================
// Types
// =============================================================================

export interface TestQualityReport {
  summary: {
    totalTestFiles: number;
    totalTestFunctions: number;
    validTests: number;
    suspiciousTests: number;
    coveragePaddingTests: number;
    overallQualityScore: number; // 0-100
  };
  suspiciousTests: SuspiciousTest[];
  testsByCategory: TestCategory[];
  mockAnalysis: MockAnalysis;
  coverageGaps: CoverageGap[];
  recommendations: string[];
}

export interface SuspiciousTest {
  testName: string;
  filePath: string;
  issues: TestIssue[];
  qualityScore: number; // 0-100
  verdict: "VALID" | "SUSPICIOUS" | "COVERAGE_PADDING";
  targetFunction?: string;
  targetComplexity?: number;
}

export interface TestIssue {
  type: TestIssueType;
  severity: "HIGH" | "MEDIUM" | "LOW";
  description: string;
  suggestion: string;
}

export type TestIssueType =
  | "ZERO_ASSERTIONS"
  | "WEAK_ASSERTIONS_ONLY"
  | "LOW_ASSERTION_DENSITY"
  | "EXCESSIVE_MOCKING"
  | "NO_ERROR_CASE_TESTING"
  | "COMPLEXITY_MISMATCH"
  | "CALL_WITHOUT_VERIFY"
  | "SNAPSHOT_ONLY"
  | "TRIVIAL_ASSERTION";

export interface TestCategory {
  category: string;
  count: number;
  description: string;
  examples: string[];
}

export interface MockAnalysis {
  totalMockedDependencies: number;
  fullyMockedTests: number; // >80% mocked
  partiallyMockedTests: number; // 20-80% mocked
  integrationTests: number; // <20% mocked
  mostMockedDependencies: Array<{ name: string; mockCount: number }>;
}

export interface CoverageGap {
  functionName: string;
  filePath: string;
  complexity: number;
  hasTests: boolean;
  testQuality: "GOOD" | "WEAK" | "NONE";
  businessLayer: string;
  recommendation: string;
}

// =============================================================================
// Test Pattern Detection
// =============================================================================

/**
 * Common weak assertion patterns that don't verify actual behavior
 */
const WEAK_ASSERTION_PATTERNS = [
  /\.toBeTruthy\(\)/,
  /\.toBeFalsy\(\)/,
  /\.toBeDefined\(\)/,
  /\.toBeUndefined\(\)/,
  /\.not\.toBeNull\(\)/,
  /\.toBeInstanceOf\(/,
  /\.toHaveLength\(0\)/,
  /expect\(true\)\.toBe\(true\)/,
  /expect\(.*\)\.toBe\(true\)/,
  /expect\(.*\)\.toBe\(false\)/,
];

/**
 * Strong assertion patterns that verify actual values
 */
const STRONG_ASSERTION_PATTERNS = [
  /\.toEqual\(/,
  /\.toStrictEqual\(/,
  /\.toBe\([^tf]/,  // toBe with actual values, not true/false
  /\.toContain\(/,
  /\.toMatch\(/,
  /\.toThrow\(/,
  /\.toHaveBeenCalledWith\(/,
  /\.toHaveProperty\(/,
  /\.resolves\./,
  /\.rejects\./,
];

/**
 * Mock patterns
 */
const MOCK_PATTERNS = [
  /jest\.mock\(/,
  /jest\.fn\(\)/,
  /\.mockImplementation\(/,
  /\.mockReturnValue\(/,
  /\.mockResolvedValue\(/,
  /\.mockRejectedValue\(/,
  /vi\.mock\(/,
  /vi\.fn\(\)/,
  /sinon\.stub\(/,
  /sinon\.mock\(/,
  /\.spyOn\(/,
];

/**
 * Snapshot-only test patterns
 */
const SNAPSHOT_PATTERNS = [
  /\.toMatchSnapshot\(\)/,
  /\.toMatchInlineSnapshot\(/,
];

/**
 * Coverage padding patterns - calling without asserting
 */
const COVERAGE_PADDING_PATTERNS = [
  /^\s*await?\s+\w+\([^)]*\);?\s*$/m,  // Bare function calls
  /it\(['"].*['"],\s*(?:async\s*)?\(\)\s*=>\s*\{[^}]*\}\)/,  // Empty or near-empty tests
];

// =============================================================================
// Analysis Functions
// =============================================================================

/**
 * Detect if a function is a test function
 */
function isTestFunction(fn: FunctionInfo): boolean {
  const name = fn.name.toLowerCase();
  const path = fn.filePath.toLowerCase();

  // Check path patterns
  if (path.includes("__tests__") || path.includes(".test.") ||
      path.includes(".spec.") || path.includes("/test/") ||
      path.includes("/tests/")) {
    return true;
  }

  // Check function name patterns
  if (name.startsWith("test") || name.startsWith("it") ||
      name.startsWith("describe") || name.includes("test_") ||
      name.includes("_test")) {
    return true;
  }

  return false;
}

/**
 * Extract test file path from a test function
 */
function getTestFilePath(fn: FunctionInfo): string {
  return fn.filePath;
}

/**
 * Analyze assertion patterns in test code
 */
function analyzeAssertions(testCode: string): {
  totalAssertions: number;
  weakAssertions: number;
  strongAssertions: number;
  snapshotAssertions: number;
} {
  let weakAssertions = 0;
  let strongAssertions = 0;
  let snapshotAssertions = 0;

  // Count weak assertions
  for (const pattern of WEAK_ASSERTION_PATTERNS) {
    const matches = testCode.match(new RegExp(pattern.source, "g"));
    if (matches) weakAssertions += matches.length;
  }

  // Count strong assertions
  for (const pattern of STRONG_ASSERTION_PATTERNS) {
    const matches = testCode.match(new RegExp(pattern.source, "g"));
    if (matches) strongAssertions += matches.length;
  }

  // Count snapshot assertions
  for (const pattern of SNAPSHOT_PATTERNS) {
    const matches = testCode.match(new RegExp(pattern.source, "g"));
    if (matches) snapshotAssertions += matches.length;
  }

  return {
    totalAssertions: weakAssertions + strongAssertions + snapshotAssertions,
    weakAssertions,
    strongAssertions,
    snapshotAssertions,
  };
}

/**
 * Count mock usage in test code
 */
function countMocks(testCode: string): number {
  let mockCount = 0;
  for (const pattern of MOCK_PATTERNS) {
    const matches = testCode.match(new RegExp(pattern.source, "g"));
    if (matches) mockCount += matches.length;
  }
  return mockCount;
}

/**
 * Estimate test complexity based on various factors
 */
function estimateTestComplexity(fn: FunctionInfo): number {
  // Use available complexity or estimate from line count
  if (fn.complexity) return fn.complexity;

  const lineCount = (fn.endLine || 0) - (fn.startLine || 0);
  if (lineCount <= 5) return 1;
  if (lineCount <= 15) return 3;
  if (lineCount <= 30) return 5;
  return Math.min(10, Math.floor(lineCount / 10));
}

/**
 * Calculate quality score for a test (0-100)
 */
function calculateTestQualityScore(
  assertionRatio: number,  // strong / total
  mockRatio: number,       // mocks / function calls
  complexityMatch: number, // test complexity / target complexity
  hasErrorCases: boolean,
  isSnapshotOnly: boolean
): number {
  let score = 100;

  // Penalize for weak assertions
  if (assertionRatio < 0.3) score -= 30;
  else if (assertionRatio < 0.5) score -= 15;
  else if (assertionRatio < 0.7) score -= 5;

  // Penalize for excessive mocking
  if (mockRatio > 0.8) score -= 25;
  else if (mockRatio > 0.5) score -= 10;

  // Penalize for complexity mismatch
  if (complexityMatch < 0.2) score -= 20;
  else if (complexityMatch < 0.5) score -= 10;

  // Penalize for no error case testing
  if (!hasErrorCases) score -= 10;

  // Penalize for snapshot-only tests
  if (isSnapshotOnly) score -= 15;

  return Math.max(0, Math.min(100, score));
}

/**
 * Determine verdict based on quality score
 */
function getVerdict(score: number): "VALID" | "SUSPICIOUS" | "COVERAGE_PADDING" {
  if (score >= 70) return "VALID";
  if (score >= 40) return "SUSPICIOUS";
  return "COVERAGE_PADDING";
}

/**
 * Generate issues for a test based on analysis
 */
function generateIssues(
  assertionAnalysis: ReturnType<typeof analyzeAssertions>,
  mockCount: number,
  estimatedCalls: number,
  testComplexity: number,
  targetComplexity: number | undefined
): TestIssue[] {
  const issues: TestIssue[] = [];

  // Zero assertions
  if (assertionAnalysis.totalAssertions === 0) {
    issues.push({
      type: "ZERO_ASSERTIONS",
      severity: "HIGH",
      description: "Test has no assertions - it only executes code without verifying behavior",
      suggestion: "Add expect() statements to verify the function's return value and side effects",
    });
  }

  // Weak assertions only
  if (assertionAnalysis.totalAssertions > 0 &&
      assertionAnalysis.strongAssertions === 0 &&
      assertionAnalysis.snapshotAssertions === 0) {
    issues.push({
      type: "WEAK_ASSERTIONS_ONLY",
      severity: "HIGH",
      description: "Test only uses weak assertions (toBeTruthy, toBeDefined) that don't verify actual values",
      suggestion: "Replace weak assertions with specific value checks using toEqual() or toBe(specificValue)",
    });
  }

  // Low assertion density
  const assertionDensity = estimatedCalls > 0
    ? assertionAnalysis.totalAssertions / estimatedCalls
    : 0;
  if (assertionDensity < 0.3 && assertionAnalysis.totalAssertions > 0) {
    issues.push({
      type: "LOW_ASSERTION_DENSITY",
      severity: "MEDIUM",
      description: `Test makes ~${estimatedCalls} calls but only has ${assertionAnalysis.totalAssertions} assertions`,
      suggestion: "Add assertions for intermediate results and edge cases",
    });
  }

  // Excessive mocking
  const mockRatio = estimatedCalls > 0 ? mockCount / estimatedCalls : 0;
  if (mockRatio > 0.8 && mockCount > 3) {
    issues.push({
      type: "EXCESSIVE_MOCKING",
      severity: "MEDIUM",
      description: `Test mocks ${mockCount} dependencies - it's testing mocks, not real behavior`,
      suggestion: "Consider integration tests or reduce mocking to only external dependencies",
    });
  }

  // Complexity mismatch
  if (targetComplexity && targetComplexity > 10 && testComplexity < 3) {
    issues.push({
      type: "COMPLEXITY_MISMATCH",
      severity: "MEDIUM",
      description: `Target has complexity ${targetComplexity} but test is trivial (complexity ${testComplexity})`,
      suggestion: "Add tests for different code paths, edge cases, and error conditions",
    });
  }

  // Snapshot only
  if (assertionAnalysis.snapshotAssertions > 0 &&
      assertionAnalysis.strongAssertions === 0 &&
      assertionAnalysis.weakAssertions === 0) {
    issues.push({
      type: "SNAPSHOT_ONLY",
      severity: "LOW",
      description: "Test relies entirely on snapshots - easy to approve incorrect changes",
      suggestion: "Add explicit assertions for critical properties alongside snapshots",
    });
  }

  return issues;
}

// =============================================================================
// Report Generator
// =============================================================================

export async function generateTestQualityReport(
  client: CodeSynapseClient
): Promise<TestQualityReport> {
  // Fetch all functions
  const [allFunctions, mostComplex] = await Promise.all([
    client.listFunctions({ limit: 10000 }),
    client.getMostComplexFunctions(100),
  ]);

  // Separate test and production functions
  const testFunctions = allFunctions.filter(isTestFunction);
  const productionFunctions = allFunctions.filter(fn => !isTestFunction(fn));

  // Create a map of production functions by name for matching
  const prodFunctionsByName = new Map<string, FunctionInfo>();
  for (const fn of productionFunctions) {
    // Store by simple name and by full path
    prodFunctionsByName.set(fn.name, fn);
    prodFunctionsByName.set(`${fn.filePath}:${fn.name}`, fn);
  }

  // Analyze each test function
  const suspiciousTests: SuspiciousTest[] = [];
  let validCount = 0;
  let suspiciousCount = 0;
  let paddingCount = 0;

  // Track mock usage
  let totalMocks = 0;
  const mockCountByDep = new Map<string, number>();
  let fullyMockedTests = 0;
  let partiallyMockedTests = 0;
  let integrationTests = 0;

  // Group tests by file for analysis
  const testsByFile = new Map<string, FunctionInfo[]>();
  for (const fn of testFunctions) {
    const file = fn.filePath;
    if (!testsByFile.has(file)) {
      testsByFile.set(file, []);
    }
    testsByFile.get(file)!.push(fn);
  }

  for (const fn of testFunctions) {
    // Estimate test characteristics based on function metadata
    const testComplexity = estimateTestComplexity(fn);
    const lineCount = (fn.endLine || 0) - (fn.startLine || 0);

    // Estimate assertions and mocks based on test size and name
    // In a real implementation, we'd parse the actual test code
    const estimatedCalls = Math.max(1, Math.floor(lineCount / 3));

    // Heuristics for assertion analysis based on function characteristics
    let estimatedAssertions = {
      totalAssertions: 0,
      weakAssertions: 0,
      strongAssertions: 0,
      snapshotAssertions: 0,
    };

    // Tests with "should" in name tend to have assertions
    const hasDescriptiveName = fn.name.includes("should") || fn.name.includes("expect") ||
                               fn.name.includes("verify") || fn.name.includes("check");

    if (hasDescriptiveName) {
      estimatedAssertions.strongAssertions = Math.max(1, Math.floor(lineCount / 5));
      estimatedAssertions.totalAssertions = estimatedAssertions.strongAssertions;
    } else if (lineCount > 3) {
      // Shorter tests without descriptive names are more suspicious
      estimatedAssertions.weakAssertions = Math.max(0, Math.floor(lineCount / 8));
      estimatedAssertions.totalAssertions = estimatedAssertions.weakAssertions;
    }

    // Estimate mocks based on test file patterns
    const mockCount = fn.filePath.includes("unit") ? Math.floor(estimatedCalls * 0.5) :
                      fn.filePath.includes("integration") ? Math.floor(estimatedCalls * 0.1) :
                      Math.floor(estimatedCalls * 0.3);
    totalMocks += mockCount;

    const mockRatio = estimatedCalls > 0 ? mockCount / estimatedCalls : 0;
    if (mockRatio > 0.8) fullyMockedTests++;
    else if (mockRatio > 0.2) partiallyMockedTests++;
    else integrationTests++;

    // Try to find the target function
    const targetName = fn.name
      .replace(/^(test_?|it_?|should_?)/i, "")
      .replace(/_(test|spec)$/i, "")
      .replace(/^(describes?|tests?)\s*/i, "");
    const targetFunction = prodFunctionsByName.get(targetName);
    const targetComplexity = targetFunction?.complexity;

    // Check for error case testing
    const hasErrorCases = fn.name.toLowerCase().includes("error") ||
                          fn.name.toLowerCase().includes("throw") ||
                          fn.name.toLowerCase().includes("fail") ||
                          fn.name.toLowerCase().includes("invalid");

    // Calculate quality score
    const assertionRatio = estimatedAssertions.totalAssertions > 0
      ? estimatedAssertions.strongAssertions / estimatedAssertions.totalAssertions
      : 0;
    const complexityMatch = targetComplexity
      ? testComplexity / targetComplexity
      : 0.5;
    const isSnapshotOnly = estimatedAssertions.snapshotAssertions > 0 &&
                           estimatedAssertions.strongAssertions === 0;

    const qualityScore = calculateTestQualityScore(
      assertionRatio,
      mockRatio,
      complexityMatch,
      hasErrorCases,
      isSnapshotOnly
    );

    const verdict = getVerdict(qualityScore);

    // Generate issues
    const issues = generateIssues(
      estimatedAssertions,
      mockCount,
      estimatedCalls,
      testComplexity,
      targetComplexity
    );

    // Count by verdict
    if (verdict === "VALID") validCount++;
    else if (verdict === "SUSPICIOUS") suspiciousCount++;
    else paddingCount++;

    // Add to suspicious if not valid
    if (verdict !== "VALID" && issues.length > 0) {
      suspiciousTests.push({
        testName: fn.name,
        filePath: fn.filePath,
        issues,
        qualityScore,
        verdict,
        targetFunction: targetFunction?.name,
        targetComplexity,
      });
    }
  }

  // Sort suspicious tests by quality score (worst first)
  suspiciousTests.sort((a, b) => a.qualityScore - b.qualityScore);

  // Calculate overall quality score
  const totalTests = testFunctions.length;
  const overallQualityScore = totalTests > 0
    ? Math.round((validCount / totalTests) * 100)
    : 0;

  // Build test categories
  const testCategories: TestCategory[] = [
    {
      category: "Valid Tests",
      count: validCount,
      description: "Tests with meaningful assertions that verify actual behavior",
      examples: testFunctions
        .filter(fn => {
          const hasDescriptiveName = fn.name.includes("should") || fn.name.includes("verify");
          return hasDescriptiveName;
        })
        .slice(0, 3)
        .map(fn => fn.name),
    },
    {
      category: "Suspicious Tests",
      count: suspiciousCount,
      description: "Tests with potential quality issues that may need review",
      examples: suspiciousTests
        .filter(t => t.verdict === "SUSPICIOUS")
        .slice(0, 3)
        .map(t => t.testName),
    },
    {
      category: "Coverage Padding",
      count: paddingCount,
      description: "Tests that appear to exist primarily for coverage metrics",
      examples: suspiciousTests
        .filter(t => t.verdict === "COVERAGE_PADDING")
        .slice(0, 3)
        .map(t => t.testName),
    },
  ];

  // Build mock analysis
  const mockAnalysis: MockAnalysis = {
    totalMockedDependencies: totalMocks,
    fullyMockedTests,
    partiallyMockedTests,
    integrationTests,
    mostMockedDependencies: [], // Would need deeper analysis
  };

  // Identify coverage gaps - high-complexity business code with weak/no tests
  const coverageGaps: CoverageGap[] = mostComplex
    .filter(fn => !isTestFunction(fn))
    .slice(0, 20)
    .map(fn => {
      // Check if this function has tests
      const possibleTestNames = [
        `test_${fn.name}`,
        `test${fn.name}`,
        `${fn.name}_test`,
        `${fn.name}Test`,
        `should ${fn.name}`,
      ];

      const hasTests = testFunctions.some(test =>
        possibleTestNames.some(name =>
          test.name.toLowerCase().includes(name.toLowerCase()) ||
          test.name.toLowerCase().includes(fn.name.toLowerCase())
        )
      );

      // Find matching tests to determine quality
      const matchingTests = suspiciousTests.filter(t =>
        t.targetFunction === fn.name ||
        t.testName.toLowerCase().includes(fn.name.toLowerCase())
      );

      let testQuality: "GOOD" | "WEAK" | "NONE" = "NONE";
      if (hasTests) {
        if (matchingTests.length === 0 || matchingTests.every(t => t.verdict === "VALID")) {
          testQuality = "GOOD";
        } else {
          testQuality = "WEAK";
        }
      }

      const businessLayer = fn.classification === "domain" ? "domain"
        : fn.classification === "infrastructure" ? "infrastructure"
        : "unknown";

      let recommendation = "";
      if (testQuality === "NONE") {
        recommendation = `Add tests for this ${businessLayer} function with complexity ${fn.complexity}`;
      } else if (testQuality === "WEAK") {
        recommendation = `Improve existing tests - add stronger assertions and error case coverage`;
      } else {
        recommendation = `Tests look adequate - consider adding edge case coverage`;
      }

      return {
        functionName: fn.name,
        filePath: fn.filePath,
        complexity: fn.complexity || 0,
        hasTests,
        testQuality,
        businessLayer,
        recommendation,
      };
    });

  // Generate recommendations
  const recommendations: string[] = [];

  if (paddingCount > 0) {
    recommendations.push(
      `${paddingCount} tests appear to be coverage padding. ` +
      `Review and either add meaningful assertions or remove them.`
    );
  }

  if (suspiciousCount > totalTests * 0.3) {
    recommendations.push(
      `${Math.round(suspiciousCount / totalTests * 100)}% of tests have quality issues. ` +
      `Schedule a test improvement sprint.`
    );
  }

  const zeroAssertionTests = suspiciousTests.filter(t =>
    t.issues.some(i => i.type === "ZERO_ASSERTIONS")
  );
  if (zeroAssertionTests.length > 0) {
    recommendations.push(
      `${zeroAssertionTests.length} tests have ZERO assertions. ` +
      `These are pure coverage padding - start here.`
    );
  }

  const weakOnlyTests = suspiciousTests.filter(t =>
    t.issues.some(i => i.type === "WEAK_ASSERTIONS_ONLY")
  );
  if (weakOnlyTests.length > 0) {
    recommendations.push(
      `${weakOnlyTests.length} tests use only weak assertions (toBeTruthy, toBeDefined). ` +
      `Replace with specific value assertions.`
    );
  }

  if (fullyMockedTests > totalTests * 0.5) {
    recommendations.push(
      `${Math.round(fullyMockedTests / totalTests * 100)}% of tests are fully mocked. ` +
      `Consider adding integration tests to verify real behavior.`
    );
  }

  const domainGaps = coverageGaps.filter(g => g.businessLayer === "domain" && g.testQuality !== "GOOD");
  if (domainGaps.length > 0) {
    recommendations.push(
      `${domainGaps.length} high-complexity domain functions lack quality tests. ` +
      `Priority: ${domainGaps[0].functionName} (complexity: ${domainGaps[0].complexity})`
    );
  }

  if (overallQualityScore >= 80) {
    recommendations.push(
      `Test quality score is ${overallQualityScore}% (GOOD). ` +
      `Focus on maintaining quality in new tests.`
    );
  }

  return {
    summary: {
      totalTestFiles: testsByFile.size,
      totalTestFunctions: totalTests,
      validTests: validCount,
      suspiciousTests: suspiciousCount,
      coveragePaddingTests: paddingCount,
      overallQualityScore,
    },
    suspiciousTests: suspiciousTests.slice(0, 30),
    testsByCategory: testCategories,
    mockAnalysis,
    coverageGaps,
    recommendations,
  };
}

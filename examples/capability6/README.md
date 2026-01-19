# Business-Aware Testing MVP

> **Transform test metrics from "lines covered" to "business risk mitigated"**

A CLI tool that demonstrates how Code-Synapse's knowledge graph enables intelligent test analysis that understands business context, not just code coverage.

## What This Example Does

This MVP showcases **Business-Aware Testing** - the concept that not all code (and therefore not all tests) is equally important. It uses Code-Synapse's REST API to:

### 1. Business-Weighted Coverage Analysis
Instead of treating all code equally, weights coverage by business impact:

| Business Layer | Weight | Why |
|----------------|--------|-----|
| Revenue-Critical | 4x | Bugs here = direct revenue loss |
| User-Facing | 2x | Bugs here = user experience degradation |
| Internal | 1x | Standard internal logic |
| Infrastructure | 0.5x | Plumbing code, less business impact |

### 2. Test Intelligence Analysis
Goes beyond "does this code have a test?" to answer:
- **Is the test actually valuable?** (or just coverage padding)
- **Is the test testing real behavior?** (or just mocked dependencies)
- **Does the test correlate with past incidents?** (code that broke before)
- **Is the test covering the full call chain?** (or just shallow execution)

### 3. Day 0 Insights (Instant Value)
Provides immediate insights without any configuration:
- **God Classes** - High complexity modules doing too much
- **Modification Hotspots** - High churn + high complexity = danger
- **Bus Factor Risks** - Single contributor knowledge silos
- **Codebase Health Score** - Overall quality assessment

### 4. PR Risk Score Calculator
Calculates transparent risk scores for pull requests:
- **Explicit Risk Factors** - Shows exactly what contributes to the score
- **Blast Radius Analysis** - How many business flows are affected
- **Similar Past Changes** - What happened when similar changes were made
- **Suggested Reviewers** - Who has expertise in the affected code

### 5. Function Knowledge Context
Provides comprehensive context for any function:
- **Business Justification** - Why this code exists
- **Experts** - Who knows this code best
- **Dependencies** - What this function calls and is called by
- **Change History** - Recent modifications and incident history
- **Warnings** - Bus factor, stale documentation, high churn alerts

### 6. Risk & Tech Debt Prioritization
Uses the formula: `Modification Friction = Complexity x Churn x Business Weight`

High friction + low test coverage = dangerous code that needs attention.

---

## Why This Matters

### The Problem with Traditional Coverage

```
Traditional Coverage Report:
  src/utils/helpers.ts     100% covered
  src/services/payment.ts   45% covered

  Overall: 72% coverage
```

This tells you nothing about **risk**. The helper utilities might be trivial, while the payment service handles millions in transactions.

### The Business-Aware Approach

```
Business-Aware Report:
  src/utils/helpers.ts     [INFRASTRUCTURE 0.5x] 100% covered
  src/services/payment.ts  [REVENUE-CRITICAL 4x] 45% covered

  Business-Weighted Coverage: 38%

  CRITICAL: processPayment has no tests
           "Handles all payment transactions and revenue collection"
           This code has caused 3 incidents in the past.
```

Now you know **exactly where to focus**.

---

## How It Works (Using Code-Synapse)

This MVP leverages Code-Synapse's knowledge graph through its REST API:

### Data Sources

```
Code-Synapse Knowledge Graph
         |
         +-- Classifications (Domain vs Infrastructure)
         |       "Is this business logic or plumbing?"
         |
         +-- Justifications (Business Context)
         |       "What does this code do for the business?"
         |
         +-- Change Ledger (Historical Context)
         |       "How often does this code change?"
         |       "What incidents are linked to this code?"
         |
         +-- Call Graph (Dependency Analysis)
                 "What does this function call?"
                 "How deep is the test coverage?"
```

### Analysis Pipeline

```
                    Code-Synapse API
                          |
    +----------+----------+----------+----------+
    |          |          |          |          |
    v          v          v          v          v
Functions  Classif.  Justif.   Ledger    Call Graph
    |          |          |          |          |
    +----------+----------+----------+----------+
                          |
                    Test Intelligence
                    Analysis Engine
                          |
    +----------+----------+----------+----------+
    |          |          |          |          |
    v          v          v          v          v
Business   Mock      Flaky    Coverage  Incident
Critical   Reliance  Test     Depth     Correlation
Coverage   Analysis  Patterns Analysis  Analysis
    |          |          |          |          |
    +----------+----------+----------+----------+
                          |
                   Prioritized
                   Recommendations
```

### Key Insights Generated

| Insight | Data Source | Question Answered |
|---------|-------------|-------------------|
| Business-Critical Untested | Classifications + Justifications | "What revenue-critical code has no tests?" |
| Mock Trap Detection | Call Graph + Classifications | "Are we testing mocks instead of real behavior?" |
| Flaky Test Correlation | Change Ledger + Functions | "Which tests fail when specific code changes?" |
| Coverage Depth | Call Graph + Test Functions | "Do tests exercise the full call chain?" |
| Incident Correlation | Change Ledger + Incidents | "What code modules have caused past bugs?" |
| Modification Friction | Complexity + Churn + Classifications | "What code is risky to change?" |
| God Classes | Complexity + Method Count | "What modules do too much?" |
| PR Risk | All data sources | "How risky is this change?" |
| Function Context | All data sources | "Who knows this code and why does it exist?" |

---

## Installation

### Prerequisites

1. **Code-Synapse** must be installed and indexed:
   ```bash
   npm install -g code-synapse
   cd your-project
   code-synapse init
   code-synapse index
   code-synapse justify  # Optional but recommended for business context
   ```

2. **Code-Synapse viewer** must be running:
   ```bash
   code-synapse viewer
   # Server starts at http://localhost:3100
   ```

### Install the MVP

```bash
cd examples/capability6
pnpm install
pnpm build
```

---

## Usage

### Quick Start

```bash
# Generate full business-aware testing report
pnpm start report

# Or run individual analyses
pnpm run test-intelligence  # Advanced test analysis
pnpm run coverage           # Business-weighted coverage
pnpm run risk               # Risk scoring
pnpm run debt               # Tech debt ROI
pnpm run bus-factor         # Knowledge concentration
pnpm run test-quality       # Basic test quality

# NEW: Day 0 Insights (instant value, no config needed)
pnpm run day0               # God classes, hotspots, bus factor risks

# NEW: PR Risk Analysis
pnpm run pr-risk            # Calculate risk score for changes

# NEW: Function Knowledge Context
pnpm run context            # Full context for top functions
```

### JSON Output (for CI Integration)

```bash
pnpm start -- --json report > report.json

# Or for a specific analysis
pnpm start -- --json test-intelligence > test-intelligence.json
pnpm start -- --json day0 > day0-insights.json
pnpm start -- --json pr-risk > pr-risk.json
pnpm start -- --json context > function-context.json
```

### Custom API URL

```bash
pnpm start -- --url http://localhost:3100 report
```

---

## Example Output

### Day 0 Insights Report

```
===============================================================================
  DAY 0 INSIGHTS REPORT
  Instant Value - No Configuration Required
===============================================================================

SUMMARY

  Files Indexed:       234
  Functions Analyzed:  890
  Issues Flagged:      12

  Codebase Health Score: 68%  [############........]

HEALTH FACTORS

  Complexity Distribution  82%  GOOD      82% of functions are simple to moderate
  God Classes              70%  GOOD      2 potential god classes detected
  Knowledge Distribution   40%  WARNING   3 modules with critical bus factor
  Modification Stability   80%  GOOD      1 critical modification hotspot

===============================================================================

GOD CLASSES (High complexity, multiple responsibilities)

  [CRITICAL] PaymentService.ts
      Complexity: 87  |  Methods: 23  |  Lines: 1,245
      Responsibilities: Data Retrieval, Data Mutation, Validation, Business Logic, Logging
      This module has 5 different responsibilities. Consider splitting into focused modules:
      Data Retrieval, Data Mutation, Validation

  [HIGH] OrderProcessor.ts
      Complexity: 52  |  Methods: 15  |  Lines: 678
      Responsibilities: Data Mutation, Business Logic, Communication
      High complexity (52) suggests this module could benefit from refactoring

===============================================================================

MODIFICATION HOTSPOTS (High churn + high complexity = danger)

  [CRITICAL] src/services/payment/processor.ts
      Complexity: 45  |  Changes: 23  |  Last: 2 days ago
      Change Frequency: Several times per week
      CRITICAL: Very high complexity with frequent changes - high risk of introducing bugs
      23 changes with complexity 45. Consider: breaking into smaller modules,
      stabilizing the interface, adding more tests for edge cases.

===============================================================================

BUS FACTOR RISKS (Single contributor knowledge silos)

  [CRITICAL] src/services/payment
      Primary: @alice (92% of 45 commits)
      Other Contributors: @bob (3), @carol (1)
      Bus Factor: 1
      Only @alice has touched this module. Knowledge transfer urgently needed.

  [HIGH] src/services/billing
      Primary: @david (78% of 32 commits)
      Other Contributors: @alice (5), @eve (2)
      Bus Factor: 1
      @david owns 78% of changes. Consider pair programming or documentation.

===============================================================================

QUICK WINS (Easy improvements with high impact)

  [HIGH IMPACT, LOW EFFORT] Split processPayment
      src/services/payment/processor.ts
      Current: Complexity: 28
      Improvement: Extract helper functions to reduce complexity

  [HIGH IMPACT, MEDIUM EFFORT] Split validateOrder
      src/services/orders/validator.ts
      Current: Complexity: 24
      Improvement: Extract helper functions to reduce complexity

===============================================================================
```

### PR Risk Score Report

```
===============================================================================
  PR RISK SCORE REPORT
  Transparent Risk Assessment for Code Changes
===============================================================================

SUMMARY

  Overall Risk Level:   HIGH
  Risk Score:           72/100
  Confidence:           85%

  Affected Functions:   12
  Affected Business Flows: 3

===============================================================================

RISK FACTORS (Transparent Scoring)

  Risk Factor                 Weight    Score    Contribution
  -------------------------- -------- -------- --------------
  Complexity of changes         15%      8/10     12.0
  Business criticality          25%      9/10     22.5
  Change frequency (churn)      10%      6/10      6.0
  Bus factor risk               15%      8/10     12.0
  Historical incidents          20%      7/10     14.0
  Test coverage gap             15%      4/10      6.0
                               -----            ------
                               100%               72.5

===============================================================================

BLAST RADIUS ANALYSIS

  Direct Impact:
    Functions changed: 3
    Files modified: 2

  Indirect Impact (via call graph):
    Upstream callers: 8 functions
    Downstream callees: 4 functions

  Business Flows Affected:
    [REVENUE-CRITICAL] Checkout Flow
        processPayment, validateCard, createTransaction

    [USER-FACING] Order Management
        createOrder, updateOrder

    [INTERNAL] Reporting
        generateReport

===============================================================================

HISTORICAL CONTEXT

  Recent Changes (30 days):
    15 commits to affected files
    3 unique authors

  Past Incidents:
    2 incidents linked to affected code
    Last incident: 12 days ago
    "Payment processing timeout during peak hours"

===============================================================================

SIMILAR PAST CHANGES

  [78% similar] PR #234 "Update payment retry logic" - 2 weeks ago
      Outcome: INCIDENT
      Learning: Changes to payment retry affected downstream services

  [65% similar] PR #198 "Refactor payment validation" - 1 month ago
      Outcome: SUCCESS
      Learning: Well-tested changes to validation logic

===============================================================================

SUGGESTED REVIEWERS

  @alice (Domain Expert)
      23 commits to affected code | Last active: 2 days ago
      @alice is the domain expert with 23 commits to this area

  @bob (Frequent Contributor)
      8 commits to affected code | Last active: 1 week ago
      @bob has 8 commits and can provide context

===============================================================================

RECOMMENDATIONS

  [!!!] HIGH PRIORITY: Add integration tests
      Critical path is 92% mocked. Add integration tests before merging.

  [!!] MEDIUM: Ensure @alice reviews
      @alice has the most context on payment processing changes.

  [!] LOW: Update documentation
      Payment retry logic has changed - update runbook.

===============================================================================
```

### Function Knowledge Context Report

```
===============================================================================
  FUNCTION KNOWLEDGE CONTEXT REPORT
  Comprehensive Context for Code Understanding
===============================================================================

SUMMARY

  Total Functions:     20
  With Justification:  15 (75%)
  With Experts:        18 (90%)
  Avg Expert Count:    2.3

===============================================================================

FUNCTION: processPayment

  Location: src/services/payment/processor.ts:145
  Complexity: 28  |  Lines: 89

  BUSINESS JUSTIFICATION
      "Handles retry logic for failed payments in checkout flow.
       Critical for revenue recovery - retries capture ~15% of
       initially failed transactions."

      Feature Context: Checkout / Payment Processing
      Business Value: Revenue Recovery
      Confidence: 87%

  CLASSIFICATION
      Category: Domain (Payment Processing)
      Business Layer: REVENUE-CRITICAL
      Confidence: 92%

  ORIGIN
      Created: 2023-03-15 by @alice
      Reason: "Duplicate charge bug required idempotent design"
      Ticket: JIRA-1234

  EXPERTS (Who to ask)
      @alice (47 commits, last active 2 weeks ago)
          Focus: Bug fixes
          "@alice is the domain expert - reach out before major changes"

      @bob (12 commits, last active 1 month ago)
          Focus: Features
          "@bob can provide context"

  DEPENDENCIES
      Called By: CheckoutService.submit, SubscriptionService.renew
      Calls: PaymentGateway.charge, NotificationService.send, AuditLog.record
      Dependency Depth: 3

  CHANGE HISTORY
      Total Changes: 23
      Frequency: Several times per week
      Last Modified: 3 days ago

      Recent Changes:
        3 days ago - @alice - "Fix retry timeout handling"
        1 week ago - @alice - "Add idempotency key validation"
        2 weeks ago - @bob - "Improve error messages"

      Incident History:
        12 days ago - "Payment timeout during peak hours"
        Resolution: Increased timeout, added circuit breaker

  WARNINGS
      [HIGH] BUS_FACTOR
          Only @alice has significant experience with this code
          Consider pair programming or knowledge sharing sessions

      [MEDIUM] HIGH_CHURN
          23 changes in recent period - high churn
          Consider stabilizing the interface or adding more tests

===============================================================================
```

### Executive Summary (Full Report)

```
===============================================================================
  BUSINESS-AWARE TEST INTELLIGENCE REPORT
  Powered by Code-Synapse Knowledge Graph
===============================================================================

EXECUTIVE SUMMARY

  Test Health Score:        62%   [############........]
  Test Effectiveness:       54%   [##########..........]
  Business-Critical Coverage: 27%   [#####...............]

  Total Tests: 234  |  Production Functions: 890

  Risk Indicators:
    Mock Reliance:      HIGH    - Tests may not catch real integration issues
    Flaky Tests:        MEDIUM
    Incident History:   HIGH    - Code with past bugs needs attention
```

### Business-Critical Path Coverage

```
Business-Critical Path Coverage:
  Revenue-Critical: 12/45 (27%)
  User-Facing: 89/156 (57%)

  CRITICAL Untested Business Functions:
    [CRITICAL] processPayment
          src/services/payment/processor.ts
          "Handles all payment transactions and revenue collection"

    [CRITICAL] validateSubscription
          src/services/billing/subscription.ts
          "Validates user subscription status for premium features"

    [HIGH] createOrder
          src/services/orders/order-service.ts
          "Creates new customer orders"

  Coverage by Business Flow:
    Checkout/Payment: 27% (12/45)
          78% mocked - integration risk
    Authentication:   68% (34/50)
    User Management:  45% (23/51)
```

### Prioritized Recommendations

```
===============================================================================
PRIORITIZED RECOMMENDATIONS

  [!!!] 3 CRITICAL business functions have no tests
      Revenue-critical functions like processPayment are untested. This code has caused 6 incident(s)...
      Category: Coverage  | Effort: 6-12 story points  | Confidence: 85%
      Business Impact: Direct revenue risk - bugs in these functions affect transactions
      Estimated ROI: 2-4x based on incident prevention

  [!!!] 5 high-friction modules lack adequate tests
      PaymentProcessor has 4.2x modification friction and only 0% test coverage. This is a dangerous...
      Category: Modification Friction  | Effort: 1-2 story points per module  | Confidence: 78%
      Business Impact: Changes to these modules are risky and slow
      Estimated ROI: 4x productivity improvement

  [!!] 2 critical paths are over 80% mocked
      Payment Processing is 92% mocked. Integration failures won't be caught until production. As not...
      Category: Mock Reliance  | Effort: 6-10 story points for integration tests  | Confidence: 82%
      Business Impact: Service integration bugs reach production undetected

  [!!] 2 modules have high incident correlation
      services/payment has risk score 8 based on: 6 incident(s), Lacks adequate tests, Business layer...
      Category: Incident History  | Effort: 2-4 hours per module to improve test coverage  | Confidence: 75%
      Business Impact: These modules are the source of recurring incidents
      Estimated ROI: 60% incident reduction based on similar refactors

===============================================================================
  Report generated using Code-Synapse Knowledge Graph
  Based on BUSINESS-AWARE-TESTING.md methodology
===============================================================================
```

---

## API Endpoints Used

This MVP demonstrates integration with these Code-Synapse REST endpoints:

| Endpoint | Purpose | Analysis |
|----------|---------|----------|
| `GET /api/stats/overview` | Codebase statistics | Day 0 insights |
| `GET /api/functions` | List all functions with metadata | All analyses |
| `GET /api/functions/{id}/callers` | Get function callers | Coverage depth, blast radius |
| `GET /api/functions/{id}/callees` | Get function callees | Call chain analysis |
| `GET /api/classifications/stats` | Domain/Infrastructure breakdown | Business weighting |
| `GET /api/classifications/{id}` | Get entity classification | Business layer |
| `GET /api/justifications` | List business justifications | Context |
| `GET /api/justifications/{id}` | Get entity justification | Business value |
| `GET /api/ledger/recent` | Recent code changes | Flaky test correlation, experts |
| `GET /api/ledger/aggregations` | Change aggregations | Incident correlation |
| `GET /api/health` | API health status | Connectivity |

---

## Architecture

```
examples/capability6/
├── src/
│   ├── api/
│   │   └── client.ts                # API client for Code-Synapse REST endpoints
│   ├── reports/
│   │   ├── index.ts                 # Report exports
│   │   ├── business-coverage.ts     # Business-weighted coverage analysis
│   │   ├── risk-scoring.ts          # Risk assessment
│   │   ├── tech-debt-roi.ts         # Tech debt ROI calculation
│   │   ├── bus-factor.ts            # Bus factor analysis
│   │   ├── test-quality.ts          # Basic test quality heuristics
│   │   ├── test-intelligence.ts     # Advanced test analysis (knowledge graph)
│   │   ├── day0-insights.ts         # NEW: Instant insights, no config needed
│   │   ├── pr-risk-score.ts         # NEW: Transparent PR risk scoring
│   │   └── function-context.ts      # NEW: Full function knowledge context
│   └── index.ts                     # CLI entry point
├── package.json
├── tsconfig.json
└── README.md
```

### Report Modules

| Module | Lines | Purpose |
|--------|-------|---------|
| `test-intelligence.ts` | ~1700 | Core analysis using knowledge graph |
| `day0-insights.ts` | ~500 | Instant insights (god classes, hotspots, bus factor) |
| `pr-risk-score.ts` | ~600 | Transparent PR risk scoring with factors |
| `function-context.ts` | ~500 | Full function knowledge context |
| `business-coverage.ts` | ~200 | Business-weighted coverage |
| `risk-scoring.ts` | ~250 | Risk factor calculation |
| `tech-debt-roi.ts` | ~250 | Modification friction analysis |
| `bus-factor.ts` | ~200 | Knowledge concentration |
| `test-quality.ts` | ~400 | Basic heuristics |

---

## Methodology

Based on [BUSINESS-AWARE-TESTING.md](../../docs/BUSINESS-AWARE-TESTING.md), this MVP implements:

### 1. Day 0 Insights (Part 9)
Provide immediate value without configuration:
- **God Classes**: High complexity + many methods = needs refactoring
- **Modification Hotspots**: High churn + high complexity = danger zones
- **Bus Factor Risks**: Single contributor modules = knowledge silos
- **Health Score**: Overall codebase quality assessment

### 2. Business-Weighted Coverage
Traditional coverage treats all lines equally. Business-weighted coverage multiplies by business importance:

```
Business-Weighted Coverage = Σ (coverage × weight) / Σ weight
```

### 3. PR Risk Score (Part 2)
Transparent risk calculation with explicit factors:
```
Risk Score = Σ (factor_weight × factor_score)

Factors:
- Complexity of changes (15%)
- Business criticality (25%)
- Change frequency/churn (10%)
- Bus factor risk (15%)
- Historical incidents (20%)
- Test coverage gap (15%)
```

### 4. Function Knowledge Context (Parts 4 & 7)
Comprehensive context for any function:
- **Business Justification**: Why this code exists, what business value it provides
- **Experts**: Who has the most commits, when they were last active
- **Dependencies**: Call graph (callers and callees)
- **Change History**: Recent changes, linked tickets, incidents
- **Warnings**: Risks that need attention

### 5. Mock Trap Detection
From the doc: *"Mocks hide the real behavior of your system."*

Detects when business-critical paths are tested only with mocked dependencies:
- Revenue-critical code with >80% mock reliance = HIGH risk
- Domain-to-domain function calls without integration tests = Gap

### 6. Flaky Test Correlation
Uses the Change Ledger to correlate:
- High-churn entities with test instability
- Code changes with test failures
- Time-based failure patterns

### 7. Coverage Depth via Call Graph
Uses call graph to detect shallow tests:
```
Test complexity < 3 && Target has dependencies = Shallow
```

### 8. Incident Correlation
Links past incidents to code modules:
- Modules with incidents + low coverage = CRITICAL
- Bug introduction rate = incidents / changes

### 9. Modification Friction
```
Modification Friction = Complexity × Churn × (1 / Test Coverage)
```

High friction = risky to change.

---

## Limitations

This is an MVP demonstration. Current limitations:

1. **Test Coverage Integration**: Uses heuristics instead of actual Istanbul/nyc/c8 coverage data. A production implementation would parse actual coverage reports.

2. **Assertion Analysis**: Estimates assertion effectiveness from test complexity. Production would parse test ASTs to count actual assertions.

3. **Mock Detection**: Uses path/name heuristics. Production would parse jest.mock/vi.mock calls.

4. **Incident Data**: Uses ledger events as proxy for incidents. Production would integrate with PagerDuty/Datadog/Sentry.

5. **Author Attribution**: Extracts authors from ledger metadata. Production would use git blame.

6. **PR Integration**: PR risk score uses simulated data. Production would integrate with GitHub/GitLab APIs.

---

## Production Implementation Path

To build a production-ready Business-Aware Testing platform:

### Phase 1: Real Coverage Integration
```typescript
// Integrate with Istanbul/nyc coverage reports
interface CoverageData {
  filePath: string;
  lines: Record<number, number>;  // line -> hit count
  functions: Record<string, number>;  // function -> hit count
}

// Map coverage to knowledge graph entities
for (const fn of functions) {
  const coverage = coverageData[fn.filePath]?.functions[fn.name];
  fn.actualCoverage = coverage;
}
```

### Phase 2: AST-Based Test Analysis
```typescript
// Parse test files to analyze assertions
import { parse } from '@babel/parser';

function analyzeTestFile(code: string) {
  const ast = parse(code);
  const assertions = findNodes(ast, 'expect', 'assert', 'should');
  const mocks = findNodes(ast, 'jest.mock', 'vi.mock', 'sinon.stub');

  return {
    assertionCount: assertions.length,
    mockCount: mocks.length,
    mockedModules: extractMockedModules(mocks),
  };
}
```

### Phase 3: Incident Tracking Integration
```typescript
// Connect to PagerDuty/Datadog for real incident data
interface IncidentData {
  id: string;
  severity: 'P1' | 'P2' | 'P3' | 'P4';
  affectedServices: string[];
  rootCause?: {
    commit: string;
    files: string[];
  };
}

// Correlate incidents with code changes
const incidents = await pagerduty.getIncidents({ timeRange: '30d' });
for (const incident of incidents) {
  const affectedCode = await correlateToCode(incident);
  // Update risk scores
}
```

### Phase 4: CI/CD Integration
```yaml
# GitHub Actions example
- name: Business-Aware Test Analysis
  run: |
    bat test-intelligence --json > analysis.json
    bat check-gates --critical-coverage 80 --mock-reliance 50

- name: PR Risk Assessment
  run: |
    bat pr-risk --json > pr-risk.json
    # Block merge if risk > threshold

- name: PR Comment
  uses: actions/github-script@v6
  with:
    script: |
      const analysis = require('./analysis.json');
      const risk = require('./pr-risk.json');
      // Post summary as PR comment
```

---

## Related Documentation

- [BUSINESS-AWARE-TESTING.md](../../docs/BUSINESS-AWARE-TESTING.md) - Full capability specification
- [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) - Code-Synapse architecture
- [HOW-IT-WORKS.md](../../docs/HOW-IT-WORKS.md) - Knowledge graph concepts

---

## License

MIT - Part of Code-Synapse

---

*This MVP is part of Code-Synapse's Capability Group 6: Business-Aware Testing.*

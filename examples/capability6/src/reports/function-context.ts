/**
 * Function Knowledge Context
 *
 * From BUSINESS-AWARE-TESTING.md Part 4 & Part 7
 *
 * "When someone needs to modify this code, they have context. They know why
 * it exists. They know who to ask. They know what broke last time."
 *
 * This module provides comprehensive context for any function:
 *
 * FUNCTION: PaymentProcessor.handleRetry()
 *
 * Business Justification:
 *   "Handles retry logic for failed payments in checkout flow.
 *    Critical for revenue recovery—retries capture ~15% of
 *    initially failed transactions."
 *
 * Origin:
 *   • Created in JIRA-1234 (2023-03)
 *   • Reason: Duplicate charge bug required idempotent design
 *   • Original author: @alice (still at company)
 *
 * Experts:
 *   • @alice: 47 commits, last change 2 weeks ago
 *   • @bob: 12 commits, focuses on retry limits
 *
 * Dependencies:
 *   • Called by: CheckoutService, SubscriptionService
 *   • Calls: PaymentGateway, NotificationService, AuditLog
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

export interface FunctionContextReport {
  functions: FunctionContext[];
  summary: {
    totalFunctions: number;
    withJustification: number;
    withExperts: number;
    averageExpertCount: number;
  };
}

export interface FunctionContext {
  // Basic Info
  id: string;
  name: string;
  signature: string;
  filePath: string;
  lineNumber?: number;
  complexity: number;
  lineCount: number;

  // Business Context
  businessJustification: BusinessJustificationContext;

  // Classification
  classification: ClassificationContext;

  // Origin & History
  origin: OriginContext;

  // Experts
  experts: Expert[];

  // Dependencies
  dependencies: DependencyContext;

  // Change History
  changeHistory: ChangeContext;

  // Risks & Warnings
  warnings: Warning[];
}

export interface BusinessJustificationContext {
  purposeSummary: string;
  featureContext: string;
  businessValue: string;
  confidenceScore: number;
  isGenerated: boolean;
  lastUpdated?: string;
}

export interface ClassificationContext {
  category: "domain" | "infrastructure" | "unknown";
  subCategory?: string;
  businessLayer: "revenue-critical" | "user-facing" | "internal" | "infrastructure";
  confidenceScore: number;
}

export interface OriginContext {
  createdDate?: string;
  createdBy?: string;
  originalReason?: string;
  linkedTicket?: string;
  isOriginalAuthorActive: boolean;
}

export interface Expert {
  name: string;
  commitCount: number;
  lastActive: string;
  focus?: string; // What aspect they focus on
  isAvailable: boolean;
  contactRecommendation: string;
}

export interface DependencyContext {
  calledBy: DependencyInfo[];
  calls: DependencyInfo[];
  imports: string[];
  dependencyDepth: number;
}

export interface DependencyInfo {
  name: string;
  filePath: string;
  businessLayer?: string;
  isBusinessCritical: boolean;
}

export interface ChangeContext {
  totalChanges: number;
  recentChanges: RecentChange[];
  changeFrequency: string;
  lastModified?: string;
  incidentHistory: IncidentInfo[];
}

export interface RecentChange {
  date: string;
  author: string;
  description: string;
  linkedPR?: string;
  linkedTicket?: string;
  hadIncident: boolean;
}

export interface IncidentInfo {
  date: string;
  description: string;
  resolution?: string;
  preventionMeasure?: string;
}

export interface Warning {
  type: "BUS_FACTOR" | "STALE_JUSTIFICATION" | "HIGH_CHURN" | "INCIDENT_PRONE" | "UNDOCUMENTED";
  severity: "HIGH" | "MEDIUM" | "LOW";
  message: string;
  recommendation: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

function inferBusinessLayer(
  classification?: Classification,
  justification?: Justification,
  filePath?: string
): "revenue-critical" | "user-facing" | "internal" | "infrastructure" {
  const path = filePath?.toLowerCase() || "";

  // Check for revenue-critical patterns
  if (
    path.includes("payment") ||
    path.includes("checkout") ||
    path.includes("billing") ||
    path.includes("transaction") ||
    path.includes("order")
  ) {
    return "revenue-critical";
  }

  // Check classification
  if (classification?.category === "domain") {
    const area = classification.domainMetadata?.area?.toLowerCase() || "";
    if (area.includes("payment") || area.includes("checkout") || area.includes("billing")) {
      return "revenue-critical";
    }
    return "user-facing";
  }

  if (classification?.category === "infrastructure") {
    return "infrastructure";
  }

  // Check for internal patterns
  if (path.includes("admin") || path.includes("internal") || path.includes("reporting")) {
    return "internal";
  }

  return "user-facing";
}

function categorizeChangeFrequency(changeCount: number): string {
  if (changeCount >= 20) return "Very High (daily)";
  if (changeCount >= 10) return "High (several times/week)";
  if (changeCount >= 5) return "Moderate (weekly)";
  if (changeCount >= 2) return "Low (bi-weekly)";
  return "Stable (monthly or less)";
}

function inferExpertFocus(entries: LedgerEntry[]): string | undefined {
  const keywords = new Map<string, number>();

  for (const entry of entries) {
    const text = String(entry.metadata?.message || entry.metadata?.title || "").toLowerCase();

    if (text.includes("fix") || text.includes("bug")) keywords.set("bug fixes", (keywords.get("bug fixes") || 0) + 1);
    if (text.includes("refactor")) keywords.set("refactoring", (keywords.get("refactoring") || 0) + 1);
    if (text.includes("test")) keywords.set("testing", (keywords.get("testing") || 0) + 1);
    if (text.includes("feature") || text.includes("add")) keywords.set("features", (keywords.get("features") || 0) + 1);
    if (text.includes("performance") || text.includes("optimize")) keywords.set("performance", (keywords.get("performance") || 0) + 1);
  }

  const sorted = Array.from(keywords.entries()).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0];
}

// =============================================================================
// Main Report Generator
// =============================================================================

export async function generateFunctionContextReport(
  client: CodeSynapseClient,
  functionIds?: string[],
  limit: number = 20
): Promise<FunctionContextReport> {
  // Fetch all necessary data
  const [allFunctions, ledgerEntries, justificationsList] = await Promise.all([
    client.listFunctions({ limit: 5000 }),
    client.getRecentLedgerEntries(500).catch(() => []),
    client.listJustifications({ limit: 2000 }).catch(() => []),
  ]);

  // Filter to specific functions if provided, otherwise pick most important
  let targetFunctions: FunctionInfo[];

  if (functionIds && functionIds.length > 0) {
    targetFunctions = allFunctions.filter((fn) => functionIds.includes(fn.id));
  } else {
    // Pick functions by complexity and caller count (most important)
    targetFunctions = allFunctions
      .filter(
        (fn) =>
          !fn.filePath.includes("__tests__") &&
          !fn.filePath.includes(".test.") &&
          !fn.filePath.includes(".spec.")
      )
      .sort((a, b) => {
        const scoreA = (a.complexity || 0) * 2 + (a.callerCount || 0);
        const scoreB = (b.complexity || 0) * 2 + (b.callerCount || 0);
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  // Build lookup maps
  const justificationsMap = new Map<string, Justification>();
  for (const j of justificationsList) {
    justificationsMap.set(j.entityId, j);
  }

  // Group ledger entries by entity
  const ledgerByEntity = new Map<string, LedgerEntry[]>();
  for (const entry of ledgerEntries) {
    for (const entityId of entry.entityIds || []) {
      if (!ledgerByEntity.has(entityId)) {
        ledgerByEntity.set(entityId, []);
      }
      ledgerByEntity.get(entityId)!.push(entry);
    }
  }

  // Build function contexts
  const functionContexts: FunctionContext[] = [];

  for (const fn of targetFunctions) {
    // Fetch additional data for this function
    let classification: Classification | null = null;
    let callers: FunctionInfo[] = [];
    let callees: FunctionInfo[] = [];

    try {
      [classification, callers, callees] = await Promise.all([
        client.getClassification(fn.id).catch(() => null),
        client.getFunctionCallers(fn.id).catch(() => []),
        client.getFunctionCallees(fn.id).catch(() => []),
      ]);
    } catch {
      // Continue with partial data
    }

    const justification = justificationsMap.get(fn.id);
    const entityLedger = ledgerByEntity.get(fn.id) || [];

    // Build expert list
    const authorCommits = new Map<string, { count: number; entries: LedgerEntry[] }>();
    for (const entry of entityLedger) {
      const author = String(entry.metadata?.author || entry.metadata?.user || "unknown");
      if (!authorCommits.has(author)) {
        authorCommits.set(author, { count: 0, entries: [] });
      }
      const data = authorCommits.get(author)!;
      data.count++;
      data.entries.push(entry);
    }

    const experts: Expert[] = Array.from(authorCommits.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([name, data]) => {
        const lastEntry = data.entries.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )[0];

        return {
          name,
          commitCount: data.count,
          lastActive: lastEntry?.timestamp || "unknown",
          focus: inferExpertFocus(data.entries),
          isAvailable: true, // Would come from HR/team data
          contactRecommendation:
            data.count > 10
              ? `${name} is the domain expert - reach out before major changes`
              : `${name} can provide context`,
        };
      });

    // Build change history
    const incidentEntries = entityLedger.filter(
      (e) =>
        e.eventType.includes("incident") ||
        e.eventType.includes("error") ||
        e.eventType.includes("bug")
    );

    const recentChanges: RecentChange[] = entityLedger
      .filter((e) => e.eventType.includes("change") || e.eventType.includes("commit"))
      .slice(0, 5)
      .map((e) => ({
        date: e.timestamp,
        author: String(e.metadata?.author || "unknown"),
        description: String(e.metadata?.message || e.metadata?.title || "Code change"),
        linkedPR: e.metadata?.pr ? String(e.metadata.pr) : undefined,
        linkedTicket: e.metadata?.ticket ? String(e.metadata.ticket) : undefined,
        hadIncident: incidentEntries.some(
          (inc) => new Date(inc.timestamp) > new Date(e.timestamp)
        ),
      }));

    // Determine business layer
    const businessLayer = inferBusinessLayer(classification || undefined, justification, fn.filePath);

    // Build warnings
    const warnings: Warning[] = [];

    // Bus factor warning
    if (experts.length === 1 && experts[0].commitCount > 5) {
      warnings.push({
        type: "BUS_FACTOR",
        severity: "HIGH",
        message: `Only ${experts[0].name} has significant experience with this code`,
        recommendation: "Consider pair programming or knowledge sharing sessions",
      });
    }

    // High churn warning
    if (entityLedger.length > 15) {
      warnings.push({
        type: "HIGH_CHURN",
        severity: "MEDIUM",
        message: `${entityLedger.length} changes in recent period - high churn`,
        recommendation: "Consider stabilizing the interface or adding more tests",
      });
    }

    // Incident prone warning
    if (incidentEntries.length > 0) {
      warnings.push({
        type: "INCIDENT_PRONE",
        severity: incidentEntries.length > 2 ? "HIGH" : "MEDIUM",
        message: `${incidentEntries.length} incident(s) linked to this code`,
        recommendation: "Review past incidents before making changes",
      });
    }

    // Undocumented warning
    if (!justification && businessLayer === "revenue-critical") {
      warnings.push({
        type: "UNDOCUMENTED",
        severity: "MEDIUM",
        message: "Revenue-critical code without business justification",
        recommendation: "Run `code-synapse justify` to generate documentation",
      });
    }

    const context: FunctionContext = {
      id: fn.id,
      name: fn.name,
      signature: `${fn.name}()`,
      filePath: fn.filePath,
      lineNumber: fn.startLine,
      complexity: fn.complexity || 1,
      lineCount: (fn.endLine - fn.startLine) || 0,

      businessJustification: {
        purposeSummary: justification?.purposeSummary || "No justification generated",
        featureContext: justification?.featureContext || "Unknown",
        businessValue: justification?.businessValue || "Unknown business value",
        confidenceScore: justification?.confidenceScore || 0,
        isGenerated: !!justification,
        lastUpdated: undefined, // Not available in current API
      },

      classification: {
        category: (classification?.category as "domain" | "infrastructure") || "unknown",
        subCategory: classification?.domainMetadata?.area || classification?.infrastructureMetadata?.layer,
        businessLayer,
        confidenceScore: classification?.confidence || 0,
      },

      origin: {
        createdDate: recentChanges[recentChanges.length - 1]?.date,
        createdBy: experts[experts.length - 1]?.name,
        originalReason: recentChanges[recentChanges.length - 1]?.description,
        linkedTicket: recentChanges[recentChanges.length - 1]?.linkedTicket,
        isOriginalAuthorActive: true, // Would come from HR data
      },

      experts,

      dependencies: {
        calledBy: callers.slice(0, 5).map((c) => ({
          name: c.name,
          filePath: c.filePath,
          businessLayer: inferBusinessLayer(undefined, undefined, c.filePath),
          isBusinessCritical: c.filePath.includes("payment") || c.filePath.includes("checkout"),
        })),
        calls: callees.slice(0, 5).map((c) => ({
          name: c.name,
          filePath: c.filePath,
          businessLayer: inferBusinessLayer(undefined, undefined, c.filePath),
          isBusinessCritical: c.filePath.includes("payment") || c.filePath.includes("checkout"),
        })),
        imports: [], // Would come from semantic analysis
        dependencyDepth: callees.length,
      },

      changeHistory: {
        totalChanges: entityLedger.length,
        recentChanges,
        changeFrequency: categorizeChangeFrequency(entityLedger.length),
        lastModified: recentChanges[0]?.date,
        incidentHistory: incidentEntries.slice(0, 3).map((e) => ({
          date: e.timestamp,
          description: String(e.metadata?.description || "Incident"),
          resolution: e.metadata?.resolution ? String(e.metadata.resolution) : undefined,
          preventionMeasure: e.metadata?.prevention ? String(e.metadata.prevention) : undefined,
        })),
      },

      warnings,
    };

    functionContexts.push(context);
  }

  // Calculate summary
  const withJustification = functionContexts.filter((f) => f.businessJustification.isGenerated).length;
  const withExperts = functionContexts.filter((f) => f.experts.length > 0).length;
  const totalExperts = functionContexts.reduce((sum, f) => sum + f.experts.length, 0);

  return {
    functions: functionContexts,
    summary: {
      totalFunctions: functionContexts.length,
      withJustification,
      withExperts,
      averageExpertCount: functionContexts.length > 0 ? totalExperts / functionContexts.length : 0,
    },
  };
}

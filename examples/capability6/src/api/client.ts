/**
 * Code-Synapse API Client
 *
 * A TypeScript client for interacting with Code-Synapse REST API endpoints.
 */

export interface ApiClientConfig {
  baseUrl: string;
  timeout?: number;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface OverviewStats {
  totalFiles: number;
  totalFunctions: number;
  totalClasses: number;
  totalInterfaces: number;
  totalRelationships: number;
  languages: Record<string, number>;
}

export interface FunctionInfo {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  complexity?: number;
  callerCount?: number;
  calleeCount?: number;
  confidence?: number;
  justification?: string;
  classification?: string;
  subCategory?: string;
}

export interface ClassificationStats {
  total: number;
  byCategory: {
    domain: number;
    infrastructure: number;
    unknown: number;
  };
  bySubCategory: Record<string, number>;
}

export interface Classification {
  entityId: string;
  category: "domain" | "infrastructure" | "unknown";
  domainMetadata?: {
    area: string;
    subArea?: string;
    businessValue?: string;
  };
  infrastructureMetadata?: {
    layer: string;
    purpose?: string;
  };
  confidence: number;
}

export interface JustificationStats {
  total: number;
  byConfidence: {
    high: number;
    medium: number;
    low: number;
  };
  bySource: {
    inferred: number;
    manual: number;
    pending: number;
  };
  coverage: number;
}

export interface Justification {
  entityId: string;
  entityName: string;
  purposeSummary: string;
  featureContext?: string;
  businessValue?: string;
  confidenceScore: number;
  userConfirmed: boolean;
  propagatedFrom?: string;
}

export interface LedgerStats {
  entryCount: number;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
  currentSequence: number;
}

export interface LedgerEntry {
  id: string;
  eventType: string;
  timestamp: string;
  source: string;
  entityIds: string[];
  metadata: Record<string, unknown>;
}

export interface LedgerAggregations {
  byEventType: Record<string, number>;
  bySource: Record<string, number>;
  byEntity: Array<{ entityId: string; count: number }>;
}

export interface AdaptiveStats {
  totalQueries: number;
  totalChanges: number;
  hotEntityCount: number;
  coldEntityCount: number;
  isPaused: boolean;
}

export interface HotColdEntity {
  entityId: string;
  entityName?: string;
  heatScore: number;
  queryCount: number;
  changeCount: number;
  lastAccessed: string;
}

export interface MemoryRule {
  id: string;
  pattern: string;
  description: string;
  scope: string;
  category: string;
  confidence: number;
  evidenceCount: number;
  isActive: boolean;
}

export interface ComplexityDistribution {
  simple: number;    // complexity 1-5
  moderate: number;  // complexity 6-10
  complex: number;   // complexity 11-20
  veryComplex: number; // complexity 21+
}

// =============================================================================
// API Client
// =============================================================================

export class CodeSynapseClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeout = config.timeout ?? 30000;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
        throw new Error(`API Error ${response.status}: ${errorData.error || response.statusText}`);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  async getOverviewStats(): Promise<OverviewStats> {
    return this.fetch<OverviewStats>("/api/stats/overview");
  }

  async getComplexityDistribution(): Promise<ComplexityDistribution> {
    return this.fetch<ComplexityDistribution>("/api/stats/complexity");
  }

  // ===========================================================================
  // Functions
  // ===========================================================================

  async listFunctions(options?: {
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDirection?: "asc" | "desc";
  }): Promise<FunctionInfo[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    if (options?.orderBy) params.set("orderBy", options.orderBy);
    if (options?.orderDirection) params.set("orderDirection", options.orderDirection);

    return this.fetch<FunctionInfo[]>(`/api/functions?${params}`);
  }

  async getMostComplexFunctions(limit: number = 20): Promise<FunctionInfo[]> {
    return this.fetch<FunctionInfo[]>(`/api/functions/most-complex?limit=${limit}`);
  }

  async getMostCalledFunctions(limit: number = 20): Promise<FunctionInfo[]> {
    return this.fetch<FunctionInfo[]>(`/api/functions/most-called?limit=${limit}`);
  }

  async getFunction(id: string): Promise<FunctionInfo | null> {
    try {
      return await this.fetch<FunctionInfo>(`/api/functions/${encodeURIComponent(id)}`);
    } catch {
      return null;
    }
  }

  async getFunctionCallers(id: string): Promise<FunctionInfo[]> {
    return this.fetch<FunctionInfo[]>(`/api/functions/${encodeURIComponent(id)}/callers`);
  }

  async getFunctionCallees(id: string): Promise<FunctionInfo[]> {
    return this.fetch<FunctionInfo[]>(`/api/functions/${encodeURIComponent(id)}/callees`);
  }

  // ===========================================================================
  // Classifications
  // ===========================================================================

  async getClassificationStats(): Promise<ClassificationStats> {
    return this.fetch<ClassificationStats>("/api/classifications/stats");
  }

  async listClassifications(options?: {
    category?: "domain" | "infrastructure";
    limit?: number;
    offset?: number;
    minConfidence?: number;
  }): Promise<Classification[] | { domain: Classification[]; infrastructure: Classification[] }> {
    const params = new URLSearchParams();
    if (options?.category) params.set("category", options.category);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    if (options?.minConfidence) params.set("minConfidence", String(options.minConfidence));

    return this.fetch(`/api/classifications?${params}`);
  }

  async getClassificationsByDomain(area: string, limit: number = 100): Promise<Classification[]> {
    return this.fetch<Classification[]>(`/api/classifications/domain/${encodeURIComponent(area)}?limit=${limit}`);
  }

  async getClassificationsByInfrastructure(layer: string, limit: number = 100): Promise<Classification[]> {
    return this.fetch<Classification[]>(`/api/classifications/infrastructure/${encodeURIComponent(layer)}?limit=${limit}`);
  }

  async getClassification(entityId: string): Promise<Classification | null> {
    try {
      return await this.fetch<Classification>(`/api/classifications/${encodeURIComponent(entityId)}`);
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Justifications
  // ===========================================================================

  async getJustificationStats(): Promise<JustificationStats> {
    return this.fetch<JustificationStats>("/api/justifications/stats");
  }

  async listJustifications(options?: {
    limit?: number;
    offset?: number;
  }): Promise<Justification[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));

    return this.fetch<Justification[]>(`/api/justifications?${params}`);
  }

  async getJustification(entityId: string): Promise<Justification | null> {
    try {
      return await this.fetch<Justification>(`/api/justifications/${encodeURIComponent(entityId)}`);
    } catch {
      return null;
    }
  }

  async getFeatureAreas(): Promise<Array<{ name: string; count: number }>> {
    return this.fetch<Array<{ name: string; count: number }>>("/api/justifications/features");
  }

  async getLowConfidenceEntities(limit: number = 50): Promise<Justification[]> {
    return this.fetch<Justification[]>(`/api/justifications/low-confidence?limit=${limit}`);
  }

  // ===========================================================================
  // Change Ledger
  // ===========================================================================

  async getLedgerStats(): Promise<LedgerStats> {
    return this.fetch<LedgerStats>("/api/ledger/stats");
  }

  async getRecentLedgerEntries(limit: number = 50): Promise<LedgerEntry[]> {
    return this.fetch<LedgerEntry[]>(`/api/ledger/recent?limit=${limit}`);
  }

  async getLedgerAggregations(options?: {
    startTime?: string;
    endTime?: string;
  }): Promise<LedgerAggregations> {
    const params = new URLSearchParams();
    if (options?.startTime) params.set("startTime", options.startTime);
    if (options?.endTime) params.set("endTime", options.endTime);

    return this.fetch<LedgerAggregations>(`/api/ledger/aggregations?${params}`);
  }

  async getLedgerForEntity(entityId: string, limit: number = 50): Promise<LedgerEntry[]> {
    return this.fetch<LedgerEntry[]>(`/api/ledger/entity/${encodeURIComponent(entityId)}?limit=${limit}`);
  }

  // ===========================================================================
  // Adaptive Indexer
  // ===========================================================================

  async getAdaptiveStats(): Promise<AdaptiveStats> {
    return this.fetch<AdaptiveStats>("/api/adaptive/stats");
  }

  async getHotEntities(limit: number = 20): Promise<HotColdEntity[]> {
    return this.fetch<HotColdEntity[]>(`/api/adaptive/hot?limit=${limit}`);
  }

  async getColdEntities(limit: number = 20): Promise<HotColdEntity[]> {
    return this.fetch<HotColdEntity[]>(`/api/adaptive/cold?limit=${limit}`);
  }

  // ===========================================================================
  // Project Memory
  // ===========================================================================

  async getMemoryStats(): Promise<{ totalRules: number; activeRules: number }> {
    return this.fetch("/api/memory/stats");
  }

  async listMemoryRules(options?: {
    limit?: number;
    scope?: string;
    category?: string;
    isActive?: boolean;
  }): Promise<MemoryRule[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.scope) params.set("scope", options.scope);
    if (options?.category) params.set("category", options.category);
    if (options?.isActive !== undefined) params.set("isActive", String(options.isActive));

    return this.fetch<MemoryRule[]>(`/api/memory/rules?${params}`);
  }

  // ===========================================================================
  // Health
  // ===========================================================================

  async checkHealth(): Promise<{ status: string; components: Record<string, { status: string }> }> {
    return this.fetch("/api/health");
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createClient(baseUrl: string = "http://localhost:3100"): CodeSynapseClient {
  return new CodeSynapseClient({ baseUrl });
}

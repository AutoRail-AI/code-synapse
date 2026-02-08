/**
 * API Client for Code-Synapse Backend
 *
 * All endpoints are relative to /api and proxy through Vite in dev mode.
 * In production, the built static files are served alongside the API.
 */

const BASE_URL = '/api';

// Generic fetch wrapper with error handling
async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// ============================================================================
// Stats & Overview
// ============================================================================

export interface OverviewStats {
  totalFiles: number;
  totalFunctions: number;
  totalClasses: number;
  totalInterfaces: number;
  totalVariables: number;
  totalRelationships: number;
  languages: Record<string, number>;
}

export async function getOverviewStats(): Promise<OverviewStats> {
  return fetchApi<OverviewStats>('/stats/overview');
}

export async function getLanguageStats(): Promise<Record<string, number>> {
  return fetchApi<Record<string, number>>('/stats/languages');
}

export async function getComplexityStats(): Promise<{
  distribution: Record<string, number>;
  mostComplex: Array<{ name: string; complexity: number; file: string }>;
}> {
  return fetchApi('/stats/complexity');
}

// ============================================================================
// Files
// ============================================================================

export interface FileInfo {
  path: string;
  language: string;
  entityCount: number;
  lastModified: string;
}

export interface FileTree {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTree[];
  entityCount?: number;
}

export async function getFiles(params?: {
  limit?: number;
  offset?: number;
  language?: string;
}): Promise<FileInfo[]> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  if (params?.language) searchParams.set('language', params.language);
  const query = searchParams.toString();
  return fetchApi<FileInfo[]>(`/files${query ? `?${query}` : ''}`);
}

export async function getFileTree(): Promise<FileTree[]> {
  return fetchApi<FileTree[]>('/files/tree');
}

export async function getFileContent(path: string): Promise<string> {
  // File content is returned as plain text
  const url = `${BASE_URL}/files/content?path=${encodeURIComponent(path)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file content: ${response.statusText}`);
  }
  return response.text();
}

export async function getFileEntities(path: string): Promise<EntitySummary[]> {
  return fetchApi<EntitySummary[]>(`/files/entities?path=${encodeURIComponent(path)}`);
}

// ============================================================================
// Entities
// ============================================================================

export interface EntitySummary {
  id: string;
  name: string;
  kind: 'function' | 'class' | 'interface' | 'variable' | 'file';
  filePath: string;
  startLine: number;
  endLine: number;
  confidence?: number;
  justification?: string;
  classification?: 'domain' | 'infrastructure';
  subCategory?: string;
  // Additional justification fields for rich display
  businessValue?: string;
  featureContext?: string;
  detailedDescription?: string;
  tags?: string[];
}

export interface EntityDetail extends EntitySummary {
  signature?: string;
  docstring?: string;
  parameters?: Array<{ name: string; type?: string }>;
  returnType?: string;
  relationships: Array<{
    type: string;
    target: string;
    targetKind: string;
  }>;
}

export async function getFunctions(params?: {
  limit?: number;
  offset?: number;
  file?: string;
}): Promise<EntitySummary[]> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  if (params?.file) searchParams.set('file', params.file);
  const query = searchParams.toString();
  return fetchApi<EntitySummary[]>(`/functions${query ? `?${query}` : ''}`);
}

export async function getClasses(params?: {
  limit?: number;
  offset?: number;
}): Promise<EntitySummary[]> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const query = searchParams.toString();
  return fetchApi<EntitySummary[]>(`/classes${query ? `?${query}` : ''}`);
}

export async function getInterfaces(params?: {
  limit?: number;
  offset?: number;
}): Promise<EntitySummary[]> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const query = searchParams.toString();
  return fetchApi<EntitySummary[]>(`/interfaces${query ? `?${query}` : ''}`);
}

export async function getEntityById(id: string): Promise<EntityDetail> {
  return fetchApi<EntityDetail>(`/entities/${encodeURIComponent(id)}`);
}

export async function getEntityRelationships(
  id: string
): Promise<Array<{ type: string; target: EntitySummary }>> {
  return fetchApi(`/entities/${encodeURIComponent(id)}/relationships`);
}

// ============================================================================
// Entity Full Detail (combined fetch)
// ============================================================================

export interface EntityFullDetail {
  entity: EntityDetail;
  justification: {
    entityId: string;
    purposeSummary?: string;
    featureContext?: string;
    businessValue?: string;
    confidence?: number;
  } | null;
  classification: {
    entityId: string;
    category?: string;
    subCategory?: string;
    confidence?: number;
  } | null;
}

export async function getEntityFullDetail(entityId: string): Promise<EntityFullDetail> {
  const [entity, justification, classification] = await Promise.all([
    getEntityById(entityId),
    fetchApi<EntityFullDetail["justification"]>(`/justifications/${encodeURIComponent(entityId)}`).catch(() => null),
    fetchApi<EntityFullDetail["classification"]>(`/classifications/${encodeURIComponent(entityId)}`).catch(() => null),
  ]);
  return { entity, justification, classification };
}

// ============================================================================
// Search
// ============================================================================

export interface SearchResult {
  entity: EntitySummary;
  score: number;
  highlights?: string[];
}

export async function searchNatural(query: string): Promise<SearchResult[]> {
  return fetchApi<SearchResult[]>(`/search/natural?q=${encodeURIComponent(query)}`);
}

export async function searchSemantic(query: string, limit?: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (limit) params.set('limit', String(limit));
  return fetchApi<SearchResult[]>(`/search/semantic?${params}`);
}

export async function searchExact(pattern: string): Promise<SearchResult[]> {
  return fetchApi<SearchResult[]>(`/search/exact?pattern=${encodeURIComponent(pattern)}`);
}

// ============================================================================
// Hybrid Search (Phase 5 / Phase 6)
// ============================================================================

export interface HybridSearchResult {
  source: "semantic" | "lexical";
  score: number;
  filePath: string;
  entityId?: string;
  name?: string;
  entityType?: string;
  snippet?: string;
  lineNumber?: number;
  justification?: {
    purposeSummary?: string;
    featureContext?: string;
    businessValue?: string;
    confidence?: number;
  };
  patterns?: string[];
  /** Business importance lifted from justification for easy UI access. */
  businessValue?: string;
  /** Incoming call count — how many entities reference this one. */
  popularity?: number;
  /** Top callers for "Used By" display (max 3). */
  relatedCode?: Array<{ name: string; filePath: string; relation: "caller" }>;
}

export interface HybridSearchCitation {
  index: number;
  filePath: string;
  lineNumber?: number;
  snippet?: string;
  justification?: string;
}

export interface HybridSearchSummary {
  answer: string;
  citations: HybridSearchCitation[];
  modelUsed: string;
  timestamp: string;
}

export interface HybridSearchResponse {
  summary: HybridSearchSummary | null;
  results: HybridSearchResult[];
  meta?: {
    semanticCount?: number;
    lexicalCount?: number;
    queryType?: "question" | "keyword";
    processingTimeMs?: number;
    sources?: ("semantic" | "lexical")[];
  };
}

export interface HybridSearchOptions {
  businessContext?: string;
  limit?: number;
  enableSynthesis?: boolean;
}

export async function searchHybrid(
  query: string,
  options: HybridSearchOptions = {}
): Promise<HybridSearchResponse> {
  return fetchApi<HybridSearchResponse>("/search/hybrid", {
    method: "POST",
    body: JSON.stringify({ query, ...options }),
  });
}

// ============================================================================
// Graph / Relationships
// ============================================================================

export interface GraphData {
  nodes: Array<{
    id: string;
    label: string;
    kind: string;
    confidence?: number;
    classification?: string;
    direction?: 'root' | 'outgoing' | 'incoming';
  }>;
  edges: Array<{
    source: string;
    target: string;
    kind: string;  // API returns 'kind' not 'type'
  }>;
}

export async function getGraphData(params?: {
  centerEntity?: string;
  depth?: number;
  kinds?: string[];
}): Promise<GraphData> {
  const searchParams = new URLSearchParams();
  if (params?.centerEntity) searchParams.set('center', params.centerEntity);
  if (params?.depth) searchParams.set('depth', String(params.depth));
  if (params?.kinds) searchParams.set('kinds', params.kinds.join(','));
  const query = searchParams.toString();
  return fetchApi<GraphData>(`/graph${query ? `?${query}` : ''}`);
}

export async function getCallGraph(functionId: string, depth?: number): Promise<GraphData> {
  const params = new URLSearchParams({ id: functionId });
  if (depth) params.set('depth', String(depth));
  return fetchApi<GraphData>(`/graph/calls?${params}`);
}

export async function getDependencyGraph(fileOrEntity: string): Promise<GraphData> {
  return fetchApi<GraphData>(`/graph/dependencies?id=${encodeURIComponent(fileOrEntity)}`);
}

// ============================================================================
// Justifications
// ============================================================================

export interface Justification {
  entityId: string;
  justification: string;
  confidence: number;
  source: 'inferred' | 'propagated' | 'manual';
  lastUpdated: string;
}

export async function getJustifications(params?: {
  confidence?: 'high' | 'medium' | 'low' | 'uncertain';
  limit?: number;
}): Promise<Justification[]> {
  const searchParams = new URLSearchParams();
  if (params?.confidence) searchParams.set('confidence', params.confidence);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return fetchApi<Justification[]>(`/justifications${query ? `?${query}` : ''}`);
}

export async function getJustificationStats(): Promise<{
  total: number;
  byConfidence: Record<string, number>;
  bySource: Record<string, number>;
  coverage: number;
}> {
  return fetchApi('/justifications/stats');
}

// ============================================================================
// Classifications
// ============================================================================

export interface Classification {
  entityId: string;
  category: 'domain' | 'infrastructure';
  subCategory: string;
  confidence: number;
}

export async function getClassifications(params?: {
  category?: 'domain' | 'infrastructure';
  limit?: number;
}): Promise<Classification[]> {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set('category', params.category);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return fetchApi<Classification[]>(`/classifications${query ? `?${query}` : ''}`);
}

export async function getClassificationStats(): Promise<{
  total: number;
  byCategory: Record<string, number>;
  bySubCategory: Record<string, number>;
}> {
  return fetchApi('/classifications/stats');
}

// ============================================================================
// Ledger / History
// ============================================================================

export interface LedgerMCPContext {
  toolName?: string;
  query?: string;
  parameters?: Record<string, unknown>;
  resultCount?: number;
  responseTimeMs?: number;
  cacheHit?: boolean;
}

export interface LedgerEntry {
  id: string;
  timestamp: string;
  sequence?: number;
  eventType: string;
  source?: string;
  summary?: string;
  details?: string;
  impactedFiles?: string[];
  impactedEntities?: string[];
  mcpContext?: LedgerMCPContext;
  sessionId?: string;
  correlationId?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  // Deprecated alias for backward compat
  entityId?: string;
}

export interface LedgerStats {
  entryCount: number;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
  currentSequence: number;
}

export interface LedgerTimelineEntry {
  id: string;
  timestamp: string;
  eventType: string;
  source: string;
  summary: string;
  impactLevel: 'low' | 'medium' | 'high';
  hasClassificationChange: boolean;
  hasUserInteraction: boolean;
  hasError: boolean;
}

export interface LedgerAggregation {
  totalEvents: number;
  byEventType: Record<string, number>;
  bySource: Record<string, number>;
  byHour: Array<{ hour: string; count: number }>;
  topImpactedFiles: Array<{ file: string; count: number }>;
  topImpactedEntities: Array<{ entity: string; count: number }>;
  classificationChanges: number;
  errorCount: number;
  averageResponseTimeMs: number;
}

export async function getLedgerEntries(params?: {
  eventType?: string;
  eventTypes?: string;
  sources?: string;
  entityId?: string;
  since?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}): Promise<LedgerEntry[]> {
  const searchParams = new URLSearchParams();
  if (params?.eventType) searchParams.set('eventType', params.eventType);
  if (params?.eventTypes) searchParams.set('eventTypes', params.eventTypes);
  if (params?.sources) searchParams.set('sources', params.sources);
  if (params?.entityId) searchParams.set('entityId', params.entityId);
  if (params?.since) searchParams.set('since', params.since);
  if (params?.startTime) searchParams.set('startTime', params.startTime);
  if (params?.endTime) searchParams.set('endTime', params.endTime);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const query = searchParams.toString();
  return fetchApi<LedgerEntry[]>(`/ledger${query ? `?${query}` : ''}`);
}

export async function getLedgerStats(): Promise<LedgerStats> {
  return fetchApi<LedgerStats>('/ledger/stats');
}

export async function getLedgerRecent(limit = 50): Promise<LedgerEntry[]> {
  return fetchApi<LedgerEntry[]>(`/ledger/recent?limit=${limit}`);
}

export async function getLedgerTimeline(params?: {
  limit?: number;
  offset?: number;
  startTime?: string;
  endTime?: string;
}): Promise<LedgerTimelineEntry[]> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  if (params?.startTime) searchParams.set('startTime', params.startTime);
  if (params?.endTime) searchParams.set('endTime', params.endTime);
  const query = searchParams.toString();
  return fetchApi<LedgerTimelineEntry[]>(`/ledger/timeline${query ? `?${query}` : ''}`);
}

export async function getLedgerAggregations(params?: {
  startTime?: string;
  endTime?: string;
}): Promise<LedgerAggregation> {
  const searchParams = new URLSearchParams();
  if (params?.startTime) searchParams.set('startTime', params.startTime);
  if (params?.endTime) searchParams.set('endTime', params.endTime);
  const query = searchParams.toString();
  return fetchApi<LedgerAggregation>(`/ledger/aggregations${query ? `?${query}` : ''}`);
}

// ============================================================================
// Operations
// ============================================================================

export async function triggerReindex(path?: string): Promise<{ status: string; message: string }> {
  return fetchApi('/operations/reindex', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export async function triggerJustify(params?: {
  entityId?: string;
  force?: boolean;
}): Promise<{ status: string; message: string }> {
  return fetchApi('/operations/justify', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function triggerClassify(params?: {
  entityId?: string;
  force?: boolean;
}): Promise<{ status: string; message: string }> {
  return fetchApi('/operations/classify', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getHealthStatus(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: Record<string, { status: string; message?: string }>;
}> {
  return fetchApi('/health');
}

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

export interface LedgerEntry {
  id: string;
  eventType: string;
  entityId?: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export async function getLedgerEntries(params?: {
  eventType?: string;
  entityId?: string;
  since?: string;
  limit?: number;
}): Promise<LedgerEntry[]> {
  const searchParams = new URLSearchParams();
  if (params?.eventType) searchParams.set('eventType', params.eventType);
  if (params?.entityId) searchParams.set('entityId', params.entityId);
  if (params?.since) searchParams.set('since', params.since);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return fetchApi<LedgerEntry[]>(`/ledger${query ? `?${query}` : ''}`);
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

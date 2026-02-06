import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// Types for the global store
export interface OverviewStats {
  totalFiles: number;
  totalFunctions: number;
  totalClasses: number;
  totalInterfaces: number;
  totalVariables: number;
  totalRelationships: number;
  languages: Record<string, number>;
}

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
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  entityCount?: number;
}

// Global UI State
interface UIState {
  // Active section
  activeSection: string;
  setActiveSection: (section: string) => void;

  // Selected entity
  selectedEntity: EntitySummary | null;
  setSelectedEntity: (entity: EntitySummary | null) => void;

  // Selected file
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;

  // Command palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // Overview stats (cached)
  overviewStats: OverviewStats | null;
  setOverviewStats: (stats: OverviewStats) => void;

  // Loading states
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Error state
  error: string | null;
  setError: (error: string | null) => void;
}

export const useUIStore = create<UIState>()(
  devtools(
    (set) => ({
      activeSection: 'explorer',
      setActiveSection: (section) => set({ activeSection: section }),

      selectedEntity: null,
      setSelectedEntity: (entity) => set({ selectedEntity: entity }),

      selectedFile: null,
      setSelectedFile: (path) => set({ selectedFile: path }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      overviewStats: null,
      setOverviewStats: (stats) => set({ overviewStats: stats }),

      isLoading: false,
      setIsLoading: (loading) => set({ isLoading: loading }),

      error: null,
      setError: (error) => set({ error: error }),
    }),
    { name: 'code-synapse-ui' }
  )
);

// Explorer-specific state
interface ExplorerState {
  fileTree: FileNode[];
  setFileTree: (tree: FileNode[]) => void;
  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  fileContent: string | null;
  setFileContent: (content: string | null) => void;
  fileEntities: EntitySummary[];
  setFileEntities: (entities: EntitySummary[]) => void;
}

export const useExplorerStore = create<ExplorerState>()(
  devtools(
    (set) => ({
      fileTree: [],
      setFileTree: (tree) => set({ fileTree: tree }),
      expandedPaths: new Set<string>(),
      toggleExpanded: (path) =>
        set((state) => {
          const newExpanded = new Set(state.expandedPaths);
          if (newExpanded.has(path)) {
            newExpanded.delete(path);
          } else {
            newExpanded.add(path);
          }
          return { expandedPaths: newExpanded };
        }),
      fileContent: null,
      setFileContent: (content) => set({ fileContent: content }),
      fileEntities: [],
      setFileEntities: (entities) => set({ fileEntities: entities }),
    }),
    { name: 'code-synapse-explorer' }
  )
);

// Knowledge view state
interface KnowledgeState {
  entities: EntitySummary[];
  setEntities: (entities: EntitySummary[]) => void;
  filters: {
    kind: string[];
    classification: string[];
    confidence: string[];
    search: string;
  };
  setFilters: (filters: Partial<KnowledgeState['filters']>) => void;
  sortBy: 'name' | 'kind' | 'confidence' | 'file';
  setSortBy: (sortBy: KnowledgeState['sortBy']) => void;
  sortOrder: 'asc' | 'desc';
  setSortOrder: (order: KnowledgeState['sortOrder']) => void;
}

export const useKnowledgeStore = create<KnowledgeState>()(
  devtools(
    (set) => ({
      entities: [],
      setEntities: (entities) => set({ entities: entities }),
      filters: {
        kind: [],
        classification: [],
        confidence: [],
        search: '',
      },
      setFilters: (newFilters) =>
        set((state) => ({
          filters: { ...state.filters, ...newFilters },
        })),
      sortBy: 'name',
      setSortBy: (sortBy) => set({ sortBy: sortBy }),
      sortOrder: 'asc',
      setSortOrder: (order) => set({ sortOrder: order }),
    }),
    { name: 'code-synapse-knowledge' }
  )
);

// Search result type
export interface SearchResult {
  entity: EntitySummary;
  score: number;
  highlights?: string[];
}

// Search state
interface SearchState {
  query: string;
  setQuery: (query: string) => void;
  searchType: 'natural' | 'semantic' | 'exact';
  setSearchType: (type: SearchState['searchType']) => void;
  results: SearchResult[];
  setResults: (results: SearchResult[]) => void;
  searchHistory: string[];
  addToHistory: (query: string) => void;
}

export const useSearchStore = create<SearchState>()(
  devtools(
    (set) => ({
      query: '',
      setQuery: (query) => set({ query: query }),
      searchType: 'natural',
      setSearchType: (type) => set({ searchType: type }),
      results: [],
      setResults: (results) => set({ results: results }),
      searchHistory: [],
      addToHistory: (query) =>
        set((state) => ({
          searchHistory: [query, ...state.searchHistory.filter((q) => q !== query)].slice(0, 10),
        })),
    }),
    { name: 'code-synapse-search' }
  )
);

// Graph view state
export type GraphLens = 'structure' | 'business' | 'infra' | 'pattern';

interface GraphState {
  nodes: Array<{
    id: string;
    label: string;
    kind: string;
    confidence?: number; // 0-1
    classification?: 'domain' | 'infrastructure' | 'test' | 'config' | 'unknown';
    // New fields for Explorer
    featureContext?: string;
    businessValue?: string;
    purposeSummary?: string;
    complexity?: number;
    owner?: string;
  }>;
  edges: Array<{ source: string; target: string; kind: string }>;
  setGraphData: (nodes: GraphState['nodes'], edges: GraphState['edges']) => void;
  focusedNode: string | null;
  setFocusedNode: (id: string | null) => void;
  // Replace layout with Lens
  activeLens: GraphLens;
  setActiveLens: (lens: GraphLens) => void;
}

export const useGraphStore = create<GraphState>()(
  devtools(
    (set) => ({
      nodes: [],
      edges: [],
      setGraphData: (nodes, edges) => set({ nodes, edges }),
      focusedNode: null,
      setFocusedNode: (id) => set({ focusedNode: id }),
      activeLens: 'structure',
      setActiveLens: (lens) => set({ activeLens: lens }),
    }),
    { name: 'code-synapse-graph' }
  )
);

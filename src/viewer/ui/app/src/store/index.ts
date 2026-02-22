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

  // Recent files
  recentFiles: string[];
  addRecentFile: (path: string) => void;

  // Shortcut help modal
  shortcutHelpOpen: boolean;
  setShortcutHelpOpen: (open: boolean) => void;
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

      recentFiles: [],
      addRecentFile: (path) =>
        set((state) => ({
          recentFiles: [path, ...state.recentFiles.filter((f) => f !== path)].slice(0, 10),
        })),

      shortcutHelpOpen: false,
      setShortcutHelpOpen: (open) => set({ shortcutHelpOpen: open }),
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

// Hybrid search types (Phase 5)
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

export interface HybridSearchSummary {
  answer: string;
  citations: Array<{
    index: number;
    filePath: string;
    lineNumber?: number;
    snippet?: string;
    justification?: string;
  }>;
  modelUsed: string;
  timestamp: string;
}

// Chat turn (conversation message pair)
export interface ChatTurn {
  id: string;
  query: string;
  results: HybridSearchResult[];
  summary: HybridSearchSummary | null;
  timestamp: number;
  isLoading: boolean;
  error?: string;
}

// Selected search entity for detail panel
export interface SelectedSearchEntity {
  entityId: string;
  entityName: string;
  filePath: string;
}

// Search state
interface SearchState {
  query: string;
  setQuery: (query: string) => void;
  searchType: 'natural' | 'semantic' | 'exact' | 'hybrid';
  setSearchType: (type: SearchState['searchType']) => void;
  results: SearchResult[];
  setResults: (results: SearchResult[]) => void;
  searchHistory: string[];
  addToHistory: (query: string) => void;
  // Phase 5: Hybrid / Insight view
  enableDeepSearch: boolean;
  setEnableDeepSearch: (enabled: boolean) => void;
  hybridResults: HybridSearchResult[];
  hybridSummary: HybridSearchSummary | null;
  setHybridSearchResults: (results: HybridSearchResult[], summary: HybridSearchSummary | null) => void;
  // Chat history
  chatHistory: ChatTurn[];
  addChatTurn: (turn: ChatTurn) => void;
  updateLastTurn: (update: Partial<ChatTurn>) => void;
  clearChat: () => void;
  // Entity detail panel
  selectedSearchEntity: SelectedSearchEntity | null;
  setSelectedSearchEntity: (entity: SelectedSearchEntity | null) => void;
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
      enableDeepSearch: false,
      setEnableDeepSearch: (enabled) => set({ enableDeepSearch: enabled }),
      hybridResults: [],
      hybridSummary: null,
      setHybridSearchResults: (results, summary) =>
        set({ hybridResults: results, hybridSummary: summary }),
      // Chat history
      chatHistory: [],
      addChatTurn: (turn) =>
        set((state) => ({ chatHistory: [...state.chatHistory, turn] })),
      updateLastTurn: (update) =>
        set((state) => {
          const history = [...state.chatHistory];
          if (history.length > 0) {
            history[history.length - 1] = { ...history[history.length - 1]!, ...update };
          }
          return { chatHistory: history };
        }),
      clearChat: () => set({ chatHistory: [], hybridResults: [], hybridSummary: null }),
      // Entity detail panel
      selectedSearchEntity: null,
      setSelectedSearchEntity: (entity) => set({ selectedSearchEntity: entity }),
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

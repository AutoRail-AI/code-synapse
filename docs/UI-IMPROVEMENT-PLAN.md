# UI Improvement Plan

This document outlines the current state of the Code-Synapse UI and proposes improvements to make it more useful for developers and AI agents.

---

## Current State

### Technology Stack
- React 18 + TypeScript
- Vite (build tool)
- Zustand (state management)
- Tailwind CSS (styling)
- Monaco Editor (code viewing)
- React Router v6 (navigation)

### Existing Sections

| Section | Purpose | Status |
|---------|---------|--------|
| **Explorer** | File browser + code viewer with entity highlighting | Functional |
| **Knowledge** | Entity grid with filters (functions, classes, interfaces) | Functional |
| **Graph** | Canvas-based relationship visualization | Basic |
| **Search** | Natural language, semantic, and exact search | Functional |
| **Operations** | Trigger indexing, justification, classification | Functional |
| **Observability** | Event ledger and system metrics | Basic |

---

## Section Analysis

### 1. Unified Knowledge Explorer

**Concept:** 
Merge the "physical" file view (Explorer) with the "logical" knowledge view. Instead of a separate "Knowledge View", we bring the knowledge *to* the code. The Explorer becomes the single source of truth, offering different "lenses" on the codebase.

**Current State (Fragmented):**
- **Explorer**: Files only.
- **Knowledge View**: Entities only (disconnected from files).

**Proposed Unified Design:**

#### A. Smart File Tree (The Navigation Layer)
- **Status Indicators (Implemented)**: Files show color-coded bars/icons for their state:
    - 🔴 *Unindexed/No Justification*
    - 🟡 *Analysis Pending/Partial*
    - 🟢 *Justified & Classified*

#### B. Rich Editor (The Consumption Layer)
- **Inline Intelligence (Implemented)**:
    - **CodeLens Metrics**: Shows "85% Confidence • Domain" above classes/functions.
    - **Folder Mode**: Selecting a folder shows the `EntityGrid` for that folder.

#### C. Context-Aware Knowledge Grid (The Inventory Layer)
- *Replaced standalone "Knowledge View"*
- **Folder Mode**: The main editor area shows the **Entity Grid** filtered to that folder.
- **Context Panel**: Shows folder statistics (Overview) or handling file-specific insights.

**Unified Improvements:**
- **Breadcrumbs (Implemented)**: Path bar above editor area.
- **Go to Definition**: Works implicitly via CodeLens selection.
- **Global Search**: Remains in the sidebar for jumping across the project.

---

### 3. Graph View

**Current:**
```
┌────────────────────────────────────────────────────┐
│ Toolbar: Layout | Filters | Zoom                   │
├────────────────────────────────────────────────────┤
│                                                    │
│              Canvas Graph                          │
│                                                    │
└────────────────────────────────────────────────────┘
```

**Strengths:**
- Canvas rendering handles large graphs
- Layout options (force, hierarchy, radial)
- Color coding by entity kind

**Weaknesses:**
- ~~No node search/filter~~ ✅ Search box with autocomplete added
- ~~Can't focus on a specific entity~~ ✅ Focus mode with configurable depth
- ~~No edge labels (call, import, extends)~~ ✅ Edge labels on hover
- ~~No zoom-to-fit~~ ✅ Zoom-to-fit button added
- ~~No export (PNG, SVG)~~ ✅ Export as PNG added
- ~~Legend is missing~~ ✅ Legend exists (Function, Class, Interface, Other)

**Proposed Improvements:**
- ~~Add search box to find and focus nodes~~ ✅ Implemented with dropdown results
- ~~Add edge type labels on hover~~ ✅ Implemented with color-coded edge info panel
- ~~Add zoom-to-fit button~~ ✅ Implemented
- ~~Add legend for colors/shapes~~ ✅ Implemented in `GraphView.tsx:497-506`
- ~~Add "Focus on entity" mode (shows only N hops)~~ ✅ Implemented with depth selector (1-4 hops)
- ~~Add export functionality~~ ✅ Export as PNG implemented

---

### 4. Search View

**Current:**
```
┌────────────────────────────────────────────────────┐
│ Search: [________________________] [Type Dropdown] │
├────────────────────────────────────────────────────┤
│ Results with match scores                          │
└────────────────────────────────────────────────────┘
```

**Strengths:**
- Three search modes (natural, semantic, exact)
- Search history for repeat queries
- Result cards show relevance

**Weaknesses:**
- No faceted search (filter results by kind, file, etc.)
- No search suggestions/autocomplete
- Semantic search requires embeddings (not always available)
- No "search in file" scope

**Proposed Improvements:**
- Add result filters (kind, file path, classification)
- Add autocomplete from entity names
- Show embedding status (warn if not generated)
- Add scope selector (all, current file, folder)

---

### 5. Operations View

**Current:**
```
┌────────────────────────────────────────────────────┐
│ Action Cards: Reindex | Justify | Classify         │
├────────────────────────────────────────────────────┤
│ Statistics + Health Status                         │
└────────────────────────────────────────────────────┘
```

**Strengths:**
- Clear action buttons
- Health status shows component states
- Statistics provide coverage overview

**Weaknesses:**
- ~~No progress feedback during operations~~ ✅ Progress indicators added
- Can't target specific files/folders
- No operation history
- ~~Classification stats are hardcoded~~ ✅ Now queries actual data

**Proposed Improvements:**
- ~~Add real-time progress indicators~~ ✅ Implemented with elapsed time tracking and animated progress bars
- Add file/folder selector for targeted operations
- Add operation history log
- ~~Fix classification stats~~ ✅ Fixed in `server.ts:handleClassificationStats`

---

### 6. Observability View

**Current:**
```
┌────────────────────────────────────────────────────┐
│ Event Filters: All | Index | Justify | Classify    │
├────────────────────────────────────────────────────┤
│ Event Timeline (grouped by date)                   │
└────────────────────────────────────────────────────┘
```

**Strengths:**
- Event filtering by type
- Expandable event details
- Date grouping

**Weaknesses:**
- No date range picker
- No search within events
- Large event lists are slow (no virtualization)
- No real-time updates

**Proposed Improvements:**
- Add date range filter
- Add event search
- Implement virtual scrolling for large lists
- Add WebSocket for live event streaming

---

## Cross-Cutting Improvements

### Navigation & Discoverability

| Improvement | Description |
|-------------|-------------|
| **Command Palette** | Already exists (Cmd+K) - enhance with more actions |
| **Quick Jump** | Cmd+P style file picker with fuzzy search |
| **Keyboard Shortcuts** | Add shortcuts for common actions |
| **Breadcrumbs** | Show context path in all views |

### Data Freshness

| Improvement | Description |
|-------------|-------------|
| **Last Indexed** | Show timestamp in header |
| **Stale Indicator** | Warn if files changed since last index |
| **Auto-Refresh** | Option to poll for updates |

### Performance

| Improvement | Description |
|-------------|-------------|
| **Virtual Scrolling** | For knowledge grid and ledger |
| **Lazy Loading** | Load entity details on demand |
| **Caching** | Cache API responses with SWR/React Query |

### Accessibility

| Improvement | Description |
|-------------|-------------|
| **Keyboard Navigation** | Full keyboard support |
| **Screen Reader** | Proper ARIA labels |
| **Focus Management** | Logical focus order |

---

## New Features to Consider

### 1. Dashboard View (New Section)

A landing page showing project health at a glance:

```
┌─────────────────────────────────────────────────────────┐
│                    PROJECT DASHBOARD                     │
├──────────────────┬──────────────────┬───────────────────┤
│ Index Health     │ Coverage Stats   │ Recent Activity   │
│ • 247 files      │ • 85% justified  │ • 5 files changed │
│ • 2,779 funcs    │ • 72% classified │ • 3 new entities  │
│ • Last: 2h ago   │ • 12 need review │ • 1 error         │
├──────────────────┴──────────────────┴───────────────────┤
│ Quick Actions                                           │
│ [Re-index] [Justify All] [View Stale Files]             │
└─────────────────────────────────────────────────────────┘
```

### 2. Entity Detail Page (Deep Dive)

Dedicated page for a single entity with:
- Full justification with confidence breakdown
- Call graph (callers + callees)
- Side effects and error paths
- Design patterns it participates in
- Similar code suggestions
- Edit justification option

### 3. Comparison View

Compare two entities or two versions of the same entity:
- Side-by-side code diff
- Relationship diff
- Justification diff

### 4. AI Chat Interface

Conversational interface to query the knowledge graph:
- "What does UserService do?"
- "Show me all functions that call the database"
- "Why does this function exist?"

---

### 7. Graph Architecture & Relationship Capture

**Why do we need a Graph?**
The graph view and underlying graph data structure are essential for:
1.  **Dependency Visualization**: Seeing how files, functions, and classes depend on each other (who calls whom, who imports what).
2.  **Impact Analysis**: Understanding the ripple effects of changing a specific component.
3.  **Architectural Understanding**: Revealing the high-level structure of the application beyond the directory tree.

**Capture Mechanism (The "How" & "Where"):**
1.  **Extraction Phase (`src/core/extraction`)**:
    - **Parsed by**: Tree-sitter parsers in `function-extractor.ts`, `import-extractor.ts`.
    - **Identified Relations**: Function calls, class inheritance (`extends`), interface implementation (`implements`), and file imports.
2.  **Storage Layer (`src/core/graph/cozo-graph-store.ts`)**:
    - **Database**: CozoDB (Relational/Graph hybrid).
    - **Schema**: Explicit tables for `calls`, `imports`, `extends`, `implements`.
    - **Example**: A function call is stored as an edge `calls { from_id, to_id, is_await, ... }`.
3.  **API Layer (`src/viewer/ui/server.ts`)**:
    - **Endpoints**: Exposes relations via `/api/graph/dependencies` and `/api/entities/:id/relationships`.
    - **Consumption**: The UI fetches this to render the Canvas Graph and "Related" lists in the Context Panel.

---

## Implementation Priority

### Phase 1: Fix Existing Issues
1. Fix classification stats (hardcoded zeros)
2. Add pagination to Knowledge view
3. Add progress indicators to Operations
4. Improve Graph view with search and legend

### Phase 2: Enhance Core Views
1. Add breadcrumbs to Explorer
2. Add faceted search to Search view
3. Add virtual scrolling to Observability
4. Improve entity details panel

### Phase 3: New Features
1. Dashboard view
2. Entity detail page
3. Keyboard shortcuts
4. Command palette enhancements

### Phase 4: Advanced Features
1. AI chat interface
2. Comparison view
3. Real-time updates (WebSocket)
4. Export functionality

---

## Implementation Details

### Monaco Definition/Reference Providers (`MonacoViewer.tsx`)

The Monaco editor now includes three language intelligence providers:

1. **Definition Provider** (F12 / Ctrl+Click)
   - Triggers when user presses F12 or Ctrl+clicks on an entity
   - Fetches relationships via `getEntityRelationships(entity.id)`
   - For `calls` and `imports` relationships, navigates to the target entity
   - Supports cross-file navigation via `onNavigateToEntity` callback

2. **Reference Provider** (Shift+F12)
   - Shows all references to the selected entity
   - Fetches `called_by` and `imported_by` relationships
   - Returns locations for all referencing entities

3. **Enhanced Hover Provider**
   - Shows entity name, kind, justification, and classification
   - Displays relationship counts (callers/callees)
   - Includes navigation hints for F12/Shift+F12

### Operations Progress Indicators (`OperationsView.tsx`)

- `OperationStatus` interface tracks `startTime` and `endTime` timestamps
- `OperationCard` component displays:
  - Elapsed time counter (updates every second while running)
  - Animated indeterminate progress bar (`animate-progress` CSS class)
  - Status badges (running/success/error) with icons
- Progress animation defined in `index.css` as `progress-indeterminate` keyframes

### Classification Stats Fix (`server.ts`)

The `handleClassificationStats` endpoint now:
- Fetches actual justifications via `this.viewer.listJustifications()`
- Counts by category (domain/infrastructure/unknown)
- Counts by sub-category (domain types or architectural patterns)
- Returns real data instead of hardcoded zeros

### Graph Enhancements (Phase 2)

**Backend: CallGraphLinker (`call-graph-linker.ts`)**
- Implements **Pass 2 Analysis** to resolve cross-file function calls.
- Builds a Global Symbol Registry from all extracted files.
- Uses import statements to bridge calls from one file to another.
- Falls back to local file resolution for complex internal calls.
- Populates the `calls` table in CozoDB, enabling the "Calls" edge type in the graph.

**Frontend: GraphView (`GraphView.tsx`)**
- **Legend**: leveraging the existing comprehensive legend at the bottom-right.
- **Search**: Added node search with autocomplete dropdown to quickly find entities.
- **Focus Mode**: Implemented BFS traversal to show only nodes within N hops of the selected entity.
- **Edge Labels**: Added hover interactions to display relationship types (calls, imports, extends).
- **Export**: Added canvas-to-PNG export functionality.

---

## Technical Decisions

### State Management
Keep Zustand - it's lightweight and works well for this scale.

### Data Fetching
Consider adding React Query or SWR for:
- Automatic caching
- Background refetching
- Stale-while-revalidate pattern

### Virtual Scrolling
Options:
- `react-virtual` (TanStack) - lightweight
- `react-window` - battle-tested
- Native CSS `content-visibility` - simplest

### Graph Library
Current canvas implementation is custom. Consider:
- Keep custom for performance
- Or use `react-force-graph` for features
- Or use `cytoscape` (already a dependency)

---

## Success Metrics

| Metric                      | Current         | Target | Status      |
|-----------------------------|-----------------|--------|-------------|
| Time to find entity         | ~10s            | <3s    | In Progress |
| Time to understand purpose  | ~30s            | <10s   | In Progress |
| Operations with feedback    | ~~0%~~ → 100%   | 100%   | ✅ Complete |
| Keyboard navigable          | Partial         | Full   | In Progress |

---

## Implementation Checklist

### Phase 1: Unification & Cleanup ✅ COMPLETE
- [x] **Merge Views**:
    - [x] Merge Knowledge View into Explorer (Smart Tree + Context Grid)
    - [x] Implement "Folder Selection" -> "Entity Grid" view
    - [x] Add inline Justification/Classification rendering (CodeLens)
    - [x] Add file-tree status indicators (Indexed/Justified status)
- [x] Fix classification stats (hardcoded zeros) - Fixed in `server.ts:handleClassificationStats`
- [x] Add progress indicators to Operations - Added elapsed time tracking + animated progress bars
- [x] Add graph legend - Already existed in `GraphView.tsx:497-506`
- [x] **Graph View Improvements**:
    - [x] Node search with autocomplete dropdown
    - [x] Edge type labels on hover (calls, imports, extends, implements)
    - [x] Zoom-to-fit button
    - [x] Focus mode (show only N hops from selected node)
    - [x] Export as PNG
    - [x] Enhanced legend (nodes, edges, classification halos)
    - [x] Arrow heads on directed edges
    - [x] Color-coded edges by relationship type

### Phase 2: The "Smart" Explorer ✅ COMPLETE
- [x] **Smart Tree**: Add status icons (Indexed/Justified) to File Tree.
- [x] **Rich Editor**: Implement CodeLens for inline Justification & Classification.
- [x] **Context Grid**: Implement "Folder-scoped" entity grid in main view.
- [x] Breadcrumb navigation
- [x] Monaco Definition/Reference Providers (Graph Bridge) - F12/Ctrl+Click for definition, Shift+F12 for references, enhanced hover
- [x] Explorer Context Panel: AST Tree & Incoming Refs (Partial: Stats for Folders)

### Phase 3: New Views
- [ ] Dashboard view
- [ ] Entity detail page
- [ ] Keyboard shortcuts system
- [ ] Enhanced command palette

### Phase 4: Advanced
- [ ] AI chat interface
- [ ] WebSocket real-time updates
- [ ] Export graph as image
- [ ] Comparison view

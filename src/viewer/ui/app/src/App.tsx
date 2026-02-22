import { Routes, Route, Navigate } from 'react-router-dom';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';
import { ShortcutHelpModal } from './components/common/ShortcutHelpModal';
import { DashboardView } from './components/dashboard/DashboardView';
import { ExplorerView } from './components/explorer/ExplorerView';

import { GraphView } from './components/graph/GraphView';
import { SearchView } from './components/search/SearchView';
import { OperationsView } from './components/operations/OperationsView';
import { ObservabilityView } from './components/observability/ObservabilityView';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

function App() {
  useKeyboardShortcuts();

  return (
    <div className="h-screen flex flex-col bg-bg-main text-slate-100 bg-gradient-mesh">
      {/* Global Header */}
      <Header />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Section Navigation Sidebar */}
        <Sidebar />

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard/*" element={<DashboardView />} />
            <Route path="/explorer/*" element={<ExplorerView />} />

            <Route path="/graph/*" element={<GraphView />} />
            <Route path="/search/*" element={<SearchView />} />
            <Route path="/operations/*" element={<OperationsView />} />
            <Route path="/observability/*" element={<ObservabilityView />} />
          </Routes>
        </main>
      </div>

      {/* Global Modals */}
      <ShortcutHelpModal />
    </div>
  );
}

export default App;

import { useEffect } from 'react';
import {
  Search,
  Command,
  Activity,
  FileCode,
  Box,
  GitBranch,
  Layers,
} from 'lucide-react';
import { useUIStore } from '../../store';
import { getOverviewStats } from '../../api/client';

export function Header() {
  const {
    overviewStats,
    setOverviewStats,
    commandPaletteOpen,
    setCommandPaletteOpen,
  } = useUIStore();

  // Fetch overview stats on mount
  useEffect(() => {
    getOverviewStats()
      .then(setOverviewStats)
      .catch((err) => console.error('Failed to load stats:', err));
  }, [setOverviewStats]);

  // Keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  return (
    <header className="h-16 flex items-center justify-between px-6 z-50">
      {/* Logo and Title - Floating Glass */}
      <div className="flex items-center gap-3 glass-panel px-4 py-2 rounded-xl">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
            <GitBranch className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg text-white tracking-tight">Code-Synapse</span>
        </div>
      </div>

      {/* Stats Bar - Centered Pills */}
      <div className="flex items-center gap-3 backdrop-blur-sm bg-slate-900/30 px-4 py-2 rounded-full border border-slate-700/30">
        {overviewStats ? (
          <>
            <StatBadge
              icon={<FileCode className="w-4 h-4 text-emerald-400" />}
              label="Files"
              value={overviewStats.totalFiles}
            />
            <div className="w-px h-4 bg-slate-700/50" />
            <StatBadge
              icon={<Box className="w-4 h-4 text-indigo-400" />}
              label="Functions"
              value={overviewStats.totalFunctions}
            />
            <div className="w-px h-4 bg-slate-700/50" />
            <StatBadge
              icon={<Layers className="w-4 h-4 text-purple-400" />}
              label="Classes"
              value={overviewStats.totalClasses}
            />
            <div className="w-px h-4 bg-slate-700/50" />
            <StatBadge
              icon={<Activity className="w-4 h-4 text-orange-400" />}
              label="Relations"
              value={overviewStats.totalRelationships}
            />
          </>
        ) : (
          <span className="text-slate-500 text-sm">Loading stats...</span>
        )}
      </div>

      {/* Command Palette Trigger */}
      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="group flex items-center gap-3 px-4 py-2 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-sidebar-primary/50 rounded-xl transition-all duration-300 shadow-sm hover:shadow-glow"
      >
        <Search className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
        <span className="text-sm text-slate-400 group-hover:text-white font-medium transition-colors">Search...</span>
        <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 bg-slate-900/50 rounded-md text-xs text-slate-500 font-mono group-hover:text-slate-300 border border-slate-700/50">
          <Command className="w-3 h-3" />K
        </kbd>
      </button>

      {/* Command Palette Modal */}
      {commandPaletteOpen && (
        <CommandPalette onClose={() => setCommandPaletteOpen(false)} />
      )}
    </header>
  );
}

function StatBadge({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2 text-slate-400">
      {icon}
      <span className="text-slate-500">{label}:</span>
      <span className="text-slate-200 font-medium">{value.toLocaleString()}</span>
    </div>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-xl bg-slate-800 border border-slate-700 rounded-lg shadow-2xl">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700">
          <Search className="w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search entities, files, or type a command..."
            className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 outline-none text-lg"
            autoFocus
          />
        </div>

        <div className="py-2 max-h-80 overflow-y-auto">
          <div className="px-3 py-1 text-xs font-medium text-slate-500 uppercase">
            Quick Actions
          </div>
          <CommandItem label="Go to File" shortcut="⌘P" />
          <CommandItem label="Search Functions" shortcut="⌘⇧F" />
          <CommandItem label="View Graph" shortcut="⌘G" />
          <CommandItem label="Trigger Re-index" shortcut="⌘R" />

          <div className="px-3 py-1 mt-2 text-xs font-medium text-slate-500 uppercase">
            Recent Files
          </div>
          <CommandItem label="src/core/indexer/index.ts" />
          <CommandItem label="src/mcp/server.ts" />
          <CommandItem label="src/cli/commands/default.ts" />
        </div>
      </div>
    </div>
  );
}

function CommandItem({
  label,
  shortcut,
}: {
  label: string;
  shortcut?: string;
}) {
  return (
    <button className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-700 text-slate-300 text-sm">
      <span>{label}</span>
      {shortcut && (
        <kbd className="text-xs text-slate-500 bg-slate-600 px-1.5 py-0.5 rounded">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

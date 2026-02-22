import { useUIStore } from '../../store';
import { Keyboard, X } from 'lucide-react';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: '\u2318 1', description: 'Go to Dashboard' },
      { keys: '\u2318 2', description: 'Go to Explorer' },
      { keys: '\u2318 3', description: 'Go to Graph' },
      { keys: '\u2318 4', description: 'Go to Search' },
      { keys: '\u2318 5', description: 'Go to Operations' },
      { keys: '\u2318 6', description: 'Go to Ledger' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: '\u2318 P', description: 'Open command palette' },
      { keys: '\u2318 K', description: 'Open command palette (alt)' },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { keys: '\u2318 /', description: 'Show keyboard shortcuts' },
      { keys: 'Esc', description: 'Close modal / palette' },
    ],
  },
];

export function ShortcutHelpModal() {
  const { shortcutHelpOpen, setShortcutHelpOpen } = useUIStore();

  if (!shortcutHelpOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setShortcutHelpOpen(false)}
      />
      <div className="relative w-full max-w-lg glass-panel rounded-2xl shadow-2xl border border-slate-700/30 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rail-purple/10 rounded-lg">
              <Keyboard className="w-5 h-5 text-rail-purple" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Keyboard Shortcuts</h2>
              <p className="text-xs text-slate-500">Navigate faster with shortcuts</p>
            </div>
          </div>
          <button
            onClick={() => setShortcutHelpOpen(false)}
            className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[60vh] overflow-auto custom-scrollbar">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
                {group.title}
              </h3>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-800/40 transition-colors"
                  >
                    <span className="text-sm text-slate-300">{shortcut.description}</span>
                    <kbd className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800/60 border border-slate-700/50 rounded-md text-xs text-slate-400 font-mono">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ShortcutHelpModal;

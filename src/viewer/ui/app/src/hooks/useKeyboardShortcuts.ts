import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '../store';

const VIEW_SHORTCUTS: Record<string, { path: string; section: string }> = {
  '1': { path: '/dashboard', section: 'dashboard' },
  '2': { path: '/explorer', section: 'explorer' },
  '3': { path: '/graph', section: 'graph' },
  '4': { path: '/search', section: 'search' },
  '5': { path: '/operations', section: 'operations' },
  '6': { path: '/observability', section: 'observability' },
};

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const {
    setActiveSection,
    setCommandPaletteOpen,
    commandPaletteOpen,
    setShortcutHelpOpen,
    shortcutHelpOpen,
  } = useUIStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when user is typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // Still allow Escape in inputs
        if (e.key === 'Escape') {
          (target as HTMLInputElement).blur();
        }
        return;
      }

      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd+P or Cmd+K — open command palette
      if (isMeta && (e.key === 'p' || e.key === 'k')) {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }

      // Cmd+/ — toggle shortcut help
      if (isMeta && e.key === '/') {
        e.preventDefault();
        setShortcutHelpOpen(!shortcutHelpOpen);
        return;
      }

      // Cmd+1-6 — navigate views
      if (isMeta && VIEW_SHORTCUTS[e.key]) {
        e.preventDefault();
        const { path, section } = VIEW_SHORTCUTS[e.key]!;
        setActiveSection(section);
        navigate(path);
        return;
      }

      // Escape — close modals
      if (e.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else if (shortcutHelpOpen) {
          setShortcutHelpOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    navigate,
    setActiveSection,
    setCommandPaletteOpen,
    commandPaletteOpen,
    setShortcutHelpOpen,
    shortcutHelpOpen,
  ]);
}

import { useLocation, useNavigate } from 'react-router-dom';
import {
  FolderTree,
  LayoutDashboard,
  GitBranch,
  Search,
  Settings,
  Activity,
} from 'lucide-react';
import { useUIStore } from '../../store';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  description: string;
}

const navItems: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard className="w-5 h-5" />,
    path: '/dashboard',
    description: 'Overview stats and quick actions',
  },
  {
    id: 'explorer',
    label: 'Explorer',
    icon: <FolderTree className="w-5 h-5" />,
    path: '/explorer',
    description: 'Browse files and entities',
  },

  {
    id: 'graph',
    label: 'Graph',
    icon: <GitBranch className="w-5 h-5" />,
    path: '/graph',
    description: 'Interactive knowledge graph',
  },
  {
    id: 'search',
    label: 'Search',
    icon: <Search className="w-5 h-5" />,
    path: '/search',
    description: 'Natural language & semantic search',
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: <Settings className="w-5 h-5" />,
    path: '/operations',
    description: 'Indexing, justification, config',
  },
  {
    id: 'observability',
    label: 'Ledger',
    icon: <Activity className="w-5 h-5" />,
    path: '/observability',
    description: 'Change ledger, MCP tracking, metrics',
  },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeSection, setActiveSection } = useUIStore();

  const handleNavClick = (item: NavItem) => {
    setActiveSection(item.id);
    navigate(item.path);
  };

  return (
    <aside className="w-16 lg:w-64 flex flex-col pt-4 pb-6 px-3">
      <nav className="flex-1 space-y-2">
        {navItems.map((item) => {
          const isActive =
            location.pathname.startsWith(item.path) ||
            activeSection === item.id;

          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item)}
              className={`w-full group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${isActive
                ? 'bg-rail-purple/15 text-cloud-white shadow-glow border border-rail-purple/20'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 hover:translate-x-1'
                }`}
              title={item.description}
            >
              <span
                className={`transition-colors duration-300 ${isActive ? 'text-electric-cyan' : 'text-slate-500 group-hover:text-slate-300'}`}
              >
                {item.icon}
              </span>
              <span className="hidden lg:block text-sm font-medium">
                {item.label}
              </span>
              {isActive && (
                <div className="hidden lg:block ml-auto w-1.5 h-1.5 rounded-full bg-rail-purple shadow-[0_0_8px_rgba(110,24,179,0.6)]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom section with version info */}
      <div className="mt-auto px-4">
        <div className="hidden lg:flex items-center justify-between text-xs text-slate-500 bg-slate-900/40 p-3 rounded-lg border border-slate-800/50">
          <div className="font-medium">Code-Synapse</div>
          <div className="bg-slate-800 px-1.5 py-0.5 rounded text-[10px] text-slate-400">v0.1.0</div>
        </div>
      </div>
    </aside>
  );
}

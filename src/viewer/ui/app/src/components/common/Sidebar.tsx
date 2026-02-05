import { useLocation, useNavigate } from 'react-router-dom';
import {
  FolderTree,

  GitBranch,
  Search,
  Settings,
  Activity,
  ChevronRight,
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
    label: 'Observability',
    icon: <Activity className="w-5 h-5" />,
    path: '/observability',
    description: 'Ledger, history, metrics',
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
    <aside className="w-16 lg:w-56 bg-slate-800 border-r border-slate-700 flex flex-col">
      <nav className="flex-1 py-4">
        {navItems.map((item) => {
          const isActive =
            location.pathname.startsWith(item.path) ||
            activeSection === item.id;

          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item)}
              className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${isActive
                ? 'bg-slate-700 text-white border-l-2 border-blue-500'
                : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200 border-l-2 border-transparent'
                }`}
              title={item.description}
            >
              <span
                className={isActive ? 'text-blue-400' : 'text-slate-500'}
              >
                {item.icon}
              </span>
              <span className="hidden lg:block text-sm font-medium">
                {item.label}
              </span>
              {isActive && (
                <ChevronRight className="hidden lg:block w-4 h-4 ml-auto text-slate-500" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom section with version info */}
      <div className="p-4 border-t border-slate-700">
        <div className="hidden lg:block text-xs text-slate-500">
          <div>Code-Synapse</div>
          <div>v0.1.0</div>
        </div>
      </div>
    </aside>
  );
}

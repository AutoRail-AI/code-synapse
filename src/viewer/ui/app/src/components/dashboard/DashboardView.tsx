import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Box,
  FileCode,
  GitBranch,
  Heart,
  Layers,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  getOverviewStats,
  getJustificationStats,
  getClassificationStats,
  getLedgerRecent,
  getHealthStatus,
  triggerReindex,
  triggerJustify,
  type OverviewStats,
  type LedgerEntry,
} from '../../api/client';
import { useUIStore } from '../../store';

interface JustificationStats {
  total: number;
  byConfidence: Record<string, number>;
  bySource: Record<string, number>;
  coverage: number;
}

interface ClassificationStats {
  total: number;
  byCategory: Record<string, number>;
  bySubCategory: Record<string, number>;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: Record<string, { status: string; message?: string }>;
}

export function DashboardView() {
  const navigate = useNavigate();
  const { setActiveSection } = useUIStore();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [justStats, setJustStats] = useState<JustificationStats | null>(null);
  const [classStats, setClassStats] = useState<ClassificationStats | null>(null);
  const [recentEntries, setRecentEntries] = useState<LedgerEntry[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getOverviewStats().catch(() => null),
      getJustificationStats().catch(() => null),
      getClassificationStats().catch(() => null),
      getLedgerRecent(10).catch(() => []),
      getHealthStatus().catch(() => null),
    ]).then(([s, j, c, l, h]) => {
      setStats(s);
      setJustStats(j as JustificationStats | null);
      setClassStats(c as ClassificationStats | null);
      setRecentEntries(l as LedgerEntry[]);
      setHealth(h as HealthStatus | null);
      setLoading(false);
    });
  }, []);

  const totalEntities = stats
    ? stats.totalFunctions + stats.totalClasses + stats.totalInterfaces + stats.totalVariables
    : 0;
  const justifiedPct = justStats && totalEntities > 0
    ? Math.round((justStats.coverage ?? 0) * 100)
    : 0;
  const classifiedPct = classStats && totalEntities > 0
    ? Math.round((classStats.total / totalEntities) * 100)
    : 0;

  const navigateTo = (path: string, section: string) => {
    setActiveSection(section);
    navigate(path);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-slate-700 rounded-full" />
            <div className="absolute top-0 w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
          <span className="text-sm text-slate-400">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto custom-scrollbar bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-rail-purple/5 via-quantum-violet/5 to-electric-cyan/5" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
        <div className="relative px-8 pt-8 pb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 bg-primary/10 border border-primary/20 rounded-xl">
              <Sparkles className="w-6 h-6 text-electric-cyan" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Dashboard</h1>
              <p className="text-sm text-slate-500">Knowledge graph overview at a glance</p>
            </div>
          </div>

          {/* Hero Stats */}
          <div className="grid grid-cols-4 gap-4">
            <HeroCard
              icon={<Box className="w-5 h-5" />}
              label="Total Entities"
              value={totalEntities}
              color="cyan"
              subtitle={`${stats?.totalFiles ?? 0} files indexed`}
            />
            <HeroCard
              icon={<Shield className="w-5 h-5" />}
              label="Justified"
              value={`${justifiedPct}%`}
              color="purple"
              subtitle={`${justStats?.total ?? 0} justifications`}
            />
            <HeroCard
              icon={<Layers className="w-5 h-5" />}
              label="Classified"
              value={`${classifiedPct}%`}
              color="cyan"
              subtitle={`${classStats?.total ?? 0} classified`}
            />
            <HeroCard
              icon={<Heart className="w-5 h-5" />}
              label="Health"
              value={health?.status ?? 'unknown'}
              color={health?.status === 'healthy' ? 'green' : health?.status === 'degraded' ? 'amber' : 'red'}
              subtitle={`${Object.keys(health?.components ?? {}).length} components`}
            />
          </div>
        </div>
      </div>

      {/* Two-column grid */}
      <div className="px-8 py-6 grid grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-slate-800/30 border border-slate-700/30 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-electric-cyan" />
              <h2 className="text-sm font-semibold text-white">Recent Activity</h2>
            </div>
            <button
              onClick={() => navigateTo('/observability', 'observability')}
              className="text-xs text-slate-500 hover:text-electric-cyan transition-colors"
            >
              View all
            </button>
          </div>
          <div className="space-y-2">
            {recentEntries.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No recent activity</p>
            ) : (
              recentEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-700/30 transition-colors"
                >
                  <div className="w-2 h-2 rounded-full bg-electric-cyan/60 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-slate-300 truncate">
                      {formatEventType(entry.eventType)}
                    </div>
                    {entry.summary && (
                      <div className="text-[11px] text-slate-500 truncate">{entry.summary}</div>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-600 flex-shrink-0 font-mono">
                    {new Date(entry.timestamp).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-slate-800/30 border border-slate-700/30 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-rail-purple" />
            <h2 className="text-sm font-semibold text-white">Quick Actions</h2>
          </div>
          <div className="space-y-2">
            <QuickAction
              icon={<RefreshCw className="w-4 h-4" />}
              label="Trigger Re-index"
              description="Scan files and rebuild knowledge graph"
              onClick={() => triggerReindex().catch(console.error)}
            />
            <QuickAction
              icon={<Shield className="w-4 h-4" />}
              label="Run Justification"
              description="Generate business justifications for entities"
              onClick={() => triggerJustify().catch(console.error)}
            />
            <QuickAction
              icon={<GitBranch className="w-4 h-4" />}
              label="Explore Graph"
              description="Interactive knowledge graph visualization"
              onClick={() => navigateTo('/graph', 'graph')}
            />
            <QuickAction
              icon={<FileCode className="w-4 h-4" />}
              label="Browse Files"
              description="Explore indexed files and entities"
              onClick={() => navigateTo('/explorer', 'explorer')}
            />
          </div>
        </div>
      </div>

      {/* Classification Breakdown */}
      {classStats && Object.keys(classStats.bySubCategory).length > 0 && (
        <div className="px-8 pb-8">
          <div className="bg-slate-800/30 border border-slate-700/30 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-electric-cyan" />
              <h2 className="text-sm font-semibold text-white">Classification Breakdown</h2>
            </div>
            <div className="grid grid-cols-2 gap-6">
              {/* Category bars */}
              <div>
                <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">By Category</h3>
                <div className="space-y-3">
                  {Object.entries(classStats.byCategory)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, count]) => {
                      const pct = classStats.total > 0 ? (count / classStats.total) * 100 : 0;
                      return (
                        <div key={cat}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-300 capitalize">{cat}</span>
                            <span className="text-[10px] text-slate-500">{count} ({Math.round(pct)}%)</span>
                          </div>
                          <div className="h-2 bg-slate-700/50 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                cat === 'domain'
                                  ? 'bg-gradient-to-r from-electric-cyan to-rail-purple'
                                  : 'bg-gradient-to-r from-slate-500 to-slate-400'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
              {/* Sub-category breakdown */}
              <div>
                <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">By Sub-Category</h3>
                <div className="space-y-2 max-h-48 overflow-auto custom-scrollbar">
                  {Object.entries(classStats.bySubCategory)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 10)
                    .map(([sub, count]) => {
                      const pct = classStats.total > 0 ? (count / classStats.total) * 100 : 0;
                      return (
                        <div key={sub} className="flex items-center justify-between">
                          <span className="text-xs text-slate-400 truncate flex-1 mr-2">{sub}</span>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-electric-cyan/60 rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-500 w-8 text-right">{count}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HeroCard({
  icon,
  label,
  value,
  color,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
  subtitle: string;
}) {
  const colorMap: Record<string, { text: string; bg: string }> = {
    cyan: { text: 'text-electric-cyan', bg: 'bg-electric-cyan/10' },
    purple: { text: 'text-quantum-violet', bg: 'bg-rail-purple/10' },
    green: { text: 'text-green-400', bg: 'bg-green-500/10' },
    amber: { text: 'text-amber-400', bg: 'bg-amber-500/10' },
    red: { text: 'text-red-400', bg: 'bg-red-500/10' },
  };
  const c = colorMap[color] ?? colorMap.cyan;

  return (
    <div className="relative group">
      <div className={`absolute inset-0 ${c.bg} rounded-2xl blur-xl opacity-50 group-hover:opacity-100 transition-opacity`} />
      <div className="relative bg-slate-800/40 backdrop-blur-sm border border-slate-700/30 rounded-2xl p-4 hover:border-slate-600/50 transition-all hover:shadow-lg">
        <div className={`${c.text} ${c.bg} w-10 h-10 rounded-xl flex items-center justify-center mb-3`}>
          {icon}
        </div>
        <div className="text-2xl font-bold text-white mb-0.5 capitalize">{value}</div>
        <div className="text-xs text-slate-400 font-medium">{label}</div>
        <div className="text-[10px] text-slate-500 mt-0.5">{subtitle}</div>
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-700/30 border border-transparent hover:border-slate-600/30 transition-all text-left group"
    >
      <div className="text-slate-500 group-hover:text-electric-cyan transition-colors">{icon}</div>
      <div>
        <div className="text-sm text-slate-300 font-medium">{label}</div>
        <div className="text-[11px] text-slate-500">{description}</div>
      </div>
    </button>
  );
}

function formatEventType(eventType: string): string {
  const parts = eventType.split(':');
  if (parts.length <= 1) return eventType;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

export default DashboardView;

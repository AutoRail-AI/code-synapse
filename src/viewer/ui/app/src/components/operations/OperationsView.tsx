import { useState, useEffect } from 'react';
import {
  Settings,
  Brain,
  Layers,
  Play,
  CheckCircle,
  AlertCircle,
  Loader2,
  FolderSync,
  Cpu,
} from 'lucide-react';
import {
  triggerReindex,
  triggerJustify,
  triggerClassify,
  getHealthStatus,
  getJustificationStats,
  getClassificationStats,
} from '../../api/client';

interface OperationStatus {
  status: 'idle' | 'running' | 'success' | 'error';
  message?: string;
  startTime?: Date;
}

export function OperationsView() {
  const [reindexStatus, setReindexStatus] = useState<OperationStatus>({ status: 'idle' });
  const [justifyStatus, setJustifyStatus] = useState<OperationStatus>({ status: 'idle' });
  const [classifyStatus, setClassifyStatus] = useState<OperationStatus>({ status: 'idle' });
  const [health, setHealth] = useState<{
    status: string;
    components: Record<string, { status: string; message?: string }>;
  } | null>(null);
  const [justStats, setJustStats] = useState<{
    total: number;
    byConfidence: Record<string, number>;
    coverage: number;
  } | null>(null);
  const [classStats, setClassStats] = useState<{
    total: number;
    byCategory: Record<string, number>;
  } | null>(null);

  // Load health and stats on mount
  useEffect(() => {
    getHealthStatus()
      .then(setHealth)
      .catch(console.error);

    getJustificationStats()
      .then(setJustStats)
      .catch(console.error);

    getClassificationStats()
      .then(setClassStats)
      .catch(console.error);
  }, []);

  const handleReindex = async () => {
    setReindexStatus({ status: 'running', startTime: new Date() });
    try {
      const result = await triggerReindex();
      setReindexStatus({ status: 'success', message: result.message });
    } catch (err) {
      setReindexStatus({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const handleJustify = async () => {
    setJustifyStatus({ status: 'running', startTime: new Date() });
    try {
      const result = await triggerJustify();
      setJustifyStatus({ status: 'success', message: result.message });
      // Refresh stats
      getJustificationStats().then(setJustStats).catch(console.error);
    } catch (err) {
      setJustifyStatus({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const handleClassify = async () => {
    setClassifyStatus({ status: 'running', startTime: new Date() });
    try {
      const result = await triggerClassify();
      setClassifyStatus({ status: 'success', message: result.message });
      // Refresh stats
      getClassificationStats().then(setClassStats).catch(console.error);
    } catch (err) {
      setClassifyStatus({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  return (
    <div className="h-full overflow-auto custom-scrollbar">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-semibold text-white">Operations</h1>
        </div>

        {/* Health Status */}
        <div className="panel mb-6">
          <div className="panel-header flex items-center justify-between">
            <span>System Health</span>
            <HealthBadge status={health?.status || 'unknown'} />
          </div>
          <div className="panel-content">
            {health ? (
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(health.components).map(([name, comp]) => (
                  <div
                    key={name}
                    className="flex items-center justify-between p-3 bg-slate-700/50 rounded"
                  >
                    <span className="text-slate-300 capitalize">{name}</span>
                    <HealthBadge status={comp.status} small />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-500">Loading health status...</div>
            )}
          </div>
        </div>

        {/* Operations */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Re-index */}
          <OperationCard
            title="Re-index Codebase"
            description="Scan files and rebuild the knowledge graph"
            icon={<FolderSync className="w-6 h-6" />}
            status={reindexStatus}
            onRun={handleReindex}
          />

          {/* Justify */}
          <OperationCard
            title="Generate Justifications"
            description="Infer business purpose for entities"
            icon={<Brain className="w-6 h-6" />}
            status={justifyStatus}
            onRun={handleJustify}
          />

          {/* Classify */}
          <OperationCard
            title="Classify Entities"
            description="Categorize as Domain or Infrastructure"
            icon={<Layers className="w-6 h-6" />}
            status={classifyStatus}
            onRun={handleClassify}
          />
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Justification Stats */}
          <div className="panel">
            <div className="panel-header">Justification Statistics</div>
            <div className="panel-content">
              {justStats ? (
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Justified</span>
                    <span className="text-white font-medium">{justStats.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Coverage</span>
                    <span className="text-white font-medium">
                      {Math.round(justStats.coverage * 100)}%
                    </span>
                  </div>
                  <div className="border-t border-slate-700 pt-4">
                    <div className="text-sm text-slate-500 mb-2">By Confidence</div>
                    {Object.entries(justStats.byConfidence).map(([level, count]) => (
                      <div key={level} className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400 capitalize">{level}</span>
                        <span className="text-slate-300">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-slate-500">Loading...</div>
              )}
            </div>
          </div>

          {/* Classification Stats */}
          <div className="panel">
            <div className="panel-header">Classification Statistics</div>
            <div className="panel-content">
              {classStats ? (
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Classified</span>
                    <span className="text-white font-medium">{classStats.total}</span>
                  </div>
                  <div className="border-t border-slate-700 pt-4">
                    <div className="text-sm text-slate-500 mb-2">By Category</div>
                    {Object.entries(classStats.byCategory).map(([category, count]) => (
                      <div key={category} className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400 capitalize">{category}</span>
                        <span className="text-slate-300">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-slate-500">Loading...</div>
              )}
            </div>
          </div>
        </div>

        {/* LLM Configuration */}
        <div className="panel mt-6">
          <div className="panel-header flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            LLM Configuration
          </div>
          <div className="panel-content">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-500 block mb-1">Model</label>
                <select className="input">
                  <option value="balanced">Balanced (qwen2.5-coder-3b)</option>
                  <option value="fastest">Fastest (qwen2.5-coder-0.5b)</option>
                  <option value="minimal">Minimal (qwen2.5-coder-1.5b)</option>
                  <option value="quality">Quality (qwen2.5-coder-7b)</option>
                  <option value="maximum">Maximum (qwen2.5-coder-14b)</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-500 block mb-1">
                  Batch Size
                </label>
                <input
                  type="number"
                  defaultValue={10}
                  min={1}
                  max={50}
                  className="input"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Changes take effect on next justification/classification run
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OperationCard({
  title,
  description,
  icon,
  status,
  onRun,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  status: OperationStatus;
  onRun: () => void;
}) {
  const isRunning = status.status === 'running';

  return (
    <div className="panel">
      <div className="panel-content">
        <div className="flex items-center gap-3 mb-3">
          <div className="text-blue-400">{icon}</div>
          <div>
            <h3 className="font-medium text-white">{title}</h3>
            <p className="text-xs text-slate-500">{description}</p>
          </div>
        </div>

        {status.status !== 'idle' && (
          <div
            className={`text-sm p-2 rounded mb-3 ${
              status.status === 'running'
                ? 'bg-blue-500/10 text-blue-400'
                : status.status === 'success'
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-red-500/10 text-red-400'
            }`}
          >
            <div className="flex items-center gap-2">
              {status.status === 'running' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : status.status === 'success' ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <AlertCircle className="w-4 h-4" />
              )}
              <span>
                {status.status === 'running'
                  ? 'Running...'
                  : status.message || (status.status === 'success' ? 'Completed' : 'Failed')}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={onRun}
          disabled={isRunning}
          className="btn btn-primary w-full flex items-center justify-center gap-2"
        >
          {isRunning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {isRunning ? 'Running...' : 'Run'}
        </button>
      </div>
    </div>
  );
}

function HealthBadge({ status, small }: { status: string; small?: boolean }) {
  const baseClasses = small ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  const statusClasses =
    status === 'healthy'
      ? 'bg-green-500/20 text-green-400'
      : status === 'degraded'
        ? 'bg-yellow-500/20 text-yellow-400'
        : 'bg-red-500/20 text-red-400';

  return (
    <span className={`${baseClasses} ${statusClasses} rounded-full font-medium`}>
      {status}
    </span>
  );
}

export default OperationsView;

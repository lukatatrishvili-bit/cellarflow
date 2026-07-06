import React, { useMemo } from 'react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import type { Vessel, WineLot, DailyFermLog, LabAnalysis, Task } from '../lib/wineryState';
import TankCapacityChart from './TankCapacityChart';
import FermentationCurveChart from './FermentationCurveChart';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Container,
  LayoutDashboard,
  ShieldAlert,
  TestTube,
  Thermometer,
  Wine,
} from 'lucide-react';
import {
  ActionButton,
  EmptyState,
  InlineNotice,
  MetricCard,
  PageHeader,
  ProgressBar,
  SectionCard,
  StatusBadge,
} from './ui/primitives';

interface WineryDashboardTabProps {
  lang: Language;
  lots: WineLot[];
  vessels: Vessel[];
  fermLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  tasks: Task[];
  chartLotId: string;
  setChartLotId: (val: string) => void;
  selectedTankId: string | null;
  setSelectedTankId: (val: string | null) => void;
  onToggleTaskStatus: (taskId: string) => void;
  setActiveTab?: (tab: string) => void;
  setCalculatorLotId?: (lotId: string) => void;
  setPrefilledTaskTitle?: (title: string) => void;
  setPrefilledTaskPriority?: (priority: 'high' | 'medium' | 'low') => void;
  setPrefilledTaskDesc?: (desc: string) => void;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function formatVolume(value: number) {
  return `${Math.round(value).toLocaleString()} L`;
}

function latestByLot<T extends { lotId: string; date: string }>(records: T[]) {
  return records.reduce<Record<string, T>>((acc, record) => {
    if (!acc[record.lotId] || record.date > acc[record.lotId].date) acc[record.lotId] = record;
    return acc;
  }, {});
}

export default function WineryDashboardTab({
  lang,
  lots,
  vessels,
  fermLogs,
  labLogs,
  tasks,
  chartLotId,
  setChartLotId,
  selectedTankId,
  setSelectedTankId,
  onToggleTaskStatus,
  setActiveTab,
  setCalculatorLotId,
  setPrefilledTaskTitle,
  setPrefilledTaskPriority,
  setPrefilledTaskDesc
}: WineryDashboardTabProps) {
  const t = translations[lang];
  const isKa = lang === 'ka';
  const today = todayISO();
  const go = (tab: string) => setActiveTab ? () => setActiveTab(tab) : undefined;

  const totalLotsVolume = lots.reduce((acc, curr) => acc + curr.currentVolume, 0);
  const totalCapacity = vessels.reduce((acc, curr) => acc + curr.capacity, 0);
  const occupiedVessels = vessels.filter(v => v.currentVolume > 0);
  const occupiedTanksCount = occupiedVessels.length;
  const vesselUsePct = totalCapacity > 0 ? (occupiedVessels.reduce((acc, curr) => acc + curr.currentVolume, 0) / totalCapacity) * 100 : 0;
  const activeFerms = lots.filter(l => l.stage === 'fermenting');
  const activeFermsCount = activeFerms.length;
  const avgTemp = occupiedVessels.length > 0
    ? parseFloat((occupiedVessels.reduce((acc, curr) => acc + (curr.temperature || 0), 0) / occupiedVessels.length).toFixed(1))
    : 0;

  const latestFermByLot = latestByLot(fermLogs);
  const latestLabByLot = latestByLot(labLogs);
  const fermentsMissingReading = activeFerms.filter(lot => latestFermByLot[lot.id]?.date !== today);
  const lowSO2Alerts = Object.values(latestLabByLot).filter(log => log.freeSo2 < 15);
  const highVAAlerts = Object.values(latestLabByLot).filter(log => log.volatileAcid > 0.8);
  const pendingTasks = tasks
    .filter(task => task.status !== 'completed')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdueTasks = pendingTasks.filter(task => task.dueDate < today);
  const readyForBottling = lots.filter(lot => ['stabilization', 'filtration', 'aging'].includes(lot.stage) && lot.currentVolume > 0);

  const workQueue = [
    ...lowSO2Alerts.map(log => ({
      id: `so2-${log.id}`,
      tone: 'danger' as const,
      title: `Low SO₂: ${lots.find(l => l.id === log.lotId)?.name || log.lotId}`,
      detail: `${log.freeSo2} mg/L free SO₂ · ${log.date}`,
      action: () => {
        setCalculatorLotId?.(log.lotId);
        setActiveTab?.('calculators');
      },
      actionLabel: 'Run SO₂ calculator',
    })),
    ...highVAAlerts.map(log => ({
      id: `va-${log.id}`,
      tone: 'danger' as const,
      title: `Volatile acidity warning: ${lots.find(l => l.id === log.lotId)?.name || log.lotId}`,
      detail: `${log.volatileAcid} g/L VA · ${log.date}`,
      action: () => {
        setPrefilledTaskTitle?.(`Inspect & seal vessel for Lot ${log.lotId}`);
        setPrefilledTaskPriority?.('high');
        setPrefilledTaskDesc?.(`Acetation alert: volatile acidity is elevated at ${log.volatileAcid} g/L. Check cooling jacket, clean headspace, verify lid gasket tightness, and purge with CO2/Argon if necessary.`);
        setActiveTab?.('tasks');
      },
      actionLabel: 'Create inspection task',
    })),
    ...fermentsMissingReading.map(lot => ({
      id: `ferm-${lot.id}`,
      tone: 'warning' as const,
      title: `Fermentation reading missing: ${lot.name}`,
      detail: `${lot.currentVolume.toLocaleString()} L · ${lot.variety}`,
      action: go('fermentation'),
      actionLabel: 'Log reading',
    })),
    ...overdueTasks.slice(0, 4).map(task => ({
      id: `task-${task.id}`,
      tone: 'warning' as const,
      title: task.title,
      detail: `Overdue since ${task.dueDate} · ${task.priority} priority`,
      action: go('tasks'),
      actionLabel: 'Review tasks',
    })),
  ].slice(0, 8);

  const chartableLotIds = Array.from(new Set(fermLogs.map(l => l.lotId)));
  const selectedChartLotId = chartLotId && chartableLotIds.includes(chartLotId)
    ? chartLotId
    : chartableLotIds[0] || '';

  const mappedTanks = useMemo(() => {
    return vessels.map(v => ({
      id: v.id,
      name: v.id,
      capacity: v.capacity,
      currentVolume: v.currentVolume,
      status: v.assignedLotId
        ? (lots.find(l => l.id === v.assignedLotId)?.stage === 'fermenting' ? 'fermenting' : 'occupied')
        : (v.cleaningStatus === 'dirty' ? 'cleaning' : 'empty')
    }));
  }, [vessels, lots]);

  const recentFermLogs = [...fermLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const recentTasks = pendingTasks.slice(0, 6);

  return (
    <div className="space-y-5 animate-fade-in text-stone-800 relative z-10">
      <PageHeader
        eyebrow={isKa ? 'Cellar command' : 'Cellar command'}
        title={t.dashboard || 'Winery Dashboard'}
        description={isKa
          ? 'A calmer operating desk for cellar priorities, vessels, fermentation, and urgent work.'
          : 'A calmer operating desk for cellar priorities, vessels, fermentation, and urgent work.'}
        icon={LayoutDashboard}
        actions={(
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={go('fermentation')} className="gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Log fermentation
            </ActionButton>
            <ActionButton tone="secondary" onClick={go('labs')} className="gap-1.5">
              <TestTube className="h-3.5 w-3.5" /> Add lab
            </ActionButton>
            <ActionButton tone="secondary" onClick={go('tasks')} className="gap-1.5">
              <ClipboardList className="h-3.5 w-3.5" /> Tasks
            </ActionButton>
          </div>
        )}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label={t.total_volume || 'Wine volume'}
          value={formatVolume(totalLotsVolume)}
          detail={`${lots.length} active wine lots`}
          icon={Wine}
          tone="brand"
          onClick={go('lots')}
        />
        <MetricCard
          label={t.total_tanks || 'Vessels'}
          value={`${occupiedTanksCount}/${vessels.length}`}
          detail={`${Math.round(vesselUsePct)}% of cellar capacity used`}
          icon={Container}
          tone={vesselUsePct > 85 ? 'warning' : 'info'}
          onClick={go('vessels')}
        />
        <MetricCard
          label={t.active_ferms || 'Fermenting'}
          value={activeFermsCount}
          detail={fermentsMissingReading.length ? `${fermentsMissingReading.length} need readings today` : 'Readings up to date'}
          icon={Activity}
          tone={fermentsMissingReading.length ? 'warning' : 'success'}
          onClick={go('fermentation')}
        />
        <MetricCard
          label={t.temperature || 'Avg vessel temp'}
          value={`${avgTemp} °C`}
          detail={occupiedTanksCount ? `${occupiedTanksCount} occupied vessels` : 'No occupied vessels'}
          icon={Thermometer}
          tone="neutral"
          onClick={go('vessels')}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-5">
        <SectionCard
          title="Today’s cellar queue"
          subtitle="Chemistry risks, missing fermentation readings, and overdue work first."
          icon={ShieldAlert}
          actions={<StatusBadge tone={workQueue.length ? 'warning' : 'success'}>{workQueue.length ? `${workQueue.length} open` : 'clear'}</StatusBadge>}
        >
          {workQueue.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No urgent cellar work"
              description="Chemistry, fermentation, and overdue task signals are clear for the recorded data."
            />
          ) : (
            <div className="space-y-2.5">
              {workQueue.map(item => (
                <div key={item.id} className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800 dark:bg-stone-950/30">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-0.5 rounded-xl border p-2 ${
                      item.tone === 'danger'
                        ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300'
                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
                    }`}>
                      <AlertTriangle className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <strong className="block text-sm font-black text-stone-900 dark:text-amber-50">{item.title}</strong>
                      <span className="block text-[11px] font-semibold text-stone-500 dark:text-stone-400">{item.detail}</span>
                    </div>
                  </div>
                  {item.action && (
                    <ActionButton tone={item.tone === 'danger' ? 'danger' : 'secondary'} onClick={item.action} className="shrink-0">
                      {item.actionLabel}
                    </ActionButton>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Cellar health"
          subtitle="Fast read on capacity and next production moves."
          icon={BarChart3}
        >
          <div className="space-y-4">
            <ProgressBar
              value={vesselUsePct}
              tone={vesselUsePct > 85 ? 'warning' : 'brand'}
              label="Capacity utilization"
            />

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/40">
                <span className="block text-[9px] font-mono font-bold uppercase text-stone-500 dark:text-stone-400">Ready soon</span>
                <strong className="mt-1 block text-xl font-black text-stone-900 dark:text-amber-50">{readyForBottling.length}</strong>
                <span className="text-[10px] font-semibold text-stone-500">lots near bottling</span>
              </div>
              <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/40">
                <span className="block text-[9px] font-mono font-bold uppercase text-stone-500 dark:text-stone-400">Chemistry</span>
                <strong className={`mt-1 block text-xl font-black ${lowSO2Alerts.length || highVAAlerts.length ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {lowSO2Alerts.length + highVAAlerts.length}
                </strong>
                <span className="text-[10px] font-semibold text-stone-500">latest lab alerts</span>
              </div>
            </div>

            {vesselUsePct > 85 && (
              <InlineNotice tone="warning">
                Cellar capacity is getting tight. Consider bottling, transfers, or adding temporary storage before receiving more fruit.
              </InlineNotice>
            )}
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard
          title={isKa ? 'Cellar vessel utilization' : 'Cellar vessel utilization'}
          subtitle="Capacity vs active liquid volume."
          icon={Container}
          actions={<StatusBadge tone="info">D3</StatusBadge>}
        >
          {vessels.length === 0 ? (
            <EmptyState icon={Container} title="No vessels yet" description="Add tanks, qvevri, barrels, or bins to start capacity planning." />
          ) : (
            <TankCapacityChart tanks={mappedTanks} onSelectTank={setSelectedTankId} selectedTankId={selectedTankId} />
          )}
        </SectionCard>

        <SectionCard
          title={isKa ? 'Kinetics & sugar degradation' : 'Kinetics & sugar degradation'}
          subtitle="Fermentation trend for the selected lot."
          icon={Activity}
          actions={chartableLotIds.length > 0 && (
            <select
              value={selectedChartLotId}
              onChange={(e) => setChartLotId(e.target.value)}
              className="w-full sm:w-48 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[10px] font-bold text-stone-800 outline-none dark:border-stone-800 dark:bg-stone-950 dark:text-amber-50"
            >
              {chartableLotIds.map(lId => {
                const associatedLot = lots.find(lt => lt.id === lId);
                return (
                  <option key={lId} value={lId}>
                    {associatedLot ? associatedLot.name : lId}
                  </option>
                );
              })}
            </select>
          )}
        >
          {chartableLotIds.length === 0 ? (
            <EmptyState icon={Activity} title="No fermentation readings yet" description="Log the first daily density and temperature reading to start the curve." />
          ) : (
            <FermentationCurveChart logs={fermLogs} selectedLotId={selectedChartLotId} />
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard
          title={t.upcoming_tasks || 'Upcoming tasks'}
          subtitle="A short work queue, not an endless ledger."
          icon={ClipboardList}
          actions={<StatusBadge tone={overdueTasks.length ? 'danger' : 'neutral'}>{pendingTasks.length} pending</StatusBadge>}
        >
          {recentTasks.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No open tasks" description="Nothing is scheduled in the cellar task list." />
          ) : (
            <div className="space-y-2">
              {recentTasks.map(task => (
                <label key={task.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-100 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-950/30">
                  <input
                    type="checkbox"
                    checked={task.status === 'completed'}
                    onChange={() => onToggleTaskStatus(task.id)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-stone-300 accent-[#4e0e15]"
                  />
                  <span className="min-w-0 flex-1">
                    <strong className={`block text-xs font-black ${task.status === 'completed' ? 'text-stone-500 dark:text-stone-400 line-through' : 'text-stone-900 dark:text-amber-50'}`}>{task.title}</strong>
                    <span className="mt-1 block text-[10px] font-mono font-bold text-stone-500 dark:text-stone-400">
                      Due {task.dueDate} · {task.assignedTo || 'Unassigned'} · {task.priority}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Recent fermentation logs"
          subtitle="Latest cellar readings across lots."
          icon={TestTube}
        >
          {recentFermLogs.length === 0 ? (
            <EmptyState icon={TestTube} title="No readings logged" description="Daily logs will appear here once fermentation tracking starts." />
          ) : (
            <div className="space-y-2.5">
              {recentFermLogs.map(log => {
                const lot = lots.find(l => l.id === log.lotId);
                return (
                  <div key={log.id} className="rounded-xl border border-stone-100 bg-stone-50/60 p-3 text-xs dark:border-stone-800 dark:bg-stone-950/30">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block truncate font-black text-stone-900 dark:text-amber-50">{lot?.name || log.lotId}</strong>
                        <span className="block text-[10px] font-mono font-bold text-stone-500 dark:text-stone-400">{log.date}</span>
                      </div>
                      <StatusBadge tone="info">{log.temperature} °C</StatusBadge>
                    </div>
                    <p className="mt-2 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                      Density {log.density} SG{log.tastingNotes ? ` · ${log.tastingNotes}` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

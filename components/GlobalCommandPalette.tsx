import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Boxes,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Grape,
  PackageSearch,
  Search,
  Settings,
  ShoppingCart,
  Sprout,
  Truck,
  Warehouse,
  Wine,
  X,
} from 'lucide-react';
import type { InventoryItem, SalesDispatchRecord, SalesOrderRecord, Task, Vessel, WineLot } from '../lib/wineryState';
import type { Role } from '../server/permissions';
import type { Language } from '../lib/i18n';
import { canViewAppDestination } from '../lib/navigationPermissions';
import {
  inventoryCategoryLabel,
  reservationStatusLabel,
  stageLabel,
  taskPriorityLabel,
  taskStatusLabel,
  vesselTypeLabel,
} from '../lib/enumLabels';
import { useFocusTrap } from './useFocusTrap';

type CommandKind = 'module' | 'lot' | 'lineage' | 'vessel' | 'inventory' | 'task' | 'order' | 'dispatch';

const KIND_LABEL_KA: Record<CommandKind, string> = {
  module: 'მოდული', lot: 'პარტია', lineage: 'გენეალოგია', vessel: 'ჭურჭელი',
  inventory: 'ინვენტარი', task: 'დავალება', order: 'შეკვეთა', dispatch: 'გატანა',
};

interface CommandItem {
  id: string;
  kind: CommandKind;
  title: string;
  subtitle: string;
  keywords: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

interface Props {
  open: boolean;
  lang?: Language;
  onOpenChange: (open: boolean) => void;
  lots: WineLot[];
  vessels: Vessel[];
  inventory: InventoryItem[];
  tasks: Task[];
  orders: SalesOrderRecord[];
  dispatches: SalesDispatchRecord[];
  role?: Role;
  setActiveModule: (moduleId: string) => void;
  setActiveTab: (tabId: string) => void;
  setPassportLotId: (lotId: string | null) => void;
  setSelectedTankId: (vesselId: string | null) => void;
  setLineageLotId: (lotId: string) => void;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function kindTone(kind: CommandKind): string {
  switch (kind) {
    case 'module': return 'bg-stone-100 text-stone-700 border-stone-200';
    case 'lot': return 'bg-rose-100 text-[#4e0e15] border-rose-200';
    case 'lineage': return 'bg-amber-100 text-amber-900 border-amber-200';
    case 'vessel': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'inventory': return 'bg-zinc-100 text-zinc-700 border-zinc-200';
    case 'task': return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'order': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'dispatch': return 'bg-teal-100 text-teal-800 border-teal-200';
    default: return 'bg-stone-100 text-stone-700 border-stone-200';
  }
}

export default function GlobalCommandPalette({
  open,
  lang = 'en',
  onOpenChange,
  lots,
  vessels,
  inventory,
  tasks,
  orders,
  dispatches,
  role = 'Owner/Admin',
  setActiveModule,
  setActiveTab,
  setPassportLotId,
  setSelectedTankId,
  setLineageLotId,
}: Props) {
  const ka = lang === 'ka';
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const close = () => onOpenChange(false);
  useFocusTrap(dialogRef, { active: open, onClose: close });

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [open]);

  const jump = (moduleId: string, tabId?: string) => {
    setActiveModule(moduleId);
    if (tabId) setActiveTab(tabId);
    close();
  };

  const commands = useMemo<CommandItem[]>(() => {
    const allModuleCommands: Array<CommandItem & { moduleId: string; tabId?: string }> = [
      { id: 'module-dashboard', moduleId: 'portal', kind: 'module', title: ka ? 'მთავარი' : 'Dashboard', subtitle: ka ? 'მთავარი პორტალის გახსნა' : 'Open main portal', keywords: 'dashboard portal home overview მთავარი', icon: BarChart3, run: () => jump('portal') },
      { id: 'module-vineyard', moduleId: 'vazi', kind: 'module', title: ka ? 'ვენახი' : 'Vineyard', subtitle: ka ? 'ვაზის მოდულის გახსნა' : 'Open Vazi vineyard module', keywords: 'vazi vineyard blocks harvest phenology spray ვენახი', icon: Sprout, run: () => jump('vazi') },
      { id: 'module-cellar', moduleId: 'gvino', tabId: 'dashboard', kind: 'module', title: ka ? 'მარანი' : 'Cellar', subtitle: ka ? 'ღვინის მოდულის გახსნა' : 'Open Gvino winery module', keywords: 'gvino cellar winery lots tanks vessels მარანი', icon: Wine, run: () => jump('gvino', 'dashboard') },
      { id: 'module-sales', moduleId: 'sales', kind: 'module', title: ka ? 'გაყიდვები' : 'Sales', subtitle: ka ? 'შეკვეთები, ჯავშნები, გატანა' : 'Orders, reservations, dispatch', keywords: 'sales orders reservations dispatch customers გაყიდვები', icon: ShoppingCart, run: () => jump('sales') },
      { id: 'module-storage', moduleId: 'storage', kind: 'module', title: ka ? 'საწყობი' : 'Storage', subtitle: ka ? 'მზა პროდუქციის მარაგი' : 'Finished goods stock', keywords: 'storage warehouse stock bottles inventory finished goods საწყობი', icon: Warehouse, run: () => jump('storage') },
      { id: 'module-analytics', moduleId: 'analytics', kind: 'module', title: ka ? 'ანალიტიკა' : 'Analytics', subtitle: ka ? 'წლების შედარების ანგარიშები' : 'Year comparison reports', keywords: 'analytics reports year comparison vintage margin ანალიტიკა', icon: BarChart3, run: () => jump('analytics') },
      { id: 'module-docs', moduleId: 'docs', kind: 'module', title: ka ? 'დოკუმენტები' : 'Documents', subtitle: ka ? 'ოფიციალური დოკუმენტები და ექსპორტი' : 'Official documents and exports', keywords: 'documents reports official forms exports დოკუმენტები', icon: FileSpreadsheet, run: () => jump('docs') },
      { id: 'module-settings', moduleId: 'settings', kind: 'module', title: ka ? 'პარამეტრები' : 'Settings', subtitle: ka ? 'პროფილი და კომპანიის პარამეტრები' : 'Profile and company settings', keywords: 'settings profile company users პარამეტრები', icon: Settings, run: () => jump('settings') },
    ];
    const moduleCommands = allModuleCommands.filter((item) => (
      canViewAppDestination(role, item.moduleId, item.tabId)
    ));

    const lotCommands = canViewAppDestination(role, 'gvino', 'lots') ? lots.flatMap<CommandItem>((lot) => [
      {
        id: `lot-${lot.id}`,
        kind: 'lot',
        title: lot.id,
        subtitle: `${lot.name} · ${lot.vintage} · ${stageLabel(lot.stage, lang)}`,
        keywords: `${lot.id} ${lot.name} ${lot.variety} ${lot.vineyardBlock} ${lot.region} ${lot.vintage} wine lot passport`,
        icon: Wine,
        run: () => {
          setActiveModule('gvino');
          setActiveTab('lots');
          setPassportLotId(lot.id);
          close();
        },
      },
      {
        id: `lineage-${lot.id}`,
        kind: 'lineage',
        title: `${ka ? 'გენეალოგია' : 'Lineage'}: ${lot.id}`,
        subtitle: lot.name,
        keywords: `${lot.id} ${lot.name} lineage traceability genealogy tree blend`,
        icon: PackageSearch,
        run: () => {
          setActiveModule('gvino');
          setActiveTab('lineage');
          setLineageLotId(lot.id);
          setPassportLotId(null);
          close();
        },
      },
    ]) : [];

    const vesselCommands = canViewAppDestination(role, 'gvino', 'vessels') ? vessels.map<CommandItem>((vessel) => ({
      id: `vessel-${vessel.id}`,
      kind: 'vessel',
      title: vessel.id,
      subtitle: `${vessel.type ? vesselTypeLabel(vessel.type, lang) : (ka ? 'ჭურჭელი' : 'vessel')} · ${(vessel.currentVolume || 0).toLocaleString()} / ${(vessel.capacity || 0).toLocaleString()} L`,
      keywords: `${vessel.id} ${vessel.type || ''} ${vessel.assignedLotId || ''} ${vessel.locationDetails || ''} tank vessel qvevri barrel`,
      icon: Grape,
      run: () => {
        setActiveModule('gvino');
        setActiveTab('vessels');
        setSelectedTankId(vessel.id);
        close();
      },
    })) : [];

    const inventoryCommands = canViewAppDestination(role, 'gvino', 'inventory') ? inventory.map<CommandItem>((item) => ({
      id: `inventory-${item.id}`,
      kind: 'inventory',
      title: item.name,
      subtitle: `${inventoryCategoryLabel(item.category, lang)} · ${(item.stock || 0).toLocaleString()} ${item.unit}`,
      keywords: `${item.id} ${item.name} ${item.category} ${item.supplierName} inventory additive packaging stock`,
      icon: Boxes,
      run: () => jump('gvino', 'inventory'),
    })) : [];

    const taskCommands = canViewAppDestination(role, 'gvino', 'tasks') ? tasks.map<CommandItem>((task) => ({
      id: `task-${task.id}`,
      kind: 'task',
      title: task.title,
      subtitle: ka
        ? `${taskPriorityLabel(task.priority, lang)} · ვადა ${task.dueDate || '—'} · ${taskStatusLabel(task.status, lang)}`
        : `${taskPriorityLabel(task.priority, lang)} priority · due ${task.dueDate || 'n/a'} · ${taskStatusLabel(task.status, lang)}`,
      keywords: `${task.title} ${task.description} ${task.assignedTo} ${task.priority} ${task.status} task todo`,
      icon: ClipboardList,
      run: () => jump('gvino', 'tasks'),
    })) : [];

    const orderCommands = canViewAppDestination(role, 'sales') ? orders.map<CommandItem>((order) => ({
      id: `order-${order.id}`,
      kind: 'order',
      title: order.orderNumber || order.customerName,
      subtitle: `${order.customerName} · ${(order.bottles || 0).toLocaleString()} ${ka ? 'ბოთლი' : 'btl'} · ${reservationStatusLabel(order.status, lang)}`,
      keywords: `${order.id} ${order.orderNumber || ''} ${order.customerName} ${order.lotId} ${order.lotName} ${order.status} reservation order sales`,
      icon: ShoppingCart,
      run: () => jump('sales'),
    })) : [];

    const dispatchCommands = canViewAppDestination(role, 'sales') ? dispatches.map<CommandItem>((dispatch) => ({
      id: `dispatch-${dispatch.id}`,
      kind: 'dispatch',
      title: dispatch.customerName,
      subtitle: `${dispatch.lotName} · ${(dispatch.bottles || 0).toLocaleString()} btl · ${dispatch.date}`,
      keywords: `${dispatch.id} ${dispatch.customerName} ${dispatch.lotId} ${dispatch.lotName} dispatch sale revenue`,
      icon: Truck,
      run: () => jump('sales'),
    })) : [];


    return [
      ...moduleCommands,
      ...lotCommands,
      ...vesselCommands,
      ...orderCommands,
      ...dispatchCommands,
      ...inventoryCommands,
      ...taskCommands,
    ];
  }, [dispatches, inventory, lots, orders, role, tasks, vessels, ka]);

  const results = useMemo(() => {
    const q = normalize(query);
    if (!q) return commands.slice(0, 12);
    const tokens = q.split(' ').filter(Boolean);
    return commands
      .map(item => {
        const haystack = normalize(`${item.title} ${item.subtitle} ${item.keywords}`);
        const score = tokens.reduce((acc, token) => {
          if (normalize(item.title).startsWith(token)) return acc + 12;
          if (haystack.includes(token)) return acc + 4;
          return acc;
        }, 0);
        return { item, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
      .slice(0, 14)
      .map(x => x.item);
  }, [commands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) return null;

  const select = (item: CommandItem | undefined) => {
    if (!item) return;
    item.run();
  };

  return (
    <div className="fixed inset-0 z-[90] bg-stone-950/35 backdrop-blur-sm p-4 sm:p-8" onMouseDown={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ka ? 'გლობალური ბრძანებების პანელი' : 'Global command palette'}
        tabIndex={-1}
        className="mx-auto mt-10 max-w-2xl overflow-hidden rounded-3xl border border-[#e8dfd5] bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[#e8dfd5] px-4 py-3 dark:border-stone-800">
          <Search className="w-5 h-5 text-[#4e0e15] dark:text-amber-300" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex(i => Math.min(results.length - 1, i + 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex(i => Math.max(0, i - 1));
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                select(results[selectedIndex]);
              }
            }}
            placeholder={ka ? 'ძიება: ღვინის კოდი, ჭურჭელი, მომხმარებელი, დავალება, დოკუმენტი...' : 'Search wine code, vessel, customer, task, document...'}
            className="min-w-0 flex-1 bg-transparent py-2 text-sm font-semibold text-stone-900 outline-none placeholder:text-stone-400 dark:text-amber-50"
          />
          <button
            type="button"
            onClick={close}
            className="rounded-xl p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-900 dark:hover:text-stone-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[520px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-stone-300" />
              <h3 className="text-sm font-bold text-stone-700 dark:text-stone-200">{ka ? 'შედეგი არ მოიძებნა' : 'No results found'}</h3>
              <p className="mt-1 text-xs text-stone-400">{ka ? 'სცადეთ ღვინის კოდი, ჭურჭლის ID, მომხმარებლის სახელი ან მოდული.' : 'Try a wine code, vessel ID, customer name, or module.'}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((item, index) => {
                const Icon = item.icon;
                const selected = index === selectedIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => select(item)}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                      selected
                        ? 'bg-[#4e0e15] text-amber-50'
                        : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-900'
                    }`}
                  >
                    <div className={`rounded-xl border p-2 ${selected ? 'border-amber-300/30 bg-amber-100/10 text-amber-200' : kindTone(item.kind)}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <strong className="truncate text-sm">{item.title}</strong>
                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide ${selected ? 'border-amber-300/40 text-amber-200' : kindTone(item.kind)}`}>
                          {ka ? KIND_LABEL_KA[item.kind] : item.kind}
                        </span>
                      </div>
                      <p className={`truncate text-xs ${selected ? 'text-amber-100/75' : 'text-stone-400'}`}>{item.subtitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#e8dfd5] px-4 py-2 text-[10px] font-mono text-stone-400 dark:border-stone-800">
          <span>{ka ? '↑↓ ნავიგაცია · Enter გახსნა · Esc დახურვა' : '↑↓ navigate · Enter open · Esc close'}</span>
          <span>Ctrl / Cmd + K</span>
        </div>
      </div>
    </div>
  );
}

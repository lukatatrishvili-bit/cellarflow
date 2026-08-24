import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  Boxes,
  GitMerge,
  Grape,
  Maximize2,
  Minimize2,
  PackageCheck,
  Search,
  ShoppingCart,
  Shuffle,
  Sparkles,
  Truck,
  Wine,
  Wrench,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type {
  BottlingRunRecord,
  CellarOperation,
  CellarTransferRecord,
  CertificationRecord,
  GrapeIntakeRecord,
  SalesDispatchRecord,
  SalesOrderRecord,
  WineLot,
} from '../lib/wineryState';
import type { StorageLocation, StockMovement } from '../lib/storage';
import { stageLabel } from '../lib/enumLabels';
import {
  buildLotLineageGraph,
  fitLineageZoom,
  layoutLineageGraph,
  lineagePathTargets,
  LINEAGE_NODE_HEIGHT,
  LINEAGE_NODE_WIDTH,
  type LineageEdge,
  type LineageNode,
  type LineageNodeType,
  type PositionedLineageNode,
  shortestPathNodeIds,
} from '../lib/lineage';
import { EmptyState, PageHeader, SectionCard, StatusBadge } from './ui/primitives';

interface Props {
  lang: Language;
  lots: WineLot[];
  grapeIntakes: GrapeIntakeRecord[];
  cellarOps: CellarOperation[];
  transfers: CellarTransferRecord[];
  bottlingRuns: BottlingRunRecord[];
  storageLocations: StorageLocation[];
  stockMovements: StockMovement[];
  salesOrders: SalesOrderRecord[];
  salesDispatches: SalesDispatchRecord[];
  certificationRecords?: CertificationRecord[];
  focusLotId?: string;
}

const typeMeta: Record<LineageNodeType, {
  label: string;
  labelKa: string;
  icon: React.ComponentType<{ className?: string }>;
  card: string;
  badge: string;
  line: string;
}> = {
  grape_intake: {
    label: 'Grape intake',
    labelKa: 'მიღება',
    icon: Grape,
    card: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/20',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    line: '#059669',
  },
  wine_lot: {
    label: 'Wine lot',
    labelKa: 'პარტია',
    icon: Wine,
    card: 'border-rose-200 bg-white dark:border-rose-950 dark:bg-stone-900',
    badge: 'bg-rose-100 text-rose-800 border-rose-200',
    line: '#7f1d1d',
  },
  blend: {
    label: 'Blend',
    labelKa: 'კუპაჟი',
    icon: GitMerge,
    card: 'border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20',
    badge: 'bg-amber-100 text-amber-900 border-amber-200',
    line: '#d97706',
  },
  transfer: {
    label: 'Transfer',
    labelKa: 'გადატანა',
    icon: Shuffle,
    card: 'border-sky-200 bg-sky-50/80 dark:border-sky-900 dark:bg-sky-950/20',
    badge: 'bg-sky-100 text-sky-800 border-sky-200',
    line: '#0284c7',
  },
  cellar_operation: {
    label: 'Operation',
    labelKa: 'ოპერაცია',
    icon: Wrench,
    card: 'border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-950/50',
    badge: 'bg-stone-100 text-stone-700 border-stone-200',
    line: '#78716c',
  },
  bottling: {
    label: 'Bottling',
    labelKa: 'ჩამოსხმა',
    icon: PackageCheck,
    card: 'border-blue-200 bg-blue-50/80 dark:border-blue-900 dark:bg-blue-950/20',
    badge: 'bg-blue-100 text-blue-800 border-blue-200',
    line: '#2563eb',
  },
  storage: {
    label: 'Storage',
    labelKa: 'საწყობი',
    icon: Boxes,
    card: 'border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-950/50',
    badge: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    line: '#52525b',
  },
  reservation: {
    label: 'Reservation',
    labelKa: 'ჯავშანი',
    icon: ShoppingCart,
    card: 'border-purple-200 bg-purple-50/80 dark:border-purple-900 dark:bg-purple-950/20',
    badge: 'bg-purple-100 text-purple-800 border-purple-200',
    line: '#7c3aed',
  },
  dispatch: {
    label: 'Dispatch',
    labelKa: 'რეალიზაცია',
    icon: Truck,
    card: 'border-teal-200 bg-teal-50/80 dark:border-teal-900 dark:bg-teal-950/20',
    badge: 'bg-teal-100 text-teal-800 border-teal-200',
    line: '#0d9488',
  },
  certification: {
    label: 'Certification',
    labelKa: 'Certification',
    icon: BadgeCheck,
    card: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/20',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    line: '#16a34a',
  },
};

const edgeLabel: Record<LineageEdge['type'], { en: string; ka: string }> = {
  created: { en: 'created', ka: 'შეიქმნა' },
  transferred: { en: 'moved', ka: 'გადატანა' },
  blended: { en: 'blend component', ka: 'კუპაჟის ნაწილი' },
  operated: { en: 'operation', ka: 'ოპერაცია' },
  bottled: { en: 'bottled', ka: 'ჩამოისხა' },
  stored: { en: 'stored', ka: 'შენახვა' },
  reserved: { en: 'reserved', ka: 'ჯავშანი' },
  sold: { en: 'sold', ka: 'გაიყიდა' },
  certified: { en: 'certified', ka: 'Certification' },
};

function nodeMeta(node: LineageNode) {
  return typeMeta[node.type] || typeMeta.wine_lot;
}

function formatQty(node: LineageNode): string {
  const parts: string[] = [];
  if (node.volumeL) parts.push(`${node.volumeL.toLocaleString(undefined, { maximumFractionDigits: 1 })} L`);
  if (node.bottles) parts.push(`${node.bottles.toLocaleString()} btl`);
  return parts.join(' · ');
}

function nodeCenterRight(node: PositionedLineageNode) {
  return { x: node.x + LINEAGE_NODE_WIDTH, y: node.y + LINEAGE_NODE_HEIGHT / 2 };
}

function nodeCenterLeft(node: PositionedLineageNode) {
  return { x: node.x, y: node.y + LINEAGE_NODE_HEIGHT / 2 };
}

function EdgePath({ edge, nodesById }: { edge: LineageEdge; nodesById: Map<string, PositionedLineageNode> }) {
  const from = nodesById.get(edge.from);
  const to = nodesById.get(edge.to);
  if (!from || !to) return null;
  const a = nodeCenterRight(from);
  const b = nodeCenterLeft(to);
  const curve = Math.max(70, Math.min(180, (b.x - a.x) * 0.5));
  const d = `M ${a.x} ${a.y} C ${a.x + curve} ${a.y}, ${b.x - curve} ${b.y}, ${b.x} ${b.y}`;
  const stroke = nodeMeta(from).line;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;

  return (
    <g>
      <path d={d} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" opacity="0.82" />
      <path d={d} fill="none" stroke="transparent" strokeWidth="12" />
      <circle cx={b.x} cy={b.y} r="3.5" fill={stroke} opacity="0.9" />
      {edge.label && (
        <g>
          <rect x={midX - 46} y={midY - 10} width="92" height="18" rx="9" fill="white" opacity="0.92" />
          <text x={midX} y={midY + 3} textAnchor="middle" fontSize="9" fontWeight="700" fill="#78716c">
            {edge.label.slice(0, 19)}
          </text>
        </g>
      )}
    </g>
  );
}

function LineageCard({
  node,
  selected,
  onSelect,
  ka,
}: {
  node: PositionedLineageNode;
  selected: boolean;
  onSelect: (node: PositionedLineageNode) => void;
  ka: boolean;
}) {
  const meta = nodeMeta(node);
  const Icon = meta.icon;
  const qty = formatQty(node);

  return (
    <button
      type="button"
      onClick={() => onSelect(node)}
      className={`absolute text-left rounded-2xl border shadow-sm p-3 transition-all cursor-pointer hover:-translate-y-0.5 hover:shadow-md ${meta.card} ${node.emphasis ? 'ring-2 ring-[#4e0e15]/25 dark:ring-amber-300/25' : ''} ${selected ? 'outline outline-2 outline-[#4e0e15]' : ''}`}
      style={{ left: node.x, top: node.y, width: LINEAGE_NODE_WIDTH, height: LINEAGE_NODE_HEIGHT }}
    >
      <div className="flex items-start gap-2">
        <div className={`p-1.5 rounded-xl border ${meta.badge}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[8px] uppercase font-mono font-black px-1.5 py-0.5 rounded border ${meta.badge}`}>
              {ka ? meta.labelKa : meta.label}
            </span>
            {node.date && <span className="text-[8px] font-mono text-stone-400">{node.date}</span>}
          </div>
          <strong className="block mt-1 text-[12px] leading-tight font-black text-stone-900 dark:text-amber-50 truncate">
            {node.label}
          </strong>
          {node.subtitle && (
            <span className="block text-[10px] leading-tight text-stone-500 dark:text-stone-400 truncate">
              {node.subtitle}
            </span>
          )}
          {qty && (
            <span className="block mt-1 text-[9px] font-mono font-bold text-stone-500 dark:text-stone-400 truncate">
              {qty}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function DetailPanel({ node, edges, ka }: { node: LineageNode | null; edges: LineageEdge[]; ka: boolean }) {
  if (!node) return null;

  const meta = nodeMeta(node);
  const Icon = meta.icon;
  const relatedEdges = edges.filter(e => e.from === node.id || e.to === node.id);
  const metadata = Object.entries(node.metadata || {}).filter(([, value]) => value !== undefined && value !== null && value !== '');

  return (
    <SectionCard title={node.label} icon={Icon}>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        {[
          [ka ? 'თარიღი' : 'Date', node.date || '—'],
          [ka ? 'პარტია' : 'Lot', node.lotId || '—'],
          [ka ? 'მოცულობა' : 'Volume', node.volumeL ? `${node.volumeL.toLocaleString()} L` : '—'],
          [ka ? 'ბოთლები' : 'Bottles', node.bottles ? `${node.bottles.toLocaleString()} ${ka ? 'ბოთ.' : 'btl'}` : '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-stone-50 p-2 dark:bg-stone-950/50">
            <span className="block text-[8px] uppercase font-mono text-stone-400 font-bold">{label}</span>
            <strong className="text-stone-700 dark:text-stone-200">{value}</strong>
          </div>
        ))}
      </div>

      {relatedEdges.length > 0 && (
        <div className="mt-3">
          <span className="text-[9px] uppercase font-mono text-stone-400 font-bold">{ka ? 'კავშირები' : 'Links'}</span>
          <div className="mt-1 space-y-1.5">
            {relatedEdges.map(edge => (
              <div key={edge.id} className="text-[10px] rounded-lg bg-stone-50 px-2 py-1.5 text-stone-600 dark:bg-stone-950/50 dark:text-stone-300">
                <strong>{ka ? edgeLabel[edge.type].ka : edgeLabel[edge.type].en}</strong>
                {edge.label ? ` · ${edge.label}` : ''}
              </div>
            ))}
          </div>
        </div>
      )}

      {metadata.length > 0 && (
        <div className="mt-3">
          <span className="text-[9px] uppercase font-mono text-stone-400 font-bold">{ka ? 'მეტამონაცემები' : 'Metadata'}</span>
          <div className="mt-1 space-y-1.5 max-h-44 overflow-y-auto pr-1">
            {metadata.slice(0, 8).map(([key, value]) => {
              const keyKa: Record<string, string> = {
                vintage: 'მოსავალი', variety: 'ჯიში', stage: 'ეტაპი', wineClass: 'ღვინის კლასი',
                region: 'რეგიონი', block: 'ნაკვეთი', operator: 'ოპერატორი', supplier: 'მომწოდებელი',
              };
              const displayKey = ka ? (keyKa[key] || key) : key;
              const displayValue = key === 'stage'
                ? stageLabel(String(value), ka ? 'ka' : 'en')
                : key === 'wineClass' && ka
                  ? ({red_dry: 'წითელი მშრალი', white_dry: 'თეთრი მშრალი', amber_dry: 'ქარვისფერი მშრალი', rose: 'ვარდისფერი'} as Record<string, string>)[String(value)] || String(value)
                  : String(value);
              return (
                <div key={key} className="text-[10px] rounded-lg bg-stone-50 px-2 py-1.5 text-stone-600 dark:bg-stone-950/50 dark:text-stone-300">
                  <strong className="font-mono">{displayKey}</strong>: {displayValue}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function MiniMap({
  ka,
  nodes,
  edges,
  nodesById,
  width,
  height,
  selectedNodeId,
}: {
  ka: boolean;
  nodes: PositionedLineageNode[];
  edges: LineageEdge[];
  nodesById: Map<string, PositionedLineageNode>;
  width: number;
  height: number;
  selectedNodeId?: string;
}) {
  if (nodes.length === 0) return null;
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);

  return (
    <SectionCard title={ka ? 'მინი რუკა' : 'Mini map'}>
      <div className="relative h-20 overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-950/40">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {edges.map(edge => {
            const from = nodesById.get(edge.from);
            const to = nodesById.get(edge.to);
            if (!from || !to) return null;
            return (
              <line
                key={edge.id}
                x1={((from.x + LINEAGE_NODE_WIDTH) / safeWidth) * 100}
                y1={((from.y + LINEAGE_NODE_HEIGHT / 2) / safeHeight) * 100}
                x2={(to.x / safeWidth) * 100}
                y2={((to.y + LINEAGE_NODE_HEIGHT / 2) / safeHeight) * 100}
                stroke={nodeMeta(from).line}
                strokeWidth="1.2"
                opacity="0.45"
              />
            );
          })}
        </svg>
        {nodes.map(node => (
          <span
            key={node.id}
            className={`absolute h-2 w-3 rounded-full border ${
              selectedNodeId === node.id
                ? 'border-[#4e0e15] bg-[#4e0e15]'
                : 'border-white bg-stone-400 dark:border-stone-950'
            }`}
            style={{
              left: `${(node.x / safeWidth) * 100}%`,
              top: `${(node.y / safeHeight) * 100}%`,
            }}
          />
        ))}
      </div>
    </SectionCard>
  );
}

export function LotLineageGraphTab({
  lang,
  lots,
  grapeIntakes,
  cellarOps,
  transfers,
  bottlingRuns,
  storageLocations,
  stockMovements,
  salesOrders,
  salesDispatches,
  certificationRecords = [],
  focusLotId,
}: Props) {
  const ka = lang === 'ka';
  const [query, setQuery] = useState('');
  const [selectedLotId, setSelectedLotId] = useState(focusLotId || lots[0]?.id || '');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [focusPathOnly, setFocusPathOnly] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const lastAutoFitKeyRef = useRef('');
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const lotOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? lots.filter(l => `${l.id} ${l.name} ${l.variety} ${l.vintage}`.toLowerCase().includes(q))
      : lots;
    return filtered.slice().sort((a, b) => b.vintage - a.vintage || a.id.localeCompare(b.id));
  }, [lots, query]);

  React.useEffect(() => {
    if (!selectedLotId && lots[0]) setSelectedLotId(lots[0].id);
    if (selectedLotId && !lots.some(l => l.id === selectedLotId)) setSelectedLotId(lots[0]?.id || '');
  }, [lots, selectedLotId]);

  React.useEffect(() => {
    if (focusLotId && lots.some(l => l.id === focusLotId)) {
      setSelectedLotId(focusLotId);
      setSelectedNodeId(null);
      setFocusPathOnly(false);
    }
  }, [focusLotId, lots]);

  const graph = useMemo(() => {
    if (!selectedLotId) return { nodes: [], edges: [] };
    return buildLotLineageGraph({
      lots,
      grapeIntakes,
      cellarOps,
      transfers,
      bottlingRuns,
      storageLocations,
      stockMovements,
      salesOrders,
      salesDispatches,
      certificationRecords,
    }, selectedLotId);
  }, [bottlingRuns, cellarOps, certificationRecords, grapeIntakes, lots, salesDispatches, salesOrders, selectedLotId, stockMovements, storageLocations, transfers]);

  const visibleNodeIds = useMemo(() => {
    if (!focusPathOnly || !selectedNodeId) return null;
    const ids = shortestPathNodeIds(graph, `lot:${selectedLotId}`, selectedNodeId);
    return ids.size > 0 ? ids : null;
  }, [focusPathOnly, graph, selectedLotId, selectedNodeId]);

  const visibleGraph = useMemo(() => {
    if (!visibleNodeIds) return graph;
    return {
      nodes: graph.nodes.filter(node => visibleNodeIds.has(node.id)),
      edges: graph.edges.filter(edge => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)),
    };
  }, [graph, visibleNodeIds]);

  const pathTargets = useMemo(
    () => lineagePathTargets(graph, `lot:${selectedLotId}`),
    [graph, selectedLotId],
  );

  const positioned = useMemo(() => layoutLineageGraph(visibleGraph), [visibleGraph]);
  const nodesById = useMemo(() => new Map(positioned.nodes.map(n => [n.id, n])), [positioned.nodes]);
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) || null : positioned.nodes.find(n => n.emphasis) || null;
  const selectedLot = lots.find(l => l.id === selectedLotId);
  const visibleNodes = positioned.nodes;
  const visibleEdges = positioned.edges;
  const counts = graph.nodes.reduce<Record<LineageNodeType, number>>((acc, node) => {
    acc[node.type] = (acc[node.type] || 0) + 1;
    return acc;
  }, {} as Record<LineageNodeType, number>);

  useEffect(() => {
    const element = canvasViewportRef.current;
    if (!element) return;
    const measure = () => setViewportSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [positioned.nodes.length]);

  const fitView = useCallback(() => {
    if (!positioned.nodes.length || !viewportSize.width || !viewportSize.height) return;
    setZoom(fitLineageZoom(positioned.width, positioned.height, viewportSize.width, viewportSize.height));
    canvasViewportRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  }, [positioned.height, positioned.nodes.length, positioned.width, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    fitView();
  }, [fitView, isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  const visibleGraphKey = visibleNodeIds ? Array.from(visibleNodeIds).sort().join('|') : 'all';
  useEffect(() => {
    if (!positioned.nodes.length || !viewportSize.width || !viewportSize.height) return;
    const key = `${selectedLotId}:${visibleGraphKey}:${positioned.width}x${positioned.height}`;
    if (lastAutoFitKeyRef.current === key) return;
    lastAutoFitKeyRef.current = key;
    setZoom(fitLineageZoom(positioned.width, positioned.height, viewportSize.width, viewportSize.height));
  }, [positioned.height, positioned.nodes.length, positioned.width, selectedLotId, viewportSize.height, viewportSize.width, visibleGraphKey]);

  const scaledWidth = Math.max(positioned.width * zoom, viewportSize.width || 1);
  const scaledHeight = Math.max(positioned.height * zoom, viewportSize.height || 360);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        eyebrow={ka ? 'მიკვლევადობა' : 'Lineage'}
        title={ka ? 'ღვინის კოდის მიკვლევადობის ხე' : 'Wine Code Traceability Tree'}
        icon={GitMerge}
        actions={(
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
            <div className="relative w-full sm:w-[240px] sm:min-w-[240px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={ka ? 'ძებნა: კოდი, ღვინო, ჯიში...' : 'Search lot code, wine, variety...'}
                className="w-full pl-9 pr-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-semibold outline-none focus:border-[#4e0e15] dark:bg-stone-950 dark:border-stone-800 dark:text-amber-50"
              />
            </div>
            <select
              value={selectedLotId}
              onChange={e => {
                setSelectedLotId(e.target.value);
                setSelectedNodeId(null);
                setFocusPathOnly(false);
              }}
              className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs font-bold sm:w-[260px] sm:min-w-[260px] dark:bg-stone-950 dark:border-stone-800 dark:text-amber-50"
            >
              {lotOptions.map(lot => (
                <option key={lot.id} value={lot.id}>{lot.id} · {lot.name}</option>
              ))}
            </select>
            <select
              value={focusPathOnly ? selectedNodeId || '' : ''}
              onChange={event => {
                const nodeId = event.target.value;
                setSelectedNodeId(nodeId || null);
                setFocusPathOnly(Boolean(nodeId));
              }}
              aria-label={ka ? 'მიკვლევადობის ბოლო წერტილი' : 'Trace endpoint'}
              className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs font-bold sm:w-[230px] sm:min-w-[230px] dark:bg-stone-950 dark:border-stone-800 dark:text-amber-50"
            >
              <option value="">{ka ? 'სრული გრაფი · აირჩიეთ გზა' : 'Full graph · choose a path'}</option>
              {pathTargets.map(node => (
                <option key={node.id} value={node.id}>
                  {(ka ? typeMeta[node.type].labelKa : typeMeta[node.type].label)} · {node.label}
                </option>
              ))}
            </select>
            <div className="flex shrink-0 items-center gap-1 rounded-xl border border-stone-200 bg-stone-50 p-1 dark:border-stone-800 dark:bg-stone-950">
              <button
                type="button"
                onClick={() => setZoom(value => Math.max(0.02, Math.round((value - 0.1) * 10) / 10))}
                className="rounded-lg p-2 text-stone-500 hover:bg-white hover:text-[#4e0e15] dark:hover:bg-stone-900 dark:hover:text-amber-200"
                title={ka ? 'დაშორება' : 'Zoom out'}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="min-w-10 rounded-lg px-2 py-2 text-center text-[10px] font-mono font-black text-stone-500 hover:bg-white hover:text-[#4e0e15] dark:hover:bg-stone-900 dark:hover:text-amber-200"
                title={ka ? 'გადიდების გადატვირთვა' : 'Reset zoom'}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={fitView}
                className="rounded-lg p-2 text-stone-500 hover:bg-white hover:text-[#4e0e15] dark:hover:bg-stone-900 dark:hover:text-amber-200"
                title={ka ? 'გრაფიკის მოთავსება' : 'Fit graph to view'}
                aria-label={ka ? 'გრაფიკის მოთავსება' : 'Fit graph to view'}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(value => Math.min(1.4, Math.round((value + 0.1) * 10) / 10))}
                className="rounded-lg p-2 text-stone-500 hover:bg-white hover:text-[#4e0e15] dark:hover:bg-stone-900 dark:hover:text-amber-200"
                title={ka ? 'გადიდება' : 'Zoom in'}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setFocusPathOnly(value => !value)}
              disabled={!selectedNodeId}
              className={`shrink-0 rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-wide transition-colors ${
                focusPathOnly
                  ? 'border-[#4e0e15] bg-[#4e0e15] text-amber-50'
                  : 'border-stone-200 bg-stone-50 text-stone-500 hover:bg-white hover:text-[#4e0e15] dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300'
              } disabled:cursor-not-allowed disabled:opacity-45`}
              title={!selectedNodeId ? (ka ? 'ჯერ აირჩიეთ კვანძი' : 'Select a node first') : undefined}
            >
              {ka ? 'არჩეული გზა' : 'Selected path'}
            </button>
          </div>
        )}
      />

      {selectedLot && (
        <div className="flex flex-wrap gap-2 text-[10px] font-mono">
          <span className="px-2 py-1 rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-950 dark:text-stone-300">{selectedLot.vintage}</span>
          <span className="px-2 py-1 rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-950 dark:text-stone-300">{selectedLot.variety}</span>
          <span className="px-2 py-1 rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-950 dark:text-stone-300">{stageLabel(selectedLot.stage, lang)}</span>
          <span className="px-2 py-1 rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-950 dark:text-stone-300">{selectedLot.currentVolume.toLocaleString()} {ka ? 'ლ ამჟამად' : 'L current'}</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        {(Object.keys(typeMeta) as LineageNodeType[]).map(type => {
          const meta = typeMeta[type];
          const Icon = meta.icon;
          return (
            <div key={type} className="bg-white border border-[#e8dfd5] rounded-xl p-3 dark:bg-stone-900 dark:border-stone-800">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[8px] uppercase font-black ${meta.badge}`}>
                <Icon className="w-3 h-3" /> {ka ? meta.labelKa : meta.label}
              </span>
              <strong className="block mt-1 text-lg font-serif font-black text-stone-900 dark:text-amber-100">{counts[type] || 0}</strong>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        <div className={`${isFullscreen ? 'fixed inset-2 z-50 flex flex-col rounded-xl sm:inset-4' : 'rounded-2xl'} bg-white border border-[#e8dfd5] shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800`}>
          <div className="px-4 py-3 border-b border-[#e8dfd5] flex items-center justify-between dark:border-stone-800">
            <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
              <Sparkles className="w-4 h-4" /> {ka ? 'მიკვლევადობის ხე' : 'Traceability tree'}
            </span>
            <div className="flex items-center gap-2">
              {focusPathOnly && <StatusBadge tone="brand">{ka ? 'ფოკუსი' : 'focused'}</StatusBadge>}
              <span className="text-[9px] font-mono text-stone-400">
                {visibleNodes.length}/{graph.nodes.length} {ka ? 'კვანძი' : 'nodes'} · {visibleEdges.length} {ka ? 'კავშირი' : 'links'}
                {positioned.hasCycle ? (ka ? ' · ციკლის გაფრთხილება' : ' · cycle warning') : ''}
              </span>
              <button
                type="button"
                onClick={() => setIsFullscreen(value => !value)}
                className="rounded-lg border border-stone-200 p-1.5 text-stone-500 transition-colors hover:bg-stone-50 hover:text-[#4e0e15] dark:border-stone-800 dark:hover:bg-stone-950 dark:hover:text-amber-200"
                title={isFullscreen ? (ka ? 'სრული ეკრანიდან გამოსვლა' : 'Exit full screen') : (ka ? 'სრულ ეკრანზე გახსნა' : 'Open full screen')}
                aria-label={isFullscreen ? (ka ? 'სრული ეკრანიდან გამოსვლა' : 'Exit full screen') : (ka ? 'სრულ ეკრანზე გახსნა' : 'Open full screen')}
              >
                {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {positioned.nodes.length === 0 ? (
            <EmptyState
              icon={GitMerge}
              title={ka ? 'მიკვლევადობის გრაფი ჯერ ცარიელია' : 'No lineage graph available yet'}
              description={ka ? 'შექმენით პარტია ან მიიღეთ ყურძენი მიკვლევადობის დასაწყებად.' : 'Create a wine lot or receive grapes to begin traceability.'}
            />
          ) : (
            <div ref={canvasViewportRef} className={`${isFullscreen ? 'min-h-0 flex-1' : 'h-[min(68vh,640px)] min-h-[360px]'} overflow-auto overscroll-contain bg-[#fbfaf7] touch-pan-x touch-pan-y dark:bg-stone-950/40`}>
              <div className="relative" style={{ width: scaledWidth, height: scaledHeight, minWidth: '100%' }}>
                <div
                  className="absolute left-0 top-0 origin-top-left"
                  style={{
                    width: positioned.width,
                    height: positioned.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: 'top left',
                  }}
                >
                  <svg className="absolute inset-0 pointer-events-none" width={positioned.width} height={positioned.height}>
                    <defs>
                      <filter id="lineage-shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodOpacity="0.15" />
                      </filter>
                    </defs>
                    {visibleEdges.map(edge => (
                      <EdgePath key={edge.id} edge={edge} nodesById={nodesById} />
                    ))}
                  </svg>

                  {visibleNodes.map(node => (
                    <LineageCard
                      key={node.id}
                      node={node}
                      selected={selectedNode?.id === node.id}
                      onSelect={(n) => setSelectedNodeId(n.id)}
                      ka={ka}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <DetailPanel node={selectedNode} edges={positioned.edges} ka={ka} />
          <MiniMap
            ka={ka}
            nodes={visibleNodes}
            edges={visibleEdges}
            nodesById={nodesById}
            width={positioned.width}
            height={positioned.height}
            selectedNodeId={selectedNode?.id}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Memoized: `useWineryState` hands out stable handler identities, so a state
 * change elsewhere in the app (a toast, a sync timestamp, another module's
 * records) leaves this component’s props referentially equal and React skips
 * the re-render entirely.
 */
export default React.memo(LotLineageGraphTab);

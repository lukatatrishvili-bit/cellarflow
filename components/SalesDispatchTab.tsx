import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  CalendarClock,
  CheckCircle2,
  PackageCheck,
  ShoppingCart,
  Trash2,
  Truck,
  XCircle,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { BottlingRunRecord, SalesDispatchRecord, SalesOrderRecord, WineLot } from '../lib/wineryState';
import { rollupLots, type CostEntry } from '../lib/costing';
import type { WinePricing } from '../lib/costing/store';
import {
  availableToSell,
  computeDispatchFinancials,
  isActiveReservation,
  reservedBottlesFor,
} from '../lib/sales';
import {
  computeStock,
  stockMovementFromDispatch,
  type StockMovement,
  type StorageLocation,
} from '../lib/storage';
import { CountUp } from './motion';

interface Props {
  lang: Language;
  lots: WineLot[];
  bottlingRuns: BottlingRunRecord[];
  costEntries: CostEntry[];
  pricing: WinePricing;
  locations: StorageLocation[];
  movements: StockMovement[];
  dispatches: SalesDispatchRecord[];
  orders: SalesOrderRecord[];
  onUpdateMovements: (movements: StockMovement[]) => void;
  onUpdateDispatches: (dispatches: SalesDispatchRecord[]) => void;
  onUpdateOrders: (orders: SalesOrderRecord[]) => void;
  currency: string;
  currentUserName: string;
  setToastMessage?: (message: string) => void;
}

interface StockRow {
  locationId: string;
  locationName: string;
  lotId: string;
  lotName: string;
  onHand: number;
  reserved: number;
  available: number;
}

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export default function SalesDispatchTab({
  lang,
  lots,
  bottlingRuns,
  costEntries,
  pricing,
  locations,
  movements,
  dispatches,
  orders,
  onUpdateMovements,
  onUpdateDispatches,
  onUpdateOrders,
  currency,
  currentUserName,
  setToastMessage,
}: Props) {
  const ka = lang === 'ka';
  const today = new Date().toISOString().slice(0, 10);

  const stock = useMemo(() => computeStock(movements), [movements]);

  const bottlesByLot = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of bottlingRuns) {
      map[r.lotId] = (map[r.lotId] || 0) + (r.totalBottles || 0) + (r.totalCeramic || 0);
    }
    return map;
  }, [bottlingRuns]);

  const costSummaries = useMemo(() => rollupLots(
    lots.map(l => ({ id: l.id, volumeLitres: l.currentVolume || l.initialVolume || 0 })),
    costEntries,
    bottlesByLot,
  ), [bottlesByLot, costEntries, lots]);

  const stockRows = useMemo<StockRow[]>(() => {
    const rows: StockRow[] = [];
    for (const loc of locations) {
      const s = stock.get(loc.id);
      if (!s) continue;
      for (const [lotId, bottles] of Object.entries(s.byLot)) {
        if (bottles <= 0) continue;
        const reserved = reservedBottlesFor(orders, loc.id, lotId, today);
        rows.push({
          locationId: loc.id,
          locationName: loc.name,
          lotId,
          lotName: lots.find(l => l.id === lotId)?.name || lotId,
          onHand: bottles,
          reserved,
          available: Math.max(0, bottles - reserved),
        });
      }
    }
    return rows.sort((a, b) => a.locationName.localeCompare(b.locationName) || a.lotName.localeCompare(b.lotName));
  }, [locations, lots, orders, stock, today]);

  const availableRows = useMemo(() => stockRows.filter(r => r.available > 0), [stockRows]);

  const [date, setDate] = useState(today);
  const [customerName, setCustomerName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [lotId, setLotId] = useState('');
  const [bottles, setBottles] = useState('');
  const [pricePerBottle, setPricePerBottle] = useState('');
  const [operator, setOperator] = useState('');
  const [notes, setNotes] = useState('');

  const [orderDate, setOrderDate] = useState(today);
  const [orderCustomerName, setOrderCustomerName] = useState('');
  const [orderLocationId, setOrderLocationId] = useState('');
  const [orderLotId, setOrderLotId] = useState('');
  const [orderBottles, setOrderBottles] = useState('');
  const [orderPricePerBottle, setOrderPricePerBottle] = useState('');
  const [requestedDispatchDate, setRequestedDispatchDate] = useState('');
  const [reservedUntil, setReservedUntil] = useState('');
  const [orderNotes, setOrderNotes] = useState('');

  useEffect(() => {
    if (!locationId && availableRows[0]) setLocationId(availableRows[0].locationId);
  }, [availableRows, locationId]);

  useEffect(() => {
    if (!orderLocationId && availableRows[0]) setOrderLocationId(availableRows[0].locationId);
  }, [availableRows, orderLocationId]);

  const lotsAtLocation = useMemo(() => {
    if (!locationId) return [];
    return availableRows.filter(r => r.locationId === locationId);
  }, [availableRows, locationId]);

  const orderLotsAtLocation = useMemo(() => {
    if (!orderLocationId) return [];
    return availableRows.filter(r => r.locationId === orderLocationId);
  }, [availableRows, orderLocationId]);

  useEffect(() => {
    if ((!lotId || !lotsAtLocation.some(r => r.lotId === lotId)) && lotsAtLocation[0]) {
      setLotId(lotsAtLocation[0].lotId);
    }
  }, [lotId, lotsAtLocation]);

  useEffect(() => {
    if ((!orderLotId || !orderLotsAtLocation.some(r => r.lotId === orderLotId)) && orderLotsAtLocation[0]) {
      setOrderLotId(orderLotsAtLocation[0].lotId);
    }
  }, [orderLotId, orderLotsAtLocation]);

  useEffect(() => {
    const p = pricing[lotId];
    setPricePerBottle(p && p > 0 ? String(p) : '');
  }, [lotId, pricing]);

  useEffect(() => {
    const p = pricing[orderLotId];
    setOrderPricePerBottle(p && p > 0 ? String(p) : '');
  }, [orderLotId, pricing]);

  const selectedRow = lotsAtLocation.find(r => r.lotId === lotId) || null;
  const selectedOrderRow = orderLotsAtLocation.find(r => r.lotId === orderLotId) || null;

  const qty = Math.max(0, parseInt(bottles) || 0);
  const available = selectedRow?.available || 0;
  const price = parseFloat(pricePerBottle) || 0;
  const costPerBottle = costSummaries.get(lotId)?.perBottle ?? null;
  const financials = computeDispatchFinancials({ bottles: qty, pricePerBottle: price, costPerBottle });
  const overStock = qty > available;
  const canDispatch = !!customerName.trim() && !!locationId && !!lotId && qty > 0 && !overStock && price > 0;

  const orderQty = Math.max(0, parseInt(orderBottles) || 0);
  const orderAvailable = selectedOrderRow?.available || 0;
  const orderPrice = parseFloat(orderPricePerBottle) || 0;
  const orderCostPerBottle = costSummaries.get(orderLotId)?.perBottle ?? null;
  const orderFinancials = computeDispatchFinancials({ bottles: orderQty, pricePerBottle: orderPrice, costPerBottle: orderCostPerBottle });
  const reserveDateInvalid = !!reservedUntil && reservedUntil < today;
  const requestedDateInvalid = !!requestedDispatchDate && requestedDispatchDate < orderDate;
  const overReservation = orderQty > orderAvailable;
  const canReserve = !!orderCustomerName.trim()
    && !!orderLocationId
    && !!orderLotId
    && orderQty > 0
    && !overReservation
    && !reserveDateInvalid
    && !requestedDateInvalid
    && orderPrice > 0;

  const activeOrders = useMemo(() => orders.filter(o => isActiveReservation(o, today)), [orders, today]);
  const orderTotals = useMemo(() => activeOrders.reduce((acc, o) => ({
    count: acc.count + 1,
    bottles: acc.bottles + (o.bottles || 0),
    value: round2(acc.value + (o.revenue || 0)),
  }), { count: 0, bottles: 0, value: 0 }), [activeOrders]);

  const dispatchTotals = useMemo(() => dispatches.reduce((acc, d) => ({
    bottles: acc.bottles + (d.bottles || 0),
    revenue: round2(acc.revenue + (d.revenue || 0)),
    cogs: round2(acc.cogs + (d.cogs || 0)),
    grossProfit: round2(acc.grossProfit + (d.grossProfit || 0)),
  }), { bottles: 0, revenue: 0, cogs: 0, grossProfit: 0 }), [dispatches]);

  const fmtMoney = (n: number) => `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  const locName = (id: string) => locations.find(l => l.id === id)?.name || id;
  const lotName = (id: string) => lots.find(l => l.id === id)?.name || id;

  const makeDispatch = (input: {
    date: string;
    customerName: string;
    lotId: string;
    locationId: string;
    bottles: number;
    pricePerBottle: number;
    costPerBottle?: number | null;
    operator: string;
    notes?: string;
    salesOrderId?: string;
  }): { movement: StockMovement; record: SalesDispatchRecord } | null => {
    const dispatchId = `sale-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const movement = stockMovementFromDispatch({
      dispatchId,
      date: input.date,
      lotId: input.lotId,
      locationId: input.locationId,
      bottles: input.bottles,
      customerName: input.customerName,
    });
    if (!movement) return null;

    const computed = computeDispatchFinancials({
      bottles: input.bottles,
      pricePerBottle: input.pricePerBottle,
      costPerBottle: input.costPerBottle,
    });

    return {
      movement,
      record: {
        id: dispatchId,
        date: input.date,
        customerName: input.customerName,
        lotId: input.lotId,
        lotName: lotName(input.lotId),
        locationId: input.locationId,
        locationName: locName(input.locationId),
        bottles: input.bottles,
        pricePerBottle: input.pricePerBottle,
        currency,
        revenue: computed.revenue,
        costPerBottle: input.costPerBottle ?? null,
        cogs: computed.cogs,
        grossProfit: computed.grossProfit,
        marginPct: computed.marginPct,
        stockMovementId: movement.id,
        salesOrderId: input.salesOrderId,
        operator: input.operator,
        notes: input.notes || undefined,
      },
    };
  };

  const submitDispatch = () => {
    if (!canDispatch || !selectedRow) return;
    const result = makeDispatch({
      date,
      customerName: customerName.trim(),
      lotId,
      locationId,
      bottles: qty,
      pricePerBottle: price,
      costPerBottle,
      operator: operator.trim() || currentUserName,
      notes: notes.trim(),
    });
    if (!result) return;

    onUpdateMovements([result.movement, ...movements]);
    onUpdateDispatches([result.record, ...dispatches]);
    setBottles('');
    setCustomerName('');
    setNotes('');
    setToastMessage?.(`Dispatch recorded: ${qty.toLocaleString()} bottles → ${result.record.customerName}`);
  };

  const submitOrder = () => {
    if (!canReserve || !selectedOrderRow) return;
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const orderId = `so-${Date.now()}-${suffix.toLowerCase()}`;
    const record: SalesOrderRecord = {
      id: orderId,
      orderNumber: `SO-${orderDate.replace(/-/g, '')}-${suffix}`,
      orderDate,
      createdAt: new Date().toISOString(),
      requestedDispatchDate: requestedDispatchDate || undefined,
      reservedUntil: reservedUntil || undefined,
      customerName: orderCustomerName.trim(),
      lotId: orderLotId,
      lotName: lotName(orderLotId),
      locationId: orderLocationId,
      locationName: locName(orderLocationId),
      bottles: orderQty,
      pricePerBottle: orderPrice,
      currency,
      revenue: orderFinancials.revenue,
      costPerBottle: orderCostPerBottle,
      cogs: orderFinancials.cogs,
      grossProfit: orderFinancials.grossProfit,
      marginPct: orderFinancials.marginPct,
      status: 'reserved',
      operator: currentUserName,
      notes: orderNotes.trim() || undefined,
    };

    onUpdateOrders([record, ...orders]);
    setOrderCustomerName('');
    setOrderBottles('');
    setOrderNotes('');
    setToastMessage?.(`Reserved ${orderQty.toLocaleString()} bottles for ${record.customerName}`);
  };

  const fulfillOrder = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status !== 'reserved') return;

    const onHand = stock.get(order.locationId)?.byLot[order.lotId] || 0;
    const availableForThisOrder = availableToSell({
      onHandBottles: onHand,
      orders,
      locationId: order.locationId,
      lotId: order.lotId,
      asOfDate: today,
      excludeOrderId: order.id,
    });

    if (order.bottles > availableForThisOrder) {
      setToastMessage?.(`Cannot fulfill ${order.orderNumber || order.id}: only ${availableForThisOrder.toLocaleString()} bottles are physically available.`);
      return;
    }

    const result = makeDispatch({
      date: today,
      customerName: order.customerName,
      lotId: order.lotId,
      locationId: order.locationId,
      bottles: order.bottles,
      pricePerBottle: order.pricePerBottle,
      costPerBottle: order.costPerBottle ?? costSummaries.get(order.lotId)?.perBottle ?? null,
      operator: currentUserName,
      notes: order.notes ? `Fulfilled order ${order.orderNumber || order.id}. ${order.notes}` : `Fulfilled order ${order.orderNumber || order.id}`,
      salesOrderId: order.id,
    });
    if (!result) return;

    onUpdateMovements([result.movement, ...movements]);
    onUpdateDispatches([result.record, ...dispatches]);
    onUpdateOrders(orders.map(o => o.id === order.id
      ? { ...o, status: 'fulfilled', dispatchId: result.record.id, fulfilledAt: new Date().toISOString() }
      : o));
    setToastMessage?.(`Order fulfilled and dispatched: ${order.bottles.toLocaleString()} bottles → ${order.customerName}`);
  };

  const cancelOrder = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status !== 'reserved') return;
    onUpdateOrders(orders.map(o => o.id === orderId
      ? { ...o, status: 'cancelled', cancelledAt: new Date().toISOString() }
      : o));
    setToastMessage?.(`Reservation cancelled: ${order.orderNumber || order.customerName}`);
  };

  const recordDeletedId = (id: string | undefined) => {
    if (!id || typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem('vinea_deleted_ids');
      const list = stored ? JSON.parse(stored) : [];
      if (!list.includes(id)) list.push(id);
      localStorage.setItem('vinea_deleted_ids', JSON.stringify(list));
    } catch { /* ignore */ }
  };

  const deleteDispatch = (id: string) => {
    const dispatch = dispatches.find(d => d.id === id);
    recordDeletedId(id);
    recordDeletedId(dispatch?.stockMovementId);
    onUpdateDispatches(dispatches.filter(d => d.id !== id));
    if (dispatch?.stockMovementId) {
      onUpdateMovements(movements.filter(m => m.id !== dispatch.stockMovementId));
    }
    if (dispatch?.salesOrderId) {
      onUpdateOrders(orders.map(o => o.id === dispatch.salesOrderId
        ? { ...o, status: 'reserved', dispatchId: undefined, fulfilledAt: undefined }
        : o));
    }
  };

  const statusLabel = (order: SalesOrderRecord) => {
    if (order.status === 'reserved' && !isActiveReservation(order, today)) return 'expired';
    return order.status;
  };

  const statusClass = (order: SalesOrderRecord) => {
    const label = statusLabel(order);
    if (label === 'fulfilled') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (label === 'cancelled') return 'bg-stone-100 text-stone-500 border-stone-200';
    if (label === 'expired') return 'bg-amber-100 text-amber-800 border-amber-200';
    return 'bg-blue-100 text-blue-800 border-blue-200';
  };

  const labelCls = 'text-[9px] uppercase font-mono block mb-1 font-bold text-stone-500 dark:text-stone-400 tracking-widest';
  const inputCls = 'w-full bg-stone-50 border border-stone-200 px-2.5 py-2 rounded-lg text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15] dark:bg-stone-900 dark:border-stone-800 dark:text-amber-50';

  return (
    <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-6 flex flex-col space-y-5 font-sans animate-fade-in">
      <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
        <span className="text-[9px] uppercase tracking-widest bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded font-bold">
          {ka ? 'Sales' : 'Sales'}
        </span>
        <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
          <Truck className="w-5 h-5 text-[#4e0e15]" />
          {ka ? 'Sales Orders & Dispatch' : 'Sales Orders & Dispatch'}
        </h3>
        <p className="text-xs text-stone-500 dark:text-stone-400 font-semibold mt-0.5">
          Reserve bottled stock before physical dispatch, then fulfill orders into auditable stock movements.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Active reservations', value: orderTotals.count, accent: 'text-blue-700 dark:text-blue-300', money: false },
          { label: 'Reserved bottles', value: orderTotals.bottles, accent: 'text-[#4e0e15] dark:text-amber-300', money: false },
          { label: 'Bottles dispatched', value: dispatchTotals.bottles, accent: 'text-[#4e0e15] dark:text-amber-300', money: false },
          { label: 'Revenue', value: dispatchTotals.revenue, accent: 'text-emerald-700 dark:text-emerald-400', money: true },
          { label: 'Gross profit', value: dispatchTotals.grossProfit, accent: dispatchTotals.grossProfit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600', money: true },
        ].map((card, i) => (
          <div key={i} className="bg-white border border-[#e8dfd5] rounded-2xl p-4 dark:bg-stone-900 dark:border-stone-800">
            <span className="text-[9px] uppercase font-mono text-stone-500 dark:text-stone-400 font-bold tracking-widest">{card.label}</span>
            <strong className={`block mt-1 text-2xl font-serif font-black ${card.accent}`}>
              <CountUp value={card.value} format={(n) => card.money ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toLocaleString()} /> {card.money ? currency : ''}
            </strong>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[410px_1fr] gap-5">
        <div className="space-y-4">
          <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-3 dark:bg-stone-900 dark:border-stone-800">
            <h4 className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
              <CalendarClock className="w-4 h-4" /> Reserve stock / sales order
            </h4>
            {availableRows.length === 0 ? (
              <div className="text-center py-8 text-stone-500 dark:text-stone-400 text-xs font-semibold">
                <PackageCheck className="w-10 h-10 mx-auto mb-2 opacity-40" />
                No unreserved bottled stock available for new reservations.
              </div>
            ) : (
              <>
                <div>
                  <label className={labelCls}>Customer</label>
                  <input value={orderCustomerName} onChange={e => setOrderCustomerName(e.target.value)} placeholder="e.g. Tbilisi Wine Bar" className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Order date</label>
                    <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Dispatch by</label>
                    <input type="date" value={requestedDispatchDate} onChange={e => setRequestedDispatchDate(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Reserve until</label>
                  <input type="date" value={reservedUntil} onChange={e => setReservedUntil(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Storage location</label>
                  <select value={orderLocationId} onChange={e => setOrderLocationId(e.target.value)} className={inputCls}>
                    {locations.filter(l => availableRows.some(r => r.locationId === l.id)).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Wine lot</label>
                  <select value={orderLotId} onChange={e => setOrderLotId(e.target.value)} className={inputCls}>
                    {orderLotsAtLocation.map(r => (
                      <option key={`${r.locationId}-${r.lotId}`} value={r.lotId}>
                        {r.lotName} · {r.available.toLocaleString()} available · {r.reserved.toLocaleString()} reserved
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Bottles</label>
                    <input type="number" min={0} max={orderAvailable || undefined} value={orderBottles} onChange={e => setOrderBottles(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Price / bottle ({currency})</label>
                    <input type="number" min={0} step="0.01" value={orderPricePerBottle} onChange={e => setOrderPricePerBottle(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Notes</label>
                  <input value={orderNotes} onChange={e => setOrderNotes(e.target.value)} placeholder="optional" className={inputCls} />
                </div>

                <div className="text-[11px] font-mono border border-stone-200 rounded-xl p-3 bg-stone-50/60 space-y-1 dark:bg-stone-950/40 dark:border-stone-800">
                  <div className="flex justify-between"><span>On hand</span><strong>{(selectedOrderRow?.onHand || 0).toLocaleString()} btl</strong></div>
                  <div className="flex justify-between"><span>Already reserved</span><strong>{(selectedOrderRow?.reserved || 0).toLocaleString()} btl</strong></div>
                  <div className="flex justify-between"><span>Available to reserve</span><strong>{orderAvailable.toLocaleString()} btl</strong></div>
                  <div className="flex justify-between"><span>Order value</span><strong>{fmtMoney(orderFinancials.revenue)}</strong></div>
                  <div className="flex justify-between"><span>Estimated margin</span><strong>{orderFinancials.marginPct != null ? `${orderFinancials.marginPct}%` : '—'}</strong></div>
                </div>
                {(overReservation || reserveDateInvalid || requestedDateInvalid) && (
                  <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                    {overReservation ? 'Reservation quantity exceeds available unreserved stock.' : reserveDateInvalid ? 'Reserve-until date must be today or later.' : 'Requested dispatch date cannot be before the order date.'}
                  </div>
                )}
                <button onClick={submitOrder} disabled={!canReserve}
                  className="w-full px-4 py-2.5 bg-blue-800 hover:bg-blue-900 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer">
                  Create reservation
                </button>
              </>
            )}
          </div>

          <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-3 dark:bg-stone-900 dark:border-stone-800">
            <h4 className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
              <ShoppingCart className="w-4 h-4" /> Record dispatch now
            </h4>
            {availableRows.length === 0 ? (
              <div className="text-center py-8 text-stone-500 dark:text-stone-400 text-xs font-semibold">
                <PackageCheck className="w-10 h-10 mx-auto mb-2 opacity-40" />
                No unreserved bottled stock available for direct dispatch.
              </div>
            ) : (
              <>
                <div>
                  <label className={labelCls}>Customer</label>
                  <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="e.g. Tbilisi Wine Bar" className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Date</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Operator</label>
                    <input value={operator} onChange={e => setOperator(e.target.value)} placeholder={currentUserName} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Storage location</label>
                  <select value={locationId} onChange={e => setLocationId(e.target.value)} className={inputCls}>
                    {locations.filter(l => availableRows.some(r => r.locationId === l.id)).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Wine lot</label>
                  <select value={lotId} onChange={e => setLotId(e.target.value)} className={inputCls}>
                    {lotsAtLocation.map(r => (
                      <option key={`${r.locationId}-${r.lotId}`} value={r.lotId}>
                        {r.lotName} · {r.available.toLocaleString()} available · {r.reserved.toLocaleString()} reserved
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Bottles</label>
                    <input type="number" min={0} max={available || undefined} value={bottles} onChange={e => setBottles(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Price / bottle ({currency})</label>
                    <input type="number" min={0} step="0.01" value={pricePerBottle} onChange={e => setPricePerBottle(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Notes</label>
                  <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" className={inputCls} />
                </div>

                <div className="text-[11px] font-mono border border-stone-200 rounded-xl p-3 bg-stone-50/60 space-y-1 dark:bg-stone-950/40 dark:border-stone-800">
                  <div className="flex justify-between"><span>Available after reservations</span><strong>{available.toLocaleString()} btl</strong></div>
                  <div className="flex justify-between"><span>Revenue</span><strong>{fmtMoney(financials.revenue)}</strong></div>
                  <div className="flex justify-between"><span>Cost / bottle</span><strong>{costPerBottle != null ? fmtMoney(costPerBottle) : '—'}</strong></div>
                  <div className="flex justify-between"><span>Gross profit</span><strong>{financials.marginPct != null ? fmtMoney(financials.grossProfit) : '—'}</strong></div>
                  <div className="flex justify-between"><span>Margin</span><strong>{financials.marginPct != null ? `${financials.marginPct}%` : '—'}</strong></div>
                </div>
                {overStock && (
                  <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                    Dispatch quantity exceeds unreserved available stock.
                  </div>
                )}
                <button onClick={submitDispatch} disabled={!canDispatch}
                  className="w-full px-4 py-2.5 bg-[#4e0e15] hover:bg-[#34070a] disabled:opacity-50 disabled:cursor-not-allowed text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer">
                  Record dispatch
                </button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
            <div className="px-4 py-3 border-b border-[#e8dfd5] flex items-center justify-between dark:border-stone-800">
              <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
                <CalendarClock className="w-4 h-4" /> Sales orders / reservations
              </span>
              <span className="text-[9px] font-mono text-stone-500 dark:text-stone-400">{orders.length} records</span>
            </div>
            {orders.length === 0 ? (
              <div className="text-center py-12 text-stone-500 dark:text-stone-400 text-xs font-semibold">
                No reservations created yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-stone-500 dark:text-stone-400 font-bold dark:bg-stone-950">
                      <th className="p-2.5">Order / Customer</th>
                      <th className="p-2.5">Lot / Location</th>
                      <th className="p-2.5 text-right">Bottles</th>
                      <th className="p-2.5 text-right">Value</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                    {orders.map(o => (
                      <tr key={o.id} className="hover:bg-stone-50/50 dark:hover:bg-white/5">
                        <td className="p-2.5">
                          <span className="font-mono text-stone-500">{o.orderNumber || o.orderDate}</span>
                          <span className="block font-bold text-stone-800 dark:text-amber-50">{o.customerName}</span>
                          {o.reservedUntil && <span className="block text-[9px] text-stone-500 dark:text-stone-400">reserved until {o.reservedUntil}</span>}
                        </td>
                        <td className="p-2.5">
                          <span className="font-bold text-stone-700 dark:text-stone-200">{o.lotName}</span>
                          <span className="block text-[9px] font-mono text-stone-500 dark:text-stone-400">{o.locationName}</span>
                        </td>
                        <td className="p-2.5 text-right font-bold">{o.bottles.toLocaleString()}</td>
                        <td className="p-2.5 text-right font-mono text-emerald-700 dark:text-emerald-400">{fmtMoney(o.revenue || 0)}</td>
                        <td className="p-2.5">
                          <span className={`inline-flex px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase ${statusClass(o)}`}>
                            {statusLabel(o)}
                          </span>
                        </td>
                        <td className="p-2.5 text-right">
                          {o.status === 'reserved' ? (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => fulfillOrder(o.id)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer" title="Fulfill into dispatch">
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button onClick={() => cancelOrder(o.id)} className="text-stone-300 hover:text-rose-600 cursor-pointer" title="Cancel reservation">
                                <XCircle className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-[9px] font-mono text-stone-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
            <div className="px-4 py-3 border-b border-[#e8dfd5] flex items-center justify-between dark:border-stone-800">
              <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
                <BadgeDollarSign className="w-4 h-4" /> Recent dispatches
              </span>
              <span className="text-[9px] font-mono text-stone-500 dark:text-stone-400">{dispatches.length} records</span>
            </div>
            {dispatches.length === 0 ? (
              <div className="text-center py-12 text-stone-500 dark:text-stone-400 text-xs font-semibold">
                No sales dispatches recorded yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-stone-500 dark:text-stone-400 font-bold dark:bg-stone-950">
                      <th className="p-2.5">Date / Customer</th>
                      <th className="p-2.5">Lot / Location</th>
                      <th className="p-2.5 text-right">Bottles</th>
                      <th className="p-2.5 text-right">Revenue</th>
                      <th className="p-2.5 text-right">Margin</th>
                      <th className="p-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                    {dispatches.map(d => (
                      <tr key={d.id} className="hover:bg-stone-50/50 dark:hover:bg-white/5">
                        <td className="p-2.5">
                          <span className="font-mono text-stone-500">{d.date}</span>
                          <span className="block font-bold text-stone-800 dark:text-amber-50">{d.customerName}</span>
                          {d.salesOrderId && <span className="block text-[9px] text-blue-500">from reservation</span>}
                        </td>
                        <td className="p-2.5">
                          <span className="font-bold text-stone-700 dark:text-stone-200">{d.lotName}</span>
                          <span className="block text-[9px] font-mono text-stone-500 dark:text-stone-400">{d.locationName}</span>
                        </td>
                        <td className="p-2.5 text-right font-bold">{d.bottles.toLocaleString()}</td>
                        <td className="p-2.5 text-right font-mono text-emerald-700 dark:text-emerald-400">{fmtMoney(d.revenue || 0)}</td>
                        <td className="p-2.5 text-right font-mono">{d.marginPct != null ? `${d.marginPct}%` : '—'}</td>
                        <td className="p-2.5 text-right">
                          <button onClick={() => deleteDispatch(d.id)} className="text-stone-300 hover:text-rose-600 cursor-pointer" title="Delete dispatch">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

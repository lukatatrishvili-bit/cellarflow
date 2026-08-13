import React from 'react';
import { ArrowDownToLine, Boxes, CircleDollarSign, PackageCheck, Plus, Send, Truck } from 'lucide-react';
import type { Language } from '../lib/language';
import type { InventoryItem } from '../lib/wineryState';
import { identityExchangeRateQuote, normalizeInvoiceCurrency } from '../lib/currency';
import {
  createInvoiceReceiptCommandIntent,
  submitInvoiceReceiptCommand,
  type InvoiceReceiptCommandResponse,
} from '../lib/commands/client';
import {
  createReorderPurchaseOrder,
  purchaseOrderTotal,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from '../lib/operationsControl';

interface ProcurementTabProps {
  lang: Language;
  currentUsername: string;
  accountingCurrency: string;
  inventory: InventoryItem[];
  purchaseOrders: PurchaseOrder[];
  onUpdatePurchaseOrders: React.Dispatch<React.SetStateAction<PurchaseOrder[]>>;
  onApplyInvoiceReceiptCommandResponse: (response: InvoiceReceiptCommandResponse) => void;
  canCreate: boolean;
  canUpdate: boolean;
  canReceive: boolean;
  setToastMessage?: (message: string | null) => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const statuses: PurchaseOrderStatus[] = ['draft', 'submitted', 'ordered', 'partially_received', 'received', 'cancelled'];

export default function ProcurementTab(props: ProcurementTabProps) {
  const ka = props.lang === 'ka';
  const [busy, setBusy] = React.useState('');
  const lowStock = React.useMemo(() => props.inventory.filter(item => item.stock <= item.minThreshold), [props.inventory]);
  const supplierNames = React.useMemo(() => [...new Set(lowStock.map(item => item.supplierName.trim()).filter(Boolean))].sort(), [lowStock]);
  const accountingCurrency = normalizeInvoiceCurrency(props.accountingCurrency) || 'GEL';

  const createOrder = (supplierName: string) => {
    try {
      const order = createReorderPurchaseOrder(props.inventory, {
        supplierName,
        createdBy: props.currentUsername,
        orderDate: today(),
        currency: accountingCurrency,
      });
      props.onUpdatePurchaseOrders(current => [order, ...current]);
      props.setToastMessage?.(ka ? 'შესყიდვის შეკვეთა შეიქმნა.' : `${order.orderNumber} created.`);
    } catch (error) {
      props.setToastMessage?.(error instanceof Error ? error.message : 'Purchase order could not be created.');
    }
  };

  const updateOrder = (id: string, patch: Partial<PurchaseOrder>) => {
    const changedAt = new Date().toISOString();
    props.onUpdatePurchaseOrders(current => current.map(order => order.id === id ? { ...order, ...patch, lastModified: changedAt } : order));
  };

  const changeStatus = (order: PurchaseOrder, status: PurchaseOrderStatus) => {
    const changedAt = new Date().toISOString();
    updateOrder(order.id, {
      status,
      ...(status === 'submitted' ? { submittedAt: changedAt } : {}),
      ...(status === 'ordered' ? { orderedAt: changedAt } : {}),
    });
  };

  const receive = async (order: PurchaseOrder) => {
    if (order.currency !== accountingCurrency) {
      props.setToastMessage?.(ka ? 'მიღებამდე შეუთანხმეთ შეკვეთისა და აღრიცხვის ვალუტა.' : `Set the PO currency to ${accountingCurrency} before receiving.`);
      return;
    }
    const lines = order.lines.filter(line => line.quantity > line.receivedQuantity);
    if (!lines.length) return;
    setBusy(order.id);
    try {
      const receiptDate = today();
      const intent = createInvoiceReceiptCommandIntent({
        analysisId: `purchase-order-${order.id}`,
        invoice: {
          supplierName: order.supplierName,
          invoiceNumber: order.orderNumber,
          invoiceDate: receiptDate,
          currency: order.currency,
          subtotal: purchaseOrderTotal(order),
          total: purchaseOrderTotal(order),
        },
        accountingCurrency,
        exchangeRate: identityExchangeRateQuote(accountingCurrency, receiptDate),
        costBasis: 'net',
        additionalCostsSource: 0,
        sources: [],
        lines: lines.map(line => {
          const item = props.inventory.find(candidate => candidate.id === line.inventoryItemId);
          const quantity = line.quantity - line.receivedQuantity;
          return {
            lineId: line.id,
            mode: 'receive' as const,
            inventoryItemId: line.inventoryItemId,
            productName: line.productName,
            category: item?.category || 'unassigned',
            supplierName: order.supplierName,
            invoiceDescription: `${order.orderNumber} · ${line.productName}`,
            invoiceQuantity: quantity,
            invoiceUnit: line.unit,
            stockQuantity: quantity,
            stockUnit: line.unit,
            conversionFactor: 1,
            conversionConfirmed: true,
            sourceCostPerStockUnit: line.unitCost,
            lineNetAmount: quantity * line.unitCost,
            lineTotal: quantity * line.unitCost,
            activeIngredients: item?.activeIngredients || [],
            sourceIds: [`purchase-order:${order.id}`],
          };
        }),
      });
      const response = await submitInvoiceReceiptCommand(intent);
      props.onApplyInvoiceReceiptCommandResponse(response);
      updateOrder(order.id, {
        status: 'received',
        receivedAt: new Date().toISOString(),
        receiptCommandId: intent.commandId,
        lines: order.lines.map(line => ({ ...line, receivedQuantity: line.quantity })),
      });
      props.setToastMessage?.(ka ? 'საქონელი მიღებულია და მარაგი ატომურად განახლდა.' : `Received ${order.orderNumber}; inventory and receipt audit were posted atomically.`);
    } catch (error) {
      props.setToastMessage?.(error instanceof Error ? error.message : 'Purchase order receipt failed.');
    } finally {
      setBusy('');
    }
  };

  const openValue = props.purchaseOrders.filter(order => !['received', 'cancelled'].includes(order.status)).reduce((sum, order) => sum + purchaseOrderTotal(order), 0);

  return <div className="space-y-6">
    <header><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-300"><Truck className="h-4 w-4" />{ka ? 'შესყიდვა და მიღება' : 'Procure to consume'}</div><h2 className="mt-2 font-serif text-3xl font-semibold text-stone-950 dark:text-white">{ka ? 'მარაგის შევსების კონტროლი' : 'Purchasing and receiving'}</h2><p className="mt-2 max-w-3xl text-sm text-stone-600 dark:text-stone-400">{ka ? 'დაბალი მარაგიდან შექმენით შეკვეთა და მიღებისას განაახლეთ მარაგი აუდიტირებადი ოპერაციით.' : 'Turn reorder points into purchase orders, then receive goods through the same auditable inventory command as invoice imports.'}</p></header>

    <section className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><Boxes className="h-5 w-5 text-sky-700" /><strong className="mt-3 block text-2xl">{lowStock.length}</strong><span className="text-[10px] font-bold uppercase text-stone-500">{ka ? 'დაბალი მარაგი' : 'Low-stock items'}</span></div><div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><Send className="h-5 w-5 text-sky-700" /><strong className="mt-3 block text-2xl">{props.purchaseOrders.filter(order => !['received', 'cancelled'].includes(order.status)).length}</strong><span className="text-[10px] font-bold uppercase text-stone-500">{ka ? 'ღია შეკვეთა' : 'Open orders'}</span></div><div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><CircleDollarSign className="h-5 w-5 text-sky-700" /><strong className="mt-3 block text-2xl">{openValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} {accountingCurrency}</strong><span className="text-[10px] font-bold uppercase text-stone-500">{ka ? 'ღია ღირებულება' : 'Open value'}</span></div></section>

    {props.canCreate && supplierNames.length > 0 && <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-5 dark:border-sky-900 dark:bg-sky-950/20"><h3 className="text-xs font-black uppercase tracking-wider text-sky-900 dark:text-sky-100">{ka ? 'შევსების წინადადებები' : 'Reorder suggestions'}</h3><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{supplierNames.map(supplier => { const count = lowStock.filter(item => item.supplierName.trim() === supplier).length; return <button key={supplier} type="button" onClick={() => createOrder(supplier)} className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-white px-4 text-left text-xs font-bold shadow-sm dark:bg-stone-900"><span>{supplier}<small className="mt-1 block font-normal text-stone-500">{count} item(s)</small></span><Plus className="h-4 w-4 text-sky-700" /></button>; })}</div></section>}

    <section className="space-y-4">{props.purchaseOrders.length === 0 ? <div className="rounded-2xl border border-dashed border-stone-300 p-12 text-center text-sm text-stone-500 dark:border-stone-700">{ka ? 'შესყიდვის შეკვეთა ჯერ არ არის.' : 'No purchase orders yet.'}</div> : props.purchaseOrders.map(order => <article key={order.id} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><div className="text-[10px] font-black uppercase tracking-wider text-sky-700 dark:text-sky-300">{order.orderNumber} · {order.status}</div><h3 className="mt-1 text-lg font-bold">{order.supplierName}</h3><p className="mt-1 text-xs text-stone-500">{order.orderDate} · {purchaseOrderTotal(order).toLocaleString(undefined, { maximumFractionDigits: 2 })} {order.currency}</p></div>{props.canUpdate && <div className="flex flex-wrap gap-2"><select value={order.status} onChange={event => changeStatus(order, event.target.value as PurchaseOrderStatus)} className="min-h-10 rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs dark:border-stone-700 dark:bg-stone-950">{statuses.map(status => <option key={status}>{status}</option>)}</select><input type="date" value={order.expectedDate || ''} onChange={event => updateOrder(order.id, { expectedDate: event.target.value || undefined })} className="min-h-10 rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs dark:border-stone-700 dark:bg-stone-950" /></div>}</div>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-stone-200 text-[10px] uppercase text-stone-500 dark:border-stone-800"><th className="py-2">Item</th><th className="py-2">Qty</th><th className="py-2">Unit cost</th><th className="py-2 text-right">Total</th></tr></thead><tbody>{order.lines.map(line => <tr key={line.id} className="border-b border-stone-100 dark:border-stone-800"><td className="py-3 font-bold">{line.productName}</td><td className="py-3">{line.quantity} {line.unit}{line.receivedQuantity > 0 ? ` (${line.receivedQuantity} received)` : ''}</td><td className="py-3">{line.unitCost.toLocaleString()}</td><td className="py-3 text-right">{(line.quantity * line.unitCost).toLocaleString()}</td></tr>)}</tbody></table></div>
      {props.canReceive && ['submitted', 'ordered', 'partially_received'].includes(order.status) && <button type="button" disabled={busy === order.id} onClick={() => void receive(order)} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 text-xs font-black text-white disabled:opacity-50">{busy === order.id ? <ArrowDownToLine className="h-4 w-4 animate-bounce" /> : <PackageCheck className="h-4 w-4" />}{ka ? 'მიღება და მარაგში შეტანა' : 'Receive into inventory'}</button>}</article>)}</section>
  </div>;
}

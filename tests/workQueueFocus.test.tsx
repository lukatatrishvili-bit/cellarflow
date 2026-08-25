import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ProcurementTab from '../components/ProcurementTab';
import ProductionPlannerTab from '../components/ProductionPlannerTab';
import QualitySopTab from '../components/QualitySopTab';
import type { ProductionPlanItem, PurchaseOrder, QualitySop } from '../lib/operationsControl';

describe('work queue record destinations', () => {
  it('renders the focused SOP and purchase order as keyboard-focusable targets', () => {
    const sop: QualitySop = {
      id: 'sop-1', title: 'Sanitize line', category: 'sanitation', frequency: 'daily', owner: 'ana', active: true,
      nextDueDate: '2026-08-25', checklist: ['Rinse'], evidenceRequired: false, completionHistory: [],
      createdAt: '2026-08-24T10:00:00.000Z', createdBy: 'ana',
    };
    const order: PurchaseOrder = {
      id: 'po-1', orderNumber: 'PO-1', supplierName: 'Supplier', status: 'ordered', orderDate: '2026-08-20',
      expectedDate: '2026-08-25', currency: 'GEL', lines: [], notes: '', createdAt: '2026-08-20T10:00:00.000Z', createdBy: 'ana',
    };

    const sopMarkup = renderToStaticMarkup(<QualitySopTab
      lang="en" currentUsername="ana" vessels={[]} lots={[]} qualitySops={[sop]}
      onUpdateQualitySops={vi.fn()} canCreate={false} canUpdate={false} canDelete={false} focusSopId="sop-1"
    />);
    const orderMarkup = renderToStaticMarkup(<ProcurementTab
      lang="en" currentUsername="ana" accountingCurrency="GEL" inventory={[]} purchaseOrders={[order]}
      onUpdatePurchaseOrders={vi.fn()} onApplyInvoiceReceiptCommandResponse={vi.fn()}
      canCreate={false} canUpdate={false} canReceive={false} focusOrderId="po-1"
    />);

    expect(sopMarkup).toContain('id="quality-sop-sop-1"');
    expect(sopMarkup).toContain('tabindex="-1"');
    expect(sopMarkup).toContain('border-emerald-700');
    expect(orderMarkup).toContain('id="purchase-order-po-1"');
    expect(orderMarkup).toContain('tabindex="-1"');
    expect(orderMarkup).toContain('border-sky-700');
  });

  it('explains and disables a plan step whose prerequisite is unfinished', () => {
    const prerequisite: ProductionPlanItem = {
      id: 'prepare', title: 'Prepare vessel', kind: 'sanitation', status: 'in_progress', startDate: '2026-08-24', endDate: '2026-08-25',
      assignedTo: 'ana', vesselIds: [], notes: '', dependencyIds: [], createdAt: '', createdBy: 'ana',
    };
    const plan: ProductionPlanItem = {
      id: 'transfer', title: 'Transfer lot', kind: 'transfer', status: 'planned', startDate: '2026-08-25', endDate: '2026-08-25',
      assignedTo: 'ana', vesselIds: [], notes: '', dependencyIds: ['prepare'], createdAt: '', createdBy: 'ana',
    };
    const markup = renderToStaticMarkup(<ProductionPlannerTab
      lang="en" currentUsername="ana" productionPlans={[prerequisite, plan]} onUpdateProductionPlans={vi.fn()}
      vessels={[]} lots={[]} blocks={[]} harvests={[]} canCreate={false} canUpdate canDelete={false} focusPlanId="transfer"
    />);

    expect(markup).toContain('id="plan-transfer"');
    expect(markup).toContain('Next step is blocked');
    expect(markup).toContain('Complete prerequisite work first: Prepare vessel.');
    expect(markup).toMatch(/<option[^>]*disabled=""[^>]*>ready<\/option>/);
  });
});

import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CostsTab from '../components/CostsTab';
import type { CostEntry } from '../lib/costing';
import type { CompanyProfile, WineLot } from '../lib/wineryState';

const lot: WineLot = {
  id: 'LOT-SAP-2026',
  name: 'Saperavi Reserve',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Mukuzani Block 1',
  region: 'Kakheti',
  initialVolume: 1_000,
  currentVolume: 900,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-09-01',
  history: [],
};

const entry: CostEntry = {
  id: 'cost-qa-1',
  date: '2026-09-15',
  lotId: lot.id,
  category: 'labor',
  description: 'Harvest cellar crew',
  amount: 420,
  currency: 'GEL',
};

const company: CompanyProfile = {
  companyName: 'QA Winery LLC',
  wineryName: 'QA Marani',
  country: 'Georgia',
  region: 'Kakheti',
  municipality: 'Telavi',
  address: 'Wine Street 1',
  contactEmail: 'qa@example.com',
  phone: '+995 555 000 000',
  website: 'https://example.com',
  measurementUnits: 'metric',
  currency: 'GEL',
};

function props(overrides: Partial<ComponentProps<typeof CostsTab>> = {}): ComponentProps<typeof CostsTab> {
  return {
    lang: 'en',
    lots: [lot],
    inventory: [],
    company,
    bottlingRuns: [],
    costEntries: [entry],
    onUpdateCostEntries: vi.fn(),
    pricing: { [lot.id]: 22 },
    onUpdatePricing: vi.fn(),
    ...overrides,
  };
}

function renderCosts(overrides: Partial<ComponentProps<typeof CostsTab>> = {}): string {
  return renderToStaticMarkup(React.createElement(CostsTab, props(overrides)));
}

describe('CostsTab action permissions', () => {
  it('preserves the financial report and ledger without mutation controls in read-only mode', () => {
    const markup = renderCosts({
      canCreateCost: false,
      canDeleteCost: false,
      canUpdatePricing: false,
      canExportCosts: true,
    });

    expect(markup).toContain('Read-only cost access');
    expect(markup).toContain('Saperavi Reserve');
    expect(markup).toContain('Harvest cellar crew');
    expect(markup).toContain('22.00 GEL');
    expect(markup).toContain('CSV');
    expect(markup).toContain('XLSX');
    expect(markup).not.toContain('Add cost');
    expect(markup).not.toContain('Price per bottle for Saperavi Reserve');
    expect(markup).not.toContain('Delete cost for Saperavi Reserve');
  });

  it('can expose cost creation while keeping pricing, deletion, and exports restricted', () => {
    const markup = renderCosts({
      canCreateCost: true,
      canDeleteCost: false,
      canUpdatePricing: false,
      canExportCosts: false,
    });

    expect(markup).toContain('Limited finance access');
    expect(markup).toContain('Add cost');
    expect(markup).not.toContain('Price per bottle for Saperavi Reserve');
    expect(markup).not.toContain('Delete cost for Saperavi Reserve');
    expect(markup).not.toContain('cost_margin_report.csv');
    expect(markup).not.toContain(' CSV</button>');
    expect(markup).not.toContain(' XLSX</button>');
  });

  it('preserves all existing controls by default for an owner', () => {
    const markup = renderCosts();

    expect(markup).toContain('Add cost');
    expect(markup).toContain('Price per bottle for Saperavi Reserve');
    expect(markup).toContain('Delete cost for Saperavi Reserve');
    expect(markup).toContain(' CSV</button>');
    expect(markup).toContain(' XLSX</button>');
  });

  it('localizes the read-only explanation in Georgian', () => {
    const markup = renderCosts({
      lang: 'ka',
      canCreateCost: false,
      canDeleteCost: false,
      canUpdatePricing: false,
    });

    expect(markup).toContain('მხოლოდ ნახვის წვდომა');
    expect(markup).not.toContain('Read-only cost access');
  });
});

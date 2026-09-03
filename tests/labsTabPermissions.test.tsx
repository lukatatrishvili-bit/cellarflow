import React, { type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
// The default export is wrapped in React.memo (an object, not a function), so
// the tests below that invoke the component directly use the named render
// function. Both refer to the same implementation.
import LabsTab, { LabsTab as LabsTabRender } from '../components/LabsTab';
import type { LabAnalysis } from '../lib/wineryState';

const labLog: LabAnalysis = {
  id: 'lab-1',
  lotId: 'QA-LOT-1',
  tankId: 'T-1',
  date: '2026-07-11',
  alcoholPct: 12.5,
  volatileAcid: 0.42,
  freeSo2: 24,
  totalSo2: 78,
  residualSugar: 2.1,
  ph: 3.45,
  malicAcid: 0.4,
  lacticAcid: 1.2,
  turbidity: 16,
  technician: 'QA Technician',
  titratableAcidity: 6.2,
};

function labProps(
  overrides: Partial<ComponentProps<typeof LabsTab>> = {},
): ComponentProps<typeof LabsTab> {
  return {
    lang: 'en',
    lots: [],
    vessels: [],
    labLogs: [labLog],
    labFilterType: 'all',
    setLabFilterType: vi.fn(),
    labFilterAge: 'all',
    setLabFilterAge: vi.fn(),
    labLotId: '',
    setLabLotId: vi.fn(),
    labTankId: '',
    setLabTankId: vi.fn(),
    labDate: '2026-07-11',
    setLabDate: vi.fn(),
    labPH: 3.45,
    setLabPH: vi.fn(),
    labMalic: 0.4,
    setLabMalic: vi.fn(),
    labTechnician: 'QA Technician',
    setLabTechnician: vi.fn(),
    labABV: 0,
    setLabABV: vi.fn(),
    labVA: 0,
    setLabVA: vi.fn(),
    labFSO2: 0,
    setLabFSO2: vi.fn(),
    labTSO2: 0,
    setLabTSO2: vi.fn(),
    labResidualSugar: 0,
    setLabResidualSugar: vi.fn(),
    labLactic: 0,
    setLabLactic: vi.fn(),
    labTA: 0,
    setLabTA: vi.fn(),
    labTurbidity: 0,
    setLabTurbidity: vi.fn(),
    onAddLabLog: vi.fn(),
    ...overrides,
  };
}

function flattenElements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(flattenElements);
  if (!React.isValidElement(node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [element, ...flattenElements(element.props.children)];
}

describe('LabsTab action permissions', () => {
  it('keeps lab history and filters visible while hiding create controls', () => {
    const markup = renderToStaticMarkup(React.createElement(LabsTab, labProps({
      canCreateLabAnalysis: false,
    })));

    expect(markup).toContain('Lab history is read-only for your workspace role');
    expect(markup).toContain('QA-LOT-1 (T-1)');
    expect(markup).toContain('Filter Wine Type / Class');
    expect(markup).toContain('Filter Age / Vintage');
    expect(markup).not.toContain('Add Lab Readings');
    expect(markup).not.toContain('Commit Lab Reads');
    expect(markup).toContain('xl:col-span-3');
  });

  it('localizes the read-only notice in Georgian', () => {
    const markup = renderToStaticMarkup(React.createElement(LabsTab, labProps({
      lang: 'ka',
      canCreateLabAnalysis: false,
    })));

    expect(markup).toContain('ლაბორატორიის ისტორია მხოლოდ სანახავია');
    expect(markup).not.toContain('Lab history is read-only');
  });

  it('preserves create behavior by default and forwards permitted submissions', () => {
    const onAddLabLog = vi.fn();
    const tree = LabsTabRender(labProps({ onAddLabLog }));
    const form = flattenElements(tree).find(element => element.type === 'form');
    const event = { preventDefault: vi.fn() } as unknown as React.FormEvent;

    expect(renderToStaticMarkup(tree)).toContain('Add Lab Readings');
    expect(form).toBeDefined();
    form?.props.onSubmit(event);
    expect(onAddLabLog).toHaveBeenCalledWith(event);
  });
});

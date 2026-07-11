import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CellarMap from '../components/CellarMap';
import TanksVessels from '../components/TanksVessels';
import { ToastProvider } from '../components/ToastProvider';
import type { Vessel, WineLot } from '../lib/wineryState';

const vessel: Vessel = {
  id: 'T-READ-1',
  type: 'stainless_steel',
  shape: 'vertical',
  capacity: 2_000,
  currentVolume: 1_200,
  assignedLotId: 'LOT-1',
  cleaningStatus: 'dirty',
  lastCleaned: '2026-07-01',
  temperature: 18.5,
  coolingJacketActive: false,
  targetTemperature: null,
  lastOperation: 'Filled',
  locationDetails: 'North Hall',
  xGrid: 25,
  yGrid: 30,
};

const lot: WineLot = {
  id: 'LOT-1',
  name: 'Saperavi Reserve',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Block A',
  region: 'Kakheti',
  initialVolume: 1_500,
  currentVolume: 1_200,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-06-01',
  history: [],
};

function vesselProps(overrides: Partial<ComponentProps<typeof TanksVessels>> = {}): ComponentProps<typeof TanksVessels> {
  return {
    lang: 'en',
    vessels: [vessel],
    lots: [lot],
    onUpdateVessels: vi.fn(),
    ...overrides,
  };
}

function renderVessels(overrides: Partial<ComponentProps<typeof TanksVessels>> = {}): string {
  return renderToStaticMarkup(
    React.createElement(ToastProvider, null, React.createElement(TanksVessels, vesselProps(overrides))),
  );
}

describe('TanksVessels action permissions', () => {
  it('keeps vessel data visible while hiding every mutation control in read-only mode', () => {
    const markup = renderVessels({
      canCreateVessel: false,
      canUpdateVessel: false,
      canDeleteVessel: false,
    });

    expect(markup).toContain('Read-only vessel access.');
    expect(markup).toContain('T-READ-1');
    expect(markup).toContain('Saperavi Reserve');
    expect(markup).toContain('North Hall');
    expect(markup).not.toContain('Commission Vessel');
    expect(markup).not.toContain('Register Vessel');
    expect(markup).not.toContain('title="Set temperature value"');
    expect(markup).not.toContain('Wash Vessel');
    expect(markup).not.toContain('Commission out / destroy vessel');
  });

  it('allows operational updates without exposing commission or decommission actions', () => {
    const markup = renderVessels({
      canCreateVessel: false,
      canUpdateVessel: true,
      canDeleteVessel: false,
    });

    expect(markup).toContain('Limited vessel access.');
    expect(markup).not.toContain('Commission Vessel');
    expect(markup).toContain('Your role cannot commission vessels or decommission vessels.');
    expect(markup).toContain('title="Set temperature value"');
    expect(markup).toContain('Wash Vessel');
    expect(markup).not.toContain('Commission out / destroy vessel');
  });

  it('keeps create and update actions while omitting delete for a winemaker-style role', () => {
    const markup = renderVessels({
      canCreateVessel: true,
      canUpdateVessel: true,
      canDeleteVessel: false,
    });

    expect(markup).toContain('Commission Vessel');
    expect(markup).toContain('title="Set temperature value"');
    expect(markup).toContain('Wash Vessel');
    expect(markup).not.toContain('Commission out / destroy vessel');
    expect(markup).toContain('Your role cannot decommission vessels.');
  });

  it('retains all existing actions by default for backward compatibility', () => {
    const markup = renderVessels();

    expect(markup).toContain('Commission Vessel');
    expect(markup).toContain('title="Set temperature value"');
    expect(markup).toContain('Wash Vessel');
    expect(markup).toContain('Commission out / destroy vessel');
    expect(markup).not.toContain('Limited vessel access.');
  });

  it('localizes the read-only explanation in Georgian', () => {
    const markup = renderVessels({
      lang: 'ka',
      canCreateVessel: false,
      canUpdateVessel: false,
      canDeleteVessel: false,
    });

    expect(markup).toContain('მხოლოდ ნახვის წვდომა.');
    expect(markup).toContain('შეგიძლიათ ნახოთ ტევადობა, მდგომარეობა და მარნის რუკა');
    expect(markup).not.toContain('Read-only vessel access.');
  });
});

describe('CellarMap vessel permissions', () => {
  it('keeps map layers and transfer navigation visible but hides layout editing without update access', () => {
    const markup = renderToStaticMarkup(React.createElement(CellarMap, {
      lang: 'en',
      vessels: [vessel],
      lots: [lot],
      onUpdateVessels: vi.fn(),
      canUpdateVessel: false,
      canExecuteTransfer: false,
    }));

    expect(markup).toContain('Interactive Cellar Floor Map');
    expect(markup).toContain('Variety Color');
    expect(markup).toContain('Temperature');
    expect(markup).toContain('Sanitation');
    expect(markup).toContain('T-READ-1');
    expect(markup).not.toContain('Customize Layout');
    expect(markup).not.toContain('dispatch a transfer');
  });

  it('retains layout editing by default', () => {
    const markup = renderToStaticMarkup(React.createElement(CellarMap, {
      lang: 'en',
      vessels: [vessel],
      lots: [lot],
      onUpdateVessels: vi.fn(),
      canExecuteTransfer: true,
    }));

    expect(markup).toContain('Customize Layout');
    expect(markup).toContain('dispatch a transfer');
  });
});

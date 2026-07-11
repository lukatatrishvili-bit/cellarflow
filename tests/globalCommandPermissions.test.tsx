import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import GlobalCommandPalette from '../components/GlobalCommandPalette';
import type { Role } from '../server/permissions';

function renderPalette(role: Role): string {
  return renderToStaticMarkup(React.createElement(GlobalCommandPalette, {
    open: true,
    onOpenChange: vi.fn(),
    lots: [],
    vessels: [],
    inventory: [],
    tasks: [],
    orders: [],
    dispatches: [],
    role,
    setActiveModule: vi.fn(),
    setActiveTab: vi.fn(),
    setPassportLotId: vi.fn(),
    setSelectedTankId: vi.fn(),
    setLineageLotId: vi.fn(),
  }));
}

describe('GlobalCommandPalette permissions', () => {
  it('only indexes destinations available to a lab technician', () => {
    const markup = renderPalette('Lab Technician');

    expect(markup).toContain('>Dashboard</strong>');
    expect(markup).toContain('>Cellar</strong>');
    expect(markup).toContain('>Documents</strong>');
    expect(markup).toContain('>Settings</strong>');
    expect(markup).not.toContain('>Vineyard</strong>');
    expect(markup).not.toContain('>Sales</strong>');
    expect(markup).not.toContain('>Storage</strong>');
    expect(markup).not.toContain('>Analytics</strong>');
  });

  it('keeps the complete module index for an owner', () => {
    const markup = renderPalette('Owner/Admin');

    expect(markup).toContain('>Vineyard</strong>');
    expect(markup).toContain('>Sales</strong>');
    expect(markup).toContain('>Storage</strong>');
    expect(markup).toContain('>Analytics</strong>');
  });
});

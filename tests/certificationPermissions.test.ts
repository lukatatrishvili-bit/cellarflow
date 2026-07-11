import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CertificationManagerTab from '../components/CertificationManagerTab';
import type { WineLot } from '../lib/wineryState';

const lot: WineLot = {
  id: 'lot-2026-01',
  name: 'Saperavi Reserve',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Mukuzani Block 1',
  region: 'Kakheti',
  initialVolume: 1_000,
  currentVolume: 900,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-01-01',
  history: [],
};

function renderCertification(canManageCertification: boolean): string {
  return renderToStaticMarkup(React.createElement(CertificationManagerTab, {
    lang: 'en',
    lots: [lot],
    blocks: [],
    grapeIntakes: [],
    labLogs: [],
    bottlingRuns: [],
    certificationRecords: [],
    attachments: [],
    onUpdateCertificationRecords: vi.fn(),
    onUpdateLots: vi.fn(),
    onAddAttachment: () => {
      throw new Error('Attachment callback must not run during rendering.');
    },
    canManageCertification,
  }));
}

describe('CertificationManagerTab permissions', () => {
  it('renders a visibly read-only review surface without mutation actions', () => {
    const markup = renderCertification(false);

    expect(markup).toContain('Read-only certification access');
    expect(markup).not.toContain('Save</button>');
    expect(markup).not.toContain('Apply PDO');
    expect(markup).not.toContain('type="file"');
    expect(markup).toMatch(/<select[^>]*aria-label="Product type"[^>]*disabled=""/);
    expect(markup).toMatch(/<textarea[^>]*disabled=""/);
    expect(markup).not.toMatch(/<select[^>]*aria-label="Wine lot"[^>]*disabled=""/);
    expect(markup).not.toMatch(/<select[^>]*aria-label="PDO rule"[^>]*disabled=""/);
  });

  it('keeps certification mutation controls available for managers', () => {
    const markup = renderCertification(true);

    expect(markup).not.toContain('Read-only certification access');
    expect(markup).toContain('Save</button>');
    expect(markup).toContain('Apply PDO');
    expect(markup).toContain('type="file"');
    expect(markup).not.toMatch(/<select[^>]*aria-label="Product type"[^>]*disabled=""/);
  });
});

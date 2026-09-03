import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import SyncConflictResolutionModal from '../components/SyncConflictResolutionModal';

const conflict = {
  collection: 'lots',
  recordId: 'lot-1',
  local: { id: 'lot-1', name: 'Local name' },
  server: { id: 'lot-1', name: 'Server name' },
};

describe('SyncConflictResolutionModal', () => {
  it('exposes a labelled modal and keyboard-operable radio choices', () => {
    const markup = renderToStaticMarkup(React.createElement(SyncConflictResolutionModal, {
      lang: 'en',
      conflicts: [conflict],
      resolutions: {},
      onChoose: vi.fn(),
      onResolve: vi.fn(),
      onClose: vi.fn(),
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/role="radio"/g)).toHaveLength(2);
    expect(markup).not.toContain('aria-checked="true"');
    expect(markup).toContain('Choose a version for every conflict to continue.');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Review sync conflicts later');
  });

  it('localizes the selection and close affordances in Georgian', () => {
    const markup = renderToStaticMarkup(React.createElement(SyncConflictResolutionModal, {
      lang: 'ka',
      conflicts: [conflict],
      resolutions: { 'lots-lot-1': 'local' },
      onChoose: vi.fn(),
      onResolve: vi.fn(),
      onClose: vi.fn(),
    }));

    expect(markup).toContain('✓ არჩეულია');
    expect(markup).toContain('კონფლიქტების მოგვიანებით განხილვა');
    expect(markup).not.toContain('✓ Selected');
    expect(markup).not.toContain('disabled=""');
  });
});

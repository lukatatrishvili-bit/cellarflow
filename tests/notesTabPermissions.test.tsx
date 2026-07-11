import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import NotesTab from '../components/NotesTab';

const lots = [
  {
    id: 'LOT-SAP-2026',
    name: 'Saperavi Reserve',
    vintage: 2026,
    variety: 'Saperavi',
    vineyardBlock: 'Block A',
    region: 'Kakheti',
    initialVolume: 1_000,
    currentVolume: 900,
    wineClass: 'red' as const,
    stage: 'aging' as const,
    createdAt: '2026-09-01',
    history: [],
  },
];

const notes = [
  {
    id: 'note-1',
    title: 'Fermentation tasting',
    category: 'Tasting' as const,
    content: 'Dark fruit and balanced acidity.',
    date: '2026-09-05',
    author: 'Nino',
    relatedLotId: 'LOT-SAP-2026',
  },
  {
    id: 'note-2',
    title: 'Cellar sanitation',
    category: 'Sanitation' as const,
    content: 'South aisle cleaning complete.',
    date: '2026-09-06',
    author: 'Giorgi',
  },
];

function notesProps(overrides: Partial<ComponentProps<typeof NotesTab>> = {}): ComponentProps<typeof NotesTab> {
  return {
    lang: 'en',
    lots,
    notesList: notes,
    onAddNewNote: vi.fn(),
    onDeleteNote: vi.fn(),
    ...overrides,
  };
}

describe('NotesTab action permissions', () => {
  it('keeps notes and lot filtering visible in read-only mode', () => {
    const markup = renderToStaticMarkup(React.createElement(NotesTab, notesProps({
      canCreateNote: false,
      canDeleteNote: false,
    })));

    expect(markup).toContain('Read-only access');
    expect(markup).toContain('Fermentation tasting');
    expect(markup).toContain('Cellar sanitation');
    expect(markup).toContain('Filter notes by lot');
    expect(markup).toContain('All lots');
    expect(markup).toContain('Saperavi Reserve');
    expect(markup).toContain('Showing 2 of 2');
    expect(markup).not.toContain('Record Winery Note');
    expect(markup).not.toContain('Save Note Entry');
    expect(markup).not.toContain('Delete Fermentation tasting');
    expect(markup).not.toContain('Delete Cellar sanitation');
  });

  it('retains the original create and delete controls by default', () => {
    const markup = renderToStaticMarkup(React.createElement(NotesTab, notesProps()));

    expect(markup).toContain('Record Winery Note');
    expect(markup).toContain('Save Note Entry');
    expect(markup).toContain('Delete Fermentation tasting');
    expect(markup).toContain('Delete Cellar sanitation');
    expect(markup).not.toContain('Read-only access');
  });

  it.each([
    { canCreateNote: false, canDeleteNote: true, formVisible: false, deleteVisible: true, notice: 'cannot create new entries' },
    { canCreateNote: true, canDeleteNote: false, formVisible: true, deleteVisible: false, notice: 'cannot delete entries' },
  ])('applies create and delete permissions independently: $notice', (permission) => {
    const markup = renderToStaticMarkup(React.createElement(NotesTab, notesProps(permission)));

    expect(markup.includes('Record Winery Note')).toBe(permission.formVisible);
    expect(markup.includes('Delete Fermentation tasting')).toBe(permission.deleteVisible);
    expect(markup).toContain(permission.notice);
  });

  it('localizes the read-only notice and lot filter in Georgian', () => {
    const markup = renderToStaticMarkup(React.createElement(NotesTab, notesProps({
      lang: 'ka',
      canCreateNote: false,
      canDeleteNote: false,
    })));

    expect(markup).toContain('მხოლოდ ნახვის წვდომა');
    expect(markup).toContain('ჩანაწერების ლოტით გაფილტვრა');
    expect(markup).toContain('ყველა ლოტი');
  });
});

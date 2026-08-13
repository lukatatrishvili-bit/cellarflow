import { describe, expect, it } from 'vitest';
import { buildAdminCsv } from '../lib/adminCsvExport';

describe('admin CSV export', () => {
  it('emits an Excel-friendly BOM and safely quotes every field', () => {
    expect(buildAdminCsv(
      ['Name', 'Note', 'Empty'],
      [['A, B', 'He said "hello"\nand left', null]],
    )).toBe('\uFEFF"Name","Note","Empty"\r\n"A, B","He said ""hello""\nand left",""');
  });
});

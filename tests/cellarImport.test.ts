import { describe, expect, it } from 'vitest';
import {
  applyImport,
  importTemplateCsv,
  previewLotImport,
  previewVesselImport,
} from '../lib/cellarImport';
import type { Vessel, WineLot } from '../lib/wineryState';

const NOW = '2026-09-01T07:00:00.000Z';

const existingVessel: Vessel = {
  id: 'T-01',
  type: 'stainless_steel',
  shape: 'vertical',
  capacity: 5000,
  currentVolume: 1000,
  assignedLotId: 'LOT-OLD',
  cleaningStatus: 'dirty',
  lastCleaned: '2026-08-01',
  temperature: 18,
  coolingJacketActive: true,
  targetTemperature: 16,
  lastOperation: 'Racked',
};

describe('previewVesselImport', () => {
  const preview = (csv: string, existing: Vessel[] = []) => previewVesselImport({ csv, existing });

  it('reads a plain file', () => {
    const result = preview('id,capacity,volume\nT-01,5000,3200\nT-02,2000,0\n');

    expect(result).toMatchObject({ created: 2, updated: 0, skipped: 0, missingColumns: [] });
    expect(result.rows[0].record).toMatchObject({ id: 'T-01', capacity: 5000, currentVolume: 3200 });
  });

  it('accepts the header names a person would actually type', () => {
    const result = preview('Tank ID,Capacity (L),Current Volume\nT-01,5000,3200\n');

    expect(result.missingColumns).toEqual([]);
    expect(result.rows[0].record?.currentVolume).toBe(3200);
  });

  it('refuses to guess when a required column is absent', () => {
    const result = preview('name,volume\nT-01,3200\n');

    expect(result.missingColumns).toEqual(['id', 'capacity']);
    expect(result.rows.every(row => row.action === 'skip')).toBe(true);
  });

  it('names unused columns rather than silently dropping them', () => {
    const result = preview('id,capacity,serial number\nT-01,5000,ABC\n');

    expect(result.unknownColumns).toEqual(['serial number']);
  });

  it('marks an existing vessel as an update, not a duplicate', () => {
    const result = preview('id,capacity,volume\nT-01,5000,3200\n', [existingVessel]);

    expect(result).toMatchObject({ created: 0, updated: 1 });
  });

  it('keeps fields the file does not speak about', () => {
    const result = preview('id,capacity,volume\nT-01,5000,3200\n', [existingVessel]);
    const record = result.rows[0].record!;

    expect(record).toMatchObject({
      cleaningStatus: 'dirty',
      lastCleaned: '2026-08-01',
      coolingJacketActive: true,
      targetTemperature: 16,
      temperature: 18,
    });
    expect(record.currentVolume).toBe(3200);
  });

  it('reports a bad row without failing the file', () => {
    const result = preview('id,capacity,volume\nT-01,5000,3200\n,4000,10\nT-03,abc,10\n');

    expect(result).toMatchObject({ created: 1, skipped: 2 });
    expect(result.rows[1].issues).toContain('Missing vessel id.');
    expect(result.rows[2].issues).toContain('Capacity must be a number.');
  });

  it('gives the source line number for every row', () => {
    const result = preview('id,capacity\nT-01,5000\nT-02,5000\n');

    expect(result.rows.map(row => row.line)).toEqual([2, 3]);
  });

  it('catches a volume that will not fit the vessel', () => {
    const result = preview('id,capacity,volume\nT-01,1000,2000\n');

    expect(result.rows[0].issues).toContain('Volume is greater than the capacity.');
  });

  it('catches an id repeated inside one file', () => {
    const result = preview('id,capacity\nT-01,5000\nt-01,4000\n');

    expect(result.rows[1].issues[0]).toContain('Duplicate vessel id');
  });

  it('rejects an unrecognised vessel type instead of inventing one', () => {
    const result = preview('id,capacity,type\nT-01,5000,spaceship\n');

    expect(result.rows[0].issues[0]).toContain('Unknown vessel type');
  });

  it('defaults an empty vessel to zero volume rather than refusing', () => {
    const result = preview('id,capacity,volume\nT-01,5000,\n');

    expect(result.rows[0].record?.currentVolume).toBe(0);
  });

  it('reads numbers a European spreadsheet exports', () => {
    const result = preview('id,capacity,volume\nT-01,"5 000","3200,5"\n');

    expect(result.rows[0].record).toMatchObject({ capacity: 5000, currentVolume: 3200.5 });
  });

  it('handles CRLF files and trailing blank lines', () => {
    const result = preview('id,capacity\r\nT-01,5000\r\n\r\n');

    expect(result).toMatchObject({ created: 1, skipped: 0 });
  });

  it('produces nothing from an empty file', () => {
    expect(preview('')).toMatchObject({ created: 0, updated: 0, skipped: 0 });
  });
});

describe('previewLotImport', () => {
  const preview = (csv: string, existing: WineLot[] = []) => previewLotImport({ csv, existing, now: NOW });

  it('reads a plain file and fills sensible defaults', () => {
    const result = preview('id,volume\nLOT-1,3200\n');
    const record = result.rows[0].record!;

    expect(result).toMatchObject({ created: 1, missingColumns: [] });
    expect(record).toMatchObject({
      id: 'LOT-1',
      name: 'LOT-1',
      vintage: 2026,
      currentVolume: 3200,
      wineClass: 'red',
      stage: 'aging',
    });
  });

  it('treats today’s volume as the opening balance when none is given', () => {
    // A lot onboarded mid-life has no earlier volume to remember.
    expect(preview('id,volume\nLOT-1,3200\n').rows[0].record?.initialVolume).toBe(3200);
    expect(preview('id,volume,initial volume\nLOT-1,3200,4000\n').rows[0].record?.initialVolume).toBe(4000);
  });

  it('rejects an unknown class or stage by name', () => {
    expect(preview('id,volume,class\nLOT-1,10,purple\n').rows[0].issues[0]).toContain('Unknown wine class');
    expect(preview('id,volume,stage\nLOT-1,10,dancing\n').rows[0].issues[0]).toContain('Unknown stage');
  });

  it('accepts the classes this app actually has', () => {
    for (const wineClass of ['amber', 'qvevri', 'base_wine']) {
      expect(preview(`id,volume,class\nLOT-1,10,${wineClass}\n`).rows[0].record?.wineClass).toBe(wineClass);
    }
  });

  it('rejects a vintage that is not a plausible year', () => {
    expect(preview('id,volume,vintage\nLOT-1,10,1799\n').rows[0].issues[0]).toContain('vintage');
    expect(preview('id,volume,vintage\nLOT-1,10,2026\n').rows[0].record?.vintage).toBe(2026);
  });

  it('preserves an existing lot’s history and creation date on update', () => {
    const existing: WineLot = {
      id: 'LOT-1',
      name: 'Old name',
      vintage: 2025,
      variety: 'Rkatsiteli',
      vineyardBlock: 'B',
      region: 'Kakheti',
      initialVolume: 100,
      currentVolume: 90,
      wineClass: 'white',
      stage: 'aging',
      createdAt: '2025-01-01T00:00:00.000Z',
      history: [{ date: '2025-06-01', type: 'Racking', description: 'moved', operator: 'ana' }],
    };
    const record = preview('id,volume\nLOT-1,80\n', [existing]).rows[0].record!;

    expect(record.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(record.history).toHaveLength(1);
    expect(record.currentVolume).toBe(80);
    expect(record.name).toBe('Old name');
  });
});

describe('applyImport', () => {
  it('adds new records and replaces matching ones, leaving the rest alone', () => {
    const existing = [existingVessel, { ...existingVessel, id: 'T-99' }];
    const preview = previewVesselImport({
      csv: 'id,capacity,volume\nT-01,5000,4000\nT-02,2000,0\n',
      existing,
    });

    const result = applyImport(existing, preview);

    expect(result).toHaveLength(3);
    expect(result.find(entry => entry.id === 'T-01')?.currentVolume).toBe(4000);
    expect(result.find(entry => entry.id === 'T-99')?.currentVolume).toBe(1000);
    expect(result.find(entry => entry.id === 'T-02')).toBeTruthy();
  });

  it('applies only what the preview would import', () => {
    const preview = previewVesselImport({
      csv: 'id,capacity,volume\nT-01,5000,4000\nT-02,1000,9999\n',
      existing: [],
    });

    const result = applyImport([], preview);

    expect(result.map(entry => entry.id)).toEqual(['T-01']);
  });

  it('changes nothing when every row was rejected', () => {
    const existing = [existingVessel];
    const preview = previewVesselImport({ csv: 'name,volume\nT-01,10\n', existing });

    expect(applyImport(existing, preview)).toBe(existing);
  });
});

describe('importTemplateCsv', () => {
  it('produces a file its own importer accepts without complaint', () => {
    const vessels = previewVesselImport({ csv: importTemplateCsv('vessels'), existing: [] });
    expect(vessels).toMatchObject({ skipped: 0, missingColumns: [], unknownColumns: [] });
    expect(vessels.created).toBe(2);

    const lots = previewLotImport({ csv: importTemplateCsv('lots'), existing: [], now: NOW });
    expect(lots).toMatchObject({ skipped: 0, missingColumns: [], unknownColumns: [] });
    expect(lots.created).toBe(1);
  });
});

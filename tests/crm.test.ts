import { describe, expect, it } from 'vitest';
import { createCrmLeadRecord, crmLeadContactLine, upsertCrmLeadRecord } from '../lib/crm';

describe('CRM lead records', () => {
  it('creates a saved CRM lead from a directory preview', () => {
    const lead = createCrmLeadRecord({
      id: 'lead-marani',
      displayName: 'Marani Telavi - Kakheti',
      companyName: 'Marani Telavi LLC',
      wineryName: 'Marani Telavi',
      source: 'manual_directory_import',
      tags: ['winery', 'Kakheti', 'winery'],
      notes: 'Wine Agency registration: WA-1',
      contactEmail: 'hello@example.com',
      createdAt: '2026-07-09T00:00:00.000Z',
      owner: 'Luka',
    });

    expect(lead.status).toBe('new');
    expect(lead.tags).toEqual(['winery', 'Kakheti']);
    expect(crmLeadContactLine(lead)).toContain('hello@example.com');
  });

  it('upserts duplicate leads without losing existing status', () => {
    const existing = createCrmLeadRecord({
      id: 'lead-marani',
      displayName: 'Old',
      companyName: 'Old LLC',
      wineryName: 'Old',
      source: 'manual',
      tags: ['old'],
      notes: 'Existing note',
      status: 'qualified',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    const incoming = createCrmLeadRecord({
      id: 'lead-marani',
      displayName: 'Marani Telavi',
      companyName: 'Marani Telavi LLC',
      wineryName: 'Marani Telavi',
      source: 'manual_directory_import',
      tags: ['new'],
      notes: 'New note',
      createdAt: '2026-07-09T00:00:00.000Z',
    });

    const merged = upsertCrmLeadRecord([existing], incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('qualified');
    expect(merged[0].createdAt).toBe('2026-07-01T00:00:00.000Z');
    expect(merged[0].tags).toEqual(['old', 'new']);
  });
});

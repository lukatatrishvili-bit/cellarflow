import { describe, expect, it } from 'vitest';
import {
  summarizeAiDrafts,
  summarizeAttachments,
  summarizeCrmLeads,
  summarizeOrgData,
} from '../server/adminOrgSummary';
import { checksumAttachmentDataUrl } from '../lib/attachments';

describe('admin org summary', () => {
  const inlineDataUrl = 'data:text/plain;base64,SGVsbG8=';
  const orgData = {
    vessels: [{ id: 'T-1' }, { id: 'T-2' }],
    lots: [{ id: 'L-1' }],
    certificationRecords: [{ id: 'C-1' }],
    attachments: [
      {
        id: 'att-1',
        module: 'official_docs',
        linkedRecordType: 'officialDocument',
        linkedRecordId: 'annex-3',
        sizeBytes: 128,
        checksum: checksumAttachmentDataUrl(inlineDataUrl),
        storage: { kind: 'inline', dataUrl: inlineDataUrl },
      },
      {
        id: 'att-2',
        module: 'certification',
        sizeBytes: 512,
        storage: { kind: 'external', url: 'https://example.test/cert.pdf' },
      },
      {
        id: 'att-3',
        module: 'crm',
        checksum: 'invalid',
        storage: { kind: 'metadata_only' },
      },
    ],
    crmLeads: [
      { id: 'lead-1', status: 'new' },
      { id: 'lead-2', status: 'customer' },
      { id: 'lead-3', status: 'archived' },
    ],
    aiDrafts: [
      { id: 'draft-1', type: 'task', status: 'draft', reviewOnly: true },
      { id: 'draft-2', type: 'compliance_warning', status: 'dismissed', reviewOnly: true },
    ],
  };

  it('summarizes attachment storage and checksum coverage', () => {
    const summary = summarizeAttachments(orgData);

    expect(summary.count).toBe(3);
    expect(summary.linkedCount).toBe(1);
    expect(summary.inlineCount).toBe(1);
    expect(summary.externalCount).toBe(1);
    expect(summary.metadataOnlyCount).toBe(1);
    expect(summary.inlineBytes).toBe(128);
    expect(summary.checksummedCount).toBe(1);
    expect(summary.invalidChecksumCount).toBe(1);
    expect(summary.checksumCoveragePct).toBe(33);
    expect(summary.byModule).toMatchObject({
      official_docs: 1,
      certification: 1,
      crm: 1,
    });
  });

  it('summarizes CRM and AI draft queues', () => {
    expect(summarizeCrmLeads(orgData)).toMatchObject({
      count: 3,
      activeCount: 2,
      customersCount: 1,
      byStatus: { new: 1, customer: 1, archived: 1 },
    });

    expect(summarizeAiDrafts(orgData)).toMatchObject({
      count: 2,
      reviewOnlyCount: 2,
      byStatus: { draft: 1, dismissed: 1 },
      byType: { task: 1, compliance_warning: 1 },
    });
  });

  it('builds a compact operational org summary', () => {
    expect(summarizeOrgData(orgData)).toMatchObject({
      tanksCount: 2,
      lotsCount: 1,
      certificationRecordsCount: 1,
      attachmentsCount: 3,
      crmLeadsCount: 3,
      aiDraftsCount: 2,
      inlineAttachmentBytes: 128,
      attachmentChecksumCoveragePct: 33,
    });
  });
});

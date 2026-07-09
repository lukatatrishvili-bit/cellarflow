import { describe, expect, it } from 'vitest';
import { checksumAttachmentDataUrl } from '../lib/attachments';
import { validateSyncPayload } from '../server/routes/sync';

const baseDb = () => ({
  lots: [],
  auditLogs: [],
  attachments: [],
});

const attachment = (fields: Record<string, any>) => ({
  id: 'att-1',
  fileName: 'certificate.pdf',
  module: 'certification',
  storage: { kind: 'metadata_only' },
  ...fields,
});

describe('sync payload validation', () => {
  it('accepts supported inline attachments with matching checksum and MIME', () => {
    const dataUrl = 'data:application/pdf;base64,AAAA';

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        mimeType: 'application/pdf',
        storage: { kind: 'inline', dataUrl },
        checksum: checksumAttachmentDataUrl(dataUrl),
      })],
    }, undefined)).not.toThrow();
  });

  it('rejects unsafe external attachment URLs', () => {
    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        storage: { kind: 'external', url: 'javascript:alert(1)' },
      })],
    }, undefined)).toThrow(/http\(s\)/i);
  });

  it('rejects unsupported attachment filenames and MIME types', () => {
    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({ fileName: 'payload.exe' })],
    }, undefined)).toThrow(/unsupported file type/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        mimeType: 'text/html',
        storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
      })],
    }, undefined)).toThrow(/unsupported MIME type/i);
  });

  it('rejects inline MIME and checksum mismatches', () => {
    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        mimeType: 'application/pdf',
        storage: { kind: 'inline', dataUrl: 'data:image/png;base64,AAAA' },
      })],
    }, undefined)).toThrow(/MIME type does not match/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
        checksum: '0'.repeat(64),
      })],
    }, undefined)).toThrow(/checksum does not match/i);
  });
});

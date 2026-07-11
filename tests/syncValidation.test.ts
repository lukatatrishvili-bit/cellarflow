import { describe, expect, it } from 'vitest';
import { checksumAttachmentDataUrl, MAX_INLINE_ATTACHMENT_BYTES } from '../lib/attachments';
import { prepareAttachmentsForServerMerge, validateSyncPayload } from '../server/routes/sync';

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

  it('rejects unsafe or non-HTTPS external attachment URLs', () => {
    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        storage: { kind: 'external', url: 'javascript:alert(1)' },
      })],
    }, undefined)).toThrow(/https/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        storage: { kind: 'external', url: 'http://example.test/evidence.pdf' },
      })],
    }, undefined)).toThrow(/https/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        storage: { kind: 'external', url: 'https://user:pass@example.test/evidence.pdf' },
      })],
    }, undefined)).toThrow(/https/i);
  });

  it('rejects unsupported attachment filenames and MIME types', () => {
    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({ fileName: '../certificate.pdf' })],
    }, undefined)).toThrow(/safe fileName/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({ fileName: 'payload.exe' })],
    }, undefined)).toThrow(/unsupported file type/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        mimeType: 'text/html',
        storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
      })],
    }, undefined)).toThrow(/unsupported MIME type/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        fileName: 'certificate.pdf',
        mimeType: 'image/png',
        storage: { kind: 'inline', dataUrl: 'data:image/png;base64,AAAA' },
      })],
    }, undefined)).toThrow(/unsupported MIME type/i);
  });

  it('rejects inline MIME and checksum mismatches', () => {
    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        mimeType: 'application/pdf',
        storage: { kind: 'inline', dataUrl: 'data:image/png;base64,AAAA' },
      })],
    }, undefined)).toThrow(/inline storage requires|MIME type does not match/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        fileName: 'certificate.pdf',
        storage: { kind: 'inline', dataUrl: 'data:image/png;base64,AAAA' },
      })],
    }, undefined)).toThrow(/inline storage requires/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        fileName: 'certificate.pdf',
        mimeType: 'application/pdf',
        storage: { kind: 'inline', dataUrl: 'data:application/pdf,not-base64' },
      })],
    }, undefined)).toThrow(/inline storage requires/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
        checksum: '0'.repeat(64),
      })],
    }, undefined)).toThrow(/checksum does not match/i);
  });

  it('rejects inline attachments whose decoded payload exceeds the single-file cap', () => {
    const payload = 'A'.repeat(Math.ceil((MAX_INLINE_ATTACHMENT_BYTES + 1) / 3) * 4);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        mimeType: 'application/pdf',
        sizeBytes: 1,
        storage: { kind: 'inline', dataUrl: `data:application/pdf;base64,${payload}` },
      })],
    }, undefined)).toThrow(/too large/i);
  });

  it('normalizes attachment payloads before server merge without mutating the request', () => {
    const dataUrl = 'data:application/pdf;base64,AAAA';
    const incoming = [{
      id: 'att-1',
      fileName: '  Certificate.PDF  ',
      mimeType: ' Application/PDF; charset=UTF-8 ',
      module: 'certification',
      storage: { kind: 'inline', dataUrl, url: 'https://example.test/ignored.pdf' },
    }, {
      id: 'att-2',
      fileName: ' External Evidence.PDF ',
      mimeType: '',
      module: 'official_docs',
      checksum: 'A'.repeat(64),
      storage: {
        kind: 'external',
        url: ' https://example.test/evidence.pdf ',
        dataUrl: 'data:application/pdf;base64,SHOULD_NOT_PERSIST',
      },
    }, {
      id: 'att-3',
      fileName: 'Metadata.pdf',
      module: 'official_docs',
      storage: {
        kind: 'metadata_only',
        dataUrl: 'data:application/pdf;base64,SHOULD_NOT_PERSIST',
        url: 'https://example.test/ignored.pdf',
      },
    }];

    const prepared = prepareAttachmentsForServerMerge(incoming);

    expect(prepared[0]).toMatchObject({
      fileName: 'Certificate.PDF',
      mimeType: 'application/pdf',
      checksum: checksumAttachmentDataUrl(dataUrl),
    });
    expect(prepared[1]).toMatchObject({
      fileName: 'External Evidence.PDF',
      checksum: 'a'.repeat(64),
      storage: { kind: 'external', url: 'https://example.test/evidence.pdf' },
    });
    expect(prepared[0].storage).toEqual({ kind: 'inline', dataUrl });
    expect(prepared[1].storage).toEqual({ kind: 'external', url: 'https://example.test/evidence.pdf' });
    expect(prepared[2].storage).toEqual({ kind: 'metadata_only' });
    expect(prepared[1]).not.toHaveProperty('mimeType');
    expect(incoming[0].fileName).toBe('  Certificate.PDF  ');
    expect(incoming[0].storage).not.toBe(prepared[0].storage);
    expect(incoming[1].storage.url).toBe(' https://example.test/evidence.pdf ');
  });
});

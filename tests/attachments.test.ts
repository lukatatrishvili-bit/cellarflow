import { describe, expect, it } from 'vitest';
import {
  attachmentUploadPreflightError,
  attachmentMimeTypeMatchesInlineDataUrl,
  attachmentMimeTypeMatchesFileName,
  attachmentsForRecord,
  checksumAttachmentDataUrl,
  createDocumentAttachmentRecord,
  formatAttachmentSize,
  getAttachmentAccess,
  inlineAttachmentDecodedBytes,
  inlineAttachmentMediaType,
  isAllowedInlineAttachmentDataUrl,
  isSupportedAttachmentMimeType,
  isSupportedAttachmentFileName,
  isValidAttachmentChecksum,
  MAX_INLINE_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILENAME_CHARS,
  MAX_TOTAL_INLINE_ATTACHMENT_BYTES,
  normalizeAttachmentFileName,
  normalizeAttachmentMimeType,
  normalizeExternalAttachmentUrl,
  supportedAttachmentTypesLabel,
  SUPPORTED_ATTACHMENT_ACCEPT,
  SUPPORTED_ATTACHMENT_EXTENSIONS,
  sumInlineAttachmentBytes,
} from '../lib/attachments';

describe('document attachments', () => {
  it('creates an inline attachment record with safe defaults', () => {
    const attachment = createDocumentAttachmentRecord({
      fileName: 'certificate.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1200,
      module: 'certification',
      linkedRecordType: 'certificationRecord',
      linkedRecordId: 'cert-1',
      storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
      uploadedAt: '2026-07-09T00:00:00.000Z',
      uploadedBy: 'Luka',
    });

    expect(attachment.id).toContain('certificate-pdf');
    expect(attachment.storage.kind).toBe('inline');
    expect(attachment.linkedRecordId).toBe('cert-1');
    expect(attachment.mimeType).toBe('application/pdf');
    expect(attachment.checksum).toBe(checksumAttachmentDataUrl('data:application/pdf;base64,AAAA'));
    expect(isValidAttachmentChecksum(attachment.checksum)).toBe(true);
  });

  it('keeps attachment IDs distinct for non-Latin filenames with sparse ASCII slugs', () => {
    const uploadedAt = '2026-07-09T00:00:00.000Z';
    const first = createDocumentAttachmentRecord({
      fileName: 'ქართული სერტიფიკატი.pdf',
      module: 'official_docs',
      uploadedAt,
      storage: { kind: 'metadata_only' },
    });
    const second = createDocumentAttachmentRecord({
      fileName: 'სხვა სერტიფიკატი.pdf',
      module: 'official_docs',
      uploadedAt,
      storage: { kind: 'metadata_only' },
    });

    expect(first.id).toMatch(/^att-\d+-pdf-[a-f0-9]{8}$/);
    expect(second.id).toMatch(/^att-\d+-pdf-[a-f0-9]{8}$/);
    expect(first.id).not.toBe(second.id);
  });

  it('rejects oversized inline files before JSON sync', () => {
    expect(() => createDocumentAttachmentRecord({
      fileName: 'large.pdf',
      sizeBytes: MAX_INLINE_ATTACHMENT_BYTES + 1,
      module: 'official_docs',
      storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
    })).toThrow(/too large/i);
  });

  it('allows only supported inline attachment data URL types', () => {
    expect(normalizeAttachmentFileName('  ქართული სერტიფიკატი.PDF  ')).toBe('ქართული სერტიფიკატი.PDF');
    expect(isSupportedAttachmentFileName('CERTIFICATE.PDF')).toBe(true);
    expect(isSupportedAttachmentFileName('ქართული სერტიფიკატი.PDF')).toBe(true);
    expect(isSupportedAttachmentFileName('malware.exe')).toBe(false);
    expect(normalizeAttachmentFileName('../certificate.pdf')).toBeNull();
    expect(normalizeAttachmentFileName('line\nbreak.pdf')).toBeNull();
    expect(normalizeAttachmentFileName('CON.pdf')).toBeNull();
    expect(normalizeAttachmentFileName('con.backup.pdf')).toBeNull();
    expect(normalizeAttachmentFileName('lpt1.csv')).toBeNull();
    expect(normalizeAttachmentFileName(`${'a'.repeat(MAX_ATTACHMENT_FILENAME_CHARS + 1)}.pdf`)).toBeNull();
    expect(inlineAttachmentMediaType('data:application/pdf;base64,AAAA')).toBe('application/pdf');
    expect(normalizeAttachmentMimeType(' Application/PDF; charset=UTF-8 ')).toBe('application/pdf');
    expect(isSupportedAttachmentMimeType('application/pdf', 'certificate.pdf')).toBe(true);
    expect(attachmentMimeTypeMatchesFileName('application/pdf', 'certificate.pdf')).toBe(true);
    expect(attachmentMimeTypeMatchesFileName('application/pdf', 'photo.png')).toBe(false);
    expect(isSupportedAttachmentMimeType('image/png', 'certificate.pdf')).toBe(false);
    expect(isSupportedAttachmentMimeType('text/html', 'certificate.pdf')).toBe(false);
    expect(isAllowedInlineAttachmentDataUrl('data:application/pdf;base64,AAAA', 'certificate.pdf')).toBe(true);
    expect(inlineAttachmentDecodedBytes('data:application/pdf;base64,AAAA')).toBe(3);
    expect(inlineAttachmentDecodedBytes('data:text/csv;base64,YSxiCg==')).toBe(4);
    expect(inlineAttachmentDecodedBytes('data:application/pdf,not-base64')).toBeNull();
    expect(isAllowedInlineAttachmentDataUrl('data:application/pdf,not-base64', 'certificate.pdf')).toBe(false);
    expect(isAllowedInlineAttachmentDataUrl('data:image/png;base64,AAAA', 'certificate.pdf')).toBe(false);
    expect(isAllowedInlineAttachmentDataUrl(
      'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,AAAA',
      'ledger.xlsx',
    )).toBe(true);
    expect(isAllowedInlineAttachmentDataUrl('data:application/octet-stream;base64,AAAA', 'scan.pdf')).toBe(true);
    expect(isAllowedInlineAttachmentDataUrl('data:text/plain;base64,YSxiCg==', 'ledger.csv')).toBe(true);
    expect(isAllowedInlineAttachmentDataUrl('data:text/html;base64,PHNjcmlwdD4=', 'invoice.pdf')).toBe(false);
    expect(attachmentMimeTypeMatchesInlineDataUrl('data:application/octet-stream;base64,AAAA', 'application/pdf', 'scan.pdf')).toBe(true);
    expect(attachmentMimeTypeMatchesInlineDataUrl('data:text/plain;base64,YSxiCg==', 'text/csv', 'ledger.csv')).toBe(true);
    expect(attachmentMimeTypeMatchesInlineDataUrl('data:text/csv,not-base64', 'text/csv', 'ledger.csv')).toBe(false);
    expect(attachmentMimeTypeMatchesInlineDataUrl('data:image/png;base64,AAAA', 'application/pdf', 'certificate.pdf')).toBe(false);
    expect(attachmentMimeTypeMatchesInlineDataUrl('data:image/png;base64,AAAA', undefined, 'certificate.pdf')).toBe(false);

    expect(() => createDocumentAttachmentRecord({
      fileName: 'unsafe.pdf',
      sizeBytes: 12,
      module: 'official_docs',
      storage: { kind: 'inline', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' },
    })).toThrow(/supported/i);
  });

  it('rejects mismatched or unsupported attachment MIME declarations', () => {
    expect(() => createDocumentAttachmentRecord({
      fileName: 'mismatch.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
      module: 'official_docs',
      storage: { kind: 'inline', dataUrl: 'data:image/png;base64,AAAA' },
    })).toThrow(/supported|match/i);

    expect(() => createDocumentAttachmentRecord({
      fileName: 'wrong-extension.pdf',
      mimeType: 'image/png',
      sizeBytes: 12,
      module: 'official_docs',
      storage: { kind: 'inline', dataUrl: 'data:image/png;base64,AAAA' },
    })).toThrow(/mime type/i);

    expect(() => createDocumentAttachmentRecord({
      fileName: 'not-base64.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
      module: 'official_docs',
      storage: { kind: 'inline', dataUrl: 'data:application/pdf,not-base64' },
    })).toThrow(/supported|match/i);

    expect(() => createDocumentAttachmentRecord({
      fileName: 'unsupported.pdf',
      mimeType: 'text/html',
      sizeBytes: 12,
      module: 'official_docs',
      storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
    })).toThrow(/mime type/i);
  });

  it('rejects unsupported attachment filename extensions', () => {
    expect(() => createDocumentAttachmentRecord({
      fileName: 'unsafe.exe',
      module: 'official_docs',
      storage: { kind: 'metadata_only' },
    })).toThrow(/file type/i);

    expect(() => createDocumentAttachmentRecord({
      fileName: '..\\secret.pdf',
      module: 'official_docs',
      storage: { kind: 'metadata_only' },
    })).toThrow(/safe file name/i);
  });

  it('rejects unknown storage kinds in the shared attachment creator', () => {
    expect(() => createDocumentAttachmentRecord({
      fileName: 'certificate.pdf',
      module: 'official_docs',
      storage: { kind: 'mystery' as any },
    })).toThrow(/storage kind/i);
  });

  it('returns user-facing preflight upload errors', () => {
    expect(attachmentUploadPreflightError({
      name: '../secret.pdf',
      size: 12,
      type: 'application/pdf',
    })).toMatch(/file name is not safe/i);

    expect(attachmentUploadPreflightError({
      name: 'payload.exe',
      size: 12,
      type: 'application/x-msdownload',
    })).toMatch(/unsupported attachment file type/i);

    expect(attachmentUploadPreflightError({
      name: 'large.pdf',
      size: MAX_INLINE_ATTACHMENT_BYTES + 1,
      type: 'application/pdf',
    })).toMatch(/too large/i);

    expect(attachmentUploadPreflightError({
      name: 'bad.pdf',
      size: 12,
      type: 'text/html',
    })).toMatch(/MIME type/i);

    expect(attachmentUploadPreflightError({
      name: 'bad.pdf',
      size: 12,
      type: 'image/png',
    })).toMatch(/MIME type/i);

    expect(attachmentUploadPreflightError({
      name: 'ok.pdf',
      size: 12,
      type: 'application/pdf',
    })).toBeNull();
  });

  it('rejects malformed checksum input', () => {
    expect(() => createDocumentAttachmentRecord({
      fileName: 'tampered.pdf',
      sizeBytes: 12,
      module: 'official_docs',
      storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
      checksum: 'not-a-sha256',
    })).toThrow(/checksum/i);
  });

  it('rejects mismatched inline checksum input', () => {
    expect(() => createDocumentAttachmentRecord({
      fileName: 'tampered.pdf',
      sizeBytes: 12,
      module: 'official_docs',
      storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
      checksum: '0'.repeat(64),
    })).toThrow(/does not match/i);
  });

  it('formats sizes and filters linked records', () => {
    const a = createDocumentAttachmentRecord({
      fileName: 'a.pdf',
      sizeBytes: 1024,
      module: 'certification',
      linkedRecordType: 'certificationRecord',
      linkedRecordId: 'cert-1',
      uploadedAt: '2026-07-09T00:00:00.000Z',
    });
    const b = createDocumentAttachmentRecord({
      fileName: 'b.pdf',
      sizeBytes: 2048,
      module: 'certification',
      linkedRecordType: 'certificationRecord',
      linkedRecordId: 'cert-2',
      uploadedAt: '2026-07-10T00:00:00.000Z',
    });

    expect(formatAttachmentSize(1024)).toBe('1.0 KB');
    expect(attachmentsForRecord([a, b], 'certificationRecord', 'cert-1')).toEqual([a]);
  });

  it('returns safe access descriptors for downloadable/openable attachments', () => {
    const external = createDocumentAttachmentRecord({
      fileName: 'external.pdf',
      module: 'official_docs',
      storage: { kind: 'external', url: 'https://example.test/evidence.pdf' },
    });

    expect(external.storage.url).toBe('https://example.test/evidence.pdf');
    expect(getAttachmentAccess({
      fileName: 'inline.pdf',
      storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
    })).toMatchObject({
      href: 'data:application/pdf;base64,AAAA',
      label: 'Download',
      download: 'inline.pdf',
      external: false,
    });

    expect(getAttachmentAccess({
      fileName: 'external.pdf',
      storage: { kind: 'external', url: 'https://example.test/evidence.pdf' },
    })).toMatchObject({
      href: 'https://example.test/evidence.pdf',
      label: 'Open',
      external: true,
    });
  });

  it('normalizes external attachment URLs and rejects unsafe storage URLs', () => {
    expect(normalizeExternalAttachmentUrl('https://example.test/file.pdf')).toBe('https://example.test/file.pdf');
    // http:// is rejected: mixed-content-blocked on the HTTPS app + downgrade risk.
    expect(normalizeExternalAttachmentUrl(' http://example.test/file.pdf ')).toBeNull();
    expect(normalizeExternalAttachmentUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeExternalAttachmentUrl('/relative/file.pdf')).toBeNull();
    expect(normalizeExternalAttachmentUrl('https://user:pass@example.test/file.pdf')).toBeNull();

    expect(() => createDocumentAttachmentRecord({
      fileName: 'unsafe.pdf',
      module: 'official_docs',
      storage: { kind: 'external', url: 'javascript:alert(1)' },
    })).toThrow(/https/i);
  });

  it('does not expose unsafe or metadata-only attachment links', () => {
    expect(getAttachmentAccess({
      fileName: 'unsafe.pdf',
      storage: { kind: 'external', url: 'javascript:alert(1)' },
    })).toBeNull();

    expect(getAttachmentAccess({
      fileName: 'unsafe.pdf',
      storage: { kind: 'inline', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' },
    })).toBeNull();

    expect(getAttachmentAccess({
      fileName: 'metadata.pdf',
      storage: { kind: 'metadata_only' },
    })).toBeNull();
  });

  it('sums only inline attachment bytes toward the org budget', () => {
    const list = [
      { sizeBytes: 1_000_000, storage: { kind: 'inline' as const, dataUrl: 'data:application/pdf;base64,AAAA' } },
      { sizeBytes: 2_000_000, storage: { kind: 'inline' as const, dataUrl: 'data:image/png;base64,BBBB' } },
      { sizeBytes: 9_000_000, storage: { kind: 'external' as const, url: 'https://example.test/big.pdf' } },
      { storage: { kind: 'metadata_only' as const } },
    ];
    // external + metadata_only cost ~0; only the two inline files count.
    expect(sumInlineAttachmentBytes(list)).toBe(3_000_000);
    expect(sumInlineAttachmentBytes(undefined)).toBe(0);
    expect(sumInlineAttachmentBytes([])).toBe(0);
  });

  it('uses decoded payload bytes when inline sizeBytes is under-declared', () => {
    const dataUrl = `data:application/pdf;base64,${'A'.repeat(400)}`;
    expect(inlineAttachmentDecodedBytes(dataUrl)).toBe(300);
    expect(sumInlineAttachmentBytes([{ sizeBytes: 1, storage: { kind: 'inline', dataUrl } }])).toBe(300);
  });

  it('keeps declared inline size when it is larger than decoded payload bytes', () => {
    const dataUrl = 'data:application/pdf;base64,AAAA';
    expect(sumInlineAttachmentBytes([{ sizeBytes: 1000, storage: { kind: 'inline', dataUrl } }])).toBe(1000);
  });

  it('falls back to decoded payload bytes when an inline size is missing', () => {
    const dataUrl = `data:application/pdf;base64,${'A'.repeat(500)}`;
    expect(sumInlineAttachmentBytes([{ storage: { kind: 'inline', dataUrl } }])).toBe(375);
  });

  it('falls back to raw data URL length only for malformed legacy inline payloads', () => {
    const dataUrl = 'data:application/pdf,not-base64';
    expect(sumInlineAttachmentBytes([{ storage: { kind: 'inline', dataUrl } }])).toBe(dataUrl.length);
  });

  it('sets a total inline budget above the single-file cap', () => {
    expect(MAX_TOTAL_INLINE_ATTACHMENT_BYTES).toBeGreaterThan(MAX_INLINE_ATTACHMENT_BYTES);
  });

  it('keeps the browser accept list aligned with the user-facing type label', () => {
    expect(SUPPORTED_ATTACHMENT_ACCEPT).toBe('.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.csv');
    expect(SUPPORTED_ATTACHMENT_ACCEPT).toBe(SUPPORTED_ATTACHMENT_EXTENSIONS.map(extension => `.${extension}`).join(','));
    for (const extension of SUPPORTED_ATTACHMENT_ACCEPT.split(',')) {
      expect(extension.startsWith('.')).toBe(true);
      expect(supportedAttachmentTypesLabel().toLowerCase()).toContain(extension.slice(1));
    }
  });
});

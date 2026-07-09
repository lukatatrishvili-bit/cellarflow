import { describe, expect, it } from 'vitest';
import {
  attachmentMimeTypeMatchesInlineDataUrl,
  attachmentsForRecord,
  checksumAttachmentDataUrl,
  createDocumentAttachmentRecord,
  formatAttachmentSize,
  getAttachmentAccess,
  inlineAttachmentMediaType,
  isAllowedInlineAttachmentDataUrl,
  isSupportedAttachmentMimeType,
  isSupportedAttachmentFileName,
  isValidAttachmentChecksum,
  MAX_INLINE_ATTACHMENT_BYTES,
  normalizeAttachmentMimeType,
  normalizeExternalAttachmentUrl,
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

  it('rejects oversized inline files before JSON sync', () => {
    expect(() => createDocumentAttachmentRecord({
      fileName: 'large.pdf',
      sizeBytes: MAX_INLINE_ATTACHMENT_BYTES + 1,
      module: 'official_docs',
      storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
    })).toThrow(/too large/i);
  });

  it('allows only supported inline attachment data URL types', () => {
    expect(isSupportedAttachmentFileName('CERTIFICATE.PDF')).toBe(true);
    expect(isSupportedAttachmentFileName('malware.exe')).toBe(false);
    expect(inlineAttachmentMediaType('data:application/pdf;base64,AAAA')).toBe('application/pdf');
    expect(normalizeAttachmentMimeType(' Application/PDF; charset=UTF-8 ')).toBe('application/pdf');
    expect(isSupportedAttachmentMimeType('application/pdf', 'certificate.pdf')).toBe(true);
    expect(isSupportedAttachmentMimeType('text/html', 'certificate.pdf')).toBe(false);
    expect(isAllowedInlineAttachmentDataUrl('data:application/pdf;base64,AAAA', 'certificate.pdf')).toBe(true);
    expect(isAllowedInlineAttachmentDataUrl(
      'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,AAAA',
      'ledger.xlsx',
    )).toBe(true);
    expect(isAllowedInlineAttachmentDataUrl('data:application/octet-stream;base64,AAAA', 'scan.pdf')).toBe(true);
    expect(isAllowedInlineAttachmentDataUrl('data:text/plain;base64,YSxiCg==', 'ledger.csv')).toBe(true);
    expect(isAllowedInlineAttachmentDataUrl('data:text/html;base64,PHNjcmlwdD4=', 'invoice.pdf')).toBe(false);
    expect(attachmentMimeTypeMatchesInlineDataUrl('data:application/octet-stream;base64,AAAA', 'application/pdf', 'scan.pdf')).toBe(true);
    expect(attachmentMimeTypeMatchesInlineDataUrl('data:text/plain;base64,YSxiCg==', 'text/csv', 'ledger.csv')).toBe(true);
    expect(attachmentMimeTypeMatchesInlineDataUrl('data:image/png;base64,AAAA', 'application/pdf', 'certificate.pdf')).toBe(false);

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
    })).toThrow(/does not match/i);

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
      fileName: 'metadata.pdf',
      storage: { kind: 'metadata_only' },
    })).toBeNull();
  });
});

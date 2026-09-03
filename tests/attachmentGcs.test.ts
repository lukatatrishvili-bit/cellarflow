import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createDocumentAttachmentRecord,
  getAttachmentAccess,
  isValidAttachmentObjectKey,
} from '../lib/attachments';
import {
  contentTypeForKey,
  decodeDataUrl,
  deleteAttachmentObject,
  getAttachmentObject,
  putAttachmentObject,
} from '../server/attachmentStore';

// Point the local attachment store at a throwaway dir (no GCS_BUCKET in tests
// → local backend). localAttachmentRoot reads DATABASE_PATH at call time.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-att-'));
const priorDbPath = process.env.DATABASE_PATH;
beforeAll(() => { process.env.DATABASE_PATH = path.join(tmpRoot, 'db.json'); });
afterAll(() => {
  if (priorDbPath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = priorDbPath;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

const pdfDataUrl = (body: string) => 'data:application/pdf;base64,' + Buffer.from(`%PDF-1.4 ${body}`).toString('base64');

describe('attachment object keys', () => {
  it('accepts "<orgId>/<file>" and rejects traversal / bad shapes', () => {
    expect(isValidAttachmentObjectKey('org_abc/att-1.pdf')).toBe(true);
    expect(isValidAttachmentObjectKey('org_abc/../etc/passwd')).toBe(false);
    expect(isValidAttachmentObjectKey('org_abc')).toBe(false);          // no slash
    expect(isValidAttachmentObjectKey('a/b/c')).toBe(false);            // extra slash
    expect(isValidAttachmentObjectKey('org abc/x.pdf')).toBe(false);    // space
    expect(isValidAttachmentObjectKey('')).toBe(false);
  });
});

describe('gcs attachment records', () => {
  it('creates a gcs record that carries only the object key (no bytes)', () => {
    const rec = createDocumentAttachmentRecord({
      fileName: 'cert.pdf',
      mimeType: 'application/pdf',
      module: 'certification',
      storage: { kind: 'gcs', objectKey: 'org_1/att-9.pdf' },
    });
    expect(rec.storage.kind).toBe('gcs');
    expect(rec.storage.objectKey).toBe('org_1/att-9.pdf');
    expect(rec.storage.dataUrl).toBeUndefined();
  });

  it('rejects a gcs record without a valid object key', () => {
    expect(() => createDocumentAttachmentRecord({
      fileName: 'cert.pdf', mimeType: 'application/pdf', module: 'certification',
      storage: { kind: 'gcs' },
    })).toThrow(/object key/i);
  });

  it('serves a gcs attachment through the org-scoped endpoint URL', () => {
    const access = getAttachmentAccess({ fileName: 'cert.pdf', storage: { kind: 'gcs', objectKey: 'org_1/att-9.pdf' } });
    expect(access?.href).toBe('/api/attachments/object/org_1/att-9.pdf');
    expect(access?.external).toBe(false);
    expect(access?.download).toBe('cert.pdf');
  });
});

describe('attachment object store (local backend)', () => {
  it('decodes data URLs and maps keys to content types', () => {
    const { mime, bytes } = decodeDataUrl(pdfDataUrl('hello'));
    expect(mime).toBe('application/pdf');
    expect(bytes.toString()).toContain('%PDF-1.4 hello');
    expect(contentTypeForKey('org_1/x.pdf')).toBe('application/pdf');
    expect(contentTypeForKey('org_1/x.png')).toBe('image/png');
    expect(contentTypeForKey('org_1/x.unknown')).toBe('application/octet-stream');
  });

  it('round-trips put → get → delete and never stores bytes in state', async () => {
    const stored = await putAttachmentObject('org_test', 'att-round', 'pdf', pdfDataUrl('round-trip'));
    expect(stored.objectKey).toBe('org_test/att-round.pdf');
    expect(stored.sizeBytes).toBeGreaterThan(0);
    expect(stored.checksum).toMatch(/^[a-f0-9]{64}$/);

    const got = await getAttachmentObject(stored.objectKey);
    expect(got).not.toBeNull();
    expect(got!.contentType).toBe('application/pdf');
    expect(got!.bytes.toString()).toContain('%PDF-1.4 round-trip');

    await deleteAttachmentObject(stored.objectKey);
    expect(await getAttachmentObject(stored.objectKey)).toBeNull();
  });

  it('returns null for invalid or unknown keys', async () => {
    expect(await getAttachmentObject('bad key')).toBeNull();
    expect(await getAttachmentObject('org_test/missing.pdf')).toBeNull();
  });
});

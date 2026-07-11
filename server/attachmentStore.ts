import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { isValidAttachmentObjectKey } from '../lib/attachments';

/**
 * Object storage for document attachment BYTES, kept out of the org JSONB state.
 *
 * Inline attachments bloat the whole-org blob that is re-serialized on every
 * sync; here the bytes live as individual objects (GCS when GCS_BUCKET is set,
 * otherwise a local data/attachments directory for dev) and the org state holds
 * only a validated object key. Object key format: "<orgId>/<attachmentId>.<ext>"
 * — the org prefix is what the serve endpoint authorizes against.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUCKET = (process.env.GCS_BUCKET || '').trim();
const GCS_PREFIX = 'attachments';

export const attachmentStoreBackend: 'gcs' | 'local' = BUCKET ? 'gcs' : 'local';

function localAttachmentRoot(): string {
  const base = process.env.DATABASE_PATH
    ? path.dirname(path.resolve(process.env.DATABASE_PATH))
    : path.resolve(__dirname, '..');
  return path.join(base, 'attachments');
}

/** Resolve a validated object key to an absolute local path, never escaping root. */
function localPathFor(objectKey: string): string {
  const root = localAttachmentRoot();
  const resolved = path.resolve(root, objectKey);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Attachment path escaped the storage root.');
  }
  return resolved;
}

let storage: any = null;
async function gcsBucket() {
  if (!storage) {
    const { Storage } = await import('@google-cloud/storage');
    storage = new Storage();
  }
  return storage.bucket(BUCKET);
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

export function contentTypeForKey(objectKey: string): string {
  const ext = (objectKey.split('.').pop() || '').toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
}

/** Parse a `data:<mime>;base64,<payload>` URL into bytes (base64 or percent-encoded). */
export function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid data URL.');
  const mime = (match[1] || 'application/octet-stream').toLowerCase();
  const bytes = match[2]
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'utf8');
  return { mime, bytes };
}

export interface StoredAttachment {
  objectKey: string;
  sizeBytes: number;
  checksum: string;
}

export async function putAttachmentObject(
  orgId: string,
  attachmentId: string,
  ext: string,
  dataUrl: string,
): Promise<StoredAttachment> {
  const cleanExt = String(ext).toLowerCase().replace(/[^a-z0-9]/g, '');
  const objectKey = `${orgId}/${attachmentId}.${cleanExt}`;
  if (!isValidAttachmentObjectKey(objectKey)) throw new Error('Could not build a valid object key.');

  const { bytes } = decodeDataUrl(dataUrl);
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');

  if (attachmentStoreBackend === 'gcs') {
    await (await gcsBucket())
      .file(`${GCS_PREFIX}/${objectKey}`)
      .save(bytes, { contentType: contentTypeForKey(objectKey), resumable: false });
  } else {
    const target = localPathFor(objectKey);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  return { objectKey, sizeBytes: bytes.length, checksum };
}

export async function getAttachmentObject(
  objectKey: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!isValidAttachmentObjectKey(objectKey)) return null;
  const contentType = contentTypeForKey(objectKey);
  try {
    if (attachmentStoreBackend === 'gcs') {
      const file = (await gcsBucket()).file(`${GCS_PREFIX}/${objectKey}`);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [buf] = await file.download();
      return { bytes: buf, contentType };
    }
    const target = localPathFor(objectKey);
    if (!fs.existsSync(target)) return null;
    return { bytes: fs.readFileSync(target), contentType };
  } catch {
    return null;
  }
}

export async function deleteAttachmentObject(objectKey: string): Promise<void> {
  if (!isValidAttachmentObjectKey(objectKey)) return;
  try {
    if (attachmentStoreBackend === 'gcs') {
      await (await gcsBucket()).file(`${GCS_PREFIX}/${objectKey}`).delete({ ignoreNotFound: true });
    } else {
      const target = localPathFor(objectKey);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
  } catch {
    /* best-effort cleanup — a stray object is harmless */
  }
}

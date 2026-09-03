import express from 'express';
import { checkWineryScope } from '../middleware/auth';
import {
  attachmentExtension,
  attachmentMimeTypeMatchesInlineDataUrl,
  attachmentUploadPreflightError,
  createDocumentAttachmentRecord,
  isAllowedInlineAttachmentDataUrl,
  isValidAttachmentObjectKey,
  normalizeAttachmentFileName,
  normalizeAttachmentMimeType,
} from '../../lib/attachments';
import {
  attachmentStoreBackend,
  contentTypeForKey,
  getAttachmentObject,
  putAttachmentObject,
} from '../attachmentStore';

const router = express.Router();

// Cap a single upload's decoded size. The global JSON body limit (5mb) bounds
// the base64 data URL; this is the decoded-byte ceiling for one object.
const MAX_UPLOAD_BYTES = 3_500_000;

function newAttachmentObjectId(): string {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// POST /api/attachments/upload — store bytes in object storage (not the JSONB
// blob) and return a ready-to-sync attachment record with kind 'gcs'.
router.post('/upload', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  const orgId = String(session.organizationId || '');
  if (!isValidAttachmentObjectKey(`${orgId}/x.pdf`)) {
    return res.status(400).json({ error: 'Organization id is not usable for object storage.' });
  }

  const body = req.body || {};
  const fileName = normalizeAttachmentFileName(body.fileName);
  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
  const mimeType = normalizeAttachmentMimeType(body.mimeType);
  const sizeBytes = Number(body.sizeBytes);

  if (!fileName) return res.status(400).json({ error: 'A safe file name is required.' });

  const preflight = attachmentUploadPreflightError(
    { name: fileName, size: Number.isFinite(sizeBytes) ? sizeBytes : 0, type: mimeType },
    MAX_UPLOAD_BYTES,
  );
  if (preflight) return res.status(400).json({ error: preflight });

  if (!isAllowedInlineAttachmentDataUrl(dataUrl, fileName)) {
    return res.status(400).json({ error: 'Upload requires a supported PDF, image, Office, or CSV data URL.' });
  }
  if (!attachmentMimeTypeMatchesInlineDataUrl(dataUrl, mimeType, fileName)) {
    return res.status(400).json({ error: 'Declared MIME type does not match the uploaded content.' });
  }

  try {
    const attachmentObjectId = newAttachmentObjectId();
    const ext = attachmentExtension(fileName);
    const stored = await putAttachmentObject(orgId, attachmentObjectId, ext, dataUrl);
    if (stored.sizeBytes > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'Uploaded file is too large.' });
    }

    // Build the record the client will add to state and sync. No bytes here —
    // only the object key — so the sync payload stays tiny.
    const attachment = createDocumentAttachmentRecord({
      fileName,
      mimeType,
      sizeBytes: stored.sizeBytes,
      module: body.module,
      linkedRecordType: typeof body.linkedRecordType === 'string' ? body.linkedRecordType : undefined,
      linkedRecordId: typeof body.linkedRecordId === 'string' ? body.linkedRecordId : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      uploadedBy: session.username,
      checksum: stored.checksum,
      storage: { kind: 'gcs', objectKey: stored.objectKey },
    });

    return res.status(201).json({ ok: true, backend: attachmentStoreBackend, attachment });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Attachment upload failed.' });
  }
});

// GET /api/attachments/object/<orgId>/<file> — stream a stored object, scoped to
// the caller's organization (the object key must live under their org prefix).
// RegExp route: Express 5 params do not span the '/' inside the key.
router.get(/^\/object\/(.+)$/, checkWineryScope('read'), async (req, res) => {
  const session = (req as any).wineryContext;
  const raw = (req.params as any)[0] as string;
  const objectKey = raw.split('/').map((seg) => {
    try { return decodeURIComponent(seg); } catch { return seg; }
  }).join('/');

  if (!isValidAttachmentObjectKey(objectKey)) {
    return res.status(400).json({ error: 'Invalid attachment key.' });
  }
  if (!objectKey.startsWith(`${session.organizationId}/`)) {
    return res.status(403).json({ error: 'Attachment does not belong to this organization.' });
  }

  const object = await getAttachmentObject(objectKey);
  if (!object) return res.status(404).json({ error: 'Attachment not found.' });

  res.setHeader('Content-Type', object.contentType || contentTypeForKey(objectKey));
  res.setHeader('Content-Length', String(object.bytes.length));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Non-inline content types download; images/PDF may preview inline.
  const disposition = /^(image\/|application\/pdf)/.test(object.contentType) ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${objectKey.split('/').pop()}"`);
  return res.status(200).end(object.bytes);
});

export default router;

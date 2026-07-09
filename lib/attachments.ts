import type {
  DocumentAttachment,
  DocumentAttachmentModule,
  DocumentAttachmentStorageKind,
} from './wineryState';
import { sha256Hex } from './auditHash';

export const MAX_INLINE_ATTACHMENT_BYTES = 2_500_000;
// Total inline attachment bytes allowed per organization. Inline attachments
// live in the whole-org JSONB blob that is fully serialized on every sync and
// written to a single GCS object, so unbounded growth degrades every sync and
// eventually exceeds the request body limit. Beyond this budget, large files
// must use `external` (HTTPS link) or `metadata_only` storage instead.
export const MAX_TOTAL_INLINE_ATTACHMENT_BYTES = 25_000_000;

/** Sum the stored bytes of all inline attachments (external/metadata cost ~0). */
export function sumInlineAttachmentBytes(
  attachments: ReadonlyArray<Pick<DocumentAttachment, 'sizeBytes' | 'storage'>> | undefined,
): number {
  if (!Array.isArray(attachments)) return 0;
  let total = 0;
  for (const a of attachments) {
    if (a?.storage?.kind !== 'inline') continue;
    const declared = Number(a.sizeBytes);
    if (Number.isFinite(declared) && declared > 0) {
      total += declared;
    } else if (typeof a.storage.dataUrl === 'string') {
      total += a.storage.dataUrl.length; // conservative fallback (base64 chars)
    }
  }
  return total;
}
const ATTACHMENT_CHECKSUM_RE = /^[a-f0-9]{64}$/;
const INLINE_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
]);
const INLINE_ATTACHMENT_EXTENSIONS = new Set([
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
]);

export interface DocumentAttachmentInput {
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  module: DocumentAttachmentModule;
  linkedRecordType?: string;
  linkedRecordId?: string;
  description?: string;
  storage?: {
    kind?: DocumentAttachmentStorageKind;
    dataUrl?: string;
    url?: string;
  };
  checksum?: string;
  uploadedAt?: string;
  uploadedBy?: string;
}

export interface DocumentAttachmentAccess {
  href: string;
  label: 'Download' | 'Open';
  download?: string;
  external: boolean;
}

const MODULES: DocumentAttachmentModule[] = [
  'company',
  'official_docs',
  'certification',
  'cadastre',
  'qvevri',
  'lab',
  'vineyard_project',
  'crm',
  'other',
];

function slug(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48) || 'attachment';
}

export function isKnownAttachmentModule(module: unknown): module is DocumentAttachmentModule {
  return typeof module === 'string' && MODULES.includes(module as DocumentAttachmentModule);
}

export function checksumAttachmentDataUrl(dataUrl: string): string {
  return sha256Hex(dataUrl);
}

export function isValidAttachmentChecksum(checksum: unknown): checksum is string {
  return typeof checksum === 'string' && ATTACHMENT_CHECKSUM_RE.test(checksum.toLowerCase());
}

export function formatAttachmentSize(sizeBytes?: number): string {
  if (!Number.isFinite(sizeBytes || 0) || !sizeBytes) return 'unknown size';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentExtension(fileName?: string): string {
  const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

export function isSupportedAttachmentFileName(fileName: unknown): boolean {
  return INLINE_ATTACHMENT_EXTENSIONS.has(attachmentExtension(String(fileName || '')));
}

export function normalizeAttachmentMimeType(mimeType: unknown): string | undefined {
  if (typeof mimeType !== 'string') return undefined;
  const normalized = mimeType.split(';')[0].trim().toLowerCase();
  return normalized || undefined;
}

export function isSupportedAttachmentMimeType(mimeType: unknown, fileName?: string): boolean {
  const normalized = normalizeAttachmentMimeType(mimeType);
  if (!normalized) return true;
  if (INLINE_ATTACHMENT_MIME_TYPES.has(normalized)) return true;
  if (!isSupportedAttachmentFileName(fileName)) return false;
  if (normalized === 'application/octet-stream') return true;
  if (normalized === 'text/plain' && attachmentExtension(fileName) === 'csv') return true;
  return false;
}

export function inlineAttachmentMediaType(dataUrl: unknown): string | null {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;,]*)(?:;[^,]*)?,/i);
  if (!match) return null;
  return (match[1] || '').trim().toLowerCase() || null;
}

export function attachmentMimeTypeMatchesInlineDataUrl(
  dataUrl: unknown,
  mimeType: unknown,
  fileName?: string,
): boolean {
  const declared = normalizeAttachmentMimeType(mimeType);
  if (!declared) return true;
  if (!isSupportedAttachmentMimeType(declared, fileName)) return false;

  const actual = inlineAttachmentMediaType(dataUrl);
  if (!actual) return false;
  if (declared === actual) return true;

  const extension = attachmentExtension(fileName);
  if ((declared === 'application/octet-stream' || actual === 'application/octet-stream')
    && isSupportedAttachmentFileName(fileName)) {
    return true;
  }
  if (extension === 'csv') {
    const csvLike = new Set(['text/plain', 'text/csv', 'application/csv']);
    return csvLike.has(declared) && csvLike.has(actual);
  }
  return false;
}

export function isAllowedInlineAttachmentDataUrl(
  dataUrl: unknown,
  fileName?: string,
): boolean {
  const mediaType = inlineAttachmentMediaType(dataUrl);
  if (!mediaType) return false;
  if (INLINE_ATTACHMENT_MIME_TYPES.has(mediaType)) return true;
  const extension = attachmentExtension(fileName);
  if (!isSupportedAttachmentFileName(fileName)) return false;
  if (mediaType === 'application/octet-stream') return true;
  if (mediaType === 'text/plain' && extension === 'csv') return true;
  return false;
}

export function normalizeExternalAttachmentUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url);
    // HTTPS only: http:// links are mixed-content-blocked on the (HTTPS) app
    // and a downgrade risk, so they are never a valid external attachment.
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getAttachmentAccess(
  attachment: Pick<DocumentAttachment, 'fileName' | 'storage'>,
): DocumentAttachmentAccess | null {
  if (attachment.storage.kind === 'inline' && attachment.storage.dataUrl?.startsWith('data:')) {
    return {
      href: attachment.storage.dataUrl,
      label: 'Download',
      download: attachment.fileName,
      external: false,
    };
  }

  if (attachment.storage.kind === 'external' && attachment.storage.url) {
    const href = normalizeExternalAttachmentUrl(attachment.storage.url);
    if (!href) return null;
    return {
      href,
      label: 'Open',
      external: true,
    };
  }

  return null;
}

export function createDocumentAttachmentRecord(input: DocumentAttachmentInput): DocumentAttachment {
  const uploadedAt = input.uploadedAt || new Date().toISOString();
  const storage = input.storage || {};
  const kind = storage.kind || (storage.dataUrl ? 'inline' : storage.url ? 'external' : 'metadata_only');

  if (!input.fileName.trim()) {
    throw new Error('Attachment requires a file name.');
  }
  if (!isSupportedAttachmentFileName(input.fileName)) {
    throw new Error('Attachment file type is not supported.');
  }
  if (!isKnownAttachmentModule(input.module)) {
    throw new Error(`Unknown attachment module: ${input.module}`);
  }
  if (input.sizeBytes !== undefined && (input.sizeBytes < 0 || !Number.isFinite(input.sizeBytes))) {
    throw new Error('Attachment size must be a non-negative number.');
  }
  const normalizedMimeType = normalizeAttachmentMimeType(input.mimeType);
  if (!isSupportedAttachmentMimeType(normalizedMimeType, input.fileName)) {
    throw new Error('Attachment MIME type is not supported.');
  }
  if (kind === 'inline' && !isAllowedInlineAttachmentDataUrl(storage.dataUrl, input.fileName)) {
    throw new Error('Inline attachment requires a supported PDF, image, Office, or CSV data URL.');
  }
  if (kind === 'inline' && !attachmentMimeTypeMatchesInlineDataUrl(storage.dataUrl, normalizedMimeType, input.fileName)) {
    throw new Error('Attachment MIME type does not match inline data.');
  }
  if (kind === 'inline' && (input.sizeBytes || 0) > MAX_INLINE_ATTACHMENT_BYTES) {
    throw new Error(`Inline attachment is too large (${formatAttachmentSize(input.sizeBytes)}).`);
  }
  const externalUrl = kind === 'external' ? normalizeExternalAttachmentUrl(storage.url) : null;
  if (kind === 'external' && !externalUrl) {
    throw new Error('External attachment requires a valid HTTPS URL.');
  }
  if (input.checksum !== undefined && !isValidAttachmentChecksum(input.checksum)) {
    throw new Error('Attachment checksum must be a SHA-256 hex digest.');
  }

  const expectedInlineChecksum = kind === 'inline' && storage.dataUrl
    ? checksumAttachmentDataUrl(storage.dataUrl)
    : undefined;
  if (expectedInlineChecksum && input.checksum && input.checksum.toLowerCase() !== expectedInlineChecksum) {
    throw new Error('Attachment checksum does not match inline data.');
  }

  const checksum = input.checksum ? input.checksum.toLowerCase() : expectedInlineChecksum;

  return {
    id: `att-${Date.parse(uploadedAt) || Date.now()}-${slug(input.fileName)}`,
    fileName: input.fileName.trim(),
    mimeType: normalizedMimeType,
    sizeBytes: input.sizeBytes,
    uploadedAt,
    uploadedBy: input.uploadedBy,
    module: input.module,
    linkedRecordType: input.linkedRecordType,
    linkedRecordId: input.linkedRecordId,
    description: input.description,
    storage: {
      kind,
      dataUrl: kind === 'inline' ? storage.dataUrl : undefined,
      url: kind === 'external' ? externalUrl ?? undefined : undefined,
    },
    checksum,
  };
}

export function attachmentsForRecord(
  attachments: DocumentAttachment[],
  linkedRecordType: string,
  linkedRecordId?: string,
): DocumentAttachment[] {
  return attachments
    .filter(attachment => attachment.linkedRecordType === linkedRecordType)
    .filter(attachment => !linkedRecordId || attachment.linkedRecordId === linkedRecordId)
    .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
}

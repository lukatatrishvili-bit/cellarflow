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
export const MAX_ATTACHMENT_FILENAME_CHARS = 180;
export const SUPPORTED_ATTACHMENT_EXTENSIONS = [
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
] as const;
export const SUPPORTED_ATTACHMENT_ACCEPT = SUPPORTED_ATTACHMENT_EXTENSIONS.map(extension => `.${extension}`).join(',');

/** Sum the stored bytes of all inline attachments (external/metadata cost ~0). */
export function sumInlineAttachmentBytes(
  attachments: ReadonlyArray<Pick<DocumentAttachment, 'sizeBytes' | 'storage'>> | undefined,
): number {
  if (!Array.isArray(attachments)) return 0;
  let total = 0;
  for (const a of attachments) {
    if (a?.storage?.kind !== 'inline') continue;
    const declared = Number(a.sizeBytes);
    const declaredBytes = Number.isFinite(declared) && declared > 0 ? declared : 0;
    const decodedBytes = inlineAttachmentDecodedBytes(a.storage.dataUrl);
    const fallbackBytes = typeof a.storage.dataUrl === 'string' ? a.storage.dataUrl.length : 0;
    total += Math.max(declaredBytes, decodedBytes ?? fallbackBytes);
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
const INLINE_ATTACHMENT_EXTENSIONS = new Set<string>(SUPPORTED_ATTACHMENT_EXTENSIONS);
const WINDOWS_RESERVED_ATTACHMENT_BASENAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ATTACHMENT_MIME_TYPES_BY_EXTENSION: Record<string, Set<string>> = {
  pdf: new Set(['application/pdf']),
  jpg: new Set(['image/jpeg']),
  jpeg: new Set(['image/jpeg']),
  png: new Set(['image/png']),
  doc: new Set(['application/msword']),
  docx: new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  xls: new Set(['application/vnd.ms-excel']),
  xlsx: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  csv: new Set(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel']),
};

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
    objectKey?: string;
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

export interface AttachmentUploadCandidate {
  name: string;
  size: number;
  type?: string;
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
const STORAGE_KINDS: DocumentAttachmentStorageKind[] = ['inline', 'external', 'metadata_only', 'gcs'];
// Object keys are server-generated: "<orgId>/<attachmentId>.<ext>". Validate
// defensively so a crafted key cannot escape the org prefix or traverse paths.
const ATTACHMENT_OBJECT_KEY_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function isValidAttachmentObjectKey(key: unknown): key is string {
  return typeof key === 'string'
    && key.length > 0
    && key.length <= 300
    && ATTACHMENT_OBJECT_KEY_RE.test(key)
    && !key.includes('..');
}

function slug(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48) || 'attachment';
}

function attachmentIdSlug(fileName: string, uploadedAt: string, checksum?: string, sizeBytes?: number): string {
  const digest = sha256Hex(`${uploadedAt}|${fileName}|${checksum || ''}|${sizeBytes ?? ''}`).slice(0, 8);
  return `${slug(fileName)}-${digest}`;
}

export function isKnownAttachmentModule(module: unknown): module is DocumentAttachmentModule {
  return typeof module === 'string' && MODULES.includes(module as DocumentAttachmentModule);
}

export function isKnownAttachmentStorageKind(kind: unknown): kind is DocumentAttachmentStorageKind {
  return typeof kind === 'string' && STORAGE_KINDS.includes(kind as DocumentAttachmentStorageKind);
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

export function supportedAttachmentTypesLabel(): string {
  return 'PDF, JPG/JPEG, PNG, DOC, DOCX, XLS, XLSX, or CSV';
}

export function attachmentExtension(fileName?: string): string {
  const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

export function normalizeAttachmentFileName(fileName: unknown): string | null {
  if (typeof fileName !== 'string') return null;
  const trimmed = fileName.trim();
  if (!trimmed || trimmed.length > MAX_ATTACHMENT_FILENAME_CHARS) return null;
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return null;
  if (/[\\/:*?"<>|]/.test(trimmed)) return null;

  const baseName = trimmed.replace(/\.[^.]+$/, '').trim();
  if (!baseName || baseName === '.' || baseName === '..' || baseName.startsWith('..')) return null;
  if (WINDOWS_RESERVED_ATTACHMENT_BASENAMES.test(baseName.split('.')[0])) return null;
  return trimmed;
}

export function isSupportedAttachmentFileName(fileName: unknown): boolean {
  const normalized = normalizeAttachmentFileName(fileName);
  return Boolean(normalized && INLINE_ATTACHMENT_EXTENSIONS.has(attachmentExtension(normalized)));
}

export function normalizeAttachmentMimeType(mimeType: unknown): string | undefined {
  if (typeof mimeType !== 'string') return undefined;
  const normalized = mimeType.split(';')[0].trim().toLowerCase();
  return normalized || undefined;
}

export function attachmentMimeTypeMatchesFileName(mimeType: unknown, fileName?: string): boolean {
  const normalized = normalizeAttachmentMimeType(mimeType);
  if (!normalized) return true;

  const normalizedFileName = normalizeAttachmentFileName(fileName);
  if (!normalizedFileName || !isSupportedAttachmentFileName(normalizedFileName)) return false;
  if (normalized === 'application/octet-stream') return true;

  const allowedForExtension = ATTACHMENT_MIME_TYPES_BY_EXTENSION[attachmentExtension(normalizedFileName)];
  return Boolean(allowedForExtension?.has(normalized));
}

export function isSupportedAttachmentMimeType(mimeType: unknown, fileName?: string): boolean {
  const normalized = normalizeAttachmentMimeType(mimeType);
  if (!normalized) return true;
  if (!INLINE_ATTACHMENT_MIME_TYPES.has(normalized)
    && normalized !== 'application/octet-stream'
    && normalized !== 'text/plain') {
    return false;
  }
  if (fileName === undefined) return normalized !== 'text/plain';
  return attachmentMimeTypeMatchesFileName(normalized, fileName);
}

function isSupportedInlineAttachmentMediaType(dataUrl: unknown, fileName?: string): boolean {
  const mediaType = inlineAttachmentMediaType(dataUrl);
  if (!mediaType) return false;
  if (inlineAttachmentDecodedBytes(dataUrl) === null) return false;
  if (isSupportedAttachmentMimeType(mediaType, fileName)) return true;

  // Some browsers report CSV files as text/plain even when users selected a
  // .csv file. Keep that compatibility path explicit and extension-bound.
  const normalizedFileName = normalizeAttachmentFileName(fileName);
  if (!normalizedFileName) return false;
  const extension = attachmentExtension(normalizedFileName);
  if (mediaType === 'text/plain' && extension === 'csv') return true;
  return false;
}

export function attachmentUploadPreflightError(
  file: AttachmentUploadCandidate,
  maxInlineBytes = MAX_INLINE_ATTACHMENT_BYTES,
  lang?: string,
): string | null {
  const isKa = lang === 'ka';
  if (!normalizeAttachmentFileName(file.name)) {
    return isKa
      ? 'ფაილის სახელი არ არის უსაფრთხო. წაშალეთ გზის გამყოფები ან საკონტროლო სიმბოლოები.'
      : 'Attachment file name is not safe. Remove path separators or control characters.';
  }
  if (!isSupportedAttachmentFileName(file.name)) {
    return isKa
      ? `ფაილის ტიპი მხარდაჭერილი არ არის. გამოიყენეთ: PDF, JPG/JPEG, PNG, DOC, DOCX, XLS, XLSX, ან CSV.`
      : `Unsupported attachment file type. Use ${supportedAttachmentTypesLabel()}.`;
  }
  if (file.size > maxInlineBytes) {
    return isKa
      ? `ფაილი ძალიან დიდია ლოკალური სინქრონიზაციისთვის (${formatAttachmentSize(file.size)}).`
      : `File is too large for local sync (${formatAttachmentSize(file.size)}).`;
  }
  if (!isSupportedAttachmentMimeType(file.type, file.name)) {
    return isKa
      ? 'მიმაგრებული ფაილის MIME ტიპი მხარდაჭერილი არ არის.'
      : 'Attachment MIME type is not supported.';
  }
  return null;
}

export function inlineAttachmentMediaType(dataUrl: unknown): string | null {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;,]*)(?:;[^,]*)?,/i);
  if (!match) return null;
  return (match[1] || '').trim().toLowerCase() || null;
}

function inlineAttachmentBase64Payload(dataUrl: unknown): string | null {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;,]*)(?:;[^,]*)*;base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (!match) return null;

  const payload = match[2];
  if (payload.length % 4 !== 0) return null;
  if (/=/.test(payload.slice(0, -2))) return null;
  return payload;
}

export function inlineAttachmentDecodedBytes(dataUrl: unknown): number | null {
  const payload = inlineAttachmentBase64Payload(dataUrl);
  if (payload === null) return null;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return (payload.length / 4) * 3 - padding;
}

export function attachmentMimeTypeMatchesInlineDataUrl(
  dataUrl: unknown,
  mimeType: unknown,
  fileName?: string,
): boolean {
  const declared = normalizeAttachmentMimeType(mimeType);
  if (!declared) return isSupportedInlineAttachmentMediaType(dataUrl, fileName);
  if (!isSupportedAttachmentMimeType(declared, fileName)) return false;

  const actual = inlineAttachmentMediaType(dataUrl);
  if (!actual) return false;
  if (inlineAttachmentDecodedBytes(dataUrl) === null) return false;
  if (!isSupportedAttachmentMimeType(actual, fileName)) return false;
  if (declared === actual) return true;

  const extension = attachmentExtension(fileName);
  if (declared === 'application/octet-stream' || actual === 'application/octet-stream') {
    return true;
  }
  if (extension === 'csv') {
    const csvLike = new Set(['text/plain', 'text/csv', 'application/csv', 'application/vnd.ms-excel']);
    return csvLike.has(declared) && csvLike.has(actual);
  }
  return false;
}

export function isAllowedInlineAttachmentDataUrl(
  dataUrl: unknown,
  fileName?: string,
): boolean {
  return isSupportedInlineAttachmentMediaType(dataUrl, fileName);
}

export function normalizeExternalAttachmentUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    // HTTPS only: http:// links are mixed-content-blocked on the (HTTPS) app
    // and a downgrade risk, so they are never a valid external attachment.
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getAttachmentAccess(
  attachment: Pick<DocumentAttachment, 'fileName' | 'storage'>,
): DocumentAttachmentAccess | null {
  const dataUrl = attachment.storage.kind === 'inline' ? attachment.storage.dataUrl : undefined;
  if (typeof dataUrl === 'string' && isAllowedInlineAttachmentDataUrl(dataUrl, attachment.fileName)) {
    return {
      href: dataUrl,
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

  // GCS-backed: bytes are served by the org-scoped attachment endpoint. The
  // object key is path-segment-encoded so slashes in the route are preserved.
  if (attachment.storage.kind === 'gcs' && isValidAttachmentObjectKey(attachment.storage.objectKey)) {
    const encoded = attachment.storage.objectKey!.split('/').map(encodeURIComponent).join('/');
    return {
      href: `/api/attachments/object/${encoded}`,
      label: 'Download',
      download: attachment.fileName,
      external: false,
    };
  }

  return null;
}

export function createDocumentAttachmentRecord(input: DocumentAttachmentInput): DocumentAttachment {
  const uploadedAt = input.uploadedAt || new Date().toISOString();
  const storage = input.storage || {};
  const inferredKind = storage.dataUrl ? 'inline' : storage.url ? 'external' : 'metadata_only';
  const kind = storage.kind || inferredKind;
  const fileName = normalizeAttachmentFileName(input.fileName);

  if (!fileName) {
    throw new Error('Attachment requires a safe file name.');
  }
  if (!isSupportedAttachmentFileName(fileName)) {
    throw new Error('Attachment file type is not supported.');
  }
  if (!isKnownAttachmentModule(input.module)) {
    throw new Error(`Unknown attachment module: ${input.module}`);
  }
  if (!isKnownAttachmentStorageKind(kind)) {
    throw new Error(`Unknown attachment storage kind: ${kind}`);
  }
  if (input.sizeBytes !== undefined && (input.sizeBytes < 0 || !Number.isFinite(input.sizeBytes))) {
    throw new Error('Attachment size must be a non-negative number.');
  }
  const normalizedMimeType = normalizeAttachmentMimeType(input.mimeType);
  if (!isSupportedAttachmentMimeType(normalizedMimeType, fileName)) {
    throw new Error('Attachment MIME type is not supported.');
  }
  if (kind === 'inline' && !isAllowedInlineAttachmentDataUrl(storage.dataUrl, fileName)) {
    throw new Error('Inline attachment requires a supported PDF, image, Office, or CSV data URL.');
  }
  if (kind === 'inline' && !attachmentMimeTypeMatchesInlineDataUrl(storage.dataUrl, normalizedMimeType, fileName)) {
    throw new Error('Attachment MIME type does not match inline data.');
  }
  const decodedInlineBytes = kind === 'inline' ? inlineAttachmentDecodedBytes(storage.dataUrl) : null;
  const inlineBytesForLimit = Math.max(input.sizeBytes || 0, decodedInlineBytes || 0);
  if (kind === 'inline' && inlineBytesForLimit > MAX_INLINE_ATTACHMENT_BYTES) {
    throw new Error(`Inline attachment is too large (${formatAttachmentSize(inlineBytesForLimit)}).`);
  }
  const externalUrl = kind === 'external' ? normalizeExternalAttachmentUrl(storage.url) : null;
  if (kind === 'external' && !externalUrl) {
    throw new Error('External attachment requires a valid HTTPS URL.');
  }
  if (kind === 'gcs' && !isValidAttachmentObjectKey(storage.objectKey)) {
    throw new Error('GCS attachment requires a valid object key.');
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
    id: `att-${Date.parse(uploadedAt) || Date.now()}-${attachmentIdSlug(fileName, uploadedAt, checksum, input.sizeBytes)}`,
    fileName,
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
      objectKey: kind === 'gcs' ? storage.objectKey : undefined,
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

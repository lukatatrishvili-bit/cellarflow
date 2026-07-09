import { isValidAttachmentChecksum } from '../lib/attachments';

interface AnyRecord {
  [key: string]: any;
}

export interface AttachmentSummary {
  count: number;
  linkedCount: number;
  inlineCount: number;
  externalCount: number;
  metadataOnlyCount: number;
  inlineBytes: number;
  checksummedCount: number;
  invalidChecksumCount: number;
  checksumCoveragePct: number;
  byModule: Record<string, number>;
}

export interface CrmLeadSummary {
  count: number;
  activeCount: number;
  customersCount: number;
  byStatus: Record<string, number>;
}

export interface AiDraftSummary {
  count: number;
  reviewOnlyCount: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}

export interface OrgDataSummary {
  dataSizeBytes: number;
  tanksCount: number;
  lotsCount: number;
  certificationRecordsCount: number;
  attachmentsCount: number;
  crmLeadsCount: number;
  aiDraftsCount: number;
  inlineAttachmentBytes: number;
  attachmentChecksumCoveragePct: number;
}

function listFrom(data: AnyRecord | undefined | null, key: string): AnyRecord[] {
  const value = data?.[key];
  return Array.isArray(value) ? value : [];
}

function increment(target: Record<string, number>, key: unknown): void {
  const normalized = String(key || 'unknown').trim() || 'unknown';
  target[normalized] = (target[normalized] || 0) + 1;
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export function summarizeAttachments(dataOrAttachments: AnyRecord | AnyRecord[] | undefined | null): AttachmentSummary {
  const attachments = Array.isArray(dataOrAttachments)
    ? dataOrAttachments
    : listFrom(dataOrAttachments, 'attachments');
  const byModule: Record<string, number> = {};
  let linkedCount = 0;
  let inlineCount = 0;
  let externalCount = 0;
  let metadataOnlyCount = 0;
  let inlineBytes = 0;
  let checksummedCount = 0;
  let invalidChecksumCount = 0;

  for (const attachment of attachments) {
    increment(byModule, attachment?.module);
    if (attachment?.linkedRecordId || attachment?.linkedRecordType) linkedCount += 1;

    const storageKind = attachment?.storage?.kind;
    if (storageKind === 'inline') {
      inlineCount += 1;
      const sizeBytes = Number(attachment?.sizeBytes || 0);
      if (Number.isFinite(sizeBytes) && sizeBytes > 0) inlineBytes += sizeBytes;
    } else if (storageKind === 'external') {
      externalCount += 1;
    } else {
      metadataOnlyCount += 1;
    }

    if (attachment?.checksum) {
      if (isValidAttachmentChecksum(attachment.checksum)) checksummedCount += 1;
      else invalidChecksumCount += 1;
    }
  }

  return {
    count: attachments.length,
    linkedCount,
    inlineCount,
    externalCount,
    metadataOnlyCount,
    inlineBytes,
    checksummedCount,
    invalidChecksumCount,
    checksumCoveragePct: pct(checksummedCount, attachments.length),
    byModule,
  };
}

export function summarizeCrmLeads(dataOrLeads: AnyRecord | AnyRecord[] | undefined | null): CrmLeadSummary {
  const leads = Array.isArray(dataOrLeads) ? dataOrLeads : listFrom(dataOrLeads, 'crmLeads');
  const byStatus: Record<string, number> = {};
  let activeCount = 0;
  let customersCount = 0;

  for (const lead of leads) {
    const status = String(lead?.status || 'unknown');
    increment(byStatus, status);
    if (status !== 'archived') activeCount += 1;
    if (status === 'customer') customersCount += 1;
  }

  return {
    count: leads.length,
    activeCount,
    customersCount,
    byStatus,
  };
}

export function summarizeAiDrafts(dataOrDrafts: AnyRecord | AnyRecord[] | undefined | null): AiDraftSummary {
  const drafts = Array.isArray(dataOrDrafts) ? dataOrDrafts : listFrom(dataOrDrafts, 'aiDrafts');
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let reviewOnlyCount = 0;

  for (const draft of drafts) {
    increment(byStatus, draft?.status);
    increment(byType, draft?.type);
    if (draft?.reviewOnly === true) reviewOnlyCount += 1;
  }

  return {
    count: drafts.length,
    reviewOnlyCount,
    byStatus,
    byType,
  };
}

export function summarizeOrgData(data: AnyRecord | undefined | null): OrgDataSummary {
  const attachmentSummary = summarizeAttachments(data);
  return {
    dataSizeBytes: JSON.stringify(data || {}).length,
    tanksCount: listFrom(data, 'vessels').length,
    lotsCount: listFrom(data, 'lots').length,
    certificationRecordsCount: listFrom(data, 'certificationRecords').length,
    attachmentsCount: attachmentSummary.count,
    crmLeadsCount: listFrom(data, 'crmLeads').length,
    aiDraftsCount: listFrom(data, 'aiDrafts').length,
    inlineAttachmentBytes: attachmentSummary.inlineBytes,
    attachmentChecksumCoveragePct: attachmentSummary.checksumCoveragePct,
  };
}

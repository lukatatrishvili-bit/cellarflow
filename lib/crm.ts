import type { CrmLeadRecord, CrmLeadStatus } from './wineryState';
import type { WineryCrmLead } from './wineryDirectoryImport';

export interface CrmLeadRecordInput extends WineryCrmLead {
  status?: CrmLeadStatus;
  createdAt?: string;
  updatedAt?: string;
  owner?: string;
  lastContactedAt?: string;
}

export function createCrmLeadRecord(input: CrmLeadRecordInput): CrmLeadRecord {
  const now = input.updatedAt || input.createdAt || new Date().toISOString();
  return {
    id: input.id,
    displayName: input.displayName,
    companyName: input.companyName,
    wineryName: input.wineryName,
    region: input.region,
    municipality: input.municipality,
    address: input.address,
    contactEmail: input.contactEmail,
    phone: input.phone,
    website: input.website,
    source: input.source,
    tags: Array.from(new Set(input.tags || [])),
    notes: input.notes || '',
    status: input.status || 'new',
    createdAt: input.createdAt || now,
    updatedAt: now,
    owner: input.owner,
    lastContactedAt: input.lastContactedAt,
  };
}

export function upsertCrmLeadRecord(leads: CrmLeadRecord[], incoming: CrmLeadRecord): CrmLeadRecord[] {
  const existing = leads.find(lead => lead.id === incoming.id);
  if (!existing) return [incoming, ...leads];
  return leads.map(lead => (
    lead.id === incoming.id
      ? {
          ...existing,
          ...incoming,
          createdAt: existing.createdAt,
          status: existing.status === 'archived' ? incoming.status : existing.status,
          notes: incoming.notes || existing.notes,
          tags: Array.from(new Set([...(existing.tags || []), ...(incoming.tags || [])])),
        }
      : lead
  ));
}

export function crmLeadContactLine(lead: Pick<CrmLeadRecord, 'contactEmail' | 'phone' | 'website'>): string {
  return [lead.contactEmail, lead.phone, lead.website].filter(Boolean).join(' / ') || 'No contact details';
}

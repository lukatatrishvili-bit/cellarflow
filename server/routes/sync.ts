import express from 'express';
import { checkWineryScope, setOrganizationStateHeaders } from '../middleware/auth';
import {
  getUserData,
  createEmptyUserData,
  saveUserData,
  saveDB,
  reloadUserOrganizationDataFromPostgres,
  OrganizationStateVersionConflictError,
} from '../db';
import {
  applyDeletions,
  createDeletionMatcher,
  mergeCollections,
  isValidId,
  toClientKey,
  type DeletedRecordRef,
} from '../sync';
import { prepareAuditLogsForServerMerge } from '../../lib/auditHash';
import { syncRecordFingerprint } from '../../lib/deletionTombstones';
import { compareBottlingRunsNewestFirst } from '../../lib/bottlingIntegrity';
import { reservedBottlesFor } from '../../lib/sales';
import {
  attachmentMimeTypeMatchesInlineDataUrl,
  checksumAttachmentDataUrl,
  inlineAttachmentDecodedBytes,
  isAllowedInlineAttachmentDataUrl,
  isSupportedAttachmentMimeType,
  isSupportedAttachmentFileName,
  isValidAttachmentChecksum,
  isValidAttachmentObjectKey,
  MAX_INLINE_ATTACHMENT_BYTES,
  MAX_TOTAL_INLINE_ATTACHMENT_BYTES,
  normalizeAttachmentFileName,
  normalizeAttachmentMimeType,
  normalizeExternalAttachmentUrl,
  sumInlineAttachmentBytes,
} from '../../lib/attachments';
import {
  can,
  canAccess,
  canSyncCollection,
  moduleForAttachmentKind,
  moduleForSyncCollection,
  type PermissionAction,
  type PermissionModule,
} from '../permissions';
import { assessFootprintPressure, measureStateFootprint } from '../../lib/retention';
import { recordSyncOperationalMetric } from '../operationalTelemetry';
import { organizationHasFeature, recordProductionUsage } from '../billing/service';

const router = express.Router();

/**
 * Byte ceiling for a whole-state sync body.
 *
 * This is the FIRST limit a growing workspace meets — it binds long before the
 * record ceilings below, because the body parser rejects on wire bytes while
 * those count entities. It is deliberately the same 5 MB the global parser
 * uses; the point of naming it here is that `/api/sync` mounts its own parser
 * so an over-limit body produces a structured, actionable 413 instead of the
 * body parser's raw HTML error (which the client could only surface as a bare
 * "Sync rejected (HTTP 413)").
 *
 * Keep it aligned with the Cloud Run memory allocation: the raw body, its
 * parsed object graph, and the merged candidate document are all resident at
 * once during a sync.
 */
export const MAX_SYNC_BODY_BYTES = 5_000_000;

export const MAX_SYNC_RECORDS_PER_COLLECTION = 20_000;
export const MAX_SYNC_TOTAL_RECORDS = 75_000;
export const MAX_SYNC_TOMBSTONES = 20_000;

/**
 * Convert the body parser's `entity.too.large` into the same structured shape
 * the in-route limit errors use, so `lib/syncQueue` can read `code`/`error`
 * from JSON rather than failing `res.json()` on an HTML error page.
 *
 * The offline path is what makes this matter: attachments are added inline and
 * only offloaded to object storage once a request succeeds, so a tablet that
 * spends a day offline can accumulate several inline blobs and then breach the
 * ceiling on its first reconnect — precisely when a silent failure is worst.
 */
export function syncBodyLimitErrorHandler(
  err: any,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (err?.type !== 'entity.too.large') return next(err);
  const capMb = (MAX_SYNC_BODY_BYTES / 1_000_000).toFixed(0);
  return res.status(413).json({
    code: 'sync_payload_too_large',
    error: `This workspace's pending changes exceed the ${capMb} MB sync limit. Large files attached while offline are the usual cause: stay connected so attachments upload to file storage, or remove them and re-attach as an external link. No changes were lost — they remain on this device for retry.`,
  });
}

export class SyncPayloadLimitError extends Error {
  constructor(
    public readonly code: 'sync_payload_invalid' | 'sync_collection_record_limit_exceeded' | 'sync_total_record_limit_exceeded' | 'sync_tombstone_limit_exceeded',
    message: string,
    public readonly statusCode = 413,
  ) {
    super(message);
    this.name = 'SyncPayloadLimitError';
  }
}

/** Bound whole-state sync work before permission, merge, and conflict processing. */
export function assertSyncPayloadWithinLimits(body: unknown): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SyncPayloadLimitError(
      'sync_payload_invalid',
      'Sync payload must be a JSON object. Local changes were kept.',
      400,
    );
  }
  const payload = body as Record<string, unknown>;
  let totalRecords = 0;
  for (const [collection, value] of Object.entries(payload)) {
    if (!Array.isArray(value)) continue;
    if (collection === 'deletedIds' || collection === 'deletedRecords') {
      if (value.length > MAX_SYNC_TOMBSTONES) {
        throw new SyncPayloadLimitError(
          'sync_tombstone_limit_exceeded',
          `Sync contains ${value.length.toLocaleString()} deletion records; the limit is ${MAX_SYNC_TOMBSTONES.toLocaleString()}. Export or archive old data and retry in smaller maintenance batches. Local changes were kept.`,
        );
      }
      continue;
    }
    if (value.length > MAX_SYNC_RECORDS_PER_COLLECTION) {
      throw new SyncPayloadLimitError(
        'sync_collection_record_limit_exceeded',
        `${collection} contains ${value.length.toLocaleString()} records in one sync; the limit is ${MAX_SYNC_RECORDS_PER_COLLECTION.toLocaleString()}. Export or archive older records before retrying. Local changes were kept.`,
      );
    }
    totalRecords += value.length;
    if (totalRecords > MAX_SYNC_TOTAL_RECORDS) {
      throw new SyncPayloadLimitError(
        'sync_total_record_limit_exceeded',
        `Sync contains more than ${MAX_SYNC_TOTAL_RECORDS.toLocaleString()} records across collections. Export or archive older records before retrying. Local changes were kept.`,
      );
    }
  }
}

function pruneTestUserSeedDuplicates(userDb: any): void {
  const staleHarvestIds = new Set(['HV-SAP-24', 'HV-RK-23']);
  const staleSamplingIds = new Set(['GS-SAP-24', 'GS-RK-23']);

  if (Array.isArray(userDb.harvests)) {
    userDb.harvests = userDb.harvests.filter((item: any) => !staleHarvestIds.has(item?.id));
  }
  if (Array.isArray(userDb.samplings)) {
    userDb.samplings = userDb.samplings.filter((item: any) => !staleSamplingIds.has(item?.id));
  }
}

/**
 * Validate the incoming sync payload against the CURRENT server state (throws
 * on violation). Extracted from the route handler so the merge/save retry loop
 * can re-validate against freshly reloaded state after a version conflict.
 */
export function validateSyncPayload(
  userDb: any,
  collections: Record<string, any>,
  deletedIds: any,
  deletedRecords?: any,
): void {
  {
    // 1. Validate legacy wildcard and collection-scoped tombstones, then block
    // deletions of bottled lots or immutable audit logs.
    if (deletedIds !== undefined) {
      if (!Array.isArray(deletedIds)) {
        throw new Error('deletedIds must be an array');
      }
      for (const id of deletedIds) {
        if (!isValidId(id)) {
          throw new Error(`Invalid deleted ID syntax: ${id}`);
        }
      }
    }
    if (deletedRecords !== undefined) {
      if (!Array.isArray(deletedRecords)) {
        throw new Error('deletedRecords must be an array');
      }
      for (const record of deletedRecords) {
        if (!record || typeof record !== 'object' || !isValidId(record.id)) {
          throw new Error(`Invalid deleted record syntax: ${record?.id}`);
        }
        if (typeof record.collection !== 'string'
          || !moduleForSyncCollection(record.collection)
          || !Array.isArray(userDb?.[record.collection])) {
          throw new Error(`Invalid deleted record collection: ${record.collection}`);
        }
        if (record.baselineTimestamp !== undefined && (
          typeof record.baselineTimestamp !== 'string'
          || record.baselineTimestamp.length > 64
          || !Number.isFinite(Date.parse(record.baselineTimestamp))
        )) {
          throw new Error(`Invalid deletion baseline timestamp for ${record.id}.`);
        }
        if (record.baselineFingerprint !== undefined && (
          typeof record.baselineFingerprint !== 'string'
          || !/^[0-9a-f]{8}$/.test(record.baselineFingerprint)
        )) {
          throw new Error(`Invalid deletion baseline fingerprint for ${record.id}.`);
        }
        if (record.deletedAt !== undefined && (
          typeof record.deletedAt !== 'string'
          || record.deletedAt.length > 64
          || !Number.isFinite(Date.parse(record.deletedAt))
        )) {
          throw new Error(`Invalid deletion capture timestamp for ${record.id}.`);
        }
      }
    }

    const deletionMatcher = createDeletionMatcher(deletedIds, deletedRecords);
    const isDeleted = deletionMatcher.isDeleted;
    for (const lot of Array.isArray(userDb?.lots) ? userDb.lots : []) {
      if (lot?.id && isDeleted('lots', lot.id) && lot.stage === 'bottled') {
        throw new Error(`Volatile Content Lock: Bottled wine lot ${lot.id} cannot be deleted.`);
      }
    }
    for (const audit of Array.isArray(userDb?.auditLogs) ? userDb.auditLogs : []) {
      if (audit?.id && isDeleted('auditLogs', audit.id)) {
        throw new Error(`Audit Immutability: Deletion of audit log ${audit.id} is forbidden.`);
      }
    }
    const mergedCollection = (key: string): any[] => {
      const byId = new Map<string, any>();
      const stored = Array.isArray(userDb?.[key]) ? userDb[key] : [];
      const incoming = Array.isArray(collections?.[key]) ? collections[key] : [];
      for (const item of stored) {
        if (item?.id) byId.set(item.id, item);
      }
      for (const item of incoming) {
        if (item?.id) byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
      }
      return [...byId.values()];
    };
    const effectiveCollection = (key: string): any[] => (
      mergedCollection(key).filter(item => !isDeleted(key, item.id))
    );
    const effectiveRecord = (key: string, id: unknown): any | undefined => (
      typeof id === 'string'
        ? effectiveCollection(key).find(item => item?.id === id)
        : undefined
    );
    const validateMovementParity = (
      kind: 'bottling' | 'bottling_reversal' | 'sale' | 'sale_reversal',
      parent: any,
      movement: any,
    ): void => {
      const label = kind === 'bottling'
        ? 'Bottling'
        : kind === 'bottling_reversal'
          ? 'Bottling Reversal'
          : kind === 'sale' ? 'Sales' : 'Sales Reversal';
      const expectedDirection = kind === 'sale' || kind === 'bottling_reversal' ? 'out' : 'in';
      if (movement.direction !== expectedDirection) {
        throw new Error(`Mismatched ${label} Link: Stock movement ${movement.id} must have direction '${expectedDirection}'.`);
      }
      if (movement.reason !== kind) {
        throw new Error(`Mismatched ${label} Link: Stock movement ${movement.id} must have reason '${kind}'.`);
      }
      if (movement.sourceRef !== parent.id) {
        throw new Error(`Mismatched ${label} Link: Stock movement ${movement.id} must link back to ${parent.id}.`);
      }
      if (movement.lotId !== parent.lotId) {
        throw new Error(`Mismatched ${label} Link: Stock movement ${movement.id} must use lot ${parent.lotId}.`);
      }
      const expectedLocationId = kind === 'bottling' || kind === 'bottling_reversal'
        ? parent.storageLocationId
        : parent.locationId;
      if (expectedLocationId && movement.locationId !== expectedLocationId) {
        throw new Error(`Mismatched ${label} Link: Stock movement ${movement.id} must use location ${expectedLocationId}.`);
      }
      const expectedBottles = kind === 'bottling' || kind === 'bottling_reversal'
        ? parent.placedInStorageBottles
        : parent.bottles;
      if (typeof expectedBottles === 'number' && movement.bottles !== expectedBottles) {
        throw new Error(`Mismatched ${label} Link: Stock movement ${movement.id} must contain ${expectedBottles} bottles.`);
      }
    };
    const validateBottlingReversalParity = (reversal: any): void => {
      if (reversal.recordKind !== 'reversal'
        || !reversal.commandId
        || !isValidId(reversal.reversalOfRunId)
        || !isValidId(reversal.reversalOfCommandId)) {
        throw new Error(`Mismatched Bottling Reversal: correction run ${reversal.id} has incomplete provenance.`);
      }
      const original = effectiveRecord('bottlingRuns', reversal.reversalOfRunId);
      if (!original || original.recordKind === 'reversal'
        || original.commandId !== reversal.reversalOfCommandId
        || original.reversedByCommandId !== reversal.commandId
        || original.reversedAt !== reversal.lastModified
        || original.reversalReason !== reversal.reversalReason
        || typeof reversal.reversalReason !== 'string'
        || !reversal.reversalReason.trim()
        || reversal.reversalReason.length > 500
        || reversal.date !== String(reversal.lastModified).slice(0, 10)
        || original.lotId !== reversal.lotId
        || original.lotName !== reversal.lotName
        || original.lotNumber !== reversal.lotNumber
        || original.totalBottles !== reversal.totalBottles
        || original.totalCeramic !== reversal.totalCeramic
        || original.volumeBottledL !== reversal.volumeBottledL
        || JSON.stringify(original.formats) !== JSON.stringify(reversal.formats)
        || JSON.stringify(original.packagingDeductions || {}) !== JSON.stringify(reversal.packagingDeductions || {})) {
        throw new Error(`Mismatched Bottling Reversal: correction run ${reversal.id} is inconsistent with its original run.`);
      }
      const lot = effectiveRecord('lots', original.lotId);
      if (!lot || lot.currentVolume !== original.previousLotVolumeL
        || lot.stage !== original.previousLotStage
        || lot.lastCommandId !== reversal.commandId
        || lot.lastModified !== reversal.lastModified
        || lot.history?.[0]?.sourceRef !== reversal.id
        || lot.history?.[0]?.type !== 'correction') {
        throw new Error(`Mismatched Bottling Reversal: lot ${original.lotId} was not restored by ${reversal.id}.`);
      }
      const storedReversal = (Array.isArray(userDb?.bottlingRuns) ? userDb.bottlingRuns : [])
        .find((run: any) => run?.id === reversal.id);
      if (!storedReversal) {
        for (const [inventoryId, quantity] of Object.entries(original.packagingDeductions || {})) {
          const before = (Array.isArray(userDb?.inventory) ? userDb.inventory : [])
            .find((entry: any) => entry?.id === inventoryId);
          const restored = effectiveRecord('inventory', inventoryId);
          if (!before || !restored || typeof quantity !== 'number'
            || restored.stock !== before.stock + quantity
            || restored.lastCommandId !== reversal.commandId
            || restored.lastModified !== reversal.lastModified) {
            throw new Error(`Mismatched Bottling Reversal: packaging material ${inventoryId} was not restored.`);
          }
        }
      }
      const originalCosts = effectiveCollection('costEntries').filter((entry: any) => (
        entry?.sourceRef === original.id && entry.recordKind !== 'reversal'
      ));
      const reversalCosts = effectiveCollection('costEntries').filter((entry: any) => (
        entry?.recordKind === 'reversal' && entry.reversalOfCommandId === original.commandId
          && entry.sourceRef === reversal.id
      ));
      if (originalCosts.length !== reversalCosts.length) {
        throw new Error(`Mismatched Bottling Reversal: cost ledger for ${reversal.id} is incomplete.`);
      }
      for (const originalCost of originalCosts) {
        const correction = reversalCosts.find((entry: any) => entry.reversalOfCostEntryId === originalCost.id);
        if (!correction || correction.commandId !== reversal.commandId
          || correction.lastModified !== reversal.lastModified
          || correction.lotId !== originalCost.lotId
          || correction.category !== originalCost.category
          || correction.currency !== originalCost.currency
          || correction.amount !== -Math.abs(originalCost.amount)
          || originalCost.reversedByCommandId !== reversal.commandId
          || originalCost.reversedAt !== reversal.lastModified
          || originalCost.reversalReason !== reversal.reversalReason) {
          throw new Error(`Mismatched Bottling Reversal: cost correction for ${originalCost.id} is invalid.`);
        }
      }
      if (original.storageMovementId) {
        const movement = effectiveRecord('stockMovements', reversal.storageMovementId);
        const originalMovement = effectiveRecord('stockMovements', original.storageMovementId);
        if (!movement || !originalMovement
          || movement.reversalOfMovementId !== originalMovement.id
          || movement.reversalOfCommandId !== original.commandId
          || movement.commandId !== reversal.commandId
          || movement.lastModified !== reversal.lastModified) {
          throw new Error(`Mismatched Bottling Reversal: storage correction for ${reversal.id} is invalid.`);
        }
        validateMovementParity('bottling_reversal', reversal, movement);
      } else if (reversal.storageMovementId || reversal.storageLocationId || reversal.placedInStorageBottles) {
        throw new Error(`Mismatched Bottling Reversal: ${reversal.id} has an unexpected storage correction.`);
      }
    };
    const validateCellarOperationReversalParity = (reversal: any): void => {
      if (reversal.recordKind !== 'reversal'
        || !reversal.commandId
        || !isValidId(reversal.reversalOfOperationId)
        || !isValidId(reversal.reversalOfCommandId)
        || reversal.type !== 'correction') {
        throw new Error(`Mismatched Cellar Operation Reversal: correction ${reversal.id} has incomplete provenance.`);
      }
      const original = effectiveRecord('cellarOps', reversal.reversalOfOperationId);
      const snapshot = original?.reversalSnapshot;
      if (!original || original.recordKind === 'reversal'
        || original.commandId !== reversal.reversalOfCommandId
        || original.reversedByCommandId !== reversal.commandId
        || original.reversedAt !== reversal.lastModified
        || original.reversalReason !== reversal.reversalReason
        || !snapshot || ![1, 2].includes(snapshot.version)
        || typeof reversal.reversalReason !== 'string'
        || !reversal.reversalReason.trim()
        || reversal.reversalReason.length > 500
        || reversal.date !== String(reversal.lastModified).slice(0, 10)
        || reversal.lotId !== original.lotId
        || reversal.lotName !== original.lotName
        || reversal.vesselId !== original.vesselId
        || reversal.vesselToId !== original.vesselToId
        || reversal.materialId !== original.materialId
        || reversal.materialName !== original.materialName
        || reversal.dose !== original.dose
        || reversal.unit !== original.unit
        || JSON.stringify(reversal.materials || []) !== JSON.stringify(original.materials || [])
        || reversal.volumeBeforeL !== (original.volumeAfterL ?? snapshot.lot?.currentVolume)
        || reversal.volumeAfterL !== snapshot.lot?.currentVolume) {
        throw new Error(`Mismatched Cellar Operation Reversal: correction ${reversal.id} is inconsistent with its original operation.`);
      }
      const lot = effectiveRecord('lots', original.lotId);
      if (!lot || lot.currentVolume !== snapshot.lot.currentVolume
        || lot.stage !== snapshot.lot.stage
        || lot.lastCommandId !== reversal.commandId
        || lot.lastModified !== reversal.lastModified
        || lot.history?.[0]?.sourceRef !== reversal.id
        || lot.history?.[0]?.type !== 'correction') {
        throw new Error(`Mismatched Cellar Operation Reversal: lot ${original.lotId} was not restored by ${reversal.id}.`);
      }
      if (snapshot.vessel) {
        const vessel = effectiveRecord('vessels', snapshot.vessel.id);
        if (!vessel || vessel.currentVolume !== snapshot.vessel.currentVolume
          || vessel.lastOperation !== snapshot.vessel.lastOperation
          || vessel.lastCommandId !== reversal.commandId
          || vessel.lastModified !== reversal.lastModified) {
          throw new Error(`Mismatched Cellar Operation Reversal: vessel ${snapshot.vessel.id} was not restored.`);
        }
      } else if (original.vesselId) {
        throw new Error(`Mismatched Cellar Operation Reversal: vessel snapshot for ${original.id} is missing.`);
      }
      const inventorySnapshots = snapshot.version === 2
        ? snapshot.inventory
        : snapshot.inventory ? [snapshot.inventory] : [];
      const originalMaterialUsages = Array.isArray(original.materials) && original.materials.length
        ? original.materials
        : original.materialId && original.dose
          ? [{ materialId: original.materialId, quantity: original.dose }]
          : [];
      if (!Array.isArray(inventorySnapshots)
        || inventorySnapshots.length !== originalMaterialUsages.length) {
        throw new Error(`Mismatched Cellar Operation Reversal: inventory snapshots for ${original.id} are incomplete.`);
      }
      for (const inventorySnapshot of inventorySnapshots) {
        const material = effectiveRecord('inventory', inventorySnapshot.id);
        if (!material || material.stock !== inventorySnapshot.stock
          || material.lastCommandId !== reversal.commandId
          || material.lastModified !== reversal.lastModified) {
          throw new Error(`Mismatched Cellar Operation Reversal: material ${inventorySnapshot.id} was not restored.`);
        }
      }
      const originalCosts = effectiveCollection('costEntries').filter((entry: any) => (
        entry?.sourceRef === original.id && entry.recordKind !== 'reversal'
      ));
      const reversalCosts = effectiveCollection('costEntries').filter((entry: any) => (
        entry?.recordKind === 'reversal' && entry.reversalOfCommandId === original.commandId
          && entry.sourceRef === reversal.id
      ));
      const costSnapshots = snapshot.version === 2
        ? snapshot.costEntries
        : snapshot.costEntry ? [snapshot.costEntry] : [];
      const expectedCostCount = Array.isArray(costSnapshots) ? costSnapshots.length : -1;
      if (originalCosts.length !== expectedCostCount || reversalCosts.length !== expectedCostCount) {
        throw new Error(`Mismatched Cellar Operation Reversal: cost ledger for ${reversal.id} is incomplete.`);
      }
      for (const costSnapshot of costSnapshots) {
        const originalCost = originalCosts.find((entry: any) => entry.id === costSnapshot.id);
        const correction = reversalCosts.find((entry: any) => entry.reversalOfCostEntryId === costSnapshot.id);
        if (!originalCost || !correction
          || originalCost.amount !== costSnapshot.amount
          || originalCost.currency !== costSnapshot.currency
          || correction.reversalOfCostEntryId !== originalCost.id
          || correction.commandId !== reversal.commandId
          || correction.lastModified !== reversal.lastModified
          || correction.lotId !== originalCost.lotId
          || correction.category !== originalCost.category
          || correction.currency !== originalCost.currency
          || correction.amount !== -Math.abs(originalCost.amount)
          || originalCost.reversedByCommandId !== reversal.commandId
          || originalCost.reversedAt !== reversal.lastModified
          || originalCost.reversalReason !== reversal.reversalReason) {
          throw new Error(`Mismatched Cellar Operation Reversal: cost correction for ${costSnapshot.id} is invalid.`);
        }
      }
      const originalAudit = effectiveRecord('auditLogs', snapshot.auditId);
      const correctionAudits = effectiveCollection('auditLogs').filter((audit: any) => (
        audit?.commandId === reversal.commandId
      ));
      if (!originalAudit || originalAudit.commandId !== original.commandId
        || correctionAudits.length !== 1
        || correctionAudits[0].lastModified !== reversal.lastModified
        || correctionAudits[0].changedItem !== `Lot ${original.lotId}`
        || !String(correctionAudits[0].actionType || '').startsWith('Cellar Operation Reversal:')) {
        throw new Error(`Mismatched Cellar Operation Reversal: signed audit evidence for ${reversal.id} is incomplete.`);
      }
    };
    const validateHarvestIntakeReversalParity = (reversal: any): void => {
      if (reversal.recordKind !== 'reversal' || !reversal.commandId
        || !isValidId(reversal.reversalOfIntakeId)
        || !isValidId(reversal.reversalOfCommandId)) {
        throw new Error(`Mismatched Harvest Intake Reversal: correction ${reversal.id} has incomplete provenance.`);
      }
      const original = effectiveRecord('grapeIntakes', reversal.reversalOfIntakeId);
      const snapshot = original?.reversalSnapshot;
      if (!original || original.recordKind === 'reversal'
        || original.commandId !== reversal.reversalOfCommandId
        || original.reversedByCommandId !== reversal.commandId
        || original.reversedAt !== reversal.lastModified
        || original.reversalReason !== reversal.reversalReason
        || !snapshot || snapshot.version !== 1
        || typeof reversal.reversalReason !== 'string' || !reversal.reversalReason.trim()
        || reversal.reversalReason.length > 500
        || reversal.date !== String(reversal.lastModified).slice(0, 10)
        || reversal.createdLotId !== original.createdLotId
        || reversal.netWeightKg !== original.netWeightKg
        || reversal.estimatedVolumeL !== original.estimatedVolumeL
        || reversal.source !== original.source
        || reversal.variety !== original.variety) {
        throw new Error(`Mismatched Harvest Intake Reversal: correction ${reversal.id} is inconsistent with its original intake.`);
      }
      const lot = effectiveRecord('lots', original.createdLotId);
      if (!lot || lot.currentVolume !== 0 || !lot.voidedAt
        || lot.voidedAt !== reversal.lastModified
        || lot.voidedByCommandId !== reversal.commandId
        || lot.voidReason !== reversal.reversalReason
        || lot.lastCommandId !== reversal.commandId
        || lot.lastModified !== reversal.lastModified
        || lot.history?.[0]?.sourceRef !== reversal.id
        || lot.history?.[0]?.type !== 'Grape Intake Reversal') {
        throw new Error(`Mismatched Harvest Intake Reversal: lot ${original.createdLotId} was not voided by ${reversal.id}.`);
      }
      if (snapshot.harvest) {
        const harvest = effectiveRecord('harvests', snapshot.harvest.id);
        if (!harvest || harvest.sentToGvino !== snapshot.harvest.sentToGvino
          || (harvest.actualHarvestedKg ?? null) !== snapshot.harvest.actualHarvestedKg
          || (harvest.actualHarvestDate ?? null) !== snapshot.harvest.actualHarvestDate
          || (harvest.associatedLotId ?? null) !== snapshot.harvest.associatedLotId
          || harvest.lastCommandId !== reversal.commandId
          || harvest.lastModified !== reversal.lastModified) {
          throw new Error(`Mismatched Harvest Intake Reversal: harvest ${snapshot.harvest.id} was not restored.`);
        }
      }
      if (snapshot.vessel) {
        const vessel = effectiveRecord('vessels', snapshot.vessel.id);
        if (!vessel || vessel.currentVolume !== snapshot.vessel.currentVolume
          || (vessel.assignedLotId ?? null) !== snapshot.vessel.assignedLotId
          || vessel.temperature !== snapshot.vessel.temperature
          || vessel.lastOperation !== snapshot.vessel.lastOperation
          || vessel.lastCommandId !== reversal.commandId
          || vessel.lastModified !== reversal.lastModified) {
          throw new Error(`Mismatched Harvest Intake Reversal: vessel ${snapshot.vessel.id} was not restored.`);
        }
      }
      const originalCosts = effectiveCollection('costEntries').filter((entry: any) => (
        entry?.sourceRef === original.id && entry.recordKind !== 'reversal'
      ));
      const reversalCosts = effectiveCollection('costEntries').filter((entry: any) => (
        entry?.recordKind === 'reversal' && entry.reversalOfCommandId === original.commandId
          && entry.sourceRef === reversal.id
      ));
      const expectedCostCount = snapshot.costEntry ? 1 : 0;
      if (originalCosts.length !== expectedCostCount || reversalCosts.length !== expectedCostCount) {
        throw new Error(`Mismatched Harvest Intake Reversal: cost ledger for ${reversal.id} is incomplete.`);
      }
      if (snapshot.costEntry) {
        const originalCost = originalCosts[0];
        const correction = reversalCosts[0];
        if (originalCost.id !== snapshot.costEntry.id
          || correction.reversalOfCostEntryId !== originalCost.id
          || correction.commandId !== reversal.commandId
          || correction.lastModified !== reversal.lastModified
          || correction.amount !== -Math.abs(originalCost.amount)
          || originalCost.reversedByCommandId !== reversal.commandId
          || originalCost.reversedAt !== reversal.lastModified) {
          throw new Error(`Mismatched Harvest Intake Reversal: cost correction for ${originalCost.id} is invalid.`);
        }
      }
      const originalAudit = effectiveRecord('auditLogs', snapshot.auditId);
      const correctionAudits = effectiveCollection('auditLogs').filter((audit: any) => audit?.commandId === reversal.commandId);
      if (!originalAudit || originalAudit.commandId !== original.commandId
        || correctionAudits.length !== 1
        || correctionAudits[0].lastModified !== reversal.lastModified
        || correctionAudits[0].changedItem !== `WineLot ${original.createdLotId}`
        || correctionAudits[0].actionType !== 'Grape Receiving Reversal') {
        throw new Error(`Mismatched Harvest Intake Reversal: signed audit evidence for ${reversal.id} is incomplete.`);
      }
    };
    const validateFermentationCompletionReversalParity = (reversal: any): void => {
      if (reversal.recordKind !== 'reversal' || !reversal.commandId
        || !isValidId(reversal.reversalOfLogId)
        || !isValidId(reversal.reversalOfCommandId)) {
        throw new Error(`Mismatched Fermentation Completion Reversal: correction ${reversal.id} has incomplete provenance.`);
      }
      const original = effectiveRecord('fermlogs', reversal.reversalOfLogId);
      const snapshot = original?.completionSnapshot;
      if (!original || original.recordKind !== 'completion' || original.isCompletion !== true
        || original.commandId !== reversal.reversalOfCommandId
        || original.reversedByCommandId !== reversal.commandId
        || original.reversedAt !== reversal.lastModified
        || original.reversalReason !== reversal.reversalReason
        || !snapshot || snapshot.version !== 1
        || typeof reversal.reversalReason !== 'string' || !reversal.reversalReason.trim()
        || reversal.reversalReason.length > 500
        || reversal.date !== String(reversal.lastModified).slice(0, 10)
        || reversal.lotId !== original.lotId || reversal.tankId !== original.tankId
        || reversal.temperature !== original.temperature || reversal.density !== original.density
        || reversal.sugar !== original.sugar || reversal.ph !== original.ph
        || reversal.isCompletion !== false) {
        throw new Error(`Mismatched Fermentation Completion Reversal: correction ${reversal.id} is inconsistent with its original reading.`);
      }
      const storedReversal = (Array.isArray(userDb?.fermlogs) ? userDb.fermlogs : [])
        .find((log: any) => log?.id === reversal.id);
      if (!storedReversal) {
        const lot = effectiveRecord('lots', original.lotId);
        if (!lot || lot.stage !== snapshot.lot?.stage
          || lot.currentVolume !== snapshot.lot?.currentVolume
          || lot.lastCommandId !== reversal.commandId
          || lot.lastModified !== reversal.lastModified
          || lot.history?.[0]?.sourceRef !== reversal.id
          || lot.history?.[0]?.type !== 'correction') {
          throw new Error(`Mismatched Fermentation Completion Reversal: lot ${original.lotId} was not reopened by ${reversal.id}.`);
        }
        const vessel = effectiveRecord('vessels', original.tankId);
        if (!vessel || vessel.id !== snapshot.vessel?.id
          || vessel.currentVolume !== snapshot.vessel.currentVolume
          || (vessel.assignedLotId ?? null) !== snapshot.vessel.assignedLotId
          || vessel.lastOperation !== snapshot.vessel.lastOperation
          || vessel.lastCommandId !== reversal.commandId
          || vessel.lastModified !== reversal.lastModified) {
          throw new Error(`Mismatched Fermentation Completion Reversal: vessel ${original.tankId} was not restored.`);
        }
      }
      const originalAudit = effectiveRecord('auditLogs', snapshot.auditId);
      const correctionAudits = effectiveCollection('auditLogs').filter((audit: any) => audit?.commandId === reversal.commandId);
      if (!originalAudit || originalAudit.commandId !== original.commandId
        || correctionAudits.length !== 1
        || correctionAudits[0].lastModified !== reversal.lastModified
        || correctionAudits[0].changedItem !== `WineLot ${original.lotId}`
        || correctionAudits[0].actionType !== 'Fermentation Completion Reversal') {
        throw new Error(`Mismatched Fermentation Completion Reversal: signed audit evidence for ${reversal.id} is incomplete.`);
      }
    };
    const validateSalesReversalParity = (reversal: any, returnMovement: any): void => {
      if (reversal.recordKind !== 'reversal'
        || !reversal.commandId
        || !isValidId(reversal.reversalOfDispatchId)
        || !isValidId(reversal.reversalOfCommandId)) {
        throw new Error(`Mismatched Sales Reversal: correction dispatch ${reversal.id} has incomplete provenance.`);
      }
      const original = effectiveRecord('salesDispatches', reversal.reversalOfDispatchId);
      if (!original || original.recordKind === 'reversal' || original.commandId !== reversal.reversalOfCommandId) {
        throw new Error(`Mismatched Sales Reversal: correction dispatch ${reversal.id} has no matching original dispatch.`);
      }
      const originalMovement = effectiveRecord('stockMovements', original.stockMovementId);
      if (!originalMovement
        || returnMovement.reversalOfMovementId !== originalMovement.id
        || returnMovement.reversalOfCommandId !== original.commandId
        || returnMovement.commandId !== reversal.commandId
        || returnMovement.lastModified !== reversal.lastModified
        || returnMovement.date !== reversal.date
        || original.reversedByCommandId !== reversal.commandId
        || original.reversedAt !== reversal.lastModified
        || original.reversalReason !== reversal.reversalReason
        || typeof reversal.reversalReason !== 'string'
        || !reversal.reversalReason.trim()
        || reversal.reversalReason.length > 500
        || reversal.date !== String(reversal.lastModified).slice(0, 10)
        || original.lotId !== reversal.lotId
        || original.locationId !== reversal.locationId
        || original.bottles !== reversal.bottles
        || original.customerName !== reversal.customerName
        || original.pricePerBottle !== reversal.pricePerBottle
        || original.currency !== reversal.currency
        || original.revenue !== reversal.revenue
        || original.costPerBottle !== reversal.costPerBottle
        || original.cogs !== reversal.cogs
        || original.grossProfit !== reversal.grossProfit
        || original.marginPct !== reversal.marginPct
        || originalMovement.direction !== 'out'
        || originalMovement.reason !== 'sale'
        || originalMovement.sourceRef !== original.id
        || originalMovement.lotId !== original.lotId
        || originalMovement.locationId !== original.locationId
        || originalMovement.bottles !== original.bottles
        || (originalMovement.commandId !== undefined && originalMovement.commandId !== original.commandId)) {
        throw new Error(`Mismatched Sales Reversal: correction dispatch ${reversal.id} is inconsistent with its original sale.`);
      }
      validateMovementParity('sale_reversal', reversal, returnMovement);
    };
    const validateStoragePlacementParity = (
      run: any,
      placement: any,
      movement: any,
    ): void => {
      if (movement.direction !== 'in' || movement.reason !== 'receive') {
        throw new Error('Mismatched Storage Placement: Stock movement ' + movement.id + ' must be an inbound receive.');
      }
      if (movement.sourceRef !== run.id || movement.lotId !== run.lotId) {
        throw new Error('Mismatched Storage Placement: Stock movement ' + movement.id + ' must link to its bottling run and lot.');
      }
      if (placement.movementId !== movement.id
        || placement.locationId !== movement.locationId
        || placement.bottles !== movement.bottles
        || placement.date !== movement.date) {
        throw new Error('Mismatched Storage Placement: Bottling run ' + run.id + ' does not match stock movement ' + movement.id + '.');
      }
      if (placement.commandId && movement.commandId !== placement.commandId) {
        throw new Error('Mismatched Storage Placement: Stock movement ' + movement.id + ' has a different command id.');
      }
    };

    const effectiveCellarOperations = effectiveCollection('cellarOps');
    for (const operation of effectiveCellarOperations) {
      if (operation.recordKind === 'reversal') {
        validateCellarOperationReversalParity(operation);
      } else if (operation.reversedByCommandId || operation.reversedAt || operation.reversalReason) {
        const correction = effectiveCellarOperations.find(item => (
          item?.recordKind === 'reversal' && item.reversalOfOperationId === operation.id
        ));
        if (!correction) {
          throw new Error(`Mismatched Cellar Operation Reversal: original operation ${operation.id} has no correction.`);
        }
      }
    }

    const effectiveGrapeIntakes = effectiveCollection('grapeIntakes');
    for (const intake of effectiveGrapeIntakes) {
      if (intake.recordKind === 'reversal') {
        validateHarvestIntakeReversalParity(intake);
      } else if (intake.reversedByCommandId || intake.reversedAt || intake.reversalReason) {
        const correction = effectiveGrapeIntakes.find(item => (
          item?.recordKind === 'reversal' && item.reversalOfIntakeId === intake.id
        ));
        if (!correction) {
          throw new Error(`Mismatched Harvest Intake Reversal: original intake ${intake.id} has no correction.`);
        }
      }
    }

    const effectiveFermentationLogs = effectiveCollection('fermlogs');
    for (const log of effectiveFermentationLogs) {
      if (log.recordKind === 'reversal') {
        validateFermentationCompletionReversalParity(log);
      } else if (log.reversedByCommandId || log.reversedAt || log.reversalReason) {
        const correction = effectiveFermentationLogs.find(item => (
          item?.recordKind === 'reversal' && item.reversalOfLogId === log.id
        ));
        if (!correction) {
          throw new Error(`Mismatched Fermentation Completion Reversal: original reading ${log.id} has no correction.`);
        }
      }
    }

    if (deletionMatcher.hasDeletions) {
      const survivingMovements = effectiveCollection('stockMovements');
      const survivingDispatches = effectiveCollection('salesDispatches');
      const survivingOrders = effectiveCollection('salesOrders');
      const survivingBottlingRuns = effectiveCollection('bottlingRuns');
      const survivingCosts = effectiveCollection('costEntries');
      const allBottlingRuns = mergedCollection('bottlingRuns');

      for (const transfer of mergedCollection('transfers')) {
        if (!transfer?.id || !isDeleted('transfers', transfer.id)) continue;
        if (transfer.commandId) {
          throw new Error(`Immutable Transfer Ledger: command-created record ${transfer.id} cannot be deleted.`);
        }
      }

      for (const operation of mergedCollection('cellarOps')) {
        if (!operation?.id || !isDeleted('cellarOps', operation.id)) continue;
        if (operation.commandId) {
          throw new Error(`Immutable Cellar Operation Ledger: command-created record ${operation.id} cannot be deleted.`);
        }
      }

      for (const intake of mergedCollection('grapeIntakes')) {
        if (!intake?.id || !isDeleted('grapeIntakes', intake.id)) continue;
        if (intake.commandId) {
          throw new Error(`Immutable Grape Intake Ledger: command-created record ${intake.id} cannot be deleted.`);
        }
      }

      for (const log of mergedCollection('fermlogs')) {
        if (!log?.id || !isDeleted('fermlogs', log.id)) continue;
        if (log.commandId) {
          throw new Error(`Immutable Fermentation Ledger: command-created record ${log.id} cannot be deleted.`);
        }
      }

      for (const location of mergedCollection('storageLocations')) {
        if (!location?.id || !isDeleted('storageLocations', location.id)) continue;
        const movement = survivingMovements.find(item => item.locationId === location.id);
        if (movement) {
          throw new Error(`Referenced Storage Location: ${location.id} is still used by stock movement ${movement.id}.`);
        }
        const dispatch = survivingDispatches.find(item => item.locationId === location.id);
        if (dispatch) {
          throw new Error(`Referenced Storage Location: ${location.id} is still used by sales dispatch ${dispatch.id}.`);
        }
        const order = survivingOrders.find(item => item.locationId === location.id);
        if (order) {
          throw new Error(`Referenced Storage Location: ${location.id} is still used by sales order ${order.id}.`);
        }
        const bottlingRun = survivingBottlingRuns.find(item => item.storageLocationId === location.id
          || item.storagePlacements?.some((placement: any) => placement.locationId === location.id));
        if (bottlingRun) {
          throw new Error(`Referenced Storage Location: ${location.id} is still used by bottling run ${bottlingRun.id}.`);
        }
      }

      for (const movement of mergedCollection('stockMovements')) {
        if (!movement?.id || !isDeleted('stockMovements', movement.id)) continue;
        if (movement.commandId) {
          throw new Error(`Immutable Stock Ledger: command-created movement ${movement.id} cannot be deleted.`);
        }
        const bottlingRun = survivingBottlingRuns.find(item => (
          item.storageMovementId === movement.id
          || item.storagePlacements?.some((placement: any) => placement.movementId === movement.id)
          || movement.sourceRef === item.id
        ));
        if (bottlingRun) {
          throw new Error(`Referenced Stock Movement: ${movement.id} is still used by bottling run ${bottlingRun.id}.`);
        }
        const dispatch = survivingDispatches.find(item => (
          item.stockMovementId === movement.id || movement.sourceRef === item.id
        ));
        if (dispatch) {
          throw new Error(`Referenced Stock Movement: ${movement.id} is still used by sales dispatch ${dispatch.id}.`);
        }

        const remainingOnHand = survivingMovements.reduce((total, item) => {
          if (item.locationId !== movement.locationId || item.lotId !== movement.lotId) return total;
          return total + (item.direction === 'in' ? item.bottles : -item.bottles);
        }, 0);
        if (remainingOnHand < 0) {
          throw new Error(`Invalid Stock Deletion: removing ${movement.id} would make stock negative for ${movement.lotId} at ${movement.locationId}.`);
        }
        const reserved = reservedBottlesFor(
          survivingOrders,
          movement.locationId,
          movement.lotId,
        );
        if (remainingOnHand < reserved) {
          throw new Error(`Reserved Stock Deletion: removing ${movement.id} would leave ${reserved} reserved bottles without enough stock.`);
        }
      }

      for (const dispatch of mergedCollection('salesDispatches')) {
        if (!dispatch?.id || !isDeleted('salesDispatches', dispatch.id)) continue;
        if (dispatch.commandId) {
          throw new Error(`Immutable Sales Ledger: command-created dispatch ${dispatch.id} cannot be deleted.`);
        }
        const movement = survivingMovements.find(item => (
          item.id === dispatch.stockMovementId || item.sourceRef === dispatch.id
        ));
        if (movement) {
          throw new Error(`Referenced Sales Dispatch: ${dispatch.id} is still used by stock movement ${movement.id}.`);
        }
        const order = survivingOrders.find(item => item.dispatchId === dispatch.id);
        if (order) {
          throw new Error(`Referenced Sales Dispatch: ${dispatch.id} is still used by sales order ${order.id}.`);
        }
      }

      for (const order of mergedCollection('salesOrders')) {
        if (!order?.id || !isDeleted('salesOrders', order.id)) continue;
        if (order.commandId || order.lastCommandId) {
          throw new Error(`Immutable Sales Order Ledger: command-created order ${order.id} cannot be deleted.`);
        }
        const dispatch = survivingDispatches.find(item => item.salesOrderId === order.id);
        if (dispatch) {
          throw new Error(`Referenced Sales Order: ${order.id} is still used by sales dispatch ${dispatch.id}.`);
        }
      }

      for (const run of allBottlingRuns) {
        if (!run?.id || !isDeleted('bottlingRuns', run.id)) continue;
        if (run.commandId) {
          throw new Error(`Immutable Bottling Ledger: command-created run ${run.id} cannot be deleted.`);
        }
        const sameLotRuns = allBottlingRuns
          .map((candidate, index) => ({ candidate, index }))
          .filter(({ candidate }) => candidate?.lotId && candidate.lotId === run.lotId)
          .sort((left, right) => (
            compareBottlingRunsNewestFirst(left.candidate, right.candidate)
            || left.index - right.index
          ));
        const latest = sameLotRuns[0];
        if (latest && latest.candidate.id !== run.id) {
          throw new Error(`Bottling Rollback Order: ${run.id} is not the latest bottling run for lot ${run.lotId}. Roll back ${latest.candidate.id} first.`);
        }
        const restoredLot = mergedCollection('lots').find(item => item?.id === run.lotId);
        if (run.previousLotStage !== undefined && restoredLot?.stage !== run.previousLotStage) {
          throw new Error(`Bottling Rollback Mismatch: lot ${run.lotId} must restore stage ${run.previousLotStage} when deleting ${run.id}.`);
        }
        if (run.previousLotVolumeL !== undefined && restoredLot?.currentVolume !== run.previousLotVolumeL) {
          throw new Error(`Bottling Rollback Mismatch: lot ${run.lotId} must restore volume ${run.previousLotVolumeL} when deleting ${run.id}.`);
        }
        const movement = survivingMovements.find(item => (
          item.id === run.storageMovementId || item.sourceRef === run.id
        ));
        if (movement) {
          throw new Error(`Referenced Bottling Run: ${run.id} is still used by stock movement ${movement.id}.`);
        }
        const cost = survivingCosts.find(item => item.sourceRef === run.id);
        if (cost) {
          throw new Error(`Referenced Bottling Run: ${run.id} is still used by cost entry ${cost.id}.`);
        }
      }

      for (const cost of mergedCollection('costEntries')) {
        if (!cost?.id || !isDeleted('costEntries', cost.id)) continue;
        if (cost.commandId) {
          throw new Error(`Immutable Cost Ledger: command-created entry ${cost.id} cannot be deleted.`);
        }
      }

      for (const receipt of mergedCollection('invoiceReceipts')) {
        if (!receipt?.id || !isDeleted('invoiceReceipts', receipt.id)) continue;
        throw new Error(`Immutable Invoice Receipt Ledger: receipt ${receipt.id} cannot be deleted; post a reversal.`);
      }

      for (const movement of mergedCollection('inventoryMovements')) {
        if (!movement?.id || !isDeleted('inventoryMovements', movement.id)) continue;
        throw new Error(`Immutable Inventory Movement Ledger: movement ${movement.id} cannot be deleted.`);
      }
    }

    const effectiveTransfers = effectiveCollection('transfers');
    for (const transfer of effectiveTransfers) {
      if (transfer.recordKind !== undefined && !['transfer', 'reversal'].includes(transfer.recordKind)) {
        throw new Error(`Transfer ${transfer.id} has invalid recordKind.`);
      }
      if (transfer.recordKind === 'reversal') {
        const original = effectiveTransfers.find(item => item.id === transfer.reversalOfTransferId);
        if (!original
          || original.recordKind === 'reversal'
          || !transfer.commandId
          || transfer.reversalOfCommandId !== original.commandId
          || original.reversedByCommandId !== transfer.commandId
          || original.reversedAt !== transfer.lastModified
          || original.reversalReason !== transfer.reversalReason) {
          throw new Error(`Mismatched Transfer Reversal: correction ${transfer.id} is not paired with its original transfer.`);
        }
      } else if (transfer.reversedByCommandId || transfer.reversedAt || transfer.reversalReason) {
        const reversal = effectiveTransfers.find(item => (
          item.recordKind === 'reversal'
          && item.commandId === transfer.reversedByCommandId
          && item.reversalOfTransferId === transfer.id
        ));
        if (!reversal
          || transfer.reversedAt !== reversal.lastModified
          || transfer.reversalReason !== reversal.reversalReason) {
          throw new Error(`Mismatched Transfer Reversal: original transfer ${transfer.id} has no valid correction record.`);
        }
      }
    }

    // 2. Validate collections syntax and schema integrity
    for (const key of Object.keys(collections)) {
      if (key === 'users') {
        throw new Error('Modifying user credentials via sync is forbidden');
      }
      if (key === 'aiFindings') {
        throw new Error('AI findings are server-owned and cannot be modified via sync');
      }
      if (key === 'companyProfile') {
        const profile = collections[key];
        if (profile && typeof profile === 'object') {
          if (profile.latitude !== undefined && typeof profile.latitude !== 'number') {
            throw new Error('companyProfile latitude must be a number');
          }
          if (profile.longitude !== undefined && typeof profile.longitude !== 'number') {
            throw new Error('companyProfile longitude must be a number');
          }
        }
        continue;
      }
      if (key === 'winePricing') {
        const pricing = collections[key];
        if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) {
          throw new Error('winePricing must be an object keyed by lot ID');
        }
        for (const [lotId, price] of Object.entries(pricing)) {
          if (!isValidId(lotId)) {
            throw new Error(`winePricing has invalid lot ID: ${lotId}`);
          }
          if (typeof price !== 'number' || price < 0) {
            throw new Error(`winePricing for ${lotId} must be a non-negative number`);
          }
        }
        continue;
      }

      const clientList = collections[key];
      if (clientList !== undefined) {
        if (!Array.isArray(clientList)) {
          throw new Error(`Collection ${key} must be an array of objects`);
        }
        const incomingIds = new Set<string>();
        for (const item of clientList) {
          if (!item || typeof item !== 'object') {
            throw new Error(`Items in ${key} must be valid objects`);
          }
          if (!isValidId(item.id)) {
            throw new Error(`Item in ${key} has invalid or missing ID: ${item.id}`);
          }
          if (incomingIds.has(item.id)) {
            throw new Error(`Duplicate ID in ${key}: ${item.id}.`);
          }
          incomingIds.add(item.id);
          if (isDeleted(key, item.id)) {
            throw new Error(`Deleted item ${item.id} cannot be resubmitted in ${key}.`);
          }

          // General Time Invariance / Immutable properties check
          const existingItem = (userDb as any)[key]?.find((x: any) => x.id === item.id);
          if (existingItem) {
            if (item.createdAt !== undefined && item.createdAt !== existingItem.createdAt) {
              throw new Error(`Immortal Field Mutation: createdAt cannot be modified on item ${item.id}.`);
            }
            if (item.originalOwnerId !== undefined && item.originalOwnerId !== existingItem.originalOwnerId) {
              throw new Error(`Immortal Field Mutation: originalOwnerId cannot be modified on item ${item.id}.`);
            }
          }

          // Viticulture log referential integrity check (blockId must exist and not be deleted)
          const hasBlockRef = ['scoutings', 'phenologyLogs', 'sprays', 'soilRecords', 'samplings', 'harvests', 'irrigationLogs', 'fertilizerLogs'].includes(key);
          if (hasBlockRef && item.blockId !== undefined) {
            if (!isValidId(item.blockId)) {
              throw new Error(`Item in ${key} has invalid referenced blockId.`);
            }
            const blockExists = userDb.blocks.some((b: any) => b.id === item.blockId) || (collections.blocks && collections.blocks.some((b: any) => b.id === item.blockId));
            const blockDeleted = isDeleted('blocks', item.blockId);
            if (!blockExists || blockDeleted) {
              throw new Error(`Orphaned Reference: Item in ${key} references non-existent or deleted Block (${item.blockId}).`);
            }
          }

          if (key === 'vessels') {
            const capacity = item.capacity !== undefined ? item.capacity : (existingItem ? existingItem.capacity : undefined);
            const currentVolume = item.currentVolume !== undefined ? item.currentVolume : (existingItem ? existingItem.currentVolume : undefined);
            const assignedLotId = item.assignedLotId !== undefined ? item.assignedLotId : (existingItem ? existingItem.assignedLotId : undefined);

            if (capacity !== undefined) {
              if (typeof capacity !== 'number' || capacity <= 0) {
                throw new Error(`Vessel ${item.id} capacity must be a positive number.`);
              }
            } else {
              throw new Error(`Vessel ${item.id} must have a capacity.`);
            }

            if (currentVolume !== undefined) {
              if (typeof currentVolume !== 'number' || currentVolume < 0) {
                throw new Error(`Vessel ${item.id} volume cannot be negative.`);
              }
              if (currentVolume > capacity) {
                throw new Error(`Capacity Theft: Vessel ${item.id} volume (${currentVolume}) exceeds physical capacity (${capacity}).`);
              }
            }

            if (assignedLotId !== undefined && assignedLotId !== null) {
              if (!isValidId(assignedLotId)) {
                throw new Error(`Vessel ${item.id} has invalid referenced assignedLotId.`);
              }
              const lotExists = userDb.lots.some((l: any) => l.id === assignedLotId) || (collections.lots && collections.lots.some((l: any) => l.id === assignedLotId));
              const lotDeleted = isDeleted('lots', assignedLotId);
              if (!lotExists || lotDeleted) {
                throw new Error(`Orphaned Reference: Vessel ${item.id} references non-existent or deleted Lot (${assignedLotId}).`);
              }

              const lot = userDb.lots.find((l: any) => l.id === assignedLotId) || (collections.lots && collections.lots.find((l: any) => l.id === assignedLotId));
              if (lot && lot.stage === 'bottled') {
                if (existingItem && currentVolume !== undefined && currentVolume < existingItem.currentVolume) {
                  throw new Error(`Volatile Content Lock: Vessel ${item.id} volume containing bottled lot cannot decrease.`);
                }
              }
            }
          }

          else if (key === 'lots') {
            const existingLot = existingItem;
            const currentVolume = item.currentVolume !== undefined ? item.currentVolume : (existingLot ? existingLot.currentVolume : undefined);
            const initialVolume = item.initialVolume !== undefined ? item.initialVolume : (existingLot ? existingLot.initialVolume : undefined);
            const rollbackRun = existingLot?.stage === 'bottled'
              && item.stage !== undefined
              && item.currentVolume !== undefined
              ? mergedCollection('bottlingRuns').find((run: any) => (
                run?.id
                && isDeleted('bottlingRuns', run.id)
                && run.lotId === item.id
                && run.previousLotStage !== undefined
                && run.previousLotVolumeL !== undefined
                && item.stage === run.previousLotStage
                && item.currentVolume === run.previousLotVolumeL
              ))
              : undefined;
            const isExactBottlingRollback = Boolean(rollbackRun);

            if (initialVolume !== undefined && (typeof initialVolume !== 'number' || initialVolume < 0)) {
              throw new Error(`Lot ${item.id} initial volume cannot be negative.`);
            }
            if (currentVolume !== undefined && (typeof currentVolume !== 'number' || currentVolume < 0)) {
              throw new Error(`Lot ${item.id} volume cannot be negative.`);
            }

            if (existingLot && existingLot.stage === 'bottled') {
              if (currentVolume !== undefined && currentVolume < existingLot.currentVolume && !isExactBottlingRollback) {
                throw new Error(`Volatile Content Lock: Bottled wine lot ${item.id} volume cannot decrease.`);
              }
              const frozenFields = ['name', 'vintage', 'variety', 'vineyardBlock', 'region', 'wineClass', 'stage'];
              for (const field of frozenFields) {
                if (item[field] !== undefined && item[field] !== existingLot[field]) {
                  if (field === 'stage' && isExactBottlingRollback) continue;
                  throw new Error(`Volatile Content Lock: Bottled wine lot ${item.id} parameter '${field}' is frozen.`);
                }
              }
            }
            if (item.classification !== undefined && !['PDO', 'PGI', 'table_wine', 'other'].includes(item.classification)) {
              throw new Error(`Lot ${item.id} has invalid classification.`);
            }
            if (item.certificationStatus !== undefined && !['not_started', 'sample_prepared', 'submitted', 'approved', 'rejected', 'expired'].includes(item.certificationStatus)) {
              throw new Error(`Lot ${item.id} has invalid certificationStatus.`);
            }
            if (item.originProofStatus !== undefined && !['missing', 'partial', 'verified'].includes(item.originProofStatus)) {
              throw new Error(`Lot ${item.id} has invalid originProofStatus.`);
            }
            if (item.marketStatus !== undefined && !['local', 'export', 'local_and_export', 'unknown'].includes(item.marketStatus)) {
              throw new Error(`Lot ${item.id} has invalid marketStatus.`);
            }
          }

          else if (key === 'fermlogs') {
            if (item.recordKind !== undefined && !['reading', 'completion', 'reversal'].includes(item.recordKind)) {
              throw new Error(`Fermentation log ${item.id} has invalid recordKind.`);
            }
            if (existingItem?.commandId) {
              const immutableFields = [
                'commandId', 'recordKind', 'tankId', 'lotId', 'date', 'temperature', 'density',
                'sugar', 'ph', 'tastingNotes', 'capManagement', 'additives', 'isCompletion',
                'completedAt', 'completedBy', 'reversalOfLogId', 'reversalOfCommandId',
              ];
              for (const field of immutableFields) {
                if (item[field] !== undefined && item[field] !== existingItem[field]) {
                  throw new Error(`Immutable Fermentation Ledger: ${field} cannot be modified on ${item.id}.`);
                }
              }
              if (item.completionSnapshot !== undefined
                && JSON.stringify(item.completionSnapshot) !== JSON.stringify(existingItem.completionSnapshot)) {
                throw new Error(`Immutable Fermentation Ledger: completionSnapshot cannot be modified on ${item.id}.`);
              }
            }
            if (!isValidId(item.lotId)) {
              throw new Error(`Fermentation log ${item.id} has invalid referenced lotId.`);
            }
            const hasTankRef = item.tankId !== undefined && item.tankId !== null && item.tankId !== '';
            if (hasTankRef && !isValidId(item.tankId)) {
              throw new Error(`Fermentation log ${item.id} has invalid referenced tankId.`);
            }
            const lotExists = (userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId))) &&
                              !isDeleted('lots', item.lotId);
            const tankExists = !hasTankRef || ((userDb.vessels.some((v: any) => v.id === item.tankId) || (collections.vessels && collections.vessels.some((v: any) => v.id === item.tankId))) &&
                               !isDeleted('vessels', item.tankId));
            if (!lotExists || !tankExists) {
              throw new Error(`Orphaned Fermentation: Fermentation log ${item.id} references non-existent or deleted Lot (${item.lotId}) or Vessel (${item.tankId}).`);
            }
            if (item.temperature !== undefined && typeof item.temperature !== 'number') {
              throw new Error(`Fermentation log ${item.id} temperature must be a number`);
            }
            if (item.density !== undefined && (typeof item.density !== 'number' || item.density < 0)) {
              throw new Error(`Fermentation log ${item.id} density cannot be negative`);
            }
            if (item.sugar !== undefined && (typeof item.sugar !== 'number' || item.sugar < 0)) {
              throw new Error(`Fermentation log ${item.id} sugar cannot be negative`);
            }
            if (item.ph !== undefined && (typeof item.ph !== 'number' || item.ph < 0)) {
              throw new Error(`Fermentation log ${item.id} pH cannot be negative`);
            }
          }

          else if (key === 'lablogs') {
            if (!isValidId(item.tankId) || !isValidId(item.lotId)) {
              throw new Error(`Lab analysis ${item.id} has invalid referenced IDs.`);
            }
            const lotExists = (userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId))) &&
                              !isDeleted('lots', item.lotId);
            const tankExists = (userDb.vessels.some((v: any) => v.id === item.tankId) || (collections.vessels && collections.vessels.some((v: any) => v.id === item.tankId))) &&
                               !isDeleted('vessels', item.tankId);
            if (!lotExists || !tankExists) {
              throw new Error(`Orphaned Lab Log: Lab analysis ${item.id} references non-existent or deleted Lot (${item.lotId}) or Vessel (${item.tankId}).`);
            }
            const checkFields = ['alcoholPct', 'volatileAcid', 'freeSo2', 'totalSo2', 'residualSugar', 'ph', 'malicAcid', 'lacticAcid', 'turbidity', 'titratableAcidity'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Lab analysis ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'inventory') {
            if (item.stock !== undefined && (typeof item.stock !== 'number' || item.stock < 0)) {
              throw new Error(`Inventory item ${item.id} stock cannot be negative.`);
            }
            if (item.minThreshold !== undefined && (typeof item.minThreshold !== 'number' || item.minThreshold < 0)) {
              throw new Error(`Inventory item ${item.id} minThreshold cannot be negative.`);
            }
            if (item.costPerUnit !== undefined && (typeof item.costPerUnit !== 'number' || item.costPerUnit < 0)) {
              throw new Error(`Inventory item ${item.id} costPerUnit cannot be negative.`);
            }
            if (item.costCurrency !== undefined && !['GEL', 'EUR', 'USD'].includes(item.costCurrency)) {
              throw new Error(`Inventory item ${item.id} costCurrency must be GEL, EUR, or USD.`);
            }
            if (item.activeIngredients !== undefined && (
              !Array.isArray(item.activeIngredients)
              || item.activeIngredients.length > 20
              || item.activeIngredients.some((value: unknown) => typeof value !== 'string' || value.length > 240)
            )) {
              throw new Error(`Inventory item ${item.id} activeIngredients is invalid.`);
            }
            for (const sourceField of ['productSourceUrls', 'officialSourceUrls']) {
              const urls = item[sourceField];
              if (urls === undefined) continue;
              if (
                !Array.isArray(urls)
                || urls.length > 20
                || urls.some((url: unknown) => typeof url !== 'string' || url.length > 2_000 || !/^https:\/\//i.test(url))
              ) {
                throw new Error(`Inventory item ${item.id} ${sourceField} is invalid.`);
              }
            }
            if (item.lastInvoiceReceipt !== undefined) {
              const receipt = item.lastInvoiceReceipt;
              if (!receipt || typeof receipt !== 'object') {
                throw new Error(`Inventory item ${item.id} lastInvoiceReceipt is invalid.`);
              }
              for (const field of ['quantity', 'unitCost', 'lineTotal', 'sourceUnitCost', 'sourceLineTotal', 'exchangeRate']) {
                if (
                  receipt[field] !== undefined
                  && (typeof receipt[field] !== 'number' || !Number.isFinite(receipt[field]) || receipt[field] < 0)
                ) {
                  throw new Error(`Inventory item ${item.id} invoice receipt ${field} is invalid.`);
                }
              }
              if (receipt.sourceCurrency !== undefined && !['GEL', 'EUR', 'USD'].includes(receipt.sourceCurrency)) {
                throw new Error(`Inventory item ${item.id} invoice receipt sourceCurrency is invalid.`);
              }
            }
          }

          else if (key === 'invoiceReceipts') {
            if (!existingItem) {
              throw new Error(`Immutable Invoice Receipt Ledger: ${item.id} must be created through an invoice command.`);
            }
            if (syncRecordFingerprint(item) !== syncRecordFingerprint(existingItem)) {
              throw new Error(`Immutable Invoice Receipt Ledger: ${item.id} cannot be modified through sync.`);
            }
          }

          else if (key === 'inventoryMovements') {
            if (!existingItem) {
              throw new Error(`Immutable Inventory Movement Ledger: ${item.id} must be created through an invoice command.`);
            }
            if (syncRecordFingerprint(item) !== syncRecordFingerprint(existingItem)) {
              throw new Error(`Immutable Inventory Movement Ledger: ${item.id} cannot be modified through sync.`);
            }
          }

          else if (key === 'bottlingRuns') {
            const runRecord = { ...(existingItem || {}), ...item };
            if (item.recordKind !== undefined && !['bottling', 'reversal'].includes(item.recordKind)) {
              throw new Error(`Bottling run ${item.id} has invalid recordKind.`);
            }
            if (existingItem?.commandId) {
              const immutableFields = [
                'commandId', 'recordKind', 'createdAt', 'lotId', 'lotName', 'date', 'lotNumber',
                'operator', 'totalBottles', 'totalCeramic', 'volumeBottledL',
                'previousLotVolumeL', 'previousLotStage', 'bottlesPerBox',
                'packagingCostTotal', 'bottlingServiceCost', 'storageLocationId', 'storageMovementId',
                'reversalOfRunId', 'reversalOfCommandId',
              ];
              for (const field of immutableFields) {
                if (item[field] !== undefined && item[field] !== existingItem[field]) {
                  throw new Error(`Immutable Bottling Ledger: ${field} cannot be modified on ${item.id}.`);
                }
              }
              for (const field of ['formats', 'packagingMaterialIds', 'packagingDeductions']) {
                if (item[field] !== undefined
                  && JSON.stringify(item[field]) !== JSON.stringify(existingItem[field])) {
                  throw new Error(`Immutable Bottling Ledger: ${field} cannot be modified on ${item.id}.`);
                }
              }
            }
            if (!isValidId(item.lotId)) {
              throw new Error(`Bottling run ${item.id} has invalid referenced lotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const lotDeleted = isDeleted('lots', item.lotId);
            if (!lotExists || lotDeleted) {
              throw new Error(`Orphaned Bottling Run: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }
            const numericFields = ['totalBottles', 'totalCeramic', 'volumeBottledL', 'previousLotVolumeL', 'bottlesPerBox', 'packagingCostTotal', 'bottlingServiceCost', 'placedInStorageBottles'];
            for (const field of numericFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Bottling run ${item.id} property ${field} must be non-negative.`);
              }
            }
            if (item.formats !== undefined) {
              if (!item.formats || typeof item.formats !== 'object' || Array.isArray(item.formats)) {
                throw new Error(`Bottling run ${item.id} formats must be an object.`);
              }
              for (const [format, count] of Object.entries(item.formats)) {
                if (typeof count !== 'number' || count < 0) {
                  throw new Error(`Bottling run ${item.id} format ${format} count must be non-negative.`);
                }
              }
            }
            if (item.packagingMaterialIds !== undefined) {
              if (!item.packagingMaterialIds || typeof item.packagingMaterialIds !== 'object' || Array.isArray(item.packagingMaterialIds)) {
                throw new Error(`Bottling run ${item.id} packagingMaterialIds must be an object.`);
              }
              for (const [component, materialId] of Object.entries(item.packagingMaterialIds)) {
                if (materialId !== undefined && materialId !== null && materialId !== '') {
                  if (!isValidId(materialId)) {
                    throw new Error(`Bottling run ${item.id} has invalid packaging material for ${component}.`);
                  }
                  const materialExists = userDb.inventory.some((i: any) => i.id === materialId) || (collections.inventory && collections.inventory.some((i: any) => i.id === materialId));
                  const materialDeleted = isDeleted('inventory', materialId);
                  if (!materialExists || materialDeleted) {
                    throw new Error(`Orphaned Bottling Run: ${item.id} references non-existent or deleted packaging material (${materialId}).`);
                  }
                }
              }
            }
            if (item.packagingDeductions !== undefined) {
              if (!item.packagingDeductions || typeof item.packagingDeductions !== 'object' || Array.isArray(item.packagingDeductions)) {
                throw new Error(`Bottling run ${item.id} packagingDeductions must be an object.`);
              }
              for (const [materialId, qty] of Object.entries(item.packagingDeductions)) {
                if (!isValidId(materialId)) {
                  throw new Error(`Bottling run ${item.id} has invalid packaging deduction material ID.`);
                }
                if (typeof qty !== 'number' || qty < 0) {
                  throw new Error(`Bottling run ${item.id} packaging deduction for ${materialId} must be non-negative.`);
                }
              }
            }
            if (item.storageLocationId) {
              if (!isValidId(item.storageLocationId)) {
                throw new Error(`Bottling run ${item.id} has invalid storageLocationId.`);
              }
              const locExists = userDb.storageLocations?.some((l: any) => l.id === item.storageLocationId) || (collections.storageLocations && collections.storageLocations.some((l: any) => l.id === item.storageLocationId));
              const locDeleted = isDeleted('storageLocations', item.storageLocationId);
              if (!locExists || locDeleted) {
                throw new Error(`Orphaned Bottling Run: ${item.id} references non-existent or deleted Storage Location (${item.storageLocationId}).`);
              }
            }
            const storageMovementId = item.storageMovementId !== undefined
              ? item.storageMovementId
              : existingItem?.storageMovementId;
            if (storageMovementId) {
              if (!isValidId(storageMovementId)) {
                throw new Error(`Bottling run ${item.id} has invalid storageMovementId.`);
              }
              const movement = effectiveRecord('stockMovements', storageMovementId);
              if (!movement) {
                throw new Error(`Orphaned Bottling Run: ${item.id} references non-existent or deleted Stock Movement (${storageMovementId}).`);
              }
              validateMovementParity(runRecord.recordKind === 'reversal' ? 'bottling_reversal' : 'bottling', runRecord, movement);
            }
            if (runRecord.storagePlacements !== undefined) {
              if (!Array.isArray(runRecord.storagePlacements) || runRecord.storagePlacements.length > 10_000) {
                throw new Error(`Bottling run ${item.id} storagePlacements must be a bounded array.`);
              }
              const placementMovementIds = new Set<string>();
              let placedUnits = 0;
              for (const placement of runRecord.storagePlacements) {
                if (!placement || typeof placement !== 'object'
                  || !isValidId(placement.movementId)
                  || !isValidId(placement.locationId)
                  || typeof placement.bottles !== 'number'
                  || !Number.isSafeInteger(placement.bottles)
                  || placement.bottles <= 0
                  || typeof placement.date !== 'string') {
                  throw new Error(`Bottling run ${item.id} has an invalid storage placement.`);
                }
                if (placementMovementIds.has(placement.movementId)) {
                  throw new Error(`Bottling run ${item.id} repeats storage movement ${placement.movementId}.`);
                }
                placementMovementIds.add(placement.movementId);
                if (!effectiveRecord('storageLocations', placement.locationId)) {
                  throw new Error(`Orphaned Bottling Run: ${item.id} references non-existent or deleted Storage Location (${placement.locationId}).`);
                }
                const movement = effectiveRecord('stockMovements', placement.movementId);
                if (!movement) {
                  throw new Error(`Orphaned Bottling Run: ${item.id} references non-existent or deleted Stock Movement (${placement.movementId}).`);
                }
                validateStoragePlacementParity(runRecord, placement, movement);
                placedUnits += placement.bottles;
              }
              if (typeof runRecord.placedInStorageBottles === 'number'
                && runRecord.placedInStorageBottles !== placedUnits) {
                throw new Error(`Mismatched Storage Placement: Bottling run ${item.id} placement total is invalid.`);
              }
            }
            if (runRecord.recordKind === 'reversal') {
              if (Array.isArray(runRecord.storagePlacements) && runRecord.storagePlacements.length > 0) {
                throw new Error(`Mismatched Bottling Reversal: ${item.id} cannot contain inbound storage placements.`);
              }
              validateBottlingReversalParity(runRecord);
            }
          }

          else if (key === 'transfers') {
            const numericFields = ['volume', 'loss'];
            for (const field of numericFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Transfer ${item.id} property ${field} must be non-negative.`);
              }
            }
            if (item.sourceId !== undefined && !isValidId(item.sourceId)) {
              throw new Error(`Transfer ${item.id} has invalid sourceId.`);
            }
            if (item.destId !== undefined && !isValidId(item.destId)) {
              throw new Error(`Transfer ${item.id} has invalid destId.`);
            }
            if (item.recordKind !== undefined && !['transfer', 'reversal'].includes(item.recordKind)) {
              throw new Error(`Transfer ${item.id} has invalid recordKind.`);
            }
            if (existingItem?.commandId) {
              const immutableFields = [
                'commandId', 'recordKind', 'sourceId', 'destId', 'volume', 'loss',
                'sourceLotId', 'destinationLotId', 'resultLotId',
                'sourceContributionL', 'destinationContributionL', 'arrivalVolumeL',
                'reversalOfTransferId', 'reversalOfCommandId',
              ];
              for (const field of immutableFields) {
                if (item[field] !== undefined && item[field] !== existingItem[field]) {
                  throw new Error(`Immutable Transfer Ledger: ${field} cannot be modified on ${item.id}.`);
                }
              }
              if (item.reversalSnapshot !== undefined
                && JSON.stringify(item.reversalSnapshot) !== JSON.stringify(existingItem.reversalSnapshot)) {
                throw new Error(`Immutable Transfer Ledger: reversalSnapshot cannot be modified on ${item.id}.`);
              }
            }
          }

          else if (key === 'grapeIntakes') {
            if (item.recordKind !== undefined && !['intake', 'reversal'].includes(item.recordKind)) {
              throw new Error(`Grape intake ${item.id} has invalid recordKind.`);
            }
            if (existingItem?.commandId) {
              const immutableFields = [
                'commandId', 'recordKind', 'date', 'source', 'supplierName', 'supplierIdCode',
                'blockId', 'blockName', 'variety', 'vintage', 'grossWeightKg', 'tareWeightKg',
                'netWeightKg', 'estimatedVolumeL', 'destinationVesselId', 'createdLotId',
                'harvestRecordId', 'operator', 'reversalOfIntakeId', 'reversalOfCommandId',
              ];
              for (const field of immutableFields) {
                if (item[field] !== undefined && item[field] !== existingItem[field]) {
                  throw new Error(`Immutable Grape Intake Ledger: ${field} cannot be modified on ${item.id}.`);
                }
              }
              if (item.reversalSnapshot !== undefined
                && JSON.stringify(item.reversalSnapshot) !== JSON.stringify(existingItem.reversalSnapshot)) {
                throw new Error(`Immutable Grape Intake Ledger: reversalSnapshot cannot be modified on ${item.id}.`);
              }
              if (existingItem.recordKind === 'reversal' || existingItem.reversedByCommandId) {
                for (const field of ['reversedByCommandId', 'reversedAt', 'reversalReason']) {
                  if (item[field] !== undefined && item[field] !== existingItem[field]) {
                    throw new Error(`Immutable Grape Intake Ledger: ${field} cannot be modified on ${item.id}.`);
                  }
                }
              }
            }
            if (!isValidId(item.createdLotId)) {
              throw new Error(`Grape intake ${item.id} has invalid referenced createdLotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.createdLotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.createdLotId));
            const lotDeleted = isDeleted('lots', item.createdLotId);
            if (!lotExists || lotDeleted) {
              throw new Error(`Orphaned Grape Intake: ${item.id} references non-existent or deleted Lot (${item.createdLotId}).`);
            }

            if (item.source !== undefined && !['own', 'supplier'].includes(item.source)) {
              throw new Error(`Grape intake ${item.id} has invalid source.`);
            }
            if (item.condition !== undefined && !['excellent', 'good', 'fair', 'damaged'].includes(item.condition)) {
              throw new Error(`Grape intake ${item.id} has invalid condition.`);
            }
            if (item.pickingMethod !== undefined && !['hand', 'machine'].includes(item.pickingMethod)) {
              throw new Error(`Grape intake ${item.id} has invalid pickingMethod.`);
            }
            const nonNegativeFields = ['grossWeightKg', 'tareWeightKg', 'netWeightKg', 'brix', 'ph', 'titratableAcidity', 'estimatedVolumeL', 'costPerKg', 'totalCost', 'grapePrice'];
            for (const field of nonNegativeFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Grape intake ${item.id} property ${field} must be non-negative.`);
              }
            }
            if (item.juiceYieldPct !== undefined && (typeof item.juiceYieldPct !== 'number' || item.juiceYieldPct < 0 || item.juiceYieldPct > 100)) {
              throw new Error(`Grape intake ${item.id} juiceYieldPct must be between 0 and 100.`);
            }
            if (item.paymentStatus !== undefined && !['not_applicable', 'unpaid', 'partial', 'paid'].includes(item.paymentStatus)) {
              throw new Error(`Grape intake ${item.id} has invalid paymentStatus.`);
            }
            if (item.destinationVesselId) {
              if (!isValidId(item.destinationVesselId)) {
                throw new Error(`Grape intake ${item.id} has invalid destinationVesselId.`);
              }
              const vesselExists = userDb.vessels.some((v: any) => v.id === item.destinationVesselId) || (collections.vessels && collections.vessels.some((v: any) => v.id === item.destinationVesselId));
              const vesselDeleted = isDeleted('vessels', item.destinationVesselId);
              if (!vesselExists || vesselDeleted) {
                throw new Error(`Orphaned Grape Intake: ${item.id} references non-existent or deleted Vessel (${item.destinationVesselId}).`);
              }
            }
            if (item.harvestRecordId) {
              if (!isValidId(item.harvestRecordId)) {
                throw new Error(`Grape intake ${item.id} has invalid harvestRecordId.`);
              }
              const harvestExists = userDb.harvests.some((h: any) => h.id === item.harvestRecordId) || (collections.harvests && collections.harvests.some((h: any) => h.id === item.harvestRecordId));
              const harvestDeleted = isDeleted('harvests', item.harvestRecordId);
              if (!harvestExists || harvestDeleted) {
                throw new Error(`Orphaned Grape Intake: ${item.id} references non-existent or deleted Harvest (${item.harvestRecordId}).`);
              }
            }
          }

          else if (key === 'cellarOps') {
            const operationRecord = { ...(existingItem || {}), ...item };
            if (item.recordKind !== undefined && !['operation', 'reversal'].includes(item.recordKind)) {
              throw new Error(`Cellar operation ${item.id} has invalid recordKind.`);
            }
            if (existingItem?.commandId) {
              const immutableFields = [
                'commandId', 'recordKind', 'date', 'type', 'customLabel', 'lotId', 'lotName',
                'vesselId', 'vesselToId', 'volumeBeforeL', 'volumeAfterL', 'materialId',
                'materialName', 'dose', 'unit', 'operator', 'notes',
                'reversalOfOperationId', 'reversalOfCommandId',
              ];
              for (const field of immutableFields) {
                if (item[field] !== undefined && item[field] !== existingItem[field]) {
                  throw new Error(`Immutable Cellar Operation Ledger: ${field} cannot be modified on ${item.id}.`);
                }
              }
              if (item.reversalSnapshot !== undefined
                && JSON.stringify(item.reversalSnapshot) !== JSON.stringify(existingItem.reversalSnapshot)) {
                throw new Error(`Immutable Cellar Operation Ledger: reversalSnapshot cannot be modified on ${item.id}.`);
              }
              if (item.materials !== undefined
                && JSON.stringify(item.materials) !== JSON.stringify(existingItem.materials)) {
                throw new Error(`Immutable Cellar Operation Ledger: materials cannot be modified on ${item.id}.`);
              }
              if (existingItem.recordKind === 'reversal' || existingItem.reversedByCommandId) {
                for (const field of ['reversedByCommandId', 'reversedAt', 'reversalReason']) {
                  if (item[field] !== undefined && item[field] !== existingItem[field]) {
                    throw new Error(`Immutable Cellar Operation Ledger: ${field} cannot be modified on ${item.id}.`);
                  }
                }
              }
            }
            if (!isValidId(item.lotId)) {
              throw new Error(`Cellar operation ${item.id} has invalid referenced lotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const lotDeleted = isDeleted('lots', item.lotId);
            if (!lotExists || lotDeleted) {
              throw new Error(`Orphaned Cellar Operation: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }

            for (const vesselField of ['vesselId', 'vesselToId']) {
              if (item[vesselField]) {
                if (!isValidId(item[vesselField])) {
                  throw new Error(`Cellar operation ${item.id} has invalid ${vesselField}.`);
                }
                const vesselExists = userDb.vessels.some((v: any) => v.id === item[vesselField]) || (collections.vessels && collections.vessels.some((v: any) => v.id === item[vesselField]));
                const vesselDeleted = isDeleted('vessels', item[vesselField]);
                if (!vesselExists || vesselDeleted) {
                  throw new Error(`Orphaned Cellar Operation: ${item.id} references non-existent or deleted Vessel (${item[vesselField]}).`);
                }
              }
            }

            if (item.materialId) {
              if (!isValidId(item.materialId)) {
                throw new Error(`Cellar operation ${item.id} has invalid materialId.`);
              }
              const materialExists = userDb.inventory.some((i: any) => i.id === item.materialId) || (collections.inventory && collections.inventory.some((i: any) => i.id === item.materialId));
              const materialDeleted = isDeleted('inventory', item.materialId);
              if (!materialExists || materialDeleted) {
                throw new Error(`Orphaned Cellar Operation: ${item.id} references non-existent or deleted inventory material (${item.materialId}).`);
              }
            }

            const nonNegativeFields = ['dose', 'volumeBeforeL', 'volumeAfterL'];
            for (const field of nonNegativeFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Cellar operation ${item.id} property ${field} must be non-negative.`);
              }
            }
            if (item.materials !== undefined) {
              if (!Array.isArray(item.materials) || item.materials.length > 25) {
                throw new Error(`Cellar operation ${item.id} materials must be a bounded array.`);
              }
              const materialIds = new Set<string>();
              for (const usage of item.materials) {
                if (!usage || !isValidId(usage.materialId)
                  || typeof usage.quantity !== 'number'
                  || !Number.isFinite(usage.quantity)
                  || usage.quantity <= 0
                  || (usage.purpose !== undefined
                    && (typeof usage.purpose !== 'string' || usage.purpose.length > 120))) {
                  throw new Error(`Cellar operation ${item.id} has an invalid material usage.`);
                }
                if (materialIds.has(usage.materialId)) {
                  throw new Error(`Cellar operation ${item.id} repeats inventory material ${usage.materialId}.`);
                }
                materialIds.add(usage.materialId);
                const materialExists = userDb.inventory.some((inventoryItem: any) => inventoryItem.id === usage.materialId)
                  || (collections.inventory && collections.inventory.some((inventoryItem: any) => inventoryItem.id === usage.materialId));
                const materialDeleted = isDeleted('inventory', usage.materialId);
                if (!materialExists || materialDeleted) {
                  throw new Error(`Orphaned Cellar Operation: ${item.id} references non-existent or deleted inventory material (${usage.materialId}).`);
                }
              }
            }
            if (operationRecord.recordKind === 'reversal') {
              validateCellarOperationReversalParity(operationRecord);
            }
          }

          else if (key === 'costEntries') {
            const costRecord = { ...(existingItem || {}), ...item };
            if (item.recordKind !== undefined && !['cost', 'reversal'].includes(item.recordKind)) {
              throw new Error(`Cost entry ${item.id} has invalid recordKind.`);
            }
            if (existingItem?.commandId) {
              const immutableFields = [
                'commandId', 'recordKind', 'date', 'lotId', 'category', 'description', 'amount',
                'currency', 'quantity', 'unitCost', 'sourceRef', 'createdBy',
                'reversalOfCostEntryId', 'reversalOfCommandId',
              ];
              for (const field of immutableFields) {
                if (item[field] !== undefined && item[field] !== existingItem[field]) {
                  throw new Error(`Immutable Cost Ledger: ${field} cannot be modified on ${item.id}.`);
                }
              }
            }
            if (!isValidId(item.lotId)) {
              throw new Error(`Cost entry ${item.id} has invalid referenced lotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const lotDeleted = isDeleted('lots', item.lotId);
            if (!lotExists || lotDeleted) {
              throw new Error(`Orphaned Cost Entry: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }
            if (typeof item.amount !== 'number') {
              throw new Error(`Cost entry ${item.id} amount must be a number.`);
            }
            if (item.quantity !== undefined && (typeof item.quantity !== 'number'
              || (item.quantity < 0 && costRecord.recordKind !== 'reversal')
              || (costRecord.recordKind === 'reversal' && item.quantity > 0))) {
              throw new Error(`Cost entry ${item.id} quantity has an invalid sign.`);
            }
            if (item.unitCost !== undefined && (typeof item.unitCost !== 'number' || item.unitCost < 0)) {
              throw new Error(`Cost entry ${item.id} unitCost must be non-negative.`);
            }
            if (costRecord.recordKind === 'reversal') {
              const original = effectiveRecord('costEntries', costRecord.reversalOfCostEntryId);
              const reversalRun = effectiveRecord('bottlingRuns', costRecord.sourceRef);
              const reversalOperation = effectiveRecord('cellarOps', costRecord.sourceRef);
              const reversalIntake = effectiveRecord('grapeIntakes', costRecord.sourceRef);
              const reversalParent = reversalRun?.recordKind === 'reversal'
                ? reversalRun
                : reversalOperation?.recordKind === 'reversal'
                  ? reversalOperation
                  : reversalIntake?.recordKind === 'reversal'
                    ? reversalIntake
                    : undefined;
              if (!(costRecord.amount < 0)
                || !costRecord.commandId
                || !original
                || original.recordKind === 'reversal'
                || original.commandId !== costRecord.reversalOfCommandId
                || original.amount !== Math.abs(costRecord.amount)
                || original.lotId !== costRecord.lotId
                || original.category !== costRecord.category
                || original.currency !== costRecord.currency
                || original.reversedByCommandId !== costRecord.commandId
                || original.reversedAt !== costRecord.lastModified
                || !reversalParent
                || reversalParent.commandId !== costRecord.commandId
                || reversalParent.reversalOfCommandId !== original.commandId) {
                throw new Error(`Mismatched Cost Reversal: correction entry ${item.id} is inconsistent.`);
              }
            }
          }

          else if (key === 'storageLocations') {
            if (item.capacityBottles !== undefined && (typeof item.capacityBottles !== 'number' || item.capacityBottles < 0)) {
              throw new Error(`Storage location ${item.id} capacityBottles must be non-negative.`);
            }
            if (item.targetTempC !== undefined && typeof item.targetTempC !== 'number') {
              throw new Error(`Storage location ${item.id} targetTempC must be a number.`);
            }
            if (item.targetHumidity !== undefined && (typeof item.targetHumidity !== 'number' || item.targetHumidity < 0 || item.targetHumidity > 100)) {
              throw new Error(`Storage location ${item.id} targetHumidity must be between 0 and 100.`);
            }
          }

          else if (key === 'stockMovements') {
            if (existingItem?.commandId) {
              const immutableFields = [
                'commandId', 'date', 'lotId', 'locationId', 'direction', 'bottles',
                'reason', 'sourceRef', 'relatedMovementId', 'reversalOfMovementId',
                'reversalOfCommandId',
              ];
              for (const field of immutableFields) {
                if (item[field] !== undefined && item[field] !== existingItem[field]) {
                  throw new Error(`Immutable Stock Ledger: ${field} cannot be modified on ${item.id}.`);
                }
              }
            }
            if (!isValidId(item.lotId)) {
              throw new Error(`Stock movement ${item.id} has invalid referenced lotId.`);
            }
            if (!isValidId(item.locationId)) {
              throw new Error(`Stock movement ${item.id} has invalid referenced locationId.`);
            }
            const lotExists = effectiveRecord('lots', item.lotId);
            const locExists = effectiveRecord('storageLocations', item.locationId);
            if (!lotExists) {
              throw new Error(`Orphaned Stock Movement: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }
            if (!locExists) {
              throw new Error(`Orphaned Stock Movement: ${item.id} references non-existent or deleted Storage Location (${item.locationId}).`);
            }
            if (!['in', 'out'].includes(item.direction)) {
              throw new Error(`Stock movement ${item.id} has invalid direction.`);
            }
            if (typeof item.bottles !== 'number' || item.bottles < 0) {
              throw new Error(`Stock movement ${item.id} bottles must be non-negative.`);
            }
            const hasStoredBottlingProvenance = (Array.isArray(userDb?.bottlingRuns) ? userDb.bottlingRuns : [])
              .some((run: any) => run?.lotId === item.lotId
                && run.recordKind !== 'reversal' && !run.reversedByCommandId && !run.reversedAt
                && !isDeleted('bottlingRuns', run.id));
            const linkedRun = ['bottling', 'receive'].includes(item.reason)
              ? effectiveRecord('bottlingRuns', item.sourceRef)
              : undefined;
            const hasLinkedSamePayloadProvenance = linkedRun?.lotId === item.lotId;
            if (!['bottled', 'sold'].includes(lotExists.stage)
              && !hasStoredBottlingProvenance
              && !hasLinkedSamePayloadProvenance) {
              throw new Error(`Ineligible Stock Movement: lot ${item.lotId} is not bottled and has no bottling provenance.`);
            }
            if (item.sourceRef !== undefined && item.sourceRef !== null && item.sourceRef !== '' && !isValidId(item.sourceRef)) {
              throw new Error(`Stock movement ${item.id} has invalid sourceRef.`);
            }
            const movementRecord = { ...(existingItem || {}), ...item };
            if (movementRecord.sourceRef && movementRecord.reason === 'bottling') {
              const run = effectiveRecord('bottlingRuns', movementRecord.sourceRef);
              if (!run) {
                throw new Error(`Orphaned Stock Movement: ${item.id} references non-existent or deleted Bottling Run (${movementRecord.sourceRef}).`);
              }
              if (run.storageMovementId && run.storageMovementId !== item.id) {
                throw new Error(`Mismatched Bottling Link: Bottling run ${run.id} points to a different stock movement.`);
              }
              validateMovementParity('bottling', run, movementRecord);
            }
            if (movementRecord.sourceRef && movementRecord.reason === 'receive') {
              const run = effectiveRecord('bottlingRuns', movementRecord.sourceRef);
              if (!run) {
                throw new Error(`Orphaned Stock Movement: ${item.id} references non-existent or deleted Bottling Run (${movementRecord.sourceRef}).`);
              }
              const placement = Array.isArray(run.storagePlacements)
                ? run.storagePlacements.find((entry: any) => entry?.movementId === item.id)
                : undefined;
              if (!placement) {
                throw new Error(`Mismatched Storage Placement: Bottling run ${run.id} does not point to stock movement ${item.id}.`);
              }
              validateStoragePlacementParity(run, placement, movementRecord);
            }
            if (movementRecord.sourceRef && movementRecord.reason === 'sale') {
              const dispatch = effectiveRecord('salesDispatches', movementRecord.sourceRef);
              if (!dispatch) {
                throw new Error(`Orphaned Stock Movement: ${item.id} references non-existent or deleted Sales Dispatch (${movementRecord.sourceRef}).`);
              }
              if (dispatch.stockMovementId && dispatch.stockMovementId !== item.id) {
                throw new Error(`Mismatched Sales Link: Sales dispatch ${dispatch.id} points to a different stock movement.`);
              }
              validateMovementParity('sale', dispatch, movementRecord);
            }
            if (movementRecord.sourceRef && movementRecord.reason === 'sale_reversal') {
              const reversal = effectiveRecord('salesDispatches', movementRecord.sourceRef);
              if (!reversal) {
                throw new Error(`Orphaned Stock Movement: ${item.id} references non-existent or deleted Sales Reversal (${movementRecord.sourceRef}).`);
              }
              if (reversal.stockMovementId !== item.id) {
                throw new Error(`Mismatched Sales Reversal: correction dispatch ${reversal.id} points to a different return movement.`);
              }
              validateSalesReversalParity(reversal, movementRecord);
            }
            if (movementRecord.sourceRef && movementRecord.reason === 'bottling_reversal') {
              const reversal = effectiveRecord('bottlingRuns', movementRecord.sourceRef);
              if (!reversal || reversal.recordKind !== 'reversal'
                || reversal.storageMovementId !== item.id) {
                throw new Error(`Mismatched Bottling Reversal: correction run ${movementRecord.sourceRef} does not point to ${item.id}.`);
              }
              validateBottlingReversalParity(reversal);
            }
            if (movementRecord.sourceRef
              && !['bottling', 'receive', 'sale', 'sale_reversal', 'bottling_reversal'].includes(movementRecord.reason)
              && (effectiveRecord('bottlingRuns', movementRecord.sourceRef)
                || effectiveRecord('salesDispatches', movementRecord.sourceRef))) {
              throw new Error(`Mismatched Stock Movement Link: ${item.id} has an invalid reason for linked source ${movementRecord.sourceRef}.`);
            }
            if (movementRecord.relatedMovementId !== undefined
              && movementRecord.relatedMovementId !== null
              && movementRecord.relatedMovementId !== '') {
              if (!isValidId(movementRecord.relatedMovementId)) {
                throw new Error(`Stock movement ${item.id} has invalid relatedMovementId.`);
              }
              const related = effectiveRecord('stockMovements', movementRecord.relatedMovementId);
              if (!related) {
                throw new Error(`Orphaned Stock Movement: ${item.id} references non-existent or deleted paired movement (${movementRecord.relatedMovementId}).`);
              }
              if (movementRecord.reason !== 'transfer'
                || related.reason !== 'transfer'
                || related.relatedMovementId !== item.id
                || related.direction === movementRecord.direction
                || related.lotId !== movementRecord.lotId
                || related.bottles !== movementRecord.bottles
                || related.date !== movementRecord.date
                || related.locationId === movementRecord.locationId
                || !movementRecord.commandId
                || related.commandId !== movementRecord.commandId
                || movementRecord.sourceRef !== movementRecord.commandId
                || related.sourceRef !== movementRecord.commandId) {
                throw new Error(`Mismatched Storage Relocation: paired movement ${item.id} is inconsistent.`);
              }
            }
          }

          else if (key === 'salesDispatches') {
            if (item.recordKind !== undefined && !['dispatch', 'reversal'].includes(item.recordKind)) {
              throw new Error(`Sales dispatch ${item.id} has invalid recordKind.`);
            }
            if (existingItem?.commandId) {
              const immutableFields = [
                'commandId', 'recordKind', 'date', 'customerName', 'lotId', 'lotName',
                'locationId', 'locationName', 'bottles', 'pricePerBottle', 'currency',
                'revenue', 'costPerBottle', 'cogs', 'grossProfit', 'marginPct',
                'stockMovementId', 'salesOrderId', 'reversalOfDispatchId', 'reversalOfCommandId',
              ];
              for (const field of immutableFields) {
                if (item[field] !== undefined && item[field] !== existingItem[field]) {
                  throw new Error(`Immutable Sales Ledger: ${field} cannot be modified on ${item.id}.`);
                }
              }
              if (existingItem.recordKind === 'reversal' || existingItem.reversedByCommandId) {
                for (const field of ['reversedByCommandId', 'reversedAt', 'reversalReason']) {
                  if (item[field] !== undefined && item[field] !== existingItem[field]) {
                    throw new Error(`Immutable Sales Ledger: ${field} cannot be modified on ${item.id}.`);
                  }
                }
              }
            }
            if (!isValidId(item.lotId)) {
              throw new Error(`Sales dispatch ${item.id} has invalid referenced lotId.`);
            }
            if (!isValidId(item.locationId)) {
              throw new Error(`Sales dispatch ${item.id} has invalid referenced locationId.`);
            }
            const lotExists = effectiveRecord('lots', item.lotId);
            const locExists = effectiveRecord('storageLocations', item.locationId);
            if (!lotExists) {
              throw new Error(`Orphaned Sales Dispatch: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }
            if (!locExists) {
              throw new Error(`Orphaned Sales Dispatch: ${item.id} references non-existent or deleted Storage Location (${item.locationId}).`);
            }
            const numericFields = ['bottles', 'pricePerBottle', 'revenue', 'cogs'];
            for (const field of numericFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Sales dispatch ${item.id} property ${field} must be non-negative.`);
              }
            }
            if (item.grossProfit !== undefined && typeof item.grossProfit !== 'number') {
              throw new Error(`Sales dispatch ${item.id} grossProfit must be a number.`);
            }
            if (item.costPerBottle !== undefined && item.costPerBottle !== null && (typeof item.costPerBottle !== 'number' || item.costPerBottle < 0)) {
              throw new Error(`Sales dispatch ${item.id} costPerBottle must be non-negative.`);
            }
            if (item.marginPct !== undefined && item.marginPct !== null && typeof item.marginPct !== 'number') {
              throw new Error(`Sales dispatch ${item.id} marginPct must be a number.`);
            }
            const dispatchRecord = { ...(existingItem || {}), ...item };
            if (!isValidId(dispatchRecord.stockMovementId)) {
              throw new Error(`Sales dispatch ${item.id} has invalid or missing stockMovementId.`);
            }
            const movement = effectiveRecord('stockMovements', dispatchRecord.stockMovementId);
            if (!movement) {
              throw new Error(`Orphaned Sales Dispatch: ${item.id} references non-existent or deleted Stock Movement (${dispatchRecord.stockMovementId}).`);
            }
            validateMovementParity(dispatchRecord.recordKind === 'reversal' ? 'sale_reversal' : 'sale', dispatchRecord, movement);
            if (dispatchRecord.recordKind === 'reversal') {
              if (dispatchRecord.salesOrderId) {
                throw new Error(`Mismatched Sales Reversal: correction dispatch ${item.id} cannot fulfill an order.`);
              }
              validateSalesReversalParity(dispatchRecord, movement);
            } else if (dispatchRecord.reversedByCommandId || dispatchRecord.reversedAt) {
              const reversal = effectiveCollection('salesDispatches').find(candidate => (
                candidate?.recordKind === 'reversal' && candidate.reversalOfDispatchId === dispatchRecord.id
              ));
              if (!reversal) {
                throw new Error(`Mismatched Sales Reversal: reversed dispatch ${item.id} has no correction entry.`);
              }
              const returnMovement = effectiveRecord('stockMovements', reversal.stockMovementId);
              if (!returnMovement) {
                throw new Error(`Mismatched Sales Reversal: correction dispatch ${reversal.id} has no return movement.`);
              }
              validateSalesReversalParity(reversal, returnMovement);
            }
            if (item.salesOrderId !== undefined && item.salesOrderId !== null && item.salesOrderId !== '' && !isValidId(item.salesOrderId)) {
              throw new Error(`Sales dispatch ${item.id} has invalid salesOrderId.`);
            }
            if (dispatchRecord.salesOrderId) {
              const order = effectiveRecord('salesOrders', dispatchRecord.salesOrderId);
              if (!order) {
                throw new Error(`Orphaned Sales Dispatch: ${item.id} references non-existent or deleted Sales Order (${dispatchRecord.salesOrderId}).`);
              }
              const orderMatchesLifecycle = dispatchRecord.reversedByCommandId
                ? order.status === 'cancelled'
                  && order.reversedByCommandId === dispatchRecord.reversedByCommandId
                  && order.reversalReason === dispatchRecord.reversalReason
                : order.status === 'fulfilled';
              if (order.dispatchId !== item.id || !orderMatchesLifecycle) {
                throw new Error(`Mismatched Sales Link: Sales order ${order.id} must be fulfilled or cancelled by the matching reversal for dispatch ${item.id}.`);
              }
              if (order.lotId !== dispatchRecord.lotId
                || order.locationId !== dispatchRecord.locationId
                || order.bottles !== dispatchRecord.bottles) {
                throw new Error(`Mismatched Sales Link: Sales order ${order.id} does not match dispatch ${item.id} lot, location, and bottle count.`);
              }
            }
          }

          else if (key === 'salesOrders') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Sales order ${item.id} has invalid referenced lotId.`);
            }
            if (!isValidId(item.locationId)) {
              throw new Error(`Sales order ${item.id} has invalid referenced locationId.`);
            }
            const lotExists = effectiveRecord('lots', item.lotId);
            const locExists = effectiveRecord('storageLocations', item.locationId);
            if (!lotExists) {
              throw new Error(`Orphaned Sales Order: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }
            if (!locExists) {
              throw new Error(`Orphaned Sales Order: ${item.id} references non-existent or deleted Storage Location (${item.locationId}).`);
            }
            if (!['reserved', 'fulfilled', 'cancelled'].includes(item.status)) {
              throw new Error(`Sales order ${item.id} has invalid status.`);
            }
            const numericFields = ['bottles', 'pricePerBottle', 'revenue', 'cogs'];
            for (const field of numericFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Sales order ${item.id} property ${field} must be non-negative.`);
              }
            }
            if (item.grossProfit !== undefined && typeof item.grossProfit !== 'number') {
              throw new Error(`Sales order ${item.id} grossProfit must be a number.`);
            }
            if (item.costPerBottle !== undefined && item.costPerBottle !== null && (typeof item.costPerBottle !== 'number' || item.costPerBottle < 0)) {
              throw new Error(`Sales order ${item.id} costPerBottle must be non-negative.`);
            }
            if (item.marginPct !== undefined && item.marginPct !== null && typeof item.marginPct !== 'number') {
              throw new Error(`Sales order ${item.id} marginPct must be a number.`);
            }
            if (item.dispatchId !== undefined && item.dispatchId !== null && item.dispatchId !== '' && !isValidId(item.dispatchId)) {
              throw new Error(`Sales order ${item.id} has invalid dispatchId.`);
            }
            const orderRecord = { ...(existingItem || {}), ...item };
            if (orderRecord.dispatchId) {
              const dispatch = effectiveRecord('salesDispatches', orderRecord.dispatchId);
              if (!dispatch) {
                throw new Error(`Orphaned Sales Order: ${item.id} references non-existent or deleted Sales Dispatch (${orderRecord.dispatchId}).`);
              }
              const orderMatchesLifecycle = dispatch.reversedByCommandId
                ? orderRecord.status === 'cancelled'
                  && orderRecord.reversedByCommandId === dispatch.reversedByCommandId
                  && orderRecord.reversalReason === dispatch.reversalReason
                : orderRecord.status === 'fulfilled';
              if (!orderMatchesLifecycle || dispatch.salesOrderId !== item.id) {
                throw new Error(`Mismatched Sales Link: Sales order ${item.id} must be fulfilled or cancelled by the matching reversal for dispatch ${dispatch.id}.`);
              }
              if (dispatch.lotId !== orderRecord.lotId
                || dispatch.locationId !== orderRecord.locationId
                || dispatch.bottles !== orderRecord.bottles) {
                throw new Error(`Mismatched Sales Link: Sales order ${item.id} does not match dispatch ${dispatch.id} lot, location, and bottle count.`);
              }
            }
          }

          else if (key === 'supplierPayments') {
            if (typeof item.supplierName !== 'string' || !item.supplierName.trim()) {
              throw new Error(`Supplier payment ${item.id} requires a supplier name.`);
            }
            if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount <= 0) {
              throw new Error(`Supplier payment ${item.id} amount must be a positive number.`);
            }
            if (item.method !== undefined && !['cash', 'bank', 'other'].includes(item.method)) {
              throw new Error(`Supplier payment ${item.id} has invalid method.`);
            }
          }

          else if (key === 'certificationRecords') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Certification record ${item.id} has invalid referenced lotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const lotDeleted = isDeleted('lots', item.lotId);
            if (!lotExists || lotDeleted) {
              throw new Error(`Orphaned Certification Record: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }
            if (item.bottlingRunId) {
              if (!isValidId(item.bottlingRunId)) {
                throw new Error(`Certification record ${item.id} has invalid bottlingRunId.`);
              }
              const runExists = userDb.bottlingRuns.some((r: any) => r.id === item.bottlingRunId) || (collections.bottlingRuns && collections.bottlingRuns.some((r: any) => r.id === item.bottlingRunId));
              const runDeleted = isDeleted('bottlingRuns', item.bottlingRunId);
              if (!runExists || runDeleted) {
                throw new Error(`Orphaned Certification Record: ${item.id} references non-existent or deleted Bottling Run (${item.bottlingRunId}).`);
              }
            }
            if (!['wine', 'sparkling_wine', 'chacha_spirit', 'grape_must_juice', 'fortified_wine'].includes(item.productType)) {
              throw new Error(`Certification record ${item.id} has invalid productType.`);
            }
            if (!['draft', 'ready', 'submitted', 'approved', 'rejected'].includes(item.applicationStatus)) {
              throw new Error(`Certification record ${item.id} has invalid applicationStatus.`);
            }
            if (item.organolepticResult !== undefined && !['pending', 'passed', 'failed', 'not_required'].includes(item.organolepticResult)) {
              throw new Error(`Certification record ${item.id} has invalid organolepticResult.`);
            }
            if (item.balanceCheckStatus !== undefined && !['pending', 'passed', 'failed'].includes(item.balanceCheckStatus)) {
              throw new Error(`Certification record ${item.id} has invalid balanceCheckStatus.`);
            }
            if (item.purpose !== undefined && !['local_market', 'export'].includes(item.purpose)) {
              throw new Error(`Certification record ${item.id} has invalid purpose.`);
            }
            if (item.sampleQuantity !== undefined && (typeof item.sampleQuantity !== 'number' || item.sampleQuantity < 0)) {
              throw new Error(`Certification record ${item.id} sampleQuantity must be non-negative.`);
            }
          }

          else if (key === 'attachments') {
            if (typeof item.fileName !== 'string' || !item.fileName.trim()) {
              throw new Error(`Attachment ${item.id} requires a fileName.`);
            }
            const attachmentFileName = normalizeAttachmentFileName(item.fileName);
            if (!attachmentFileName) {
              throw new Error(`Attachment ${item.id} requires a safe fileName.`);
            }
            if (!isSupportedAttachmentFileName(attachmentFileName)) {
              throw new Error(`Attachment ${item.id} has unsupported file type.`);
            }
            if (!['company', 'official_docs', 'certification', 'cadastre', 'qvevri', 'lab', 'vineyard_project', 'crm', 'other'].includes(item.module)) {
              throw new Error(`Attachment ${item.id} has invalid module.`);
            }
            if (!item.storage || typeof item.storage !== 'object' || !['inline', 'external', 'metadata_only', 'gcs'].includes(item.storage.kind)) {
              throw new Error(`Attachment ${item.id} has invalid storage kind.`);
            }
            if (item.sizeBytes !== undefined && (typeof item.sizeBytes !== 'number' || !Number.isFinite(item.sizeBytes) || item.sizeBytes < 0)) {
              throw new Error(`Attachment ${item.id} sizeBytes must be non-negative.`);
            }
            if (!isSupportedAttachmentMimeType(item.mimeType, attachmentFileName)) {
              throw new Error(`Attachment ${item.id} has unsupported MIME type.`);
            }
            if (item.storage.kind === 'inline') {
              if (!isAllowedInlineAttachmentDataUrl(item.storage.dataUrl, attachmentFileName)) {
                throw new Error(`Attachment ${item.id} inline storage requires a supported PDF, image, Office, or CSV data URL.`);
              }
              if (!attachmentMimeTypeMatchesInlineDataUrl(item.storage.dataUrl, item.mimeType, attachmentFileName)) {
                throw new Error(`Attachment ${item.id} MIME type does not match inline content.`);
              }
              const decodedInlineBytes = inlineAttachmentDecodedBytes(item.storage.dataUrl) || 0;
              if (Math.max(item.sizeBytes || 0, decodedInlineBytes) > MAX_INLINE_ATTACHMENT_BYTES) {
                throw new Error(`Attachment ${item.id} is too large for inline sync.`);
              }
              if (item.checksum !== undefined && checksumAttachmentDataUrl(item.storage.dataUrl) !== String(item.checksum).toLowerCase()) {
                throw new Error(`Attachment ${item.id} checksum does not match inline content.`);
              }
            }
            if (item.storage.kind === 'external' && !normalizeExternalAttachmentUrl(item.storage.url)) {
              throw new Error(`Attachment ${item.id} external storage requires a valid HTTPS URL.`);
            }
            // GCS-backed: bytes live in object storage, so state carries only a
            // validated object key and no inline data — cost to the JSONB blob
            // is ~0 regardless of file size (the whole point of this backend).
            if (item.storage.kind === 'gcs' && !isValidAttachmentObjectKey(item.storage.objectKey)) {
              throw new Error(`Attachment ${item.id} gcs storage requires a valid object key.`);
            }
            if (item.checksum !== undefined && !isValidAttachmentChecksum(item.checksum)) {
              throw new Error(`Attachment ${item.id} has invalid checksum.`);
            }
            if (item.linkedRecordId !== undefined && item.linkedRecordId !== null && item.linkedRecordId !== '' && !isValidId(item.linkedRecordId)) {
              throw new Error(`Attachment ${item.id} has invalid linkedRecordId.`);
            }
          }

          else if (key === 'crmLeads') {
            if (typeof item.displayName !== 'string' || !item.displayName.trim()) {
              throw new Error(`CRM lead ${item.id} requires a displayName.`);
            }
            if (typeof item.companyName !== 'string' || !item.companyName.trim()) {
              throw new Error(`CRM lead ${item.id} requires a companyName.`);
            }
            if (!['new', 'contacted', 'qualified', 'customer', 'archived'].includes(item.status)) {
              throw new Error(`CRM lead ${item.id} has invalid status.`);
            }
            if (!Array.isArray(item.tags)) {
              throw new Error(`CRM lead ${item.id} tags must be an array.`);
            }
          }

          else if (key === 'aiDrafts') {
            if (!['task', 'lab_check', 'cellar_operation', 'so2_calculation', 'spray_recommendation', 'compliance_warning', 'official_document_explanation', 'lot_passport_summary'].includes(item.type)) {
              throw new Error(`AI draft ${item.id} has invalid type.`);
            }
            if (!['high', 'medium', 'low'].includes(item.priority)) {
              throw new Error(`AI draft ${item.id} has invalid priority.`);
            }
            if (!['draft', 'converted_to_task', 'dismissed'].includes(item.status)) {
              throw new Error(`AI draft ${item.id} has invalid status.`);
            }
            if (item.reviewOnly !== true) {
              throw new Error(`AI draft ${item.id} must remain review-only.`);
            }
          }

          else if (key === 'tasks') {
            if (item.priority && !['high', 'medium', 'low'].includes(item.priority)) {
              throw new Error(`Task ${item.id} has invalid priority: ${item.priority}`);
            }
            if (item.status && !['pending', 'completed'].includes(item.status)) {
              throw new Error(`Task ${item.id} has invalid status: ${item.status}`);
            }
            if (item.assignedUserId !== undefined
              && (typeof item.assignedUserId !== 'string' || item.assignedUserId.length > 160)) {
              throw new Error(`Task ${item.id} has an invalid assigned user.`);
            }
            if (item.whatsappNotification !== undefined) {
              const notification = item.whatsappNotification;
              if (!notification || typeof notification !== 'object' || Array.isArray(notification)) {
                throw new Error(`Task ${item.id} has an invalid WhatsApp notification.`);
              }
              if (!['sending', 'accepted', 'sent', 'delivered', 'read', 'failed'].includes(notification.status)) {
                throw new Error(`Task ${item.id} has an invalid WhatsApp delivery status.`);
              }
              if (typeof notification.updatedAt !== 'string' || notification.updatedAt.length > 80
                || (notification.messageId !== undefined
                  && (typeof notification.messageId !== 'string' || notification.messageId.length > 500))
                || (notification.error !== undefined
                  && (typeof notification.error !== 'string' || notification.error.length > 300))
                || (notification.language !== undefined && !['en', 'ka'].includes(notification.language))) {
                throw new Error(`Task ${item.id} has invalid WhatsApp delivery metadata.`);
              }
            }
          }

          else if (key === 'blocks') {
            if (item.area !== undefined && (typeof item.area !== 'number' || item.area < 0)) {
              throw new Error(`Block ${item.id} area cannot be negative.`);
            }
            if (item.parcelArea !== undefined && item.parcelArea !== null && (typeof item.parcelArea !== 'number' || item.parcelArea < 0)) {
              throw new Error(`Block ${item.id} parcelArea cannot be negative.`);
            }
            if (item.elevation !== undefined && (typeof item.elevation !== 'number' || item.elevation < 0)) {
              throw new Error(`Block ${item.id} elevation cannot be negative.`);
            }
            if (item.latitude !== undefined && (typeof item.latitude !== 'number' || !Number.isFinite(item.latitude) || item.latitude < -90 || item.latitude > 90)) {
              throw new Error(`Block ${item.id} latitude must be a valid coordinate.`);
            }
            if (item.longitude !== undefined && (typeof item.longitude !== 'number' || !Number.isFinite(item.longitude) || item.longitude < -180 || item.longitude > 180)) {
              throw new Error(`Block ${item.id} longitude must be a valid coordinate.`);
            }
            if (item.rowsCount !== undefined && (typeof item.rowsCount !== 'number' || item.rowsCount < 0)) {
              throw new Error(`Block ${item.id} rowsCount cannot be negative.`);
            }
            if (item.vinesCount !== undefined && (typeof item.vinesCount !== 'number' || item.vinesCount < 0)) {
              throw new Error(`Block ${item.id} vinesCount cannot be negative.`);
            }
            for (const field of ['boundary', 'gpsPolygon']) {
              const polygon = item[field];
              if (polygon === undefined || polygon === null) continue;
              if (!Array.isArray(polygon)) {
                throw new Error(`Block ${item.id} ${field} must be an array of coordinates.`);
              }
              for (const point of polygon) {
                if (!point || typeof point !== 'object'
                  || typeof point.lat !== 'number' || !Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90
                  || typeof point.lng !== 'number' || !Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180) {
                  throw new Error(`Block ${item.id} ${field} contains an invalid coordinate.`);
                }
              }
            }
          }

          else if (key === 'sprays') {
            const checkFields = ['dosePerHa', 'waterVolumePerHa', 'totalProductUsed', 'totalWaterUsed', 'windSpeed', 'temperature', 'humidity'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Spray record ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'soilRecords') {
            const checkFields = ['pH', 'organicMatterPct', 'nitrogenMgKg', 'phosphorusMgKg', 'potassiumMgKg', 'calciumMgKg', 'magnesiumMgKg', 'salinityDsm'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Soil record ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'samplings') {
            const checkFields = ['brix', 'pH', 'totalAcidityGL', 'berryWeightG'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Sampling record ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'harvests') {
            if (item.estimatedTons !== undefined && (typeof item.estimatedTons !== 'number' || item.estimatedTons < 0)) {
              throw new Error(`Harvest ${item.id} estimatedTons cannot be negative.`);
            }
            if (item.actualHarvestedKg !== undefined && (typeof item.actualHarvestedKg !== 'number' || item.actualHarvestedKg < 0)) {
              throw new Error(`Harvest ${item.id} actualHarvestedKg cannot be negative.`);
            }
          }

          else if (key === 'irrigationLogs') {
            const checkFields = ['durationHours', 'waterVolumeLiters', 'soilMoistureBeforePct', 'soilMoistureAfterPct'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Irrigation record ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'fertilizerLogs') {
            if (item.dosePerHa !== undefined && (typeof item.dosePerHa !== 'number' || item.dosePerHa < 0)) {
              throw new Error(`Fertilizer log ${item.id} dosePerHa cannot be negative.`);
            }
            if (item.totalAmountUsed !== undefined && (typeof item.totalAmountUsed !== 'number' || item.totalAmountUsed < 0)) {
              throw new Error(`Fertilizer log ${item.id} totalAmountUsed cannot be negative.`);
            }
          }

          else if (key === 'phenologyLogs') {
            if (item.gdd !== undefined && (typeof item.gdd !== 'number' || item.gdd < 0)) {
              throw new Error(`Phenology record ${item.id} gdd cannot be negative.`);
            }
            if (item.confidence !== undefined && (typeof item.confidence !== 'number' || item.confidence < 0 || item.confidence > 100)) {
              throw new Error(`Phenology record ${item.id} confidence must be between 0 and 100.`);
            }
          }

          else if (key === 'notes') {
            if (item.relatedLotId !== undefined && item.relatedLotId !== null) {
              if (!isValidId(item.relatedLotId)) {
                throw new Error(`Note ${item.id} has invalid referenced relatedLotId.`);
              }
              const lotExists = userDb.lots.some((l: any) => l.id === item.relatedLotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.relatedLotId));
              const lotDeleted = isDeleted('lots', item.relatedLotId);
              if (!lotExists || lotDeleted) {
                throw new Error(`Orphaned Reference: Note ${item.id} references non-existent or deleted Lot (${item.relatedLotId}).`);
              }
            }
          }

          else if (key === 'auditLogs') {
            const existingAudit = userDb.auditLogs.find((l: any) => l.id === item.id);
            if (existingAudit && (existingAudit.hash !== item.hash || existingAudit.action !== item.action || existingAudit.actor !== item.actor)) {
              throw new Error(`Audit Immutability: Modify log ${item.id} is forbidden.`);
            }
          }
        }
      }
    }

    const aggregateMovements = effectiveCollection('stockMovements')
      .filter(item => item && ['in', 'out'].includes(item.direction) && typeof item.bottles === 'number' && Number.isFinite(item.bottles));
    const aggregateOrders = effectiveCollection('salesOrders');
    const stockPairs = new Map<string, { locationId: string; lotId: string; onHand: number }>();
    const stockByLocation = new Map<string, number>();
    for (const movement of aggregateMovements) {
      const signedBottles = movement.direction === 'in' ? movement.bottles : -movement.bottles;
      const key = `${movement.locationId}\u0000${movement.lotId}`;
      const pair = stockPairs.get(key) || { locationId: movement.locationId, lotId: movement.lotId, onHand: 0 };
      pair.onHand += signedBottles;
      stockPairs.set(key, pair);
      stockByLocation.set(movement.locationId, (stockByLocation.get(movement.locationId) || 0) + signedBottles);
    }
    for (const order of aggregateOrders) {
      if (order?.status !== 'reserved' || !order.locationId || !order.lotId) continue;
      const key = `${order.locationId}\u0000${order.lotId}`;
      if (!stockPairs.has(key)) {
        stockPairs.set(key, { locationId: order.locationId, lotId: order.lotId, onHand: 0 });
      }
    }
    for (const pair of stockPairs.values()) {
      if (pair.onHand < 0) {
        throw new Error(`Invalid Stock Balance: outbound movements exceed inbound stock for ${pair.lotId} at ${pair.locationId}.`);
      }
      const reserved = reservedBottlesFor(aggregateOrders, pair.locationId, pair.lotId);
      if (reserved > pair.onHand) {
        throw new Error(`Invalid Stock Reservation: ${reserved} reserved bottles exceed ${pair.onHand} on hand for ${pair.lotId} at ${pair.locationId}.`);
      }
    }
    for (const location of effectiveCollection('storageLocations')) {
      if (!location?.id || !(location.capacityBottles > 0)) continue;
      const onHand = stockByLocation.get(location.id) || 0;
      if (onHand > location.capacityBottles) {
        throw new Error(`Invalid Storage Capacity: ${onHand} bottles exceed ${location.capacityBottles} at ${location.id}.`);
      }
    }
  }
}

const RESPONSE_COLLECTION_DEPENDENCIES: Partial<Record<string, PermissionModule[]>> = {
  // Lab entry needs active vessel IDs even though technicians do not manage the
  // vessel module itself.
  vessels: ['lab'],
  // Certification review is an evidence-aggregation workflow spanning origin,
  // receiving, lab, and bottling records. These collections remain read-only
  // unless their own module permission grants writes.
  lots: ['certification'],
  blocks: ['certification'],
  grapeIntakes: ['certification'],
  lablogs: ['certification'],
  bottlingRuns: ['certification'],
};

function mayViewResponseCollection(role: string, collection: string): boolean {
  const directModule = collection === 'integrationHub'
    ? 'company_profile'
    : moduleForSyncCollection(collection);
  if (directModule && canAccess(role, directModule, 'view')) return true;
  return (RESPONSE_COLLECTION_DEPENDENCIES[collection] || [])
    .some(module => canAccess(role, module, 'view'));
}

function omitRecordFields(record: any, fields: string[]): any {
  if (!record || typeof record !== 'object') return record;
  const copy = { ...record };
  for (const field of fields) delete copy[field];
  return copy;
}

/**
 * Return a schema-complete, role-filtered DB snapshot. Unauthorized collections
 * stay present as []/{} so hydration clears stale data from an earlier role or
 * organization instead of retaining it client-side.
 */
export function redactWineryDatabaseForRole(role: string, userDb: any): any {
  const empty = createEmptyUserData() as any;
  const response: any = {};
  const canViewCosts = canAccess(role, 'costs', 'view');
  const canViewStorage = canAccess(role, 'storage', 'view');

  for (const [collection, emptyValue] of Object.entries(empty)) {
    if (collection === 'syncDeletionLedger') continue;
    const storedValue = userDb?.[collection];
    if (collection === 'attachments') {
      response.attachments = (Array.isArray(storedValue) ? storedValue : [])
        .filter((attachment: any) => {
          const module = moduleForAttachmentKind(attachment?.module);
          return module && canAccess(role, module, 'view');
        });
      continue;
    }
    if (!mayViewResponseCollection(role, collection)) {
      response[collection] = Array.isArray(emptyValue) ? [] : {};
      continue;
    }

    if (!Array.isArray(emptyValue)) {
      response[collection] = storedValue && typeof storedValue === 'object' && !Array.isArray(storedValue)
        ? { ...storedValue }
        : {};
      continue;
    }

    let records = Array.isArray(storedValue) ? storedValue : [];
    if (!canViewCosts) {
      if (collection === 'inventory') {
        records = records.map((record: any) => omitRecordFields(record, ['costPerUnit', 'lastInvoiceReceipt']));
      } else if (collection === 'grapeIntakes') {
        records = records.map((record: any) => {
          const redacted = omitRecordFields(record, [
            'costPerKg', 'totalCost', 'currency', 'grapePrice', 'paymentStatus',
          ]);
          if (redacted.reversalSnapshot?.costEntry) {
            redacted.reversalSnapshot = omitRecordFields(redacted.reversalSnapshot, ['costEntry']);
          }
          return redacted;
        });
      } else if (collection === 'bottlingRuns') {
        records = records.map((record: any) => omitRecordFields(record, [
          'packagingCostTotal', 'bottlingServiceCost',
        ]));
      } else if (collection === 'salesDispatches' || collection === 'salesOrders') {
        records = records.map((record: any) => omitRecordFields(record, [
          'costPerBottle', 'cogs', 'grossProfit', 'marginPct',
        ]));
      }
    }
    if (!canViewStorage && collection === 'bottlingRuns') {
      records = records.map((record: any) => omitRecordFields(record, [
        'storageLocationId', 'storageMovementId', 'placedInStorageBottles',
      ]));
    }
    response[collection] = records;
  }

  return response;
}

export interface SyncCandidateResult {
  candidateDb: any;
  conflicts: ReturnType<typeof mergeCollections>;
  deletionConflict: boolean;
  deletionRejected?: boolean;
  deletionError?: string;
  recoverableCollections?: Record<string, any>;
}

export const MAX_SYNC_DELETION_LEDGER_ENTRIES = 20_000;

interface SyncDeletionLedgerEntry {
  id: string;
  collection: string;
  recordLastModified?: string;
  recordFingerprint: string;
  deletedAt: string;
}

const deletionIdentity = (collection: string, id: string): string => `${collection}\u0000${id}`;

function normalizedDeletionLedger(userDb: any): SyncDeletionLedgerEntry[] {
  if (!Array.isArray(userDb?.syncDeletionLedger)) return [];
  return userDb.syncDeletionLedger.filter((entry: any): entry is SyncDeletionLedgerEntry => (
    entry
    && typeof entry === 'object'
    && typeof entry.id === 'string'
    && typeof entry.collection === 'string'
    && typeof entry.recordFingerprint === 'string'
    && typeof entry.deletedAt === 'string'
  ));
}

function deletionVersionConflicts(
  userDb: any,
  deletedRecords: DeletedRecordRef[] | undefined,
): ReturnType<typeof mergeCollections> {
  const conflicts: ReturnType<typeof mergeCollections> = [];
  for (const deletion of Array.isArray(deletedRecords) ? deletedRecords : []) {
    if (!deletion || typeof deletion.collection !== 'string' || typeof deletion.id !== 'string') continue;
    const existing = Array.isArray(userDb?.[deletion.collection])
      ? userDb[deletion.collection].find((record: any) => record?.id === deletion.id)
      : undefined;
    if (!existing) continue; // delete/delete replay converges without conflict
    const timestampChanged = typeof deletion.baselineTimestamp === 'string'
      && deletion.baselineTimestamp !== existing.lastModified;
    const contentChanged = typeof deletion.baselineFingerprint === 'string'
      && deletion.baselineFingerprint !== syncRecordFingerprint(existing);
    if (!timestampChanged && !contentChanged) continue;
    conflicts.push({
      collection: toClientKey(deletion.collection),
      recordId: deletion.id,
      local: null,
      server: { ...existing },
    });
  }
  return conflicts;
}

function prepareCollectionsAgainstDeletionLedger(
  userDb: any,
  collections: Record<string, any>,
): {
  safeCollections: Record<string, any>;
  conflicts: ReturnType<typeof mergeCollections>;
  recreatedIdentities: Set<string>;
} {
  const ledger = new Map(normalizedDeletionLedger(userDb).map(entry => (
    [deletionIdentity(entry.collection, entry.id), entry]
  )));
  if (ledger.size === 0) {
    return { safeCollections: collections, conflicts: [], recreatedIdentities: new Set() };
  }

  const safeCollections: Record<string, any> = { ...collections };
  const conflicts: ReturnType<typeof mergeCollections> = [];
  const recreatedIdentities = new Set<string>();
  for (const [collection, value] of Object.entries(collections)) {
    if (!Array.isArray(value)) continue;
    safeCollections[collection] = value.filter((record: any) => {
      if (!record || typeof record.id !== 'string') return true;
      const identity = deletionIdentity(collection, record.id);
      const deletion = ledger.get(identity);
      if (!deletion) return true;
      const currentExists = Array.isArray(userDb?.[collection])
        && userDb[collection].some((current: any) => current?.id === record.id);
      if (currentExists) return true;
      if (typeof record.baselineTimestamp === 'string') {
        conflicts.push({
          collection: toClientKey(collection),
          recordId: record.id,
          local: { ...record },
          server: null,
        });
        return false;
      }
      if (syncRecordFingerprint(record) === deletion.recordFingerprint) {
        // A full-collection sync can carry an untouched stale copy. The
        // authoritative deletion wins silently instead of resurrecting it.
        return false;
      }
      // No edit baseline and different content means an explicit new lifecycle
      // reusing the id. Allow it and retire the previous lifecycle's ledger row.
      recreatedIdentities.add(identity);
      return true;
    });
  }
  return { safeCollections, conflicts, recreatedIdentities };
}

function appendDeletionLedger(
  candidateDb: any,
  recordsBeforeDeletion: Array<{ collection: string; record: any; deletedAt?: string }>,
  recreatedIdentities: Set<string>,
): void {
  const deletedIdentities = new Set(recordsBeforeDeletion.map(({ collection, record }) => (
    deletionIdentity(collection, record.id)
  )));
  const ledger = normalizedDeletionLedger(candidateDb).filter(entry => {
    const identity = deletionIdentity(entry.collection, entry.id);
    return !deletedIdentities.has(identity) && !recreatedIdentities.has(identity);
  });
  for (const { collection, record, deletedAt } of recordsBeforeDeletion) {
    ledger.push({
      id: record.id,
      collection,
      ...(typeof record.lastModified === 'string' ? { recordLastModified: record.lastModified } : {}),
      recordFingerprint: syncRecordFingerprint(record),
      deletedAt: deletedAt || new Date().toISOString(),
    });
  }
  candidateDb.syncDeletionLedger = ledger.slice(-MAX_SYNC_DELETION_LEDGER_ENTRIES);
}

/**
 * Remove the compensating mutations that only make sense when their paired
 * deletion succeeds. The remainder can be merged safely when the server has
 * to reject or defer that deletion (for example after another session added a
 * reference).
 */
export function prepareCollectionsForRejectedDeletion(
  userDb: any,
  collections: Record<string, any>,
  deletedIds: any,
  deletedRecords?: any,
): Record<string, any> {
  const deletionMatcher = createDeletionMatcher(deletedIds, deletedRecords);
  if (!deletionMatcher.hasDeletions) return collections;

  const safeCollections: Record<string, any> = { ...collections };
  const deletedRuns = (Array.isArray(userDb?.bottlingRuns) ? userDb.bottlingRuns : [])
    .filter((run: any) => run?.id && deletionMatcher.isDeleted('bottlingRuns', run.id));
  const deletedDispatches = (Array.isArray(userDb?.salesDispatches) ? userDb.salesDispatches : [])
    .filter((dispatch: any) => dispatch?.id && deletionMatcher.isDeleted('salesDispatches', dispatch.id));

  if (deletedRuns.length > 0 && Array.isArray(collections.lots)) {
    const runByLotId = new Map(deletedRuns.map((run: any) => [run.lotId, run]));
    safeCollections.lots = collections.lots.map((lot: any) => {
      const run: any = runByLotId.get(lot?.id);
      const existing = Array.isArray(userDb?.lots)
        ? userDb.lots.find((candidate: any) => candidate?.id === lot?.id)
        : undefined;
      if (!run || !existing) return lot;
      const isRollbackMutation = lot.stage === run.previousLotStage
        && lot.currentVolume === run.previousLotVolumeL;
      if (!isRollbackMutation) return lot;

      const incomingHistory = Array.isArray(lot.history) ? [...lot.history] : undefined;
      const serverHistory = Array.isArray(existing.history) ? existing.history : [];
      const sourceEvents = serverHistory
        .map((event: any, index: number) => ({ event, index }))
        .filter(({ event }: { event: any; index: number }) => event?.sourceRef === run.id);
      if (incomingHistory) {
        for (const { event, index } of sourceEvents) {
          if (incomingHistory.some((candidate: any) => JSON.stringify(candidate) === JSON.stringify(event))) continue;
          incomingHistory.splice(Math.min(index, incomingHistory.length), 0, event);
        }
      }

      return {
        ...lot,
        stage: existing.stage,
        currentVolume: existing.currentVolume,
        ...(incomingHistory ? { history: incomingHistory } : {}),
      };
    });
  }

  if (deletedRuns.length > 0 && Array.isArray(collections.inventory)) {
    const restoredByMaterialId = new Map<string, number>();
    for (const run of deletedRuns) {
      for (const [materialId, quantity] of Object.entries(run?.packagingDeductions || {})) {
        if (typeof quantity !== 'number' || quantity <= 0) continue;
        restoredByMaterialId.set(materialId, (restoredByMaterialId.get(materialId) || 0) + quantity);
      }
    }
    safeCollections.inventory = collections.inventory.map((item: any) => {
      const restored = restoredByMaterialId.get(item?.id);
      const existing = Array.isArray(userDb?.inventory)
        ? userDb.inventory.find((candidate: any) => candidate?.id === item?.id)
        : undefined;
      if (!restored || !existing || typeof item.stock !== 'number' || typeof existing.stock !== 'number') return item;
      const expectedRollbackStock = Math.round((existing.stock + restored) * 1000) / 1000;
      return item.stock === expectedRollbackStock ? { ...item, stock: existing.stock } : item;
    });
  }

  if (deletedDispatches.length > 0 && Array.isArray(collections.salesOrders)) {
    const deletedDispatchIds = new Set(deletedDispatches.map((dispatch: any) => dispatch.id));
    safeCollections.salesOrders = collections.salesOrders.map((order: any) => {
      const existing = Array.isArray(userDb?.salesOrders)
        ? userDb.salesOrders.find((candidate: any) => candidate?.id === order?.id)
        : undefined;
      if (!existing?.dispatchId || !deletedDispatchIds.has(existing.dispatchId) || order.dispatchId) return order;
      return {
        ...order,
        dispatchId: existing.dispatchId,
        status: existing.status,
        fulfilledAt: existing.fulfilledAt,
      };
    });
  }

  return safeCollections;
}

/**
 * Build the state that would actually be saved without mutating the current
 * server snapshot. Deletions are applied only after every incoming update has
 * merged cleanly and the resulting references have been revalidated.
 */
export function buildSyncCandidate(
  userDb: any,
  collections: Record<string, any>,
  deletedIds: any,
  historyScope = '',
  deletedRecords?: DeletedRecordRef[],
): SyncCandidateResult {
  const originalDb = JSON.parse(JSON.stringify(userDb));
  const hasDeletions = createDeletionMatcher(deletedIds, deletedRecords).hasDeletions;
  const versionConflicts = deletionVersionConflicts(userDb, deletedRecords);
  if (versionConflicts.length > 0) {
    return { candidateDb: originalDb, conflicts: versionConflicts, deletionConflict: true };
  }

  const ledgerPreparation = prepareCollectionsAgainstDeletionLedger(userDb, collections);
  if (ledgerPreparation.conflicts.length > 0) {
    return {
      candidateDb: originalDb,
      conflicts: ledgerPreparation.conflicts,
      deletionConflict: hasDeletions,
    };
  }

  const candidateDb = JSON.parse(JSON.stringify(userDb));
  const conflicts = mergeCollections(candidateDb, ledgerPreparation.safeCollections, historyScope);

  // A multi-collection payload represents one client transaction (dispatch +
  // stock movement + order update, bottling + lot rollback, etc.). Persisting
  // clean siblings while an anchor record conflicts creates orphan workflows,
  // so conservatively defer the entire payload.
  if (conflicts.length > 0) {
    return { candidateDb: originalDb, conflicts, deletionConflict: hasDeletions };
  }

  if (hasDeletions) {
    validateSyncPayload(candidateDb, {}, deletedIds, deletedRecords);
    const deletionMatcher = createDeletionMatcher(deletedIds, deletedRecords);
    const deletionMetadata = new Map(
      (Array.isArray(deletedRecords) ? deletedRecords : []).map(record => (
        [deletionIdentity(record.collection, record.id), record]
      )),
    );
    const recordsBeforeDeletion: Array<{ collection: string; record: any; deletedAt?: string }> = [];
    for (const [collection, records] of Object.entries(candidateDb)) {
      if (collection === 'syncDeletionLedger' || !Array.isArray(records)) continue;
      for (const record of records) {
        if (!record?.id || !deletionMatcher.isDeleted(collection, record.id)) continue;
        const metadata = deletionMetadata.get(deletionIdentity(collection, record.id));
        recordsBeforeDeletion.push({
          collection,
          record,
          ...(typeof metadata?.deletedAt === 'string' ? { deletedAt: metadata.deletedAt } : {}),
        });
      }
    }
    applyDeletions(candidateDb, deletedIds, deletedRecords);
    appendDeletionLedger(candidateDb, recordsBeforeDeletion, ledgerPreparation.recreatedIdentities);
  } else if (ledgerPreparation.recreatedIdentities.size > 0) {
    appendDeletionLedger(candidateDb, [], ledgerPreparation.recreatedIdentities);
  }

  return { candidateDb, conflicts, deletionConflict: false };
}

/**
 * Build a sync result that never leaves deletion tombstones permanently stuck.
 * A rejected/deferred deletion restores its server records while preserving
 * unrelated clean updates from the same payload.
 */
export function buildRecoverableSyncCandidate(
  userDb: any,
  collections: Record<string, any>,
  deletedIds: any,
  preflightDeletionError: string | null = null,
  historyScope = '',
  deletedRecords?: DeletedRecordRef[],
): SyncCandidateResult {
  const safeCollections = prepareCollectionsForRejectedDeletion(userDb, collections, deletedIds, deletedRecords);
  const recover = (error: string): SyncCandidateResult => {
    const safeCandidate = buildSyncCandidate(userDb, safeCollections, undefined, historyScope);
    return {
      ...safeCandidate,
      deletionRejected: true,
      deletionError: error,
      recoverableCollections: safeCollections,
    };
  };

  if (preflightDeletionError) return recover(preflightDeletionError);

  try {
    const candidate = buildSyncCandidate(userDb, collections, deletedIds, historyScope, deletedRecords);
    if (!candidate.deletionConflict) return candidate;

    const safeCandidate = buildSyncCandidate(userDb, safeCollections, undefined, historyScope);
    return {
      ...safeCandidate,
      conflicts: candidate.conflicts,
      deletionConflict: true,
    };
  } catch (err: any) {
    return recover(err?.message || 'Deletion integrity validation failed');
  }
}

export function prepareAttachmentsForServerMerge(attachments: any): any {
  if (!Array.isArray(attachments)) return attachments;

  return attachments.map((item: any) => {
    if (!item || typeof item !== 'object') return item;

    const fileName = normalizeAttachmentFileName(item.fileName) || item.fileName;
    const rawStorage = item.storage && typeof item.storage === 'object' && !Array.isArray(item.storage)
      ? item.storage
      : {};
    const storage = rawStorage.kind === 'inline'
      ? { kind: 'inline', dataUrl: rawStorage.dataUrl }
      : rawStorage.kind === 'external'
        ? { kind: 'external', url: normalizeExternalAttachmentUrl(rawStorage.url) || rawStorage.url }
        : rawStorage.kind === 'gcs' && isValidAttachmentObjectKey(rawStorage.objectKey)
          ? { kind: 'gcs', objectKey: rawStorage.objectKey }
          : { kind: 'metadata_only' };
    const prepared: any = {
      ...item,
      fileName,
      storage,
    };

    const mimeType = normalizeAttachmentMimeType(item.mimeType);
    if (mimeType) {
      prepared.mimeType = mimeType;
    } else {
      delete prepared.mimeType;
    }

    if (storage?.kind === 'inline' && typeof storage.dataUrl === 'string') {
      prepared.checksum = item.checksum
        ? String(item.checksum).toLowerCase()
        : checksumAttachmentDataUrl(storage.dataUrl);
    } else if (item.checksum) {
      prepared.checksum = String(item.checksum).toLowerCase();
    }

    return prepared;
  });
}

function syncActionsForCollection(userDb: any, collection: string, incoming: any): PermissionAction[] {
  if (collection === 'companyProfile' || collection === 'winePricing') return ['update'];
  if (!Array.isArray(incoming)) return [];
  const existing = Array.isArray(userDb[collection]) ? userDb[collection] : [];
  const existingIds = new Set(existing.map((item: any) => item?.id).filter(Boolean));
  const actions = new Set<PermissionAction>();
  for (const item of incoming) {
    if (!item || typeof item !== 'object' || !item.id) continue;
    actions.add(existingIds.has(item.id) ? 'update' : 'create');
  }
  return [...actions];
}

export function syncMutatesCollection(
  userDb: any,
  collections: Record<string, any>,
  deletedIds: any,
  deletedRecords: any,
  collection: string,
): boolean {
  const existing = Array.isArray(userDb?.[collection]) ? userDb[collection] : [];
  const existingById = new Map(existing
    .filter((item: any) => item?.id)
    .map((item: any) => [item.id, item]));
  const incoming = collections[collection];
  if (Array.isArray(incoming) && incoming.some((item: any) => {
    if (!item || typeof item !== 'object' || !item.id) return false;
    const stored = existingById.get(item.id);
    return !stored || syncRecordFingerprint(stored) !== syncRecordFingerprint(item);
  })) return true;

  if (Array.isArray(deletedRecords) && deletedRecords.some((record: any) => (
    record?.collection === collection && existingById.has(record?.id)
  ))) return true;
  return Array.isArray(deletedIds) && deletedIds.some((id: any) => existingById.has(id));
}

function deletionTargetsForId(userDb: any, id: string): Array<{ collection: string; module: ReturnType<typeof moduleForSyncCollection>; action: PermissionAction }> {
  const targets: Array<{ collection: string; module: ReturnType<typeof moduleForSyncCollection>; action: PermissionAction }> = [];
  for (const [collection, value] of Object.entries(userDb || {})) {
    if (collection === 'syncDeletionLedger') continue;
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || item.id !== id) continue;
      const module = collection === 'attachments'
        ? moduleForAttachmentKind(item.module)
        : moduleForSyncCollection(collection);
      targets.push({
        collection,
        module,
        action: collection === 'attachments' ? 'update' : 'delete',
      });
    }
  }
  return targets;
}

function authorizeDeletions(role: string, userDb: any, deletedIds: any, deletedRecords?: any): string | null {
  const hasLegacyDeletions = Array.isArray(deletedIds) && deletedIds.length > 0;
  const hasScopedDeletions = Array.isArray(deletedRecords) && deletedRecords.length > 0;
  if (!hasLegacyDeletions && !hasScopedDeletions) return null;
  if (can(role, 'admin')) return null;

  const requested = [
    ...(hasLegacyDeletions ? deletedIds.map((id: any) => ({ id, collection: null })) : []),
    ...(hasScopedDeletions ? deletedRecords : []),
  ];
  for (const record of requested) {
    const { id, collection } = record || {};
    if (!isValidId(id)) continue;
    const targets = deletionTargetsForId(userDb, id)
      .filter(target => !collection || target.collection === collection);
    for (const target of targets) {
      if (!target.module) {
        return `Forbidden: deleting ${id} from ${target.collection} is not authorized.`;
      }
      if (!canAccess(role, target.module, target.action)) {
        return `Forbidden: ${role} cannot ${target.action} ${target.collection}.`;
      }
    }
  }
  return null;
}

export function authorizeSyncPayload(
  role: string,
  userDb: any,
  collections: Record<string, any>,
  deletedIds: any,
  deletedRecords?: any,
): string | null {
  const deletionError = authorizeDeletions(role, userDb, deletedIds, deletedRecords);
  if (deletionError) return deletionError;

  for (const [collection, incoming] of Object.entries(collections)) {
    if (collection === 'aiFindings') {
      return 'Forbidden: AI findings are server-owned and cannot be modified via sync.';
    }
    if (!moduleForSyncCollection(collection)) {
      return `Forbidden: ${collection} is not an authorized sync collection.`;
    }
    if (collection === 'attachments' && Array.isArray(incoming)) {
      const existing = Array.isArray(userDb[collection]) ? userDb[collection] : [];
      const existingById = new Map<string, any>();
      for (const existingItem of existing) {
        if (existingItem?.id) existingById.set(existingItem.id, existingItem);
      }
      for (const item of incoming) {
        if (!item || typeof item !== 'object' || !item.id) continue;
        const existingItem = existingById.get(item.id);
        const incomingModule = moduleForAttachmentKind(item.module);
        if (!incomingModule) return `Forbidden: attachment ${item.id} has unknown module.`;
        const action: PermissionAction = existingItem ? 'update' : 'create';
        const modules = new Set([incomingModule]);
        if (existingItem) {
          const existingModule = moduleForAttachmentKind((existingItem as any).module);
          if (!existingModule) return `Forbidden: attachment ${item.id} has unknown stored module.`;
          modules.add(existingModule);
        }
        for (const module of modules) {
          if (!canAccess(role, module, action)) {
            return `Forbidden: ${role} cannot ${action} ${collection} for ${module}.`;
          }
        }
      }
      continue;
    }
    const actions = syncActionsForCollection(userDb, collection, incoming);
    for (const action of actions) {
      if (!canSyncCollection(role, collection, action)) {
        return `Forbidden: ${role} cannot ${action} ${collection}.`;
      }
    }
  }
  return null;
}

// POST /api/sync
router.post('/sync', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  const telemetryStartedAt = Date.now();
  const telemetry = {
    mergeMs: 0,
    retryCount: 0,
    conflict: false,
  };
  const telemetryPayload = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const payloadBytes = Buffer.byteLength(JSON.stringify(req.body ?? null));
  const tombstoneCount = ['deletedIds', 'deletedRecords'].reduce((total, key) => (
    total + (Array.isArray(telemetryPayload[key]) ? telemetryPayload[key].length : 0)
  ), 0);
  const recordCount = Object.entries(telemetryPayload).reduce((total, [key, value]) => (
    total + (!['deletedIds', 'deletedRecords'].includes(key) && Array.isArray(value) ? value.length : 0)
  ), 0);
  res.once('finish', () => {
    recordSyncOperationalMetric({
      payloadBytes,
      recordCount,
      tombstoneCount,
      durationMs: Date.now() - telemetryStartedAt,
      mergeMs: telemetry.mergeMs,
      retryCount: telemetry.retryCount,
      conflict: telemetry.conflict,
      statusCode: res.statusCode,
      outcome: telemetry.conflict ? 'conflict' : res.statusCode >= 200 && res.statusCode < 300
        ? 'success'
        : 'rejected',
    });
  });
  try {
    assertSyncPayloadWithinLimits(req.body);
  } catch (error) {
    if (error instanceof SyncPayloadLimitError) {
      return res.status(error.statusCode).json({
        code: error.code,
        error: error.message,
        limits: {
          recordsPerCollection: MAX_SYNC_RECORDS_PER_COLLECTION,
          totalRecords: MAX_SYNC_TOTAL_RECORDS,
          tombstones: MAX_SYNC_TOMBSTONES,
        },
      });
    }
    throw error;
  }
  const { deletedIds, deletedRecords, ...collections } = req.body;

  // Optimistic-concurrency retry: a version conflict means another sync landed
  // between our reload and save. Per-item baselines make the merge idempotent,
  // so re-running it against the fresh state resolves the whole-document race
  // server-side instead of bouncing a 409 to the client. True same-field
  // conflicts are still reported per item via `conflicts`.
  const MAX_SAVE_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
    telemetry.retryCount = attempt - 1;
    const refreshed = await reloadUserOrganizationDataFromPostgres(session.username);
    const expectedOrgStateVersion = refreshed?.meta.version ?? null;
    const userDb = refreshed?.data || await getUserData(session.username) || createEmptyUserData();
    // Baseline inline-attachment footprint before this sync mutates state, so
    // the budget guard below can allow shrinking syncs even when already at cap.
    const inlineBytesBefore = sumInlineAttachmentBytes(userDb.attachments);

    if (syncMutatesCollection(userDb, collections, deletedIds, deletedRecords, 'costEntries')) {
      const canTrackProductionCosts = await organizationHasFeature(
        session.organizationId,
        'production_cost_tracking',
      );
      if (!canTrackProductionCosts) {
        return res.status(403).json({
          code: 'subscription_feature_required',
          feature: 'production_cost_tracking',
          error: 'Production cost tracking is not included in the current subscription plan.',
        });
      }
    }

    const permissionError = authorizeSyncPayload(session.role, userDb, collections, undefined);
    if (permissionError) {
      return res.status(403).json({ error: permissionError });
    }

    const safeCollections = prepareCollectionsForRejectedDeletion(userDb, collections, deletedIds, deletedRecords);
    try {
      validateSyncPayload(userDb, safeCollections, undefined);
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Validation error' });
    }

    const deletionRequested = (
      deletedIds !== undefined
      && (!Array.isArray(deletedIds) || deletedIds.length > 0)
    ) || (
      deletedRecords !== undefined
      && (!Array.isArray(deletedRecords) || deletedRecords.length > 0)
    );
    let deletionError: string | null = null;
    if (deletionRequested) {
      deletionError = authorizeSyncPayload(session.role, userDb, {}, deletedIds, deletedRecords);
      if (!deletionError) {
        try {
          validateSyncPayload(userDb, collections, deletedIds, deletedRecords);
        } catch (err: any) {
          deletionError = err?.message || 'Deletion validation failed';
        }
      }
    }

    // Never mutate the client payload: a retry must re-prepare from the
    // original collections against whichever server state it reloaded.
    const merging: Record<string, any> = { ...collections };
    try {
      if (Array.isArray(collections.auditLogs)) {
        merging.auditLogs = prepareAuditLogsForServerMerge(
          userDb.auditLogs || [],
          collections.auditLogs.map((log: any) => ({ ...log })),
        );
      }
      if (Array.isArray(collections.attachments)) {
        merging.attachments = prepareAttachmentsForServerMerge(collections.attachments);
      }
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Audit validation error' });
    }

    const mergeStartedAt = Date.now();
    const candidate = buildRecoverableSyncCandidate(
      userDb,
      merging,
      deletedIds,
      deletionError,
      session.organizationId,
      deletedRecords,
    );
    telemetry.mergeMs += Date.now() - mergeStartedAt;
    const { candidateDb, conflicts } = candidate;
    const deletionDeferred = candidate.deletionConflict;
    if (conflicts.length > 0) {
      telemetry.conflict = true;
      await setOrganizationStateHeaders(res, session.username);
      return res.json({
        hasConflicts: true,
        conflicts,
        serverDb: redactWineryDatabaseForRole(session.role, candidateDb),
        ...(deletionDeferred ? { deletionDeferred: true } : {}),
        ...(candidate.deletionRejected ? {
          deletionRejected: true,
          deletionError: candidate.deletionError,
          recoverableCollections: Object.fromEntries(
            Object.keys(candidate.recoverableCollections || {}).map(collection => {
              const redacted = redactWineryDatabaseForRole(
                session.role,
                candidate.recoverableCollections,
              );
              return [collection, redacted[collection]];
            }),
          ),
        } : {}),
      });
    }
    if (session.username === 'testuser1') {
      pruneTestUserSeedDuplicates(candidateDb);
    }

    // Org-wide inline-attachment budget. Inline blobs accumulate in the JSONB
    // state, so block syncs that GROW the footprint past the cap — but always
    // allow syncs that keep it flat or shrink it, so a user who is already at
    // the limit can still delete/externalize attachments to recover.
    const inlineBytesAfter = sumInlineAttachmentBytes(candidateDb.attachments);
    if (inlineBytesAfter > MAX_TOTAL_INLINE_ATTACHMENT_BYTES && inlineBytesAfter > inlineBytesBefore) {
      const capMb = (MAX_TOTAL_INLINE_ATTACHMENT_BYTES / 1_000_000).toFixed(0);
      return res.status(413).json({
        code: 'inline_attachment_budget_exceeded',
        error: `Inline attachment storage for this winery would exceed ${capMb} MB. Use an external HTTPS link or metadata-only storage for large files, or remove existing inline attachments.`,
      });
    }

    try {
      await saveUserData(session.username, candidateDb, {
        expectedVersion: expectedOrgStateVersion,
        updatedBy: `api-sync:${session.username}`,
      });
    } catch (err) {
      if (err instanceof OrganizationStateVersionConflictError) {
        if (attempt < MAX_SAVE_ATTEMPTS) continue; // re-merge on the fresh state
        const latest = await reloadUserOrganizationDataFromPostgres(session.username);
        if (latest) {
          saveDB({ syncPostgres: false });
          await setOrganizationStateHeaders(res, session.username);
        }
        return res.status(409).json({
          code: 'org_state_conflict',
          error: 'Organization data changed while saving. Please sync again before retrying.',
          serverDb: redactWineryDatabaseForRole(session.role, latest?.data || candidateDb),
        });
      }
      throw err;
    }

    // Capacity is informational during harvest: usage is updated server-side,
    // but exceeding a plan never blocks or discards operational records.
    await recordProductionUsage(session.organizationId, candidateDb).catch((error) => {
      console.error('[billing] failed to refresh production usage:', error instanceof Error ? error.message : 'unknown error');
    });

    await setOrganizationStateHeaders(res, session.username);
    const responseDb = redactWineryDatabaseForRole(session.role, candidateDb);

    // Report how close this workspace is to the sync ceilings. The append-only
    // collections only grow, and without this the first signal that a winery has
    // outgrown them is a rejected sync — long past the point where anything can
    // be done calmly. Reported only once it matters, so the normal response
    // stays unchanged.
    const pressure = assessFootprintPressure(
      measureStateFootprint(candidateDb),
      { maxRecords: MAX_SYNC_TOTAL_RECORDS, maxBytes: MAX_SYNC_BODY_BYTES },
    );

    return res.json({
      ...responseDb,
      ...(candidate.deletionRejected ? {
        deletionRejected: true,
        deletionError: candidate.deletionError,
      } : {}),
      ...(pressure.level === 'ok' ? {} : {
        stateFootprint: {
          level: pressure.level,
          recordsPct: Math.round(pressure.recordsPct * 100),
          bytesPct: Math.round(pressure.bytesPct * 100),
          topCollections: pressure.topCollections,
        },
      }),
    });
  }
});

// GET /api/db
router.get('/db', checkWineryScope('read'), async (req, res) => {
  const session = (req as any).wineryContext;

  const refreshed = await reloadUserOrganizationDataFromPostgres(session.username);
  let userDb = refreshed?.data || await getUserData(session.username);
  if (!userDb) {
    userDb = createEmptyUserData();
    await saveUserData(session.username, userDb);
  }
  await setOrganizationStateHeaders(res, session.username);
  res.json(redactWineryDatabaseForRole(session.role, userDb));
});

export default router;

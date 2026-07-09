import express from 'express';
import { checkWineryScope, setOrganizationStateHeaders } from '../middleware/auth';
import {
  getUserData,
  createEmptyUserData,
  saveUserData,
  saveDB,
  getDB,
  reloadUserOrganizationDataFromPostgres,
  OrganizationStateVersionConflictError,
} from '../db';
import { applyDeletions, mergeCollections, isValidId } from '../sync';
import { prepareAuditLogsForServerMerge } from '../../lib/auditHash';
import {
  attachmentMimeTypeMatchesInlineDataUrl,
  checksumAttachmentDataUrl,
  isAllowedInlineAttachmentDataUrl,
  isSupportedAttachmentMimeType,
  isSupportedAttachmentFileName,
  isValidAttachmentChecksum,
  MAX_INLINE_ATTACHMENT_BYTES,
  MAX_TOTAL_INLINE_ATTACHMENT_BYTES,
  normalizeExternalAttachmentUrl,
  sumInlineAttachmentBytes,
} from '../../lib/attachments';
import { can, canAccess, canSyncCollection, moduleForAttachmentKind, moduleForSyncCollection, type PermissionAction } from '../permissions';

const router = express.Router();

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
export function validateSyncPayload(userDb: any, collections: Record<string, any>, deletedIds: any): void {
  {
    // 1. Validate deletedIds syntax & block deletions of bottled lots or audit logs
    if (deletedIds !== undefined) {
      if (!Array.isArray(deletedIds)) {
        throw new Error('deletedIds must be an array');
      }
      for (const id of deletedIds) {
        if (!isValidId(id)) {
          throw new Error(`Invalid deleted ID syntax: ${id}`);
        }
        // Volatile Content Lock
        const existingLot = userDb.lots.find((l: any) => l.id === id);
        if (existingLot && existingLot.stage === 'bottled') {
          throw new Error(`Volatile Content Lock: Bottled wine lot ${id} cannot be deleted.`);
        }
        // Audit Immutability
        const existingAudit = userDb.auditLogs.find((l: any) => l.id === id);
        if (existingAudit) {
          throw new Error(`Audit Immutability: Deletion of audit log ${id} is forbidden.`);
        }
      }
    }

    // 2. Validate collections syntax and schema integrity
    for (const key of Object.keys(collections)) {
      if (key === 'users') {
        throw new Error('Modifying user credentials via sync is forbidden');
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
        for (const item of clientList) {
          if (!item || typeof item !== 'object') {
            throw new Error(`Items in ${key} must be valid objects`);
          }
          if (!isValidId(item.id)) {
            throw new Error(`Item in ${key} has invalid or missing ID: ${item.id}`);
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
            const blockDeleted = deletedIds && deletedIds.includes(item.blockId);
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
              const lotDeleted = deletedIds && deletedIds.includes(assignedLotId);
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

            if (initialVolume !== undefined && (typeof initialVolume !== 'number' || initialVolume < 0)) {
              throw new Error(`Lot ${item.id} initial volume cannot be negative.`);
            }
            if (currentVolume !== undefined && (typeof currentVolume !== 'number' || currentVolume < 0)) {
              throw new Error(`Lot ${item.id} volume cannot be negative.`);
            }

            if (existingLot && existingLot.stage === 'bottled') {
              if (currentVolume !== undefined && currentVolume < existingLot.currentVolume) {
                throw new Error(`Volatile Content Lock: Bottled wine lot ${item.id} volume cannot decrease.`);
              }
              const frozenFields = ['name', 'vintage', 'variety', 'vineyardBlock', 'region', 'wineClass', 'stage'];
              for (const field of frozenFields) {
                if (item[field] !== undefined && item[field] !== existingLot[field]) {
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
            if (!isValidId(item.lotId)) {
              throw new Error(`Fermentation log ${item.id} has invalid referenced lotId.`);
            }
            const hasTankRef = item.tankId !== undefined && item.tankId !== null && item.tankId !== '';
            if (hasTankRef && !isValidId(item.tankId)) {
              throw new Error(`Fermentation log ${item.id} has invalid referenced tankId.`);
            }
            const lotExists = (userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId))) &&
                              !(deletedIds && deletedIds.includes(item.lotId));
            const tankExists = !hasTankRef || ((userDb.vessels.some((v: any) => v.id === item.tankId) || (collections.vessels && collections.vessels.some((v: any) => v.id === item.tankId))) &&
                               !(deletedIds && deletedIds.includes(item.tankId)));
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
                              !(deletedIds && deletedIds.includes(item.lotId));
            const tankExists = (userDb.vessels.some((v: any) => v.id === item.tankId) || (collections.vessels && collections.vessels.some((v: any) => v.id === item.tankId))) &&
                               !(deletedIds && deletedIds.includes(item.tankId));
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
          }

          else if (key === 'bottlingRuns') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Bottling run ${item.id} has invalid referenced lotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const lotDeleted = deletedIds && deletedIds.includes(item.lotId);
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
                  const materialDeleted = deletedIds && deletedIds.includes(materialId as string);
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
              if (!locExists) {
                throw new Error(`Orphaned Bottling Run: ${item.id} references non-existent Storage Location (${item.storageLocationId}).`);
              }
            }
            if (item.storageMovementId && !isValidId(item.storageMovementId)) {
              throw new Error(`Bottling run ${item.id} has invalid storageMovementId.`);
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
          }

          else if (key === 'grapeIntakes') {
            if (!isValidId(item.createdLotId)) {
              throw new Error(`Grape intake ${item.id} has invalid referenced createdLotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.createdLotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.createdLotId));
            const lotDeleted = deletedIds && deletedIds.includes(item.createdLotId);
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
              const vesselDeleted = deletedIds && deletedIds.includes(item.destinationVesselId);
              if (!vesselExists || vesselDeleted) {
                throw new Error(`Orphaned Grape Intake: ${item.id} references non-existent or deleted Vessel (${item.destinationVesselId}).`);
              }
            }
            if (item.harvestRecordId) {
              if (!isValidId(item.harvestRecordId)) {
                throw new Error(`Grape intake ${item.id} has invalid harvestRecordId.`);
              }
              const harvestExists = userDb.harvests.some((h: any) => h.id === item.harvestRecordId) || (collections.harvests && collections.harvests.some((h: any) => h.id === item.harvestRecordId));
              const harvestDeleted = deletedIds && deletedIds.includes(item.harvestRecordId);
              if (!harvestExists || harvestDeleted) {
                throw new Error(`Orphaned Grape Intake: ${item.id} references non-existent or deleted Harvest (${item.harvestRecordId}).`);
              }
            }
          }

          else if (key === 'cellarOps') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Cellar operation ${item.id} has invalid referenced lotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const lotDeleted = deletedIds && deletedIds.includes(item.lotId);
            if (!lotExists || lotDeleted) {
              throw new Error(`Orphaned Cellar Operation: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }

            for (const vesselField of ['vesselId', 'vesselToId']) {
              if (item[vesselField]) {
                if (!isValidId(item[vesselField])) {
                  throw new Error(`Cellar operation ${item.id} has invalid ${vesselField}.`);
                }
                const vesselExists = userDb.vessels.some((v: any) => v.id === item[vesselField]) || (collections.vessels && collections.vessels.some((v: any) => v.id === item[vesselField]));
                const vesselDeleted = deletedIds && deletedIds.includes(item[vesselField]);
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
              const materialDeleted = deletedIds && deletedIds.includes(item.materialId);
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
          }

          else if (key === 'costEntries') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Cost entry ${item.id} has invalid referenced lotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const lotDeleted = deletedIds && deletedIds.includes(item.lotId);
            if (!lotExists || lotDeleted) {
              throw new Error(`Orphaned Cost Entry: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }
            if (typeof item.amount !== 'number') {
              throw new Error(`Cost entry ${item.id} amount must be a number.`);
            }
            if (item.quantity !== undefined && (typeof item.quantity !== 'number' || item.quantity < 0)) {
              throw new Error(`Cost entry ${item.id} quantity must be non-negative.`);
            }
            if (item.unitCost !== undefined && (typeof item.unitCost !== 'number' || item.unitCost < 0)) {
              throw new Error(`Cost entry ${item.id} unitCost must be non-negative.`);
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
            if (!isValidId(item.lotId)) {
              throw new Error(`Stock movement ${item.id} has invalid referenced lotId.`);
            }
            if (!isValidId(item.locationId)) {
              throw new Error(`Stock movement ${item.id} has invalid referenced locationId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const locExists = userDb.storageLocations?.some((l: any) => l.id === item.locationId) || (collections.storageLocations && collections.storageLocations.some((l: any) => l.id === item.locationId));
            if (!lotExists) {
              throw new Error(`Orphaned Stock Movement: ${item.id} references non-existent Lot (${item.lotId}).`);
            }
            if (!locExists) {
              throw new Error(`Orphaned Stock Movement: ${item.id} references non-existent Storage Location (${item.locationId}).`);
            }
            if (!['in', 'out'].includes(item.direction)) {
              throw new Error(`Stock movement ${item.id} has invalid direction.`);
            }
            if (typeof item.bottles !== 'number' || item.bottles < 0) {
              throw new Error(`Stock movement ${item.id} bottles must be non-negative.`);
            }
            if (item.sourceRef !== undefined && item.sourceRef !== null && item.sourceRef !== '' && !isValidId(item.sourceRef)) {
              throw new Error(`Stock movement ${item.id} has invalid sourceRef.`);
            }
          }

          else if (key === 'salesDispatches') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Sales dispatch ${item.id} has invalid referenced lotId.`);
            }
            if (!isValidId(item.locationId)) {
              throw new Error(`Sales dispatch ${item.id} has invalid referenced locationId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const locExists = userDb.storageLocations?.some((l: any) => l.id === item.locationId) || (collections.storageLocations && collections.storageLocations.some((l: any) => l.id === item.locationId));
            if (!lotExists) {
              throw new Error(`Orphaned Sales Dispatch: ${item.id} references non-existent Lot (${item.lotId}).`);
            }
            if (!locExists) {
              throw new Error(`Orphaned Sales Dispatch: ${item.id} references non-existent Storage Location (${item.locationId}).`);
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
            if (item.stockMovementId !== undefined && !isValidId(item.stockMovementId)) {
              throw new Error(`Sales dispatch ${item.id} has invalid stockMovementId.`);
            }
            if (item.salesOrderId !== undefined && item.salesOrderId !== null && item.salesOrderId !== '' && !isValidId(item.salesOrderId)) {
              throw new Error(`Sales dispatch ${item.id} has invalid salesOrderId.`);
            }
          }

          else if (key === 'salesOrders') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Sales order ${item.id} has invalid referenced lotId.`);
            }
            if (!isValidId(item.locationId)) {
              throw new Error(`Sales order ${item.id} has invalid referenced locationId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const locExists = userDb.storageLocations?.some((l: any) => l.id === item.locationId) || (collections.storageLocations && collections.storageLocations.some((l: any) => l.id === item.locationId));
            if (!lotExists) {
              throw new Error(`Orphaned Sales Order: ${item.id} references non-existent Lot (${item.lotId}).`);
            }
            if (!locExists) {
              throw new Error(`Orphaned Sales Order: ${item.id} references non-existent Storage Location (${item.locationId}).`);
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
            const lotDeleted = deletedIds && deletedIds.includes(item.lotId);
            if (!lotExists || lotDeleted) {
              throw new Error(`Orphaned Certification Record: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }
            if (item.bottlingRunId) {
              if (!isValidId(item.bottlingRunId)) {
                throw new Error(`Certification record ${item.id} has invalid bottlingRunId.`);
              }
              const runExists = userDb.bottlingRuns.some((r: any) => r.id === item.bottlingRunId) || (collections.bottlingRuns && collections.bottlingRuns.some((r: any) => r.id === item.bottlingRunId));
              const runDeleted = deletedIds && deletedIds.includes(item.bottlingRunId);
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
            if (!isSupportedAttachmentFileName(item.fileName)) {
              throw new Error(`Attachment ${item.id} has unsupported file type.`);
            }
            if (!['company', 'official_docs', 'certification', 'cadastre', 'qvevri', 'lab', 'vineyard_project', 'crm', 'other'].includes(item.module)) {
              throw new Error(`Attachment ${item.id} has invalid module.`);
            }
            if (!item.storage || typeof item.storage !== 'object' || !['inline', 'external', 'metadata_only'].includes(item.storage.kind)) {
              throw new Error(`Attachment ${item.id} has invalid storage kind.`);
            }
            if (item.sizeBytes !== undefined && (typeof item.sizeBytes !== 'number' || !Number.isFinite(item.sizeBytes) || item.sizeBytes < 0)) {
              throw new Error(`Attachment ${item.id} sizeBytes must be non-negative.`);
            }
            if (!isSupportedAttachmentMimeType(item.mimeType, item.fileName)) {
              throw new Error(`Attachment ${item.id} has unsupported MIME type.`);
            }
            if (item.storage.kind === 'inline') {
              if (!isAllowedInlineAttachmentDataUrl(item.storage.dataUrl, item.fileName)) {
                throw new Error(`Attachment ${item.id} inline storage requires a supported PDF, image, Office, or CSV data URL.`);
              }
              if (!attachmentMimeTypeMatchesInlineDataUrl(item.storage.dataUrl, item.mimeType, item.fileName)) {
                throw new Error(`Attachment ${item.id} MIME type does not match inline content.`);
              }
              if ((item.sizeBytes || 0) > MAX_INLINE_ATTACHMENT_BYTES || item.storage.dataUrl.length > MAX_INLINE_ATTACHMENT_BYTES * 2) {
                throw new Error(`Attachment ${item.id} is too large for inline sync.`);
              }
              if (item.checksum !== undefined && checksumAttachmentDataUrl(item.storage.dataUrl) !== String(item.checksum).toLowerCase()) {
                throw new Error(`Attachment ${item.id} checksum does not match inline content.`);
              }
            }
            if (item.storage.kind === 'external' && !normalizeExternalAttachmentUrl(item.storage.url)) {
              throw new Error(`Attachment ${item.id} external storage requires a valid HTTP(S) URL.`);
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
              const lotDeleted = deletedIds && deletedIds.includes(item.relatedLotId);
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
  }
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

function deletionTargetsForId(userDb: any, id: string): Array<{ collection: string; module: ReturnType<typeof moduleForSyncCollection>; action: PermissionAction }> {
  const targets: Array<{ collection: string; module: ReturnType<typeof moduleForSyncCollection>; action: PermissionAction }> = [];
  for (const [collection, value] of Object.entries(userDb || {})) {
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

function authorizeDeletedIds(role: string, userDb: any, deletedIds: any): string | null {
  if (!Array.isArray(deletedIds) || deletedIds.length === 0) return null;
  if (can(role, 'admin')) return null;

  for (const id of deletedIds) {
    if (!isValidId(id)) continue;
    const targets = deletionTargetsForId(userDb, id);
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

export function authorizeSyncPayload(role: string, userDb: any, collections: Record<string, any>, deletedIds: any): string | null {
  const deletionError = authorizeDeletedIds(role, userDb, deletedIds);
  if (deletionError) return deletionError;

  for (const [collection, incoming] of Object.entries(collections)) {
    if (!moduleForSyncCollection(collection)) {
      return `Forbidden: ${collection} is not an authorized sync collection.`;
    }
    if (collection === 'attachments' && Array.isArray(incoming)) {
      const existing = Array.isArray(userDb[collection]) ? userDb[collection] : [];
      const existingIds = new Set(existing.map((item: any) => item?.id).filter(Boolean));
      for (const item of incoming) {
        if (!item || typeof item !== 'object' || !item.id) continue;
        const module = moduleForAttachmentKind(item.module);
        if (!module) return `Forbidden: attachment ${item.id} has unknown module.`;
        const action: PermissionAction = existingIds.has(item.id) ? 'update' : 'create';
        if (!canAccess(role, module, action)) {
          return `Forbidden: ${role} cannot ${action} ${collection} for ${module}.`;
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
  const { deletedIds, ...collections } = req.body;

  // Optimistic-concurrency retry: a version conflict means another sync landed
  // between our reload and save. Per-item baselines make the merge idempotent,
  // so re-running it against the fresh state resolves the whole-document race
  // server-side instead of bouncing a 409 to the client. True same-field
  // conflicts are still reported per item via `conflicts`.
  const MAX_SAVE_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
    const refreshed = await reloadUserOrganizationDataFromPostgres(session.username);
    const expectedOrgStateVersion = refreshed?.meta.version ?? null;
    const userDb = refreshed?.data || await getUserData(session.username) || createEmptyUserData();
    // Baseline inline-attachment footprint before this sync mutates state, so
    // the budget guard below can allow shrinking syncs even when already at cap.
    const inlineBytesBefore = sumInlineAttachmentBytes(userDb.attachments);

    const permissionError = authorizeSyncPayload(session.role, userDb, collections, deletedIds);
    if (permissionError) {
      return res.status(403).json({ error: permissionError });
    }

    try {
      validateSyncPayload(userDb, collections, deletedIds);
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Validation error' });
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
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Audit validation error' });
    }

    // Apply deletions, then merge with optimistic-concurrency conflict detection.
    applyDeletions(userDb, deletedIds);
    const conflicts = mergeCollections(userDb, merging, session.organizationId);
    if (session.username === 'testuser1') {
      pruneTestUserSeedDuplicates(userDb);
    }

    // Org-wide inline-attachment budget. Inline blobs accumulate in the JSONB
    // state, so block syncs that GROW the footprint past the cap — but always
    // allow syncs that keep it flat or shrink it, so a user who is already at
    // the limit can still delete/externalize attachments to recover.
    const inlineBytesAfter = sumInlineAttachmentBytes(userDb.attachments);
    if (inlineBytesAfter > MAX_TOTAL_INLINE_ATTACHMENT_BYTES && inlineBytesAfter > inlineBytesBefore) {
      const capMb = (MAX_TOTAL_INLINE_ATTACHMENT_BYTES / 1_000_000).toFixed(0);
      return res.status(413).json({
        code: 'inline_attachment_budget_exceeded',
        error: `Inline attachment storage for this winery would exceed ${capMb} MB. Use an external HTTPS link or metadata-only storage for large files, or remove existing inline attachments.`,
      });
    }

    try {
      await saveUserData(session.username, userDb, {
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
          serverDb: latest?.data || userDb,
        });
      }
      throw err;
    }

    await setOrganizationStateHeaders(res, session.username);

    if (conflicts.length > 0) {
      return res.json({ hasConflicts: true, conflicts, serverDb: userDb });
    }
    return res.json(userDb);
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
  res.json(userDb);
});

export default router;

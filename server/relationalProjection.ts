interface OrganizationProjectionState {
  vessels?: any[];
  lots?: any[];
}

function vesselProjection(vessel: any, organizationId: string) {
  return {
    id: vessel.id,
    organizationId,
    type: vessel.type || '',
    shape: vessel.shape || '',
    capacity: Number(vessel.capacity) || 0,
    currentVolume: Number(vessel.currentVolume) || 0,
    assignedLotId: vessel.assignedLotId || null,
    cleaningStatus: vessel.cleaningStatus || 'clean',
    lastCleaned: vessel.lastCleaned || '',
    temperature: Number(vessel.temperature) || 0,
    coolingJacketActive: Boolean(vessel.coolingJacketActive),
    targetTemperature: vessel.targetTemperature !== undefined && vessel.targetTemperature !== null
      ? Number(vessel.targetTemperature)
      : null,
    lastOperation: vessel.lastOperation || '',
    locationDetails: vessel.locationDetails || null,
    xGrid: vessel.xGrid !== undefined && vessel.xGrid !== null ? Number(vessel.xGrid) : null,
    yGrid: vessel.yGrid !== undefined && vessel.yGrid !== null ? Number(vessel.yGrid) : null,
    lastSealedDate: vessel.lastSealedDate || null,
    soilTemperature: vessel.soilTemperature !== undefined && vessel.soilTemperature !== null
      ? Number(vessel.soilTemperature)
      : null,
    qvevriNumber: vessel.qvevriNumber || null,
    maraniLocation: vessel.maraniLocation || null,
    buried: vessel.buried !== undefined && vessel.buried !== null ? Boolean(vessel.buried) : null,
    lastWashingDate: vessel.lastWashingDate || null,
    limeWashStatus: vessel.limeWashStatus || null,
    waxingStatus: vessel.waxingStatus || null,
    inspectionNotes: vessel.inspectionNotes || null,
    fillingDate: vessel.fillingDate || null,
    grapeVariety: vessel.grapeVariety || null,
    chachaPercentage: vessel.chachaPercentage !== undefined && vessel.chachaPercentage !== null
      ? Number(vessel.chachaPercentage)
      : null,
    stemInclusion: vessel.stemInclusion !== undefined && vessel.stemInclusion !== null
      ? Boolean(vessel.stemInclusion)
      : null,
    mixingFrequency: vessel.mixingFrequency || null,
    dailyMixingLog: Array.isArray(vessel.dailyMixingLog) ? vessel.dailyMixingLog : [],
    sealingDate: vessel.sealingDate || null,
    openingDate: vessel.openingDate || null,
    skinContactDurationDays: vessel.skinContactDurationDays !== undefined && vessel.skinContactDurationDays !== null
      ? Number(vessel.skinContactDurationDays)
      : null,
    firstRackingDate: vessel.firstRackingDate || null,
    sanitationHistory: Array.isArray(vessel.sanitationHistory) ? vessel.sanitationHistory : [],
  };
}

function lotProjection(lot: any, organizationId: string) {
  return {
    id: lot.id,
    organizationId,
    name: lot.name || '',
    vintage: Number(lot.vintage) || 0,
    variety: lot.variety || '',
    vineyardBlock: lot.vineyardBlock || '',
    region: lot.region || '',
    initialVolume: Number(lot.initialVolume) || 0,
    currentVolume: Number(lot.currentVolume) || 0,
    wineClass: lot.wineClass || '',
    stage: lot.stage || '',
    createdAt: lot.createdAt || new Date(0).toISOString(),
    history: Array.isArray(lot.history) ? lot.history : [],
    sensoryProfile: lot.sensoryProfile || null,
  };
}

export async function syncVesselLotProjection(
  tx: any,
  organizationId: string,
  state: OrganizationProjectionState,
): Promise<void> {
  if (!tx?.vessel?.upsert || !tx?.wineLot?.upsert) {
    // Unit-test and legacy compatibility clients can omit non-authoritative
    // projection delegates. Deployed schema drift checks require them.
    return;
  }

  const vessels = (state.vessels || []).filter(item => item?.id);
  const lots = (state.lots || []).filter(item => item?.id);
  const vesselIds = vessels.map(item => item.id);
  const lotIds = lots.map(item => item.id);

  await tx.vessel.deleteMany({
    where: {
      organizationId,
      ...(vesselIds.length ? { id: { notIn: vesselIds } } : {}),
    },
  });
  await tx.wineLot.deleteMany({
    where: {
      organizationId,
      ...(lotIds.length ? { id: { notIn: lotIds } } : {}),
    },
  });

  for (const vessel of vessels) {
    const projected = vesselProjection(vessel, organizationId);
    const { id, organizationId: projectedOrganizationId, ...update } = projected;
    await tx.vessel.upsert({
      where: {
        organizationId_id: { organizationId, id },
      },
      update,
      create: { id, organizationId: projectedOrganizationId, ...update },
    });
  }
  for (const lot of lots) {
    const projected = lotProjection(lot, organizationId);
    const { id, organizationId: projectedOrganizationId, ...update } = projected;
    await tx.wineLot.upsert({
      where: {
        organizationId_id: { organizationId, id },
      },
      update,
      create: { id, organizationId: projectedOrganizationId, ...update },
    });
  }
}

export interface ProjectionMismatchSummary {
  vesselExpected: number;
  vesselActual: number;
  vesselMismatches: number;
  lotExpected: number;
  lotActual: number;
  lotMismatches: number;
  totalMismatches: number;
}

function comparable(value: any): string {
  return JSON.stringify(value);
}

export async function compareVesselLotProjection(
  prisma: any,
  organizationId: string,
  state: OrganizationProjectionState,
): Promise<ProjectionMismatchSummary> {
  const [storedVessels, storedLots] = await Promise.all([
    prisma.vessel.findMany({ where: { organizationId } }),
    prisma.wineLot.findMany({ where: { organizationId } }),
  ]);
  const expectedVessels = (state.vessels || [])
    .filter(item => item?.id)
    .map(item => vesselProjection(item, organizationId));
  const expectedLots = (state.lots || [])
    .filter(item => item?.id)
    .map(item => lotProjection(item, organizationId));
  const storedVesselsById = new Map(storedVessels.map((item: any) => [item.id, item]));
  const storedLotsById = new Map(storedLots.map((item: any) => [item.id, item]));

  let vesselMismatches = Math.max(0, storedVessels.length - expectedVessels.length);
  for (const expected of expectedVessels) {
    if (comparable(storedVesselsById.get(expected.id)) !== comparable(expected)) vesselMismatches += 1;
  }
  let lotMismatches = Math.max(0, storedLots.length - expectedLots.length);
  for (const expected of expectedLots) {
    if (comparable(storedLotsById.get(expected.id)) !== comparable(expected)) lotMismatches += 1;
  }

  return {
    vesselExpected: expectedVessels.length,
    vesselActual: storedVessels.length,
    vesselMismatches,
    lotExpected: expectedLots.length,
    lotActual: storedLots.length,
    lotMismatches,
    totalMismatches: vesselMismatches + lotMismatches,
  };
}

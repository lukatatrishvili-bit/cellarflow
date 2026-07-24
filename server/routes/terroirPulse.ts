import express from 'express';
import {
  OrganizationStateVersionConflictError,
  getDB,
  getPrismaClientForAdmin,
  reloadUserOrganizationDataFromPostgres,
  saveOrganizationData,
  type UserDataState,
} from '../db';
import { checkWineryScope } from '../middleware/auth';
import {
  buildTerroirPulse,
  normalizeTerroirSharingSettings,
  type TerroirPulsePublication,
  type TerroirPulseSource,
} from '../../lib/terroirPulse';

const router = express.Router();
const SHARING_ROLES = new Set(['Owner/Admin', 'Winemaker', 'Viticulturist']);

function boundedEnvironmentNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

async function publicSources(): Promise<TerroirPulseSource[]> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const rows = await prisma.organizationState.findMany({
      select: { organizationId: true, data: true },
    });
    return rows.map(row => ({
      organizationId: row.organizationId,
      data: (row.data || {}) as TerroirPulseSource['data'],
    }));
  }

  return Object.entries(getDB().orgData || {}).map(([organizationId, data]) => ({
    organizationId,
    data,
  }));
}

function applyPublicFilters(publication: TerroirPulsePublication, query: express.Request['query']): TerroirPulsePublication {
  const exactText = (value: unknown): string => typeof value === 'string' ? value.trim().slice(0, 100) : '';
  const country = exactText(query.country).toLocaleLowerCase();
  const region = exactText(query.region).toLocaleLowerCase();
  const variety = exactText(query.variety).toLocaleLowerCase();
  const level = query.level === 'region' || query.level === 'terroir' ? query.level : '';
  const vintage = /^\d{4}$/.test(exactText(query.vintage)) ? Number(query.vintage) : null;
  return {
    ...publication,
    groups: publication.groups.filter(group => (
      (!country || group.country.toLocaleLowerCase() === country)
      && (!region || group.region.toLocaleLowerCase() === region)
      && (!variety || group.variety.toLocaleLowerCase() === variety)
      && (!level || group.level === level)
      && (!vintage || group.vintage === vintage)
    )),
  };
}

// Public by design. This endpoint returns only thresholded aggregates; it never
// returns organization IDs, block IDs, coordinates, or record-level values.
router.get('/', async (req, res) => {
  try {
    const publication = buildTerroirPulse(await publicSources(), {
      minimumContributors: boundedEnvironmentNumber('TERROIR_PULSE_MIN_CONTRIBUTORS', 5, 3, 50),
      minimumHectares: boundedEnvironmentNumber('TERROIR_PULSE_MIN_HECTARES', 5, 0, 100_000),
      maximumContributorShare: boundedEnvironmentNumber('TERROIR_PULSE_MAX_CONTRIBUTOR_SHARE', 0.4, 0.2, 1),
      publicationDelayDays: boundedEnvironmentNumber('TERROIR_PULSE_DELAY_DAYS', 7, 0, 90),
    });
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json(applyPublicFilters(publication, req.query));
  } catch (error) {
    console.error('[terroir-pulse] public aggregation failed:', error);
    res.status(503).json({ error: 'Terroir Pulse is temporarily unavailable.' });
  }
});

router.get('/settings', checkWineryScope('read'), async (req, res) => {
  const session = (req as any).wineryContext as { username: string; role: string; organizationId: string };
  if (!SHARING_ROLES.has(session.role)) {
    return res.status(403).json({ error: 'Only owners, winemakers, and viticulturists can manage data sharing.' });
  }
  const refreshed = await reloadUserOrganizationDataFromPostgres(session.username);
  const data = refreshed?.data || getDB().orgData?.[session.organizationId];
  if (!data) return res.status(404).json({ error: 'Organization data was not found.' });
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  const blockIds = blocks.map(block => String(block?.id || '')).filter(Boolean);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    settings: normalizeTerroirSharingSettings(data.terroirSharing, blockIds),
    blocks: blocks.map(block => ({
      id: String(block?.id || ''),
      name: String(block?.name || 'Unnamed block').slice(0, 120),
      variety: String(block?.grapeVariety || '').slice(0, 100),
      area: Number.isFinite(Number(block?.area)) ? Number(block.area) : 0,
      region: String(data.companyProfile?.region || '').slice(0, 100),
      terroir: String(
        block?.microzone
        || block?.village
        || block?.community
        || block?.municipality
        || data.companyProfile?.region
        || 'Unspecified',
      ).slice(0, 100),
    })),
  });
});

router.put('/settings', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext as { username: string; role: string; organizationId: string };
  if (!SHARING_ROLES.has(session.role)) {
    return res.status(403).json({ error: 'Only owners, winemakers, and viticulturists can manage data sharing.' });
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const refreshed = await reloadUserOrganizationDataFromPostgres(session.username);
    const existing = refreshed?.data || getDB().orgData?.[session.organizationId];
    if (!existing) return res.status(404).json({ error: 'Organization data was not found.' });
    const blockIds = (Array.isArray(existing.blocks) ? existing.blocks : [])
      .map(block => String(block?.id || ''))
      .filter(Boolean);
    const requestedBlockIds = Array.isArray(req.body?.selectedBlockIds)
      ? req.body.selectedBlockIds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : [];
    const unknownBlockIds = requestedBlockIds.filter((blockId: string) => !blockIds.includes(blockId));
    if (unknownBlockIds.length > 0) {
      return res.status(400).json({ error: 'One or more selected vineyard blocks no longer exist.' });
    }

    const currentSettings = normalizeTerroirSharingSettings(existing.terroirSharing, blockIds);
    const requested = normalizeTerroirSharingSettings(req.body, blockIds);
    if (requested.enabled && requested.selectedBlockIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one vineyard block before enabling sharing.' });
    }
    if (requested.enabled && !requested.shareSampling && !requested.shareHarvest) {
      return res.status(400).json({ error: 'Select at least one data category before enabling sharing.' });
    }
    const defaultAttribution = String(
      existing.companyProfile?.wineryName || existing.companyProfile?.companyName || '',
    ).trim().slice(0, 100);
    const now = new Date().toISOString();
    const nextSettings = {
      enabled: requested.enabled,
      privacyMode: requested.privacyMode,
      selectedBlockIds: requested.selectedBlockIds,
      shareSampling: requested.shareSampling,
      shareHarvest: requested.shareHarvest,
      attributionName: requested.privacyMode === 'attributed'
        ? requested.attributionName || defaultAttribution
        : '',
      consentVersion: 1 as const,
      ...(requested.enabled ? {
        acceptedAt: currentSettings.enabled ? currentSettings.acceptedAt || now : now,
      } : {}),
      updatedAt: now,
      updatedBy: session.username,
    };
    if (requested.enabled && requested.privacyMode === 'attributed' && !nextSettings.attributionName) {
      return res.status(400).json({ error: 'Add a public contributor name before enabling attributed sharing.' });
    }

    const candidate: UserDataState = { ...existing, terroirSharing: nextSettings };
    try {
      await saveOrganizationData(session.organizationId, candidate, {
        expectedVersion: refreshed?.meta.version ?? null,
        updatedBy: `terroir-sharing:${session.username}`,
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ settings: nextSettings });
    } catch (error) {
      if (error instanceof OrganizationStateVersionConflictError && attempt < 3) continue;
      if (error instanceof OrganizationStateVersionConflictError) {
        return res.status(409).json({ error: 'Organization data changed while saving. Please try again.' });
      }
      throw error;
    }
  }

  return res.status(409).json({ error: 'Organization data changed while saving. Please try again.' });
});

export default router;

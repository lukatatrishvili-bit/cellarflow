import type { Vessel, WineLot } from './wineryState';
import { planTopping, type ToppingIssue, type ToppingPlan } from './topping';

/**
 * Topping many barrels from one vessel, in one go.
 *
 * This is what topping is actually for. A cellar hand does twenty barrels in a
 * morning from a single topping tank, and doing that one form at a time is the
 * friction that stops the job being recorded at all. The map already knows
 * which barrels you mean — you pointed at them — so the only questions left are
 * where the wine comes from and how much goes in each.
 *
 * Planning is separate from doing, and deliberately so: the operator sees the
 * whole batch before any of it is written, including which barrels will be
 * skipped and why, and whether the source can actually cover the total.
 */

export interface BatchToppingEntry {
  vesselId: string;
  /** Present only when this barrel can actually be topped. */
  plan?: ToppingPlan;
  /** Why this barrel is being skipped. */
  issue?: ToppingIssue;
}

export interface BatchToppingPreview {
  entries: BatchToppingEntry[];
  /** Barrels that will be topped. */
  toppable: BatchToppingEntry[];
  skipped: BatchToppingEntry[];
  /** Litres the source must give up in total. */
  totalDrawL: number;
  /** How much more the source would need to cover every toppable barrel. */
  shortfallL: number;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Work out what a batch would do.
 *
 * Each barrel is checked against the source's *running* balance rather than
 * its opening one, so a source that covers four of six barrels reports the
 * last two as short instead of promising all six and failing partway through.
 */
export function planBatchTopping(input: {
  sourceVesselId: string;
  targetVesselIds: string[];
  litresPerVessel: number;
  vessels: Vessel[];
  lots: WineLot[];
}): BatchToppingPreview {
  const { sourceVesselId, targetVesselIds, litresPerVessel, vessels, lots } = input;
  const byId = new Map(vessels.map(vessel => [vessel.id, vessel]));
  const sourceVessel = byId.get(sourceVesselId);

  let remainingSource = sourceVessel?.currentVolume ?? 0;
  let totalDrawL = 0;
  let shortfallL = 0;
  const entries: BatchToppingEntry[] = [];

  for (const vesselId of targetVesselIds) {
    if (vesselId === sourceVesselId) {
      entries.push({ vesselId, issue: 'same_vessel' });
      continue;
    }
    const vessel = byId.get(vesselId);
    if (!vessel) {
      entries.push({ vesselId, issue: 'unknown_source_vessel' });
      continue;
    }
    if (!vessel.assignedLotId) {
      // The barrel being topped must hold something to top up.
      entries.push({ vesselId, issue: 'source_has_no_lot' });
      continue;
    }

    // Checked against what the source has left after the earlier barrels, so a
    // partial batch is honest about which ones it can cover.
    const checked = planTopping({
      toppedVessel: vessel,
      toppedLotId: vessel.assignedLotId,
      sourceVesselId,
      vessels: sourceVessel
        ? vessels.map(entry => (entry.id === sourceVesselId ? { ...entry, currentVolume: remainingSource } : entry))
        : vessels,
      lots,
      volumeL: litresPerVessel,
    });

    if (!checked.ok) {
      if (checked.issue === 'insufficient_source') shortfallL = round3(shortfallL + litresPerVessel);
      entries.push({ vesselId, issue: checked.issue });
      continue;
    }

    remainingSource = round3(remainingSource - checked.plan.volumeL);
    totalDrawL = round3(totalDrawL + checked.plan.volumeL);
    entries.push({ vesselId, plan: checked.plan });
  }

  return {
    entries,
    toppable: entries.filter(entry => entry.plan),
    skipped: entries.filter(entry => !entry.plan),
    totalDrawL,
    shortfallL,
  };
}

/**
 * The largest per-barrel amount that would let every selected barrel be topped
 * from this source. Offered as a suggestion when a batch comes up short, so the
 * answer to "it does not fit" is a number rather than trial and error.
 */
export function maxLitresPerVessel(input: {
  sourceVesselId: string;
  targetVesselIds: string[];
  vessels: Vessel[];
}): number {
  const { sourceVesselId, targetVesselIds, vessels } = input;
  const byId = new Map(vessels.map(vessel => [vessel.id, vessel]));
  const source = byId.get(sourceVesselId);
  if (!source) return 0;

  const eligible = targetVesselIds
    .filter(id => id !== sourceVesselId)
    .map(id => byId.get(id))
    .filter((vessel): vessel is Vessel => Boolean(vessel?.assignedLotId));
  if (!eligible.length) return 0;

  const bySource = (source.currentVolume || 0) / eligible.length;
  // Never more than the tightest barrel's headroom, or that barrel overflows.
  const byHeadroom = Math.min(
    ...eligible.map(vessel => Math.max(0, (vessel.capacity || 0) - (vessel.currentVolume || 0))),
  );
  return Math.floor(Math.min(bySource, byHeadroom) * 10) / 10;
}

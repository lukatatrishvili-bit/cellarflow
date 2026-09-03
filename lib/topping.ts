import type { Vessel, WineLot } from './wineryState';

/**
 * Topping: replacing what a barrel loses to evaporation.
 *
 * It was the one routine cellar job with no way to record it. `vessel_filling`
 * is not the same thing — that is filling an empty vessel, a dedicated workflow
 * that moves a lot into a container. Topping is a small, repeated addition of
 * make-up wine into a vessel that is already working, and it does three things
 * at once: the topped vessel gains volume, the source loses it, and the topped
 * lot's composition and cost now include a fraction of the topping wine.
 *
 * Modelled here rather than as a transfer because of how it is actually done —
 * twenty barrels in a morning, from one topping vessel. Sending each one
 * through the full transfer workflow is the friction that stops people
 * recording it at all, and unrecorded topping is how a lot's stated volume
 * drifts away from what is in the cellar.
 */

export interface ToppingPlan {
  toppedVesselId: string;
  toppedLotId: string;
  sourceVesselId: string;
  sourceLotId: string;
  /** Litres moved from source to topped vessel. Always positive. */
  volumeL: number;
  /** Source volumes before the move, for the cost-side weighted average. */
  sourceLotVolumeBefore: number;
}

export type ToppingIssue =
  | 'no_volume'
  | 'same_vessel'
  | 'unknown_source_vessel'
  | 'source_has_no_lot'
  | 'insufficient_source'
  | 'over_capacity';

export type ToppingCheck =
  | { ok: true; plan: ToppingPlan }
  | { ok: false; issue: ToppingIssue };

/** Litres are stored to 3 dp elsewhere; keep topping consistent with that. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function toppingIssueMessage(issue: ToppingIssue, lang: 'en' | 'ka'): string {
  const ka = lang === 'ka';
  switch (issue) {
    case 'no_volume':
      return ka ? 'მიუთითეთ დოლივის მოცულობა.' : 'Enter how much wine was added.';
    case 'same_vessel':
      return ka ? 'ჭურჭელი საკუთარი თავიდან ვერ შეივსება.' : 'A vessel cannot be topped from itself.';
    case 'unknown_source_vessel':
      return ka ? 'დოლივის წყარო ჭურჭელი ვერ მოიძებნა.' : 'That topping source vessel does not exist.';
    case 'source_has_no_lot':
      return ka ? 'წყარო ჭურჭელში პარტია არ არის.' : 'The topping source vessel holds no lot.';
    case 'insufficient_source':
      return ka ? 'წყარო ჭურჭელში საკმარისი ღვინო არ არის.' : 'The topping source does not hold that much wine.';
    case 'over_capacity':
      return ka ? 'დოლივა ჭურჭლის ტევადობას სცდება.' : 'Topping would take the vessel past its capacity.';
  }
}

/**
 * Check a topping before anything is written.
 *
 * Deliberately refuses rather than clamping. Silently topping by less than
 * asked would leave the recorded volume and the barrel disagreeing, which is
 * the exact drift this operation exists to prevent.
 */
export function planTopping(input: {
  toppedVessel: Vessel;
  toppedLotId: string;
  sourceVesselId: string;
  vessels: Vessel[];
  lots: WineLot[];
  volumeL: number;
}): ToppingCheck {
  const { toppedVessel, toppedLotId, sourceVesselId, vessels, lots, volumeL } = input;

  if (!(volumeL > 0) || !Number.isFinite(volumeL)) return { ok: false, issue: 'no_volume' };
  if (sourceVesselId === toppedVessel.id) return { ok: false, issue: 'same_vessel' };

  const sourceVessel = vessels.find(vessel => vessel.id === sourceVesselId);
  if (!sourceVessel) return { ok: false, issue: 'unknown_source_vessel' };

  const sourceLotId = sourceVessel.assignedLotId;
  if (!sourceLotId) return { ok: false, issue: 'source_has_no_lot' };

  const volume = round3(volumeL);
  if ((sourceVessel.currentVolume || 0) < volume) return { ok: false, issue: 'insufficient_source' };
  if (round3((toppedVessel.currentVolume || 0) + volume) > (toppedVessel.capacity || 0)) {
    return { ok: false, issue: 'over_capacity' };
  }

  const sourceLot = lots.find(lot => lot.id === sourceLotId);

  return {
    ok: true,
    plan: {
      toppedVesselId: toppedVessel.id,
      toppedLotId,
      sourceVesselId,
      sourceLotId,
      volumeL: volume,
      sourceLotVolumeBefore: sourceLot?.currentVolume ?? sourceVessel.currentVolume ?? 0,
    },
  };
}

export interface ToppingEffect {
  vessels: Vessel[];
  lots: WineLot[];
}

/**
 * Both ends of a topping, in litres moved rather than a resulting total.
 *
 * The generic volume path every other operation uses sets the lot AND the
 * operating vessel to one `volumeAfterL`, which quietly assumes a lot lives in
 * exactly one vessel. Topping is the case where that assumption breaks in
 * ordinary use: a lot spread across twenty barrels is topped one barrel at a
 * time, and writing the lot's new total onto a single barrel would put 880 L
 * into a 225 L container. So topping moves litres explicitly and does not
 * borrow that path.
 *
 * Split into a vessel half and a lot half because React state updates arrive
 * one collection at a time; `applyTopping` composes them for testing.
 */
export function toppingVessels(
  plan: ToppingPlan,
  vessels: Vessel[],
  description: string,
): Vessel[] {
  return vessels.map(vessel => {
    if (vessel.id === plan.sourceVesselId) {
      return {
        ...vessel,
        currentVolume: Math.max(0, round3((vessel.currentVolume || 0) - plan.volumeL)),
        lastOperation: description,
      };
    }
    if (vessel.id === plan.toppedVesselId) {
      return {
        ...vessel,
        currentVolume: round3((vessel.currentVolume || 0) + plan.volumeL),
        lastOperation: description,
      };
    }
    return vessel;
  });
}

export function toppingLots(
  plan: ToppingPlan,
  lots: WineLot[],
  entry: { date: string; operator: string; description: string },
): WineLot[] {
  return lots.map(lot => {
    if (lot.id === plan.sourceLotId) {
      return {
        ...lot,
        currentVolume: Math.max(0, round3((lot.currentVolume || 0) - plan.volumeL)),
        history: [
          { date: entry.date, type: 'Topping', description: entry.description, operator: entry.operator },
          ...(lot.history || []),
        ],
      };
    }
    // The topped lot's own timeline entry is written by the operation handler
    // alongside every other operation's; only its volume moves here.
    if (lot.id === plan.toppedLotId) {
      return { ...lot, currentVolume: round3((lot.currentVolume || 0) + plan.volumeL) };
    }
    return lot;
  });
}

export function applyTopping(input: {
  plan: ToppingPlan;
  vessels: Vessel[];
  lots: WineLot[];
  date: string;
  operator: string;
  description: string;
}): ToppingEffect {
  const { plan, vessels, lots, date, operator, description } = input;
  return {
    vessels: toppingVessels(plan, vessels, description),
    lots: toppingLots(plan, lots, { date, operator, description }),
  };
}

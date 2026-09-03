import type { CellarOperationType, Vessel } from './wineryState';
import { CELLAR_OPERATIONS, QUICK_CELLAR_OPERATIONS } from './wineryOperations';

/**
 * Turning what someone types in the command palette into cellar work.
 *
 * The palette could already find things; it could not do anything. Typing
 * "rack T-101 T-204" found a tank, and then you navigated to the transfers
 * screen and typed the same two tanks again.
 *
 * A parsed action never executes on its own. It resolves to an intent that
 * opens the matching recorder pre-filled, and a person confirms there. Moving
 * wine because a fuzzy text match looked right is precisely the kind of thing
 * that should not happen without someone reading it back — a mistyped "1200"
 * is a very different afternoon from a mistyped search.
 */

export type PaletteAction =
  | { kind: 'transfer'; sourceVesselId: string; destinationVesselId: string; litres?: number }
  | { kind: 'operation'; vesselId: string; type: CellarOperationType; litres?: number };

export interface ParsedPaletteAction {
  action: PaletteAction;
  /** What the palette row says this will do. */
  title: string;
  /** The reminder that nothing is written yet. */
  detail: string;
}

/**
 * Verbs, and what they mean here. `rack` is a transfer rather than the
 * `racking` operation because moving wine between vessels goes through the
 * transfer workflow — the operation of that name is the dedicated one the quick
 * recorder refuses.
 */
const TRANSFER_VERBS = ['rack', 'racking', 'transfer', 'move', 'გადატანა'];

const OPERATION_ALIASES: Record<string, CellarOperationType> = {
  top: 'topping',
  topping: 'topping',
  'top-up': 'topping',
  დოლივა: 'topping',
  so2: 'sulfitation',
  sulfite: 'sulfitation',
  sulphite: 'sulfitation',
  sulfitation: 'sulfitation',
  სულფიტაცია: 'sulfitation',
  add: 'additive',
  additive: 'additive',
  fine: 'fining',
  fining: 'fining',
  filter: 'filtration',
  filtration: 'filtration',
  stabilise: 'stabilization',
  stabilize: 'stabilization',
  stabilization: 'stabilization',
  pumpover: 'pumpover',
  pump: 'pumpover',
  remontage: 'pumpover',
  punchdown: 'punchdown',
  punch: 'punchdown',
  measure: 'measurement',
  temp: 'measurement',
  brix: 'measurement',
  check: 'measurement',
  press: 'pressing',
  pressing: 'pressing',
  crush: 'crush_destem',
};

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Vessels are matched by exact id first, then by a prefix that names exactly
 * one. An ambiguous prefix resolves to nothing rather than guessing — picking
 * the alphabetically-first of `T-1`, `T-10` and `T-12` would be a coin toss
 * with wine on it.
 */
function matchVessel(token: string | undefined, vessels: Vessel[]): Vessel | null {
  const wanted = normalise(token || '');
  if (!wanted) return null;
  const exact = vessels.find(vessel => normalise(vessel.id) === wanted);
  if (exact) return exact;
  const prefixed = vessels.filter(vessel => normalise(vessel.id).startsWith(wanted));
  return prefixed.length === 1 ? prefixed[0] : null;
}

function parseLitres(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const value = Number(token.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function operationLabel(type: CellarOperationType, ka: boolean): string {
  const meta = CELLAR_OPERATIONS.find(entry => entry.key === type);
  return (ka ? meta?.ka : meta?.en) || type;
}

/**
 * Parse a palette query into an action, or nothing.
 *
 * Returns nothing rather than a partial guess whenever the vessels named do not
 * resolve, so an incomplete phrase quietly falls through to ordinary search
 * results instead of offering to do something half-understood.
 */
export function parsePaletteAction(input: {
  query: string;
  vessels: Vessel[];
  lang?: string;
}): ParsedPaletteAction | null {
  const ka = input.lang === 'ka';
  const tokens = input.query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const [verb, ...rest] = tokens;
  const verbKey = normalise(verb);

  if (TRANSFER_VERBS.includes(verbKey)) {
    const source = matchVessel(rest[0], input.vessels);
    const destination = matchVessel(rest[1], input.vessels);
    if (!source || !destination || source.id === destination.id) return null;
    const litres = parseLitres(rest[2]);
    return {
      action: {
        kind: 'transfer',
        sourceVesselId: source.id,
        destinationVesselId: destination.id,
        ...(litres !== undefined ? { litres } : {}),
      },
      title: ka
        ? `გადატანა: ${source.id} → ${destination.id}${litres ? ` · ${litres} ლ` : ''}`
        : `Transfer ${source.id} → ${destination.id}${litres ? ` · ${litres} L` : ''}`,
      detail: ka ? 'გაიხსნება დასადასტურებლად' : 'Opens pre-filled for you to confirm',
    };
  }

  const type = OPERATION_ALIASES[verbKey];
  if (!type) return null;
  // Only the quick operations; the dedicated ones have their own workflows and
  // the inline recorder refuses them.
  if (!QUICK_CELLAR_OPERATIONS.some(entry => entry.key === type)) return null;

  const vessel = matchVessel(rest[0], input.vessels);
  if (!vessel) return null;
  const litres = parseLitres(rest[1]);

  return {
    action: {
      kind: 'operation',
      vesselId: vessel.id,
      type,
      ...(litres !== undefined ? { litres } : {}),
    },
    title: ka
      ? `${operationLabel(type, true)}: ${vessel.id}${litres ? ` · ${litres} ლ` : ''}`
      : `${operationLabel(type, false)} on ${vessel.id}${litres ? ` · ${litres} L` : ''}`,
    detail: ka ? 'გაიხსნება დასადასტურებლად' : 'Opens pre-filled for you to confirm',
  };
}

/** The examples shown when the palette is empty, so the verbs are discoverable. */
export function paletteActionHints(ka: boolean): string[] {
  return ka
    ? ['დოლივა T-101 5', 'გადატანა T-101 T-204 1200', 'so2 T-101']
    : ['top B-01 5', 'rack T-101 T-204 1200', 'so2 T-101'];
}

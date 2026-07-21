import type { GrapeIntakeRecord } from './wineryState';

export function isHarvestIntakeReversal(intake: GrapeIntakeRecord): boolean {
  return intake.recordKind === 'reversal';
}

/** True only for receipts that still represent physical fruit in the winery. */
export function isActiveHarvestIntake(intake: GrapeIntakeRecord): boolean {
  return !isHarvestIntakeReversal(intake) && !intake.reversedByCommandId && !intake.reversedAt;
}

/** Signed multiplier for immutable receiving and reporting ledgers. */
export function harvestIntakeLedgerSign(intake: GrapeIntakeRecord): 1 | -1 {
  return isHarvestIntakeReversal(intake) ? -1 : 1;
}

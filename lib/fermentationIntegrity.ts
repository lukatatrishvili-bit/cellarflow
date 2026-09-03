import type { DailyFermLog } from './wineryState';

/** A correction row documents compensation; it is never a physical reading. */
export function isFermentationCompletionReversal(log: DailyFermLog): boolean {
  return log.recordKind === 'reversal' || Boolean(log.reversalOfLogId || log.reversalOfCommandId);
}

/** Physical readings remain chartable even when their completion effect was reversed. */
export function isPhysicalFermentationReading(log: DailyFermLog): boolean {
  return !isFermentationCompletionReversal(log);
}

/** Only an uncompensated completion currently closes the campaign. */
export function isActiveFermentationCompletion(log: DailyFermLog): boolean {
  return isPhysicalFermentationReading(log)
    && log.isCompletion === true
    && !log.reversedByCommandId
    && !log.reversedAt;
}

/** A fresh, ordinary reading can be promoted to completion evidence. */
export function isCompletableFermentationReading(log: DailyFermLog): boolean {
  return isPhysicalFermentationReading(log)
    && !log.commandId
    && log.isCompletion !== true;
}

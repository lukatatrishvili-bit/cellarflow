import type { CellarOperation } from './wineryState';

type CellarOperationIntegrityFields = Pick<
  CellarOperation,
  'recordKind' | 'reversalOfOperationId' | 'reversedByCommandId' | 'reversedAt'
>;

/** A correction is an append-only compensating ledger fact. */
export function isCellarOperationReversal(operation: CellarOperationIntegrityFields): boolean {
  return operation.recordKind === 'reversal' || Boolean(operation.reversalOfOperationId);
}

/** Active operations are the physical treatments that still affect current state. */
export function isActiveCellarOperation(operation: CellarOperationIntegrityFields): boolean {
  return !isCellarOperationReversal(operation)
    && !operation.reversedByCommandId
    && !operation.reversedAt;
}

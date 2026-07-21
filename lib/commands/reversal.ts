/** Shared reference carried by every domain-specific reversal command. */
export interface CommandReversalReferencePayload {
  originalCommandId: string;
  reason: string;
}

/** Shared receipt facts returned by every successfully compensated command. */
export interface CommandReversalReceipt {
  originalCommandId: string;
  reversalCommandId: string;
  reason: string;
  reversedAt: string;
}

export const REVERSAL_REASON_MAX_LENGTH = 500;

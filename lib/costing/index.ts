/**
 * Public API for the cost-accounting engine.
 *   summarizeLot / rollupLots  — cost per lot, per litre, per bottle
 *   computeBlendTransfers      — WAC cost movement between blended lots
 *   marginPct / valuation      — profitability & finished-goods valuation
 */
export * from './types';
export {
  round2,
  summarizeLot,
  perUnit,
  marginPct,
  valuation,
  rollupLots,
  computeBlendTransfers,
  totalLedger,
} from './engine';

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Guards the single completion signal the plan-fulfilment loop hangs off.
 *
 * A recorded operation reaches state by three different routes: the durable
 * command round-trip, local application of that same command when the command
 * store is unavailable (the offline and JSON-backend path), and a bare
 * `onAddOperation` fallback when the command bindings are absent. Settling
 * planned work from the state hook's write funnels therefore misses the very
 * path a cellar hand on a phone would take — which is how this was first wired,
 * and it silently did nothing.
 *
 * `onOperationLogged` is the one thing every route agrees on, so App settles
 * planned work there. This test fails if a fourth route appears without it, or
 * if an existing one stops firing it.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

describe('operation completion signal', () => {
  const source = read('components/CellarOperationsTab.tsx');

  it('fires onOperationLogged from every path that records an operation', () => {
    // The three success sites, plus room for the guard to notice a new one.
    const signals = source.match(/onOperationLogged\?\.\(/g) || [];
    expect(signals.length).toBe(3);
  });

  it('has no success path that writes operations without announcing it', () => {
    // Each function that commits an operation must reach the callback before it
    // returns. Checked by pairing every commit marker with a following signal.
    const commitMarkers = [
      'const operationId = onAddOperation(intent.payload.operation);',
      'onUpdateOperations?.(applied.state.cellarOps);',
      'onApplyCellarOperationCommandResponse(response);',
    ];

    for (const marker of commitMarkers) {
      const at = source.indexOf(marker);
      expect(at, `commit marker moved or was renamed: ${marker}`).toBeGreaterThan(-1);
      const following = source.slice(at, at + 1200);
      expect(
        following.includes('onOperationLogged?.('),
        `no completion signal follows: ${marker}`,
      ).toBe(true);
    }
  });

  it('settles planned work from that callback rather than the state hook', () => {
    const app = read('src/App.tsx');
    const hook = read('hooks/useWineryState.ts');

    // App reacts to the recorder's own signal.
    expect(app).toContain('onOperationLogged={handleVesselOperationLogged}');
    expect(app).toContain("state.signalPlanRecord('operation')");

    // The hook's operation write funnels must not settle it a second time.
    expect(hook).not.toContain("signalPlanRecord('operation')");
  });

  it('keeps the transfer recorder on the same contract', () => {
    const transfers = read('components/TransfersTab.tsx');
    const app = read('src/App.tsx');
    const hook = read('hooks/useWineryState.ts');

    // Two write paths, both announcing.
    expect((transfers.match(/onTransferLogged\?\.\(\)/g) || []).length).toBe(2);
    expect(app).toContain('onTransferLogged={signalTransferRecorded}');
    expect(hook).not.toContain("signalPlanRecord('transfer')");
  });

  it('leaves lab analyses on the hook, where their only write path is', () => {
    const labs = read('components/LabsTab.tsx');
    const hook = read('hooks/useWineryState.ts');

    // LabsTab submits through a single callback, so the hook is the recorder.
    expect(labs).toContain('onAddLabLog(event);');
    expect((labs.match(/onAddLabLog\(/g) || []).length).toBeLessThanOrEqual(3);
    expect(hook).toContain("signalPlanRecord('lab')");
  });
});

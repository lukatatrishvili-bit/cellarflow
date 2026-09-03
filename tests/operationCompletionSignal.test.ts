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
 * All three now live in `hooks/useOperationExecution.ts`, shared by the
 * treatments screen and the cellar map's inline recorder, and each reports
 * through `onApplied`. Callers turn that into `onOperationLogged`, which is what
 * App settles planned work on. This test fails if a fourth route appears without
 * reporting, or if an existing one stops.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

describe('operation completion signal', () => {
  const source = read('hooks/useOperationExecution.ts');

  it('reports from every path that records an operation', () => {
    // The three success sites, plus room for the guard to notice a new one.
    const signals = source.match(/deps\.onApplied\?\.\(/g) || [];
    expect(signals.length).toBe(3);
  });

  it('has no success path that writes operations without reporting it', () => {
    // Each route must reach the callback before it returns. Checked by pairing
    // every commit marker with a following report.
    const commitMarkers = [
      'const id = deps.onAddOperation(intent.payload.operation);',
      'deps.onUpdateOperations?.(applied.state.cellarOps);',
      'deps.onApplyCommandResponse(response);',
    ];

    for (const marker of commitMarkers) {
      const at = source.indexOf(marker);
      expect(at, `commit marker moved or was renamed: ${marker}`).toBeGreaterThan(-1);
      const following = source.slice(at, at + 1200);
      expect(
        following.includes('deps.onApplied?.('),
        `no completion report follows: ${marker}`,
      ).toBe(true);
    }
  });

  it('keeps both recorders on that shared path', () => {
    // The treatments screen and the map dialog must not grow private copies of
    // the commit routes; preventing that is what this hook is for.
    for (const file of ['components/CellarOperationsTab.tsx', 'src/App.tsx']) {
      expect(read(file)).toContain('useOperationExecution');
    }
    expect(read('components/CellarOperationsTab.tsx')).not.toContain('submitCellarOperationCommand(');
  });

  it('settles planned work from every recorder, not only the full screens', () => {
    // The recorders that were added after the fulfilment loop — the shell
    // dialogs reachable from the map, the vessel drawer and the command
    // palette, plus batch topping — each bypassed it, because the signal was
    // wired to the two full screens rather than to the shared commit path.
    // Every hook instance in App must report.
    const app = read('src/App.tsx');
    const hooks = ['useTransferExecution', 'useOperationExecution', 'useBatchTopping'];
    for (const hook of hooks) {
      const at = app.indexOf(`${hook}({`);
      expect(at, `${hook} is no longer instantiated in App`).toBeGreaterThan(-1);
      // The options object ends at the first line that closes it at this depth.
      const block = app.slice(at, at + app.slice(at).indexOf('\n  });'));
      expect(block.includes('onApplied'), `${hook} does not report completions`).toBe(true);
    }
    expect(read('hooks/useBatchTopping.ts')).toContain('deps.onApplied?.()');
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

    // One write path, announcing once. The transfer commit used to be copied
    // into this screen and the cellar map separately, so it announced from two
    // places; both now go through `useTransferExecution`, which reports the
    // result to whoever asked for it exactly once.
    expect(transfers).toContain("from '../hooks/useTransferExecution'");
    expect((transfers.match(/onTransferLogged\?\.\(\)/g) || []).length).toBe(1);
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

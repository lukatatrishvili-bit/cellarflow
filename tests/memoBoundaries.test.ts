import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Guards the memo boundaries added for the re-render work.
 *
 * `React.memo` compares props one level deep, so a single prop allocated inline
 * in JSX — an arrow function, an object literal, a `.filter()` result — is
 * enough to make the boundary fail on every render. Nothing about that is
 * visible at the call site: the component still works, it just quietly re-renders
 * as before while paying for a comparison that can never pass.
 *
 * Four of the twelve memoized components were in exactly that state when this
 * check was first run (`clearPrefill`, `onOpenOnboarding`, `clearPrefilled`,
 * `onPrefillConsumed`), which is why it is a test rather than a one-time audit.
 *
 * Fix a failure by hoisting the value: `useCallback` for handlers, `useMemo` for
 * derived arrays and objects.
 */

const repoRoot = path.resolve(__dirname, '..');
const componentsDir = path.join(repoRoot, 'components');
const appSource = fs.readFileSync(path.join(repoRoot, 'src/App.tsx'), 'utf8').split('\r\n').join('\n');

/** Components whose default export is wrapped in React.memo. */
function memoizedComponents(): string[] {
  return fs.readdirSync(componentsDir)
    .filter(name => name.endsWith('.tsx'))
    .map(name => ({ name: name.replace(/\.tsx$/, ''), source: fs.readFileSync(path.join(componentsDir, name), 'utf8') }))
    .filter(({ name, source }) => source.includes(`React.memo(${name})`))
    .map(({ name }) => name);
}

/** The opening JSX tag for `name` in App.tsx, or null when it is not rendered there. */
function openingTag(name: string): string | null {
  const start = appSource.indexOf(`<${name}\n`);
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < appSource.length; i += 1) {
    const ch = appSource[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return appSource.slice(start, i);
  }
  return null;
}

/**
 * Props whose value gets a fresh identity on every render.
 *
 * A derivation ending in `.length` or `.size` yields a number, which React
 * compares by value — it wastes a recomputation but does NOT break the memo, so
 * it is deliberately not reported here. Only identity changes are.
 */
function unstableProps(tag: string): string[] {
  const offenders: string[] = [];
  for (const line of tag.split('\n')) {
    const match = /^\s+([a-zA-Z][\w]*)=\{(.*)$/.exec(line);
    if (!match) continue;
    const [, prop, rest] = match;
    const value = rest.trim();

    if (/^(\(\s*\)|\([\w\s,{}:?]*\)|[\w]+)\s*=>/.test(value)) offenders.push(`${prop} (inline arrow)`);
    else if (value.startsWith('{')) offenders.push(`${prop} (inline object)`);
    else if (value.startsWith('[')) offenders.push(`${prop} (inline array)`);
    else if (/\.(filter|map|slice|sort|concat)\(/.test(value) && !/\.(length|size)\b/.test(value)) {
      offenders.push(`${prop} (derived collection)`);
    }
  }
  return offenders;
}

describe('memo boundaries', () => {
  const memoized = memoizedComponents();

  it('finds the memoized components', () => {
    expect(memoized.length).toBeGreaterThanOrEqual(12);
  });

  it.each(memoized)('%s receives only stable props from App', (name) => {
    const tag = openingTag(name);
    if (tag === null) return; // rendered elsewhere; nothing to assert here

    const offenders = unstableProps(tag);
    expect(
      offenders,
      `<${name}> is memoized but App allocates these props inline, so the memo never holds: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('detects an unstable prop when one is present', () => {
    // Proves the check can fail — otherwise a broken matcher would look like a pass.
    const sample = [
      '<SomeTab',
      '  lots={state.lots}',
      '  onAct={() => doThing()}',
      '  onPick={(id) => choose(id)}',
      '  rows={state.rows.filter(Boolean)}',
      '  config={{ a: 1 }}',
      '  tags={[1, 2]}',
    ].join('\n');

    expect(unstableProps(sample)).toEqual([
      'onAct (inline arrow)',
      'onPick (inline arrow)',
      'rows (derived collection)',
      'config (inline object)',
      'tags (inline array)',
    ]);
  });

  it('does not flag a derived count, which React compares by value', () => {
    const sample = [
      '<SomeTab',
      "  qvevriCount={state.vessels.filter(v => v.type === 'qvevri').length}",
    ].join('\n');
    // Wasteful to recompute, but it cannot break the memo — so it is not an error here.
    expect(unstableProps(sample)).toEqual([]);
  });
});

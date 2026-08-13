import { describe, it, expect } from 'vitest';
import {
  applyWorkspaceRoute,
  clearWorkspaceRoute,
  isWorkspaceModule,
  parseWorkspaceRoute,
  workspaceRouteMatches,
  WORKSPACE_MODULES,
} from '../lib/workspaceRoute';
import { authRedirectTarget } from '../lib/authRouting';
import { workspaceRouteCanMirrorPath } from '../hooks/useWorkspaceRoute';

describe('parsing a destination from the URL', () => {
  it('reads a module and tab', () => {
    expect(parseWorkspaceRoute('?module=gvino&tab=lots')).toEqual({ module: 'gvino', tab: 'lots' });
  });

  it('accepts a search string with or without the leading question mark', () => {
    expect(parseWorkspaceRoute('module=vazi&tab=blocks').module).toBe('vazi');
  });

  it('ignores a module the app does not have', () => {
    // A hand-edited or stale link must not put the workspace somewhere that
    // does not exist.
    expect(parseWorkspaceRoute('?module=../admin&tab=lots').module).toBeNull();
    expect(parseWorkspaceRoute('?module=&tab=lots').module).toBeNull();
  });

  it('ignores a tab that is not a plausible identifier', () => {
    expect(parseWorkspaceRoute('?tab=<script>').tab).toBeNull();
    expect(parseWorkspaceRoute(`?tab=${'a'.repeat(41)}`).tab).toBeNull();
    expect(parseWorkspaceRoute('?tab=lots').tab).toBe('lots');
  });

  it('returns nothing for an empty or unparseable search', () => {
    expect(parseWorkspaceRoute('')).toEqual({ module: null, tab: null });
    expect(parseWorkspaceRoute('?')).toEqual({ module: null, tab: null });
  });

  it('recognises every module the workspace can show', () => {
    for (const module of WORKSPACE_MODULES) {
      expect(isWorkspaceModule(module)).toBe(true);
    }
    expect(isWorkspaceModule('nope')).toBe(false);
  });
});

describe('writing a destination into the URL', () => {
  it('only decorates the generic workspace shell, not public or dedicated routes', () => {
    expect(workspaceRouteCanMirrorPath('/dashboard')).toBe(true);
    expect(workspaceRouteCanMirrorPath('/dashboard/')).toBe(true);
    expect(workspaceRouteCanMirrorPath('/tasks')).toBe(false);
    expect(workspaceRouteCanMirrorPath('/welcome')).toBe(false);
    expect(workspaceRouteCanMirrorPath('/login')).toBe(false);
  });
  it('sets the module and tab', () => {
    expect(applyWorkspaceRoute('', 'gvino', 'lots')).toBe('?module=gvino&tab=lots');
  });

  it('replaces a previous destination rather than appending another', () => {
    const next = applyWorkspaceRoute('?module=vazi&tab=blocks', 'gvino', 'lots');

    expect(next).toBe('?module=gvino&tab=lots');
  });

  it('keeps a deep link so copying the address bar still reproduces the screen', () => {
    // Dropping ?lot= once consumed would mean the URL of an open passport no
    // longer reopens it, which defeats the point of addressable state.
    const next = applyWorkspaceRoute('?lot=LOT-2026-001', 'gvino', 'lots');

    expect(next).toContain('lot=LOT-2026-001');
    expect(next).toContain('module=gvino');
  });

  it('keeps unrelated parameters untouched', () => {
    const next = applyWorkspaceRoute('?task=T-9&ref=email', 'portal', 'dashboard');

    expect(next).toContain('task=T-9');
    expect(next).toContain('ref=email');
  });

  it('clears a generic destination without dropping a dedicated deep link', () => {
    expect(clearWorkspaceRoute('?task=T-9&module=gvino&tab=tasks')).toBe('?task=T-9');
  });

  it('drops an invalid destination instead of writing it', () => {
    expect(applyWorkspaceRoute('?module=gvino&tab=lots', 'bogus', '<script>')).toBe('');
  });

  it('round-trips every module', () => {
    for (const module of WORKSPACE_MODULES) {
      const search = applyWorkspaceRoute('', module, 'dashboard');
      expect(parseWorkspaceRoute(search).module).toBe(module);
    }
  });
});

describe('comparing the URL with the current destination', () => {
  it('matches when they agree', () => {
    expect(workspaceRouteMatches('?module=gvino&tab=lots', 'gvino', 'lots')).toBe(true);
  });

  it('does not match when either differs', () => {
    expect(workspaceRouteMatches('?module=gvino&tab=lots', 'gvino', 'vessels')).toBe(false);
    expect(workspaceRouteMatches('?module=gvino&tab=lots', 'vazi', 'lots')).toBe(false);
    expect(workspaceRouteMatches('', 'gvino', 'lots')).toBe(false);
  });

  it('ignores other parameters when comparing', () => {
    // Otherwise every arrival with a deep link would rewrite the URL and push a
    // spurious history entry.
    expect(workspaceRouteMatches('?lot=L-1&module=gvino&tab=lots', 'gvino', 'lots')).toBe(true);
  });
});

describe('surviving the sign-in redirect', () => {
  it('carries the destination through the post-login redirect', () => {
    // The reason the destination is in the query and not the path: a link
    // opened while signed out must still land in the right place afterwards.
    const link = `/${applyWorkspaceRoute('', 'gvino', 'lots')}`;

    const target = authRedirectTarget(link, true);

    expect(target).toBe('/dashboard?module=gvino&tab=lots');
    expect(parseWorkspaceRoute(target!.slice(target!.indexOf('?')))).toEqual({
      module: 'gvino',
      tab: 'lots',
    });
  });

  it('leaves an already-authenticated workspace URL alone', () => {
    expect(authRedirectTarget('/dashboard?module=gvino&tab=lots', true)).toBeNull();
  });
});

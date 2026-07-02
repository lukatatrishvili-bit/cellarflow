import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

// Mock React hooks to test the performance manager hook logic
vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof React>();
  let stateValue: any = null;
  return {
    ...original,
    useState: (init: any) => {
      // Mock simple state
      const val = typeof init === 'function' ? init() : init;
      return [val, (newVal: any) => {}];
    },
    useEffect: (fn: any, deps: any) => {
      // Execute effect synchronously for testing
      fn();
    }
  };
});

import { usePerformanceManager } from '../hooks/usePerformanceManager';

describe('usePerformanceManager logic', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      connection: { saveData: false },
      getBattery: () => Promise.resolve({
        level: 1.0,
        charging: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    });

    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({
        matches: query.includes('reduce'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
      localStorage: {
        getItem: () => 'false',
        setItem: vi.fn(),
      }
    });
  });

  it('correctly resolves status variables', () => {
    const mgr = usePerformanceManager();
    expect(mgr.shouldReduceMotion).toBeDefined();
    expect(mgr.batteryLow).toBe(false);
    expect(mgr.dataSaver).toBe(false);
    expect(mgr.manualLowPower).toBe(false);
  });
});

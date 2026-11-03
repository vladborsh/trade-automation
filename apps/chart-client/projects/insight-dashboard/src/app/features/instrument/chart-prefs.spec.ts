import { describe, expect, it } from 'vitest';
import { LEGENDS_HIDDEN_KEY, loadLegendsHidden, saveLegendsHidden } from './chart-prefs';

/** IB-099 item 2 — the legend toggle is remembered, and a hostile store costs nothing. */
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const throwing = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); } };

describe('legends hidden — remembered per viewer', () => {
  it('shown by default; a saved choice comes back', () => {
    const s = memory();
    expect(loadLegendsHidden(s)).toBe(false);
    saveLegendsHidden(s, true);
    expect(s.m.get(LEGENDS_HIDDEN_KEY)).toBe('1');
    expect(loadLegendsHidden(s)).toBe(true);
    saveLegendsHidden(s, false);
    expect(loadLegendsHidden(s)).toBe(false);
  });
  it('a store that throws or is missing: shown, and saving does not throw', () => {
    expect(loadLegendsHidden(throwing)).toBe(false);
    expect(() => saveLegendsHidden(throwing, true)).not.toThrow();
    expect(loadLegendsHidden(null)).toBe(false);
    expect(() => saveLegendsHidden(null, true)).not.toThrow();
  });
});

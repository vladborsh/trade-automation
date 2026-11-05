import { describe, expect, it } from 'vitest';
import { HELP_SEEN_PREFIX, helpStartsOpen, type HelpStorage } from './help-block-state';

/** IB-120 — the first-visit rule of `app-help-block`. */
function memory(): HelpStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('helpStartsOpen', () => {
  it('open on the first visit, collapsed on every later one', () => {
    const s = memory();
    expect(helpStartsOpen(() => s, 'liquidations', true)).toBe(true);
    expect(s.data.get(`${HELP_SEEN_PREFIX}liquidations`)).toBe('1');
    expect(helpStartsOpen(() => s, 'liquidations', true)).toBe(false);
    expect(helpStartsOpen(() => s, 'liquidations', true)).toBe(false);
  });

  it('each block remembers its own visit', () => {
    const s = memory();
    helpStartsOpen(() => s, 'liquidations', true);
    expect(helpStartsOpen(() => s, 'heat', true)).toBe(true);
  });

  it('without storage it renders open — the accessor throwing, the read throwing, the write throwing, or none at all', () => {
    expect(helpStartsOpen(() => { throw new DOMException('denied', 'SecurityError'); }, 'k', true)).toBe(true);
    expect(helpStartsOpen(() => ({ getItem: () => { throw new Error('x'); }, setItem: () => undefined }), 'k', true)).toBe(true);
    expect(helpStartsOpen(() => ({ getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } }), 'k', true)).toBe(true);
    expect(helpStartsOpen(() => null, 'k', true)).toBe(true);
  });

  it('a block not meant to open on a first visit starts collapsed and records nothing', () => {
    const s = memory();
    expect(helpStartsOpen(() => s, 'k', false)).toBe(false);
    expect(s.data.size).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { barAtOrBefore, FOCUS_BARS, focusView, parseAt } from './focus-at';
import { windowFor } from './time-range';

/** IB-098 — `?at=` from an insight link: which moments are accepted, and the view around one. */
const NOW_MS = Date.UTC(2026, 10, 3, 18, 0, 0);
const NOW = NOW_MS / 1000;

describe('parseAt — a bad link costs the reader nothing', () => {
  it('a recent integer moment is accepted', () => {
    expect(parseAt(String(NOW - 3_600), NOW_MS)).toBe(NOW - 3_600);
    expect(parseAt(` ${NOW - 60} `, NOW_MS)).toBe(NOW - 60);
  });
  it('junk, fractions, negatives, ms instead of seconds, the future and the too-old are ignored', () => {
    for (const raw of [null, undefined, '', 'abc', '1793.5', '-5', '1e9', String(NOW_MS), String(NOW + 3_600), String(NOW - 91 * 86_400)]) {
      expect(parseAt(raw, NOW_MS), String(raw)).toBeNull();
    }
  });
  it('a minute of clock skew is tolerated', () => {
    expect(parseAt(String(NOW + 30), NOW_MS)).toBe(NOW + 30);
  });
});

describe('focusView — the finest frame that holds the moment, the view centred on it', () => {
  it('two hours ago: 1m, the bar is the minute, 120 bars centred on it', () => {
    const at = NOW - 2 * 3_600 + 25;
    const v = focusView(at, NOW_MS);
    expect(v.timeframe).toBe('1m');
    expect(v.barSec).toBe(at - 25);
    expect([v.from, v.to]).toEqual([v.barSec - 60 * 60, v.barSec + 60 * 60]);
  });
  it('the frame steps up with age: 2 days → 3m, 4 days → 5m, 6 days → 15m, 20 days → 1h, 60 days → 4h', () => {
    expect([2, 4, 6, 20, 60].map((d) => focusView(NOW - d * 86_400, NOW_MS).timeframe)).toEqual(['3m', '5m', '15m', '1h', '4h']);
  });
  it('the moment and the whole view are inside the data window the frame loads (so no other read is needed)', () => {
    for (const d of [0.01, 0.5, 0.99, 1.5, 2.9, 4.9, 6.9, 29, 89]) {
      const v = focusView(NOW - d * 86_400, NOW_MS);
      const w = windowFor(v.timeframe, NOW_MS);
      expect(v.from, `${d}`).toBeGreaterThanOrEqual(w.fromMs / 1000);
      expect(v.to, `${d}`).toBeLessThanOrEqual(NOW);
      expect(v.atSec).toBeGreaterThanOrEqual(v.from);
      expect(v.atSec).toBeLessThanOrEqual(v.to + 60);
    }
  });
  it('a moment two minutes ago cannot be centred: the view ends now and keeps its width', () => {
    const v = focusView(NOW - 120, NOW_MS);
    expect(v.to).toBe(NOW);
    expect(v.to - v.from).toBe(FOCUS_BARS * 60);
  });
});

describe('barAtOrBefore — the marker lands on a drawn bar', () => {
  const times = [100, 160, 220, 400];
  it('the bar at or before the moment, across a gap in the candles', () => {
    expect([barAtOrBefore(times, 160), barAtOrBefore(times, 219), barAtOrBefore(times, 399), barAtOrBefore(times, 9_999)]).toEqual([160, 160, 220, 400]);
  });
  it('before every bar: the first; no bars: null', () => {
    expect(barAtOrBefore(times, 5)).toBe(100);
    expect(barAtOrBefore([], 5)).toBeNull();
  });
});

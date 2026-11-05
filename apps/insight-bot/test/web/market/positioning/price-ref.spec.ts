import { klinesWeight } from '../../../../src/news/reaction-prices';
import {
  REF_BAR_MS, REF_BARS_CACHE_MS, hourlyRef, refBarCloseMs, refBarsWindow, refFromBars,
} from '../../../../src/web/market/positioning/price-ref';

/** IB-BUG-040 — where a period's price change starts. */
const H = 3_600_000;
const M = 60_000;
const PERIODS = [['1h', H], ['4h', 4 * H], ['24h', 24 * H]] as const;

describe('refBarCloseMs: the 5 m close NEAREST now − P', () => {
  it('the found case: at 12:58 the 1h change starts at 12:00 (58 min back), not at the 11:00 hourly close (118 min back)', () => {
    // 12:58 − 1 h = 11:58 → the nearest 5 m close is 12:00, so the change spans 58 min
    expect(refBarCloseMs('1h', Date.UTC(2026, 10, 5, 12, 58))).toBe(Date.UTC(2026, 10, 5, 12, 0));
    expect(refBarCloseMs('1h', Date.UTC(2026, 10, 5, 12, 57, 29))).toBe(Date.UTC(2026, 10, 5, 11, 55));
  });

  it('every period, every second of an hour: the window is P ± 2.5 min, on a 5 m close', () => {
    const t0 = Date.UTC(2026, 10, 5, 12);
    for (const [p, ms] of PERIODS) {
      for (let now = t0; now < t0 + H; now += 1_000) {
        const ref = refBarCloseMs(p, now);
        expect(ref % REF_BAR_MS).toBe(0);
        expect(Math.abs(now - ref - ms)).toBeLessThanOrEqual(REF_BAR_MS / 2);
      }
    }
  });
});

describe('refBarsWindow: one read holds every period\'s reference for the cache\'s whole life', () => {
  it('for a read at any second of an hour, and any moment of its 30 min after: the reference bar is in it and was CLOSED at the read', () => {
    const t0 = Date.UTC(2026, 10, 5, 12);
    for (let read = t0; read < t0 + H; read += 7_000) {
      const w = refBarsWindow(read);
      const lastClose = w.fromMs + w.limit * REF_BAR_MS;
      expect(lastClose).toBeLessThanOrEqual(read); // only closed bars
      for (let at = read; at <= read + REF_BARS_CACHE_MS; at += 61_000) {
        for (const [p] of PERIODS) {
          const closeMs = refBarCloseMs(p, at);
          expect(closeMs - REF_BAR_MS).toBeGreaterThanOrEqual(w.fromMs);
          expect(closeMs).toBeLessThanOrEqual(lastClose);
        }
      }
    }
  });

  it('is one request of 289 bars: weight 2', () => {
    const w = refBarsWindow(Date.UTC(2026, 10, 5, 12, 3, 17));
    expect(w.limit).toBe(289);
    expect(klinesWeight(w.limit)).toBe(2);
  });

  it('the cache life is bounded: past 57.5 min the 1h reference may not have closed at the read', () => {
    // the worst case: read just before a 5 m close, so its last bar closed 5 min earlier
    const read = Date.UTC(2026, 10, 5, 12, 4, 59);
    const w = refBarsWindow(read);
    expect(refBarCloseMs('1h', read + 57 * M)).toBeLessThanOrEqual(w.fromMs + w.limit * REF_BAR_MS);
    const tooLate = read + 58 * M;
    expect(refBarCloseMs('1h', tooLate)).toBeGreaterThan(w.fromMs + w.limit * REF_BAR_MS);
  });
});

describe('refFromBars', () => {
  const bars = [0, 1, 2].map((i) => ({ time: (Date.UTC(2026, 10, 5, 11) + i * REF_BAR_MS) / 1000, close: 10 + i }));
  it('the bar that CLOSES at the moment: not the one that opens there', () => {
    const closeMs = Date.UTC(2026, 10, 5, 11, 5);
    expect(refFromBars(bars, closeMs)).toEqual({ close: 10, closeMs });
  });
  it('a bar not held is null, never a neighbour', () => {
    expect(refFromBars(bars, Date.UTC(2026, 10, 5, 11, 0))).toBeNull();
    expect(refFromBars([bars[0], bars[2]] as typeof bars, Date.UTC(2026, 10, 5, 11, 10))).toBeNull();
  });
});

describe('hourlyRef (7d): the last complete hour that ended at or before the instant', () => {
  it('its close, stamped at the hour\'s END', () => {
    const base = { closes: [1, 2, 3], closeTimes: [0, H, 2 * H] };
    expect(hourlyRef(base, 2 * H)).toEqual({ close: 2, closeMs: 2 * H });
    expect(hourlyRef(base, 2 * H - 1)).toEqual({ close: 1, closeMs: H });
    expect(hourlyRef(base, 0)).toBeNull();
  });
});

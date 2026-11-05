import { QUIET_MS, WINDOW_MS, quietAt, scanSide, statsAt, type LiqPrint } from '../../../src/alerts/liquidations/window';

/**
 * IB-122 (L1, L2, L8) — the sliding window. Each spec is built so it can fail: the cascade straddles a
 * minute AND a 5-minute boundary (fixed buckets would split it and miss twice), the crossing is between
 * two prints, the quiet period ends exactly at 30 min.
 */
const T = Date.UTC(2026, 10, 5, 12, 0, 0); // 12:00:00, a 5-minute boundary
const S = 1_000;
const p = (atMs: number, usd: number, venue: LiqPrint['venue'] = 'binance'): LiqPrint => ({ ts: atMs, usd, venue });

describe('scanSide (L1): the first moment the 5-min sum reached the threshold', () => {
  it('a $6M cascade across a 5-minute boundary, $3M each side of it, is ONE alert at a $5M threshold', () => {
    const prints = [p(T - 90 * S, 1.5e6), p(T - 40 * S, 1.5e6), p(T + 20 * S, 1.5e6, 'bybit'), p(T + 70 * S, 1.5e6, 'okx')];
    // fixed buckets [11:55, 12:00) and [12:00, 12:05) would hold $3M each: no alert at all
    const r = scanSide(prints, T - 10 * 60 * S, T + 5 * 60 * S, 5e6, []);
    expect(r.alerts.map((a) => a.at)).toEqual([T + 70 * S]);
    expect(r.alerts[0]?.stats).toEqual({ sum: 6e6, count: 4, byVenue: { binance: 3e6, bybit: 1.5e6, okx: 1.5e6 }, largest: { usd: 1.5e6, venue: 'binance' } });
  });

  it('at = the exact print that crossed, not the tick and not a bucket edge', () => {
    const prints = [p(T + 1_234, 3e6), p(T + 61_789, 1.9e6), p(T + 62_001, 0.2e6), p(T + 63_000, 5e6)];
    const r = scanSide(prints, T, T + 5 * 60 * S, 5e6, []);
    expect(r.alerts.map((a) => a.at)).toEqual([T + 62_001]);
  });

  it('the window is (t − 5 min, t]: a print exactly 5 min before t is out, prints AT t are in', () => {
    const prints = [p(T, 3e6), p(T + WINDOW_MS, 1e6), p(T + WINDOW_MS, 1e6)];
    expect(statsAt(prints, T + WINDOW_MS).sum).toBe(2e6);
    expect(scanSide(prints, T, T + WINDOW_MS, 5e6, []).alerts).toEqual([]);
    expect(scanSide(prints, T - 1, T + WINDOW_MS, 4e6, []).alerts).toEqual([]); // 3 then 2: never 4 together
    expect(scanSide([...prints.slice(0, 1), p(T + WINDOW_MS - 1, 1e6)], T - 1, T + WINDOW_MS, 4e6, []).alerts.map((a) => a.at)).toEqual([T + WINDOW_MS - 1]);
  });

  it('only moments in (from, to] are candidates; earlier prints count in their window', () => {
    const prints = [p(T, 4e6), p(T + 30 * S, 2e6)];
    expect(scanSide(prints, T + 30 * S, T + 60 * S, 5e6, []).alerts).toEqual([]); // the crossing at T+30 s was the previous tick's
    expect(scanSide(prints, T + 29 * S, T + 60 * S, 5e6, []).alerts.map((a) => a.at)).toEqual([T + 30 * S]);
  });
});

describe('L2: quiet 30 min from at; detection is normal again after', () => {
  const cascade = (from: number) => [p(from, 3e6), p(from + 10 * S, 3e6)];

  it('a second crossing inside 30 min is no alert; one at exactly at + 30 min is', () => {
    const at = T + 10 * S;
    // a second $6M burst ending 1 ms before the quiet period ends: silent; a $0.1M print exactly at at + 30 min
    // sees that burst in its window, so the cascade, still going, gets a fresh alert there
    const prints = [...cascade(T), ...cascade(at + QUIET_MS - 10 * S - 1), p(at + QUIET_MS, 0.1e6)];
    const r = scanSide(prints, T - 1, T + 2 * QUIET_MS, 5e6, []);
    expect(r.alerts.map((a) => a.at)).toEqual([at, at + QUIET_MS]);
  });

  it('the journal\'s alerts block the same way (a restart), and a late print cannot cross just before one', () => {
    const at = T + 10 * S;
    expect(scanSide(cascade(T), T - 1, T + QUIET_MS, 5e6, [at]).alerts).toEqual([]);
    expect(quietAt(at - WINDOW_MS + 1, [at])).toBe(true);
    expect(quietAt(at - WINDOW_MS, [at])).toBe(false);
    expect(quietAt(at + QUIET_MS, [at])).toBe(false);
  });
});

describe('L8 near-misses', () => {
  it('the hour\'s largest window at ≥ 0.5× that fired nothing; the build-up to an alert is not a near-miss', () => {
    const prints = [p(T + 60 * S, 2.6e6), p(T + 20 * 60 * S, 3.2e6), p(T + 40 * 60 * S, 3e6), p(T + 40 * 60 * S + 10 * S, 3e6)];
    const r = scanSide(prints, T, T + 59 * 60 * S, 5e6, []);
    expect(r.alerts.map((a) => a.at)).toEqual([T + 40 * 60 * S + 10 * S]);
    // 3.0M at 12:40:00 is the alert's prelude (inside (at − 5 min, at)); 3.2M at 12:20 is the hour's best
    expect([...r.nearMisses.values()]).toEqual([{ at: T + 20 * 60 * S, sum: 3.2e6, hour: T }]);
  });

  it('below 0.5× is nothing', () => {
    expect(scanSide([p(T + S, 2.4e6)], T, T + 60 * S, 5e6, []).nearMisses.size).toBe(0);
  });
});

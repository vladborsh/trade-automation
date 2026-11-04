import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BinanceRestKline } from '@trade-automation/binance-client';
import type { Bar } from '../../../src/insights/divergence/detector';
import { entryT0, klinesWeight, measurePath, windowBars, windowClosed } from '../../../src/alerts/oi-divergence/research/path';

/**
 * IB-115 (V23, V24) — the price path. The real fixture is the 4 h window after dev-1's real ETH 1h bullish
 * alert (t0 = its confirmation + 6 min, rounded up); its expected numbers were computed from the raw rows by a
 * separate script, not by this code. Order cases (stop first, threshold first, both in one bar) are hand-built.
 */
const fixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/binance/fapi-klines-5m-ethusdt-path.json'), 'utf8')) as {
  t0: number; stopPrice: number; atr14: number; klines: BinanceRestKline[];
};
const toBar = (r: BinanceRestKline): Bar => ({ time: Math.floor(Number(r[0]) / 1000), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]) });
const real = fixture.klines.map(toBar);

const T0 = 1_792_296_600;
/** Hand-built 5 m bars from T0, entry 100, ATR 10: each [high, low]. */
const path = (...hl: Array<[number, number]>): Bar[] => hl.map(([high, low], i) => ({ time: T0 + i * 300, open: i === 0 ? 100 : (high + low) / 2, high, low, close: (high + low) / 2 }));

describe('the price path (IB-115, V23–V24)', () => {
  it('V23: t0 = confirming close + 6 min, rounded UP to 5 m — the same for 15m, 1h and 4h closes', () => {
    expect(entryT0(1_792_296_000)).toBe(1_792_296_600); // a 1h close: + 10 min
    expect(entryT0(1_792_296_000 + 900)).toBe(1_792_296_000 + 900 + 600);
    expect(entryT0(1_792_296_000 + 240)).toBe(1_792_296_000 + 600); // off-grid: 4 + 6 = 10 min → 10
    expect(entryT0(1_792_296_000 + 241)).toBe(1_792_296_000 + 900); // 4:01 + 6 = 10:01 → up to 15 min
    expect(entryT0(1_792_296_000 + 1)).toBe(1_792_296_000 + 600); // 6:01 → 10 min
  });

  it('V24: one call per window at 48 / 288 / 864 bars is weight 1 / 2 / 5 — 8 per subject', () => {
    expect((['4h', '24h', '72h'] as const).map(windowBars)).toEqual([48, 288, 864]);
    expect((['4h', '24h', '72h'] as const).map((w) => klinesWeight(windowBars(w)))).toEqual([1, 2, 5]);
    expect([99, 100, 499, 500, 1000, 1001].map(klinesWeight)).toEqual([1, 2, 2, 5, 5, 10]);
  });

  it('a window is measured only after its last bar closed and a minute passed', () => {
    expect(windowClosed(T0, '4h', T0 + 4 * 3_600 + 59)).toBe(false);
    expect(windowClosed(T0, '4h', T0 + 4 * 3_600 + 60)).toBe(true);
  });

  it('real ETH 4 h after the alert: entry = open at t0, high/low with the first bar that made them, bullish never stopped or moved', () => {
    expect(fixture.t0).toBe(entryT0(1_792_296_000));
    expect(real).toHaveLength(48);
    const m = measurePath(real, { t0: fixture.t0, win: '4h', direction: 'bullish', atr14: fixture.atr14, stopPrice: fixture.stopPrice });
    expect(m).toEqual({
      bars: 48, entryAt: 1_792_296_600, entryPrice: 2421.81, high: 2422.75, highAt: 1_792_296_600, low: 2405.3, lowAt: 1_792_308_300,
      stopAt: null, fav05At: null, fav1At: null, fav2At: null, orderAmbiguous: false,
    });
  });

  it('the same real bars read bearish: 0.5 and 1 ATR reached at their own first bars, 2 not; a stop just above entry hits at once', () => {
    const m = measurePath(real, { t0: fixture.t0, win: '4h', direction: 'bearish', atr14: fixture.atr14, stopPrice: 2422.5 });
    expect([m.fav05At, m.fav1At, m.fav2At, m.stopAt, m.orderAmbiguous]).toEqual([1_792_299_000, 1_792_301_700, null, 1_792_296_600, false]);
  });

  it('a random control (no direction): high/low only — no stop, no thresholds, no ambiguity claimed', () => {
    const m = measurePath(real, { t0: fixture.t0, win: '4h', direction: null, atr14: fixture.atr14, stopPrice: null });
    expect([m.high, m.low, m.stopAt, m.fav05At, m.fav1At, m.fav2At, m.orderAmbiguous]).toEqual([2422.75, 2405.3, null, null, null, null, null]);
  });

  it('stop BEFORE the threshold: stop_at < fav_05_at, not ambiguous', () => {
    const m = measurePath(path([101, 99], [100, 94], [106, 98]), { t0: T0, win: '4h', direction: 'bullish', atr14: 10, stopPrice: 95 });
    expect([m.stopAt, m.fav05At, m.orderAmbiguous]).toEqual([T0 + 300, T0 + 600, false]);
  });

  it('threshold BEFORE the stop', () => {
    const m = measurePath(path([101, 99], [105, 99], [101, 94]), { t0: T0, win: '4h', direction: 'bullish', atr14: 10, stopPrice: 95 });
    expect([m.fav05At, m.stopAt, m.orderAmbiguous]).toEqual([T0 + 300, T0 + 600, false]);
  });

  it('both in ONE 5 m bar → order_ambiguous (5 m cannot order them; said, not guessed)', () => {
    const m = measurePath(path([101, 99], [106, 94]), { t0: T0, win: '4h', direction: 'bullish', atr14: 10, stopPrice: 95 });
    expect([m.fav05At, m.stopAt, m.orderAmbiguous]).toEqual([T0 + 300, T0 + 300, true]);
    // bearish mirror: the stop above, the move down
    const b = measurePath(path([101, 99], [106, 94]), { t0: T0, win: '4h', direction: 'bearish', atr14: 10, stopPrice: 105 });
    expect([b.fav05At, b.stopAt, b.orderAmbiguous]).toEqual([T0 + 300, T0 + 300, true]);
  });

  it('touching the stop is not beyond it; reaching exactly x × ATR counts', () => {
    const m = measurePath(path([101, 95], [110, 99], [120, 99]), { t0: T0, win: '4h', direction: 'bullish', atr14: 10, stopPrice: 95 });
    expect([m.stopAt, m.fav05At, m.fav1At, m.fav2At]).toEqual([null, T0 + 300, T0 + 300, T0 + 600]);
  });

  it('bars outside [t0, t0 + window) are ignored; no kline at t0 → entry at the first one after, and it says so', () => {
    const before = { time: T0 - 300, open: 1, high: 1_000, low: 1, close: 1 };
    const after = { time: T0 + 4 * 3_600, open: 1, high: 1_000, low: 1, close: 1 };
    const inside = path([101, 99], [102, 98]).slice(1); // the t0 bar missing (a closed session)
    const m = measurePath([before, ...inside, after], { t0: T0, win: '4h', direction: 'bullish', atr14: 10, stopPrice: 95 });
    expect([m.bars, m.entryAt, m.high, m.low]).toEqual([1, T0 + 300, 102, 98]);
    expect(measurePath([before, after], { t0: T0, win: '4h', direction: 'bullish', atr14: 10, stopPrice: 95 }).bars).toBe(0);
  });
});

import type { Candle } from '@trade-automation/contracts';
import { toCandlestickData } from '../chart-data.adapter';
import { RSI_STABLE_BARS, rsiDrawable, rsiLineData, rsiWilder } from './rsi';

// The classic Wilder 14-period worked example (StockCharts "RSI" ChartSchool spreadsheet).
const REF_CLOSES = [
  44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614,
  46.282, 46.282, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548,
  44.0288, 44.1783, 44.2181, 44.5672, 43.4205, 42.6628, 43.1314,
];
const REF_RSI_FROM_14 = [
  70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.3,
  33.08, 37.77,
];

/** Deterministic pseudo-random walk (LCG) — no Math.random in specs. */
function randomWalk(n: number, seed: number): number[] {
  let s = seed;
  let price = 100;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    price = Math.max(1, price + (s / 4294967296 - 0.5) * 2);
    out.push(price);
  }
  return out;
}

describe('rsiWilder', () => {
  it('matches the classic Wilder/StockCharts 14-period example to ±0.01', () => {
    const rsi = rsiWilder(REF_CLOSES, 14);
    REF_RSI_FROM_14.forEach((expected, k) => {
      expect(Math.abs((rsi[14 + k] as number) - expected)).toBeLessThan(0.01);
    });
  });

  it('leaves indices 0 … period−1 null (nothing drawn, never a fake 50/0)', () => {
    const rsi = rsiWilder(REF_CLOSES, 14);
    expect(rsi.length).toBe(REF_CLOSES.length);
    expect(rsi.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(rsi[14]).not.toBeNull();
  });

  it('is all null when there are not more than `period` closes', () => {
    expect(rsiWilder([1, 2, 3], 3)).toEqual([null, null, null]);
    expect(rsiWilder([], 14)).toEqual([]);
  });

  it('all-gain → 100, all-loss → 0, flat → 50', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 100 - i);
    const flat = Array.from({ length: 30 }, () => 100);
    expect(rsiWilder(up, 14).slice(14)).toEqual(new Array(16).fill(100));
    expect(rsiWilder(down, 14).slice(14)).toEqual(new Array(16).fill(0));
    expect(rsiWilder(flat, 14).slice(14)).toEqual(new Array(16).fill(50));
  });
});

describe('RSI_STABLE_BARS / rsiDrawable', () => {
  it('is 10 × period', () => {
    expect(RSI_STABLE_BARS(14)).toBe(140);
    expect(RSI_STABLE_BARS(2)).toBe(20);
  });

  it('nulls the first RSI_STABLE_BARS entries and keeps the rest of rsiWilder', () => {
    const closes = randomWalk(300, 7);
    const full = rsiWilder(closes, 14);
    const drawn = rsiDrawable(closes, 14);
    expect(drawn.slice(0, 140).every((v) => v === null)).toBe(true);
    expect(drawn.slice(140)).toEqual(full.slice(140));
  });

  // The loadOlder() no-jump guarantee (§12.4): prepending history re-seeds the RSI, but every
  // index the pane actually draws moves by < 0.01.
  for (const period of [2, 14, 50]) {
    for (const seed of [1, 42, 9001]) {
      it(`RSI over older ++ current matches current at every drawn index (period ${period}, seed ${seed})`, () => {
        const all = randomWalk(RSI_STABLE_BARS(period) * 3 + 500, seed);
        const olderLen = 500;
        const current = all.slice(olderLen);
        const drawnCurrent = rsiDrawable(current, period);
        const drawnAll = rsiWilder(all, period);
        let checked = 0;
        drawnCurrent.forEach((v, i) => {
          if (v !== null) {
            expect(Math.abs(v - (drawnAll[olderLen + i] as number))).toBeLessThan(0.01);
            checked++;
          }
        });
        expect(checked).toBe(current.length - RSI_STABLE_BARS(period));
      });
    }
  }
});

describe('rsiLineData', () => {
  it('emits one point per drawable bar, at the candle open time in seconds', () => {
    const closes = randomWalk(160, 3);
    const candles = closes.map(
      (close, i) =>
        ({
          instrument: 'binance:BTCUSDT',
          timeframe: '5m',
          openTime: 1_700_000_000_000 + i * 300_000,
          open: close,
          high: close,
          low: close,
          close,
          volume: 0,
          closed: true,
          source: 'venue-rest',
        }) as Candle,
    );
    const data = rsiLineData(candles, 14);
    expect(data.length).toBe(20);
    expect(data[0].time).toBe((candles[140].openTime / 1000) as typeof data[0]['time']);
    expect(data[19].value).toBe(rsiWilder(closes, 14)[159] as number);
  });

  it('uses the candle series\' own time for a non-whole-second openTime (no extra time-scale slots)', () => {
    const closes = randomWalk(150, 5);
    const candles = closes.map((close, i) => ({ openTime: 1_700_000_000_807 + i * 60_000, close }) as Candle);
    const data = rsiLineData(candles, 14);
    expect(data.map((d) => d.time)).toEqual(
      candles.slice(140).map((c) => toCandlestickData(c).time),
    );
  });
});

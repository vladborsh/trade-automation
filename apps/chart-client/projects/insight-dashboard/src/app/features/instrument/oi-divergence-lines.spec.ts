import { describe, expect, it } from 'vitest';
import type { WebOiDivergenceLine } from '@trade-automation/contracts';
import { DIVERGENCE_COLOURS, divergenceStrokes, divergenceTf, oiBarOf, visibleLines } from './oi-divergence-lines';

/** IB-110 — what the chart draws from the divergence lines. */
const H = 3_600;
const T = 1_793_000_000 - (1_793_000_000 % H);
const end = (bar: number, price: number, oiBar: number, oi: number) => ({ time: T + bar * H, price, oiTime: T + oiBar * H + 1_800, oi });
const line = (dir: 'bullish' | 'bearish', a: ReturnType<typeof end>, b: ReturnType<typeof end>, repeat: WebOiDivergenceLine['repeat'] = null): WebOiDivergenceLine => ({
  direction: dir, a, b, confirmedAt: b.time + 7 * H, pricePct: (b.price / a.price - 1) * 100, oiPct: (b.oi / a.oi - 1) * 100, repeat, firedAt: null,
});
const oiPane = Array.from({ length: 60 }, (_, i) => ({ time: T + i * H, value: 1_000, notional: 1_000 * 3_000 })); // $3 000 a contract

describe('divergenceTf', () => {
  it('15m, 1h, 4h have lines; every other chart frame has none', () => {
    expect(['1m', '5m', '15m', '1h', '4h', '1d'].map(divergenceTf)).toEqual([null, null, '15m', '1h', '4h', null]);
  });
});

describe('visibleLines — a repeat replaces the line it extends (V8)', () => {
  it('A–B then A–C: only A–C; another run and the other direction stay', () => {
    const ab = line('bullish', end(10, 100, 10, 900), end(30, 98, 30, 950));
    const ac = line('bullish', end(10, 100, 10, 900), end(50, 96, 50, 980), { runLength: 3, firstBTime: ab.b.time });
    const other = line('bearish', end(12, 110, 12, 1_000), end(25, 112, 25, 940));
    expect(visibleLines([ab, ac, other])).toEqual([other, ac]);
    expect(visibleLines([ab, other])).toEqual([other, ab]); // control: no repeat, both drawn
  });
});

describe('divergenceStrokes', () => {
  it('two strokes a line: price at the wicks, OI at the pivot bars in USD; colour by direction, a repeat dashed', () => {
    const l = line('bullish', end(10, 100, 11, 900), end(30, 98, 30, 950), { runLength: 3, firstBTime: T });
    const [price, oi] = divergenceStrokes([l], oiPane, '1h');
    expect(price).toEqual({ pane: 'price', direction: 'bullish', colour: DIVERGENCE_COLOURS.bullish, dashed: true,
      points: [{ time: T + 10 * H, value: 100 }, { time: T + 30 * H, value: 98 }] });
    // the OI pivot's reading at 11:30 belongs to the bar opened 11:00; 900 contracts × $3 000
    expect(oi.points).toEqual([{ time: T + 11 * H, value: 2_700_000 }, { time: T + 30 * H, value: 2_850_000 }]);
    expect(oi.colour).toBe(DIVERGENCE_COLOURS.bullish);
  });

  it('an OI end whose bar the pane does not hold: the price stroke alone', () => {
    const l = line('bearish', end(10, 110, 10, 1_000), end(30, 112, 30, 940));
    const strokes = divergenceStrokes([l], oiPane.slice(0, 20), '1h');
    expect(strokes.map((s) => s.pane)).toEqual(['price']);
    expect(strokes[0].colour).toBe(DIVERGENCE_COLOURS.bearish);
  });

  it('the OI reading at a bar’s close belongs to that bar, the one at its open to the bar before', () => {
    expect(oiBarOf(T + H, H)).toBe(T);
    expect(oiBarOf(T, H)).toBe(T - H);
  });
});

import { describe, expect, it } from 'vitest';
import type { WebOiDivergenceLine } from '@trade-automation/contracts';
import { DIVERGENCE_COLOURS, divergenceStrokes, divergenceTf, OI_CONTRACTS_COLOUR, oiBarOf, visibleLines } from './oi-divergence-lines';
import { TRX_1H_LINES, TRX_1H_OI } from './oi-divergence-trx-1h.fixture';

/** IB-110 — what the chart draws from the divergence lines. */
const H = 3_600;
const T = 1_793_000_000 - (1_793_000_000 % H);
const end = (bar: number, price: number, oiBar: number, oi: number) => ({ time: T + bar * H, price, oiTime: T + oiBar * H + 1_800, oi });
const line = (dir: 'bullish' | 'bearish', a: ReturnType<typeof end>, b: ReturnType<typeof end>, repeat: WebOiDivergenceLine['repeat'] = null): WebOiDivergenceLine => ({
  direction: dir, a, b, confirmedAt: b.time + 7 * H, pricePct: (b.price / a.price - 1) * 100, oiPct: (b.oi / a.oi - 1) * 100, repeat, firedAt: null,
});

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
  it('two strokes a line: price at the wicks, OI at the pivot bars in CONTRACTS (the detector’s values); a repeat dashed', () => {
    const l = line('bullish', end(10, 100, 11, 900), end(30, 98, 30, 950), { runLength: 3, firstBTime: T });
    const [price, oi] = divergenceStrokes([l], '1h');
    expect(price).toEqual({ pane: 'price', unit: 'price', direction: 'bullish', colour: DIVERGENCE_COLOURS.bullish, dashed: true,
      points: [{ time: T + 10 * H, value: 100 }, { time: T + 30 * H, value: 98 }] });
    // the OI pivot's reading at 11:30 belongs to the bar opened 11:00
    expect(oi).toMatchObject({ pane: 'openInterest', unit: 'contracts', colour: DIVERGENCE_COLOURS.bullish,
      points: [{ time: T + 11 * H, value: 900 }, { time: T + 30 * H, value: 950 }] });
  });

  it('OI pivots out of order on this frame (B’s before A’s): the price stroke alone', () => {
    const l = line('bearish', end(10, 110, 10, 1_000), end(30, 112, 9, 940));
    const strokes = divergenceStrokes([l], '1h');
    expect(strokes.map((s) => s.pane)).toEqual(['price']);
    expect(strokes[0].colour).toBe(DIVERGENCE_COLOURS.bearish);
  });

  it('the OI reading at a bar’s close belongs to that bar, the one at its open to the bar before', () => {
    expect(oiBarOf(T + H, H)).toBe(T);
    expect(oiBarOf(T, H)).toBe(T - H);
  });
});

/**
 * TL review (IB-110): the OI stroke must show what the detector measured. On TRX 1h the alert says OI +0.76 %
 * (contracts) while price fell 8.4 % — in USD that OI is LOWER at B, and a stroke drawn in USD pointed down beside
 * a text that says it rose. For every line, the stroke's direction in the unit it is drawn in is oiPct's sign.
 */
describe('the OI stroke agrees with the alert (TRX 1h, recorded)', () => {
  it('sign(end − start) of every OI stroke == sign(oiPct), on the real line that USD would draw backwards', () => {
    expect(TRX_1H_LINES.some((l) => l.direction === 'bullish' && l.oiPct > 0 && l.pricePct < -5)).toBe(true); // the case is in the fixture
    // …and it IS the case: in USD (the pane's main line, as recorded) OI is lower at B than at A
    const usdAt = (t: number) => TRX_1H_OI.filter((p) => p.time <= t).at(-1)!.notional!;
    const l0 = TRX_1H_LINES[0];
    expect(usdAt(oiBarOf(l0.b.oiTime, H)) < usdAt(oiBarOf(l0.a.oiTime, H))).toBe(true);
    const strokes = divergenceStrokes(TRX_1H_LINES, '1h').filter((s) => s.pane === 'openInterest');
    const lines = visibleLines(TRX_1H_LINES);
    expect(strokes).toHaveLength(lines.length);
    strokes.forEach((s, i) => expect([s.unit, Math.sign(s.points[1].value - s.points[0].value)]).toEqual(['contracts', Math.sign(lines[i].oiPct)]));
  });
});

describe('the «OI, контракты» line is dim, the stroke is not (IB-114, V21)', () => {
  it('the muted token #8b949e at 50 % opacity; both stroke colours opaque', () => {
    const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(OI_CONTRACTS_COLOUR);
    expect(rgba?.slice(1).map(Number)).toEqual([0x8b, 0x94, 0x9e, 0.5]);
    for (const c of Object.values(DIVERGENCE_COLOURS)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

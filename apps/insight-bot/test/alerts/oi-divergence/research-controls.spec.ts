import { detectDivergences, type Bar, type DivergenceParams } from '../../../src/insights/divergence/detector';
import { pivotControlPicks, randomControlBars, randomControlPick } from '../../../src/alerts/oi-divergence/research/controls';

/** IB-115 (V25) — the control picks: random by hash (a replay picks the same bars), pivot at the decided bar. */
const DAY0 = Date.UTC(2026, 10, 4) / 1000;

describe('random controls (V25)', () => {
  it('2 distinct bar closes per coin, TF and UTC day, inside that day, on the TF grid', () => {
    for (const [tf, sec] of [['15m', 900], ['1h', 3_600], ['4h', 14_400]] as const) {
      for (let d = 0; d < 30; d++) {
        const day = DAY0 + d * 86_400;
        const picks = randomControlBars('BTCUSDT', tf, sec, day);
        expect(picks).toHaveLength(2);
        expect(new Set(picks).size).toBe(2);
        for (const t of picks) {
          expect(t >= day && t < day + 86_400 && (t - day) % sec === 0).toBe(true);
        }
      }
    }
  });

  it('a replay picks the SAME bars — pinned values, so a change in what is hashed fails here', () => {
    expect(randomControlBars('BTCUSDT', '1h', 3_600, DAY0)).toEqual(randomControlBars('BTCUSDT', '1h', 3_600, DAY0));
    expect({
      btc1h: randomControlBars('BTCUSDT', '1h', 3_600, DAY0).map((t) => (t - DAY0) / 3_600),
      eth1h: randomControlBars('ETHUSDT', '1h', 3_600, DAY0).map((t) => (t - DAY0) / 3_600),
      btc15m: randomControlBars('BTCUSDT', '15m', 900, DAY0).map((t) => (t - DAY0) / 900),
      btc1hNext: randomControlBars('BTCUSDT', '1h', 3_600, DAY0 + 86_400).map((t) => (t - DAY0 - 86_400) / 3_600),
    }).toEqual({ btc1h: [10, 22], eth1h: [9, 11], btc15m: [58, 93], btc1hNext: [3, 9] });
  });

  it('it varies by symbol, TF and day (over 30 days the picks are not one fixed hour)', () => {
    const hours = new Set<number>();
    for (let d = 0; d < 30; d++) for (const t of randomControlBars('BTCUSDT', '1h', 3_600, DAY0 + d * 86_400)) hours.add((t / 3_600) % 24);
    expect(hours.size).toBeGreaterThan(10);
  });

  it('randomControlPick fires on the newest bar only when it is one of the day’s picks; t0 = its close + 6 min, up to 5 m', () => {
    const [pick] = randomControlBars('SOLUSDT', '1h', 3_600, DAY0);
    const bars = (last: number): Bar[] => Array.from({ length: 30 }, (_, i) => {
      const time = last - (29 - i) * 3_600;
      return { time, open: 100, high: 102 + (i % 3), low: 99, close: 101 };
    });
    const hit = randomControlPick('SOLUSDT', '1h', bars(pick), 3_600);
    expect(hit).toMatchObject({ kind: 'random', direction: null, stopPrice: null, barTime: pick, t0: pick + 3_600 + 600 });
    expect(hit?.atr14).toBeGreaterThan(0);
    expect(randomControlPick('SOLUSDT', '1h', bars(pick + 3_600 * 25), 3_600)).toBeNull(); // not a pick hour (25 h later)
    const notPick = Array.from({ length: 24 }, (_, h) => DAY0 + h * 3_600).find((t) => !randomControlBars('SOLUSDT', '1h', 3_600, DAY0).includes(t)) as number;
    expect(randomControlPick('SOLUSDT', '1h', bars(notPick), 3_600)).toBeNull();
  });
});

describe('pivot controls (V25)', () => {
  const TF = 900;
  const T0 = 1_793_000_000 - (1_793_000_000 % TF);
  // IB-141 (V35, V37): unequal sides as on 4h — the decided index, t0 and the hole window each fail if the side is swapped
  const P: DivergenceParams = { nLeft: 6, nRight: 2, k: 3, w: 96, atrMult: 0.25, oiMedianMult: 0.5, priceLineTolAtrMult: 0.25, oiLineTolMedianMult: 0.5 };
  const make = (len: number, lows: Record<number, number>, highs: Record<number, number> = {}) => {
    const bars: Bar[] = Array.from({ length: len }, (_, i) => {
      const low = lows[i] ?? 100;
      return { time: T0 + i * TF, open: low + 1, high: highs[i] ?? low + 2, low, close: low + 1 };
    });
    const oi5m = Array.from({ length: len * 3 }, (_, s) => ({ time: T0 + (s + 1) * 300, oi: 1000 + 10 * (Math.floor(s / 3) % 2) }));
    return { bars, oi5m };
  };
  const LEN = 150;
  const I = LEN - (P.k + P.nRight + 1); // the bar this evaluation decides: OI up to k after it, then nRight to confirm

  it('a low pivot at the decided bar → bullish control, stop = its low, t0 = close of bar i + nRight, + 6 min, up to 5 m', () => {
    const { bars, oi5m } = make(LEN, { [I]: 95 });
    const r = detectDivergences({ tfSec: TF, bars, oi5m, params: P });
    const picks = pivotControlPicks({ tfSec: TF, bars, oi5m, params: P }, r);
    expect(picks.map((x) => [x.kind, x.direction, x.barTime, x.stopPrice, x.t0])).toEqual([
      ['pivot', 'bullish', T0 + I * TF, 95, T0 + (I + P.nRight + 1) * TF + 600],
    ]);
  });

  it('one wide bar that is both a low and a high pivot → two controls, one per direction', () => {
    const { bars, oi5m } = make(LEN, { [I]: 95 }, { [I]: 110 });
    const r = detectDivergences({ tfSec: TF, bars, oi5m, params: P });
    expect(pivotControlPicks({ tfSec: TF, bars, oi5m, params: P }, r).map((x) => [x.direction, x.stopPrice])).toEqual([['bullish', 95], ['bearish', 110]]);
  });

  it('a pivot one bar newer is not decided yet (its OI pairing may still come); one bar older was decided last time', () => {
    for (const at of [I + 1, I - 1]) {
      const { bars, oi5m } = make(LEN, { [at]: 95 });
      const r = detectDivergences({ tfSec: TF, bars, oi5m, params: P });
      expect(pivotControlPicks({ tfSec: TF, bars, oi5m, params: P }, r)).toEqual([]);
    }
  });

  it('a pivot whose evaluation was skipped for a hole is not a control (it was not judged)', () => {
    const { bars, oi5m } = make(LEN, { [I]: 95 });
    const holed = oi5m.filter((x) => x.time !== T0 + (I - 5) * TF + 600);
    const inp = { tfSec: TF, bars, oi5m: holed, params: P };
    expect(pivotControlPicks(inp, detectDivergences(inp))).toEqual([]);
    // the venue's own silence there is not a hole: the control stands
    const silent = { ...inp, venueSilent: [{ from: T0 + (I - 5) * TF + 600, to: T0 + (I - 5) * TF + 600 }] };
    expect(pivotControlPicks(silent, detectDivergences(silent))).toHaveLength(1);
  });

  it('the hole window starts at bar i − W − nLeft: a hole there voids the control, one bar earlier does not', () => {
    const { bars, oi5m } = make(LEN, { [I]: 95 });
    const at = (bar: number) => {
      const inp = { tfSec: TF, bars, oi5m: oi5m.filter((x) => x.time !== T0 + bar * TF + 600), params: P };
      return pivotControlPicks(inp, detectDivergences(inp)).length;
    };
    expect([at(I - P.w - P.nLeft), at(I - P.w - P.nLeft - 1)]).toEqual([0, 1]);
  });
});

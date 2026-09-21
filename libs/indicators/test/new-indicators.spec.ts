import { Candle } from '@trade-automation/contracts';
import { bollinger, ema, macd, rsi, sma, stochastic } from '../src';
import { bar } from './test-helpers';

const MIN = 60_000;
const fromCloses = (closes: number[]): Candle[] =>
  closes.map((c, i) => bar(i * MIN, { open: c, high: c, low: c, close: c }));
const values = (s: { value: number }[]) => s.map((p) => p.value);
const times = (s: { time: number }[]) => s.map((p) => p.time / MIN);

describe('hand-worked short series (T-027)', () => {
  it('SMA(3) of 2, 4, 6, 8, 4 → 4, 6, 6 from bar 2', () => {
    const s = sma(fromCloses([2, 4, 6, 8, 4]), { length: 3 }).sma;
    expect(times(s)).toEqual([2, 3, 4]);
    expect(values(s)).toEqual([4, 6, 6]);
  });

  it('EMA(3) of 2, 4, 6, 8, 4: seed SMA 4 at bar 2, α = 0.5 → 6, then 5', () => {
    // bar 3: 0.5·8 + 0.5·4 = 6; bar 4: 0.5·4 + 0.5·6 = 5
    const s = ema(fromCloses([2, 4, 6, 8, 4]), { length: 3 }).ema;
    expect(times(s)).toEqual([2, 3, 4]);
    expect(values(s)).toEqual([4, 6, 5]);
  });

  it('RSI(2), Wilder, of 10, 11, 10.5, 11.5, 11', () => {
    // changes +1, −0.5, +1, −0.5. Bar 2: avgG (1+0)/2 = 0.5, avgL (0+0.5)/2 = 0.25 → RS 2 → 66.667
    // bar 3: avgG (0.5+1)/2 = 0.75, avgL (0.25+0)/2 = 0.125 → RS 6 → 85.714
    // bar 4: avgG (0.75+0)/2 = 0.375, avgL (0.125+0.5)/2 = 0.3125 → RS 1.2 → 54.545
    const s = rsi(fromCloses([10, 11, 10.5, 11.5, 11]), { length: 2 }).rsi;
    expect(times(s)).toEqual([2, 3, 4]);
    expect(s[0].value).toBeCloseTo(100 - 100 / 3, 10);
    expect(s[1].value).toBeCloseTo(100 - 100 / 7, 10);
    expect(s[2].value).toBeCloseTo(100 - 100 / 2.2, 10);
  });

  it('MACD(2, 3, 2) of 1, 3, 2, 5, 4, 6, 5', () => {
    // EMA2 (α 2/3): 2 (seed, bar 1), 2, 4, 4, 5.3333, 5; EMA3 (α 1/2): 2 (seed, bar 2), 3.5, 3.75, 4.875, 4.9375
    // macd from bar 2: 0, 0.5, 0.25, 0.458333, 0.173611
    // signal = EMA2 of macd from bar 2: seed (0 + 0.5)/2 = 0.25 at bar 3, 0.25, 0.388889, 0.245370
    const m = macd(fromCloses([1, 3, 2, 5, 4, 6, 5]), { fast: 2, slow: 3, signal: 2 });
    expect(times(m.macd)).toEqual([2, 3, 4, 5, 6]);
    [0, 0.5, 0.25, 0.4583333333333333, 0.1736111111111111].forEach((v, i) => expect(m.macd[i].value).toBeCloseTo(v, 12));
    expect(times(m.signal)).toEqual([3, 4, 5, 6]);
    [0.25, 0.25, 0.3888888888888889, 0.24537037037037038].forEach((v, i) => expect(m.signal[i].value).toBeCloseTo(v, 12));
    [0.25, 0, 0.06944444444444445, -0.07175925925925926].forEach((v, i) => expect(m.hist[i].value).toBeCloseTo(v, 12));
  });

  it('Bollinger(3, 2) of 1, 2, 3, 4: population σ of (1, 2, 3) = √(2/3)', () => {
    const bb = bollinger(fromCloses([1, 2, 3, 4]), { length: 3, stdDevs: 2 });
    const band = 2 * Math.sqrt(2 / 3); // 1.632993…
    expect(times(bb.middle)).toEqual([2, 3]);
    expect(values(bb.middle)).toEqual([2, 3]);
    bb.upper.forEach((p, i) => expect(p.value).toBeCloseTo([2, 3][i] + band, 12));
    bb.lower.forEach((p, i) => expect(p.value).toBeCloseTo([2, 3][i] - band, 12));
  });

  it('Stochastic(3, 2, 2) on six bars', () => {
    // (h, l, c): (10,8,9) (11,9,10) (12,9,11) (12,10,10) (13,11,12) (14,12,13)
    // raw %K over 3 bars from bar 2: 100·(11−8)/(12−8) = 75; (10−9)/(12−9) = 33.33; (12−9)/(13−9) = 75; (13−10)/(14−10) = 75
    // k = SMA2 from bar 3: 54.1667, 54.1667, 75; d = SMA2 of k from bar 4: 54.1667, 64.5833
    const hlc = [[10, 8, 9], [11, 9, 10], [12, 9, 11], [12, 10, 10], [13, 11, 12], [14, 12, 13]];
    const bars = hlc.map(([high, low, close], i) => bar(i * MIN, { open: close, high, low, close }));
    const st = stochastic(bars, { kLength: 3, dLength: 2, smoothing: 2 });
    expect(times(st.k)).toEqual([3, 4, 5]);
    [54.166666666666664, 54.166666666666664, 75].forEach((v, i) => expect(st.k[i].value).toBeCloseTo(v, 10));
    expect(times(st.d)).toEqual([4, 5]);
    [54.166666666666664, 64.58333333333333].forEach((v, i) => expect(st.d[i].value).toBeCloseTo(v, 10));
  });

  it('Stochastic: a zero high-low range gives raw %K 0 (TA-Lib)', () => {
    const st = stochastic(fromCloses([5, 5, 5, 5]), { kLength: 2, dLength: 1, smoothing: 1 });
    expect(values(st.k)).toEqual([0, 0, 0]);
  });
});

describe('warm-up: no point before the indicator is defined (T-027)', () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5);
  const b = fromCloses(closes);
  const firstBar = (s: { time: number }[]) => s[0].time / MIN;

  it('each output starts at its first defined bar, with one point per bar after it, all finite', () => {
    const cases: [string, { time: number; value: number }[], number][] = [
      ['sma(10)', sma(b, { length: 10 }).sma, 9],
      ['ema(10)', ema(b, { length: 10 }).ema, 9],
      ['rsi(10)', rsi(b, { length: 10 }).rsi, 10],
      ['macd(5,10,4).macd', macd(b, { fast: 5, slow: 10, signal: 4 }).macd, 9],
      ['macd(5,10,4).signal', macd(b, { fast: 5, slow: 10, signal: 4 }).signal, 12],
      ['bollinger(10).middle', bollinger(b, { length: 10, stdDevs: 2 }).middle, 9],
      ['stochastic(10,3,3).k', stochastic(b, { kLength: 10, dLength: 3, smoothing: 3 }).k, 11],
      ['stochastic(10,3,3).d', stochastic(b, { kLength: 10, dLength: 3, smoothing: 3 }).d, 13],
    ];
    for (const [label, series, first] of cases) {
      expect({ label, first: firstBar(series), length: series.length }).toEqual({ label, first, length: 40 - first });
      expect(series.every((p) => Number.isFinite(p.value))).toBe(true);
    }
  });

  it('too few bars → empty series, never zeros or NaN', () => {
    const short = b.slice(0, 5);
    expect(sma(short, { length: 10 }).sma).toEqual([]);
    expect(ema(short, { length: 10 }).ema).toEqual([]);
    expect(rsi(short, { length: 5 }).rsi).toEqual([]); // needs length + 1 bars
    expect(macd(short, { fast: 2, slow: 10, signal: 3 })).toEqual({ macd: [], signal: [], hist: [] });
    expect(bollinger(short, { length: 10, stdDevs: 2 })).toEqual({ upper: [], middle: [], lower: [] });
    expect(stochastic(short, { kLength: 4, dLength: 2, smoothing: 2 })).toEqual({ k: [{ time: 4 * MIN, value: expect.any(Number) }], d: [] });
    expect(sma([], { length: 3 }).sma).toEqual([]);
  });
});

describe('purity and the forming bar (design §5.6)', () => {
  const b = fromCloses(Array.from({ length: 200 }, (_, i) => 100 + ((i * 37) % 23) - 11));

  it('causal: on a prefix of the bars, every output is the same prefix — adding a bar never rewrites the past', () => {
    const run = (bars: Candle[]) => ({
      sma: sma(bars, { length: 20 }), ema: ema(bars, { length: 20 }), rsi: rsi(bars, { length: 14 }),
      macd: macd(bars, { fast: 12, slow: 26, signal: 9 }), bb: bollinger(bars, { length: 20, stdDevs: 2 }),
      st: stochastic(bars, { kLength: 14, dLength: 3, smoothing: 3 }),
    });
    const full = run(b);
    const part = run(b.slice(0, 120));
    for (const [name, out] of Object.entries(part)) {
      for (const [key, series] of Object.entries(out as Record<string, unknown[]>)) {
        expect({ name, key, prefix: (full as Record<string, Record<string, unknown[]>>)[name][key].slice(0, series.length) }).toEqual({ name, key, prefix: series });
      }
    }
  });

  it('does not mutate its input and returns the same output twice', () => {
    const copy = structuredClone(b);
    const first = macd(b, { fast: 12, slow: 26, signal: 9 });
    expect(macd(b, { fast: 12, slow: 26, signal: 9 })).toEqual(first);
    expect(b).toEqual(copy);
  });

  it('rejects nonsensical parameters with RangeError', () => {
    expect(() => sma(b, { length: 0 })).toThrow(RangeError);
    expect(() => ema(b, { length: 2.5 })).toThrow(RangeError);
    expect(() => rsi(b, { length: -1 })).toThrow(RangeError);
    expect(() => macd(b, { fast: 26, slow: 12, signal: 9 })).toThrow(RangeError);
    expect(() => bollinger(b, { length: 20, stdDevs: 0 })).toThrow(RangeError);
    expect(() => stochastic(b, { kLength: 14, dLength: 0, smoothing: 3 })).toThrow(RangeError);
  });
});

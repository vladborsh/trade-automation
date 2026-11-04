import { oiPerBar, SLOT_SEC, type OiPoint } from './oi-per-bar';
import { pivots, type Side } from './pivots';

/**
 * IB-109 — price vs open-interest divergence (architecture/oi-divergence-design-2026-11-04.md, V1,
 * V4–V9). **Pure**: bars and 5 m OI in, pivots / pairs / divergences / skips out, no I/O. The alert
 * loop, the chart and the history run all call this one function, so a line on the chart and an
 * alert cannot disagree on the same data.
 *
 * - **Bullish**, on lows: the price's wick low is LOWER at B than at A, OI's per-bar min is HIGHER.
 * - **Bearish**, on highs: the wick high is HIGHER at B, OI's per-bar max is LOWER.
 *
 * Holds nothing between calls: the caller passes the bars and readings it read, and gets plain data
 * back (no boot warm-up, IB-096).
 */
export interface Bar {
  /** Open time, unix seconds — the venue's kline convention. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DivergenceParams {
  /** Pivot reach: bars each side (V5). */
  n: number;
  /** Pairing reach: an OI pivot within ±k bars of the price pivot (V6). */
  k: number;
  /** Lookback: A's price pivot within W bars of B's (V7). */
  w: number;
  /** δp = atrMult × ATR14 at B. */
  atrMult: number;
  /** δoi = oiMedianMult × median |ΔOI per bar| over the 100 bars before B. */
  oiMedianMult: number;
}

export interface DivergenceInput {
  tfSec: number;
  /** CLOSED bars only, ascending and contiguous. A pivot's confirmation is bar i+N being in here. */
  bars: readonly Bar[];
  oi5m: readonly OiPoint[];
  params: DivergenceParams;
  /** 5 m slots (unix seconds, inclusive ranges) the venue did not publish — IB-104's «биржа не публиковала». Not holes. */
  venueSilent?: ReadonlyArray<{ from: number; to: number }>;
  /** Slots after this moment are not due yet (the venue's publish lag): not holes. Default: the last bar's close. */
  oiDueUntil?: number;
}

export type Direction = 'bullish' | 'bearish';

export interface PivotPair {
  side: Side;
  /** Bar index of the price pivot, and of the OI pivot paired with it. */
  price: number;
  oi: number;
  /** The bar whose close confirms the pair: max(price, oi) + N. */
  confirmIndex: number;
}

export interface DivergenceEnd {
  time: number;
  price: number;
  oiTime: number;
  oi: number;
}

export interface Divergence {
  direction: Direction;
  a: DivergenceEnd;
  b: DivergenceEnd;
  /** Bar indexes, for the caller's own drawing / checks. */
  aIndex: number;
  bIndex: number;
  confirmedAt: number;
  /** B against A, percent. */
  pricePct: number;
  oiPct: number;
  /** V8: pivots in the run (2 for a first alert); the run's first line's B time, null for a first alert. */
  runLength: number;
  runFirstBTime: number | null;
}

export interface DivergenceSkip {
  /** B's price pivot bar. */
  barTime: number;
  reason: 'no_oi_data';
  holeFrom: number;
  holeTo: number;
}

export interface DivergenceResult {
  pivots: { lows: number[]; highs: number[]; oiLows: number[]; oiHighs: number[] };
  pairs: PivotPair[];
  divergences: Divergence[];
  skips: DivergenceSkip[];
}

/** V7: ATR over this many bars, and the |ΔOI| median over this many bars before B. */
export const ATR_PERIOD = 14;
export const OI_MEDIAN_BARS = 100;
/**
 * B is evaluated only once all `OI_MEDIAN_BARS` per-bar moves before it exist POSITIONALLY (V7: «over the 100
 * bars before B» — not «whatever history there is»), and at least this many of them are known (a bar the venue
 * did not publish has no OI and no move; a TradFi coin's closed sessions must not mute it).
 */
export const OI_MEDIAN_MIN = 20;

/**
 * IB-110 (TL 2026-11-04, V10) — how many CLOSED bars a caller must hand the detector so that the newest B it can
 * confirm is judged on full context, derived from the constants, never typed by hand:
 * - its farthest A (W bars back) must itself be a pivot: N bars before A → B ≥ W + N;
 * - the noise floor's 100 moves end at B's previous bar and start at bar B − OI_MEDIAN_BARS − 1 → B ≥ OI_MEDIAN_BARS + 1;
 *   ATR14 needs B ≥ ATR_PERIOD, always the smaller;
 * - after B: its OI pivot up to k bars later, then N bars to confirm → k + N bars, plus B's own bar.
 * Defaults: 15m 112, 1h 136, 4h 111. The spec checks that one bar fewer loses the evaluation.
 */
export function barsForEvaluation(p: Pick<DivergenceParams, 'n' | 'k' | 'w'>): number {
  return Math.max(p.w + p.n, OI_MEDIAN_BARS + 1, ATR_PERIOD) + p.k + p.n + 1;
}

export function detectDivergences(input: DivergenceInput): DivergenceResult {
  const { bars, params } = input;
  const opens = bars.map((b) => b.time);
  const oi = oiPerBar(opens, input.oi5m, input.tfSec);
  const lows = pivots(bars.map((b) => b.low), params.n, 'low');
  const highs = pivots(bars.map((b) => b.high), params.n, 'high');
  const oiLows = pivots(oi.min, params.n, 'low');
  const oiHighs = pivots(oi.max, params.n, 'high');

  const pairs = [...pair(lows, oiLows, 'low', params), ...pair(highs, oiHighs, 'high', params)]
    .filter((p) => p.confirmIndex < bars.length);
  const holes = holeFinder(input);
  const divergences: Divergence[] = [];
  const skips: DivergenceSkip[] = [];

  for (const side of ['low', 'high'] as const) {
    const sidePairs = pairs.filter((p) => p.side === side).sort((x, y) => x.confirmIndex - y.confirmIndex || x.price - y.price);
    const series = side === 'low' ? oi.min : oi.max;
    const seriesTime = side === 'low' ? oi.minTime : oi.maxTime;
    const found: Divergence[] = [];
    for (const b of sidePairs) {
      const lo = Math.max(0, b.price - params.w - params.n);
      const hi = Math.min(bars.length - 1, b.price + params.k + params.n);
      const hole = holes(bars[lo].time, bars[hi].time + input.tfSec);
      if (hole) {
        skips.push({ barTime: bars[b.price].time, reason: 'no_oi_data', holeFrom: hole.from, holeTo: hole.to });
        continue;
      }
      const noise = noiseAt(bars, series, b.price, params);
      if (noise === null) continue;
      const candidates = sidePairs.filter((a) => a.price < b.price && a.price >= b.price - params.w
        && a.confirmIndex <= b.confirmIndex && a.oi < b.oi
        && diverges(side, bars, series, a, b, noise));
      if (candidates.length === 0) continue;
      const a = candidates.reduce((far, c) => (c.price < far.price ? c : far)); // V7: the farthest A
      const d = divergence(side, bars, series, seriesTime, a, b, input.tfSec);
      // V8: a repeat extends the latest earlier line from the same A (or a farther one) through a B before this one
      const prev = found.filter((p) => a.price <= p.aIndex && p.bIndex > a.price && p.bIndex < b.price)
        .reduce<Divergence | null>((last, p) => (last === null || p.bIndex > last.bIndex ? p : last), null);
      if (prev) {
        d.runLength = prev.runLength + 1;
        d.runFirstBTime = prev.runFirstBTime ?? prev.b.time;
      }
      found.push(d);
    }
    divergences.push(...found);
  }

  divergences.sort((x, y) => x.confirmedAt - y.confirmedAt || x.b.time - y.b.time);
  skips.sort((x, y) => x.barTime - y.barTime);
  return { pivots: { lows, highs, oiLows, oiHighs }, pairs, divergences, skips };
}

/** V6: each price pivot with the nearest OI pivot of the same kind within ±k (the earlier on a tie); none, no pair. */
function pair(price: readonly number[], oi: readonly number[], side: Side, p: DivergenceParams): PivotPair[] {
  const out: PivotPair[] = [];
  for (const i of price) {
    let best: number | null = null;
    for (const j of oi) {
      const d = Math.abs(j - i);
      if (d > p.k) continue;
      if (best === null || d < Math.abs(best - i) || (d === Math.abs(best - i) && j < best)) best = j;
    }
    if (best !== null) out.push({ side, price: i, oi: best, confirmIndex: Math.max(i, best) + p.n });
  }
  return out;
}

interface Noise {
  dp: number;
  doi: number;
}

/** V7: δp from ATR14 at B, δoi from the median per-bar OI move over the 100 bars before B. Null: not enough history to judge. */
function noiseAt(bars: readonly Bar[], series: ReadonlyArray<number | null>, i: number, p: DivergenceParams): Noise | null {
  if (i < ATR_PERIOD || i < OI_MEDIAN_BARS + 1) return null;
  let tr = 0;
  for (let t = i - ATR_PERIOD + 1; t <= i; t++) {
    const prevClose = bars[t - 1].close;
    tr += Math.max(bars[t].high - bars[t].low, Math.abs(bars[t].high - prevClose), Math.abs(bars[t].low - prevClose));
  }
  const deltas: number[] = [];
  for (let t = Math.max(1, i - OI_MEDIAN_BARS); t < i; t++) {
    const a = series[t - 1];
    const b = series[t];
    if (a !== null && b !== null) deltas.push(Math.abs(b - a));
  }
  if (deltas.length < OI_MEDIAN_MIN) return null;
  return { dp: p.atrMult * (tr / ATR_PERIOD), doi: p.oiMedianMult * median(deltas) };
}

function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** V7's four conditions, mirrored for highs. */
function diverges(side: Side, bars: readonly Bar[], series: ReadonlyArray<number | null>, a: PivotPair, b: PivotPair, noise: Noise): boolean {
  const price = (t: number) => (side === 'low' ? bars[t].low : bars[t].high);
  const pA = price(a.price);
  const pB = price(b.price);
  const oA = series[a.oi] as number;
  const oB = series[b.oi] as number;
  // (1) the price is worse at B, (2) OI is better at B — each by more than its noise
  const priceWorse = side === 'low' ? pB < pA - noise.dp : pB > pA + noise.dp;
  const oiBetter = side === 'low' ? oB > oA + noise.doi : oB < oA - noise.doi;
  if (!priceWorse || !oiBetter) return false;
  // (3) no wick between A and B crosses the price line, (4) no per-bar OI crosses the OI line
  const crosses = (v: number, line: number) => (side === 'low' ? v < line : v > line);
  for (let t = a.price + 1; t < b.price; t++) if (crosses(price(t), lineAt(a.price, pA, b.price, pB, t))) return false;
  for (let t = a.oi + 1; t < b.oi; t++) {
    const v = series[t];
    if (v !== null && crosses(v, lineAt(a.oi, oA, b.oi, oB, t))) return false;
  }
  return true;
}

function lineAt(x0: number, y0: number, x1: number, y1: number, x: number): number {
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

function divergence(
  side: Side, bars: readonly Bar[], series: ReadonlyArray<number | null>, seriesTime: ReadonlyArray<number | null>,
  a: PivotPair, b: PivotPair, tfSec: number,
): Divergence {
  const end = (p: PivotPair): DivergenceEnd => ({
    time: bars[p.price].time,
    price: side === 'low' ? bars[p.price].low : bars[p.price].high,
    oiTime: seriesTime[p.oi] as number,
    oi: series[p.oi] as number,
  });
  const A = end(a);
  const B = end(b);
  return {
    direction: side === 'low' ? 'bullish' : 'bearish',
    a: A, b: B, aIndex: a.price, bIndex: b.price,
    confirmedAt: bars[b.confirmIndex].time + tfSec,
    pricePct: (B.price / A.price - 1) * 100,
    oiPct: (B.oi / A.oi - 1) * 100,
    runLength: 2, runFirstBTime: null,
  };
}

/**
 * V9: a hole is a 5 m slot in the window with no reading, that the venue did not cause and that is
 * already due. The window `(from, to]` matches `oiPerBar`'s ownership: a bar owns `open < t ≤ close`.
 * Returns the first hole's contiguous range, or null.
 */
function holeFinder(input: DivergenceInput): (from: number, to: number) => { from: number; to: number } | null {
  const have = new Set(input.oi5m.map((p) => p.time));
  const silent = input.venueSilent ?? [];
  const lastClose = input.bars.length > 0 ? input.bars[input.bars.length - 1].time + input.tfSec : 0;
  const due = input.oiDueUntil ?? lastClose;
  const missing = (s: number) => !have.has(s) && s <= due && !silent.some((r) => s >= r.from && s <= r.to);
  return (from, to) => {
    for (let s = Math.floor(from / SLOT_SEC) * SLOT_SEC + SLOT_SEC; s <= to; s += SLOT_SEC) {
      if (!missing(s)) continue;
      let end = s;
      while (end + SLOT_SEC <= to && missing(end + SLOT_SEC)) end += SLOT_SEC;
      return { from: s, to: end };
    }
    return null;
  };
}

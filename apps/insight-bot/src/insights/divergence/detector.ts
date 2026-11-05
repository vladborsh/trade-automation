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
  /** Pivot reach on the left: how far back a pivot looks (V5, V34). */
  nLeft: number;
  /** Pivot reach on the right: how many closed bars confirm a pivot (V5, V34). 4h: 2 since IB-141. */
  nRight: number;
  /** Pairing reach: an OI pivot within ±k bars of the price pivot (V6). */
  k: number;
  /** Lookback: A's price pivot within W bars of B's (V7). */
  w: number;
  /** δp = atrMult × ATR14 at B. */
  atrMult: number;
  /** δoi = oiMedianMult × median |ΔOI per bar| over the 100 bars before B. */
  oiMedianMult: number;
  /** V18: a wick in (A, B) may cross the price line by up to this × ATR14 at THAT bar. 0 = round 1 (none). */
  priceLineTolAtrMult: number;
  /** V18: a per-bar OI in (oiA, oiB) may cross the OI line by up to this × δoi's median (at B). 0 = round 1. */
  oiLineTolMedianMult: number;
}

export interface DivergenceInput {
  tfSec: number;
  /** CLOSED bars only, ascending and contiguous. A pivot's confirmation is bar i + nRight being in here. */
  bars: readonly Bar[];
  oi5m: readonly OiPoint[];
  params: DivergenceParams;
  /** 5 m slots (unix seconds, inclusive ranges) the venue did not publish — IB-104's «биржа не публиковала». Not holes. */
  venueSilent?: ReadonlyArray<{ from: number; to: number }>;
  /** Slots after this moment are not due yet (the venue's publish lag): not holes. Default: the last bar's close. */
  oiDueUntil?: number;
  /**
   * V36: which earlier pivot may be A. `full` (the default, and the only rule the server uses): A's price and OI
   * pivots also hold with max(nLeft, nRight) bars on the right. `fast` drops that check — it exists for V39's
   * history run (IB-141), which reports what the rule removes. Production code never passes it.
   */
  aRule?: 'full' | 'fast';
}

export type Direction = 'bullish' | 'bearish';

export interface PivotPair {
  side: Side;
  /** Bar index of the price pivot, and of the OI pivot paired with it. */
  price: number;
  oi: number;
  /** The bar whose close confirms the pair: max(price, oi) + nRight (V6, V35). */
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
 * IB-110 (TL 2026-11-04, V10), re-derived in IB-114 (V18) and IB-141 (V35) — how many CLOSED bars a caller must hand
 * the detector so that the newest B it can confirm is judged on full context, derived from the constants, never
 * typed by hand. Before B the terms take `nLeft`, after B `nRight`:
 * - its farthest A (W bars back) must itself be a pivot: nLeft bars before A → B ≥ W + nLeft;
 * - V18's price tolerance needs ATR14 at the crossing bar j, i.e. j ≥ ATR_PERIOD. A bar within A's right reach
 *   cannot cross: A is the lowest of them (V5) and the line falls from A (the price is worse at B). V36 holds A to
 *   max(nLeft, nRight) bars on the right, so the first bar that can cross is A + max(nLeft, nRight) + 1 →
 *   B ≥ W + ATR_PERIOD − max(nLeft, nRight) − 1 (binding only while that max is < 7). (`aRule: 'fast'` holds A to
 *   nRight only; the history run's W keeps this term below the OI one on 4h, so the count is unchanged there.)
 * - the noise floor's 100 moves end at B's previous bar and start at bar B − OI_MEDIAN_BARS − 1 → B ≥ OI_MEDIAN_BARS + 1;
 *   ATR14 at B needs B ≥ ATR_PERIOD, always the smaller;
 * - after B: its OI pivot up to k bars later, then nRight bars to confirm → k + nRight bars, plus B's own bar.
 * Defaults: 15m 113, 1h 185, 4h **107** (was 111 at 6/6: nRight 2, V34). Counted whatever the tolerance: at 0 the
 * extra ≤ 7 bars are unused, never missing. The spec checks that one bar fewer loses the evaluation.
 */
export function barsForEvaluation(p: Pick<DivergenceParams, 'nLeft' | 'nRight' | 'k' | 'w'>): number {
  const aRight = Math.max(p.nLeft, p.nRight);
  return Math.max(p.w + Math.max(p.nLeft, ATR_PERIOD - aRight - 1), OI_MEDIAN_BARS + 1, ATR_PERIOD) + p.k + p.nRight + 1;
}

export function detectDivergences(input: DivergenceInput): DivergenceResult {
  const { bars, params } = input;
  const opens = bars.map((b) => b.time);
  const oi = oiPerBar(opens, input.oi5m, input.tfSec);
  const lowValues = bars.map((b) => b.low);
  const highValues = bars.map((b) => b.high);
  const lows = pivots(lowValues, params.nLeft, params.nRight, 'low');
  const highs = pivots(highValues, params.nLeft, params.nRight, 'high');
  const oiLows = pivots(oi.min, params.nLeft, params.nRight, 'low');
  const oiHighs = pivots(oi.max, params.nLeft, params.nRight, 'high');
  const canBeA = aEligibility(params, { low: lowValues, high: highValues }, { low: oi.min, high: oi.max }, input.aRule ?? 'full');

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
      const lo = Math.max(0, b.price - params.w - params.nLeft);
      const hi = Math.min(bars.length - 1, b.price + params.k + params.nRight);
      const hole = holes(bars[lo].time, bars[hi].time + input.tfSec);
      if (hole) {
        skips.push({ barTime: bars[b.price].time, reason: 'no_oi_data', holeFrom: hole.from, holeTo: hole.to });
        continue;
      }
      if (!bOiHolds(series, b)) continue; // IB-141 option 1: an OI pivot before B must still stand on B's own bar
      const noise = noiseAt(bars, series, b.price, params);
      if (noise === null) continue;
      const candidates = sidePairs.filter((a) => a.price < b.price && a.price >= b.price - params.w
        && a.confirmIndex <= b.confirmIndex && a.oi < b.oi && canBeA(a, b.confirmIndex)
        && diverges(side, bars, series, a, b, noise, params));
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
export function pair(price: readonly number[], oi: readonly number[], side: Side, p: DivergenceParams): PivotPair[] {
  const out: PivotPair[] = [];
  for (const i of price) {
    let best: number | null = null;
    for (const j of oi) {
      const d = Math.abs(j - i);
      if (d > p.k) continue;
      if (best === null || d < Math.abs(best - i) || (d === Math.abs(best - i) && j < best)) best = j;
    }
    if (best !== null) out.push({ side, price: i, oi: best, confirmIndex: Math.max(i, best) + p.nRight });
  }
  return out;
}

/**
 * IB-141 option 1 (TL review 2026-11-05; the owner rules on it) — **B's OI pivot must hold on the bars up to B.**
 * Pairing lets B's OI pivot lie up to k bars BEFORE the price pivot. With equal sides (k ≤ N) its right side always
 * covers B's own bar; with 6/2 and k = 3 it does not, so B's bar could already carry OI beyond A's while the alert
 * says «OI did not follow» (V39's BNB 4h 2026-10-27: OI pivot at B − 3, B's bar above A's OI). So the OI pivot's
 * right side reaches max(nRight, B − oiB): every bar after it, through B, ties or is worse (V5's non-strict right
 * side; an unknown bar is not a tie). Bars up to B are closed by B's confirmation. A no-op when nRight ≥ k.
 */
export function bOiHolds(series: ReadonlyArray<number | null>, b: Pick<PivotPair, 'side' | 'price' | 'oi'>): boolean {
  const v = series[b.oi];
  if (v === null || v === undefined) return false;
  for (let j = b.oi + 1; j <= b.price; j++) {
    const x = series[j];
    if (x === null || x === undefined || (b.side === 'low' ? x < v : x > v)) return false;
  }
  return true;
}

/**
 * V36 (IB-141) — "fast B, full A". With unequal sides two pivots of a kind can be nRight + 1 bars apart, so a 6/2
 * low that a lower low contradicts 3–6 bars later could serve as A for that lower low: a «divergence» across two
 * bars between a false bottom and the real one. So a pair may be **A** only if its price pivot AND its OI pivot
 * also hold with max(nLeft, nRight) bars on the right — judged only on bars up to B's confirmation
 * (`max(price, oi) + max(nLeft, nRight) ≤ bConfirmIndex`): the loop deciding B and a replay over later bars (the
 * chart) then admit the same A. B keeps the fast nRight. With equal sides this is exactly `a.confirmIndex ≤
 * b.confirmIndex`, which both callers already require: a no-op on 15m and 1h.
 */
export function aEligibility(
  p: Pick<DivergenceParams, 'nLeft' | 'nRight'>,
  price: Record<Side, ReadonlyArray<number | null>>, oi: Record<Side, ReadonlyArray<number | null>>, rule: 'full' | 'fast',
): (a: PivotPair, bConfirmIndex: number) => boolean {
  const reach = Math.max(p.nLeft, p.nRight);
  if (rule === 'fast' || reach === p.nRight) return () => true;
  const full = (values: ReadonlyArray<number | null>, side: Side) => new Set(pivots(values, p.nLeft, reach, side));
  const sets = {
    low: { price: full(price.low, 'low'), oi: full(oi.low, 'low') },
    high: { price: full(price.high, 'high'), oi: full(oi.high, 'high') },
  };
  return (a, bConfirmIndex) => sets[a.side].price.has(a.price) && sets[a.side].oi.has(a.oi)
    && Math.max(a.price, a.oi) + reach <= bConfirmIndex;
}

export interface Noise {
  dp: number;
  doi: number;
  /** V18: the OI line's tolerance, from δoi's own median — one number per evaluation. */
  oiLineTol: number;
  /** The median |ΔOI per bar| itself — the unit the OI line's near-miss is counted in (IB-115, V26). */
  med: number;
}

/** ATR14 at bar i, i.e. over bars i − 13 … i (each true range needs the bar before). Null before bar ATR_PERIOD. */
export function atrAt(bars: readonly Bar[], i: number): number | null {
  if (i < ATR_PERIOD) return null;
  let tr = 0;
  for (let t = i - ATR_PERIOD + 1; t <= i; t++) {
    const prevClose = bars[t - 1].close;
    tr += Math.max(bars[t].high - bars[t].low, Math.abs(bars[t].high - prevClose), Math.abs(bars[t].low - prevClose));
  }
  return tr / ATR_PERIOD;
}

/** V7: δp from ATR14 at B, δoi from the median per-bar OI move over the 100 bars before B. Null: not enough history to judge. */
export function noiseAt(bars: readonly Bar[], series: ReadonlyArray<number | null>, i: number, p: DivergenceParams): Noise | null {
  const atr = atrAt(bars, i);
  if (atr === null || i < OI_MEDIAN_BARS + 1) return null;
  const deltas: number[] = [];
  for (let t = Math.max(1, i - OI_MEDIAN_BARS); t < i; t++) {
    const a = series[t - 1];
    const b = series[t];
    if (a !== null && b !== null) deltas.push(Math.abs(b - a));
  }
  if (deltas.length < OI_MEDIAN_MIN) return null;
  const med = median(deltas);
  return { dp: p.atrMult * atr, doi: p.oiMedianMult * med, oiLineTol: p.oiLineTolMedianMult * med, med };
}

function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** V7's four conditions, mirrored for highs; conditions 3–4 with V18's tolerances. */
function diverges(
  side: Side, bars: readonly Bar[], series: ReadonlyArray<number | null>, a: PivotPair, b: PivotPair, noise: Noise, p: DivergenceParams,
): boolean {
  const price = (t: number) => (side === 'low' ? bars[t].low : bars[t].high);
  const pA = price(a.price);
  const pB = price(b.price);
  const oA = series[a.oi] as number;
  const oB = series[b.oi] as number;
  // (1) the price is worse at B, (2) OI is better at B — each by more than its noise
  const priceWorse = side === 'low' ? pB < pA - noise.dp : pB > pA + noise.dp;
  const oiBetter = side === 'low' ? oB > oA + noise.doi : oB < oA - noise.doi;
  if (!priceWorse || !oiBetter) return false;
  // (3) no wick between A and B crosses the price line, (4) no per-bar OI crosses the OI line — by MORE than the
  // tolerance (V18): `beyond` is strict, so a crossing of exactly the tolerance passes, and tolerance 0 is round 1.
  const beyond = (v: number, line: number, tol: number) => (side === 'low' ? v < line - tol : v > line + tol);
  for (let t = a.price + 1; t < b.price; t++) {
    const line = lineAt(a.price, pA, b.price, pB, t);
    if (!beyond(price(t), line, 0)) continue;
    // ATR14 at the crossing bar t itself, as ruled — not at B. Without its history (t < ATR_PERIOD) the tolerance
    // is 0: never admit what round 1 refused on a guess. barsForEvaluation counts the bars that make it known.
    const tol = p.priceLineTolAtrMult === 0 ? 0 : p.priceLineTolAtrMult * (atrAt(bars, t) ?? 0);
    if (beyond(price(t), line, tol)) return false;
  }
  for (let t = a.oi + 1; t < b.oi; t++) {
    const v = series[t];
    if (v !== null && beyond(v, lineAt(a.oi, oA, b.oi, oB, t), noise.oiLineTol)) return false;
  }
  return true;
}

export function lineAt(x0: number, y0: number, x1: number, y1: number, x: number): number {
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
export function holeFinder(input: DivergenceInput): (from: number, to: number) => { from: number; to: number } | null {
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

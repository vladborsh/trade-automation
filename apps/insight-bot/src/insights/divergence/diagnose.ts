import { OI_NEAR_MISS_UNIT, type OiNearMissRule, type OiNearMissUnit } from '@trade-automation/contracts';
import {
  aEligibility, atrAt, bOiHolds, holeFinder, KINDS, lineAt, noiseAt, oiGap, pair, priceGap, type Bar, type Direction, type DivergenceEnd, type DivergenceInput,
  type DivergenceParams, type DivergenceResult, type Kind, type Noise, type PivotPair,
} from './detector';
import { oiPerBar } from './oi-per-bar';
import type { Side } from './pivots';

/**
 * IB-115 (architecture/oi-divergence-design-2026-11-04.md V26) — near-misses: a candidate A–B that fails
 * EXACTLY ONE of the six conditions, within a bounded reach. Pure, and beside the detector, not inside it:
 * it reads the detector's result and never changes it, so turning it on cannot change a detection.
 *
 * | rule | fails when | in reach when | `miss` |
 * |---|---|---|---|
 * | `price_delta` | B is not worse than A by MORE than δp | worse by ≥ 0 | (δp − worse-by) ÷ δp |
 * | `oi_delta` | OI is not better by MORE than δoi | better by ≥ 0 | (δoi − better-by) ÷ δoi |
 * | `price_line` | a wick in (A, B) crosses the line by more than its tolerance | every such excess ≤ one more tolerance | max excess, in ATR14 at that bar |
 * | `oi_line` | a per-bar OI crosses the OI line by more than its tolerance | every such excess ≤ one more tolerance | max excess, in |ΔOI| medians |
 * | `k` | A's or B's nearest OI pivot is beyond k | at k + 1 … 2k | bars beyond k |
 * | `w` | A is more than W bars before B | W + 1 … ⌊1.5 W⌋ | bars beyond W |
 *
 * A line rule with tolerance 0 has no reach (one more tolerance is still 0): round 1's lines yield no near-miss.
 * At most one per (kind, direction, B), only for a B with no detection OF THAT KIND; of several A, the smallest
 * `miss` relative to its reach wins (the farther A on a tie, as V7 picks A). A B whose window has a hole is not
 * judged (V9).
 *
 * IB-144 (V41): run per kind. For `hidden`, `price_delta` / `oi_delta` measure the flipped (1) / (2) — the price
 * BETTER at B, OI WORSE — through the detector's own `priceGap` / `oiGap`; the line, k and W rules and their reaches
 * are unchanged (the line side follows the pivot, V40).
 */
export interface NearMiss {
  direction: Direction;
  kind: Kind;
  a: DivergenceEnd;
  b: DivergenceEnd;
  aIndex: number;
  bIndex: number;
  rule: OiNearMissRule;
  miss: number;
  unit: OiNearMissUnit;
  /** B's pairing confirmed: the close of max(B, B's OI pivot) + nRight. */
  confirmedAt: number;
}

/** V26's reach on k and W: what the bar count must cover (`barsForEvaluation(nearMissReach(p))`). */
export function nearMissReach(p: Pick<DivergenceParams, 'nLeft' | 'nRight' | 'k' | 'w'>): Pick<DivergenceParams, 'nLeft' | 'nRight' | 'k' | 'w'> {
  return { nLeft: p.nLeft, nRight: p.nRight, k: 2 * p.k, w: Math.floor(1.5 * p.w) };
}

interface Failure {
  rule: OiNearMissRule;
  miss: number;
  inReach: boolean;
}

export function diagnose(input: DivergenceInput, result: DivergenceResult): NearMiss[] {
  const { bars, params: p } = input;
  if (bars.length === 0) return [];
  const reach = nearMissReach(p);
  const oi = oiPerBar(bars.map((b) => b.time), input.oi5m, input.tfSec);
  const holes = holeFinder(input);
  // V36: the same «full A» as the detector — a near-miss must be a line the detector could have drawn
  const canBeA = aEligibility(p, { low: bars.map((b) => b.low), high: bars.map((b) => b.high) }, { low: oi.min, high: oi.max }, input.aRule ?? 'full');
  const out: NearMiss[] = [];

  for (const side of ['low', 'high'] as const) {
    const direction: Direction = side === 'low' ? 'bullish' : 'bearish';
    const series = side === 'low' ? oi.min : oi.max;
    const seriesTime = side === 'low' ? oi.minTime : oi.maxTime;
    const price = side === 'low' ? result.pivots.lows : result.pivots.highs;
    const oiPivots = side === 'low' ? result.pivots.oiLows : result.pivots.oiHighs;
    const wide = pair(price, oiPivots, side, { ...p, k: reach.k }).filter((x) => x.confirmIndex < bars.length);
    const relative = (f: Failure) => f.miss / reachOf(f.rule, p, reach);
    const end = (x: PivotPair): DivergenceEnd => ({
      time: bars[x.price].time,
      price: side === 'low' ? bars[x.price].low : bars[x.price].high,
      oiTime: seriesTime[x.oi] as number,
      oi: series[x.oi] as number,
    });

    for (const kind of KINDS) {
      const detected = new Set(result.divergences.filter((d) => d.direction === direction && d.kind === kind).map((d) => d.bIndex));
      for (const b of wide) {
        if (detected.has(b.price)) continue;
        const lo = Math.max(0, b.price - reach.w - p.nLeft);
        const hi = Math.min(bars.length - 1, b.price + reach.k + p.nRight);
        if (holes(bars[lo].time, bars[hi].time + input.tfSec)) continue;
        if (!bOiHolds(series, b)) continue; // the same B the detector could judge (IB-141 option 1)
        const noise = noiseAt(bars, series, b.price, p);
        if (noise === null) continue;
        let best: { a: PivotPair; f: Failure } | null = null;
        for (const a of wide) {
          if (!(a.price < b.price && b.price - a.price <= reach.w && a.confirmIndex <= b.confirmIndex && a.oi < b.oi && canBeA(a, b.confirmIndex))) continue;
          const failed = failures(side, kind, bars, series, a, b, noise, p, reach);
          if (failed.length !== 1 || !failed[0].inReach) continue;
          const f = failed[0];
          if (best === null || relative(f) < relative(best.f) || (relative(f) === relative(best.f) && a.price < best.a.price)) best = { a, f };
        }
        if (best === null) continue;
        out.push({
          direction, kind, a: end(best.a), b: end(b), aIndex: best.a.price, bIndex: b.price,
          rule: best.f.rule, miss: best.f.miss, unit: OI_NEAR_MISS_UNIT[best.f.rule],
          confirmedAt: bars[b.confirmIndex].time + input.tfSec,
        });
      }
    }
  }
  return out.sort((x, y) => x.confirmedAt - y.confirmedAt || x.b.time - y.b.time || KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind));
}

/** The width of each rule's reach, in its own unit — what «smallest miss relative to its unit» divides by. */
function reachOf(rule: OiNearMissRule, p: DivergenceParams, reach: Pick<DivergenceParams, 'k' | 'w'>): number {
  switch (rule) {
    case 'price_delta':
    case 'oi_delta':
      return 1;
    case 'price_line':
      return p.priceLineTolAtrMult;
    case 'oi_line':
      return p.oiLineTolMedianMult;
    case 'k':
      return reach.k - p.k;
    case 'w':
      return reach.w - p.w;
  }
}

/** Every one of the six conditions A–B fails, with how much and whether that is within reach. */
function failures(
  side: Side, kind: Kind, bars: readonly Bar[], series: ReadonlyArray<number | null>, a: PivotPair, b: PivotPair, noise: Noise,
  p: DivergenceParams, reach: Pick<DivergenceParams, 'k' | 'w'>,
): Failure[] {
  const out: Failure[] = [];
  const price = (t: number) => (side === 'low' ? bars[t].low : bars[t].high);
  const pA = price(a.price);
  const pB = price(b.price);
  const oA = series[a.oi] as number;
  const oB = series[b.oi] as number;

  // (1) δp, (2) δoi: the detector requires MORE than the threshold (strict); the gap in the kind's direction (V40)
  const worse = priceGap(side, kind, pA, pB);
  if (!(worse > noise.dp)) out.push({ rule: 'price_delta', miss: noise.dp > 0 ? (noise.dp - worse) / noise.dp : 0, inReach: noise.dp > 0 && worse >= 0 });
  const better = oiGap(side, kind, oA, oB);
  if (!(better > noise.doi)) out.push({ rule: 'oi_delta', miss: noise.doi > 0 ? (noise.doi - better) / noise.doi : 0, inReach: noise.doi > 0 && better >= 0 });

  // (3) the price line: each crossing bar against ITS ATR14 tolerance (V18)
  const under = (v: number, line: number) => (side === 'low' ? line - v : v - line);
  let priceMiss = 0;
  let priceFail = false;
  let priceReach = true;
  for (let t = a.price + 1; t < b.price; t++) {
    const c = under(price(t), lineAt(a.price, pA, b.price, pB, t));
    if (c <= 0) continue;
    const atr = atrAt(bars, t);
    const tol = p.priceLineTolAtrMult === 0 ? 0 : p.priceLineTolAtrMult * (atr ?? 0);
    if (!(c > tol)) continue;
    priceFail = true;
    if (atr === null || atr <= 0 || tol <= 0 || c > 2 * tol) priceReach = false;
    else priceMiss = Math.max(priceMiss, (c - tol) / atr);
  }
  if (priceFail) out.push({ rule: 'price_line', miss: priceMiss, inReach: priceReach });

  // (4) the OI line: one tolerance per evaluation, from δoi's median
  let oiMiss = 0;
  let oiFail = false;
  let oiReach = true;
  for (let t = a.oi + 1; t < b.oi; t++) {
    const v = series[t];
    if (v === null) continue;
    const c = under(v, lineAt(a.oi, oA, b.oi, oB, t));
    if (!(c > noise.oiLineTol)) continue;
    oiFail = true;
    if (noise.oiLineTol <= 0 || noise.med <= 0 || c > 2 * noise.oiLineTol) oiReach = false;
    else oiMiss = Math.max(oiMiss, (c - noise.oiLineTol) / noise.med);
  }
  if (oiFail) out.push({ rule: 'oi_line', miss: oiMiss, inReach: oiReach });

  // (5) k: either end's OI pivot beyond k (pairing at 2k found it, so it is within reach)
  const kDist = Math.max(Math.abs(a.oi - a.price), Math.abs(b.oi - b.price));
  if (kDist > p.k) out.push({ rule: 'k', miss: kDist - p.k, inReach: kDist <= reach.k });

  // (6) W: A more than W bars before B
  const span = b.price - a.price;
  if (span > p.w) out.push({ rule: 'w', miss: span - p.w, inReach: span <= reach.w });
  return out;
}

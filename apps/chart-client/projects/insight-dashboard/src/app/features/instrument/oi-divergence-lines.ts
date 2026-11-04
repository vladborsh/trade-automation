import { OI_DIVERGENCE_TF_SEC, OI_DIVERGENCE_TFS, type OiDivergenceTf, type WebOiDivergenceLine } from '@trade-automation/contracts';

/**
 * IB-110 (OI divergence design V8, V15) — what the instrument chart draws from
 * `/series/oi-divergences`, pure:
 * - **one line per run** — a repeat (A–C) REPLACES the line it extends (A–B): of every run only
 *   its newest line is drawn;
 * - each line is two strokes, on the price pane (wick low/high at A and B) and on the OI pane (the OI
 *   pivots); bullish teal, bearish red (colour carries the direction), a repeat dashed;
 * - the OI pane plots **USD notional**, the detector works in contracts: each OI end is the pivot's
 *   own contracts × that bar's notional ÷ contracts, so it sits in the pane's unit at the pivot's value.
 */
export const DIVERGENCE_COLOURS = { bullish: '#26a69a', bearish: '#ef5350' } as const;

export interface StrokePoint {
  time: number;
  value: number;
}

export interface DivergenceStroke {
  pane: 'price' | 'openInterest';
  direction: WebOiDivergenceLine['direction'];
  colour: string;
  dashed: boolean;
  points: [StrokePoint, StrokePoint];
}

/** The chart timeframes that have divergences (15m, 1h, 4h); null for any other. */
export function divergenceTf(timeframe: string): OiDivergenceTf | null {
  return (OI_DIVERGENCE_TFS as readonly string[]).includes(timeframe) ? (timeframe as OiDivergenceTf) : null;
}

/** V8: the newest line of each run — a run is keyed by its direction and its first line's B. */
export function visibleLines(lines: readonly WebOiDivergenceLine[]): WebOiDivergenceLine[] {
  const newest = new Map<string, WebOiDivergenceLine>();
  for (const l of lines) {
    const key = `${l.direction}:${l.repeat?.firstBTime ?? l.b.time}`;
    const kept = newest.get(key);
    if (!kept || l.b.time > kept.b.time) newest.set(key, l);
  }
  return [...newest.values()].sort((x, y) => x.b.time - y.b.time);
}

/** The bar (open, seconds) that owns an OI reading labelled `t`: the detector's rule, `open < t ≤ open + tf`. */
export const oiBarOf = (t: number, tfSec: number): number => Math.ceil(t / tfSec) * tfSec - tfSec;

/**
 * The strokes for `lines` on a chart of `tf`. `openInterest` is the OI pane's own series (contracts as
 * `value`, USD as `notional`), for the unit; an OI end whose bar has no notional is left out (its price
 * stroke still draws).
 */
export function divergenceStrokes(
  lines: readonly WebOiDivergenceLine[],
  openInterest: ReadonlyArray<{ time: number; value: number; notional: number | null }>,
  tf: OiDivergenceTf,
): DivergenceStroke[] {
  const tfSec = OI_DIVERGENCE_TF_SEC[tf];
  const usdPerContract = new Map<number, number>();
  for (const p of openInterest) {
    if (p.notional !== null && p.value > 0) usdPerContract.set(Math.floor(p.time / tfSec) * tfSec, p.notional / p.value);
  }
  const out: DivergenceStroke[] = [];
  for (const l of visibleLines(lines)) {
    const style = { direction: l.direction, colour: DIVERGENCE_COLOURS[l.direction], dashed: l.repeat !== null };
    out.push({ pane: 'price', ...style, points: [{ time: l.a.time, value: l.a.price }, { time: l.b.time, value: l.b.price }] });
    const aBar = oiBarOf(l.a.oiTime, tfSec);
    const bBar = oiBarOf(l.b.oiTime, tfSec);
    const ka = usdPerContract.get(aBar);
    const kb = usdPerContract.get(bBar);
    if (ka !== undefined && kb !== undefined && aBar < bBar) {
      out.push({ pane: 'openInterest', ...style, points: [{ time: aBar, value: l.a.oi * ka }, { time: bBar, value: l.b.oi * kb }] });
    }
  }
  return out;
}

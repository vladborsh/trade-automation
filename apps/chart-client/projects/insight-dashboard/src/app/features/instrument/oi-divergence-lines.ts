import { OI_DIVERGENCE_TF_SEC, OI_DIVERGENCE_TFS, type OiDivergenceTf, type WebOiDivergenceLine } from '@trade-automation/contracts';

/**
 * IB-110 (OI divergence design V8, V15) — what the instrument chart draws from
 * `/series/oi-divergences`, pure:
 * - **one line per run** — a repeat (A–C) REPLACES the line it extends (A–B): of every run only
 *   its newest line is drawn;
 * - each line is two strokes, on the price pane (wick low/high at A and B) and on the OI pane (the OI
 *   pivots); bullish teal, bearish red (colour carries the direction), a repeat dashed;
 * - **the OI stroke is drawn in CONTRACTS**, the detector's own unit (TL review): the OI pane's main line is
 *   USD notional, and a USD stroke can point the opposite way to the alert — TRX 1h, OI +0.76 % in contracts
 *   while price fell 8.4 %, is LOWER at B in USD. So the pane gains a thin «OI, контракты» line on its own
 *   overlay scale (`OI_CONTRACTS_SCALE`), and the stroke sits on that scale; `sign(end − start) == sign(oiPct)`
 *   holds by construction, and a spec on the recorded TRX line pins it.
 */
export const OI_CONTRACTS_SCALE = 'oi-contracts';
/**
 * IB-114 (V21, owner): the contracts line is context, the stroke on it is the signal — so the line is DIM: the
 * muted token `#8b949e` at 50 % opacity, 1 px, under the USD OI line (2 px, `#58a6ff`). The strokes keep their
 * full colour (`DIVERGENCE_COLOURS`, opaque).
 */
export const OI_CONTRACTS_COLOUR = 'rgba(139, 148, 158, 0.5)';
export const DIVERGENCE_COLOURS = { bullish: '#26a69a', bearish: '#ef5350' } as const;

export interface StrokePoint {
  time: number;
  value: number;
}

export interface DivergenceStroke {
  pane: 'price' | 'openInterest';
  /** The price pane's own unit, or OI in contracts on the `OI_CONTRACTS_SCALE` overlay. */
  unit: 'price' | 'contracts';
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
 * The strokes for `lines` on a chart of `tf`: the price stroke at the wicks, the OI stroke at the OI pivots'
 * bars in contracts (the values the detector compared).
 */
export function divergenceStrokes(lines: readonly WebOiDivergenceLine[], tf: OiDivergenceTf): DivergenceStroke[] {
  const tfSec = OI_DIVERGENCE_TF_SEC[tf];
  const out: DivergenceStroke[] = [];
  for (const l of visibleLines(lines)) {
    const style = { direction: l.direction, colour: DIVERGENCE_COLOURS[l.direction], dashed: l.repeat !== null };
    out.push({ pane: 'price', unit: 'price', ...style, points: [{ time: l.a.time, value: l.a.price }, { time: l.b.time, value: l.b.price }] });
    const aBar = oiBarOf(l.a.oiTime, tfSec);
    const bBar = oiBarOf(l.b.oiTime, tfSec);
    if (aBar < bBar) {
      out.push({ pane: 'openInterest', unit: 'contracts', ...style, points: [{ time: aBar, value: l.a.oi }, { time: bBar, value: l.b.oi }] });
    }
  }
  return out;
}

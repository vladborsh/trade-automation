import { createHash } from 'node:crypto';
import { OI_RANDOM_CONTROLS_PER_DAY, type OiDivergenceDirection, type OiDivergenceTf } from '@trade-automation/contracts';
import { atrAt, holeFinder, type Bar, type DivergenceInput, type DivergenceResult } from '../../../insights/divergence/detector';
import { entryT0 } from './path';

/**
 * IB-115 (architecture/oi-divergence-design-2026-11-04.md V25) — the two control groups, as pure picks over
 * the bars and the detector result the loop already has (no extra fetch).
 */
const DAY = 86_400;

export interface ControlPick {
  kind: 'pivot' | 'random';
  direction: OiDivergenceDirection | null;
  /** The bar's OPEN time. */
  barTime: number;
  stopPrice: number | null;
  atr14: number;
  /** V23: the confirming bar's close + 6 min, up to 5 m. Pivot: bar i + N; random: the bar itself. */
  t0: number;
}

/**
 * `random`: 2 bar closes per coin, TF and UTC day, picked by a hash of (symbol, tf, day) — a replay or a
 * restart picks the same bars. Returns the chosen bars' open times, ascending.
 */
export function randomControlBars(symbol: string, tf: OiDivergenceTf, tfSec: number, dayStartSec: number): number[] {
  const perDay = DAY / tfSec;
  const h = createHash('sha256').update(`${symbol}|${tf}|${new Date(dayStartSec * 1000).toISOString().slice(0, 10)}`).digest();
  const picks: number[] = [];
  for (let i = 0; picks.length < Math.min(OI_RANDOM_CONTROLS_PER_DAY, perDay); i++) {
    const slot = h.readUInt32BE((i * 4) % (h.length - 3)) % perDay;
    if (!picks.includes(slot)) picks.push(slot);
    if (i > 64) break; // a 32-byte digest cannot keep colliding; this only bounds the loop
  }
  return picks.sort((a, b) => a - b).map((slot) => dayStartSec + slot * tfSec);
}

/**
 * `pivot`: the price pivot(s) at the one bar this evaluation decides for good — index length − (k + N + 1),
 * the newest B whose every pairing (OI pivot up to k after it, then N to confirm) is in the window.
 * A pivot whose window [i − W − N, i + k + N] has a hole in OI is not a control: it was not judged (the hole
 * can hide the OI pivot it would have paired with — the detector skips paired ones, V9; this also covers the
 * unpaired). Whether it produced an alert is the journal's to say: the caller filters on it.
 * Direction from the kind: low → bullish, high → bearish.
 */
export function pivotControlPicks(input: DivergenceInput, result: DivergenceResult): ControlPick[] {
  const { bars, params: p, tfSec } = input;
  const i = bars.length - (p.k + p.n + 1);
  if (i < 0 || i + p.n >= bars.length) return [];
  const isLow = result.pivots.lows.includes(i);
  const isHigh = result.pivots.highs.includes(i);
  if (!isLow && !isHigh) return [];
  const atr = atrAt(bars, i);
  if (atr === null) return [];
  const lo = Math.max(0, i - p.w - p.n);
  if (holeFinder(input)(bars[lo].time, bars[bars.length - 1].time + tfSec) !== null) return [];
  const t0 = entryT0(bars[i + p.n].time + tfSec);
  const out: ControlPick[] = [];
  if (isLow) out.push({ kind: 'pivot', direction: 'bullish', barTime: bars[i].time, stopPrice: bars[i].low, atr14: atr, t0 });
  if (isHigh) out.push({ kind: 'pivot', direction: 'bearish', barTime: bars[i].time, stopPrice: bars[i].high, atr14: atr, t0 });
  return out;
}

/** `random`: the newest closed bar, when it is one of its day's picks. */
export function randomControlPick(symbol: string, tf: OiDivergenceTf, bars: readonly Bar[], tfSec: number): ControlPick | null {
  const i = bars.length - 1;
  if (i < 0) return null;
  const bar = bars[i];
  const day = Math.floor(bar.time / DAY) * DAY;
  if (!randomControlBars(symbol, tf, tfSec, day).includes(bar.time)) return null;
  const atr = atrAt(bars, i);
  if (atr === null) return null;
  return { kind: 'random', direction: null, barTime: bar.time, stopPrice: null, atr14: atr, t0: entryT0(bar.time + tfSec) };
}

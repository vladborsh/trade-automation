/**
 * IB-109 (design V4) — the 5-minute OI readings as one value per bar: the **min** of the readings
 * that belong to the bar (for lows), the **max** (for highs). Pure.
 *
 * **Which bar a reading belongs to is pinned by the venue's own timestamps**
 * (`test/fixtures/binance/open-interest-hist-labels.json`, probed 2026-11-04): Binance labels each
 * `openInterestHist` 5 m row with the MOMENT of the reading — a row labelled 17:10:00 is served at
 * 17:10:33, so it cannot describe 17:10–17:15. It is the state at the end of the slot 17:05–17:10.
 * So a bar `[open, open + tf)` owns the readings labelled `open < t ≤ open + tf`: its close's
 * reading is its own, its open's reading is the previous bar's close. Taking `open ≤ t < open + tf`
 * instead would shift every OI value by one slot (5 minutes) toward the past — the off-by-one V4
 * warns about.
 */
export const SLOT_SEC = 300;

export interface OiPoint {
  /** Unix seconds: the moment of the reading, as the venue labels it. */
  time: number;
  oi: number;
}

export interface OiPerBar {
  /** Per bar, the smallest reading it owns; null when it owns none. */
  min: Array<number | null>;
  max: Array<number | null>;
  /** The time of that reading (for the line's OI end), per bar. */
  minTime: Array<number | null>;
  maxTime: Array<number | null>;
}

/** The open time of the bar that owns a reading labelled `t` (seconds). */
export function barOpenOf(t: number, tfSec: number): number {
  return Math.ceil(t / tfSec) * tfSec - tfSec;
}

/** One value per bar from the 5 m readings. `barOpens` ascending; readings in any order. */
export function oiPerBar(barOpens: readonly number[], points: readonly OiPoint[], tfSec: number): OiPerBar {
  const index = new Map(barOpens.map((open, i) => [open, i]));
  const n = barOpens.length;
  const out: OiPerBar = { min: Array(n).fill(null), max: Array(n).fill(null), minTime: Array(n).fill(null), maxTime: Array(n).fill(null) };
  for (const p of points) {
    if (!Number.isFinite(p.oi)) continue;
    const i = index.get(barOpenOf(p.time, tfSec));
    if (i === undefined) continue;
    const lo = out.min[i];
    if (lo === null || p.oi < lo || (p.oi === lo && p.time < (out.minTime[i] as number))) {
      out.min[i] = p.oi;
      out.minTime[i] = p.time;
    }
    const hi = out.max[i];
    if (hi === null || p.oi > hi || (p.oi === hi && p.time < (out.maxTime[i] as number))) {
      out.max[i] = p.oi;
      out.maxTime[i] = p.time;
    }
  }
  return out;
}

import { OI_RESEARCH_WINDOW_SEC, type OiDivergenceDirection, type OiResearchWindow } from '@trade-automation/contracts';
import type { Bar } from '../../../insights/divergence/detector';
import { EVALUATE_AFTER_CLOSE_SEC } from '../timing';

/**
 * IB-115 (architecture/oi-divergence-design-2026-11-04.md V23, V24) — the price path of one measured row
 * (an alert, a control, a near-miss) over one window, from closed 5 m klines. Pure.
 *
 * Direction-free storage: high/low and their times give MFE and MAE for either side. The stop and the
 * favourable thresholds are direction-bound: a random control (no direction) has neither.
 */
export const PATH_BAR_SEC = 300;

/**
 * V23: `t0` = the confirming bar's close + 6 min (V9's evaluation moment), rounded UP to the next 5 m
 * boundary. Sent or not, late or not, the same `t0`: sending does not change what is measured.
 */
export function entryT0(confirmingCloseSec: number): number {
  return Math.ceil((confirmingCloseSec + EVALUATE_AFTER_CLOSE_SEC) / PATH_BAR_SEC) * PATH_BAR_SEC;
}

/** 5 m klines in a window: 48 / 288 / 864. */
export function windowBars(win: OiResearchWindow): number {
  return OI_RESEARCH_WINDOW_SEC[win] / PATH_BAR_SEC;
}

/**
 * `/fapi/v1/klines` weight by `limit` (Binance docs, USD-M «Kline/Candlestick Data»): [1, 100) 1,
 * [100, 500) 2, [500, 1000] 5, above 10. One call per window: 48 → 1, 288 → 2, 864 → 5, so 8 per subject.
 */
export function klinesWeight(limit: number): number {
  if (limit < 100) return 1;
  if (limit < 500) return 2;
  if (limit <= 1000) return 5;
  return 10;
}

/** The window is measurable once its last 5 m bar has closed and the venue has had a minute to settle it. */
export const PATH_SETTLE_SEC = 60;
export function windowClosed(t0: number, win: OiResearchWindow, nowSec: number): boolean {
  return t0 + OI_RESEARCH_WINDOW_SEC[win] + PATH_SETTLE_SEC <= nowSec;
}

export interface PathSubject {
  t0: number;
  win: OiResearchWindow;
  /** null: a random control — no stop, no thresholds. */
  direction: OiDivergenceDirection | null;
  atr14: number;
  /** B's extreme (bullish: B's low; bearish: B's high), the pivot's own for a pivot control; null for random. */
  stopPrice: number | null;
}

export interface PathMeasurement {
  /** 5 m klines the venue had in [t0, t0 + window). */
  bars: number;
  entryAt: number | null;
  entryPrice: number | null;
  high: number | null;
  highAt: number | null;
  low: number | null;
  lowAt: number | null;
  stopAt: number | null;
  fav05At: number | null;
  fav1At: number | null;
  fav2At: number | null;
  /** The stop and a threshold in the same 5 m bar: 5 m cannot order them. Null where there is no stop or no direction. */
  orderAmbiguous: boolean | null;
}

/**
 * V24 on `klines5m` (any 5 m klines; only those opening in [t0, t0 + window) count, ascending by time).
 * - entry: the open of the kline AT t0; if the venue had none there (a closed session), the first after it,
 *   and `entryAt` says which. No kline in the window: everything null, `bars` 0.
 * - `high_at` / `low_at`: the FIRST bar reaching the extreme.
 * - `stop_at`: the first bar trading BEYOND the stop (bullish: low < stop; bearish: high > stop).
 * - `fav_x_at`: the first bar whose excursion in the direction reaches x × ATR14
 *   (bullish: high − entry ≥ x·ATR; bearish: entry − low ≥ x·ATR).
 */
export function measurePath(klines5m: readonly Bar[], s: PathSubject): PathMeasurement {
  const end = s.t0 + OI_RESEARCH_WINDOW_SEC[s.win];
  const bars = klines5m.filter((b) => b.time >= s.t0 && b.time < end).sort((x, y) => x.time - y.time);
  const none: PathMeasurement = {
    bars: 0, entryAt: null, entryPrice: null, high: null, highAt: null, low: null, lowAt: null,
    stopAt: null, fav05At: null, fav1At: null, fav2At: null, orderAmbiguous: null,
  };
  if (bars.length === 0) return none;
  const entry = bars[0];
  let high = entry.high;
  let highAt = entry.time;
  let low = entry.low;
  let lowAt = entry.time;
  for (const b of bars) {
    if (b.high > high) { high = b.high; highAt = b.time; }
    if (b.low < low) { low = b.low; lowAt = b.time; }
  }
  const out: PathMeasurement = { ...none, bars: bars.length, entryAt: entry.time, entryPrice: entry.open, high, highAt, low, lowAt };
  if (s.direction === null) return out;

  const bullish = s.direction === 'bullish';
  const first = (hit: (b: Bar) => boolean): number | null => bars.find(hit)?.time ?? null;
  const reach = (mult: number) => first((b) => (bullish ? b.high - entry.open : entry.open - b.low) >= mult * s.atr14);
  out.fav05At = reach(0.5);
  out.fav1At = reach(1);
  out.fav2At = reach(2);
  if (s.stopPrice !== null) {
    const stop = s.stopPrice;
    out.stopAt = first((b) => (bullish ? b.low < stop : b.high > stop));
    out.orderAmbiguous = out.stopAt !== null && [out.fav05At, out.fav1At, out.fav2At].includes(out.stopAt);
  }
  return out;
}

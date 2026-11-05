import { LIQ_NEAR_MISS_RATIO, LIQ_QUIET_SEC, LIQ_VENUES, LIQ_WINDOW_SEC, type LiqByVenue, type LiqVenue } from '@trade-automation/contracts';

/**
 * IB-122 (design L1, L2, L8) — the sliding 5-minute window over one coin's and one side's liquidations,
 * all venues together. Pure: the loop hands it the prints it read and the alerts the journal holds.
 *
 * **No buckets.** Every print's moment `t` is a candidate; the window at `t` is (t − 5 min, t], and a
 * sum can only grow at a print, so the first `t` whose window reaches the threshold IS the crossing
 * moment — the alert's `at`, exact to the tape's millisecond. A cascade straddling a minute or a
 * 5-minute boundary is one window, so it is one alert.
 *
 * L2's quiet period: after an alert at `A`, no alert for that coin and side while `t < A + 30 min`. The
 * block also reaches back to `A − 5 min`: a print the venue delivered late can make an EARLIER moment
 * cross once it lands, and that is the same cascade, not a second one.
 */
export const WINDOW_MS = LIQ_WINDOW_SEC * 1_000;
export const QUIET_MS = LIQ_QUIET_SEC * 1_000;
const HOUR_MS = 3_600_000;

export interface LiqPrint {
  /** Epoch ms, the venue's event time. */
  ts: number;
  usd: number;
  venue: LiqVenue;
}

export interface WindowStats {
  sum: number;
  count: number;
  byVenue: LiqByVenue;
  largest: { usd: number; venue: LiqVenue };
}

export interface Crossing {
  /** Epoch ms: the first moment the window reached the threshold. */
  at: number;
  stats: WindowStats;
}

export interface NearMissCandidate {
  /** Epoch ms of the window's end. */
  at: number;
  sum: number;
  /** The UTC hour `at` falls in, epoch ms. */
  hour: number;
}

export interface ScanResult {
  alerts: Crossing[];
  /** L8: per UTC hour, the largest window in [0.5, 1) × threshold that was not inside a quiet period. */
  nearMisses: Map<number, NearMissCandidate>;
}

/** L8: the largest candidate of each UTC hour. */
export function bestPerHour(candidates: readonly NearMissCandidate[]): Map<number, NearMissCandidate> {
  const out = new Map<number, NearMissCandidate>();
  for (const c of candidates) {
    const best = out.get(c.hour);
    if (!best || c.sum > best.sum) out.set(c.hour, c);
  }
  return out;
}

/** True when `t` is inside the quiet period of an alert at `a` (see the module comment). */
export function quietAt(t: number, alertAts: readonly number[]): boolean {
  return alertAts.some((a) => t > a - WINDOW_MS && t < a + QUIET_MS);
}

/** The window (t − 5 min, t] over prints sorted by `ts`. */
export function statsAt(prints: readonly LiqPrint[], t: number): WindowStats {
  const byVenue = Object.fromEntries(LIQ_VENUES.map((v) => [v, 0])) as LiqByVenue;
  let sum = 0;
  let count = 0;
  let largest: { usd: number; venue: LiqVenue } = { usd: 0, venue: 'binance' };
  for (const p of prints) {
    if (p.ts <= t - WINDOW_MS || p.ts > t) continue;
    sum += p.usd;
    count++;
    byVenue[p.venue] += p.usd;
    if (p.usd > largest.usd) largest = { usd: p.usd, venue: p.venue };
  }
  return { sum, count, byVenue, largest };
}

/**
 * Every candidate moment in (fromMs, toMs], oldest first. `prints` must be sorted by `ts` and must hold
 * everything in (fromMs − 5 min, toMs]; the loop reads exactly that.
 *
 * `alertAts`: the journal's alerts for this coin and side (their `at`), which open quiet periods.
 */
export function scanSide(
  prints: readonly LiqPrint[], fromMs: number, toMs: number, thresholdUsd: number, alertAts: readonly number[],
): ScanResult {
  const prefix: number[] = [0];
  for (const p of prints) prefix.push((prefix[prefix.length - 1] as number) + p.usd);
  const quiet = [...alertAts];
  const out: ScanResult = { alerts: [], nearMisses: new Map() };
  const candidates: NearMissCandidate[] = [];
  let lo = 0;
  for (let i = 0; i < prints.length; i++) {
    const t = (prints[i] as LiqPrint).ts;
    if (t <= fromMs) continue;
    if (t > toMs) break;
    if (i + 1 < prints.length && (prints[i + 1] as LiqPrint).ts === t) continue; // the window at t includes every print AT t
    while ((prints[lo] as LiqPrint).ts <= t - WINDOW_MS) lo++;
    const sum = (prefix[i + 1] as number) - (prefix[lo] as number);
    if (quietAt(t, quiet)) continue;
    if (sum >= thresholdUsd) {
      out.alerts.push({ at: t, stats: statsAt(prints, t) });
      quiet.push(t);
      continue;
    }
    if (sum >= LIQ_NEAR_MISS_RATIO * thresholdUsd) candidates.push({ at: t, sum, hour: Math.floor(t / HOUR_MS) * HOUR_MS });
  }
  // a window that built up to an alert found later in this scan is that alert's prelude, not a near-miss
  out.nearMisses = bestPerHour(candidates.filter((c) => !quietAt(c.at, out.alerts.map((a) => a.at))));
  return out;
}


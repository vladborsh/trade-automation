import type { WebInsightSpark } from '@trade-automation/contracts';

/**
 * IB-107 (market-page design D24, §7.3) — the mini-chart behind a statement, made from a series the
 * rule ALREADY holds. Pure: nothing here fetches, so a spark can never cost a venue call. Fewer than
 * two usable values is no chart (`null`, honest), never a padded one.
 */
export const SPARK_MAX = 30;

/**
 * The last `max` values (≤ 30), with `highlight` (an index into `values`) moved to the kept window —
 * or null if the highlighted value fell outside it. Non-finite values are a bug upstream, not a bar:
 * a series holding one gives no spark rather than a chart with a hole that looks like a zero.
 */
export function sparkOf(values: readonly number[], highlight: number | null, max = SPARK_MAX): WebInsightSpark | null {
  if (values.length < 2 || values.some((v) => !Number.isFinite(v))) return null;
  const keep = Math.min(max, SPARK_MAX, values.length);
  const drop = values.length - keep;
  const h = highlight === null || highlight < drop || highlight >= values.length ? null : highlight - drop;
  return { values: values.slice(drop), highlight: h };
}

/** The tail of a series with "now" appended and highlighted — R2's own sample plus the current window, R7. */
export function sparkWithNow(sample: readonly number[], now: number, max: number): WebInsightSpark | null {
  const values = [...sample.slice(Math.max(0, sample.length - (max - 1))), now];
  return sparkOf(values, values.length - 1, max);
}

/**
 * R10: a minute series → means over consecutive `stepSec` buckets of the last `windowSec`, ending at
 * the series' own last minute (60 minutes → 30 two-minute values). Anchored on the data, not a clock:
 * the minutes are the ones the rule's premium was measured on. A bucket with no valid minute is
 * skipped, not a 0 — a 0 % premium is a claim.
 */
export function bucketMeans(points: readonly { time: number; value: number }[], windowSec: number, stepSec: number): number[] {
  const valid = points.filter((p) => Number.isFinite(p.value));
  if (valid.length === 0) return [];
  const end = Math.max(...valid.map((p) => p.time)) + 60; // minute starts: the last minute is inside
  const from = end - windowSec;
  const sums = new Map<number, { sum: number; n: number }>();
  for (const p of valid) {
    if (p.time < from || p.time >= end) continue;
    const k = Math.floor((p.time - from) / stepSec);
    const b = sums.get(k) ?? { sum: 0, n: 0 };
    sums.set(k, { sum: b.sum + p.value, n: b.n + 1 });
  }
  return [...sums.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b.sum / b.n);
}

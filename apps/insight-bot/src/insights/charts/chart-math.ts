import { WEB_INSIGHT_CHART_MAX_POINTS, type WebInsightChart, type WebInsightChartPoint } from '@trade-automation/contracts';

/**
 * IB-119 (market round 2 §3) — the arithmetic the per-rule charts share. Pure: nothing here reads a
 * venue or the database.
 */

/** Non-finite points are a bug upstream, not a value: they are dropped, never drawn as a zero. */
export function finitePoints(points: readonly WebInsightChartPoint[]): WebInsightChartPoint[] {
  return points.filter((p) => Number.isFinite(p.value) && Number.isFinite(p.time));
}

/**
 * A LINE longer than `max` points, sampled evenly with the first and the last always kept (a line
 * thinned this way keeps its shape and both ends). Bars are never thinned: `tail` keeps the newest.
 */
export function thin(points: readonly WebInsightChartPoint[], max = WEB_INSIGHT_CHART_MAX_POINTS): WebInsightChartPoint[] {
  if (points.length <= max) return [...points];
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)] as WebInsightChartPoint);
}

export function tail<T>(points: readonly T[], max = WEB_INSIGHT_CHART_MAX_POINTS): T[] {
  return points.slice(Math.max(0, points.length - max));
}

/**
 * A series as % change from its FIRST point (R4, R11: price and OI on one axis). Null when the first
 * value is not positive: a change from zero is not a percentage.
 */
export function pctFromFirst(points: readonly WebInsightChartPoint[]): WebInsightChartPoint[] | null {
  const base = points[0]?.value;
  if (base === undefined || !(base > 0)) return null;
  return points.map((p) => ({ time: p.time, value: (p.value / base - 1) * 100 }));
}

const sortedAsc = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);

/**
 * The index K (1-based) such that a value is rare (rarity ≥ 0.90 by `rarity`'s mid-rank) exactly when
 * it is ABOVE the K-th smallest sample value: past e_K at least K of n lie below it, and K/n ≥ 0.90;
 * at or under e_K at most K − 1 do. The one inexact case is a value EQUAL to e_K with ties above it,
 * where mid-rank may still reach 0.90 — the band then calls a tied edge "normal".
 */
const rareRank = (n: number, show: number) => Math.min(n, Math.ceil(show * n));

/**
 * R2's band — ONE-sided, like its rarity (`rarity(usd, sample)`: only "more" is unusual): from the
 * sample's minimum to e_K. A bar above `hi` is a bar the rule would call rare.
 */
export function upperBand(sample: readonly number[], show: number): { lo: number; hi: number } | null {
  if (sample.length === 0) return null;
  const s = sortedAsc(sample);
  return { lo: s[0] as number, hi: s[rareRank(s.length, show) - 1] as number };
}

/**
 * R5's band — TWO-sided, like `levelRarity`: the median ± the K-th smallest distance from it. A value
 * outside is exactly one whose `levelRarity` reaches `show` (bar the tie noted at `rareRank`). This is
 * not p5–p95: on a skewed sample p5–p95 can call a value normal that the rarity calls rare, and the
 * band must agree with the card's own claim.
 */
export function levelBand(sample: readonly number[], show: number): { lo: number; hi: number } | null {
  if (sample.length === 0) return null;
  const s = sortedAsc(sample);
  const mid = s.length >> 1;
  const median = s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
  const d = sortedAsc(sample.map((v) => Math.abs(v - median)))[rareRank(s.length, show) - 1] as number;
  return { lo: median - d, hi: median + d };
}

/** A chart, or null when no series kept a point (an empty chart is not a chart). */
export function chartOf(c: Omit<WebInsightChart, 'series'> & { series: Array<{ key: WebInsightChart['series'][number]['key']; points: WebInsightChartPoint[] | null }> }): WebInsightChart | null {
  const series = c.series
    .map((s) => ({ key: s.key, points: s.points === null ? [] : finitePoints(s.points) }))
    .filter((s) => s.points.length > 0)
    .map((s) => ({ key: s.key, points: c.kind === 'lines' ? thin(s.points) : tail(s.points) }));
  if (series.length === 0) return null;
  if (c.kind === 'bars_mirror' && series.length !== 2) return null;
  return { ...c, series };
}

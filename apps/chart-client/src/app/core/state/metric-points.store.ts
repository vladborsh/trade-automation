import { Injectable, signal } from '@angular/core';
import type { MetricPoint } from '@trade-automation/contracts';

/**
 * Merge a live metric point into an ascending, `time`-sorted series
 * (architecture/chart-layouts.md §4.2: identity is (metric, instrument,
 * timeframe, time)) — mirrors `mergeCandle` (candles.store.ts): same `time`
 * replaces the existing point in place (the forming-bucket update case), a
 * newer `time` appends. A point older than the last known one is ignored
 * rather than inserted mid-series.
 */
export function mergePoint(series: readonly MetricPoint[], incoming: MetricPoint): MetricPoint[] {
  if (series.length === 0) {
    return [incoming];
  }
  const last = series[series.length - 1];
  if (incoming.time === last.time) {
    return [...series.slice(0, -1), incoming];
  }
  if (incoming.time > last.time) {
    return [...series, incoming];
  }
  const idx = series.findIndex((p) => p.time === incoming.time);
  if (idx >= 0) {
    return [...series.slice(0, idx), incoming, ...series.slice(idx + 1)];
  }
  // older than everything we have and not a replace: drop it, do not corrupt ordering
  return series.slice();
}

/**
 * Prepend an older page of metric-point history for scroll-back pagination.
 * Mirrors `prependHistory` (candles.store.ts).
 */
export function prependPoints(series: readonly MetricPoint[], older: readonly MetricPoint[]): MetricPoint[] {
  if (older.length === 0) {
    return series.slice();
  }
  if (series.length === 0) {
    return older.slice();
  }
  const firstKnown = series[0].time;
  const filtered = older.filter((p) => p.time < firstKnown);
  return [...filtered, ...series];
}

/**
 * MetricPoint[] container for one panel's metric series (architecture/chart-layouts.md
 * §6.2) — not `providedIn: 'root'`; one instance is constructed per `PanelFeed`.
 */
@Injectable()
export class MetricPointsStore {
  private readonly series = signal<MetricPoint[]>([]);
  readonly points = this.series.asReadonly();

  setHistory(points: MetricPoint[]): void {
    this.series.set([...points].sort((a, b) => a.time - b.time));
  }

  clear(): void {
    this.series.set([]);
  }

  mergeLive(point: MetricPoint): void {
    this.series.update((current) => mergePoint(current, point));
  }

  prepend(older: MetricPoint[]): void {
    this.series.update((current) => prependPoints(current, older));
  }

  lastTime(): number | null {
    const current = this.series();
    return current.length > 0 ? current[current.length - 1].time : null;
  }

  firstTime(): number | null {
    const current = this.series();
    return current.length > 0 ? current[0].time : null;
  }
}

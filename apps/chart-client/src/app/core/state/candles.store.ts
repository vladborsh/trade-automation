import { Injectable, signal } from '@angular/core';
import type { Candle } from '@trade-automation/contracts';

/**
 * Merge a live candle frame into an ascending, `openTime`-sorted series
 * (§5.3 step 3): same `openTime` replaces the existing bar in place (the
 * forming-bar update case), a newer `openTime` appends. A frame older than
 * the last known bar (a stale/duplicate frame arriving out of order) is
 * ignored rather than inserted mid-series.
 *
 * Pure function so it is testable without any Angular/DI machinery.
 */
export function mergeCandle(series: readonly Candle[], incoming: Candle): Candle[] {
  if (series.length === 0) {
    return [incoming];
  }
  const last = series[series.length - 1];
  if (incoming.openTime === last.openTime) {
    return [...series.slice(0, -1), incoming];
  }
  if (incoming.openTime > last.openTime) {
    return [...series, incoming];
  }
  const idx = series.findIndex((c) => c.openTime === incoming.openTime);
  if (idx >= 0) {
    return [...series.slice(0, idx), incoming, ...series.slice(idx + 1)];
  }
  // older than everything we have and not a replace: drop it, do not corrupt ordering
  return series.slice();
}

/**
 * Prepend an older page of history fetched for scroll-back pagination
 * (§5.3 step 4). Assumes `older` is ascending and entirely before
 * `series[0]`; de-dupes on `openTime` defensively in case of an overlapping
 * boundary bar.
 */
export function prependHistory(series: readonly Candle[], older: readonly Candle[]): Candle[] {
  if (older.length === 0) {
    return series.slice();
  }
  if (series.length === 0) {
    return older.slice();
  }
  const firstKnown = series[0].openTime;
  const filtered = older.filter((c) => c.openTime < firstKnown);
  return [...filtered, ...series];
}

@Injectable({ providedIn: 'root' })
export class CandlesStore {
  private readonly series = signal<Candle[]>([]);
  readonly candles = this.series.asReadonly();

  setHistory(candles: Candle[]): void {
    this.series.set([...candles].sort((a, b) => a.openTime - b.openTime));
  }

  clear(): void {
    this.series.set([]);
  }

  mergeLive(candle: Candle): void {
    this.series.update((current) => mergeCandle(current, candle));
  }

  prepend(older: Candle[]): void {
    this.series.update((current) => prependHistory(current, older));
  }

  lastOpenTime(): number | null {
    const current = this.series();
    return current.length > 0 ? current[current.length - 1].openTime : null;
  }

  firstOpenTime(): number | null {
    const current = this.series();
    return current.length > 0 ? current[0].openTime : null;
  }
}

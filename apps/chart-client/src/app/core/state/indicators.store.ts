import { Injectable, signal } from '@angular/core';
import type { IndicatorPoint } from '@trade-automation/contracts';

function pointKey(point: IndicatorPoint): string {
  return `${point.strategyId}|${point.seriesId}|${point.time}`;
}

/**
 * Merge a live indicator point into a list keyed on
 * `(strategyId, seriesId, time)` (architecture/vwap-band-reversal-plugin.md
 * §3.2) — a point at a time already present replaces it (a strategy
 * re-emitting the same closed bar), otherwise it is appended. Not
 * necessarily ascending across strategies/series, callers sort per-group.
 */
export function mergeIndicatorPoint(list: readonly IndicatorPoint[], incoming: IndicatorPoint): IndicatorPoint[] {
  const key = pointKey(incoming);
  const idx = list.findIndex((p) => pointKey(p) === key);
  if (idx >= 0) {
    return [...list.slice(0, idx), incoming, ...list.slice(idx + 1)];
  }
  return [...list, incoming];
}

/** IndicatorPoint[] for the currently selected instrument: history load + live append. */
@Injectable({ providedIn: 'root' })
export class IndicatorsStore {
  private readonly list = signal<IndicatorPoint[]>([]);
  readonly points = this.list.asReadonly();

  setHistory(points: IndicatorPoint[]): void {
    this.list.set(points.slice());
  }

  clear(): void {
    this.list.set([]);
  }

  append(point: IndicatorPoint): void {
    this.list.update((current) => mergeIndicatorPoint(current, point));
  }
}

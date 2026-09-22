/**
 * How a series' new data relates to what the chart last rendered, so `ChartComponent` can pick the
 * cheap path. Candles and metric points share the rule, keyed by their time field (ms):
 * - `update` — the same count (the forming bar changed) or one more (a bar appended): update the last;
 * - `prepend` — older bars loaded at the front (scroll-back pagination): the newest bar is unchanged
 *   but the count grew by more than one; the visible range must be preserved across the setData;
 * - `replace` — anything else (first data, a timeframe switch, a reload): full setData.
 */
export type RenderDiff = 'update' | 'prepend' | 'replace';

export function renderDiff(lastCount: number, lastTimeMs: number | null, count: number, newestTimeMs: number): RenderDiff {
  if (lastCount > 0 && (count === lastCount || count === lastCount + 1)) return 'update';
  if (lastTimeMs !== null && count > lastCount && newestTimeMs === lastTimeMs) return 'prepend';
  return 'replace';
}

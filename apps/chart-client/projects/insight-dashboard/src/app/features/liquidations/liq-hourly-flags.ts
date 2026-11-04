import type { WebLiquidationHourly } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
import type { HourlyLayout } from './liq-layout';
import { formatRatio, formatUsd } from './liquidations.format';

/**
 * IB-108 (market-page design §7.6) — the hourly chart's two callouts, read from its own bars: the
 * LARGEST bucket («03:00 · лонги $14.4M · ×9 от нормы») and the LAST one («сейчас · шорты $11.3M»).
 * Each names the bucket's bigger side and that side's amount. «× нормы» only when the bucket has a
 * ratio to the norm (IB-089: none for a partial bucket, none before the norm exists) — never
 * invented. One flag when the largest bucket IS the last one; none for an empty chart.
 *
 * TL review: the «now» flag is drawn only when the current bucket is MATERIAL — at least
 * `NOW_MIN_SHARE` (10 %) of the chart's largest bucket, or `NOW_MIN_RATIO` (×2) its norm once norms
 * exist. «сейчас · лонги $292» beside a $48M hour drew the eye to nothing.
 *
 * Geometry: a flag sits BESIDE its bar, never over it — to the bar's left in the right half of the
 * chart, to its right in the left half — at the end of the bar's bigger side, kept inside the chart.
 */
export const FLAG_H = 26;
export const NOW_MIN_SHARE = 0.1;
export const NOW_MIN_RATIO = 2;

export interface HourFlag {
  kind: 'max' | 'now';
  key: StringKey;
  params: { time: number; sideKey: StringKey; usd: string; ratio: string };
  side: 'long' | 'short';
  /** `left`: the flag's left edge at `x`; `right`: its right edge at `x`. CSS pixels of the chart. */
  anchor: 'left' | 'right';
  x: number;
  /** The flag's top edge. */
  y: number;
}

export function hourlyFlags(hourly: WebLiquidationHourly, layout: HourlyLayout, size: { width: number; height: number }): HourFlag[] {
  const n = hourly.buckets.length;
  if (n === 0 || layout.empty) return [];
  const total = (i: number) => hourly.buckets[i].long + hourly.buckets[i].short;
  let max = 0;
  for (let i = 1; i < n; i++) if (total(i) > total(max)) max = i;
  const last = n - 1;
  const ratio = layout.bars[last].ratio;
  const material = total(last) >= NOW_MIN_SHARE * total(max) || (ratio !== null && ratio >= NOW_MIN_RATIO);
  const picks: Array<{ i: number; kind: HourFlag['kind'] }> = max === last
    ? [{ i: last, kind: 'now' }]
    : [{ i: max, kind: 'max' }, ...(material ? [{ i: last, kind: 'now' as const }] : [])];
  return picks.filter(({ i }) => total(i) > 0).map(({ i, kind }) => flag(hourly, layout, size, i, kind));
}

function flag(hourly: WebLiquidationHourly, layout: HourlyLayout, size: { width: number; height: number }, i: number, kind: HourFlag['kind']): HourFlag {
  const b = hourly.buckets[i];
  const bar = layout.bars[i];
  const side: HourFlag['side'] = b.long > b.short ? 'long' : 'short';
  const ratio = formatRatio(bar.ratio);
  const right = bar.x + bar.w / 2 > size.width / 2;
  const end = side === 'short' ? bar.shortY : bar.longY + bar.longH - FLAG_H;
  return {
    kind,
    key: (kind === 'now' ? (ratio ? 'liq.flag.nowNorm' : 'liq.flag.now') : ratio ? 'liq.flag.maxNorm' : 'liq.flag.max') as StringKey,
    params: { time: b.time, sideKey: side === 'long' ? 'liq.side.longs' : 'liq.side.shorts', usd: formatUsd(side === 'long' ? b.long : b.short), ratio: ratio ?? '' },
    side,
    anchor: right ? 'right' : 'left',
    x: right ? Math.max(0, bar.x - 4) : Math.min(size.width, bar.x + bar.w + 4),
    y: Math.max(0, Math.min(size.height - FLAG_H, end)),
  };
}

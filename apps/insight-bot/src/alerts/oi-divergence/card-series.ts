import { OI_DIVERGENCE_TF_SEC, type WebOiDivergenceAlert } from '@trade-automation/contracts';
import { oiPerBar, type OiPoint } from '../../insights/divergence/oi-per-bar';

/**
 * IB-113 (OI divergence design V16) — the card's spark: OI per bar from A to B, the series the alert
 * was about — the per-bar MIN for a bullish one (lows), the MAX for a bearish one, the same rule the
 * detector used (V4). From our own stored 5 m readings: no venue call. A bar that owns no reading is
 * dropped, not drawn as zero. Longer than `max` bars, it is sampled evenly, A and B always kept.
 */
export function cardOiSeries(alert: Pick<WebOiDivergenceAlert, 'tf' | 'direction' | 'a' | 'b'>, points: readonly OiPoint[], max = 30): number[] {
  const tfSec = OI_DIVERGENCE_TF_SEC[alert.tf];
  const opens: number[] = [];
  for (let t = alert.a.time; t <= alert.b.time; t += tfSec) opens.push(t);
  const perBar = oiPerBar(opens, points, tfSec);
  const series = (alert.direction === 'bullish' ? perBar.min : perBar.max).filter((v): v is number => v !== null && Number.isFinite(v));
  if (series.length <= max) return series;
  const step = (series.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => series[Math.round(i * step)] as number);
}

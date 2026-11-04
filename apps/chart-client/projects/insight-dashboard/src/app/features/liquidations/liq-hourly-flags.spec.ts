import type { WebLiquidationHourly } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { ru } from '../../i18n/ru';
import { FLAG_H, hourlyFlags, NOW_MIN_RATIO, NOW_MIN_SHARE } from './liq-hourly-flags';
import { hourlyLayout } from './liq-layout';

/** IB-108 — the hourly chart's callouts: the largest bucket and the last one, from the bars themselves. */
const size = { width: 600, height: 240 };
const T0 = 1_793_700_000;
const hourly = (buckets: Array<[long: number, short: number, partial?: boolean]>, total: number | null = null): WebLiquidationHourly => ({
  bucketSec: 3600,
  buckets: buckets.map(([long, short, partial = false], i) => ({ time: T0 + i * 3600, long, short, partial, rarity: null, outlier: false })),
  norm: { long: total === null ? null : total / 2, short: total === null ? null : total / 2, total },
  basis: { window: '30d', sample: 0, withData: 0, unavailable: null } as never,
});
const flags = (h: WebLiquidationHourly) => hourlyFlags(h, hourlyLayout(h, size), size);

describe('hourlyFlags', () => {
  it('the largest bucket and the last: each names its bigger side and that side’s amount', () => {
    const f = flags(hourly([[1e6, 1e5], [14.4e6, 2e6], [3e5, 1e5], [1e6, 11.3e6]]));
    expect(f.map((x) => [x.kind, x.side, x.params.usd, x.params.time])).toEqual([
      ['max', 'long', '$14M', T0 + 3600], // the page's formatUsd (whole above $10M)
      ['now', 'short', '$11M', T0 + 3 * 3600],
    ]);
    expect(f.map((x) => x.key)).toEqual(['liq.flag.max', 'liq.flag.now']); // no norm → no «×»
    expect(f.map((x) => x.params.sideKey)).toEqual(['liq.side.longs', 'liq.side.shorts']);
  });

  it('«× от нормы» only when the bucket has a ratio to the norm — never for a partial bucket', () => {
    const f = flags(hourly([[1e6, 1e6], [9e6, 0], [0, 4e6, true]], 1e6));
    expect(f[0]).toMatchObject({ key: 'liq.flag.maxNorm', params: { ratio: '×9' } });
    expect(f[1]).toMatchObject({ key: 'liq.flag.now', params: { ratio: '' } });
  });

  it('one flag when the largest bucket is the last; none for an empty chart or an empty last hour', () => {
    expect(flags(hourly([[1e5, 0], [0, 5e6]])).map((x) => x.kind)).toEqual(['now']);
    expect(flags(hourly([[0, 0], [0, 0]]))).toEqual([]);
    expect(flags(hourly([[5e6, 0], [0, 0]])).map((x) => x.kind)).toEqual(['max']);
  });

  it('TL review: «now» only when the current bucket is material — ≥ 10 % of the largest, or ×2 its norm', () => {
    expect(NOW_MIN_SHARE).toBe(0.1);
    expect(NOW_MIN_RATIO).toBe(2);
    // $292 beside a $48M hour: noise — only the largest is flagged
    expect(flags(hourly([[1e6, 1e6], [0, 48e6], [292, 0]])).map((x) => x.kind)).toEqual(['max']);
    // just under 10 % of the largest: still none; at 10 %: flagged, on its larger side
    expect(flags(hourly([[0, 0], [0, 48e6], [4.7e6, 0.09e6]])).map((x) => x.kind)).toEqual(['max']);
    expect(flags(hourly([[0, 0], [0, 48e6], [4.0e6, 0.8e6]])).map((x) => [x.kind, x.side])).toEqual([['max', 'short'], ['now', 'long']]);
    // small against the largest, but twice its norm: material once norms exist
    const withNorm = flags(hourly([[0, 0], [0, 48e6], [2.5e6, 0]], 1e6));
    expect(withNorm.map((x) => [x.kind, x.key])).toEqual([['max', 'liq.flag.maxNorm'], ['now', 'liq.flag.nowNorm']]);
    // and under ×2 of the norm, still under 10 %: none
    expect(flags(hourly([[0, 0], [0, 48e6], [1.5e6, 0]], 1e6)).map((x) => x.kind)).toEqual(['max']);
  });

  it('beside its bar, never over it, and inside the chart: left of a bar in the right half, right of one in the left half', () => {
    const h = hourly([[1e5, 0], [30e6, 0], [0, 0], [0, 0], [0, 0], [0, 20e6]]);
    const layout = hourlyLayout(h, size);
    const [max, now] = hourlyFlags(h, layout, size);
    const barOf = (time: number) => layout.bars.find((b) => b.time === time)!;
    expect(max.anchor).toBe('left');
    expect(max.x).toBeGreaterThanOrEqual(barOf(max.params.time).x + barOf(max.params.time).w);
    expect(now.anchor).toBe('right');
    expect(now.x).toBeLessThanOrEqual(barOf(now.params.time).x);
    for (const f of [max, now]) {
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.y + FLAG_H).toBeLessThanOrEqual(size.height);
    }
    // a long sits at the bottom end of its bar, a short at the top end
    expect(max.y).toBeGreaterThan(layout.axisY - FLAG_H);
    expect(now.y).toBeLessThan(layout.axisY);
  });

  it('every flag key reads in both languages with the same placeholders', () => {
    for (const key of ['liq.flag.max', 'liq.flag.maxNorm', 'liq.flag.now', 'liq.flag.nowNorm'] as const) {
      for (const t of [ru, en]) expect((t as Record<string, string>)[key]).toMatch(/\{side\} \{usd\}/);
    }
  });
});

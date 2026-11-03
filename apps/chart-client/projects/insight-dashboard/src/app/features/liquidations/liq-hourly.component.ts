import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { WebLiquidationHourly } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { hostWidth } from '../../ui/host-width';
import { hourlyLayout, tickLabel, type HourBarView } from './liq-layout';
import { formatRatio, formatUsd } from './liquidations.format';

/**
 * IB-089 (D8a) — market-wide crypto liquidations per bucket as mirrored bars: shorts up, longs
 * down, the per-bucket norm as a dashed line per side, «×» over the outliers. A tap on a bar
 * (hover has no phone equivalent, D16) states its numbers under the chart.
 */
@Component({
  selector: 'app-liq-hourly',
  standalone: true,
  templateUrl: './liq-hourly.component.html',
  styleUrl: './liq-hourly.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiqHourlyComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly hourly = input.required<WebLiquidationHourly>();
  /** Why there is no norm line, or what the norm is — in words, under the chart. */
  readonly note = input<string | null>(null);

  readonly height = 160;
  readonly width = hostWidth(342);
  readonly layout = computed(() => hourlyLayout(this.hourly(), { width: this.width(), height: this.height }));
  readonly selected = signal<number | null>(null);
  readonly detail = computed(() => {
    const time = this.selected();
    const bar = this.layout().bars.find((b) => b.time === time);
    return bar ? this.describe(bar) : null;
  });

  label(time: number): string {
    return tickLabel(time, this.hourly().bucketSec);
  }

  pick(time: number): void {
    this.selected.set(this.selected() === time ? null : time);
  }

  private describe(bar: HourBarView): string {
    const b = this.hourly().buckets.find((x) => x.time === bar.time)!;
    const params = { time: this.label(b.time), short: formatUsd(b.short), long: formatUsd(b.long) };
    return bar.ratio === null
      ? this.t('liq.hourly.detail', params)
      : this.t('liq.hourly.detailRatio', { ...params, ratio: formatRatio(bar.ratio) as string });
  }
}

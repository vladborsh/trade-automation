import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { WebKpisResponse } from '@trade-automation/contracts';
import { I18nService } from '../../../i18n/i18n.service';
import { KpiChartComponent } from './kpi-chart.component';
import { kpiTileView, type KpiTileView } from './kpi-tile';

/**
 * IB-088 (D10), IB-106 (design §7.5) — the KPI strip: five tiles (IB-117 dropped F&G) filling the row
 * (`auto-fit, minmax(200px, 1fr)`). Each tile: label (its source in the tooltip), the value with
 * its delta or word beside it, a 6 px bar — or, IB-118, a 7-day chart with its min / max row — a muted
 * note, and a small visible credit only where
 * the source's terms ask for one (CoinGecko). A tile the server could not fill
 * says «нет данных» in words. What goes where is `kpi-tile.ts`.
 */
@Component({
  selector: 'app-kpi-strip',
  standalone: true,
  imports: [KpiChartComponent],
  templateUrl: './kpi-strip.component.html',
  styleUrl: './kpi-strip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiStripComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly kpis = input<WebKpisResponse | null>(null);
  readonly tiles = computed(() => (this.kpis()?.tiles ?? []).map(kpiTileView));

  /** IB-118: the chart's accessible name — the range row it sits on, in words. */
  rangeLabel(tile: KpiTileView): string {
    const r = tile.range;
    return [r?.left, r?.right].filter((x) => !!x).map((x) => this.t(x!.key, x!.params)).join(' / ');
  }
}

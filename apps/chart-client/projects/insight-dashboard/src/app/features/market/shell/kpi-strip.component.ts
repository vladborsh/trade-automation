import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { WebKpisResponse } from '@trade-automation/contracts';
import { I18nService } from '../../../i18n/i18n.service';
import { kpiView } from './market-text';

/**
 * IB-088 (D10) — the KPI strip: value, signed and coloured delta, the context line and the source
 * beside the figure (alternative.me's attribution for F&G, §5). A tile the server could not fill
 * says «нет данных» in words.
 */
@Component({
  selector: 'app-kpi-strip',
  standalone: true,
  templateUrl: './kpi-strip.component.html',
  styleUrl: './kpi-strip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiStripComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly kpis = input<WebKpisResponse | null>(null);
  readonly tiles = computed(() => (this.kpis()?.tiles ?? []).map((tile) => ({ id: tile.id, view: kpiView(tile) })));
}

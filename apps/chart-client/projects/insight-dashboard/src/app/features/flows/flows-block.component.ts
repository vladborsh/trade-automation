import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { WebFlowsResponse, WebInsightBlockLine, WebMarketPeriod } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { CardComponent } from '../../ui/card.component';
import { BlockConclusionComponent } from '../market/shell/block-conclusion.component';
import { flowsTiles, sourceNames, type Words } from './flows-layout';
import { MiniChartComponent } from './mini-chart.component';

/**
 * IB-091 — «Деривативы и потоки» (market-page phase 2, cut 2026-11-03): DVOL, put/call by OI,
 * stablecoin supply and the Coinbase premium (D18), each a tile with its figure, what it means,
 * an «необычно» badge at D2's threshold, a mini-chart, and — when it has no figure — why. Every
 * source is credited under the tiles; the block ends with its conclusion line (R8–R10).
 * IB-108 (§7.6): an `app-card`; the four tiles as the KPI strip's sub-tiles — value `.num`, the
 * mini-chart from each tile's own `series`, the meaning muted — and «Вывод:» in the card's slot.
 */
@Component({
  selector: 'app-flows-block',
  standalone: true,
  imports: [CardComponent, MiniChartComponent, BlockConclusionComponent],
  templateUrl: './flows-block.component.html',
  styleUrl: './flows-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlowsBlockComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly flows = input.required<WebFlowsResponse>();
  readonly period = input<WebMarketPeriod>('24h');
  readonly line = input<WebInsightBlockLine | null | undefined>(null);

  readonly tiles = computed(() => flowsTiles(this.flows(), this.period()));
  readonly sources = computed(() => sourceNames(this.flows()));

  say(w: Words): string {
    const params = { ...w.params };
    if (typeof params['period'] === 'string') params['period'] = this.t(`market.period.${params['period']}` as Words['key']);
    return this.t(w.key, params);
  }
}

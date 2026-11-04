import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { WebInsightBlockLine, WebLiquidationsOverviewResponse, WebMarketPeriod } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { CardComponent } from '../../ui/card.component';
import { BlockConclusionComponent } from '../market/shell/block-conclusion.component';
import { blockView, type NormNote } from './liq-layout';
import { LiqHourlyComponent } from './liq-hourly.component';
import { LiqLargeComponent } from './liq-large.component';
import { LiqWhereComponent } from './liq-where.component';
import { formatUsd } from './liquidations.format';

/**
 * IB-089 — the market page's liquidation block (design D8, D15, D17): totals for the period, the
 * mirrored hourly bars, «где» as diverging bars, the large ones as a bubble timeline with cards,
 * and the block's one conclusion line. Replaces IB-038's card, table and feed.
 *
 * IB-108 (§7.6): three `app-card`s — «по часам» and «где» side by side when they fit
 * (`flex: 999 1 560px` / `1 1 380px`), «крупные» at full width, ending with the block's «Вывод:».
 */
@Component({
  selector: 'app-liquidations-block',
  standalone: true,
  imports: [CardComponent, LiqHourlyComponent, LiqWhereComponent, LiqLargeComponent, BlockConclusionComponent],
  templateUrl: './liquidations-block.component.html',
  styleUrl: './liquidations-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidationsBlockComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly overview = input.required<WebLiquidationsOverviewResponse>();
  readonly period = input<WebMarketPeriod>('24h');
  readonly line = input<WebInsightBlockLine | null | undefined>(null);
  readonly nowSec = input(Math.floor(Date.now() / 1000));

  readonly view = computed(() => blockView(this.overview(), this.period(), this.nowSec()));

  say(note: NormNote | null): string | null {
    return note === null ? null : this.t(note.key, note.params);
  }

  largeMin(): string {
    return formatUsd(this.overview().block.largeMinUsd);
  }

  hourlyTitle(): string {
    return this.overview().block.hourly.bucketSec > 3600 ? this.t('liq.hourly.title4h') : this.t('liq.hourly.title');
  }

  periodLabel(): string {
    return this.t(`market.period.${this.period()}` as StringKey);
  }
}

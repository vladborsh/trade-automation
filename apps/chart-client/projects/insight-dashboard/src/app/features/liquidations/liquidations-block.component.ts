import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { WebInsightBlockLine, WebLiquidationsOverviewResponse, WebMarketPeriod } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { BlockConclusionComponent } from '../market/shell/block-conclusion.component';
import { blockView, type NormNote } from './liq-layout';
import { LiqHourlyComponent } from './liq-hourly.component';
import { LiqLargeComponent } from './liq-large.component';
import { LiqWhereComponent } from './liq-where.component';

/**
 * IB-089 — the market page's liquidation block (design D8, D15, D17): totals for the period, the
 * mirrored hourly bars, «где» as diverging bars, the large ones as a bubble timeline with cards,
 * and the block's one conclusion line. Replaces IB-038's card, table and feed.
 */
@Component({
  selector: 'app-liquidations-block',
  standalone: true,
  imports: [LiqHourlyComponent, LiqWhereComponent, LiqLargeComponent, BlockConclusionComponent],
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

  periodLabel(): string {
    return this.t(`market.period.${this.period()}` as StringKey);
  }
}

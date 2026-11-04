import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { WebLiquidationLargeEvent } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { hostWidth } from '../../ui/host-width';
import { bubbleLayout, largeCards, tickLabel, type LargeCard } from './liq-layout';
import { collapseRows } from './liq-where-collapse';
import { formatUsd } from './liquidations.format';

/**
 * IB-089 (D8c) — the period's large liquidations: a bubble timeline (radius ∝ √USD, shorts above,
 * longs below) and cards with «× медианы» and the series. A bubble or a card opens the instrument
 * at that minute — IB-088's link format, `/instrument/<sym>?at=<sec>`.
 * IB-108 (§7.6): the cards four across (`minmax(240px, 1fr)`), folded at 8 at every width with
 * IB-101's `collapseRows` and «Показать все (N)»; IB-089's context lines stay on each card.
 */
@Component({
  selector: 'app-liq-large',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './liq-large.component.html',
  styleUrl: './liq-large.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiqLargeComponent {
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly large = input.required<readonly WebLiquidationLargeEvent[]>();
  readonly minUsd = input(0);
  /** The period on the time axis, unix seconds. */
  readonly from = input.required<number>();
  readonly to = input.required<number>();
  readonly bucketSec = input(3_600);
  readonly note = input<string | null>(null);

  readonly height = 140;
  readonly width = hostWidth(342);
  readonly layout = computed(() => bubbleLayout(this.large(), { from: this.from(), to: this.to() }, { width: this.width(), height: this.height }));
  readonly cards = computed(() => largeCards(this.large()));
  readonly collapsed = computed(() => collapseRows(this.cards().map((card) => ({ ...card, usd: card.event.usd }))));
  readonly expanded = signal(false);
  readonly visible = computed(() => (this.expanded() ? this.cards() : this.collapsed().shown));
  readonly usd = formatUsd;

  label(time: number): string {
    return tickLabel(time, this.bucketSec());
  }

  time(event: WebLiquidationLargeEvent): string {
    return tickLabel(event.time, 60);
  }

  side(event: WebLiquidationLargeEvent): string {
    return this.t(event.side === 'long' ? 'liq.side.longs' : 'liq.side.shorts');
  }

  open(card: Pick<LargeCard, 'link'> | WebLiquidationLargeEvent): void {
    const link = 'link' in card ? card.link : largeCards([card])[0].link;
    void this.router.navigate(link.commands, { queryParams: link.queryParams });
  }

  word(x: { key: StringKey; params: Record<string, string | number> }): string {
    return this.t(x.key, x.params);
  }
}

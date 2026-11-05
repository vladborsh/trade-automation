import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { venueName, type WebLiquidationEpisode } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { CHART_H, CHART_W, episodeChart } from './liq-episode-chart';
import {
  coinChips, coinSentence, episodeLink, episodeMinutes, episodeTime, plural, priceFacts, venueChips, type Text,
} from './liq-episodes';
import { tickLabel } from './liq-layout';
import { formatUsd } from './liquidations.format';

/**
 * IB-134 (liquidation-episodes design E6) — one episode: when, which side, how much (left); how many
 * prints in how long, the coin sentence and the coin/venue chips (middle); the mini chart and the
 * price facts of the episode's largest coin, with the link to it (right). A tap anywhere but the
 * link opens the episode's largest prints (≤ 20, already in the answer — no request).
 * Phone: one column, the chart at full width under the chips.
 */
@Component({
  selector: 'app-liq-episode-card',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './liq-episode-card.component.html',
  styleUrl: './liq-episode-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiqEpisodeCardComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly episode = input.required<WebLiquidationEpisode>();
  /** 1-based place among the shown cards. */
  readonly rank = input.required<number>();
  /** 7d: times carry the day (the table's rule, IB-120). */
  readonly withDay = input(false);
  /** The page's coin / venue filters: their chips are highlighted, the figures stay whole-episode (E5). */
  readonly symbol = input('all');
  readonly venue = input('all');
  /** The page's minimum: the expanded prints are already cut to it by the server; named in the empty line. */
  readonly minUsd = input(0);

  readonly open = signal(false);
  readonly w = CHART_W;
  readonly h = CHART_H;
  readonly usd = formatUsd;

  readonly time = computed(() => episodeTime(this.episode(), this.withDay()));
  readonly what = computed(() => {
    const e = this.episode();
    return this.text({ key: 'liqEp.card.what', params: { prints: this.text(plural('prints', e.count)), minutes: this.text(plural('minutes', episodeMinutes(e))) } });
  });
  readonly coinLine = computed(() => {
    const s = coinSentence(this.episode());
    return s === null ? null : this.text(s);
  });
  readonly coins = computed(() => coinChips(this.episode(), this.symbol()));
  readonly venues = computed(() => venueChips(this.episode(), this.venue()));
  readonly chart = computed(() => episodeChart(this.episode()));
  readonly facts = computed(() => priceFacts(this.episode()));
  readonly link = computed(() => episodeLink(this.episode()));
  readonly prints = computed(() => this.episode().prints.map((p) => ({
    ...p, when: tickLabel(p.time, this.withDay() ? 86_400 : 60), venueName: venueName(p.venue), amount: formatUsd(p.usd),
  })));

  /** ① … ⑳: the mockup's circled rank. */
  rankMark(): string {
    return String.fromCharCode(0x245f + Math.min(Math.max(this.rank(), 1), 20));
  }

  sideLabel(): string {
    return this.t(this.episode().side === 'short' ? 'liqEp.side.short' : 'liqEp.side.long');
  }

  text(x: Text): string {
    return this.t(x.key, x.params);
  }

  /** A tap anywhere on the card except a link (which navigates) opens or closes the prints. */
  toggle(event: Event): void {
    if ((event.target as Element | null)?.closest('a')) return;
    this.open.update((v) => !v);
  }
}

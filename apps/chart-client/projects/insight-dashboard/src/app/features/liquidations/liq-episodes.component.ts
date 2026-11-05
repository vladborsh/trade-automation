import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { WebLiquidationEpisodesResponse } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { LiqEpisodeCardComponent } from './liq-episode-card.component';
import { episodeMinutes, episodesState, episodeTime, plural, segments, shortNormDays, type Segment, type Text } from './liq-episodes';
import { formatUsd } from './liquidations.format';

/**
 * IB-134 (liquidation-episodes design E3, E4) — the episode view: the summary line with the amber
 * «not Market» line under it, then the cards (largest first, capped by the server) and the fold:
 * «ещё {n} эпизодов поменьше · все ликвидации списком →». The link carries no count (IB-120 ruling).
 * The `collecting` state is the page's: it shows the flat list instead (E2).
 */
@Component({
  selector: 'app-liq-episodes',
  standalone: true,
  imports: [RouterLink, LiqEpisodeCardComponent],
  templateUrl: './liq-episodes.component.html',
  styleUrl: './liq-episodes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiqEpisodesComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly answer = input.required<WebLiquidationEpisodesResponse>();
  /** The flat list's URL parameters (the page's, plus `view=list`). */
  readonly listParams = input.required<Record<string, string | null>>();

  readonly week = computed(() => this.answer().query.period === '7d');
  readonly state = computed(() => episodesState(this.answer()));
  readonly threshold = computed(() => {
    const n = this.answer().norm;
    return n.status === 'ready' ? formatUsd(n.thresholdUsd) : null;
  });
  readonly normDays = computed(() => shortNormDays(this.answer()));
  readonly usd = formatUsd;

  /** E4, in the language's own word order; the parts the template colours are named. */
  readonly summary = computed<Segment[]>(() => {
    const r = this.answer();
    const period = this.t(`liqEp.period.${r.query.period}` as StringKey);
    const largest = r.episodes.find((e) => e.id === r.summary.largestId);
    if (r.summary.count === 0 || largest === undefined) {
      return segments(this.i18n.table()['liqEp.summary.none'], { period, usd: this.threshold() ?? '' });
    }
    return segments(this.i18n.table()['liqEp.summary'], {
      period,
      count: this.text(plural('episodes', r.summary.count)),
      shorts: this.text(plural('times', r.summary.shorts)),
      longs: this.text(plural('times', r.summary.longs)),
      shortsWord: this.t('liqEp.summary.shortsWord'),
      longsWord: this.t('liqEp.summary.longsWord'),
      when: episodeTime({ from: largest.from, to: largest.from }, true),
      coin: largest.coins[0].base,
      usd: formatUsd(largest.usd),
      minutes: this.text(plural('minutes', episodeMinutes(largest))),
    });
  });

  /** «…на «Рынке» — здесь их нет», with «Рынке» as the router link to Market at this period. */
  readonly notMarket = computed(() => segments(this.i18n.table()['liqEp.notMarket'], { market: this.t('liqEp.notMarket.link') }));
  readonly marketParams = computed(() => ({ p: this.answer().query.period }));

  readonly folded = computed(() => {
    const n = this.answer().folded;
    return n > 0 ? this.text(plural('folded', n)) : null;
  });

  text(x: Text): string {
    return this.t(x.key, x.params);
  }
}

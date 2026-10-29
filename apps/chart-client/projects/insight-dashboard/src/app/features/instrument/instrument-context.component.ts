import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  WebLiquidationCoin, WebLiquidationsOverviewResponse, WebMarketCardsResponse,
} from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { LoaderComponent } from '../../ui/loader.component';
import { LiquidationsNowComponent } from '../liquidations/liquidations-now.component';
import { fearGreedBand } from '../market/market.adapter';
import { percent, signed } from '../market/market.format';
import type { NowTiles } from './instrument-now';

/**
 * The column beside the instrument chart (2026-10-24 redesign, §13): what the coin looks like now,
 * its liquidation summary, and two market cards for context.
 *
 * The market cards are this component's own fetch, once: they are the same for every coin, so the
 * page does not refetch them when the symbol changes.
 */
@Component({
  selector: 'app-instrument-context',
  standalone: true,
  imports: [RouterLink, LiquidationsNowComponent, LoaderComponent],
  templateUrl: './instrument-context.component.html',
  styleUrl: './instrument-context.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstrumentContextComponent {
  readonly symbol = input.required<string>();
  readonly now = input.required<NowTiles>();
  readonly liqCoin = input<WebLiquidationCoin | null>(null);
  readonly liqVenues = input<WebLiquidationsOverviewResponse['venues']>({ present: [], missing: [] });
  /** The page is fetching this coin's window: the "now" tiles are about to change, so they show skeletons. */
  readonly loading = input(false);

  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  private readonly cards = signal<WebMarketCardsResponse | null>(null);
  readonly cardsLoading = signal(true);

  readonly fearGreed = computed(() => {
    const fg = this.cards()?.fearGreed;
    if (!fg) return null;
    const band = fearGreedBand(fg.now.value);
    return { value: fg.now.value, label: this.t(band.key), colour: band.colour };
  });

  readonly dominance = computed(() => {
    const dom = this.cards()?.dominance;
    if (!dom) return null;
    const change = signed(dom.changePct24h, 2);
    return {
      share: percent(dom.btcPct, 1),
      change: change === null ? null : this.t('market.dominance.day', { change: this.t('market.points', { value: change }) }),
    };
  });

  constructor() {
    void this.loadCards();
  }

  private async loadCards(): Promise<void> {
    try {
      this.cards.set(await this.api.marketCards());
    } catch {
      this.cards.set(null); // the column keeps its other sections; the cards say "no data"
    } finally {
      this.cardsLoading.set(false);
    }
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, signal, type OnDestroy } from '@angular/core';
import type { WebLiquidationsOverviewResponse, WebMarketCardsResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { LiquidationsFeedComponent } from '../liquidations/liquidations-feed.component';
import { LiquidationsNowComponent } from '../liquidations/liquidations-now.component';
import { LiquidationsWhereComponent } from '../liquidations/liquidations-where.component';
import { coinPrice, fearGreedBand } from './market.adapter';
import { asOfUtc, capUsd, fractionPercent, fractionSigned, percent, signed } from './market.format';

/** The liquidation overview is polled with the page; the server caches 15 s (IB-038 §12.3). */
export const POLL_MS = 30_000;

/**
 * architecture/insight-bot-web-dashboard.md §12.1 (ruling 2026-10-07) — the market page, and the
 * dashboard's landing page.
 *
 * **There is no chart here, and that is the requirement, not a simplification.** The user said it
 * twice: Fear & Greed, BTC dominance and the liquidations are information cards. A sparkline is a
 * chart with its axes hidden, so there is no SVG on this page at all — if a reader had to read a
 * shape to get the number, the card would have failed.
 *
 * What replaces the lines: every card states **the value, its unit, the instant it was measured and
 * the venue it came from**, and expresses change as a sentence («в прошлый опубликованный день 44 —
 * нейтрально») rather than a slope. A change the server cannot compute arrives as `null` and is
 * rendered in words — the dominance series is collected forward and can never be backfilled (§10),
 * so «данных пока за N дней» is a true statement where a flat line would be a false one.
 *
 * The component derives nothing: `/context/cards` returns the cards (`market-cards.ts`, server-side
 * and pure) and this class only formats. IB-038's three liquidation surfaces mount underneath,
 * unwrapped and input-only, which is the seam agreed with dev-2.
 */
@Component({
  selector: 'app-market',
  standalone: true,
  imports: [LiquidationsNowComponent, LiquidationsWhereComponent, LiquidationsFeedComponent],
  templateUrl: './market.component.html',
  styleUrl: './market.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketComponent implements OnDestroy {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly cards = signal<WebMarketCardsResponse | null>(null);
  readonly liquidations = signal<WebLiquidationsOverviewResponse | null>(null);
  readonly error = signal<string | null>(null);
  readonly liquidationsError = signal<string | null>(null);
  readonly loading = signal(true);
  readonly minUsd = signal(100_000);

  readonly fearGreed = computed(() => this.cards()?.fearGreed ?? null);
  readonly dominance = computed(() => this.cards()?.dominance ?? null);
  readonly btcVsTop = computed(() => this.cards()?.btcVsTop ?? null);
  readonly caps = computed(() => this.cards()?.caps ?? []);
  readonly capsDay = computed(() => this.cards()?.capsDay ?? null);

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    void this.load();
    // only the liquidation half is polled: the cards' sources publish once a day and once every
    // few minutes, so re-reading them on a timer would spend queries to redraw the same figures
    this.timer = setInterval(() => void this.loadLiquidations(), POLL_MS);
  }

  ngOnDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.cards.set(await this.api.marketCards());
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.loading.set(false);
    }
    await this.loadLiquidations();
  }

  /**
   * Separate from the cards on purpose: a failing liquidation query must not blank the market
   * cards, and vice versa. They come from different collectors and fail independently.
   */
  async loadLiquidations(): Promise<void> {
    this.liquidationsError.set(null);
    try {
      this.liquidations.set(await this.api.liquidationsOverview(this.minUsd()));
    } catch (err) {
      this.liquidationsError.set(this.t('liq.loadFailed', { message: (err as Error).message }));
    }
  }

  onMinUsdChange(value: number): void {
    this.minUsd.set(value);
    void this.loadLiquidations();
  }

  /** The band's label key and colour, from the same value the venue's own wording describes. */
  readonly band = fearGreedBand;
  readonly asOf = asOfUtc;
  readonly signed = signed;
  readonly percent = percent;
  readonly cap = capUsd;
  readonly share = fractionPercent;
  readonly change = fractionSigned;
  readonly price = coinPrice;
}

import { ChangeDetectionStrategy, Component, computed, inject, signal, type OnDestroy } from '@angular/core';
import type { WebLiquidationsOverviewResponse, WebMarketCardsResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { LoaderComponent } from '../../ui/loader.component';
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
  imports: [LiquidationsNowComponent, LiquidationsWhereComponent, LiquidationsFeedComponent, LoaderComponent],
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
  readonly liquidationsLoading = signal(true);
  /** Nothing to show yet: the cards draw skeletons. A refresh over shown cards is the header's inline loader. */
  readonly firstLoad = computed(() => this.loading() && this.cards() === null);
  /** Only the first liquidation read gets a loader; the 30 s poll replaces content in place. */
  readonly liquidationsFirstLoad = computed(() => this.liquidationsLoading() && this.liquidations() === null);

  readonly fearGreed = computed(() => this.cards()?.fearGreed ?? null);
  readonly dominance = computed(() => this.cards()?.dominance ?? null);
  readonly btcVsTop = computed(() => this.cards()?.btcVsTop ?? null);
  readonly caps = computed(() => this.cards()?.caps ?? []);
  readonly capsDay = computed(() => this.cards()?.capsDay ?? null);
  /**
   * Read live from the venues, nothing stored (2026-10-24). A move the venue does not publish free
   * is then simply not shown, rather than explained as a collection that is still young.
   */
  readonly live = computed(() => this.cards()?.live ?? false);

  /**
   * Only the coins that actually have a cap for the day, and a count of the ones that do not.
   *
   * Fifteen rows of «нет данных» is the same mistake IB-038 avoided with its empty coins: it fills
   * the screen with the absence of information instead of stating it once. The count is the fact —
   * and the share card above already says what the denominator was.
   */
  readonly heldCaps = computed(() => this.caps().filter((row) => row.capUsd !== null));
  readonly missingCaps = computed(() => this.caps().length - this.heldCaps().length);

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
    this.liquidationsLoading.set(true);
    try {
      this.liquidations.set(await this.api.liquidationsOverview(this.minUsd()));
    } catch (err) {
      this.liquidationsError.set(this.t('liq.loadFailed', { message: (err as Error).message }));
    } finally {
      this.liquidationsLoading.set(false);
    }
  }

  onMinUsdChange(value: number): void {
    this.minUsd.set(value);
    void this.loadLiquidations();
  }

  /** The band's label key and colour, from the same value the venue's own wording describes. */
  readonly band = fearGreedBand;
  readonly asOf = asOfUtc;
  readonly cap = capUsd;
  readonly price = coinPrice;

  /**
   * A figure **with its unit**, or «нет данных» — one method, because the unit and the absence have
   * to be decided together.
   *
   * The first render put the unit in the sentence («За неделю {change} п.п.») and produced «За
   * неделю нет данных п.п.», a unit hanging off a phrase that has no number. So the sentence takes
   * one finished clause and these three build it: a known value carries `п.п.` / `%`, an unknown
   * one carries nothing but the words saying so.
   */
  points(value: number | null): string {
    const body = signed(value);
    return body === null ? this.t('market.unknown') : this.t('market.points', { value: body });
  }

  percent(value: number | null, { sign = false } = {}): string {
    const body = sign ? signed(value) : percent(value);
    return body === null ? this.t('market.unknown') : this.t('market.percent', { value: body });
  }

  /** The caps table stores shares and changes as 0..1 fractions; same rule, one conversion earlier. */
  fraction(value: number | null, { sign = false } = {}): string {
    const body = sign ? fractionSigned(value) : fractionPercent(value);
    return body === null ? this.t('market.unknown') : this.t('market.percent', { value: body });
  }
}

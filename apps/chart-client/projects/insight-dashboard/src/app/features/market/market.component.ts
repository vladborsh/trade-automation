import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import type {
  WebInsightsResponse, WebKpisResponse, WebLiquidationsOverviewResponse, WebMarketCardsResponse, WebMarketPeriod,
} from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { LoaderComponent } from '../../ui/loader.component';
import { LiquidationsFeedComponent } from '../liquidations/liquidations-feed.component';
import { LiquidationsNowComponent } from '../liquidations/liquidations-now.component';
import { LiquidationsWhereComponent } from '../liquidations/liquidations-where.component';
import { coinPrice, fearGreedBand } from './market.adapter';
import { asOfUtc, capUsd, fractionPercent, fractionSigned, percent, signed } from './market.format';
import { BlockScheduler, liveAge, type BlockId } from './shell/block-scheduler';
import { InsightsBlockComponent } from './shell/insights-block.component';
import { KpiStripComponent } from './shell/kpi-strip.component';
import { parsePeriod } from './shell/market-text';
import { PeriodSwitchComponent } from './shell/period-switch.component';

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
 *
 * **IB-088 (market-page design D13–D16): this is now the page SHELL.** The period is page-wide and in
 * the URL (`?p=`); every block is loaded by one `BlockScheduler` at its own cadence (liquidations
 * 10 s, insights and KPIs 60 s, caps 120 s), paused while the tab is hidden; a block's error stays on
 * that block. The header shows the oldest block's age. There is no Refresh button and no page-wide
 * poll. The liquidation and cap surfaces below are slots IB-089/IB-090 replace.
 */
@Component({
  selector: 'app-market',
  standalone: true,
  imports: [
    LiquidationsNowComponent, LiquidationsWhereComponent, LiquidationsFeedComponent, LoaderComponent,
    PeriodSwitchComponent, KpiStripComponent, InsightsBlockComponent,
  ],
  templateUrl: './market.component.html',
  styleUrl: './market.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly period = signal<WebMarketPeriod>(parsePeriod(this.route.snapshot.queryParamMap.get('p')));
  readonly cards = signal<WebMarketCardsResponse | null>(null);
  readonly liquidations = signal<WebLiquidationsOverviewResponse | null>(null);
  readonly kpis = signal<WebKpisResponse | null>(null);
  readonly insights = signal<WebInsightsResponse | null>(null);
  readonly minUsd = signal(100_000);
  /** Ticks every second so the live indicator's age moves without a request. */
  readonly nowMs = signal(Date.now());
  /** The scheduler's per-block state, re-read whenever it changes. */
  private readonly blocks = signal(new Map<BlockId, { error: string | null; loaded: boolean }>());

  readonly firstLoad = computed(() => this.cards() === null && !this.blockError('caps'));
  readonly liquidationsFirstLoad = computed(() => this.liquidations() === null && !this.blockError('liquidations'));
  readonly nowSec = computed(() => Math.floor(this.nowMs() / 1000));
  readonly age = computed(() => liveAge(this.scheduler.snapshot(), this.nowMs()));

  readonly fearGreed = computed(() => this.cards()?.fearGreed ?? null);
  readonly dominance = computed(() => this.cards()?.dominance ?? null);
  readonly btcVsTop = computed(() => this.cards()?.btcVsTop ?? null);
  readonly caps = computed(() => this.cards()?.caps ?? []);
  readonly capsDay = computed(() => this.cards()?.capsDay ?? null);
  /** Read live from the venues, nothing stored (2026-10-24): an unpublished move is simply not shown. */
  readonly live = computed(() => this.cards()?.live ?? false);
  /** Only the coins with a cap for the day, and a count of the rest (twenty rows of «нет данных» is not information). */
  readonly heldCaps = computed(() => this.caps().filter((row) => row.capUsd !== null));
  readonly missingCaps = computed(() => this.caps().length - this.heldCaps().length);

  private readonly scheduler: BlockScheduler;

  constructor() {
    const doc = inject(DOCUMENT);
    this.scheduler = new BlockScheduler(
      { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      () => this.syncBlocks(),
    );
    // A response is kept only if the parameters it was asked with are still the page's: a period
    // switch during a request must not show the old period's answer under the new label.
    this.scheduler.register('liquidations', async () => {
      const [minUsd, period] = [this.minUsd(), this.period()];
      const r = await this.api.liquidationsOverview(minUsd, 30, period);
      if (minUsd === this.minUsd() && period === this.period()) this.liquidations.set(r);
    });
    this.scheduler.register('kpis', async () => this.kpis.set(await this.api.marketKpis()));
    this.scheduler.register('insights', async () => {
      const period = this.period();
      const r = await this.api.marketInsights(period);
      if (period === this.period()) this.insights.set(r);
    });
    this.scheduler.register('caps', async () => this.cards.set(await this.api.marketCards()));
    this.scheduler.start();

    const onVisibility = () => this.scheduler.setVisible(doc.visibilityState !== 'hidden');
    doc.addEventListener('visibilitychange', onVisibility);
    const clock = setInterval(() => this.nowMs.set(Date.now()), 1_000);
    inject(DestroyRef).onDestroy(() => {
      this.scheduler.stop();
      clearInterval(clock);
      doc.removeEventListener('visibilitychange', onVisibility);
    });
  }

  /** D14: a new period is a new URL and a fresh read of every period-dependent block. */
  onPeriodChange(p: WebMarketPeriod): void {
    this.period.set(p);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { p }, queryParamsHandling: 'merge', replaceUrl: true });
    this.scheduler.refresh('liquidations');
    this.scheduler.refresh('insights');
  }

  onMinUsdChange(value: number): void {
    this.minUsd.set(value);
    this.scheduler.refresh('liquidations');
  }

  /** This block's error, shown on this block only (D13). */
  blockError(id: BlockId): string | null {
    return this.blocks().get(id)?.error ?? null;
  }

  private syncBlocks(): void {
    this.blocks.set(new Map(this.scheduler.snapshot().map((b) => [b.id, { error: b.state.error, loaded: b.state.lastOkAt !== null }])));
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

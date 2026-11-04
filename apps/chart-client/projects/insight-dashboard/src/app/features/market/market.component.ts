import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import type {
  WebCapsResponse, WebInsightBlock, WebInsightBlockLine, WebInsightsResponse, WebPositioningResponse, WebKpisResponse, WebLiquidationsOverviewResponse, WebMarketCardsResponse, WebMarketPeriod,
} from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { LoaderComponent } from '../../ui/loader.component';
import { CapsBlockComponent } from '../caps/caps-block.component';
import { LiquidationsBlockComponent } from '../liquidations/liquidations-block.component';
import { PositioningBlockComponent } from '../positioning/positioning-block.component';
import { BlockConclusionComponent } from './shell/block-conclusion.component';
import { FearGreedGaugeComponent } from './fear-greed-gauge.component';
import { fearGreedBand } from './market.adapter';
import { BlockScheduler, liveAge, type BlockId } from './shell/block-scheduler';
import { bindVisibility } from './shell/scheduler-visibility';
import { InsightsBlockComponent } from './shell/insights-block.component';
import { KpiStripComponent } from './shell/kpi-strip.component';
import { parsePeriod } from './shell/market-text';
import { PeriodSwitchComponent } from './shell/period-switch.component';

/**
 * The market page, and the dashboard's landing page (architecture/market-page-design-2026-11-03.md).
 *
 * History, because the comment used to say the opposite: §12.1 (ruling 2026-10-07) made this a page
 * of information cards with no chart at all. The 2026-11-03 redesign (D12) replaced the cards with
 * charts that each state their basis — mirrored bars, a quadrant, a treemap — because the owner
 * found the cards dry and cramped. What carried over is the rule behind §12.1: every figure has its
 * unit, its source and its basis, and an absent number is said in words, never drawn as zero.
 *
 * This class is the SHELL (IB-088, D13–D16): the period is page-wide and in the URL (`?p=`); one
 * `BlockScheduler` loads every block at its own cadence (liquidations 10 s, insights / KPIs /
 * positioning 60 s, caps / sentiment 120 s), paused while the tab is hidden; a block's error stays on
 * that block; the header shows the newest update's age. Each block is its own component and ends
 * with its D15 conclusion line; the Fear & Greed card (/context/cards) is the one card left.
 */
@Component({
  selector: 'app-market',
  standalone: true,
  imports: [
    LiquidationsBlockComponent, PositioningBlockComponent, CapsBlockComponent, BlockConclusionComponent, LoaderComponent,
    PeriodSwitchComponent, KpiStripComponent, InsightsBlockComponent, FearGreedGaugeComponent
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
  readonly positioning = signal<WebPositioningResponse | null>(null);
  readonly caps = signal<WebCapsResponse | null>(null);
  /** Ticks every second so the live indicator's age moves without a request. */
  readonly nowMs = signal(Date.now());
  /** The scheduler's per-block state, re-read whenever it changes. */
  private readonly blocks = signal(new Map<BlockId, { error: string | null; loaded: boolean }>());

  readonly firstLoad = computed(() => this.cards() === null && !this.blockError('sentiment'));
  readonly nowSec = computed(() => Math.floor(this.nowMs() / 1000));
  readonly age = computed(() => liveAge(this.scheduler.snapshot(), this.nowMs()));
  readonly staleTitle = computed(() => {
    const late = this.age()?.stale ?? [];
    return late.length === 0 ? null : this.t('market.liveStale', { blocks: late.map((id) => this.t(`market.block.${id}` as StringKey)).join(', ') });
  });

  readonly fearGreed = computed(() => this.cards()?.fearGreed ?? null);

  private readonly scheduler: BlockScheduler;

  constructor() {
    const doc = inject(DOCUMENT);
    this.scheduler = new BlockScheduler(
      { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      () => this.syncBlocks(),
    );
    // A response is kept only if the parameters it was asked with are still the page's: a period
    // switch during a request must not show the old period's answer under the new label.
    // IB-089: the page reads only `block`; the IB-038 feed is asked for one row (its min and
    // limit are the server's to clamp), not thirty nobody draws.
    this.scheduler.register('liquidations', async () => {
      const period = this.period();
      const r = await this.api.liquidationsOverview(100_000, 1, period);
      if (period === this.period()) this.liquidations.set(r);
    });
    this.scheduler.register('kpis', async () => this.kpis.set(await this.api.marketKpis()));
    this.scheduler.register('insights', async () => {
      const period = this.period();
      const r = await this.api.marketInsights(period);
      if (period === this.period()) this.insights.set(r);
    });
    this.scheduler.register('positioning', async () => {
      const period = this.period();
      const r = await this.api.marketPositioning(period);
      if (period === this.period()) this.positioning.set(r);
    });
    this.scheduler.register('caps', async () => {
      const period = this.period();
      const r = await this.api.marketCaps(period);
      if (period === this.period()) this.caps.set(r);
    });
    this.scheduler.register('sentiment', async () => this.cards.set(await this.api.marketCards()));
    // IB-BUG-021: the current visibility first, so a page loaded in a background tab stays silent
    const detachVisibility = bindVisibility(doc, this.scheduler);
    this.scheduler.start();

    const clock = setInterval(() => this.nowMs.set(Date.now()), 1_000);
    inject(DestroyRef).onDestroy(() => {
      this.scheduler.stop();
      clearInterval(clock);
      detachVisibility();
    });
  }

  /** D14: a new period is a new URL and a fresh read of every period-dependent block. */
  onPeriodChange(p: WebMarketPeriod): void {
    this.period.set(p);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { p }, queryParamsHandling: 'merge', replaceUrl: true });
    for (const id of ['liquidations', 'insights', 'positioning', 'caps'] as const) this.scheduler.refresh(id);
  }

  /** D15: that block's one conclusion line from the insights response. */
  insightLine(block: WebInsightBlock): WebInsightBlockLine | null {
    return this.insights()?.blocks.find((b) => b.block === block) ?? null;
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
}

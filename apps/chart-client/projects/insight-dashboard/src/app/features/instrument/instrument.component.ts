import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import type {
  WebCandlesResponse, WebFundingResponse, WebLiquidationEventsResponse, WebLiquidationCoin,
  WebLiquidationsOverviewResponse, WebLiquidationsResponse, WebLongShortResponse,
  WebTimeframe, WebTopLiquidation, WebUniverseSymbol,
} from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { formatUsd } from '../liquidations/liquidations.format';
import { LiquidationsNowComponent } from '../liquidations/liquidations-now.component';
import { InstrumentChartComponent, type PaneData } from './instrument-chart.component';
import {
  allowedTimeframes, bucketFor, effectiveTimeframe, findPreset, isRefused, RANGE_PRESETS,
  rangeOf, type RangePreset,
} from './time-range';

/**
 * architecture/insight-bot-web-dashboard.md §2 — one time-aligned screen for a symbol: price,
 * open interest, liquidations, taker delta and CVD, funding, long/short, and the 50 largest
 * liquidations in the window.
 *
 * The class is wiring only; every mapping lives in `series.adapter.ts` and every range rule in
 * `time-range.ts`, each with its own spec (AGENTS.md). The charts are a child component so this
 * one stays about *what to fetch* and that one about *how to draw*.
 */
@Component({
  selector: 'app-instrument',
  standalone: true,
  imports: [FormsModule, DatePipe, DecimalPipe, InstrumentChartComponent, LiquidationsNowComponent],
  templateUrl: './instrument.component.html',
  styleUrl: './instrument.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstrumentComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly symbol = signal<string>('BTCUSDT');
  readonly universe = signal<WebUniverseSymbol[]>([]);
  readonly preset = signal<RangePreset>(findPreset('1d') as RangePreset);
  readonly timeframe = signal<WebTimeframe>('1m');
  readonly market = signal<'perp' | 'spot'>('perp');
  readonly typed = signal('');

  readonly panes = signal<PaneData | null>(null);
  readonly top = signal<WebTopLiquidation[]>([]);
  /**
   * IB-039 — this instrument's row out of IB-038's overview, for the summary under the chart.
   *
   * The SAME endpoint and the same component as the landing card, not a copy: the overview
   * already computes 1 h / 4 h / 24 h per coin with the norm basis and the venue honesty line,
   * it is cached 15 s server-side, and a second implementation of «× от нормы» is exactly the
   * duplicated-threshold drift I deleted from the server in IB-038.
   */
  readonly liqCoin = signal<WebLiquidationCoin | null>(null);
  readonly liqVenues = signal<WebLiquidationsOverviewResponse['venues']>({ present: [], missing: [] });
  /**
   * The 24 h total, for the scope line that sits ABOVE the fold.
   *
   * The summary card is below it — the Tech Lead ruled on 2026-10-12 that the row keeps its full
   * height rather than shrinking to rescue the card — so the visible line carries the number and
   * says where the detail is. Same figure as the card's 24 h window, formatted the same way, so
   * the two cannot disagree.
   */
  readonly liqTotal24h = computed(() => {
    const window = this.liqCoin()?.windows.find((w) => w.window === '24h');
    return window ? formatUsd(window.total.usd) : null;
  });
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** Set when the page asked for a coarser frame than the one chosen, so it can say so. */
  readonly coarsenedTo = signal<WebTimeframe | null>(null);

  readonly presets = RANGE_PRESETS;
  readonly timeframes = computed(() => allowedTimeframes(this.preset()));
  readonly downsampled = computed(() => {
    const panes = this.panes();
    return panes !== null && (panes.candles.downsampled || panes.liquidations.downsampled);
  });

  constructor() {
    const fromRoute = this.route.snapshot.paramMap.get('symbol');
    if (fromRoute) this.symbol.set(fromRoute.toUpperCase());
    void this.loadUniverse();
    void this.load();
  }

  async loadUniverse(): Promise<void> {
    try {
      this.universe.set((await this.api.universeTop(20)).symbols);
    } catch {
      this.universe.set([]); // the picker degrades to free typing; the page still works
    }
  }

  /** Navigating rewrites the URL, so a chosen symbol is shareable and survives a reload. */
  select(symbol: string): void {
    const next = symbol.trim().toUpperCase();
    if (next.length === 0 || next === this.symbol()) return;
    this.symbol.set(next);
    void this.router.navigate(['/instrument', next]);
    void this.load();
  }

  choosePreset(preset: RangePreset): void {
    this.preset.set(preset);
    void this.load();
  }

  chooseTimeframe(tf: WebTimeframe): void {
    this.timeframe.set(tf);
    void this.load();
  }

  toggleMarket(): void {
    this.market.set(this.market() === 'perp' ? 'spot' : 'perp');
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    const preset = this.preset();
    const chosen = this.timeframe();
    const tf = effectiveTimeframe(preset, chosen);
    this.coarsenedTo.set(isRefused(preset, chosen) ? tf : null);

    const { fromMs, toMs } = rangeOf(preset, Date.now());
    const symbol = this.symbol();
    const bucket = bucketFor(preset);

    try {
      const [candles, oi, funding, ls, liquidations, top, events] = await Promise.all([
        this.api.candles(symbol, fromMs, toMs, tf, this.market()),
        this.api.openInterest(symbol, fromMs, toMs),
        this.api.funding(symbol, fromMs, toMs),
        this.api.longShort(symbol, fromMs, toMs, 'global_account'),
        this.api.liquidations(symbol, fromMs, toMs, bucket),
        this.api.topLiquidations(symbol, fromMs, toMs, 50),
        this.liquidationEvents(symbol, fromMs, toMs),
      ]);
      this.panes.set(this.toPanes(candles, oi, funding, ls, liquidations, events, tf, bucket));
      this.top.set(top.rows);
      void this.loadSummary(symbol);
    } catch (error) {
      this.error.set((error as Error).message);
      this.panes.set(null);
      this.top.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * The markers' events, degrading rather than failing the page.
   *
   * A window with more than 2 000 liquidations answers `RANGE_TOO_WIDE`, which is the server
   * refusing to truncate. That is not a reason to show no chart: the candles are still worth
   * looking at, so the markers drop out and the rest of the page loads.
   */
  private async liquidationEvents(symbol: string, fromMs: number, toMs: number): Promise<WebLiquidationEventsResponse> {
    try {
      return await this.api.liquidationEvents(symbol, fromMs, toMs);
    } catch {
      return { symbol, minUsd: 0, events: [], venuesPresent: [], undercounted: true };
    }
  }

  /** IB-038's overview, narrowed to this coin. Failure leaves the summary off, not the page. */
  private async loadSummary(symbol: string): Promise<void> {
    try {
      const overview = await this.api.liquidationsOverview();
      this.liqCoin.set(overview.perCoin.find((c) => c.symbol === symbol) ?? null);
      this.liqVenues.set(overview.venues);
    } catch {
      this.liqCoin.set(null);
    }
  }

  private toPanes(
    candles: WebCandlesResponse,
    oi: { points: Array<{ time: number; value: number; notional: number | null }> },
    funding: WebFundingResponse,
    ls: WebLongShortResponse,
    liquidations: WebLiquidationsResponse,
    events: WebLiquidationEventsResponse,
    timeframe: WebTimeframe,
    bucket: string,
  ): PaneData {
    return {
      instrument: `binance:${this.symbol()}`,
      timeframe,
      bucket,
      candles,
      openInterest: oi.points,
      funding,
      longShort: ls,
      liquidations,
      liquidationEvents: events.events,
      liquidationVenues: events.venuesPresent,
    };
  }
}

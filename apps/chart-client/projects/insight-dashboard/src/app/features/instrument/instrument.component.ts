import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import type {
  WebCandlesResponse, WebFundingResponse, WebLiquidationEventsResponse, WebLiquidationCoin,
  WebLiquidationsOverviewResponse, WebLiquidationsResponse, WebLongShortResponse,
  WebTimeframe, WebTopLiquidation, WebUniverseSummaryRow, WebUniverseSymbol,
} from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { InstrumentChartComponent, type PaneData } from './instrument-chart.component';
import { InstrumentContextComponent } from './instrument-context.component';
import { nowTiles } from './instrument-now';
import { SymbolPickerComponent } from './symbol-picker.component';
import {
  allowedTimeframes, bucketFor, effectiveTimeframe, findPreset, isRefused, RANGE_PRESETS,
  rangeOf, type RangePreset,
} from './time-range';

/**
 * architecture/insight-bot-web-dashboard.md §2 and §13 — one time-aligned screen for a symbol:
 * price with the spot line and liquidation bubbles, open interest, taker delta and CVD, funding,
 * long/short; beside it the coin's current figures and the market context; below it the 50
 * largest liquidations in the window.
 *
 * The class is wiring only; every mapping lives in `series.adapter.ts` and every range rule in
 * `time-range.ts`, each with its own spec (AGENTS.md). The charts are a child component so this
 * one stays about *what to fetch* and that one about *how to draw*.
 */
@Component({
  selector: 'app-instrument',
  standalone: true,
  imports: [DatePipe, DecimalPipe, InstrumentChartComponent, InstrumentContextComponent, SymbolPickerComponent],
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
  /** The dropdown's live figures (`/universe/summary`); null until the first answer. */
  readonly summary = signal<WebUniverseSummaryRow[] | null>(null);
  readonly summaryFailed = signal(false);

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
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** Set when the page asked for a coarser frame than the one chosen, so it can say so. */
  readonly coarsenedTo = signal<WebTimeframe | null>(null);

  readonly presets = RANGE_PRESETS;
  readonly timeframes = computed(() => allowedTimeframes(this.preset()));
  /** The context column's tiles: the window's latest points plus the live summary's row. */
  readonly now = computed(() =>
    nowTiles(this.panes(), this.summary()?.find((r) => r.id === this.symbol()) ?? null, this.symbol()));

  readonly downsampled = computed(() => {
    const panes = this.panes();
    return panes !== null && (panes.candles.downsampled || panes.liquidations.downsampled);
  });

  constructor() {
    const fromRoute = this.route.snapshot.paramMap.get('symbol');
    if (fromRoute) this.symbol.set(fromRoute.toUpperCase());
    void this.loadUniverse();
    void this.loadFigures();
    void this.load();
  }

  /**
   * The dropdown's figures. Called on arrival and every time the dropdown opens; the server caches
   * them for a minute, so opening it repeatedly costs the venue nothing extra.
   */
  async loadFigures(): Promise<void> {
    try {
      this.summary.set((await this.api.universeSummary(20)).rows);
      this.summaryFailed.set(false);
    } catch {
      this.summaryFailed.set(true); // the list still works from /universe/top; only the figures go
    }
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
      const [candles, spot, oi, funding, ls, liquidations, top, events] = await Promise.all([
        this.api.candles(symbol, fromMs, toMs, tf, 'perp'),
        this.spot(symbol, fromMs, toMs, tf),
        this.api.openInterest(symbol, fromMs, toMs),
        this.api.funding(symbol, fromMs, toMs),
        this.api.longShort(symbol, fromMs, toMs, 'global_account'),
        this.api.liquidations(symbol, fromMs, toMs, bucket),
        this.api.topLiquidations(symbol, fromMs, toMs, 50),
        this.liquidationEvents(symbol, fromMs, toMs),
      ]);
      this.panes.set(this.toPanes(candles, spot, oi, funding, ls, liquidations, events, tf, bucket));
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

  /**
   * The spot candles for the line on the price pane, degrading rather than failing the page.
   * `none` when the top list says the coin has no Binance spot market, or the read came back
   * empty; `failed` when it errored. The legend says which, because they mean different things.
   */
  private async spot(symbol: string, fromMs: number, toMs: number, tf: WebTimeframe): Promise<{ candles: WebCandlesResponse | null; state: PaneData['spotState'] }> {
    const known = this.universe().find((s) => s.id === symbol);
    if (known && !known.venues.binanceSpot) return { candles: null, state: 'none' };
    try {
      const candles = await this.api.candles(symbol, fromMs, toMs, tf, 'spot');
      return candles.candles.length > 0 ? { candles, state: 'shown' } : { candles: null, state: 'none' };
    } catch {
      return { candles: null, state: 'failed' };
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
    spot: { candles: WebCandlesResponse | null; state: PaneData['spotState'] },
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
      spotCandles: spot.candles,
      spotState: spot.state,
    };
  }
}

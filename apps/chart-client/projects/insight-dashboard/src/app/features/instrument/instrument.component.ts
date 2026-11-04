import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DOCUMENT, DatePipe, DecimalPipe } from '@angular/common';
import { AmountPipe } from './amount';
import type {
  WebLiquidationCoin, WebLiquidationsOverviewResponse, WebTimeframe, WebTopLiquidation,
  WebUniverseSummaryRow, WebUniverseSymbol,
} from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { InstrumentChartComponent, type PaneData } from './instrument-chart.component';
import { InstrumentContextComponent } from './instrument-context.component';
import { nowTiles } from './instrument-now';
import { instrumentTailJobs } from './instrument-tail';
import { focusFromQuery, type FocusView } from './focus-at';
import { LegendToggleComponent } from './legend-toggle.component';
import { fetchWindow } from './instrument-window';
import { LiveTail } from './live-tail';
import { isBeforeHistory, prependEarlier } from './pane-merge';
import { FullscreenButtonComponent } from '../../ui/fullscreen-button.component';
import { LoaderComponent } from '../../ui/loader.component';
import { SymbolPickerComponent } from './symbol-picker.component';
import { PICKER_SIZE } from './symbol-picker.rows';
import { bucketFor, sideWindow, TIMEFRAMES, timeframeLabel, windowFor } from './time-range';

/**
 * architecture/insight-bot-web-dashboard.md §2 and §13 — one time-aligned screen for a symbol:
 * price with liquidation bubbles, sessions and previous day/week levels, open interest, taker delta and CVD, funding,
 * long/short; beside it the coin's current figures and the market context; below it the 50
 * largest liquidations in the window.
 *
 * The class is wiring only; every mapping lives in `series.adapter.ts` and the window each
 * timeframe opens with in `time-range.ts`, each with its own spec (AGENTS.md). The charts are a child component so this
 * one stays about *what to fetch* and that one about *how to draw*.
 */
@Component({
  selector: 'app-instrument',
  standalone: true,
  imports: [AmountPipe, DatePipe, DecimalPipe, InstrumentChartComponent, InstrumentContextComponent, LegendToggleComponent, LoaderComponent, SymbolPickerComponent, FullscreenButtonComponent],
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
  /** True until the top list has answered or failed: the picker shows a loader meanwhile. */
  readonly universeLoading = signal(true);
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
  /** The first load, a timeframe switch or a symbol switch: the chart shows a loader over it. */
  readonly loading = signal(true);
  /** An earlier window is being fetched after a scroll to the left edge. */
  readonly loadingEarlier = signal(false);
  /** An earlier read came back empty: the venue's history starts at the left edge. */
  readonly historyStart = signal(false);
  /** The start of what is on screen, which is where the next earlier window ends. */
  private loadedFromMs = 0;
  /** Bumped by every fresh load, so an answer for an abandoned choice is dropped. */
  private generation = 0;
  readonly error = signal<string | null>(null);
  /** IB-098: the moment `?at=` linked to; dropped as soon as the reader picks another symbol or frame. */
  readonly focus = signal<FocusView | null>(null);

  /** IB-066 — the live tail: candles every 5 s, the rest every minute. The rules are `live-tail.ts`'s. */
  private readonly tail = new LiveTail({
    jobs: instrumentTailJobs(this.api, {
      panes: this.panes, top: this.top, symbol: this.symbol, timeframe: this.timeframe,
      refreshSummary: (symbol) => void this.loadSummary(symbol),
    }),
    generation: () => this.generation,
    busy: () => this.loading() || this.loadingEarlier() || this.panes() === null,
    maxGapMs: () => { const w = windowFor(this.timeframe(), 0); return w.toMs - w.fromMs; },
    reload: () => void this.load(),
    visibility: inject(DOCUMENT),
  });

  /** No range buttons since 2026-10-24: the window follows the timeframe (`time-range.ts`). */
  readonly timeframes = TIMEFRAMES;
  readonly timeframeLabel = timeframeLabel;
  /** The context column's tiles: the window's latest points plus the live summary's row. */
  readonly now = computed(() =>
    nowTiles(this.panes(), this.summary()?.find((r) => r.id === this.symbol()) ?? null, this.symbol()));

  /** Under the chart, so it does not push the chart down; the loading state is the chart's loader. */
  readonly edgeNote = computed(() => (this.historyStart() ? this.t('instrument.historyStart') : null));

  readonly downsampled = computed(() => {
    const panes = this.panes();
    return panes !== null && (panes.candles.downsampled || panes.liquidations.downsampled);
  });

  constructor() {
    const fromRoute = this.route.snapshot.paramMap.get('symbol');
    if (fromRoute) this.symbol.set(fromRoute.toUpperCase());
    this.focus.set(focusFromQuery(this.route.snapshot.queryParamMap.get('at'), Date.now(), this.route.snapshot.queryParamMap.get('span')));
    this.timeframe.set(this.focus()?.timeframe ?? this.timeframe());
    void this.loadUniverse();
    void this.loadFigures();
    void this.load();
    this.tail.start();
    inject(DestroyRef).onDestroy(() => this.tail.stop());
  }

  /**
   * The dropdown's figures. Called on arrival and every time the dropdown opens; the server caches
   * them for a minute, so opening it repeatedly costs the venue nothing extra.
   */
  async loadFigures(): Promise<void> {
    try {
      this.summary.set((await this.api.universeSummary(PICKER_SIZE)).rows);
      this.summaryFailed.set(false);
    } catch {
      this.summaryFailed.set(true); // the list still works from /universe/top; only the figures go
    }
  }

  async loadUniverse(): Promise<void> {
    try {
      this.universe.set((await this.api.universeTop(PICKER_SIZE)).symbols);
    } catch {
      this.universe.set([]); // the picker degrades to free typing; the page still works
    } finally {
      this.universeLoading.set(false);
    }
  }

  /** Navigating rewrites the URL, so a chosen symbol is shareable and survives a reload. */
  select(symbol: string): void {
    const next = symbol.trim().toUpperCase();
    if (next.length === 0 || next === this.symbol()) return;
    this.symbol.set(next);
    this.focus.set(null);
    void this.router.navigate(['/instrument', next]);
    void this.load();
  }

  chooseTimeframe(tf: WebTimeframe): void {
    this.timeframe.set(tf);
    // the moment belonged to the link: off the screen and off the URL, so a reload does not jump back
    if (this.focus()) void this.router.navigate([], { queryParams: { at: null, span: null }, queryParamsHandling: 'merge', replaceUrl: true });
    this.focus.set(null);
    void this.load();
  }

  async load(): Promise<void> {
    const generation = ++this.generation;
    this.loading.set(true);
    this.error.set(null);
    this.historyStart.set(false);

    const tf = this.timeframe();
    const { fromMs, toMs } = windowFor(tf, Date.now());
    const symbol = this.symbol();
    const bucket = bucketFor(tf);

    try {
      const [panes, top] = await Promise.all([
        fetchWindow(this.api, { symbol, fromMs, toMs, timeframe: tf, bucket }),
        this.api.topLiquidations(symbol, sideWindow(fromMs, toMs).fromMs, toMs, 50),
      ]);
      if (generation !== this.generation) return; // a newer choice was made while this was loading
      this.loadedFromMs = fromMs;
      this.panes.set(panes);
      this.top.set(top.rows);
      this.tail.reset(toMs);
      void this.loadSummary(symbol);
    } catch (error) {
      if (generation !== this.generation) return;
      this.error.set((error as Error).message);
      this.panes.set(null);
      this.top.set([]);
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }

  /**
   * The reader scrolled to the left edge: fetch the window before the one on screen, the same
   * width, and join it on (2026-10-24 bug: scrolling left loaded nothing). One read at a time;
   * an empty earlier read means the venue's history starts there, and the page stops asking.
   * The top-50 table stays about the opening window, not about however far the reader scrolled.
   */
  async loadEarlier(): Promise<void> {
    const current = this.panes();
    if (!current || this.loadingEarlier() || this.historyStart() || this.loading()) return;
    const generation = this.generation;
    const toMs = this.loadedFromMs - 1;
    const { fromMs } = windowFor(current.timeframe as WebTimeframe, toMs);
    this.loadingEarlier.set(true);
    try {
      const earlier = await fetchWindow(this.api, {
        symbol: this.symbol(), fromMs, toMs, timeframe: current.timeframe as WebTimeframe,
        bucket: current.bucket,
      });
      if (generation !== this.generation) return;
      if (isBeforeHistory(earlier)) {
        this.historyStart.set(true);
        return;
      }
      this.loadedFromMs = fromMs;
      // the window as it is NOW: a live-tail poll may have joined bars on while this was in flight
      this.panes.set(prependEarlier(this.panes() ?? current, earlier));
    } catch {
      // a failed earlier read leaves the window as it was; the next scroll to the edge retries
    } finally {
      this.loadingEarlier.set(false);
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
}

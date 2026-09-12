import type { Panel, Timeframe } from '@trade-automation/contracts';
import { RestClient } from '../api/rest.client';
import { LiveSocket } from '../api/live.socket';
import { CandlesStore } from './candles.store';
import { MetricPointsStore } from './metric-points.store';
import { SignalsStore } from './signals.store';
import { IndicatorsStore } from './indicators.store';

const HISTORY_LIMIT = 1500;
const PAGE_LIMIT = 500;

export interface PanelFeedDeps {
  rest: RestClient;
  socket: LiveSocket;
}

/**
 * architecture/chart-layouts.md §6.2 — one feed per panel. Owns its own
 * `CandlesStore`/`MetricPointsStore`/`SignalsStore` instances (never shared
 * singletons, so N panels never clobber each other's data), plus an
 * `IndicatorsStore` — the VWAP client unit's indicator points ride the same
 * `signals` topic subscription (architecture/vwap-band-reversal-plugin.md
 * §3.1), so they follow the same per-panel instrument and the same
 * `panel.signals` gate as signals do (§6.5).
 *
 * `panel.signals === false` ⇒ `start()` never calls `GET /api/signals`,
 * never calls `GET /api/indicators`, and never subscribes either topic —
 * enforced upstream here so `OverlayLayer`/`IndicatorLayer` simply never see
 * anything for a signals-off panel.
 */
export class PanelFeed {
  readonly candles = new CandlesStore();
  readonly points = new MetricPointsStore();
  readonly signals = new SignalsStore();
  readonly indicators = new IndicatorsStore();

  private frameSubscriptions: Array<{ unsubscribe: () => void }> = [];

  constructor(
    readonly panel: Panel,
    readonly timeframe: Timeframe,
    private readonly deps: PanelFeedDeps,
  ) {}

  async start(): Promise<void> {
    const { rest, socket } = this.deps;
    const instrument = this.panel.instrument;
    const fetches: Promise<void>[] = [];

    if (this.panel.kind === 'candles') {
      fetches.push(
        rest
          .getCandles(instrument, this.timeframe, undefined, undefined, HISTORY_LIMIT)
          .then((history) => this.candles.setHistory(history)),
      );
    } else {
      fetches.push(
        rest
          .getMetrics(instrument, this.panel.metric!, this.timeframe, undefined, undefined, HISTORY_LIMIT)
          .then((history) => this.points.setHistory(history)),
      );
    }

    if (this.panel.signals) {
      fetches.push(rest.getSignals(instrument).then((history) => this.signals.setHistory(history)));
      fetches.push(rest.getIndicators(instrument).then((history) => this.indicators.setHistory(history)));
    }

    await Promise.all(fetches);

    if (this.panel.kind === 'candles') {
      socket.subscribeCandles(instrument, this.timeframe);
      this.frameSubscriptions.push(
        socket.candlesFor(instrument, this.timeframe).subscribe((frame) => this.candles.mergeLive(frame.candle)),
      );
    } else {
      socket.subscribeMetrics(instrument, this.panel.metric!, this.timeframe);
      this.frameSubscriptions.push(
        socket
          .metricsFor(instrument, this.panel.metric!, this.timeframe)
          .subscribe((frame) => this.points.mergeLive(frame.point)),
      );
    }

    if (this.panel.signals) {
      socket.subscribeSignals(instrument);
      this.frameSubscriptions.push(
        socket.signalsFor(instrument).subscribe((frame) => this.signals.append(frame.signal)),
      );
      this.frameSubscriptions.push(
        socket.indicatorsFor(instrument).subscribe((frame) => this.indicators.append(frame.point)),
      );
    }
  }

  stop(): void {
    const { socket } = this.deps;
    const instrument = this.panel.instrument;

    if (this.panel.kind === 'candles') {
      socket.unsubscribeCandles(instrument, this.timeframe);
    } else {
      socket.unsubscribeMetrics(instrument, this.panel.metric!, this.timeframe);
    }
    if (this.panel.signals) {
      socket.unsubscribeSignals(instrument);
    }

    for (const sub of this.frameSubscriptions) {
      sub.unsubscribe();
    }
    this.frameSubscriptions = [];
  }

  /** Per-panel scroll-back pagination (§6.4's interaction with pagination). */
  async loadOlder(): Promise<void> {
    const { rest } = this.deps;
    const instrument = this.panel.instrument;

    if (this.panel.kind === 'candles') {
      const oldest = this.candles.firstOpenTime();
      if (oldest === null) {
        return;
      }
      const older = await rest.getCandles(instrument, this.timeframe, undefined, oldest, PAGE_LIMIT);
      this.candles.prepend(older);
    } else {
      const oldest = this.points.firstTime();
      if (oldest === null) {
        return;
      }
      const older = await rest.getMetrics(instrument, this.panel.metric!, this.timeframe, undefined, oldest, PAGE_LIMIT);
      this.points.prepend(older);
    }
  }

  /** On WS reconnect: re-fetch from the last known point to heal any gap (base §5.3 step 5). */
  async healAfterReconnect(): Promise<void> {
    const { rest } = this.deps;
    const instrument = this.panel.instrument;

    if (this.panel.kind === 'candles') {
      const lastKnown = this.candles.lastOpenTime();
      const fresh = await rest.getCandles(instrument, this.timeframe, lastKnown ?? undefined, undefined, HISTORY_LIMIT);
      for (const candle of fresh) {
        this.candles.mergeLive(candle);
      }
    } else {
      const lastKnown = this.points.lastTime();
      const fresh = await rest.getMetrics(
        instrument,
        this.panel.metric!,
        this.timeframe,
        lastKnown ?? undefined,
        undefined,
        HISTORY_LIMIT,
      );
      for (const point of fresh) {
        this.points.mergeLive(point);
      }
    }
  }
}

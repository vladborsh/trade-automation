import { TIMEFRAME_MS, type Panel, type Timeframe } from '@trade-automation/contracts';
import { RestClient } from '../api/rest.client';
import { LiveSocket } from '../api/live.socket';
import { CandlesStore } from './candles.store';
import { MetricPointsStore } from './metric-points.store';
import { SignalsStore } from './signals.store';
import { IndicatorsStore } from './indicators.store';

const HISTORY_LIMIT = 1500;
const PAGE_LIMIT = 500;
// The real server's wire contract requires `from`/`to` on every history query
// (libs/contracts/src/wire.ts — no `.default()` on either field), AND — since
// architecture/live-signal-server.md §12 — a `from` the store doesn't already
// reach can trigger an on-demand fetch-and-persist straight from the venue
// (candles.controller.ts). A literal `from: 0` therefore doesn't mean "give me
// the latest `limit` bars" anymore, the way it did before §12 landed — it means
// "fetch this instrument's entire history since epoch if you have to", which
// for a years-old Binance symbol at 1m is tens of thousands of REST pages in
// one request. Bound `from` to a generous multiple of how much calendar time
// `limit` bars actually need instead: comfortably covers weekend/holiday gaps
// (§12.2's Capital.com sessions included) while never asking for more than a
// bounded, reasonable page of history in a single request.
const HISTORY_LOOKBACK_MULTIPLIER = 3;

function boundedFrom(to: number, tf: Timeframe, limit: number): number {
  return Math.max(0, to - TIMEFRAME_MS[tf] * limit * HISTORY_LOOKBACK_MULTIPLIER);
}

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

    const nowMs = Date.now();
    const historyFrom = boundedFrom(nowMs, this.timeframe, HISTORY_LIMIT);

    if (this.panel.kind === 'candles') {
      fetches.push(
        rest
          .getCandles(instrument, this.timeframe, historyFrom, nowMs, HISTORY_LIMIT)
          .then((history) => this.candles.setHistory(history)),
      );
    } else {
      fetches.push(
        rest
          .getMetrics(instrument, this.panel.metric!, this.timeframe, historyFrom, nowMs, HISTORY_LIMIT)
          .then((history) => this.points.setHistory(history)),
      );
    }

    if (this.panel.signals) {
      // Signals/indicators have no timeframe of their own — they ride the same visible
      // window as this panel's main series, so the same bound applies.
      fetches.push(
        rest.getSignals(instrument, historyFrom, nowMs).then((history) => this.signals.setHistory(history)),
      );
      fetches.push(
        rest.getIndicators(instrument, historyFrom, nowMs).then((history) => this.indicators.setHistory(history)),
      );
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
      const older = await rest.getCandles(
        instrument,
        this.timeframe,
        boundedFrom(oldest, this.timeframe, PAGE_LIMIT),
        oldest,
        PAGE_LIMIT,
      );
      this.candles.prepend(older);
    } else {
      const oldest = this.points.firstTime();
      if (oldest === null) {
        return;
      }
      const older = await rest.getMetrics(
        instrument,
        this.panel.metric!,
        this.timeframe,
        boundedFrom(oldest, this.timeframe, PAGE_LIMIT),
        oldest,
        PAGE_LIMIT,
      );
      this.points.prepend(older);
    }
  }

  /** On WS reconnect: re-fetch from the last known point to heal any gap (base §5.3 step 5). */
  async healAfterReconnect(): Promise<void> {
    const { rest } = this.deps;
    const instrument = this.panel.instrument;

    const nowMs = Date.now();

    if (this.panel.kind === 'candles') {
      const lastKnown = this.candles.lastOpenTime();
      const fresh = await rest.getCandles(
        instrument,
        this.timeframe,
        lastKnown ?? boundedFrom(nowMs, this.timeframe, HISTORY_LIMIT),
        nowMs,
        HISTORY_LIMIT,
      );
      for (const candle of fresh) {
        this.candles.mergeLive(candle);
      }
    } else {
      const lastKnown = this.points.lastTime();
      const fresh = await rest.getMetrics(
        instrument,
        this.panel.metric!,
        this.timeframe,
        lastKnown ?? boundedFrom(nowMs, this.timeframe, HISTORY_LIMIT),
        nowMs,
        HISTORY_LIMIT,
      );
      for (const point of fresh) {
        this.points.mergeLive(point);
      }
    }
  }
}

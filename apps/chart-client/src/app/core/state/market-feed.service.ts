import { Injectable, effect } from '@angular/core';
import { AppConfigService } from '../config/app-config.service';
import { RestClient } from '../api/rest.client';
import { LiveSocket } from '../api/live.socket';
import { InstrumentsStore } from './instruments.store';
import { TimeframeStore } from './timeframe.store';
import { CandlesStore } from './candles.store';
import { SignalsStore } from './signals.store';
import { IndicatorsStore } from './indicators.store';
import { StrategiesStore } from './strategies.store';
import { ConnectionStore } from './connection.store';
import type { InstrumentId, Timeframe } from '@trade-automation/contracts';

const HISTORY_LIMIT = 1500;
const PAGE_LIMIT = 500;

interface Subscription {
  instrument: InstrumentId;
  timeframe: Timeframe;
}

/**
 * Orchestrates the boot sequence, instrument/timeframe switch, live merge,
 * scroll-back pagination and reconnect gap-healing described in §5.3.
 * Stores stay dumb signal containers; this is the one place that wires them
 * to the REST client and the socket.
 */
@Injectable({ providedIn: 'root' })
export class MarketFeedService {
  private active: Subscription | null = null;
  private frameSubscriptions: Array<{ unsubscribe: () => void }> = [];

  constructor(
    private readonly config: AppConfigService,
    private readonly rest: RestClient,
    private readonly socket: LiveSocket,
    private readonly instruments: InstrumentsStore,
    private readonly timeframe: TimeframeStore,
    private readonly candles: CandlesStore,
    private readonly signals: SignalsStore,
    private readonly indicators: IndicatorsStore,
    private readonly strategies: StrategiesStore,
    private readonly connection: ConnectionStore,
  ) {
    effect(() => {
      const instrument = this.instruments.selected();
      const tf = this.timeframe.selected();
      if (instrument) {
        void this.switchTo(instrument.id, tf);
      }
    });
  }

  async boot(): Promise<void> {
    await this.config.load();
    const [instruments, strategies] = await Promise.all([this.rest.getInstruments(), this.rest.getStrategies()]);
    this.instruments.setInstruments(instruments);
    this.strategies.setStrategies(strategies);

    this.socket.connectionState.subscribe((state) => this.connection.setConnectionState(state));
    this.socket.statusFrames$.subscribe((frame) =>
      this.connection.setVenueStatus(frame.instrument, frame.venueStatus, frame.lastClosedCandleTime),
    );
    this.socket.reconnected.subscribe(() => void this.healGapAfterReconnect());
    this.socket.connect(this.config.get().wsUrl);
  }

  private async switchTo(instrument: InstrumentId, tf: Timeframe): Promise<void> {
    const previous = this.active;
    if (previous && previous.instrument === instrument && previous.timeframe === tf) {
      return;
    }

    // Subscription churn on one socket, never a reconnect (§5.3 step 2).
    if (previous) {
      this.socket.unsubscribeCandles(previous.instrument, previous.timeframe);
      this.socket.unsubscribeSignals(previous.instrument);
    }
    for (const sub of this.frameSubscriptions) {
      sub.unsubscribe();
    }
    this.frameSubscriptions = [];

    this.candles.clear();
    this.signals.clear();
    this.indicators.clear();
    this.active = { instrument, timeframe: tf };

    const [candleHistory, signalHistory, indicatorHistory] = await Promise.all([
      this.rest.getCandles(instrument, tf, undefined, undefined, HISTORY_LIMIT),
      this.rest.getSignals(instrument),
      this.rest.getIndicators(instrument),
    ]);
    this.candles.setHistory(candleHistory);
    this.signals.setHistory(signalHistory);
    this.indicators.setHistory(indicatorHistory);

    this.socket.subscribeCandles(instrument, tf);
    // `indicator` frames ride the same `signals` topic subscription (§3.1).
    this.socket.subscribeSignals(instrument);

    this.frameSubscriptions.push(
      this.socket.candlesFor(instrument, tf).subscribe((frame) => this.candles.mergeLive(frame.candle)),
    );
    this.frameSubscriptions.push(
      this.socket.signalsFor(instrument).subscribe((frame) => this.signals.append(frame.signal)),
    );
    this.frameSubscriptions.push(
      this.socket.indicatorsFor(instrument).subscribe((frame) => this.indicators.append(frame.point)),
    );
  }

  /** Scroll-back pagination (§5.3 step 4): fetch the page before what is loaded, prepend. */
  async loadOlderHistory(): Promise<void> {
    if (!this.active) {
      return;
    }
    const oldest = this.candles.firstOpenTime();
    if (oldest === null) {
      return;
    }
    const older = await this.rest.getCandles(this.active.instrument, this.active.timeframe, undefined, oldest, PAGE_LIMIT);
    this.candles.prepend(older);
  }

  /**
   * On WS reconnect, re-fetch from the last known openTime to heal any gap
   * that opened while disconnected (§5.3 step 5) — the client never assumes
   * it missed nothing. Re-subscription itself is handled inside LiveSocket.
   */
  private async healGapAfterReconnect(): Promise<void> {
    if (!this.active) {
      return;
    }
    const lastKnown = this.candles.lastOpenTime();
    const fresh = await this.rest.getCandles(this.active.instrument, this.active.timeframe, lastKnown ?? undefined, undefined, HISTORY_LIMIT);
    for (const candle of fresh) {
      this.candles.mergeLive(candle);
    }
  }
}

import type {
  Candle,
  Instrument,
  InstrumentId,
  Signal,
  Timeframe,
  VenueStatus,
} from '../src/app/core/contracts/contracts';
import {
  FIXTURE_INSTRUMENTS,
  advanceFormingCandle,
  closeCandle,
  generateSeedHistory,
  resample,
  startFormingCandle,
} from './fixtures';
import { computeHistoricalSignals, detectExampleCrossSignal } from './example-cross';

export type CandleListener = (candle: Candle) => void;
export type SignalListener = (signal: Signal) => void;

/**
 * In-memory replay of fixture candles standing in for the real
 * MarketDataModule + StorageModule + StrategyEngine, until SE-1's
 * apps/signal-server lands (§9.1 note on SE-2's mock server).
 */
export class MockMarketState {
  readonly instruments: Instrument[] = FIXTURE_INSTRUMENTS;
  private readonly venueStatus = new Map<InstrumentId, VenueStatus>(
    FIXTURE_INSTRUMENTS.map((i) => [i.id, 'up' as VenueStatus]),
  );
  private readonly oneMinuteHistory = new Map<InstrumentId, Candle[]>();
  private readonly signals = new Map<InstrumentId, Signal[]>();

  private readonly candleListeners = new Set<CandleListener>();
  private readonly signalListeners = new Set<SignalListener>();

  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly barMs = 2000) {
    const now = Date.now();
    for (const instrument of this.instruments) {
      const history = generateSeedHistory(instrument.id, now);
      this.oneMinuteHistory.set(instrument.id, history);
      // Backfill signals for the seed window too, so a fresh boot already has
      // something for the client to render (§4.4's end-to-end proof) instead
      // of waiting on a live crossover.
      this.signals.set(instrument.id, computeHistoricalSignals(history));
    }
  }

  onCandle(listener: CandleListener): () => void {
    this.candleListeners.add(listener);
    return () => this.candleListeners.delete(listener);
  }

  onSignal(listener: SignalListener): () => void {
    this.signalListeners.add(listener);
    return () => this.signalListeners.delete(listener);
  }

  venueStatusFor(id: InstrumentId): VenueStatus {
    return this.venueStatus.get(id) ?? 'down';
  }

  history1m(id: InstrumentId): Candle[] {
    return this.oneMinuteHistory.get(id) ?? [];
  }

  candles(id: InstrumentId, timeframe: Timeframe, from?: number, to?: number, limit = 1500): Candle[] {
    const oneMinute = this.history1m(id);
    const series = resample(oneMinute, timeframe);
    const filtered = series.filter((c) => (from === undefined || c.openTime >= from) && (to === undefined || c.openTime <= to));
    return filtered.slice(Math.max(0, filtered.length - limit));
  }

  signalsFor(id: InstrumentId, from?: number, to?: number, strategyId?: string): Signal[] {
    const list = this.signals.get(id) ?? [];
    return list.filter(
      (s) =>
        (from === undefined || s.time >= from) &&
        (to === undefined || s.time <= to) &&
        (strategyId === undefined || s.strategyId === strategyId),
    );
  }

  lastClosedOpenTime(id: InstrumentId): number | null {
    const history = this.history1m(id);
    return history.length > 0 ? history[history.length - 1].openTime : null;
  }

  /** Starts the simulated live feed: forming-bar ticks, bar close, demo signal detection. */
  start(): void {
    if (this.tickTimer) {
      return;
    }
    const formingTickMs = Math.max(250, Math.floor(this.barMs / 4));
    let elapsedInBar = 0;
    let tickIndex = 0;
    const forming = new Map<InstrumentId, Candle>();

    for (const instrument of this.instruments) {
      const history = this.history1m(instrument.id);
      forming.set(instrument.id, startFormingCandle(instrument.id, history[history.length - 1]));
    }

    this.tickTimer = setInterval(() => {
      tickIndex += 1;
      elapsedInBar += formingTickMs;
      const closingThisTick = elapsedInBar >= this.barMs;
      if (closingThisTick) {
        elapsedInBar = 0;
      }

      for (const instrument of this.instruments) {
        const current = forming.get(instrument.id)!;
        const advanced = advanceFormingCandle(instrument.id, current, tickIndex);

        if (!closingThisTick) {
          forming.set(instrument.id, advanced);
          this.emitCandle(advanced);
          continue;
        }

        const closed = closeCandle(advanced);
        const history = this.history1m(instrument.id);
        const nextHistory = [...history, closed];
        this.oneMinuteHistory.set(instrument.id, nextHistory);
        this.emitCandle(closed);
        forming.set(instrument.id, startFormingCandle(instrument.id, closed));

        const signal = detectExampleCrossSignal(nextHistory);
        if (signal) {
          const list = this.signals.get(instrument.id) ?? [];
          list.push(signal);
          this.signals.set(instrument.id, list);
          this.emitSignal(signal);
        }
      }
    }, formingTickMs);
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private emitCandle(candle: Candle): void {
    for (const listener of this.candleListeners) {
      listener(candle);
    }
  }

  private emitSignal(signal: Signal): void {
    for (const listener of this.signalListeners) {
      listener(signal);
    }
  }
}

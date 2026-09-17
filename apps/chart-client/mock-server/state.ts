import type {
  Candle,
  IndicatorPoint,
  Instrument,
  InstrumentId,
  MetricKind,
  MetricObservation,
  MetricPoint,
  Signal,
  Timeframe,
  VenueStatus,
} from '@trade-automation/contracts';
import { bucketObservations } from '@trade-automation/contracts';
import {
  FIXTURE_INSTRUMENTS,
  advanceFormingCandle,
  advanceOpenInterestObservation,
  applyTailGap,
  closeCandle,
  generateSeedHistory,
  resample,
  seedOpenInterestObservations,
  startFormingCandle,
} from './fixtures';
import { computeHistoricalSignals, detectExampleCrossSignal } from './example-cross';
import {
  computeHistoricalVwapBandPoints,
  computeHistoricalVwapBandSignals,
  computeVwapBandPoint,
  detectVwapBandResearchSignal,
} from './vwap-band-mock';

export type CandleListener = (candle: Candle) => void;
export type SignalListener = (signal: Signal) => void;
export type IndicatorListener = (point: IndicatorPoint) => void;
/** Raw observations, not yet bucketed — each subscriber buckets to its own subscribed timeframe (§4.5). */
export type MetricListener = (observation: MetricObservation) => void;

function metricStreamKey(metric: MetricKind, instrument: InstrumentId): string {
  return `${metric}|${instrument}`;
}

/** The mock's synthetic VWAP band strategy (§8.2 step 1) only covers capitalcom instruments, as the real one does. */
function supportsVwapBandMock(id: InstrumentId): boolean {
  return id.startsWith('capitalcom:');
}

/**
 * In-memory replay of fixture candles standing in for the real
 * MarketDataModule + StorageModule + StrategyEngine, until SE-3's
 * apps/signal-server lands (§9.1 note on SE-2's mock server). Also stands
 * in for the vwap-band-reversal plug-in (architecture/vwap-band-reversal-plugin.md
 * §8.2 step 1) with a synthetic band + research-tier marker, since that
 * plug-in's real parity fixture only exists in `apps/signal-server`.
 */
export class MockMarketState {
  readonly instruments: Instrument[] = FIXTURE_INSTRUMENTS;
  readonly bootTime = Date.now();
  private readonly venueStatus = new Map<InstrumentId, VenueStatus>(
    FIXTURE_INSTRUMENTS.map((i) => [i.id, 'up' as VenueStatus]),
  );
  private readonly oneMinuteHistory = new Map<InstrumentId, Candle[]>();
  private readonly signals = new Map<InstrumentId, Signal[]>();
  private readonly indicators = new Map<InstrumentId, IndicatorPoint[]>();
  /** architecture/chart-layouts.md §4.2 — raw observations, keyed `${metric}|${instrument}`; bucketed to a timeframe on read. */
  private readonly metricObservations = new Map<string, MetricObservation[]>();

  private readonly candleListeners = new Set<CandleListener>();
  private readonly signalListeners = new Set<SignalListener>();
  private readonly indicatorListeners = new Set<IndicatorListener>();
  private readonly metricListeners = new Set<MetricListener>();

  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly barMs = 2000) {
    const now = Date.now();
    for (const instrument of this.instruments) {
      const history = applyTailGap(instrument.id, generateSeedHistory(instrument.id, now));
      this.oneMinuteHistory.set(instrument.id, history);
      // Backfill signals for the seed window too, so a fresh boot already has
      // something for the client to render (§4.4's end-to-end proof) instead
      // of waiting on a live crossover.
      const signals = computeHistoricalSignals(history);
      if (supportsVwapBandMock(instrument.id)) {
        signals.push(...computeHistoricalVwapBandSignals(history));
        this.indicators.set(instrument.id, computeHistoricalVwapBandPoints(history));
      } else {
        this.indicators.set(instrument.id, []);
      }
      signals.sort((a, b) => a.time - b.time);
      this.signals.set(instrument.id, signals);

      const oi = seedOpenInterestObservations(instrument.id, history);
      if (oi.length > 0) {
        this.metricObservations.set(metricStreamKey('openInterest', instrument.id), oi);
      }
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

  onIndicator(listener: IndicatorListener): () => void {
    this.indicatorListeners.add(listener);
    return () => this.indicatorListeners.delete(listener);
  }

  onMetric(listener: MetricListener): () => void {
    this.metricListeners.add(listener);
    return () => this.metricListeners.delete(listener);
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

  indicatorsFor(id: InstrumentId, from?: number, to?: number, strategyId?: string): IndicatorPoint[] {
    const list = this.indicators.get(id) ?? [];
    return list.filter(
      (p) =>
        (from === undefined || p.time >= from) &&
        (to === undefined || p.time <= to) &&
        (strategyId === undefined || p.strategyId === strategyId),
    );
  }

  /** `GET /api/metrics` (§4.5): bucketed to `timeframe`, same time-window filtering as `candles()`. */
  metrics(id: InstrumentId, metric: MetricKind, timeframe: Timeframe, from?: number, to?: number, limit = 1500): MetricPoint[] {
    const observations = this.metricObservations.get(metricStreamKey(metric, id)) ?? [];
    const points = bucketObservations(observations, timeframe);
    const filtered = points.filter((p) => (from === undefined || p.time >= from) && (to === undefined || p.time <= to));
    return filtered.slice(Math.max(0, filtered.length - limit));
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
          this.pushSignal(signal);
        }

        if (supportsVwapBandMock(instrument.id)) {
          const point = computeVwapBandPoint(closed);
          const list = this.indicators.get(instrument.id) ?? [];
          list.push(point);
          this.indicators.set(instrument.id, list);
          this.emitIndicator(point);

          const researchSignal = detectVwapBandResearchSignal(closed);
          if (researchSignal) {
            this.pushSignal(researchSignal);
          }
        }

        const oiKey = metricStreamKey('openInterest', instrument.id);
        const oiHistory = this.metricObservations.get(oiKey);
        if (oiHistory && oiHistory.length > 0) {
          const nextObservation = advanceOpenInterestObservation(instrument.id, oiHistory[oiHistory.length - 1], closed.openTime);
          this.metricObservations.set(oiKey, [...oiHistory, nextObservation]);
          this.emitMetric(nextObservation);
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

  private pushSignal(signal: Signal): void {
    const list = this.signals.get(signal.instrument) ?? [];
    list.push(signal);
    this.signals.set(signal.instrument, list);
    this.emitSignal(signal);
  }

  private emitCandle(candle: Candle): void {
    for (const listener of this.candleListeners) {
      listener(candle);
    }
  }

  private emitMetric(observation: MetricObservation): void {
    for (const listener of this.metricListeners) {
      listener(observation);
    }
  }

  private emitSignal(signal: Signal): void {
    for (const listener of this.signalListeners) {
      listener(signal);
    }
  }

  private emitIndicator(point: IndicatorPoint): void {
    for (const listener of this.indicatorListeners) {
      listener(point);
    }
  }
}

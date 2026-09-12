import { EventEmitter2 } from '@nestjs/event-emitter';
import { Candle, Instrument, Signal } from '@trade-automation/contracts';
import { CandleCache } from '../../src/market-data/candle-cache.service';
import { CandleClosedEvent, MarketDataEvents } from '../../src/market-data/market-data.events';
import { IndicatorCache } from '../../src/strategy-engine/indicator-cache.service';
import { SignalStrategy, StrategyContext, StrategyOutput } from '../../src/strategy-engine/signal-strategy.port';
import { IndicatorEmittedEvent, StrategyEngineEvents } from '../../src/strategy-engine/strategy-engine.events';
import { StrategyRunnerService } from '../../src/strategy-engine/strategy-runner.service';
import { ActiveStrategy } from '../../src/strategy-engine/strategy-registry.service';

const instrumentA: Instrument = {
  id: 'binance:BTCUSDT',
  venue: 'binance',
  symbol: 'BTCUSDT',
  assetClass: 'crypto-perp',
  displayName: 'BTC',
  pricePrecision: 2,
  quoteCurrency: 'USDT',
  sessionTimezone: 'UTC',
};

function bar(openTime: number): Candle {
  return {
    instrument: instrumentA.id,
    timeframe: '1m',
    openTime,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 0,
    closed: true,
    source: 'venue-stream',
  };
}

function fakeMetrics() {
  return {
    strategyEvalDurationMs: { observe: jest.fn() },
    strategyErrors: { inc: jest.fn() },
  } as never;
}

function baseStrategy(overrides: Partial<SignalStrategy> = {}): SignalStrategy {
  return {
    id: 'test-strategy',
    tier: 'demo',
    displayName: 'Test strategy',
    description: 'test',
    requirements: { instruments: [instrumentA.id], timeframe: '1m', warmupBars: { '1m': 3 } },
    onCandle: () => ({ signals: [] }),
    ...overrides,
  };
}

function buildRunner(strategy: SignalStrategy) {
  const cache = new CandleCache();
  const indicatorCache = new IndicatorCache();
  const events = new EventEmitter2();
  const registry = { active: (): ActiveStrategy[] => [{ strategy, instruments: [instrumentA.id] }] } as never;
  const config = { instruments: [instrumentA] } as never;
  const signalStore = { append: jest.fn(async () => undefined) };
  const execution = { onSignal: jest.fn(async () => undefined) };
  const metrics = fakeMetrics();

  const runner = new StrategyRunnerService(
    registry,
    cache,
    indicatorCache,
    events,
    config,
    metrics,
    signalStore as never,
    execution as never,
  );
  runner.onApplicationBootstrap();
  // @OnEvent only self-wires under Nest's EventEmitterModule discovery; wire it manually here
  // since this test constructs the service directly instead of through the DI container.
  events.on(MarketDataEvents.CandleClosed, (event: CandleClosedEvent) => runner.handleClosed(event));
  return { runner, cache, indicatorCache, events, signalStore, execution };
}

const MIN = 60_000;

const baseSignal: Omit<Signal, 'strategyId' | 'instrument' | 'tier'> = {
  id: '11111111-1111-1111-1111-111111111111',
  timeframe: '1m',
  time: 0,
  kind: 'info',
  direction: 'flat',
  overlay: [],
  meta: {},
};

describe('StrategyRunner warm-up gating and error isolation (architecture/live-signal-server.md §4.4)', () => {
  it('does not call onCandle until warmupBars is satisfied, then evaluates once warm', async () => {
    const onCandle = jest.fn<StrategyOutput, [StrategyContext]>(() => ({ signals: [] }));
    const strategy = baseStrategy({
      id: 'test-strategy',
      requirements: { instruments: [instrumentA.id], timeframe: '1m', warmupBars: { '1m': 3 } },
      onCandle,
    });
    const { runner, cache, events } = buildRunner(strategy);

    for (let i = 0; i < 2; i++) {
      const c = bar(i * MIN);
      cache.upsert(c);
      await events.emitAsync(MarketDataEvents.CandleClosed, new CandleClosedEvent(c));
    }
    expect(onCandle).not.toHaveBeenCalled();
    expect(runner.statuses()[0].status).toBe('warming');

    const c3 = bar(2 * MIN);
    cache.upsert(c3);
    await events.emitAsync(MarketDataEvents.CandleClosed, new CandleClosedEvent(c3));

    expect(onCandle).toHaveBeenCalledTimes(1);
    expect(runner.statuses()[0].status).toBe('live');
  });

  it('honours minBars instead of warmupBars for readiness when both are declared', async () => {
    const onCandle = jest.fn<StrategyOutput, [StrategyContext]>(() => ({ signals: [] }));
    const strategy = baseStrategy({
      id: 'session-strategy',
      requirements: {
        instruments: [instrumentA.id],
        timeframe: '1m',
        warmupBars: { '1m': 1440 }, // cache-sizing only
        minBars: { '1m': 1 }, // readiness
      },
      onCandle,
    });
    const { runner, cache, events } = buildRunner(strategy);

    const c1 = bar(0);
    cache.upsert(c1);
    await events.emitAsync(MarketDataEvents.CandleClosed, new CandleClosedEvent(c1));

    expect(onCandle).toHaveBeenCalledTimes(1);
    expect(runner.statuses()[0].status).toBe('live');
  });

  it('isolates a throw in onCandle: it is caught, counted, and does not stop later evaluations', async () => {
    const onCandle = jest.fn<StrategyOutput, [StrategyContext]>(() => {
      throw new Error('boom');
    });
    const strategy = baseStrategy({
      id: 'flaky-strategy',
      requirements: { instruments: [instrumentA.id], timeframe: '1m', warmupBars: { '1m': 1 } },
      onCandle,
    });
    const { runner, cache, events } = buildRunner(strategy);

    const c1 = bar(0);
    cache.upsert(c1);
    await expect(events.emitAsync(MarketDataEvents.CandleClosed, new CandleClosedEvent(c1))).resolves.toBeDefined();

    expect(runner.statuses()[0].status).toBe('error');

    // a second closed candle must still be attempted — the runner is not dead
    onCandle.mockReset();
    onCandle.mockReturnValue({ signals: [] });
    const c2 = bar(MIN);
    cache.upsert(c2);
    await events.emitAsync(MarketDataEvents.CandleClosed, new CandleClosedEvent(c2));

    expect(onCandle).toHaveBeenCalledTimes(1);
    expect(runner.statuses()[0].status).toBe('live');
  });

  it('persists returned signals and emits SignalEmitted, isolating a downstream ExecutionPort failure', async () => {
    const signal: Signal = { ...baseSignal, strategyId: 'sig-strategy', instrument: instrumentA.id, tier: 'demo' };
    const strategy = baseStrategy({
      id: 'sig-strategy',
      requirements: { instruments: [instrumentA.id], timeframe: '1m', warmupBars: { '1m': 1 } },
      onCandle: () => ({ signals: [signal] }),
    });
    const { runner, cache, events, signalStore, execution } = buildRunner(strategy);
    execution.onSignal.mockRejectedValueOnce(new Error('execution down'));

    let emitted: Signal | undefined;
    events.on(StrategyEngineEvents.SignalEmitted, (e: { signal: Signal }) => (emitted = e.signal));

    const c1 = bar(0);
    cache.upsert(c1);
    await events.emitAsync(MarketDataEvents.CandleClosed, new CandleClosedEvent(c1));

    expect(signalStore.append).toHaveBeenCalledWith([signal]);
    expect(emitted).toEqual(signal);
    expect(runner.statuses()[0].status).toBe('live'); // execution failure does not fail the runner
  });

  it('overwrites tier, strategyId and instrument on every signal, regardless of what the plug-in returned', async () => {
    const forgedSignal: Signal = {
      ...baseSignal,
      strategyId: 'someone-elses-id',
      instrument: 'binance:ETHUSDT',
      tier: 'live', // a research-tier plug-in trying to self-promote
    };
    const strategy = baseStrategy({
      id: 'stamped-strategy',
      tier: 'research',
      requirements: { instruments: [instrumentA.id], timeframe: '1m', warmupBars: { '1m': 1 } },
      onCandle: () => ({ signals: [forgedSignal] }),
    });
    const { runner, cache, events, signalStore } = buildRunner(strategy);

    const c1 = bar(0);
    cache.upsert(c1);
    await events.emitAsync(MarketDataEvents.CandleClosed, new CandleClosedEvent(c1));

    expect(signalStore.append).toHaveBeenCalledWith([
      expect.objectContaining({ tier: 'research', strategyId: 'stamped-strategy', instrument: instrumentA.id }),
    ]);
  });

  it("rejects a kind: 'entry' signal from a non-live-tier strategy as a runner error", async () => {
    const entrySignal: Signal = {
      ...baseSignal,
      strategyId: 'research-strategy',
      instrument: instrumentA.id,
      tier: 'research',
      kind: 'entry',
    };
    const strategy = baseStrategy({
      id: 'research-strategy',
      tier: 'research',
      requirements: { instruments: [instrumentA.id], timeframe: '1m', warmupBars: { '1m': 1 } },
      onCandle: () => ({ signals: [entrySignal] }),
    });
    const { runner, cache, events, signalStore, execution } = buildRunner(strategy);

    const c1 = bar(0);
    cache.upsert(c1);
    await events.emitAsync(MarketDataEvents.CandleClosed, new CandleClosedEvent(c1));

    expect(runner.statuses()[0].status).toBe('error');
    expect(signalStore.append).not.toHaveBeenCalled();
    expect(execution.onSignal).not.toHaveBeenCalled();
  });

  it('caches and broadcasts indicator points returned alongside signals, stamped by the runner', async () => {
    const strategy = baseStrategy({
      id: 'indicator-strategy',
      requirements: {
        instruments: [instrumentA.id],
        timeframe: '1m',
        warmupBars: { '1m': 1 },
        indicators: [{ id: 'test-series', label: 'Test series', scale: 'price', keys: [{ key: 'v', label: 'V' }] }],
      },
      onCandle: (ctx) => ({
        signals: [],
        indicators: [{ seriesId: 'test-series', time: ctx.now, values: { v: 42 } }],
      }),
    });
    const { runner, cache, events, indicatorCache } = buildRunner(strategy);

    let emitted: IndicatorEmittedEvent | undefined;
    events.on(StrategyEngineEvents.IndicatorEmitted, (e: IndicatorEmittedEvent) => (emitted = e));

    const c1 = bar(0);
    cache.upsert(c1);
    await events.emitAsync(MarketDataEvents.CandleClosed, new CandleClosedEvent(c1));

    expect(emitted?.point).toEqual({
      strategyId: 'indicator-strategy',
      instrument: instrumentA.id,
      timeframe: '1m',
      tier: 'demo',
      seriesId: 'test-series',
      time: 0,
      values: { v: 42 },
    });
    expect(indicatorCache.query(instrumentA.id, 0, 0, 'indicator-strategy')).toHaveLength(1);
  });
});

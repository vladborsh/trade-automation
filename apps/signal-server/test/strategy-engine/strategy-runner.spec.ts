import { EventEmitter2 } from '@nestjs/event-emitter';
import { Candle, Instrument, Signal } from '@trade-automation/contracts';
import { CandleCache } from '../../src/market-data/candle-cache.service';
import { CandleClosedEvent, MarketDataEvents } from '../../src/market-data/market-data.events';
import { SignalStrategy, StrategyContext } from '../../src/strategy-engine/signal-strategy.port';
import { StrategyEngineEvents } from '../../src/strategy-engine/strategy-engine.events';
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

function buildRunner(strategy: SignalStrategy) {
  const cache = new CandleCache();
  const events = new EventEmitter2();
  const registry = { active: (): ActiveStrategy[] => [{ strategy, instruments: [instrumentA.id] }] } as never;
  const config = { instruments: [instrumentA] } as never;
  const signalStore = { append: jest.fn(async () => undefined) };
  const execution = { onSignal: jest.fn(async () => undefined) };
  const metrics = fakeMetrics();

  const runner = new StrategyRunnerService(registry, cache, events, config, metrics, signalStore as never, execution as never);
  runner.onApplicationBootstrap();
  // @OnEvent only self-wires under Nest's EventEmitterModule discovery; wire it manually here
  // since this test constructs the service directly instead of through the DI container.
  events.on(MarketDataEvents.CandleClosed, (event: CandleClosedEvent) => runner.handleClosed(event));
  return { runner, cache, events, signalStore, execution };
}

const MIN = 60_000;

describe('StrategyRunner warm-up gating and error isolation (architecture/live-signal-server.md §4.4)', () => {
  it('does not call onCandle until warmupBars is satisfied, then evaluates once warm', async () => {
    const onCandle = jest.fn(() => [] as Signal[]);
    const strategy: SignalStrategy = {
      id: 'test-strategy',
      requirements: { instruments: [instrumentA.id], timeframe: '1m', warmupBars: { '1m': 3 } },
      onCandle,
    };
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

  it('isolates a throw in onCandle: it is caught, counted, and does not stop later evaluations', async () => {
    const onCandle = jest.fn<Signal[], [StrategyContext]>(() => {
      throw new Error('boom');
    });
    const strategy: SignalStrategy = {
      id: 'flaky-strategy',
      requirements: { instruments: [instrumentA.id], timeframe: '1m', warmupBars: { '1m': 1 } },
      onCandle,
    };
    const { runner, cache, events } = buildRunner(strategy);

    const c1 = bar(0);
    cache.upsert(c1);
    await expect(events.emitAsync(MarketDataEvents.CandleClosed, new CandleClosedEvent(c1))).resolves.toBeDefined();

    expect(runner.statuses()[0].status).toBe('error');

    // a second closed candle must still be attempted — the runner is not dead
    onCandle.mockReset();
    onCandle.mockReturnValue([] as Signal[]);
    const c2 = bar(MIN);
    cache.upsert(c2);
    await events.emitAsync(MarketDataEvents.CandleClosed, new CandleClosedEvent(c2));

    expect(onCandle).toHaveBeenCalledTimes(1);
    expect(runner.statuses()[0].status).toBe('live');
  });

  it('persists returned signals and emits SignalEmitted, isolating a downstream ExecutionPort failure', async () => {
    const signal: Signal = {
      id: '11111111-1111-1111-1111-111111111111',
      strategyId: 'sig-strategy',
      instrument: instrumentA.id,
      timeframe: '1m',
      time: 0,
      kind: 'info',
      direction: 'flat',
      overlay: [],
      meta: {},
    };
    const strategy: SignalStrategy = {
      id: 'sig-strategy',
      requirements: { instruments: [instrumentA.id], timeframe: '1m', warmupBars: { '1m': 1 } },
      onCandle: () => [signal],
    };
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
});

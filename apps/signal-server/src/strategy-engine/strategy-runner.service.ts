import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InstrumentId, StrategiesResponse, StrategyStatus, Timeframe } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { CandleCache } from '../market-data/candle-cache.service';
import { CandleClosedEvent, MarketDataEvents } from '../market-data/market-data.events';
import { MetricsService } from '../observability/metrics.service';
import { SIGNAL_STORE, SignalStore } from '../storage/signal-store.port';
import { toZoned } from './clock';
import { EXECUTION_PORT, ExecutionPort } from './execution.port';
import { SignalStrategy, StrategyContext, StrategyState } from './signal-strategy.port';
import { StrategyEngineEvents, SignalEmittedEvent } from './strategy-engine.events';
import { ActiveStrategy, StrategyRegistryService } from './strategy-registry.service';

interface Runner {
  strategy: SignalStrategy;
  instrument: InstrumentId;
  timeframe: Timeframe;
  warmupBars: Partial<Record<Timeframe, number>>;
  state: StrategyState;
  status: StrategyStatus;
  errorCount: number;
}

function runnerKey(strategyId: string, instrument: InstrumentId): string {
  return `${strategyId}|${instrument}`;
}

/**
 * architecture/live-signal-server.md §4.4 — one instance per (strategy, instrument). Refuses
 * to evaluate until every warmupBars requirement is met ('warming'), then calls onCandle,
 * persists the returned signals, publishes SignalEmitted, hands them to ExecutionPort.
 * "A throw inside one runner is caught, logged with the strategy id and instrument, and
 * counted — it never takes down ingestion or other runners" (ported from the bot's
 * per-strategy try/catch in StrategyRunner.execute()).
 */
@Injectable()
export class StrategyRunnerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StrategyRunnerService.name);
  private readonly runners = new Map<string, Runner>();
  private instrumentsById = new Map<InstrumentId, { sessionTimezone: string }>();

  constructor(
    private readonly registry: StrategyRegistryService,
    private readonly cache: CandleCache,
    private readonly events: EventEmitter2,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
    @Inject(SIGNAL_STORE) private readonly signalStore: SignalStore,
    @Inject(EXECUTION_PORT) private readonly execution: ExecutionPort,
  ) {}

  onApplicationBootstrap(): void {
    this.instrumentsById = new Map(this.config.instruments.map((i) => [i.id, i]));
    for (const active of this.registry.active()) {
      this.registerRunner(active);
    }
  }

  private registerRunner(active: ActiveStrategy): void {
    for (const instrument of active.instruments) {
      const key = runnerKey(active.strategy.id, instrument);
      this.runners.set(key, {
        strategy: active.strategy,
        instrument,
        timeframe: active.strategy.requirements.timeframe,
        warmupBars: active.strategy.requirements.warmupBars as Partial<Record<Timeframe, number>>,
        state: {},
        status: 'warming',
        errorCount: 0,
      });
    }
  }

  @OnEvent(MarketDataEvents.CandleClosed)
  async handleClosed(event: CandleClosedEvent): Promise<void> {
    const candle = event.candle;
    for (const runner of this.runners.values()) {
      if (runner.instrument !== candle.instrument || runner.timeframe !== candle.timeframe) continue;
      await this.evaluate(runner, candle.openTime);
    }
  }

  private isWarm(runner: Runner): boolean {
    for (const [tf, needed] of Object.entries(runner.warmupBars)) {
      if (!needed) continue;
      const have = this.cache.window(runner.instrument, tf as Timeframe).length;
      if (have < needed) return false;
    }
    return true;
  }

  private async evaluate(runner: Runner, now: number): Promise<void> {
    if (!this.isWarm(runner)) {
      runner.status = 'warming';
      return;
    }

    const instrumentMeta = this.instrumentsById.get(runner.instrument);
    if (!instrumentMeta) return;

    const ctx: StrategyContext = {
      instrument: { id: runner.instrument, ...instrumentMeta } as StrategyContext['instrument'],
      now,
      window: (tf: Timeframe) => this.cache.window(runner.instrument, tf),
      state: runner.state,
      clock: { toZoned },
    };

    const startedAt = process.hrtime.bigint();
    try {
      const signals = runner.strategy.onCandle(ctx);
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.metrics.strategyEvalDurationMs.observe(
        { strategyId: runner.strategy.id, instrument: runner.instrument },
        durationMs,
      );
      runner.status = 'live';
      if (signals.length === 0) return;

      await this.signalStore.append(signals);
      for (const signal of signals) {
        this.events.emit(StrategyEngineEvents.SignalEmitted, new SignalEmittedEvent(signal));
        try {
          await this.execution.onSignal(signal);
        } catch (execErr) {
          this.logger.error(
            `ExecutionPort.onSignal failed for ${runner.strategy.id}/${runner.instrument}: ${(execErr as Error).message}`,
          );
        }
      }
    } catch (err) {
      runner.status = 'error';
      runner.errorCount += 1;
      this.metrics.strategyErrors.inc({ strategyId: runner.strategy.id, instrument: runner.instrument });
      this.logger.error(
        `Strategy runner error strategyId=${runner.strategy.id} instrument=${runner.instrument} ` +
          `errorCount=${runner.errorCount}: ${(err as Error).message}`,
      );
      // Never rethrow: one strategy's bug must not take down ingestion or other runners.
    }
  }

  statuses(): StrategiesResponse {
    const out: StrategiesResponse = [];
    for (const active of this.registry.active()) {
      const instruments = active.instruments;
      const perInstrumentStatuses = instruments.map(
        (i) => this.runners.get(runnerKey(active.strategy.id, i))?.status ?? 'warming',
      );
      const status: StrategyStatus = perInstrumentStatuses.includes('error')
        ? 'error'
        : perInstrumentStatuses.every((s) => s === 'live')
          ? 'live'
          : 'warming';
      const warmupBars = active.strategy.requirements.warmupBars as Partial<Record<Timeframe, number>>;
      out.push({
        id: active.strategy.id,
        enabled: true,
        instruments,
        timeframe: active.strategy.requirements.timeframe,
        warmupBars: Math.max(0, ...Object.values(warmupBars).map((v) => v ?? 0)),
        status,
      });
    }
    return out;
  }
}

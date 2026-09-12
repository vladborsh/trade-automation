import { Injectable, Logger } from '@nestjs/common';
import { InstrumentId, Timeframe } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { CandleCache } from '../market-data/candle-cache.service';
import { SignalStrategy } from './signal-strategy.port';
import { ExampleCrossStrategy } from './strategies/example-cross/example-cross.strategy';

export interface ActiveStrategy {
  strategy: SignalStrategy;
  instruments: InstrumentId[];
}

/**
 * architecture/live-signal-server.md §4.4: "'Plugging in' a shipped strategy = adding one
 * Nest module exporting one SignalStrategy provider, plus a config line enabling it for its
 * instruments." `PLUGIN_FACTORIES` is the scaffold's registration point — a shipped strategy
 * adds an entry here (or is refactored onto the SIGNAL_STRATEGIES multi-provider token once
 * there is more than one real plug-in to justify it).
 */
const PLUGIN_FACTORIES: Record<string, (params: Record<string, unknown>) => SignalStrategy> = {
  'example-cross': (params) => new ExampleCrossStrategy(Number(params.smaPeriod ?? 20)),
};

@Injectable()
export class StrategyRegistryService {
  private readonly logger = new Logger(StrategyRegistryService.name);
  private readonly activeStrategies: ActiveStrategy[];

  constructor(
    private readonly config: AppConfigService,
    private readonly cache: CandleCache,
  ) {
    this.activeStrategies = this.build();
    this.sizeCache();
  }

  private build(): ActiveStrategy[] {
    const out: ActiveStrategy[] = [];
    for (const entry of this.config.strategies) {
      if (!entry.enabled) continue;
      const factory = PLUGIN_FACTORIES[entry.id];
      if (!factory) {
        this.logger.warn(`Unknown strategy id in strategies.yaml: ${entry.id} (skipped)`);
        continue;
      }
      out.push({ strategy: factory(entry.params), instruments: entry.instruments });
    }
    return out;
  }

  /** architecture/live-signal-server.md §4.1: cache depth "sized from the strategies'
   * declared warmupBars at boot — the cache must hold max(warmupBars) + margin." */
  private sizeCache(): void {
    for (const { strategy, instruments } of this.activeStrategies) {
      const warmup = strategy.requirements.warmupBars as Partial<Record<Timeframe, number>>;
      for (const instrument of instruments) {
        for (const [tf, bars] of Object.entries(warmup)) {
          if (bars) this.cache.setMinDepth(instrument, tf as Timeframe, bars);
        }
      }
    }
  }

  active(): ActiveStrategy[] {
    return this.activeStrategies;
  }
}

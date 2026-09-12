import { Injectable, Logger } from '@nestjs/common';
import { InstrumentId, Timeframe, Venue } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { CandleCache } from '../market-data/candle-cache.service';
import { IndicatorCache } from './indicator-cache.service';
import { SignalStrategy } from './signal-strategy.port';
import { ExampleCrossStrategy } from './strategies/example-cross/example-cross.strategy';
import { createVwapBandReversalStrategy } from './strategies/vwap-band-reversal/vwap-band-reversal.strategy';

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
  'vwap-band-reversal': (params) => createVwapBandReversalStrategy(params),
};

/**
 * architecture/vwap-band-reversal-plugin.md §5.2 — strategies whose id is in this set only
 * evaluate for instruments on the listed venue(s); a configured instrument on any other venue
 * is a boot error (NY-window session semantics on a 24/7 perp would be a silent
 * misconfiguration).
 */
const VENUE_RESTRICTED_PLUGINS: Record<string, readonly Venue[]> = {
  'vwap-band-reversal': ['capitalcom'],
};

@Injectable()
export class StrategyRegistryService {
  private readonly logger = new Logger(StrategyRegistryService.name);
  private readonly activeStrategies: ActiveStrategy[];

  constructor(
    private readonly config: AppConfigService,
    private readonly cache: CandleCache,
    private readonly indicatorCache: IndicatorCache,
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
      this.assertVenueAllowed(entry.id, entry.instruments);
      out.push({ strategy: factory(entry.params), instruments: entry.instruments });
    }
    return out;
  }

  private assertVenueAllowed(strategyId: string, instruments: InstrumentId[]): void {
    const allowedVenues = VENUE_RESTRICTED_PLUGINS[strategyId];
    if (!allowedVenues) return;
    for (const instrument of instruments) {
      const venue = instrument.split(':')[0] as Venue;
      if (!allowedVenues.includes(venue)) {
        throw new Error(
          `strategies.yaml: '${strategyId}' is restricted to venue(s) [${allowedVenues.join(', ')}] but ` +
            `instrument '${instrument}' is on venue '${venue}' — refusing to boot with this configuration.`,
        );
      }
    }
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
        const depthBars = Math.max(0, ...Object.values(warmup).map((v) => v ?? 0));
        for (const spec of strategy.requirements.indicators ?? []) {
          this.indicatorCache.setMinDepth(strategy.id, instrument, spec.id, depthBars);
        }
      }
    }
  }

  active(): ActiveStrategy[] {
    return this.activeStrategies;
  }
}

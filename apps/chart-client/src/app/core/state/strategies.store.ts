import { Injectable, computed, signal } from '@angular/core';
import type { IndicatorSeriesSpec, InstrumentId } from '@trade-automation/contracts';
import type { StrategyInfo } from '../contracts/derived';

/** `GET /api/strategies` at boot (architecture/vwap-band-reversal-plugin.md §3.2). */
@Injectable({ providedIn: 'root' })
export class StrategiesStore {
  private readonly list = signal<StrategyInfo[]>([]);
  readonly strategies = this.list.asReadonly();

  /** `IndicatorSeriesSpec` keyed by `${strategyId}:${seriesId}`, for `IndicatorLayer`. */
  readonly indicatorSpecs = computed(() => {
    const specs = new Map<string, IndicatorSeriesSpec>();
    for (const strategy of this.list()) {
      for (const spec of strategy.indicators ?? []) {
        specs.set(`${strategy.id}:${spec.id}`, spec);
      }
    }
    return specs;
  });

  setStrategies(strategies: StrategyInfo[]): void {
    this.list.set(strategies);
  }

  /**
   * §6 item 4: the badge shows whenever an enabled non-`live` strategy
   * covers the selected instrument.
   */
  hasNonLiveStrategyFor(instrument: InstrumentId | null): boolean {
    if (!instrument) {
      return false;
    }
    return this.list().some((s) => s.enabled && s.tier !== 'live' && s.instruments.includes(instrument));
  }

  strategiesFor(instrument: InstrumentId | null): StrategyInfo[] {
    if (!instrument) {
      return [];
    }
    return this.list().filter((s) => s.instruments.includes(instrument));
  }
}

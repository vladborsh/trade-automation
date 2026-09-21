import type { Signal } from '@angular/core';
import type {
  Candle,
  IndicatorPoint,
  IndicatorSeriesSpec,
  MetricPoint,
  OverlayPrimitive,
  Panel,
} from '@trade-automation/contracts';
import type { IndicatorsStore } from '../../core/state/indicators.store';
import type { SignalsStore } from '../../core/state/signals.store';

/**
 * backtest-app-system-design.md §2.3 (D2) — everything `ChartPanelComponent` and
 * `PanelGridComponent` render one panel from. The live terminal supplies it through
 * `panelFeedSource()` over a `PanelFeed`; the replay workspace supplies its own. The chart kit
 * never needs to know which.
 *
 * Interface decisions beyond §2.3 (Tech Lead rulings on T-016, 2026-09-21):
 * - `points` (Q2): metric panels (e.g. open interest) draw from it. Required; a source with
 *   no metric series returns an empty signal.
 * - `researchScope` (Q3): exists **only for the live research badge**. `PanelGridComponent`
 *   hands these per-panel store instances to the unmodified `ResearchBadgeComponent` through a
 *   panel-scoped injector. Omit it anywhere no research strategy runs (e.g. replay); the badge
 *   then reads the empty root stores and stays hidden.
 */
export interface PanelSource {
  readonly panel: Panel;
  readonly candles: Signal<readonly Candle[]>;
  readonly points: Signal<readonly MetricPoint[]>;
  readonly overlays: Signal<readonly OverlayPrimitive[]>;
  readonly indicatorPoints: Signal<readonly IndicatorPoint[]>;
  readonly indicatorSpecs: Signal<ReadonlyMap<string, IndicatorSeriesSpec>>;
  readonly researchScope?: PanelResearchScope;
  loadOlder(): Promise<void>;
}

/** The live feed's own per-panel stores, for the research badge only (see `PanelSource`). */
export interface PanelResearchScope {
  readonly signals: SignalsStore;
  readonly indicators: IndicatorsStore;
}

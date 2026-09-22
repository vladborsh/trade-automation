import type { Signal } from '@angular/core';
import type {
  Candle,
  IndicatorPoint,
  IndicatorSeriesSpec,
  MetricPoint,
  OverlayPrimitive,
  Panel,
} from '@trade-automation/contracts';
import type { PositionToolChange, PositionToolsView } from '../chart/overlay/position-tool.model';
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
  /**
   * backtest-app-system-design.md §9.1 (T-022): the panel's position tools. Only the replay
   * workspace supplies it; without it the chart draws none and ignores pointer hits.
   */
  readonly positionTools?: PanelPositionTools;
  /**
   * backtest-app-system-design.md §9.2 (T-026): where the chart panel attaches its chart's
   * picture, for the trade screenshots. Only the replay workspace supplies it.
   */
  readonly capture?: PanelCapture;
  /**
   * T-047: whether indicator series titles are drawn on the chart. Absent means yes (the live
   * terminal, whose research titles carry the "unvalidated" wording); the replay workspace draws
   * lines only.
   */
  readonly indicatorLabels?: boolean;
  loadOlder(): Promise<void>;
}

/** The chart's picture (with its primitives, without the crosshair) while the chart exists. */
export interface PanelCapture {
  attach(take: (() => HTMLCanvasElement | null) | null): void;
}

/** A panel's position tools as the chart kit sees them: what to draw, and where changes go. */
export interface PanelPositionTools {
  readonly view: Signal<PositionToolsView>;
  apply(change: PositionToolChange): void;
  /** The price under the pointer while it is over this panel's chart, else null. */
  setPointerPrice(price: number | null): void;
}

/** The live feed's own per-panel stores, for the research badge only (see `PanelSource`). */
export interface PanelResearchScope {
  readonly signals: SignalsStore;
  readonly indicators: IndicatorsStore;
}

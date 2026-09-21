import { type Signal, computed, signal } from '@angular/core';
import type { Candle, IndicatorPoint, IndicatorSeriesSpec, MetricPoint, OverlayPrimitive, Panel } from '@trade-automation/contracts';
import type { PanelPositionTools, PanelSource } from '../../features/panel-grid/panel-source';
import { seriesBars } from './fold-on-step';
import type { ReplayEngine } from './replay-engine';

const NO_POINTS = signal<readonly MetricPoint[]>([]).asReadonly();
const NO_OVERLAYS = signal<readonly OverlayPrimitive[]>([]).asReadonly();
const NO_INDICATOR_POINTS = signal<readonly IndicatorPoint[]>([]).asReadonly();
const NO_INDICATOR_SPECS = signal<ReadonlyMap<string, IndicatorSeriesSpec>>(new Map()).asReadonly();

/**
 * backtest-app-system-design.md §2.3 (D2) — one replay panel as a `PanelSource`: the engine's
 * timeframe bars behind the cursor (closed + forming). Session layouts are candle panels only
 * (D10), so `points` is empty; indicators arrive with a later task. `positionTools` are the
 * panel's position tools (T-022). No `researchScope`: no research strategy runs in replay.
 */
export class ReplayPanelSource implements PanelSource {
  readonly candles: Signal<readonly Candle[]>;
  readonly points = NO_POINTS;
  readonly overlays = NO_OVERLAYS;
  readonly indicatorPoints = NO_INDICATOR_POINTS;
  readonly indicatorSpecs = NO_INDICATOR_SPECS;

  constructor(
    readonly panel: Panel,
    private readonly engine: ReplayEngine,
    readonly positionTools?: PanelPositionTools,
  ) {
    const series = engine.seriesFor(panel.id);
    this.candles = computed(() => seriesBars(series()));
  }

  loadOlder(): Promise<void> {
    return this.engine.loadOlder(this.panel.id);
  }
}

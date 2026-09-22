import { type Signal, computed, signal } from '@angular/core';
import type { Candle, IndicatorPoint, IndicatorSeriesSpec, MetricPoint, OverlayPrimitive, Panel, SessionPanel } from '@trade-automation/contracts';
import type { PanelPositionTools, PanelSource } from '../../features/panel-grid/panel-source';
import { CaptureSlot } from './capture-chart';
import { seriesBars } from './fold-on-step';
import { panelIndicators } from './panel-indicators';
import type { ReplayEngine } from './replay-engine';

const NO_POINTS = signal<readonly MetricPoint[]>([]).asReadonly();
const NO_OVERLAYS = signal<readonly OverlayPrimitive[]>([]).asReadonly();

/**
 * backtest-app-system-design.md §2.3 (D2) — one replay panel as a `PanelSource`: the engine's
 * timeframe bars behind the cursor (closed + forming). Session layouts are candle panels only
 * (D10), so `points` is empty. The panel's `indicators` (T-028) are computed on the client over
 * those same bars on every step, timeframe switch and older page (decision 11). `positionTools`
 * are the panel's position tools (T-022). No `researchScope`: no research strategy runs in replay.
 */
export class ReplayPanelSource implements PanelSource {
  readonly candles: Signal<readonly Candle[]>;
  readonly points = NO_POINTS;
  readonly overlays = NO_OVERLAYS;
  readonly indicatorPoints: Signal<readonly IndicatorPoint[]>;
  readonly indicatorSpecs: Signal<ReadonlyMap<string, IndicatorSeriesSpec>>;
  /** The chart panel's picture, for the entry and exit screenshots (T-026). */
  readonly capture = new CaptureSlot();
  /** T-047: indicators are lines only on replay panels. */
  readonly indicatorLabels = false;

  constructor(
    readonly panel: Panel & Pick<SessionPanel, 'indicators'>,
    private readonly engine: ReplayEngine,
    readonly positionTools?: PanelPositionTools,
  ) {
    const series = engine.seriesFor(panel.id);
    this.candles = computed(() => seriesBars(series()));
    const indicators = computed(() => panelIndicators(this.candles(), panel.indicators, panel.instrument, engine.timeframe()));
    this.indicatorPoints = computed(() => indicators().points);
    this.indicatorSpecs = computed(() => indicators().specs);
  }

  loadOlder(): Promise<void> {
    return this.engine.loadOlder(this.panel.id);
  }
}

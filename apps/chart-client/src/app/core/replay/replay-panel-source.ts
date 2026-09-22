import { type Signal, computed, signal } from '@angular/core';
import type { Candle, IndicatorPoint, IndicatorSeriesSpec, MetricPoint, OverlayPrimitive, Panel, SessionPanel } from '@trade-automation/contracts';
import type { PanelPositionTools, PanelSource } from '../../features/panel-grid/panel-source';
import { CaptureSlot } from './capture-chart';
import { seriesBars } from './fold-on-step';
import { padToBucket } from './pad-to-bucket';
import { panelIndicators } from './panel-indicators';
import type { ReplayEngine } from './replay-engine';

/** T-063: the same on every replay panel, so the synced window agrees; ~a tool's width at the newest bar. */
export const REPLAY_RIGHT_MARGIN_PX = 160;

const NO_POINTS = signal<readonly MetricPoint[]>([]).asReadonly();

/**
 * backtest-app-system-design.md §2.3 (D2) — one replay panel as a `PanelSource`: the engine's
 * timeframe bars behind the cursor (closed + forming). Session layouts are candle panels only
 * (D10), so `points` is empty. The panel's `indicators` (T-028) are computed on the client over
 * those same bars on every step, timeframe switch and older page (decision 11); their chart
 * primitives (T-057: the iFVG boxes) are the panel's `overlays` — position-tool drawings stay on
 * their own primitive. `positionTools`
 * are the panel's position tools (T-022). No `researchScope`: no research strategy runs in replay.
 */
export class ReplayPanelSource implements PanelSource {
  readonly candles: Signal<readonly Candle[]>;
  readonly points = NO_POINTS;
  readonly overlays: Signal<readonly OverlayPrimitive[]>;
  readonly indicatorPoints: Signal<readonly IndicatorPoint[]>;
  readonly indicatorSpecs: Signal<ReadonlyMap<string, IndicatorSeriesSpec>>;
  /** The chart panel's picture, for the entry and exit screenshots (T-026). */
  readonly capture = new CaptureSlot();
  /** T-047: indicators are lines only on replay panels. */
  readonly indicatorLabels = false;
  /** T-063: room right of the newest bar, so a tool drawn there is usable without panning. */
  readonly rightMarginPx = REPLAY_RIGHT_MARGIN_PX;
  /**
   * T-056 (ruling A): every bucket without a bar from the first bar to the cursor's, at the panel's
   * timeframe — only the chart sees it: `candles` (and so the indicators, the fills and the position
   * tools) stay real bars.
   */
  readonly whitespace: Signal<readonly number[]>;

  constructor(
    readonly panel: Panel & Pick<SessionPanel, 'indicators'>,
    private readonly engine: ReplayEngine,
    readonly positionTools?: PanelPositionTools,
  ) {
    const series = engine.seriesFor(panel.id);
    this.candles = computed(() => seriesBars(series()));
    this.whitespace = computed(() => padToBucket(this.candles(), engine.timeframe(), engine.cursor()));
    const indicators = computed(() => panelIndicators(this.candles(), panel.indicators, panel.instrument, engine.timeframe()));
    this.indicatorPoints = computed(() => indicators().points);
    this.indicatorSpecs = computed(() => indicators().specs);
    this.overlays = computed(() => indicators().overlays);
  }

  loadOlder(): Promise<void> {
    return this.engine.loadOlder(this.panel.id);
  }
}

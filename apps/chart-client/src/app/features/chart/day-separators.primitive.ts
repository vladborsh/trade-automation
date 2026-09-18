import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApi,
  IPanePrimitive,
  IPanePrimitivePaneView,
  IPaneApi,
  IPrimitivePaneRenderer,
  Logical,
  PaneAttachedParameter,
  PrimitivePaneViewZOrder,
  Time,
} from 'lightweight-charts';
import type { Timeframe } from '@trade-automation/contracts';
import { CHART_PALETTE } from './chart-theme';
import { nyDayBoundaryIndices, showsDaySeparators } from './day-separators';

const SEPARATOR_ALPHA = 0.35;
const SEPARATOR_DASH_PX = [4, 4];

/**
 * §12.3 — vertical dashed lines at the New York day boundaries, drawn at logical `i − 0.5` (the
 * left edge of the first bar of the new NY day). A PANE primitive, not a series one: it survives
 * the metric line↔candles series swap (§11.2) and works on any pane (price, metric, RSI). It never
 * touches the time scale or the crosshair, and `hitTest` is null, so sync is unaffected.
 *
 * Usage: `attachTo(pane)`, then `setData(timesSec, tf)` whenever the pane's bars change.
 */
export class DaySeparatorsPrimitive implements IPanePrimitive<Time> {
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private pane: IPaneApi<Time> | null = null;
  private boundaries: number[] = [];
  private readonly view = new DaySeparatorsPaneView(this);

  attached(param: PaneAttachedParameter<Time>): void {
    this.chart = param.chart as IChartApi;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.requestUpdate = null;
  }

  attachTo(pane: IPaneApi<Time>): void {
    this.pane = pane;
    pane.attachPrimitive(this);
  }

  detach(): void {
    this.pane?.detachPrimitive(this);
    this.pane = null;
  }

  /** `timesSec`: the pane's bar times (UTC epoch seconds, index = logical index). */
  setData(timesSec: readonly number[], tf: Timeframe): void {
    this.boundaries = showsDaySeparators(tf) ? nyDayBoundaryIndices(timesSec) : [];
    this.requestUpdate?.();
  }

  boundaryIndices(): readonly number[] {
    return this.boundaries;
  }

  getChart(): IChartApi | null {
    return this.chart;
  }

  paneViews(): readonly IPanePrimitivePaneView[] {
    return [this.view];
  }

  hitTest(): null {
    return null;
  }
}

class DaySeparatorsPaneView implements IPanePrimitivePaneView {
  constructor(private readonly primitive: DaySeparatorsPrimitive) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new DaySeparatorsRenderer(this.primitive);
  }
}

class DaySeparatorsRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly primitive: DaySeparatorsPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    const chart = this.primitive.getChart();
    const boundaries = this.primitive.boundaryIndices();
    if (!chart || boundaries.length === 0) {
      return;
    }
    const timeScale = chart.timeScale();
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio }) => {
      const lineWidth = Math.max(1, Math.floor(horizontalPixelRatio));
      context.save();
      context.globalAlpha = SEPARATOR_ALPHA;
      context.strokeStyle = CHART_PALETTE.separator;
      context.lineWidth = lineWidth;
      context.setLineDash(SEPARATOR_DASH_PX.map((px) => px * horizontalPixelRatio));
      context.beginPath();
      for (const i of boundaries) {
        const x = timeScale.logicalToCoordinate((i - 0.5) as Logical);
        if (x === null) {
          continue;
        }
        // Centre a whole-pixel line on the pixel grid so 1 px stays crisp.
        const bx = Math.round(x * horizontalPixelRatio) + (lineWidth % 2) / 2;
        if (bx < 0 || bx > bitmapSize.width) {
          continue;
        }
        context.moveTo(bx, 0);
        context.lineTo(bx, bitmapSize.height);
      }
      context.stroke();
      context.restore();
    });
  }
}

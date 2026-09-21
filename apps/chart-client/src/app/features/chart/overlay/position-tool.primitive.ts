import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import { labelFor, toolGeometry } from './position-tool.geometry';
import type { PositionToolsView } from './position-tool.model';

const RISK = '#ef5350';
const REWARD = '#26a69a';
const ENTRY = '#c9d1d9';
const MUTED = '#8b949e';
const HANDLE_SIZE = 8;

/** A drawing is at least this wide, so its handles and labels stay usable at the right edge. */
export const TOOL_MIN_WIDTH_PX = 200;

/**
 * The x of a tool's left edge: its anchor time on this chart, but never closer than
 * `TOOL_MIN_WIDTH_PX` to the right edge (the anchor is usually the newest bar, which sits right
 * against the price scale) and never left of the pane.
 */
export function anchorX(chart: IChartApi, anchorTimeMs: number): number {
  const timeScale = chart.timeScale();
  const x = timeScale.timeToCoordinate(Math.floor(anchorTimeMs / 1000) as UTCTimestamp) ?? 0;
  return Math.max(0, Math.min(x, timeScale.width() - TOOL_MIN_WIDTH_PX));
}

/**
 * backtest-app-system-design.md §9.1 — the position tools of one candle series, drawn in one canvas
 * pass with `ShapesPrimitive`'s vocabulary (which stays untouched): a translucent rect from entry
 * to SL in #ef5350 and entry to TP in #26a69a, a ray at each level with a right-edge label (price,
 * distance, R, qty on the entry), square handles (three on a draft, SL/TP on a live order). The
 * active tool is drawn brighter. Render-only: pointer handling is `PositionToolController`'s.
 */
export class PositionToolPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdateFn: (() => void) | null = null;
  private attachedSeries: ISeriesApi<SeriesType> | null = null;
  private view: PositionToolsView | null = null;
  private readonly paneView = new PositionToolPaneView(this);

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart as unknown as IChartApi;
    this.series = param.series as unknown as ISeriesApi<SeriesType>;
    this.requestUpdateFn = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdateFn = null;
  }

  /** Idempotent: attaches this primitive to `series` at most once. */
  attachTo(series: ISeriesApi<SeriesType>): void {
    if (this.attachedSeries === series) return;
    series.attachPrimitive(this as unknown as ISeriesPrimitive<Time>);
    this.attachedSeries = series;
  }

  setView(view: PositionToolsView | null): void {
    this.view = view;
    this.requestUpdateFn?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.paneView];
  }

  getChart(): IChartApi | null {
    return this.chart;
  }

  getSeries(): ISeriesApi<SeriesType> | null {
    return this.series;
  }

  getView(): PositionToolsView | null {
    return this.view;
  }
}

class PositionToolPaneView implements IPrimitivePaneView {
  constructor(private readonly primitive: PositionToolPrimitive) {}

  renderer(): IPrimitivePaneRenderer | null {
    return new PositionToolRenderer(this.primitive);
  }
}

class PositionToolRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly primitive: PositionToolPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    const chart = this.primitive.getChart();
    const series = this.primitive.getSeries();
    const view = this.primitive.getView();
    if (!chart || !series || !view || view.tools.length === 0) return;

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const priceToY = (price: number) => series.priceToCoordinate(price);
      // inactive first, so the active tool is painted on top
      const tools = [...view.tools].sort((a, b) => Number(a.active) - Number(b.active));
      for (const tool of tools) {
        const g = toolGeometry(tool, anchorX(chart, tool.anchorTime), priceToY);
        if (!g) continue;
        const width = mediaSize.width - g.x;
        const alpha = tool.active ? 0.28 : 0.12;
        const band = (y: number, color: string) => {
          context.save();
          context.globalAlpha = alpha;
          context.fillStyle = color;
          context.fillRect(g.x, Math.min(g.yEntry, y), width, Math.abs(y - g.yEntry));
          context.restore();
        };
        band(g.ySl, RISK);
        if (g.yTp !== null) band(g.yTp, REWARD);

        const level = (y: number, color: string, label: string) => {
          context.save();
          context.globalAlpha = tool.active ? 1 : 0.7;
          context.strokeStyle = color;
          context.lineWidth = tool.active ? 2 : 1;
          context.setLineDash(tool.kind === 'draft' ? [4, 3] : []);
          context.beginPath();
          context.moveTo(g.x, y);
          context.lineTo(mediaSize.width, y);
          context.stroke();
          context.setLineDash([]);
          context.fillStyle = color;
          context.font = '10px ui-monospace, monospace';
          context.textAlign = 'right';
          context.fillText(label, mediaSize.width - 4, y - 4);
          context.restore();
        };
        level(g.yEntry, tool.active ? ENTRY : MUTED, labelFor(tool, 'entry', view));
        level(g.ySl, RISK, labelFor(tool, 'sl', view));
        if (g.yTp !== null) level(g.yTp, REWARD, labelFor(tool, 'tp', view));

        for (const h of g.handles) {
          context.save();
          context.fillStyle = '#0d1117';
          context.strokeStyle = h.part === 'sl' ? RISK : h.part === 'tp' ? REWARD : ENTRY;
          context.lineWidth = tool.active ? 2 : 1;
          context.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          context.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          context.restore();
        }
      }
    });
  }
}

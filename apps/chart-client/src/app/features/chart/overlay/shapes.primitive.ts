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

export interface ShapeRect {
  from: number; // ms epoch
  to: number; // ms epoch
  top: number;
  bottom: number;
  color?: string;
  label?: string;
}

export interface ShapeRay {
  time: number; // ms epoch
  price: number;
  color?: string;
  label?: string;
}

export interface ShapeLine {
  points: Array<{ time: number; price: number }>; // ms epoch
  color?: string;
  label?: string;
  style?: 'solid' | 'dashed';
}

interface ShapesData {
  rects: ShapeRect[];
  rays: ShapeRay[];
  lines: ShapeLine[];
}

function msToTime(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

/**
 * §3.2 of architecture/vwap-band-reversal-plugin.md: one lightweight-charts
 * v5 ISeriesPrimitive drawing `rect` (filled, translucent, optional label),
 * `ray` (horizontal from (time, price) to the right edge) and `line`
 * (polyline through points, solid or dashed) in a single canvas pass.
 * `rect.renderer.ts`/`ray.renderer.ts`/`line.renderer.ts` are thin adapters
 * onto this one instance, attached once per series.
 */
export class ShapesPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdateFn: (() => void) | null = null;
  private attachedSeries: ISeriesApi<SeriesType> | null = null;

  private readonly data: ShapesData = { rects: [], rays: [], lines: [] };
  private readonly view = new ShapesPaneView(this);

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
    if (this.attachedSeries === series) {
      return;
    }
    series.attachPrimitive(this as unknown as ISeriesPrimitive<Time>);
    this.attachedSeries = series;
  }

  setRects(rects: ShapeRect[]): void {
    this.data.rects = rects;
    this.requestUpdateFn?.();
  }

  setRays(rays: ShapeRay[]): void {
    this.data.rays = rays;
    this.requestUpdateFn?.();
  }

  setLines(lines: ShapeLine[]): void {
    this.data.lines = lines;
    this.requestUpdateFn?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  getChart(): IChartApi | null {
    return this.chart;
  }

  getSeries(): ISeriesApi<SeriesType> | null {
    return this.series;
  }

  getData(): ShapesData {
    return this.data;
  }
}

class ShapesPaneView implements IPrimitivePaneView {
  constructor(private readonly primitive: ShapesPrimitive) {}

  renderer(): IPrimitivePaneRenderer | null {
    return new ShapesPaneRenderer(this.primitive);
  }
}

class ShapesPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly primitive: ShapesPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    const chart = this.primitive.getChart();
    const series = this.primitive.getSeries();
    if (!chart || !series) {
      return;
    }
    const { rects, rays, lines } = this.primitive.getData();
    if (rects.length === 0 && rays.length === 0 && lines.length === 0) {
      return;
    }

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const timeToX = (ms: number): number | null => chart.timeScale().timeToCoordinate(msToTime(ms));
      const priceToY = (price: number): number | null => series.priceToCoordinate(price);

      for (const rect of rects) {
        const x1 = timeToX(rect.from);
        const y1 = priceToY(rect.top);
        const y2 = priceToY(rect.bottom);
        if (x1 === null || y1 === null || y2 === null) {
          continue;
        }
        const x2 = timeToX(rect.to) ?? mediaSize.width;
        const top = Math.min(y1, y2);
        const height = Math.abs(y2 - y1);
        context.save();
        context.globalAlpha = 0.15;
        context.fillStyle = rect.color ?? '#d29922';
        context.fillRect(x1, top, x2 - x1, height);
        context.restore();
        if (rect.label) {
          context.save();
          context.fillStyle = rect.color ?? '#d29922';
          context.font = '10px ui-monospace, monospace';
          context.fillText(rect.label, x1 + 3, top + 11);
          context.restore();
        }
      }

      for (const ray of rays) {
        const x = timeToX(ray.time);
        const y = priceToY(ray.price);
        if (x === null || y === null) {
          continue;
        }
        context.save();
        context.strokeStyle = ray.color ?? '#787b86';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(mediaSize.width, y);
        context.stroke();
        context.restore();
        if (ray.label) {
          context.save();
          context.fillStyle = ray.color ?? '#787b86';
          context.font = '10px ui-monospace, monospace';
          context.fillText(ray.label, x + 3, y - 4);
          context.restore();
        }
      }

      for (const line of lines) {
        if (line.points.length < 2) {
          continue;
        }
        context.save();
        context.strokeStyle = line.color ?? '#d29922';
        context.lineWidth = 1;
        context.setLineDash(line.style === 'dashed' ? [4, 3] : []);
        context.beginPath();
        let started = false;
        for (const point of line.points) {
          const x = timeToX(point.time);
          const y = priceToY(point.price);
          if (x === null || y === null) {
            continue;
          }
          if (!started) {
            context.moveTo(x, y);
            started = true;
          } else {
            context.lineTo(x, y);
          }
        }
        context.stroke();
        context.restore();
        if (line.label && started) {
          const first = line.points[0];
          const x = timeToX(first.time);
          const y = priceToY(first.price);
          if (x !== null && y !== null) {
            context.save();
            context.fillStyle = line.color ?? '#d29922';
            context.font = '10px ui-monospace, monospace';
            context.fillText(line.label, x + 3, y - 4);
            context.restore();
          }
        }
      }
    });
  }
}

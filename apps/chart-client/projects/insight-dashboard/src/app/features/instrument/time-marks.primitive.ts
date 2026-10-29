import type {
  IChartApiBase, IPanePrimitive, IPanePrimitivePaneView, IPrimitivePaneRenderer, Logical,
  PaneAttachedParameter, PrimitivePaneViewZOrder, Time,
} from 'lightweight-charts';

/**
 * Vertical marks across a whole pane: dashed lines at times (day separators) and filled bands
 * between two bars (trading sessions). A **pane** primitive (lightweight-charts 5), not a series
 * one, because it belongs to the pane's height, not to any series' price scale.
 *
 * Which bars get a mark is decided in `day-separators.ts` and `trading-sessions.ts`, specced; this
 * file only turns candle times into pixels and paints. Every time it is given is a candle time, so
 * `timeToCoordinate` always finds it; a band runs from half a bar before its first bar to half a
 * bar after its last, so adjacent bars' bands meet and a one-bar band is still a bar wide.
 * Drawn under the series (`zOrder: 'bottom'`), so a band never tints a candle it sits behind.
 */

export interface TimeBand {
  first: number;
  last: number;
  colour: string;
}

export interface TimeMarks {
  lines: readonly number[];
  bands: readonly TimeBand[];
}

export const DAY_SEPARATOR_COLOUR = '#30363d';

interface Target {
  useBitmapCoordinateSpace: (cb: (scope: {
    context: CanvasRenderingContext2D; horizontalPixelRatio: number; verticalPixelRatio: number;
    bitmapSize: { width: number; height: number };
  }) => void) => void;
}

class TimeMarksRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly lines: readonly number[],
    private readonly bands: ReadonlyArray<{ x1: number; x2: number; colour: string }>,
  ) {}

  draw(target: Target): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: h, bitmapSize }) => {
      for (const b of this.bands) {
        ctx.fillStyle = b.colour;
        ctx.fillRect(Math.round(b.x1 * h), 0, Math.max(1, Math.round((b.x2 - b.x1) * h)), bitmapSize.height);
      }
      if (this.lines.length === 0) return;
      ctx.strokeStyle = DAY_SEPARATOR_COLOUR;
      ctx.lineWidth = Math.max(1, Math.floor(h));
      ctx.setLineDash([4 * h, 4 * h]);
      ctx.beginPath();
      for (const x of this.lines) {
        const px = Math.round(x * h) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, bitmapSize.height);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }
}

class TimeMarksView implements IPanePrimitivePaneView {
  constructor(private readonly primitive: TimeMarksPrimitive) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this.primitive.renderer();
  }
}

/** Attach with `chart.panes()[i].attachPrimitive(new TimeMarksPrimitive(marks))`. */
export class TimeMarksPrimitive implements IPanePrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private readonly views = [new TimeMarksView(this)];

  constructor(private readonly marks: TimeMarks) {}

  attached(param: PaneAttachedParameter<Time>): void {
    this.chart = param.chart;
  }

  detached(): void {
    this.chart = null;
  }

  paneViews(): readonly IPanePrimitivePaneView[] {
    return this.views;
  }

  renderer(): IPrimitivePaneRenderer | null {
    const timeScale = this.chart?.timeScale();
    if (!timeScale) return null;
    const x = (t: number): number | null => timeScale.timeToCoordinate(t as Time);
    const a = timeScale.logicalToCoordinate(0 as Logical);
    const b = timeScale.logicalToCoordinate(1 as Logical);
    const half = a !== null && b !== null ? (b - a) / 2 : 0;
    const lines: number[] = [];
    for (const t of this.marks.lines) {
      const at = x(t);
      if (at !== null) lines.push(at - half); // the left edge of the day's first bar
    }
    const bands: Array<{ x1: number; x2: number; colour: string }> = [];
    for (const band of this.marks.bands) {
      const x1 = x(band.first);
      const x2 = x(band.last);
      if (x1 !== null && x2 !== null) bands.push({ x1: x1 - half, x2: x2 + half, colour: band.colour });
    }
    return new TimeMarksRenderer(lines, bands);
  }
}

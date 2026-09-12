import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { OverlayRenderer } from './overlay-layer';
import type { OverlayPrimitive } from '@trade-automation/contracts';
import { ShapesPrimitive } from './shapes.primitive';

type RectPrimitive = Extract<OverlayPrimitive, { type: 'rect' }>;

/**
 * Thin adapter onto the shared `ShapesPrimitive` (architecture/vwap-band-reversal-plugin.md
 * §3.2): converts `rect` overlay primitives into the primitive's shape
 * vocabulary. `ShapesPrimitive` itself does the canvas drawing.
 */
export class RectRenderer implements OverlayRenderer<'rect'> {
  readonly type = 'rect' as const;

  constructor(private readonly shapes: ShapesPrimitive) {}

  supports(type: OverlayPrimitive['type']): boolean {
    return type === 'rect';
  }

  attach(_chart: IChartApi, series: ISeriesApi<SeriesType>): void {
    this.shapes.attachTo(series);
  }

  render(primitives: RectPrimitive[]): void {
    this.shapes.setRects(
      primitives.map((p) => ({
        from: p.from,
        to: p.to,
        top: p.top,
        bottom: p.bottom,
        color: p.color,
        label: p.label,
      })),
    );
  }

  clear(): void {
    this.shapes.setRects([]);
  }
}

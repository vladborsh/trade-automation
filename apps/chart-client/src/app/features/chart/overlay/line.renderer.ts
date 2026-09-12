import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { OverlayRenderer } from './overlay-layer';
import type { OverlayPrimitive } from '@trade-automation/contracts';
import { ShapesPrimitive } from './shapes.primitive';

type LinePrimitive = Extract<OverlayPrimitive, { type: 'line' }>;

/**
 * Thin adapter onto the shared `ShapesPrimitive` (architecture/vwap-band-reversal-plugin.md
 * §3.2): converts `line` overlay primitives (a polyline through `points`,
 * solid or dashed per the `style` field) into the primitive's shape
 * vocabulary.
 */
export class LineRenderer implements OverlayRenderer<'line'> {
  readonly type = 'line' as const;

  constructor(private readonly shapes: ShapesPrimitive) {}

  supports(type: OverlayPrimitive['type']): boolean {
    return type === 'line';
  }

  attach(_chart: IChartApi, series: ISeriesApi<SeriesType>): void {
    this.shapes.attachTo(series);
  }

  render(primitives: LinePrimitive[]): void {
    this.shapes.setLines(
      primitives.map((p) => ({
        points: p.points,
        color: p.color,
        label: p.label,
        style: p.style,
      })),
    );
  }

  clear(): void {
    this.shapes.setLines([]);
  }
}

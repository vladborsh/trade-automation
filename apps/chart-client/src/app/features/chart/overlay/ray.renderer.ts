import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { OverlayRenderer } from './overlay-layer';
import type { OverlayPrimitive } from '@trade-automation/contracts';
import { ShapesPrimitive } from './shapes.primitive';

type RayPrimitive = Extract<OverlayPrimitive, { type: 'ray' }>;

/**
 * Thin adapter onto the shared `ShapesPrimitive` (architecture/vwap-band-reversal-plugin.md
 * §3.2): converts `ray` overlay primitives (a horizontal ray from
 * (time, price) to the right edge) into the primitive's shape vocabulary.
 */
export class RayRenderer implements OverlayRenderer<'ray'> {
  readonly type = 'ray' as const;

  constructor(private readonly shapes: ShapesPrimitive) {}

  supports(type: OverlayPrimitive['type']): boolean {
    return type === 'ray';
  }

  attach(_chart: IChartApi, series: ISeriesApi<SeriesType>): void {
    this.shapes.attachTo(series);
  }

  render(primitives: RayPrimitive[]): void {
    this.shapes.setRays(
      primitives.map((p) => ({
        time: p.time,
        price: p.price,
        color: p.color,
        label: p.label,
      })),
    );
  }

  clear(): void {
    this.shapes.setRays([]);
  }
}

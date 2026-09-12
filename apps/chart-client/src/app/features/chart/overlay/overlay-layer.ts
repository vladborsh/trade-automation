import type { ISeriesApi, IChartApi, SeriesType } from 'lightweight-charts';
import type { OverlayPrimitive } from '@trade-automation/contracts';

/**
 * One renderer per `OverlayPrimitive.type` (§5.2). `attach` runs once when
 * the chart/series is ready; `render` is called with every primitive of
 * this renderer's type whenever the overlay set changes; `clear` removes
 * everything this renderer previously drew.
 */
export interface OverlayRenderer<T extends OverlayPrimitive['type'] = OverlayPrimitive['type']> {
  readonly type: T;
  supports(type: OverlayPrimitive['type']): boolean;
  attach(chart: IChartApi, series: ISeriesApi<SeriesType>): void;
  render(primitives: Extract<OverlayPrimitive, { type: T }>[]): void;
  clear(): void;
}

/**
 * Fans a flat `OverlayPrimitive[]` out to the renderer registered for each
 * `type`. Adding a new drawable (rect/ray/line already exist as stubs) is
 * "register a new renderer", not a change to this class.
 */
export class OverlayLayer {
  private readonly renderers = new Map<OverlayPrimitive['type'], OverlayRenderer>();

  register(renderer: OverlayRenderer): void {
    this.renderers.set(renderer.type, renderer);
  }

  attachAll(chart: IChartApi, series: ISeriesApi<SeriesType>): void {
    for (const renderer of this.renderers.values()) {
      renderer.attach(chart, series);
    }
  }

  render(primitives: readonly OverlayPrimitive[]): void {
    const byType = new Map<OverlayPrimitive['type'], OverlayPrimitive[]>();
    for (const primitive of primitives) {
      const bucket = byType.get(primitive.type) ?? [];
      bucket.push(primitive);
      byType.set(primitive.type, bucket);
    }
    for (const [type, renderer] of this.renderers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.render((byType.get(type) ?? []) as any);
    }
  }

  clearAll(): void {
    for (const renderer of this.renderers.values()) {
      renderer.clear();
    }
  }
}

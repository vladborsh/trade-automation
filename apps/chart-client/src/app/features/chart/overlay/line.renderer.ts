import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { OverlayRenderer } from './overlay-layer';
import type { OverlayPrimitive } from '../../../core/contracts/contracts';

type LinePrimitive = Extract<OverlayPrimitive, { type: 'line' }>;

/**
 * Deferred per architecture/live-signal-server.md §5.2/§3.4: type-complete
 * so `Signal.overlay` can carry `line` primitives (VWAP, bands) from day
 * one, but rendering (an additional line series, or a plugin-drawn
 * polyline) is not implemented yet — no strategy needs it in this
 * scaffold. Warns once per render call and skips instead of throwing.
 */
export class LineRenderer implements OverlayRenderer<'line'> {
  readonly type = 'line' as const;

  supports(type: OverlayPrimitive['type']): boolean {
    return type === 'line';
  }

  attach(_chart: IChartApi, _series: ISeriesApi<SeriesType>): void {
    // no-op: nothing to attach until this renderer is implemented
  }

  render(primitives: LinePrimitive[]): void {
    if (primitives.length > 0) {
      console.warn(`[OverlayLayer] 'line' overlay renderer is not implemented yet; skipping ${primitives.length} primitive(s).`);
    }
  }

  clear(): void {
    // no-op: nothing was ever drawn
  }
}

import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { OverlayRenderer } from './overlay-layer';
import type { OverlayPrimitive } from '../../../core/contracts/contracts';

type RectPrimitive = Extract<OverlayPrimitive, { type: 'rect' }>;

/**
 * Deferred per architecture/live-signal-server.md §5.2/§3.4: type-complete
 * so `Signal.overlay` can carry `rect` primitives (FVG/iFVG boxes, ranges)
 * from day one, but rendering via lightweight-charts' series-primitives/
 * plugin API is not implemented yet — no strategy needs it in this
 * scaffold. Warns once per render call and skips instead of throwing.
 */
export class RectRenderer implements OverlayRenderer<'rect'> {
  readonly type = 'rect' as const;

  supports(type: OverlayPrimitive['type']): boolean {
    return type === 'rect';
  }

  attach(_chart: IChartApi, _series: ISeriesApi<SeriesType>): void {
    // no-op: nothing to attach until this renderer is implemented
  }

  render(primitives: RectPrimitive[]): void {
    if (primitives.length > 0) {
      console.warn(`[OverlayLayer] 'rect' overlay renderer is not implemented yet; skipping ${primitives.length} primitive(s).`);
    }
  }

  clear(): void {
    // no-op: nothing was ever drawn
  }
}

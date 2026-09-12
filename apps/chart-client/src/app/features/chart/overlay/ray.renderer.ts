import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { OverlayRenderer } from './overlay-layer';
import type { OverlayPrimitive } from '../../../core/contracts/contracts';

type RayPrimitive = Extract<OverlayPrimitive, { type: 'ray' }>;

/**
 * Deferred per architecture/live-signal-server.md §5.2/§3.4: type-complete
 * so `Signal.overlay` can carry `ray` primitives (the bot's true-open
 * levels — a horizontal ray from (time, price) rightwards) from day one,
 * but rendering via the series-primitives/plugin API is not implemented
 * yet. Warns once per render call and skips instead of throwing.
 */
export class RayRenderer implements OverlayRenderer<'ray'> {
  readonly type = 'ray' as const;

  supports(type: OverlayPrimitive['type']): boolean {
    return type === 'ray';
  }

  attach(_chart: IChartApi, _series: ISeriesApi<SeriesType>): void {
    // no-op: nothing to attach until this renderer is implemented
  }

  render(primitives: RayPrimitive[]): void {
    if (primitives.length > 0) {
      console.warn(`[OverlayLayer] 'ray' overlay renderer is not implemented yet; skipping ${primitives.length} primitive(s).`);
    }
  }

  clear(): void {
    // no-op: nothing was ever drawn
  }
}

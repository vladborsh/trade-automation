import {
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesMarkerBarPosition,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { OverlayRenderer } from './overlay-layer';
import type { OverlayPrimitive } from '@trade-automation/contracts';

type MarkerPrimitive = Extract<OverlayPrimitive, { type: 'marker' }>;

const POSITION_MAP: Record<MarkerPrimitive['position'], SeriesMarkerBarPosition> = {
  above: 'aboveBar',
  below: 'belowBar',
};

export class MarkerRenderer implements OverlayRenderer<'marker'> {
  readonly type = 'marker' as const;
  private plugin: ISeriesMarkersPluginApi<Time> | null = null;

  supports(type: OverlayPrimitive['type']): boolean {
    return type === 'marker';
  }

  attach(_chart: IChartApi, series: ISeriesApi<SeriesType>): void {
    this.plugin = createSeriesMarkers(series, []);
  }

  render(primitives: MarkerPrimitive[]): void {
    if (!this.plugin) {
      return;
    }
    const markers: SeriesMarker<Time>[] = primitives
      .slice()
      .sort((a, b) => a.time - b.time)
      .map((p) => ({
        time: Math.floor(p.time / 1000) as UTCTimestamp,
        position: POSITION_MAP[p.position],
        shape: p.shape,
        color: p.color ?? '#2196f3',
        text: p.text,
      }));
    this.plugin.setMarkers(markers);
  }

  clear(): void {
    this.plugin?.setMarkers([]);
  }
}

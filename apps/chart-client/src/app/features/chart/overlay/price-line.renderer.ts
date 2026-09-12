import type { IChartApi, IPriceLine, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { OverlayRenderer } from './overlay-layer';
import type { OverlayPrimitive } from '@trade-automation/contracts';

type PriceLinePrimitive = Extract<OverlayPrimitive, { type: 'priceLine' }>;

export class PriceLineRenderer implements OverlayRenderer<'priceLine'> {
  readonly type = 'priceLine' as const;
  private series: ISeriesApi<SeriesType> | null = null;
  private lines: IPriceLine[] = [];

  supports(type: OverlayPrimitive['type']): boolean {
    return type === 'priceLine';
  }

  attach(_chart: IChartApi, series: ISeriesApi<SeriesType>): void {
    this.series = series;
  }

  render(primitives: PriceLinePrimitive[]): void {
    this.clear();
    if (!this.series) {
      return;
    }
    for (const p of primitives) {
      this.lines.push(
        this.series.createPriceLine({
          price: p.price,
          color: p.color ?? '#787b86',
          lineStyle: p.style === 'dashed' ? 2 : 0,
          lineWidth: 1,
          axisLabelVisible: true,
          title: p.label ?? '',
        }),
      );
    }
  }

  clear(): void {
    if (this.series) {
      for (const line of this.lines) {
        this.series.removePriceLine(line);
      }
    }
    this.lines = [];
  }
}

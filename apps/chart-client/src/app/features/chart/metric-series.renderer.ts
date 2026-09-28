import { CandlestickSeries, LineSeries, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { MetricPoint, Timeframe } from '@trade-automation/contracts';
import { toMetricCandleData, toMetricLineData } from './chart-data.adapter';
import { formatCompact } from './compact-number.format';
import { METRIC_DOWN_COLOR, METRIC_UP_COLOR, metricSeriesStyle, type MetricSeriesStyle } from './metric-series-style';

export type MetricSeriesApi = ISeriesApi<'Line'> | ISeriesApi<'Candlestick'>;

type Drawn = { style: 'line'; series: ISeriesApi<'Line'> } | { style: 'candles'; series: ISeriesApi<'Candlestick'> };

const PRICE_FORMAT = { type: 'custom' as const, formatter: formatCompact, minMove: 1 };

/**
 * architecture/chart-layouts.md §11.2 — owns a metric panel's one series: a `LineSeries` or a
 * `CandlestickSeries` per `metricSeriesStyle`, swapped in place when the style changes (the
 * panel is not recreated on a timeframe change), plotting the USD notional side of each point.
 * Kept out of `ChartComponent`, which only forwards points and asks for the current series.
 */
export class MetricSeriesRenderer {
  private chart: IChartApi | null = null;
  private drawn: Drawn | null = null;
  /**
   * Which chart pane the series lives in. Defaults to 0, which is what every backtest call site
   * has always got — the backtest panel gives each metric its own chart, so pane 0 is the only
   * pane there. IB-031 draws price and open interest on ONE chart, where OI must have its own
   * pane or its notional (10^9) flattens the candles (10^4) into a line. Generalised in place
   * rather than forked, the same way IB-030 generalised `ApiError`.
   */
  private pane = 0;

  get series(): MetricSeriesApi | null {
    return this.drawn?.series ?? null;
  }

  attach(chart: IChartApi, tf: Timeframe, pane = 0): MetricSeriesApi {
    this.chart = chart;
    this.pane = pane;
    this.drawn = this.create(chart, metricSeriesStyle(tf));
    return this.drawn.series;
  }

  /** Swaps the series if `tf` draws in another style. Returns true on a swap — the caller must `setData` again. */
  setTimeframe(tf: Timeframe): boolean {
    const style = metricSeriesStyle(tf);
    if (!this.chart || !this.drawn || this.drawn.style === style) {
      return false;
    }
    this.chart.removeSeries(this.drawn.series);
    this.drawn = this.create(this.chart, style);
    return true;
  }

  setData(points: readonly MetricPoint[]): void {
    if (this.drawn?.style === 'line') {
      this.drawn.series.setData(points.map(toMetricLineData));
    } else if (this.drawn?.style === 'candles') {
      this.drawn.series.setData(points.map(toMetricCandleData));
    }
  }

  update(point: MetricPoint): void {
    if (this.drawn?.style === 'line') {
      this.drawn.series.update(toMetricLineData(point));
    } else if (this.drawn?.style === 'candles') {
      this.drawn.series.update(toMetricCandleData(point));
    }
  }

  private create(chart: IChartApi, style: MetricSeriesStyle): Drawn {
    if (style === 'line') {
      return {
        style,
        series: chart.addSeries(LineSeries, {
          color: METRIC_UP_COLOR,
          lineWidth: 2,
          lastValueVisible: true,
          priceFormat: PRICE_FORMAT,
        }, this.pane),
      };
    }
    return {
      style,
      series: chart.addSeries(CandlestickSeries, {
        upColor: METRIC_UP_COLOR,
        downColor: METRIC_DOWN_COLOR,
        borderVisible: false,
        wickUpColor: METRIC_UP_COLOR,
        wickDownColor: METRIC_DOWN_COLOR,
        priceFormat: PRICE_FORMAT,
      }, this.pane),
    };
  }
}

import { ColorType, type CandlestickSeriesPartialOptions, type DeepPartial, type TimeChartOptions } from 'lightweight-charts';

/** The chart's options — moved out of `ChartComponent.ngAfterViewInit` unchanged. */
export const CHART_OPTIONS: DeepPartial<TimeChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: '#0d1117' },
    textColor: '#c9d1d9',
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
  },
  grid: {
    vertLines: { color: '#161b22' },
    horzLines: { color: '#161b22' },
  },
  timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#30363d' },
  rightPriceScale: { borderColor: '#30363d' },
  crosshair: { mode: 0 },
  autoSize: true,
};

/** The candlestick series' options — moved out of `ChartComponent.ngAfterViewInit` unchanged. */
export const CANDLE_SERIES_OPTIONS: CandlestickSeriesPartialOptions = {
  upColor: '#26a69a',
  downColor: '#ef5350',
  borderVisible: false,
  wickUpColor: '#26a69a',
  wickDownColor: '#ef5350',
};

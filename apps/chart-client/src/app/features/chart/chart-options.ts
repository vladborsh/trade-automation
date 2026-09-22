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

/**
 * T-063: the chart's options with a right margin of `rightMarginPx` pixels (lightweight-charts keeps it
 * constant in pixels across zoom), so a tool drawn at the newest bar has room without panning. `0` (the
 * live terminal) is `CHART_OPTIONS` unchanged.
 */
export function chartOptions(rightMarginPx: number): DeepPartial<TimeChartOptions> {
  if (rightMarginPx <= 0) return CHART_OPTIONS;
  return { ...CHART_OPTIONS, timeScale: { ...CHART_OPTIONS.timeScale, rightOffsetPixels: rightMarginPx } };
}

/** The candlestick series' options — moved out of `ChartComponent.ngAfterViewInit` unchanged. */
export const CANDLE_SERIES_OPTIONS: CandlestickSeriesPartialOptions = {
  upColor: '#26a69a',
  downColor: '#ef5350',
  borderVisible: false,
  wickUpColor: '#26a69a',
  wickDownColor: '#ef5350',
};

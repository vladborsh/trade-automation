import { ColorType, type CandlestickSeriesPartialOptions, type DeepPartial, type ChartOptions } from 'lightweight-charts';

/**
 * The dark-terminal theme every panel's chart is created with (AGENTS.md palette), and the price
 * candle colours. Moved out of `chart.component.ts` unchanged (it was over the 250-line ceiling).
 */
export const CHART_OPTIONS: DeepPartial<ChartOptions> = {
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

export const PRICE_CANDLE_OPTIONS: CandlestickSeriesPartialOptions = {
  upColor: '#26a69a',
  downColor: '#ef5350',
  borderVisible: false,
  wickUpColor: '#26a69a',
  wickDownColor: '#ef5350',
};

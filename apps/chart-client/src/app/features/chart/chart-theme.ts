import { ColorType, type CandlestickSeriesPartialOptions, type DeepPartial, type ChartOptions } from 'lightweight-charts';
import { nyTickMarkFormatter, nyTimeFormatter } from './ny-time';

/**
 * The single source of chart colours (architecture/chart-layouts.md §12.1, AGENTS.md rule 4).
 * Up = white, down = blue — price candles and OI candles alike (`metric-series-style.ts`).
 */
export const CHART_PALETTE = {
  up: '#ffffff',
  down: '#2962ff',
  bg: '#0d1117',
  border: '#30363d',
  text: '#c9d1d9',
  muted: '#8b949e',
  separator: '#8b949e',
} as const;

/**
 * The dark-terminal theme every panel's chart is created with, and the price candle colours.
 * Moved out of `chart.component.ts` (it was over the 250-line ceiling); grid off on every panel.
 */
export const CHART_OPTIONS: DeepPartial<ChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: CHART_PALETTE.bg },
    textColor: CHART_PALETTE.text,
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
  },
  grid: {
    vertLines: { visible: false },
    horzLines: { visible: false },
  },
  // §12.2: axis and crosshair show New York wall-clock; the data stays real UTC.
  localization: { timeFormatter: nyTimeFormatter },
  timeScale: { timeVisible: true, secondsVisible: false, borderColor: CHART_PALETTE.border, tickMarkFormatter: nyTickMarkFormatter() },
  rightPriceScale: { borderColor: CHART_PALETTE.border },
  crosshair: { mode: 0 },
  autoSize: true,
};

export const PRICE_CANDLE_OPTIONS: CandlestickSeriesPartialOptions = {
  upColor: CHART_PALETTE.up,
  downColor: CHART_PALETTE.down,
  borderVisible: true,
  borderUpColor: CHART_PALETTE.up,
  borderDownColor: CHART_PALETTE.down,
  wickUpColor: CHART_PALETTE.up,
  wickDownColor: CHART_PALETTE.down,
};

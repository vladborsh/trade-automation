import { CandleChartData } from '../../interfaces/charts/candlestick-chart-data';

export function ATR(candles: CandleChartData[], length: number): number[] {
  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const highLow = candles[i].high - candles[i].low;
    const highClose = Math.abs(candles[i].high - candles[i - 1].close);
    const lowClose = Math.abs(candles[i].low - candles[i - 1].close);
    const trueRange = Math.max(highLow, highClose, lowClose);
    trueRanges.push(trueRange);
  }

  const atr: number[] = [];
  for (let i = length; i < candles.length; i++) {
    const atrValue = trueRanges.slice(i - length, i).reduce((a, b) => a + b, 0) / length;
    atr.push(atrValue);
  }

  return atr;
}

import { CandleChartData } from "../../interfaces/charts/candlestick-chart-data";

export function range(candles: CandleChartData[], length: number): { top: number[], bottom: number[], priceInDiscount: boolean } {
  const priceWindow = candles.slice(0, length);
  const top: number[] = [];
  const bottom: number[] = [];

  for (let barIndex = length; barIndex <= candles.length - 1; barIndex++) {
    const currentTop = Math.max(...priceWindow.map(candle => candle.high));
    const currentBottom = Math.min(...priceWindow.map(candle => candle.low));

    top.push(currentTop);
    bottom.push(currentBottom);

    priceWindow.push(candles[barIndex]);
    priceWindow.shift();
  }

  const lastTop = top[top.length - 1];
  const lastBottom = bottom[bottom.length - 1];
  const middle = (lastTop + lastBottom) / 2;
  const priceInDiscount = candles[candles.length - 1].close < middle;

  return { top, bottom, priceInDiscount };
}

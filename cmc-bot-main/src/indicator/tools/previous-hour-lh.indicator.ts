import { add, isWithinInterval } from "date-fns";
import { CandleChartData } from "../../interfaces/charts/candlestick-chart-data";

export interface PreviousHourLHResponse {
  low: { y: number, x: number },
  high: { y: number, x: number },
}

export function previousHourLH(
  candles: CandleChartData[],
): PreviousHourLHResponse| void {
  const latestCandle = candles[candles.length - 1];
  const targetHour = add(latestCandle.openTime, { hours: -1 });
  const targetHourStart = targetHour.setMinutes(0);
  const targetHourEnd = targetHour.setMinutes(59);

  let hourMin: { y: number, x: number } | null = null;
  let hourMax: { y: number, x: number } | null = null;

  for (let i = 0; i < candles.length - 1; i++) {
    if (isWithinInterval(candles[i].openTime, { start: targetHourStart, end: targetHourEnd })) {
      if (hourMin === null || candles[i].low < hourMin.y) {
        hourMin = {
          y: candles[i].low,
          x: i,
        };
      }
      if (hourMax === null || candles[i].high > hourMax.y) {
        hourMax = {
          y: candles[i].high,
          x: i,
        };
      }
    }
  }

  if (hourMin && hourMax) {
    return {
      low: hourMin,
      high: hourMax,
    }
  }
}

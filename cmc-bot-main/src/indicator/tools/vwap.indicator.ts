import { differenceInMinutes, startOfDay } from "date-fns";
import { CandleChartData } from "../../interfaces/charts/candlestick-chart-data";

export function VWAP(candles: CandleChartData[]): { vwap: number[], vwapTop: number[], vwapBottom: number[] } {
  const vwap: number[] = [];
  const deviations: number[] = [];
  const stdDevsTop: number[] = [];
  const stdDevsBottom: number[] = [];
  let cumulativeVolume = 0;
  let cumulativeValue = 0;
  let currentDayStartTime = startOfDay(new Date(candles[0].openTime)); // Start of the first day

  candles.forEach((candle) => {
    // Check if we're still on the same day
    const currentCandleTime = new Date(candle.openTime);
    if (startOfDay(currentCandleTime).getTime() !== currentDayStartTime.getTime()) {
      // Reset for new day
      currentDayStartTime = startOfDay(currentCandleTime);
      cumulativeVolume = 0;
      cumulativeValue = 0;
      deviations.length = 0;
    }

    cumulativeVolume += candle.volume;
    cumulativeValue += candle.close * candle.volume;

    const currentVWAP = cumulativeValue / cumulativeVolume;
    vwap.push(currentVWAP);

    const deviation = candle.close - currentVWAP;
    deviations.push(deviation);

    // Calculate standard deviation based on the distance from the start of the day
    const distanceFromStartOfDay = differenceInMinutes(currentCandleTime, currentDayStartTime);
    const slice = deviations.slice(Math.max(0, deviations.length - distanceFromStartOfDay));

    const meanDeviation = slice.reduce((acc, val) => acc + val, 0) / slice.length;
    const variance = slice.reduce((acc, val) => acc + Math.pow(val - meanDeviation, 2), 0) / slice.length;
    const stdDev = Math.sqrt(variance);

    stdDevsTop.push(currentVWAP + stdDev);
    stdDevsBottom.push(currentVWAP - stdDev);
  });

  return { vwap, vwapTop: stdDevsTop, vwapBottom: stdDevsBottom };
}

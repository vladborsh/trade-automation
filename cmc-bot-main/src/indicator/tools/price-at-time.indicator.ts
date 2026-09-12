import { isWithinInterval } from 'date-fns';
import { CandleChartData } from '../../interfaces/charts/candlestick-chart-data';
import { getTargetTimeFromNYTime } from './date-helpers';

export function priceAtTime(
  candles: CandleChartData[],
  targetHour: number,
  targetMinute: number
): { y: number, x: number } | void {
  const latestCandle = candles[candles.length - 1];
  const targetTime = getTargetTimeFromNYTime(latestCandle.openTime, targetHour, targetMinute);

  for (let i = 1; i < candles.length - 1; i++) {
    if (isWithinInterval(targetTime, { start: candles[i - 1].openTime, end: candles[i].openTime })) {
      return {
        y: candles[i].open,
        x: i,
      };
    }
  }
}

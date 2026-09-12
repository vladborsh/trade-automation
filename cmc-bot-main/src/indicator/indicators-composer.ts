import { CandleChartData } from '../interfaces/charts/candlestick-chart-data';
import { Indicator } from '../interfaces/indicator.interface';
import { IndicatorMap } from '../types/types';

export function composeIndicators<T extends readonly Indicator[]>(
  inds: T,
  chartData: CandleChartData[],
): IndicatorMap<T> {
  const result = {} as IndicatorMap<T>;

  inds.forEach((ind) => {
    // Temporarily cast to `any` for assignment
    (result as any)[ind.code] = ind.calculate(chartData);
  });

  return result;
}

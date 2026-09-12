import { CandleChartData } from "./charts/candlestick-chart-data";

export interface Indicator<T = any, R = any> {
  code: string;
  calculate: (chartData: CandleChartData[], ...params: any[]) => R;
}

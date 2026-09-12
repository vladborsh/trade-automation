import { Observable } from "rxjs";
import { GeneralTimeIntervals } from "../types/enums";
import { CandleChartData } from "./charts/candlestick-chart-data";

export interface IExchangeClient {
  init(): Promise<void>;
  getCandles(
    asset: string,
    interval: GeneralTimeIntervals,
    startTime?: number,
    endTime?: number): Promise<CandleChartData[]>;
  getCandlesStream(
    asset: string,
    interval: GeneralTimeIntervals): Observable<CandleChartData[]>;
}

import { GeneralTimeIntervals } from "../types/enums";
import { CandleChartData } from "../interfaces/charts/candlestick-chart-data";
import { IExchangeClient } from "../interfaces/exchange-client.interface";
import fs from 'fs';
import { Observable } from "rxjs";
import { intervalsToMillisecondsConfig } from "./data-scrapper.config";
import { findKey } from "lodash";

export class StaticDataSource implements IExchangeClient {
  storedCandles = new Map<GeneralTimeIntervals, CandleChartData[]>();

  constructor(private fileNames: string[]) {}

  async init(): Promise<void> {
    for (const fileName of this.fileNames) {
      const data = fs.readFileSync(fileName, 'utf8');
      try {
        const candles = JSON.parse(data);
        const openTimeDiff = candles[1].openTime - candles[0].openTime;

        const interval: string | undefined = findKey(intervalsToMillisecondsConfig, (value) => value === openTimeDiff);
        if (!interval) {
          throw new Error(`Invalid interval: ${openTimeDiff}`);
        }
        this.storedCandles.set(interval as GeneralTimeIntervals, candles);
      } catch (e) {
        throw new Error(`Error while parsing file ${fileName}: ${e}`);
      }
    }
  }

  async getCandles(
    asset: string,
    interval: GeneralTimeIntervals,
    startTime: number,
    endTime: number
  ): Promise<CandleChartData[]> {
    const candles = this.storedCandles.get(interval);

    if (!candles) {
      throw new Error(`Candles for ${interval} not found`);
    }

    return candles.filter((candle) => candle.openTime >= startTime && candle.openTime <= endTime);
  }

  getCandlesStream(
    asset: string,
    interval: GeneralTimeIntervals
  ): Observable<CandleChartData[]> {
    throw new Error('Method not implemented.');
  }
}

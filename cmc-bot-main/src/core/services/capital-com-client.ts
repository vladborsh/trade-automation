import { EnvConfig } from '../../env-config';
import axios, { AxiosError, AxiosResponse } from 'axios';
import { CapComMarketData } from '../../interfaces/capital-com.interfaces';
import { CandleChartData } from '../../interfaces/charts/candlestick-chart-data';
import { GeneralTimeIntervals } from '../../types/enums';
import { IExchangeClient } from '../../interfaces/exchange-client.interface';
import { Observable } from 'rxjs';
import { mapGeneralTimeIntervalToCapCom } from './configs/capital-com-client.config';
import { CapitalComMarketMarketData } from './configs/capital-com-market-data.interface';
import { mapMarketDataToChartData } from './configs/capital-com.helpers';
import { CapitalComSession } from './capital-com-session';
import { add, differenceInMinutes, format } from 'date-fns';
import { injectable } from 'inversify';

@injectable()
export class CapitalComClient implements IExchangeClient {
  private streams: Record<string, Observable<CandleChartData[]>> = {};

  constructor(
    private envConfig: EnvConfig,
    private capitalComSession: CapitalComSession
  ) {
    setInterval(async () => await capitalComSession.checkAndRenewSession(), 11111);
  }

  public async init(): Promise<void> {
    await this.capitalComSession.renewSession();
  }

  public async getCandles(
    symbol: string,
    interval: GeneralTimeIntervals,
    startTime: number,
    endTime: number
  ): Promise<CandleChartData[]> {
    const diffInMinutes = differenceInMinutes(endTime, startTime);

    if (diffInMinutes <= 720) {
      return await this.realRequest(symbol, interval, startTime, endTime)
    }

    const result: CandleChartData[] = [];
    let startTime_ = new Date(startTime);
    let endTime_ = add(startTime_, { minutes: 720 });

    do {
      result.push(...await this.realRequest(symbol, interval, startTime_.getTime(), endTime_.getTime()));

      startTime_ = endTime_;
      endTime_ = add(endTime_, { minutes: 720 });
      if (endTime_ > new Date(endTime)) {
        result.push(...await this.realRequest(symbol, interval, startTime_.getTime(), new Date(endTime).getTime()));
      }
    } while (endTime_ <= new Date(endTime));
    return result;
  }

  private async realRequest(
    symbol: string,
    interval: GeneralTimeIntervals,
    startTime: number,
    endTime: number
  ): Promise<CandleChartData[]> {
    const marketResponse: AxiosResponse<CapComMarketData> = await axios.get(
      `${this.envConfig.CAPITAL_COM_URL}api/v1/prices/${symbol}`,
      {
        headers: {
          'X-SECURITY-TOKEN': this.capitalComSession.session$.getValue().X_SECURITY_TOKEN,
          CST: this.capitalComSession.session$.getValue().CST,
        },
        params: {
          resolution: mapGeneralTimeIntervalToCapCom[interval],
          max: 720,
          from: this.convertTime(startTime),
          to: this.convertTime(endTime),
        },
      }
    );

    return mapMarketDataToChartData(marketResponse.data);
  }

  private convertTime(milliseconds: number): string {
    return new Date(milliseconds).toISOString().split('.')[0];
  }

  public getCandlesStream(
    asset: string,
    interval: GeneralTimeIntervals
  ): Observable<CandleChartData[]> {
    return this.start(asset, interval);
  }

  public async getMarketData(): Promise<CapitalComMarketMarketData> {
    if (!this.capitalComSession.session$.getValue()) {
      throw new Error('Capital.com session was not started');
    }

    const response: AxiosResponse<CapitalComMarketMarketData> = await axios.get(
      `${this.envConfig.CAPITAL_COM_URL}api/v1/marketnavigation`,
      {
        headers: {
          'X-SECURITY-TOKEN': this.capitalComSession.session$.getValue().X_SECURITY_TOKEN,
          CST: this.capitalComSession.session$.getValue().CST,
        },
      }
    );

    return response.data;
  }

  public async getMarketSearch(search: string): Promise<any> {
    if (!this.capitalComSession.session$.getValue()) {
      throw new Error('Capital.com session was not started');
    }

    const response: AxiosResponse<any> = await axios.get(
      `${this.envConfig.CAPITAL_COM_URL}api/v1/markets?searchTerm=${search}`,
      {
        headers: {
          'X-SECURITY-TOKEN': this.capitalComSession.session$.getValue().X_SECURITY_TOKEN,
          CST: this.capitalComSession.session$.getValue().CST,
        },
      }
    );

    return response.data;
  }

  public start(symbol: string, timeInterval: GeneralTimeIntervals): Observable<CandleChartData[]> {
    if (this.streams[this.getKey(symbol, timeInterval)]) {
      return this.streams[this.getKey(symbol, timeInterval)];
    }

    const newStream = new Observable<CandleChartData[]>(observer => {
      const intervalMilliseconds = this.calculateInterval(timeInterval);
      let isSubscribed = true;
      let initialTimeoutId: NodeJS.Timeout;
      let nextEmissionTimeoutId: NodeJS.Timeout;
      let lastCandle: CandleChartData | undefined;

      const emitCandleData = async () => {
        try {
          const candles = [];
        } catch (e) {
          let err = e as AxiosError;
          observer.error(err.message ? err.message : err);
        }
      };

      const scheduleNextEmission = async () => {
        if (!isSubscribed) return;
        const timeToNextInterval = this.calculateTimeToNextInterval(intervalMilliseconds);
        await new Promise(
          resolve => (nextEmissionTimeoutId = setTimeout(resolve, timeToNextInterval))
        );
        await emitCandleData();
      };

      initialTimeoutId = setTimeout(async () => {
        await emitCandleData();
        while (isSubscribed) {
          await scheduleNextEmission();
        }
      }, this.calculateTimeToNextInterval(intervalMilliseconds));

      return () => {
        isSubscribed = false;
        clearTimeout(nextEmissionTimeoutId);
        clearTimeout(initialTimeoutId);
      };
    });

    this.streams[this.getKey(symbol, timeInterval)] = newStream;

    return newStream;
  }

  private calculateInterval(timeInterval: GeneralTimeIntervals): number {
    const unit = timeInterval[0];
    const value = parseInt(timeInterval.slice(1));

    switch (unit) {
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      default:
        throw value * 60 * 1000;
    }
  }

  private calculateTimeToNextInterval(intervalMilliseconds: number): number {
    const dateNow = Date.now();
    const msFromHourStart = dateNow % (60 * 60 * 1000);
    const msFromIntervalStart = msFromHourStart % intervalMilliseconds;
    const timeToNextInterval = intervalMilliseconds - msFromIntervalStart;

    return timeToNextInterval;
  }

  private getKey(symbol: string, interval: string): string {
    return `${symbol}:${interval}`;
  }
}

import Binance, {
  Binance as BinanceConnect,
  ExchangeInfo,
  CandleChartResult,
  Symbol,
  Candle,
  CandleChartInterval_LT,
} from 'binance-api-node';
import { EnvConfig } from '../../env-config';
import { CandleChartData } from '../../interfaces/charts/candlestick-chart-data';
import { Observable, Observer, from } from 'rxjs';
import { timeIntervalBinanceToMillis } from './exchange-helpers';
import { IExchangeClient } from '../../interfaces/exchange-client.interface';
import { GeneralTimeIntervals } from '../../types/enums';
import { mapGeneralTimeIntervalToBinance } from './configs/binance-client.config';
import { DynamicConfig } from '../../utils/dynamic-config';
import { injectable } from 'inversify';

@injectable()
export class BinanceClient implements IExchangeClient {
  client: BinanceConnect;
  exchangeInfo: ExchangeInfo | undefined;
  historyCandles: Record<string, CandleChartData[]> = {};

  constructor(envConfig: EnvConfig, private dynamicConfig: DynamicConfig) {
    this.client = Binance({
      apiKey: envConfig.BINANCE_API_KEY,
      apiSecret: envConfig.BINANCE_API_KEY,
    });
  }

  async init() {
    this.exchangeInfo = await this.client.exchangeInfo();
  }

  public async getCandles(
    asset: string,
    interval: GeneralTimeIntervals,
    startTime?: number,
    endTime?: number,
  ): Promise<CandleChartData[]> {
    const rawCandles = await this.client.futuresCandles({
      symbol: asset,
      interval: mapGeneralTimeIntervalToBinance[interval],
      limit: 720,
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
    });

    return BinanceClient.mapCandleChartResult(rawCandles);
  }

  public getCandlesStream(
    asset: string,
    interval: GeneralTimeIntervals
  ): Observable<CandleChartData[]> {
    return new Observable((observer: Observer<CandleChartData[]>) => {
      const clean = this.client.ws.candles(asset, mapGeneralTimeIntervalToBinance[interval], (candle) => {
        if (candle.isFinal) {
          const lastCandle = BinanceClient.mapCandle(candle, mapGeneralTimeIntervalToBinance[interval]);

          from(this.getCachedHistoryCandles(asset, interval))
            .subscribe(historyCandles => {
              observer.next([...historyCandles, lastCandle]);
              historyCandles.push(lastCandle);
              historyCandles.shift();
            });
        }
      });

      return () => clean();
    });
  }

  public async isSymbolExists(symbolToCheck: string): Promise<boolean> {
    if (!this.exchangeInfo) {
      throw new Error('client is not initialized. call "init" before');
    }

    return this.exchangeInfo.symbols.some(
      (symbolInfo: Symbol) => symbolInfo.symbol === symbolToCheck
    );
  }

  private async getCachedHistoryCandles(symbol: string, interval: GeneralTimeIntervals) {
    if (!this.historyCandles[this.getKey(symbol, interval)]) {
      const dynamicConfigValues = await this.dynamicConfig.getConfig();

      const historyCandles = await this.getCandles(
        symbol,
        interval,
        dynamicConfigValues.CHART_HISTORY_SIZE
      );
      /* last candles is unfinished */
      historyCandles.pop();
      historyCandles.pop();
      this.historyCandles[this.getKey(symbol, interval)] = historyCandles;
    }

    return this.historyCandles[this.getKey(symbol, interval)];
  }

  private static mapCandleChartResult(chartResult: CandleChartResult[]): CandleChartData[] {
    return chartResult.map<CandleChartData>((kline) => ({
      open: parseFloat(kline.open),
      close: parseFloat(kline.close),
      high: parseFloat(kline.high),
      low: parseFloat(kline.low),
      openTime: kline.openTime,
      closeTime: kline.closeTime,
      volume: parseFloat(kline.volume),
    }));
  }

  private static mapCandle(candle: Candle, interval: CandleChartInterval_LT): CandleChartData {
    return {
      open: parseFloat(candle.open),
      close: parseFloat(candle.close),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      openTime: Date.now() - timeIntervalBinanceToMillis(interval),
      volume: parseFloat(candle.volume),
    };
  }

  private getKey(symbol: string, interval: GeneralTimeIntervals): string {
    return `${symbol}:${interval}`;
  }
}

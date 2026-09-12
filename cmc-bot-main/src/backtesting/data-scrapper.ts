import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs';
import { add, format, getDay, isWeekend } from 'date-fns';
import { EnvConfig } from '../env-config';
import { DynamicConfig } from '../utils/dynamic-config';
import { getExchangeClient } from './backtest-helpers';
import { GeneralTimeIntervals } from '../types/enums';
import { CandleChartData } from '../interfaces/charts/candlestick-chart-data';
import { dataScrapperIntervalStepConfig } from './data-scrapper.config';
import { IExchangeClient } from '../interfaces/exchange-client.interface';
import { adjustEndTime, getNextValidTime, isTradingHour } from './data-scrapper.helper';
import { request } from 'http';

export class DataScrapper {
  aggregatedData: CandleChartData[] = [];

  constructor(
    private startDate: Date,
    private endDate: Date,
    private interval: GeneralTimeIntervals
  ) {}

  public async scrap(symbol: string, isForex = false): Promise<void> {
    console.log(
      chalk.yellow(
        `Scrapping data from ${this.startDate.toUTCString()} to ${this.endDate.toUTCString()} for ${symbol}`
      )
    );

    const { exchangeClient } = await this.init(symbol);

    this.aggregatedData = [];

    if (isForex) {
      await this.runMainLoopForex(symbol, exchangeClient);
    } else {
      await this.runMainLoop(symbol, exchangeClient);
    }
    this.saveData(symbol);

    process.exit(0);
  }

  private async init(symbol: string) {
    dotenv.config();
    const envConfig = EnvConfig.getInstance();
    const dynamicConfig = DynamicConfig.getInstance(envConfig);
    const exchangeClient = await getExchangeClient(envConfig, dynamicConfig, symbol);

    console.log(chalk.yellow(`Init complete`));
    return { exchangeClient };
  }

  private async runMainLoopForex(symbol: string, exchangeClient: IExchangeClient) {
    let time = getNextValidTime(this.startDate);

    while (time <= this.endDate) {
      if (!isTradingHour(time) || isWeekend(time)) {
        time = getNextValidTime(time);
        continue;
      }

      let duration = dataScrapperIntervalStepConfig[this.interval];
      let requestEndTime = adjustEndTime(time, duration);

      if (
        time.getUTCDate() === requestEndTime.getUTCDate() &&
        time.getUTCHours() === requestEndTime.getUTCHours() &&
        time.getUTCMinutes() === requestEndTime.getUTCMinutes()
      ) {
        console.log('End time is the same as the start time, moving to next day');
        time = new Date(time);
        time.setUTCDate(time.getUTCDate() + 1);
        continue;
      }

      console.log(`Scrapping data ${time.toUTCString()} - ${requestEndTime.toUTCString()}`);

      try {
        const candles = await exchangeClient.getCandles(
          symbol,
          this.interval,
          time.getTime(),
          requestEndTime.getTime()
        );
        if (candles.length > 0) {
          console.log(
            `data: from ${new Date(candles[0].openTime).toUTCString()} to ${new Date(candles[candles.length - 1].openTime).toUTCString()}`
          );
          this.aggregatedData.push(...candles);

          const fetchedStartTime = new Date(candles[0].openTime);
          const fetchedEndTime = new Date(candles[candles.length - 1].openTime);
          if (
            fetchedStartTime.getUTCDate() === fetchedEndTime.getUTCDate() &&
            fetchedStartTime.getUTCHours() === fetchedEndTime.getUTCHours() &&
            fetchedStartTime.getUTCMinutes() === fetchedEndTime.getUTCMinutes()
          ) {
            console.log('End time is the same as the start time, moving to next day');
            time = new Date(time);
            time.setUTCDate(time.getUTCDate() + 1);
            continue;
          }

          time = new Date(candles[candles.length - 1].openTime);
        } else {
          // Move to next valid time if no candles are returned
          time = getNextValidTime(add(time, dataScrapperIntervalStepConfig[this.interval]));
        }
      } catch (e) {
        console.log(chalk.red(`Error while scrapping data ${e}`));
        time = getNextValidTime(add(time, dataScrapperIntervalStepConfig[this.interval]));
      }
    }
  }

  private async runMainLoop(symbol: string, exchangeClient: IExchangeClient) {
    let time = this.startDate;

    while (time <= this.endDate) {
      let requestEndTime = add(time, dataScrapperIntervalStepConfig[this.interval]);

      console.log(`Scrapping data ${time.toUTCString()} - ${requestEndTime.toUTCString()}`);

      try {
        const candles = await exchangeClient.getCandles(
          symbol,
          this.interval,
          time.getTime(),
          requestEndTime.getTime()
        );
        const isTrailedCandle =
          this.aggregatedData.length &&
          candles[0].openTime === this.aggregatedData[this.aggregatedData.length - 1].openTime;

        if (isTrailedCandle) {
          candles.shift();
        }

        this.aggregatedData.push(...candles);

        time = new Date(candles[candles.length - 1].openTime);
      } catch (e) {
        console.log(chalk.red(`Error while scrapping data ${e}`));
        time = new Date(requestEndTime);
      }
    }
  }

  private saveData(symbol: string) {
    const data = JSON.stringify(this.aggregatedData);
    const folderName = 'data';
    if (!fs.existsSync(`./${folderName}`)) {
      fs.mkdirSync(`./${folderName}`);
    }
    const filePath = `./${folderName}/${symbol}-${this.format(this.startDate)}-${this.format(this.endDate)}-${this.interval}.json`;
    fs.writeFileSync(filePath, data);
    console.log(chalk.green(`\n Data scrapped and saved to file ${filePath} \n`));
  }

  private format(date: Date): string {
    return format(date, 'yyyy-MM-dd');
  }
}

import dotenv from 'dotenv';
import chalk from 'chalk';
import fs from 'fs';
import { parse } from 'json2csv';
import { add } from 'date-fns';
import { DynamicConfig } from '../utils/dynamic-config';
import { GeneralTimeIntervals } from '../types/enums';
import { EnvConfig } from '../env-config';
import { ChartCanvasRenderer } from '../core/services/chart-canvas-renderer';
import { CandleChartData } from '../interfaces/charts/candlestick-chart-data';
import {
  convertIntervalToDuration,
  getExchangeClient,
  getStrategyFactoryByKey,
} from './backtest-helpers';
import { ChartRenderableEntities } from '../indicator/dto/sm-indicator-response';
import { BacktestReporter, Statistics } from './backtest-reporter';
import { StrategyTemplate } from '../strategy/strategy-template';
import { IExchangeClient } from '../interfaces/exchange-client.interface';
import { Order } from '../strategy/order';
import { formatNumber } from '../utils/utils';
import { OrderDirection } from '../strategy/enum/order-direction.enum';

interface HyperParametersReport {
  statistics: Statistics;
  params: Record<string, any>;
}

export class BacktestRunner {
  constructor(
    private startTime: Date,
    private endTime: Date,
    private interval: GeneralTimeIntervals,
    private exchangeFactory?: () => IExchangeClient
  ) {}

  public async runTests(symbol: string, strategyName: string): Promise<void> {
    console.log(chalk.yellow(`Start backtesting for ${symbol} on ${this.interval} interval`));

    const { exchangeClient, imageRenderer } = await this.init(symbol);

    const hpReport: HyperParametersReport[] = [];

    let iter = 0;
    for (let params of this.generateHyperParameters()) {
      console.log(chalk.yellow(`Start iteration ${iter} with params ${JSON.stringify(params)}`));

      const strategy = getStrategyFactoryByKey(strategyName, exchangeClient, symbol, params)();
      const reporter = new BacktestReporter(this.interval, imageRenderer);

      let time = this.startTime;

      this.notifyAboutAutoClosedOrders(() => time, strategy);

      strategy.onOrderClosedByPrice$.subscribe(({ order, chartData, status }) => {
        if (order.direction === OrderDirection.buy) {
          this.processClosedBuyOrder(order, chartData, {}, () => time);
        }
        if (order.direction === OrderDirection.sell) {
          this.processClosedSellOrder(order, chartData, {}, () => time);
        }
      });

      while (time <= this.endTime) {
        if (time.getMinutes() === 0 && time.getHours() === 0) {
          console.log(`Time: ${time.toLocaleString()}`);
        }

        const requestStartTime = add(time, { hours: -12 }).getTime();
        const requestEndTime = time.getTime();

        const { order } = await strategy.processStep(requestStartTime, requestEndTime);

        if (order) {
          this.notifyAboutOrders(order, time);
        }

        time = add(time, convertIntervalToDuration(this.interval));
      }

      const statistics = await reporter.generateReport(
        this.startTime,
        this.endTime,
        strategy,
        symbol
      );

      console.log(JSON.stringify(params));

      hpReport.push({ statistics, params });
      this.saveSearchGridStatistics(symbol, hpReport);

      iter++;
    }

    process.exit(0);
  }

  private saveSearchGridStatistics(symbol: string, array: HyperParametersReport[]): void {
    const jsonData: any[] = [];

    for (let hpReport of array) {
      jsonData.push({
        averageProfit: round(hpReport.statistics.averageProfitPerTrade),
        profitOrders: hpReport.statistics.profitOrders,
        averageRiskReward: round(hpReport.statistics.averageRiskReward),
        winRate: percent(hpReport.statistics.winRate),
        minVwapAtrRatio: hpReport.params.MIN_VWAP_ATR_RATIO,
        maxVwapAtrRatio: hpReport.params.MAX_VWAP_ATR_RATIO,
        maxIfvgToAtrRatio: hpReport.params.MAX_IFVG_TO_ATR_RATIO,
        timings: JSON.stringify(hpReport.params.timings),
      });
    }
    const csv = parse(jsonData);

    const folderName = 'reports';
    if (!fs.existsSync(`./${folderName}`)) {
      fs.mkdirSync(`./${folderName}`);
    }
    const filePath = `./${folderName}/grid-search-${symbol}-${this.interval}-csv.csv`;
    fs.writeFileSync(filePath, csv);
  }

  private *generateHyperParameters(): IterableIterator<Record<string, any>> {
    const newYorkIndicesParameters = {
      timings: [
        [
          { hour: 9, minute: 31 },
          { hour: 9, minute: 51 },
        ],
      ],
      orderAliveTimings: [
        [
          { hour: 9, minute: 20 },
          { hour: 12, minute: 0 },
        ],
      ],
      MIN_VWAP_ATR_RATIO: 2.5,
      MAX_VWAP_ATR_RATIO: 11.5,
      MAX_IFVG_TO_ATR_RATIO: 8,
    };

    const londonParameters = {
      timings: [
        [
          { hour: 2, minute: 3 },
          { hour: 2, minute: 20 },
        ],
      ],
      orderAliveTimings: [
        [
          { hour: 2, minute: 0 },
          { hour: 3, minute: 0 },
        ],
      ],
      MIN_VWAP_ATR_RATIO: 2.5,
      MAX_VWAP_ATR_RATIO: 11.5,
      MAX_IFVG_TO_ATR_RATIO: 8,
    };

    yield londonParameters;
  }

  private async init(
    symbol: string
  ): Promise<{ exchangeClient: IExchangeClient; imageRenderer: ChartCanvasRenderer }> {
    dotenv.config();
    const envConfig = EnvConfig.getInstance();
    const dynamicConfig = DynamicConfig.getInstance(envConfig);
    const imageRenderer = new ChartCanvasRenderer(await dynamicConfig.getConfig());

    let exchangeClient: IExchangeClient;
    if (this.exchangeFactory) {
      exchangeClient = this.exchangeFactory();
      await exchangeClient.init();
    } else {
      exchangeClient = await getExchangeClient(envConfig, dynamicConfig, symbol);
    }

    console.log(chalk.yellow(`Init complete`));
    return {
      exchangeClient,
      imageRenderer,
    };
  }

  private notifyAboutAutoClosedOrders(timeFn: () => Date, strategy: StrategyTemplate): void {
    strategy.onOrderClosedByStrategy$.subscribe(order => {
      const chalkFunc: chalk.Chalk = order.profitable ? chalk.bgGreen : chalk.bgGray;
      const messageBase = `${order.entryPrice} -> ${order.closePrice} [${timeFn().toLocaleString()}] (RR: ${formatNumber(order.riskRewardRate)})`;

      if (order.direction === OrderDirection.buy) {
        console.log(chalkFunc(`BUY ORDER CLOSED: ${messageBase}`));
      } else {
        console.log(chalkFunc(`SELL ORDER CLOSED: ${messageBase}`));
      }
    });
  }

  private notifyAboutOrders(order: Order, time: Date): void {
    if (order.direction === OrderDirection.buy) {
      console.log(
        chalk.green(
          `BUY ORDER CREATED: ${order.entryPrice} -> ${order.stopLossPrice} -> ${order.takeProfitPrice} [${time.toLocaleString()}]`
        )
      );
    }
    if (order.direction === OrderDirection.sell) {
      console.log(
        chalk.green(
          `SELL ORDER CREATED: ${order.entryPrice} -> ${order.stopLossPrice} -> ${order.takeProfitPrice} [${time.toLocaleString()}]`
        )
      );
    }
  }

  private processClosedBuyOrder(
    order: Order,
    chartData: CandleChartData[],
    renderables: Partial<ChartRenderableEntities>,
    timeFn: () => Date
  ): void {
    const lastCandle = chartData[chartData.length - 1];

    if (lastCandle.close <= order.stopLossPrice) {
      order.close(lastCandle.openTime, lastCandle.close, chartData, renderables);
      const messageBase = `${order.entryPrice} -> ${order.stopLossPrice} [${timeFn().toLocaleString()}] (RR: ${formatNumber(order.riskRewardRate)})`;
      const highLightFn: chalk.Chalk = order.profitable
        ? chalk.bgGreen
        : order.isBreakeven
          ? chalk.bgGray
          : chalk.bgRed;
      console.log(highLightFn(`BUY ORDER STOP LOSS REACHED: ${messageBase}`));
    }
    if (lastCandle.close >= order.takeProfitPrice) {
      order.close(lastCandle.openTime, lastCandle.close, chartData, renderables);
      const messageBase = `${order.entryPrice} -> ${order.takeProfitPrice} [${timeFn().toLocaleString()}] (RR: ${formatNumber(order.riskRewardRate)})`;
      console.log(chalk.bgGreen(`BUY ORDER TAKE PROFIT REACHED: ${messageBase}`));
    }
  }

  private processClosedSellOrder(
    order: Order,
    chartData: CandleChartData[],
    renderables: Partial<ChartRenderableEntities>,
    timeFn: () => Date
  ): void {
    const lastCandle = chartData[chartData.length - 1];
    if (lastCandle.close >= order.stopLossPrice) {
      order.close(lastCandle.openTime, lastCandle.close, chartData, renderables);
      const messageBase = `${order.entryPrice} -> ${order.stopLossPrice} [${timeFn().toLocaleString()}] (RR: ${formatNumber(order.riskRewardRate)})`;
      const highLightFn: chalk.Chalk = order.profitable
        ? chalk.bgGreen
        : order.isBreakeven
          ? chalk.bgGray
          : chalk.bgRed;
      console.log(highLightFn(`SELL ORDER STOP LOSS REACHED: ${messageBase}`));
    }
    if (lastCandle.close <= order.takeProfitPrice) {
      order.close(lastCandle.openTime, lastCandle.close, chartData, renderables);
      const messageBase = `${order.entryPrice} -> ${order.takeProfitPrice} [${timeFn().toLocaleString()}] (RR: ${formatNumber(order.riskRewardRate)})`;
      console.log(chalk.bgGreen(`SELL ORDER TAKE PROFIT REACHED: ${messageBase}`));
    }
  }
}

function percent(value: number): number {
  return Math.ceil(value * 100);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

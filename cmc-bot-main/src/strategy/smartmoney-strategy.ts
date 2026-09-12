import {
  add,
  addHours,
  addMinutes,
  format,
  getDay,
  isSameDay,
  isWithinInterval,
  startOfDay,
} from 'date-fns';
import { zonedTimeToUtc } from 'date-fns-tz';
import { StrategyTemplate } from './strategy-template';
import { CandleChartData } from '../interfaces/charts/candlestick-chart-data';
import { indicatorScript } from '../indicator/main-indicator';
import { StrategyResponse } from './strategy-response.interface';
import {
  ChartRenderableEntities,
  SmIndicatorInsights,
} from '../indicator/dto/sm-indicator-response';
import { OrderDirection } from './enum/order-direction.enum';
import { IExchangeClient } from '../interfaces/exchange-client.interface';
import { GeneralTimeIntervals, LogMessageType } from '../types/enums';
import { ATR } from '../indicator/tools/atr.indicator';
import { Order } from './order';
import { calculateFVG } from '../indicator/tools/fvg.indicator';
import { RiskManager } from './risk-manager';

export class SmartMoneyStrategy extends StrategyTemplate {
  public TARGET_RISK_REWARD_RATIO = 2.7;
  private LOW_TIME_FRAME_INTERVAL = GeneralTimeIntervals.m1;
  private HIGH_TIME_FRAME_BIAS_INTERVAL = GeneralTimeIntervals.h1;
  private HIGH_TIME_FRAME_BIAS_BACK_STEP_DATE = { hours: -720 };
  private MAX_IFVG_TO_ATR_RATIO = 8;

  constructor(
    protected readonly client: IExchangeClient,
    protected readonly symbol: string,
    strategyCode: string,
    protected readonly riskManager: RiskManager,
  ) {
    super(client, symbol, strategyCode, riskManager);
  }

  public isValidTimeForNewOrders(timestamp: number): boolean {
    const today = startOfDay(new Date(timestamp));
    const timezone = 'America/New_York';
    const startTime = zonedTimeToUtc(addMinutes(addHours(today, 9), 40), timezone);
    const endTime = zonedTimeToUtc(addMinutes(addHours(today, 11), 10), timezone);
    const currentDay = getDay(timestamp);

    return isWithinInterval(timestamp, { start: startTime, end: endTime }) &&
      currentDay >= 1 && currentDay <= 5;
  }

  public canOrdersBeAlive(timestamp: number): boolean {
    const today = startOfDay(new Date(timestamp));
    const timezone = 'America/New_York';
    const startTime = zonedTimeToUtc(addMinutes(addHours(today, 9), 40), timezone);
    const endTime = zonedTimeToUtc(addMinutes(addHours(today, 11), 10), timezone);
    const currentDay = getDay(timestamp);

    return isWithinInterval(timestamp, { start: startTime, end: endTime }) &&
      currentDay >= 1 && currentDay <= 5;
  }

  public async processCharts(candles: CandleChartData[], startTime: number, endTime: number): Promise<StrategyResponse> {
    const response = indicatorScript(candles, {});
    const bias = await this.getHighTimeFrameBias(endTime);

    this._onIntermediateNotification$.next({
      type: LogMessageType.STRATEGY_BIAS_CALCULATION,
      message: `Direction - ${bias.direction}`,
    });

    const sellSignal =
      response.insights.aboveNYamTrueOpen &&
      response.insights.bearishIfvgOccurs &&
      !response.insights.priceInDiscount &&
      bias.direction === OrderDirection.sell &&
      this.isIFVGtoATRRatioAllowed(candles, response.insights) &&
      !this.riskManager.isMaxLossPerDayReached(this.orders, candles) &&
      !this.riskManager.takeProfitPerDayReached(this.orders, candles);

    if (sellSignal) {
      this._onIntermediateNotification$.next({
        type: LogMessageType.STRATEGY_BIAS,
        message: `${this.strategyCode} - ${bias.direction}`,
        candles: bias.candles,
      });
      const stopLoss = this.riskManager.adjustStopLoss(candles, response.insights, OrderDirection.sell);
      return {
        buySignal: false,
        sellSignal: true,
        stopLoss: stopLoss,
        takeProfit: this.adjustTakeProfitToTargetRiskRewardRatio(
          candles,
          OrderDirection.sell,
          stopLoss
        ),
        renderables: response.renderables,
      };
    }

    const buySignal =
      !response.insights.aboveNYamTrueOpen &&
      response.insights.bullishIfvgOccurs &&
      response.insights.priceInDiscount &&
      bias.direction === OrderDirection.buy &&
      this.isIFVGtoATRRatioAllowed(candles, response.insights) &&
      !this.riskManager.isMaxLossPerDayReached(this.orders, candles) &&
      !this.riskManager.takeProfitPerDayReached(this.orders, candles);

    if (buySignal) {
      this._onIntermediateNotification$.next({
        type: LogMessageType.STRATEGY_BIAS,
        message: `${this.strategyCode} - ${bias.direction}`,
        candles: bias.candles,
      });
      const stopLoss = this.riskManager.adjustStopLoss(candles, response.insights, OrderDirection.buy);

      return {
        buySignal: true,
        sellSignal: false,
        stopLoss: stopLoss,
        takeProfit: this.adjustTakeProfitToTargetRiskRewardRatio(
          candles,
          OrderDirection.buy,
          stopLoss
        ),
        renderables: response.renderables,
      };
    }

    return {
      buySignal: false,
      sellSignal: false,
    };
  }

  public processOutOfValidTime(
    candles: CandleChartData[],
    renderables?: Partial<ChartRenderableEntities>
  ): void {
    this.orders
      .filter(order => !order.isClosed)
      .forEach(order => {
        const lastCandle = candles[candles.length - 1];
        if (lastCandle) {
          order.close(lastCandle.openTime, lastCandle.close, candles, renderables);
          this._onOrderClosedByStrategy$.next(order);
        }
      });
  }

  protected getLowTimeframe(): GeneralTimeIntervals {
    return this.LOW_TIME_FRAME_INTERVAL;
  }

  protected verifyExistingOrders(candles: CandleChartData[]): void {
    const lastCandle = candles[candles.length - 1];
    const openedOrders = this.orders.filter(order => !order.isClosed);

    const orders = this.riskManager.tryToTrailStopLoss(openedOrders, lastCandle);
    orders.forEach(order => this._onTrailStopLoss$.next(order));

    const openedBuyOrders = openedOrders.filter(order => order.direction === OrderDirection.buy);
    const openedSellOrders = openedOrders.filter(order => order.direction === OrderDirection.sell);

    if (openedBuyOrders.length > 0 && openedSellOrders.length > 0) {
      const earliestOrder = [...openedBuyOrders, ...openedSellOrders].reduce((acc, curr) => {
        if (acc.entryTime < curr.entryTime) {
          return acc;
        }
        return curr;
      });

      earliestOrder.close(lastCandle.openTime, lastCandle.close, candles);
      this._onOrderClosedByStrategy$.next(earliestOrder);
    }
  }

  protected isNewOrdersAllowed(direction: OrderDirection): boolean {
    if (this.orders.length === 0) {
      return true;
    }

    return this.riskManager.isOpenedOrderAmountCorrect(this.orders, direction);
  }

  private adjustTakeProfitToTargetRiskRewardRatio(
    candles: CandleChartData[],
    direction: OrderDirection,
    stopLoss: number
  ): number {
    const lastCandle = candles[candles.length - 1];
    let lossWindow = 0;

    if (direction === OrderDirection.buy) {
      lossWindow = lastCandle.close - stopLoss;
      return lastCandle.close + this.TARGET_RISK_REWARD_RATIO * lossWindow;
    } else {
      lossWindow = stopLoss - lastCandle.close;
      return lastCandle.close - this.TARGET_RISK_REWARD_RATIO * lossWindow;
    }
  }

  private isIFVGtoATRRatioAllowed(
    candles: CandleChartData[],
    insights: SmIndicatorInsights
  ): boolean {
    const atr = ATR(candles, 20);
    const lastATR = atr[atr.length - 1];
    let lastIfvgToAtrRatio = Infinity;
    let ifvgSize = 0;
    if (insights.lastIFVG) {
      const ifvg = insights.lastIFVG;
      ifvgSize = Math.abs(ifvg.low - ifvg.high);
      lastIfvgToAtrRatio = lastATR / ifvgSize;
    }

    return lastIfvgToAtrRatio < this.MAX_IFVG_TO_ATR_RATIO;
  }

  private async getHighTimeFrameBias(endDate: number): Promise<{ direction: OrderDirection | void, candles: CandleChartData[] }> {
    const startDate = add(endDate, this.HIGH_TIME_FRAME_BIAS_BACK_STEP_DATE);
    const highTimeframeCandles = await this.client.getCandles(
      this.symbol,
      this.HIGH_TIME_FRAME_BIAS_INTERVAL,
      startDate.getTime(),
      endDate
    );
    const result = calculateFVG(highTimeframeCandles);

    return {
      direction: result.lastIFVGDirection,
      candles: highTimeframeCandles,
    };
  }
}

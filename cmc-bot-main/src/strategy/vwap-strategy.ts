import {
  add,
  addHours,
  addMinutes,
  getDay,
  isWithinInterval,
  startOfDay,
} from 'date-fns';
import { IExchangeClient } from '../interfaces/exchange-client.interface';
import { StrategyTemplate } from './strategy-template';
import { zonedTimeToUtc } from 'date-fns-tz';
import { CandleChartData } from '../interfaces/charts/candlestick-chart-data';
import { ChartRenderableEntities } from '../indicator/dto/sm-indicator-response';
import { GeneralTimeIntervals, LogMessageType } from '../types/enums';
import { OrderDirection } from './enum/order-direction.enum';
import { VWAP } from '../indicator/tools/vwap.indicator';
import { StrategyResponse } from './strategy-response.interface';
import { composeIndicators } from '../indicator/indicators-composer';
import { calculateFVG } from '../indicator/tools/fvg.indicator';
import { range } from '../indicator/tools/range.indicator';
import { ATR } from '../indicator/tools/atr.indicator';
import { FVG } from '../indicator/interfaces/fvg';
import { priceAtTime } from '../indicator/tools/price-at-time.indicator';
import { previousHourLH } from '../indicator/tools/previous-hour-lh.indicator';
import { RiskManager } from './risk-manager';

export class VWapStrategy extends StrategyTemplate {
  public TARGET_RISK_REWARD_RATIO = 3;
  private LOW_TIME_FRAME_INTERVAL = GeneralTimeIntervals.m1;

  constructor(
    protected readonly client: IExchangeClient,
    protected readonly symbol: string,
    strategyCode: string,
    private hyperParameters: Record<string, any>,
    protected readonly riskManager: RiskManager,
  ) {
    super(client, symbol, strategyCode, riskManager);
  }

  public isValidTimeForNewOrders(timestamp: number): boolean {
    const today = startOfDay(new Date(timestamp));
    const timezone = 'America/New_York';
    const currentDay = getDay(timestamp);

    if (!this.hyperParameters.timings) {
      return false;
    }

    return this.hyperParameters.timings.some(([start, end]) => isWithinInterval(
      timestamp,
      {
        start: zonedTimeToUtc(addMinutes(addHours(today, start.hour), start.minute), timezone),
        end: zonedTimeToUtc(addMinutes(addHours(today, end.hour), end.minute), timezone),
      })) &&
      currentDay >= 1 && currentDay <= 5;
  }

  public canOrdersBeAlive(timestamp: number): boolean {
    const today = startOfDay(new Date(timestamp));
    const timezone = 'America/New_York';
    const currentDay = getDay(timestamp);

    if (!this.hyperParameters.orderAliveTimings) {
      return false;
    }

    return this.hyperParameters.orderAliveTimings.some(([start, end]) => isWithinInterval(
      timestamp,
      {
        start: zonedTimeToUtc(addMinutes(addHours(today, start.hour), start.minute), timezone),
        end: zonedTimeToUtc(addMinutes(addHours(today, end.hour), end.minute), timezone),
      })) &&
      currentDay >= 1 && currentDay <= 5;
  }

  public async processCharts(candles: CandleChartData[], startTime: number, endTime: number): Promise<StrategyResponse> {
    const analytics: Record<string, string | number | undefined> = {};
    const lastCandle = candles[candles.length - 1];
    const response = this.processCandles(candles);
    const bias = await this.getHighTimeFrameBias(lastCandle.open, endTime);

    if (!bias) {
      return {
        buySignal: false,
        sellSignal: false,
      };
    }

    const rangeBottom = response.range.bottom;
    const rangeTop = response.range.top;
    const atr = response.atr[response.atr.length - 1];
    const vwapRange = bias.vwapTop[bias.vwapTop.length - 1] - bias.vwapBottom[bias.vwapBottom.length - 1]
    const vwapAtrRatio = vwapRange / atr;
    const isIFVGtoATRRatioAllowed = this.isIFVGtoATRRatioAllowed(candles, response.fvg.lastIFVG);
    const abovePrevHourHigh = this.abovePrevHourHigh(candles, response.prevHour?.high);
    const belowPrevHourLow = this.belowPrevHourLow(candles, response.prevHour?.low);

    analytics.vwapAtrRatio = vwapAtrRatio;
    analytics.rangeTop = rangeTop[rangeTop.length - 1];
    analytics.rangeBottom = rangeBottom[rangeBottom.length - 1];
    analytics.biasDirection = bias.direction;
    analytics.isIFVGtoATRRatioAllowed = isIFVGtoATRRatioAllowed.toString();
    analytics.abovePrevHourHigh = abovePrevHourHigh.toString();
    analytics.belowPrevHourLow = belowPrevHourLow.toString();

    this._onIntermediateNotification$.next({
      type: LogMessageType.STRATEGY_BIAS_CALCULATION,
      message: `Direction - ${bias.direction}`,
    });

    const sellSignal =
      response.fvg.bearishIfvgOccurs &&
      vwapAtrRatio >= this.hyperParameters.MIN_VWAP_ATR_RATIO &&
      vwapAtrRatio <= this.hyperParameters.MAX_VWAP_ATR_RATIO &&
      !response.range.priceInDiscount &&
      bias.direction === OrderDirection.sell &&
      isIFVGtoATRRatioAllowed &&
      abovePrevHourHigh &&
      !this.riskManager.isMaxLossPerDayReached(this.orders, candles) &&
      !this.riskManager.takeProfitPerDayReached(this.orders, candles);

    if (sellSignal) {
      const stopLoss = this.riskManager.adjustStopLoss(
        candles,
        { rangeLow: rangeBottom[rangeBottom.length - 1], rangeHigh: rangeTop[rangeTop.length - 1] },
        OrderDirection.sell
      );

      return {
        buySignal: false,
        sellSignal: true,
        stopLoss,
        takeProfit: this.adjustTakeProfitToTargetRiskRewardRatio(
          candles,
          OrderDirection.sell,
          stopLoss
        ),
        analytics,
      };
    }

    const buySignal =
      response.fvg.bullishIfvgOccurs &&
      vwapAtrRatio >= this.hyperParameters.MIN_VWAP_ATR_RATIO &&
      vwapAtrRatio <= this.hyperParameters.MAX_VWAP_ATR_RATIO &&
      response.range.priceInDiscount &&
      bias.direction === OrderDirection.buy &&
      isIFVGtoATRRatioAllowed &&
      belowPrevHourLow &&
      !this.riskManager.isMaxLossPerDayReached(this.orders, candles) &&
      !this.riskManager.takeProfitPerDayReached(this.orders, candles);

    if (buySignal) {
      const stopLoss = this.riskManager.adjustStopLoss(
        candles,
        { rangeLow: rangeBottom[rangeBottom.length - 1], rangeHigh: rangeTop[rangeTop.length - 1] },
        OrderDirection.buy
      );

      return {
        buySignal: true,
        sellSignal: false,
        stopLoss,
        takeProfit: this.adjustTakeProfitToTargetRiskRewardRatio(
          candles,
          OrderDirection.buy,
          stopLoss
        ),
        analytics,
      };
    }

    return {
      buySignal: false,
      sellSignal: false,
      analytics,
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

  private isIFVGtoATRRatioAllowed(
    candles: CandleChartData[],
    lastIFVG: FVG,
  ): boolean {
    if (!lastIFVG) {
      return false;
    }
    const atr = ATR(candles, 20);
    const lastATR = atr[atr.length - 1];
    let lastIfvgToAtrRatio = Infinity;
    let ifvgSize = 0;

    const ifvg = lastIFVG;
    ifvgSize = Math.abs(ifvg.low - ifvg.high);
    lastIfvgToAtrRatio = lastATR / ifvgSize;

    return lastIfvgToAtrRatio < this.hyperParameters.MAX_IFVG_TO_ATR_RATIO;
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

  private async getHighTimeFrameBias(
    lastPrice: number,
    endDate: number,
  ): Promise<{ direction: OrderDirection, vwapTop: number[], vwap: number[], vwapBottom: number[] } | void> {
    const startDate = add(startOfDay(endDate), { minutes: 1 });

    const highTimeframeCandles = await this.client.getCandles(
      this.symbol,
      GeneralTimeIntervals.m1,
      startDate.getTime(),
      endDate
    );
    const indicators = [
      {
        code: 'vwap',
        calculate: (v: CandleChartData[]) => VWAP(v),
      }
    ] as const;

    const response = composeIndicators(indicators, highTimeframeCandles);

    const { vwapBottom, vwap, vwapTop } = response.vwap;

    if (lastPrice > vwapTop[vwapTop.length - 1]) {
      return {
        direction: OrderDirection.sell,
        vwapTop: vwapTop,
        vwap: vwap,
        vwapBottom: vwapBottom,
      };
    } else if (lastPrice < vwapBottom[vwapBottom.length - 1]) {
      return {
        direction: OrderDirection.buy,
        vwapTop: vwapTop,
        vwap: vwap,
        vwapBottom: vwapBottom,
      }
    }
  }

  private processCandles(candles: CandleChartData[]) {
    const indicators = [
      {
        code: 'range',
        calculate: (v: CandleChartData[]) => range(v, 200),
      },
      {
        code: 'fvg',
        calculate: (v: CandleChartData[]) => calculateFVG(v),
      },
      {
        code: 'atr',
        calculate: (v: CandleChartData[]) => ATR(v, 20),
      },
      {
        code: 'opening',
        calculate: (v: CandleChartData[]) => priceAtTime(v, 9, 0),
      },
      {
        code: 'prevHour',
        calculate: (v: CandleChartData[]) => previousHourLH(v),
      }
    ] as const;

    return composeIndicators(indicators, candles);
  }

  private abovePrevHourHigh(candles: CandleChartData[], prevHour: { y: number, x: number } | void): boolean {
    if (prevHour) {
      let highest = candles[candles.length - 1].high;
      for(let i = candles.length - 2; i >= candles.length - 6; i--) {
        highest = Math.max(highest, candles[i].high);
      }
      return highest > prevHour.y;
    }

    return false;
  }

  private belowPrevHourLow(candles: CandleChartData[], prevHour: { y: number, x: number } | void): boolean {
    if (prevHour) {
      let lowest = candles[candles.length - 1].low;
      for(let i = candles.length - 2; i >= candles.length - 6; i--) {
        lowest = Math.min(lowest, candles[i].low);
      }
      return lowest < prevHour.y;
    }

    return false;
  }
}

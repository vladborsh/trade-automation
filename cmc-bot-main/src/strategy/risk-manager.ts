import { isSameDay, startOfDay } from "date-fns";
import { CandleChartData } from "../interfaces/charts/candlestick-chart-data";
import { OrderDirection } from "./enum/order-direction.enum";
import { Order } from "./order";

export class RiskManager {
  private MAX_OPENED_ORDERS_IN_SAME_DIRECTION = 1;
  private MAX_LOST_ORDERS_PER_DAY = 2;
  private MAX_WIN_ORDERS_PER_DAY = 1;

  public tryToTrailStopLoss(openedOrders: Order[], lastCandle: CandleChartData): Order[] {
    const ordersWithTrailedStopLoss: Order[] = [];

    openedOrders.forEach(order => {
      let orderCurrentProfit = 0;
      if (order.direction === OrderDirection.buy) {
        orderCurrentProfit = lastCandle.close - order.entryPrice;
      } else if (order.direction === OrderDirection.sell) {
        orderCurrentProfit = order.entryPrice - lastCandle.close;
      }
      const orderCurrentRisk = order.initialStopLossSize;
      const orderCurrentProfitRatio = orderCurrentProfit / orderCurrentRisk;

      let prevStopLoss = order.stopLossPrice;
      if (orderCurrentProfitRatio > 1 && orderCurrentProfitRatio < 2) {
        order.trailStopLoss(0);
      }
      if (orderCurrentProfitRatio > 2) {
        order.trailStopLoss(1);
      }
      let newStopLoss = order.stopLossPrice;
      if (prevStopLoss !== newStopLoss) {
        ordersWithTrailedStopLoss.push(order);
      }
    });

    return ordersWithTrailedStopLoss;
  }

  public isOpenedOrderAmountCorrect(virtualOrders: Order[], direction: OrderDirection): boolean {
    const numberOfOpenedOrders = virtualOrders.filter(
      order => !order.isClosed && order.direction === direction
    ).length;

    return numberOfOpenedOrders < this.MAX_OPENED_ORDERS_IN_SAME_DIRECTION;
  }

  public isMaxLossPerDayReached(virtualOrders: Order[], candles: CandleChartData[]): boolean {
    const currentDay = startOfDay(new Date(candles[candles.length - 1].openTime));
    const currentDayLostOrders = virtualOrders.filter(order => {
      if (order.isClosed && order.closeTime) {
        const orderCloseDay = startOfDay(new Date(order.closeTime));

        return isSameDay(orderCloseDay, currentDay) && !order.profitable;
      }
    });

    return currentDayLostOrders.length >= this.MAX_LOST_ORDERS_PER_DAY;
  }

  public takeProfitPerDayReached(virtualOrders: Order[], candles: CandleChartData[]): boolean {
    const currentDay = startOfDay(new Date(candles[candles.length - 1].openTime));
    const currentDayWins = virtualOrders.filter(order => {
      if (order.isClosed && order.closeTime && order.profitable) {
        const orderCloseDay = startOfDay(new Date(order.closeTime));

        return isSameDay(orderCloseDay, currentDay) && order.profitable;
      }
    });

    return currentDayWins.length >= this.MAX_WIN_ORDERS_PER_DAY;
  }

  public adjustStopLoss(
    candles: CandleChartData[],
    insights: { rangeLow: number; rangeHigh: number },
    direction: OrderDirection
  ): number {
    const entryPrice = candles[candles.length - 1].close;
    const stopLossSize = this.getStopLossSize(candles, insights, direction);
    const stopLossToRangeRatio = this.getStopLossRatio(candles, insights, direction);

    let ratioFromOriginal = 1;

    if (stopLossToRangeRatio < 3 && stopLossToRangeRatio >= 2.5) {
      ratioFromOriginal = 0.7;
    } else if (stopLossToRangeRatio < 2.5) {
      ratioFromOriginal = 0.5;
    }

    const newStopLossSize = stopLossSize * ratioFromOriginal;
    const newStopLossPrice =
      direction === OrderDirection.buy
        ? entryPrice - newStopLossSize
        : entryPrice + newStopLossSize;

    return newStopLossPrice;
  }

  public getStopLossRatio(
    candles: CandleChartData[],
    insights: { rangeLow: number; rangeHigh: number },
    direction: OrderDirection
  ): number {
    const stopLossSize = this.getStopLossSize(candles, insights, direction);
    const rangeSize = Math.abs(insights.rangeLow - insights.rangeHigh);

    return rangeSize / stopLossSize;
  }

  public getStopLossSize(
    candles: CandleChartData[],
    insights: { rangeLow: number; rangeHigh: number },
    direction: OrderDirection
  ): number {
    const entryPrice = candles[candles.length - 1].close;
    const stopLossPrice = direction === OrderDirection.buy ? insights.rangeLow : insights.rangeHigh;
    const stopLossSize = Math.abs(stopLossPrice - entryPrice);

    return stopLossSize;
  }
}

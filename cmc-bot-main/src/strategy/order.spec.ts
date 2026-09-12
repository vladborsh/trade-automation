

import { CandleChartData } from '../interfaces/charts/candlestick-chart-data';
import { OrderDirection } from './enum/order-direction.enum';
import { Order } from './order';

describe('Order Class', () => {
  let order: Order;
  const entryTime = Date.now();
  const strategyCode = 'STR001';

  beforeEach(() => {
    order = new Order(
      OrderDirection.buy,
      100,
      entryTime,
      95,
      110,
      strategyCode
    );
  });

  describe('constructor and basic properties', () => {
    it('calculates initial stop loss size correctly', () => {
      expect(order.initialStopLossSize).toBe(5);
    });
  });

  describe('trailStopLoss method', () => {
    it('should change stop loss price accordingly to ratio', () => {
      const sellOrder = new Order(
        OrderDirection.sell,
        100,
        entryTime,
        105,
        90,
        strategyCode
      );
      sellOrder.trailStopLoss(1);
      expect(sellOrder.stopLossPrice).toBe(95);
    });
  });

  describe('close method', () => {
    it('handles closing a sell order with a loss correctly', () => {
      const sellOrder = new Order(
        OrderDirection.sell,
        100,
        entryTime,
        105,
        90,
        strategyCode
      );
      const closeTime = Date.now();
      const closePrice = 106;
      const chartData: CandleChartData[] = [{ open: 105, high: 107, low: 104, close: 106, openTime: closeTime, volume: 1 }];
      sellOrder.close(closeTime, closePrice, chartData);

      expect(sellOrder.isClosed).toBe(true);
      expect(sellOrder.closePrice).toBe(105);
      expect(sellOrder.profitable).toBe(false);
    });

    it('marks an order as breakeven when the stop loss is adjusted to the entry price', () => {
      order.trailStopLoss(0);
      order.close(entryTime + 1000, 100, []);

      expect(order.isBreakeven).toBe(true);
    });

    it('calculates risk reward rate accurately upon close', () => {
      const closeTime = Date.now();
      const closePrice = 103;
      const chartData: CandleChartData[] = [{ open: 102, high: 104, low: 101, close: 103, openTime: closeTime, volume: 1 }];
      order.close(closeTime, closePrice, chartData);

      expect(order.riskRewardRate).toBe((3 / 5));
    });

    it('should not adjust stop loss price for buy orders to lower values', () => {
      const buyOrder = new Order(
        OrderDirection.buy,
        105,
        entryTime,
        100,
        115,
        strategyCode
      );
      buyOrder.trailStopLoss(1);
      buyOrder.trailStopLoss(0.5);

      expect(buyOrder.stopLossPrice).toBe(110);
    });

    it('should not adjust stop loss price for sell orders to higher values', () => {
      const buyOrder = new Order(
        OrderDirection.sell,
        105,
        entryTime,
        110,
        90,
        strategyCode
      );
      buyOrder.trailStopLoss(1);
      buyOrder.trailStopLoss(0.5);

      expect(buyOrder.stopLossPrice).toBe(100 );
    });
  });

  describe('setChartSnapshot method', () => {
    it('sets the close chart snapshot correctly', () => {
      const chartData: CandleChartData[] = [{ open: 100, high: 105, low: 99, close: 104, openTime: entryTime, volume: 1 }];
      const renderables = {};
      order.setChartSnapshot(chartData, renderables);

      expect(order.entryChartSnapshot).toEqual({ chartData, renderables });
    });
  });
});

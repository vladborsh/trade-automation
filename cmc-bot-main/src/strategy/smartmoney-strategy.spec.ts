import { CandleChartData } from "../interfaces/charts/candlestick-chart-data";
import { IExchangeClient } from "../interfaces/exchange-client.interface";
import { OrderDirection } from "./enum/order-direction.enum";
import { RiskManager } from "./risk-manager";
import { SmartMoneyStrategy } from "./smartmoney-strategy";


describe('SmartMoneyStrategy', () => {
  let client: IExchangeClient;
  let strategy: SmartMoneyStrategy;

  beforeEach(() => {
    client = {
      init: jest.fn(),
      getCandles: jest.fn().mockResolvedValue([]),
      getCandlesStream: jest.fn(),
    };

    strategy = new SmartMoneyStrategy(client, 'BTCUSD', '001', new RiskManager());
  });

  describe('isValidTime', () => {
    it('returns true during valid trading hours', () => {
      const timestamp = new Date('2023-11-30T14:45:00Z').getTime();
      expect(strategy.isValidTimeForNewOrders(timestamp)).toBeTruthy();
    });

    it('returns false outside trading hours', () => {
      const timestamp = new Date('2023-11-30T13:30:00Z').getTime();
      expect(strategy.isValidTimeForNewOrders(timestamp)).toBeFalsy();
    });
  });

});

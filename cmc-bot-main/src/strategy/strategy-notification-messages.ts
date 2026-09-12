import { injectable } from 'inversify';
import { EnvConfig } from '../env-config';
import { getLinkText } from '../utils/get-link-text.helper';
import { formatNumber } from '../utils/utils';
import { OrderDirection } from './enum/order-direction.enum';
import { Order } from './order';

@injectable ()
export class StrategyNotificationMessages {
  constructor(private readonly envConfig: EnvConfig) {}

  public getMessageForOrder(order: Order, symbol: string): string {
    const symbolMessage = `${this.getLink(symbol)} `;
    const orderDirection = order.direction === OrderDirection.buy ? '📈 buy' : '📉 sell';
    const entryPriceMessage = `👉 Entry price: ${formatNumber(order.entryPrice)}`;
    const stopLossPriceMessage = `☑️ Stop loss price: \`${formatNumber(order.stopLossPrice)}\``;
    const takeProfitPriceMessage = `✅ Take profit price: \`${formatNumber(order.takeProfitPrice)}\``;
    const priceValues = `${entryPriceMessage}\n${takeProfitPriceMessage}\n${stopLossPriceMessage}`;
    const calculatorMessage = `${this.getLinkToCalculator(order)}`;
    const supportMessage = 'You can click on TP and SL prices to copy them';

    return (`${symbolMessage}\n${orderDirection}\n ${priceValues}\n\n${supportMessage}\n\n${calculatorMessage}`);
  }

  public getLinkToCalculator(order: Order): string {
    const base = this.envConfig.POSITION_CALCULATOR_URL;
    const params = `?&entryPrice=${order.entryPrice}&stopLossPrice=${order.stopLossPrice}&takeProfitPrice=${order.takeProfitPrice}`;

    const url = `${base}${params}`;

    return `[Calculate position](${url})`;
  }

  public getTrailStopMessage(symbol: string, order: Order): string {
    const title = `Stop loss ${this.getLink(symbol)} was trailed`;
    const orderDirection = order.direction === OrderDirection.buy ? '📈 buy' : '📉 sell';
    const entryPriceMessage = `👉 Entry price: ${formatNumber(order.entryPrice)}`;
    const stopLossPriceMessage = `Stop loss price TRAILED to: ${formatNumber(order.stopLossPrice)}`;

    return (`${title}\n${orderDirection}\n ${entryPriceMessage}\n${stopLossPriceMessage}`);
  }

  public getOrderStopLossMessage(symbol: string, order: Order): string {
    const title = `⚫ Stop loss ${this.getLink(symbol)} hit`;
    const orderDirection = order.direction === OrderDirection.buy ? '📈 buy' : '📉 sell';
    const stopLossPriceMessage = `Stop loss price CLOSED to: ${formatNumber(order.stopLossPrice)}`;

    return (`${title}\n${orderDirection}\n \n${stopLossPriceMessage}`);
  }

  public getOrderTakeProfitMessage(symbol: string, order: Order): string {
    const title = `🟢 Take profit ${this.getLink(symbol)} hit`;
    const orderDirection = order.direction === OrderDirection.buy ? '📈 buy' : '📉 sell';
    const takeProfitPriceMessage = `Take profit price CLOSED to: ${formatNumber(order.takeProfitPrice)}`;

    return (`${title}\n${orderDirection}\n \n${takeProfitPriceMessage}`);
  }

  public getOrderClosedMessage(symbol: string, order: Order): string {
    const title = `Order ${this.getLink(symbol)} should be closed`;
    const orderDirection = order.direction === OrderDirection.buy ? '📈 buy' : '📉 sell';
    const entryPriceMessage = `👉 Entry price: ${formatNumber(order.entryPrice)}`;
    const stopLossPriceMessage = `Stop loss price: ${formatNumber(order.stopLossPrice)}`;
    const riskRewardRateMessage = `💰 Risk reward rate: ${formatNumber(order.riskRewardRate)}`;

    return (`${title}\n${orderDirection}\n ${entryPriceMessage}\n${stopLossPriceMessage}\n${riskRewardRateMessage}`);
  }

  private getExchangeName(symbol: string): string {
    if (symbol.toUpperCase().includes('USDT')) {
      return 'binance';
    }

    return 'capitalcom';
  }

  private getLink(symbol: string): string {
    return getLinkText(symbol.toUpperCase(), 'm1', this.getExchangeName(symbol))
  }
}

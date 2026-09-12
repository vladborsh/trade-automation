import { CandleChartData } from '../interfaces/charts/candlestick-chart-data';
import { Order } from './order';
import { StrategyResponse } from './strategy-response.interface';
import { ChartRenderableEntities } from '../indicator/dto/sm-indicator-response';
import { Observable, Subject } from 'rxjs';
import { IExchangeClient } from '../interfaces/exchange-client.interface';
import { StrategyStepProcessingResponse } from './strategy-step-processing-response.interface';
import { GeneralTimeIntervals, LogMessageType } from '../types/enums';
import { OrderDirection } from './enum/order-direction.enum';
import { generateOrderRenderables } from './helpers/strategy.helpers';
import { RiskManager } from './risk-manager';

export enum OrderClosedStatus {
  TAKE_PROFIT = 'TAKE_PROFIT',
  STOP_LOSS = 'STOP_LOSS',
}

export abstract class StrategyTemplate {
  protected orders: Order[] = [];
  public abstract TARGET_RISK_REWARD_RATIO: number;
  protected _onInvalidTimeStepProcessing$ = new Subject<{ time: number; symbol: string }>();
  protected _onStepProcessingNoOrders$ = new Subject<{ time: number; symbol: string }>();
  protected _onOrderClosedByStrategy$ = new Subject<Order>();
  protected _onOrderClosedByPrice$ = new Subject<{
    order: Order;
    chartData: CandleChartData[];
    status: OrderClosedStatus;
  }>();
  protected _onTrailStopLoss$ = new Subject<Order>();
  protected _onIntermediateNotification$ = new Subject<{
    type: LogMessageType;
    message?: string;
    candles?: CandleChartData[];
  }>();

  private lastCandles: CandleChartData[] = [];

  constructor(
    protected readonly client: IExchangeClient,
    protected readonly symbol: string,
    public readonly strategyCode: string,
    protected readonly riskManager: RiskManager
  ) {}

  public addOrder(order: Order): void {
    this.orders.push(order);
  }

  public get onIntermediateNotification$(): Observable<{
    type: LogMessageType;
    message?: string;
    candles?: CandleChartData[];
  }> {
    return this._onIntermediateNotification$.asObservable();
  }

  public get onOrderClosedByStrategy$(): Observable<Order> {
    return this._onOrderClosedByStrategy$.asObservable();
  }

  public get onOrderClosedByPrice$(): Observable<{
    order: Order;
    chartData: CandleChartData[];
    status: OrderClosedStatus;
  }> {
    return this._onOrderClosedByPrice$.asObservable();
  }

  public get onTrailStopLoss$(): Observable<Order> {
    return this._onTrailStopLoss$.asObservable();
  }

  public get onInvalidTimeStepProcessing$(): Observable<{ time: number; symbol: string }> {
    return this._onInvalidTimeStepProcessing$.asObservable();
  }

  public get onStepProcessingNoOrders$(): Observable<{ time: number; symbol: string }> {
    return this._onStepProcessingNoOrders$.asObservable();
  }

  public async processStep(
    startTime: number,
    endTime: number
  ): Promise<StrategyStepProcessingResponse> {
    if (!this.canOrdersBeAlive(endTime)) {
      this.processOutOfValidTime(this.lastCandles);
      this._onInvalidTimeStepProcessing$.next({ time: endTime, symbol: this.symbol });
      return this.getNoSignalResponse();
    }

    const candles = await this.client.getCandles(
      this.symbol,
      this.getLowTimeframe(),
      startTime,
      endTime
    );

    this.lastCandles = candles;

    if (candles.length === 0) {
      return this.getNoSignalResponse(candles);
    }

    this.checkAndCloseOrders(this.orders, candles);
    this.verifyExistingOrders(candles);

    const latestCandle = candles[candles.length - 1];
    const { openTime } = latestCandle;

    let analytics: Record<string, string | number | undefined> = {};

    if (this.isValidTimeForNewOrders(endTime)) {
      const indicatorResponse = await this.processCharts(candles, startTime, endTime);

      analytics = indicatorResponse.analytics || {};

      const signalled = indicatorResponse.buySignal || indicatorResponse.sellSignal;

      if (
        signalled &&
        this.isNewOrdersAllowed(
          indicatorResponse.buySignal ? OrderDirection.buy : OrderDirection.sell
        )
      ) {
        const order = this.putOrder(indicatorResponse, candles);

        if (order) {
          return {
            signal: indicatorResponse,
            candles,
            order,
            analytics,
            renderables: generateOrderRenderables(order),
          };
        }
      } else {
        this._onStepProcessingNoOrders$.next({ time: openTime, symbol: this.symbol });
      }
    }

    return this.getNoSignalResponse(candles, analytics);
  }

  public refreshOrders(): void {
    this.orders = [];
  }

  protected putOrder(response: StrategyResponse, candles: CandleChartData[]): Order | undefined {
    if (response.stopLoss && response.takeProfit) {
      const entryPrice = candles[candles.length - 1].close;
      const entryTime = candles[candles.length - 1].openTime + this.getInterval(candles);

      const order = new Order(
        response.sellSignal ? OrderDirection.sell : OrderDirection.buy,
        entryPrice,
        entryTime,
        response.stopLoss,
        response.takeProfit,
        this.strategyCode
      );

      if (response.analytics) {
        order.analytics = response.analytics;
      }

      order.setChartSnapshot(candles, {
        ...response.renderables,
        ...generateOrderRenderables(order),
      });
      this.orders.push(order);

      return order;
    }
  }

  protected getInterval(candles: CandleChartData[]): number {
    return candles[candles.length - 1].openTime - candles[candles.length - 2].openTime;
  }

  protected getNoSignalResponse(
    candles?: CandleChartData[],
    analytics?: Record<string, string | number | undefined>
  ): StrategyStepProcessingResponse {
    return {
      signal: {
        buySignal: false,
        sellSignal: false,
      },
      analytics: analytics || {},
      candles: candles || [],
    };
  }

  private checkAndCloseOrders(orders: Order[], candles: CandleChartData[]): void {
    orders
      .filter(order => !order.isClosed)
      .forEach(async order => {
        if (order.direction === OrderDirection.buy) {
          await this.processClosedBuyOrder(order, candles);
        }
        if (order.direction === OrderDirection.sell) {
          await this.processClosedSellOrder(order, candles);
        }
      });
  }

  private async processClosedBuyOrder(order: Order, candles: CandleChartData[]): Promise<void> {
    const lastCandle = candles[candles.length - 1];

    if (lastCandle.close < order.stopLossPrice) {
      order.close(lastCandle.openTime, lastCandle.close, candles);
      this._onOrderClosedByPrice$.next({
        order,
        chartData: candles,
        status: OrderClosedStatus.STOP_LOSS,
      });
    } else if (lastCandle.close > order.takeProfitPrice) {
      order.close(lastCandle.openTime, lastCandle.close, candles);
      this._onOrderClosedByPrice$.next({
        order,
        chartData: candles,
        status: OrderClosedStatus.TAKE_PROFIT,
      });
    }
  }

  private async processClosedSellOrder(order: Order, candles: CandleChartData[]): Promise<void> {
    const lastCandle = candles[candles.length - 1];

    if (lastCandle.close > order.stopLossPrice) {
      order.close(lastCandle.openTime, lastCandle.close, candles);
      this._onOrderClosedByPrice$.next({
        order,
        chartData: candles,
        status: OrderClosedStatus.STOP_LOSS,
      });
    } else if (lastCandle.close < order.takeProfitPrice) {
      order.close(lastCandle.openTime, lastCandle.close, candles);
      this._onOrderClosedByPrice$.next({
        order,
        chartData: candles,
        status: OrderClosedStatus.TAKE_PROFIT,
      });
    }
  }

  public abstract isValidTimeForNewOrders(timestamp: number): boolean;

  public abstract canOrdersBeAlive(timestamp: number): boolean;

  public abstract processOutOfValidTime(
    candles: CandleChartData[],
    renderables?: Partial<ChartRenderableEntities>
  ): void;

  protected abstract getLowTimeframe(): GeneralTimeIntervals;

  protected abstract verifyExistingOrders(candles: CandleChartData[]): void;

  protected abstract isNewOrdersAllowed(direction: OrderDirection): boolean;

  protected abstract processCharts(
    candles: CandleChartData[],
    originalStartDate: number,
    originalEndDate: number
  ): Promise<StrategyResponse>;
}

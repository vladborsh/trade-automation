import { add } from 'date-fns';
import { DynamoDBClient } from '../core/services/dynamo-db-client';
import { OrderClosedStatus, StrategyTemplate } from './strategy-template';
import { Order } from './order';
import { CandleChartData } from '../interfaces/charts/candlestick-chart-data';
import { ChartCanvasRenderer } from '../core/services/chart-canvas-renderer';
import { Logger } from 'winston';
import { Observable, Subject, takeUntil, throttleTime } from 'rxjs';
import { OrderDirection } from './enum/order-direction.enum';
import { loadFromDto } from './helpers/strategy.helpers';
import { StrategyNotificationMessages } from './strategy-notification-messages';
import { ChartRenderableEntities } from '../indicator/dto/sm-indicator-response';
import { CapitalComClient } from '../core/services/capital-com-client';
import { LogMessageType } from '../types/enums';
import { DynamicConfig } from '../utils/dynamic-config';
import { RiskManager } from './risk-manager';
import { StrategyProvider } from './strategy-provider';
import { isEmpty, isUndefined } from 'lodash';
import { injectable } from 'inversify';

@injectable()
export class StrategyRunner {
  strategies: Record<string, StrategyTemplate> = {};
  private readonly onTerminate$ = new Subject<void>();
  private readonly INVALID_TIME_LOG_INTERVAL = 1000 * 60 * 60;
  private readonly NO_ORDERS_LOG_INTERVAL = 1000 * 60 * 10;

  private messageChannel$ = new Subject<string>();
  private photoMessageChannel$ = new Subject<[string, Buffer]>();

  constructor(
    private dynamoDBClient: DynamoDBClient,
    private chartCanvasRenderer: ChartCanvasRenderer,
    private logger: Logger,
    private strategiesProvider: StrategyProvider,
    private strategyNotificationMessages: StrategyNotificationMessages
  ) {}

  public getMessageChannel$(): Observable<string> {
    return this.messageChannel$.asObservable();
  }
  public getPhotoMessageChannel$(): Observable<[string, Buffer]> {
    return this.photoMessageChannel$.asObservable();
  }

  public async init(): Promise<void> {
    this.strategies = await this.strategiesProvider.getStrategies();
    this.subscribeToStrategyEvents();
    this.loadOrdersFromDb();
  }

  public async execute(): Promise<void> {
    const endTime = Date.now();
    const startTime = add(endTime, { hours: -12 }).getTime();

    for (const strategy of Object.values(this.strategies)) {
      try {
        const { order, candles, renderables, analytics } = await strategy.processStep(
          startTime,
          endTime
        );

        this.logAnalytics(strategy, analytics);

        if (order) {
          this.logNewOrder(strategy.strategyCode, order);
          await this.broadcastToAll(order, strategy.strategyCode, candles, renderables);
          await this.dynamoDBClient.saveOrder(order.mapToDto());
        }
      } catch (e) {
        this.logger.error({
          type: LogMessageType.STRATEGY_EXECUTION_ERROR,
          message: `Error during strategy execution: ${e}, ${strategy.strategyCode}`,
        });
      }
    }
  }

  private async broadcastToAll(
    order: Order,
    symbol: string,
    candles: CandleChartData[],
    renderables?: Partial<ChartRenderableEntities>
  ): Promise<void> {
    try {
      const message = this.strategyNotificationMessages.getMessageForOrder(order, symbol);
      const img = this.chartCanvasRenderer.generateImage(candles, renderables || {});

      this.photoMessageChannel$.next([message, img]);
    } catch (e) {
      this.logger.error({
        type: LogMessageType.BROADCASTING_ERROR,
        message: `Error while broadcasting message to all users: ${e}`,
      });
    }
  }

  private logAnalytics(
    strategy: StrategyTemplate,
    analytics: Record<string, string | number | undefined>
  ): void {
    if (isUndefined(analytics) || isEmpty(analytics)) {
      return;
    }
    this.logger.info({
      strategy: strategy.strategyCode,
      type: LogMessageType.ANALYTICS,
      message: `${JSON.stringify(analytics)}`,
    });
  }

  private async loadOrdersFromDb(): Promise<void> {
    try {
      const orderDtos = await this.dynamoDBClient.getAllOrders();

      for (const orderDto of orderDtos) {
        const strategy = this.strategies[orderDto.strategyCode];

        if (strategy) {
          strategy.addOrder(loadFromDto(orderDto));
        }
      }
    } catch (e) {
      this.logger.error({
        type: LogMessageType.STRATEGY_RUNNER_INIT_ERROR,
        message: `Error while loading orders from db: ${e}`,
      });
    }
  }

  private subscribeToStrategyEvents(): void {
    Object.values(this.strategies).forEach(strategy => {
      this.processStrategyIntermediateNotifications(strategy);
      this.processOrderClosedByPrice(strategy);
      this.processStrategyTrailStopLoss(strategy);
      this.processOrderClosedByStrategy(strategy);
      this.processStrategyInvalidTimeStepProcessing(strategy);
      this.processStrategyStepProcessingNoOrders(strategy);
    });
  }

  private processStrategyIntermediateNotifications(strategy: StrategyTemplate): void {
    strategy.onIntermediateNotification$
      .pipe(takeUntil(this.onTerminate$))
      .subscribe(({ type, message }) => {
        this.logger.info({
          type,
          strategy: strategy.strategyCode,
          message,
        });
      });
  }

  private processOrderClosedByPrice(strategy: StrategyTemplate): void {
    strategy.onOrderClosedByPrice$
      .pipe(takeUntil(this.onTerminate$))
      .subscribe(async ({ order, status }) => {
        this.logger.info({
          type: LogMessageType.ORDER_CLOSED_BY_PRICE,
          strategy: strategy.strategyCode,
          direction: order.direction,
          message: `Order ${order.id} was closed by ${status}`,
        });
        await this.dynamoDBClient.updateOrder(order.mapToDto());
        await this.handleOrderClosedByPrice(strategy.strategyCode, order, status);
      });
  }

  private processStrategyTrailStopLoss(strategy: StrategyTemplate): void {
    strategy.onTrailStopLoss$.pipe(takeUntil(this.onTerminate$)).subscribe(async order => {
      this.logger.info({
        type: LogMessageType.ORDER_TRAIL_STOP_LOSS,
        strategy: strategy.strategyCode,
        message: `Trail stop loss was trailed for order ${order.id}`,
      });
      await this.dynamoDBClient.updateOrder(order.mapToDto())
      await this.handleTrailedStopLoss(strategy.strategyCode, order);
    });
  }

  private processOrderClosedByStrategy(strategy: StrategyTemplate): void {
    strategy.onOrderClosedByStrategy$.pipe(takeUntil(this.onTerminate$)).subscribe(async order => {
      this.logger.info({
        type: LogMessageType.ORDER_CLOSED_BY_STRATEGY,
        strategy: strategy.strategyCode,
        direction: order.direction,
        message: `Order ${order.id} was closed`,
      });
      await this.dynamoDBClient.updateOrder(order.mapToDto())
      await this.handleOrderClosedByStrategy(strategy.strategyCode, order);
    });
  }

  private processStrategyInvalidTimeStepProcessing(strategy: StrategyTemplate): void {
    strategy.onInvalidTimeStepProcessing$
      .pipe(throttleTime(this.INVALID_TIME_LOG_INTERVAL), takeUntil(this.onTerminate$))
      .subscribe(({ time, symbol }) => {
        this.logger.info({
          type: LogMessageType.OUT_OF_CORRECT_TIME,
          message: `Out of correct time, ${symbol} at ${new Date(time).toUTCString()}`,
        });
      });
  }

  private processStrategyStepProcessingNoOrders(strategy: StrategyTemplate): void {
    strategy.onStepProcessingNoOrders$
      .pipe(throttleTime(this.NO_ORDERS_LOG_INTERVAL), takeUntil(this.onTerminate$))
      .subscribe(({ time, symbol }) => {
        this.logger.info({
          type: LogMessageType.NO_ORDERS_LOG,
          message: `No orders, ${symbol} at ${new Date(time).toUTCString()}`,
        });
      });
  }

  private async handleTrailedStopLoss(symbol: string, order: Order) {
    this.messageChannel$.next(this.strategyNotificationMessages.getTrailStopMessage(symbol, order));
  }

  private async handleOrderClosedByPrice(symbol: string, order: Order, status: OrderClosedStatus) {
    try {
      const statusToMessage: Record<OrderClosedStatus, string> = {
        [OrderClosedStatus.TAKE_PROFIT]:
          this.strategyNotificationMessages.getOrderTakeProfitMessage(symbol, order),
        [OrderClosedStatus.STOP_LOSS]: this.strategyNotificationMessages.getOrderStopLossMessage(
          symbol,
          order
        ),
      };
      const message = statusToMessage[status];
      this.messageChannel$.next(message);
    } catch (e) {
      this.logger.error({
        type: LogMessageType.BROADCASTING_ERROR,
        message: `Error while broadcasting message to all users: ${e}`,
      });
    }
  }

  private async handleOrderClosedByStrategy(symbol: string, order: Order) {
    this.messageChannel$.next(this.strategyNotificationMessages.getOrderClosedMessage(symbol, order));
  }

  private logNewOrder(symbol: string, order: Order): void {
    const direction = OrderDirection.buy ? 'buy' : 'sell';
    const title = `New ${direction} order ${symbol.toUpperCase()}`;
    const price = `${order.entryPrice} -> ${order.stopLossPrice} -> ${order.takeProfitPrice}`;

    this.logger.info({
      type: LogMessageType.NEW_ORDER,
      message: `${title}: ${price}, [${new Date().toUTCString()}]`,
      direction: order.direction,
      time: order.entryTime,
    });
  }
}

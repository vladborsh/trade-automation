import { ChartRenderableEntities } from '../indicator/dto/sm-indicator-response';
import { CandleChartData } from '../interfaces/charts/candlestick-chart-data';
import { v4 as uuid4 } from 'uuid';
import { OrderDirection } from './enum/order-direction.enum';
import { OrderDto } from './interfaces/order.dto.interface';

export class Order {
  public id: string | undefined;
  public isClosed = false;
  public isBreakeven = false;
  public closeTime: number | null = null;
  public closePrice: number | null = null;
  public riskRewardRate = 0;
  public initialStopLossSize = 0;
  public profitable: boolean = false;
  public analytics: Record<string, string | number | undefined> = {};

  public entryChartSnapshot?: {
    chartData: CandleChartData[];
    renderables?: Partial<ChartRenderableEntities>;
  };

  public closeChartSnapshot?: {
    chartData: CandleChartData[];
    renderables?: Partial<ChartRenderableEntities>;
  };

  constructor(
    public direction: OrderDirection,
    public entryPrice: number,
    public entryTime: number,
    public stopLossPrice: number,
    public takeProfitPrice: number,
    private strategyCode: string,
    public createdDate = Date.now(),
  ) {
    this.id = uuid4();
    this.initialStopLossSize = Math.abs(this.stopLossPrice - this.entryPrice);
  }

  public mapToDto(): OrderDto {
    return {
      id: this.id,
      direction: this.direction,
      entryPrice: this.entryPrice,
      entryTime: this.entryTime,
      stopLossPrice: this.stopLossPrice,
      takeProfitPrice: this.takeProfitPrice,
      isClosed: this.isClosed,
      isBreakeven: this.isBreakeven,
      closeTime: this.closeTime,
      closePrice: this.closePrice,
      riskRewardRate: this.riskRewardRate,
      initialStopLossSize: this.initialStopLossSize,
      profitable: this.profitable,
      createdDate: this.createdDate,
      strategyCode: this.strategyCode,
    };
  }

  public setChartSnapshot(
    chartData: CandleChartData[],
    renderables?: Partial<ChartRenderableEntities>
  ) {
    this.entryChartSnapshot = { chartData, renderables };
  }

  public trailStopLoss(stopLossRatio: number) {
    const oldStopLoss = this.stopLossPrice;
    if (this.direction === OrderDirection.buy) {
      const newStopLoss = this.entryPrice + stopLossRatio * this.initialStopLossSize;
      if (newStopLoss > oldStopLoss) {
        this.stopLossPrice = newStopLoss;
      }
    } else if (this.direction === OrderDirection.sell) {
      const newStopLoss = this.entryPrice - stopLossRatio * this.initialStopLossSize;
      if (newStopLoss < oldStopLoss) {
        this.stopLossPrice = newStopLoss;
      }
    }
  }

  public close(
    closeTime: number,
    closePrice: number,
    chartData: CandleChartData[],
    renderables?: Partial<ChartRenderableEntities>
  ) {
    this.isClosed = true;
    this.closeTime = closeTime;
    if (this.direction === OrderDirection.buy) {
      this.profitable = this.entryPrice < closePrice;
      if (closePrice < this.stopLossPrice) {
        closePrice = this.stopLossPrice;
      } else if (closePrice > this.takeProfitPrice) {
        closePrice = this.takeProfitPrice;
      }
    } else if (this.direction === OrderDirection.sell) {
      this.profitable = this.entryPrice > closePrice;
      if (closePrice > this.stopLossPrice) {
        closePrice = this.stopLossPrice;
      } else if (closePrice < this.takeProfitPrice) {
        closePrice = this.takeProfitPrice;
      }
    }
    this.closePrice = closePrice;
    if (this.stopLossPrice === this.entryPrice) {
      this.isBreakeven = true;
    }
    this.riskRewardRate = Math.abs(closePrice - this.entryPrice) / this.initialStopLossSize;
    if (!this.profitable && !this.isBreakeven) {
      this.riskRewardRate = -this.riskRewardRate;
    }
    this.closeChartSnapshot = { chartData, renderables };
  }
}

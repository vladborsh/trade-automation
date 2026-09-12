import { ChartRenderableEntities } from "../indicator/dto/sm-indicator-response";
import { CandleChartData } from "../interfaces/charts/candlestick-chart-data";
import { Order } from "./order";
import { StrategyResponse } from "./strategy-response.interface";

export interface StrategyStepProcessingResponse {
  signal: StrategyResponse,
  candles: CandleChartData[],
  analytics: Record<string, string | number | undefined>,
  order?: Order,
  renderables?: Partial<ChartRenderableEntities>,
}

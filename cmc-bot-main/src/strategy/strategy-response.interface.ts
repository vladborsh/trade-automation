import { ChartRenderableEntities } from "../indicator/dto/sm-indicator-response";

export interface StrategyResponse {
  buySignal: boolean,
  sellSignal: boolean,
  takeProfit?: number,
  stopLoss?: number,
  renderables?: Partial<ChartRenderableEntities>,
  analytics?: Record<string, string | number | undefined>,
}

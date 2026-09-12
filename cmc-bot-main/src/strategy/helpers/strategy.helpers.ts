import { ChartRenderableEntities } from "../../indicator/dto/sm-indicator-response";
import { OrderDto } from "../interfaces/order.dto.interface";
import { Order } from "../order";

export function loadFromDto(dto: OrderDto): Order {
  const order = new Order(
    dto.direction,
    dto.entryPrice,
    dto.entryTime,
    dto.stopLossPrice,
    dto.takeProfitPrice,
    dto.strategyCode,
    dto.createdDate,
  );
  order.id = dto.id;
  order.isClosed = dto.isClosed;
  order.isBreakeven = dto.isBreakeven;
  order.closeTime = dto.closeTime;
  order.closePrice = dto.closePrice;
  order.riskRewardRate = dto.riskRewardRate;
  order.initialStopLossSize = dto.initialStopLossSize;
  order.profitable = dto.profitable;
  order.createdDate = dto.createdDate;

  return order;
}

export function generateOrderRenderables(order: Order): Partial<ChartRenderableEntities> {
  return {
    horizontalLines: [
      {
        y: order.entryPrice,
        title: `${order.entryPrice.toFixed(2)}`,
        color: '#777777',
      },
      {
        y: order.stopLossPrice,
        title: `${order.stopLossPrice.toFixed(2)}`,
        color: '#b55d5a',
      },
      {
        y: order.takeProfitPrice,
        title: `${order.takeProfitPrice.toFixed(2)}`,
        color: '#499943',
      },
    ],
  };
}

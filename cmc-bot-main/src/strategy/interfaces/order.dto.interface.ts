import { OrderDirection } from "../enum/order-direction.enum";

export interface OrderDto {
  id?: string;
  direction: OrderDirection;
  entryPrice: number;
  entryTime: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  strategyCode: string;
  isClosed: boolean;
  isBreakeven: boolean;
  closeTime: number | null;
  closePrice: number | null;
  riskRewardRate: number;
  initialStopLossSize: number;
  profitable: boolean;
  createdDate: number;
}

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common';
import {
  CancelRequest,
  CancelRequestSchema,
  CloseRequest,
  CloseRequestSchema,
  CloseResponse,
  ModifyOrderRequest,
  ModifyOrderRequestSchema,
  Order,
  OrderDetail,
  PlaceOrderRequest,
  PlaceOrderRequestSchema,
  PlaceOrderResponse,
  User,
} from '@trade-automation/contracts';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { OrderService } from '../../../backtest/order.service';
import { ZodValidationPipe } from '../../zod-validation.pipe';

/**
 * architecture/backtest-app-system-design.md §7.2 — /api/backtest/sessions/:id/orders.
 * Authenticated by the global AuthGuard; every call is scoped to the cookie user. A replayed
 * `opId` (D9) answers with the same status and the stored body.
 */
@Controller('api/backtest/sessions/:id/orders')
export class OrdersController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  place(
    @CurrentUser() user: User | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PlaceOrderRequestSchema)) body: PlaceOrderRequest,
  ): Promise<PlaceOrderResponse> {
    return this.orders.place(this.ownerId(user), id, body);
  }

  @Get()
  list(@CurrentUser() user: User | undefined, @Param('id') id: string, @Query('status') status?: string): Promise<Order[]> {
    return this.orders.list(this.ownerId(user), id, status);
  }

  @Get(':orderId')
  get(@CurrentUser() user: User | undefined, @Param('id') id: string, @Param('orderId') orderId: string): Promise<OrderDetail> {
    return this.orders.get(this.ownerId(user), id, orderId);
  }

  /** T-033: move the stop and/or target of a pending or open order (decision 23). */
  @Patch(':orderId')
  modify(
    @CurrentUser() user: User | undefined,
    @Param('id') id: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(ModifyOrderRequestSchema)) body: ModifyOrderRequest,
  ): Promise<Order> {
    return this.orders.modify(this.ownerId(user), id, orderId, body);
  }

  @Post(':orderId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: User | undefined,
    @Param('id') id: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(CancelRequestSchema)) body: CancelRequest,
  ): Promise<Order> {
    return this.orders.cancel(this.ownerId(user), id, orderId, body);
  }

  @Post(':orderId/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentUser() user: User | undefined,
    @Param('id') id: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(CloseRequestSchema)) body: CloseRequest,
  ): Promise<CloseResponse> {
    return this.orders.close(this.ownerId(user), id, orderId, body);
  }

  /** 503 without a DB (the guard is then a pass-through and there is no user); otherwise the cookie user. */
  private ownerId(user: User | undefined): string {
    this.orders.assertEnabled();
    if (!user) throw new UnauthorizedException('authentication required');
    return user.id;
  }
}

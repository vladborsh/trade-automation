import { BadRequestException, HttpStatus, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  CancelRequest,
  CloseRequest,
  CloseResponse,
  FillEvent,
  ModifyOrderRequest,
  Order,
  OrderDetail,
  OrderStatusSchema,
  PlaceOrderRequest,
  PlaceOrderResponse,
  SessionSummary,
} from '@trade-automation/contracts';
import {
  computeMae,
  computeStats,
  computeTradeResult,
  marketExitEvent,
  marketFillPrice,
  modifyLevelError,
  modifyReference,
  positionSize,
  toSessionAggregates,
} from '@trade-automation/replay-core';
import { z } from 'zod';
import { apiError } from '../auth/auth-error';
import { CANDLE_STORE, CandleStore } from '../storage/candle-store.port';
import { lastRevealed1m } from './last-revealed';
import { screenshotUrl } from './screenshot-url';
import { orderLevelError, placementOverflows, plannedEntry } from './order-validation';
import { money } from './pg/numeric';
import { MutationOp, runSessionMutation, sessionNotFound, TxRepos } from './session-mutation';
import { BACKTEST_REPOSITORIES, BacktestRepositories } from './session.repository.port';

const UuidSchema = z.string().uuid();

/**
 * architecture/backtest-app-system-design.md §7.2 — orders: place, cancel, manual close, list, get.
 *
 * - Every call is scoped to `userId` (the cookie user): the session is resolved through
 *   `SessionRepository.findById(userId, …)` first, and another user's session is a 404.
 * - Every mutation goes through `runSessionMutation` (D9): one transaction that locks the session
 *   row, replays a seen `opId`, and otherwise stores its response with the mutation.
 * - All fill and money maths is replay-core's (`positionSize`, `marketFillPrice`,
 *   `marketExitEvent`, `computeTradeResult`, `computeMae`, `computeStats`,
 *   `toSessionAggregates`): the client runs the same functions (decision 5).
 */
@Injectable()
export class OrderService {
  constructor(
    @Inject(BACKTEST_REPOSITORIES) private readonly repos: BacktestRepositories | null,
    @Inject(CANDLE_STORE) private readonly store: CandleStore,
  ) {}

  /**
   * POST …/orders. A market order fills now at `lastClose ± half` (`marketFillPrice`) with
   * `entry_time_ms` = the last revealed 1m candle's `openTime`; a limit order is `pending`.
   * `qty` / `riskAmount` come from `positionSize` over the current balance and are fixed here.
   */
  place(userId: string, sessionId: string, req: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    return this.mutate(userId, sessionId, { opId: req.opId, kind: 'place', request: req }, async (tx, session) => {
      assertTradable(session, req.cursorMs);
      const panel = session.layout.panels.find((p) => p.id === req.panelId);
      if (!panel) throw new BadRequestException(`Unknown panelId '${req.panelId}' for this session.`);

      const last = await this.lastBar(panel.instrument, session.cursorMs);
      const levelError = orderLevelError(req, last.close);
      if (levelError) throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, levelError, levelMessage(levelError));
      if (!(session.balance > 0)) {
        throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BALANCE_NOT_POSITIVE', 'The session balance is not positive; the order cannot be sized.');
      }
      const { qty, riskAmount } = positionSize(session.balance, req.riskPct, plannedEntry(req, last.close), req.sl);
      const market = req.type === 'market';
      const entryPrice = market ? marketFillPrice(req.side, last.close, session.costs) : null;
      if (placementOverflows({ qty, riskAmount, entryPrice })) {
        throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, 'STOP_DISTANCE_ZERO', 'The stop is too close to the entry to size this order within limits.');
      }

      const order = await tx.orders.insert({
        sessionId: session.id,
        seq: await tx.orders.nextSeq(session.id),
        panelId: panel.id,
        instrument: panel.instrument,
        side: req.side,
        type: req.type,
        status: market ? 'open' : 'pending',
        placedAtMs: session.cursorMs,
        limitPrice: market ? null : (req.limitPrice as number),
        entryPrice,
        entryTimeMs: market ? last.openTime : null,
        qty,
        riskPct: req.riskPct,
        riskAmountCcy: riskAmount,
        sl: req.sl,
        tp: req.tp ?? null,
        fillResolution: market ? '1m' : null,
      });
      const events: FillEvent[] = market
        ? [{ orderId: order.id, kind: 'fill', time: order.entryTimeMs as number, price: order.entryPrice as number, resolution: '1m' }]
        : [];
      return { order, events };
    });
  }

  /** POST …/orders/:orderId/cancel — pending only (409 `ORDER_NOT_PENDING`). */
  cancel(userId: string, sessionId: string, orderId: string, req: CancelRequest): Promise<Order> {
    return this.mutate(userId, sessionId, { opId: req.opId, kind: 'cancel', request: req, orderId }, async (tx, session) => {
      assertTradable(session, req.cursorMs);
      const order = await this.lockOrder(tx, session.id, orderId);
      if (order.status !== 'pending') {
        throw apiError(HttpStatus.CONFLICT, 'ORDER_NOT_PENDING', `Only a pending order can be cancelled (this one is ${order.status}).`);
      }
      return (await tx.orders.cancel(session.id, order.id, session.cursorMs)) as Order;
    });
  }

  /**
   * POST …/orders/:orderId/close — open only (409 `ORDER_NOT_OPEN`). A market exit at the last
   * revealed 1m close (`marketExitEvent`, `close_reason='manual'`); costs, PnL, R and MAE from
   * replay-core; then the balance and the aggregate columns, all in the one transaction.
   */
  close(userId: string, sessionId: string, orderId: string, req: CloseRequest): Promise<CloseResponse> {
    return this.mutate(userId, sessionId, { opId: req.opId, kind: 'close', request: req, orderId }, async (tx, session) => {
      assertTradable(session, req.cursorMs);
      const order = await this.lockOrder(tx, session.id, orderId);
      if (order.status !== 'open') {
        throw apiError(HttpStatus.CONFLICT, 'ORDER_NOT_OPEN', `Only an open order can be closed (this one is ${order.status}).`);
      }
      const entryTimeMs = order.entryTimeMs as number;
      const last = await this.lastBar(order.instrument, session.cursorMs);
      const exit = marketExitEvent(order, last, 'manual', session.costs);
      const result = computeTradeResult(order, exit, session.costs);
      const path = await this.store.query(order.instrument, '1m', entryTimeMs, exit.time);
      const mae = computeMae({ ...order, exitTimeMs: exit.time }, path);

      const closed = (await tx.orders.close(session.id, order.id, {
        exitPrice: exit.price,
        exitTimeMs: exit.time,
        closeReason: 'manual',
        fillResolution: order.fillResolution ?? '1m',
        slTpSameBar: false,
        ...result,
        ...mae,
      })) as Order;

      const stats = computeStats(await tx.orders.listClosedForStats(session.id), session.initialBalance, session.periodFromMs);
      const updated = await tx.sessions.applyTradeClose(
        userId,
        session.id,
        session.balance + (closed.pnlCcy as number),
        toSessionAggregates(stats, Date.now()),
      );
      return { order: closed, stats, balance: (updated as SessionSummary).balance };
    });
  }

  /**
   * PATCH …/orders/:orderId (decision 23, T-033) — moves the stop and/or target of a pending or open
   * order (409 `ORDER_NOT_ACTIVE` otherwise). The new levels are checked by replay-core's
   * `modifyLevelError`, the rule the client's handles apply too: a pending order against its limit
   * (as at placement), an open one against the last revealed 1m close. `sl_initial` and
   * `risk_amount_ccy` never change, so R stays anchored to the placement risk. One
   * `order_modifications` row per level whose stored value changes, at the cursor, in the same
   * transaction; a move to the current value changes nothing and writes no row.
   */
  modify(userId: string, sessionId: string, orderId: string, req: ModifyOrderRequest): Promise<Order> {
    if (req.sl === undefined && req.tp === undefined) {
      return Promise.reject(new BadRequestException('Nothing to modify: give sl, tp or both.'));
    }
    return this.mutate(userId, sessionId, { opId: req.opId, kind: 'modify', request: req, orderId }, async (tx, session) => {
      assertTradable(session, req.cursorMs);
      const order = await this.lockOrder(tx, session.id, orderId);
      if (order.status !== 'pending' && order.status !== 'open') {
        throw apiError(HttpStatus.CONFLICT, 'ORDER_NOT_ACTIVE', `Only a pending or open order can be modified (this one is ${order.status}).`);
      }
      const changes: { field: 'sl' | 'tp'; oldValue: number | null; newValue: number }[] = [];
      if (req.sl !== undefined && money(req.sl) !== order.slCurrent) changes.push({ field: 'sl', oldValue: order.slCurrent, newValue: req.sl });
      if (req.tp !== undefined && money(req.tp) !== order.tpCurrent) changes.push({ field: 'tp', oldValue: order.tpCurrent, newValue: req.tp });
      if (changes.length === 0) return order;

      const levels = Object.fromEntries(changes.map((c) => [c.field, c.newValue])) as { sl?: number; tp?: number };
      const modifiable = { side: order.side, status: order.status, limitPrice: order.limitPrice };
      const lastClose = order.status === 'open' ? (await this.lastBar(order.instrument, session.cursorMs)).close : NaN;
      const levelError =
        levels.sl !== undefined && money(levels.sl) === money(modifyReference(modifiable, lastClose))
          ? 'STOP_DISTANCE_ZERO' // equal at column precision, as at placement
          : modifyLevelError(modifiable, levels, lastClose);
      if (levelError) throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, levelError, modifyMessage(levelError, order.status));

      const updated = (await tx.orders.updateLevels(session.id, order.id, levels)) as Order;
      for (const c of changes) {
        await tx.orders.insertModification({ orderId: order.id, cursorMs: session.cursorMs, ...c });
      }
      return updated;
    });
  }

  /** GET …/orders?status= — the journal, by `seq`. */
  async list(userId: string, sessionId: string, status?: string): Promise<Order[]> {
    const parsed = OrderStatusSchema.optional().safeParse(status);
    if (!parsed.success) throw new BadRequestException(`Unknown status '${status}'.`);
    const repos = this.requireEnabled();
    const session = await this.findSession(repos, userId, sessionId);
    return repos.orders.list(session.id, parsed.data ? [parsed.data] : undefined);
  }

  /** GET …/orders/:orderId — with its modifications and the URLs of its stored screenshots (T-025). */
  async get(userId: string, sessionId: string, orderId: string): Promise<OrderDetail> {
    const repos = this.requireEnabled();
    const session = await this.findSession(repos, userId, sessionId);
    const order = UuidSchema.safeParse(orderId).success ? await repos.orders.findById(session.id, orderId) : null;
    if (!order) throw new NotFoundException('Order not found.');
    const [modifications, shots] = await Promise.all([repos.orders.listModifications(order.id), repos.screenshots.listByOrder(order.id)]);
    const screenshots: OrderDetail['screenshots'] = {};
    for (const s of shots) screenshots[s.kind] = screenshotUrl(session.id, order.id, s.kind);
    return { order, modifications, screenshots };
  }

  /** 503 when the DB module is disabled. */
  assertEnabled(): void {
    this.requireEnabled();
  }

  private mutate<T>(userId: string, sessionId: string, op: MutationOp, fn: (tx: TxRepos, session: SessionSummary) => Promise<T>): Promise<T> {
    return runSessionMutation(this.requireEnabled(), userId, sessionId, op, fn);
  }

  private async findSession(repos: BacktestRepositories, userId: string, sessionId: string): Promise<SessionSummary> {
    const session = UuidSchema.safeParse(sessionId).success ? await repos.sessions.findById(userId, sessionId) : null;
    if (!session) throw sessionNotFound();
    return session;
  }

  private async lockOrder(tx: TxRepos, sessionId: string, orderId: string): Promise<Order> {
    const order = UuidSchema.safeParse(orderId).success ? await tx.orders.findById(sessionId, orderId, { forUpdate: true }) : null;
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  private async lastBar(instrument: Order['instrument'], cursorMs: number) {
    const last = await lastRevealed1m(this.store, instrument, cursorMs);
    if (!last) {
      throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, 'NO_PRICE_AT_CURSOR', `No 1m candle of ${instrument} is revealed at the cursor.`);
    }
    return last;
  }

  private requireEnabled(): BacktestRepositories {
    if (!this.repos) throw new ServiceUnavailableException('backtest disabled: DATABASE_URL not set');
    return this.repos;
  }
}

/** 409 `SESSION_COMPLETE`, then 409 `CURSOR_MISMATCH` (§5.5: an order op carries the cursor it was made at). */
function assertTradable(session: SessionSummary, cursorMs: number): void {
  if (session.status === 'complete') throw apiError(HttpStatus.CONFLICT, 'SESSION_COMPLETE', 'The session is complete.');
  if (cursorMs !== session.cursorMs) {
    throw apiError(HttpStatus.CONFLICT, 'CURSOR_MISMATCH', `cursorMs ${cursorMs} does not match the session cursor ${session.cursorMs}.`);
  }
}

/** T-033: what the moved level was checked against — the limit, or the market for an open position. */
function modifyMessage(code: string, status: 'pending' | 'open'): string {
  const against = status === 'pending' ? 'the limit' : 'the last close';
  switch (code) {
    case 'STOP_DISTANCE_ZERO':
      return `The stop is too close to ${against}.`;
    case 'SL_ON_WRONG_SIDE':
      return `A long stop must be below ${against}, a short stop above it.`;
    default:
      return `A long target must be above ${against}, a short target below it.`;
  }
}

function levelMessage(code: string): string {
  switch (code) {
    case 'LIMIT_ON_WRONG_SIDE':
      return 'A long limit must be below the last close, a short limit above it (stop entries are not supported).';
    case 'STOP_DISTANCE_ZERO':
      return 'The stop is too close to the entry to size this order.';
    case 'SL_ON_WRONG_SIDE':
      return 'A long stop must be below the entry, a short stop above it.';
    default:
      return 'A long target must be above the entry, a short target below it.';
  }
}

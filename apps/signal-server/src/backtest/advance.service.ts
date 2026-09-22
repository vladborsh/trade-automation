import { BadRequestException, HttpStatus, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  AdvanceRequest,
  AdvanceResult,
  CloseReason,
  FillEvent,
  FillResolution,
  InstrumentId,
  Order,
  SessionSummary,
  TIMEFRAME_MS,
  Timeframe,
} from '@trade-automation/contracts';
import {
  EngineFillEvent,
  PathBar,
  computeMae,
  computeStats,
  computeTradeResult,
  evaluateOrder,
  marketExitEvent,
  toSessionAggregates,
  walkBarsPessimistic,
} from '@trade-automation/replay-core';
import { apiError } from '../auth/auth-error';
import { CANDLE_STORE, CandleStore } from '../storage/candle-store.port';
import { lastRevealed1m } from './last-revealed';
import { runSessionMutation, TxRepos } from './session-mutation';
import { BACKTEST_REPOSITORIES, BacktestRepositories } from './session.repository.port';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

interface Span {
  bars: PathBar[];
  resolution: FillResolution;
}

interface Exit {
  order: Order;
  event: EngineFillEvent;
}

/**
 * architecture/backtest-app-system-design.md §5.5 — POST …/advance `{opId, toCursorMs}`, D4.
 * One `runSessionMutation` (session row locked, the same request under a seen `opId` replayed, a
 * different one refused with 409, the response stored), then:
 *
 * 1. 409 `SESSION_COMPLETE`; 400 for a `toCursorMs` not on a minute (every cursor a client
 *    produces is a bar close); 409 `CURSOR_BACKWARDS` when it is before the cursor. A target past
 *    `period_to_ms` is clamped to it. An equal cursor is a no-op that returns the current state.
 * 2. **The span** is exactly the 1m candles newly revealed (§5.1: revealed when
 *    `openTime + 60 000 <= cursor`), i.e. `openTime` in `[cursor_ms, toCursorMs - 60 000]`, per
 *    instrument with pending/open orders. With no 1m in the span, the session-timeframe bars fully
 *    closed inside it are walked with `walkBarsPessimistic` and every row they touch is flagged
 *    `fill_resolution='pessimistic-bar'` (decision 4). Neither → nothing happens for it.
 * 3. `evaluateOrder` per order (seq order): fills are written as they come; exits are then applied
 *    **in exit-time order across instruments** (tie: seq) — costs, PnL, R from
 *    `computeTradeResult`, MAE from `computeMae` over the 1m path `[entry, exit]` (the session-tf
 *    bars for a pessimistic-bar trade), `balance += pnl` per close.
 * 4. When the target reaches `period_to_ms` (decision 28): every still-open position is closed as
 *    a market exit (`marketExitEvent`, `end-of-session`) at the last revealed 1m, pending orders are
 *    cancelled at `period_to_ms`, the session becomes `complete`.
 * 5. The cursor is written; when anything closed, the balance and the aggregate columns
 *    (`toSessionAggregates(computeStats(…))`) too — all in the one transaction.
 *
 * Response: `{cursorMs, status, balance, events (chronological), orders (every row touched, by
 * seq), stats}`.
 */
@Injectable()
export class AdvanceService {
  constructor(
    @Inject(BACKTEST_REPOSITORIES) private readonly repos: BacktestRepositories | null,
    @Inject(CANDLE_STORE) private readonly store: CandleStore,
  ) {}

  advance(userId: string, sessionId: string, req: AdvanceRequest): Promise<AdvanceResult> {
    return runSessionMutation(this.requireEnabled(), userId, sessionId, { opId: req.opId, kind: 'advance', request: req }, (tx, session) =>
      this.apply(tx, userId, session, req.toCursorMs),
    );
  }

  /** 503 when the DB module is disabled. */
  assertEnabled(): void {
    this.requireEnabled();
  }

  private async apply(tx: TxRepos, userId: string, session: SessionSummary, requested: number): Promise<AdvanceResult> {
    if (session.status === 'complete') throw apiError(HttpStatus.CONFLICT, 'SESSION_COMPLETE', 'The session is complete.');
    if (requested % MIN !== 0) throw apiError(HttpStatus.BAD_REQUEST, 'CURSOR_OFF_MINUTE', 'toCursorMs must be on a minute boundary.');
    if (requested < session.cursorMs) {
      throw apiError(HttpStatus.CONFLICT, 'CURSOR_BACKWARDS', `toCursorMs ${requested} is before the cursor ${session.cursorMs}.`);
    }
    const from = session.cursorMs;
    const to = Math.min(requested, session.periodToMs);
    const ending = to === session.periodToMs;
    const costs = session.costs;

    const live = await tx.orders.list(session.id, ['pending', 'open']);
    const current = new Map(live.map((o) => [o.id, o]));
    const touched = new Set<string>();
    const events: FillEvent[] = [];
    const exits: Exit[] = [];

    // steps 2-3a: walk the span per instrument; write fills as they come, collect exits
    if (to > from) {
      for (const [instrument, orders] of groupByInstrument(live)) {
        const span = await this.span(instrument, session.timeframe, from, to);
        if (!span) continue;
        for (const order of orders) {
          const walked = span.resolution === '1m' ? evaluateOrder(order, span.bars, costs) : walkBarsPessimistic(order, span.bars, costs);
          for (const event of walked) {
            if (event.kind === 'fill') {
              const filled = (await tx.orders.fill(session.id, order.id, {
                entryPrice: event.price,
                entryTimeMs: event.time,
                fillResolution: event.resolution,
              })) as Order;
              current.set(filled.id, filled);
              touched.add(filled.id);
              events.push(wireEvent(event));
            } else {
              exits.push({ order: current.get(order.id) as Order, event });
            }
          }
        }
      }
    }

    // step 3b: exits in exit-time order across instruments, balance per close
    let balance = session.balance;
    let closedCount = 0;
    const close = async (order: Order, event: EngineFillEvent) => {
      const closed = await this.closeTrade(tx, session, order, event);
      current.set(closed.id, closed);
      touched.add(closed.id);
      events.push(wireEvent(event));
      balance += closed.pnlCcy as number;
      closedCount++;
    };
    exits.sort((a, b) => a.event.time - b.event.time || a.order.seq - b.order.seq);
    for (const { order, event } of exits) await close(order, event);

    // step 4: end of session — force-close what is open, cancel what is pending
    if (ending) {
      const remaining = [...current.values()].sort((a, b) => a.seq - b.seq);
      for (const order of remaining.filter((o) => o.status === 'open')) {
        const last = await this.lastPrice(order.instrument, session.timeframe, to, order.entryTimeMs as number);
        await close(order, marketExitEvent(order, last.bar, 'end-of-session', costs, last.resolution));
      }
      for (const order of remaining.filter((o) => o.status === 'pending')) {
        const cancelled = (await tx.orders.cancel(session.id, order.id, to)) as Order;
        current.set(cancelled.id, cancelled);
        touched.add(cancelled.id);
      }
    }

    // step 5: cursor, then balance + aggregates when anything closed
    await tx.sessions.advanceCursor(userId, session.id, to, ending);
    const stats = computeStats(await tx.orders.listClosedForStats(session.id), session.initialBalance, session.periodFromMs);
    if (closedCount > 0) {
      const updated = await tx.sessions.applyTradeClose(userId, session.id, balance, toSessionAggregates(stats, Date.now()));
      balance = (updated as SessionSummary).balance;
    }

    const seqOf = new Map([...current.values()].map((o) => [o.id, o.seq]));
    return {
      cursorMs: to,
      status: ending ? 'complete' : session.status,
      balance,
      events: events.sort(
        (a, b) => a.time - b.time || kindRank(a) - kindRank(b) || (seqOf.get(a.orderId) as number) - (seqOf.get(b.orderId) as number),
      ),
      orders: [...touched].map((id) => current.get(id) as Order).sort((a, b) => a.seq - b.seq),
      stats,
    };
  }

  /** Step 2: the newly revealed 1m of the span, else the session-tf bars fully closed inside it. */
  private async span(instrument: InstrumentId, tf: Timeframe, from: number, to: number): Promise<Span | null> {
    const bars1m = await this.store.query(instrument, '1m', from, to - MIN);
    if (bars1m.length > 0) return { bars: bars1m, resolution: '1m' };
    const bars = await this.closedTfBars(instrument, tf, from, to);
    return bars.length > 0 ? { bars, resolution: 'pessimistic-bar' } : null;
  }

  /** Session-tf bars with `openTime >= from` and `openTime + tfMs <= to` — never a forming bar. */
  private async closedTfBars(instrument: InstrumentId, tf: Timeframe, from: number, to: number): Promise<PathBar[]> {
    if (tf === '1m') return [];
    const tfMs = TIMEFRAME_MS[tf];
    if (to - tfMs < from) return [];
    return (await this.store.query(instrument, tf, from, to - tfMs)).filter((b) => b.openTime >= from && b.openTime + tfMs <= to);
  }

  /** Costs, PnL, R and MAE for one exit, written to the row (step 3). */
  private async closeTrade(tx: TxRepos, session: SessionSummary, order: Order, event: EngineFillEvent): Promise<Order> {
    const result = computeTradeResult(order, event, session.costs);
    const pessimistic = order.fillResolution === 'pessimistic-bar' || event.resolution === 'pessimistic-bar';
    const mae = computeMae({ ...order, exitTimeMs: event.time }, await this.maePath(order, session.timeframe, event.time, pessimistic));
    return (await tx.orders.close(session.id, order.id, {
      exitPrice: event.price,
      exitTimeMs: event.time,
      closeReason: event.reason as CloseReason,
      fillResolution: pessimistic ? 'pessimistic-bar' : '1m',
      slTpSameBar: event.slTpSameBar === true,
      ...result,
      ...mae,
    })) as Order;
  }

  /**
   * MAE path over `[entry, exit]` (T-005 window rule applied by `computeMae`): the 1m candles; for a
   * pessimistic-bar trade the session-tf bars, the same bars that resolved it.
   */
  private async maePath(order: Order, tf: Timeframe, exitTimeMs: number, pessimistic: boolean): Promise<PathBar[]> {
    const entry = order.entryTimeMs as number;
    return this.store.query(order.instrument, pessimistic && tf !== '1m' ? tf : '1m', entry, exitTimeMs);
  }

  /**
   * Step 4's price: the last revealed 1m at `to`, searched back as far as the position's entry (so
   * a position always finds at least its entry candle, even when the period runs past the tape).
   * For an instrument with no 1m, the last session-tf bar closed by `to`, flagged pessimistic.
   * Neither → 422 `NO_PRICE_AT_CURSOR` and the whole advance rolls back.
   */
  private async lastPrice(instrument: InstrumentId, tf: Timeframe, to: number, sinceMs: number): Promise<{ bar: PathBar; resolution: FillResolution }> {
    const lookbackDays = Math.ceil((to - sinceMs) / DAY) + 1;
    const bar1m = await lastRevealed1m(this.store, instrument, to, lookbackDays);
    if (bar1m) return { bar: bar1m, resolution: '1m' };
    const bars = await this.closedTfBars(instrument, tf, sinceMs, to);
    if (bars.length > 0) return { bar: bars[bars.length - 1], resolution: 'pessimistic-bar' };
    throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, 'NO_PRICE_AT_CURSOR', `No price of ${instrument} to close the position at.`);
  }

  private requireEnabled(): BacktestRepositories {
    if (!this.repos) throw new ServiceUnavailableException('backtest disabled: DATABASE_URL not set');
    return this.repos;
  }
}

function groupByInstrument(orders: readonly Order[]): Map<InstrumentId, Order[]> {
  const groups = new Map<InstrumentId, Order[]>();
  for (const o of orders) groups.set(o.instrument, [...(groups.get(o.instrument) ?? []), o]);
  return groups;
}

/** The contract `FillEvent` (drops the engine-only `slTpSameBar`, which lives on the row). */
function wireEvent(e: EngineFillEvent): FillEvent {
  const { slTpSameBar: _sameBar, ...event } = e;
  return event;
}

function kindRank(e: FillEvent): number {
  return e.kind === 'fill' ? 0 : 1;
}

import { randomUUID } from 'crypto';
import { Candle, Coverage, InstrumentId, Order, SessionAggregates, SessionSummary, Timeframe } from '@trade-automation/contracts';
import type { StatsOrder } from '@trade-automation/replay-core';
import { OpsRepository } from '../../src/backtest/ops.repository.port';
import { NewOrder, OrderClose, OrderFill, OrderRepository } from '../../src/backtest/order.repository.port';
import { money, percent, rMultiple } from '../../src/backtest/pg/numeric';
import { BacktestRepositories, NewSession, SessionRepository } from '../../src/backtest/session.repository.port';
import { SessionService } from '../../src/backtest/session.service';

/** In-memory `BacktestRepositories`; `transaction` runs inline (no rollback) — PG behaviour is in the integration spec. */
export class FakeBacktestRepositories implements BacktestRepositories {
  readonly rows = new Map<string, { userId: string; session: SessionSummary }>();
  private clock = 1_000;
  /** Closed orders per session id seeded directly, as `listClosedForStats` returns them. */
  readonly closedOrders = new Map<string, StatsOrder[]>();
  /** Every order row, by id (T-015). */
  readonly orderRows = new Map<string, Order>();
  /** `backtest_ops`, keyed `sessionId|opId`; stored as JSON text like the jsonb column. */
  readonly opRows = new Map<string, string>();

  private ordersOf(sessionId: string): Order[] {
    return [...this.orderRows.values()].filter((o) => o.sessionId === sessionId).sort((a, b) => a.seq - b.seq);
  }

  private patchOrder(sessionId: string, orderId: string, from: Order['status'], patch: Partial<Order>): Order | null {
    const row = this.orderRows.get(orderId);
    if (!row || row.sessionId !== sessionId || row.status !== from) return null;
    Object.assign(row, patch, { updatedAt: this.clock++ });
    return { ...row };
  }

  readonly orders: OrderRepository = {
    listClosedForStats: jest.fn(async (sessionId: string) => [
      ...(this.closedOrders.get(sessionId) ?? []),
      ...this.ordersOf(sessionId).filter((o) => o.status === 'closed'),
    ]),
    nextSeq: async (sessionId) => Math.max(0, ...this.ordersOf(sessionId).map((o) => o.seq)) + 1,
    insert: async (o: NewOrder) => {
      const now = this.clock++;
      const row: Order = {
        id: randomUUID(), sessionId: o.sessionId, seq: o.seq, panelId: o.panelId, instrument: o.instrument,
        side: o.side, type: o.type, status: o.status, placedAtMs: o.placedAtMs,
        limitPrice: money(o.limitPrice), entryPrice: money(o.entryPrice), entryTimeMs: o.entryTimeMs,
        qty: money(o.qty), riskPct: percent(o.riskPct), riskAmountCcy: money(o.riskAmountCcy),
        slInitial: money(o.sl), slCurrent: money(o.sl), tpInitial: money(o.tp), tpCurrent: money(o.tp),
        exitPrice: null, exitTimeMs: null, closeReason: null, fillResolution: o.fillResolution, slTpSameBar: false,
        commissionCcy: 0, spreadCostCcy: 0, pnlCcy: null, pnlR: null, maePrice: null, maeR: null,
        cancelledAtMs: null, createdAt: now, updatedAt: now,
      };
      this.orderRows.set(row.id, row);
      return { ...row };
    },
    findById: async (sessionId, orderId) => {
      const row = this.orderRows.get(orderId);
      return row && row.sessionId === sessionId ? { ...row } : null;
    },
    list: async (sessionId, statuses) =>
      this.ordersOf(sessionId).filter((o) => !statuses || statuses.includes(o.status)).map((o) => ({ ...o })),
    listModifications: async () => [],
    fill: async (sessionId, orderId, f: OrderFill) =>
      this.patchOrder(sessionId, orderId, 'pending', {
        status: 'open', entryPrice: money(f.entryPrice), entryTimeMs: f.entryTimeMs, fillResolution: f.fillResolution,
      }),
    cancel: async (sessionId, orderId, cancelledAtMs) =>
      this.patchOrder(sessionId, orderId, 'pending', { status: 'cancelled', cancelledAtMs }),
    close: async (sessionId, orderId, c: OrderClose) =>
      this.patchOrder(sessionId, orderId, 'open', {
        status: 'closed', exitPrice: money(c.exitPrice), exitTimeMs: c.exitTimeMs, closeReason: c.closeReason,
        fillResolution: c.fillResolution, slTpSameBar: c.slTpSameBar, commissionCcy: money(c.commissionCcy), spreadCostCcy: money(c.spreadCostCcy),
        pnlCcy: money(c.pnlCcy), pnlR: rMultiple(c.pnlR), maePrice: money(c.maePrice), maeR: rMultiple(c.maeR),
      }),
  };

  readonly ops: OpsRepository = {
    find: async (sessionId, opId) => {
      const stored = this.opRows.get(`${sessionId}|${opId}`);
      return stored === undefined ? null : JSON.parse(stored);
    },
    save: async (sessionId, opId, response) => {
      this.opRows.set(`${sessionId}|${opId}`, JSON.stringify(response));
    },
  };

  readonly sessions: SessionRepository = {
    insert: async (userId, s: NewSession) => {
      const now = this.clock++;
      const session: SessionSummary = {
        id: randomUUID(),
        name: s.name,
        status: 'active',
        sessionCurrency: s.sessionCurrency,
        timeframe: s.timeframe,
        periodFromMs: s.periodFromMs,
        periodToMs: s.periodToMs,
        cursorMs: s.periodFromMs,
        initialBalance: s.initialBalance,
        balance: s.initialBalance,
        defaultRiskPct: s.defaultRiskPct,
        costs: s.costs,
        skipWeekends: s.skipWeekends,
        notionalWarnMultiple: s.notionalWarnMultiple,
        layout: structuredClone(s.layout),
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        tradesCount: 0,
        winsCount: 0,
        lossesCount: 0,
        pnlCcy: 0,
        pnlR: 0,
        profitFactor: null,
        maxDrawdownCcy: 0,
        maxDrawdownR: 0,
        avgWinCcy: null,
        avgWinR: null,
        avgLossCcy: null,
        avgLossR: null,
        statsComputedAt: null,
      };
      this.rows.set(session.id, { userId, session });
      return session;
    },
    listByUser: async (userId) =>
      [...this.rows.values()].filter((r) => r.userId === userId).map((r) => r.session).sort((a, b) => b.createdAt - a.createdAt),
    findById: async (userId, id) => {
      const row = this.rows.get(id);
      return row && row.userId === userId ? row.session : null;
    },
    update: async (userId, id, patch: { name?: string; timeframe?: Timeframe }) => {
      const row = this.rows.get(id);
      if (!row || row.userId !== userId) return null;
      Object.assign(row.session, {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.timeframe !== undefined && { timeframe: patch.timeframe }),
        updatedAt: this.clock++,
      });
      return row.session;
    },
    delete: async (userId, id) => {
      const row = this.rows.get(id);
      if (!row || row.userId !== userId) return false;
      return this.rows.delete(id);
    },
    advanceCursor: async (userId, id, cursorMs: number, complete: boolean) => {
      const row = this.rows.get(id);
      if (!row || row.userId !== userId) return null;
      const now = this.clock++;
      Object.assign(row.session, { cursorMs, updatedAt: now, ...(complete && { status: 'complete', completedAt: now }) });
      return row.session;
    },
    applyTradeClose: async (userId, id, balance: number, a: SessionAggregates) => {
      const row = this.rows.get(id);
      if (!row || row.userId !== userId) return null;
      Object.assign(row.session, { ...a, balance: money(balance), updatedAt: this.clock++ });
      return row.session;
    },
  };

  transaction<T>(fn: (repos: Omit<BacktestRepositories, 'transaction'>) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

export const DAY = 86_400_000;
export const T0 = Date.UTC(2026, 0, 1);

export const INSTRUMENTS = [
  { id: 'binance:BTCUSDT', sessionCurrency: 'USD' },
  { id: 'binance:ETHUSDT', sessionCurrency: 'USD' },
  { id: 'capitalcom:EURCHF', sessionCurrency: 'CHF' },
  { id: 'capitalcom:US100', sessionCurrency: 'USD' },
] as const;

/** 30 days of 1m for everything except US100, which has none. */
export const COVERAGE: Record<string, Coverage | null> = {
  'binance:BTCUSDT': { from: T0, to: T0 + 30 * DAY },
  'binance:ETHUSDT': { from: T0, to: T0 + 30 * DAY },
  'capitalcom:EURCHF': { from: T0, to: T0 + 30 * DAY },
  'capitalcom:US100': null,
};

export function fakeStore(coverage: Record<string, Coverage | null> = COVERAGE) {
  return { coverage: jest.fn(async (id: InstrumentId) => coverage[id] ?? null) } as never;
}

export function fakeInstrumentConfig() {
  return { instruments: INSTRUMENTS } as never;
}

export function makeSessionService(repos: FakeBacktestRepositories | null, store = fakeStore()) {
  return new SessionService(repos, fakeInstrumentConfig(), store);
}

export function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'BTC practice',
    layout: {
      id: 'crypto',
      name: 'Crypto',
      grid: { columns: 2, rows: 1 },
      panels: [
        { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT' },
        { id: 'eth', kind: 'candles', instrument: 'binance:ETHUSDT', signals: true },
      ],
    },
    timeframe: '15m',
    periodFromMs: T0 + 5 * DAY,
    periodToMs: T0 + 10 * DAY,
    initialBalance: 10_000,
    defaultRiskPct: 1,
    costs: { enabled: true, commissionPct: 0.04, spread: 0.5 },
    ...overrides,
  };
}

/** A 1m candle of `instrument` (T-015 order specs). */
export function m1(instrument: InstrumentId, openTime: number, o: number, h: number, l: number, c: number): Candle {
  return { instrument, timeframe: '1m', openTime, open: o, high: h, low: l, close: c, volume: 1, closed: true, source: 'venue-rest' };
}

/** In-memory `CandleStore` over a fixed set of 1m candles: `coverage` and `query` only. */
export function candleStore(bars: Candle[]) {
  const of = (id: InstrumentId) => bars.filter((b) => b.instrument === id).sort((a, b) => a.openTime - b.openTime);
  return {
    coverage: jest.fn(async (id: InstrumentId) => {
      const own = of(id);
      return own.length ? { from: own[0].openTime, to: own[own.length - 1].openTime } : null;
    }),
    query: jest.fn(async (id: InstrumentId, tf: Timeframe, from: number, to: number) =>
      tf === '1m' ? of(id).filter((b) => b.openTime >= from && b.openTime <= to) : [],
    ),
  } as never;
}

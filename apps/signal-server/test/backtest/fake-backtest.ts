import { randomUUID } from 'crypto';
import { Coverage, InstrumentId, SessionSummary, Timeframe } from '@trade-automation/contracts';
import type { StatsOrder } from '@trade-automation/replay-core';
import { OrderRepository } from '../../src/backtest/order.repository.port';
import { BacktestRepositories, NewSession, SessionRepository } from '../../src/backtest/session.repository.port';
import { SessionService } from '../../src/backtest/session.service';

/** In-memory `BacktestRepositories`; `transaction` runs inline (no rollback) — PG behaviour is in the integration spec. */
export class FakeBacktestRepositories implements BacktestRepositories {
  readonly rows = new Map<string, { userId: string; session: SessionSummary }>();
  private clock = 1_000;
  /** Closed orders per session id, as `listClosedForStats` returns them. */
  readonly closedOrders = new Map<string, StatsOrder[]>();

  readonly orders: OrderRepository = {
    listClosedForStats: jest.fn(async (sessionId: string) => this.closedOrders.get(sessionId) ?? []),
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

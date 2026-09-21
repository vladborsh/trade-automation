import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  CreateSessionRequestSchema,
  PatchSessionRequestSchema,
  type BacktestErrorCode,
  type BacktestInstrument,
  type Session,
  type SessionDetail,
  type SessionStats,
  type SessionSummary,
} from '@trade-automation/contracts';
import { readJsonBody, type SendJson } from './auth';

/**
 * architecture/backtest-app-system-design.md §7.2 — an in-memory stand-in for the real server's
 * backtest instruments and sessions routes (apps/signal-server: session-validation.ts,
 * session.service.ts), so the client runs against the mock without a database. Same paths,
 * statuses and error codes: 422 LAYOUT_TOO_MANY_PANELS / LAYOUT_NOT_CANDLES (checked before the
 * schema) / INSTRUMENT_NOT_AVAILABLE / MIXED_SESSION_CURRENCY / PERIOD_OUTSIDE_COVERAGE, 400 for
 * a malformed body or an inverted period, 404 for another user's or an unknown session, 409
 * SESSION_COMPLETE for a timeframe change on a complete session.
 *
 * Fixed catalogue (coverage is deterministic so e2e defaults are stable):
 *   binance:BTCUSDT   USD  2024-01-01 .. 2026-06-30
 *   binance:ETHUSDT   USD  2025-01-01 .. 2026-06-30
 *   capitalcom:EURCHF CHF  2024-01-01 .. 2026-06-30   (a second currency, to demo mixing)
 *   capitalcom:US100  USD  no stored 1m (coverage null)
 * Sessions are per user id; the mock holds no orders, so every session is empty.
 */

const MIN = 60_000;
const COVERAGE_TO = Date.UTC(2026, 5, 30, 23, 59);

export const MOCK_BACKTEST_INSTRUMENTS: BacktestInstrument[] = [
  { id: 'binance:BTCUSDT', displayName: 'BTC/USDT Perp', assetClass: 'crypto-perp', sessionCurrency: 'USD', pricePrecision: 2, coverage: { from: Date.UTC(2024, 0, 1), to: COVERAGE_TO } },
  { id: 'binance:ETHUSDT', displayName: 'ETH/USDT Perp', assetClass: 'crypto-perp', sessionCurrency: 'USD', pricePrecision: 2, coverage: { from: Date.UTC(2025, 0, 1), to: COVERAGE_TO } },
  { id: 'capitalcom:EURCHF', displayName: 'EUR/CHF', assetClass: 'forex-cfd', sessionCurrency: 'CHF', pricePrecision: 5, coverage: { from: Date.UTC(2024, 0, 1), to: COVERAGE_TO } },
  { id: 'capitalcom:US100', displayName: 'US Tech 100', assetClass: 'index-cfd', sessionCurrency: 'USD', pricePrecision: 1, coverage: null },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A session with no closed trades: the stats computeStats returns for an empty order list. */
function emptyStats(s: SessionSummary): SessionStats {
  return {
    trades: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0,
    pnl: 0, pnlR: 0, grossProfit: 0, grossProfitR: 0, grossLoss: 0, grossLossR: 0, profitFactor: null,
    equityCurve: [{ time: s.periodFromMs, balance: s.initialBalance, balanceR: 0 }],
    maxDrawdownCcy: 0, maxDrawdownR: 0, maxDrawdownPct: 0,
    avgWin: null, avgWinR: null, avgLoss: null, avgLossR: null, expectancyR: 0,
    maeAvg: null, maeWorst: null, pessimisticTrades: 0, endOfSessionCloses: 0, byInstrument: {}, bySide: {},
  };
}

function toSession(s: SessionSummary): Session {
  const { tradesCount: _a, winsCount: _b, lossesCount: _c, pnlCcy: _d, pnlR: _e, profitFactor: _f, maxDrawdownCcy: _g, maxDrawdownR: _h, avgWinCcy: _i, avgWinR: _j, avgLossCcy: _k, avgLossR: _l, statsComputedAt: _m, ...session } = s;
  return session;
}

export class MockBacktestState {
  private readonly sessions = new Map<string, { userId: string; summary: SessionSummary }>();

  /** Handles `/api/backtest/*` for a signed-in user; false when the path is not one of these. */
  async handle(req: IncomingMessage, res: ServerResponse, pathname: string, send: SendJson, userId: string): Promise<boolean> {
    if (!pathname.startsWith('/api/backtest/')) return false;
    const method = req.method ?? 'GET';

    if (method === 'GET' && pathname === '/api/backtest/instruments') {
      send(res, 200, MOCK_BACKTEST_INSTRUMENTS);
      return true;
    }
    if (pathname === '/api/backtest/sessions') {
      if (method === 'GET') {
        send(res, 200, [...this.sessions.values()].filter((s) => s.userId === userId).map((s) => s.summary).sort((a, b) => b.createdAt - a.createdAt));
        return true;
      }
      if (method === 'POST') {
        this.create(res, send, userId, await readJsonBody(req));
        return true;
      }
    }
    const match = /^\/api\/backtest\/sessions\/([^/]+)$/.exec(pathname);
    if (match) {
      const own = UUID.test(match[1]) ? this.sessions.get(match[1]) : undefined;
      const session = own && own.userId === userId ? own.summary : null;
      if (!session) {
        send(res, 404, { statusCode: 404, message: 'Session not found.' });
        return true;
      }
      if (method === 'GET') {
        const detail: SessionDetail = { session: toSession(session), openOrders: [], stats: emptyStats(session) };
        send(res, 200, detail);
      } else if (method === 'PATCH') {
        this.patch(res, send, session, await readJsonBody(req));
      } else if (method === 'DELETE') {
        this.sessions.delete(session.id);
        send(res, 204, null);
      } else {
        return false;
      }
      return true;
    }
    return false;
  }

  private create(res: ServerResponse, send: SendJson, userId: string, body: Record<string, unknown> | null): void {
    const panels = (body?.['layout'] as { panels?: unknown } | undefined)?.panels;
    if (Array.isArray(panels) && panels.length > 4) return fail(send, res, 422, 'LAYOUT_TOO_MANY_PANELS', `A session layout has at most 4 panels (got ${panels.length}).`);
    if (Array.isArray(panels) && panels.some((p) => (p as { kind?: unknown })?.kind !== 'candles')) return fail(send, res, 422, 'LAYOUT_NOT_CANDLES', 'Session layouts hold candle panels only.');
    const parsed = CreateSessionRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.periodFromMs >= parsed.data.periodToMs) {
      send(res, 400, { statusCode: 400, message: 'Bad Request' });
      return;
    }
    const req = parsed.data;
    const ids = [...new Set(req.layout.panels.map((p) => p.instrument))];
    const catalogue = ids.map((id) => MOCK_BACKTEST_INSTRUMENTS.find((i) => i.id === id));
    const missing = ids.find((_, n) => !catalogue[n]?.coverage);
    if (missing) return fail(send, res, 422, 'INSTRUMENT_NOT_AVAILABLE', `Instrument ${missing} has no stored 1m history to replay.`);
    const currencies = [...new Set(catalogue.map((i) => i!.sessionCurrency))];
    if (currencies.length > 1) return fail(send, res, 422, 'MIXED_SESSION_CURRENCY', `All panels must share one session currency; got ${currencies.join(', ')}.`);
    const outside = catalogue.find((i) => !(req.periodFromMs < i!.coverage!.to + MIN && i!.coverage!.from < req.periodToMs));
    if (outside) return fail(send, res, 422, 'PERIOD_OUTSIDE_COVERAGE', `The period does not overlap the stored 1m history of ${outside.id}.`);

    const now = Date.now();
    const summary: SessionSummary = {
      id: randomUUID(), name: req.name, status: 'active', sessionCurrency: currencies[0], timeframe: req.timeframe,
      periodFromMs: req.periodFromMs, periodToMs: req.periodToMs, cursorMs: req.periodFromMs,
      initialBalance: req.initialBalance, balance: req.initialBalance, defaultRiskPct: req.defaultRiskPct, costs: req.costs,
      skipWeekends: req.skipWeekends ?? true, notionalWarnMultiple: req.notionalWarnMultiple ?? 5, layout: req.layout,
      createdAt: now, updatedAt: now, completedAt: null,
      tradesCount: 0, winsCount: 0, lossesCount: 0, pnlCcy: 0, pnlR: 0, profitFactor: null, maxDrawdownCcy: 0, maxDrawdownR: 0,
      avgWinCcy: null, avgWinR: null, avgLossCcy: null, avgLossR: null, statsComputedAt: null,
    };
    this.sessions.set(summary.id, { userId, summary });
    send(res, 201, toSession(summary));
  }

  private patch(res: ServerResponse, send: SendJson, session: SessionSummary, body: Record<string, unknown> | null): void {
    const parsed = PatchSessionRequestSchema.safeParse(body ?? {});
    if (!parsed.success || parsed.data.layout !== undefined) {
      send(res, 400, { statusCode: 400, message: 'Bad Request' });
      return;
    }
    if (parsed.data.timeframe !== undefined && session.status === 'complete') {
      return fail(send, res, 409, 'SESSION_COMPLETE', 'The timeframe of a complete session cannot be changed.');
    }
    Object.assign(session, { ...parsed.data, updatedAt: Date.now() });
    send(res, 200, toSession(session));
  }
}

function fail(send: SendJson, res: ServerResponse, status: number, code: BacktestErrorCode, message: string): void {
  send(res, status, { error: { code, message } });
}

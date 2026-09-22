import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  CreateSessionRequestSchema,
  PatchSessionRequestSchema,
  type BacktestErrorCode,
  type BacktestInstrument,
  type Session,
  type SessionDetail,
  type SessionLayout,
  type SessionStats,
  type SessionSummary,
  type Timeframe,
} from '@trade-automation/contracts';
import { readJsonBody, type SendJson } from './auth';
import { MOCK_CONTRACTS } from './fixtures';
import { replayAhead, replayHistory } from './replay-tape';
import { screenshotPng, seededOrderDetail, seededOrders, seededStats } from './journal-seed';

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
 * Replay candles (`…/candles`, `…/candles/ahead`) come from the deterministic tape in replay-tape.ts.
 * `POST …/advance` moves the stored cursor like the real one (T-017 + BUG-004): minute-aligned or
 * 400, backwards 409 CURSOR_BACKWARDS, clamped to the period end where the session completes,
 * then 409 SESSION_COMPLETE; the same opId with the same body replays, with another body 409s.
 * No orders are placed in the mock, so an advance never fills anything; `…/orders` and `…/stats`
 * report the fixed journal from journal-seed.ts (T-024).
 */

const MIN = 60_000;
const COVERAGE_TO = Date.UTC(2026, 5, 30, 23, 59);

export const MOCK_BACKTEST_INSTRUMENTS: BacktestInstrument[] = [
  { id: 'binance:BTCUSDT', displayName: 'BTC/USDT Perp', assetClass: 'crypto-perp', sessionCurrency: 'USD', pricePrecision: 2, coverage: { from: Date.UTC(2024, 0, 1), to: COVERAGE_TO }, contract: MOCK_CONTRACTS['binance:BTCUSDT'] },
  { id: 'binance:ETHUSDT', displayName: 'ETH/USDT Perp', assetClass: 'crypto-perp', sessionCurrency: 'USD', pricePrecision: 2, coverage: { from: Date.UTC(2025, 0, 1), to: COVERAGE_TO }, contract: MOCK_CONTRACTS['binance:ETHUSDT'] },
  { id: 'capitalcom:EURCHF', displayName: 'EUR/CHF', assetClass: 'forex-cfd', sessionCurrency: 'CHF', pricePrecision: 5, coverage: { from: Date.UTC(2024, 0, 1), to: COVERAGE_TO }, contract: MOCK_CONTRACTS['capitalcom:EURCHF'] },
  { id: 'capitalcom:US100', displayName: 'US Tech 100', assetClass: 'index-cfd', sessionCurrency: 'USD', pricePrecision: 1, coverage: null, contract: MOCK_CONTRACTS['capitalcom:US100'] },
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
  /** `${sessionId}:${opId}` → the request body as sent and the stored response (D9, BUG-004). */
  private readonly ops = new Map<string, { body: string; status: number; response: unknown }>();

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
    const candles = /^\/api\/backtest\/sessions\/([^/]+)\/candles(\/ahead)?$/.exec(pathname);
    if (candles && method === 'GET') {
      const own = UUID.test(candles[1]) ? this.sessions.get(candles[1]) : undefined;
      const session = own && own.userId === userId ? own.summary : null;
      if (!session) {
        send(res, 404, { statusCode: 404, message: 'Session not found.' });
        return true;
      }
      this.candles(res, send, session, new URL(req.url ?? '/', 'http://mock').searchParams, candles[2] !== undefined);
      return true;
    }
    const one = /^\/api\/backtest\/sessions\/([^/]+)\/orders\/([^/]+)(\/screenshots\/entry)?$/.exec(pathname);
    if (one && method === 'GET') {
      const own = UUID.test(one[1]) ? this.sessions.get(one[1]) : undefined;
      const detail = own && own.userId === userId ? seededOrderDetail(own.summary, one[2]) : null;
      if (!detail || (one[3] && !detail.screenshots.entry)) {
        send(res, 404, { statusCode: 404, message: 'Not found.' });
      } else if (one[3]) {
        // Not JSON, so not through `send`: set the credentialed-CORS headers it would have.
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'private, max-age=31536000',
          'Access-Control-Allow-Origin': req.headers.origin ?? '*',
          'Access-Control-Allow-Credentials': 'true',
          Vary: 'Origin',
        });
        res.end(screenshotPng);
      } else {
        send(res, 200, detail);
      }
      return true;
    }
    const journal = /^\/api\/backtest\/sessions\/([^/]+)\/(orders|stats)$/.exec(pathname);
    if (journal && method === 'GET') {
      const own = UUID.test(journal[1]) ? this.sessions.get(journal[1]) : undefined;
      const session = own && own.userId === userId ? own.summary : null;
      if (!session) {
        send(res, 404, { statusCode: 404, message: 'Session not found.' });
      } else if (journal[2] === 'stats') {
        send(res, 200, seededStats(session));
      } else {
        const status = new URL(req.url ?? '/', 'http://mock').searchParams.get('status');
        send(res, 200, seededOrders(session).filter((o) => !status || o.status === status));
      }
      return true;
    }
    const advance = /^\/api\/backtest\/sessions\/([^/]+)\/advance$/.exec(pathname);
    if (advance && method === 'POST') {
      const own = UUID.test(advance[1]) ? this.sessions.get(advance[1]) : undefined;
      const session = own && own.userId === userId ? own.summary : null;
      if (!session) {
        send(res, 404, { statusCode: 404, message: 'Session not found.' });
        return true;
      }
      this.advance(res, send, session, await readJsonBody(req));
      return true;
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
    const shapeError = layoutShapeError(body);
    if (shapeError) return fail(send, res, 422, shapeError.code, shapeError.message);
    const parsed = CreateSessionRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.periodFromMs >= parsed.data.periodToMs) {
      send(res, 400, { statusCode: 400, message: 'Bad Request' });
      return;
    }
    const req = parsed.data;
    const verdict = checkLayout(req.layout, req.periodFromMs, req.periodToMs);
    if ('code' in verdict) return fail(send, res, 422, verdict.code, verdict.message);
    const currencies = [verdict.currency];

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

  /** §7.2 replay candles: an unknown panel is a 400, `before > cursor` a 422 FUTURE_REQUESTED. */
  private candles(res: ServerResponse, send: SendJson, session: SessionSummary, q: URLSearchParams, ahead: boolean): void {
    const panel = session.layout.panels.find((p) => p.id === q.get('panelId'));
    const coverage = MOCK_BACKTEST_INSTRUMENTS.find((i) => i.id === panel?.instrument)?.coverage;
    if (!panel || !coverage) {
      send(res, 400, { statusCode: 400, message: 'Bad Request' });
      return;
    }
    if (ahead) {
      const fromMs = Number(q.get('fromMs'));
      const limit = Math.min(Number(q.get('limit') ?? 5000), 5000);
      send(res, 200, replayAhead(panel.instrument, coverage, fromMs, limit, session.periodToMs));
      return;
    }
    const tf = q.get('timeframe') as Timeframe;
    const before = Number(q.get('before'));
    if (before > session.cursorMs) return fail(send, res, 422, 'FUTURE_REQUESTED', 'History is served only up to the session cursor.');
    send(res, 200, replayHistory(panel.instrument, coverage, tf, before, Math.min(Number(q.get('limit') ?? 1500), 1500)));
  }

  private advance(res: ServerResponse, send: SendJson, session: SessionSummary, body: Record<string, unknown> | null): void {
    const opId = typeof body?.['opId'] === 'string' ? body['opId'] : '';
    const target = body?.['toCursorMs'];
    if (!UUID.test(opId) || typeof target !== 'number' || !Number.isInteger(target) || target < 0) {
      send(res, 400, { statusCode: 400, message: 'Bad Request' });
      return;
    }
    const key = `${session.id}:${opId}`;
    const fingerprint = JSON.stringify({ opId, toCursorMs: target });
    const seen = this.ops.get(key);
    if (seen) {
      if (seen.body === fingerprint) send(res, seen.status, seen.response);
      else send(res, 409, { statusCode: 409, message: 'opId already used for a different request' });
      return;
    }
    const answer = (status: number, response: unknown) => {
      this.ops.set(key, { body: fingerprint, status, response });
      send(res, status, response);
    };
    if (session.status === 'complete') return answer(409, { error: { code: 'SESSION_COMPLETE', message: 'The session is complete.' } });
    if (target % MIN !== 0) return answer(400, { statusCode: 400, message: 'toCursorMs must be on a minute boundary.' });
    if (target < session.cursorMs) {
      return answer(409, { error: { code: 'CURSOR_BACKWARDS', message: `toCursorMs ${target} is before the cursor ${session.cursorMs}.` } });
    }
    const to = Math.min(target, session.periodToMs);
    const now = Date.now();
    Object.assign(session, { cursorMs: to, updatedAt: now });
    if (to === session.periodToMs) Object.assign(session, { status: 'complete', completedAt: now });
    answer(200, { cursorMs: to, status: session.status, balance: session.balance, events: [], orders: [], stats: emptyStats(session) });
  }

  /**
   * Like the real server (T-029): a layout edit passes the create checks against the session's
   * period and keeps the session's currency. The mock holds no orders, so the real server's
   * "panel with pending or open orders" 409 never fires here.
   */
  private patch(res: ServerResponse, send: SendJson, session: SessionSummary, body: Record<string, unknown> | null): void {
    const shapeError = layoutShapeError(body);
    if (shapeError) return fail(send, res, 422, shapeError.code, shapeError.message);
    const parsed = PatchSessionRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      send(res, 400, { statusCode: 400, message: 'Bad Request' });
      return;
    }
    const { layout } = parsed.data;
    if (layout) {
      const verdict = checkLayout(layout, session.periodFromMs, session.periodToMs);
      if ('code' in verdict) return fail(send, res, 422, verdict.code, verdict.message);
      if (verdict.currency !== session.sessionCurrency) {
        return fail(send, res, 422, 'MIXED_SESSION_CURRENCY', `This session trades in ${session.sessionCurrency}; its panels cannot move to ${verdict.currency}.`);
      }
    }
    if ((parsed.data.timeframe !== undefined || layout !== undefined) && session.status === 'complete') {
      return fail(send, res, 409, 'SESSION_COMPLETE', 'The timeframe or layout of a complete session cannot be changed.');
    }
    Object.assign(session, { ...parsed.data, updatedAt: Date.now() });
    send(res, 200, toSession(session));
  }
}

/** The two layout codes, checked on the raw body before the schema (as the real server does). */
function layoutShapeError(body: Record<string, unknown> | null): { code: BacktestErrorCode; message: string } | null {
  const panels = (body?.['layout'] as { panels?: unknown } | undefined)?.panels;
  if (!Array.isArray(panels)) return null;
  if (panels.length > 4) return { code: 'LAYOUT_TOO_MANY_PANELS', message: `A session layout has at most 4 panels (got ${panels.length}).` };
  if (panels.some((p) => (p as { kind?: unknown })?.kind !== 'candles')) return { code: 'LAYOUT_NOT_CANDLES', message: 'Session layouts hold candle panels only.' };
  return null;
}

/** Availability, one currency, and a period overlapping each instrument's 1m coverage. */
function checkLayout(layout: SessionLayout, fromMs: number, toMs: number): { currency: string } | { code: BacktestErrorCode; message: string } {
  const ids = [...new Set(layout.panels.map((p) => p.instrument))];
  const catalogue = ids.map((id) => MOCK_BACKTEST_INSTRUMENTS.find((i) => i.id === id));
  const missing = ids.find((_, n) => !catalogue[n]?.coverage);
  if (missing) return { code: 'INSTRUMENT_NOT_AVAILABLE', message: `Instrument ${missing} has no stored 1m history to replay.` };
  const currencies = [...new Set(catalogue.map((i) => i!.sessionCurrency))];
  if (currencies.length > 1) return { code: 'MIXED_SESSION_CURRENCY', message: `All panels must share one session currency; got ${currencies.join(', ')}.` };
  const outside = catalogue.find((i) => !(fromMs < i!.coverage!.to + MIN && i!.coverage!.from < toMs));
  if (outside) return { code: 'PERIOD_OUTSIDE_COVERAGE', message: `The period does not overlap the stored 1m history of ${outside.id}.` };
  return { currency: currencies[0] };
}

function fail(send: SendJson, res: ServerResponse, status: number, code: BacktestErrorCode, message: string): void {
  send(res, status, { error: { code, message } });
}

import { BadRequestException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SessionDetailSchema, SessionSchema } from '@trade-automation/contracts';
import { computeStats } from '@trade-automation/replay-core';
import { COVERAGE, DAY, FakeBacktestRepositories, T0, createBody, fakeStore, makeSessionService } from './fake-backtest';

const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';

async function errorOf(p: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await p;
  } catch (err) {
    const e = err as HttpException;
    return { status: e.getStatus(), body: e.getResponse() };
  }
  throw new Error('expected a rejection');
}

const code = (c: string) => ({ error: { code: c, message: expect.any(String) } });

describe('SessionService (backtest-app-system-design.md §7.2)', () => {
  let repos: FakeBacktestRepositories;
  let service: ReturnType<typeof makeSessionService>;

  beforeEach(() => {
    repos = new FakeBacktestRepositories();
    service = makeSessionService(repos);
  });

  describe('create', () => {
    it('starts the cursor at periodFromMs, balance at initialBalance, status active, with the defaults', async () => {
      const session = await service.create(ALICE, createBody());
      expect(SessionSchema.parse(session)).toEqual(session);
      expect(session).toMatchObject({
        name: 'BTC practice',
        status: 'active',
        sessionCurrency: 'USD',
        timeframe: '15m',
        cursorMs: T0 + 5 * DAY,
        balance: 10_000,
        initialBalance: 10_000,
        skipWeekends: true,
        costs: { enabled: true, commissionPct: 0.04, spread: 0.5 },
        completedAt: null,
      });
      expect(session).not.toHaveProperty('tradesCount'); // a Session, not a summary
    });

    it('stores its own parsed copy of the layout (schema defaults applied)', async () => {
      const body = createBody();
      const session = await service.create(ALICE, body);
      expect(session.layout.panels[0]).toEqual({ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false });
      (body.layout as { name: string }).name = 'mutated after the call';
      expect((await service.get(ALICE, session.id)).layout.name).toBe('Crypto');
    });

    it('honours an explicit skipWeekends; a notionalWarnMultiple from an old client is ignored (D12, T-053)', async () => {
      const session = await service.create(ALICE, createBody({ skipWeekends: false, notionalWarnMultiple: 3 }));
      expect(session).toMatchObject({ skipWeekends: false });
      expect('notionalWarnMultiple' in session).toBe(false);
    });

    it.each([
      [
        'LAYOUT_TOO_MANY_PANELS',
        {
          layout: {
            id: 'x',
            name: 'X',
            grid: { columns: 3, rows: 2 },
            panels: [1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, kind: 'candles', instrument: 'binance:BTCUSDT' })),
          },
        },
      ],
      [
        'LAYOUT_NOT_CANDLES',
        {
          layout: {
            id: 'x',
            name: 'X',
            grid: { columns: 2, rows: 1 },
            panels: [
              { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT' },
              { id: 'oi', kind: 'metric', instrument: 'binance:BTCUSDT', metric: 'openInterest' },
            ],
          },
        },
      ],
      [
        'MIXED_SESSION_CURRENCY',
        {
          layout: {
            id: 'x',
            name: 'X',
            grid: { columns: 2, rows: 1 },
            panels: [
              { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT' },
              { id: 'eurchf', kind: 'candles', instrument: 'capitalcom:EURCHF' },
            ],
          },
        },
      ],
      [
        'INSTRUMENT_NOT_AVAILABLE',
        { layout: { id: 'x', name: 'X', grid: { columns: 1, rows: 1 }, panels: [{ id: 'ndx', kind: 'candles', instrument: 'capitalcom:US100' }] } },
      ],
      ['PERIOD_OUTSIDE_COVERAGE', { periodFromMs: T0 + 40 * DAY, periodToMs: T0 + 45 * DAY }],
    ])('422 %s in the {error:{code,message}} envelope; nothing stored', async (expected, overrides) => {
      expect(await errorOf(service.create(ALICE, createBody(overrides)))).toEqual({ status: 422, body: code(expected) });
      expect(repos.rows.size).toBe(0);
    });

    it('400 for a malformed body or an inverted period', async () => {
      await expect(service.create(ALICE, { name: 'x' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(ALICE, createBody({ periodFromMs: T0 + 9 * DAY, periodToMs: T0 + 9 * DAY }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('tenancy: another user’s session is a 404, never a 403', () => {
    it('list/get/patch/delete see only the caller’s rows', async () => {
      const a = await service.create(ALICE, createBody({ name: 'alice' }));
      const b = await service.create(BOB, createBody({ name: 'bob' }));

      expect((await service.list(ALICE)).map((s) => s.name)).toEqual(['alice']);
      expect((await service.list(BOB)).map((s) => s.name)).toEqual(['bob']);

      await expect(service.get(BOB, a.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.patch(BOB, a.id, { name: 'hijack' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.delete(BOB, a.id)).rejects.toBeInstanceOf(NotFoundException);
      expect((await service.get(ALICE, a.id)).name).toBe('alice');
      expect((await service.get(BOB, b.id)).name).toBe('bob');
    });

    it('a non-uuid id is a 404, not a database error', async () => {
      await expect(service.get(ALICE, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.patch(ALICE, 'not-a-uuid', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.delete(ALICE, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('list returns summaries with the aggregate columns, newest first', async () => {
    await service.create(ALICE, createBody({ name: 'first' }));
    await service.create(ALICE, createBody({ name: 'second' }));
    const list = await service.list(ALICE);
    expect(list.map((s) => s.name)).toEqual(['second', 'first']);
    expect(list[0]).toMatchObject({ tradesCount: 0, pnlCcy: 0, profitFactor: null, statsComputedAt: null });
  });

  describe('patch', () => {
    it('renames and switches timeframe', async () => {
      const s = await service.create(ALICE, createBody());
      const patched = await service.patch(ALICE, s.id, { name: 'renamed', timeframe: '1h' });
      expect(patched).toMatchObject({ name: 'renamed', timeframe: '1h' });
      expect(patched).not.toHaveProperty('tradesCount');
    });

    it('409 SESSION_COMPLETE for a timeframe change on a complete session; renaming it is fine', async () => {
      const s = await service.create(ALICE, createBody());
      repos.rows.get(s.id)!.session.status = 'complete';
      expect(await errorOf(service.patch(ALICE, s.id, { timeframe: '1h' }))).toEqual({ status: 409, body: code('SESSION_COMPLETE') });
      await expect(service.patch(ALICE, s.id, { name: 'done' })).resolves.toMatchObject({ name: 'done', timeframe: '15m' });
    });

  });

  describe('layout edit (T-029)', () => {
    const layout = (...panels: { id: string; instrument: string; kind?: string; indicators?: unknown }[]) => ({
      id: 'edited',
      name: 'Edited',
      grid: { columns: 4, rows: 1 },
      panels: panels.map((p) => ({ kind: 'candles', ...p })),
    });
    const openOrder = (sessionId: string, panelId: string, instrument: 'binance:BTCUSDT' | 'binance:ETHUSDT', status: 'pending' | 'open') =>
      repos.orders.insert({
        sessionId, seq: 1, panelId, instrument, side: 'long', type: status === 'pending' ? 'limit' : 'market', status,
        placedAtMs: T0 + 5 * DAY, limitPrice: status === 'pending' ? 90 : null, entryPrice: status === 'open' ? 100 : null,
        entryTimeMs: status === 'open' ? T0 + 5 * DAY : null, qty: 1, contractMultiplier: 1, riskPct: 1, riskAmountCcy: 10, sl: 80, tp: null,
        fillResolution: status === 'open' ? '1m' : null,
      });

    it('adds, removes and reorders panels, carrying indicators, and returns the updated session', async () => {
      const s = await service.create(ALICE, createBody());
      const next = layout(
        { id: 'eth', instrument: 'binance:ETHUSDT' },
        { id: 'btc', instrument: 'binance:BTCUSDT', indicators: [{ id: 'ema', params: { length: 21 } }] },
        { id: 'btc-2', instrument: 'binance:BTCUSDT' },
      );
      const patched = await service.patch(ALICE, s.id, { layout: next });
      expect(patched.layout.panels.map((p) => p.id)).toEqual(['eth', 'btc', 'btc-2']);
      expect(patched.layout.panels[1].indicators).toEqual([{ id: 'ema', params: { length: 21 } }]);
      expect(patched.cursorMs).toBe(s.cursorMs); // a layout edit never touches the cursor
      expect((await service.get(ALICE, s.id)).layout).toEqual(patched.layout); // persisted
    });

    it.each([
      ['LAYOUT_TOO_MANY_PANELS', layout(...['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, instrument: 'binance:BTCUSDT' })))],
      ['LAYOUT_NOT_CANDLES', layout({ id: 'btc', instrument: 'binance:BTCUSDT' }, { id: 'oi', instrument: 'binance:BTCUSDT', kind: 'metric' })],
      ['INSTRUMENT_NOT_AVAILABLE', layout({ id: 'ndx', instrument: 'capitalcom:US100' })],
      ['MIXED_SESSION_CURRENCY', layout({ id: 'btc', instrument: 'binance:BTCUSDT' }, { id: 'eurchf', instrument: 'capitalcom:EURCHF' })],
      ['MIXED_SESSION_CURRENCY', layout({ id: 'eurchf', instrument: 'capitalcom:EURCHF' })], // consistent, but not the session's USD
    ])('422 %s, and the layout is unchanged', async (expected, next) => {
      const s = await service.create(ALICE, createBody());
      expect(await errorOf(service.patch(ALICE, s.id, { layout: next }))).toEqual({ status: 422, body: code(expected) });
      expect((await service.get(ALICE, s.id)).layout).toEqual(s.layout);
    });

    it('422 PERIOD_OUTSIDE_COVERAGE: coverage is checked against the session period', async () => {
      const shifted = makeSessionService(repos, fakeStore({ ...COVERAGE, 'binance:ETHUSDT': { from: T0 + 20 * DAY, to: T0 + 30 * DAY } }));
      const s = await shifted.create(ALICE, createBody({ layout: layout({ id: 'btc', instrument: 'binance:BTCUSDT' }) }));
      expect(await errorOf(shifted.patch(ALICE, s.id, { layout: layout({ id: 'eth', instrument: 'binance:ETHUSDT' }) }))).toEqual({
        status: 422,
        body: code('PERIOD_OUTSIDE_COVERAGE'),
      });
    });

    it('409 SESSION_COMPLETE for a layout edit on a complete session', async () => {
      const s = await service.create(ALICE, createBody());
      repos.rows.get(s.id)!.session.status = 'complete';
      expect(await errorOf(service.patch(ALICE, s.id, { layout: layout({ id: 'btc', instrument: 'binance:BTCUSDT' }) }))).toEqual({
        status: 409,
        body: code('SESSION_COMPLETE'),
      });
    });

    it('a panel with a pending or open order cannot be removed or re-pointed (plain 409); closed ones do not block', async () => {
      const s = await service.create(ALICE, createBody()); // panels btc, eth
      await openOrder(s.id, 'eth', 'binance:ETHUSDT', 'open');
      const removeEth = layout({ id: 'btc', instrument: 'binance:BTCUSDT' });
      const err = await errorOf(service.patch(ALICE, s.id, { layout: removeEth }));
      expect(err.status).toBe(409);
      expect(err.body).toMatchObject({ statusCode: 409, message: expect.stringMatching(/Panel 'eth' has pending or open orders/) });
      const repoint = layout({ id: 'btc', instrument: 'binance:BTCUSDT' }, { id: 'eth', instrument: 'binance:BTCUSDT' });
      expect((await errorOf(service.patch(ALICE, s.id, { layout: repoint }))).status).toBe(409);
      // reordering and adding around it is fine
      await expect(service.patch(ALICE, s.id, { layout: layout({ id: 'eth', instrument: 'binance:ETHUSDT' }, { id: 'btc', instrument: 'binance:BTCUSDT' }) })).resolves.toBeDefined();

      const other = await service.create(ALICE, createBody());
      await openOrder(other.id, 'btc', 'binance:BTCUSDT', 'pending');
      expect((await errorOf(service.patch(ALICE, other.id, { layout: layout({ id: 'eth', instrument: 'binance:ETHUSDT' }) }))).status).toBe(409);
      repos.orderRows.forEach((o) => {
        if (o.sessionId === other.id) o.status = 'cancelled';
      });
      await expect(service.patch(ALICE, other.id, { layout: layout({ id: 'eth', instrument: 'binance:ETHUSDT' }) })).resolves.toBeDefined();
    });

    it('a malformed layout body is a 400; another user is a 404', async () => {
      const s = await service.create(ALICE, createBody());
      await expect(service.patch(ALICE, s.id, { layout: { panels: 'nope' } })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.patch(ALICE, s.id, { layout: layout({ id: 'BTC!', instrument: 'binance:BTCUSDT' }) })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.patch(BOB, s.id, { layout: layout({ id: 'btc', instrument: 'binance:BTCUSDT' }) })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('detail', () => {
    const closed = {
      id: '00000000-0000-4000-8000-0000000000c1',
      seq: 1,
      instrument: 'binance:BTCUSDT' as const,
      side: 'long' as const,
      status: 'closed' as const,
      exitTimeMs: T0 + 6 * DAY,
      pnlCcy: 150,
      pnlR: 1.5,
      maeR: -0.4,
      fillResolution: '1m' as const,
      closeReason: 'take-profit' as const,
    };

    it('returns the session, no open orders yet (T-015), and computeStats over its closed orders', async () => {
      const s = await service.create(ALICE, createBody());
      repos.closedOrders.set(s.id, [closed]);
      const detail = await service.detail(ALICE, s.id);
      expect(SessionDetailSchema.parse(detail)).toEqual(detail);
      expect(detail.session).toEqual(s);
      expect(detail.openOrders).toEqual([]);
      expect(detail.stats).toEqual(computeStats([closed], 10_000, T0 + 5 * DAY));
      expect(detail.stats).toMatchObject({ trades: 1, pnl: 150, pnlR: 1.5 });
    });

    it('404 for another user’s session, without ever reading its orders', async () => {
      const s = await service.create(ALICE, createBody());
      await expect(service.detail(BOB, s.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.detail(ALICE, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundException);
      expect(repos.orders.listClosedForStats).not.toHaveBeenCalled();
    });
  });

  it('delete removes the row', async () => {
    const s = await service.create(ALICE, createBody());
    await service.delete(ALICE, s.id);
    await expect(service.get(ALICE, s.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('503 for everything without a database', async () => {
    const disabled = makeSessionService(null);
    await expect(disabled.create(ALICE, createBody())).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(disabled.list(ALICE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(disabled.get(ALICE, 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(disabled.detail(ALICE, 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(disabled.patch(ALICE, 'x', {})).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(disabled.delete(ALICE, 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(() => disabled.assertEnabled()).toThrow(ServiceUnavailableException);
  });
});

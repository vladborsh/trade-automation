import { vi } from 'vitest';
import type { AheadResponse, Candle, Panel, ReplayHistoryResponse, Timeframe } from '@trade-automation/contracts';
import { foldOneMinute, isWeekend } from '@trade-automation/replay-core';
import { seriesBars } from './fold-on-step';
import { ReplayEngine, type ReplayApi } from './replay-engine';

const M = 60_000;
const at = (d: number, h: number, m = 0) => Date.UTC(2026, 8, d, h, m); // September 2026: 18 = Friday, 21 = Monday

/**
 * A deterministic 1m tape: Friday 18th 21:00–24:00, nothing over the weekend, Monday 21st
 * 00:00–00:30, an empty stretch 00:30–01:15, then 01:15–03:00. `phase` offsets the prices so a
 * second panel differs from the first.
 */
function tape(instrument: Panel['instrument'], phase = 0): Candle[] {
  const ranges: Array<[number, number]> = [
    [at(18, 21), at(19, 0)],
    [at(21, 0), at(21, 0, 30)],
    [at(21, 1, 15), at(21, 3)],
  ];
  const out: Candle[] = [];
  for (const [from, to] of ranges) {
    for (let t = from; t < to; t += M) {
      const i = t / M;
      const close = 100 + ((i * 7 + phase) % 23) * 0.25;
      out.push({
        instrument,
        timeframe: '1m',
        openTime: t,
        open: close - 0.5,
        high: close + ((i + phase) % 5),
        low: close - ((i * 3 + phase) % 4),
        close,
        volume: (i % 11) + 1,
        closed: true,
        source: 'storage',
      });
    }
  }
  return out;
}

const PANELS: Panel[] = [
  { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false },
  { id: 'eth', kind: 'candles', instrument: 'binance:ETHUSDT', signals: false },
];
const TAPES: Record<string, Candle[]> = { btc: tape('binance:BTCUSDT'), eth: tape('binance:ETHUSDT', 3) };
const PERIOD_TO = at(21, 3);

/**
 * The server, with its fold replaced by `foldOneMinute` over the same tape (T-014 does exactly
 * this). Like the real one it serves history only up to the session's stored cursor, which does
 * not move until T-021 — so a switch after steps must not ask for `before = cursor`.
 */
function fakeServer(opts: { pageCap?: number; serverCursor?: number } = {}) {
  const api = {
    history: vi.fn(async (panelId: string, tf: Timeframe, before: number, limit: number): Promise<ReplayHistoryResponse> => {
      if (opts.serverCursor !== undefined && before > opts.serverCursor) throw new Error('422 FUTURE_REQUESTED');
      const { closed, forming } = foldOneMinute(TAPES[panelId], tf, before);
      return { bars: closed.slice(-limit), forming };
    }),
    ahead: vi.fn(async (panelId: string, fromMs: number, limit: number): Promise<AheadResponse> => {
      const rest = TAPES[panelId].filter((c) => c.openTime >= fromMs && c.openTime + M <= PERIOD_TO);
      const n = Math.min(limit, opts.pageCap ?? limit);
      return {
        candles: rest.slice(0, n).map((c) => [c.openTime, c.open, c.high, c.low, c.close, c.volume]),
        endOfTape: rest.length <= n,
      };
    }),
    patchTimeframe: vi.fn(async (_tf: Timeframe) => undefined),
  };
  return api satisfies ReplayApi;
}

function engine(api: ReplayApi, cursorMs: number, timeframe: Timeframe = '5m'): ReplayEngine {
  return new ReplayEngine(api, { panels: PANELS, cursorMs, serverCursorMs: cursorMs, timeframe, periodToMs: PERIOD_TO, skipWeekends: true });
}

/** What `GET …/candles?before=cursor` returns for a panel, as the chart would draw it. */
async function serverBars(api: ReturnType<typeof fakeServer>, panelId: string, tf: Timeframe, before: number): Promise<Candle[]> {
  const { bars, forming } = await api.history(panelId, tf, before, 1500);
  return forming ? [...bars, forming] : bars;
}

async function stepN(e: ReplayEngine, n: number): Promise<number[]> {
  const cursors: number[] = [];
  for (let i = 0; i < n; i++) {
    await e.step();
    cursors.push(e.cursor());
  }
  return cursors;
}

describe('ReplayEngine (backtest-app-system-design.md §5)', () => {
  it('PARITY: N steps give exactly the bars the server returns at the final cursor, per panel', async () => {
    const api = fakeServer();
    const e = engine(api, at(18, 23, 42)); // mid-bar, Friday evening
    await e.start();
    await stepN(e, 25); // crosses the weekend and the Monday empty stretch, stops mid-tape
    expect(e.error()).toBeNull();
    expect(e.cursor()).toBe(at(21, 2, 30)); // 4 steps to Sat 00:00, 6 to Mon 00:30, 01:20, then 14 more

    for (const p of PANELS) {
      expect(seriesBars(e.seriesFor(p.id)())).toEqual(await serverBars(api, p.id, '5m', e.cursor()));
    }
  });

  it('PARITY holds when every ahead page is tiny, so steps block and fetch mid-way', async () => {
    const api = fakeServer({ pageCap: 7 });
    const e = engine(api, at(18, 23, 42));
    await e.start();
    await stepN(e, 25);
    expect(e.error()).toBeNull();
    expect(e.cursor()).toBe(at(21, 2, 30));

    for (const p of PANELS) {
      expect(seriesBars(e.seriesFor(p.id)())).toEqual(await serverBars(api, p.id, '5m', e.cursor()));
    }
    expect(api.ahead.mock.calls.length).toBeGreaterThan(20);
  });

  it('started turns true only once start() has the first history in (BUG-010 e2e hook)', async () => {
    const e = engine(fakeServer(), at(18, 23, 50));
    expect(e.started()).toBe(false);
    const starting = e.start();
    expect(e.blocked()).toBe(true);
    expect(e.started()).toBe(false); // loading: an e2e must not point at the chart yet
    await starting;
    expect(e.started()).toBe(true);
    expect(e.blocked()).toBe(false);
  });

  it('skips the weekend and jumps the empty stretch: the cursor never stops without data', async () => {
    const e = engine(fakeServer(), at(18, 23, 50));
    await e.start();
    const cursors = await stepN(e, 5);

    expect(cursors).toEqual([at(18, 23, 55), at(19, 0, 0), at(21, 0, 5), at(21, 0, 10), at(21, 0, 15)]);
    expect(cursors.every((c) => !isWeekend(c - 5 * M))).toBe(true);

    const more = await stepN(e, 4); // 00:20, 00:25, 00:30, then over 00:30–01:15
    expect(more).toEqual([at(21, 0, 20), at(21, 0, 25), at(21, 0, 30), at(21, 1, 20)]);
  });

  it('a timeframe switch keeps the cursor, shows the partially formed bar, and patches the session', async () => {
    const api = fakeServer({ serverCursor: at(18, 21, 40) }); // the server's cursor stays at the start (T-021)
    const e = engine(api, at(18, 21, 40));
    await e.start();
    await stepN(e, 3); // 21:45, 21:50, 21:55
    const cursor = e.cursor();
    const aheadCallsBefore = api.ahead.mock.calls.length;

    await e.setTimeframe('1h');
    const switchCalls = api.ahead.mock.calls.slice(aheadCallsBefore);
    expect(e.cursor()).toBe(cursor);
    expect(e.timeframe()).toBe('1h');
    const bars = seriesBars(e.seriesFor('btc')());
    expect(bars.at(-1)).toMatchObject({ openTime: at(18, 21), closed: false });
    expect(bars).toEqual(await serverBars(fakeServer(), 'btc', '1h', cursor)); // what before=cursor would return
    expect(api.patchTimeframe).toHaveBeenCalledWith('1h');

    // …and stepping on at the new timeframe stays in parity (the carry reaches back to 21:00).
    expect(await stepN(e, 3)).toEqual([at(18, 22), at(18, 23), at(19, 0)]);
    expect(e.error()).toBeNull();
    expect(seriesBars(e.seriesFor('btc')())).toEqual(await serverBars(fakeServer(), 'btc', '1h', e.cursor()));
    expect(api.history.mock.calls.every(([, , before]) => before <= at(18, 21, 40))).toBe(true);
    // Extending the cache back to 21:00 asked only for the 55 missing minutes, not a full page.
    const back = switchCalls.filter(([, from]) => from < cursor);
    expect(back.map(([panel, from, limit]) => [panel, from, limit])).toEqual([
      ['btc', at(18, 21, 0), 55],
      ['eth', at(18, 21, 0), 55],
    ]);
  });

  it('a switch to a finer timeframe mid-bar is also exact, far ahead of the server cursor', async () => {
    const api = fakeServer({ serverCursor: at(18, 21, 0) });
    const e = engine(api, at(18, 21, 0), '1h');
    await e.start();
    await stepN(e, 2); // 22:00, 23:00 at 1h
    await e.setTimeframe('15m');
    expect(seriesBars(e.seriesFor('btc')())).toEqual(await serverBars(fakeServer(), 'btc', '15m', e.cursor()));
    await e.setTimeframe('5m');
    expect(await stepN(e, 7)).toEqual([5, 10, 15, 20, 25, 30, 35].map((m) => at(18, 23, m)));
    expect(e.error()).toBeNull();
    expect(seriesBars(e.seriesFor('eth')())).toEqual(await serverBars(fakeServer(), 'eth', '5m', e.cursor()));
  });

  it('stops at the end of the period; further steps do nothing', async () => {
    const e = engine(fakeServer(), at(21, 2, 40));
    await e.start();
    await stepN(e, 10);
    expect(e.cursor()).toBe(PERIOD_TO);
    expect(e.atEnd()).toBe(true);
  });

  describe('a step pressed while another is in flight (T-037)', () => {
    /** Lets the queued step (started from the in-flight step's end) run to completion. */
    const settle = () => new Promise((r) => setTimeout(r, 30));

    it('is queued, shown, and runs as exactly one extra step', async () => {
      const e = engine(fakeServer({ pageCap: 3 }), at(18, 22, 0)); // tiny pages: the step blocks on a fetch
      await e.start();
      const first = e.step();
      void e.step(); // pressed while the first is in flight
      expect(e.stepQueued()).toBe(true);
      await first;
      await settle();
      expect(e.cursor()).toBe(at(18, 22, 10));
      expect(e.stepQueued()).toBe(false);
    });

    it('many presses while busy are one step, not a backlog (holding →)', async () => {
      const e = engine(fakeServer({ pageCap: 3 }), at(18, 22, 0));
      await e.start();
      const first = e.step();
      for (let i = 0; i < 20; i++) void e.step();
      await first;
      await settle();
      expect(e.cursor()).toBe(at(18, 22, 10)); // the in-flight step + one
    });

    it('a press during a timeframe switch steps once the switch is done', async () => {
      const e = engine(fakeServer(), at(18, 22, 0));
      await e.start();
      const switching = e.setTimeframe('15m');
      void e.step();
      expect(e.stepQueued()).toBe(true);
      await switching;
      await settle();
      expect(e.timeframe()).toBe('15m');
      expect(e.cursor()).toBe(at(18, 22, 15));
    });

    it('a reload (retire) drops the queued step: nothing is carried across it', async () => {
      const e = engine(fakeServer({ pageCap: 3 }), at(18, 22, 0));
      await e.start();
      const first = e.step();
      void e.step();
      e.retire();
      expect(e.stepQueued()).toBe(false);
      await first;
      await settle();
      expect(e.cursor()).toBe(at(18, 22, 5)); // only the step already in flight
      void e.step(); // and a retired engine queues nothing either
      expect(e.stepQueued()).toBe(false);
    });

    it('a session completed while the step was in flight runs no queued step', async () => {
      const e = engine(fakeServer({ pageCap: 3 }), at(18, 22, 0));
      await e.start();
      const first = e.step();
      void e.step();
      e.complete(); // the advance answer said "complete"
      await first;
      await settle();
      expect(e.cursor()).toBe(at(18, 22, 5));
      expect(e.stepQueued()).toBe(false);
    });

    it('at the end of the period the queued press does nothing', async () => {
      const e = engine(fakeServer(), at(21, 2, 55)); // one step before PERIOD_TO
      await e.start();
      const first = e.step();
      void e.step();
      await first;
      await settle();
      expect(e.cursor()).toBe(PERIOD_TO);
      expect(e.atEnd()).toBe(true);
      expect(e.stepQueued()).toBe(false);
    });
  });

  it('a retired engine (BUG-009: the session is reloading) shows loading for good and ignores steps and switches', async () => {
    const api = fakeServer({ pageCap: 3 });
    const e = engine(api, at(18, 22, 0));
    await e.start();
    const inFlight = e.step(); // a step that blocks on a page…
    e.retire(); // …when the reload starts
    await inFlight;
    expect(e.blocked()).toBe(true); // the in-flight step's end does not clear it
    expect(e.started()).toBe(false); // the readiness hook drops until the fresh engine has started
    const cursor = e.cursor();
    await e.step();
    await e.setTimeframe('1m');
    expect(e.cursor()).toBe(cursor);
    expect(e.timeframe()).toBe('5m');
    expect(api.patchTimeframe).not.toHaveBeenCalled();
  });

  it('loads older history page by page and stops when there is none', async () => {
    const api = fakeServer();
    const e = engine(api, at(21, 2, 0));
    await e.start();
    const first = e.seriesFor('btc')().closed[0].openTime;
    await e.loadOlder('btc'); // everything older fits in one page
    const oldest = e.seriesFor('btc')().closed[0].openTime;
    expect(oldest).toBeLessThanOrEqual(first);
    await e.loadOlder('btc');
    expect(e.seriesFor('btc')().closed[0].openTime).toBe(oldest);
  });

  it('reports every step, uses the confirmed server cursor for history, and locks once complete', async () => {
    const api = fakeServer({ serverCursor: at(18, 22, 0) });
    const stepped: number[] = [];
    const e = new ReplayEngine(api, {
      panels: PANELS, cursorMs: at(18, 21, 40), serverCursorMs: at(18, 21, 40), timeframe: '5m',
      periodToMs: PERIOD_TO, skipWeekends: true, onStep: (c) => stepped.push(c),
    });
    await e.start();
    await stepN(e, 4);
    expect(stepped).toEqual([45, 50, 55, 60].map((m) => at(18, 21, 0) + m * M));

    e.confirmServerCursor(at(18, 22, 0)); // the advances came back
    await e.setTimeframe('15m');
    expect(api.history.mock.calls.at(-1)?.[2]).toBe(at(18, 22, 0)); // anchor = 22:00, not 21:30
    e.confirmServerCursor(at(18, 21, 0)); // never moves backwards
    await e.setTimeframe('1h');
    expect(e.error()).toBeNull();

    e.complete();
    await e.step();
    await e.setTimeframe('5m');
    expect(e.cursor()).toBe(at(18, 22, 0));
    expect(e.timeframe()).toBe('1h');
    expect(stepped).toHaveLength(4);
  });

  it("hands onStep each panel's newly revealed 1m: from <= openTime <= cursor − 60 000 (T-023 preview)", async () => {
    const api = fakeServer();
    const revealed: Array<{ cursor: number; btc: number[]; eth: number[] }> = [];
    const e = new ReplayEngine(api, {
      panels: PANELS, cursorMs: at(18, 21, 40), serverCursorMs: at(18, 21, 40), timeframe: '5m',
      periodToMs: PERIOD_TO, skipWeekends: true,
      onStep: (c, r) => revealed.push({ cursor: c, btc: r.get('btc')!.map((b) => b.openTime), eth: r.get('eth')!.map((b) => b.openTime) }),
    });
    await e.start();
    await stepN(e, 2);
    const span = (from: number, to: number) => TAPES['btc'].map((b) => b.openTime).filter((t) => t >= from && t + M <= to);
    expect(revealed[0]).toEqual({ cursor: at(18, 21, 45), btc: span(at(18, 21, 40), at(18, 21, 45)), eth: span(at(18, 21, 40), at(18, 21, 45)) });
    expect(revealed[1].btc).toEqual(span(at(18, 21, 45), at(18, 21, 50)));
    expect(revealed[1].btc).toHaveLength(5);
  });

  it('a session loaded as complete is locked from the start', async () => {
    const e = new ReplayEngine(fakeServer(), {
      panels: PANELS, cursorMs: PERIOD_TO, serverCursorMs: PERIOD_TO, timeframe: '5m', periodToMs: PERIOD_TO, skipWeekends: true, completed: true,
    });
    expect(e.completed()).toBe(true);
  });

  it('view-only (§9.3): history at the cursor, no ahead cache, steps inert, a switch re-fetches and is not persisted', async () => {
    const api = fakeServer({ serverCursor: at(21, 2, 0) });
    const stepped: number[] = [];
    const e = new ReplayEngine(api, {
      panels: PANELS, cursorMs: at(18, 22, 7), serverCursorMs: at(21, 2, 0), timeframe: '5m', periodToMs: PERIOD_TO,
      skipWeekends: true, viewOnly: true, completed: true, onStep: (c) => stepped.push(c),
    });
    await e.start();
    expect(seriesBars(e.seriesFor('btc')())).toEqual(await serverBars(api, 'btc', '5m', at(18, 22, 7)));
    expect(api.ahead).not.toHaveBeenCalled();

    await e.step();
    expect(e.cursor()).toBe(at(18, 22, 7));
    expect(stepped).toEqual([]);

    await e.setTimeframe('1h'); // allowed in view-only, even on a complete session
    expect(e.timeframe()).toBe('1h');
    expect(e.cursor()).toBe(at(18, 22, 7));
    expect(seriesBars(e.seriesFor('btc')())).toEqual(await serverBars(api, 'btc', '1h', at(18, 22, 7)));
    expect(api.patchTimeframe).not.toHaveBeenCalled();
    expect(api.ahead).not.toHaveBeenCalled();
  });

  it('reports a failed request instead of throwing, and leaves the cursor where it was', async () => {
    const api = fakeServer();
    const e = engine(api, at(18, 21, 40));
    await e.start();
    api.history.mockRejectedValueOnce(new Error('HTTP 503'));
    await e.setTimeframe('1h');
    expect(e.error()).toBe('HTTP 503');
    expect(e.cursor()).toBe(at(18, 21, 40));
    expect(e.timeframe()).toBe('5m'); // a failed switch leaves the old timeframe and its bars
    expect(api.patchTimeframe).not.toHaveBeenCalled();
    expect(e.blocked()).toBe(false);
  });
});

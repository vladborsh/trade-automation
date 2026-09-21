import { vi } from 'vitest';
import type { AheadResponse, Candle, Panel, ReplayHistoryResponse, Timeframe } from '@trade-automation/contracts';
import { foldOneMinute } from '@trade-automation/replay-core';
import { seriesBars } from './fold-on-step';
import { ReplayEngine, type ReplayApi } from './replay-engine';

/**
 * T-029: panels added and removed mid-session. Its own file (not replay-engine.spec.ts) so it does
 * not collide with work on the engine's own spec; the fake server mirrors that spec's.
 */
const M = 60_000;
const at = (d: number, h: number, m = 0) => Date.UTC(2026, 8, d, h, m); // 18 = Friday, 21 = Monday

function tape(instrument: Panel['instrument'], phase: number): Candle[] {
  const ranges: Array<[number, number]> = [
    [at(18, 21), at(19, 0)],
    [at(21, 0), at(21, 3)],
  ];
  const out: Candle[] = [];
  for (const [from, to] of ranges) {
    for (let t = from; t < to; t += M) {
      const i = t / M;
      const close = 100 + ((i * 7 + phase) % 23) * 0.25;
      out.push({ instrument, timeframe: '1m', openTime: t, open: close - 0.5, high: close + ((i + phase) % 5), low: close - ((i * 3 + phase) % 4), close, volume: (i % 11) + 1, closed: true, source: 'storage' });
    }
  }
  return out;
}

const BTC: Panel = { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false };
const ETH: Panel = { id: 'eth', kind: 'candles', instrument: 'binance:ETHUSDT', signals: false };
const TAPES: Record<string, Candle[]> = { btc: tape('binance:BTCUSDT', 0), eth: tape('binance:ETHUSDT', 3) };
const PERIOD_TO = at(21, 3);

/** The server: history only up to its own cursor (422 otherwise), ahead pages clamped to the period. */
function fakeServer(serverCursor: () => number, pageCap?: number) {
  return {
    history: vi.fn(async (panelId: string, tf: Timeframe, before: number, limit: number): Promise<ReplayHistoryResponse> => {
      if (before > serverCursor()) throw new Error('422 FUTURE_REQUESTED');
      const { closed, forming } = foldOneMinute(TAPES[panelId], tf, before);
      return { bars: closed.slice(-limit), forming };
    }),
    ahead: vi.fn(async (panelId: string, fromMs: number, limit: number): Promise<AheadResponse> => {
      const rest = TAPES[panelId].filter((c) => c.openTime >= fromMs && c.openTime + M <= PERIOD_TO);
      const n = Math.min(limit, pageCap ?? limit);
      return { candles: rest.slice(0, n).map((c) => [c.openTime, c.open, c.high, c.low, c.close, c.volume]), endOfTape: rest.length <= n };
    }),
    patchTimeframe: vi.fn(async () => undefined),
  } satisfies ReplayApi;
}

/** What the chart must show for a panel at `cursor`: its 1m tape folded to `tf` up to the cursor. */
function expected(panelId: string, tf: Timeframe, cursor: number): Candle[] {
  const { closed, forming } = foldOneMinute(TAPES[panelId], tf, cursor);
  return forming ? [...closed, forming] : closed;
}

async function stepN(e: ReplayEngine, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await e.step();
}

describe('ReplayEngine.addPanel / removePanel (T-029)', () => {
  it('a panel added mid-session shows exactly its bars at the cursor, even with the server cursor behind', async () => {
    const start = at(18, 23, 42);
    const api = fakeServer(() => start, 50); // the server has not confirmed any advance yet; small pages
    const e = new ReplayEngine(api, { panels: [BTC], cursorMs: start, serverCursorMs: start, timeframe: '15m', periodToMs: PERIOD_TO, skipWeekends: true });
    await e.start();
    await stepN(e, 5); // over the weekend: the client cursor is now well ahead of the server's
    expect(e.cursor()).toBeGreaterThan(start);

    await e.addPanel(ETH);
    expect(e.error()).toBeNull();
    expect(seriesBars(e.seriesFor('eth')())).toEqual(expected('eth', '15m', e.cursor()));
    // history was only ever asked for up to the server cursor
    for (const call of api.history.mock.calls) expect(call[2]).toBeLessThanOrEqual(start);

    // and it keeps folding in step with the others
    await stepN(e, 7);
    expect(seriesBars(e.seriesFor('eth')())).toEqual(expected('eth', '15m', e.cursor()));
    expect(seriesBars(e.seriesFor('btc')())).toEqual(expected('btc', '15m', e.cursor()));
  });

  it('works on a boundary cursor and after a timeframe switch; adding the same id twice is a no-op', async () => {
    const cursor = at(21, 1);
    const api = fakeServer(() => cursor);
    const e = new ReplayEngine(api, { panels: [BTC], cursorMs: cursor, serverCursorMs: cursor, timeframe: '5m', periodToMs: PERIOD_TO, skipWeekends: true });
    await e.start();
    await e.setTimeframe('1h');
    await e.addPanel(ETH);
    expect(seriesBars(e.seriesFor('eth')())).toEqual(expected('eth', '1h', cursor));
    const calls = api.history.mock.calls.length;
    await e.addPanel(ETH);
    expect(api.history.mock.calls.length).toBe(calls);
  });

  it('a call that arrives while a step is in flight waits for it instead of being dropped', async () => {
    const cursor = at(21, 1);
    const api = fakeServer(() => cursor, 3); // tiny pages: steps block on fetches
    const e = new ReplayEngine(api, { panels: [BTC], cursorMs: cursor, serverCursorMs: cursor, timeframe: '5m', periodToMs: PERIOD_TO, skipWeekends: true });
    await e.start();
    const stepping = e.step();
    const adding = e.addPanel(ETH);
    await Promise.all([stepping, adding]);
    expect(seriesBars(e.seriesFor('eth')())).toEqual(expected('eth', '5m', e.cursor()));
  });

  it('removePanel drops the tape; the remaining panels keep stepping', async () => {
    const cursor = at(21, 1);
    const api = fakeServer(() => cursor);
    const e = new ReplayEngine(api, { panels: [BTC, ETH], cursorMs: cursor, serverCursorMs: cursor, timeframe: '5m', periodToMs: PERIOD_TO, skipWeekends: true });
    await e.start();
    await e.removePanel('eth');
    expect(() => e.seriesFor('eth')).toThrow(/Unknown panel/);
    await stepN(e, 3);
    expect(e.error()).toBeNull();
    expect(seriesBars(e.seriesFor('btc')())).toEqual(expected('btc', '5m', e.cursor()));
    await e.removePanel('nope'); // unknown id: harmless
  });
});

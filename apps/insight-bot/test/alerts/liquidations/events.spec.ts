import {
  CAP_MS, EVENT_MAX_MS, SETTLE_MS, continuationNews, eventSums, firstQuiet, groupEvents, memberTimes, type CrossingRow, type SidePrint,
} from '../../../src/alerts/liquidations/events';

/**
 * IB-143 (design §2a, L11–L13) — the market event as pure functions. The boundaries the task row names: the
 * 60 s silence exactly at its edge; the 3-min cap; a coin before S resets the silence; a coin after S goes to the
 * continuation; a continuation needs a new coin or a member's threshold more; a crossing after the close opens a
 * new event.
 */
const T0 = Date.UTC(2026, 10, 4, 14, 41, 7);
const S = 1_000;
const MIN = 60 * S;
const row = (symbol: string, at: number, eventAt: number | null = null, key = `${symbol}@${at}`): CrossingRow => ({ key, symbol, at, eventAt });
const timesOf = (entries: Record<string, number[]>) => new Map(Object.entries(entries).map(([k, v]) => [k, [...v].sort((a, b) => a - b)]));

describe('firstQuiet (L11): 60 s without a member print, or the cap', () => {
  it('a print EXACTLY 60 s after the previous one is inside the window: it resets the silence', () => {
    expect(firstQuiet([T0, T0 + 60 * S], T0, T0 + CAP_MS, T0 + 10 * MIN)).toEqual({ at: T0 + 120 * S, by: 'quiet' });
  });

  it('one millisecond later it is not: the event settled at T0 + 60 s', () => {
    expect(firstQuiet([T0, T0 + 60 * S + 1], T0, T0 + CAP_MS, T0 + 10 * MIN)).toEqual({ at: T0 + 60 * S, by: 'quiet' });
  });

  it('not known before the silence has lasted 60 s: null at T0 + 59.999 s, quiet at T0 + 60 s', () => {
    expect(firstQuiet([T0], T0, T0 + CAP_MS, T0 + 60 * S - 1)).toBeNull();
    expect(firstQuiet([T0], T0, T0 + CAP_MS, T0 + 60 * S)).toEqual({ at: T0 + 60 * S, by: 'quiet' });
  });

  it('a print every 30 s: never settles, so S is the cap, T0 + 3 min — and not before the cap is reached', () => {
    const every30 = Array.from({ length: 20 }, (_, i) => T0 + i * 30 * S);
    expect(firstQuiet(every30, T0, T0 + CAP_MS, T0 + CAP_MS - 1)).toBeNull();
    expect(firstQuiet(every30, T0, T0 + CAP_MS, T0 + CAP_MS)).toEqual({ at: T0 + CAP_MS, by: 'cap' });
  });

  it('prints after `now` (a replay reads ahead) are not known yet', () => {
    expect(firstQuiet([T0, T0 + 50 * S], T0, T0 + CAP_MS, T0 + 30 * S)).toBeNull();
  });

  it('a silence that would end after the cap is the cap', () => {
    // prints 50 s apart until T0 + 150 s: the first silence would end at T0 + 210 s, after the cap
    expect(firstQuiet([T0, T0 + 50 * S, T0 + 100 * S, T0 + 150 * S], T0, T0 + CAP_MS, T0 + 10 * MIN)).toEqual({ at: T0 + CAP_MS, by: 'cap' });
  });
});

describe('memberTimes: a coin\'s prints count from its own crossing on', () => {
  it('ETH\'s prints before it crossed are not member prints', () => {
    const times = timesOf({ BTC: [T0, T0 + 10 * S], ETH: [T0 + 20 * S, T0 + 40 * S] });
    expect(memberTimes([row('BTC', T0), row('ETH', T0 + 40 * S)], times)).toEqual([T0, T0 + 10 * S, T0 + 40 * S]);
  });
});

describe('groupEvents (L11)', () => {
  const none = new Map();

  it('one coin, settled: S = last print + 60 s and the event closes there', () => {
    const [e, ...rest] = groupEvents([row('BTC', T0)], timesOf({ BTC: [T0, T0 + 20 * S] }), T0 + 10 * MIN, none);
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ t0: T0, s: { at: T0 + 80 * S, by: 'quiet' }, close: { at: T0 + 80 * S, by: 'quiet' } });
  });

  it('a coin crossing before S joins the first message and resets the 60 s', () => {
    // BTC alone would settle at T0 + 60 s; ETH crosses at T0 + 50 s and prints until T0 + 90 s
    const times = timesOf({ BTC: [T0], ETH: [T0 + 50 * S, T0 + 90 * S] });
    const [e] = groupEvents([row('BTC', T0), row('ETH', T0 + 50 * S)], times, T0 + 10 * MIN, none);
    expect(e?.members.map((m) => m.symbol)).toEqual(['BTC', 'ETH']);
    expect(e?.s).toEqual({ at: T0 + 150 * S, by: 'quiet' });
  });

  it('a crossing AT the close (half-open) opens a new event; one before it joins', () => {
    const times = timesOf({ BTC: [T0], ETH: [T0 + 60 * S], SOL: [T0 + 60 * S - 1] });
    const atClose = groupEvents([row('BTC', T0), row('ETH', T0 + 60 * S)], times, T0 + 10 * MIN, none);
    expect(atClose.map((e) => [e.t0, e.members.map((m) => m.symbol)])).toEqual([[T0, ['BTC']], [T0 + 60 * S, ['ETH']]]);
    const before = groupEvents([row('BTC', T0), row('SOL', T0 + 60 * S - 1)], times, T0 + 10 * MIN, none);
    expect(before.map((e) => e.members.map((m) => m.symbol))).toEqual([['BTC', 'SOL']]);
  });

  it('capped: a coin crossing after S joins (the continuation), the close is the first silence after S', () => {
    const btc = Array.from({ length: 9 }, (_, i) => T0 + i * 30 * S); // T0 … T0 + 4 min, every 30 s
    const times = timesOf({ BTC: btc, BNB: [T0 + 200 * S, T0 + 260 * S] });
    const [e] = groupEvents([row('BTC', T0), row('BNB', T0 + 200 * S)], times, T0 + 20 * MIN, none);
    expect(e?.s).toEqual({ at: T0 + CAP_MS, by: 'cap' });
    expect(e?.members.map((m) => m.symbol)).toEqual(['BTC', 'BNB']);
    expect(e?.close).toEqual({ at: T0 + 320 * S, by: 'quiet' });
  });

  it('a cascade that never pauses closes at T0 + 30 min ("max")', () => {
    const btc = Array.from({ length: 70 }, (_, i) => T0 + i * 30 * S);
    const [e] = groupEvents([row('BTC', T0)], timesOf({ BTC: btc }), T0 + 40 * MIN, none);
    expect(e?.close).toEqual({ at: T0 + EVENT_MAX_MS, by: 'cap' });
  });

  it('still open: S known, close not yet', () => {
    const btc = Array.from({ length: 12 }, (_, i) => T0 + i * 30 * S);
    const [e] = groupEvents([row('BTC', T0)], timesOf({ BTC: btc }), T0 + 4 * MIN, none);
    expect(e).toMatchObject({ s: { at: T0 + CAP_MS, by: 'cap' }, close: null });
  });

  it('rows carrying eventAt stay where the journal put them; the journal\'s S wins over a recomputation', () => {
    const times = timesOf({ BTC: [T0], ETH: [T0 + 5 * MIN] });
    const decided = new Map([[T0, { first: { id: 1, sentAt: T0 + CAP_MS, settled: 'cap' as const, coins: ['BTC'], late: false } }]]);
    const [e, ...rest] = groupEvents([row('BTC', T0, T0), row('ETH', T0 + 5 * MIN, T0)], times, T0 + 10 * MIN, decided);
    expect(rest).toEqual([]);
    expect(e?.s).toEqual({ at: T0 + CAP_MS, by: 'cap' });
    expect(e?.close).toEqual({ at: T0 + 5 * MIN + SETTLE_MS, by: 'quiet' });
  });

  it('a journalled close is final: a later crossing opens a new event', () => {
    const decided = new Map([[T0, { first: { id: 1, sentAt: T0 + CAP_MS, settled: 'cap' as const, coins: ['BTC'], late: false }, close: { closedAt: T0 + 4 * MIN } }]]);
    const events = groupEvents([row('BTC', T0, T0), row('ETH', T0 + 4 * MIN)], timesOf({ BTC: [T0], ETH: [T0 + 4 * MIN] }), T0 + 10 * MIN, decided);
    expect(events.map((e) => e.t0)).toEqual([T0, T0 + 4 * MIN]);
  });
});

describe('sums and the continuation\'s news (L12, L13)', () => {
  const p = (symbol: string, ts: number, usd: number, venue: SidePrint['venue'] = 'binance'): SidePrint => ({ symbol, ts, usd, venue });

  it('each coin sums from its own window start (crossedAt − 5 min) to the moment, largest first; totals and the largest print', () => {
    const prints = [p('BTC', T0 - 6 * MIN, 9e6), p('BTC', T0 - MIN, 3e6), p('BTC', T0, 3e6, 'bybit'), p('ETH', T0 + 30 * S, 4e6, 'okx'), p('ETH', T0 + 3 * MIN, 1e6)];
    const s = eventSums([row('BTC', T0), row('ETH', T0 + 30 * S)], prints, T0 + 2 * MIN);
    expect(s.coins.map((c) => [c.symbol, c.sumUsd, c.count, c.windowStartMs])).toEqual([['BTC', 6e6, 2, T0 - 5 * MIN], ['ETH', 4e6, 1, T0 + 30 * S - 5 * MIN]]);
    expect(s).toMatchObject({ totalUsd: 10e6, count: 3, largest: { usd: 4e6, venue: 'okx', symbol: 'ETH' } });
    expect(s.coins[0]?.byVenue).toEqual({ binance: 3e6, bybit: 3e6, okx: 0 });
  });

  it('a coin crossing at or after the moment is not in its sums', () => {
    expect(eventSums([row('BTC', T0), row('ETH', T0 + 2 * MIN)], [p('BTC', T0, 6e6), p('ETH', T0 + 2 * MIN, 4e6)], T0 + 2 * MIN).coins.map((c) => c.symbol)).toEqual(['BTC']);
  });

  it('no new coin and less than a threshold more after S: not news', () => {
    const prints = [p('BTC', T0, 6e6), p('BTC', T0 + 4 * MIN, 4.9e6)];
    expect(continuationNews([row('BTC', T0)], ['BTC'], prints, T0 + CAP_MS, T0 + 5 * MIN, () => 5e6)).toEqual({ newCoins: [], addedCoins: [] });
  });

  it('a member adding at least its own threshold after S is news; prints AT S belong to the first message', () => {
    const prints = [p('BTC', T0 + CAP_MS, 1e6), p('BTC', T0 + 4 * MIN, 5e6)];
    expect(continuationNews([row('BTC', T0)], ['BTC'], prints, T0 + CAP_MS, T0 + 5 * MIN, () => 5e6)).toEqual({ newCoins: [], addedCoins: ['BTC'] });
    expect(continuationNews([row('BTC', T0)], ['BTC'], prints, T0 + CAP_MS, T0 + 5 * MIN, () => 6e6)).toEqual({ newCoins: [], addedCoins: [] });
  });

  it('a coin that joined after the first message is news', () => {
    expect(continuationNews([row('BTC', T0), row('BNB', T0 + 4 * MIN)], ['BTC'], [], T0 + CAP_MS, T0 + 6 * MIN, () => 5e6)).toEqual({ newCoins: ['BNB'], addedCoins: [] });
  });
});

import { LIQ_DEFAULT_PARAMS, type LiqAlertDetails, type LiqVenue } from '@trade-automation/contracts';
import { randomWindowEnds } from '../../../src/alerts/liquidations/controls';
import { LiqAlertLoop } from '../../../src/alerts/liquidations/liq-alert-loop';
import { MemoryLiqStore } from './memory-liq-store';

/**
 * IB-122 (L1–L8) — the loop over an in-memory store, ticking every 30 s like the service. Every rule the
 * task row lists as a spec: a cascade across a minute/tick boundary is one alert; `at` is the exact
 * crossing; quiet + exactly one continuation; a fresh alert after 30 min; late; a silent venue named;
 * dedupe across a restart; sending off by default.
 */
const T = Date.UTC(2026, 10, 5, 12, 0, 0);
const S = 1_000;
const MIN = 60 * S;
const UNIVERSE = [{ id: 'BTCUSDT', base: 'BTC', binance_perp: 'BTCUSDT', bybit_linear: 'BTCUSDT', okx_swap: 'BTC-USDT-SWAP' }];

function setup() {
  const store = new MemoryLiqStore();
  const sent: Array<{ chatId: number; text: string }> = [];
  const make = () => new LiqAlertLoop({
    store, universe: UNIVERSE, webBaseUrl: 'https://insight.example', build: 'dev', source: 'live',
    send: async (chatId, text) => (sent.push({ chatId, text }), true),
  });
  const loop = make();
  const print = (atMs: number, usd: number, venue: LiqVenue = 'binance', side: 'long' | 'short' = 'long', symbol = 'BTC') => {
    const sym = venue === 'okx' ? `${symbol}-USDT-SWAP` : `${symbol}USDT`;
    store.tape.push({ venue, symbol: sym, side, ts: atMs, usd });
  };
  /** Ticks every 30 s over [fromMs, toMs], as the service does. */
  const run = async (l: LiqAlertLoop, fromMs: number, toMs: number) => {
    for (let t = fromMs; t <= toMs; t += 30 * S) await l.tick(t);
  };
  return { store, sent, loop, make, print, run };
}

const alertsOf = (store: MemoryLiqStore, event: 'alert' | 'continuing' = 'alert') => store.alerts.filter((a) => a.event === event);

describe('LiqAlertLoop (L1): one cascade, one alert, at the exact crossing', () => {
  it('a $6M BTC cascade straddling the 12:00 minute, a 5-min boundary and two ticks is ONE alert at the print that crossed $5M', async () => {
    const h = setup();
    h.print(T - 70 * S, 2e6, 'binance');
    h.print(T - 5 * S, 1.5e6, 'bybit');
    h.print(T + 25 * S, 1.6e6, 'okx'); // 5.1M here: the crossing
    h.print(T + 50 * S, 0.9e6, 'bybit');
    await h.run(h.loop, T - 2 * MIN, T + 10 * MIN);
    const alerts = alertsOf(h.store);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ symbol: 'BTCUSDT', atMs: T + 25 * S, late: false, dedupeKey: `liq:BTCUSDT:long:${T + 25 * S - 5 * MIN}` });
    expect(alerts[0]?.details).toMatchObject({
      side: 'long', sumUsd: 5.1e6, thresholdUsd: 5e6, count: 3, byVenue: { binance: 2e6, bybit: 1.5e6, okx: 1.6e6 },
      largest: { usd: 2e6, venue: 'binance' }, silentVenues: [], binanceFootnote: false,
    });
    // direction-free price paths (the store writes the 4h/24h/72h rows), from the next 5 m bar
    expect(h.store.paths.filter((p) => p.subject === `alert:${alerts[0]?.id}`).map((p) => p.t0)).toEqual([(T + 5 * MIN) / 1000]);
  });

  it('sending is OFF by default: journalled, never sent', async () => {
    const h = setup();
    h.print(T, 6e6);
    await h.run(h.loop, T - 30 * S, T + MIN);
    expect(alertsOf(h.store)).toHaveLength(1);
    expect(h.sent).toEqual([]);
    expect(alertsOf(h.store)[0]).toMatchObject({ firedAt: null, recipients: 0 });
  });

  it('switched on: sent once to each recipient, the Binance footnote with the first message of the UTC day only', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 6e6);
    h.print(T + 40 * MIN, 6e6);
    await h.run(h.loop, T - 30 * S, T + 45 * MIN);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[0]?.text).toContain('Крупные ликвидации лонгов BTC: $6M за 5 мин');
    expect(h.sent[0]?.text).toContain('Binance публикует');
    expect(h.sent[1]?.text).not.toContain('Binance публикует');
    expect(alertsOf(h.store).map((a) => a.recipients)).toEqual([1, 1]);
  });

  it('L4: a listed coin without a threshold, or switched off, is not evaluated', async () => {
    const h = setup();
    h.store.params = { perCoin: { BTCUSDT: { enabled: false, thresholdUsd: 5e6 } } };
    h.print(T, 9e6);
    h.print(T, 9e6, 'binance', 'long', 'TRX');
    await h.run(h.loop, T - 30 * S, T + MIN);
    expect(h.store.alerts).toEqual([]);
  });
});

describe('LiqAlertLoop (L2): quiet 30 min, one continuation, fresh after', () => {
  it('more liquidations inside 30 min: no second alert, ONE «продолжается» when the sum since the window start reaches 2×', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 6e6); // alert at T, window start T − 5 min
    h.print(T + 3 * MIN, 2e6);
    h.print(T + 9 * MIN, 2.5e6); // 10.5M since T − 5 min: continuation here
    h.print(T + 12 * MIN, 6e6); // a full new window inside the quiet period: no alert, no 2nd continuation
    await h.run(h.loop, T - 30 * S, T + 29 * MIN);
    expect(alertsOf(h.store)).toHaveLength(1);
    const cont = alertsOf(h.store, 'continuing');
    expect(cont).toHaveLength(1);
    expect(cont[0]).toMatchObject({ atMs: T + 9 * MIN, dedupeKey: `liq-cont:BTCUSDT:long:${alertsOf(h.store)[0]?.id}` });
    expect(h.sent.map((m) => m.text.split('\n')[0])).toEqual(['Крупные ликвидации лонгов BTC: $6M за 5 мин', 'Ликвидации лонгов BTC — продолжается: уже $11M с 11:55 UTC']);
  });

  it('the running sum stops at the end of the quiet period; the cascade still going gets a fresh alert after it', async () => {
    const h = setup();
    h.print(T, 6e6);
    h.print(T + 31 * MIN, 5.5e6); // after the quiet period: 11.5M since T − 5 min, but outside it — no continuation
    await h.run(h.loop, T - 30 * S, T + 40 * MIN);
    expect(alertsOf(h.store, 'continuing')).toEqual([]);
    expect(alertsOf(h.store).map((a) => a.atMs)).toEqual([T, T + 31 * MIN]);
  });

  it('the two sides are separate: a long alert does not quiet the shorts', async () => {
    const h = setup();
    h.print(T, 6e6, 'binance', 'long');
    h.print(T + MIN, 6e6, 'binance', 'short');
    await h.run(h.loop, T - 30 * S, T + 3 * MIN);
    expect(alertsOf(h.store).map((a) => (a.details as LiqAlertDetails).side)).toEqual(['long', 'short']);
  });
});

describe('LiqAlertLoop: restarts, late, dedupe', () => {
  it('a restart (a new loop over the same journal) neither journals nor sends the alert again, and keeps the quiet period', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 6e6);
    await h.run(h.loop, T - 30 * S, T + MIN);
    h.print(T + 4 * MIN, 6e6);
    await h.run(h.make(), T + 2 * MIN, T + 6 * MIN); // boots with a 35-min look-back over the same prints
    expect(alertsOf(h.store)).toHaveLength(1);
    expect(h.sent).toHaveLength(2); // the alert, then the continuation (12M ≥ 10M) — not the alert again
    expect(alertsOf(h.store, 'continuing')).toHaveLength(1);
  });

  it('L6: a cascade the process slept through (at > 5 min ago) is journalled late and never sent', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 6e6);
    await h.loop.tick(T + 10 * MIN); // first tick after boot
    expect(alertsOf(h.store)).toEqual([expect.objectContaining({ atMs: T, late: true, firedAt: null })]);
    expect(h.sent).toEqual([]);
  });

  it('an overlapping tick re-sees the crossing: one row', async () => {
    const h = setup();
    h.print(T, 6e6);
    await h.loop.tick(T + 10 * S);
    await h.loop.tick(T + 15 * S);
    await h.loop.tick(T + 20 * S);
    expect(alertsOf(h.store)).toHaveLength(1);
  });
});

describe('LiqAlertLoop (L3, L5): a venue that could not report is named', () => {
  it('TRX before its first 5 min on Bybit/OKX, and OKX\'s stream stale on BTC', async () => {
    const h = setup();
    const okxStale = { firstSeen: 0, lastSeen: T - 10 * MIN };
    h.store.status = {
      ...MemoryLiqStore.allAlive(),
      heartbeats: new Map([['binance', { firstSeen: 0, lastSeen: Number.MAX_SAFE_INTEGER }], ['bybit', { firstSeen: 0, lastSeen: Number.MAX_SAFE_INTEGER }], ['okx', okxStale]]),
      tracked: new Map([['bybit', new Map([['BTCUSDT', 0], ['TRXUSDT', T - MIN]])], ['okx', new Map([['BTC-USDT-SWAP', 0]])]]),
    };
    h.print(T, 6e6);
    h.print(T, 4e5, 'binance', 'long', 'TRX');
    await h.run(h.loop, T - 30 * S, T + MIN);
    const by = Object.fromEntries(alertsOf(h.store).map((a) => [a.symbol, (a.details as LiqAlertDetails).silentVenues]));
    expect(by.BTCUSDT).toEqual([{ venue: 'okx', reason: 'stream_silent' }]);
    expect(by.TRXUSDT).toEqual([{ venue: 'bybit', reason: 'not_collected' }, { venue: 'okx', reason: 'not_collected' }]);
  });

  it('L5: TRX is read on its mapped venue symbols (TRXUSDT, TRX-USDT-SWAP) and summed', async () => {
    const h = setup();
    h.print(T, 1e5, 'binance', 'long', 'TRX');
    h.print(T + S, 1e5, 'bybit', 'long', 'TRX');
    h.print(T + 2 * S, 1e5, 'okx', 'long', 'TRX');
    await h.run(h.loop, T - 30 * S, T + MIN);
    expect(alertsOf(h.store)).toEqual([expect.objectContaining({ symbol: 'TRXUSDT', atMs: T + 2 * S })]);
    expect((alertsOf(h.store)[0]?.details as LiqAlertDetails).byVenue).toEqual({ binance: 1e5, bybit: 1e5, okx: 1e5 });
  });
});

describe('LiqAlertLoop (L8): controls', () => {
  it('near_miss: the hour\'s largest window at ≥ 0.5× that fired nothing, written once the hour is evaluated, with its ratio', async () => {
    const h = setup();
    h.print(T + 10 * MIN, 2.6e6);
    h.print(T + 30 * MIN, 3.4e6);
    await h.run(h.loop, T - 30 * S, T + 59 * MIN);
    expect(h.store.controls.filter((c) => c.kind === 'near_miss')).toEqual([]); // the hour is not over
    await h.run(h.loop, T + 59 * MIN + 30 * S, T + 61 * MIN);
    const nm = h.store.controls.filter((c) => c.kind === 'near_miss');
    expect(nm).toHaveLength(1);
    expect(nm[0]).toMatchObject({ symbol: 'BTCUSDT', atMs: T + 30 * MIN, dedupeKey: `liq-nm:BTCUSDT:long:${T / 1000}` });
    expect(nm[0]?.details).toMatchObject({ sumUsd: 3.4e6, ratio: 0.68, hour: T / 1000 });
    expect(h.store.paths.filter((p) => p.subject === `control:${nm[0]?.id}`)).toEqual([{ subject: `control:${nm[0]?.id}`, symbol: 'BTCUSDT', t0: (T + 30 * MIN) / 1000 }]);
  });

  it('random: each coin\'s 2 hash-picked windows of the day, both sides summed; the same windows on a rerun', async () => {
    const h = setup();
    const day = T - 12 * 60 * MIN;
    const ends = randomWindowEnds('BTCUSDT', day);
    expect(ends).toHaveLength(2);
    expect(randomWindowEnds('BTCUSDT', day)).toEqual(ends);
    const end = ends[0] as number;
    h.print(end - MIN, 1e5, 'binance', 'long');
    h.print(end - MIN, 2e5, 'bybit', 'short');
    await h.run(h.loop, end - MIN, end + MIN);
    const rnd = h.store.controls.filter((c) => c.kind === 'random' && c.symbol === 'BTCUSDT' && c.atMs === end);
    expect(rnd).toHaveLength(1);
    expect(rnd[0]?.details).toEqual({ windowStartMs: end - 5 * MIN, longUsd: 1e5, shortUsd: 2e5, thresholdUsd: 5e6 });
  });
});

describe('LiqAlertLoop (L7): cost', () => {
  it('steady state: one tape read per tick over ≤ 6 min, no continuation reads without an open quiet period', async () => {
    const h = setup();
    await h.run(h.loop, T, T + 10 * MIN); // the first tick catches up 35 min in 7 reads, then one per tick
    const before = h.store.reads.prints;
    const report = await h.loop.tick(T + 10 * MIN + 30 * S);
    expect(h.store.reads.prints - before).toBe(1);
    expect(report).toMatchObject({ fromMs: T + 9 * MIN + 30 * S, toMs: T + 10 * MIN + 30 * S });
    expect(h.store.reads.runningSum).toBe(0);
  });

  it('defaults: the five coins of L4', () => {
    expect(Object.keys(LIQ_DEFAULT_PARAMS.perCoin)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'TRXUSDT']);
  });
});

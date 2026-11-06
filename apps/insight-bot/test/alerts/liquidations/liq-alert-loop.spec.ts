import { LIQ_DEFAULT_PARAMS, type LiqAlertDetails, type LiqEventContinuingDetails, type LiqEventDetails, type LiqVenue } from '@trade-automation/contracts';
import { randomWindowEnds } from '../../../src/alerts/liquidations/controls';
import { LiqAlertLoop } from '../../../src/alerts/liquidations/liq-alert-loop';
import { MemoryLiqStore } from './memory-liq-store';

/**
 * IB-122 (L1–L8) and IB-143 (L10–L15) — the loop over an in-memory store, ticking every 10 s like the service.
 * Crossings: a cascade across a minute/tick boundary is one crossing at the exact moment; journalled, never sent
 * by itself. Events: one message per side at S (60 s quiet or the 3-min cap); at most one continuation at the
 * close, only with news; long and short independent; a restart mid-event does not send twice; late.
 */
const T = Date.UTC(2026, 10, 5, 12, 0, 0);
const S = 1_000;
const MIN = 60 * S;
const UNIVERSE = [{ id: 'BTCUSDT', base: 'BTC', binance_perp: 'BTCUSDT', bybit_linear: 'BTCUSDT', okx_swap: 'BTC-USDT-SWAP' }];

function setup() {
  const store = new MemoryLiqStore();
  store.coins = [{ symbol: 'BTCUSDT', base: 'BTC' }, { symbol: 'ETHUSDT', base: 'ETH' }, { symbol: 'BNBUSDT', base: 'BNB' }, { symbol: 'TRXUSDT', base: 'TRX' }];
  store.status = {
    ...store.status,
    tracked: new Map([['bybit', new Map(['BTC', 'TRX', 'ETH', 'BNB'].map((b) => [`${b}USDT`, 0]))], ['okx', new Map(['BTC', 'TRX', 'ETH', 'BNB'].map((b) => [`${b}-USDT-SWAP`, 0]))]]),
  };
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
  /** Ticks every 10 s over [fromMs, toMs], as the service does. */
  const run = async (l: LiqAlertLoop, fromMs: number, toMs: number) => {
    for (let t = fromMs; t <= toMs; t += 10 * S) await l.tick(t);
  };
  return { store, sent, loop, make, print, run };
}

type Ev = 'alert' | 'continuing' | 'event' | 'event_continuing';
const alertsOf = (store: MemoryLiqStore, event: Ev = 'alert') => store.alerts.filter((a) => a.event === event);
const firstLine = (m: { text: string }) => m.text.split('\n')[0];

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

  it('L10: the crossing is journalled with its event\'s T0 and is never sent by itself; sending is OFF by default', async () => {
    const h = setup();
    h.print(T, 6e6);
    await h.run(h.loop, T - 30 * S, T + 3 * MIN);
    expect(alertsOf(h.store)).toEqual([expect.objectContaining({ atMs: T, firedAt: null, recipients: 0 })]);
    expect((alertsOf(h.store)[0]?.details as LiqAlertDetails).eventAt).toBe(T);
    expect(alertsOf(h.store, 'event')).toEqual([expect.objectContaining({ atMs: T + MIN, firedAt: null })]);
    expect(h.sent).toEqual([]);
  });

  it('L4: a listed coin without a threshold is not evaluated; IB-151: one switched off is, its crossing journalled muted, outside any event', async () => {
    const h = setup();
    h.store.enabled = true;
    h.store.params = { perCoin: { BTCUSDT: { enabled: false, thresholdUsd: 5e6 } } };
    h.print(T, 9e6);
    h.print(T, 9e6, 'binance', 'long', 'TRX');
    const reports: Array<{ muted: number } | null> = [];
    for (let t = T - 30 * S; t <= T + 3 * MIN; t += 10 * S) reports.push(await h.loop.tick(t));
    expect(h.store.alerts.map((a) => [a.event, a.symbol, a.mutedBy, a.dedupeKey, a.firedAt])).toEqual([
      ['alert', 'BTCUSDT', 'coin', `liq:BTCUSDT:long:${T - 5 * MIN}:muted`, null],
    ]);
    expect((h.store.alerts[0]?.details as LiqAlertDetails).eventAt).toBeUndefined();
    expect(h.store.paths.filter((p) => p.subject === `alert:${h.store.alerts[0]?.id}`)).toHaveLength(1);
    expect(reports.reduce((n, r) => n + (r?.muted ?? 0), 0)).toBe(1);
    expect(h.sent).toEqual([]);
  });

  it('IB-151: a muted coin\'s quiet period is its own — a coin turned back on crosses again at once, as if the muted row had never been written', async () => {
    const h = setup();
    h.store.params = { perCoin: { BTCUSDT: { enabled: false, thresholdUsd: 5e6 } } };
    h.print(T, 9e6);
    h.print(T + 3 * MIN, 1e6); // still inside the muted crossing's 30-min quiet
    await h.run(h.loop, T - 30 * S, T + MIN);
    // muted: a second crossing inside its own quiet period is not journalled
    h.print(T + 90 * S, 6e6);
    await h.run(h.loop, T + MIN + 10 * S, T + 2 * MIN);
    expect(h.store.alerts.filter((a) => a.event === 'alert').map((a) => a.mutedBy)).toEqual(['coin']);
    h.store.params = { perCoin: { BTCUSDT: { enabled: true, thresholdUsd: 5e6 } } };
    await h.run(h.loop, T + 2 * MIN + 10 * S, T + 6 * MIN);
    // on: the unmuted coin does not see its muted row, so the window crossing again (9M + 6M + 1M) is a crossing
    const unmuted = h.store.alerts.filter((a) => a.event === 'alert' && a.mutedBy === undefined);
    expect(unmuted.map((a) => a.atMs)).toEqual([T + 3 * MIN]);
  });
});

describe('LiqAlertLoop (L11–L13): one message per market event', () => {
  it('one coin, settled: ONE message at the last print + 60 s, with the true size, reading like the old alert', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 6e6);
    h.print(T + 20 * S, 1.5e6, 'bybit');
    await h.run(h.loop, T - 30 * S, T + 10 * MIN);
    const ev = alertsOf(h.store, 'event');
    expect(ev).toEqual([expect.objectContaining({ symbol: 'BTCUSDT', atMs: T + 80 * S, dedupeKey: `liq-ev:long:${T}`, recipients: 1 })]);
    expect(ev[0]?.details).toMatchObject({ eventAt: T, sentAt: T + 80 * S, settled: 'quiet', totalUsd: 7.5e6, count: 2, binanceFootnote: true });
    // 1.5× its threshold, alone: small (IB-148, L18), so sent at the end of its hold, S + 120 s, with the content fixed at S
    expect(ev[0]).toMatchObject({ firedAt: T + 200 * S, details: expect.objectContaining({ heldUntil: T + 200 * S }) });
    expect(alertsOf(h.store, 'event_continuing')).toEqual([]);
    expect(h.sent.map(firstLine)).toEqual(['Крупные ликвидации лонгов BTC: $7.5M за 7 мин']);
    expect(h.sent[0]?.text).toContain('Binance $6M · Bybit $1.5M · OKX $0');
    expect(h.sent[0]?.text).toContain(`https://insight.example/instrument/BTCUSDT?at=${T / 1000}&tf=5m`);
  });

  it('two coins of one side within the minute: ONE message listing both, largest first; the link is the largest coin', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 6e6);
    h.print(T + 40 * S, 9e6, 'okx', 'long', 'ETH'); // ETH crosses before S (T + 60 s): resets the silence
    await h.run(h.loop, T - 30 * S, T + 10 * MIN);
    const ev = alertsOf(h.store, 'event');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ symbol: 'ETHUSDT', atMs: T + 100 * S });
    expect((ev[0]?.details as LiqEventDetails).coins.map((c) => [c.symbol, c.sumUsd])).toEqual([['ETHUSDT', 9e6], ['BTCUSDT', 6e6]]);
    expect(alertsOf(h.store).map((a) => (a.details as LiqAlertDetails).eventAt)).toEqual([T, T]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.text.split('\n').slice(0, 4)).toEqual([
      'Крупные ликвидации лонгов: $15M за 7 мин',
      'ETH $9M — Binance $0 · Bybit $0 · OKX $9M',
      'BTC $6M — Binance $6M · Bybit $0 · OKX $0',
      '2 ликвидации, крупнейшая $9M (ETH, OKX)',
    ]);
  });

  it('long and short are independent events', async () => {
    const h = setup();
    h.print(T, 6e6, 'binance', 'long');
    h.print(T + 10 * S, 6e6, 'binance', 'short');
    await h.run(h.loop, T - 30 * S, T + 5 * MIN);
    expect(alertsOf(h.store, 'event').map((e) => [e.dedupeKey, e.atMs])).toEqual([[`liq-ev:long:${T}`, T + MIN], [`liq-ev:short:${T + 10 * S}`, T + 70 * S]]);
  });

  it('cap: a cascade still printing at T0 + 3 min is sent then; the dribble after it ends silently, its size journalled', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 6e6);
    for (let t = T + 30 * S; t <= T + 5 * MIN; t += 30 * S) h.print(t, 1e5); // + $1M, under a threshold more
    await h.run(h.loop, T - 30 * S, T + 15 * MIN);
    expect(alertsOf(h.store, 'event')[0]).toMatchObject({ atMs: T + 3 * MIN });
    expect(alertsOf(h.store, 'event')[0]?.details).toMatchObject({ settled: 'cap', totalUsd: 6.6e6 });
    const cont = alertsOf(h.store, 'event_continuing');
    expect(cont).toEqual([expect.objectContaining({ atMs: T + 6 * MIN, dedupeKey: `liq-ev-cont:long:${T}`, firedAt: null })]);
    expect(cont[0]?.details).toMatchObject({ closedAt: T + 6 * MIN, closedBy: 'quiet', news: false, newCoins: [], addedCoins: [], totalUsd: 7e6 });
    expect(h.sent).toHaveLength(1);
  });

  it('cap, then a member adds its threshold again: ONE continuation at the close, dated after the first message', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 6e6);
    for (let t = T + 30 * S; t <= T + 3 * MIN; t += 30 * S) h.print(t, 1e5); // still printing at the cap
    for (let t = T + 3.5 * MIN; t <= T + 5 * MIN; t += 30 * S) h.print(t, 1.5e6); // $6M more after S
    await h.run(h.loop, T - 30 * S, T + 15 * MIN);
    const [first] = alertsOf(h.store, 'event');
    const [cont] = alertsOf(h.store, 'event_continuing');
    expect(cont).toMatchObject({ atMs: T + 6 * MIN, recipients: 1 });
    expect((cont?.details as LiqEventContinuingDetails)).toMatchObject({ addedCoins: ['BTCUSDT'], newCoins: [], news: true, firstMessageId: first?.id });
    expect((cont?.atMs ?? 0) >= (first?.atMs ?? Infinity)).toBe(true);
    expect(h.sent.map(firstLine)).toEqual(['Крупные ликвидации лонгов BTC: $6.6M за 8 мин', 'Ликвидации лонгов BTC продолжаются: уже $13M за 11 мин']);
  });

  it('cap, then a coin crossing after S: the continuation names it «+BNB»', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 6e6);
    for (let t = T + 30 * S; t <= T + 4 * MIN; t += 30 * S) h.print(t, 1e4);
    h.print(T + 4 * MIN + 10 * S, 4e5, 'bybit', 'long', 'BNB');
    await h.run(h.loop, T - 30 * S, T + 15 * MIN);
    expect(alertsOf(h.store, 'event')).toHaveLength(1);
    const cont = alertsOf(h.store, 'event_continuing');
    expect(cont[0]?.details).toMatchObject({ newCoins: ['BNBUSDT'], news: true, closedAt: T + 5 * MIN + 10 * S });
    expect(h.sent[1]?.text).toContain('+BNB $400k — Binance $0 · Bybit $400k · OKX $0');
    expect(firstLine(h.sent[1] as { text: string })).toBe('Ликвидации лонгов продолжаются: уже $6.5M за 11 мин');
  });

  it('a crossing after the close opens a new event (and its own message)', async () => {
    const h = setup();
    h.print(T, 6e6);
    h.print(T + 3 * MIN, 4e6, 'binance', 'long', 'ETH');
    await h.run(h.loop, T - 30 * S, T + 10 * MIN);
    expect(alertsOf(h.store, 'event').map((e) => (e.details as LiqEventDetails).eventAt)).toEqual([T, T + 3 * MIN]);
  });
});

describe('LiqAlertLoop: restarts, late, dedupe', () => {
  it('a restart mid-event resumes it from the journal: no crossing, message or continuation twice', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 16e6); // 3.2× its threshold: not small (L16, IB-148), so not held
    for (let t = T + 30 * S; t <= T + 3 * MIN; t += 30 * S) h.print(t, 1e5);
    for (let t = T + 3.5 * MIN; t <= T + 5 * MIN; t += 30 * S) h.print(t, 1.5e6);
    await h.run(h.loop, T - 30 * S, T + 4 * MIN); // the first message (cap) is out, the event still open
    expect(h.sent).toHaveLength(1);
    await h.run(h.make(), T + 4 * MIN, T + 10 * MIN); // boots with a 35-min look-back
    await h.run(h.make(), T + 10 * MIN, T + 11 * MIN); // and again after the close
    expect([alertsOf(h.store), alertsOf(h.store, 'event'), alertsOf(h.store, 'event_continuing')].map((r) => r.length)).toEqual([1, 1, 1]);
    expect(h.sent).toHaveLength(2);
  });

  it('a crossing written before IB-143 (no eventAt) is placed in time order: a later coin joins its event', async () => {
    const h = setup();
    h.print(T, 6e6);
    h.print(T + 30 * S, 4e6, 'binance', 'long', 'ETH');
    await h.store.insertAlert({
      source: 'live', event: 'alert', symbol: 'BTCUSDT', atMs: T, params: h.store.params, build: 'old', confirmedAtMs: T, late: false, dedupeKey: `liq:BTCUSDT:long:${T - 5 * MIN}`,
      details: { side: 'long', windowStartMs: T - 5 * MIN, sumUsd: 6e6, thresholdUsd: 5e6, byVenue: { binance: 6e6, bybit: 0, okx: 0 }, count: 1, largest: { usd: 6e6, venue: 'binance' }, silentVenues: [], binanceFootnote: false },
    });
    await h.run(h.loop, T + 20 * S, T + 5 * MIN);
    expect(alertsOf(h.store).map((a) => [a.symbol, (a.details as LiqAlertDetails).eventAt])).toEqual([['BTCUSDT', undefined], ['ETHUSDT', T]]);
    expect(alertsOf(h.store, 'event').map((e) => (e.details as LiqEventDetails).coins.map((c) => c.symbol))).toEqual([['BTCUSDT', 'ETHUSDT']]);
  });

  it('L14 late: a first message whose S is more than 5 min old is journalled late, never sent', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 6e6);
    await h.loop.tick(T + 10 * MIN); // first tick after boot
    expect(alertsOf(h.store)).toEqual([expect.objectContaining({ atMs: T, late: true, firedAt: null })]);
    expect(alertsOf(h.store, 'event')).toEqual([expect.objectContaining({ atMs: T + MIN, late: true, firedAt: null })]);
    expect(h.sent).toEqual([]);
  });

  it('L14 late S: a crossing found in time, then the process down until its S is more than 5 min old → late, never sent', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 16e6); // 3.2× its threshold: not small (L16, IB-148), so not held
    await h.run(h.loop, T - 30 * S, T + 30 * S); // the crossing is journalled in time; S (T + 60 s) not reached
    expect(alertsOf(h.store)).toEqual([expect.objectContaining({ late: false })]);
    await h.make().tick(T + 6 * MIN + 10 * S); // boots 5 min 10 s after S
    expect(alertsOf(h.store, 'event')).toEqual([expect.objectContaining({ atMs: T + MIN, late: true, firedAt: null })]);
    expect(h.sent).toEqual([]);
  });

  it('L14 late T0: a crossing found late makes the whole event late, even when its S is recent', async () => {
    const h = setup();
    h.store.enabled = true;
    h.print(T, 6e6);
    for (let t = T + 30 * S; t <= T + 4 * MIN; t += 30 * S) h.print(t, 1e4);
    await h.loop.tick(T + 5 * MIN + 30 * S); // the crossing 5.5 min old; S (cap, T + 3 min) 2.5 min old
    expect(alertsOf(h.store, 'event')).toEqual([expect.objectContaining({ atMs: T + 3 * MIN, late: true })]);
    expect(h.sent).toEqual([]);
  });

  it('an overlapping tick re-sees the crossing: one row', async () => {
    const h = setup();
    h.print(T, 16e6); // 3.2× its threshold: not small (L16, IB-148), so not held
    await h.loop.tick(T + 10 * S);
    await h.loop.tick(T + 15 * S);
    await h.loop.tick(T + 20 * S);
    await h.loop.tick(T + 2 * MIN);
    await h.loop.tick(T + 2 * MIN);
    expect([alertsOf(h.store), alertsOf(h.store, 'event')].map((r) => r.length)).toEqual([1, 1]);
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
    await h.run(h.loop, T - 30 * S, T + 3 * MIN);
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
  it('steady state: one tape read per tick over ≤ 5 min 20 s; no event read while no event is undecided', async () => {
    const h = setup();
    await h.run(h.loop, T, T + 10 * MIN); // the first tick catches up 35 min in 7 reads, then one per tick
    const before = h.store.reads.prints;
    const report = await h.loop.tick(T + 10 * MIN + 10 * S);
    expect(h.store.reads.prints - before).toBe(1);
    expect(report).toMatchObject({ fromMs: T + 10 * MIN - 10 * S, toMs: T + 10 * MIN + 10 * S }); // 10 s of overlap
  });

  it('an undecided event adds ONE read a tick; once decided, none', async () => {
    const h = setup();
    h.print(T, 16e6); // 3.2× its threshold: not small (L16, IB-148), so not held
    await h.run(h.loop, T - 30 * S, T + 30 * S);
    let before = h.store.reads.prints;
    await h.loop.tick(T + 40 * S);
    expect(h.store.reads.prints - before).toBe(2);
    await h.run(h.loop, T + 50 * S, T + 2 * MIN); // S at T + 60 s, settled: closed
    before = h.store.reads.prints;
    await h.loop.tick(T + 2 * MIN + 10 * S);
    expect(h.store.reads.prints - before).toBe(1);
  });

  it('defaults: the five coins of L4', () => {
    expect(Object.keys(LIQ_DEFAULT_PARAMS.perCoin)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'TRXUSDT']);
  });
});

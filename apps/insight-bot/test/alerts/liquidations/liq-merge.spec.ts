import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIQ_DEFAULT_PARAMS, type LiqEventContinuingDetails, type LiqEventDetails, type LiqSide, type LiqVenue } from '@trade-automation/contracts';
import { LiqAlertLoop } from '../../../src/alerts/liquidations/liq-alert-loop';
import { adminFigures, journalRow } from '../../../src/alerts/liquidations/pg/liq-alerts.repo';
import { MemoryLiqStore } from './memory-liq-store';

/**
 * IB-148 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §2b, L16–L20) — composition spec over the
 * shipped path: the live loop's own `tick` every 10 s, the real event, merge and text builders, an in-memory journal
 * (the store with migration 031's once-keys) and a recording sender. Sending is ON, source live, so what the sender
 * records is what the owner would have received.
 *
 * 1. Box tape, every coin: 11-04 14:30–14:53 short (events #4 and #5 of IB-143's rerun) and 11-05 14:25–15:21 long
 *    (#8, #9, #10). #5 (BNB, after #4's close) is absorbed; #9 (BNB, before #10) is folded into #10's text.
 * 2. The positive controls, which must stay separate, and the restart mid-hold.
 */
const S = 1_000;
const MIN = 60 * S;
const BASES = ['BTC', 'ETH', 'SOL', 'BNB', 'TRX'];
const UNIVERSE = BASES.map((b) => ({ id: `${b}USDT`, base: b, binance_perp: `${b}USDT`, bybit_linear: `${b}USDT`, okx_swap: `${b}-USDT-SWAP` }));

function setup() {
  const store = new MemoryLiqStore();
  store.coins = BASES.map((b) => ({ symbol: `${b}USDT`, base: b }));
  store.params = structuredClone(LIQ_DEFAULT_PARAMS); // BTC 5M, ETH 3M, SOL 1M, BNB 0.3M, TRX 0.3M: the box's
  store.enabled = true;
  store.status = {
    ...MemoryLiqStore.allAlive(),
    tracked: new Map([['bybit', new Map(BASES.map((b) => [`${b}USDT`, 0]))], ['okx', new Map(BASES.map((b) => [`${b}-USDT-SWAP`, 0]))]]),
  };
  let now = 0;
  const sent: Array<{ at: number; text: string }> = [];
  /** Every tick's failed coins / events: an event that throws is caught by the loop and only shows here. */
  const failed: string[] = [];
  const make = () => new LiqAlertLoop({
    store, universe: UNIVERSE, webBaseUrl: 'https://insight.example', build: 'dev', source: 'live',
    send: async (_chatId, text) => (sent.push({ at: now, text }), true),
  });
  /** Ticks every 10 s over [fromMs, toMs], as the service does. */
  const run = async (loop: LiqAlertLoop, fromMs: number, toMs: number) => {
    for (now = fromMs; now <= toMs; now += 10 * S) failed.push(...((await loop.tick(now))?.failed ?? []));
  };
  const print = (atMs: number, usd: number, base: string, side: LiqSide = 'long', venue: LiqVenue = 'binance') => {
    store.tape.push({ venue, symbol: venue === 'okx' ? `${base}-USDT-SWAP` : `${base}USDT`, side, ts: atMs, usd });
  };
  const events = () => store.alerts.filter((a) => a.event === 'event');
  return { store, sent, failed, make, run, print, events };
}

function loadTape(file: string, side: LiqSide) {
  const f = JSON.parse(readFileSync(join(__dirname, '../../fixtures', file), 'utf8')) as { baseMs: number; rows: Array<[number, LiqVenue, string, number]> };
  return { baseMs: f.baseMs, count: f.rows.length, prints: f.rows.map(([o, venue, symbol, usd]) => ({ venue, symbol, side, ts: f.baseMs + o, usd })) };
}

const firstLine = (m: { text: string }) => m.text.split('\n')[0];
/** Event rows in journal order, totals in $M to one decimal. */
const totals = (h: ReturnType<typeof setup>) => h.store.alerts.filter((a) => a.event === 'event' || a.event === 'event_continuing')
  .map((a) => [a.event, Math.round((a.details as LiqEventDetails).totalUsd / 1e5) / 10]);
const iso = (ms: number) => new Date(ms).toISOString();
const d4 = (hh: number, mm: number, ss = 0, ms = 0) => Date.UTC(2026, 10, 4, hh, mm, ss, ms);
const d5 = (hh: number, mm: number, ss = 0, ms = 0) => Date.UTC(2026, 10, 5, hh, mm, ss, ms);
const eventRow = (h: ReturnType<typeof setup>) => h.events().map((e) => {
  const d = e.details as LiqEventDetails;
  return { symbol: e.symbol, t0: iso(d.eventAt), mergedInto: d.mergedInto ? `${d.mergedInto.how} ${iso(d.mergedInto.eventAt)}` : null, firedAt: e.firedAt === null ? null : iso(e.firedAt) };
});

describe('IB-148 over the box tape, every coin (L20)', () => {
  it('the fixtures are the box tape they say they are', () => {
    expect(loadTape('liq-all-short-2026-11-04.json', 'short')).toMatchObject({ baseMs: d4(14, 30), count: 1599 });
    expect(loadTape('liq-all-long-2026-11-05.json', 'long')).toMatchObject({ baseMs: d5(14, 25), count: 4046 });
  });

  it('11-04 short: #4 and its continuation are sent; #5 (BNB $0.8M, 99 s after #4 closed) is absorbed, not sent, nothing edited', async () => {
    const h = setup();
    h.store.tape = loadTape('liq-all-short-2026-11-04.json', 'short').prints;
    await h.run(h.make(), d4(14, 36), d4(14, 53));
    expect(eventRow(h)).toEqual(PINNED_SHORT);
    const [large, bnb] = h.events();
    expect((bnb?.details as LiqEventDetails).mergedInto).toEqual({ eventAt: (large?.details as LiqEventDetails).eventAt, how: 'after' });
    expect(bnb?.details).toMatchObject({ totalUsd: expect.closeTo(0.8e6, -5) });
    expect(h.sent.map(firstLine)).toEqual(['Крупные ликвидации шортов: $20M за 8 мин', 'Ликвидации шортов продолжаются: уже $31M за 11 мин']);
    expect(totals(h)).toEqual([['event', 19.8], ['event_continuing', 30.8], ['event', 0.8]]); // IB-143's table: #4 $19.8M → $30.8M, #5 $0.8M
    // the large event's own figures are untouched: no «Перед этим» after its close
    expect(h.sent.some((m) => m.text.includes('Перед этим'))).toBe(false);
  });

  it('11-05 long: #8 sent; #9 (BNB $0.4M) held, folded into #10 as one last line; #10 keeps its total, {m}, link; its continuation', async () => {
    const h = setup();
    h.store.tape = loadTape('liq-all-long-2026-11-05.json', 'long').prints;
    await h.run(h.make(), d5(14, 31), d5(15, 21));
    expect(eventRow(h)).toEqual(PINNED_LONG);
    const ten = h.events()[2]?.details as LiqEventDetails;
    const nine = h.events()[1]?.details as LiqEventDetails;
    expect(nine.mergedInto).toEqual({ eventAt: ten.eventAt, how: 'before' });
    expect(ten.merged).toEqual([{ symbol: 'BNBUSDT', eventAt: nine.eventAt, sumUsd: nine.totalUsd, how: 'before' }]);
    expect(ten.coins.map((c) => c.symbol)).not.toContain('BNBUSDT'); // its figures stay its own
    expect(h.sent.map(firstLine)).toEqual([
      'Крупные ликвидации лонгов: $24M за 8 мин',
      'Крупные ликвидации лонгов: $37M за 8 мин',
      'Ликвидации лонгов продолжаются: уже $44M за 14 мин',
    ]);
    // IB-143's table: #8 $23.7M (close journalled only), #9 $0.4M, #10 $37.3M → $44.3M
    expect(totals(h)).toEqual([['event', 23.7], ['event_continuing', 23.7], ['event', 0.4], ['event', 37.3], ['event_continuing', 44.3]]);
    const lines = (h.sent[1] as { text: string }).text.split('\n');
    expect(lines.slice(-2)).toEqual(['Перед этим: BNB $395k (15:06 UTC)', expect.stringMatching(/^https:\/\/insight\.example\/instrument\/BTCUSDT\?at=\d+&tf=5m$/)]);
    expect(h.sent[2]?.text).not.toContain('Перед этим'); // the continuation repeats nothing about it (L19)
    // added latency: 0 s for #10 (its own S, the cap, acted on at the next tick)
    expect(h.sent[1]?.at).toBe(d5(15, 11, 20));
  });
});

/** Pinned from the run above; IB-143's rerun table (#4, #5). */
const PINNED_SHORT = [
  { symbol: 'BTCUSDT', t0: '2026-11-04T14:41:07.055Z', mergedInto: null, firedAt: '2026-11-04T14:44:10.000Z' },
  { symbol: 'BNBUSDT', t0: '2026-11-04T14:48:00.260Z', mergedInto: 'after 2026-11-04T14:41:07.055Z', firedAt: null },
];
/** #8, #9, #10. */
const PINNED_LONG = [
  { symbol: 'BTCUSDT', t0: '2026-11-05T14:36:44.062Z', mergedInto: null, firedAt: '2026-11-05T14:39:50.000Z' },
  { symbol: 'BNBUSDT', t0: '2026-11-05T15:06:12.138Z', mergedInto: 'before 2026-11-05T15:08:15.407Z', firedAt: null },
  { symbol: 'BTCUSDT', t0: '2026-11-05T15:08:15.407Z', mergedInto: null, firedAt: '2026-11-05T15:11:20.000Z' },
];

describe('IB-148 positive controls: these stay separate (L20)', () => {
  const T = Date.UTC(2026, 10, 6, 12, 0, 0);

  it('two large events in the window: a lone BTC at 6 ×, then ETH 60 s after its S → two messages, BTC not held', async () => {
    const h = setup();
    h.print(T, 30e6, 'BTC'); // S = T + 60 s
    h.print(T + 120 * S, 9.5e6, 'ETH'); // 3.2 ×: not small either
    await h.run(h.make(), T - 30 * S, T + 10 * MIN);
    expect(h.sent.map((m) => [m.at - T, firstLine(m)])).toEqual([
      [60 * S, 'Крупные ликвидации лонгов BTC: $30M за 6 мин'],
      [180 * S, 'Крупные ликвидации лонгов ETH: $9.5M за 6 мин'],
    ]);
    expect(h.events().map((e) => (e.details as LiqEventDetails).heldUntil)).toEqual([undefined, undefined]);
  });

  it('a small one, then an event below 10 × it during the hold → two messages, the small one first, in the same tick', async () => {
    const h = setup();
    h.print(T, 8e5, 'BNB'); // 2.7 ×: small; S = T + 60 s, held to T + 180 s
    h.print(T + 100 * S, 7.99e6, 'SOL'); // 8 × its threshold (not small), 9.99 × the BNB: below 10 ×; its S = T + 160 s
    await h.run(h.make(), T - 30 * S, T + 10 * MIN);
    expect(h.sent.map((m) => [m.at - T, firstLine(m)])).toEqual([
      [160 * S, 'Крупные ликвидации лонгов BNB: $800k за 6 мин'],
      [160 * S, 'Крупные ликвидации лонгов SOL: $8M за 6 мин'],
    ]);
    expect(h.events().map((e) => (e.details as LiqEventDetails).heldUntil)).toEqual([T + 160 * S, undefined]);
  });

  it('the same at exactly 10 ×: folded in (the ratio is inclusive)', async () => {
    const h = setup();
    h.print(T, 8e5, 'BNB');
    h.print(T + 100 * S, 8e6, 'SOL');
    await h.run(h.make(), T - 30 * S, T + 10 * MIN);
    expect(h.sent.map((m) => [m.at - T, firstLine(m)])).toEqual([[160 * S, 'Крупные ликвидации лонгов SOL: $8M за 6 мин']]);
    expect(h.sent[0]?.text).toContain('Перед этим: BNB $800k (12:00 UTC)');
  });

  it('a small one 121 s after a large close is sent; at 120 s it is absorbed (the window\'s edge)', async () => {
    for (const [gap, absorbed] of [[120, true], [121, false]] as const) {
      const h = setup();
      h.print(T, 30e6, 'BTC'); // settles quiet at T + 60 s: its close
      h.print(T + 60 * S + gap * S, 4e5, 'BNB');
      await h.run(h.make(), T - 30 * S, T + 10 * MIN);
      expect([gap, h.sent.map(firstLine)]).toEqual([gap, absorbed
        ? ['Крупные ликвидации лонгов BTC: $30M за 6 мин']
        : ['Крупные ликвидации лонгов BTC: $30M за 6 мин', 'Крупные ликвидации лонгов BNB: $400k за 6 мин']]);
      expect((h.events()[1]?.details as LiqEventDetails).mergedInto).toEqual(absorbed ? { eventAt: T, how: 'after' } : undefined);
    }
  });

  it('a large event opening at S + 120 s takes the held one in; at S + 121 s the small one has gone out alone', async () => {
    for (const [open, folded] of [[120, true], [121, false]] as const) {
      const h = setup();
      h.print(T, 4e5, 'BNB'); // S = T + 60 s
      h.print(T + 60 * S + open * S, 30e6, 'BTC');
      await h.run(h.make(), T - 30 * S, T + 10 * MIN);
      const bnb = h.events()[0];
      expect([open, (bnb?.details as LiqEventDetails).mergedInto?.how ?? null, bnb?.firedAt === null ? null : (bnb?.firedAt ?? 0) - T])
        .toEqual([open, folded ? 'before' : null, folded ? null : 180 * S]);
      expect(h.sent).toHaveLength(folded ? 1 : 2);
    }
  });

  it('a sum of exactly 3 × its threshold is not small: sent at its S, not held, not absorbed', async () => {
    const h = setup();
    h.print(T, 30e6, 'BTC');
    h.print(T + 90 * S, 9e5, 'BNB'); // 30 s after BTC's close, 3 ×
    await h.run(h.make(), T - 30 * S, T + 10 * MIN);
    expect(h.sent.map((m) => [m.at - T, firstLine(m)])).toEqual([[60 * S, 'Крупные ликвидации лонгов BTC: $30M за 6 мин'], [150 * S, 'Крупные ликвидации лонгов BNB: $900k за 6 мин']]);
  });

  it('the opposite side never merges, either way', async () => {
    const h = setup();
    h.print(T, 30e6, 'BTC', 'long'); // closes at T + 60 s
    h.print(T + 90 * S, 4e5, 'BNB', 'short'); // 30 s after a LONG close: held, then sent
    h.print(T + 5 * MIN, 4e5, 'BNB', 'long'); // a small long, S = T + 6 min …
    h.print(T + 6 * MIN + 30 * S, 30e6, 'BTC', 'short'); // … and a large SHORT during its hold
    await h.run(h.make(), T - 30 * S, T + 15 * MIN);
    expect(h.events().map((e) => (e.details as LiqEventDetails).mergedInto)).toEqual([undefined, undefined, undefined, undefined]);
    expect(h.sent.map((m) => [m.at - T, firstLine(m)])).toEqual([
      [60 * S, 'Крупные ликвидации лонгов BTC: $30M за 6 мин'],
      [270 * S, 'Крупные ликвидации шортов BNB: $400k за 6 мин'], // S + 120 s
      [7 * MIN + 30 * S, 'Крупные ликвидации шортов BTC: $30M за 6 мин'],
      [8 * MIN, 'Крупные ликвидации лонгов BNB: $400k за 6 мин'], // S + 120 s
    ]);
  });
});

describe('IB-148: a restart in the middle of a hold (L19 — the hold lives in the tape and the journal only)', () => {
  const T = Date.UTC(2026, 10, 6, 12, 0, 0);

  it('nothing opens: ONE message, at the end of the hold, from the restarted process', async () => {
    const h = setup();
    h.print(T, 4e5, 'BNB');
    await h.run(h.make(), T - 30 * S, T + 2 * MIN); // S at T + 60 s; the hold runs to T + 180 s
    expect([h.events().length, h.sent.length]).toEqual([0, 0]);
    await h.run(h.make(), T + 2 * MIN + 10 * S, T + 10 * MIN); // a new process: boots with the 35-min look-back
    await h.run(h.make(), T + 10 * MIN + 10 * S, T + 12 * MIN); // and once more after it was sent
    expect(h.sent.map((m) => [m.at - T, firstLine(m)])).toEqual([[180 * S, 'Крупные ликвидации лонгов BNB: $400k за 6 мин']]);
    expect(h.events()).toHaveLength(1);
  });

  it('a large one opens during the hold, then a restart: ONE message, the large one with the line', async () => {
    const h = setup();
    h.print(T, 4e5, 'BNB');
    h.print(T + 100 * S, 30e6, 'BTC'); // opens during the hold; its S = T + 160 s
    await h.run(h.make(), T - 30 * S, T + 130 * S);
    expect(h.sent).toHaveLength(0);
    await h.run(h.make(), T + 140 * S, T + 10 * MIN);
    await h.run(h.make(), T + 10 * MIN + 10 * S, T + 12 * MIN);
    expect(h.sent.map((m) => [m.at - T, firstLine(m)])).toEqual([[160 * S, 'Крупные ликвидации лонгов BTC: $30M за 6 мин']]);
    expect(h.sent[0]?.text).toContain('Перед этим: BNB $400k (12:00 UTC)');
    expect(h.events().map((e) => (e.details as LiqEventDetails).mergedInto?.how ?? null)).toEqual(['before', null]);
  });

  it('a held message due 3 min 10 s before a boot is still sent (late is measured from when it was due, L14)', async () => {
    const h = setup();
    h.print(T, 4e5, 'BNB');
    await h.run(h.make(), T - 30 * S, T + 30 * S);
    await h.make().tick(T + 6 * MIN + 10 * S); // 5 min 10 s after S, 3 min 10 s after the hold's end
    expect(h.events()).toEqual([expect.objectContaining({ late: false, details: expect.objectContaining({ heldUntil: T + 3 * MIN }) })]);
    expect(h.sent).toHaveLength(1);
  });

  it('an absorbed small event that hit its own cap: closed at its S — no continuation, and a later coin opens its own event', async () => {
    const h = setup();
    h.print(T, 30e6, 'BTC');
    for (let t = T + 90 * S; t <= T + 6 * MIN; t += 20 * S) h.print(t, 2e4, 'BNB'); // a BNB that dribbles past its own cap…
    h.print(T + 90 * S, 3e5, 'BNB'); // … crossing 30 s after BTC's close; S = its cap, T + 270 s
    h.print(T + 5 * MIN, 3.5e6, 'SOL'); // after that S, while BNB still prints
    await h.run(h.make(), T - 30 * S, T + 15 * MIN);
    expect((h.events()[1]?.details as LiqEventDetails)).toMatchObject({ settled: 'cap', mergedInto: { eventAt: T, how: 'after' } });
    expect(h.store.alerts.filter((a) => a.event === 'event_continuing' && (a.details as LiqEventContinuingDetails).eventAt === T + 90 * S)).toEqual([]);
    expect(h.sent.map(firstLine)).toEqual(['Крупные ликвидации лонгов BTC: $30M за 6 мин', 'Крупные ликвидации лонгов SOL: $3.5M за 6 мин']);
    expect(h.failed).toEqual([]);
  });

  it('an absorbed row never claims the day\'s Binance footnote (a large event at 23:58, a small one after midnight)', async () => {
    const h = setup();
    const M = Date.UTC(2026, 10, 7, 0, 0, 0);
    h.print(M - 2 * MIN, 30e6, 'BTC'); // closes 23:59:00, the footnote goes with it
    h.print(M + 30 * S, 4e5, 'BNB'); // 90 s later, on the next UTC day
    await h.run(h.make(), M - 3 * MIN, M + 10 * MIN);
    expect(h.events().map((e) => [(e.details as LiqEventDetails).mergedInto?.how ?? null, (e.details as LiqEventDetails).binanceFootnote])).toEqual([[null, true], ['after', false]]);
  });

  it('the fold survives a failed write: the next process sends the large message WITH the line, from the journal alone', async () => {
    const h = setup();
    h.print(T, 4e5, 'BNB');
    h.print(T + 100 * S, 30e6, 'BTC'); // its S = T + 160 s: BNB is folded in, then BTC's write fails once
    const insert = h.store.insertAlert.bind(h.store);
    let failOnce = true;
    h.store.insertAlert = async (x) => {
      if (failOnce && x.event === 'event' && x.symbol === 'BTCUSDT') { failOnce = false; throw new Error('db down'); }
      return insert(x);
    };
    await h.run(h.make(), T - 30 * S, T + 160 * S);
    expect([h.events().map((e) => e.symbol), h.sent.length, h.failed.length]).toEqual([['BNBUSDT'], 0, 1]);
    await h.run(h.make(), T + 170 * S, T + 10 * MIN);
    expect(h.sent.map(firstLine)).toEqual(['Крупные ликвидации лонгов BTC: $30M за 6 мин']);
    expect(h.sent[0]?.text).toContain('Перед этим: BNB $400k (12:00 UTC)');
  });
});

describe('IB-148: the journal and the admin page read a merged row', () => {
  it('journalRow carries mergedInto and the total; the admin row of an absorbed event says it was not sent (news false)', async () => {
    const h = setup();
    const T = Date.UTC(2026, 10, 6, 12, 0, 0);
    h.print(T, 30e6, 'BTC');
    h.print(T + 90 * S, 4e5, 'BNB');
    await h.run(h.make(), T - 30 * S, T + 10 * MIN);
    const [large, small] = h.events();
    const row = (a: typeof small) => journalRow({ id: a?.id ?? 0, event: 'event', symbol: a?.symbol ?? '', atMs: a?.atMs ?? 0, late: false, details: a?.details ?? {} });
    expect(row(small)).toMatchObject({ mergedInto: { eventAt: T, how: 'after' }, totalUsd: 4e5 });
    expect(row(large)).toMatchObject({ mergedInto: null, totalUsd: 30e6 });
    expect(adminFigures('event', 'BNBUSDT', small?.details ?? {})).toMatchObject({ news: false, sumUsd: 4e5 });
    expect(adminFigures('event', 'BTCUSDT', large?.details ?? {})).toMatchObject({ news: true });
  });
});

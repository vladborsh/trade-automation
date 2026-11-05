import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OI_DIVERGENCE_DEFAULT_PARAMS, type OiDivergenceTf } from '@trade-automation/contracts';
import { oiDivergenceAlert } from '../../../src/delivery/templates/oi-divergence.texts';
import { OiAlertLoop, type OiAlertLoopPorts } from '../../../src/alerts/oi-divergence/oi-alert-loop';
import type { NewOiControl } from '../../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import { OI_RESEARCH_WINDOWS } from '@trade-automation/contracts';
import { MemoryStore } from './memory-store';
import type { Bar } from '../../../src/insights/divergence/detector';
import { barsToFetch } from '../../../src/alerts/oi-divergence/basis';

/**
 * IB-112 — the alert loop on REAL data: dev-1's positive control (ETHUSDT 1h, Binance's own bars and
 * OI, a bullish divergence confirmed at 1792296000) replayed through the loop with an in-memory store
 * that enforces the journal's once-key exactly as migration 025 does. What is checked is the loop's
 * contract: journal always, send only on time and only when switched on, never twice.
 */
interface Fixture { bars: Bar[]; oi5m: Array<{ time: number; oi: number }>; expected: { aTime: number; bTime: number; pricePct: number; oiPct: number } }
const F: Fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'binance', 'oi-divergence-ethusdt-1h-bullish.json'), 'utf8'));
const CONFIRMED = 1_792_296_000; // the close of the bar that confirms the pair (B + N + 1 bars)
const H = 3_600;

function loop(store: MemoryStore, over: Partial<OiAlertLoopPorts> = {}) {
  const sent: Array<{ chatId: number; text: string }> = [];
  const klineCalls: Array<[string, OiDivergenceTf, number, number]> = [];
  const ports: OiAlertLoopPorts = {
    store,
    // the venue: closed bars with open in [from, to) — only the 1h fixture exists, other TFs have none
    klines: async (symbol, tf, from, to) => { klineCalls.push([symbol, tf, from, to]); return tf === '1h' ? F.bars.filter((b) => b.time >= from && b.time < to) : []; },
    oiWindow: async (_s, from, to) => ({ oi5m: F.oi5m.filter((o) => o.time > from && o.time <= to), venueSilent: [] }),
    closeAt: async (_s, at) => 2_000 + (at % 7),
    send: async (chatId, text) => { sent.push({ chatId, text }); return chatId !== 999; },
    webBaseUrl: 'https://box.example',
    build: 'b49cd48d4ab4',
    klines5m: async () => [],
    source: 'live',
    ...over,
  };
  return { loop: new OiAlertLoop(ports), sent, klineCalls };
}

describe('IB-112: the OI divergence loop on the real ETHUSDT 1h divergence', () => {
  it('switched OFF (the default): the divergence is journalled, nothing is sent', async () => {
    const store = new MemoryStore();
    const { loop: l, sent } = loop(store);
    const r = await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    expect(r).toMatchObject({ journalled: 1, late: 0, sent: 0, failed: [] });
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0]).toMatchObject({ symbol: 'ETHUSDT', tf: '1h', direction: 'bullish', late: false, firedAt: null, runLength: 2, runOf: null, confirmedAt: CONFIRMED });
    expect(store.alerts[0]?.a.time).toBe(F.expected.aTime);
    expect(store.alerts[0]?.b.time).toBe(F.expected.bTime);
    expect(store.alerts[0]?.params).toEqual(OI_DIVERGENCE_DEFAULT_PARAMS); // the row keeps the params it was made with
    expect(sent).toEqual([]);
  });

  it('switched ON: sent once to each recipient in their language, with the link; the row records who got it and the price', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, enabled: true };
    const { loop: l, sent } = loop(store);
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    const text = oiDivergenceAlert({ symbol: 'ETHUSDT', base: 'ETH', tf: '1h', direction: 'bullish', pricePct: F.expected.pricePct, oiPct: F.expected.oiPct, runLength: 2, bTime: F.expected.bTime }, 'https://box.example');
    expect(sent.map((s) => s.chatId)).toEqual([111, 222]);
    // the percentages are the detector's exact values; the fixture rounds them to 4 places
    expect(sent[0]?.text.split('\n')[0]).toBe(text.ru.split('\n')[0]);
    expect(sent[1]?.text.split('\n')[0]).toBe(text.en.split('\n')[0]);
    expect(sent[0]?.text).toContain(`https://box.example/instrument/ETHUSDT?at=${F.expected.bTime}&tf=1h`);
    const lastClose = F.bars.filter((b) => b.time + H <= CONFIRMED).at(-1)?.close;
    expect(store.alerts[0]).toMatchObject({ firedAt: CONFIRMED + 6 * 60, recipients: 2, priceAtFire: lastClose });
  });

  it('a restart re-evaluating the same bar journals nothing new and sends nothing twice (V8)', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, enabled: true };
    await loop(store).loop.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    const again = loop(store); // a new process: no memory of the first
    const r = await again.loop.evaluate('1h', CONFIRMED, CONFIRMED + 7 * 60);
    expect(r).toMatchObject({ journalled: 0, sent: 0 });
    expect(again.sent).toEqual([]);
    expect(store.alerts).toHaveLength(1);
  });

  it('LATE (the box was down): evaluated more than a bar + 10 min after confirmation → journalled late, never sent (V10)', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, enabled: true };
    const { loop: l, sent } = loop(store);
    const r = await l.evaluate('1h', CONFIRMED, CONFIRMED + H + 10 * 60 + 1);
    expect(r).toMatchObject({ journalled: 1, late: 1, sent: 0 });
    expect(store.alerts[0]).toMatchObject({ late: true, firedAt: null });
    expect(sent).toEqual([]);
  });

  it('one bar later (the next evaluation) the same divergence is no longer in the guarded range: not journalled twice, not missed', async () => {
    const store = new MemoryStore();
    const { loop: l } = loop(store);
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    const r = await l.evaluate('1h', CONFIRMED + H, CONFIRMED + H + 6 * 60);
    expect(r.journalled).toBe(0);
    expect(store.alerts).toHaveLength(1);
  });

  it('a hole in OI the venue did not cause → a skip, logged once, and no alert (V9)', async () => {
    const store = new MemoryStore();
    const holeFrom = F.expected.bTime - 2 * H;
    const { loop: l } = loop(store, { oiWindow: async (_s, from, to) => ({ oi5m: F.oi5m.filter((o) => o.time > from && o.time <= to && (o.time < holeFrom || o.time > holeFrom + 1_800)), venueSilent: [] }) });
    const r = await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    expect(r.journalled).toBe(0);
    expect(r.skips).toBeGreaterThan(0);
    const again = await l.evaluate('1h', CONFIRMED, CONFIRMED + 7 * 60);
    expect(again.skips).toBe(0); // once per (symbol, TF, bar)
  });

  it('…and the same slots marked «the venue did not publish» are not a hole: the alert stands', async () => {
    const store = new MemoryStore();
    const holeFrom = F.expected.bTime - 2 * H;
    const { loop: l } = loop(store, {
      oiWindow: async (_s, from, to) => ({ oi5m: F.oi5m.filter((o) => o.time > from && o.time <= to && (o.time < holeFrom || o.time > holeFrom + 1_800)), venueSilent: [{ from: holeFrom, to: holeFrom + 1_800 }] }),
    });
    const r = await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    expect(r).toMatchObject({ journalled: 1, skips: 0 });
  });

  it('reads the near-miss basis + W closed bars (272 + 168 = 440 on 1h, IB-115), ending at the due close; fewer than barsForEvaluation → not evaluated', async () => {
    const store = new MemoryStore();
    const { loop: l, klineCalls } = loop(store);
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    expect(klineCalls).toEqual([['ETHUSDT', '1h', CONFIRMED - 440 * H, CONFIRMED]]);
    const young = new MemoryStore();
    const short = loop(young, { klines: async (_s, _tf, _from, to) => F.bars.filter((b) => b.time >= to - 184 * H && b.time < to) });
    expect(await short.loop.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60)).toMatchObject({ journalled: 0, failed: [] });
    // a coin with exactly barsForEvaluation bars (younger than the + W) is evaluated: the venue has no earlier run
    const exact = loop(new MemoryStore(), { klines: async (_s, _tf, _from, to) => F.bars.filter((b) => b.time >= to - 185 * H && b.time < to) });
    expect(await exact.loop.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60)).toMatchObject({ journalled: 1, failed: [] });
  });

  it('the coin list is re-read each evaluation, and a failing coin does not stop the others', async () => {
    const store = new MemoryStore();
    store.symbols = ['BROKENUSDT', 'ETHUSDT'];
    const { loop: l } = loop(store, {
      klines: async (symbol, tf, from, to) => { if (symbol === 'BROKENUSDT') throw new Error('venue 503'); return tf === '1h' ? F.bars.filter((b) => b.time >= from && b.time < to) : []; },
    });
    const r = await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    expect(r).toMatchObject({ journalled: 1, failed: ['BROKENUSDT'] });
    store.symbols = [];
    expect((await l.evaluate('1h', CONFIRMED + H, CONFIRMED + H + 6 * 60)).journalled).toBe(0);
  });

  it('params come from the settings row at each evaluation (a change applies from the next one)', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, params: { ...OI_DIVERGENCE_DEFAULT_PARAMS, oiMedianMult: 50 } }; // an OI threshold nothing passes
    const { loop: l } = loop(store);
    expect((await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60)).journalled).toBe(0);
  });
});

describe('IB-112: scheduling and outcomes', () => {
  it('tick evaluates each TF once per due bar close (close + 6 min), and not before', async () => {
    const store = new MemoryStore();
    const { loop: l } = loop(store);
    const at = CONFIRMED + 6 * 60;
    expect((await l.tick(at)).map((r) => [r.tf, r.barClose])).toEqual([['15m', CONFIRMED], ['1h', CONFIRMED], ['4h', CONFIRMED - (CONFIRMED % 14_400)]]);
    expect(await l.tick(at + 60)).toEqual([]);
    expect((await l.tick(CONFIRMED + 15 * 60 + 6 * 60)).map((r) => r.tf)).toEqual(['15m']);
  });

  it('fills the +4 h and +24 h closes of SENT alerts, each when due, and closes the row when both are in (V12)', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, enabled: true };
    const { loop: l } = loop(store, { closeAt: async (_s, at) => (at === CONFIRMED + 6 * 60 + 4 * H ? 2_100 : at === CONFIRMED + 6 * 60 + 24 * H ? 1_950 : null) });
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    const fired = CONFIRMED + 6 * 60;
    expect(await l.fillOutcomes(fired + 3 * H)).toBe(0);
    expect(await l.fillOutcomes(fired + 4 * H + 30)).toBe(1);
    expect(store.alerts[0]).toMatchObject({ price4h: 2_100, price24h: null, outcomeAt: null });
    expect(await l.fillOutcomes(fired + 24 * H + 30)).toBe(1);
    expect(store.alerts[0]).toMatchObject({ price24h: 1_950, outcomeAt: fired + 24 * H + 30 });
  });

  it('an unsent (journal-only) alert gets no outcome fetch', async () => {
    const store = new MemoryStore();
    let calls = 0;
    const { loop: l } = loop(store, { closeAt: async () => { calls++; return 1; } });
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    await l.fillOutcomes(CONFIRMED + 30 * H);
    expect(calls).toBe(0);
  });
});

/**
 * IB-115 — the research journal, from the same evaluation: paths for every journalled alert, the two control
 * groups, near-misses, the build on every row, and the path measurer.
 */
describe('IB-115: the research journal in the loop', () => {
  const ETH5M = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'binance', 'fapi-klines-5m-ethusdt-path.json'), 'utf8')) as { klines: Array<[number, string, string, string, string]> };
  const eth5m: Bar[] = ETH5M.klines.map((r) => ({ time: r[0] / 1000, open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]) }));
  /** Every hourly evaluation the 238-bar fixture can feed (≥ barsForEvaluation = 185 closed bars). */
  const replay = async (store: MemoryStore, over: Partial<OiAlertLoopPorts> = {}) => {
    const { loop: l } = loop(store, over);
    const first = F.bars[184] as Bar;
    const last = F.bars.at(-1) as Bar;
    for (let close = first.time + H; close <= last.time + H; close += H) await l.evaluate('1h', close, close + 6 * 60);
  };

  it('a journalled alert gets 3 paths: t0 = confirmation + 6 min up to 5 m, its stop at B’s low, ATR14 at B; the row carries the build', async () => {
    const store = new MemoryStore();
    await loop(store).loop.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    expect(store.alerts[0]?.build).toBe('b49cd48d4ab4');
    expect(store.paths.filter((p) => 'alertId' in p.subject).map((p) => [p.win, p.direction, p.t0, p.stopPrice, Number(p.atr14.toFixed(3))])).toEqual(
      OI_RESEARCH_WINDOWS.map((w) => [w, 'bullish', CONFIRMED + 600, 2355, 13.855]));
  });

  it('a LATE alert is measured from the same t0 as an on-time one (V23: sending does not change what is measured)', async () => {
    const store = new MemoryStore();
    await loop(store).loop.evaluate('1h', CONFIRMED, CONFIRMED + H + 10 * 60 + 1);
    expect(store.alerts[0]?.late).toBe(true);
    expect(store.paths.filter((p) => 'alertId' in p.subject).map((p) => p.t0)).toEqual([CONFIRMED + 600, CONFIRMED + 600, CONFIRMED + 600]);
  });

  it('pivot controls: every decided price pivot without an alert — the alert’s own B is NOT one; with an empty journal it would be', async () => {
    const store = new MemoryStore();
    await replay(store);
    const pivots = store.controls.filter((c) => c.kind === 'pivot');
    expect(pivots.length).toBeGreaterThan(3);
    expect(pivots.every((c) => c.build === 'b49cd48d4ab4' && c.stopPrice !== null && c.direction !== null)).toBe(true);
    expect(pivots.some((c) => c.direction === 'bullish' && c.barTime === F.expected.bTime)).toBe(false);
    // control: the same replay with a journal that never answers «alerted» — B is then a pivot control
    const blind = new MemoryStore();
    blind.hasAlert = async () => false;
    await replay(blind);
    expect(blind.controls.some((c) => c.kind === 'pivot' && c.direction === 'bullish' && c.barTime === F.expected.bTime)).toBe(true);
    // each has its 3 paths, measured from bar i + N's close + 6 min
    const b = blind.controls.find((c) => c.kind === 'pivot' && c.barTime === F.expected.bTime) as NewOiControl & { id: number };
    expect(blind.paths.filter((p) => 'controlId' in p.subject && p.subject.controlId === b.id).map((p) => p.t0)).toEqual(
      [1, 2, 3].map(() => F.expected.bTime + 7 * H + 600));
  });

  it('random controls: 2 per day on the hash-picked closes; a replay (new process, same store) adds nothing', async () => {
    const store = new MemoryStore();
    await replay(store);
    const random = store.controls.filter((c) => c.kind === 'random');
    expect(random.length).toBeGreaterThan(0);
    expect(random.every((c) => c.direction === null && c.stopPrice === null)).toBe(true);
    const days = new Map<number, number>();
    for (const c of random) days.set(Math.floor(c.barTime / 86_400), (days.get(Math.floor(c.barTime / 86_400)) ?? 0) + 1);
    expect([...days.values()].every((n) => n <= 2)).toBe(true);
    const before = store.controls.length;
    await replay(store);
    expect(store.controls.length).toBe(before);
  });

  it('measures a closed window with one klines call at its limit, and only once it has closed', async () => {
    const store = new MemoryStore();
    const calls: Array<[string, number, number]> = [];
    const { loop: l } = loop(store, { klines5m: async (s, from, limit) => { calls.push([s, from, limit]); return eth5m; } });
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    const t0 = CONFIRMED + 600;
    expect(await l.measurePaths(t0 + 4 * H + 59)).toEqual({ measured: 0, failed: 0, weight: 0 });
    expect(await l.measurePaths(t0 + 4 * H + 60)).toEqual({ measured: 1, failed: 0, weight: 1 });
    expect(calls).toEqual([['ETHUSDT', t0, 48]]);
    const p4h = store.paths.find((p) => 'alertId' in p.subject && p.win === '4h');
    expect(p4h?.m).toMatchObject({ bars: 48, entryPrice: 2421.81, high: 2422.75, low: 2405.3, stopAt: null, orderAmbiguous: false });
    expect(await l.measurePaths(t0 + 4 * H + 120)).toEqual({ measured: 0, failed: 0, weight: 0 }); // measured once
  });

  it('a failing fetch is retried after 15 min, behind windows never tried — one bad coin cannot starve the queue', async () => {
    const store = new MemoryStore();
    let fail = true;
    const { loop: l } = loop(store, { klines5m: async () => { if (fail) throw new Error('venue 503'); return eth5m; } });
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    const t0 = CONFIRMED + 600;
    expect(await l.measurePaths(t0 + 4 * H + 60)).toMatchObject({ measured: 0, failed: 1 });
    expect(await l.measurePaths(t0 + 4 * H + 120)).toMatchObject({ measured: 0, failed: 0 }); // waiting out its retry
    fail = false;
    expect(await l.measurePaths(t0 + 4 * H + 60 + 15 * 60)).toMatchObject({ measured: 1, failed: 0 });
  });

  it('a 4h path costs 1, 24h 2, 72h 5: 8 per subject (V24)', async () => {
    const store = new MemoryStore();
    const { loop: l } = loop(store, { klines5m: async () => eth5m });
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    expect((await l.measurePaths(CONFIRMED + 600 + 72 * H + 60)).weight).toBe(8);
  });
});

/**
 * Run twice: on the 15m default (6/6) and with 15m set to 6 left / 2 right (IB-141, V35) — the decided index
 * length − (2k + nRight + 1), the read count and the confirmation each fail there if a side is swapped.
 */
describe.each([
  ['6/6, the 15m default', OI_DIVERGENCE_DEFAULT_PARAMS.perTf['15m']],
  ['6/2, unequal sides (IB-141)', { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf['15m'], nRight: 2 }],
])('IB-115: near-misses in the loop (synthetic 15m, %s)', (_name, P15) => {
  const TF = 900;
  const PARAMS = { ...OI_DIVERGENCE_DEFAULT_PARAMS, perTf: { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf, '15m': P15 } };
  const LEN = barsToFetch(P15); // what the loop reads on 15m: barsForEvaluation(near-miss reach) + W (260 at 6/6, 256 at 6/2)
  const T0 = 1_793_000_000 - (1_793_000_000 % 14_400);
  const B = LEN - (2 * P15.k + P15.nRight + 1); // the B a near-miss is decided at
  const A = B - 20;
  /** B’s OI pivot k + 1 bars after it: a k near-miss, miss 1. */
  const lowAt = (i: number) => (i === A ? 95 : i === B ? 93 : 100);
  const oiAt = (i: number) => (i === A + 1 ? 960 : i === B + P15.k + 1 ? 980 : 1000 + 10 * (i % 2));
  const bars: Bar[] = Array.from({ length: LEN + 20 }, (_, i) => ({ time: T0 + i * TF, open: lowAt(i) + 1, high: lowAt(i) + 2, low: lowAt(i), close: lowAt(i) + 1 }));
  const oi5m = bars.flatMap((b, i) => [1, 2, 3].map((s) => ({ time: b.time + s * 300, oi: oiAt(i) })));
  const ports = (): Partial<OiAlertLoopPorts> => ({
    klines: async (_s, tf, from, to) => (tf === '15m' ? bars.filter((b) => b.time >= from && b.time < to) : []),
    oiWindow: async (_s, from, to) => ({ oi5m: oi5m.filter((o) => o.time > from && o.time <= to), venueSilent: [] }),
  });
  const close = T0 + LEN * TF; // the window then ends at bar LEN − 1
  const storeWith = () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, params: PARAMS };
    return store;
  };

  it('the B the reach decides gets ONE near-miss row (rule k, miss 1 bar), with the build and 3 paths; the next evaluation adds none', async () => {
    const store = storeWith();
    const { loop: l } = loop(store, ports());
    const r = await l.evaluate('15m', close, close + 6 * 60);
    expect(r).toMatchObject({ journalled: 0, nearMisses: 1, failed: [] });
    expect(store.nearMisses.map((m) => [m.direction, m.rule, m.miss, m.unit, m.a.time, m.b.time, m.build])).toEqual([
      ['bullish', 'k', 1, 'bars', T0 + A * TF, T0 + B * TF, 'b49cd48d4ab4'],
    ]);
    const confirmedAt = T0 + (B + P15.k + 1 + P15.nRight) * TF + TF;
    expect(store.nearMisses[0]?.confirmedAt).toBe(confirmedAt);
    expect(store.paths.filter((p) => 'nearMissId' in p.subject).map((p) => [p.win, p.t0, p.stopPrice])).toEqual(
      OI_RESEARCH_WINDOWS.map((w) => [w, confirmedAt + 600, 93]));
    const next = await l.evaluate('15m', close + TF, close + TF + 6 * 60);
    expect(next.nearMisses).toBe(0);
    expect(store.nearMisses).toHaveLength(1);
  });

  it('an evaluation one bar EARLIER does not decide it yet (its OI pivot could still be within 2k)', async () => {
    const store = storeWith();
    const { loop: l } = loop(store, ports());
    expect((await l.evaluate('15m', close - TF, close - TF + 6 * 60)).nearMisses).toBe(0);
  });

  it('a B the journal holds an alert for gets no near-miss', async () => {
    const store = storeWith();
    store.hasAlert = async (_src, _s, _tf, _k, _d, bTime) => bTime === T0 + B * TF;
    const { loop: l } = loop(store, ports());
    expect((await l.evaluate('15m', close, close + 6 * 60)).nearMisses).toBe(0);
  });
});

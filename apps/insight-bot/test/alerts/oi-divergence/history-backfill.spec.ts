import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OiDivergenceTf } from '@trade-automation/contracts';
import { measureBackfillPaths, replayHistory, sliceOiWindow, type HistoryBackfillPorts } from '../../../src/alerts/oi-divergence/backfill/history-backfill';
import { WeightPacer } from '../../../src/alerts/oi-divergence/backfill/weight-pacer';
import { OiAlertLoop, type OiAlertLoopPorts } from '../../../src/alerts/oi-divergence/oi-alert-loop';
import { dueBarClose } from '../../../src/alerts/oi-divergence/timing';
import type { Bar } from '../../../src/insights/divergence/detector';
import { MemoryStore } from './memory-store';

/**
 * IB-116 (design V30–V33) — the history run against the live loop on the same data: dev-1's real ETHUSDT 1h
 * stretch (238 bars, Binance's bars and OI, one bullish divergence confirmed at 1792296000).
 */
interface Fixture { bars: Bar[]; oi5m: Array<{ time: number; oi: number }>; expected: { aTime: number; bTime: number } }
const F: Fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'binance', 'oi-divergence-ethusdt-1h-bullish.json'), 'utf8'));
const H = 3_600;
const FIRST_OI = (F.oi5m[0] as { time: number }).time;
/** The stretch both runs see: bars that open at or after the first OI reading (the chart's span, V11). */
const STRETCH = F.bars.filter((b) => b.time >= Math.ceil(FIRST_OI / H) * H);
const LAST_CLOSE = (F.bars.at(-1) as Bar).time + H;
/** A live start whose first live 1h close is the one after the fixture's last: the run covers every fixture close. */
const LIVE_START = LAST_CLOSE + H + 6 * 60 + 30;

const barsFor = (tf: OiDivergenceTf, from: number, to: number) => (tf === '1h' ? STRETCH.filter((b) => b.time >= from && b.time < to) : []);

/** IB-144: «the live loop already journalled this B of this kind», read from the store as the SQL does. */
function liveIn(store: MemoryStore): HistoryBackfillPorts['hasLive'] {
  return async (what, symbol, tf, kind, direction, bTime) => (what === 'alert' ? store.alerts : store.nearMisses)
    .some((r) => r.source === 'live' && r.symbol === symbol && r.tf === tf && r.kind === kind && r.direction === direction && r.b.time === bTime);
}

function backfillPorts(store: MemoryStore, over: Partial<HistoryBackfillPorts> = {}): HistoryBackfillPorts {
  return {
    store,
    bars: async (_s, tf, from, to) => barsFor(tf, from, to),
    oiWindow: async (_s, from, to) => ({ oi5m: F.oi5m.filter((o) => o.time > from && o.time <= to), venueSilent: [] }),
    firstStoredOi: async () => FIRST_OI,
    liveStart: async () => LIVE_START,
    // IB-144: the hidden-aware live build started where the live journal did (so both kinds share one window here)
    hiddenEnd: async () => LIVE_START,
    hasLive: liveIn(store),
    build: 'b49cd48d4ab4',
    ...over,
  };
}

/** The live loop evaluating every 1h close of the same stretch, as it would have run then. */
async function liveReplay(store: MemoryStore): Promise<void> {
  const ports: OiAlertLoopPorts = {
    store,
    klines: async (_s, tf, from, to) => barsFor(tf, from, to),
    oiWindow: async (_s, from, to) => ({ oi5m: F.oi5m.filter((o) => o.time > from && o.time <= to), venueSilent: [] }),
    closeAt: async () => null, send: async () => true, webBaseUrl: '', build: 'b49cd48d4ab4', klines5m: async () => [], source: 'live',
  };
  const loop = new OiAlertLoop(ports);
  for (let close = (STRETCH[0] as Bar).time + H; close <= LAST_CLOSE; close += H) await loop.evaluate('1h', close, close + 6 * 60);
}

/** What a row says, without who wrote it or its id: the comparison of the two runs. */
const shape = (s: MemoryStore) => ({
  alerts: s.alerts.map((a) => [a.symbol, a.tf, a.direction, a.a.time, a.b.time, a.runLength, a.runOf === null ? null : s.alerts[a.runOf - 1]?.b.time, a.confirmedAt]),
  controls: s.controls.map((c) => [c.symbol, c.tf, c.kind, c.direction, c.barTime, c.stopPrice]).sort(),
  nearMisses: s.nearMisses.map((m) => [m.symbol, m.tf, m.direction, m.a.time, m.b.time, m.rule, m.miss]).sort(),
  paths: s.paths.map((p) => [p.symbol, p.win, p.direction, p.t0, p.atr14, p.stopPrice]).sort(),
});

describe('IB-116: the history run is the live loop, replayed', () => {
  it('on a fixed stretch it writes exactly what the live loop writes on it — alerts, runs, controls, near-misses, paths', async () => {
    const live = new MemoryStore();
    await liveReplay(live);
    const back = new MemoryStore();
    const report = await replayHistory(backfillPorts(back), LIVE_START + 4 * 86_400);
    expect(shape(back)).toEqual(shape(live));
    // and it is not vacuous: the real divergence, controls of both kinds, every subject with its 3 paths
    expect(back.alerts.map((a) => [a.direction, a.a.time, a.b.time])).toContainEqual(['bullish', F.expected.aTime, F.expected.bTime]);
    expect(new Set(back.controls.map((c) => c.kind))).toEqual(new Set(['pivot', 'random']));
    expect(back.paths).toHaveLength(3 * (back.alerts.length + back.controls.length + back.nearMisses.length));
    // the report counts what it wrote
    const h1 = report.perTf.find((t) => t.tf === '1h');
    expect(h1).toMatchObject({ alerts: back.alerts.length, controls: back.controls.length, nearMisses: back.nearMisses.length, failed: 0, lastClose: LAST_CLOSE });
    expect(report.paths.rows).toBe(back.paths.length);
  });

  it('every row it writes is backfill: stamped so, never late, never sent — even with sending ON and recipients waiting', async () => {
    const back = new MemoryStore();
    back.settingsRow = { ...back.settingsRow, enabled: true };
    const r = await replayHistory(backfillPorts(back), LIVE_START);
    expect(r.perTf.map((t) => t.failed)).toEqual([0, 0, 0]); // the send port throws: reaching it would fail the coin
    expect(back.alerts.length).toBeGreaterThan(0);
    expect(back.alerts.every((a) => a.source === 'backfill' && !a.late && a.firedAt === null && a.recipients === 0)).toBe(true);
    expect([...back.controls, ...back.nearMisses].every((r) => r.source === 'backfill' && r.build === 'b49cd48d4ab4')).toBe(true);
    expect(back.skips).toEqual([]); // counted in the report, never written: the skips table has no source
  });

  it('a hole in OI the venue did not cause: counted as a skip in the report, never written (the skips table has no source)', async () => {
    const holeFrom = F.expected.bTime - 2 * H;
    const back = new MemoryStore();
    const r = await replayHistory(backfillPorts(back, {
      oiWindow: async (_s, from, to) => ({ oi5m: F.oi5m.filter((o) => o.time > from && o.time <= to && (o.time < holeFrom || o.time > holeFrom + 1_800)), venueSilent: [] }),
    }), LIVE_START);
    expect(r.perTf.find((t) => t.tf === '1h')?.skips).toBeGreaterThan(0);
    expect(back.skips).toEqual([]);
  });

  it('a rerun writes 0 rows (V30: the once-keys include source)', async () => {
    const back = new MemoryStore();
    await replayHistory(backfillPorts(back), LIVE_START);
    const before = shape(back);
    const again = await replayHistory(backfillPorts(back), LIVE_START);
    expect(again.perTf.map((t) => t.alerts + t.controls + t.nearMisses)).toEqual([0, 0, 0]);
    expect(again.paths.rows).toBe(0);
    expect(shape(back)).toEqual(before);
  });

  it('the same (symbol, tf, direction, A, B) live and backfill coexist; the live rows are untouched and the backfill is as on an empty store', async () => {
    const store = new MemoryStore();
    await liveReplay(store);
    const liveRows = JSON.stringify(store.alerts);
    await replayHistory(backfillPorts(store), LIVE_START);
    const alone = new MemoryStore();
    await replayHistory(backfillPorts(alone), LIVE_START);
    const byKey = (src: string) => store.alerts.filter((a) => a.source === src).map((a) => `${a.direction}:${a.a.time}:${a.b.time}`);
    expect(byKey('backfill')).toEqual(byKey('live'));
    expect(byKey('backfill').length).toBe(alone.alerts.length);
    expect(store.controls.filter((c) => c.source === 'backfill')).toHaveLength(alone.controls.length);
    expect(JSON.stringify(store.alerts.filter((a) => a.source === 'live'))).toBe(liveRows);
    // a backfill run never points at a live row
    expect(store.alerts.filter((a) => a.source === 'backfill' && a.runOf !== null).every((a) => store.alerts[(a.runOf as number) - 1]?.source === 'backfill')).toBe(true);
  });

  it('ends before the live loop’s first close: with the live start one bar earlier, the last close is not evaluated', async () => {
    const r = await replayHistory(backfillPorts(new MemoryStore()), LIVE_START);
    expect(r.perTf.find((t) => t.tf === '1h')?.lastClose).toBe(dueBarClose(LIVE_START, H) - H);
    const earlier = await replayHistory(backfillPorts(new MemoryStore(), { liveStart: async () => LIVE_START - H, hiddenEnd: async () => LIVE_START - H }), LIVE_START);
    expect(earlier.perTf.find((t) => t.tf === '1h')?.lastClose).toBe(LAST_CLOSE - H);
  });

  it('starts at the first OI: no bar before it is read, and the first close judged has barsForEvaluation bars after it', async () => {
    const asked: Array<[OiDivergenceTf, number]> = [];
    const r = await replayHistory(backfillPorts(new MemoryStore(), { bars: async (_s, tf, from, to) => { asked.push([tf, from]); return barsFor(tf, from, to); } }), LIVE_START);
    expect(asked.find(([tf]) => tf === '1h')?.[1]).toBe(Math.ceil(FIRST_OI / H) * H);
    expect(r.perTf.find((t) => t.tf === '1h')?.firstClose).toBe((STRETCH[0] as Bar).time + 185 * H); // barsForEvaluation on 1h = 185
  });

  it('goes one coin × TF at a time: the guard is asked before each chunk, and each chunk’s bars are read once', async () => {
    const labels: string[] = [];
    const asked: string[] = [];
    const store = new MemoryStore();
    store.symbols = ['ETHUSDT', 'BTCUSDT'];
    await replayHistory(backfillPorts(store, {
      beforeChunk: async (l) => { labels.push(l); },
      bars: async (s, tf, from, to) => { asked.push(`${s} ${tf}`); return barsFor(tf, from, to); },
    }), LIVE_START);
    expect(labels).toEqual(['ETHUSDT 15m', 'BTCUSDT 15m', 'ETHUSDT 1h', 'BTCUSDT 1h', 'ETHUSDT 4h', 'BTCUSDT 4h']);
    expect(asked).toEqual(labels);
    // two coins on the same data: each journals its own copy, as two independent coins
    expect(store.alerts.filter((a) => a.symbol === 'ETHUSDT').map((a) => [a.a.time, a.b.time]))
      .toEqual(store.alerts.filter((a) => a.symbol === 'BTCUSDT').map((a) => [a.a.time, a.b.time]));
  });

  it('a guard that aborts stops the run before the chunk is read', async () => {
    const asked: string[] = [];
    await expect(replayHistory(backfillPorts(new MemoryStore(), {
      beforeChunk: async (l) => { if (l === 'ETHUSDT 1h') throw new Error('memory guard: aborting'); },
      bars: async (s, tf, from, to) => { asked.push(`${s} ${tf}`); return barsFor(tf, from, to); },
    }), LIVE_START)).rejects.toThrow(/memory guard/);
    expect(asked).toEqual(['ETHUSDT 15m']);
  });

  it('refuses to run before the live research journal exists (nothing would bound it)', async () => {
    await expect(replayHistory(backfillPorts(new MemoryStore(), { liveStart: async () => null }), LIVE_START)).rejects.toThrow(/live research journal has not started/);
  });
});

/**
 * A run (V8), as the basis spec builds one (IB-114): lows A, B′, B on 4h, each lower, OI each higher, B′ ON the A–B
 * lines. The live loop journals A–B′ (run 2) and then A–B (run 3, `run_of` → A–B′).
 */
function runData(): { bars: Bar[]; oi5m: { time: number; oi: number }[] } {
  const tfSec = 14_400;
  const t0 = 1_793_000_000 - (1_793_000_000 % tfSec);
  const a = 120;
  const mid = 165; // W = 90 on 4h: A–B spans exactly W
  const b = 210;
  const lowAt = (i: number) => (i === a ? 95 : i === mid ? 93 : i === b ? 91 : 100);
  const oiAt = (i: number) => (i === a ? 960 : i === mid ? 975 : i === b ? 990 : 1000 + 10 * (i % 2));
  const bars = Array.from({ length: 230 }, (_, i) => ({ time: t0 + i * tfSec, open: lowAt(i) + 1, high: lowAt(i) + 2, low: lowAt(i), close: lowAt(i) + 1 }));
  const oi5m = bars.flatMap((bar, i) => Array.from({ length: tfSec / 300 }, (_, j) => ({ time: bar.time + (j + 1) * 300, oi: oiAt(i) })));
  return { bars, oi5m };
}

describe('IB-116: runs — run_of links only within backfill rows, and matches the live loop', () => {
  it('a run of three lows: the backfill writes the live loop’s rows, run_of included; into a store holding the live rows, its run points at its own row', async () => {
    const tf = '4h' as const;
    const tfSec = 14_400;
    const { bars, oi5m } = runData();
    const lastClose = (bars.at(-1) as Bar).time + tfSec;
    const liveStart = lastClose + tfSec + 6 * 60 + 30;
    const kl = (t: OiDivergenceTf, from: number, to: number) => (t === tf ? bars.filter((x) => x.time >= from && x.time < to) : []);
    const oiw = async (_s: string, from: number, to: number) => ({ oi5m: oi5m.filter((o) => o.time > from && o.time <= to), venueSilent: [] });
    const ports = (store: MemoryStore): HistoryBackfillPorts => ({
      store, bars: async (_s, t, from, to) => kl(t, from, to), oiWindow: oiw, firstStoredOi: async () => (bars[0] as Bar).time,
      liveStart: async () => liveStart, hiddenEnd: async () => liveStart, hasLive: async () => false, build: 'b49cd48d4ab4',
    });
    const live = new MemoryStore();
    const loop = new OiAlertLoop({
      store: live, klines: async (_s, t, from, to) => kl(t, from, to), oiWindow: oiw,
      closeAt: async () => null, send: async () => true, webBaseUrl: '', build: 'b49cd48d4ab4', klines5m: async () => [], source: 'live',
    });
    for (let close = (bars[0] as Bar).time + tfSec; close <= lastClose; close += tfSec) await loop.evaluate(tf, close, close + 6 * 60);
    const back = new MemoryStore();
    await replayHistory(ports(back), liveStart);
    expect(shape(back).alerts).toEqual(shape(live).alerts);
    const bullish = back.alerts.filter((x) => x.direction === 'bullish');
    expect(bullish.map((x) => [x.runLength, x.runOf === null ? null : back.alerts[x.runOf - 1]?.b.time])).toEqual([[2, null], [3, (bars[165] as Bar).time]]);

    // the same history into the store that already holds the live rows: the run points at the BACKFILL A–B′
    await replayHistory(ports(live), liveStart);
    const repeat = live.alerts.find((x) => x.source === 'backfill' && x.runLength === 3) as (typeof live.alerts)[number];
    expect(live.alerts[(repeat.runOf as number) - 1]).toMatchObject({ source: 'backfill', runLength: 2 });
  });
});

describe('IB-116: the backfill measures its own paths, paced; the live tick never takes them', () => {
  it('measures every closed backfill window (8 weight a subject), leaves live paths alone; the live measurer sees none of its rows', async () => {
    const store = new MemoryStore();
    await liveReplay(store);
    await replayHistory(backfillPorts(store), LIVE_START);
    const backfillSubjects = store.paths.filter((p) => store.sourceOf(p.subject) === 'backfill').length;
    const livePaths = store.paths.filter((p) => store.sourceOf(p.subject) === 'live').length;
    expect(backfillSubjects).toBeGreaterThan(0);

    // the live tick, long after every window closed: it takes only live rows
    const liveLoop = new OiAlertLoop({
      store, klines: async () => [], oiWindow: async () => ({ oi5m: [], venueSilent: [] }), closeAt: async () => null, send: async () => true,
      webBaseUrl: '', build: 'b49cd48d4ab4', source: 'live', klines5m: async () => [],
    });
    const later = LIVE_START + 10 * 86_400;
    await liveLoop.measurePaths(later, { limit: 10_000 });
    expect(store.paths.filter((p) => store.sourceOf(p.subject) === 'backfill' && p.m !== null)).toHaveLength(0);
    expect(store.paths.filter((p) => store.sourceOf(p.subject) === 'live' && p.m !== null)).toHaveLength(livePaths);

    const taken: number[] = [];
    const out = await measureBackfillPaths(
      { store, build: 'b49cd48d4ab4', klines5m: async () => [] },
      { take: async (w) => { taken.push(w); } }, () => later * 1000, 7,
    );
    expect(out).toMatchObject({ measured: backfillSubjects, failed: 0, weight: (backfillSubjects / 3) * 8 });
    expect(taken.reduce((a, b) => a + b, 0)).toBe(out.weight); // every call went through the pacer first
    expect(store.paths.every((p) => p.m !== null)).toBe(true);
    // a rerun measures nothing more
    expect((await measureBackfillPaths({ store, build: 'b49cd48d4ab4', klines5m: async () => [] }, { take: async () => undefined }, () => later * 1000)).measured).toBe(0);
  });

  it('a window not closed yet stays for a rerun; a failed fetch is counted and the run still ends', async () => {
    const store = new MemoryStore();
    await replayHistory(backfillPorts(store), LIVE_START);
    const lastT0 = Math.max(...store.paths.map((p) => p.t0));
    const now = lastT0 + 4 * H + 60; // the newest subject's 4h has closed, its 24h and 72h have not
    let calls = 0;
    const out = await measureBackfillPaths(
      { store, build: 'b49cd48d4ab4', klines5m: async () => { calls++; if (calls === 1) throw new Error('venue 503'); return []; } },
      { take: async () => undefined }, () => now * 1000,
    );
    expect(out.failed).toBe(1);
    const open = store.paths.filter((p) => p.m === null);
    expect(open.some((p) => p.t0 === lastT0 && p.win === '72h')).toBe(true);
  });
});

describe('IB-116: WeightPacer (≤ 200 weight in any trailing minute)', () => {
  it('lets 200 through at once, then waits for the oldest call to leave the window', async () => {
    let t = 0;
    const slept: number[] = [];
    const pacer = new WeightPacer(200, () => t, async (ms) => { slept.push(ms); t += ms; });
    const at: number[] = [];
    for (let i = 0; i < 45; i++) { await pacer.take(5); at.push(t); }
    expect(at.slice(0, 40).every((x) => x === 0)).toBe(true);
    expect(at[40]).toBe(60_000);
    expect(pacer.total).toBe(225);
    // no trailing 60 s holds more than 200
    for (const start of at) expect(at.filter((x) => x >= start && x < start + 60_000).length * 5).toBeLessThanOrEqual(200);
  });

  it('a mixed stream (1 / 2 / 5) never exceeds the budget in any trailing minute, and a call above the budget is refused', async () => {
    let t = 0;
    const pacer = new WeightPacer(200, () => t, async (ms) => { t += ms; });
    const calls: Array<[number, number]> = [];
    for (let i = 0; i < 300; i++) { const w = [1, 2, 5][i % 3] as number; await pacer.take(w); calls.push([t, w]); t += 50; }
    for (const [start] of calls) expect(calls.filter(([x]) => x >= start - 59_999 && x <= start).reduce((s, [, w]) => s + w, 0)).toBeLessThanOrEqual(200);
    await expect(pacer.take(201)).rejects.toThrow(/exceeds/);
  });
});

describe('IB-116: one OI read sliced per evaluation equals the per-window read (OiWindowReader’s predicates)', () => {
  it('readings in (from, to]; venue-silent gaps that touch [from, to], whole', () => {
    const all = {
      oi5m: [100, 400, 700, 1_000].map((time) => ({ time, oi: time })),
      venueSilent: [{ from: 0, to: 300 }, { from: 300, to: 600 }, { from: 900, to: 1_200 }, { from: 1_300, to: 1_500 }],
    };
    expect(sliceOiWindow(all, 400, 900)).toEqual({
      oi5m: [{ time: 700, oi: 700 }], // 400 excluded (the window is open at from), 1 000 after to
      venueSilent: [{ from: 300, to: 600 }, { from: 900, to: 1_200 }], // gap_to >= from and gap_from <= to, as the SQL
    });
    expect(sliceOiWindow(all, 300, 900).venueSilent).toContainEqual({ from: 0, to: 300 });
  });

});

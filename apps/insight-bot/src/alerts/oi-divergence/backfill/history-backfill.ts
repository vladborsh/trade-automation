import { OI_DIVERGENCE_TFS, OI_DIVERGENCE_TF_SEC, type OiDivergenceTf } from '@trade-automation/contracts';
import type { Bar } from '../../../insights/divergence/detector';
import type { OiWindow } from '../../../insights/divergence/oi-window.reader';
import { detectorParams } from '../../../insights/divergence/params';
import { minBarsToEvaluate } from '../basis';
import { OiAlertLoop, type OiAlertLoopPorts } from '../oi-alert-loop';
import type { OiAlertStore, PathSubjectRef, NewPaths, PathSubjects } from '../pg/oi-alerts.repo';
import { klinesWeight, windowBars } from '../research/path';
import { OI_RESEARCH_WINDOWS, OI_RESEARCH_WINDOW_SEC } from '@trade-automation/contracts';
import { dueBarClose, EVALUATE_AFTER_CLOSE_SEC } from '../timing';

/**
 * IB-116 (architecture/oi-divergence-design-2026-11-04.md §9, V30–V31) — the one-off history run: the
 * journal, the controls and the near-misses over all stored OI, stamped `source = 'backfill'`.
 *
 * **One code path with the live loop.** Every bar close of the period is evaluated by `OiAlertLoop.evaluate`
 * itself, oldest first per TF, exactly as the live loop would have evaluated it at close + 6 min: the same
 * window (`barsToFetch`), the same full-basis rule and `+W` repeat tail, the same controls and near-misses.
 * Only the ports differ: bars and OI are served from ONE read per coin and TF (sliced in memory, so the run
 * costs a handful of kline pages, not one call per close), and the loop runs with `source = 'backfill'`
 * (never late, never sent, runs and «produced an alert» looked up among backfill rows only, skips counted).
 *
 * **Period** (V31):
 * - start: each coin's first stored OI reading. Bars before it are not read, as the chart's span starts there
 *   (V11), so the first evaluations of a coin are those with `barsForEvaluation` bars after it — a young coin's
 *   rule in the live loop, and the same as the IB-111 / IB-114 history runs' population;
 * - end: the live research journal's start (the first live control). Live evaluated `dueBarClose(liveStart)`
 *   on each TF first, so the run evaluates every close BEFORE that one: the two never judge the same close.
 *
 * Paths are written with each subject here and measured by the caller (`measureBackfillPaths`), paced.
 */
export interface HistoryBackfillPorts {
  store: OiAlertStore;
  /** Every CLOSED bar of `symbol` on `tf` with open time in [fromSec, toSec), oldest first (paged by the caller). */
  bars(symbol: string, tf: OiDivergenceTf, fromSec: number, toSec: number): Promise<Bar[]>;
  /** Stored 5 m OI over (fromSec, toSec] with the venue's silences — one read for a coin's whole period. */
  oiWindow(symbol: string, fromSec: number, toSec: number): Promise<OiWindow>;
  /** Unix seconds of the coin's first stored OI reading; null when we store none. */
  firstStoredOi(symbol: string): Promise<number | null>;
  /** The live research journal's start (first live control), unix seconds; null when it has not started. */
  liveStart(): Promise<number | null>;
  build: string;
  log?: (line: string) => void;
  /** Called before each coin × TF chunk is read (the CLI's memory guard waits or aborts here). */
  beforeChunk?: (label: string) => Promise<void>;
}

export interface BackfillTfReport {
  tf: OiDivergenceTf;
  /** Evaluations (coin × bar close), and the first and last close evaluated on any coin (unix seconds). */
  closes: number;
  firstClose: number | null;
  lastClose: number | null;
  alerts: number;
  controls: number;
  nearMisses: number;
  /** Distinct (symbol, bar) skips: a hole in OI the venue did not cause (counted, not written). */
  skips: number;
  failed: number;
}

export interface BackfillReport {
  liveStart: number;
  coins: Array<{ symbol: string; firstOi: number | null; bars: Record<OiDivergenceTf, number> }>;
  perTf: BackfillTfReport[];
  /** Path rows written (3 per new subject) and the klines weight to measure them; split by whether the window has closed at `nowSec`. */
  paths: { rows: number; dueNow: number; dueNowWeight: number; open: number; lastWindowCloses: number | null };
  /** Warnings the evaluations logged, with how often (none expected: each coin starts at its own first full basis). */
  warnings: Record<string, number>;
}

/** Bars that must exist after a coin's first OI before its first close can be judged (the live loop's young-coin rule). */
function firstCloseFor(firstOi: number, tf: OiDivergenceTf, need: number): number {
  const tfSec = OI_DIVERGENCE_TF_SEC[tf];
  const firstBar = Math.ceil(firstOi / tfSec) * tfSec; // bars open at or after the first reading (V11)
  return firstBar + need * tfSec;
}

export async function replayHistory(ports: HistoryBackfillPorts, nowSec: number): Promise<BackfillReport> {
  const liveStart = await ports.liveStart();
  if (liveStart === null) throw new Error('the live research journal has not started (no live control row): nothing bounds the run');

  // the params and the coin list in force, read once: the whole run is made with one set (V31)
  const settings = await ports.store.settings();
  const symbols = await ports.store.enabledSymbols();
  const warnings: Record<string, number> = {};
  const report: BackfillReport = {
    liveStart, coins: [], perTf: [], warnings,
    paths: { rows: 0, dueNow: 0, dueNowWeight: 0, open: 0, lastWindowCloses: null },
  };
  // the coin being replayed: the loop evaluates `enabledSymbols`, so a chunk is one coin (IB-116, TL memory condition)
  const current = { symbols: [] as string[] };
  const store = countingStore(ports.store, settings, current, report.paths, nowSec);

  // one chunk = one coin × TF: its bars and its OI are read, replayed and dropped before the next (the month
  // of 5 m OI per coin is the largest thing held). Coins are independent — run, «produced an alert», controls
  // and near-misses are all per (symbol, tf) — so the order across coins does not change a row.
  let chunk: { bars: Bar[]; oi: OiWindow } = { bars: [], oi: { oi5m: [], venueSilent: [] } };
  const loop = new OiAlertLoop({
    store,
    klines: async (_symbol, _tf, from, to) => chunk.bars.filter((b) => b.time >= from && b.time < to),
    oiWindow: async (_symbol, from, to) => sliceOiWindow(chunk.oi, from, to),
    closeAt: async () => { throw new Error('the history run never reads outcomes (nothing is sent)'); },
    send: async () => { throw new Error('the history run never sends'); },
    webBaseUrl: '',
    build: ports.build,
    klines5m: async () => { throw new Error('paths are measured by measureBackfillPaths, paced'); },
    source: 'backfill',
    log: { warn: (m) => { warnings[m] = (warnings[m] ?? 0) + 1; } },
  });

  const coinBars = new Map<string, Record<OiDivergenceTf, number>>();
  for (const symbol of symbols) {
    const first = await ports.firstStoredOi(symbol);
    const counts = { '15m': 0, '1h': 0, '4h': 0 } as Record<OiDivergenceTf, number>;
    coinBars.set(symbol, counts);
    report.coins.push({ symbol, firstOi: first, bars: counts });
  }

  for (const tf of OI_DIVERGENCE_TFS) {
    const tfSec = OI_DIVERGENCE_TF_SEC[tf];
    const need = minBarsToEvaluate(detectorParams(settings.params, tf));
    const last = dueBarClose(liveStart, tfSec) - tfSec; // the close before the live loop's first on this TF
    const r: BackfillTfReport = { tf, closes: 0, firstClose: null, lastClose: null, alerts: 0, controls: 0, nearMisses: 0, skips: 0, failed: 0 };
    report.perTf.push(r);
    const skipKeys = new Set<string>();
    for (const coin of report.coins) {
      if (coin.firstOi === null) continue;
      await ports.beforeChunk?.(`${coin.symbol} ${tf}`);
      const from = Math.ceil(coin.firstOi / tfSec) * tfSec; // bars open at or after the first reading (V11)
      const bars = from < last ? (await ports.bars(coin.symbol, tf, from, last)).filter((b) => b.time >= from && b.time + tfSec <= last) : [];
      (coinBars.get(coin.symbol) as Record<OiDivergenceTf, number>)[tf] = bars.length;
      if (bars.length < need) continue;
      chunk = { bars, oi: await ports.oiWindow(coin.symbol, from - tfSec, last) };
      current.symbols = [coin.symbol];
      for (let close = firstCloseFor(coin.firstOi, tf, need); close <= last; close += tfSec) {
        const e = await loop.evaluate(tf, close, close + EVALUATE_AFTER_CLOSE_SEC);
        r.closes++;
        r.firstClose = Math.min(r.firstClose ?? close, close);
        r.lastClose = Math.max(r.lastClose ?? close, close);
        r.alerts += e.journalled;
        r.controls += e.controls;
        r.nearMisses += e.nearMisses;
        r.failed += e.failed.length;
        for (const k of e.skipKeys ?? []) skipKeys.add(k);
      }
      chunk = { bars: [], oi: { oi5m: [], venueSilent: [] } };
    }
    r.skips = skipKeys.size;
    ports.log?.(`backfill ${tf}: ${r.closes} evaluations, ${r.alerts} alerts, ${r.controls} controls, ${r.nearMisses} near-misses, ${r.skips} skips, ${r.failed} failed`);
  }
  return report;
}

/**
 * The part of a whole-period OI read a window `(fromSec, toSec]` would have read on its own (OiWindowReader):
 * the readings inside it, and the venue-silent gaps that touch it (the reader returns whole gaps that overlap).
 */
export function sliceOiWindow(all: OiWindow, fromSec: number, toSec: number): OiWindow {
  return {
    oi5m: all.oi5m.filter((p) => p.time > fromSec && p.time <= toSec),
    venueSilent: all.venueSilent.filter((g) => g.to >= fromSec && g.from <= toSec),
  };
}

/**
 * The store as the loop sees it in a backfill: settings frozen for the run, the coin list = the chunk's coin;
 * new subjects' path windows tallied into the report (counts only — nothing kept per subject).
 */
function countingStore(
  store: OiAlertStore, settings: Awaited<ReturnType<OiAlertStore['settings']>>, current: { symbols: string[] },
  tally: BackfillReport['paths'], nowSec: number,
): OiAlertStore {
  return {
    settings: async () => settings,
    enabledSymbols: async () => current.symbols,
    insertPaths: async (subject: PathSubjectRef, spec: NewPaths) => {
      await store.insertPaths(subject, spec);
      for (const win of OI_RESEARCH_WINDOWS) {
        tally.rows++;
        const closes = spec.t0 + OI_RESEARCH_WINDOW_SEC[win];
        if (closes + 60 <= nowSec) { tally.dueNow++; tally.dueNowWeight += klinesWeight(windowBars(win)); } else tally.open++;
        tally.lastWindowCloses = Math.max(tally.lastWindowCloses ?? closes, closes);
      }
    },
    insertAlert: (row) => store.insertAlert(row),
    runFirstId: (...a) => store.runFirstId(...a),
    markFired: (...a) => store.markFired(...a),
    insertSkip: (row) => store.insertSkip(row),
    recipients: () => store.recipients(),
    outcomesDue: (now) => store.outcomesDue(now),
    setOutcome: (...a) => store.setOutcome(...a),
    hasAlert: (...a) => store.hasAlert(...a),
    insertControl: (row) => store.insertControl(row),
    insertNearMiss: (row) => store.insertNearMiss(row),
    pathsDue: (...a) => store.pathsDue(...a),
    setPath: (...a) => store.setPath(...a),
    pathFailed: (...a) => store.pathFailed(...a),
  };
}

export interface PathMeasureReport {
  measured: number;
  failed: number;
  weight: number;
  durationSec: number;
  /** Backfill windows still unmeasured after the run (not closed yet, or failed in this run). */
  left: number;
}

/**
 * V31: the backfill measures its own paths, with the live loop's measurer (`OiAlertLoop.measurePaths`, same
 * `measurePath`, same 5 m klines call per window), in batches until nothing due is left — each call paced by
 * `pacer` (≤ 200 weight a minute). The live tick never sees these rows (`pathsDue` is per source).
 * A window that fails is retried by a later run (15 min `tried_at` back-off, as live); a window not closed yet
 * is measured by a rerun after it closes (the rerun writes no rows, it only measures what is due).
 */
export async function measureBackfillPaths(
  ports: { store: OiAlertStore; klines5m: OiAlertLoopPorts['klines5m']; build: string; log?: (line: string) => void },
  pacer: { take(weight: number): Promise<void> },
  now: () => number,
  batch = 50,
  /** IB-123: whose backlog — IB-116's run measures `oi`, IB-123's `market`; `all` only in specs that want both. */
  subjects: PathSubjects = 'oi',
): Promise<PathMeasureReport> {
  const loop = new OiAlertLoop({
    store: ports.store, klines5m: ports.klines5m, build: ports.build, source: 'backfill', webBaseUrl: '',
    klines: async () => { throw new Error('not used'); }, oiWindow: async () => { throw new Error('not used'); },
    closeAt: async () => { throw new Error('not used'); }, send: async () => { throw new Error('the history run never sends'); },
    log: { warn: (m) => ports.log?.(m) },
  });
  const started = now();
  const out: PathMeasureReport = { measured: 0, failed: 0, weight: 0, durationSec: 0, left: 0 };
  for (;;) {
    const r = await loop.measurePaths(Math.floor(now() / 1000), { limit: batch, beforeCall: (w) => pacer.take(w), subjects });
    out.measured += r.measured;
    out.failed += r.failed;
    out.weight += r.weight;
    if (r.measured + r.failed === 0) break;
    if (out.measured % 500 < r.measured) ports.log?.(`backfill paths: measured ${out.measured}, failed ${out.failed}, weight ${out.weight}`);
  }
  out.durationSec = Math.round((now() - started) / 1000);
  return out;
}

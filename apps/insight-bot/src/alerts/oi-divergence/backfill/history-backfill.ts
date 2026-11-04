import { OI_DIVERGENCE_TFS, OI_DIVERGENCE_TF_SEC, type OiDivergenceTf } from '@trade-automation/contracts';
import type { Bar } from '../../../insights/divergence/detector';
import type { OiWindow } from '../../../insights/divergence/oi-window.reader';
import { detectorParams } from '../../../insights/divergence/params';
import { minBarsToEvaluate } from '../basis';
import { OiAlertLoop, type OiAlertLoopPorts } from '../oi-alert-loop';
import type { OiAlertStore, PathSubjectRef, NewPaths } from '../pg/oi-alerts.repo';
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
}

export interface BackfillTfReport {
  tf: OiDivergenceTf;
  /** Bar closes evaluated, first and last (unix seconds). */
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
  /** Warnings the evaluations logged, by kind, with how often (a young window is expected at each coin's start). */
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
  const counted = countingStore(ports.store, settings, symbols);

  const warnings: Record<string, number> = {};
  const report: BackfillReport = {
    liveStart, coins: [], perTf: [], warnings,
    paths: { rows: 0, dueNow: 0, dueNowWeight: 0, open: 0, lastWindowCloses: null },
  };

  const firstOi = new Map<string, number>();
  for (const symbol of symbols) {
    const first = await ports.firstStoredOi(symbol);
    if (first !== null) firstOi.set(symbol, first);
  }

  // one read per coin and TF, one OI read per coin; the evaluation's ports slice them
  const barsBy = new Map<string, Bar[]>();
  const oiBy = new Map<string, OiWindow>();
  const lastCloseBy = new Map<OiDivergenceTf, number>();
  for (const tf of OI_DIVERGENCE_TFS) lastCloseBy.set(tf, dueBarClose(liveStart, OI_DIVERGENCE_TF_SEC[tf]) - OI_DIVERGENCE_TF_SEC[tf]);
  for (const symbol of symbols) {
    const first = firstOi.get(symbol);
    const counts = { '15m': 0, '1h': 0, '4h': 0 } as Record<OiDivergenceTf, number>;
    report.coins.push({ symbol, firstOi: first ?? null, bars: counts });
    if (first === undefined) continue;
    for (const tf of OI_DIVERGENCE_TFS) {
      const tfSec = OI_DIVERGENCE_TF_SEC[tf];
      const to = lastCloseBy.get(tf) as number;
      const from = Math.ceil(first / tfSec) * tfSec;
      const bars = from < to ? (await ports.bars(symbol, tf, from, to)).filter((b) => b.time >= from && b.time + tfSec <= to) : [];
      barsBy.set(`${symbol}|${tf}`, bars);
      counts[tf] = bars.length;
    }
    oiBy.set(symbol, await ports.oiWindow(symbol, first - 300, Math.max(...[...lastCloseBy.values()])));
  }

  const loopPorts: OiAlertLoopPorts = {
    store: counted.store,
    klines: async (symbol, tf, from, to) => (barsBy.get(`${symbol}|${tf}`) ?? []).filter((b) => b.time >= from && b.time < to),
    oiWindow: async (symbol, from, to) => sliceOiWindow(oiBy.get(symbol) ?? { oi5m: [], venueSilent: [] }, from, to),
    closeAt: async () => { throw new Error('the history run never reads outcomes (nothing is sent)'); },
    send: async () => { throw new Error('the history run never sends'); },
    webBaseUrl: '',
    build: ports.build,
    klines5m: async () => { throw new Error('paths are measured by measureBackfillPaths, paced'); },
    source: 'backfill',
    log: {
      warn: (m) => {
        const kind = / closed bars, need /.test(m) ? 'young window (fewer than barsForEvaluation bars)' : m;
        warnings[kind] = (warnings[kind] ?? 0) + 1;
      },
    },
  };
  const loop = new OiAlertLoop(loopPorts);

  for (const tf of OI_DIVERGENCE_TFS) {
    const tfSec = OI_DIVERGENCE_TF_SEC[tf];
    const need = minBarsToEvaluate(detectorParams(settings.params, tf));
    const starts = [...firstOi.values()].map((f) => firstCloseFor(f, tf, need));
    const last = lastCloseBy.get(tf) as number;
    const r: BackfillTfReport = { tf, closes: 0, firstClose: null, lastClose: null, alerts: 0, controls: 0, nearMisses: 0, skips: 0, failed: 0 };
    report.perTf.push(r);
    if (starts.length === 0) continue;
    const skipKeys = new Set<string>();
    for (let close = Math.min(...starts); close <= last; close += tfSec) {
      const e = await loop.evaluate(tf, close, close + EVALUATE_AFTER_CLOSE_SEC);
      r.closes++;
      r.firstClose ??= close;
      r.lastClose = close;
      r.alerts += e.journalled;
      r.controls += e.controls;
      r.nearMisses += e.nearMisses;
      r.failed += e.failed.length;
      for (const k of e.skipKeys ?? []) skipKeys.add(k);
    }
    r.skips = skipKeys.size;
    ports.log?.(`backfill ${tf}: ${r.closes} closes, ${r.alerts} alerts, ${r.controls} controls, ${r.nearMisses} near-misses, ${r.skips} skips, ${r.failed} failed`);
  }

  for (const p of counted.paths) {
    for (const win of OI_RESEARCH_WINDOWS) {
      report.paths.rows++;
      const closes = p.t0 + OI_RESEARCH_WINDOW_SEC[win];
      if (closes + 60 <= nowSec) { report.paths.dueNow++; report.paths.dueNowWeight += klinesWeight(windowBars(win)); } else report.paths.open++;
      report.paths.lastWindowCloses = Math.max(report.paths.lastWindowCloses ?? closes, closes);
    }
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

/** The store as the loop sees it in a backfill: settings and coins frozen for the run; new subjects' paths recorded. */
function countingStore(store: OiAlertStore, settings: Awaited<ReturnType<OiAlertStore['settings']>>, symbols: string[]) {
  const paths: NewPaths[] = [];
  const wrapped: OiAlertStore = {
    settings: async () => settings,
    enabledSymbols: async () => symbols,
    insertPaths: async (subject: PathSubjectRef, spec: NewPaths) => { paths.push(spec); await store.insertPaths(subject, spec); },
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
  return { store: wrapped, paths };
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
    const r = await loop.measurePaths(Math.floor(now() / 1000), { limit: batch, beforeCall: (w) => pacer.take(w) });
    out.measured += r.measured;
    out.failed += r.failed;
    out.weight += r.weight;
    if (r.measured + r.failed === 0) break;
    if (out.measured % 500 < r.measured) ports.log?.(`backfill paths: measured ${out.measured}, failed ${out.failed}, weight ${out.weight}`);
  }
  out.durationSec = Math.round((now() - started) / 1000);
  return out;
}

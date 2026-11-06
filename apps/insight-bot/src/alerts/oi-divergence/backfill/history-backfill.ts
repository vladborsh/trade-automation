import {
  OI_DIVERGENCE_KINDS, OI_DIVERGENCE_TFS, OI_DIVERGENCE_TF_SEC, type OiDivergenceDirection, type OiDivergenceKind, type OiDivergenceTf, type OiNearMissRule,
} from '@trade-automation/contracts';
import { ATR_PERIOD, OI_MEDIAN_BARS, type Bar } from '../../../insights/divergence/detector';
import type { OiWindow } from '../../../insights/divergence/oi-window.reader';
import { detectorParams } from '../../../insights/divergence/params';
import { minBarsToEvaluate } from '../basis';
import { OiAlertLoop, type OiAlertLoopPorts } from '../oi-alert-loop';
import type { NewOiAlert, NewOiNearMiss, OiAlertStore, PathSubjectRef, NewPaths, PathSubjects } from '../pg/oi-alerts.repo';
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
 *
 * **IB-144 (V45, V47) — kinds.** The detector finds regular and hidden alike; `opts.kinds` says which the run WRITES:
 * - both (the default, IB-116's run): regular alerts, regular near-misses and controls up to the live start, as before;
 *   hidden alerts and hidden near-misses under the hidden bounds below;
 * - `['hidden']` (IB-144's run): nothing regular and no control is written — the window's regular rows and controls
 *   exist already (IB-116, V41) — but every regular detection is still COUNTED, for V47's «regular unchanged» check.
 * **Hidden end, per (symbol, tf) (V47):** the first evaluation of the hidden-aware build — the `created_at` of the
 * pair's first LIVE control whose params carry `sendHidden` (`hiddenEnd`). The live loop journals hidden from there
 * on (and its boot replay journals the last W bars' hidden as late), so the run writes hidden only for closes before
 * it, and never a hidden B that already has a LIVE row of the same (symbol, tf, kind, direction, b_time) — nor a
 * hidden near-miss whose B has a live alert or near-miss of that kind: one B is counted once. A pair with no such
 * control yet writes no hidden row (named in `hiddenSkipped`); a rerun picks it up, once-keys make reruns safe.
 * **Counts** (`detections`) are over the IB-116 window only (closes up to the live start) for both kinds, so regular
 * and hidden are compared on the same bars; `written` says what was written. Each hidden detection can be streamed
 * with its bars and raw OI to `onHidden` (the CLI's `--dump`) for V47's independent recheck.
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
  /**
   * IB-144 (V47): the end of the hidden write window for (symbol, tf) — `created_at` of the pair's first LIVE control
   * row whose params carry `sendHidden` (the hidden-aware build's first evaluation); null when there is none yet.
   */
  hiddenEnd(symbol: string, tf: OiDivergenceTf): Promise<number | null>;
  /** IB-144 (V47): whether a LIVE alert / near-miss row exists for (symbol, tf, kind, direction, b_time). */
  hasLive(what: 'alert' | 'near_miss', symbol: string, tf: OiDivergenceTf, kind: OiDivergenceKind, direction: OiDivergenceDirection, bTime: number): Promise<boolean>;
  /** IB-144: each hidden detection, once, with what V47's independent recheck needs (the CLI writes it as JSONL). */
  onHidden?: (d: HiddenDetection) => void;
}

export interface ReplayOptions {
  /** Which kinds the run writes (IB-144). Default both. Detections of every kind are counted either way. */
  kinds?: readonly OiDivergenceKind[];
}

/** IB-144 (V45, V47): one alert as the replay found it — counted whether written or not. */
export interface Detection {
  symbol: string;
  tf: OiDivergenceTf;
  kind: OiDivergenceKind;
  direction: OiDivergenceDirection;
  aTime: number;
  bTime: number;
  runLength: number;
  confirmedAt: number;
  /** The evaluation close that offered it to the journal (its first). */
  close: number;
  /** Offered at a close up to the live start: inside IB-116's window, where V47 compares the kinds. */
  inWindow: boolean;
  /** What happened to it: written, already there (once-key), skipped because a live row has it, or out of bounds. */
  outcome: 'written' | 'exists' | 'live' | 'not_written';
}

/** The hidden detection with its context: the bars from ATR_PERIOD + 1 before A through B's confirmation, the raw OI. */
export interface HiddenDetection extends Omit<Detection, 'outcome'> {
  a: NewOiAlert['a'];
  b: NewOiAlert['b'];
  pricePct: number;
  oiPct: number;
  params: { k: number; w: number; nLeft: number; nRight: number; atrMult: number; oiMedianMult: number; priceLineTolAtrMult: number; oiLineTolMedianMult: number };
  tfSec: number;
  bars: Bar[];
  oi5m: Array<{ time: number; oi: number }>;
}

/** IB-144: per (tf, kind) — what the replay found, and near-misses by rule (inside the IB-116 window). */
export interface KindCounts {
  tf: OiDivergenceTf;
  kind: OiDivergenceKind;
  /** Distinct alerts found inside the window, and how many of them are bullish. */
  found: number;
  bullish: number;
  repeats: number;
  /** Rows written by this run (any close), and found-but-skipped because a live row has the B. */
  written: number;
  skippedLive: number;
  nearMisses: Partial<Record<OiNearMissRule, number>>;
  nearMissesWritten: number;
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
  /** IB-144 (V45): per TF and kind, regular beside hidden over the same closes. */
  kinds: KindCounts[];
  /** IB-144 (V41): B (symbol, tf, direction, b_time) inside the window that produced BOTH kinds, per TF. */
  bothKinds: Record<OiDivergenceTf, number>;
  /** IB-144 (V47): the pairs with no hidden-aware live control yet — no hidden row written for them. */
  hiddenSkipped: string[];
  /** IB-144 (V47): the hidden write bound per pair (the close before the hidden-aware build's first evaluation). */
  hiddenLast: Record<string, number>;
  /** IB-144: every distinct alert detection (keys only; the CLI dumps the hidden ones with context). */
  detections: Detection[];
}

/** Bars that must exist after a coin's first OI before its first close can be judged (the live loop's young-coin rule). */
function firstCloseFor(firstOi: number, tf: OiDivergenceTf, need: number): number {
  const tfSec = OI_DIVERGENCE_TF_SEC[tf];
  const firstBar = Math.ceil(firstOi / tfSec) * tfSec; // bars open at or after the first reading (V11)
  return firstBar + need * tfSec;
}

export async function replayHistory(ports: HistoryBackfillPorts, nowSec: number, opts: ReplayOptions = {}): Promise<BackfillReport> {
  const liveStart = await ports.liveStart();
  if (liveStart === null) throw new Error('the live research journal has not started (no live control row): nothing bounds the run');
  const writes = new Set<OiDivergenceKind>(opts.kinds ?? OI_DIVERGENCE_KINDS);

  // the params and the coin list in force, read once: the whole run is made with one set (V31)
  const settings = await ports.store.settings();
  const symbols = await ports.store.enabledSymbols();
  const warnings: Record<string, number> = {};
  const report: BackfillReport = {
    liveStart, coins: [], perTf: [], warnings,
    paths: { rows: 0, dueNow: 0, dueNowWeight: 0, open: 0, lastWindowCloses: null },
    kinds: [], bothKinds: { '15m': 0, '1h': 0, '4h': 0 }, hiddenSkipped: [], hiddenLast: {}, detections: [],
  };
  // the coin being replayed: the loop evaluates `enabledSymbols`, so a chunk is one coin (IB-116, TL memory condition)
  const current = { symbols: [] as string[] };
  // IB-144: where the evaluation is — which close, and whether each kind may be written at it
  const gate: Gate = { close: 0, regularLast: 0, hiddenLast: null, writes };
  const found = new Map<string, Detection>();
  const nearMissSeen = new Map<string, { kind: OiDivergenceKind; tf: OiDivergenceTf; rule: OiNearMissRule; inWindow: boolean; written: boolean }>();
  // one chunk = one coin × TF: its bars and its OI are read, replayed and dropped before the next (the month
  // of 5 m OI per coin is the largest thing held). Coins are independent — run, «produced an alert», controls
  // and near-misses are all per (symbol, tf) — so the order across coins does not change a row.
  let chunk: { bars: Bar[]; oi: OiWindow } = { bars: [], oi: { oi5m: [], venueSilent: [] } };
  const store = countingStore(ports.store, settings, current, report.paths, nowSec, {
    gate, ports,
    alert: (row, outcome) => {
      const key = `${row.symbol}|${row.tf}|${row.kind}|${row.direction}|${row.a.time}|${row.b.time}`;
      const seen = found.get(key);
      if (seen) { if (outcome === 'written') seen.outcome = 'written'; return; }
      const d: Detection = {
        symbol: row.symbol, tf: row.tf, kind: row.kind, direction: row.direction, aTime: row.a.time, bTime: row.b.time,
        runLength: row.runLength, confirmedAt: row.confirmedAt, close: gate.close, inWindow: gate.close <= gate.regularLast, outcome,
      };
      found.set(key, d);
      if (row.kind === 'hidden') ports.onHidden?.(hiddenContext(d, row, chunk, settings.params, OI_DIVERGENCE_TF_SEC[row.tf]));
    },
    nearMiss: (row, written) => {
      const key = `${row.symbol}|${row.tf}|${row.kind}|${row.direction}|${row.b.time}`;
      const seen = nearMissSeen.get(key);
      if (seen) { seen.written ||= written; return; }
      nearMissSeen.set(key, { kind: row.kind, tf: row.tf, rule: row.rule, inWindow: gate.close <= gate.regularLast, written });
    },
  });
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
    const regularLast = dueBarClose(liveStart, tfSec) - tfSec; // the close before the live loop's first on this TF
    const r: BackfillTfReport = { tf, closes: 0, firstClose: null, lastClose: null, alerts: 0, controls: 0, nearMisses: 0, skips: 0, failed: 0 };
    report.perTf.push(r);
    const skipKeys = new Set<string>();
    for (const coin of report.coins) {
      if (coin.firstOi === null) continue;
      // V47: hidden rows are written up to the close before the hidden-aware build's first evaluation of this pair
      let hiddenLast: number | null = null;
      if (writes.has('hidden')) {
        const end = await ports.hiddenEnd(coin.symbol, tf);
        if (end === null) report.hiddenSkipped.push(`${coin.symbol} ${tf}`);
        else report.hiddenLast[`${coin.symbol} ${tf}`] = hiddenLast = dueBarClose(end, tfSec) - tfSec;
      }
      const last = Math.max(regularLast, hiddenLast ?? regularLast);
      await ports.beforeChunk?.(`${coin.symbol} ${tf}`);
      const from = Math.ceil(coin.firstOi / tfSec) * tfSec; // bars open at or after the first reading (V11)
      const bars = from < last ? (await ports.bars(coin.symbol, tf, from, last)).filter((b) => b.time >= from && b.time + tfSec <= last) : [];
      (coinBars.get(coin.symbol) as Record<OiDivergenceTf, number>)[tf] = bars.length;
      if (bars.length < need) continue;
      chunk = { bars, oi: await ports.oiWindow(coin.symbol, from - tfSec, last) };
      current.symbols = [coin.symbol];
      gate.regularLast = regularLast;
      gate.hiddenLast = hiddenLast;
      for (let close = firstCloseFor(coin.firstOi, tf, need); close <= last; close += tfSec) {
        gate.close = close;
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

  report.detections = [...found.values()];
  for (const tf of OI_DIVERGENCE_TFS) {
    for (const kind of OI_DIVERGENCE_KINDS) {
      const all = report.detections.filter((d) => d.tf === tf && d.kind === kind);
      const inWindow = all.filter((d) => d.inWindow);
      const misses = [...nearMissSeen.values()].filter((m) => m.tf === tf && m.kind === kind);
      const byRule: Partial<Record<OiNearMissRule, number>> = {};
      for (const m of misses) if (m.inWindow) byRule[m.rule] = (byRule[m.rule] ?? 0) + 1;
      report.kinds.push({
        tf, kind, found: inWindow.length, bullish: inWindow.filter((d) => d.direction === 'bullish').length,
        repeats: inWindow.filter((d) => d.runLength > 2).length,
        written: all.filter((d) => d.outcome === 'written').length, skippedLive: all.filter((d) => d.outcome === 'live').length,
        nearMisses: byRule, nearMissesWritten: misses.filter((m) => m.written).length,
      });
    }
    const bKey = (d: Detection) => `${d.symbol}|${d.direction}|${d.bTime}`;
    const regularB = new Set(report.detections.filter((d) => d.tf === tf && d.kind === 'regular' && d.inWindow).map(bKey));
    report.bothKinds[tf] = new Set(report.detections.filter((d) => d.tf === tf && d.kind === 'hidden' && d.inWindow && regularB.has(bKey(d))).map(bKey)).size;
  }
  return report;
}

interface Gate {
  /** The close being evaluated, and the last close each kind may be written at (hidden: null = this pair writes none). */
  close: number;
  regularLast: number;
  hiddenLast: number | null;
  writes: Set<OiDivergenceKind>;
}

/** May a row of `kind` be written at the gate's close? Regular (and controls): up to the live start; hidden: its own bound. */
function writable(gate: Gate, kind: OiDivergenceKind): boolean {
  if (!gate.writes.has(kind)) return false;
  return kind === 'regular' ? gate.close <= gate.regularLast : gate.hiddenLast !== null && gate.close <= gate.hiddenLast;
}

/** The bars and raw OI V47's recheck needs for one hidden detection: ATR at A + 1, the 100 moves before B, both lines. */
function hiddenContext(
  d: Detection, row: NewOiAlert, chunk: { bars: Bar[]; oi: OiWindow }, p: Awaited<ReturnType<OiAlertStore['settings']>>['params'], tfSec: number,
): HiddenDetection {
  const t = p.perTf[d.tf];
  // the earliest bar any check reads: ATR14 just after A (and its previous close), and the 100 per-bar moves before B
  const fromTime = Math.min(row.a.time, row.a.oiTime - tfSec, row.b.time - (OI_MEDIAN_BARS + 1) * tfSec) - (ATR_PERIOD + 2) * tfSec;
  const oiFrom = fromTime - tfSec;
  const toTime = Math.max(row.b.time + tfSec, row.b.oiTime + tfSec, row.confirmedAt - tfSec); // through the confirming bar (the pictures)
  return {
    symbol: d.symbol, tf: d.tf, kind: d.kind, direction: d.direction, aTime: d.aTime, bTime: d.bTime, runLength: d.runLength,
    confirmedAt: d.confirmedAt, close: d.close, inWindow: d.inWindow, a: row.a, b: row.b,
    pricePct: (row.b.price / row.a.price - 1) * 100, oiPct: (row.b.oi / row.a.oi - 1) * 100,
    params: { k: t.k, w: t.w, nLeft: t.nLeft, nRight: t.nRight, atrMult: p.atrMult, oiMedianMult: p.oiMedianMult, priceLineTolAtrMult: p.priceLineTolAtrMult, oiLineTolMedianMult: p.oiLineTolMedianMult },
    tfSec,
    bars: chunk.bars.filter((b) => b.time >= fromTime && b.time <= toTime),
    oi5m: chunk.oi.oi5m.filter((o) => o.time > oiFrom && o.time <= toTime + tfSec),
  };
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
  kinds: {
    gate: Gate; ports: HistoryBackfillPorts;
    alert: (row: NewOiAlert, outcome: Detection['outcome']) => void;
    nearMiss: (row: NewOiNearMiss, written: boolean) => void;
  },
): OiAlertStore {
  const { gate, ports } = kinds;
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
    // IB-144: every detection is counted; it is written only inside its kind's bounds, never over a live row (V47)
    insertAlert: async (row) => {
      if (!writable(gate, row.kind)) { kinds.alert(row, 'not_written'); return null; }
      if (row.kind === 'hidden' && await ports.hasLive('alert', row.symbol, row.tf, row.kind, row.direction, row.b.time)) { kinds.alert(row, 'live'); return null; }
      const id = await store.insertAlert(row);
      kinds.alert(row, id === null ? 'exists' : 'written');
      return id;
    },
    runFirstId: (...a) => store.runFirstId(...a),
    markFired: (...a) => store.markFired(...a),
    insertSkip: (row) => store.insertSkip(row),
    recipients: () => store.recipients(),
    outcomesDue: (now) => store.outcomesDue(now),
    setOutcome: (...a) => store.setOutcome(...a),
    // a hidden B the live loop journalled «produced an alert» too: no backfill near-miss beside it (one B, once)
    hasAlert: async (source, symbol, tf, kind, direction, bTime) => (await store.hasAlert(source, symbol, tf, kind, direction, bTime))
      || (kind === 'hidden' && await ports.hasLive('alert', symbol, tf, kind, direction, bTime)),
    // V41: controls are the regular population, left as IB-116 wrote them; written only where regular rows are
    insertControl: (row) => (writable(gate, 'regular') ? store.insertControl(row) : Promise.resolve(null)),
    insertNearMiss: async (row) => {
      const ok = writable(gate, row.kind)
        && !(row.kind === 'hidden' && await ports.hasLive('near_miss', row.symbol, row.tf, row.kind, row.direction, row.b.time));
      const id = ok ? await store.insertNearMiss(row) : null;
      kinds.nearMiss(row, id !== null);
      return id;
    },
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
  /** IB-123: whose backlog — IB-116's run measures `oi`, IB-123's `liq`, IB-125's `funding`; `all` only in specs that want both. */
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

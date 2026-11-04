import { OI_DIVERGENCE_TFS, OI_DIVERGENCE_TF_SEC, type OiDivergenceParams, type OiDivergenceTf, type OiJournalSource } from '@trade-automation/contracts';
import { atrAt, detectDivergences, type Bar, type DivergenceInput, type DivergenceParams } from '../../insights/divergence/detector';
import { diagnose } from '../../insights/divergence/diagnose';
import { detectorParams } from '../../insights/divergence/params';
import { oiDivergenceAlert } from '../../delivery/templates/oi-divergence.texts';
import { barsToFetch, fullBasisIndex, hasFullBasis, minBarsForNearMisses, minBarsToEvaluate } from './basis';
import { pivotControlPicks, randomControlPick, type ControlPick } from './research/controls';
import { entryT0, klinesWeight, measurePath, windowBars } from './research/path';
import { dueBarClose, isLate } from './timing';
import type { OiAlertStore } from './pg/oi-alerts.repo';

/**
 * IB-112 (architecture/oi-divergence-design-2026-11-04.md V8–V10, V12–V14) — the OI divergence alert
 * loop, as plain logic over ports (the Nest service in delivery/ only schedules it):
 *
 * 1. On each TF, once its bar close + 6 min is due, for every enabled coin of `alert_symbols`
 *    (re-read every evaluation: no deploy to change the list): the last `barsForEvaluation(params) + W`
 *    CLOSED bars (2 weight per call; the + W gives a repeat's earlier lines their own basis, basis.ts),
 *    the stored 5 m OI over them with the venue's silences (dev-1's OiWindowReader), and the detector.
 * 2. Every divergence whose B has its full basis in the window is journalled — **always**, whatever
 *    the switch says. The unique key absorbs a re-evaluation or a restart (V8). One confirmed more
 *    than one bar + 10 min ago is journalled `late` and never sent (V10).
 * 3. Only a NEW, on-time row is sent, and only while `alert_settings.enabled` (default OFF, V13): to
 *    every user with `oi_alerts`, in their language, through the Telegram sender.
 * 4. Skips (a hole in OI the venue did not cause, V9) are logged once per (symbol, TF, bar).
 * 5. Hourly: the +4 h and +24 h closes of sent alerts (1 m kline close, 1 weight each, V12).
 * 6. IB-115, the research journal (V23–V27), from the same bars — no extra bar fetch:
 *    - every journalled alert gets its price paths (4h / 24h / 72h from t0, V24);
 *    - controls (V25): the price pivot this evaluation decides for good, if its B produced no alert; and the
 *      newest bar when it is one of its day's 2 hash-picked closes;
 *    - near-misses (V26): `diagnose` beside the detector, at the B its wider reach decides for good;
 *    - every row carries the build (V27); each tick measures up to `PATHS_PER_TICK` closed windows, one
 *      klines call each at weight 1 / 2 / 5.
 *
 * A coin that fails (venue down, no OI yet) is logged and skipped; the others still run.
 *
 * 7. IB-116 (V30, V31): the same loop replays history. `source` says who is running it:
 *    - `live` (the Nest service): everything above;
 *    - `backfill` (the one-off history run, `backfill/`): the same evaluation, so the same detections, runs,
 *      controls and near-misses — but every row is stamped `backfill`, its run and «produced an alert» are
 *      looked up among backfill rows only, nothing is ever late or sent, and skips are counted, not written
 *      (the skips table has no source; a month-old hole is not news for `/admin/alerts`).
 */
export interface OiAlertLoopPorts {
  store: OiAlertStore;
  /** Closed bars with open time in [fromSec, toSec), oldest first. */
  klines(symbol: string, tf: OiDivergenceTf, fromSec: number, toSec: number): Promise<Bar[]>;
  /** Stored 5 m OI over (fromSec, toSec] and the venue's silences in it (dev-1's OiWindowReader). */
  oiWindow(symbol: string, fromSec: number, toSec: number): Promise<{ oi5m: { time: number; oi: number }[]; venueSilent: { from: number; to: number }[] }>;
  /** The close of the 1 m bar that opens at `atSec`, or null when the venue has none. */
  closeAt(symbol: string, atSec: number): Promise<number | null>;
  /** Delivered or not; never throws (TelegramSender.sendTo). */
  send(chatId: number, text: string): Promise<boolean>;
  /** WEB_BASE_URL, for the link in the message. */
  webBaseUrl: string;
  /** IB-115 (V27): the image's commit (12 hex) or 'dev' — stamped on every journal, control and near-miss row. */
  build: string;
  /** IB-115 (V24): `limit` CLOSED 5 m klines from `fromSec`, one request at exactly that limit. */
  klines5m(symbol: string, fromSec: number, limit: number): Promise<Bar[]>;
  /** IB-116 (V30): who writes — the live service passes `live`, the history run `backfill`. No default. */
  source: OiJournalSource;
  log?: { warn(message: string): void; log?(message: string): void };
}

export interface EvaluationReport {
  tf: OiDivergenceTf;
  barClose: number;
  journalled: number;
  late: number;
  sent: number;
  skips: number;
  /** IB-115: coins evaluated, controls and near-misses recorded. */
  coins: number;
  controls: number;
  nearMisses: number;
  failed: string[];
  /** IB-116: in a backfill, the (symbol, tf, bar) skips seen — counted here instead of written. */
  skipKeys?: string[];
}

export interface PathRunReport {
  measured: number;
  failed: number;
  /** Documented klines weight of the calls made (V24: 1 / 2 / 5 per window). */
  weight: number;
}

/** IB-115: paths measured per tick at most — a backlog after downtime drains at ≤ 10 calls a minute (≤ 50 weight). */
export const PATHS_PER_TICK = 10;
/** A window whose fetch failed is retried after this long, behind the ones never tried (no starvation). */
export const PATH_RETRY_SEC = 15 * 60;

const HOUR = 3_600;

export class OiAlertLoop {
  /** The bar close each TF was last evaluated for: a tick does each due close once. */
  private readonly done = new Map<OiDivergenceTf, number>();
  private lastOutcomeRun = Number.NEGATIVE_INFINITY;
  private running = false;

  constructor(private readonly ports: OiAlertLoopPorts) {}

  /** One check (the service calls it every minute). Returns what each due evaluation did. */
  async tick(nowSec: number): Promise<EvaluationReport[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const reports: EvaluationReport[] = [];
      for (const tf of OI_DIVERGENCE_TFS) {
        const close = dueBarClose(nowSec, OI_DIVERGENCE_TF_SEC[tf]);
        if (this.done.get(tf) === close) continue;
        reports.push(await this.evaluate(tf, close, nowSec));
        this.done.set(tf, close);
      }
      if (nowSec - this.lastOutcomeRun >= HOUR) {
        await this.fillOutcomes(nowSec);
        this.lastOutcomeRun = nowSec;
      }
      const paths = await this.measurePaths(nowSec);
      if (paths.measured > 0 || paths.failed > 0) {
        this.ports.log?.log?.(`oi research paths: measured ${paths.measured}, failed ${paths.failed}, weight ${paths.weight}`);
      }
      return reports;
    } finally {
      this.running = false;
    }
  }

  /** Evaluates every enabled coin on `tf` for the bar that closed at `barClose`. */
  async evaluate(tf: OiDivergenceTf, barClose: number, nowSec: number): Promise<EvaluationReport> {
    const { store } = this.ports;
    const tfSec = OI_DIVERGENCE_TF_SEC[tf];
    const report: EvaluationReport = { tf, barClose, journalled: 0, late: 0, sent: 0, skips: 0, coins: 0, controls: 0, nearMisses: 0, failed: [] };
    const { build, source } = this.ports;
    const backfill = source === 'backfill';
    const settings = await store.settings();
    const params: DivergenceParams = detectorParams(settings.params, tf);
    const count = barsToFetch(params);
    const need = minBarsToEvaluate(params);
    const symbols = await store.enabledSymbols();
    report.coins = symbols.length;
    for (const symbol of symbols) {
      try {
        const bars = (await this.ports.klines(symbol, tf, barClose - count * tfSec, barClose)).filter((b) => b.time + tfSec <= barClose).slice(-count);
        if (bars.length < need) {
          // a coin listed recently on the venue: not enough history to judge any B on a full basis
          this.ports.log?.warn(`oi alerts ${symbol} ${tf}: ${bars.length} closed bars, need ${need} — not evaluated`);
          continue;
        }
        const from = bars[0].time;
        const to = (bars[bars.length - 1] as Bar).time + tfSec;
        const window = await this.ports.oiWindow(symbol, from, to);
        const input: DivergenceInput = { tfSec, bars, oi5m: window.oi5m, venueSilent: window.venueSilent, params };
        const result = detectDivergences(input);
        const guardFrom = bars[fullBasisIndex(params, bars.length)]?.time ?? Number.POSITIVE_INFINITY;
        for (const skip of result.skips) {
          if (skip.barTime < guardFrom) continue; // that B is judged on a full basis by an earlier evaluation
          if (backfill) { (report.skipKeys ??= []).push(`${symbol}|${tf}|${skip.barTime}`); report.skips++; continue; }
          if (await store.insertSkip({ symbol, tf, barTime: skip.barTime, holeFrom: skip.holeFrom, holeTo: skip.holeTo, at: nowSec })) report.skips++;
        }
        for (const d of result.divergences) {
          if (!hasFullBasis(d.bIndex, params, bars.length) || d.confirmedAt > to) continue;
          // V30: a backfilled row was never sent, so it cannot have been sent late either (the database refuses it)
          const late = !backfill && isLate(d.confirmedAt, nowSec, tfSec);
          const runOf = d.runFirstBTime === null ? null : await store.runFirstId(source, symbol, tf, d.direction, d.runFirstBTime);
          const id = await store.insertAlert({
            source, symbol, tf, direction: d.direction, a: d.a, b: d.b, runOf, runLength: d.runLength,
            params: settings.params, confirmedAt: d.confirmedAt, late, build,
          });
          if (id === null) continue; // already journalled: a re-evaluation or a restart (V8)
          report.journalled++;
          // V23: sent or not, late or not, the same t0 — so the switch does not change what is measured
          await store.insertPaths({ alertId: id }, { symbol, direction: d.direction, t0: entryT0(d.confirmedAt), atr14: atrAt(bars, d.bIndex) ?? 0, stopPrice: d.b.price });
          if (late) { report.late++; continue; }
          if (backfill) continue; // V33: history is never sent
          if (!settings.enabled) continue; // V13: the journal runs either way; nothing is sent while off
          const recipients = await store.recipients();
          const texts = oiDivergenceAlert({
            symbol, base: baseOf(symbol), tf, direction: d.direction, pricePct: d.pricePct, oiPct: d.oiPct, runLength: d.runLength, bTime: d.b.time,
          }, this.ports.webBaseUrl);
          let delivered = 0;
          for (const r of recipients) if (await this.ports.send(r.chatId, texts[r.lang])) delivered++;
          await store.markFired(id, nowSec, delivered, (bars[bars.length - 1] as Bar).close);
          report.sent += delivered;
        }
        await this.research(symbol, tf, input, result, settings.params, report);
      } catch (error) {
        report.failed.push(symbol);
        this.ports.log?.warn(`oi alerts ${symbol} ${tf}: ${(error as Error).message}`);
      }
    }
    return report;
  }

  /**
   * IB-115 (V25, V26): the controls and the near-miss this evaluation decides, from the bars it already read.
   * Both exclude a B the journal holds an alert for — the journal, not this window, is what «produced an alert» means.
   */
  private async research(
    symbol: string, tf: OiDivergenceTf, input: DivergenceInput, result: ReturnType<typeof detectDivergences>,
    params: OiDivergenceParams, report: EvaluationReport,
  ): Promise<void> {
    const { store, build, source } = this.ports;
    const { bars, params: p, tfSec } = input;
    const picks: ControlPick[] = [];
    for (const pick of pivotControlPicks(input, result)) {
      if (!(await store.hasAlert(source, symbol, tf, pick.direction as 'bullish' | 'bearish', pick.barTime))) picks.push(pick);
    }
    const random = randomControlPick(symbol, tf, bars, tfSec);
    if (random) picks.push(random);
    for (const c of picks) {
      const id = await store.insertControl({ source, symbol, tf, kind: c.kind, direction: c.direction, barTime: c.barTime, stopPrice: c.stopPrice, params, build });
      if (id === null) continue;
      report.controls++;
      await store.insertPaths({ controlId: id }, { symbol, direction: c.direction, t0: c.t0, atr14: c.atr14, stopPrice: c.stopPrice });
    }

    if (bars.length < minBarsForNearMisses(p)) return; // a young coin: the reach's basis is not there yet
    const decided = bars.length - (2 * p.k + p.n + 1); // the newest B whose OI pivot may lie 2k after it, confirmed
    for (const m of diagnose(input, result)) {
      if (m.bIndex !== decided) continue;
      if (await store.hasAlert(source, symbol, tf, m.direction, m.b.time)) continue;
      const id = await store.insertNearMiss({
        source, symbol, tf, direction: m.direction, a: m.a, b: m.b, rule: m.rule, miss: m.miss, unit: m.unit, params, confirmedAt: m.confirmedAt, build,
      });
      if (id === null) continue;
      report.nearMisses++;
      await store.insertPaths({ nearMissId: id }, { symbol, direction: m.direction, t0: entryT0(m.confirmedAt), atr14: atrAt(bars, m.bIndex) ?? 0, stopPrice: m.b.price });
    }
  }

  /**
   * IB-115 (V24): measures the windows that have closed — one klines call each, oldest first, failed ones last.
   * Only this loop's own source (IB-116, V31): the live tick never takes the backfill's backlog. `beforeCall`
   * lets the backfill pace each call (≤ 200 weight a minute); `limit` its batch.
   */
  async measurePaths(nowSec: number, opts: { limit?: number; beforeCall?: (weight: number) => Promise<void> } = {}): Promise<PathRunReport> {
    const { store, source } = this.ports;
    const out: PathRunReport = { measured: 0, failed: 0, weight: 0 };
    for (const due of await store.pathsDue(source, nowSec, opts.limit ?? PATHS_PER_TICK, PATH_RETRY_SEC)) {
      const limit = windowBars(due.win);
      try {
        await opts.beforeCall?.(klinesWeight(limit));
        out.weight += klinesWeight(limit);
        const klines = await this.ports.klines5m(due.symbol, due.t0, limit);
        await store.setPath(due.id, measurePath(klines, due), nowSec);
        out.measured++;
      } catch (error) {
        out.failed++;
        await store.pathFailed(due.id, nowSec);
        this.ports.log?.warn(`oi research path ${due.id} ${due.symbol} ${due.win}: ${(error as Error).message}`);
      }
    }
    return out;
  }

  /** V12: the +4 h and +24 h closes of sent alerts; `outcome_at` once both are in. */
  async fillOutcomes(nowSec: number): Promise<number> {
    const { store } = this.ports;
    let filled = 0;
    for (const row of await store.outcomesDue(nowSec)) {
      try {
        let has4h = row.price4h !== null;
        let has24h = row.price24h !== null;
        if (!has4h && row.firedAt + 4 * HOUR <= nowSec) {
          const price = await this.ports.closeAt(row.symbol, minuteOf(row.firedAt + 4 * HOUR));
          if (price !== null) { has4h = true; await store.setOutcome(row.id, 'price_4h', price, has24h ? nowSec : null); filled++; }
        }
        if (!has24h && row.firedAt + 24 * HOUR <= nowSec) {
          const price = await this.ports.closeAt(row.symbol, minuteOf(row.firedAt + 24 * HOUR));
          if (price !== null) { has24h = true; await store.setOutcome(row.id, 'price_24h', price, has4h ? nowSec : null); filled++; }
        }
      } catch (error) {
        this.ports.log?.warn(`oi alerts outcome ${row.id}: ${(error as Error).message}`);
      }
    }
    return filled;
  }
}

/** The 1 m bar a moment falls in. */
const minuteOf = (sec: number): number => Math.floor(sec / 60) * 60;

/** «TRXUSDT» → «TRX»: what a member calls the coin (the message names it so, V14). */
export function baseOf(symbol: string): string {
  const base = symbol.replace(/(USDT|USDC|FDUSD|BUSD|USD)$/, '');
  return base.length > 0 ? base : symbol;
}

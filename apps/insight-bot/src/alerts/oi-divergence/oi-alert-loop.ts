import { OI_DIVERGENCE_TFS, OI_DIVERGENCE_TF_SEC, type OiDivergenceTf } from '@trade-automation/contracts';
import { detectDivergences, type Bar, type DivergenceParams } from '../../insights/divergence/detector';
import { oiDivergenceAlert } from '../../delivery/templates/oi-divergence.texts';
import { barsToFetch, fullBasisIndex, hasFullBasis } from './basis';
import { dueBarClose, isLate } from './timing';
import type { OiAlertStore } from './pg/oi-alerts.repo';

/**
 * IB-112 (architecture/oi-divergence-design-2026-11-04.md V8–V10, V12–V14) — the OI divergence alert
 * loop, as plain logic over ports (the Nest service in delivery/ only schedules it):
 *
 * 1. On each TF, once its bar close + 6 min is due, for every enabled coin of `alert_symbols`
 *    (re-read every evaluation: no deploy to change the list): the last `barsForEvaluation(params)`
 *    CLOSED bars (2 weight per call), the stored 5 m OI over them with the venue's silences (dev-1's
 *    OiWindowReader), and the detector.
 * 2. Every divergence whose B has its full basis in the window is journalled — **always**, whatever
 *    the switch says. The unique key absorbs a re-evaluation or a restart (V8). One confirmed more
 *    than one bar + 10 min ago is journalled `late` and never sent (V10).
 * 3. Only a NEW, on-time row is sent, and only while `alert_settings.enabled` (default OFF, V13): to
 *    every user with `oi_alerts`, in their language, through the Telegram sender.
 * 4. Skips (a hole in OI the venue did not cause, V9) are logged once per (symbol, TF, bar).
 * 5. Hourly: the +4 h and +24 h closes of sent alerts (1 m kline close, 1 weight each, V12).
 *
 * A coin that fails (venue down, no OI yet) is logged and skipped; the others still run.
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
  log?: { warn(message: string): void; log?(message: string): void };
}

export interface EvaluationReport {
  tf: OiDivergenceTf;
  barClose: number;
  journalled: number;
  late: number;
  sent: number;
  skips: number;
  failed: string[];
}

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
      return reports;
    } finally {
      this.running = false;
    }
  }

  /** Evaluates every enabled coin on `tf` for the bar that closed at `barClose`. */
  async evaluate(tf: OiDivergenceTf, barClose: number, nowSec: number): Promise<EvaluationReport> {
    const { store } = this.ports;
    const tfSec = OI_DIVERGENCE_TF_SEC[tf];
    const report: EvaluationReport = { tf, barClose, journalled: 0, late: 0, sent: 0, skips: 0, failed: [] };
    const settings = await store.settings();
    const params: DivergenceParams = { ...settings.params.perTf[tf], atrMult: settings.params.atrMult, oiMedianMult: settings.params.oiMedianMult };
    const count = barsToFetch(params);
    const symbols = await store.enabledSymbols();
    for (const symbol of symbols) {
      try {
        const bars = (await this.ports.klines(symbol, tf, barClose - count * tfSec, barClose)).filter((b) => b.time + tfSec <= barClose).slice(-count);
        if (bars.length < count) {
          // a coin listed recently on the venue: not enough history to judge any B on a full basis
          this.ports.log?.warn(`oi alerts ${symbol} ${tf}: ${bars.length} closed bars, need ${count} — not evaluated`);
          continue;
        }
        const from = bars[0].time;
        const to = (bars[bars.length - 1] as Bar).time + tfSec;
        const window = await this.ports.oiWindow(symbol, from, to);
        const result = detectDivergences({ tfSec, bars, oi5m: window.oi5m, venueSilent: window.venueSilent, params });
        const guardFrom = bars[fullBasisIndex(params)]?.time ?? Number.POSITIVE_INFINITY;
        for (const skip of result.skips) {
          if (skip.barTime < guardFrom) continue; // that B is judged on a full basis by an earlier evaluation
          if (await store.insertSkip({ symbol, tf, barTime: skip.barTime, holeFrom: skip.holeFrom, holeTo: skip.holeTo, at: nowSec })) report.skips++;
        }
        for (const d of result.divergences) {
          if (!hasFullBasis(d.bIndex, params) || d.confirmedAt > to) continue;
          const late = isLate(d.confirmedAt, nowSec, tfSec);
          const runOf = d.runFirstBTime === null ? null : await store.runFirstId(symbol, tf, d.direction, d.runFirstBTime);
          const id = await store.insertAlert({
            symbol, tf, direction: d.direction, a: d.a, b: d.b, runOf, runLength: d.runLength,
            params: settings.params, confirmedAt: d.confirmedAt, late,
          });
          if (id === null) continue; // already journalled: a re-evaluation or a restart (V8)
          report.journalled++;
          if (late) { report.late++; continue; }
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
      } catch (error) {
        report.failed.push(symbol);
        this.ports.log?.warn(`oi alerts ${symbol} ${tf}: ${(error as Error).message}`);
      }
    }
    return report;
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

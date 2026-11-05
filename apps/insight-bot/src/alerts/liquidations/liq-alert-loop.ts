import {
  LIQ_CONTINUATION_MULT, LIQ_LATE_SEC, LIQ_SIDES, LIQ_TICK_SEC, type LiqAlertDetails, type LiqContinuationDetails, type LiqNearMissDetails,
  type LiqParams, type LiqRandomDetails, type LiqSide, type MarketAlertSource,
} from '@trade-automation/contracts';
import { liqAlert, liqContinuation } from '../../delivery/templates/liq-alerts.texts';
import type { Texts } from '../../delivery/templates/texts';
import { dayStartOf, liqPathT0, randomWindowEnds } from './controls';
import { silentVenues, type VenueStatus } from './coverage';
import type { JournalLiqRow, LiqAlertStore, VenuePair } from './pg/liq-alerts.repo';
import { venuePairs, venueSymbols, type UniverseSpelling, type VenueSymbols } from './venue-symbols';
import { QUIET_MS, WINDOW_MS, bestPerHour, quietAt, scanSide, statsAt, type LiqPrint, type NearMissCandidate } from './window';

/**
 * IB-122 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §2, L1–L8) — the large-liquidation
 * alert loop, as plain logic over ports (the Nest service in delivery/ only schedules it every 30 s).
 *
 * Each tick evaluates the moments in (cursor − 30 s, now]:
 * 1. ONE tape read: every enabled coin's prints on its three venue symbols (L5's mapper), both sides, over
 *    (from − 5 min, to] — 5.5 + 0.5 min in steady state (L7). A tick that is behind (boot, a slow DB) walks
 *    forward in chunks of ≤ 5 min, so no read is wider than 10 min of tape.
 * 2. Per coin and side, the sliding window (window.ts): the first moment the sum over (t − 5 min, t] reached
 *    the coin's threshold is the alert's `at`. Journalled ALWAYS (whatever the switch); its dedupe key is
 *    the window start (L2), so an overlapping tick or a restart cannot journal it twice.
 * 3. Quiet 30 min from `at` (the journal holds the periods, so they survive a restart). While quiet, the
 *    running sum since the window start is checked once a tick (one aggregate read per quiet coin and side);
 *    at 2× the threshold, ONE `continuing` row (key: the alert's id).
 * 4. `at` (or a continuation's crossing) more than 5 min before now → `late`, journalled, never sent (L6).
 * 5. Sent only while the type's switch is on (default OFF), to users with `liq_alerts`, in their language.
 * 6. Controls (L8): the hour's largest near-miss per coin and side, written once the hour has been fully
 *    evaluated; 2 hash-picked random windows per coin and day. Direction-free price paths for all three.
 *
 * Boot: the cursor starts 35 min back (one quiet period + one window), so a cascade the process slept
 * through is journalled late (L6), and the quiet periods of alerts sent before a restart are honoured.
 * A near-miss hour that a restart cut in two is judged on the evaluated part only.
 */
export interface LiqAlertLoopPorts {
  store: LiqAlertStore;
  universe: readonly UniverseSpelling[];
  /** Delivered or not; never throws (TelegramSender.sendTo). */
  send(chatId: number, text: string): Promise<boolean>;
  webBaseUrl: string;
  /** The image's commit (12 hex) or 'dev' (V27). */
  build: string;
  /** V30: who writes. No default. */
  source: MarketAlertSource;
  log?: { warn(message: string): void; log?(message: string): void };
}

export interface LiqTickReport {
  fromMs: number;
  toMs: number;
  coins: number;
  alerts: number;
  continuations: number;
  late: number;
  sent: number;
  controls: number;
  /** L7, measured: DB round trips this tick, and the most prints held at once. */
  reads: number;
  maxPrints: number;
  failed: string[];
}

/** Catch-up at boot: one quiet period and one window. */
export const BOOT_LOOKBACK_MS = QUIET_MS + WINDOW_MS;
/** Each tick re-evaluates this much before its cursor, for prints a venue delivered a little late. */
export const OVERLAP_MS = LIQ_TICK_SEC * 1_000;
/** The widest span of candidate moments one read covers. */
export const CHUNK_MS = WINDOW_MS;
const LATE_MS = LIQ_LATE_SEC * 1_000;
const HOUR_MS = 3_600_000;

interface Coin { symbol: string; base: string; thresholdUsd: number; venues: VenueSymbols; pairs: VenuePair[] }

export class LiqAlertLoop {
  private cursor: number | null = null;
  private running = false;
  /**
   * L8: per `symbol|side|hour`, each chunk's best near-miss candidate (≤ 120 an hour). Kept as a list, not a
   * running max: a candidate can turn out to be the prelude of an alert found a tick later, and is then
   * dropped at the flush in favour of the hour's next best.
   */
  private readonly nearMisses = new Map<string, { symbol: string; side: LiqSide; thresholdUsd: number; hour: number; candidates: NearMissCandidate[] }>();

  constructor(private readonly ports: LiqAlertLoopPorts) {}

  /** One check (the service calls it every 30 s). Null when the previous tick is still running. */
  async tick(nowMs: number): Promise<LiqTickReport | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const from = this.cursor === null ? nowMs - BOOT_LOOKBACK_MS : Math.min(this.cursor, nowMs) - OVERLAP_MS;
      const report: LiqTickReport = { fromMs: from, toMs: nowMs, coins: 0, alerts: 0, continuations: 0, late: 0, sent: 0, controls: 0, reads: 0, maxPrints: 0, failed: [] };
      const { store } = this.ports;
      const settings = await store.settings();
      const coins = this.coins(await store.listedCoins(), settings.params);
      report.reads += 2;
      report.coins = coins.length;
      for (let s = from; s < nowMs; s = Math.min(s + CHUNK_MS, nowMs)) {
        await this.evaluate(coins, settings, s, Math.min(s + CHUNK_MS, nowMs), nowMs, report);
      }
      await this.continuations(coins, settings, from, nowMs, report);
      await this.flushNearMisses(nowMs, settings.params, report);
      this.cursor = nowMs;
      return report;
    } finally {
      this.running = false;
    }
  }

  /** L4: enabled `alert_symbols` that have a threshold and are switched on for liquidations. */
  private coins(listed: ReadonlyArray<{ symbol: string; base: string }>, params: LiqParams): Coin[] {
    const out: Coin[] = [];
    for (const c of listed) {
      const p = params.perCoin[c.symbol];
      if (!p?.enabled) continue;
      const venues = venueSymbols(c.symbol, c.base, this.ports.universe);
      if (!venues) { this.ports.log?.warn(`liq alerts ${c.symbol}: base '${c.base}' names no USDT-linear contract — not evaluated`); continue; }
      out.push({ symbol: c.symbol, base: c.base, thresholdUsd: p.thresholdUsd, venues, pairs: venuePairs(venues) });
    }
    return out;
  }

  /** Candidate moments in (fromMs, toMs]. */
  private async evaluate(coins: readonly Coin[], settings: Awaited<ReturnType<LiqAlertStore['settings']>>, fromMs: number, toMs: number, nowMs: number, report: LiqTickReport): Promise<void> {
    const { store, source } = this.ports;
    if (coins.length === 0) return;
    const bySymbol = new Map<string, string>(); // venue|venueSymbol → coin
    for (const c of coins) for (const p of c.pairs) bySymbol.set(`${p.venue}|${p.symbol}`, c.symbol);
    const prints = await store.prints(coins.flatMap((c) => c.pairs), fromMs - WINDOW_MS, toMs);
    const journal = await store.journal(source, fromMs - QUIET_MS - WINDOW_MS);
    report.reads += 2;
    report.maxPrints = Math.max(report.maxPrints, prints.length);
    let status: VenueStatus | null = null;
    for (const coin of coins) {
      try {
        const own = prints.filter((p) => bySymbol.get(`${p.venue}|${p.symbol}`) === coin.symbol);
        for (const side of LIQ_SIDES) {
          const sidePrints: LiqPrint[] = own.filter((p) => p.side === side).map((p) => ({ ts: p.ts, usd: p.usd, venue: p.venue }));
          const alertAts = journal.filter((j) => j.event === 'alert' && j.symbol === coin.symbol && j.side === side).map((j) => j.at);
          const scan = scanSide(sidePrints, fromMs, toMs, coin.thresholdUsd, alertAts);
          for (const crossing of scan.alerts) {
            status ??= await store.venueStatus();
            report.reads++;
            await this.journalAlert(coin, side, crossing.at, crossing.stats, status, settings, nowMs, report);
          }
          for (const nm of scan.nearMisses.values()) {
            const key = `${coin.symbol}|${side}|${nm.hour}`;
            const bucket = this.nearMisses.get(key) ?? { symbol: coin.symbol, side, thresholdUsd: coin.thresholdUsd, hour: nm.hour, candidates: [] };
            bucket.candidates.push(nm);
            this.nearMisses.set(key, bucket);
          }
        }
        await this.randomControls(coin, own, fromMs, toMs, settings.params, report);
      } catch (error) {
        if (!report.failed.includes(coin.symbol)) report.failed.push(coin.symbol);
        this.ports.log?.warn(`liq alerts ${coin.symbol}: ${(error as Error).message}`);
      }
    }
  }

  private async journalAlert(
    coin: Coin, side: LiqSide, atMs: number, stats: ReturnType<typeof statsAt>, status: VenueStatus,
    settings: Awaited<ReturnType<LiqAlertStore['settings']>>, nowMs: number, report: LiqTickReport,
  ): Promise<void> {
    const { store, source, build } = this.ports;
    const windowStartMs = atMs - WINDOW_MS;
    const late = source === 'live' && nowMs - atMs > LATE_MS;
    const sending = source === 'live' && settings.enabled && !late;
    const binanceFootnote = sending && !(await store.footnoteSent(dayStartOf(nowMs)));
    const details: LiqAlertDetails = {
      side, windowStartMs, sumUsd: stats.sum, thresholdUsd: coin.thresholdUsd, byVenue: stats.byVenue, count: stats.count, largest: stats.largest,
      silentVenues: silentVenues(coin.venues, windowStartMs, atMs, status), binanceFootnote,
    };
    const id = await store.insertAlert({
      source, event: 'alert', symbol: coin.symbol, atMs, details, params: settings.params, build, confirmedAtMs: nowMs, late,
      dedupeKey: `liq:${coin.symbol}:${side}:${windowStartMs}`,
    });
    if (id === null) return;
    report.alerts++;
    await store.insertPaths({ marketAlertId: id }, coin.symbol, liqPathT0(atMs));
    if (late) { report.late++; return; }
    if (!sending) return;
    const texts = liqAlert({ symbol: coin.symbol, base: coin.base, side, atMs, sumUsd: stats.sum, byVenue: stats.byVenue, count: stats.count, largest: stats.largest, silentVenues: details.silentVenues, binanceFootnote }, this.ports.webBaseUrl);
    report.sent += await this.deliver(id, texts, nowMs);
  }

  /**
   * L2: for every alert whose quiet period overlaps this tick and that has no continuation yet, the running
   * sum since its window start, up to the end of its quiet period. One aggregate read each.
   */
  private async continuations(coins: readonly Coin[], settings: Awaited<ReturnType<LiqAlertStore['settings']>>, fromMs: number, nowMs: number, report: LiqTickReport): Promise<void> {
    const { store, source, build } = this.ports;
    const journal = await store.journal(source, fromMs - QUIET_MS);
    report.reads++;
    const continued = new Set(journal.filter((j) => j.event === 'continuing').map((j) => j.alertId));
    const open = journal.filter((j): j is JournalLiqRow => j.event === 'alert' && j.at + QUIET_MS > fromMs && !continued.has(j.id));
    for (const alert of open) {
      const coin = coins.find((c) => c.symbol === alert.symbol);
      if (!coin) continue; // switched off since: no continuation for a coin that is off
      try {
        const target = alert.thresholdUsd * LIQ_CONTINUATION_MULT;
        const run = await store.runningSum(coin.pairs, alert.side, alert.windowStartMs, Math.min(nowMs, alert.at + QUIET_MS), target);
        report.reads++;
        if (run.crossedAt === null) continue;
        const late = source === 'live' && nowMs - run.crossedAt > LATE_MS;
        const details: LiqContinuationDetails = { side: alert.side, alertId: alert.id, windowStartMs: alert.windowStartMs, sumUsd: run.total, thresholdUsd: alert.thresholdUsd };
        const id = await store.insertAlert({
          source, event: 'continuing', symbol: coin.symbol, atMs: run.crossedAt, details, params: settings.params, build, confirmedAtMs: nowMs, late,
          dedupeKey: `liq-cont:${coin.symbol}:${alert.side}:${alert.id}`,
        });
        if (id === null) continue;
        report.continuations++;
        await store.insertPaths({ marketAlertId: id }, coin.symbol, liqPathT0(run.crossedAt));
        if (late) { report.late++; continue; }
        if (source !== 'live' || !settings.enabled) continue;
        const texts = liqContinuation({ symbol: coin.symbol, base: coin.base, side: alert.side, atMs: run.crossedAt, sumUsd: run.total, windowStartMs: alert.windowStartMs }, this.ports.webBaseUrl);
        report.sent += await this.deliver(id, texts, nowMs);
      } catch (error) {
        if (!report.failed.includes(coin.symbol)) report.failed.push(coin.symbol);
        this.ports.log?.warn(`liq alerts continuation ${alert.id}: ${(error as Error).message}`);
      }
    }
  }

  private async deliver(id: number, texts: Texts, nowMs: number): Promise<number> {
    let delivered = 0;
    for (const r of await this.ports.store.recipients()) if (await this.ports.send(r.chatId, texts[r.lang])) delivered++;
    await this.ports.store.markFired(id, nowMs, delivered);
    return delivered;
  }

  /** L8 `random`: the coin's hash-picked windows whose end falls in (fromMs, toMs]. */
  private async randomControls(coin: Coin, own: ReadonlyArray<{ ts: number; usd: number; venue: LiqPrint['venue']; side: LiqSide }>, fromMs: number, toMs: number, params: LiqParams, report: LiqTickReport): Promise<void> {
    const { store, source, build } = this.ports;
    for (let day = dayStartOf(fromMs); day <= toMs; day += 86_400_000) {
      for (const end of randomWindowEnds(coin.symbol, day)) {
        if (end <= fromMs || end > toMs) continue;
        const sideSum = (side: LiqSide) => statsAt(own.filter((p) => p.side === side), end).sum;
        const details: LiqRandomDetails = { windowStartMs: end - WINDOW_MS, longUsd: sideSum('long'), shortUsd: sideSum('short'), thresholdUsd: coin.thresholdUsd };
        const id = await store.insertControl({ source, kind: 'random', symbol: coin.symbol, atMs: end, details, params, build, dedupeKey: `liq-rnd:${coin.symbol}:${end}` });
        if (id === null) continue;
        report.controls++;
        await store.insertPaths({ marketControlId: id }, coin.symbol, liqPathT0(end));
      }
    }
  }

  /** L8 `near_miss`: an hour is written once the loop has evaluated past its end; its alerts' preludes are excluded. */
  private async flushNearMisses(evaluatedTo: number, params: LiqParams, report: LiqTickReport): Promise<void> {
    const { store, source, build } = this.ports;
    const due = [...this.nearMisses].filter(([, b]) => b.hour + HOUR_MS <= evaluatedTo);
    if (due.length === 0) return;
    const journal = await store.journal(source, Math.min(...due.map(([, b]) => b.hour)) - QUIET_MS - WINDOW_MS);
    report.reads++;
    for (const [key, b] of due) {
      this.nearMisses.delete(key);
      const alertAts = journal.filter((j) => j.event === 'alert' && j.symbol === b.symbol && j.side === b.side).map((j) => j.at);
      const nm = bestPerHour(b.candidates.filter((c) => !quietAt(c.at, alertAts))).get(b.hour);
      if (!nm) continue;
      const details: LiqNearMissDetails = {
        side: b.side, windowStartMs: nm.at - WINDOW_MS, sumUsd: nm.sum, thresholdUsd: b.thresholdUsd, ratio: nm.sum / b.thresholdUsd, hour: b.hour / 1000,
      };
      try {
        const id = await store.insertControl({ source, kind: 'near_miss', symbol: b.symbol, atMs: nm.at, details, params, build, dedupeKey: `liq-nm:${b.symbol}:${b.side}:${b.hour / 1000}` });
        if (id === null) continue;
        report.controls++;
        await store.insertPaths({ marketControlId: id }, b.symbol, liqPathT0(nm.at));
      } catch (error) {
        this.ports.log?.warn(`liq alerts near-miss ${key}: ${(error as Error).message}`);
      }
    }
  }
}

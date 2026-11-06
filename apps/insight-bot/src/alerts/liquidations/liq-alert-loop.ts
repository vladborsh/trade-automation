import {
  LIQ_LATE_SEC, LIQ_SIDES, LIQ_TICK_SEC, type LiqAlertDetails, type LiqEventCoin, type LiqEventContinuingDetails, type LiqEventDetails,
  type LiqNearMissDetails, type LiqParams, type LiqRandomDetails, type LiqSide, type MarketAlertSource, mutedDedupeKey,
} from '@trade-automation/contracts';
import { liqEvent, liqEventContinuation } from '../../delivery/templates/liq-alerts.texts';
import type { Texts } from '../../delivery/templates/texts';
import { dayStartOf, liqPathT0, randomWindowEnds } from './controls';
import { silentVenues, type VenueStatus } from './coverage';
import {
  EVENT_MAX_MS, continuationNews, eventSums, groupEvents, type CoinSum, type CrossingRow, type DecidedEvent, type LiqEvent, type SidePrint,
} from './events';
import { absorbedAfter, holdDecision, isSmall, opensDuringHold, type ClosedEvent, type FollowingEvent } from './merge';
import type { JournalLiqRow, LiqAlertStore, TapePrint, VenuePair } from './pg/liq-alerts.repo';
import { venuePairs, venueSymbols, type UniverseSpelling, type VenueSymbols } from './venue-symbols';
import { QUIET_MS, WINDOW_MS, bestPerHour, quietAt, scanSide, statsAt, type LiqPrint, type NearMissCandidate } from './window';

/**
 * IB-122 / IB-143 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §2 L1–L8, §2a L10–L15) — the
 * large-liquidation alert loop, as plain logic over ports (the Nest service in delivery/ only schedules it every
 * 10 s).
 *
 * Each tick evaluates the moments in (cursor − 10 s, now]:
 * 1. ONE tape read: every enabled coin's prints on its three venue symbols (L5's mapper), both sides, over
 *    (from − 5 min, to] — 5.5 + 0.5 min in steady state (L7). A tick that is behind (boot, a slow DB) walks
 *    forward in chunks of ≤ 5 min, so no read is wider than 10 min of tape.
 * 2. Per coin and side, the sliding window (window.ts): the first moment the sum over (t − 5 min, t] reached
 *    the coin's threshold is the crossing's `at`. Quiet 30 min from `at` per (coin, side) (L2). Journalled
 *    ALWAYS as `alert` (whatever the switch), with its event's T0 in `details.eventAt`; its dedupe key is the
 *    window start, so an overlapping tick or a restart cannot journal it twice. **Never sent by itself (L10).**
 * 3. The market event per side (events.ts, L11): the crossings of the journal's last 65 min plus this tick's,
 *    grouped; the members' prints read once (only while an event is undecided). At S, ONE `event` row
 *    (`liq-ev:{side}:{T0}`), the first message. If S was the cap, at the close ONE `event_continuing` row
 *    (`liq-ev-cont:{side}:{T0}`) with the final size — sent only when a coin joined after S or a member added its
 *    threshold (L13). The journal is the state (L14): a restart resumes the event, the once-keys absorb repeats.
 * 4. A first message whose S, or a continuation whose close, is more than 5 min before now → `late`, journalled,
 *    never sent; a late T0 makes the whole event late (L6, L14). A held message (below) is measured from when it
 *    was due.
 * 3b. IB-148 (§2b, L16–L19, merge.ts): a SMALL event (one member, < 3 × its threshold at S) next to a same-side
 *    event ≥ 10 × its sum. ≤ 120 s after such an event's close: its `event` row is written at S with
 *    `mergedInto {how: 'after'}` and not sent. Otherwise it is held to S + 120 s: sent then if nothing opened on its
 *    side; if something opened, it waits for that event's first message and is folded into it (`mergedInto
 *    {how: 'before'}`, the large text gains «Перед этим: …», its `details.merged` lists it) or, below 10 ×, sent just
 *    before it in the same tick. **The hold has no state of its own:** a held event is an open event with no
 *    `event` row and a computable S, re-derived every tick from the tape and the journal like any other, so a
 *    restart mid-hold resumes it and the once-key still writes (and sends) it once.
 * 5. Sent only while the type's switch is on (default OFF), to users with `liq_alerts`, in their language.
 * 5a. IB-151 (owner ruling 2026-11-06 B): a coin switched off (`perCoin[symbol].enabled = false`, threshold kept) is
 *    evaluated like any coin, and its crossings are journalled as `alert` rows with `mutedBy: 'coin'`, no `eventAt`
 *    and a once-key of their own (`mutedDedupeKey`). **Such a crossing never reaches the events:** it is journalled
 *    before the grouping, the grouping reads only unmuted rows, so it cannot join or enlarge an event, open one, or
 *    count for IB-148's small/large merge. A coin that is on does not see its own muted rows either (quiet period,
 *    near-miss exclusion), so what is sent is what would have been sent had they never been written. Its prints are
 *    in the tick's one tape read already (they always were: L5 tracks every listed coin); no venue call.
 * 6. Controls (L8): the hour's largest near-miss per coin and side, written once the hour has been fully
 *    evaluated; 2 hash-picked random windows per coin and day. Direction-free price paths for all three.
 *
 * Boot: the cursor starts 35 min back (one quiet period + one window), so a cascade the process slept
 * through is journalled late (L6), and the quiet periods of alerts sent before a restart are honoured.
 * Crossings journalled before IB-143 carry no `eventAt`: they are placed in time order like new ones. The grouping
 * reads 65 min of crossings and acts on events of the last 35 min, so an event's opener is always in the read: a
 * read that starts mid-event can only misplace rows of an event older than any it acts on.
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
  /** Coin crossings journalled (`alert` rows, never sent by themselves). */
  alerts: number;
  /** First messages journalled (`event` rows), including small ones taken in by a larger event (IB-148). */
  events: number;
  /** Of those, taken in by a larger same-side event and not sent (L17 / L18). */
  merged: number;
  /** Event closes journalled (`event_continuing` rows), sent or not. */
  continuations: number;
  late: number;
  /** IB-151: crossings journalled muted by the coin's switch (never part of an event, never sent). */
  muted: number;
  sent: number;
  controls: number;
  /** L7, measured: DB round trips this tick, and the most prints held at once. */
  reads: number;
  maxPrints: number;
  /** Tape rows read this tick, summed over its chunks (IB-BUG-044's heartbeat). */
  prints: number;
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
/** L14: the crossings the event grouping reads — an event acted on (T0 within the boot look-back) and the one before it. */
export const EVENT_LOOKBACK_MS = BOOT_LOOKBACK_MS + EVENT_MAX_MS;

/** `on`: the coin's own switch; off only mutes (IB-151). */
interface Coin { symbol: string; base: string; thresholdUsd: number; on: boolean; venues: VenueSymbols; pairs: VenuePair[] }

/** A crossing found this tick, journalled once its event is known (a muted coin's: at once, with no event). */
interface Pending { coin: Coin; side: LiqSide; at: number; stats: ReturnType<typeof statsAt>; late: boolean }

/** IB-151: the journal rows a coin's own quiet period and near-miss exclusion see — a coin that is on, only unmuted ones. */
const ownRows = (on: boolean) => (j: JournalLiqRow): boolean => !on || !j.muted;
type Settings = Awaited<ReturnType<LiqAlertStore['settings']>>;

export class LiqAlertLoop {
  private cursor: number | null = null;
  private running = false;
  /**
   * L8: per `symbol|side|hour`, each chunk's best near-miss candidate (≤ 120 an hour). Kept as a list, not a
   * running max: a candidate can turn out to be the prelude of an alert found a tick later, and is then
   * dropped at the flush in favour of the hour's next best.
   */
  private readonly nearMisses = new Map<string, { symbol: string; side: LiqSide; thresholdUsd: number; on: boolean; hour: number; candidates: NearMissCandidate[] }>();
  /** Venue status, read at most once a tick and only when a row needs it. */
  private status: VenueStatus | null = null;

  constructor(private readonly ports: LiqAlertLoopPorts) {}

  /** One check (the service calls it every 30 s). Null when the previous tick is still running. */
  async tick(nowMs: number): Promise<LiqTickReport | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const from = this.cursor === null ? nowMs - BOOT_LOOKBACK_MS : Math.min(this.cursor, nowMs) - OVERLAP_MS;
      const report: LiqTickReport = { fromMs: from, toMs: nowMs, coins: 0, alerts: 0, events: 0, merged: 0, continuations: 0, late: 0, muted: 0, sent: 0, controls: 0, reads: 0, maxPrints: 0, prints: 0, failed: [] };
      this.status = null;
      const pending: Pending[] = [];
      const { store } = this.ports;
      const settings = await store.settings();
      const coins = this.coins(await store.listedCoins(), settings.params);
      report.reads += 2;
      report.coins = coins.length;
      for (let s = from; s < nowMs; s = Math.min(s + CHUNK_MS, nowMs)) {
        await this.evaluate(coins, settings, s, Math.min(s + CHUNK_MS, nowMs), nowMs, report, pending);
      }
      for (const p of pending.filter((q) => !q.coin.on)) {
        try {
          await this.journalAlert(p, null, settings, nowMs, report);
        } catch (error) {
          if (!report.failed.includes(p.coin.symbol)) report.failed.push(p.coin.symbol);
          this.ports.log?.warn(`liq alerts ${p.coin.symbol} (muted): ${(error as Error).message}`);
        }
      }
      await this.events(coins, settings, pending.filter((q) => q.coin.on), nowMs, report);
      await this.flushNearMisses(nowMs, settings.params, report);
      this.cursor = nowMs;
      return report;
    } finally {
      this.running = false;
    }
  }

  /** L4: enabled `alert_symbols` that have a threshold; switched off for liquidations = evaluated, muted (IB-151). */
  private coins(listed: ReadonlyArray<{ symbol: string; base: string }>, params: LiqParams): Coin[] {
    const out: Coin[] = [];
    for (const c of listed) {
      const p = params.perCoin[c.symbol];
      if (!p) continue; // no threshold: nothing to evaluate against
      const venues = venueSymbols(c.symbol, c.base, this.ports.universe);
      if (!venues) { this.ports.log?.warn(`liq alerts ${c.symbol}: base '${c.base}' names no USDT-linear contract — not evaluated`); continue; }
      out.push({ symbol: c.symbol, base: c.base, thresholdUsd: p.thresholdUsd, on: p.enabled, venues, pairs: venuePairs(venues) });
    }
    return out;
  }

  /** Candidate moments in (fromMs, toMs]. */
  private async evaluate(coins: readonly Coin[], settings: Settings, fromMs: number, toMs: number, nowMs: number, report: LiqTickReport, pending: Pending[]): Promise<void> {
    const { store, source } = this.ports;
    if (coins.length === 0) return;
    const bySymbol = new Map<string, string>(); // venue|venueSymbol → coin
    for (const c of coins) for (const p of c.pairs) bySymbol.set(`${p.venue}|${p.symbol}`, c.symbol);
    const prints = await store.prints(coins.flatMap((c) => c.pairs), fromMs - WINDOW_MS, toMs);
    const journal = await store.journal(source, fromMs - QUIET_MS - WINDOW_MS);
    report.reads += 2;
    report.maxPrints = Math.max(report.maxPrints, prints.length);
    report.prints += prints.length;
    for (const coin of coins) {
      try {
        const own = prints.filter((p) => bySymbol.get(`${p.venue}|${p.symbol}`) === coin.symbol);
        for (const side of LIQ_SIDES) {
          const sidePrints: LiqPrint[] = own.filter((p) => p.side === side).map((p) => ({ ts: p.ts, usd: p.usd, venue: p.venue }));
          const alertAts = journal.filter((j) => j.event === 'alert' && j.symbol === coin.symbol && j.side === side && ownRows(coin.on)(j)).map((j) => j.at)
            .concat(pending.filter((p) => p.coin.symbol === coin.symbol && p.side === side).map((p) => p.at));
          const scan = scanSide(sidePrints, fromMs, toMs, coin.thresholdUsd, alertAts);
          for (const crossing of scan.alerts) {
            pending.push({ coin, side, at: crossing.at, stats: crossing.stats, late: this.ports.source === 'live' && nowMs - crossing.at > LATE_MS });
          }
          for (const nm of scan.nearMisses.values()) {
            const key = `${coin.symbol}|${side}|${nm.hour}`;
            const bucket = this.nearMisses.get(key) ?? { symbol: coin.symbol, side, thresholdUsd: coin.thresholdUsd, on: coin.on, hour: nm.hour, candidates: [] };
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

  private async venueStatus(report: LiqTickReport): Promise<VenueStatus> {
    if (!this.status) { this.status = await this.ports.store.venueStatus(); report.reads++; }
    return this.status;
  }

  /** L10: the crossing's row, with its event's T0; never sent by itself. IB-151: a muted coin's has no event (`eventAt` null). */
  private async journalAlert(p: Pending, eventAt: number | null, settings: Settings, nowMs: number, report: LiqTickReport): Promise<void> {
    const { store, source, build } = this.ports;
    const windowStartMs = p.at - WINDOW_MS;
    const details: LiqAlertDetails = {
      side: p.side, windowStartMs, sumUsd: p.stats.sum, thresholdUsd: p.coin.thresholdUsd, byVenue: p.stats.byVenue, count: p.stats.count,
      largest: p.stats.largest, silentVenues: silentVenues(p.coin.venues, windowStartMs, p.at, await this.venueStatus(report)), binanceFootnote: false,
      ...(eventAt !== null ? { eventAt } : {}),
    };
    const dedupeKey = `liq:${p.coin.symbol}:${p.side}:${windowStartMs}`;
    const id = await store.insertAlert({
      source, event: 'alert', symbol: p.coin.symbol, atMs: p.at, details, params: settings.params, build, confirmedAtMs: nowMs, late: p.late,
      ...(p.coin.on ? { dedupeKey } : { dedupeKey: mutedDedupeKey(dedupeKey), mutedBy: 'coin' as const }),
    });
    if (id === null) return;
    report.alerts++;
    if (p.late) report.late++;
    if (!p.coin.on) report.muted++;
    await store.insertPaths({ marketAlertId: id }, p.coin.symbol, liqPathT0(p.at));
  }

  /**
   * L11–L14, both sides: places this tick's crossings in their events, journals them, and writes each event's
   * first message at S and its continuation at the close. The members' prints are read once, and only while some
   * event in the look-back is undecided.
   */
  private async events(coins: readonly Coin[], settings: Settings, pending: readonly Pending[], nowMs: number, report: LiqTickReport): Promise<void> {
    const { store, source } = this.ports;
    // IB-151: a muted row is never part of an event
    const journal = (await store.journal(source, nowMs - EVENT_LOOKBACK_MS)).filter((j) => j.at <= nowMs && !j.muted);
    report.reads++;

    const sides = LIQ_SIDES.map((side) => this.sideState(side, journal, pending));
    const need = sides.flatMap((x) => x.need);
    if (need.length === 0) return; // a new crossing is always in `need` (no eventAt yet)
    const symbols = new Set(need.map((r) => r.symbol));
    const fromMs = Math.min(...need.map((r) => r.eventAt ?? r.at)) - WINDOW_MS;
    const pairs = coins.filter((c) => symbols.has(c.symbol)).flatMap((c) => c.pairs);
    const bySymbol = new Map<string, string>();
    for (const c of coins) for (const p of c.pairs) bySymbol.set(`${p.venue}|${p.symbol}`, c.symbol);
    const tape: TapePrint[] = await store.prints(pairs, fromMs, nowMs);
    report.reads++;
    report.maxPrints = Math.max(report.maxPrints, tape.length);
    report.prints += tape.length;

    for (const x of sides) {
      const prints: SidePrint[] = [];
      const times = new Map<string, number[]>();
      for (const p of tape) {
        const symbol = bySymbol.get(`${p.venue}|${p.symbol}`);
        if (p.side !== x.side || symbol === undefined) continue;
        prints.push({ symbol, ts: p.ts, usd: p.usd, venue: p.venue });
        const list = times.get(symbol) ?? [];
        list.push(p.ts);
        times.set(symbol, list);
      }
      const grouped = groupEvents(x.rows, times, nowMs, x.decided);
      for (const event of grouped) {
        try {
          await this.actOn(event, grouped, x, prints, coins, settings, nowMs, report);
        } catch (error) {
          const tag = `${x.side}@${new Date(event.t0).toISOString()}`;
          if (!report.failed.includes(tag)) report.failed.push(tag);
          this.ports.log?.warn(`liq alerts event ${tag}: ${(error as Error).message}`);
        }
      }
    }
  }

  /** One side's crossings, decisions and new crossings, as the grouping needs them. */
  private sideState(side: LiqSide, journal: readonly JournalLiqRow[], pending: readonly Pending[]) {
    const own = journal.filter((j) => j.side === side);
    const decided = new Map<number, DecidedEvent>();
    for (const j of own) {
      if (j.eventAt === null) continue;
      const d = decided.get(j.eventAt) ?? {};
      if (j.event === 'event' && j.sentAt !== null && j.settled !== null) {
        d.first = { id: j.id, sentAt: j.sentAt, settled: j.settled, coins: j.coins, late: j.late, totalUsd: j.totalUsd ?? 0, mergedInto: j.mergedInto?.eventAt ?? null };
      }
      if (j.event === 'event_continuing') d.close = { closedAt: j.at, totalUsd: j.totalUsd ?? 0 };
      decided.set(j.eventAt, d);
    }
    // IB-148: the closed events a small one may be absorbed into (L17), and the small ones folded into each event (L18)
    const closed: ClosedEvent[] = [];
    for (const [t0, d] of decided) {
      if (!d.first || d.first.mergedInto !== null) continue;
      if (d.first.settled === 'quiet') closed.push({ t0, closeAt: d.first.sentAt, totalUsd: d.first.totalUsd });
      else if (d.close) closed.push({ t0, closeAt: d.close.closedAt, totalUsd: d.close.totalUsd });
    }
    const mergedBefore = new Map<number, NonNullable<LiqEventDetails['merged']>>();
    for (const j of own) {
      if (j.event !== 'event' || j.mergedInto?.how !== 'before' || j.eventAt === null) continue;
      mergedBefore.set(j.mergedInto.eventAt, [...(mergedBefore.get(j.mergedInto.eventAt) ?? []), { symbol: j.symbol, eventAt: j.eventAt, sumUsd: j.totalUsd ?? 0, how: 'before' }]);
    }
    const alerts = own.filter((j) => j.event === 'alert');
    const newOnes = pending.filter((p) => p.side === side);
    const rows: CrossingRow[] = [
      ...alerts.map((j) => ({ key: `id:${j.id}`, symbol: j.symbol, at: j.at, eventAt: j.eventAt })),
      ...newOnes.map((p) => ({ key: `new:${p.coin.symbol}:${p.at}`, symbol: p.coin.symbol, at: p.at, eventAt: null })),
    ];
    const final = (t0: number): boolean => {
      const d = decided.get(t0);
      return d?.first?.settled === 'quiet' || d?.close !== undefined || (d?.first !== undefined && d.first.mergedInto !== null);
    };
    return {
      side, rows, decided, alerts, pending: newOnes, closed, mergedBefore,
      need: rows.filter((r) => r.eventAt === null || !final(r.eventAt)),
      threshold: new Map<string, number>([...alerts.map((j) => [j.symbol, j.thresholdUsd] as const), ...newOnes.map((p) => [p.coin.symbol, p.coin.thresholdUsd] as const)]),
      late: new Map<string, boolean>([...alerts.map((j) => [`id:${j.id}`, j.late] as const), ...newOnes.map((p) => [`new:${p.coin.symbol}:${p.at}`, p.late] as const)]),
    };
  }

  private async actOn(
    event: LiqEvent, grouped: readonly LiqEvent[], x: ReturnType<LiqAlertLoop['sideState']>, prints: readonly SidePrint[], coins: readonly Coin[],
    settings: Settings, nowMs: number, report: LiqTickReport,
  ): Promise<void> {
    const { store, source, build } = this.ports;
    for (const m of event.members) {
      if (m.key.startsWith('new:')) {
        const p = x.pending.find((q) => `new:${q.coin.symbol}:${q.at}` === m.key) as Pending;
        await this.journalAlert(p, event.t0, settings, nowMs, report);
      }
    }
    if (event.t0 <= nowMs - BOOT_LOOKBACK_MS) return; // older than any boot look-back: decided before, or never
    const decided = x.decided.get(event.t0) ?? {};
    const lateT0 = source === 'live' && x.late.get(event.members[0]?.key ?? '') === true;
    const thresholdOf = (symbol: string): number => x.threshold.get(symbol) ?? coins.find((c) => c.symbol === symbol)?.thresholdUsd ?? NaN;
    const coinOf = (symbol: string): Coin | undefined => coins.find((c) => c.symbol === symbol);

    let first = decided.first;
    if (!first && event.s) {
      const sAt = event.s.at;
      const members = event.members.filter((m) => m.at < sAt);
      const sums = eventSums(members, prints, sAt);
      // IB-148 (L16–L18): a small event is absorbed after a large close, or held for one that opens after it
      let mergedInto: LiqEventDetails['mergedInto'];
      let heldUntil: number | undefined;
      if (isSmall(sums.coins.map((c) => ({ sumUsd: c.sumUsd, thresholdUsd: thresholdOf(c.symbol) })))) {
        const after = absorbedAfter(event.t0, sums.totalUsd, x.closed);
        if (after) mergedInto = { eventAt: after.t0, how: 'after' };
        else {
          const hold = holdDecision(sAt, sums.totalUsd, this.following(event, sAt, grouped, x, prints), nowMs);
          if (hold.kind === 'wait') return;
          if (hold.kind === 'fold') mergedInto = { eventAt: hold.into, how: 'before' };
          else heldUntil = hold.dueAt;
        }
      }
      const late = source === 'live' && (lateT0 || nowMs - (heldUntil ?? sAt) > LATE_MS);
      const sending = source === 'live' && settings.enabled && !late && mergedInto === undefined;
      const binanceFootnote = sending && !(await store.footnoteSent(dayStartOf(nowMs)));
      const merged = x.mergedBefore.get(event.t0);
      const details: LiqEventDetails = {
        side: x.side, eventAt: event.t0, sentAt: sAt, settled: event.s.by, coins: await this.eventCoins(sums.coins, sAt, coins, thresholdOf, report),
        totalUsd: sums.totalUsd, count: sums.count, largest: sums.largest, binanceFootnote,
        ...(heldUntil !== undefined ? { heldUntil } : {}), ...(mergedInto ? { mergedInto } : {}), ...(merged ? { merged } : {}),
      };
      const link = sums.coins[0] as CoinSum;
      const id = await store.insertAlert({
        source, event: 'event', symbol: link.symbol, atMs: event.s.at, details, params: settings.params, build, confirmedAtMs: nowMs, late,
        dedupeKey: `liq-ev:${x.side}:${event.t0}`,
      });
      if (id === null) return; // written by an overlapping tick: the next tick reads it from the journal
      report.events++;
      if (late) report.late++;
      first = { id, sentAt: sAt, settled: event.s.by, coins: sums.coins.map((c) => c.symbol), late, totalUsd: sums.totalUsd, mergedInto: mergedInto?.eventAt ?? null };
      x.decided.set(event.t0, { ...decided, first });
      if (mergedInto) {
        report.merged++;
        if (mergedInto.how === 'before') {
          x.mergedBefore.set(mergedInto.eventAt, [...(x.mergedBefore.get(mergedInto.eventAt) ?? []), { symbol: link.symbol, eventAt: event.t0, sumUsd: sums.totalUsd, how: 'before' }]);
        }
        return; // L17 / L18: the row closes it; no message, no continuation
      }
      if (event.s.by === 'quiet') x.closed.push({ t0: event.t0, closeAt: sAt, totalUsd: sums.totalUsd });
      if (sending) report.sent += await this.deliver(id, liqEvent({ side: x.side, details, baseOf: (s) => coinOf(s)?.base ?? s }, this.ports.webBaseUrl), nowMs);
    }
    if (!first || first.settled !== 'cap' || first.mergedInto !== null || decided.close || !event.close) return;

    const close = event.close;
    const members = event.members.filter((m) => m.at < close.at);
    const sums = eventSums(members, prints, close.at);
    const news = continuationNews(members, first.coins, prints, first.sentAt, close.at, thresholdOf);
    const isNews = news.newCoins.length + news.addedCoins.length > 0;
    const late = source === 'live' && (first.late || nowMs - close.at > LATE_MS);
    const sending = source === 'live' && settings.enabled && !late && isNews;
    const binanceFootnote = sending && !(await store.footnoteSent(dayStartOf(nowMs)));
    const details: LiqEventContinuingDetails = {
      side: x.side, eventAt: event.t0, sentAt: first.sentAt, coins: await this.eventCoins(sums.coins, close.at, coins, thresholdOf, report),
      totalUsd: sums.totalUsd, count: sums.count, largest: sums.largest, binanceFootnote,
      closedAt: close.at, closedBy: close.by === 'cap' ? 'max' : 'quiet', firstMessageId: first.id, ...news, news: isNews,
    };
    const id = await store.insertAlert({
      source, event: 'event_continuing', symbol: (sums.coins[0] as CoinSum).symbol, atMs: close.at, details, params: settings.params, build,
      confirmedAtMs: nowMs, late, dedupeKey: `liq-ev-cont:${x.side}:${event.t0}`,
    });
    if (id === null) return;
    report.continuations++;
    x.closed.push({ t0: event.t0, closeAt: close.at, totalUsd: sums.totalUsd });
    if (late) report.late++;
    if (sending) report.sent += await this.deliver(id, liqEventContinuation({ side: x.side, details, baseOf: (s) => coinOf(s)?.base ?? s }, this.ports.webBaseUrl), nowMs);
  }

  /**
   * L18: the first same-side event opening during the hold of a small event settled at `sAt` (T0 in (S, S + 120 s]),
   * with its total at its own S once reached; null when none has opened.
   */
  private following(event: LiqEvent, sAt: number, grouped: readonly LiqEvent[], x: ReturnType<LiqAlertLoop['sideState']>, prints: readonly SidePrint[]): FollowingEvent | null {
    const next = grouped.find((e) => e !== event && opensDuringHold(sAt, e.t0));
    if (!next) return null;
    const written = x.decided.get(next.t0)?.first;
    if (written) return { t0: next.t0, sAt: written.sentAt, totalUsd: written.totalUsd, written: true };
    if (!next.s) return { t0: next.t0, sAt: null, totalUsd: null, written: false };
    const nextS = next.s.at;
    return { t0: next.t0, sAt: nextS, totalUsd: eventSums(next.members.filter((m) => m.at < nextS), prints, nextS).totalUsd, written: false };
  }

  /** L12's per-coin details: the sums plus each coin's threshold and the venues that could not report. */
  private async eventCoins(sums: readonly CoinSum[], untilMs: number, coins: readonly Coin[], thresholdOf: (s: string) => number, report: LiqTickReport): Promise<LiqEventCoin[]> {
    const out: LiqEventCoin[] = [];
    for (const c of sums) {
      const venues = coins.find((k) => k.symbol === c.symbol)?.venues;
      out.push({
        ...c, thresholdUsd: thresholdOf(c.symbol),
        silentVenues: venues ? silentVenues(venues, c.windowStartMs, untilMs, await this.venueStatus(report)) : [],
      });
    }
    return out;
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
      const alertAts = journal.filter((j) => j.event === 'alert' && j.symbol === b.symbol && j.side === b.side && ownRows(b.on)(j)).map((j) => j.at);
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

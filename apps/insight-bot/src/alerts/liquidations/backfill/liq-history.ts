import { LIQ_DEFAULT_PARAMS, LIQ_TICK_SEC, type LiqAlertEvent, type LiqParams, type LiqSide, type LiqSilentReason } from '@trade-automation/contracts';
import { BOOT_LOOKBACK_MS, LiqAlertLoop, type LiqTickReport } from '../liq-alert-loop';
import { journalRow, type JournalLiqRow, type LiqAlertStore, type LiqSettings, type NewMarketAlert, type NewMarketControl } from '../pg/liq-alerts.repo';
import type { UniverseSpelling } from '../venue-symbols';

/**
 * IB-123 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §2 L9, §1 C4) — the large-liquidation
 * history run. **The live loop's own code** (`LiqAlertLoop.tick`, at the live cadence, 10 s since IB-143) is driven over the
 * stored tape with `source = 'backfill'`, so it is never late and never sends (the loop gates both on
 * `source === 'live'`; the send port here throws if it is reached anyway).
 *
 * Only two things differ from live, both in the store the loop is handed (`historyStore`):
 * - the settings are frozen for the run: L4's defaults (× a multiplier for the ½× / 2× counts), sending off.
 *   Pinned to the contracts' defaults, not the admin page's current params, so a rerun after the owner edits a
 *   threshold still writes 0 rows (the once-keys hold only for the same crossings);
 * - collector gaps are read from the run's start, not "the last day": a window with a gap is still counted,
 *   and `details.silentVenues` names the venue (`stream_silent`), as live would have said at the time.
 *
 * Two kinds of run share the driver (`replayLiq`):
 * - **the write (or its dry run)**: ×1 into the real tables, the once-keys and checks of migration 031;
 * - **the counts**: ×½, ×1, ×2 into a journal kept in memory (`MemoryJournalStore`). The tape is read from the
 *   database, nothing is written. In-memory, because the dedupe key is the window start and the quiet periods
 *   come from the journal: a ½× replay against a database that already holds the ×1 rows would see the ×1
 *   alerts as its own and undercount.
 */
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
export const TICK_MS = LIQ_TICK_SEC * 1_000;
/** The thresholds the owner sees counts at (the row: «по умолчанию, ×½ и ×2»). */
export const LIQ_HISTORY_MULTIPLIERS = [0.5, 1, 2] as const;

/** Every coin's threshold × k; on/off unchanged. */
export function scaleParams(params: LiqParams, k: number): LiqParams {
  return { perCoin: Object.fromEntries(Object.entries(params.perCoin).map(([s, p]) => [s, { ...p, thresholdUsd: p.thresholdUsd * k }])) };
}

/**
 * The first complete UTC day of the tape: the day after the LAST of the three liquidation streams started
 * (heartbeat `first_seen_at`). A day on which any venue began collecting mid-way is not complete. Null when a
 * stream has never been seen.
 */
export function firstFullDay(streamStarts: ReadonlyArray<number | null>): number | null {
  if (streamStarts.length === 0 || streamStarts.some((s) => s === null)) return null;
  const last = Math.max(...(streamStarts as number[]));
  return Math.ceil(last / DAY_MS) * DAY_MS;
}

/** The store as the loop sees it in a history run: frozen settings, gaps from the run's start. */
export function historyStore(base: LiqAlertStore, opts: { params: LiqParams; gapsSinceMs: number }): LiqAlertStore {
  const settings: LiqSettings = { enabled: false, membersVisible: false, params: opts.params, updatedAt: 0 };
  return {
    settings: async () => settings,
    listedCoins: () => base.listedCoins(),
    prints: (...a) => base.prints(...a),
    journal: (...a) => base.journal(...a),
    venueStatus: () => base.venueStatus(opts.gapsSinceMs),
    insertAlert: (x) => base.insertAlert(x),
    insertControl: (x) => base.insertControl(x),
    insertPaths: (...a) => base.insertPaths(...a),
    recipients: async () => [],
    markFired: async () => { throw new Error('the history run never sends'); },
    footnoteSent: async () => false,
  };
}

/** A journalled row as the counts need it. */
export interface CountedAlert {
  event: LiqAlertEvent;
  symbol: string;
  side: LiqSide;
  atMs: number;
  sumUsd: number;
  thresholdUsd: number;
  /** Venues named as having no data in the window (alerts only). */
  silent: Array<{ venue: string; reason: LiqSilentReason }>;
}

/**
 * The tape from `base`, the journal in memory, with migration 031's once-keys (source, type, dedupe_key).
 * Paths are counted, not kept.
 */
export class MemoryJournalStore implements LiqAlertStore {
  readonly alerts: Array<CountedAlert & { id: number; source: string; dedupeKey: string; late: boolean; details: Record<string, unknown>; muted: boolean }> = [];
  readonly controls: Array<{ id: number; kind: string; symbol: string; atMs: number; dedupeKey: string; source: string }> = [];
  paths = 0;
  private nextId = 1;

  constructor(private readonly base: LiqAlertStore) {}

  settings(): Promise<LiqSettings> { return this.base.settings(); }
  listedCoins(): ReturnType<LiqAlertStore['listedCoins']> { return this.base.listedCoins(); }
  prints(...a: Parameters<LiqAlertStore['prints']>): ReturnType<LiqAlertStore['prints']> { return this.base.prints(...a); }
  venueStatus(gapsSinceMs?: number): ReturnType<LiqAlertStore['venueStatus']> { return this.base.venueStatus(gapsSinceMs); }

  async journal(source: 'live' | 'backfill', sinceMs: number): Promise<JournalLiqRow[]> {
    return this.alerts.filter((a) => a.source === source && a.atMs > sinceMs).sort((a, b) => a.atMs - b.atMs || a.id - b.id)
      .map((a) => journalRow({ id: a.id, event: a.event, symbol: a.symbol, atMs: a.atMs, late: a.late, details: a.details, muted: a.muted }));
  }

  async insertAlert(x: NewMarketAlert): Promise<number | null> {
    if (this.alerts.some((a) => a.source === x.source && a.dedupeKey === x.dedupeKey)) return null;
    const d = x.details;
    const id = this.nextId++;
    this.alerts.push({
      id, source: x.source, dedupeKey: x.dedupeKey, event: x.event, symbol: x.symbol, atMs: x.atMs, side: d.side as LiqSide, late: x.late, details: d, muted: x.mutedBy !== undefined,
      sumUsd: Number(d.sumUsd ?? d.totalUsd), thresholdUsd: Number(d.thresholdUsd ?? NaN),
      silent: Array.isArray(d.silentVenues) ? (d.silentVenues as CountedAlert['silent']) : [],
    });
    return id;
  }

  async insertControl(x: NewMarketControl): Promise<number | null> {
    if (this.controls.some((c) => c.source === x.source && c.dedupeKey === x.dedupeKey)) return null;
    const id = this.nextId++;
    this.controls.push({ id, kind: x.kind, symbol: x.symbol, atMs: x.atMs, dedupeKey: x.dedupeKey, source: x.source });
    return id;
  }

  async insertPaths(): Promise<void> { this.paths += 1; }
  async recipients(): Promise<Array<{ chatId: number; lang: 'ru' | 'en' }>> { return []; }
  async markFired(): Promise<void> { throw new Error('the history run never sends'); }
  async footnoteSent(): Promise<boolean> { return false; }
}

export interface LiqReplayPorts {
  /** Already wrapped by `historyStore`. */
  store: LiqAlertStore;
  universe: readonly UniverseSpelling[];
  build: string;
  log?: (line: string) => void;
  /** Called before every hour of tape (the memory guard, IB-116). */
  beforeHour?: (label: string) => Promise<void>;
}

export interface LiqReplayTotals {
  fromMs: number;
  toMs: number;
  ticks: number;
  /** Coin crossings (`alert` rows). */
  alerts: number;
  /** First messages (`event` rows) and event closes (`event_continuing`, sent or not). */
  events: number;
  continuations: number;
  controls: number;
  reads: number;
  maxPrints: number;
  /** The loop's warnings (a failed coin-tick, an unmappable coin), each with how often it came; any → exit 1. */
  warnings: Record<string, number>;
}

/**
 * Evaluates every moment in (fromMs, toMs] with the live loop, ticking every LIQ_TICK_SEC as live does. The first tick
 * is the loop's boot tick, whose look-back (`BOOT_LOOKBACK_MS`) is placed to start exactly at `fromMs`.
 */
export async function replayLiq(ports: LiqReplayPorts, fromMs: number, toMs: number): Promise<LiqReplayTotals> {
  if (toMs - fromMs < BOOT_LOOKBACK_MS) throw new Error(`the history run needs at least ${BOOT_LOOKBACK_MS / 60_000} min of tape`);
  const warnings: Record<string, number> = {};
  const loop = new LiqAlertLoop({
    store: ports.store, universe: ports.universe, build: ports.build, source: 'backfill', webBaseUrl: '',
    send: async () => { throw new Error('the history run never sends'); },
    log: { warn: (m) => { if (!(m in warnings)) ports.log?.(m); warnings[m] = (warnings[m] ?? 0) + 1; } },
  });
  const out: LiqReplayTotals = { fromMs, toMs, ticks: 0, alerts: 0, events: 0, continuations: 0, controls: 0, reads: 0, maxPrints: 0, warnings };
  let nextHour = fromMs;
  for (let now = fromMs + BOOT_LOOKBACK_MS; ; now = Math.min(now + TICK_MS, toMs)) {
    if (now >= nextHour) {
      await ports.beforeHour?.(`tape at ${new Date(now).toISOString()}`);
      nextHour = Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS;
    }
    const r = (await loop.tick(now)) as LiqTickReport; // sequential: never null
    out.ticks++;
    out.alerts += r.alerts;
    out.events += r.events;
    out.continuations += r.continuations;
    out.controls += r.controls;
    out.reads += r.reads;
    out.maxPrints = Math.max(out.maxPrints, r.maxPrints);
    if (now >= toMs) break;
  }
  return out;
}

/** One row of the owner's table: a coin at one multiplier. */
export interface LiqCountRow {
  symbol: string;
  multiplier: number;
  thresholdUsd: number;
  alerts: number;
  longs: number;
  shorts: number;
  /** Event closes (`event_continuing`) this coin was the link coin of — journalled, sent or not. */
  continuations: number;
  /** Alerts whose window had a venue named as silent (`stream_silent`: a collector gap or a stale heartbeat). */
  withGap: number;
  /** Alerts with a venue not collected for that coin (TRX on Bybit/OKX before L5). */
  notCollected: number;
  perWeek: number;
  continuationsPerWeek: number;
}

/** Per coin, from one in-memory replay. `days` = the replayed span in days. */
export function countRows(store: MemoryJournalStore, params: LiqParams, multiplier: number, days: number): LiqCountRow[] {
  const week = (n: number) => Math.round((n / days) * 7 * 10) / 10;
  return Object.entries(params.perCoin).filter(([, p]) => p.enabled).map(([symbol, p]) => {
    const own = store.alerts.filter((a) => a.symbol === symbol);
    const alerts = own.filter((a) => a.event === 'alert');
    const continuations = own.filter((a) => a.event === 'event_continuing').length;
    return {
      symbol, multiplier, thresholdUsd: p.thresholdUsd, alerts: alerts.length,
      longs: alerts.filter((a) => a.side === 'long').length, shorts: alerts.filter((a) => a.side === 'short').length,
      continuations,
      withGap: alerts.filter((a) => a.silent.some((s) => s.reason === 'stream_silent')).length,
      notCollected: alerts.filter((a) => a.silent.some((s) => s.reason === 'not_collected')).length,
      perWeek: week(alerts.length), continuationsPerWeek: week(continuations),
    };
  });
}

/** The pinned base of every history run (see the module comment). */
export const LIQ_HISTORY_PARAMS: LiqParams = LIQ_DEFAULT_PARAMS;

/**
 * The ×1 in-memory count against the backfill rows the database holds for the same range. Not against the
 * rows THIS run wrote: a rerun writes 0 and still holds every row (the 2026-11-11 check is a rerun). IB-122's
 * per-coin `continuing` rows are not compared: IB-143 no longer writes them, and the database keeps the old ones.
 * Null when they agree, else the disagreement.
 */
export function crossCheck(memory: { alerts: number; events: number; continuations: number; controls: number }, stored: Record<string, number>): string | null {
  const db = {
    alerts: stored.alerts ?? 0, events: stored.events ?? 0, continuations: stored.event_continuations ?? 0,
    controls: (stored.controls_random ?? 0) + (stored.controls_near_miss ?? 0),
  };
  const f = (x: typeof db) => `${x.alerts}/${x.events}/${x.continuations}/${x.controls}`;
  return f(memory) === f(db) ? null : `the in-memory ×1 replay (${f(memory)}) differs from the backfill rows stored (${f(db)})`;
}

/** L15 (IB-143): one replayed event as the report needs it, from an in-memory journal. */
export interface ReplayedEvent {
  side: LiqSide;
  t0: number;
  sentAt: number;
  settled: 'quiet' | 'cap';
  /** The first message's coins, largest first, with their sums. */
  first: Array<{ symbol: string; sumUsd: number }>;
  firstTotalUsd: number;
  /** IB-148 (L17 / L18): taken in by the same-side event with this T0, and how; not a message of its own. */
  mergedInto: null | { eventAt: number; how: 'after' | 'before' };
  /** L18: a small event held after S and then sent: the added latency (heldUntil − S), ms; 0 when not held. */
  heldMs: number;
  /** L19: the small events this one took in (its text's «Перед этим» lines). */
  merged: Array<{ symbol: string; eventAt: number; sumUsd: number; how: string }>;
  continuation: null | { at: number; closedBy: string; news: boolean; newCoins: string[]; addedCoins: string[]; totalUsd: number };
  /** L15's check: a continuation is never dated before its first message. */
  continuationNotBeforeFirst: boolean;
}

/** L15 / L20: the messages a replay would have sent — first messages not taken in by another (IB-148), plus news closes. */
export function messageCount(events: readonly ReplayedEvent[]): number {
  return events.filter((e) => e.mergedInto === null).length + events.filter((e) => e.continuation?.news).length;
}

export function replayedEvents(store: MemoryJournalStore): ReplayedEvent[] {
  const conts = store.alerts.filter((a) => a.event === 'event_continuing');
  return store.alerts.filter((a) => a.event === 'event').sort((a, b) => a.atMs - b.atMs).map((e) => {
    const d = e.details as {
      eventAt: number; sentAt: number; settled: 'quiet' | 'cap'; totalUsd: number; coins: Array<{ symbol: string; sumUsd: number }>;
      heldUntil?: number; mergedInto?: ReplayedEvent['mergedInto']; merged?: ReplayedEvent['merged'];
    };
    const c = conts.find((x) => x.side === e.side && (x.details as { eventAt: number }).eventAt === d.eventAt);
    const cd = c?.details as undefined | { closedBy: string; news: boolean; newCoins: string[]; addedCoins: string[]; totalUsd: number };
    return {
      side: e.side, t0: d.eventAt, sentAt: d.sentAt, settled: d.settled, first: d.coins.map((x) => ({ symbol: x.symbol, sumUsd: x.sumUsd })),
      firstTotalUsd: d.totalUsd,
      mergedInto: d.mergedInto ?? null, heldMs: d.heldUntil === undefined ? 0 : d.heldUntil - d.sentAt, merged: d.merged ?? [],
      continuation: c && cd ? { at: c.atMs, closedBy: cd.closedBy, news: cd.news, newCoins: cd.newCoins, addedCoins: cd.addedCoins, totalUsd: cd.totalUsd } : null,
      continuationNotBeforeFirst: !c || c.atMs >= e.atMs,
    };
  });
}

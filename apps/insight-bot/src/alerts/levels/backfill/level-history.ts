import {
  LEVEL_BAR_SEC, LEVEL_DAILY_BARS, LEVEL_DAILY_KINDS, LEVEL_DEFAULT_PARAMS, LEVEL_EVENTS, LEVEL_KINDS, LEVEL_SETTLE_SEC, LEVEL_TOUCH_BAND_DEFAULT,
  type LevelBar, type LevelEvent, type LevelKind, type LevelParams, type MarketAlertSource, type WebCandle,
} from '@trade-automation/contracts';
import { klinesWeight } from '../../../news/reaction-prices';
import { LevelAlertLoop, type LevelTickReport, type LevelVenuePort } from '../level-alert-loop';
import {
  stateKey, type LevelAlertStore, type LevelCommit, type LevelSettings, type LevelStateRow, type NewLevelControl,
} from '../pg/level-alerts.repo';

/**
 * IB-127 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §4 P8, §1 C4) — the level history run.
 * **The live loop's own code** (`LevelAlertLoop.tick`, once a minute 5 s past it as live, with `levelStep`,
 * `seedState` and the shared `levelsInForce` inside it) is driven over Binance's 15m and 1d klines with
 * `source = 'backfill'`. The loop sends only when `source === 'live'`; the run's send and `markFired` also throw.
 *
 * **P10's state is built as live builds it**: the replay starts with no state rows, so the first minutes seed each
 * coin (one a minute) from its period's 15m bars, from the period start; every later period starts fresh at its
 * first bar. Crossunder/crossover therefore see exactly what a live loop started at the replay's first bar would.
 *
 * **The venue as the loop sees it at `now`** (`HistoryLevelVenue`): 15m bars that had CLOSED by `now`, and the 1d
 * bars up to the current UTC day, whose forming bar carries only its OPEN (high = low = close = open). Live reads the
 * forming bar at the day's first evaluation, with almost nothing in it; `levelsInForce` uses only a forming bar's
 * open (the weekly or monthly open on a Monday or a 1st), never its high or low. A spec pins that.
 *
 * Only the store differs from live (`levelHistoryStore`):
 * - settings frozen for the run: the shipped `LEVEL_DEFAULT_PARAMS` for the rows written (PDH/PDL off, every event
 *   on, touch band 0.1 %), sending off. Pinned, so a rerun after the owner edits a setting still writes 0 rows;
 * - the coin list frozen at the start;
 * - P10's rows kept IN MEMORY (with live's rollover deletion): `alert_level_state` gets no backfill rows, the
 *   live loop never reads them, and ≈ 130 000 minutes × 5 coins would otherwise be state writes on the box. An
 *   alert goes through the repo's own `commit` (states empty), a control `insertControl`, a path `insertPaths`:
 *   the real SQL, once-keys and constraints, so a rerun writes 0.
 *
 * The counts (PDH/PDL on for every coin, touch band ×½ / ×1 / ×2) replay into `MemoryLevelJournal`; the ×1 count
 * without PDH/PDL is cross-checked against the backfill rows the database holds. The events (P3) have no threshold:
 * the band changes touches only.
 */
export const BAR_MS = LEVEL_BAR_SEC * 1_000;
export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
/** P8: the span the counts cover. */
export const LEVEL_HISTORY_DAYS = 90;
/** The touch bands the owner sees counts at («по умолчанию, ×½ и ×2»). */
export const LEVEL_HISTORY_BAND_MULTIPLIERS = [0.5, 1, 2] as const;
/** `/fapi/v1/klines`' page: 1 500 bars at weight 10. */
export const LEVEL_HISTORY_PAGE = 1_500;

/**
 * The params of a run. `daily = false` and ×1 is the shipped default as it is (`perCoin` empty), so the written
 * rows record what live records; otherwise every coin is named, with PDH/PDL on when `daily`.
 */
export function levelHistoryParams(symbols: readonly string[], bandMultiplier: number, daily: boolean): LevelParams {
  if (bandMultiplier === 1 && !daily) return LEVEL_DEFAULT_PARAMS;
  return {
    ...LEVEL_DEFAULT_PARAMS, touchBand: LEVEL_TOUCH_BAND_DEFAULT * bandMultiplier,
    perCoin: Object.fromEntries(symbols.map((s) => [s, { enabled: true, daily }])),
  };
}

/** The index of the first bar with `openMs >= t` (bars ascending). */
function firstAtOrAfter(bars: readonly { openMs: number }[], t: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((bars[mid] as { openMs: number }).openMs >= t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The venue as the replay sees it at `now` (set by the driver before each tick). */
export class HistoryLevelVenue implements LevelVenuePort {
  now = 0;
  calls = 0;
  private readonly dailyByTime = new Map<string, Map<number, WebCandle>>();

  /** `bars`: 15m per coin, oldest first; `daily`: 1d per coin (closed days; the forming one may be absent). */
  constructor(private readonly bars: ReadonlyMap<string, readonly LevelBar[]>, daily: ReadonlyMap<string, readonly WebCandle[]>) {
    for (const [s, ds] of daily) this.dailyByTime.set(s, new Map(ds.map((d) => [d.time * 1000, d])));
  }

  /** At most `limit` bars from `fromMs` that had closed by `now`, oldest first (live: `closedKlines`). */
  async bars15m(symbol: string, fromMs: number, limit: number): Promise<LevelBar[]> {
    this.calls++;
    const all = this.of(symbol);
    const out: LevelBar[] = [];
    for (let i = firstAtOrAfter(all, fromMs); i < all.length && out.length < limit; i++) {
      const b = all[i] as LevelBar;
      if (b.openMs >= fromMs + limit * BAR_MS || b.openMs + BAR_MS > this.now) break;
      out.push({ ...b });
    }
    return out;
  }

  /**
   * The `LEVEL_DAILY_BARS` days up to and including `dayStartMs`'s, oldest first. The forming day (`dayStartMs`)
   * carries only its open: the 1d bar's when fetched, else its first 15m bar's (the same price on Binance). A day
   * after `now`'s never appears.
   */
  async daily(symbol: string, dayStartMs: number): Promise<WebCandle[]> {
    this.calls++;
    const days = this.dailyByTime.get(symbol);
    if (!days) throw new Error(`level history ${symbol}: no 1d bars fetched`);
    const today = Math.min(dayStartMs, Math.floor(this.now / DAY_MS) * DAY_MS);
    const out: WebCandle[] = [];
    for (let t = today - (LEVEL_DAILY_BARS - 1) * DAY_MS; t < today; t += DAY_MS) {
      const d = days.get(t);
      if (d) out.push({ ...d });
    }
    const open = days.get(today)?.open ?? this.firstBarOpen(symbol, today);
    if (open !== null) out.push({ time: today / 1000, open, high: open, low: open, close: open, volume: 0 });
    return out;
  }

  private firstBarOpen(symbol: string, dayStartMs: number): number | null {
    const all = this.of(symbol);
    const b = all[firstAtOrAfter(all, dayStartMs)];
    return b && b.openMs === dayStartMs && b.openMs < this.now ? b.open : null;
  }

  private of(symbol: string): readonly LevelBar[] {
    const b = this.bars.get(symbol);
    if (!b) throw new Error(`level history ${symbol}: no 15m bars fetched`);
    return b;
  }
}

/** The store as the loop sees it in a history run (see the module comment). */
export function levelHistoryStore(
  base: LevelAlertStore, opts: { params: LevelParams; coins: ReadonlyArray<{ symbol: string; base: string }> },
): LevelAlertStore {
  const settings: LevelSettings = { enabled: false, membersVisible: false, params: opts.params, updatedAt: 0 };
  const rows = new Map<string, LevelStateRow & { symbol: string }>();
  return {
    settings: async () => settings,
    listedCoins: async () => opts.coins.map((c) => ({ ...c })),
    states: async () => new Map(rows),
    commit: async (x: LevelCommit) => {
      const ids = x.alerts.length > 0 ? await base.commit({ ...x, states: [] }) : [];
      for (const r of x.states) {
        // as the repo: writing a period's row deletes the same level's rows of earlier periods
        for (const [k, v] of rows) if (v.symbol === x.symbol && v.kind === r.kind && v.periodStartMs < r.periodStartMs) rows.delete(k);
        rows.set(stateKey(x.symbol, r.kind, r.periodStartMs), { ...r, state: { ...r.state }, symbol: x.symbol });
      }
      return ids;
    },
    insertControl: (...a) => base.insertControl(...a),
    insertPaths: (...a) => base.insertPaths(...a),
    recipients: async () => [],
    markFired: async () => { throw new Error('the history run never sends'); },
  };
}

/** A journalled alert as the counts and the report need it. */
export interface CountedLevelAlert {
  id: number;
  event: LevelEvent;
  symbol: string;
  kind: LevelKind;
  price: number;
  atMs: number;
  dedupeKey: string;
  details: Record<string, unknown>;
}

/** Alerts and controls in memory with migration 031's once-keys (source, type, dedupe_key); paths counted. */
export class MemoryLevelJournal implements LevelAlertStore {
  readonly alerts: CountedLevelAlert[] = [];
  readonly controls: Array<NewLevelControl & { id: number }> = [];
  paths = 0;
  private nextId = 1;
  private readonly keys = new Set<string>();

  async settings(): Promise<LevelSettings> { throw new Error('wrapped by levelHistoryStore'); }
  async listedCoins(): Promise<Array<{ symbol: string; base: string }>> { throw new Error('wrapped by levelHistoryStore'); }
  async states(): Promise<Map<string, LevelStateRow & { symbol: string }>> { throw new Error('wrapped by levelHistoryStore'); }

  async commit(x: LevelCommit): Promise<Array<number | null>> {
    return x.alerts.map((a) => {
      if (this.keys.has(`a|${a.dedupeKey}`)) return null;
      this.keys.add(`a|${a.dedupeKey}`);
      const id = this.nextId++;
      const d = a.details as { kind: LevelKind; price: number };
      this.alerts.push({ id, event: a.event, symbol: a.symbol, kind: d.kind, price: d.price, atMs: a.atMs, dedupeKey: a.dedupeKey, details: a.details });
      return id;
    });
  }

  async insertControl(_s: MarketAlertSource, _b: string, _p: LevelParams, x: NewLevelControl): Promise<number | null> {
    if (this.keys.has(`c|${x.dedupeKey}`)) return null;
    this.keys.add(`c|${x.dedupeKey}`);
    const id = this.nextId++;
    this.controls.push({ ...x, id });
    return id;
  }

  async insertPaths(): Promise<void> { this.paths += 1; }
  async recipients(): Promise<Array<{ chatId: number; lang: 'ru' | 'en' }>> { return []; }
  async markFired(): Promise<void> { throw new Error('the history run never sends'); }
}

export interface LevelReplayTotals {
  /** The first and the last bar evaluated are [fromMs, toMs): bar OPENS. */
  fromMs: number;
  toMs: number;
  ticks: number;
  bars: number;
  alerts: number;
  controls: number;
  /** Seeds done (coin-seeds), and the history venue's reads (not venue weight: the bars are in memory). */
  seeds: number;
  reads: number;
  /** Coins a tick reported as failed, and the loop's warnings, each with how often it came; any → exit 1. */
  failed: number;
  warnings: Record<string, number>;
}

/**
 * The bars opening in [fromMs, toMs) evaluated by the live loop, ticking once a minute 5 s past it, as live. Both
 * ends are on the 15m grid. The first tick is the one that evaluates `fromMs`'s bar (its close + 5 s); the last is
 * the one that evaluates the bar before `toMs`. `beforeDay` runs before each UTC day (the memory guard, IB-116).
 */
export async function replayLevels(
  ports: { store: LevelAlertStore; venue: HistoryLevelVenue; build: string; log?: (line: string) => void; beforeDay?: (label: string) => Promise<void> },
  fromMs: number, toMs: number,
): Promise<LevelReplayTotals> {
  if (fromMs % BAR_MS !== 0 || toMs % BAR_MS !== 0) throw new Error('replayLevels: both ends on the 15m grid');
  const warnings: Record<string, number> = {};
  const loop = new LevelAlertLoop({
    store: ports.store, venue: ports.venue, weightOf: klinesWeight, build: ports.build, source: 'backfill', webBaseUrl: '',
    send: async () => { throw new Error('the history run never sends'); },
    log: { warn: (m) => { if (!(m in warnings)) ports.log?.(m); warnings[m] = (warnings[m] ?? 0) + 1; } },
  });
  const out: LevelReplayTotals = { fromMs, toMs, ticks: 0, bars: 0, alerts: 0, controls: 0, seeds: 0, reads: 0, failed: 0, warnings };
  const readsBefore = ports.venue.calls;
  const last = toMs + LEVEL_SETTLE_SEC * 1_000; // closes the bar opening at toMs − 15 min
  let nextDay = -Infinity;
  for (let now = fromMs + BAR_MS + LEVEL_SETTLE_SEC * 1_000; now <= last; now += MINUTE_MS) {
    if (now >= nextDay) {
      await ports.beforeDay?.(`15m bars of ${new Date(now).toISOString().slice(0, 10)}`);
      nextDay = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
    }
    ports.venue.now = now;
    const r = (await loop.tick(now)) as LevelTickReport; // sequential: never null
    out.ticks++;
    out.bars += r.bars;
    out.alerts += r.alerts;
    out.controls += r.controls;
    out.seeds += r.seeded.length;
    out.failed += r.failed.length;
  }
  out.reads = ports.venue.calls - readsBefore;
  return out;
}

/** One cell of the owner's table: a coin, a level kind and an event, over the replayed span. */
export interface LevelCountRow {
  symbol: string;
  kind: LevelKind;
  event: LevelEvent;
  count: number;
  perWeek: number;
}

const perWeek = (n: number, days: number): number => Math.round((n / days) * 7 * 100) / 100;

/** Every (coin, kind, event) with at least one alert, in LEVEL_KINDS × LEVEL_EVENTS order. */
export function levelCountRows(journal: MemoryLevelJournal, symbols: readonly string[], days: number): LevelCountRow[] {
  const out: LevelCountRow[] = [];
  for (const symbol of symbols) {
    for (const kind of LEVEL_KINDS) {
      for (const event of LEVEL_EVENTS) {
        const count = journal.alerts.filter((a) => a.symbol === symbol && a.kind === kind && a.event === event).length;
        if (count > 0) out.push({ symbol, kind, event, count, perWeek: perWeek(count, days) });
      }
    }
  }
  return out;
}

/** P7 touches (controls, never sent) per coin at one band: total, per UTC day, and per kind. */
export interface LevelTouchRow {
  symbol: string;
  bandMultiplier: number;
  touchBand: number;
  touches: number;
  perDay: number;
  byKind: Partial<Record<LevelKind, number>>;
}

export function levelTouchRows(journal: MemoryLevelJournal, symbols: readonly string[], bandMultiplier: number, days: number): LevelTouchRow[] {
  return symbols.map((symbol) => {
    const ts = journal.controls.filter((c) => c.kind === 'touch' && c.symbol === symbol);
    const byKind: Partial<Record<LevelKind, number>> = {};
    for (const t of ts) {
      const kind = (t.details as { kind: LevelKind }).kind;
      byKind[kind] = (byKind[kind] ?? 0) + 1;
    }
    return {
      symbol, bandMultiplier, touchBand: LEVEL_TOUCH_BAND_DEFAULT * bandMultiplier, touches: ts.length,
      perDay: Math.round((ts.length / days) * 100) / 100, byKind,
    };
  });
}

/** What the shipped defaults journal: the in-memory replay (PDH/PDL on) without PDH/PDL, as `backfillCounts` keys. */
export function levelShippedCounts(journal: MemoryLevelJournal): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (k: string) => { out[k] = (out[k] ?? 0) + 1; };
  for (const a of journal.alerts) if (!LEVEL_DAILY_KINDS.includes(a.kind)) add(`alerts_${a.event}`);
  for (const c of journal.controls) {
    if (c.kind === 'touch' && LEVEL_DAILY_KINDS.includes((c.details as { kind: LevelKind }).kind)) continue;
    add(`controls_${c.kind}`);
  }
  return out;
}

/**
 * The ×1 in-memory replay, PDH/PDL dropped, against the backfill rows the database holds
 * (`PgLevelBackfillReads.backfillCounts`). Not against the rows THIS run wrote: a rerun writes 0 and still holds
 * every row. Null when they agree.
 */
export function levelCrossCheck(memory: MemoryLevelJournal, stored: Record<string, number>): string | null {
  const mem = levelShippedCounts(memory);
  const keys = [...LEVEL_EVENTS.map((e) => `alerts_${e}`), 'controls_touch', 'controls_random'];
  const f = (x: Record<string, number>) => keys.map((k) => `${k.replace(/^(alerts|controls)_/, '')} ${x[k] ?? 0}`).join(' / ');
  return f(mem) === f(stored) ? null : `the in-memory ×1 replay without PDH/PDL (${f(mem)}) differs from the backfill rows stored (${f(stored)})`;
}

/**
 * A coin's closed klines over [fromMs, toMs), every page of 1 500 (weight 10; a 1d range under 100 bars is one call of
 * weight 1). `page(startMs, limit)` is `CandlesService.closedKlines`; `beforeCall(weight)` paces it. Pages step by
 * their span, not by the last bar returned, so a bar the venue skipped never stalls or repeats a page.
 */
export async function fetchClosed(
  page: (startMs: number, limit: number) => Promise<WebCandle[]>, barMs: number, fromMs: number, toMs: number, beforeCall: (weight: number) => Promise<void>,
): Promise<{ candles: WebCandle[]; calls: number; weight: number }> {
  const out: WebCandle[] = [];
  let calls = 0;
  let weight = 0;
  for (let start = fromMs; start < toMs;) {
    const limit = Math.min(LEVEL_HISTORY_PAGE, Math.ceil((toMs - start) / barMs));
    const w = klinesWeight(limit);
    await beforeCall(w);
    calls++;
    weight += w;
    const got = await page(start, limit);
    for (const c of got) if (c.time * 1000 >= start && c.time * 1000 < toMs) out.push(c);
    start += limit * barMs;
  }
  const seen = new Set<number>();
  const candles = out.filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true))).sort((a, b) => a.time - b.time);
  return { candles, calls, weight };
}

export const toLevelBar = (c: WebCandle): LevelBar => ({ openMs: c.time * 1000, open: c.open, high: c.high, low: c.low, close: c.close });

/** The first 15m bar any level in force at `fromMs` can need for its seed: the month start (the longest period). */
export function seedFrom(fromMs: number): number {
  const d = new Date(fromMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - BAR_MS;
}

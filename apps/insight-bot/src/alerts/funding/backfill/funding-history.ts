import {
  FUNDING_CHECK_SEC, FUNDING_DEFAULT_PARAMS, type FundingAlertEvent, type FundingParams, type FundingSide, type MarketAlertSource,
} from '@trade-automation/contracts';
import { FUNDING_FLOOR_PER_8H } from '../../../insights/thresholds';
import type { FundingRateRow } from '../../../venues/binance/payloads';
import { binanceFundingPoints } from '../../../web/market/funding-points';
import { FundingAlertLoop, type FundingTickReport, type FundingVenuePort } from '../funding-alert-loop';
import type { FundingSideState } from '../funding-state';
import { stateKey, type FundingAlertStore, type FundingCommit, type FundingSettings, type NewFundingControl } from '../pg/funding-alerts.repo';

/**
 * IB-125 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §3 F9, §1 C4) — the funding history run.
 * **The live loop's own code** (`FundingAlertLoop.tick`, every FUNDING_CHECK_SEC = 5 min as live, IB-124's
 * `fundingCheck` and `fundingStep` inside it) is driven over Binance's SETTLED funding with `source = 'backfill'`.
 * The loop sends only when `source === 'live'`; the run's send and `markFired` ports also throw.
 *
 * **What it is coarser than live in (F9, said in every report).** The live loop reads the PREDICTED rate every
 * 5 min; there is no history of it. So the replay's "predicted rate" is a step: from one settlement `T(k−1)` until
 * the next `T(k)`, a check reads the rate that SETTLED at `T(k)`, i.e. the rate of the interval it is in, and its
 * 30-day sample is every settlement up to and including `T(k−1)` (`settled(from, now]`: `T(k)` lies after now).
 * Each settlement is thus judged against its previous 30 days, and the state can change only once per interval
 * (8 h for these coins). The time a replayed signal carries is the START of the interval whose payment was
 * extreme; live would have fired somewhere inside that interval, when the predicted rate got there, or not at all
 * if it got there only by the end.
 *
 * Only the store differs from live (`fundingHistoryStore`):
 * - settings frozen for the run: F5's bounds from contracts, the floor `FUNDING_FLOOR_PER_8H` × a multiplier
 *   (×½ / ×1 / ×2 for the owner's counts), sending off. Pinned, not the admin page's params, so a rerun after the
 *   owner edits a floor still writes 0 rows;
 * - the coin list frozen at the start (one read, not 52 000);
 * - the state rows (F6) kept IN MEMORY: `alert_funding_state` gets no backfill rows. 52 000 checks × 5 coins would
 *   otherwise be 260 000 transactions on the box for state nobody resumes. An alert is written with the repo's
 *   own `commit` (states empty), a control with `insertControl`, a path with `insertPaths`: the real SQL, keys and
 *   once-constraints, so a rerun writes 0.
 *
 * The counts (×½, ×1, ×2) replay into `MemoryFundingJournal`, nothing written; the ×1 count is cross-checked
 * against the backfill rows the database holds.
 */
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
export const CHECK_MS = FUNDING_CHECK_SEC * 1_000;
/** F9: the span the counts cover. */
export const FUNDING_HISTORY_DAYS = 180;
/** The floors the owner sees counts at (the row: «по умолчанию, ×½ и ×2»). */
export const FUNDING_HISTORY_MULTIPLIERS = [0.5, 1, 2] as const;

export interface SettledPoint { time: number; rate: number }

/**
 * The params of a run at floor × `k`. ×1 is the shipped default as it is (`perCoin` empty: every coin on at the
 * shared floor), so the rows record exactly what live records; other multipliers name each coin's floor.
 */
export function fundingHistoryParams(symbols: readonly string[], k: number): FundingParams {
  if (k === 1) return FUNDING_DEFAULT_PARAMS;
  return { ...FUNDING_DEFAULT_PARAMS, perCoin: Object.fromEntries(symbols.map((s) => [s, { enabled: true, floorPer8h: FUNDING_FLOOR_PER_8H * k }])) };
}

/**
 * The venue as the replay sees it at `now` (set by the driver before each check). Points per coin, oldest first,
 * `time` in unix seconds, as `binanceFundingPoints` gives them.
 */
export class HistoryFundingVenue implements FundingVenuePort {
  now = 0;
  calls = 0;

  constructor(private readonly series: ReadonlyMap<string, readonly SettledPoint[]>) {}

  /** The rate that settles at the end of the interval `now` is in; its time is `now` (a fresh check, F7). */
  async premiumIndex(symbol: string): Promise<{ rate: number; timeMs: number; nextFundingTimeMs: number }> {
    this.calls++;
    const pts = this.of(symbol);
    const i = firstAfter(pts, this.now / 1000);
    const next = pts[i];
    if (!next) throw new Error(`funding history ${symbol}: no settlement after ${new Date(this.now).toISOString()}`);
    return { rate: next.rate, timeMs: this.now, nextFundingTimeMs: next.time * 1000 };
  }

  /** Settlements in (fromMs, toMs] that had happened by `now`, oldest first. */
  async settled(symbol: string, fromMs: number, toMs: number): Promise<SettledPoint[]> {
    this.calls++;
    const pts = this.of(symbol);
    const upto = Math.min(toMs, this.now) / 1000;
    return pts.slice(firstAfter(pts, fromMs / 1000), firstAfter(pts, upto));
  }

  private of(symbol: string): readonly SettledPoint[] {
    const pts = this.series.get(symbol);
    if (!pts) throw new Error(`funding history ${symbol}: no settled series fetched`);
    return pts;
  }
}

/** The index of the first point with `time > t` (binary search; points ascending). */
function firstAfter(pts: readonly SettledPoint[], t: number): number {
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((pts[mid] as SettledPoint).time > t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The store as the loop sees it in a history run (see the module comment). */
export function fundingHistoryStore(
  base: FundingAlertStore, opts: { params: FundingParams; coins: ReadonlyArray<{ symbol: string; base: string }> },
): FundingAlertStore {
  const settings: FundingSettings = { enabled: false, membersVisible: false, params: opts.params, updatedAt: 0 };
  const states = new Map<string, FundingSideState>();
  return {
    settings: async () => settings,
    listedCoins: async () => opts.coins.map((c) => ({ ...c })),
    states: async () => new Map([...states].map(([k, v]) => [k, { ...v }])),
    commit: async (x: FundingCommit) => {
      const ids = x.alerts.length > 0 ? await base.commit({ ...x, states: [] }) : [];
      for (const s of x.states) states.set(stateKey(x.symbol, s.side), { ...s.state });
      return ids;
    },
    insertControl: (...a) => base.insertControl(...a),
    insertPaths: (...a) => base.insertPaths(...a),
    recipients: async () => [],
    markFired: async () => { throw new Error('the history run never sends'); },
  };
}

/** A journalled row as the counts and the report need it. */
export interface CountedFundingAlert {
  id: number;
  event: FundingAlertEvent;
  symbol: string;
  side: FundingSide;
  atMs: number;
  dedupeKey: string;
  details: Record<string, unknown>;
}

/** Alerts and controls in memory with migration 031's once-keys (source, type, dedupe_key); paths counted. */
export class MemoryFundingJournal implements FundingAlertStore {
  readonly alerts: CountedFundingAlert[] = [];
  readonly controls: Array<NewFundingControl & { id: number }> = [];
  paths = 0;
  private nextId = 1;

  async settings(): Promise<FundingSettings> { throw new Error('wrapped by fundingHistoryStore'); }
  async listedCoins(): Promise<Array<{ symbol: string; base: string }>> { throw new Error('wrapped by fundingHistoryStore'); }
  async states(): Promise<Map<string, FundingSideState>> { throw new Error('wrapped by fundingHistoryStore'); }

  async commit(x: FundingCommit): Promise<Array<number | null>> {
    return x.alerts.map((a) => {
      if (this.alerts.some((r) => r.dedupeKey === a.dedupeKey)) return null;
      const id = this.nextId++;
      this.alerts.push({ id, event: a.event, symbol: a.symbol, side: a.details.side as FundingSide, atMs: a.atMs, dedupeKey: a.dedupeKey, details: a.details });
      return id;
    });
  }

  async insertControl(_s: MarketAlertSource, _b: string, _p: FundingParams, x: NewFundingControl): Promise<number | null> {
    if (this.controls.some((c) => c.dedupeKey === x.dedupeKey)) return null;
    const id = this.nextId++;
    this.controls.push({ ...x, id });
    return id;
  }

  async insertPaths(): Promise<void> { this.paths += 1; }
  async recipients(): Promise<Array<{ chatId: number; lang: 'ru' | 'en' }>> { return []; }
  async markFired(): Promise<void> { throw new Error('the history run never sends'); }
}

export interface FundingReplayTotals {
  fromMs: number;
  toMs: number;
  checks: number;
  enters: number;
  flips: number;
  controls: number;
  stale: number;
  /** Coin-checks with too few settlements to judge (fundingSample). */
  insufficient: number;
  /** The loop's warnings (a failed coin-check), each with how often it came; any → exit 1. */
  warnings: Record<string, number>;
}

/**
 * Every 5-minute grid moment in [fromMs, toMs) checked by the live loop, as live checks. `fromMs` is put on the
 * grid. `beforeDay` runs before each UTC day (the memory guard, IB-116).
 */
export async function replayFunding(
  ports: { store: FundingAlertStore; venue: HistoryFundingVenue; build: string; log?: (line: string) => void; beforeDay?: (label: string) => Promise<void> },
  fromMs: number, toMs: number,
): Promise<FundingReplayTotals> {
  const warnings: Record<string, number> = {};
  const loop = new FundingAlertLoop({
    store: ports.store, venue: ports.venue, build: ports.build, source: 'backfill', webBaseUrl: '',
    send: async () => { throw new Error('the history run never sends'); },
    log: { warn: (m) => { if (!(m in warnings)) ports.log?.(m); warnings[m] = (warnings[m] ?? 0) + 1; } },
  });
  const out: FundingReplayTotals = { fromMs, toMs, checks: 0, enters: 0, flips: 0, controls: 0, stale: 0, insufficient: 0, warnings };
  let nextDay = -Infinity;
  for (let now = Math.ceil(fromMs / CHECK_MS) * CHECK_MS; now < toMs; now += CHECK_MS) {
    if (now >= nextDay) {
      await ports.beforeDay?.(`settlements at ${new Date(now).toISOString().slice(0, 10)}`);
      nextDay = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
    }
    ports.venue.now = now;
    const r = (await loop.tick(now)) as FundingTickReport; // sequential: never null
    out.checks++;
    out.enters += r.enters;
    out.flips += r.flips;
    out.controls += r.controls;
    out.stale += r.stale;
    out.insufficient += r.insufficient;
  }
  return out;
}

/** One row of the owner's table: a coin at one multiplier. */
export interface FundingCountRow {
  symbol: string;
  multiplier: number;
  floorPer8h: number;
  enters: number;
  /** `high`: longs pay (rate unusually high and ≥ +floor); `low`: shorts pay. */
  high: number;
  low: number;
  flips: number;
  /**
   * IB-124's choice 3, counted: enters whose side comes from the rate's SIGN while its rarity comes from the
   * other tail (a `high` whose rate is below the band's low end: unusually low for the coin, yet ≥ +floor; or
   * the mirror). Such a message reads «лонги платят много» about a rate that is low for the coin.
   */
  otherTail: number;
  perWeek: number;
  flipsPerWeek: number;
}

/** Per coin, from one in-memory replay. `days` = the replayed span in days. */
export function fundingCountRows(journal: MemoryFundingJournal, symbols: readonly string[], multiplier: number, days: number): FundingCountRow[] {
  const week = (n: number) => Math.round((n / days) * 7 * 100) / 100;
  return symbols.map((symbol) => {
    const enters = journal.alerts.filter((a) => a.symbol === symbol && a.event === 'enter');
    const otherTail = enters.filter((a) => {
      const d = a.details as { rate: number; band: { lo: number; hi: number } };
      return a.side === 'high' ? d.rate < d.band.lo : d.rate > d.band.hi;
    }).length;
    const flips = journal.alerts.filter((a) => a.symbol === symbol && a.event === 'flip').length;
    return {
      symbol, multiplier, floorPer8h: FUNDING_FLOOR_PER_8H * multiplier, enters: enters.length,
      high: enters.filter((a) => a.side === 'high').length, low: enters.filter((a) => a.side === 'low').length,
      flips, otherTail, perWeek: week(enters.length), flipsPerWeek: week(flips),
    };
  });
}

/**
 * The ×1 in-memory replay against the backfill rows the database holds (`PgFundingBackfillReads.backfillCounts`).
 * Not against the rows THIS run wrote: a rerun writes 0 and still holds every row. Null when they agree.
 */
export function fundingCrossCheck(memory: MemoryFundingJournal, stored: Record<string, number>): string | null {
  const mem = {
    enter: memory.alerts.filter((a) => a.event === 'enter').length, flip: memory.alerts.filter((a) => a.event === 'flip').length,
    random: memory.controls.filter((c) => c.kind === 'random').length, near_miss: memory.controls.filter((c) => c.kind === 'near_miss').length,
  };
  const db = { enter: stored.alerts_enter ?? 0, flip: stored.alerts_flip ?? 0, random: stored.controls_random ?? 0, near_miss: stored.controls_near_miss ?? 0 };
  const f = (x: typeof db) => `enter ${x.enter} / flip ${x.flip} / random ${x.random} / near-miss ${x.near_miss}`;
  return f(mem) === f(db) ? null : `the in-memory ×1 replay (${f(mem)}) differs from the backfill rows stored (${f(db)})`;
}

/**
 * A coin's settled rates over [fromMs, toMs], every page of `/fapi/v1/fundingRate` (≤ 1 000 a call, weight 1;
 * 210 days of an 8 h coin is 630, one call). `page(startMs)` asks from `startMs` to `toMs`; `beforeCall` paces it.
 * Rows go through `binanceFundingPoints`, so a non-number rate throws as on the market page.
 */
export async function fetchSettled(
  page: (startMs: number) => Promise<FundingRateRow[]>, fromMs: number, toMs: number, limit: number, beforeCall: () => Promise<void>,
): Promise<{ points: SettledPoint[]; calls: number }> {
  const rows: FundingRateRow[] = [];
  let start = fromMs;
  let calls = 0;
  for (;;) {
    await beforeCall();
    calls++;
    const got = await page(start);
    rows.push(...got);
    if (got.length < limit) break;
    const last = Math.max(...got.map((r) => r.fundingTime));
    if (!(last + 1 > start)) throw new Error(`fundingRate paging did not advance past ${new Date(start).toISOString()}`);
    start = last + 1;
    if (start > toMs) break;
  }
  return { points: binanceFundingPoints(rows, fromMs, toMs), calls };
}

/**
 * The replay's end: `untilMs` (the live loop's first check), or earlier when a coin's last settlement fetched is
 * before it. A check needs the settlement that ENDS its interval (its "predicted" rate), and that one is in the
 * future until it happens, so the replay stops at the earliest coin's last settlement.
 */
export function replayEnd(series: ReadonlyMap<string, readonly SettledPoint[]>, untilMs: number): number {
  let end = untilMs;
  for (const pts of series.values()) {
    const last = pts[pts.length - 1];
    end = Math.min(end, last ? last.time * 1000 : -Infinity);
  }
  return end;
}

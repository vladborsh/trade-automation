import {
  LEVEL_BAR_SEC, LEVEL_DAILY_KINDS, LEVEL_EVENT_DIRECTION, LEVEL_LATE_SEC, LEVEL_SETTLE_SEC, levelEventOn,
  type CustomLevelAlertDetails, type LevelAlertDetails, type LevelBar, type LevelInForce, type LevelEvent, type LevelKind, type LevelParams, type LevelRandomDetails, type LevelTouchDetails,
  mutedDedupeKey, type MarketAlertMutedBy, type MarketAlertSource, type WebCandle,
} from '@trade-automation/contracts';
import { levelsInForce } from '@trade-automation/market-data-core';
import { barCloseMs, levelAlert } from '../../delivery/templates/level-alerts.texts';
import { customLevelAlert } from '../../delivery/templates/custom-level-alerts.texts';
import { isRandomBar } from './controls';
import { customLevelAlerts } from './custom-level-step';
import { freshState, hasState, levelStep, seedState, type LevelState } from './level-step';
import type { CustomLevel } from './pg/custom-levels.repo';
import { stateKey, type LevelAlertStore, type LevelSettings, type LevelStateRow, type NewLevelAlert } from './pg/level-alerts.repo';

/**
 * IB-126 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §4, P2–P7, P10) — the level alert loop, as plain
 * logic over ports. The Nest service in delivery/ calls `tick` once a minute, 5 s past it.
 *
 * Per listed coin (`alert_symbols`, enabled), when a 15m bar has closed (≥ 5 s ago) that it has not evaluated:
 * 1. P5: the bars since its cursor, one `klines 15m` call at exactly that count (`limit = 2` in steady state, weight
 *    1; after downtime up to 99 bars, still weight 1). The cursor is the last bar evaluated, held in memory and, across
 *    a restart, read from the P10 rows' `last_bar_at`. A bar whose close is older than 20 min is journalled `late`,
 *    never sent.
 * 2. P2: the levels in force at each bar's OPEN (`levelsInForce`, the shared module of P1) from the coin's 1d bars,
 *    re-read once a UTC day (limit 70, weight 1). A level is used only when the copy was read after its period started:
 *    a stale copy never turns a forming day into a "previous day".
 * 3. P3: `levelStep` per level; P2's per-event switches; P4's once-key `level:{symbol}:{kind}:{period start}:{event}`.
 *    The bar's alerts and the P10 rows they came from are written in ONE transaction.
 * 4. P10: a high/low level's row is stepped only from the bar right before (its `last_bar_at`). A missing row at the
 *    period's first bar starts fresh; a missing or gapped row later in the period waits for its seed (no crossunder or
 *    crossover until then; breakouts and sweeps go on). One coin is seeded per tick, so ≤ 2 pages × weight 10 a minute.
 * 5. Sent only while the type's switch is on (default OFF), to users with `level_alerts`, in their language.
 * 5a. IB-151 (owner ruling 2026-11-06 B): **every admin switch below the type's only mutes.** A coin switched off,
 *    PDH/PDL with `daily` off, an event switched off, a custom level's event switched off: the bar is evaluated and
 *    the alert journalled all the same, with `mutedBy` naming the switch (`levelMutedBy`), and never sent. A muted row's
 *    once-key ends in `:muted`, so it never takes the key a sent row would use: turning the switch back on mid-period
 *    sends what would have been sent had the muted row never been written. PDH/PDL come from the daily copy the
 *    loop reads anyway (no extra venue weight); their P10 rows are seeded with the coin's other levels.
 * 6. P7: a `touch` per level and UTC day, 2 hash-picked `random` bars per coin and day; price paths for all, direction-free.
 * 7. IB-128 (P9): the coin's custom levels (`custom`, read once per evaluating tick, so a deleted level never fires
 *    after the tick that read it) on the same bar, as opens, once per (level, event, UTC day), in the same commit;
 *    sent only to admins (`custom.recipients`). Absent `custom` (the history run) = none.
 *
 * Memory: per coin, 70 daily bars and a cursor; the state rows are re-read each tick that evaluates (≈ coins × 6).
 */
export interface LevelVenuePort {
  /** `limit` CLOSED 15m bars from `fromMs` (bar opens), oldest first; one request at that limit. */
  bars15m(symbol: string, fromMs: number, limit: number): Promise<LevelBar[]>;
  /** The 1d bars of the `LEVEL_DAILY_BARS` days up to and INCLUDING `dayStartMs`'s (still forming), oldest first. */
  daily(symbol: string, dayStartMs: number): Promise<WebCandle[]>;
}

export interface LevelAlertLoopPorts {
  store: LevelAlertStore;
  venue: LevelVenuePort;
  /** The documented weight of one 15m request at `limit` (`klinesWeight`). */
  weightOf(limit: number): number;
  /** Delivered or not; never throws (TelegramSender.sendTo). */
  send(chatId: number, text: string): Promise<boolean>;
  webBaseUrl: string;
  build: string;
  source: MarketAlertSource;
  /** IB-128: the owner's custom levels and who hears about them; absent = none (the history run). */
  custom?: CustomLevelPort;
  log?: { warn(message: string): void };
}

export interface CustomLevelPort {
  /** Every active (not deleted) custom level. */
  active(): Promise<CustomLevel[]>;
  /** Admins with `level_alerts`, in their language. */
  recipients(): Promise<Array<{ chatId: number; lang: 'ru' | 'en' }>>;
}

export interface LevelTickReport {
  atMs: number;
  /** The open of the newest bar due (closed ≥ 5 s before `atMs`). */
  dueBarMs: number;
  coins: number;
  /** Bars evaluated this tick, all coins. */
  bars: number;
  /** Venue calls and their documented weight (15m and 1d). */
  calls: number;
  weight: number;
  alerts: number;
  late: number;
  /** IB-151: alerts journalled muted by an admin switch (never sent). */
  muted: number;
  sent: number;
  controls: number;
  /** Coins whose P10 rows were seeded this tick, and coins still waiting. */
  seeded: string[];
  pendingSeed: number;
  failed: string[];
}

const BAR_MS = LEVEL_BAR_SEC * 1_000;
const DAY_MS = 86_400_000;
const LATE_MS = LEVEL_LATE_SEC * 1_000;
/** A catch-up read stays at weight 1 (limit < 100); a longer gap is re-seeded instead of stepped. */
export const LEVEL_CATCHUP_BARS = 99;
/** `/fapi/v1/klines`' limit ceiling: a seed reads in pages of this. */
export const LEVEL_SEED_PAGE = 1_500;

/** `on`: the coin's own switch (`perCoin[symbol].enabled`); off only mutes (IB-151). `daily`: PDH/PDL send. */
interface Coin { symbol: string; base: string; on: boolean; daily: boolean }
type StateMap = Map<string, LevelStateRow & { symbol: string }>;

/** The newest 15m bar whose close is at least the settle time before `nowMs`: its OPEN. */
export function dueBarOpen(nowMs: number): number {
  return Math.floor((nowMs - LEVEL_SETTLE_SEC * 1_000) / BAR_MS) * BAR_MS - BAR_MS;
}

export class LevelAlertLoop {
  private running = false;
  /** Per coin: the open of the last bar evaluated. */
  private readonly cursor = new Map<string, number>();
  private readonly dailyCopy = new Map<string, { dayStartMs: number; fetchedAt: number; bars: WebCandle[] }>();
  /** Coins with a high/low level that waits for its seed (filled by evaluation, drained one a tick). */
  private readonly pending = new Set<string>();

  constructor(private readonly ports: LevelAlertLoopPorts) {}

  /** One minute's work. Null when the previous tick is still running. */
  async tick(nowMs: number): Promise<LevelTickReport | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const due = dueBarOpen(nowMs);
      const report: LevelTickReport = {
        atMs: nowMs, dueBarMs: due, coins: 0, bars: 0, calls: 0, weight: 0, alerts: 0, late: 0, muted: 0, sent: 0, controls: 0, seeded: [], pendingSeed: 0, failed: [],
      };
      const { store, source } = this.ports;
      const settings = await store.settings();
      const coins = coinsOf(await store.listedCoins(), settings.params);
      report.coins = coins.length;
      this.forget(coins);
      const behind = coins.filter((c) => (this.cursor.get(c.symbol) ?? -Infinity) < due);
      if (behind.length === 0 && this.pending.size === 0) return report;
      const states = await store.states(source);
      // read on every tick that does work (a seed-only tick too: one indexed read, a few minutes per coin, once)
      const custom = (await this.ports.custom?.active()) ?? [];
      for (const coin of behind) {
        try {
          await this.evaluateCoin(coin, due, settings, states, custom, nowMs, report);
        } catch (error) {
          report.failed.push(coin.symbol);
          this.ports.log?.warn(`level alerts ${coin.symbol}: ${(error as Error).message}`);
        }
      }
      const next = coins.find((c) => this.pending.has(c.symbol) && this.cursor.has(c.symbol));
      if (next) {
        try {
          await this.seedCoin(next, settings, states, nowMs, report);
          report.seeded.push(next.symbol);
        } catch (error) {
          report.failed.push(`${next.symbol}(seed)`);
          this.ports.log?.warn(`level alerts ${next.symbol} seed: ${(error as Error).message}`);
        }
      }
      report.pendingSeed = this.pending.size;
      return report;
    } finally {
      this.running = false;
    }
  }

  private async evaluateCoin(
    coin: Coin, due: number, settings: LevelSettings, states: StateMap, custom: readonly CustomLevel[], nowMs: number, report: LevelTickReport,
  ): Promise<void> {
    const known = this.cursor.get(coin.symbol) ?? cursorFromRows(states, coin.symbol);
    if (known !== null && known >= due) {
      // a restart between closes: the rows already saw the due bar, so nothing is read until the next close
      this.cursor.set(coin.symbol, known);
      return;
    }
    const from = known === null ? due - BAR_MS : Math.max(known, due - (LEVEL_CATCHUP_BARS - 1) * BAR_MS);
    const limit = (due - from) / BAR_MS + 1;
    const bars = await this.ports.venue.bars15m(coin.symbol, from, limit);
    report.calls++;
    report.weight += this.ports.weightOf(limit);
    if (bars.length < 2) return;
    const daily = await this.dailyOf(coin.symbol, nowMs, report);
    const own = custom.filter((l) => l.symbol === coin.symbol);
    for (let i = 1; i < bars.length; i++) {
      await this.evaluateBar(coin, bars[i], bars[i - 1].close, daily, settings, states, own, nowMs, report);
      this.cursor.set(coin.symbol, bars[i].openMs);
      report.bars++;
    }
  }

  private async evaluateBar(
    coin: Coin, bar: LevelBar, prevClose: number, daily: { fetchedAt: number; bars: WebCandle[] }, settings: LevelSettings, states: StateMap,
    custom: readonly CustomLevel[], nowMs: number, report: LevelTickReport,
  ): Promise<void> {
    const { store, source, build } = this.ports;
    const params = settings.params;
    const closeMs = barCloseMs(bar.openMs);
    const late = nowMs - closeMs > LATE_MS;
    const levels = this.levelsAt(daily, bar.openMs);
    const rows: LevelStateRow[] = [];
    const alerts: NewLevelAlert[] = [];
    const touches: LevelTouchDetails[] = [];
    for (const lv of levels) {
      let state: LevelState | null = null;
      if (hasState(lv.kind)) {
        const row = states.get(stateKey(coin.symbol, lv.kind, lv.periodStartMs));
        if (row && row.state.lastBarMs === bar.openMs - BAR_MS) state = row.state;
        else if (!row && bar.openMs === lv.periodStartMs) state = freshState(lv.periodStartMs);
        else this.pending.add(coin.symbol);
      }
      const r = levelStep(lv.kind, lv.price, bar, prevClose, state, params.touchBand);
      if (r.state) {
        const row = { kind: lv.kind, periodStartMs: lv.periodStartMs, price: lv.price, state: r.state };
        rows.push(row);
        states.set(stateKey(coin.symbol, lv.kind, lv.periodStartMs), { ...row, symbol: coin.symbol });
      }
      for (const event of r.events) {
        const mutedBy = levelMutedBy(coin, params, lv.kind, event);
        const details: LevelAlertDetails = {
          ...lv, bar, prevClose, firstBeyondAtMs: event === 'crossunder' || event === 'crossover' ? state?.firstBeyondAtMs ?? null : null,
        };
        const dedupeKey = `level:${coin.symbol}:${lv.kind}:${lv.periodStartMs}:${event}`;
        alerts.push({
          event, symbol: coin.symbol, direction: LEVEL_EVENT_DIRECTION[event], atMs: bar.openMs, late, details,
          ...(mutedBy ? { mutedBy, dedupeKey: mutedDedupeKey(dedupeKey) } : { dedupeKey }),
        });
      }
      if (r.touch) touches.push({ ...lv, bar, from: r.touch.from, distance: r.touch.distance, touchBand: params.touchBand });
    }
    // a coin switched off mutes its custom levels too (before IB-151 it was not evaluated at all)
    for (const a of customLevelAlerts(coin.symbol, custom, bar, prevClose, late)) {
      alerts.push(coin.on ? a : { ...a, mutedBy: 'coin', dedupeKey: a.mutedBy ? a.dedupeKey : mutedDedupeKey(a.dedupeKey) });
    }

    const ids = rows.length > 0 || alerts.length > 0
      ? await store.commit({ source, build, params, confirmedAtMs: nowMs, symbol: coin.symbol, states: rows, alerts })
      : [];
    for (const [i, a] of alerts.entries()) {
      const id = ids[i];
      if (id === null || id === undefined) continue;
      report.alerts++;
      if (a.late) report.late++;
      if (a.mutedBy) report.muted++;
      await store.insertPaths({ marketAlertId: id }, coin.symbol, closeMs / 1000);
      if (source === 'live' && settings.enabled && !a.late && !a.mutedBy) {
        report.sent += a.details.kind === 'custom'
          ? await this.deliver(id, customLevelAlert(coin, a.event, a.details as CustomLevelAlertDetails, this.ports.webBaseUrl), nowMs, 'custom')
          : await this.deliver(id, levelAlert(coin, a.event, a.details as LevelAlertDetails, this.ports.webBaseUrl), nowMs, 'level');
      }
    }

    const day = new Date(bar.openMs).toISOString().slice(0, 10);
    for (const t of touches) {
      await this.control(coin.symbol, params, 'touch', bar, t, `level-touch:${coin.symbol}:${t.kind}:${t.periodStartMs}:${day}`, report);
    }
    if (isRandomBar(coin.symbol, bar.openMs)) {
      const details: LevelRandomDetails = { bar, levels };
      await this.control(coin.symbol, params, 'random', bar, details, `level-rnd:${coin.symbol}:${bar.openMs}`, report);
    }
  }

  private async control(
    symbol: string, params: LevelParams, kind: 'touch' | 'random', bar: LevelBar, details: LevelTouchDetails | LevelRandomDetails, dedupeKey: string,
    report: LevelTickReport,
  ): Promise<void> {
    const { store, source, build } = this.ports;
    const id = await store.insertControl(source, build, params, { kind, symbol, atMs: bar.openMs, details, dedupeKey });
    if (id === null) return;
    report.controls++;
    await store.insertPaths({ marketControlId: id }, symbol, barCloseMs(bar.openMs) / 1000);
  }

  /**
   * P10 seed for one coin: every high/low level in force at its cursor bar whose row is missing or behind, rebuilt
   * from the period's 15m bars (pages of 1 500 from the earliest period start) up to and including the cursor bar.
   */
  private async seedCoin(coin: Coin, settings: LevelSettings, states: StateMap, nowMs: number, report: LevelTickReport): Promise<void> {
    const cursor = this.cursor.get(coin.symbol) as number;
    const daily = await this.dailyOf(coin.symbol, nowMs, report);
    const need = this.levelsAt(daily, cursor).filter((lv) => {
      if (!hasState(lv.kind)) return false;
      const row = states.get(stateKey(coin.symbol, lv.kind, lv.periodStartMs));
      return !row || row.state.lastBarMs < cursor;
    });
    if (need.length > 0) {
      const bars: LevelBar[] = [];
      for (let from = Math.min(...need.map((l) => l.periodStartMs)); from <= cursor;) {
        const limit = Math.min(LEVEL_SEED_PAGE, (cursor - from) / BAR_MS + 1);
        bars.push(...(await this.ports.venue.bars15m(coin.symbol, from, limit)));
        report.calls++;
        report.weight += this.ports.weightOf(limit);
        from += limit * BAR_MS;
      }
      const upTo = bars.filter((b) => b.openMs <= cursor);
      // the seed has seen everything there is up to the cursor, even when the venue skipped a bar
      const rows: LevelStateRow[] = need.map((lv) => ({
        kind: lv.kind, periodStartMs: lv.periodStartMs, price: lv.price, state: { ...seedState(lv.kind, lv.price, lv.periodStartMs, upTo), lastBarMs: cursor },
      }));
      const { store, source, build } = this.ports;
      await store.commit({ source, build, params: settings.params, confirmedAtMs: nowMs, symbol: coin.symbol, states: rows, alerts: [] });
      for (const r of rows) states.set(stateKey(coin.symbol, r.kind, r.periodStartMs), { ...r, symbol: coin.symbol });
    }
    this.pending.delete(coin.symbol);
  }

  /**
   * The levels in force at `atMs` that the daily copy can vouch for. Every kind, PDH/PDL too whatever `daily` says
   * (IB-151: `daily` only mutes, `levelMutedBy`).
   */
  private levelsAt(daily: { fetchedAt: number; bars: WebCandle[] }, atMs: number): LevelInForce[] {
    return levelsInForce(daily.bars, atMs / 1000)
      .filter((l) => l.start * 1000 <= daily.fetchedAt)
      .map((l) => ({ kind: l.kind as LevelKind, price: l.price, periodStartMs: l.start * 1000, periodEndMs: l.end * 1000 }));
  }

  /** P2: the coin's 1d bars, re-read once a UTC day. A failed refresh keeps yesterday's copy (see `levelsAt`). */
  private async dailyOf(symbol: string, nowMs: number, report: LevelTickReport): Promise<{ fetchedAt: number; bars: WebCandle[] }> {
    const dayStartMs = Math.floor(nowMs / DAY_MS) * DAY_MS;
    const held = this.dailyCopy.get(symbol);
    if (held && held.dayStartMs === dayStartMs) return held;
    try {
      report.calls++;
      report.weight += 1;
      const copy = { dayStartMs, fetchedAt: nowMs, bars: await this.ports.venue.daily(symbol, dayStartMs) };
      this.dailyCopy.set(symbol, copy);
      return copy;
    } catch (error) {
      if (held) {
        this.ports.log?.warn(`level alerts ${symbol}: 1d refresh failed, using the copy from ${new Date(held.fetchedAt).toISOString()}: ${(error as Error).message}`);
        return held;
      }
      throw error;
    }
  }

  private async deliver(id: number, texts: { ru: string; en: string }, nowMs: number, who: 'level' | 'custom'): Promise<number> {
    let delivered = 0;
    const recipients = who === 'custom' ? (await this.ports.custom?.recipients()) ?? [] : await this.ports.store.recipients();
    for (const r of recipients) if (await this.ports.send(r.chatId, texts[r.lang])) delivered++;
    await this.ports.store.markFired(id, nowMs, delivered);
    return delivered;
  }

  /** A coin paused or removed on `alert_symbols` is forgotten, so resuming it starts from its rows again. (A coin's own level switch only mutes, IB-151.) */
  private forget(coins: readonly Coin[]): void {
    const on = new Set(coins.map((c) => c.symbol));
    for (const m of [this.cursor, this.dailyCopy]) for (const s of m.keys()) if (!on.has(s)) m.delete(s);
    for (const s of [...this.pending]) if (!on.has(s)) this.pending.delete(s);
  }
}

/** The newest `last_bar_at` among a coin's rows: where a restarted loop resumes. Null without rows. */
function cursorFromRows(states: StateMap, symbol: string): number | null {
  let best: number | null = null;
  for (const r of states.values()) if (r.symbol === symbol && (best === null || r.state.lastBarMs > best)) best = r.state.lastBarMs;
  return best;
}

/**
 * Every enabled `alert_symbols` coin, with its switches; a coin missing from `perCoin` is on with PDH/PDL off. A coin
 * switched off is still evaluated (IB-151): its rows are journalled muted.
 */
export function coinsOf(listed: ReadonlyArray<{ symbol: string; base: string }>, params: LevelParams): Coin[] {
  return listed.map((c) => ({ symbol: c.symbol, base: c.base, on: params.perCoin[c.symbol]?.enabled ?? true, daily: params.perCoin[c.symbol]?.daily ?? false }));
}

/**
 * IB-151: the admin switch that keeps a built-in level's event from being sent, or null. The first that applies, in
 * `MARKET_ALERT_MUTED_BY`'s order: the coin, then PDH/PDL's `daily`, then the (kind, event) switch.
 */
export function levelMutedBy(coin: Pick<Coin, 'on' | 'daily'>, params: Pick<LevelParams, 'events'>, kind: LevelKind, event: LevelEvent): MarketAlertMutedBy | null {
  if (!coin.on) return 'coin';
  if (!coin.daily && LEVEL_DAILY_KINDS.includes(kind)) return 'daily';
  if (!levelEventOn(params, kind, event)) return 'event';
  return null;
}

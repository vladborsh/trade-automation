import {
  LIQ_EVENT_MAX_SEC, LIQ_SEND_CAP_SEC, LIQ_SETTLE_SEC, LIQ_VENUES,
  type LiqByVenue, type LiqVenue,
} from '@trade-automation/contracts';
import { WINDOW_MS } from './window';

/**
 * IB-143 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §2a, L11–L13) — the market event of ONE
 * liquidated side, as pure functions over the crossings the journal holds and the members' prints. The loop
 * (liq-alert-loop.ts) reads, calls these, and writes; nothing here touches a port.
 *
 * **Member prints.** A coin is a member from its crossing on: its prints with `ts ≥ crossedAt` (any size, all
 * venues) are the event's liquidations. Its prints before the crossing are not, so a coin that joins cannot
 * retroactively fill a silence that had already settled the event.
 *
 * **Quiet.** A moment `t` is quiet when (t − 60 s, t] holds no member print, and `t` = the last member print
 * + 60 s. A print exactly 60 s after the previous one is inside that window, so it resets the silence.
 *
 * **S** (the first message) = the first quiet moment ≥ T0, at most T0 + 3 min ("cap"). **Close** = S when it
 * settled, else the first quiet moment after S, at most T0 + 30 min ("max").
 *
 * **Intervals are half-open:** a crossing at `a < S` is in the first message, `a ≥ S` is after it; a crossing at
 * `a < close` (and < T0 + 30 min) joins, `a ≥ close` opens a new event.
 */
export const SETTLE_MS = LIQ_SETTLE_SEC * 1_000;
export const CAP_MS = LIQ_SEND_CAP_SEC * 1_000;
export const EVENT_MAX_MS = LIQ_EVENT_MAX_SEC * 1_000;

/** One coin's crossing, as the journal holds it (or as found this tick, `eventAt` null). */
export interface CrossingRow {
  /** The journal id, or a tick-local key for a crossing not written yet. */
  key: string;
  symbol: string;
  at: number;
  /** The event T0 the row says it belongs to; null = not assigned yet (new, or a row written before IB-143). */
  eventAt: number | null;
}

/** What the journal already holds for an event (keyed by T0). */
export interface DecidedEvent {
  first?: { id: number; sentAt: number; settled: 'quiet' | 'cap'; coins: readonly string[]; late: boolean };
  close?: { closedAt: number };
}

export interface Moment { at: number; by: 'quiet' | 'cap' }

export interface LiqEvent {
  t0: number;
  /** By crossing time; members[0] is the opener. */
  members: CrossingRow[];
  /** S: from the journal when written, else computed; null = not reached yet. */
  s: Moment | null;
  /** The close, `by: 'cap'` meaning T0 + 30 min; null = still open. */
  close: Moment | null;
}

/** Ascending timestamps of one side's prints, per coin. */
export type PrintTimes = ReadonlyMap<string, readonly number[]>;

/** The sorted member-print times of these members (each from its own crossing on). */
export function memberTimes(members: readonly CrossingRow[], times: PrintTimes): number[] {
  const out: number[] = [];
  for (const m of members) for (const t of times.get(m.symbol) ?? []) if (t >= m.at) out.push(t);
  return out.sort((a, b) => a - b);
}

/**
 * The first quiet moment ≥ `fromMs` (see the module comment), or `capMs` if none comes before it. Null when
 * that is not known yet at `nowMs`: the silence after the last print has not lasted 60 s and the cap is ahead.
 * `times` sorted; it may hold prints after `nowMs` (a replay reads ahead), which are ignored.
 */
export function firstQuiet(times: readonly number[], fromMs: number, capMs: number, nowMs: number): Moment | null {
  const known = times.filter((t) => t <= nowMs);
  for (let i = 0; i < known.length; i++) {
    const quiet = (known[i] as number) + SETTLE_MS;
    if (quiet < fromMs) continue;
    if (quiet > capMs) break;
    const next = known[i + 1];
    if (next !== undefined && next <= quiet) continue;
    if (next === undefined && quiet > nowMs) break; // a print may still come
    return { at: quiet, by: 'quiet' };
  }
  return nowMs >= capMs ? { at: capMs, by: 'cap' } : null;
}

/** S and the close of an event with these members, as known at `nowMs` (the journal's decisions win). */
export function phases(t0: number, members: readonly CrossingRow[], times: PrintTimes, nowMs: number, decided?: DecidedEvent): Pick<LiqEvent, 's' | 'close'> {
  const own = memberTimes(members, times);
  const s: Moment | null = decided?.first
    ? { at: decided.first.sentAt, by: decided.first.settled }
    : firstQuiet(own, t0, t0 + CAP_MS, nowMs);
  if (!s) return { s: null, close: null };
  if (s.by === 'quiet') return { s, close: s };
  if (decided?.close) return { s, close: { at: decided.close.closedAt, by: decided.close.closedAt >= t0 + EVENT_MAX_MS ? 'cap' : 'quiet' } };
  return { s, close: firstQuiet(own, s.at, t0 + EVENT_MAX_MS, nowMs) };
}

/**
 * L11: groups one side's crossings into events. Rows carrying `eventAt` stay where the journal put them; the
 * others are placed in time order: into the latest event if it was still open at their crossing, else they
 * open one. `rows` must not hold crossings after `nowMs`.
 */
export function groupEvents(rows: readonly CrossingRow[], times: PrintTimes, nowMs: number, decided: ReadonlyMap<number, DecidedEvent>): LiqEvent[] {
  const sorted = [...rows].sort((a, b) => a.at - b.at || a.symbol.localeCompare(b.symbol) || a.key.localeCompare(b.key));
  const byT0 = new Map<number, CrossingRow[]>();
  const openAt = (t0: number, members: readonly CrossingRow[], a: number): boolean => {
    if (a >= t0 + EVENT_MAX_MS) return false;
    const { close } = phases(t0, members, times, a, decided.get(t0));
    return close === null || a < close.at;
  };
  for (const row of sorted) {
    let t0 = row.eventAt;
    if (t0 === null) {
      const latest = [...byT0.keys()].filter((k) => k <= row.at).sort((a, b) => b - a)[0];
      t0 = latest !== undefined && openAt(latest, byT0.get(latest) as CrossingRow[], row.at) ? latest : row.at;
    }
    const members = byT0.get(t0) ?? [];
    members.push(row);
    byT0.set(t0, members);
  }
  return [...byT0].sort(([a], [b]) => a - b).map(([t0, members]) => ({ t0, members, ...phases(t0, members, times, nowMs, decided.get(t0)) }));
}

// ------------------------------------------------------------------------------------------------------- sums

export interface SidePrint { symbol: string; ts: number; usd: number; venue: LiqVenue }

export interface CoinSum {
  symbol: string;
  crossedAt: number;
  windowStartMs: number;
  sumUsd: number;
  byVenue: LiqByVenue;
  count: number;
  largest: { usd: number; venue: LiqVenue };
}

/** L12: one coin's prints over (fromMs, toMs]. */
export function coinSum(prints: readonly SidePrint[], symbol: string, crossedAt: number, fromMs: number, toMs: number): CoinSum {
  const byVenue = Object.fromEntries(LIQ_VENUES.map((v) => [v, 0])) as LiqByVenue;
  let sumUsd = 0;
  let count = 0;
  let largest: { usd: number; venue: LiqVenue } = { usd: 0, venue: 'binance' };
  for (const p of prints) {
    if (p.symbol !== symbol || p.ts <= fromMs || p.ts > toMs) continue;
    sumUsd += p.usd;
    count++;
    byVenue[p.venue] += p.usd;
    if (p.usd > largest.usd) largest = { usd: p.usd, venue: p.venue };
  }
  return { symbol, crossedAt, windowStartMs: crossedAt - WINDOW_MS, sumUsd, byVenue, count, largest };
}

/**
 * L12 / L13: every member crossed before `untilMs`, each summed from its own window start to `untilMs`, largest
 * first; and the event's totals.
 */
export function eventSums(members: readonly CrossingRow[], prints: readonly SidePrint[], untilMs: number): {
  coins: CoinSum[]; totalUsd: number; count: number; largest: { usd: number; venue: LiqVenue; symbol: string };
} {
  const coins = members.filter((m) => m.at < untilMs)
    .map((m) => coinSum(prints, m.symbol, m.at, m.at - WINDOW_MS, untilMs))
    .sort((a, b) => b.sumUsd - a.sumUsd || a.symbol.localeCompare(b.symbol));
  let largest = { usd: 0, venue: 'binance' as LiqVenue, symbol: coins[0]?.symbol ?? '' };
  for (const c of coins) if (c.largest.usd > largest.usd) largest = { ...c.largest, symbol: c.symbol };
  return { coins, totalUsd: coins.reduce((s, c) => s + c.sumUsd, 0), count: coins.reduce((s, c) => s + c.count, 0), largest };
}

/**
 * L13: why a capped event's continuation is news — coins that joined after the first message, and first-message
 * members that added at least their own threshold between S and the close. Both empty = journalled, not sent.
 */
export function continuationNews(
  members: readonly CrossingRow[], firstCoins: readonly string[], prints: readonly SidePrint[], sAt: number, closeAt: number,
  thresholdOf: (symbol: string) => number,
): { newCoins: string[]; addedCoins: string[] } {
  const newCoins = members.filter((m) => m.at < closeAt && !firstCoins.includes(m.symbol)).map((m) => m.symbol);
  const addedCoins = firstCoins.filter((s) => {
    const m = members.find((x) => x.symbol === s);
    return m !== undefined && coinSum(prints, s, m.at, sAt, closeAt).sumUsd >= thresholdOf(s);
  });
  return { newCoins, addedCoins };
}

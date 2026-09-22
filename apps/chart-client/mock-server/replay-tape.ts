import type { AheadResponse, Candle, InstrumentId, ReplayHistoryResponse, Timeframe } from '@trade-automation/contracts';
import { TIMEFRAME_MS } from '@trade-automation/contracts';
import { foldOneMinute } from '@trade-automation/replay-core';

/**
 * backtest-app-system-design.md §5.3, §7.2 — the mock's replay tape, so the workspace runs
 * against :4300 without a database. Deterministic 1m candles, generated from the time alone:
 * every minute of the instrument's mock coverage has a candle, except a daily empty stretch
 * 12:00–12:30 UTC (so stepping shows the empty-stretch jump), and the weekend-closed instruments
 * (T-056: DXY) have none from Friday 21:00 to Sunday 22:00 UTC, like the real Capital.com hours — so
 * a crypto + DXY session has one panel whose tape ends while the other carries on. History is `foldOneMinute` over the
 * tape — the function the real server's history endpoint uses — so the mock's forming bar is
 * the real one's.
 */

const M = 60_000;
const GAP_FROM_MIN = 12 * 60;
const GAP_TO_MIN = 12 * 60 + 30;
/** Bars the mock returns per history request at most (bounds the fold for 1d). */
const HISTORY_CAP = 300;

export interface TapeRange {
  from: number;
  /** Last 1m openTime held (inclusive), as `coverage.to`. */
  to: number;
}

/** T-056: instruments whose market closes over the weekend (Fri 21:00 → Sun 22:00 UTC). */
const WEEKEND_CLOSED: ReadonlySet<InstrumentId> = new Set(['capitalcom:DXY-MOCK' as InstrumentId]);

function weekendClosed(openTime: number): boolean {
  const d = new Date(openTime);
  const day = d.getUTCDay();
  const hour = d.getUTCHours();
  return (day === 5 && hour >= 21) || day === 6 || (day === 0 && hour < 22);
}

function hasCandle(instrument: InstrumentId, openTime: number, range: TapeRange): boolean {
  if (openTime < range.from || openTime > range.to) return false;
  if (WEEKEND_CLOSED.has(instrument) && weekendClosed(openTime)) return false;
  const minuteOfDay = (openTime / M) % 1440;
  return minuteOfDay < GAP_FROM_MIN || minuteOfDay >= GAP_TO_MIN;
}

function candleAt(instrument: InstrumentId, openTime: number): Candle {
  const i = openTime / M;
  const seed = instrument.length * 97;
  const close = 40_000 + 1_500 * Math.sin(i / 4_000 + seed) + 120 * Math.sin(i / 37) + ((i * 7919 + seed) % 41) - 20;
  const open = close - (((i * 31) % 17) - 8);
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    instrument,
    timeframe: '1m',
    openTime,
    open: r(open),
    high: r(Math.max(open, close) + ((i * 13) % 9)),
    low: r(Math.min(open, close) - ((i * 11) % 7)),
    close: r(close),
    volume: 1 + (i % 17),
    closed: true,
    source: 'storage',
  };
}

/** 1m candles with `from <= openTime < to`, ascending. */
export function tape1m(instrument: InstrumentId, range: TapeRange, from: number, to: number): Candle[] {
  const out: Candle[] = [];
  for (let t = Math.ceil(Math.max(from, range.from) / M) * M; t < to && t <= range.to; t += M) {
    if (hasCandle(instrument, t, range)) out.push(candleAt(instrument, t));
  }
  return out;
}

/** `GET …/candles`: the last `limit` closed `tf` bars before `before`, plus the forming one. */
export function replayHistory(instrument: InstrumentId, range: TapeRange, tf: Timeframe, before: number, limit: number): ReplayHistoryResponse {
  const tfMs = TIMEFRAME_MS[tf];
  const bars = Math.min(limit, HISTORY_CAP);
  const window = (from: number) => foldOneMinute(tape1m(instrument, range, from, before), tf, before);
  let folded = window(Math.floor(before / tfMs) * tfMs - bars * tfMs);
  // a weekend-closed instrument (T-056) on a Sunday: look back three days so it still gets its Friday
  // bars, as the real server's "the last N bars" would — only then, so ordinary requests stay cheap
  if (folded.closed.length < bars) folded = window(Math.min(Math.floor(before / tfMs) * tfMs - bars * tfMs, before - 3 * 1440 * M));
  const { closed, forming } = folded;
  return { bars: closed.slice(-bars), forming };
}

/** `GET …/candles/ahead`: up to `limit` 1m tuples from `fromMs`, clamped to the period. */
export function replayAhead(instrument: InstrumentId, range: TapeRange, fromMs: number, limit: number, periodToMs: number): AheadResponse {
  const end = Math.min(periodToMs - M + 1, range.to + 1); // a candle is in the period if it closes by periodToMs
  const found: Candle[] = [];
  for (let t = Math.ceil(fromMs / M) * M; t < end && found.length <= limit; t += M) {
    if (hasCandle(instrument, t, range)) found.push(candleAt(instrument, t));
  }
  return {
    candles: found.slice(0, limit).map((c) => [c.openTime, c.open, c.high, c.low, c.close, c.volume]),
    endOfTape: found.length <= limit,
  };
}

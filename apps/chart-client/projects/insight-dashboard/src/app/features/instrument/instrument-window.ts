import type { EconomicEvent, WebAlertMark, WebCandle, WebLiquidationEventsResponse, WebTimeframe } from '@trade-automation/contracts';
import { monthStart } from '@trade-automation/market-data-core';
import type { InsightApiClient } from '../../core/insight-api.client';
import { calendarWindow } from './future-bars';
import type { PaneData } from './pane-data';
import type { LaterTail } from './pane-merge';
import { sideWindow } from './time-range';

export interface WindowRequest {
  symbol: string;
  fromMs: number;
  toMs: number;
  timeframe: WebTimeframe;
  bucket: string;
}

/**
 * How far before the window the daily candles reach. The first ISO week on screen needs the whole week before
 * it (14 days covered that); IB-129: the first MONTH on screen needs the whole month before it, for PMH/PML.
 * So: the 1st of the month before the window's first month, or 14 days back if that is earlier. A 1d read of
 * ≤ 62 bars more than the window, one Binance page (weight 1–2, `candles.service.ts`).
 */
export const LEVELS_LOOKBACK_DAYS = 14;
/** The most `levelsFromMs` reaches back: the 31st of a month after a 31-day month is 30 + 31 days past its start. */
export const LEVELS_LOOKBACK_MAX_DAYS = 62;
export function levelsFromMs(fromMs: number): number {
  const previousMonth = monthStart(monthStart(Math.floor(fromMs / 1000)) - 1) * 1000;
  return Math.min(previousMonth, fromMs - LEVELS_LOOKBACK_DAYS * 86_400_000);
}

/**
 * Everything the chart draws for one time window, in one round of parallel reads. Used for the
 * first load and again for each earlier window when the reader scrolls left, so the two cannot
 * drift apart in what they fetch. Moved out of `instrument.component.ts` for that reuse and to
 * keep the component under the AGENTS.md ceiling.
 *
 * The perp candles failing fails the window; the daily candles behind the previous day/week
 * levels, the liquidation markers and the calendar degrade to nothing instead, each for its own
 * reason below.
 */
export async function fetchWindow(api: InsightApiClient, req: WindowRequest): Promise<PaneData> {
  const { symbol, fromMs, toMs, timeframe, bucket } = req;
  // IB-065: every read but the candles covers at most the window's last 90 days (`sideWindow`)
  const side = sideWindow(fromMs, toMs);
  const [candles, daily, oi, funding, longShort, liquidations, events, calendar, alertMarks] = await Promise.all([
    api.candles(symbol, fromMs, toMs, timeframe, 'perp'),
    fetchDaily(api, symbol, levelsFromMs(fromMs), toMs),
    api.openInterest(symbol, side.fromMs, side.toMs),
    api.funding(symbol, side.fromMs, side.toMs),
    api.longShort(symbol, side.fromMs, side.toMs, 'global_account'),
    api.liquidations(symbol, side.fromMs, side.toMs, bucket),
    fetchLiquidationEvents(api, symbol, side.fromMs, side.toMs, timeframe),
    fetchCalendar(api, calendarWindow(side.fromMs, side.toMs)),
    fetchAlertMarks(api, symbol, fromMs, toMs),
  ]);
  return {
    instrument: `binance:${symbol}`,
    timeframe,
    bucket,
    candles,
    openInterest: oi.points,
    openInterestCoverage: { coverageFrom: oi.coverageFrom, truncated: oi.truncated },
    funding,
    longShort,
    liquidations,
    liquidationEvents: events.events,
    liquidationVenues: events.venuesPresent,
    dailyCandles: daily,
    calendarEvents: calendar,
    ...(alertMarks ? { alertMarks } : {}),
  };
}

/**
 * IB-066 — the candle poll: the bars from the last one on screen up to now. One or two bars, so
 * the bot asks Binance for them at weight 1 (`candles.service.ts`). Failing is the poll's own
 * business: the scheduler skips the tick and asks again in five seconds.
 */
export async function fetchCandleTail(api: InsightApiClient, req: WindowRequest): Promise<LaterTail> {
  return { candles: (await api.candles(req.symbol, req.fromMs, req.toMs, req.timeframe, 'perp')).candles };
}

/**
 * IB-066 — the minute's poll: every pane that comes from the bot's database, from where the last
 * read ended, plus the daily candles when a new day has begun (`dailyFromMs`, else null). The
 * markers and the daily candles degrade as they do in `fetchWindow`. The markers are grouped per
 * bar as at load (IB-068), so the forming bar's row replaces the one on screen (`appendLater`).
 */
export async function fetchSideTail(api: InsightApiClient, req: WindowRequest, dailyFromMs: number | null): Promise<LaterTail> {
  const { symbol, toMs, timeframe, bucket } = req;
  const side = sideWindow(req.fromMs, toMs);
  const [oi, funding, longShort, liquidations, events, daily] = await Promise.all([
    api.openInterest(symbol, side.fromMs, side.toMs),
    api.funding(symbol, side.fromMs, side.toMs),
    api.longShort(symbol, side.fromMs, side.toMs, 'global_account'),
    api.liquidations(symbol, side.fromMs, side.toMs, bucket),
    fetchLiquidationEvents(api, symbol, side.fromMs, side.toMs, timeframe),
    dailyFromMs === null ? null : fetchDaily(api, symbol, dailyFromMs, toMs),
  ]);
  return {
    openInterest: oi.points, funding, longShort, liquidations,
    liquidationEvents: events.events, liquidationVenues: events.venuesPresent,
    ...(daily ? { dailyCandles: daily } : {}),
  };
}

/**
 * The 1d candles for PDH/PDL/PWH/PWL. A failed read costs the four lines, not the chart: they are
 * context over the price, and the price is still worth looking at without them.
 */
async function fetchDaily(api: InsightApiClient, symbol: string, fromMs: number, toMs: number): Promise<readonly WebCandle[]> {
  try {
    return (await api.candles(symbol, fromMs, toMs, '1d', 'perp')).candles;
  } catch {
    return [];
  }
}

/**
 * The markers' events, degrading rather than failing the page.
 *
 * A window with more than 2 000 liquidations answers `RANGE_TOO_WIDE`, which is the server
 * refusing to truncate. That is not a reason to show no chart: the candles are still worth
 * looking at, so the markers drop out and the rest of the page loads.
 */
async function fetchLiquidationEvents(api: InsightApiClient, symbol: string, fromMs: number, toMs: number, tf: WebTimeframe): Promise<WebLiquidationEventsResponse> {
  try {
    return await api.liquidationEvents(symbol, fromMs, toMs, 0, tf);
  } catch {
    return { symbol, minUsd: 0, events: [], venuesPresent: [], undercounted: true };
  }
}

/**
 * IB-060 — the USD events and holidays for the event lines and the holiday bands; since IB-067
 * also the week ahead (`calendarWindow`), for the lines right of the current bar. A failed read
 * (the bot's calendar is off, or a window wider than the server's 90 days) costs the marks, not
 * the chart: they are context, like the levels.
 */
async function fetchCalendar(api: InsightApiClient, range: { fromMs: number; toMs: number }): Promise<readonly EconomicEvent[]> {
  try {
    return (await api.calendarEvents(range.fromMs, range.toMs)).events;
  } catch {
    return [];
  }
}

/**
 * IB-129 — the alert marks for the whole window (they are sparse: one DB read, no venue call). A failed read
 * is undefined: no markers and no legend entries, the chart is whole without them.
 */
async function fetchAlertMarks(api: InsightApiClient, symbol: string, fromMs: number, toMs: number): Promise<readonly WebAlertMark[] | undefined> {
  try {
    return (await api.alertMarks(symbol, fromMs, toMs)).marks;
  } catch {
    return undefined;
  }
}

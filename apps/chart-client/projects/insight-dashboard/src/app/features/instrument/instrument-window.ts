import type { EconomicEvent, WebCandle, WebLiquidationEventsResponse, WebTimeframe } from '@trade-automation/contracts';
import type { InsightApiClient } from '../../core/insight-api.client';
import type { PaneData } from './pane-data';

export interface WindowRequest {
  symbol: string;
  fromMs: number;
  toMs: number;
  timeframe: WebTimeframe;
  bucket: string;
}

/** How far before the window the daily candles reach: the first ISO week on screen needs the whole week before it. */
const LEVELS_LOOKBACK_MS = 14 * 86_400_000;

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
  const [candles, daily, oi, funding, longShort, liquidations, events, calendar] = await Promise.all([
    api.candles(symbol, fromMs, toMs, timeframe, 'perp'),
    fetchDaily(api, symbol, fromMs - LEVELS_LOOKBACK_MS, toMs),
    api.openInterest(symbol, fromMs, toMs),
    api.funding(symbol, fromMs, toMs),
    api.longShort(symbol, fromMs, toMs, 'global_account'),
    api.liquidations(symbol, fromMs, toMs, bucket),
    fetchLiquidationEvents(api, symbol, fromMs, toMs),
    fetchCalendar(api, fromMs, toMs),
  ]);
  return {
    instrument: `binance:${symbol}`,
    timeframe,
    bucket,
    candles,
    openInterest: oi.points,
    funding,
    longShort,
    liquidations,
    liquidationEvents: events.events,
    liquidationVenues: events.venuesPresent,
    dailyCandles: daily,
    calendarEvents: calendar,
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
async function fetchLiquidationEvents(api: InsightApiClient, symbol: string, fromMs: number, toMs: number): Promise<WebLiquidationEventsResponse> {
  try {
    return await api.liquidationEvents(symbol, fromMs, toMs);
  } catch {
    return { symbol, minUsd: 0, events: [], venuesPresent: [], undercounted: true };
  }
}

/**
 * IB-060 — the USD events and holidays for the event lines and the holiday bands. A failed read
 * (the bot's calendar is off, or a window wider than the server's 90 days) costs the marks, not
 * the chart: they are context, like the levels.
 */
async function fetchCalendar(api: InsightApiClient, fromMs: number, toMs: number): Promise<readonly EconomicEvent[]> {
  try {
    return (await api.calendarEvents(fromMs, toMs)).events;
  } catch {
    return [];
  }
}

import { Candle, InstrumentId } from '@trade-automation/contracts';

export interface CapComPrice {
  bid: number;
  ask: number;
}

/** One row of Capital.com's `GET /api/v1/prices/{epic}` response (mirrors cmc-bot-main's CapComMarketData). */
export interface CapComPriceRow {
  snapshotTime: string;
  snapshotTimeUTC: string;
  openPrice: CapComPrice;
  closePrice: CapComPrice;
  highPrice: CapComPrice;
  lowPrice: CapComPrice;
  lastTradedVolume: number;
}

export interface CapComMarketDataResponse {
  prices: CapComPriceRow[];
  instrumentType: string;
}

/** Resolution literal Capital.com's REST/WS APIs use for 1-minute bars. */
export const CAP_COM_RESOLUTION_1M = 'MINUTE';

/**
 * architecture/live-signal-server.md §3.3: keep bid/ask OHLC for CFD venues instead of
 * collapsing to mid (cmc-bot-main's `mapMarketDataToChartData` throws the spread away —
 * both cmc-bot Architect notes flag "no honest cost model for a CFD broker" as a result).
 * `open/high/low/close` is still the mid, matching the bot and the research reproduction.
 */
export function mapPriceRow(instrument: InstrumentId, row: CapComPriceRow, closed: boolean): Candle {
  // snapshotTimeUTC has no trailing 'Z'; safe to Date.parse only because main.ts pins TZ=UTC
  // (architecture/live-signal-server.md §4.6) so the local-time interpretation IS UTC.
  const iso = row.snapshotTimeUTC.endsWith('Z') ? row.snapshotTimeUTC : `${row.snapshotTimeUTC}Z`;
  const openTime = Date.parse(iso);
  const mid = (a: number, b: number) => (a + b) / 2;

  return {
    instrument,
    timeframe: '1m',
    openTime,
    open: mid(row.openPrice.bid, row.openPrice.ask),
    high: mid(row.highPrice.bid, row.highPrice.ask),
    low: mid(row.lowPrice.bid, row.lowPrice.ask),
    close: mid(row.closePrice.bid, row.closePrice.ask),
    volume: row.lastTradedVolume ?? 0,
    closed,
    source: closed ? 'venue-rest' : 'venue-stream',
    bid: {
      open: row.openPrice.bid,
      high: row.highPrice.bid,
      low: row.lowPrice.bid,
      close: row.closePrice.bid,
    },
    ask: {
      open: row.openPrice.ask,
      high: row.highPrice.ask,
      low: row.lowPrice.ask,
      close: row.closePrice.ask,
    },
  };
}

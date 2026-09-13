import { Candle, InstrumentId, Timeframe } from '@trade-automation/contracts';

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
 * architecture/live-signal-server.md §12.5 item 3 — Capital.com's `resolution` enum values for
 * every timeframe this system fetches natively. `MINUTE`/`MINUTE_5`/`MINUTE_15`/`HOUR`/`DAY` are
 * confirmed live-API-correct by `research/cmc-bot-vwap/results/capital_com_floor_probe.txt` (all
 * five were accepted and returned real rows or the venue's own `error.prices.not-found` — never
 * an "invalid resolution" error). `HOUR_4` was not exercised by that probe (no live credentials
 * were available to re-probe it here either — see §12.4/HANDOFF); it is corroborated instead by
 * `cmc-bot-main/src/types/enums.ts`'s `CapComTimeIntervals.HOUR_4`, the same literal a working,
 * previously-shipped client already sends to this venue's real API.
 */
/**
 * architecture/live-signal-server.md §12.2/§12.4 — confirmed by
 * `research/cmc-bot-vwap/results/capital_com_floor_probe.txt` (bisection) for
 * US100/US500/EURCHF/GBPCHF, the four Capital.com instruments this server actually configures:
 * `MINUTE`/`MINUTE_5`/`MINUTE_15` 404 for any date before 2024-01-02. Intraday-only — `HOUR`/
 * `HOUR_4`/`DAY` are known to go deeper (see `CAP_COM_DOCUMENTED_COARSE_FLOOR_MS` in
 * ingestion.service.ts) but that floor is not fully bisected, so it is not hardcoded here.
 */
export const CAP_COM_INTRADAY_FLOOR_MS = Date.UTC(2024, 0, 2);

export const CAP_COM_RESOLUTION: Record<Timeframe, string> = {
  '1m': 'MINUTE',
  '5m': 'MINUTE_5',
  '15m': 'MINUTE_15',
  '1h': 'HOUR',
  '4h': 'HOUR_4',
  '1d': 'DAY',
};

/**
 * architecture/live-signal-server.md §3.3: keep bid/ask OHLC for CFD venues instead of
 * collapsing to mid (cmc-bot-main's `mapMarketDataToChartData` throws the spread away —
 * both cmc-bot Architect notes flag "no honest cost model for a CFD broker" as a result).
 * `open/high/low/close` is still the mid, matching the bot and the research reproduction.
 *
 * `tf` defaults to `'1m'` (source `venue-rest`/`venue-stream` per `closed`); §12.1/§12.5 item 3's
 * native coarser fetch passes the requested `tf` and always gets `source: 'venue-native'`
 * (those bars are only ever fetched closed/historical, never streamed).
 */
export function mapPriceRow(instrument: InstrumentId, row: CapComPriceRow, closed: boolean, tf: Timeframe = '1m'): Candle {
  // snapshotTimeUTC has no trailing 'Z'; safe to Date.parse only because main.ts pins TZ=UTC
  // (architecture/live-signal-server.md §4.6) so the local-time interpretation IS UTC.
  const iso = row.snapshotTimeUTC.endsWith('Z') ? row.snapshotTimeUTC : `${row.snapshotTimeUTC}Z`;
  const openTime = Date.parse(iso);
  const mid = (a: number, b: number) => (a + b) / 2;

  return {
    instrument,
    timeframe: tf,
    openTime,
    open: mid(row.openPrice.bid, row.openPrice.ask),
    high: mid(row.highPrice.bid, row.highPrice.ask),
    low: mid(row.lowPrice.bid, row.lowPrice.ask),
    close: mid(row.closePrice.bid, row.closePrice.ask),
    volume: row.lastTradedVolume ?? 0,
    closed,
    source: tf !== '1m' ? 'venue-native' : closed ? 'venue-rest' : 'venue-stream',
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
